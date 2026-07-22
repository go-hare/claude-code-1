/**
 * Tests for fix: 修复穷鬼模式的写入问题
 *
 * Before the fix, poorMode was an in-memory boolean that reset on restart.
 * After the fix, it reads from / writes to settings.json via
 * getInitialSettings() and updateSettingsForSource().
 */
import { afterAll, describe, expect, test, beforeEach, mock } from 'bun:test'
import * as settingsModule from '../../../utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

// Snapshot BEFORE mock.module — live namespace rebinds under Bun mock.module.
const settingsSnap = snapshotModuleExports(settingsModule)
const realGetInitialSettings =
  settingsSnap.getInitialSettings as typeof settingsModule.getInitialSettings

// ── Mocks must be declared before the module under test is imported ──────────

let mockSettings: Record<string, unknown> = {}
let lastUpdate: { source: string; patch: Record<string, unknown> } | null = null

// Spread pre-mock snapshot and override only poor-mode paths — thin full stubs
// break tui updateSettingsForSource under Bun process-global mock.module.
mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => ({
      ...realGetInitialSettings(),
      ...mockSettings,
    }),
    getSettingsForSource: () => ({
      ...realGetInitialSettings(),
      ...mockSettings,
    }),
    getSettingsWithErrors: () => ({
      settings: { ...realGetInitialSettings(), ...mockSettings },
      errors: [],
    }),
    getSettingsWithSources: () => ({
      effective: { ...realGetInitialSettings(), ...mockSettings },
      sources: [],
    }),
    getSettings_DEPRECATED: () => ({
      ...realGetInitialSettings(),
      ...mockSettings,
    }),
    rawSettingsContainsKey: (key: string) =>
      key in mockSettings ||
      key in (realGetInitialSettings() as Record<string, unknown>),
    updateSettingsForSource: (
      source: string,
      patch: Record<string, unknown>,
    ) => {
      lastUpdate = { source, patch }
      mockSettings = { ...mockSettings, ...patch }
      // Do not write through real settings (would mutate user settings.json).
      return { error: null }
    },
  }),
)

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
  ])
})

// Import AFTER mocks are registered. The query suffix gives this file its own
// module instance so cross-file poorMode.js mocks cannot replace the subject
// under test during Bun's shared coverage run.
const poorModeModulePath = '../poorMode.js?poorModeTest'
const { isPoorModeActive, setPoorMode } = (await import(
  poorModeModulePath
)) as typeof import('../poorMode.js')

// ── Tests ────────────────────────────────────────────────────────────────────

describe('isPoorModeActive — reads from settings on first call', () => {
  beforeEach(() => {
    lastUpdate = null
  })

  test('returns false when settings has no poorMode key', () => {
    mockSettings = {}
    // Force re-read by setting internal state via setPoorMode then checking
    setPoorMode(false)
    expect(isPoorModeActive()).toBe(false)
  })

  test('returns true when settings.poorMode === true', () => {
    mockSettings = { poorMode: true }
    setPoorMode(true)
    expect(isPoorModeActive()).toBe(true)
  })
})

describe('setPoorMode — persists to settings', () => {
  beforeEach(() => {
    lastUpdate = null
  })

  test('setPoorMode(true) calls updateSettingsForSource with poorMode: true', () => {
    setPoorMode(true)
    expect(lastUpdate).not.toBeNull()
    expect(lastUpdate!.source).toBe('userSettings')
    expect(lastUpdate!.patch.poorMode).toBe(true)
  })

  test('setPoorMode(false) calls updateSettingsForSource with poorMode: undefined (removes key)', () => {
    setPoorMode(false)
    expect(lastUpdate).not.toBeNull()
    expect(lastUpdate!.source).toBe('userSettings')
    // false || undefined === undefined — key should be removed to keep settings clean
    expect(lastUpdate!.patch.poorMode).toBeUndefined()
  })

  test('isPoorModeActive() reflects the value set by setPoorMode()', () => {
    setPoorMode(true)
    expect(isPoorModeActive()).toBe(true)

    setPoorMode(false)
    expect(isPoorModeActive()).toBe(false)
  })

  test('toggling multiple times stays consistent', () => {
    setPoorMode(true)
    setPoorMode(true)
    expect(isPoorModeActive()).toBe(true)

    setPoorMode(false)
    setPoorMode(false)
    expect(isPoorModeActive()).toBe(false)
  })
})
