import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearRepoCheckoutCaches,
  getBaseRefs,
  getRepoCheckoutLabelForPath,
  getRepoCheckouts,
  parseEnvPathMap,
} from '../repoCheckouts.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_REPO_CHECKOUTS
  delete process.env.CLAUDE_CODE_BASE_REFS
  clearRepoCheckoutCaches()
})

describe('parseEnvPathMap (official hSc)', () => {
  test('parses JSON object', () => {
    const m = parseEnvPathMap('{"app":"/tmp/a","lib":"/tmp/b"}')
    expect(m.get('app')).toBe('/tmp/a')
    expect(m.get('lib')).toBe('/tmp/b')
  })
  test('empty / invalid', () => {
    expect(parseEnvPathMap(undefined).size).toBe(0)
    expect(parseEnvPathMap('not-json').size).toBe(0)
  })
})

describe('getRepoCheckouts (official Dxi)', () => {
  test('defaults to empty label → cwd', () => {
    const m = getRepoCheckouts({}, '/work')
    expect(m.get('')).toBe('/work')
  })
  test('uses env map', () => {
    clearRepoCheckoutCaches()
    const m = getRepoCheckouts(
      { CLAUDE_CODE_REPO_CHECKOUTS: '{"main":"/repos/main"}' },
      '/work',
    )
    expect(m.get('main')).toBe('/repos/main')
    expect(m.has('')).toBe(false)
  })
})

describe('getRepoCheckoutLabelForPath (official ySc)', () => {
  test('prefix match', () => {
    const m = new Map([
      ['a', '/repos/a'],
      ['b', '/repos/b'],
    ])
    expect(getRepoCheckoutLabelForPath('/repos/a/src/x.ts', m)).toBe('a')
    expect(getRepoCheckoutLabelForPath('/repos/b', m)).toBe('b')
    expect(getRepoCheckoutLabelForPath('/other', m)).toBeUndefined()
  })
})

describe('getBaseRefs', () => {
  test('parses BASE_REFS', () => {
    clearRepoCheckoutCaches()
    const m = getBaseRefs({ CLAUDE_CODE_BASE_REFS: '{"main":"origin/main"}' })
    expect(m.get('main')).toBe('origin/main')
  })
})
