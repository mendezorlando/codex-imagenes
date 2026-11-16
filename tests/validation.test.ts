import { expect, test } from 'claude-code/testing'

// The input checks answer before Codex is looked for, so nothing runs on the host.
const TOOL = 'mcp__codex-imagenes__generate'

test('refuses a call without a prompt, a .png output or a known size', async ($, on) => {
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/project' }))
  on('env.get', () => ({ value: '/Users/someone' }))
  on('fs.exists', () => ({ value: false }))
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  const empty = await $.tool.call({ tool: TOOL, prompt: '  ', output: 'a.png' })
  expect(empty.deny).toContain('prompt is missing')

  const jpg = await $.tool.call({ tool: TOOL, prompt: 'A beach', output: 'a.jpg' })
  expect(jpg.deny).toContain('.png')

  const size = await $.tool.call({ tool: TOOL, prompt: 'A beach', output: 'a.png', size: '800x600' })
  expect(size.deny).toContain('1536x1024')

  const references = await $.tool.call({ tool: TOOL, prompt: 'A beach', output: 'a.png', references: 'b.png' })
  expect(references.deny).toContain('references')
})
