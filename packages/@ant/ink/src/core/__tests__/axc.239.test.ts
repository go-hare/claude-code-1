/**
 * densable 2.1.239 Axc compositor write contract (Project C Phase-2).
 * Gold: gold-project-c-axc-methods.txt / gold-project-c-axc-callgraph.md
 */
import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'stream'
import { Axc } from '../axc.js'
import {
  NATIVE_HISTORY_BOTTOM_CHROME,
  NATIVE_HISTORY_PUMP_BATCH,
} from '../nativeHistoryPump.js'
import {
  cursorPosition,
  RESET_SCROLL_REGION,
  setScrollRegion,
} from '../termio/csi.js'
import { BSU, ESU, HIDE_CURSOR, SHOW_CURSOR } from '../termio/dec.js'

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function captureOut() {
  const chunks: string[] = []
  const out = new PassThrough()
  out.on('data', (c: Buffer | string) => {
    chunks.push(typeof c === 'string' ? c : c.toString('utf8'))
  })
  return {
    out,
    text: () => chunks.join(''),
    clear: () => {
      chunks.length = 0
    },
  }
}

describe('Axc setup / suspend / resume writes', () => {
  test('setup hides cursor and sets DECSTBM to contentHeight', () => {
    const cap = captureOut()
    const axc = new Axc(cap.out, 80, 24)
    axc.setup()
    const t = cap.text()
    expect(t).toContain(HIDE_CURSOR)
    expect(t).toContain(
      setScrollRegion(1, Math.max(2, 24 - NATIVE_HISTORY_BOTTOM_CHROME)),
    )
  })

  test('suspend writes RESET_SCROLL_REGION', () => {
    const cap = captureOut()
    const axc = new Axc(cap.out, 80, 24)
    axc.setup()
    cap.clear()
    axc.suspend()
    expect(cap.text()).toContain(RESET_SCROLL_REGION)
    expect(axc.suspended).toBe(true)
  })

  test('restore writes CSI r then CUP(contentHeight+1) then SHOW_CURSOR', () => {
    const cap = captureOut()
    const axc = new Axc(cap.out, 80, 24)
    axc.setup()
    cap.clear()
    axc.restore()
    const t = cap.text()
    const resetAt = t.indexOf(RESET_SCROLL_REGION)
    const cup = cursorPosition(axc.contentHeight + 1, 1)
    // clearLine already CUPs chrome rows (same coord as restore CUP).
    const cupAt = t.indexOf(cup, resetAt)
    const showAt = t.indexOf(SHOW_CURSOR, cupAt)
    expect(resetAt).toBeGreaterThanOrEqual(0)
    expect(cupAt).toBeGreaterThan(resetAt)
    expect(showAt).toBeGreaterThan(cupAt)
    expect(axc.restored).toBe(true)
    axc.restore()
    expect(cap.text()).toBe(t)
  })

  test('switchTranscript wipes history and writes CSI r + erase', () => {
    const cap = captureOut()
    const axc = new Axc(cap.out, 80, 24)
    axc.setup()
    axc.nativeHistory.push('old-1', 'old-2')
    axc.pumpCursor = 0
    cap.clear()
    axc.switchTranscript()
    const t = cap.text()
    expect(t).toContain(RESET_SCROLL_REGION)
    expect(axc.nativeHistory).toEqual([])
    expect(axc.pumpCursor).toBe(-1)
    expect(axc.replayPending).toBe(true)
    expect(axc.lastFrame).toBe('')
  })

  test('commitImmediate calls onWrite (Nki hook)', () => {
    const cap = captureOut()
    const writes: number[] = []
    const axc = new Axc(cap.out, 80, 24, (_ms, bytes) => writes.push(bytes))
    axc.setup()
    expect(writes.length).toBeGreaterThan(0)
    expect(writes[0]).toBeGreaterThan(0)
  })

  test('handleResize width change → replay + arm pump', () => {
    const cap = captureOut()
    const axc = new Axc(cap.out, 80, 24)
    axc.setup()
    axc.nativeHistory.push('a', 'b')
    cap.clear()
    expect(axc.handleResize(100, 24)).toBe('replay')
    expect(axc.pumpCursor).toBe(0)
    expect(axc.replayPending).toBe(true)
    expect(cap.text().length).toBeGreaterThan(0)
  })
})

