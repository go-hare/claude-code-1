import { describe, expect, test } from 'bun:test'
import {
  STREAM_FLAG_DISPLAYED,
  STREAM_FLAG_HIDE_TRAILING,
  STREAM_FLAG_RAW,
  STREAM_FLAG_SALVAGE,
  STREAMING_TEXT_MAX_CHARS,
  SALVAGE_SOFT_JOIN_WINDOW,
  appendStreamingTextDelta,
  createStreamingDisplayStore,
  createStreamingTextFlushBuffer,
  mergeSalvagePrefix,
  resolveStreamingDisplay,
  salvageJoinBase,
} from '../streamingTextStore.js'

describe('appendStreamingTextDelta densable MLp', () => {
  test('appends until max chars', () => {
    expect(appendStreamingTextDelta(null, 'ab')).toBe('ab')
    expect(appendStreamingTextDelta('ab', 'cd')).toBe('abcd')
  })

  test('caps at STREAMING_TEXT_MAX_CHARS', () => {
    const almost = 'x'.repeat(STREAMING_TEXT_MAX_CHARS - 2)
    const next = appendStreamingTextDelta(almost, 'abcdef')
    expect(next.length).toBe(STREAMING_TEXT_MAX_CHARS)
    expect(next.endsWith('ab')).toBe(true)
  })
})

describe('resolveStreamingDisplay densable Qci', () => {
  test('raw path: displayed=raw, hideTrailingLine when no transformed', () => {
    const r = resolveStreamingDisplay({
      raw: 'hello\npartial',
      transformed: null,
      salvage: null,
      exact: false,
    })
    expect(r.displayed).toBe('hello\npartial')
    expect(r.hideTrailingLine).toBe(true)
    expect(r.displayedHasNewline).toBe(true)
  })

  test('transformed wins; hideTrailingLine false', () => {
    const r = resolveStreamingDisplay({
      raw: 'raw',
      transformed: 'xform',
      salvage: null,
      exact: false,
    })
    expect(r.displayed).toBe('xform')
    expect(r.hideTrailingLine).toBe(false)
  })

  test('whitespace-only displayed collapses to null (no lone ● / DISPLAYED)', () => {
    const r = resolveStreamingDisplay({
      raw: '   \n  ',
      transformed: null,
      salvage: null,
      exact: false,
    })
    expect(r.displayed).toBe(null)
    const store = createStreamingDisplayStore()
    store.setRaw('  \n')
    expect(store.getFlags() & STREAM_FLAG_DISPLAYED).toBe(0)
    // raw still present for hideTrailing bookkeeping
    expect(store.getFlags() & STREAM_FLAG_RAW).toBe(STREAM_FLAG_RAW)
  })
})

describe('StreamingTextFlushBuffer densable UNf', () => {
  test('clear flushes null immediately', () => {
    const flushed: Array<string | null> = []
    const buf = createStreamingTextFlushBuffer({
      scheduleTimeout: () => () => {},
      onFlush: v => {
        flushed.push(v)
      },
      flushIntervalMs: 1000,
    })
    buf.apply(() => 'hello')
    buf.clear()
    expect(buf.peek()).toBe(null)
    expect(flushed.at(-1)).toBe(null)
  })

  test('apply schedules flush of pending', () => {
    const flushed: Array<string | null> = []
    const fires: Array<() => void> = []
    const buf = createStreamingTextFlushBuffer({
      scheduleTimeout: fn => {
        fires.push(fn)
        return () => {
          /* no-op cancel for test */
        }
      },
      onFlush: v => {
        flushed.push(v)
      },
      flushIntervalMs: 50,
    })
    buf.apply(() => 'a')
    buf.apply(c => (c ?? '') + 'b')
    expect(buf.peek()).toBe('ab')
    expect(flushed).toEqual([])
    expect(fires.length).toBe(1)
    fires[0]!()
    expect(flushed).toEqual(['ab'])
  })
})

