import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { UUID } from 'crypto'
import * as realAuth from '../../utils/auth.js'
import * as realBootstrap from '../../bootstrap/state.js'
import * as realFormat from '../../utils/format.js'
import * as realSettings from '../../utils/settings/settings.js'
import * as realAnalytics from '../analytics/index.js'
import * as realGrowthbook from '../analytics/growthbook.js'
import * as realClaudeAiLimits from '../claudeAiLimits.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'
import {
  clearDynamicTeamContext,
  setDynamicTeamContext,
} from '../../utils/teammate.js'
import {
  createTeammateContext,
  runWithTeammateContext,
} from '../../utils/teammateContext.js'

const savedAnthropicModel = process.env.ANTHROPIC_MODEL

const getSettingsForSourceMock = mock(
  (_source?: string) =>
    undefined as { autoContinueAtUsageLimit?: boolean } | undefined,
)
const updateSettingsForSourceMock = mock(() => ({
  error: null as Error | null,
}))
const getFeatureValueMock = mock((_key: string, fallback: unknown) => fallback)
const isClaudeAISubscriberMock = mock(() => true)
const getOauthAccountInfoMock = mock(() => ({
  billingType: 'subscription' as string | undefined,
}))
const getIsNonInteractiveSessionMock = mock(() => false)
const isReplBridgeActiveMock = mock(() => false)
const getMainLoopModelOverrideMock = mock(
  (): string | null | undefined => undefined,
)
const getInitialMainLoopModelMock = mock(
  (): string | null | undefined => undefined,
)
const getSettingsDeprecatedMock = mock(
  (): { model?: string } | undefined => undefined,
)
const logEventMock = mock((_name: string, _props?: unknown) => {})
const formatResetTimeMock = mock((ts: number) => `formatted-${ts}`)

const statusListeners = new Set<(limits: unknown) => void>()
let currentLimits: {
  status: string
  resetsAt?: number
  isUsingOverage?: boolean
  unifiedRateLimitFallbackAvailable: boolean
} = {
  status: 'allowed',
  unifiedRateLimitFallbackAvailable: false,
  isUsingOverage: false,
}

// Snapshot BEFORE mock.module — live ESM namespaces rebind into the mock, so
// afterAll `...realX` would reinstall the mock (TRACEPARENT / tui pollution).
const settingsSnap = snapshotModuleExports(realSettings)
const growthbookSnap = snapshotModuleExports(realGrowthbook)
const authSnap = snapshotModuleExports(realAuth)
const bootstrapSnap = snapshotModuleExports(realBootstrap)
const analyticsSnap = snapshotModuleExports(realAnalytics)
const formatSnap = snapshotModuleExports(realFormat)
const claudeAiLimitsSnap = snapshotModuleExports(realClaudeAiLimits)

function settingsMock() {
  return {
    ...settingsSnap,
    getSettingsForSource: getSettingsForSourceMock,
    updateSettingsForSource: updateSettingsForSourceMock,
    getSettings_DEPRECATED: getSettingsDeprecatedMock,
  }
}
function growthbookMockFactory() {
  return {
    ...growthbookSnap,
    getFeatureValue_CACHED_MAY_BE_STALE: getFeatureValueMock,
  }
}
function authMock() {
  return {
    ...authSnap,
    isClaudeAISubscriber: isClaudeAISubscriberMock,
    getOauthAccountInfo: getOauthAccountInfoMock,
  }
}
function bootstrapMock() {
  return {
    ...bootstrapSnap,
    getMainThreadAgentId: () => undefined,
    getIsNonInteractiveSession: getIsNonInteractiveSessionMock,
    isReplBridgeActive: isReplBridgeActiveMock,
    getMainLoopModelOverride: getMainLoopModelOverrideMock,
    getInitialMainLoopModel: getInitialMainLoopModelMock,
  }
}
function analyticsMock() {
  return {
    ...analyticsSnap,
    logEvent: logEventMock,
  }
}
function formatMock() {
  return {
    ...formatSnap,
    formatResetTime: formatResetTimeMock,
  }
}
function claudeAiLimitsMock() {
  return {
    ...claudeAiLimitsSnap,
    statusListeners,
    get currentLimits() {
      return currentLimits
    },
  }
}

mock.module('../../utils/settings/settings.js', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)
mock.module('src/utils/settings/settings.ts', settingsMock)

mock.module('../analytics/growthbook.js', growthbookMockFactory)
mock.module('src/services/analytics/growthbook.js', growthbookMockFactory)

mock.module('../../utils/auth.js', authMock)
mock.module('src/utils/auth.js', authMock)
mock.module('src/utils/auth.ts', authMock)

mock.module('../../bootstrap/state.js', bootstrapMock)
mock.module('src/bootstrap/state.js', bootstrapMock)

mock.module('../analytics/index.js', analyticsMock)
mock.module('src/services/analytics/index.js', analyticsMock)

mock.module('../../utils/format.js', formatMock)
mock.module('src/utils/format.js', formatMock)

