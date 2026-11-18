import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ClaudeAILimits } from '../claudeAiLimits.js'

const logEventMock = mock((_event: string, _data: unknown) => {})
const enqueueMock = mock((_cmd: unknown) => {})
let mockCommandQueue: unknown[] = []
let mockMainLoopModel = 'claude-opus-4-6'

mock.module('../analytics/index.js', () => ({
  logEvent: logEventMock,
}))

mock.module('../analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (flag: string, def: unknown) => {
    if (flag === 'tengu_marble_heron') {
      return { enabled: true, autoArm: true }
    }
    if (flag === 'tengu_maple_sundial') return true
    return def
  },
}))

mock.module('../../utils/messageQueueManager.js', () => ({
  enqueue: enqueueMock,
  getCommandQueue: () => mockCommandQueue,
  isQueuedCommandEditable: () => true,
  someInFlightDrainCommand: () => false,
}))

mock.module('../../utils/auth.js', () => ({
  isClaudeAISubscriber: () => true,
  getOauthAccountInfo: () => ({ billingType: 'claude_max' }),
}))

import * as actualBootstrap from '../../bootstrap/state.js'
import * as actualModel from '../../utils/model/model.js'

mock.module('../../bootstrap/state.js', () => ({
  ...actualBootstrap,
  getIsNonInteractiveSession: () => false,
}))

mock.module('../../utils/model/model.js', () => ({
  ...actualModel,
  getMainLoopModel: () => mockMainLoopModel,
}))

mock.module('../../utils/settings/settings.js', () => ({
  getSettingsForSource: (source: string) =>
    source === 'userSettings' ? { autoContinueAtUsageLimit: true } : undefined,
  getSettings_DEPRECATED: () => ({ autoContinueAtUsageLimit: true }),
  updateSettingsForSource: async () => ({ error: null }),
}))

import {
  cancelQuotaAutoResume,
  claimQuotaAutoResumeTurn,
  fireQuotaAutoResumeContinuation,
  getQuotaAutoResumeContinuationCap,
  getQuotaAutoResumeState,
  offerArmQuotaAutoResume,
  onQuotaAutoResumeHumanSubmit,
  onQuotaRejectedForAutoResume,
  releaseQuotaAutoResumeTurnClaim,
  resetQuotaAutoResumeForTests,
  subscribeQuotaAutoResumeEvents,
  tryAutoArmQuotaAutoResume,
} from '../quotaAutoResume.js'

function makeLimits(resetsAt: number): ClaudeAILimits {
  return {
    status: 'rejected',
    resetsAt,
    rateLimitType: 'five_hour',
  } as ClaudeAILimits
}

describe('quotaAutoResume #1372 cross-restart continuation cap', () => {
  beforeEach(() => {
    resetQuotaAutoResumeForTests()
    logEventMock.mockClear()
    enqueueMock.mockClear()
    mockCommandQueue = []
    mockMainLoopModel = 'claude-opus-4-6'
  })

  afterEach(() => {
    resetQuotaAutoResumeForTests()
  })

  test('getQuotaAutoResumeContinuationCap === 3 (SEA var N = 3)', () => {
    expect(getQuotaAutoResumeContinuationCap()).toBe(3)
  })

  test('tryAutoArmQuotaAutoResume caps at 3 continuations across self-restarting turns', () => {
    const events: string[] = []
    subscribeQuotaAutoResumeEvents(ev => events.push(ev))

    const now = Date.now()
    for (let i = 0; i < 3; i++) {
      const resetsAt = Math.floor(now / 1000) + 60 + i * 10
      expect(tryAutoArmQuotaAutoResume(makeLimits(resetsAt), now)).toBe(true)
      const uuid = fireQuotaAutoResumeContinuation()
      const claim = claimQuotaAutoResumeTurn({
        turnUuids: [uuid],
        isHumanTakeover: false,
        humanCommandUuids: [],
        willQuery: true,
      })
      if (i < 2) {
        releaseQuotaAutoResumeTurnClaim(claim, [uuid])
      }
      cancelQuotaAutoResume('dialog')
    }

    // Reset state to idle by simulating a human-less turn finish? No, claim is still active
    // until fired/cancelled; test the 4th auto-arm after episode returns to idle via cancel:
    // Verify onQuotaRejectedForAutoResume also caps at 3 continuations:
    onQuotaRejectedForAutoResume(
      makeLimits(Math.floor(now / 1000) + 500),
      'main_thread',
    )
    expect(getQuotaAutoResumeState().phase).toBe('idle')
    expect(events).toContain('cap-exhausted')
    expect(logEventMock).toHaveBeenCalledWith(
      'tengu_quota_auto_resume_cancelled',
      expect.objectContaining({ reason: 'rearm_cap' }),
    )
  })

  test('onQuotaAutoResumeHumanSubmit resets continuationsSinceHumanPrompt even when idle', () => {
    const now = Date.now()
    // Fire 3 continuations
    for (let i = 0; i < 3; i++) {
      fireQuotaAutoResumeContinuation()
    }
    // Without human prompt, auto-arm is blocked by continuation_cap
    const events: string[] = []
    subscribeQuotaAutoResumeEvents(ev => events.push(ev))
    expect(
      tryAutoArmQuotaAutoResume(makeLimits(Math.floor(now / 1000) + 120), now),
    ).toBe(false)
    expect(events).toContain('cap-exhausted')
    expect(logEventMock).toHaveBeenCalledWith(
      'tengu_quota_auto_resume_cancelled',
      expect.objectContaining({ reason: 'continuation_cap' }),
    )

    // Human submits a prompt while idle -> resets counter to 0
    onQuotaAutoResumeHumanSubmit('human-uuid-1')
    expect(
      tryAutoArmQuotaAutoResume(makeLimits(Math.floor(now / 1000) + 240), now),
    ).toBe(true)
    expect(getQuotaAutoResumeState().phase).toBe('armed')
  })
})
