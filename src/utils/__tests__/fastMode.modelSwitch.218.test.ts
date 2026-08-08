/**
 * densable 2.1.218 #31 — Rft/uU/dU model-switch fast mode announce helpers.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const logEventMock = mock(() => {})

mock.module('src/services/analytics/index.js', () => ({
  logEvent: logEventMock,
}))

mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => null,
}))

// Do NOT mock src/bootstrap/state.js — Bun mock.module is process-global and
// poisons sibling 218 tests that need real getIsNonInteractiveSession /
// setIsInteractive (e.g. forkedSkillBackground.218.test.ts).
// isRemoteModelSwitchSession() uses real state defaults (false/false).
// Tests pass remoteSession via opts when remote branch is needed.

mock.module('src/utils/auth.js', () => ({
  getAnthropicApiKey: () => 'test-key',
  getClaudeAIOAuthTokens: () => null,
  handleOAuth401Error: () => {},
  hasProfileScope: () => false,
}))

mock.module('src/utils/settings/settings.js', () => ({
  getInitialSettings: () => ({ fastMode: true }),
  getSettingsForSource: () => undefined,
  updateSettingsForSource: () => {},
}))

// Do NOT mock src/utils/config.js — Bun mock.module is process-global and
// poisons sibling 218 tests that need real saveGlobalConfig / getGlobalConfig
// (e.g. cdCommand.218 Omt/EUe trust latch). Rft/uU/dU pure helpers under test
// do not require config; isFastModeEnabled uses settings + residual gates.

mock.module('src/utils/model/providers.js', () => ({
  getAPIProvider: () => 'firstParty',
}))

mock.module('src/utils/bundledMode.js', () => ({
  isInBundledMode: () => true,
}))

mock.module('src/utils/privacyLevel.js', () => ({
  isEssentialTrafficOnly: () => false,
}))

mock.module('src/utils/residualMoreEnvGates.js', () => ({
  isOpus47FastModeEnabled: () => true,
  shouldSkipFastModeNetworkErrors: () => false,
  shouldSkipFastModeOrgCheck: () => false,
}))

mock.module('src/utils/residualFinalEnvGates.js', () => ({
  isFastModeDisabled: () => false,
}))

import {
  formatModelSwitchFastModeSuffix,
  resolveFastModeAfterModelSwitch,
  applyFastModeOnModelSwitch,
} from '../fastMode.js'

beforeEach(() => {
  logEventMock.mockClear()
})

afterEach(() => {
  logEventMock.mockClear()
})

describe('densable 2.1.218 #31 Rft/uU', () => {
  test('uU: unsupported model forces fast off', () => {
    expect(resolveFastModeAfterModelSwitch('sonnet', true)).toBe(false)
  })

  test('uU: supported model keeps prev on', () => {
    expect(resolveFastModeAfterModelSwitch('claude-opus-4-7', true)).toBe(true)
    expect(resolveFastModeAfterModelSwitch('claude-opus-4-8', true)).toBe(true)
  })

  test('uU: remote keeps prev only when model supports', () => {
    expect(
      resolveFastModeAfterModelSwitch('sonnet', true, { remoteSession: true }),
    ).toBe(false)
    expect(
      resolveFastModeAfterModelSwitch('claude-opus-4-7', true, {
        remoteSession: true,
      }),
    ).toBe(true)
    expect(
      resolveFastModeAfterModelSwitch(null, true, { remoteSession: true }),
    ).toBe(true)
  })

  test('Rft: OFF suffix when downgrading', () => {
    const s = formatModelSwitchFastModeSuffix(true, false)
    expect(s).toContain('Fast mode OFF')
    expect(s).not.toContain('Fast mode ON')
  })

  test('Rft: ON suffix when restoring', () => {
    const s = formatModelSwitchFastModeSuffix(false, true)
    expect(s).toContain('Fast mode ON')
  })

  test('Rft: no ON when kept on without announceKeptOn', () => {
    const s = formatModelSwitchFastModeSuffix(true, true)
    expect(s).toBe('')
  })

  test('Rft: announceKeptOn emits ON when staying on', () => {
    const s = formatModelSwitchFastModeSuffix(true, true, {
      announceKeptOn: true,
    })
    expect(s).toContain('Fast mode ON')
  })

  test('Rft: billing sits between ON and OFF order', () => {
    // ON + billing (no OFF)
    const onBill = formatModelSwitchFastModeSuffix(false, true, {
      billedAsExtraUsage: true,
    })
    expect(onBill.indexOf('Fast mode ON')).toBeLessThan(
      onBill.indexOf('Billed as extra usage'),
    )
    // billing + OFF (no ON)
    const offBill = formatModelSwitchFastModeSuffix(true, false, {
      billedAsExtraUsage: true,
    })
    expect(offBill.indexOf('Billed as extra usage')).toBeLessThan(
      offBill.indexOf('Fast mode OFF'),
    )
  })

  test('dU: logs model_switch_downgrade once on change', () => {
    const r = applyFastModeOnModelSwitch('sonnet', true)
    expect(r.nextFastMode).toBe(false)
    expect(r.changed).toBe(true)
    expect(r.suffix).toContain('Fast mode OFF')
    expect(logEventMock).toHaveBeenCalled()
    const calls = logEventMock.mock.calls as unknown as Array<
      [string, Record<string, unknown>?]
    >
    const call = calls.find(c => c[0] === 'tengu_fast_mode_toggled')
    expect(call?.[1]).toMatchObject({
      enabled: false,
      source: 'model_switch_downgrade',
    })
  })

  test('dU: no log when unchanged', () => {
    applyFastModeOnModelSwitch('sonnet', false)
    const calls = logEventMock.mock.calls as unknown as Array<
      [string, Record<string, unknown>?]
    >
    const call = calls.find(c => c[0] === 'tengu_fast_mode_toggled')
    expect(call).toBeUndefined()
  })
})
