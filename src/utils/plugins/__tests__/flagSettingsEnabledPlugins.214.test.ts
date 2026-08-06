/**
 * densable 2.1.214 #33 — --settings enabledPlugins install-record sync
 */
import { describe, expect, test } from 'bun:test'
import {
  isPluginForceDisabledByPolicy,
  resolveEnabledPluginScopesForInstallSync,
  shouldRunEnabledPluginsInstallSync,
} from '../flagSettingsEnabledPlugins.js'

describe('shouldRunEnabledPluginsInstallSync densable #33', () => {
  test('true when merged has plugins', () => {
    expect(shouldRunEnabledPluginsInstallSync({ 'a@mkt': true }, {}, {})).toBe(
      true,
    )
  })

  test('true when only flagSettings enables a plugin', () => {
    expect(
      shouldRunEnabledPluginsInstallSync({}, { 'only@flag': true }, {}),
    ).toBe(true)
  })

  test('false when flag has false-only entries', () => {
    expect(
      shouldRunEnabledPluginsInstallSync({}, { 'only@flag': false }, {}),
    ).toBe(false)
  })

  test('true when only policy enables', () => {
    expect(
      shouldRunEnabledPluginsInstallSync({}, {}, { 'pol@mkt': true }),
    ).toBe(true)
  })
})

describe('resolveEnabledPluginScopesForInstallSync densable Dhy', () => {
  test('flag-only true becomes user scope + flagOnly set', () => {
    const r = resolveEnabledPluginScopesForInstallSync({
      flag: { 'foo@bar': true },
      projectPath: '/proj',
    })
    expect(r.scopes.get('foo@bar')).toEqual({
      scope: 'user',
      projectPath: undefined,
    })
    expect(r.flagOnlyPluginIds.has('foo@bar')).toBe(true)
  })

  test('flag does not override existing user/project/local', () => {
    const r = resolveEnabledPluginScopesForInstallSync({
      user: { 'foo@bar': true },
      flag: { 'foo@bar': true },
      projectPath: '/proj',
    })
    expect(r.scopes.get('foo@bar')?.scope).toBe('user')
    expect(r.flagOnlyPluginIds.has('foo@bar')).toBe(false)
  })

  test('local wins over user for editable sources', () => {
    const r = resolveEnabledPluginScopesForInstallSync({
      user: { 'foo@bar': false },
      local: { 'foo@bar': true },
      projectPath: '/proj',
    })
    expect(r.scopes.get('foo@bar')).toEqual({
      scope: 'local',
      projectPath: '/proj',
    })
  })

  test('policy true becomes managed and removes flagOnly', () => {
    const r = resolveEnabledPluginScopesForInstallSync({
      flag: { 'foo@bar': true },
      policy: { 'foo@bar': true },
      projectPath: '/proj',
    })
    expect(r.scopes.get('foo@bar')?.scope).toBe('managed')
    expect(r.flagOnlyPluginIds.has('foo@bar')).toBe(false)
  })

  test('policy false blocks flag-only install record (iI)', () => {
    const r = resolveEnabledPluginScopesForInstallSync({
      flag: { 'foo@bar': true },
      policy: { 'foo@bar': false },
      projectPath: '/proj',
    })
    expect(r.scopes.has('foo@bar')).toBe(false)
    expect(r.flagOnlyPluginIds.has('foo@bar')).toBe(false)
  })

  test('flag false is ignored (only true enables)', () => {
    const r = resolveEnabledPluginScopesForInstallSync({
      flag: { 'foo@bar': false },
      projectPath: '/proj',
    })
    expect(r.scopes.has('foo@bar')).toBe(false)
  })
})

describe('isPluginForceDisabledByPolicy densable iI', () => {
  test('true when policy explicitly false', () => {
    expect(isPluginForceDisabledByPolicy('a@b', { 'a@b': false })).toBe(true)
  })
  test('false when policy true or absent', () => {
    expect(isPluginForceDisabledByPolicy('a@b', { 'a@b': true })).toBe(false)
    expect(isPluginForceDisabledByPolicy('a@b', {})).toBe(false)
  })
})