mock.module('../claudeAiLimits.js', claudeAiLimitsMock)
mock.module('src/services/claudeAiLimits.js', claudeAiLimitsMock)

const {
  armQuotaAutoResume,
  canOfferQuotaAutoResume,
  cancelQuotaAutoResume,
  claimQuotaAutoResumeTurn,
  filterPendingQuotaContinuationIfRevoked,
  fireQuotaAutoResumeContinuation,
  formatAutoContinueWaitNotice,
  getQuotaAutoResumeRearmCap,
  getQuotaAutoResumeState,
  hasPendingQuotaContinuationInQueue,
  isQuotaAutoResumeArmedOrPending,
  isQuotaRearmEligibleRateLimit,
  cancelQuotaAutoResumeWithNotice,
  onQuotaAutoResumeHumanSubmit,
  onQuotaRejectedForAutoResume,
  getWaitThenContinueOption,
  getStaleQuotaWaitPrompt,
  isAutoContinueAtUsageLimitEffective,
  isAutoContinueAtUsageLimitToggleable,
  isQuotaRejectedForAutoContinue,
  isQuotaWaitStale,
  offerArmQuotaAutoResume,
  refreshAutoContinueKeyPresence,
  resetQuotaAutoResumeForTests,
  setAutoContinueAtUsageLimitSetting,
  subscribeQuotaAutoResumeEvents,
  tickQuotaAutoResume,
  tryAutoArmQuotaAutoResume,
  isQuotaAutoArmVetoed,
  isQuotaAutoResumeLive,
  beginQuotaAutoResumeHandoff,
  endQuotaAutoResumeHandoff,
  ensureQuotaAutoResumeLimitsSubscription,
  isQuotaAutoResumeSessionReset,
  blocksQuotaAutoArmForFamilyWindow,
  TENGU_MAPLE_SUNDIAL,
  TENGU_MARBLE_HERON,
  CONTINUATION_PROMPT,
  clampMarbleHeronMs,
  getMarbleHeronGraceMs,
  MARBLE_HERON_GRACE_DEFAULT_MS,
  MARBLE_HERON_GRACE_MIN_MS,
  MARBLE_HERON_MS_MAX,
} = await import('../quotaAutoResume.js')
const {
  getCommandQueue,
  resetCommandQueue,
  setInFlightDrainBatch,
  clearInFlightDrainBatch,
} = await import('../../utils/messageQueueManager.js')

