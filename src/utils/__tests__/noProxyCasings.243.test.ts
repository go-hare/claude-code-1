import { describe, expect, test } from 'bun:test'

import { getNoProxy, shouldBypassProxy } from '../proxy.js'

describe('no_proxy casings 243', () => {
  test('merges both casings when they differ (official Ne)', () => {
    expect(
      getNoProxy({
        NO_PROXY: 'localhost',
        no_proxy: 'corp.internal',
      }),
    ).toBe('corp.internal,localhost')
  })

  test('either casing * wins before merge (official S)', () => {
    expect(getNoProxy({ NO_PROXY: '*', no_proxy: 'localhost' })).toBe('*')
    expect(getNoProxy({ NO_PROXY: 'localhost', no_proxy: '*' })).toBe('*')
  })

  test('identical lists stay a single copy', () => {
    expect(getNoProxy({ NO_PROXY: 'localhost', no_proxy: 'localhost' })).toBe(
      'localhost',
    )
  })

  test('uppercase-only localhost bypasses IDE-style http://127 host via merged list', () => {
    const env = { NO_PROXY: 'localhost', no_proxy: 'example.com' }
    const list = getNoProxy(env)
    expect(shouldBypassProxy('http://localhost:12345', list)).toBe(true)
    expect(shouldBypassProxy('http://example.com', list)).toBe(true)
    expect(shouldBypassProxy('https://api.anthropic.com', list)).toBe(false)
  })

  test('uppercase-only still works when lowercase is unset', () => {
    expect(getNoProxy({ NO_PROXY: 'localhost' })).toBe('localhost')
    expect(shouldBypassProxy('http://localhost:9', 'localhost')).toBe(true)
  })
})
