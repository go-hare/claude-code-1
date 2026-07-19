import { beforeEach, describe, expect, mock, test } from 'bun:test'

const state = {
  allowed: true as boolean,
  validated: true as boolean,
  validateError: '' as string,
  settings: {} as Record<string, unknown>,
  sessionModel: null as string | null,
  app: {
    mainLoopModel: null as string | null,
    mainLoopModelForSession: 'session-model' as string | null,
    effortValue: 'high' as string | undefined,
    fastMode: false as boolean,
  },
}

// Passthrough mocks — only override symbols under test so process-global
// mock.module does not strip other exports used by shared deps.
const realAllowlist = require('src/utils/model/modelAllowlist.ts') as {
  isModelAllowed: (m: string) => boolean
}
mock.module('src/utils/model/modelAllowlist.js', () => ({
  ...realAllowlist,
  isModelAllowed: () => state.allowed,
}))

const realValidate = require('src/utils/model/validateModel.ts') as {
  validateModel: (m: string) => Promise<{ valid: boolean; error?: string }>
}
mock.module('src/utils/model/validateModel.js', () => ({
  ...realValidate,
  validateModel: async () => ({
    valid: state.validated,
    error: state.validateError || undefined,
  }),
}))

const realCheck = require('src/utils/model/check1mAccess.ts') as Record<
  string,
  unknown
>
mock.module('src/utils/model/check1mAccess.js', () => ({
  ...realCheck,
  checkOpus1mAccess: () => true,
  checkSonnet1mAccess: () => true,
}))

const realModel = require('src/utils/model/model.ts') as Record<string, unknown>
mock.module('src/utils/model/model.js', () => ({
  ...realModel,
  getDefaultMainLoopModelSetting: () => 'sonnet',
  isOpus1mMergeEnabled: () => false,
  renderDefaultModelSetting: (m: string) => m,
  getMainLoopModel: () => 'claude-sonnet-4-6',
  getSmallFastModel: () => 'claude-haiku',
}))

const realSession = require('src/utils/sessionStorage.ts') as Record<
  string,
  unknown
>
mock.module('src/utils/sessionStorage.js', () => ({
  ...realSession,
  saveSessionModel: (m: string | null) => {
    state.sessionModel = m
  },
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

const realFast = require('src/utils/fastMode.ts') as Record<string, unknown>
mock.module('src/utils/fastMode.js', () => ({
  ...realFast,
  clearFastModeCooldown: () => {},
  isFastModeEnabled: () => false,
  isFastModeSupportedByModel: () => false,
}))

const realExtra = require('src/utils/extraUsage.ts') as Record<string, unknown>
mock.module('src/utils/extraUsage.js', () => ({
  ...realExtra,
  isBilledAsExtraUsage: () => false,
}))

const { applyModelSet, formatCurrentModel, modelUsageText } = await import(
  '../applyModel.js'
)

beforeEach(() => {
  state.allowed = true
  state.validated = true
  state.validateError = ''
  state.settings = {}
  state.sessionModel = null
  state.app = {
    mainLoopModel: null,
    mainLoopModelForSession: 'session-model',
    effortValue: 'high',
    fastMode: false,
  }
})

function makeCtx() {
  return {
    getAppState: () => ({ ...state.app }),
    setAppState: (fn: (p: typeof state.app) => typeof state.app) => {
      state.app = fn(state.app)
    },
  } as never
}

describe('applyModelSet (densable _Ht/V7r)', () => {
  test('sets known alias and persists default when asked', async () => {
    const msg = await applyModelSet('sonnet', makeCtx(), {
      persistDefault: true,
    })
    expect(msg).toContain('Set model to')
    expect(msg).toContain('saved as your default')
    expect(state.app.mainLoopModel).toBe('sonnet')
    expect(state.app.mainLoopModelForSession).toBeNull()
    expect(state.sessionModel).toBe('sonnet')
    expect(state.settings.model).toBe('sonnet')
  })

  test('session-only does not write settings', async () => {
    const msg = await applyModelSet('opus', makeCtx(), {
      persistDefault: false,
    })
    expect(msg).toContain('this session only')
    expect(state.app.mainLoopModel).toBe('opus')
    expect(state.settings.model).toBeUndefined()
  })

  test('default clears model', async () => {
    state.app.mainLoopModel = 'opus'
    await applyModelSet('default', makeCtx(), { persistDefault: true })
    expect(state.app.mainLoopModel).toBeNull()
    expect(state.settings.model).toBeUndefined()
  })

  test('rejects disallowed model', async () => {
    state.allowed = false
    const msg = await applyModelSet('secret-model', makeCtx(), {
      persistDefault: false,
    })
    expect(msg).toContain('not available')
    expect(state.app.mainLoopModel).toBeNull()
  })

  test('rejects invalid custom model', async () => {
    state.validated = false
    state.validateError = 'nope'
    const msg = await applyModelSet('custom-xyz', makeCtx(), {
      persistDefault: false,
    })
    expect(msg).toBe('nope')
  })
})

describe('formatCurrentModel / modelUsageText', () => {
  test('shows session override', () => {
    const text = formatCurrentModel(null, 'plan-model', 'medium')
    expect(text).toContain('session override')
    expect(text).toContain('plan-model')
    expect(text).toContain('effort: medium')
  })

  test('usage lists aliases', () => {
    expect(modelUsageText()).toContain('sonnet')
    expect(modelUsageText()).toContain('/model')
  })
})
