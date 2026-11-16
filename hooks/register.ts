import type { EngineInterface, Register } from 'claude-code'

// Generates one image with the person's ChatGPT subscription through Codex CLI:
// `codex exec` ephemeral (no session saved), read-only, with the built-in
// image_gen tool and OPENAI_API_KEY blanked, so it never bills the API. The
// image lands in ~/.codex/generated_images/<thread>/; it is moved to `output`
// and that folder and the work folder are removed (the origin is left clean).

type $ = EngineInterface
type Input = { prompt?: unknown; output?: unknown; references?: unknown; size?: unknown; overwrite?: unknown }
type CodexEvent = { type?: string; thread_id?: string; usage?: { input_tokens?: number; output_tokens?: number }; message?: string; error?: { message?: string } }
type Outcome = { deny: string } | { result: string }

const TOOL = 'generate'
const SIZES = ['1536x1024', '1024x1536', '1024x1024']
const REFERENCE = /\.(png|jpe?g|webp)$/i
const SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['status', 'note'],
  properties: { status: { type: 'string', enum: ['generated', 'refused', 'failed'] }, note: { type: 'string' } },
})

const DESCRIPTION =
  'Generates ONE raster image (photo, illustration, texture, mockup) with the person\'s ChatGPT subscription, ' +
  'through Codex CLI and its built-in image_gen tool: never with the API or a key. Takes 1 to 3 minutes. ' +
  'Writes a PNG to `output` and returns JSON with the path, size, sha256, seconds and a note from Codex; ' +
  'the origin (~/.codex/generated_images and the work folder) is left clean and Codex saves no session. ' +
  'To keep a character, a product or a style, pass its images in `references`. ' +
  'Show the image to the person before using it in their product.'

const INPUT_SCHEMA = {
  type: 'object',
  required: ['prompt', 'output'],
  properties: {
    prompt: { type: 'string', description: 'What it must show: subject, framing, light, palette and what must not appear.' },
    output: { type: 'string', description: 'Path of the PNG (absolute, with ~/ or relative to the session directory); ends in .png.' },
    references: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Reference images: png, jpg or webp.' },
    size: { type: 'string', enum: SIZES, description: 'Defaults to 1536x1024 (landscape).' },
    overwrite: { type: 'boolean', description: 'Replaces the output if it exists; defaults to false.' },
  },
}

const brief = (prompt: string, size: string, hasReferences: boolean) =>
  [
    'Generate ONE image with your built-in image generation tool (image_gen).',
    'Do not run commands, write code, use scripts or any API, and do not copy or move files: the caller collects the image.',
    `Size: ${size}.`,
    ...(hasReferences ? ['The attached images are references: keep the identity, features and style they show.'] : []),
    '',
    'Brief:',
    prompt,
    '',
    'Reply only with the JSON of the schema: status "generated" if the image came out, "refused" if you cannot generate it and "failed" if something went wrong; in note, one sentence on what you generated or why not.',
  ].join('\n')

const join = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`
const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
// Codex logs a websocket fallback on every run; it is noise, not the failure.
const tail = (text: string, size = 600) =>
  text.split('\n').filter(line => !/websocket/i.test(line)).join('\n').trim().slice(-size)

let codexPath: string | undefined
let isSubscription = false

async function findCodex($: $) {
  if (codexPath !== undefined && (await $.fs.exists(codexPath))) return codexPath
  const home = (await $.env.get('HOME')) ?? ''
  const dirs = [...((await $.env.get('PATH')) ?? '').split(':'), `${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin']
  for (const dir of dirs) {
    if (dir.startsWith('/') && (await $.fs.exists(join(dir, 'codex')))) return (codexPath = join(dir, 'codex'))
  }
  return undefined
}

/** undefined when Codex is signed in with ChatGPT; else why not. */
async function loginProblem($: $, codex: string) {
  if (isSubscription) return undefined
  const status = await $.process.run([codex, 'login', 'status'], { stdin: '', timeoutMs: 30_000 }).catch(() => undefined)
  const text = `${status?.stdout ?? ''}\n${status?.stderr ?? ''}`
  if (/logged in using chatgpt/i.test(text)) {
    isSubscription = true
    return undefined
  }
  return /api key/i.test(text)
    ? 'Codex is signed in with an API key and this plugin only uses the subscription: run `codex logout` and `codex login` with your ChatGPT account.'
    : `Codex is not signed in with ChatGPT (${tail(text, 200) || 'no answer'}): run \`codex login\`.`
}

