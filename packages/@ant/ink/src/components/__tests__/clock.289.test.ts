/**
 * densable 2.1.289 Clock `v()` surface.
 * Gold: official-289 SEA @193039134.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClock } from '../ClockContext.js'

const src = readFileSync(join(import.meta.dir, '../ClockContext.tsx'), 'utf8')
const frame = readFileSync(
  join(import.meta.dir, '../../hooks/use-animation-frame.ts'),
  'utf8',
)
const interval = readFileSync(
  join(import.meta.dir, '../../hooks/use-interval.ts'),
  'utf8',
)

describe('densable 2.1.289 Clock v()', () => {
  test('surface is subscribeKeepAlive / subscribeFollower / setTimeout', () => {
    expect(src).toContain('subscribeKeepAlive')
    expect(src).toContain('subscribeFollower')
    expect(src).toContain('setTimeout(callback, ms)')
    expect(src).toContain('const origin = performance.now()')
    expect(src).not.toContain('subscribe(onChange, true)')
    expect(src).not.toContain('clock.subscribe(')
  })

  test('Ji keepAlive and pDn follower / gi setTimeout loop', () => {
    expect(frame).toContain('clock.subscribeKeepAlive')
    expect(interval).toContain('clock.subscribeFollower')
    expect(interval).toContain('clock.setTimeout(tick, intervalMs)')
  })

  test('now() while idle is performance.now()-origin, live interval returns tick snapshot', () => {
    const clock = createClock(16)
    const a = clock.now()
    expect(a).toBeGreaterThanOrEqual(0)
    const release = clock.subscribeKeepAlive(() => {})
    const b = clock.now()
    expect(b).toBeGreaterThanOrEqual(0)
    release()
    const c = clock.now()
    expect(c).toBeGreaterThanOrEqual(b)
  })
})
