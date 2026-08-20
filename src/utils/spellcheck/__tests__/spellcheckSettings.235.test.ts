/**
 * densable 2.1.235 #1 — spellcheck settings tier resolve (user/flag/managed only).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { SettingsJson } from '../../settings/types.js'
import type { SettingSource } from '../../settings/constants.js'
import {
  emitSpellcheckSettingsWarnings,
  resolveSpellcheckSettings,
  warnSpellcheckOnce,
} from '../settings.js'

const debugLogs: string[] = []
mock.module('../../debug.js', () => ({
  logForDebugging: (msg: string) => {
    debugLogs.push(msg)
  },
}))

afterEach(() => {
  debugLogs.length = 0
})

function fakeReader(
  map: Partial<Record<SettingSource, SettingsJson | null>>,
): (source: SettingSource) => SettingsJson | null {
  return source => map[source] ?? null
}

describe('resolveSpellcheckSettings (B$s / lRt)', () => {
  test('policy beats flag beats user; whole block wins (no field merge)', () => {
    const get = fakeReader({
      policySettings: { spellcheck: { enabled: true, checker: 'aspell' } },
      flagSettings: { spellcheck: { enabled: false } },
      userSettings: { spellcheck: { enabled: true, language: 'en_GB' } },
    })
    const r = resolveSpellcheckSettings(get)
    expect(r.source).toBe('policySettings')
    expect(r.enabled).toBe(true)
    expect(r.block?.checker).toBe('aspell')
    expect(r.block?.language).toBeUndefined()
  })

  test('flag beats user when policy absent', () => {
    const get = fakeReader({
      flagSettings: { spellcheck: { enabled: true } },
      userSettings: { spellcheck: { enabled: false } },
    })
    const r = resolveSpellcheckSettings(get)
    expect(r.source).toBe('flagSettings')
    expect(r.enabled).toBe(true)
  })

  test('project/local never become the effective block', () => {
    const get = fakeReader({
      projectSettings: { spellcheck: { enabled: true } },
      localSettings: { spellcheck: { enabled: true } },
      userSettings: undefined as unknown as null,
    })
    // only project/local present → no trusted block
    const r = resolveSpellcheckSettings(
      fakeReader({
        projectSettings: { spellcheck: { enabled: true } },
        localSettings: { spellcheck: { enabled: true } },
      }),
    )
    expect(r.block).toBeUndefined()
    expect(r.enabled).toBe(false)
    void get
  })

  test('enabled requires explicit true', () => {
    const r = resolveSpellcheckSettings(
      fakeReader({
        userSettings: { spellcheck: { checker: 'hunspell' } },
      }),
    )
    expect(r.source).toBe('userSettings')
    expect(r.enabled).toBe(false)
  })
})

describe('emitSpellcheckSettingsWarnings (dhg)', () => {
  test('warns once for project/local ignore + missing enabled', () => {
    const host = {}
    const get = fakeReader({
      projectSettings: { spellcheck: { enabled: true } },
      userSettings: { spellcheck: { language: 'en_US' } },
    })
    const resolved = resolveSpellcheckSettings(get)
    emitSpellcheckSettingsWarnings(host, resolved, get)
    emitSpellcheckSettingsWarnings(host, resolved, get)
    warnSpellcheckOnce(host, 'duplicate-check')
    warnSpellcheckOnce(host, 'duplicate-check')

    const projectLocalWarns = debugLogs.filter(m =>
      m.includes(
        'a spellcheck block in project or local settings is ignored, whatever else is configured; set it in your user settings (~/.claude/settings.json) instead',
      ),
    )
    const missingEnabledWarns = debugLogs.filter(m =>
      m.includes('has no usable "enabled": true, so spell checking is off'),
    )
    const duplicateChecks = debugLogs.filter(m =>
      m.includes('[spellcheck] duplicate-check'),
    )
    expect(projectLocalWarns).toHaveLength(1)
    expect(missingEnabledWarns).toHaveLength(1)
    expect(duplicateChecks).toHaveLength(1)
    expect(resolved.enabled).toBe(false)
    expect(resolved.source).toBe('userSettings')
  })
})
