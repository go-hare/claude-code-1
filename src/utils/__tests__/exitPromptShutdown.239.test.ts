import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

const root = join(import.meta.dir, '../../..')

describe('process_exit wired on prompt_input_exit (densable nst/WFl)', () => {
  test('gracefulShutdown cancels quota auto-resume for prompt_input_exit', () => {
    const src = readFileSync(
      join(root, 'src/utils/gracefulShutdown.ts'),
      'utf8',
    )
    expect(src).toContain("reason === 'prompt_input_exit'")
    expect(src).toContain("cancelQuotaAutoResume('process_exit')")
  })

  test('nst helpers and product exit paths use prompt_input_exit', () => {
    const nst = readFileSync(
      join(root, 'src/utils/exitPromptShutdown.ts'),
      'utf8',
    )
    expect(nst).toContain("gracefulShutdown(0, 'prompt_input_exit')")
    expect(nst).toContain('storageV5?: unknown')

    const flow = readFileSync(join(root, 'src/components/ExitFlow.tsx'), 'utf8')
    expect(flow).toContain('exitPromptShutdown')

    const exitCmd = readFileSync(
      join(root, 'src/commands/exit/exit.tsx'),
      'utf8',
    )
    expect(exitCmd).toContain('exitPromptShutdown')

    const repl = readFileSync(join(root, 'src/screens/REPL.tsx'), 'utf8')
    expect(repl).toContain('exitPromptShutdown')

    // xTo uses background_handoff cancel, then oc via prompt_input_exit
    // (gracefulShutdown still runs process_exit idempotently).
    const bg = readFileSync(
      join(root, 'src/components/BackgroundAndExit.tsx'),
      'utf8',
    )
    expect(bg).toContain("beginQuotaAutoResumeHandoff('background_handoff')")
    expect(bg).toContain("gracefulShutdown(0, 'prompt_input_exit'")
  })

  test('leftover 239 /desktop Q6e desktop_handoff + kHe', () => {
    const desktop = readFileSync(
      join(root, 'src/components/DesktopHandoff.tsx'),
      'utf8',
    )
    expect(desktop).toContain("beginQuotaAutoResumeHandoff('desktop_handoff')")
    expect(desktop).toContain('endQuotaAutoResumeHandoff()')
  })
})
