import { describe, expect, test } from 'bun:test'
import {
  isNeedsAttentionItem,
  orderUnifiedInstalledItems,
} from '../managePluginsSections.js'
import type { UnifiedInstalledItem } from '../unifiedTypes.js'

function plugin(
  id: string,
  opts: { isEnabled?: boolean; errorCount?: number } = {},
): UnifiedInstalledItem {
  return {
    type: 'plugin',
    id,
    name: id.split('@')[0]!,
    description: undefined,
    marketplace: id.split('@')[1] ?? 'm',
    scope: 'user',
    isEnabled: opts.isEnabled ?? true,
    errorCount: opts.errorCount ?? 0,
    errors: [],
    plugin: {} as never,
  }
}

function failed(id: string): UnifiedInstalledItem {
  return {
    type: 'failed-plugin',
    id,
    name: id,
    marketplace: 'm',
    scope: 'user',
    errorCount: 1,
    errors: [],
  }
}

function mcp(
  id: string,
  status: 'connected' | 'failed' | 'needs-auth' | 'disabled',
): UnifiedInstalledItem {
  return {
    type: 'mcp',
    id,
    name: id,
    description: undefined,
    scope: 'user',
    status,
    client: {} as never,
  }
}

describe('managePluginsSections densable MBp/NQ_', () => {
  test('isNeedsAttentionItem matches densable NQ_', () => {
    expect(
      isNeedsAttentionItem(plugin('a@m', { isEnabled: true, errorCount: 2 })),
    ).toBe(true)
    expect(
      isNeedsAttentionItem(plugin('a@m', { isEnabled: true, errorCount: 0 })),
    ).toBe(false)
    expect(
      isNeedsAttentionItem(plugin('a@m', { isEnabled: false, errorCount: 3 })),
    ).toBe(false)
    expect(isNeedsAttentionItem(failed('f@m'))).toBe(true)
    expect(isNeedsAttentionItem(mcp('s', 'failed'))).toBe(true)
    expect(isNeedsAttentionItem(mcp('s', 'needs-auth'))).toBe(true)
    expect(isNeedsAttentionItem(mcp('s', 'connected'))).toBe(false)
    expect(isNeedsAttentionItem(mcp('s', 'disabled'))).toBe(false)
  })

  test('order: attention → favorites → disused → rest', () => {
    const items = [
      plugin('ok@m'),
      plugin('fav@m'),
      plugin('old@m'),
      plugin('err@m', { errorCount: 1 }),
      failed('bad@m'),
      mcp('auth', 'needs-auth'),
    ]
    const ordered = orderUnifiedInstalledItems(items, {
      searchQuery: '',
      favoriteIds: new Set(['fav@m', 'err@m']), // err is attention-first, not fav
      disusedDays: new Map([
        ['old@m', 20],
        ['fav@m', 30], // favorite wins over disused
      ]),
    })
    expect(ordered.map(i => i.id)).toEqual([
      'err@m',
      'bad@m',
      'auth',
      'fav@m',
      'old@m',
      'ok@m',
    ])
  })

  test('searchQuery skips section reordering', () => {
    const items = [plugin('ok@m'), failed('bad@m')]
    const ordered = orderUnifiedInstalledItems(items, {
      searchQuery: 'x',
      favoriteIds: new Set(),
      disusedDays: new Map(),
    })
    expect(ordered.map(i => i.id)).toEqual(['ok@m', 'bad@m'])
  })
})
