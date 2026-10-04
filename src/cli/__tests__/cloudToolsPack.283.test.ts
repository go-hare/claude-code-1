/**
 * densable 2.1.283 leftover `Pt` / `Nn` / `Ne` wrap — gold log string,
 * not_bound vs not_served, announce_refused/unverified/revoked, Ne !bound → Pt.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as realDebug from '../../utils/debug.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

const debugSnap = snapshotModuleExports(realDebug)
const logMock = mock((..._args: unknown[]) => {})

mock.module('../../utils/debug.js', () => ({
  ...debugSnap,
  logForDebugging: logMock,
}))
mock.module('src/utils/debug.js', () => ({
  ...debugSnap,
  logForDebugging: logMock,
}))

afterAll(() => {
  mock.module('../../utils/debug.js', () => ({ ...debugSnap }))
  mock.module('src/utils/debug.js', () => ({ ...debugSnap }))
})

const {
  announceServingState,
  createCloudToolsPack,
  toolsFeatureOff,
} = await import('../cloudToolsPack.js')

const GOLD_LOG_PREFIX = '[servedTools] not served over the session channel:'

afterEach(() => {
  logMock.mockClear()
})

describe('densable 2.1.283 Pt / Nn / Ne cloud tools pack', () => {
  test('source locks the gold servedTools debug string', () => {
    const src = readFileSync(
      join(import.meta.dir, '../cloudToolsPack.ts'),
      'utf8',
    )
    expect(src).toContain(GOLD_LOG_PREFIX)
    expect(src).toContain('not_announced')
    expect(src).toContain('toolsAnnounceOffReason')
    expect(src).toContain(
      '`[servedTools] not served over the session channel: ${reason ?? \'not_served\'}`',
    )
    expect(src).not.toContain('function uit(')
    expect(src).not.toContain('function nI(')
    expect(src).not.toContain('openChannel')
    expect(src).not.toContain('WebSocket')
    expect(src).not.toContain('tengu_device_bridge_connected')
    expect(src).not.toContain('amati')
  })

  test('Pt logs gold string and defaults not_served / session / undefined policy', () => {
    const pack = toolsFeatureOff()
    expect(logMock).toHaveBeenCalledWith(
      '[servedTools] not served over the session channel: not_served',
    )
    expect(pack.feature).toBe('tools')
    expect(pack.report()).toEqual({
      state: 'off',
      reason: 'not_served',
      facts: {
        serving: {
          state: 'off',
          policy: undefined,
          channel: 'session',
        },
      },
    })
    expect(pack.report().facts.serving).not.toHaveProperty('reason')
  })

  test('Pt not_bound vs not_served reason (top-level vs serving facts)', () => {
    const bound = toolsFeatureOff('not_bound')
    expect(logMock).toHaveBeenCalledWith(
      '[servedTools] not served over the session channel: not_bound',
    )
    expect(bound.report()).toEqual({
      state: 'off',
      reason: 'not_bound',
      facts: {
        serving: {
          state: 'off',
          reason: 'not_bound',
          policy: undefined,
          channel: 'session',
        },
      },
    })

    logMock.mockClear()
    const other = toolsFeatureOff('channel_off')
    expect(logMock).toHaveBeenCalledWith(
      '[servedTools] not served over the session channel: channel_off',
    )
    expect(other.report().reason).toBe('not_served')
    expect(other.report().facts.serving.reason).toBe('channel_off')
  })

  test('Pt channel seam bridge_only; policy seam is passed through', () => {
    const pack = toolsFeatureOff('not_served', {
      bridgeOnly: () => true,
      servingPolicy: () => ({ mode: 'test' }),
    })
    expect(pack.report().facts.serving.channel).toBe('bridge_only')
    expect(pack.report().facts.serving.policy).toEqual({ mode: 'test' })
  })

  test('Nn pending / on / withdrawn (no reason) / refused / unverified / revoked', () => {
    expect(announceServingState({ at: 'pending' })).toEqual({ state: 'pending' })
    expect(announceServingState({ at: 'on' })).toEqual({ state: 'on' })
    expect(announceServingState({ at: 'withdrawn' })).toEqual({ state: 'off' })
    expect(announceServingState({ at: 'withdrawn' })).not.toHaveProperty(
      'reason',
    )
    expect(announceServingState({ at: 'refused' })).toEqual({
      state: 'off',
      reason: 'announce_refused',
    })
    expect(announceServingState({ at: 'unverified' })).toEqual({
      state: 'off',
      reason: 'announce_unverified',
    })
    expect(
      announceServingState({ at: 'revoked', reason: 'device_revoked' }),
    ).toEqual({ state: 'revoked', reason: 'device_revoked' })
  })

  test('Nn withdrawn reason via servingOffReason seam', () => {
    expect(
      announceServingState(
        { at: 'withdrawn' },
        { servingOffReason: () => 'serving_off' },
      ),
    ).toEqual({ state: 'off', reason: 'serving_off' })
  })

  test('Ne !bound → Pt not_bound', () => {
    const pack = createCloudToolsPack()({ bound: false })
    expect(logMock).toHaveBeenCalledWith(
      '[servedTools] not served over the session channel: not_bound',
    )
    expect(pack.feature).toBe('tools')
    expect(pack.report()).toMatchObject({
      state: 'off',
      reason: 'not_bound',
    })
  })

  test('Ne bound without servedTools → Pt(servedToolsUnavailable)', () => {
    const pack = createCloudToolsPack()({
      bound: true,
      servedToolsUnavailable: 'channel_off',
    })
    expect(logMock).toHaveBeenCalledWith(
      '[servedTools] not served over the session channel: channel_off',
    )
    expect(pack.report()).toMatchObject({
      state: 'off',
      reason: 'not_served',
      facts: { serving: { reason: 'channel_off', channel: 'session' } },
    })
  })

  test('Ne bound + servedTools defined reports pending until announce seam', () => {
    const pack = createCloudToolsPack()({
      bound: true,
      servedTools: {},
    })
    expect(logMock).not.toHaveBeenCalled()
    expect(pack.feature).toBe('tools')
    expect(pack.report()).toEqual({ state: 'pending' })
    expect(pack.report()).not.toMatchObject({ state: 'on' })
    expect(pack.report()).not.toHaveProperty('source')
  })

  test('Ne announce seam can set refused without faking connected', () => {
    const pack = createCloudToolsPack({ announceAt: { at: 'refused' } })({
      bound: true,
      servedTools: {},
    })
    expect(pack.report()).toEqual({
      state: 'off',
      reason: 'announce_refused',
    })
  })
})
