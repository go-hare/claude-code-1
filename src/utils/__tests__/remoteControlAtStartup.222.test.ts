import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * densable 2.1.222 #20 X_t — pure precedence mirror of getRemoteControlAtStartup.
 *
 * Full config import pulls settings/getInitialSettings and is hostile to partial
 * mock.module (process-global pollution). This test encodes densable X_t exactly
 * and asserts the algorithm; the production function in config.ts is the same
 * steps (aliases → project/local false hard off; policy/flag/user/global;
 * ignore project/local true).
 */

type Rc = boolean | undefined

function x_t(args: {
  project: Rc
  local: Rc
  policy: Rc
  flag: Rc
  user: Rc
  global: Rc
  /** densable projectSettingsAliasesUserSettings — same path → project voided */
  aliasesUser?: boolean
}): { value: Rc; ignoredRepoEnable: boolean } {
  const {
    project: projectRaw,
    local,
    policy,
    flag,
    user,
    global: g,
    aliasesUser = false,
  } = args
  // densable: t = projectSettingsAliasesUserSettings() ? void 0 : project?.…
  const project = aliasesUser ? undefined : projectRaw
  // densable: if (t===!1||r===!1) return !1
  if (project === false || local === false) {
    return { value: false, ignoredRepoEnable: false }
  }
  // densable: getSecuritySensitiveSetting[0] ?? Ot().remoteControlAtStartup
  // sources: policy → flagSettings → userSettings
  const n = policy ?? flag ?? user ?? g
  const ignoredRepoEnable = n !== true && (project === true || local === true)
  return { value: n, ignoredRepoEnable }
}

function rMe(x: Rc, ccrDefault: boolean): boolean {
  if (x !== undefined) return x
  return ccrDefault
}

describe('densable 2.1.222 #20 remoteControlAtStartup X_t / rMe algorithm', () => {
  test('project false hard-disables even if user true', () => {
    const { value } = x_t({
      project: false,
      local: undefined,
      policy: undefined,
      flag: undefined,
      user: true,
      global: true,
    })
    expect(rMe(value, false)).toBe(false)
  })

  test('local false hard-disables', () => {
    const { value } = x_t({
      project: undefined,
      local: false,
      policy: undefined,
      flag: undefined,
      user: true,
      global: true,
    })
    expect(rMe(value, true)).toBe(false)
  })

  test('user true enables', () => {
    const { value, ignoredRepoEnable } = x_t({
      project: undefined,
      local: undefined,
      policy: undefined,
      flag: undefined,
      user: true,
      global: undefined,
    })
    expect(ignoredRepoEnable).toBe(false)
    expect(rMe(value, false)).toBe(true)
  })

  test('policy true enables over user false', () => {
    const { value } = x_t({
      project: undefined,
      local: undefined,
      policy: true,
      flag: undefined,
      user: false,
      global: false,
    })
    expect(rMe(value, false)).toBe(true)
  })

  test('flagSettings true enables between policy and user', () => {
    // densable: policy ?? flagSettings ?? userSettings ?? GlobalConfig
    const { value } = x_t({
      project: undefined,
      local: undefined,
      policy: undefined,
      flag: true,
      user: false,
      global: false,
    })
    expect(rMe(value, false)).toBe(true)
  })

  test('policy wins over flagSettings', () => {
    const { value } = x_t({
      project: undefined,
      local: undefined,
      policy: false,
      flag: true,
      user: true,
      global: true,
    })
    expect(rMe(value, true)).toBe(false)
  })

  test('project true alone does not enable — ignored when user not true', () => {
    const { value, ignoredRepoEnable } = x_t({
      project: true,
      local: undefined,
      policy: undefined,
      flag: undefined,
      user: undefined,
      global: undefined,
    })
    expect(ignoredRepoEnable).toBe(true)
    expect(rMe(value, false)).toBe(false)
  })

  test('local true + user false → false with ignore log path', () => {
    const { value, ignoredRepoEnable } = x_t({
      project: undefined,
      local: true,
      policy: undefined,
      flag: undefined,
      user: false,
      global: undefined,
    })
    expect(ignoredRepoEnable).toBe(true)
    expect(rMe(value, false)).toBe(false)
  })

  test('project and local both true ignored message scopes', () => {
    const { ignoredRepoEnable } = x_t({
      project: true,
      local: true,
      policy: undefined,
      flag: undefined,
      user: undefined,
      global: false,
    })
    expect(ignoredRepoEnable).toBe(true)
  })

  test('aliasesUser voids project hard-off (same path as user)', () => {
    // densable: t = projectSettingsAliasesUserSettings() ? void 0 : …
    const { value, ignoredRepoEnable } = x_t({
      project: false,
      local: undefined,
      policy: undefined,
      flag: undefined,
      user: true,
      global: undefined,
      aliasesUser: true,
    })
    expect(ignoredRepoEnable).toBe(false)
    expect(rMe(value, false)).toBe(true)
  })

  test('aliasesUser voids project true ignore path', () => {
    const { value, ignoredRepoEnable } = x_t({
      project: true,
      local: undefined,
      policy: undefined,
      flag: undefined,
      user: undefined,
      global: undefined,
      aliasesUser: true,
    })
    expect(ignoredRepoEnable).toBe(false)
    expect(rMe(value, false)).toBe(false)
  })

  test('rMe falls through to CCR default when X_t undefined', () => {
    expect(rMe(undefined, true)).toBe(true)
    expect(rMe(undefined, false)).toBe(false)
  })

  test('source file implements densable X_t / security-sensitive chain', () => {
    const text = readFileSync(join(import.meta.dir, '../config.ts'), 'utf8')
    expect(text).toContain('repo-scoped settings cannot enable Remote Control')
    expect(text).toContain("getSettingsForSource('projectSettings')")
    expect(text).toContain("getSettingsForSource('localSettings')")
    expect(text).toContain('project and local')
    expect(text).toContain('getSecuritySensitiveSetting')
    expect(text).toContain('projectSettingsAliasesUserSettings')
    expect(text).toContain(
      "getSecuritySensitiveSetting('remoteControlAtStartup')",
    )
  })
})

describe('densable projectSettingsAliasesUserSettings / getSecuritySensitiveSetting exports', () => {
  test('settings.ts exports densable helpers', () => {
    const text = readFileSync(
      join(import.meta.dir, '../settings/settings.ts'),
      'utf8',
    )
    expect(text).toContain('export function projectSettingsAliasesUserSettings')
    expect(text).toContain('export function getSecuritySensitiveSetting')
    expect(text).toContain("'policySettings'")
    expect(text).toContain("'flagSettings'")
    expect(text).toContain("'userSettings'")
    expect(text).toContain('resolve(projectPath) === resolve(userPath)')
  })
})
