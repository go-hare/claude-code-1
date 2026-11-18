import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { LEFT_ARROW_STOPPED_TURN_TOAST } from '../leftArrowConfirm.js'

describe('2.1.292-2.1.296 REPL / LeftArrow / Cancel / Config / PromptInput', () => {
  const replSrc = readFileSync(
    join(import.meta.dir, '../../screens/REPL.tsx'),
    'utf8',
  )
  const turnSrc = readFileSync(
    join(import.meta.dir, '../../screens/repl/runReplTurn.ts'),
    'utf8',
  )
  const cancelSrc = readFileSync(
    join(import.meta.dir, '../../hooks/useCancelRequest.ts'),
    'utf8',
  )
  const configSrc = readFileSync(
    join(import.meta.dir, '../../components/Settings/Config.tsx'),
    'utf8',
  )
  const promptSrc = readFileSync(
    join(import.meta.dir, '../../components/PromptInput/PromptInput.tsx'),
    'utf8',
  )

  test('#211 /resume restores plan mode via preparePlanModeRestoreOnInteractiveResume', () => {
    expect(replSrc).toContain('preparePlanModeRestoreOnInteractiveResume')
    expect(replSrc).toContain('applyInteractivePlanModeRestore')
  })

  test('#223 takePendingPastes wired from REPL to PromptInput dispatchPasteEvent', () => {
    expect(replSrc).toContain('takePendingPastes={takePendingPastes}')
    expect(promptSrc).toContain('takePendingPastes')
    expect(promptSrc).toContain('dispatchPasteEvent(pending)')
  })

  test('#243 /config Theme menu invokes saveThemeWithConfigSetHook', () => {
    expect(configSrc).toContain('saveThemeWithConfigSetHook')
  })

  test('#349 & #311 stopped turn while defer-armed notifies LEFT_ARROW_STOPPED_TURN_TOAST', () => {
    expect(LEFT_ARROW_STOPPED_TURN_TOAST).toBe(
      'Backgrounding cancelled — the turn was stopped.',
    )
    expect(replSrc).toContain('LEFT_ARROW_STOPPED_TURN_TOAST')
    expect(turnSrc).toContain("abortController.signal.reason !== 'background'")
    expect(turnSrc).toContain('LEFT_ARROW_STOPPED_TURN_TOAST')
  })

  test('#378 typed draft cancels defer-arm at loop_top so Claude keeps working in foreground', () => {
    expect(replSrc).toContain('tengu_defer_boundary_cancelled_draft')
    expect(replSrc).toContain('LEFT_ARROW_IHT_DRAFT_TOAST')
  })

  test('#456 Esc at idle prompt activates on pending /loop wakeup while Ctrl+C leaves it alone', () => {
    expect(cancelSrc).toContain('hasPendingLoopWakeup')
    expect(cancelSrc).toContain(
      'isQuotaAutoResumeEscTarget ||\n      hasPendingLoopWakeup',
    )
  })

  test('#518/#519/#547 LeftArrow handoff blocks foreground queue drain, saves queued history, aborts late turns', () => {
    expect(replSrc).toContain(
      'leftArrowToAgentsFired.current || leftArrowDeferRef.current !== null || leftArrowConfirmOpenRef.current',
    )
    expect(replSrc).toContain("lateAc.abort('background')")
    expect(replSrc).toContain('addToHistory(qCmd.historyEntry)')
  })
})
