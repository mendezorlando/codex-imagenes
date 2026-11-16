import type { EngineInterface, Register } from 'claude-code'

// Generates one image with the person's ChatGPT subscription through Codex CLI:
// `codex exec` ephemeral (no session saved), read-only, with the built-in
// image_gen tool and OPENAI_API_KEY blanked, so it never bills the API. The
// image lands in ~/.codex/generated_images/<thread>/; it is moved to `destino`
// and that folder and the work folder are removed (the origin is left clean).

type $ = EngineInterface
type Input = { encargo?: unknown; destino?: unknown; referencias?: unknown; tamano?: unknown; sobrescribir?: unknown }
type CodexEvent = { type?: string; thread_id?: string; usage?: { input_tokens?: number; output_tokens?: number }; message?: string; error?: { message?: string } }
type Outcome = { deny: string } | { result: string }

const TOOL = 'generar'
const SIZES = ['1536x1024', '1024x1536', '1024x1024']
const REFERENCE = /\.(png|jpe?g|webp)$/i
const SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['status', 'note'],
  properties: { status: { type: 'string', enum: ['generated', 'refused', 'failed'] }, note: { type: 'string' } },
})

const DESCRIPTION =
  'Genera UNA imagen raster (foto, ilustración, textura, maqueta) con la suscripción de ChatGPT de la persona, ' +
  'a través de Codex CLI y su herramienta image_gen integrada: nunca con la API ni con una clave. Tarda de 1 a 3 minutos. ' +
  'Escribe un PNG en `destino` y devuelve JSON con la ruta, el tamaño, el sha256, los segundos y una nota de Codex; ' +
  'el origen (~/.codex/generated_images y la carpeta de trabajo) queda limpio y Codex no guarda la sesión. ' +
  'Para mantener un personaje, un producto o un estilo, pasa sus imágenes en `referencias`. ' +
  'Enséñale la imagen a la persona antes de usarla en su producto.'

const INPUT_SCHEMA = {
  type: 'object',
  required: ['encargo', 'destino'],
  properties: {
    encargo: { type: 'string', description: 'Lo que debe mostrar: sujeto, encuadre, luz, paleta y lo que no debe aparecer.' },
    destino: { type: 'string', description: 'Ruta del PNG (absoluta, con ~/ o relativa al directorio de la sesión); termina en .png.' },
    referencias: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Imágenes png, jpg o webp de referencia.' },
    tamano: { type: 'string', enum: SIZES, description: 'Por defecto, 1536x1024 (horizontal).' },
    sobrescribir: { type: 'boolean', description: 'Reemplaza el destino si ya existe; por defecto, false.' },
  },
}

const brief = (encargo: string, size: string, hasReferences: boolean) =>
  [
    'Genera UNA imagen con tu herramienta integrada de generación de imágenes (image_gen).',
    'No ejecutes comandos, no escribas código, no uses scripts ni ninguna API, y no copies ni muevas archivos: quien te llama recoge la imagen.',
    `Tamaño: ${size}.`,
    ...(hasReferences ? ['Las imágenes adjuntas son referencias: conserva la identidad, los rasgos y el estilo que muestran.'] : []),
    '',
    'Encargo:',
    encargo,
    '',
    'Responde solo con el JSON del esquema: status "generated" si la imagen salió, "refused" si no puedes generarla y "failed" si algo falló; en note, una frase con lo que generaste o por qué no.',
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
    ? 'Codex tiene sesión con una clave de API y este plugin solo usa la suscripción: ejecuta `codex logout` y `codex login` con tu cuenta de ChatGPT.'
    : `Codex no tiene sesión iniciada con ChatGPT (${tail(text, 200) || 'sin respuesta'}): ejecuta \`codex login\`.`
}