describe('Axc.tickPump', () => {
  test('emits up to q$0 lines and returns true while more remain', () => {
    const cap = captureOut()
    const axc = new Axc(cap.out, 80, 24)
    axc.setup()
    for (let i = 0; i < NATIVE_HISTORY_PUMP_BATCH + 5; i++) {
      axc.nativeHistory.push(`line-${i}`)
    }
    axc.pumpCursor = 0
    cap.clear()
    expect(axc.tickPump()).toBe(true)
    expect(axc.pumpCursor).toBe(NATIVE_HISTORY_PUMP_BATCH)
    expect(cap.text()).toContain('line-0')
    expect(cap.text()).toContain(`line-${NATIVE_HISTORY_PUMP_BATCH - 1}`)
  })

  test('pumpCursor < 0 → false, no write', () => {
    const cap = captureOut()
    const axc = new Axc(cap.out, 80, 24)
    axc.setup()
    cap.clear()
    expect(axc.tickPump()).toBe(false)
    expect(cap.text()).toBe('')
  })
})

describe('Axc.syncViewport pump gate', () => {
  test('early-return while pumping (no onScreen mutate)', () => {
    const axc = new Axc(new PassThrough(), 80, 24)
    axc.setup()
    axc.onScreen.push('x', 'y')
    axc.committedTop = 0
    axc.pumpCursor = 0
    axc.syncViewport(
      { lines: ['a'], scrollTop: 2, scrollHeight: 10, transcriptEnd: 10 },
      20,
    )
    expect(axc.onScreen).toEqual(['x', 'y'])
    expect(axc.committedTop).toBe(0)
  })
})

describe('Axc.draw unchanged chrome wipes the whole buf', () => {
  test('unchanged chrome wipes pending viewport paints and does not commit (no sync)', () => {
    const prevTmux = process.env.TMUX
    const prevForce = process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT
    process.env.TMUX = '1'
    delete process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT
    try {
      const cap = captureOut()
      const axc = new Axc(cap.out, 80, 24)
      axc.setup()
      cap.clear()

      const contentHeight = 20
      axc.syncViewport(
        {
          lines: Array.from({ length: contentHeight }, (_, i) => `row-${i}`),
          scrollTop: 0,
          scrollHeight: contentHeight,
          transcriptEnd: contentHeight,
        },
        contentHeight,
      )
      expect(axc.buf.length).toBeGreaterThan(0)

      // First draw commits chrome and records lastFrame.
      axc.draw({
        contentHeight,
        bottomTop: contentHeight,
        bottomLines: ['prompt'],
        overlayLines: [],
      })
      cap.clear()

      axc.syncViewport(
        {
          lines: Array.from({ length: contentHeight }, (_, i) => `row2-${i}`),
          scrollTop: 0,
          scrollHeight: contentHeight,
          transcriptEnd: contentHeight,
        },
        contentHeight,
      )
      expect(axc.buf.includes('row2-0')).toBe(true)

      // densable Axc.draw: identical chrome → wipe whole buf, no commitImmediate.
      axc.draw({
        contentHeight,
        bottomTop: contentHeight,
        bottomLines: ['prompt'],
        overlayLines: [],
      })
      const out = cap.text()
      expect(out).not.toContain('row2-0')
      expect(axc.buf).toBe('')
    } finally {
      if (prevTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = prevTmux
      if (prevForce === undefined)
        delete process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT
      else process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT = prevForce
    }
  })

  test('sync-on dedupe never emits a BSU without its ESU', () => {
    const prevTmux = process.env.TMUX
    const prevForce = process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT
    delete process.env.TMUX
    process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT = '1'
    try {
      const cap = captureOut()
      const axc = new Axc(cap.out, 80, 24)
      axc.setup()

      const layout = {
        contentHeight: 20,
        bottomTop: 20,
        bottomLines: ['prompt'],
        overlayLines: [],
      }

      // First draw establishes lastFrame. No syncViewport ran, so syncOpen is
      // false and draw() opens the synchronized update itself.
      axc.draw(layout)
      cap.clear()

      // densable wipe: identical chrome drops the whole buf (including any BSU
      // opened this draw) and does not commit. BSU count stays equal to ESU.
      axc.draw(layout)
      const out = cap.text()
      expect(countOf(out, BSU)).toBe(countOf(out, ESU))
      expect(out).toBe('')
      expect(axc.buf).toBe('')
    } finally {
      if (prevTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = prevTmux
      if (prevForce === undefined)
        delete process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT
      else process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT = prevForce
    }
  })
})
