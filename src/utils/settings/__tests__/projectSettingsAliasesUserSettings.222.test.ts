import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'path'

/**
 * densable `set` / projectSettingsAliasesUserSettings pure path-equality mirror.
 * Production helper uses getSettingsFilePathForSource + path.resolve.
 */

function aliases(
  projectPath: string | undefined,
  userPath: string | undefined,
): boolean {
  return (
    !!projectPath && !!userPath && resolve(projectPath) === resolve(userPath)
  )
}

describe('densable projectSettingsAliasesUserSettings path equality', () => {
  test('true when same absolute path', () => {
    const p = join('/home/u', '.claude', 'settings.json')
    expect(aliases(p, p)).toBe(true)
  })

  test('true when relative forms resolve equal', () => {
    const base = resolve('.')
    const a = join(base, '.claude', 'settings.json')
    const b = join(base, '.', '.claude', 'settings.json')
    expect(aliases(a, b)).toBe(true)
  })

  test('false when different paths', () => {
    expect(
      aliases(
        join('/repo', '.claude', 'settings.json'),
        join('/home/u', '.claude', 'settings.json'),
      ),
    ).toBe(false)
  })

  test('false when either path missing', () => {
    expect(aliases(undefined, '/x')).toBe(false)
    expect(aliases('/x', undefined)).toBe(false)
    expect(aliases(undefined, undefined)).toBe(false)
  })
})

describe('densable getSecuritySensitiveSetting priority', () => {
  type Rc = boolean | undefined

  function securitySensitiveFirst(args: {
    policy: Rc
    flag: Rc
    user: Rc
  }): Rc {
    // densable order: policySettings → flagSettings → userSettings
    const values = [args.policy, args.flag, args.user].filter(
      (v): v is boolean => v !== undefined && v !== null,
    )
    return values[0]
  }

  test('policy first', () => {
    expect(
      securitySensitiveFirst({ policy: false, flag: true, user: true }),
    ).toBe(false)
  })

  test('flag between policy and user', () => {
    expect(
      securitySensitiveFirst({
        policy: undefined,
        flag: true,
        user: false,
      }),
    ).toBe(true)
  })

  test('user when policy/flag absent', () => {
    expect(
      securitySensitiveFirst({
        policy: undefined,
        flag: undefined,
        user: true,
      }),
    ).toBe(true)
  })

  test('undefined when all absent', () => {
    expect(
      securitySensitiveFirst({
        policy: undefined,
        flag: undefined,
        user: undefined,
      }),
    ).toBe(undefined)
  })
})
