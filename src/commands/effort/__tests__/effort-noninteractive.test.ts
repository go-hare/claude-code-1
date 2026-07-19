import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

/**
 * densable yEs — noninteractive /effort.
 * Do NOT mock ../effort.js (process-global mock.module would poison
 * executeEffort.ultracode.test.ts in the same bun test process).
 * Mock leaf settings/analytics/workflow gate only.
 */

const settingsState = {
  effortLevel: undefined as string | undefined,
  calls: [] as Array<{ source: string; patch: Record<string, unknown> }>,
}

const realSettings = await import('../../../utils/settings/settings.js')

mock.module('src/utils/settings/settings.js', () => ({
  ...realSettings,
  getInitialSettings: () => ({
    effortLevel: settingsState.effortLevel,
  }),
  updateSettingsForSource: (source: string, patch: Record<string, unknown>) => {
    settingsState.calls.push({ source, patch })
    if ('effortLevel' in patch) {
      settingsState.effortLevel = patch.effortLevel as string | undefined
    }
    return { error: undefined }
  },
}))

mock.module('src/utils/workflowDisableGate.js', () => ({
  isWorkflowsFeatureEnabled: () => true,
}))

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

const realModel = require('src/utils/model/model.ts') as Record<string, unknown>
mock.module('src/utils/model/model.js', () => ({
  ...realModel,
  getMainLoopModel: () => 'claude-sonnet-4-6',
}))

const { call } = await import('../effort-noninteractive.js')

const app = {
  effortValue: undefined as string | undefined,
  ultracode: false,
}

beforeEach(() => {
  app.effortValue = undefined
  app.ultracode = false
  settingsState.effortLevel = undefined
  settingsState.calls = []
  delete process.env.CLAUDE_CODE_EFFORT_LEVEL
})

afterEach(() => {
  delete process.env.CLAUDE_CODE_EFFORT_LEVEL
})

function ctx() {
  return {
    getAppState: () => ({
      effortValue: app.effortValue,
      ultracode: app.ultracode,
      mainLoopModel: null,
      mainLoopModelForSession: null,
    }),
    setAppState: (
      fn: (p: {
        effortValue: string | undefined
        ultracode: boolean
      }) => {
        effortValue: string | undefined
        ultracode: boolean
      },
    ) => {
      const next = fn({
        effortValue: app.effortValue,
        ultracode: app.ultracode,
      })
      app.effortValue = next.effortValue
      app.ultracode = next.ultracode
    },
  } as never
}

describe('effort noninteractive (densable yEs)', () => {
  test('empty args returns usage', async () => {
    const r = await call('', ctx())
    expect(r).toEqual({
      type: 'text',
      value: 'Usage: /effort <low|medium|high|xhigh|max|auto|ultracode>',
    })
  })

  test('help text', async () => {
    const r = await call('help', ctx())
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('Effort levels')
      expect(r.value).toContain('xhigh')
      expect(r.value).toContain('ultracode')
    }
  })

  test('sets low effort via executeEffort', async () => {
    const r = await call('low', ctx())
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('Set effort level to low')
    }
    expect(app.effortValue).toBe('low')
    expect(app.ultracode).toBe(false)
  })

  test('ultracode sets xhigh + session flag', async () => {
    const r = await call('ultracode', ctx())
    expect(app.effortValue).toBe('xhigh')
    expect(app.ultracode).toBe(true)
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('ultracode')
    }
    // session-only — no settings write for ultracode alias
    expect(settingsState.calls).toEqual([])
  })

  test('status shows current', async () => {
    app.effortValue = 'high'
    const r = await call('status', ctx())
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('high')
    }
  })

  test('status shows ultracode when flag set', async () => {
    app.effortValue = 'xhigh'
    app.ultracode = true
    const r = await call('status', ctx())
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('ultracode')
    }
  })
})
