/**
 * densable 2.1.239 Axc pump contract locks (Project C Phase-1).
 * Gold: docs/upstream-extraction/v2.1.239/snippets/gold-project-c-axc-callgraph.md
 */
import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'stream'
import { Axc } from '../axc.js'
import {
  NATIVE_HISTORY_BOTTOM_CHROME,
  NATIVE_HISTORY_CAP,
  NATIVE_HISTORY_PUMP_BATCH,
  NativeHistoryPump,
} from '../nativeHistoryPump.js'

describe('Axc constants (239 SEA)', () => {
  test('q$0 / uyn / dyn lock', () => {
    expect(NATIVE_HISTORY_PUMP_BATCH).toBe(100)
    expect(NATIVE_HISTORY_CAP).toBe(10_000)
    expect(NATIVE_HISTORY_BOTTOM_CHROME).toBe(4)
  })
})

describe('NativeHistoryPump.handleResize', () => {
  test('same dims → noop; does not arm pump', () => {
    const p = new NativeHistoryPump(80, 24)
    p.nativeHistory.push('a')
    expect(p.handleResize(80, 24)).toBe('noop')
    expect(p.pumpCursor).toBe(-1)
    expect(p.replayPending).toBe(false)
  })

  test('width change → replay and arm cursor at 0 when history non-empty', () => {
    const p = new NativeHistoryPump(80, 24)
    p.nativeHistory.push('a', 'b')
    expect(p.handleResize(100, 24)).toBe('replay')
    expect(p.cols).toBe(100)
    expect(p.contentHeight).toBe(Math.max(2, 24 - 4))
    expect(p.replayPending).toBe(true)
    expect(p.pumpCursor).toBe(0)
  })

  test('height shrink → replay; empty history → pumpCursor -1', () => {
    const p = new NativeHistoryPump(80, 40)
    expect(p.handleResize(80, 20)).toBe('replay')
    expect(p.pumpCursor).toBe(-1)
    expect(p.replayPending).toBe(true)
  })

  test('height grow only → adjust; no pump arm', () => {
    const p = new NativeHistoryPump(80, 20)
    p.nativeHistory.push('x')
    expect(p.handleResize(80, 40)).toBe('adjust')
    expect(p.pumpCursor).toBe(-1)
    expect(p.replayPending).toBe(false)
    expect(p.contentHeight).toBe(Math.max(2, 40 - 4))
  })

  test('suspended resize → noop but stores dims', () => {
    const p = new NativeHistoryPump(80, 24)
    p.suspend()
    expect(p.handleResize(120, 30)).toBe('noop')
    expect(p.cols).toBe(120)
    expect(p.rows).toBe(30)
    expect(p.pumpCursor).toBe(-1)
  })
})

describe('NativeHistoryPump.resume', () => {
  test('size change vs suspend snapshot arms replay', () => {
    const p = new NativeHistoryPump(80, 24)
    p.nativeHistory.push('h')
    p.suspend()
    p.resume(100, 24)
    expect(p.suspended).toBe(false)
    expect(p.replayPending).toBe(true)
    expect(p.pumpCursor).toBe(0)
  })

  test('same size as suspend snapshot does not arm', () => {
    const p = new NativeHistoryPump(80, 24)
    p.nativeHistory.push('h')
    p.suspend()
    p.resume(80, 24)
    expect(p.replayPending).toBe(false)
    expect(p.pumpCursor).toBe(-1)
  })
})

describe('NativeHistoryPump.tickPump', () => {
  test('idle cursor → false, empty batch', () => {
    const p = new NativeHistoryPump(80, 24)
    expect(p.tickPump()).toBe(false)
    expect(p.lastEmittedBatch).toEqual([])
  })

  test('batches q$0=100 and returns true until drained', () => {
    const p = new NativeHistoryPump(80, 24)
    p.nativeHistory = Array.from({ length: 250 }, (_, i) => `L${i}`)
    p.pumpCursor = 0
    expect(p.tickPump()).toBe(true)
    expect(p.lastEmittedBatch).toHaveLength(100)
    expect(p.lastEmittedBatch[0]).toBe('L0')
    expect(p.lastEmittedBatch[99]).toBe('L99')
    expect(p.pumpCursor).toBe(100)

    expect(p.tickPump()).toBe(true)
    expect(p.lastEmittedBatch).toHaveLength(100)
    expect(p.pumpCursor).toBe(200)

    expect(p.tickPump()).toBe(false)
    expect(p.lastEmittedBatch).toHaveLength(50)
    expect(p.pumpCursor).toBe(-1)
  })
})

