import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { planHarborWillowAutoFallback } from '../autoModeHarborWillow.js'
import {
  clearClassifierPolicySkipsForTesting,
  getClassifierModel,
  isClassifierEscalationAllowed,
  vetClassifierModel,
} from '../yoloClassifier.js'
import {
  consumeClassifierOverflowCompact,
  markClassifierOverflowCompactSpent,
  requestClassifierOverflowCompact,
} from '../permissions.js'

describe('2.1.302 permissions alignment (#894, #921, #923)', () => {
  const origEnv = process.env.CLAUDE_CODE_AUTO_MODE_MODEL
  const origBgEnv = process.env.CLAUDE_CODE_BG_CLASSIFIER_MODEL

  beforeEach(() => {
    clearClassifierPolicySkipsForTesting()
    delete process.env.CLAUDE_CODE_AUTO_MODE_MODEL
    delete process.env.CLAUDE_CODE_BG_CLASSIFIER_MODEL
  })

  afterEach(() => {
    if (origEnv === undefined) delete process.env.CLAUDE_CODE_AUTO_MODE_MODEL
    else process.env.CLAUDE_CODE_AUTO_MODE_MODEL = origEnv
    if (origBgEnv === undefined)
      delete process.env.CLAUDE_CODE_BG_CLASSIFIER_MODEL
    else process.env.CLAUDE_CODE_BG_CLASSIFIER_MODEL = origBgEnv
  })

  test('#894: isClassifierEscalationAllowed rejects sonnet-5-5 / opus-5-5 / opus-5', () => {
    expect(isClassifierEscalationAllowed('claude-sonnet-5-5')).toBe(false)
    expect(isClassifierEscalationAllowed('claude-opus-5-5')).toBe(false)
    expect(isClassifierEscalationAllowed('claude-opus-5')).toBe(false)
    expect(isClassifierEscalationAllowed('claude-sonnet-5')).toBe(true)
    expect(isClassifierEscalationAllowed('claude-sonnet-4-6')).toBe(true)
  })

  test('#894: vetClassifierModel rejects safeguard-blocked models only for env source', () => {
    expect(vetClassifierModel('claude-sonnet-5-5', 'env')).toBeUndefined()
    expect(vetClassifierModel('claude-sonnet-5-5', 'model')).toBe(
      'claude-sonnet-5-5',
    )
    expect(vetClassifierModel('claude-sonnet-5', 'env')).toBe('claude-sonnet-5')
  })

  test('#894: getClassifierModel honors CLAUDE_CODE_AUTO_MODE_MODEL when allowed', () => {
    process.env.CLAUDE_CODE_AUTO_MODE_MODEL = 'claude-sonnet-5'
    expect(getClassifierModel()).toBe('claude-sonnet-5')
  })

  test('#921: requestClassifierOverflowCompact + consumeClassifierOverflowCompact + markClassifierOverflowCompactSpent lifecycle', () => {
    const msgs = [{ uuid: 'epoch-1' }, { uuid: 'msg-2' }]
    consumeClassifierOverflowCompact('main', msgs, true)
    expect(
      requestClassifierOverflowCompact('main', msgs, {
        toolName: 'Bash',
        denied: true,
        mode: 'auto',
      }),
    ).toBe('requested')
    expect(
      requestClassifierOverflowCompact('main', msgs, {
        toolName: 'Edit',
        denied: true,
        mode: 'auto',
      }),
    ).toBe('joined')

    // Consuming with canCompactNext=false or stale mode does NOT mark spentEpoch
    const skipped = consumeClassifierOverflowCompact('main', msgs, false)
    expect(skipped.stale).toBeUndefined()
    expect(skipped.pending?.epoch).toBe('epoch-1')
    expect(skipped.pending?.deniedToolNames).toEqual(['Bash', 'Edit'])

    // Re-enabling canCompact without markClassifierOverflowCompactSpent allows re-requesting
    consumeClassifierOverflowCompact('main', msgs, true)
    expect(
      requestClassifierOverflowCompact('main', msgs, {
        toolName: 'Bash',
        denied: true,
        mode: 'auto',
      }),
    ).toBe('requested')

    // Mode mismatch returns stale: 'mode' without marking spentEpoch
    const modeStale = consumeClassifierOverflowCompact(
      'main',
      msgs,
      true,
      'default',
    )
    expect(modeStale.stale).toBe('mode')

    // Explicitly marking spent (SEA Fhn) prevents re-triggering for same epoch
    markClassifierOverflowCompactSpent('main', 'epoch-1')
    expect(
      requestClassifierOverflowCompact('main', msgs, {
        toolName: 'Bash',
        denied: true,
        mode: 'auto',
      }),
    ).toBeUndefined()
  })

  test('#923: planHarborWillowAutoFallback falls back to default when isRemote or nonInteractive without mossAnchor', () => {
    expect(
      planHarborWillowAutoFallback({
        hasResolvedMode: false,
        circuitBroken: false,
        disableAutoMode: false,
        harborWillow: true,
        isNonInteractiveSession: true,
        mossAnchor: false,
      }),
    ).toEqual({ mode: 'default', fromAutoFallback: false })

    expect(
      planHarborWillowAutoFallback({
        hasResolvedMode: false,
        circuitBroken: false,
        disableAutoMode: false,
        harborWillow: true,
        isNonInteractiveSession: false,
        mossAnchor: false,
        isRemote: true,
      }),
    ).toEqual({ mode: 'default', fromAutoFallback: false })

    expect(
      planHarborWillowAutoFallback({
        hasResolvedMode: false,
        circuitBroken: false,
        disableAutoMode: false,
        harborWillow: true,
        isNonInteractiveSession: false,
        mossAnchor: false,
        isRemote: false,
      }),
    ).toEqual({ mode: 'auto', fromAutoFallback: true })
  })
})
