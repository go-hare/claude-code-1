/**
 * densable 2.1.235 — vscodeSdkMcp experiment_gates + log_event routing.
 *
 * Process-global mock.module — spread real config/settings snapshots and
 * restore in afterAll (thin unrestored mocks poisoned tui/autoMode suites).
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'
import * as realAnalytics from 'src/services/analytics/index.js'
import * as realGrowthbook from 'src/services/analytics/growthbook.js'
import * as realConfig from 'src/utils/config.js'
import * as realSettings from 'src/utils/settings/settings.js'

mock.module('bun:bundle', () => ({
  feature: () => false,
}))

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const configSnap = snapshotModuleExports(realConfig)
const settingsSnap = snapshotModuleExports(realSettings)
const growthbookSnap = snapshotModuleExports(realGrowthbook)
const analyticsSnap = snapshotModuleExports(realAnalytics)

const logEventMock = mock(
  (_name: string, _data?: Record<string, unknown>) => {},
)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: logEventMock,
}))

const cachedGb: Record<string, unknown> = {}
const cachedSg: Record<string, boolean> = {}
let hasSeenAutoDefaultNudge = false
let feedbackLastShown: number | undefined
let clientDataCache: Record<string, unknown> | null = null
let modelAllowed = true

function configMock() {
  return {
    ...configSnap,
    getGlobalConfig: () => ({
      ...(configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig)(),
      cachedGrowthBookFeatures: cachedGb,
      cachedStatsigGates: cachedSg,
      hasSeenAutoDefaultNudge,
      clientDataCache,
      feedbackSurveyState:
        feedbackLastShown !== undefined
          ? { lastShownTime: feedbackLastShown }
          : undefined,
    }),
    saveGlobalConfig: (
      updater: (c: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const next = updater({
        hasSeenAutoDefaultNudge,
        clientDataCache,
        feedbackSurveyState:
          feedbackLastShown !== undefined
            ? { lastShownTime: feedbackLastShown }
            : undefined,
      })
      if (typeof next.hasSeenAutoDefaultNudge === 'boolean') {
        hasSeenAutoDefaultNudge = next.hasSeenAutoDefaultNudge
      }
      if ('clientDataCache' in next) {
        clientDataCache =
          (next.clientDataCache as Record<string, unknown> | null) ?? null
      }
      const fs = next.feedbackSurveyState as
        | { lastShownTime?: number }
        | undefined
      if (fs?.lastShownTime !== undefined) {
        feedbackLastShown = fs.lastShownTime
      }
    },
  }
}

mock.module('src/utils/config.js', configMock)
mock.module('src/utils/config.ts', configMock)

mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE: (gate: string) =>
    Boolean(cachedGb[gate] ?? cachedSg[gate] ?? false),
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) => {
    if (key in cachedGb) return cachedGb[key]
    return fallback
  },
}))

function settingsMock() {
  return {
    ...settingsSnap,
    updateSettingsForSource: mock(() => {}),
  }
}

mock.module('src/utils/settings/settings.js', settingsMock)
mock.module('src/utils/settings/settings.ts', settingsMock)

mock.module('src/utils/model/modelAllowlist.js', () => ({
  isModelAllowed: (_model: string) => modelAllowed,
}))

mock.module('src/services/analytics/config.js', () => ({
  isFeedbackSurveyDisabled: () => false,
}))

mock.module('src/services/policyLimits/index.js', () => ({
  isPolicyAllowed: () => true,
}))

mock.module('src/utils/residualFinalEnvGates.js', () => ({
  isFeedbackSurveyEnvDisabled: () => false,
}))

afterAll(() => {
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.ts', () => ({ ...configSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
    'src/utils/settings/settings.ts',
  ])
})

const {
  setupVscodeSdkMcp,
  resetVscodeSdkMcpForTests,
  VSCODE_EXPERIMENT_GATE_KEYS,
  notifyVscodeFileUpdated,
} = await import('../vscodeSdkMcp.js')
const {
  isClaudeVscodeHostSession,
  isRefusalFallbackLaneEnabled,
  handleVscodeFeedbackSurveyEvent,
  handleVscodeAutoDefaultNudgeEvent,
  getVscodeStartupAnnouncementGate,
  isAutoDefaultLaunchEnabled,
} = await import('../vscodeIdeBridgeCallbacks.js')

type Handler = (params: {
  eventName: string
  eventData: Record<string, unknown>
}) => Promise<void>

function makeClient(opts?: {
  name?: string
  type?: 'connected' | 'failed'
  configType?: 'sdk' | 'stdio'
}) {
  let handler: Handler | undefined
  const notifications: Array<{ method: string; params: unknown }> = []
  const client = {
    setNotificationHandler: (_method: string, _schema: unknown, h: Handler) => {
      handler = h
    },
    notification: mock(async (payload: { method: string; params: unknown }) => {
      notifications.push(payload)
    }),
    onerror: undefined as ((e: Error) => void) | undefined,
  }
  return {
    server: {
      name: opts?.name ?? 'claude-vscode',
      type: opts?.type ?? ('connected' as const),
      client,
      capabilities: {},
      config: { type: opts?.configType ?? 'sdk', name: 'claude-vscode' },
      cleanup: async () => {},
    },
    client,
    notifications,
    getHandler: () => handler,
  }
}

describe('vscodeSdkMcp densable 2.1.235', () => {
  const prevEntry = process.env.CLAUDE_CODE_ENTRYPOINT
  const prevChild = process.env.CLAUDE_CODE_CHILD_SESSION
  const prevCd = process.env.CLAUDECODE
  const prevRefusal = process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK
  const prevNoFb = process.env.CLAUDE_CODE_NO_MODEL_FALLBACK

  beforeEach(() => {
    resetVscodeSdkMcpForTests()
    logEventMock.mockClear()
    for (const k of Object.keys(cachedGb)) delete cachedGb[k]
    for (const k of Object.keys(cachedSg)) delete cachedSg[k]
    hasSeenAutoDefaultNudge = false
    feedbackLastShown = undefined
    clientDataCache = null
    modelAllowed = true
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode'
    delete process.env.CLAUDE_CODE_CHILD_SESSION
    delete process.env.CLAUDECODE
    delete process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK
    delete process.env.CLAUDE_CODE_NO_MODEL_FALLBACK
  })

  afterEach(() => {
    if (prevEntry === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = prevEntry
    if (prevChild === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION
    else process.env.CLAUDE_CODE_CHILD_SESSION = prevChild
    if (prevCd === undefined) delete process.env.CLAUDECODE
    else process.env.CLAUDECODE = prevCd
    if (prevRefusal === undefined)
      delete process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK
    else process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK = prevRefusal
    if (prevNoFb === undefined) delete process.env.CLAUDE_CODE_NO_MODEL_FALLBACK
    else process.env.CLAUDE_CODE_NO_MODEL_FALLBACK = prevNoFb
  })

  test('VSCODE_EXPERIMENT_GATE_KEYS is SEA 14-key set', () => {
    const actual = [...VSCODE_EXPERIMENT_GATE_KEYS].slice().sort()
    const expected = [
      'fable5_launch_show',
      'startup_announcement',
      'tengu_auto_mode_state',
      'tengu_brick_follow',
      'tengu_cobalt_harbor_notice',
      'tengu_harbor_willow',
      'tengu_loggia_carousel',
      'tengu_loggia_carousel_config',
      'tengu_quiet_fern',
      'tengu_slate_ribbon',
      'tengu_vellum_siding',
      'tengu_vscode_cc_auth',
      'tengu_vscode_onboarding',
      'tengu_vscode_review_upsell',
    ] as typeof actual
    expect(actual).toEqual(expected.slice().sort())
  })

  test('pushes full gates; quiet_fern/cc_auth/slate_ribbon hardcoded true', async () => {
    const { server, notifications } = makeClient()
    setupVscodeSdkMcp([server as never], {
      refusalFallbackLaneEnabled: true,
      refusalFallbackSettingToggleVisible: true,
      fable5LaunchShow: false,
      startupAnnouncement: false,
      autoDefaultLaunchEnabled: true,
    })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.method).toBe('experiment_gates')
    const gates = (
      notifications[0]!.params as { gates: Record<string, unknown> }
    ).gates
    expect(Object.keys(gates).sort()).toEqual(
      [...VSCODE_EXPERIMENT_GATE_KEYS].sort(),
    )
    expect(gates.tengu_quiet_fern).toBe(true)
    expect(gates.tengu_vscode_cc_auth).toBe(true)
    expect(gates.tengu_slate_ribbon).toBe(true)
    expect(gates.tengu_loggia_carousel).toBe(true)
    expect(gates.tengu_loggia_carousel_config).toBe(true)
    expect(gates.tengu_harbor_willow).toBe(true)
    expect(gates.fable5_launch_show).toBe(false)
    expect(gates.startup_announcement).toBe(false)
    // cobalt default true on miss
    expect(gates.tengu_cobalt_harbor_notice).toBe(true)
    // always present
    expect(gates.tengu_auto_mode_state).toBe('enabled')
  })

  test('RnT: opt-in remaps to enabled; disabled preserved', async () => {
    cachedGb.tengu_auto_mode_config = { enabled: 'opt-in' }
    const a = makeClient()
    setupVscodeSdkMcp([a.server as never])
    const gatesA = (
      a.notifications[0]!.params as { gates: Record<string, unknown> }
    ).gates
    expect(gatesA.tengu_auto_mode_state).toBe('enabled')

    resetVscodeSdkMcpForTests()
    cachedGb.tengu_auto_mode_config = { enabled: 'disabled' }
    const b = makeClient()
    setupVscodeSdkMcp([b.server as never])
    const gatesB = (
      b.notifications[0]!.params as { gates: Record<string, unknown> }
    ).gates
    expect(gatesB.tengu_auto_mode_state).toBe('disabled')

    resetVscodeSdkMcpForTests()
    cachedGb.tengu_auto_mode_config = { enabled: 'bogus' }
    const c = makeClient()
    setupVscodeSdkMcp([c.server as never])
    const gatesC = (
      c.notifications[0]!.params as { gates: Record<string, unknown> }
    ).gates
    expect(gatesC.tengu_auto_mode_state).toBe('enabled')
  })

  test('log_event survey/nudge special-case under sdk+hUe; else tengu_vscode_ prefix', async () => {
    const survey = mock((_d: Record<string, unknown>) => {})
    const nudge = mock(
      (_p: 'shown' | 'resolved', _d: Record<string, unknown>) => {},
    )
    const { server, getHandler } = makeClient()
    setupVscodeSdkMcp([server as never], {
      onFeedbackSurveyEvent: survey,
      onAutoDefaultNudgeEvent: nudge,
    })
    const h = getHandler()
    expect(h).toBeDefined()

    await h!({
      eventName: 'tengu_feedback_survey_event',
      eventData: { event_type: 'appeared' },
    })
    expect(survey).toHaveBeenCalledTimes(1)
    expect(logEventMock).not.toHaveBeenCalled()

    logEventMock.mockClear()
    await h!({
      eventName: 'auto_default_nudge_shown',
      eventData: { current_mode: 'default' },
    })
    expect(nudge).toHaveBeenCalledWith('shown', { current_mode: 'default' })
    expect(logEventMock).not.toHaveBeenCalled()

    logEventMock.mockClear()
    await h!({
      eventName: 'panel_opened',
      eventData: { x: 1 },
    })
    expect(logEventMock).toHaveBeenCalledWith('tengu_vscode_panel_opened', {
      x: 1,
    })
  })

  test('survey/nudge do not fire callback when not vscode host session', async () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    const survey = mock(() => {})
    const { server, getHandler } = makeClient()
    setupVscodeSdkMcp([server as never], {
      onFeedbackSurveyEvent: survey,
    })
    await getHandler()!({
      eventName: 'tengu_feedback_survey_event',
      eventData: { event_type: 'appeared' },
    })
    expect(survey).not.toHaveBeenCalled()
  })

  test('non claude-vscode client is no-op', () => {
    const { server, notifications } = makeClient({ name: 'other' })
    setupVscodeSdkMcp([server as never])
    expect(notifications).toHaveLength(0)
  })

  test('onerror logs channel error once', () => {
    const { server, client } = makeClient()
    setupVscodeSdkMcp([server as never])
    expect(typeof client.onerror).toBe('function')
    client.onerror!(new Error('boom1'))
    client.onerror!(new Error('boom2'))
    const channelLogs = logEventMock.mock.calls.filter(
      c => c[0] === 'vscode_notification_channel_error',
    )
    expect(channelLogs).toHaveLength(1)
  })

  test('notifyVscodeFileUpdated remains ant-gated', async () => {
    const prev = process.env.USER_TYPE
    process.env.USER_TYPE = 'external'
    const { server, client } = makeClient()
    setupVscodeSdkMcp([server as never])
    notifyVscodeFileUpdated('/a', null, 'x')
    expect(client.notification).toHaveBeenCalledTimes(1) // only experiment_gates
    if (prev === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = prev
  })
})

describe('vscodeIdeBridgeCallbacks densable helpers', () => {
  test('isClaudeVscodeHostSession matches hUe', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode'
    delete process.env.CLAUDE_CODE_CHILD_SESSION
    delete process.env.CLAUDECODE
    expect(isClaudeVscodeHostSession()).toBe(true)
    process.env.CLAUDECODE = '1'
    expect(isClaudeVscodeHostSession()).toBe(false)
  })

  test('isRefusalFallbackLaneEnabled is $re (refusal && !NO_MODEL_FALLBACK)', () => {
    delete process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK
    delete process.env.CLAUDE_CODE_NO_MODEL_FALLBACK
    expect(isRefusalFallbackLaneEnabled({})).toBe(true)
    expect(
      isRefusalFallbackLaneEnabled({
        CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1',
      }),
    ).toBe(false)
    expect(
      isRefusalFallbackLaneEnabled({ CLAUDE_CODE_NO_MODEL_FALLBACK: '1' }),
    ).toBe(false)
  })

  test('HIn: meadow_lantern from clientDataCache ORs harbor_willow', () => {
    cachedSg.tengu_harbor_willow = false
    clientDataCache = null
    expect(isAutoDefaultLaunchEnabled()).toBe(false)
    clientDataCache = { meadow_lantern: true }
    expect(isAutoDefaultLaunchEnabled()).toBe(true)
    clientDataCache = { meadow_lantern: 'true' } // SEA === true only
    expect(isAutoDefaultLaunchEnabled()).toBe(false)
    clientDataCache = null
    cachedSg.tengu_harbor_willow = true
    expect(isAutoDefaultLaunchEnabled()).toBe(true)
  })

  test('vNh: top priority requiresModel-ok announcement as JSON; else false', () => {
    expect(getVscodeStartupAnnouncementGate()).toBe(false)
    cachedGb.tengu_startup_announcements = [
      {
        id: 'low',
        text: 'low text',
        priority: 1,
        title: 'Low',
      },
      {
        id: 'high',
        text: 'high text',
        priority: 10,
        title: 'High',
        footer: 'f',
      },
    ]
    expect(JSON.parse(getVscodeStartupAnnouncementGate() as string)).toEqual({
      id: 'high',
      title: 'High',
      text: 'high text',
      footer: 'f',
    })
    // requiresModel fail drops that item; next wins
    cachedGb.tengu_startup_announcements = [
      { id: 'gated', text: 'x', priority: 99, requiresModel: 'opus' },
      { id: 'ok', text: 'y', priority: 1 },
    ]
    modelAllowed = false
    expect(JSON.parse(getVscodeStartupAnnouncementGate() as string)).toEqual({
      id: 'ok',
      text: 'y',
    })
    modelAllowed = true
    expect(JSON.parse(getVscodeStartupAnnouncementGate() as string)).toEqual({
      id: 'gated',
      text: 'x',
    })
  })

  test('handleVscodeFeedbackSurveyEvent appeared updates lastShownTime', () => {
    feedbackLastShown = undefined
    handleVscodeFeedbackSurveyEvent({ event_type: 'appeared' })
    const first = feedbackLastShown as number | undefined
    expect(typeof first).toBe('number')
    handleVscodeFeedbackSurveyEvent({ event_type: 'appeared' })
    expect(feedbackLastShown as number | undefined).toBe(first) // debounce
    handleVscodeFeedbackSurveyEvent({ event_type: 'other' })
    expect(feedbackLastShown as number | undefined).toBe(first)
  })

  test('handleVscodeAutoDefaultNudgeEvent accept latches and sets auto', () => {
    hasSeenAutoDefaultNudge = false
    logEventMock.mockClear()
    handleVscodeAutoDefaultNudgeEvent('shown', { current_mode: 'default' })
    expect(
      logEventMock.mock.calls.some(
        c => c[0] === 'tengu_auto_default_nudge_shown',
      ),
    ).toBe(true)
    handleVscodeAutoDefaultNudgeEvent('resolved', {
      current_mode: 'default',
      choice: 'accept',
    })
    expect(hasSeenAutoDefaultNudge).toBe(true)
    expect(
      logEventMock.mock.calls.some(
        c => c[0] === 'tengu_auto_default_nudge_resolved',
      ),
    ).toBe(true)
    // second call ignored
    logEventMock.mockClear()
    handleVscodeAutoDefaultNudgeEvent('shown', { current_mode: 'default' })
    expect(logEventMock).not.toHaveBeenCalled()
  })
})
