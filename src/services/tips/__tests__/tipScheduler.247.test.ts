import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realHistory from 'src/services/tips/tipHistory.js'
import type { Tip } from '../types.js'

const historySnap = snapshotModuleExports(realHistory)
const sessions: Record<string, number> = {}

function historyMock() {
  return {
    ...historySnap,
    getSessionsSinceLastShown: (id: string) =>
      Object.hasOwn(sessions, id) ? sessions[id]! : Number.POSITIVE_INFINITY,
  }
}

mock.module('src/services/tips/tipHistory.ts', historyMock)
mock.module('src/services/tips/tipHistory.js', historyMock)

afterAll(() => {
  mock.module('src/services/tips/tipHistory.ts', () => ({ ...historySnap }))
  mock.module('src/services/tips/tipHistory.js', () => ({ ...historySnap }))
})

import { spinnerTipHostFromContext } from '../tipRegistry.js'
import {
  evaluateTipContent,
  selectMarketplaceDeclaredPluginTip,
  selectTipWithLongestTimeSinceShown,
} from '../tipScheduler.js'

afterEach(() => {
  for (const key of Object.keys(sessions)) delete sessions[key]
})

function tip(id: string, priority?: number): Tip {
  return {
    id,
    content: async () => id,
    cooldownSessions: 0,
    isRelevant: async () => true,
    ...(priority !== undefined ? { priority } : {}),
  }
}

describe('densable 2.1.247 #2 qhe pick', () => {
  test('empty and single skip sort', () => {
    expect(selectTipWithLongestTimeSinceShown([])).toBeUndefined()
    const only = tip('only', 0)
    expect(selectTipWithLongestTimeSinceShown([only])).toBe(only)
  })

  test('longer sessions beat higher priority', () => {
    sessions.old = 8
    sessions.hot = 1
    const old = tip('old', 0)
    const hot = tip('hot', 10)
    expect(selectTipWithLongestTimeSinceShown([hot, old])?.id).toBe('old')
  })

  test('equal sessions tie-break by priority desc; missing is 0', () => {
    sessions.a = 3
    sessions.b = 3
    sessions.c = 3
    const a = tip('a')
    const b = tip('b', 2)
    const c = tip('c', -1)
    expect(selectTipWithLongestTimeSinceShown([a, c, b])?.id).toBe('b')
  })

  test('never-shown Infinity ties use priority, not a special never-shown branch', () => {
    const low = tip('low', 1)
    const high = tip('high', 4)
    expect(selectTipWithLongestTimeSinceShown([low, high])?.id).toBe('high')
  })

  test('Vhe is Whe → qhe; no FORCE_TIP / getForceTipId on this path', () => {
    const src = readFileSync(
      join(import.meta.dir, '../tipScheduler.ts'),
      'utf8',
    )
    const vhe = src.slice(
      src.indexOf('export async function getTipToShowOnSpinner'),
    )
    expect(vhe).toContain('await getRelevantTips(context)')
    expect(vhe).toContain('selectTipWithLongestTimeSinceShown(tips)')
    expect(vhe).not.toContain('getForceTipId')
    expect(vhe).not.toContain('CLAUDE_CODE_FORCE_TIP_ID')
  })

  test('Xt failedTipIds are per session.host', () => {
    const ctxA = { session: { host: {} } }
    const ctxB = { session: { host: {} } }
    spinnerTipHostFromContext(ctxA).failedTipIds.add('x')
    expect(spinnerTipHostFromContext(ctxA).failedTipIds.has('x')).toBe(true)
    expect(spinnerTipHostFromContext(ctxB).failedTipIds.has('x')).toBe(false)
  })

  test('Ghe content throw records failedTipIds and returns empty', async () => {
    const ctx = { session: { host: {} } }
    const boom = tip('boom')
    boom.content = async () => {
      throw new Error('nope')
    }
    expect(await evaluateTipContent(boom, ctx)).toBe('')
    expect(spinnerTipHostFromContext(ctx).failedTipIds.has('boom')).toBe(true)
  })

  test('Ghe success returns content and does not mark failed', async () => {
    const ctx = { session: { host: {} } }
    expect(await evaluateTipContent(tip('ok'), ctx)).toBe('ok')
    expect(spinnerTipHostFromContext(ctx).failedTipIds.has('ok')).toBe(false)
  })

  test('Xt marketplace tips set pluginId; Qhe skips missing pluginId and max>=2', () => {
    const tips = readFileSync(
      join(import.meta.dir, '../marketplacePluginTips.ts'),
      'utf8',
    )
    expect(tips).toContain('pluginId: `${plugin.name}@${marketplaceName}`')
    const scheduler = readFileSync(
      join(import.meta.dir, '../tipScheduler.ts'),
      'utf8',
    )
    const qhe = scheduler.slice(
      scheduler.indexOf(
        'export async function selectMarketplaceDeclaredPluginTip',
      ),
    )
    expect(qhe).toContain('if (!tip.pluginId) continue')
    expect(qhe).toContain('getPluginSuggestionShownCount(tip.pluginId)')
    expect(qhe).toContain('MARKETPLACE_PLUGIN_TIP_COUNT_CAP')
    expect(scheduler).toContain('tengu_dead_probe_legacy_plugin_tip_counts')
    const vhe = scheduler.slice(
      scheduler.indexOf('export async function getTipToShowOnSpinner'),
    )
    expect(vhe).not.toContain('pluginId')
    expect(vhe).toContain('selectTipWithLongestTimeSinceShown(tips)')
    expect(typeof selectMarketplaceDeclaredPluginTip).toBe('function')
  })
})
