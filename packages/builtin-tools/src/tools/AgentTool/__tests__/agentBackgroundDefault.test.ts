import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const agentToolSource = readFileSync(
  join(__dirname, '..', 'AgentTool.tsx'),
  'utf-8',
)
const promptSource = readFileSync(join(__dirname, '..', 'prompt.ts'), 'utf-8')

describe('Agent background-by-default (official 208)', () => {
  test('schema describe says background by default / set false for sync', () => {
    expect(agentToolSource).toContain('Agents run in the background by default')
    expect(agentToolSource).toContain(
      'Set to false only when your very next action depends on this agent',
    )
    expect(agentToolSource).not.toContain(
      'Set to true to run this agent in the background',
    )
  })

  test('shouldRunAsync uses densable wo h/b/D with !== false default', () => {
    // densable wo: b = ... || (!h && p!==false); D = ... || (!Mv(e) && b)
    expect(agentToolSource).toContain('(!h && run_in_background !== false)')
    expect(agentToolSource).toContain('(!isWebFetchSpawn && b)')
    expect(agentToolSource).toContain(
      'isRemoteIsolation || (D && !spawnBackgroundTasksDisabled)',
    )
    expect(agentToolSource).not.toContain('isProactiveActive')
  })

  test('async_launched map does not invite Read/Bash tail of outputFile', () => {
    expect(agentToolSource).not.toContain(
      'If asked, you can check progress before completion by using',
    )
    expect(agentToolSource).toContain('Cloud agent launched')
  })

  test('prompt says Agents run in the background by default', () => {
    expect(promptSource).toContain('Agents run in the background by default')
    expect(promptSource).toContain('run_in_background: false')
    expect(promptSource).not.toContain('Foreground (default)')
    expect(promptSource).not.toContain('Use foreground (default)')
  })
})