describe('NativeHistoryPump.syncViewport pump gate', () => {
  test('early-returns while pumping — history unchanged', () => {
    const p = new NativeHistoryPump(80, 24)
    p.onScreen = ['a', 'b', 'c']
    p.committedTop = 0
    p.pumpCursor = 0
    p.nativeHistory = ['old']
    p.syncViewport(
      { lines: [], scrollTop: 3, scrollHeight: 10, transcriptEnd: 3 },
      p.contentHeight,
    )
    expect(p.nativeHistory).toEqual(['old'])
    expect(p.onScreen).toEqual(['a', 'b', 'c'])
    expect(p.committedTop).toBe(0)
  })

  test('when not pumping, scroll-out pushes onScreen into history under uyn', () => {
    const p = new NativeHistoryPump(80, 24)
    p.onScreen = ['a', 'b', 'c']
    p.committedTop = 0
    p.syncViewport(
      { lines: [], scrollTop: 2, scrollHeight: 10, transcriptEnd: 2 },
      p.contentHeight,
    )
    expect(p.nativeHistory).toEqual(['a', 'b'])
    expect(p.onScreen).toEqual(['c'])
    expect(p.committedTop).toBe(2)
  })
})

describe('NativeHistoryPump.primeBackfill', () => {
  test('arms pumpCursor at pre-append length; caps at uyn', () => {
    const p = new NativeHistoryPump(80, 24)
    p.nativeHistory = Array.from({ length: NATIVE_HISTORY_CAP - 2 }, (_, i) =>
      String(i),
    )
    p.primeBackfill(['x', 'y', 'z', 'w'])
    expect(p.nativeHistory).toHaveLength(NATIVE_HISTORY_CAP)
    expect(p.nativeHistory.at(-1)).toBe('w')
    expect(p.replayPending).toBe(true)
    // before=CAP-2; overflow=2; cursor=max(0, CAP-2-2)=CAP-4
    expect(p.pumpCursor).toBe(NATIVE_HISTORY_CAP - 4)
  })
})

describe('Axc vs NativeHistoryPump state (no dual-impl drift)', () => {
  test('primeBackfill arms the same cursor and cap', () => {
    const pump = new NativeHistoryPump(80, 24)
    const axc = new Axc(new PassThrough(), 80, 24)
    const seed = Array.from({ length: NATIVE_HISTORY_CAP - 2 }, (_, i) =>
      String(i),
    )
    pump.nativeHistory = [...seed]
    axc.nativeHistory = [...seed]
    const add = ['x', 'y', 'z', 'w']
    pump.primeBackfill(add)
    axc.primeBackfill(add)
    expect(axc.nativeHistory).toEqual(pump.nativeHistory)
    expect(axc.pumpCursor).toBe(pump.pumpCursor)
    expect(axc.replayPending).toBe(pump.replayPending)
  })

  test('switchTranscript state matches pump (Axc also writes CSI)', () => {
    const pump = new NativeHistoryPump(80, 24)
    const axc = new Axc(new PassThrough(), 80, 24)
    pump.nativeHistory.push('a')
    axc.nativeHistory.push('a')
    pump.pumpCursor = 0
    axc.pumpCursor = 0
    pump.switchTranscript()
    axc.switchTranscript()
    expect(axc.nativeHistory).toEqual(pump.nativeHistory)
    expect(axc.pumpCursor).toBe(pump.pumpCursor)
    expect(axc.replayPending).toBe(pump.replayPending)
  })
})

describe('NativeHistoryPump.computeLayout', () => {
  test('reserves max(dyn, bottom.length)', () => {
    const p = new NativeHistoryPump(80, 24)
    const short = p.computeLayout(['a'], [])
    expect(short.contentHeight).toBe(20) // 24 - 4
    expect(short.bottomTop).toBe(20)
    const tall = p.computeLayout(['a', 'b', 'c', 'd', 'e', 'f'], [])
    expect(tall.contentHeight).toBe(18) // 24 - 6
    expect(tall.bottomTop).toBe(18)
  })
})
