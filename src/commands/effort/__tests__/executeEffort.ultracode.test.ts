import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const settingsState = {
  effortLevel: undefined as string | undefined,
  calls: [] as Array<{ source: string; patch: Record<string, unknown> }>,
}

// Capture real settings BEFORE mock.module so we can spread exports without recursion.
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

// Import after mocks
const { executeEffort, showCurrentEffort } = await import('../effort.js')

beforeEach(() => {
  settingsState.effortLevel = undefined
  settingsState.calls = []
  delete process.env.CLAUDE_CODE_EFFORT_LEVEL
})

afterEach(() => {
  delete process.env.CLAUDE_CODE_EFFORT_LEVEL
})

describe('executeEffort ultracode (densable sLy)', () => {
  test('sets xhigh + ultracode session flag without persisting effortLevel', () => {
    const r = executeEffort('ultracode', { model: 'claude-opus-4-7' })
    expect(r.effortUpdate).toEqual({ value: 'xhigh', ultracode: true })
    expect(r.message).toContain('ultracode')
    expect(r.message).toContain('this session only')
    // ultracode path must not write effortLevel to settings
    expect(settingsState.calls).toEqual([])
    expect(settingsState.effortLevel).toBeUndefined()
  })

  test('non-ultracode clears ultracode flag and persists', () => {
    const r = executeEffort('high', { model: 'claude-opus-4-7' })
    expect(r.effortUpdate).toEqual({ value: 'high', ultracode: false })
    expect(settingsState.effortLevel).toBe('high')
    expect(settingsState.calls.length).toBeGreaterThan(0)
  })

  test('auto clears ultracode', () => {
    const r = executeEffort('auto')
    expect(r.effortUpdate).toEqual({ value: undefined, ultracode: false })
    expect(r.message.toLowerCase()).toContain('auto')
  })
})

describe('showCurrentEffort ultracode (densable LJr)', () => {
  test('reports ultracode when session active', () => {
    const r = showCurrentEffort('xhigh', 'claude-opus-4-7', true)
    expect(r.message).toContain('ultracode')
    expect(r.message).toContain('this session only')
  })

  test('reports normal level when ultracode off', () => {
    const r = showCurrentEffort('high', 'claude-opus-4-7', false)
    expect(r.message).toContain('high')
    expect(r.message).not.toContain('ultracode')
  })
})
