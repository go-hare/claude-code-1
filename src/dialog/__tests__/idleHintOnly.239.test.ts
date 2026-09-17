/**
 * densable idle-return is ungated hint-only. 2.1.246 extracted F$ from REPL.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../..')

describe('idle-return hint-only (densable 2.1.239 / 2.1.246 F$)', () => {
  test('REPL has no focused idle-return / IdleReturnDialog invent', () => {
    const repl = readFileSync(join(root, 'screens/REPL.tsx'), 'utf8')
    expect(repl).not.toContain('IdleReturnDialog')
    expect(repl).not.toMatch(/['"]idle-return['"]/)
    expect(repl).not.toContain('idleReturnPending')
    expect(repl).not.toContain('skipIdleCheckRef')
    expect(repl).not.toMatch(/willowMode === 'dialog'/)
    expect(repl).not.toContain('willowMode variant')
    expect(repl).toContain('IdleReturnController')
    expect(repl).toContain('onClearSubmitted')
    expect(repl).toContain('setLocalOverlayShowing')
    expect(repl).toContain('idleReturnController.dispose()')
    expect(repl).toContain('initialPromptUuid')
    expect(repl).toContain('isQuotaAutoResumeArmed')
    expect(repl).not.toContain(
      'hasArmedQuotaAutoResume: isQuotaAutoResumeWaiting',
    )
    expect(repl).not.toContain('idleReturnControllerRef')
    expect(repl).not.toContain('idleHintShownRef')
    expect(repl).not.toContain('hintRef.current = true')
    expect(repl).not.toContain('getTotalInputTokens()')
    expect(repl).not.toContain('totalInputTokens: totalTokens')
    expect(repl).not.toContain("hintRef.current = 'hint_v2'")
    expect(repl).not.toContain('lastTranscriptActivityMs')
    expect(repl).not.toContain('variant: idleHintShownRef')
    expect(repl).toContain('immediate-ended-by-model')
    expect(repl).toContain("kind: 'feedback'")
    expect(repl).toContain('isEndedByModelCommandBlocked')
    expect(repl).not.toContain('isStickyContextual')
  })

  test('IdleReturnController keeps hint-only copy and F$ gates', () => {
    const ctrl = readFileSync(
      join(root, 'utils/idleReturnController.ts'),
      'utf8',
    )
    expect(ctrl).toContain('idle-return-hint')
    expect(ctrl).toContain('hint_shown')
    expect(ctrl).toContain("kind: 'contextual'")
    expect(ctrl).toContain('idleReturnContextTokens')
    expect(ctrl).toContain('contextTokens:')
    // Both env reads live in residualMsEnvGates (resolveIdleThresholdMinutes
    // reads CLAUDE_CODE_IDLE_THRESHOLD_MINUTES); the controller must still go
    // through them rather than hardcoding a threshold. Env-value behaviour is
    // covered by idleReturnController.246.test.ts + residualEnvGates.test.ts.
    expect(ctrl).toContain('resolveIdleTokenThreshold')
    expect(ctrl).toContain('resolveIdleThresholdMs')
    expect(ctrl).not.toContain('getTotalInputTokens()')
    expect(ctrl).not.toContain("hintRef.current = 'hint_v2'")
    expect(ctrl).not.toContain('IdleReturnDialog')
  })
})
