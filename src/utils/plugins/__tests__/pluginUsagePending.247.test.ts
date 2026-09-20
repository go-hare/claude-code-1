import { afterEach, describe, expect, test } from 'bun:test'
import { resetSessionHostForTests } from '../../sessionHost.js'
import {
  drainPendingPluginUsage,
  hasPendingPluginUsage,
  incrementPluginUsage,
  resetPendingPluginUsageForTests,
  wipePendingPluginUsage,
} from '../pluginUsagePending.js'

afterEach(() => {
  resetPendingPluginUsageForTests()
  resetSessionHostForTests()
})

describe('densable 2.1.247 HP/dm/sPe/yln', () => {
  test('dm increments pendingUsage then sPe drains', () => {
    incrementPluginUsage('owner/plugin')
    incrementPluginUsage('owner/plugin')
    expect(hasPendingPluginUsage('owner/plugin')).toBe(true)
    const drained = drainPendingPluginUsage()
    expect(drained).toEqual([
      ['owner/plugin', { count: 2, lastUsedAt: expect.any(Number) }],
    ])
    expect(hasPendingPluginUsage('owner/plugin')).toBe(false)
  })

  test('yln deletes matching pendingUsage keys before persist wipe', () => {
    incrementPluginUsage('Owner/Plugin')
    incrementPluginUsage('other/keep')
    wipePendingPluginUsage(new Set(['owner/plugin']))
    expect(hasPendingPluginUsage('Owner/Plugin')).toBe(false)
    expect(hasPendingPluginUsage('other/keep')).toBe(true)
  })
})