afterAll(() => {
  mock.module('../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  restoreSettingsMockWith(mock.module, settingsSnap, [
    '../../utils/settings/settings.js',
    'src/utils/settings/settings.js',
    'src/utils/settings/settings.ts',
  ])
  mock.module('../analytics/growthbook.js', () => ({ ...growthbookSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('../../utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/utils/auth.ts', () => ({ ...authSnap }))
  mock.module('../analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('../../utils/format.js', () => ({ ...formatSnap }))
  mock.module('src/utils/format.js', () => ({ ...formatSnap }))
  mock.module('../claudeAiLimits.js', () => ({ ...claudeAiLimitsSnap }))
  mock.module('src/services/claudeAiLimits.js', () => ({
    ...claudeAiLimitsSnap,
  }))
  delete process.env.CLAUDE_CODE_AGENT_ID
  if (savedAnthropicModel === undefined) {
    delete process.env.ANTHROPIC_MODEL
  } else {
    process.env.ANTHROPIC_MODEL = savedAnthropicModel
  }
  clearDynamicTeamContext()
})

describe('quotaAutoResume densable 2.1.234', () => {
  beforeEach(() => {
    resetQuotaAutoResumeForTests()
    getSettingsForSourceMock.mockReset()
    getSettingsForSourceMock.mockImplementation(() => undefined)
    updateSettingsForSourceMock.mockReset()
    updateSettingsForSourceMock.mockImplementation(() => ({ error: null }))
    getFeatureValueMock.mockReset()
    getFeatureValueMock.mockImplementation((_k, fallback) => fallback)
    isClaudeAISubscriberMock.mockReset()
    isClaudeAISubscriberMock.mockReturnValue(true)
    getOauthAccountInfoMock.mockReset()
    getOauthAccountInfoMock.mockReturnValue({ billingType: 'subscription' })
    getIsNonInteractiveSessionMock.mockReset()
    getIsNonInteractiveSessionMock.mockReturnValue(false)
    isReplBridgeActiveMock.mockReset()
    isReplBridgeActiveMock.mockReturnValue(false)
    getMainLoopModelOverrideMock.mockReset()
    getMainLoopModelOverrideMock.mockReturnValue(undefined)
    getInitialMainLoopModelMock.mockReset()
    getInitialMainLoopModelMock.mockReturnValue(undefined)
    getSettingsDeprecatedMock.mockReset()
    getSettingsDeprecatedMock.mockReturnValue(undefined)
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.CLAUDE_CODE_AGENT_ID
    delete process.env.ANTHROPIC_MODEL
    clearDynamicTeamContext()
    resetCommandQueue()
    logEventMock.mockReset()
    formatResetTimeMock.mockReset()
    formatResetTimeMock.mockImplementation(ts => `formatted-${ts}`)
    currentLimits = {
      status: 'allowed',
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
  })

  afterEach(() => {
    resetQuotaAutoResumeForTests()
    resetCommandQueue()
    clearInFlightDrainBatch()
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.CLAUDE_CODE_AGENT_ID
    delete process.env.ANTHROPIC_MODEL
    clearDynamicTeamContext()
  })

  test('BXa/Wqn: absent key ⇒ effective true', () => {
    expect(refreshAutoContinueKeyPresence()).toBe('absent')
    expect(isAutoContinueAtUsageLimitEffective()).toBe(true)
  })

  test('BXa/Wqn: present false ⇒ effective false', () => {
    getSettingsForSourceMock.mockImplementation((source?: string) =>
      source === 'userSettings'
        ? { autoContinueAtUsageLimit: false }
        : undefined,
    )
    expect(refreshAutoContinueKeyPresence()).toBe('present')
    expect(isAutoContinueAtUsageLimitEffective()).toBe(false)
  })

  test('vgt: toggleable only when maple_sundial true', () => {
    expect(isAutoContinueAtUsageLimitToggleable()).toBe(false)
    getFeatureValueMock.mockImplementation((key, fallback) =>
      key === TENGU_MAPLE_SUNDIAL ? true : fallback,
    )
    expect(isAutoContinueAtUsageLimitToggleable()).toBe(true)
  })

  test('Vqn: rejected + resetsAt + not overage', () => {
    expect(
      isQuotaRejectedForAutoContinue({
        status: 'rejected',
        resetsAt: 1_700_000_000,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      }),
    ).toBe(true)
    expect(
      isQuotaRejectedForAutoContinue({
        status: 'rejected',
        resetsAt: 1_700_000_000,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: true,
      }),
    ).toBe(false)
    expect(
      isQuotaRejectedForAutoContinue({
        status: 'rejected',
        resetsAt: 1_700_000_000,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
        overageInUse: true,
      }),
    ).toBe(false)
  })

  test('d$t/canOffer: usage_based billing blocked', () => {
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(canOfferQuotaAutoResume(limits)).toBe(true)
    getOauthAccountInfoMock.mockReturnValue({ billingType: 'usage_based' })
    expect(canOfferQuotaAutoResume(limits)).toBe(false)
  })

  test('M4f/L4f arm + qXa fire enqueues A4f continuation', () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 1
    const limits = {
      status: 'rejected' as const,
      resetsAt,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(offerArmQuotaAutoResume(limits, Date.now(), 'dialog')).toBe(true)
    expect(getQuotaAutoResumeState().phase).toBe('armed')

    // Force fire by arming with past fireAt via direct arm + tick past fire
    resetQuotaAutoResumeForTests()
    armQuotaAutoResume(
      Math.floor(Date.now() / 1000) - 10,
      Date.now() - 120_000,
      'dialog',
    )
    // Override fireAt by re-reading state and ticking far ahead
    const armed = getQuotaAutoResumeState()
    expect(armed.phase).toBe('armed')
    const result = tickQuotaAutoResume(
      (armed as { fireAtMs: number }).fireAtMs + 1,
      false,
    )
    expect(result).toBe('fired')
    const queued = getCommandQueue()[0]
    expect(queued).toMatchObject({
      value: CONTINUATION_PROMPT,
      origin: { kind: 'auto-continuation' },
      isMeta: true,
      priority: 'later',
    })
    expect(getQuotaAutoResumeState().phase).toBe('idle')
    // densable IVr('fired') keeps pendingContinuationUuid so WXa still matches
    expect(hasPendingQuotaContinuationInQueue()).toBe(true)
  })

  test('IVr fired keeps uuid; Yqn/manual_submit cancels armed wait', () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600
    offerArmQuotaAutoResume(
      {
        status: 'rejected',
        resetsAt,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      Date.now(),
      'dialog',
    )
    expect(getQuotaAutoResumeState().phase).toBe('armed')
    onQuotaAutoResumeHumanSubmit()
    expect(getQuotaAutoResumeState().phase).toBe('idle')
    expect(logEventMock).toHaveBeenCalledWith(
      'tengu_quota_auto_resume_cancelled',
      expect.objectContaining({ reason: 'manual_submit' }),
    )
  })

  test('Yqn after fire drops queued continuation ownership (Xqn keepIfDrained)', () => {
    armQuotaAutoResume(
      Math.floor(Date.now() / 1000) - 10,
      Date.now() - 120_000,
      'dialog',
    )
    const armed = getQuotaAutoResumeState()
    tickQuotaAutoResume((armed as { fireAtMs: number }).fireAtMs + 1, false)
    expect(hasPendingQuotaContinuationInQueue()).toBe(true)
    onQuotaAutoResumeHumanSubmit()
    expect(hasPendingQuotaContinuationInQueue()).toBe(false)
  })

  test('qXa tick does not setting_off a dialog-armed wait', () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600
    offerArmQuotaAutoResume(
      {
        status: 'rejected',
        resetsAt,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      Date.now(),
      'dialog',
    )
    expect(getQuotaAutoResumeState().phase).toBe('armed')
    getSettingsForSourceMock.mockImplementation((source?: string) =>
      source === 'userSettings'
        ? { autoContinueAtUsageLimit: false }
        : undefined,
    )
    refreshAutoContinueKeyPresence()
    expect(isAutoContinueAtUsageLimitEffective()).toBe(false)
    expect(tickQuotaAutoResume(Date.now(), false)).toBe('pending')
    expect(getQuotaAutoResumeState().phase).toBe('armed')
  })

  test('qXa tick setting_off only auto-origin armed wait', () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600
    offerArmQuotaAutoResume(
      {
        status: 'rejected',
        resetsAt,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      Date.now(),
      'auto',
    )
    expect(getQuotaAutoResumeState().phase).toBe('armed')
    getSettingsForSourceMock.mockImplementation((source?: string) =>
      source === 'userSettings'
        ? { autoContinueAtUsageLimit: false }
        : undefined,
    )
    refreshAutoContinueKeyPresence()
    expect(tickQuotaAutoResume(Date.now(), false)).toBe('idle')
    expect(getQuotaAutoResumeState().phase).toBe('idle')
  })

  test('hSl/qvm: slept-through fire is stale Enter prompt', () => {
    armQuotaAutoResume(
      Math.floor(Date.now() / 1000) - 10,
      Date.now() - 120_000,
      'dialog',
    )
    const armed = getQuotaAutoResumeState()
    expect(armed.phase).toBe('armed')
    const result = tickQuotaAutoResume(
      (armed as { fireAtMs: number }).fireAtMs + 31 * 60 * 1000,
      false,
    )
    expect(result).toBe('stale')
    expect(getQuotaAutoResumeState().phase).toBe('stale')
    expect(isQuotaWaitStale()).toBe(true)
    expect(getStaleQuotaWaitPrompt()).toBe(CONTINUATION_PROMPT)
  })

  test('Axi cancel setting_off via setAutoContinueAtUsageLimitSetting(false)', () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600
    offerArmQuotaAutoResume(
      {
        status: 'rejected',
        resetsAt,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      Date.now(),
      'dialog',
    )
    expect(getQuotaAutoResumeState().phase).toBe('armed')
    setAutoContinueAtUsageLimitSetting(false)
    expect(updateSettingsForSourceMock).toHaveBeenCalledWith('userSettings', {
      autoContinueAtUsageLimit: false,
    })
    expect(getQuotaAutoResumeState().phase).toBe('idle')
  })

  test('O4f auto-arm requires effective setting', () => {
    getSettingsForSourceMock.mockImplementation((source?: string) =>
      source === 'userSettings'
        ? { autoContinueAtUsageLimit: false }
        : undefined,
    )
    refreshAutoContinueKeyPresence()
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
  })

  test('$Fm: print/non-interactive cannot offer or auto-arm', () => {
    getIsNonInteractiveSessionMock.mockReturnValue(true)
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(canOfferQuotaAutoResume(limits)).toBe(false)
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
  })

  test('$Fm: bg session cannot offer (gold As)', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(canOfferQuotaAutoResume(limits)).toBe(false)
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
  })

  test('QOt: replBridge vetoes auto-arm only', () => {
    isReplBridgeActiveMock.mockReturnValue(true)
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(canOfferQuotaAutoResume(limits)).toBe(true)
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
  })

  test('QOt: teammateAgentId (dynamicTeamContext) vetoes auto-arm only', () => {
    setDynamicTeamContext({
      agentId: 'agent-1',
      agentName: 'researcher',
      teamName: 'team',
      planModeRequired: false,
    })
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(canOfferQuotaAutoResume(limits)).toBe(true)
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
  })

  test('QOt: teammateAgentId (ALS) vetoes auto-arm only', () => {
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    runWithTeammateContext(
      createTeammateContext({
        agentId: 'agent-1',
        agentName: 'researcher',
        teamName: 'team',
        planModeRequired: false,
        parentSessionId: 'parent-1',
        abortController: new AbortController(),
      }),
      () => {
        expect(canOfferQuotaAutoResume(limits)).toBe(true)
        expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
      },
    )
  })

  test('QOt: leftover CLAUDE_CODE_AGENT_ID does not veto', () => {
    process.env.CLAUDE_CODE_AGENT_ID = 'agent-1'
    expect(isQuotaAutoArmVetoed()).toBe(false)
  })

  test('REPL fork switchSession uses fork reason (RDl keep latch)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(src).toContain("entrypoint === 'fork' ? 'fork' : 'resume'")
  })

  test('print.ts has no quota auto-resume wait loop (gold kDl REPL-only)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../cli/print.ts'),
      'utf8',
    )
    expect(src).not.toContain('quotaAutoResume')
    expect(src).not.toContain('tickQuotaAutoResume')
    expect(src).not.toContain('tryAutoArmQuotaAutoResume')
  })

  test('DZi wait option labels', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    expect(getWaitThenContinueOption(future, true)).toEqual({
      label: 'Wait here, then continue automatically shortly',
      confirmationPhrase: 'shortly',
    })
    expect(getWaitThenContinueOption(future, false).label).toContain(
      'Wait here, then continue automatically at',
    )
    expect(getWaitThenContinueOption(undefined, false)).toEqual({
      label: 'Wait here, then continue automatically when the limit resets',
      confirmationPhrase: 'when your usage limit resets',
    })
  })

  test('lYm wait notice while armed', () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600
    offerArmQuotaAutoResume(
      {
        status: 'rejected',
        resetsAt,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      Date.now(),
      'auto',
    )
    const notice = formatAutoContinueWaitNotice(getQuotaAutoResumeState())
    expect(notice).toContain('Usage limit reached · continuing automatically')
    expect(notice).toContain('esc or type to cancel')
  })

  test('cancelQuotaAutoResume escape clears armed', () => {
    offerArmQuotaAutoResume(
      {
        status: 'rejected',
        resetsAt: Math.floor(Date.now() / 1000) + 3600,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      Date.now(),
      'dialog',
    )
    cancelQuotaAutoResume('escape')
    expect(getQuotaAutoResumeState().phase).toBe('idle')
    expect(logEventMock).toHaveBeenCalledWith(
      'tengu_quota_auto_resume_cancelled',
      expect.objectContaining({ reason: 'escape' }),
    )
  })

  test('fireQuotaAutoResumeContinuation sets pending uuid', () => {
    const uuid = fireQuotaAutoResumeContinuation()
    expect(typeof uuid).toBe('string')
    expect(getCommandQueue().some(cmd => cmd.uuid === uuid)).toBe(true)
    expect(hasPendingQuotaContinuationInQueue()).toBe(true)
  })

  test('O4f qlr: WXa after fire blocks tryAutoArm', () => {
    getFeatureValueMock.mockImplementation((key, fallback) =>
      key === TENGU_MAPLE_SUNDIAL ? true : fallback,
    )
    armQuotaAutoResume(
      Math.floor(Date.now() / 1000) - 10,
      Date.now() - 120_000,
      'dialog',
    )
    const armed = getQuotaAutoResumeState()
    tickQuotaAutoResume((armed as { fireAtMs: number }).fireAtMs + 1, false)
    expect(hasPendingQuotaContinuationInQueue()).toBe(true)
    const later = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 7200,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(tryAutoArmQuotaAutoResume(later)).toBe(false)
    expect(getQuotaAutoResumeState().phase).toBe('idle')
  })

  test('O4f: kxi handoffInProgress blocks tryAutoArm until xfe', () => {
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(beginQuotaAutoResumeHandoff('background_handoff')).toBe(false)
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
    endQuotaAutoResumeHandoff()
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(true)
    expect(getQuotaAutoResumeState().phase).toBe('armed')
  })

  test('RDl: clear/resume/remote_attach reset; fork/undefined keep latch', () => {
    expect(isQuotaAutoResumeSessionReset('clear')).toBe(true)
    expect(isQuotaAutoResumeSessionReset('resume')).toBe(true)
    expect(isQuotaAutoResumeSessionReset('remote_attach')).toBe(true)
    expect(isQuotaAutoResumeSessionReset('fork')).toBe(false)
    expect(isQuotaAutoResumeSessionReset('spare_claim')).toBe(false)
    expect(isQuotaAutoResumeSessionReset(undefined)).toBe(false)
  })

  test('remote_attach is passed on local hydrate / remote TUI create', () => {
    const storage = readFileSync(
      join(import.meta.dir, '../../utils/sessionStorage.ts'),
      'utf8',
    )
    const main = readFileSync(join(import.meta.dir, '../../main.tsx'), 'utf8')
    expect(storage).toContain(
      "switchSession(asSessionId(sessionId), null, 'remote_attach')",
    )
    expect(main).toContain(
      "switchSession(asSessionId(createdSession.id), null, 'remote_attach')",
    )
  })

  test('eUm: resume/clear session switch drops kxi latch', async () => {
    const { switchSession, regenerateSessionId } = await import(
      '../../bootstrap/state.js'
    )
    const { asSessionId } = await import('../../types/ids.js')
    // leftover 239 eUm uses real onSessionSwitch from bootstrapSnap
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 7200,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    ensureQuotaAutoResumeLimitsSubscription()
    beginQuotaAutoResumeHandoff('background_handoff')
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
    switchSession(asSessionId(crypto.randomUUID()), null, 'resume')
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(true)
    endQuotaAutoResumeHandoff()
    beginQuotaAutoResumeHandoff('background_handoff')
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
    regenerateSessionId()
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(true)
  })

  test('eUm: fork session switch keeps kxi latch', async () => {
    const { switchSession } = await import('../../bootstrap/state.js')
    const { asSessionId } = await import('../../types/ids.js')
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 7200,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    ensureQuotaAutoResumeLimitsSubscription()
    beginQuotaAutoResumeHandoff('background_handoff')
    switchSession(asSessionId(crypto.randomUUID()), null, 'fork')
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
  })

  test('V4f: conversation_reset clears handoff latch', () => {
    const limits = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 7200,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    beginQuotaAutoResumeHandoff('background_handoff')
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(false)
    cancelQuotaAutoResume('conversation_reset')
    expect(tryAutoArmQuotaAutoResume(limits)).toBe(true)
  })

  test('qlr sxa: in-flight drain owned cmd blocks tryAutoArm', () => {
    const uuid = fireQuotaAutoResumeContinuation() as UUID
    resetCommandQueue()
    expect(hasPendingQuotaContinuationInQueue()).toBe(false)
    setInFlightDrainBatch([
      {
        value: CONTINUATION_PROMPT,
        mode: 'prompt',
        uuid,
      },
    ])
    expect(isQuotaAutoResumeLive()).toBe(true)
    const later = {
      status: 'rejected' as const,
      resetsAt: Math.floor(Date.now() / 1000) + 7200,
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    }
    expect(tryAutoArmQuotaAutoResume(later)).toBe(false)
    clearInFlightDrainBatch()
    expect(isQuotaAutoResumeLive()).toBe(false)
  })

  test('z4f: Jqn killswitch strips continuation; otherwise keeps it', () => {
    const uuid = fireQuotaAutoResumeContinuation() as UUID
    const humanUuid = 'human-1111-1111-1111-111111111111' as UUID
    const batch = [
      { value: 'human', mode: 'prompt' as const, uuid: humanUuid },
      {
        value: CONTINUATION_PROMPT,
        mode: 'prompt' as const,
        uuid,
      },
    ] as QueuedCommand[]
    expect(
      filterPendingQuotaContinuationIfRevoked(batch).map(c => c.uuid),
    ).toEqual([humanUuid, uuid])

    getFeatureValueMock.mockImplementation((key, fallback) => {
      if (key === TENGU_MARBLE_HERON) return { enabled: false }
      return fallback
    })
    expect(
      filterPendingQuotaContinuationIfRevoked(batch).map(c => c.uuid),
    ).toEqual([humanUuid])
  })

  test('W4f: Yqn after fire claims takeover (does not dequeue)', () => {
    const continuationUuid = fireQuotaAutoResumeContinuation()
    const humanUuid = 'human-takeover'
    onQuotaAutoResumeHumanSubmit(humanUuid, { dispatching: true })
    expect(hasPendingQuotaContinuationInQueue()).toBe(false)
    expect(getCommandQueue().some(cmd => cmd.uuid === continuationUuid)).toBe(
      true,
    )
    const claim = claimQuotaAutoResumeTurn({
      turnUuids: [continuationUuid, humanUuid],
      isHumanTakeover: true,
      humanCommandUuids: [humanUuid],
      willQuery: true,
    })
    expect(claim).toMatchObject({ kind: 'takeover', queried: true })
    expect(getCommandQueue().some(cmd => cmd.uuid === continuationUuid)).toBe(
      true,
    )
  })

  test('Klr: false while armed wait; true after fire (WXa)', () => {
    offerArmQuotaAutoResume(
      {
        status: 'rejected',
        resetsAt: Math.floor(Date.now() / 1000) + 3600,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      Date.now(),
      'dialog',
    )
    expect(getQuotaAutoResumeState().phase).toBe('armed')
    expect(isQuotaAutoResumeArmedOrPending()).toBe(false)

    resetQuotaAutoResumeForTests()
    armQuotaAutoResume(
      Math.floor(Date.now() / 1000) - 10,
      Date.now() - 120_000,
      'dialog',
    )
    const armed = getQuotaAutoResumeState()
    tickQuotaAutoResume((armed as { fireAtMs: number }).fireAtMs + 1, false)
    expect(hasPendingQuotaContinuationInQueue()).toBe(true)
    expect(isQuotaAutoResumeArmedOrPending()).toBe(true)
  })

  test('kill_agents Gis: skip when !Klr so armed wait survives', () => {
    offerArmQuotaAutoResume(
      {
        status: 'rejected',
        resetsAt: Math.floor(Date.now() / 1000) + 3600,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      Date.now(),
      'dialog',
    )
    // densable if(Klr()) Gis — call site must not Gis while waiting
    if (isQuotaAutoResumeArmedOrPending()) {
      cancelQuotaAutoResumeWithNotice('kill_agents_chord')
    }
    expect(getQuotaAutoResumeState().phase).toBe('armed')
  })

  test('kill_agents Gis: Klr after fire cancels WXa', () => {
    fireQuotaAutoResumeContinuation()
    expect(isQuotaAutoResumeArmedOrPending()).toBe(true)
    const notice = cancelQuotaAutoResumeWithNotice('kill_agents_chord')
    expect(notice).toBeTruthy()
    expect(hasPendingQuotaContinuationInQueue()).toBe(false)
    expect(isQuotaAutoResumeArmedOrPending()).toBe(false)
  })

  test('T0S/HEv: getQuotaAutoResumeRearmCap === 2', () => {
    expect(getQuotaAutoResumeRearmCap()).toBe(2)
  })

  test('X0S: cross-family week limit blocks auto-arm', () => {
    // densable X5w: seven_day_opus + sonnet model → block (absent n2r escape)
    expect(
      blocksQuotaAutoArmForFamilyWindow('seven_day_opus', 'claude-sonnet-4'),
    ).toBe(true)
    expect(
      blocksQuotaAutoArmForFamilyWindow('seven_day_sonnet', 'claude-opus-4-6'),
    ).toBe(true)
    // same-family → do not block
    expect(
      blocksQuotaAutoArmForFamilyWindow('seven_day_opus', 'claude-opus-4-6'),
    ).toBe(false)
    expect(
      blocksQuotaAutoArmForFamilyWindow('seven_day_sonnet', 'claude-sonnet-4'),
    ).toBe(false)
    // non-family windows never block via X0S
    expect(
      blocksQuotaAutoArmForFamilyWindow('five_hour', 'claude-sonnet-4'),
    ).toBe(false)
    expect(
      blocksQuotaAutoArmForFamilyWindow('seven_day', 'claude-haiku-4'),
    ).toBe(false)
  })

  test('X0S: n2r alias escape unblocks cross-family week limit', () => {
    getMainLoopModelOverrideMock.mockReturnValue('opusplan')
    expect(
      blocksQuotaAutoArmForFamilyWindow('seven_day_opus', 'claude-sonnet-4'),
    ).toBe(false)
    getMainLoopModelOverrideMock.mockReturnValue('haiku')
    expect(
      blocksQuotaAutoArmForFamilyWindow('seven_day_sonnet', 'claude-opus-4-6'),
    ).toBe(false)
  })

  test('X5w n2r alias families', () => {
    const { resolveQuotaAutoArmAliasFamily } =
      require('../quotaAutoResume.js') as typeof import('../quotaAutoResume.js')
    expect(resolveQuotaAutoArmAliasFamily('opusplan')).toBe('opus')
    expect(resolveQuotaAutoArmAliasFamily('opusplan[1m]')).toBe('opus')
    expect(resolveQuotaAutoArmAliasFamily('haiku')).toBe('sonnet')
    expect(resolveQuotaAutoArmAliasFamily('claude-sonnet-4')).toBe(null)
  })

  test('xxi: five_hour/seven_day/overage eligible; undefined not', () => {
    expect(isQuotaRearmEligibleRateLimit('five_hour', 'claude-opus-4')).toBe(
      true,
    )
    expect(isQuotaRearmEligibleRateLimit('seven_day', 'claude-sonnet-4')).toBe(
      true,
    )
    expect(isQuotaRearmEligibleRateLimit('overage', 'claude-haiku-4')).toBe(
      true,
    )
    expect(isQuotaRearmEligibleRateLimit(undefined, 'claude-opus-4')).toBe(
      false,
    )
    // densable xxi: yDe/ZWs → Wjo(family) — same-family eligible (not inverted)
    expect(
      isQuotaRearmEligibleRateLimit('seven_day_opus', 'claude-opus-4-6'),
    ).toBe(true)
    expect(
      isQuotaRearmEligibleRateLimit('seven_day_opus', 'claude-sonnet-4'),
    ).toBe(false)
    expect(
      isQuotaRearmEligibleRateLimit('seven_day_sonnet', 'claude-sonnet-4'),
    ).toBe(true)
    expect(
      isQuotaRearmEligibleRateLimit('seven_day_sonnet', 'claude-opus-4-6'),
    ).toBe(false)
  })

  test('s0v: continuation claim + main_thread reject rearms and increments', () => {
    const events: string[] = []
    const unsub = subscribeQuotaAutoResumeEvents(e => events.push(e))
    const continuationUuid = fireQuotaAutoResumeContinuation()
    const claim = claimQuotaAutoResumeTurn({
      turnUuids: [continuationUuid],
      isHumanTakeover: false,
      humanCommandUuids: [],
      willQuery: true,
    })
    expect(claim?.kind).toBe('continuation')
    // densable GZa must be false — drain the queue pointer target
    resetCommandQueue()
    const nextResets = Math.floor(Date.now() / 1000) + 7200
    onQuotaRejectedForAutoResume(
      {
        status: 'rejected',
        resetsAt: nextResets,
        rateLimitType: 'five_hour',
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      'main_thread',
    )
    const state = getQuotaAutoResumeState()
    expect(state.phase).toBe('armed')
    expect(state).toMatchObject({
      consecutiveRearms: 1,
      resetsAtSeconds: nextResets,
    })
    expect(events).toContain('rearmed')
    expect(logEventMock).toHaveBeenCalledWith(
      'tengu_quota_auto_resume_armed',
      expect.objectContaining({ rearm: 1 }),
    )
    unsub()
  })

  test('s0v: other querySource does not rearm', () => {
    const continuationUuid = fireQuotaAutoResumeContinuation()
    claimQuotaAutoResumeTurn({
      turnUuids: [continuationUuid],
      isHumanTakeover: false,
      humanCommandUuids: [],
      willQuery: true,
    })
    resetCommandQueue()
    onQuotaRejectedForAutoResume(
      {
        status: 'rejected',
        resetsAt: Math.floor(Date.now() / 1000) + 7200,
        rateLimitType: 'five_hour',
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      },
      'other',
    )
    expect(getQuotaAutoResumeState().phase).toBe('idle')
  })

  test('s0v: third consecutive rearm emits cap-exhausted (HEv=2)', () => {
    const events: string[] = []
    const unsub = subscribeQuotaAutoResumeEvents(e => events.push(e))

    const rejectMain = (resetsAt: number) => {
      const uuid = fireQuotaAutoResumeContinuation()
      claimQuotaAutoResumeTurn({
        turnUuids: [uuid],
        isHumanTakeover: false,
        humanCommandUuids: [],
        willQuery: true,
      })
      resetCommandQueue()
      onQuotaRejectedForAutoResume(
        {
          status: 'rejected',
          resetsAt,
          rateLimitType: 'five_hour',
          unifiedRateLimitFallbackAvailable: false,
          isUsingOverage: false,
        },
        'main_thread',
      )
    }

    const base = Math.floor(Date.now() / 1000)
    rejectMain(base + 3600) // consecutiveRearms 0→1, rearmed
    expect(getQuotaAutoResumeState().phase).toBe('armed')
    expect(
      (getQuotaAutoResumeState() as { consecutiveRearms: number })
        .consecutiveRearms,
    ).toBe(1)

    // Simulate fire completing without PVr reset — leave consecutiveRearms=1,
    // clear armed wait, keep claim path for next reject.
    cancelQuotaAutoResume('fired')
    rejectMain(base + 7200) // 1→2, rearmed
    expect(
      (getQuotaAutoResumeState() as { consecutiveRearms: number })
        .consecutiveRearms,
    ).toBe(2)
    cancelQuotaAutoResume('fired')

    events.length = 0
    rejectMain(base + 10800) // >=2 → cap
    expect(getQuotaAutoResumeState().phase).toBe('idle')
    expect(events).toContain('cap-exhausted')
    expect(logEventMock).toHaveBeenCalledWith(
      'tengu_quota_auto_resume_cancelled',
      expect.objectContaining({ reason: 'rearm_cap' }),
    )
    unsub()
  })
})

describe('kDl marble_heron graceMs (densable yDl / R5w / D5w / I5w)', () => {
  test('yDl clamps non-number / negative / over-max', () => {
    expect(clampMarbleHeronMs(undefined, 1800000, 60000)).toBe(1800000)
    expect(clampMarbleHeronMs('nope', 1800000, 60000)).toBe(1800000)
    expect(clampMarbleHeronMs(-1, 1800000, 60000)).toBe(1800000)
    expect(clampMarbleHeronMs(1000, 1800000, 60000)).toBe(60000)
    expect(clampMarbleHeronMs(MARBLE_HERON_MS_MAX + 1, 1800000, 0)).toBe(
      MARBLE_HERON_MS_MAX,
    )
    expect(clampMarbleHeronMs('90000', 1800000, 60000)).toBe(90000)
  })

  test('default grace is 30m; config graceMs is read and clamped', () => {
    expect(getMarbleHeronGraceMs()).toBe(MARBLE_HERON_GRACE_DEFAULT_MS)
    getFeatureValueMock.mockImplementation((key, fallback) =>
      key === TENGU_MARBLE_HERON ? { graceMs: 90_000 } : fallback,
    )
    expect(getMarbleHeronGraceMs()).toBe(90_000)
    getFeatureValueMock.mockImplementation((key, fallback) =>
      key === TENGU_MARBLE_HERON ? { graceMs: 1_000 } : fallback,
    )
    expect(getMarbleHeronGraceMs()).toBe(MARBLE_HERON_GRACE_MIN_MS)
  })

  test('qXa marks stale when gap exceeds configured grace past fireAt', () => {
    getFeatureValueMock.mockImplementation((key, fallback) =>
      key === TENGU_MARBLE_HERON ? { graceMs: 60_000 } : fallback,
    )
    const armNow = Date.now() - 120_000
    armQuotaAutoResume(Math.floor(Date.now() / 1000) - 10, armNow, 'dialog')
    const armed = getQuotaAutoResumeState()
    expect(armed.phase).toBe('armed')
    const fireAt = (armed as { fireAtMs: number }).fireAtMs
    const nowMs = Math.max(fireAt, armNow + 60_000) + 1
    expect(tickQuotaAutoResume(nowMs, false)).toBe('stale')
    expect(getQuotaAutoResumeState().phase).toBe('stale')
  })
})
