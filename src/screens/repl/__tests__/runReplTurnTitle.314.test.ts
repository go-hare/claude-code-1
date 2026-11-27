import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  advanceTitleFallback,
  resolveTitleCandidate,
  UNUSABLE_TITLE_RETRIES,
} from '../runReplTurn.js'

describe('#1414 resolveTitleCandidate / advanceTitleFallback (nyr / ryr)', () => {
  test('substantive prose seeds fallback with UNUSABLE_TITLE_RETRIES = 2', () => {
    const candidate = resolveTitleCandidate({
      prose: 'Fix the failing auth test',
      isContinuationTurn: false,
      fallback: undefined,
    })
    expect(candidate).toEqual({
      text: 'Fix the failing auth test',
      unusableRepliesLeft: UNUSABLE_TITLE_RETRIES,
    })
  })

  test('failed first attempt (e.g. usage limit) preserves fallback for subsequent turn', () => {
    const initial = resolveTitleCandidate({
      prose: 'Fix the failing auth test',
      isContinuationTurn: false,
      fallback: undefined,
    })!
    const afterFailure = advanceTitleFallback(initial, { kind: 'failed' })
    expect(afterFailure).toEqual(initial)

    // Continuation turn with no new prose reuses the preserved fallback
    const retried = resolveTitleCandidate({
      prose: null,
      isContinuationTurn: true,
      fallback: afterFailure,
    })
    expect(retried).toEqual(initial)
  })

  test('unusable replies decrement budget and drop after exhausting 2 attempts', () => {
    const initial = { text: 'Initial prompt', unusableRepliesLeft: 2 }
    const afterFirst = advanceTitleFallback(initial, { kind: 'unusable' })
    expect(afterFirst).toEqual({
      text: 'Initial prompt',
      unusableRepliesLeft: 1,
    })
    const afterSecond = advanceTitleFallback(afterFirst!, { kind: 'unusable' })
    expect(afterSecond).toBeUndefined()
  })

  test('titled outcome clears fallback', () => {
    const initial = { text: 'Initial prompt', unusableRepliesLeft: 2 }
    expect(
      advanceTitleFallback(initial, { kind: 'titled', title: 'Auth test fix' }),
    ).toBeUndefined()
  })
})

describe('#1257, #1411, #1416 REPL.tsx wiring', () => {
  const replSrc = [
    readFileSync(join(import.meta.dir, '..', '..', 'REPL.tsx'), 'utf8'),
    readFileSync(
      join(import.meta.dir, '..', 'useReplRewindAndActions.ts'),
      'utf8',
    ),
    readFileSync(
      join(import.meta.dir, '..', 'useReplTerminalStatus.ts'),
      'utf8',
    ),
  ].join('\n')
  const normalizedReplSrc = replSrc.replace(/\s+/g, ' ')

  test('#1257 gates MessageSelector onSummarize on DISABLE_COMPACT', () => {
    expect(replSrc).toContain('isEnvTruthy(process.env.DISABLE_COMPACT)')
  })

  test('#1411 calls repinScrollRef.current(true, "rewind") in restoreMessageSync', () => {
    expect(replSrc).toContain("repinScrollRef.current(true, 'rewind')")
  })

  test('#1416 keeps terminalTitle from sessionTitle (/rename) even while waiting for approval', () => {
    expect(normalizedReplSrc).toContain(
      "const terminalTitle = sessionTitle ?? sessionAiTitle ?? agentTitle ?? haikuTitle ?? 'Claude Code'",
    )
    expect(replSrc).toContain('title={terminalTitle}')
  })
})
