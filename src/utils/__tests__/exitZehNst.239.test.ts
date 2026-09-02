import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

const root = join(import.meta.dir, '../../..')

describe('exit / pke densable nst·Zeh·isRunning wiring (239)', () => {
  test('wZt uses Jeh + isRunning; wO0 uses Zeh; $To finishExit uses nst', () => {
    const repl = readFileSync(join(root, 'src/screens/REPL.tsx'), 'utf8')
    expect(repl).toContain('listExitBackgroundItems')
    expect(repl).toContain('queryGuard.isRunning')
    expect(repl).toContain('exitPromptShutdown')
    // densable wZt: no onBeforeExit (iwg only from wO0/TTc) — must NOT latch
    // shutting-down before ExitFlow confirm.
    expect(repl).not.toContain(
      "onBeforeExit={() => setPke({ kind: 'shutting-down' })}",
    )
    expect(repl).not.toMatch(
      /getIsResponseStreaming=\{\(\) => queryGuard\.isActive\}/,
    )

    const exitCmd = readFileSync(
      join(root, 'src/commands/exit/exit.tsx'),
      'utf8',
    )
    expect(exitCmd).toContain('listExitInFlightItems')
    expect(exitCmd).toContain('exitPromptShutdown')
    expect(exitCmd).not.toContain('listExitBackgroundItems')

    const flow = readFileSync(join(root, 'src/components/ExitFlow.tsx'), 'utf8')
    expect(flow).toContain('exitPromptShutdown')
    expect(flow).toContain('resolveMidTurn()')
    expect(flow).not.toContain('resolveMidTurn() || resolveStreaming()')
  })
})
