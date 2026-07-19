/**
 * densable Ace residual #154 wire — concurrent-onquery re-enqueue path.
 * Source-shape + pure Ace gate (no full REPL mount).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isSystemVisibleOrigin } from '../../utils/messagePredicates.js'

const replPath = join(import.meta.dir, '../REPL.tsx')

/**
 * densable concurrent-onquery filter mirror (REPL.tsx onQuery body):
 * keep user msgs unless isMeta && !Ace(origin).
 */
function wouldEnqueueConcurrent(
  m: {
    type: string
    isMeta?: boolean
    origin?: { kind?: string; senderTaskId?: string } | null
    text: string | null
  },
): boolean {
  if (m.type !== 'user') return false
  if (m.isMeta && !isSystemVisibleOrigin(m.origin)) return false
  if (m.text === null) return false
  return true
}

describe('concurrent onquery densable Ace wire', () => {
  test('REPL source stamps Ace skipSlash + meta gate', () => {
    const src = readFileSync(replPath, 'utf8')
    expect(src).toContain('isSystemVisibleOrigin')
    expect(src).toContain('skipSlashCommands: isSystemVisibleOrigin(origin)')
    expect(src).toContain('if (m.isMeta && !isSystemVisibleOrigin(origin)) continue')
    expect(src).toContain("logEvent('tengu_concurrent_onquery_enqueued'")
    // concurrent path comments densable Ace gate (not the old filter-only path)
    expect(src).toContain('densable concurrent-onquery: skip isMeta unless Ace')
  })

  test('pure gate: plain user enqueues', () => {
    expect(
      wouldEnqueueConcurrent({ type: 'user', text: 'hi' }),
    ).toBe(true)
  })

  test('pure gate: meta without Ace origin drops', () => {
    expect(
      wouldEnqueueConcurrent({
        type: 'user',
        isMeta: true,
        text: 'skill expand',
      }),
    ).toBe(false)
    expect(
      wouldEnqueueConcurrent({
        type: 'user',
        isMeta: true,
        origin: { kind: 'human' },
        text: 'meta human',
      }),
    ).toBe(false)
  })

  test('pure gate: meta + channel/observer/peer(sender) enqueues', () => {
    expect(
      wouldEnqueueConcurrent({
        type: 'user',
        isMeta: true,
        origin: { kind: 'channel' },
        text: 'from channel',
      }),
    ).toBe(true)
    expect(
      wouldEnqueueConcurrent({
        type: 'user',
        isMeta: true,
        origin: { kind: 'observer' },
        text: 'obs',
      }),
    ).toBe(true)
    expect(
      wouldEnqueueConcurrent({
        type: 'user',
        isMeta: true,
        origin: { kind: 'peer', senderTaskId: 'a1' },
        text: 'peer',
      }),
    ).toBe(true)
  })

  test('pure gate: null text drops', () => {
    expect(
      wouldEnqueueConcurrent({ type: 'user', text: null }),
    ).toBe(false)
  })

  test('skipSlashCommands Ace parity for enqueue stamp', () => {
    expect(isSystemVisibleOrigin({ kind: 'channel' })).toBe(true)
    expect(isSystemVisibleOrigin({ kind: 'human' })).toBe(false)
    expect(isSystemVisibleOrigin(undefined)).toBe(false)
  })
})