async function generate($: $, input: Input): Promise<Outcome> {
  const fail = (text: string): Outcome => ({ deny: `codex-imagenes: ${text}` })

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (prompt === '') return fail('the prompt is missing.')
  if (prompt.length > 8000) return fail('the prompt is longer than 8000 characters.')
  if (typeof input.output !== 'string' || !/\.png$/i.test(input.output)) return fail('`output` must be a path ending in .png.')
  const size = input.size ?? SIZES[0]
  if (typeof size !== 'string' || !SIZES.includes(size)) return fail(`\`size\` must be ${SIZES.join(', ')}.`)
  const listed = input.references ?? []
  if (!Array.isArray(listed) || listed.length > 8 || listed.some(item => typeof item !== 'string')) {
    return fail('`references` must be a list of up to 8 paths.')
  }

  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  const absolute = (path: string) => (path.startsWith('/') ? path : path.startsWith('~/') ? home + path.slice(1) : join(cwd, path))
  const output = absolute(input.output)
  if (input.overwrite !== true && (await $.fs.exists(output))) {
    return fail(`${output} already exists; pass \`overwrite: true\` to replace it.`)
  }
  const references: string[] = []
  for (const item of listed as string[]) {
    const path = absolute(item)
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat?.kind !== 'file' || !REFERENCE.test(path)) return fail(`the reference ${path} is not an existing png, jpg or webp.`)
    references.push(path)
  }

  const codex = await findCodex($)
  if (codex === undefined) return fail('Codex CLI is not on the PATH or in ~/.local/bin: install it and sign in with `codex login`.')
  const problem = await loginProblem($, codex)
  if (problem !== undefined) return fail(problem)

  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  const work = join(tmp, `codex-imagenes-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  await $.fs.write(join(work, 'schema.json'), SCHEMA)
  const removeWork = () => $.process.run(['rm', '-rf', work]).catch(() => undefined)

  const label = base(output)
  const startedAt = Date.now()
  const elapsed = () => Math.round((Date.now() - startedAt) / 1000)
  const tick = () => $.ui.status(`Codex is generating ${label}… ${elapsed()} s`)
  tick()
  const timer = $.clock.every(5000, tick)
  let run: Awaited<ReturnType<$['process']['run']>> | undefined
  let crash = ''
  try {
    // shortcut: an interrupted call leaves Codex running up to its 10 min timeout; stream with $.process.spawn if that matters.
    run = await $.process.run(
      [codex, 'exec', '--skip-git-repo-check', '--ephemeral', '--json', '-s', 'read-only', '-C', work,
        '--output-schema', join(work, 'schema.json'), '-o', join(work, 'last.json'),
        ...references.flatMap(path => ['-i', path])],
      { stdin: brief(prompt, size, references.length > 0), timeoutMs: 600_000, env: { OPENAI_API_KEY: '' } },
    )
  } catch (error) {
    crash = String(error)
  } finally {
    timer.cancel()
    $.ui.status(undefined)
  }

  const events: CodexEvent[] = (run?.stdout ?? '').split('\n').flatMap(line => {
    try {
      return [JSON.parse(line) as CodexEvent]
    } catch {
      return []
    }
  })
  const thread = events.find(event => event.type === 'thread.started')?.thread_id
  const usage = events.find(event => event.type === 'turn.completed')?.usage
  const failed = events.find(event => event.type === 'turn.failed' || event.type === 'error')
  const answer = await $.fs
    .read(join(work, 'last.json'))
    .then(text => JSON.parse(text) as { status?: string; note?: string })
    .catch(() => undefined)

  const origin = thread !== undefined && /^[\w-]+$/.test(thread) ? join(home, `.codex/generated_images/${thread}`) : undefined
  const images = origin === undefined ? [] : (await $.fs.list(origin).catch(() => []))
    .filter(entry => entry.kind === 'file' && /\.png$/i.test(entry.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  if (images.length === 0) {
    await removeWork()
    const why = [
      answer?.note && `Codex: ${answer.status ?? '?'}, ${answer.note}`,
      failed && `event ${failed.type}: ${failed.error?.message ?? failed.message ?? ''}`,
      crash && `did not finish: ${crash}`,
      run && run.exitCode !== 0 && `exit ${run.exitCode}: ${tail(run.stderr)}`,
    ].filter(Boolean).join(' · ')
    return fail(`no image came out (${elapsed()} s). ${why || 'No more detail.'}`)
  }

  const made = await $.process.run(['mkdir', '-p', parent(output)])
  if (made.exitCode !== 0) return fail(`could not create ${parent(output)}: ${tail(made.stderr, 300)}. The image is still in ${origin}.`)
  const others: string[] = []
  for (const [index, image] of images.entries()) {
    const target = index === 0 ? output : output.replace(/\.png$/i, `-${index + 1}.png`)
    const moved = await $.process.run(['mv', '-f', join(origin!, image.name), target])
    if (moved.exitCode !== 0) return fail(`could not move ${image.name} to ${target}: ${tail(moved.stderr, 300)}. It is still in ${origin}.`)
    if (index > 0) others.push(target)
  }
  await $.process.run(['rmdir', origin!]).catch(() => undefined)
  await removeWork()

  const described = await $.process.run(['file', '-b', output]).catch(() => undefined)
  const [, width, height] = /(\d+) x (\d+)/.exec(described?.stdout ?? '') ?? []
  const hashed = await $.process.run(['shasum', '-a', '256', output])
    .catch(() => $.process.run(['sha256sum', output]))
    .catch(() => undefined)
  const bytes = await $.fs.stat(output).then(stat => stat.size).catch(() => undefined)
  const seconds = elapsed()

  $.ui.toast(`${label}: ready in ${seconds} s`)
  if (seconds >= 60) void $.ui.notify(`${label} is ready (${seconds} s).`, { title: 'Codex · images' }).catch(() => undefined)

  return {
    result: JSON.stringify({
      status: answer?.status ?? 'generated',
      path: output,
      width: width === undefined ? undefined : Number(width),
      height: height === undefined ? undefined : Number(height),
      bytes,
      sha256: hashed?.stdout.split(/\s/)[0] || undefined,
      seconds,
      note: answer?.note,
      thread,
      tokens: usage && { input: usage.input_tokens, output: usage.output_tokens },
      others: others.length > 0 ? others : undefined,
      origin: 'clean',
    }),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({ name: TOOL, description: DESCRIPTION, inputSchema: INPUT_SCHEMA })
    return started
  })
  on('tool.call', { tool: 'mcp__codex-imagenes__generate' }, ($, e) => generate($, e as unknown as Input))
    .catch(($, e, next) => ({ deny: `codex-imagenes: failed (${next.error.kind}: ${(next.error.message ?? '').slice(0, 300)}).` }))
}
