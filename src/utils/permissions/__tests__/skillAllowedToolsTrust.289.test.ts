import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realBootstrap from '../../../bootstrap/state.js'
import * as realConcurrent from '../../concurrentSessions.js'
import * as realPermissionsLoader from '../permissionsLoader.js'
import {
  analyticsMock,
  restoreAnalyticsMock,
} from '../../../../tests/mocks/analytics.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

let managedOnly = false

const bootstrapSnap = snapshotModuleExports(realBootstrap)
const concurrentSnap = snapshotModuleExports(realConcurrent)
const loaderSnap = snapshotModuleExports(realPermissionsLoader)

mock.module('../permissionsLoader.js', () => ({
  ...loaderSnap,
  shouldAllowManagedPermissionRulesOnly: () => managedOnly,
}))
mock.module('src/utils/permissions/permissionsLoader.js', () => ({
  ...loaderSnap,
  shouldAllowManagedPermissionRulesOnly: () => managedOnly,
}))

mock.module('src/bootstrap/state.js', () => ({
  ...bootstrapSnap,
  getPrintOutputFormat: () => null,
}))
mock.module('../../../bootstrap/state.js', () => ({
  ...bootstrapSnap,
  getPrintOutputFormat: () => null,
}))

mock.module('src/utils/concurrentSessions.js', () => ({
  ...concurrentSnap,
  isBgSession: () => false,
}))
mock.module('../../concurrentSessions.js', () => ({
  ...concurrentSnap,
  isBgSession: () => false,
}))

mock.module('src/services/analytics/index.js', analyticsMock)
mock.module('../../../services/analytics/index.js', analyticsMock)

afterAll(() => {
  mock.module('../permissionsLoader.js', () => ({ ...loaderSnap }))
  mock.module('src/utils/permissions/permissionsLoader.js', () => ({
    ...loaderSnap,
  }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('../../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/utils/concurrentSessions.js', () => ({ ...concurrentSnap }))
  mock.module('../../concurrentSessions.js', () => ({ ...concurrentSnap }))
  mock.module('src/services/analytics/index.js', restoreAnalyticsMock)
  mock.module('../../../services/analytics/index.js', restoreAnalyticsMock)
})

const {
  isSkillAllowedToolsTrusted,
  resolveTrustedSkillAllowedTools,
  resetSkillAllowedToolsWithheldForTests,
} = await import('../skillAllowedToolsTrust.js')

describe('densable 2.1.289 ije / wSn allowed-tools trust', () => {
  afterEach(() => {
    managedOnly = false
    resetSkillAllowedToolsWithheldForTests()
  })

  test('managed-rules-only off trusts every source (wSn !Zh)', () => {
    managedOnly = false
    expect(isSkillAllowedToolsTrusted('userSettings')).toBe(true)
    expect(isSkillAllowedToolsTrusted('plugin')).toBe(true)
  })

  test('managed-rules-only on: bundled trusted, userSettings emptied', async () => {
    managedOnly = true
    expect(isSkillAllowedToolsTrusted('bundled')).toBe(true)
    expect(isSkillAllowedToolsTrusted('builtin')).toBe(true)
    expect(isSkillAllowedToolsTrusted('userSettings')).toBe(false)
    const emptied = await resolveTrustedSkillAllowedTools({
      name: 'demo',
      source: 'userSettings',
      allowedTools: ['Bash'],
    })
    expect(emptied).toEqual([])
  })

  test('empty allowedTools stay empty without withhold', async () => {
    managedOnly = true
    expect(
      await resolveTrustedSkillAllowedTools({
        name: 'demo',
        source: 'userSettings',
        allowedTools: [],
      }),
    ).toEqual([])
  })

  test('unique English lock', async () => {
    const { readFileSync } = await import('fs')
    const src = readFileSync(
      new URL('../skillAllowedToolsTrust.ts', import.meta.url),
      'utf-8',
    )
    expect(src).toContain(
      'permission rules are restricted to managed settings (allowManagedPermissionRulesOnly)',
    )
    expect(src).toContain(
      'Ask an admin to add the rules it needs to managed settings.',
    )
    expect(src).toContain('tengu_frontmatter_grant_withheld')
    expect(src).toContain('Ignoring allowed-tools')
  })
})