describe('createStreamingDisplayStore densable WNf', () => {
  test('setRaw updates flags and notifies', () => {
    const store = createStreamingDisplayStore()
    let ticks = 0
    store.subscribe(() => {
      ticks++
    })
    expect(store.getFlags() & STREAM_FLAG_DISPLAYED).toBe(0)
    store.setRaw('hi')
    expect(store.getFlags() & STREAM_FLAG_RAW).toBe(STREAM_FLAG_RAW)
    expect(store.getFlags() & STREAM_FLAG_DISPLAYED).toBe(STREAM_FLAG_DISPLAYED)
    expect(ticks).toBe(1)
    store.setRaw(null)
    expect(store.getFlags() & STREAM_FLAG_DISPLAYED).toBe(0)
  })

  test('B2a STREAM_FLAG_HIDE_TRAILING when raw single-line (no transformed)', () => {
    // densable getFlags: (n!==null && hideTrailing && !hasNewline) ? B2a : 0
    const store = createStreamingDisplayStore()
    store.setRaw('partial line')
    expect(store.getFlags() & STREAM_FLAG_HIDE_TRAILING).toBe(
      STREAM_FLAG_HIDE_TRAILING,
    )
    store.setRaw('line with\nnewline')
    expect(store.getFlags() & STREAM_FLAG_HIDE_TRAILING).toBe(0)
    store.setRaw('still single')
    store.setTransformed('xform')
    // transformed → hideTrailing false → no B2a
    expect(store.getFlags() & STREAM_FLAG_HIDE_TRAILING).toBe(0)
  })

  test('densable: salvage survives setRaw(null) / pH.clear (not desync bug)', () => {
    // densable Qci + cX: clear raw only; salvage-only displayed keeps U2a + j2a.
    // setSalvage(null) is land/esc/refusal-end/!Ln — never pH.clear.
    const store = createStreamingDisplayStore()
    store.setRaw('partial')
    store.setSalvage('kept salvage text', true)
    expect(store.getFlags() & STREAM_FLAG_SALVAGE).toBe(STREAM_FLAG_SALVAGE)

    store.setRaw(null)
    store.setTransformed(null)

    expect(store.getState().salvage).toBe('kept salvage text')
    expect(store.getFlags() & STREAM_FLAG_SALVAGE).toBe(STREAM_FLAG_SALVAGE)
    expect(store.getFlags() & STREAM_FLAG_DISPLAYED).toBe(STREAM_FLAG_DISPLAYED)

    const resolved = resolveStreamingDisplay(store.getState())
    expect(resolved.displayed).toBe('kept salvage text')
    // raw null → hideTrailingLine false (densable: n===null && !!r)
    expect(resolved.hideTrailingLine).toBe(false)
  })

  test('densable: clear path does not imply setSalvage(null)', () => {
    const bufFlushed: Array<string | null> = []
    const store = createStreamingDisplayStore()
    const buf = createStreamingTextFlushBuffer({
      scheduleTimeout: () => () => {},
      onFlush: v => {
        bufFlushed.push(v)
        store.setRaw(v)
      },
    })
    store.setSalvage('prefix', false)
    store.setRaw('live')
    // densable cX-shaped clear: buffer clear + optional setTransformed; no salvage
    buf.clear()
    store.setTransformed(null)
    expect(bufFlushed.at(-1)).toBe(null)
    expect(store.getState().raw).toBe(null)
    expect(store.getState().salvage).toBe('prefix')
    expect(store.getFlags() & STREAM_FLAG_SALVAGE).toBe(STREAM_FLAG_SALVAGE)
  })
})

describe('salvageJoinBase densable yUp', () => {
  test('returns full prefix when within aUp window', () => {
    expect(salvageJoinBase('short')).toBe('short')
  })

  test('takes last aUp chars and drops leading low-surrogate', () => {
    // Build prefix longer than window ending with high+low pair straddling cut
    const high = String.fromCharCode(0xd83d) // high surrogate
    const low = String.fromCharCode(0xde00) // low surrogate
    // window starts mid-pair: ...[high][low...rest]
    const rest = 'x'.repeat(SALVAGE_SOFT_JOIN_WINDOW - 1)
    const prefix = `head${high}${low}${rest}`
    // slice(-1e4) may start with low if high is just before window
    const base = salvageJoinBase(prefix)
    expect(base.length).toBeLessThanOrEqual(SALVAGE_SOFT_JOIN_WINDOW)
    // must not start with lone low surrogate
    const c0 = base.charCodeAt(0)
    expect(c0 < 0xdc00 || c0 > 0xdfff).toBe(true)
  })
})

describe('mergeSalvagePrefix densable r7o/Cjs', () => {
  test('exact join concatenates', () => {
    expect(mergeSalvagePrefix('pre', 'post', true)).toBe('prepost')
  })

  test('soft join strips overlapping yUp base from next', () => {
    const prefix = 'hello world'
    const next = `hello world more`
    // base is full prefix (<=1e4); trimStart next startsWith base → strip
    expect(mergeSalvagePrefix(prefix, next, false)).toBe('hello world more')
  })

  test('soft join keeps original next when body does not start with base', () => {
    // densable Cjs: body = trimmed.startsWith(base) ? strip : original t
    const prefix = 'alpha'
    const next = '  beta gamma'
    // original next kept (with leading spaces); no word-sep because body !/^\w/
    expect(mergeSalvagePrefix(prefix, next, false)).toBe('alpha  beta gamma')
  })

  test('soft join returns prefix when body empty after strip', () => {
    expect(mergeSalvagePrefix('only', 'only', false)).toBe('only')
  })
})
