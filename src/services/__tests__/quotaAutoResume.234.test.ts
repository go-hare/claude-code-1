import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

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

const realSettings = await import('../../utils/settings/settings.js')
mock.module('../../utils/settings/settings.js', () => ({
  ...realSettings,
  getSettingsForSource: getSettingsForSourceMock,
  updateSettingsForSource: updateSettingsForSourceMock,
}))

const realGrowthbook = await import('../analytics/growthbook.js')
mock.module('../analytics/growthbook.js', () => ({
  ...realGrowthbook,
  getFeatureValue_CACHED_MAY_BE_STALE: getFeatureValueMock,
}))

const realAuth = await import('../../utils/auth.js')
mock.module('../../utils/auth.js', () => ({
  ...realAuth,
  isClaudeAISubscriber: isClaudeAISubscriberMock,
  getOauthAccountInfo: getOauthAccountInfoMock,
}))

const realBootstrap = await import('../../bootstrap/state.js')
mock.module('../../bootstrap/state.js', () => ({
  ...realBootstrap,
  getMainThreadAgentId: () => undefined,
  getIsNonInteractiveSession: getIsNonInteractiveSessionMock,
}))

const realAnalytics = await import('../analytics/index.js')
mock.module('../analytics/index.js', () => ({
  ...realAnalytics,
  logEvent: logEventMock,
}))

const realFormat = await import('../../utils/format.js')
mock.module('../../utils/format.js', () => ({
  ...realFormat,
  formatResetTime: formatResetTimeMock,
}))

const realClaudeAiLimits = await import('../claudeAiLimits.js')
mock.module('../claudeAiLimits.js', () => ({
  ...realClaudeAiLimits,
  statusListeners,
  get currentLimits() {
    return currentLimits
  },
}))

const {
  armQuotaAutoResume,
  canOfferQuotaAutoResume,
  cancelQuotaAutoResume,
  claimQuotaAutoResumeTurn,
  filterPendingQuotaContinuationIfRevoked,
  fireQuotaAutoResumeContinuation,
  formatAutoContinueWaitNotice,
  getQuotaAutoResumeState,
  hasPendingQuotaContinuationInQueue,
  isQuotaAutoResumeArmedOrPending,
  cancelQuotaAutoResumeWithNotice,
  onQuotaAutoResumeHumanSubmit,
  getWaitThenContinueOption,
  isAutoContinueAtUsageLimitEffective,
  isAutoContinueAtUsageLimitToggleable,
  isQuotaRejectedForAutoContinue,
  offerArmQuotaAutoResume,
  refreshAutoContinueKeyPresence,
  resetQuotaAutoResumeForTests,
  setAutoContinueAtUsageLimitSetting,
  tickQuotaAutoResume,
  tryAutoArmQuotaAutoResume,
  TENGU_MAPLE_SUNDIAL,
  TENGU_MARBLE_HERON,
  CONTINUATION_PROMPT,
} = await import('../quotaAutoResume.js')
const { getCommandQueue, resetCommandQueue } = await import(
  '../../utils/messageQueueManager.js'
)

afterAll(() => {
  mock.module('../../bootstrap/state.js', () => ({ ...realBootstrap }))
  mock.module('../../utils/settings/settings.js', () => ({ ...realSettings }))
  mock.module('../analytics/growthbook.js', () => ({ ...realGrowthbook }))
  mock.module('../../utils/auth.js', () => ({ ...realAuth }))
  mock.module('../analytics/index.js', () => ({ ...realAnalytics }))
  mock.module('../../utils/format.js', () => ({ ...realFormat }))
  mock.module('../claudeAiLimits.js', () => ({ ...realClaudeAiLimits }))
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

  test('z4f: Jqn killswitch strips continuation; otherwise keeps it', () => {
    const uuid = fireQuotaAutoResumeContinuation()
    const batch = [
      { value: 'human', mode: 'prompt' as const, uuid: 'human-1' },
      { value: CONTINUATION_PROMPT, mode: 'prompt' as const, uuid },
    ]
    expect(
      filterPendingQuotaContinuationIfRevoked(batch).map(c => c.uuid),
    ).toEqual(['human-1', uuid])

    getFeatureValueMock.mockImplementation((key, fallback) => {
      if (key === TENGU_MARBLE_HERON) return { enabled: false }
      return fallback
    })
    expect(
      filterPendingQuotaContinuationIfRevoked(batch).map(c => c.uuid),
    ).toEqual(['human-1'])
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
})
