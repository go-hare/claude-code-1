import { beforeEach, describe, expect, mock, test } from 'bun:test'

const state = {
  unavailable: null as string | null,
  featureEnabled: true as boolean,
  settings: {} as Record<string, unknown>,
  app: {
    mainLoopModel: 'claude-sonnet-4-6' as string | null,
    mainLoopModelForSession: null as string | null,
    fastMode: false as boolean,
  },
  events: [] as Array<{ enabled: boolean; source: string }>,
}

const realFast = require('src/utils/fastMode.ts') as Record<string, unknown>
mock.module('src/utils/fastMode.js', () => ({
  ...realFast,
  isFastModeEnabled: () => state.featureEnabled,
  getFastModeUnavailableReason: () => state.unavailable,
  isFastModeSupportedByModel: (m: string | null) =>
    typeof m === 'string' && m.includes('opus'),
  getFastModeModel: () => 'claude-opus-4-6',
  clearFastModeCooldown: () => {},
  prefetchFastModeStatus: async () => {},
  FAST_MODE_MODEL_DISPLAY: 'Opus 4.6',
}))

const realSettings = require('src/utils/settings/settings.ts') as Record<
  string,
  unknown
>
mock.module('src/utils/settings/settings.js', () => ({
  ...realSettings,
  updateSettingsForSource: (_src: string, patch: Record<string, unknown>) => {
    state.settings = { ...state.settings, ...patch }
    return {}
  },
}))

const realAnalytics = require('src/services/analytics/index.ts') as Record<
  string,
  unknown
>
mock.module('src/services/analytics/index.js', () => ({
  ...realAnalytics,
  logEvent: (name: string, data: { enabled: boolean; source: string }) => {
    if (name === 'tengu_fast_mode_toggled') {
      state.events.push({ enabled: data.enabled, source: String(data.source) })
    }
  },
}))

mock.module('src/components/FastIcon.js', () => ({
  getFastIconString: () => '⚡',
  FastIcon: () => null,
}))

mock.module('src/utils/modelCost.js', () => ({
  formatModelPricing: () => '$x/MTok',
  getOpus46CostTier: () => ({}),
}))

const { applyFastModeToggle } = await import('../applyFast.js')
const { call } = await import('../fast-noninteractive.js')

beforeEach(() => {
  state.unavailable = null
  state.featureEnabled = true
  state.settings = {}
  state.app = {
    mainLoopModel: 'claude-sonnet-4-6',
    mainLoopModelForSession: null,
    fastMode: false,
  }
  state.events = []
})

function appCtx() {
  return {
    getAppState: () => ({ ...state.app }),
    setAppState: (fn: (p: typeof state.app) => typeof state.app) => {
      state.app = fn(state.app)
    },
  }
}

describe('applyFastModeToggle (densable dsr/jTo)', () => {
  test('enable persists and switches model when needed', () => {
    const ctx = appCtx()
    const msg = applyFastModeToggle(
      true,
      ctx.getAppState,
      ctx.setAppState as never,
      { persistDefault: true, source: 'shortcut' },
    )
    expect(msg).toContain('Fast mode ON')
    expect(msg).toContain('model set to Opus 4.6')
    expect(msg).not.toContain('this session only')
    expect(state.app.fastMode).toBe(true)
    expect(state.app.mainLoopModel).toBe('claude-opus-4-6')
    expect(state.settings.fastMode).toBe(true)
    expect(state.events.at(-1)?.source).toBe('shortcut')
  })

  test('session-only does not write settings', () => {
    const ctx = appCtx()
    const msg = applyFastModeToggle(
      true,
      ctx.getAppState,
      ctx.setAppState as never,
      { persistDefault: false, source: 'bridge' },
    )
    expect(msg).toContain('this session only')
    expect(state.settings.fastMode).toBeUndefined()
    expect(state.app.fastMode).toBe(true)
  })

  test('disable clears settings when persisting', () => {
    state.app.fastMode = true
    const ctx = appCtx()
    const msg = applyFastModeToggle(
      false,
      ctx.getAppState,
      ctx.setAppState as never,
      { persistDefault: true, source: 'picker' },
    )
    expect(msg).toBe('Fast mode OFF')
    expect(state.app.fastMode).toBe(false)
    expect(state.settings.fastMode).toBeUndefined()
  })

  test('unavailable reason short-circuits', () => {
    state.unavailable = 'org disabled'
    const ctx = appCtx()
    const msg = applyFastModeToggle(
      true,
      ctx.getAppState,
      ctx.setAppState as never,
      { persistDefault: true, source: 'bridge' },
    )
    expect(msg).toContain('unavailable')
    expect(state.app.fastMode).toBe(false)
    expect(state.events).toEqual([])
  })
})

describe('fast noninteractive (densable VPy)', () => {
  test('on enables session-only', async () => {
    const r = await call('on', appCtx() as never)
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('Fast mode ON')
      expect(r.value).toContain('this session only')
    }
    expect(state.app.fastMode).toBe(true)
    expect(state.settings.fastMode).toBeUndefined()
    expect(state.events.at(-1)?.source).toBe('bridge')
  })

  test('empty toggles current value', async () => {
    state.app.fastMode = true
    const r = await call('', appCtx() as never)
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('Fast mode OFF')
    }
    expect(state.app.fastMode).toBe(false)
  })

  test('unknown arg rejected', async () => {
    const r = await call('maybe', appCtx() as never)
    expect(r).toEqual({
      type: 'text',
      value: 'Unknown argument "maybe". Use: /fast [on|off]',
    })
    expect(state.app.fastMode).toBe(false)
  })

  test('feature disabled', async () => {
    state.featureEnabled = false
    state.unavailable = 'disabled'
    const r = await call('on', appCtx() as never)
    expect(r).toEqual({ type: 'text', value: 'disabled' })
  })
})
