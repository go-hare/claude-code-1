/**
 * densable 2.1.283 leftover gold `Rt` @202303237 wrap.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SERVED_ASK_DEFAULT_MAX_MS,
  SERVED_ASK_INFLIGHT_CAP,
  SERVED_ASK_RECENT_CAP,
  createServedAskLimiter,
  servedHostMaxAskMs,
} from '../servedAskLimiter.js'

const src = readFileSync(
  join(import.meta.dir, '../servedAskLimiter.ts'),
  'utf8',
)

describe('servedAskLimiter 283 leftover gold Rt wrap', () => {
  test('source-locks gold Rt; no minify public API; no WS', () => {
    expect(src).toContain('gold `Rt` @202303237')
    expect(src).toContain('x.servedHost()?.limits.max_ask_ms')
    expect(src).toContain('KMe.max_ask_ms')
    expect(src).not.toMatch(/^export (async )?function Rt\b/m)
    expect(src).not.toContain('new WebSocket')
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('wss://bridge.claudeusercontent.com')
  })

  test('servedHostMaxAskMs reads host.limits.max_ask_ms', () => {
    expect(servedHostMaxAskMs()).toBeUndefined()
    expect(servedHostMaxAskMs({})).toBeUndefined()
    expect(servedHostMaxAskMs({ limits: {} })).toBeUndefined()
    expect(servedHostMaxAskMs({ limits: { max_ask_ms: 45_000 } })).toBe(45_000)
  })

  test('gold xn/Un/KMe caps', () => {
    expect(SERVED_ASK_RECENT_CAP).toBe(20)
    expect(SERVED_ASK_INFLIGHT_CAP).toBe(64)
    expect(SERVED_ASK_DEFAULT_MAX_MS).toBe(120_000)
  })

  test('Rt bag: asked lapses_at, workerGone drops asked, clear, report', () => {
    let now = 1_000
    let changed = 0
    const limiter = createServedAskLimiter({
      now: () => now,
      maxAskMs: () => servedHostMaxAskMs({ limits: { max_ask_ms: 5_000 } }),
      onChanged: () => {
        changed += 1
      },
    })
    expect(limiter.report()).toBeUndefined()
    limiter.noteRunning('c1', 'Bash')
    expect(limiter.inflight.get('c1')?.state).toBe('running')
    limiter.noteAsked('c1', 'Bash', 'ask-1')
    expect(limiter.inflight.get('c1')).toEqual({
      call_id: 'c1',
      tool: 'Bash',
      state: 'asked',
      since: 1_000,
      ask_id: 'ask-1',
      lapses_at: 6_000,
    })
    limiter.noteRunning('c2', 'Read')
    limiter.workerGone()
    expect(limiter.inflight.has('c1')).toBe(false)
    expect(limiter.inflight.get('c2')?.state).toBe('running')
    limiter.noteEnded('c2', 'Read', 'completed')
    const report = limiter.report()
    expect(report?.live).toEqual([])
    expect(report?.recent).toEqual([
      { call_id: 'c2', tool: 'Read', ended: 'completed', at: 1_000 },
    ])
    limiter.noteRunning('c3')
    limiter.clear()
    expect(limiter.inflight.size).toBe(0)
    expect(changed).toBeGreaterThan(0)
    now = 2_000
    const fallback = createServedAskLimiter({ now: () => now })
    fallback.noteAsked('c4')
    expect(fallback.inflight.get('c4')?.lapses_at).toBe(
      2_000 + SERVED_ASK_DEFAULT_MAX_MS,
    )
  })
})