async function generate($: $, input: Input): Promise<Outcome> {
  const fail = (text: string): Outcome => ({ deny: `codex-imagenes: ${text}` })

  const encargo = typeof input.encargo === 'string' ? input.encargo.trim() : ''
  if (encargo === '') return fail('falta el encargo.')
  if (encargo.length > 8000) return fail('el encargo pasa de 8000 caracteres.')
  if (typeof input.destino !== 'string' || !/\.png$/i.test(input.destino)) return fail('`destino` debe ser una ruta que termine en .png.')
  const size = input.tamano ?? SIZES[0]
  if (typeof size !== 'string' || !SIZES.includes(size)) return fail(`\`tamano\` debe ser ${SIZES.join(', ')}.`)
  const listed = input.referencias ?? []
  if (!Array.isArray(listed) || listed.length > 8 || listed.some(item => typeof item !== 'string')) {
    return fail('`referencias` debe ser una lista de hasta 8 rutas.')
  }

  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  const absolute = (path: string) => (path.startsWith('/') ? path : path.startsWith('~/') ? home + path.slice(1) : join(cwd, path))
  const destino = absolute(input.destino)
  if (input.sobrescribir !== true && (await $.fs.exists(destino))) {
    return fail(`${destino} ya existe; pasa \`sobrescribir: true\` para reemplazarlo.`)
  }
  const references: string[] = []
  for (const item of listed as string[]) {
    const path = absolute(item)
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat?.kind !== 'file' || !REFERENCE.test(path)) return fail(`la referencia ${path} no es un png, jpg o webp que exista.`)
    references.push(path)
  }

  const codex = await findCodex($)
  if (codex === undefined) return fail('no encuentro Codex CLI en el PATH ni en ~/.local/bin: instálalo e inicia sesión con `codex login`.')
  const problem = await loginProblem($, codex)
  if (problem !== undefined) return fail(problem)

  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  const work = join(tmp, `codex-imagenes-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  await $.fs.write(join(work, 'schema.json'), SCHEMA)
  const removeWork = () => $.process.run(['rm', '-rf', work]).catch(() => undefined)

  const label = base(destino)
  const startedAt = Date.now()
  const elapsed = () => Math.round((Date.now() - startedAt) / 1000)
  const tick = () => $.ui.status(`Codex genera ${label}… ${elapsed()} s`)
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
      { stdin: brief(encargo, size, references.length > 0), timeoutMs: 600_000, env: { OPENAI_API_KEY: '' } },
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
      failed && `evento ${failed.type}: ${failed.error?.message ?? failed.message ?? ''}`,
      crash && `no terminó: ${crash}`,
      run && run.exitCode !== 0 && `salida ${run.exitCode}: ${tail(run.stderr)}`,
    ].filter(Boolean).join(' · ')
    return fail(`no salió ninguna imagen (${elapsed()} s). ${why || 'Sin más detalle.'}`)
  }

  const made = await $.process.run(['mkdir', '-p', parent(destino)])
  if (made.exitCode !== 0) return fail(`no pude crear ${parent(destino)}: ${tail(made.stderr, 300)}. La imagen sigue en ${origin}.`)
  const extra: string[] = []
  for (const [index, image] of images.entries()) {
    const target = index === 0 ? destino : destino.replace(/\.png$/i, `-${index + 1}.png`)
    const moved = await $.process.run(['mv', '-f', join(origin!, image.name), target])
    if (moved.exitCode !== 0) return fail(`no pude mover ${image.name} a ${target}: ${tail(moved.stderr, 300)}. Sigue en ${origin}.`)
    if (index > 0) extra.push(target)
  }
  await $.process.run(['rmdir', origin!]).catch(() => undefined)
  await removeWork()

  const described = await $.process.run(['file', '-b', destino]).catch(() => undefined)
  const [, width, height] = /(\d+) x (\d+)/.exec(described?.stdout ?? '') ?? []
  const hashed = await $.process.run(['shasum', '-a', '256', destino])
    .catch(() => $.process.run(['sha256sum', destino]))
    .catch(() => undefined)
  const bytes = await $.fs.stat(destino).then(stat => stat.size).catch(() => undefined)
  const seconds = elapsed()

  $.ui.toast(`${label}: lista en ${seconds} s`)
  if (seconds >= 60) void $.ui.notify(`${label} está lista (${seconds} s).`, { title: 'Codex · imágenes' }).catch(() => undefined)

  return {
    result: JSON.stringify({
      estado: answer?.status === 'generated' || answer === undefined ? 'generada' : answer.status,
      ruta: destino,
      ancho: width === undefined ? undefined : Number(width),
      alto: height === undefined ? undefined : Number(height),
      bytes,
      sha256: hashed?.stdout.split(/\s/)[0] || undefined,
      segundos: seconds,
      nota: answer?.note,
      hilo: thread,
      tokens: usage && { entrada: usage.input_tokens, salida: usage.output_tokens },
      otras: extra.length > 0 ? extra : undefined,
      origen: 'limpio',
    }),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({ name: TOOL, description: DESCRIPTION, inputSchema: INPUT_SCHEMA })
    return started
  })
  on('tool.call', { tool: 'mcp__codex-imagenes__generar' }, ($, e) => generate($, e as unknown as Input))
    .catch(($, e, next) => ({ deny: `codex-imagenes: falló (${next.error.kind}: ${(next.error.message ?? '').slice(0, 300)}).` }))
}
