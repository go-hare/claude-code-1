/**
 * densable 2.1.248 #29 — Shift-Tab (chat:cycleMode) dismisses the armed
 * Ctrl-C "press again to exit" hint so the permission-mode indicator shows.
 *
 * GOLD: official-248 claude.exe a9 @203088579 sha=fee3bf6fc23ba497
 * Unique vs 247 yh @232689460: `Vr((Ci)=>Ci.show?{show:!1}:Ci)`
 * (247 had `ro(!1)` / setHelpOpen only; no exit-hint clear).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { dismissExitHintIfShowing } from '../dismissExitHintIfShowing.js'

const promptSrc = readFileSync(
  join(import.meta.dir, '../PromptInput.tsx'),
  'utf8',
)

describe('densable 2.1.248 #29 a9 Vr exit-hint clear', () => {
  test('gold Vr: show true → {show:false} (drops key)', () => {
    expect(dismissExitHintIfShowing({ show: true, key: 'Ctrl-C' })).toEqual({
      show: false,
    })
  })

  test('gold Vr: show false returns the same object', () => {
    const prev = { show: false as const, key: 'Ctrl-C' }
    expect(dismissExitHintIfShowing(prev)).toBe(prev)
  })

  test('handleCycleMode calls Vr at start (SEA a9 comma before teammate gate)', () => {
    expect(promptSrc).toContain('setExitMessage(dismissExitHintIfShowing)')
    const cycleIdx = promptSrc.indexOf(
      'const handleCycleMode = useCallback(() => {',
    )
    expect(cycleIdx).toBeGreaterThan(-1)
    const teammateIdx = promptSrc.indexOf(
      'if (isAgentSwarmsEnabled() && viewedTeammate && viewingAgentTaskId)',
      cycleIdx,
    )
    const vrIdx = promptSrc.indexOf(
      'setExitMessage(dismissExitHintIfShowing)',
      cycleIdx,
    )
    expect(vrIdx).toBeGreaterThan(cycleIdx)
    expect(vrIdx).toBeLessThan(teammateIdx)
  })

  test('does not invent AgentView exitArmed clear on Shift-Tab', () => {
    expect(promptSrc).not.toContain('exitArmed')
    expect(promptSrc).not.toContain('setExitArmed')
  })
})
