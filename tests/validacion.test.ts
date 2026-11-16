import { expect, test } from 'claude-code/testing'

// The input checks answer before Codex is looked for, so nothing runs on the host.
const TOOL = 'mcp__codex-imagenes__generar'

test('refuses a call without an encargo, a .png destino or a known size', async ($, on) => {
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proyecto' }))
  on('env.get', () => ({ value: '/Users/alguien' }))
  on('fs.exists', () => ({ value: false }))
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })

  const empty = await $.tool.call({ tool: TOOL, encargo: '  ', destino: 'a.png' })
  expect(empty.deny).toContain('falta el encargo')

  const jpg = await $.tool.call({ tool: TOOL, encargo: 'Una playa', destino: 'a.jpg' })
  expect(jpg.deny).toContain('.png')

  const size = await $.tool.call({ tool: TOOL, encargo: 'Una playa', destino: 'a.png', tamano: '800x600' })
  expect(size.deny).toContain('1536x1024')

  const references = await $.tool.call({ tool: TOOL, encargo: 'Una playa', destino: 'a.png', referencias: 'b.png' })
  expect(references.deny).toContain('referencias')
})
