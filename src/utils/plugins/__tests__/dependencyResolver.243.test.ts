import { afterEach, describe, expect, test } from 'bun:test'
import type { LoadedPlugin } from '../../../types/plugin.js'
import { verifyAndDemote, qualifyDependency } from '../dependencyResolver.js'

function plugin(
  name: string,
  source: string,
  deps?: string[],
  enabled = true,
): LoadedPlugin {
  return {
    name,
    source,
    repository: source,
    path: `/tmp/${name}`,
    enabled,
    manifest: {
      name,
      ...(deps ? { dependencies: deps } : {}),
    },
  } as LoadedPlugin
}

describe('densable 2.1.243 #27 inline marketplace deps', () => {
  test('qualifyDependency leaves bare deps unchanged for @inline declarer', () => {
    expect(qualifyDependency('dep-b', 'plugin-a@inline')).toBe('dep-b')
  })

  test('verifyAndDemote: @inline + dep with marketplace matches enabled B@inline', () => {
    const plugins = [
      plugin('plugin-a', 'plugin-a@inline', ['dep-b@some-marketplace']),
      plugin('dep-b', 'dep-b@inline', undefined),
    ]
    const { demoted, errors } = verifyAndDemote(plugins)
    expect(demoted.size).toBe(0)
    expect(errors).toHaveLength(0)
  })

  test('verifyAndDemote: @inline + marketplace dep fails when name absent', () => {
    const plugins = [
      plugin('plugin-a', 'plugin-a@inline', ['missing@some-marketplace']),
      plugin('other', 'other@inline'),
    ]
    const { demoted, errors } = verifyAndDemote(plugins)
    expect(demoted.has('plugin-a@inline')).toBe(true)
    expect(errors[0]?.type).toBe('dependency-unsatisfied')
  })

  test('non-inline declarer still requires exact marketplace match', () => {
    const plugins = [
      plugin('plugin-a', 'plugin-a@shop', ['dep-b@other-mkt']),
      plugin('dep-b', 'dep-b@inline'),
    ]
    const { demoted } = verifyAndDemote(plugins)
    expect(demoted.has('plugin-a@shop')).toBe(true)
  })
})
