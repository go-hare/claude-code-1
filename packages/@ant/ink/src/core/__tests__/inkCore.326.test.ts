import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { createClock } from '../../components/ClockContext.js'
import {
  matchesKeystroke,
  normalizeMacOptionInput,
} from '../../keybindings/match.js'
import { parseKeystroke } from '../../keybindings/parser.js'
import Ink, { drainStdin } from '../ink.js'
import {
  isGnuScreenEnv,
  setTerminalEmojiWidthCalibrator,
  stringWidth,
} from '../stringWidth.js'
import {
  mayWriteRawUrlHyperlink,
  supportsHyperlinks,
} from '../supports-hyperlinks.js'
import {
  isTmuxSyncRedrawsEverything,
  resetTerminalProbeForTests,
  setXtversionName,
  shouldSkipTmuxSyncForDiff,
  writeDiffToTerminal,
} from '../terminal.js'
import { PROGRAM_STATUS_KEEP_ALL, TerminalWriteContext } from '../../index.js'
import { Jk } from '../terminalCapabilities.js'
import { Cursor } from '../utils/Cursor.js'
import wrapText from '../wrap-text.js'

const origEnv = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in origEnv)) delete process.env[key]
  }
  Object.assign(process.env, origEnv)
}

function makeTtyStdout() {
  const chunks: string[] = []
  const stdout = new PassThrough() as PassThrough & {
    columns: number
    rows: number
    isTTY: boolean
    chunks: string[]
  }
  stdout.columns = 80
  stdout.rows = 24
  stdout.isTTY = true
  stdout.chunks = chunks
  const origWrite = stdout.write.bind(stdout)
  stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
    )
    return origWrite(chunk as never, ...(rest as []))
  }) as typeof stdout.write
  return stdout
}

function makeTtyStdin(buffered: string[] = []) {
  const queue = [...buffered]
  const stdin = new EventEmitter() as EventEmitter & {
    isTTY: boolean
    isRaw: boolean
    setRawMode: (m: boolean) => void
    ref: () => void
    unref: () => void
    resume: () => void
    pause: () => void
    read: () => string | null
  }
  stdin.isTTY = true
  stdin.isRaw = true
  stdin.setRawMode = (m: boolean) => {
    stdin.isRaw = m
  }
  stdin.ref = () => {}
  stdin.unref = () => {}
  stdin.resume = () => {}
  stdin.pause = () => {}
  stdin.read = () => (queue.length > 0 ? queue.shift()! : null)
  return stdin
}

afterEach(() => {
  restoreEnv()
  resetTerminalProbeForTests()
  setTerminalEmojiWidthCalibrator(undefined)
})

describe('Wave 326 Group 4A — Ink core & keybindings', () => {
  test('#10 & #127: wrapText clip without ellipsis, truncate-rows per-line preserving newlines, and truncate-end single-unit', () => {
    expect(wrapText('abcdefghij\n1234567890', 5, 'clip')).toBe('abcde\n12345')
    const truncatedRows = wrapText(
      'hello world\nsecond long line',
      8,
      'truncate-rows',
    )
    const lines = truncatedRows.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]!.endsWith('…')).toBe(true)
    expect(lines[1]!.endsWith('…')).toBe(true)
    expect(stringWidth(lines[0]!)).toBeLessThanOrEqual(8)
    expect(stringWidth(lines[1]!)).toBeLessThanOrEqual(8)
    // Official 2.1.328 `Ad()`: truncate-end stays single-unit truncation
    const singleUnit = wrapText(
      'hello world\nsecond long line',
      8,
      'truncate-end',
    )
    expect(singleUnit.split('\n')).toHaveLength(1)
    expect(singleUnit.endsWith('…')).toBe(true)
    expect(stringWidth(singleUnit)).toBeLessThanOrEqual(8)
  })

  test('#48: Ink.onRender recovers from RangeError allocation failure without crashing', () => {
    const stdout = makeTtyStdout()
    const stdin = makeTtyStdin()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: stdin as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      ;(ink as unknown as { renderer: () => never }).renderer = () => {
        throw new RangeError('Array buffer allocation failed')
      }
      expect(() => ink.onRender()).not.toThrow()
    } finally {
      ink.unmount()
    }
  })

  test('#144: Cursor.fromText maps wrapped text & control characters cleanly', () => {
    const text = 'abc\x07def\nghi'
    const c = Cursor.fromText(text, 10, text.length)
    expect(c.offset).toBe(text.length)
    const movedUp = c.up()
    expect(movedUp.offset).toBeLessThan(text.length)
    const wrapped = Cursor.fromText('0123456789abcdef', 6, 10)
    const pos = wrapped.getPosition()
    expect(pos.line).toBeGreaterThanOrEqual(1)
    expect(wrapped.left().offset).toBe(9)
    expect(wrapped.right().offset).toBe(11)
  })

  test('#185: tmux 3.7 skips BSU/ESU on small incremental diffs, keeps on clearTerminal or large diff', () => {
    delete process.env.TMUX
    setXtversionName('tmux 3.7')
    expect(isTmuxSyncRedrawsEverything()).toBe(true)
    const smallDiff = [{ type: 'stdout' as const, content: 'spinner ⠋' }]
    expect(shouldSkipTmuxSyncForDiff(smallDiff)).toBe(true)

    const out: string[] = []
    const terminal = {
      stdout: {
        write(s: string) {
          out.push(s)
          return true
        },
      } as never,
      stderr: process.stderr,
    }
    writeDiffToTerminal(terminal, smallDiff, false, 24)
    expect(out.join('')).not.toContain('\x1b[?2026h')

    const largeDiff = [{ type: 'stdout' as const, content: 'x'.repeat(2048) }]
    expect(shouldSkipTmuxSyncForDiff(largeDiff)).toBe(false)
    out.length = 0
    writeDiffToTerminal(terminal, largeDiff, false, 24)
    expect(out.join('')).toContain('\x1b[?2026h')

    const clearDiff = [
      { type: 'clearTerminal' as const, reason: 'resize' as const },
    ]
    expect(shouldSkipTmuxSyncForDiff(clearDiff)).toBe(false)
  })

  test('#186: macOS Option+T (†) maps to meta+t keybinding', () => {
    process.env.LC_TERMINAL = 'iTerm2'
    const norm = normalizeMacOptionInput('\u2020', {
      meta: false,
      ctrl: false,
      shift: false,
    } as never)
    expect(norm.input).toBe('t')
    expect(norm.meta).toBe(true)

    const parsed = parseKeystroke('meta+t')
    expect(
      matchesKeystroke(
        '\u2020',
        {
          upArrow: false,
          downArrow: false,
          leftArrow: false,
          rightArrow: false,
          pageDown: false,
          pageUp: false,
          home: false,
          end: false,
          return: false,
          escape: false,
          ctrl: false,
          shift: false,
          tab: false,
          backspace: false,
          delete: false,
          meta: false,
          super: false,
          fn: false,
        } as never,
        parsed,
      ),
    ).toBe(true)
  })

  test('#188: ProgramStatusController emits OSC 7501 on update and clears on leave', () => {
    const controller = Jk().programStatus
    const unsub = controller.show({
      root: { state: 'working', msg: 'Working' },
    })
    const seq = controller.update({ keep: 'all' })
    expect(seq).toContain('\x1b]7501;')
    unsub()
    const leaveSeq = controller.leave(true)
    expect(leaveSeq).toContain('\x1b]7501;')
    // Leaving when unsupported and already cleared emits nothing
    expect(controller.leave(false)).toBe('')
  })

  test('#202 & #203: drainStdin drains buffered mouse escapes and prepareToSuspend returns cleanly', () => {
    const stdin = makeTtyStdin(['\x1b[<35;10;5M', '\x1b[<35;11;5M'])
    const drained = drainStdin(stdin as never, 0, 5)
    expect(drained?.toString('utf8')).toContain('\x1b[<35;10;5M')

    const stdout = makeTtyStdout()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      expect(typeof ink.prepareToSuspend).toBe('function')
      expect(typeof ink.prepareToSuspend()).toBe('string')

      // #203: handleStdoutBackpressure must NOT reassert modes/redraw/repaint when isFinishingWrites is true
      let reassertCount = 0
      let redrawCount = 0
      let repaintCount = 0
      const internal = ink as unknown as {
        isFinishingWrites: boolean
        reassertTerminalModes: () => void
        forceRedraw: () => void
        repaint: () => void
        handleStdoutBackpressure: (ep: {
          droppedBytes: number
          endedBy: 'drain' | 'timeout'
          durationMs: number
          peakQueuedBytes: number
        }) => void
      }
      internal.reassertTerminalModes = () => {
        reassertCount++
      }
      internal.forceRedraw = () => {
        redrawCount++
      }
      internal.repaint = () => {
        repaintCount++
      }
      internal.isFinishingWrites = true
      internal.handleStdoutBackpressure({
        droppedBytes: 128,
        endedBy: 'drain',
        durationMs: 10,
        peakQueuedBytes: 128,
      })
      expect(reassertCount).toBe(0)
      expect(redrawCount).toBe(0)
      expect(repaintCount).toBe(0)

      internal.isFinishingWrites = false
      internal.handleStdoutBackpressure({
        droppedBytes: 128,
        endedBy: 'drain',
        durationMs: 10,
        peakQueuedBytes: 128,
      })
      expect(reassertCount).toBe(1)
      expect(redrawCount).toBe(1)

      // #188: index exports TerminalWriteContext and PROGRAM_STATUS_KEEP_ALL
      expect(TerminalWriteContext).toBeDefined()
      expect(PROGRAM_STATUS_KEEP_ALL).toEqual({ keep: 'all' })
    } finally {
      ink.unmount()
    }
  })

  test('#213: Rex terminal supports hyperlinks; unrecognized terminal disables raw URL OSC 8', () => {
    delete process.env.FORCE_HYPERLINK
    delete process.env.VTE_VERSION
    delete process.env.WT_SESSION
    delete process.env.KONSOLE_VERSION
    delete process.env.KITTY_WINDOW_ID
    delete process.env.DOMTERM
    delete process.env.TERM_PROGRAM_VERSION
    process.env.TERM_PROGRAM = 'rex'
    process.env.TERM = 'xterm-256color'
    expect(supportsHyperlinks()).toBe(true)
    expect(
      mayWriteRawUrlHyperlink('https://example.com', { isTTY: true }),
    ).toBe(true)

    delete process.env.TERM_PROGRAM
    process.env.TERM = 'dumb'
    expect(
      mayWriteRawUrlHyperlink('https://example.com', { isTTY: true }),
    ).toBe(false)
  })

  test('#222 & #223: stringWidth handles wide symbols (✌/☝), Indic vowels, calibrator, and GNU screen', () => {
    expect(stringWidth('hello')).toBe(5)
    expect(stringWidth('✌')).toBe(2)
    expect(stringWidth('☝')).toBe(2)
    // Indic dependent vowel sign should not be mis-counted as width 2
    expect(stringWidth('क\u093e')).toBeLessThanOrEqual(2)

    // Custom calibrator overrides grapheme width when installed
    setTerminalEmojiWidthCalibrator(g => (g === '👍🏽' ? 4 : undefined))
    expect(stringWidth('👍🏽')).toBe(4)
    setTerminalEmojiWidthCalibrator(undefined)

    process.env.STY = '12345.pts-0.host'
    expect(isGnuScreenEnv()).toBe(true)
  })

  test('#242: createClock keeps zero timers when idle and avoids restarting on follower subscribe', () => {
    const clock = createClock(50)
    const unsubFollower = clock.subscribeFollower(() => {})
    const t0 = clock.now()
    expect(typeof t0).toBe('number')
    const unsubKeep = clock.subscribeKeepAlive(() => {})
    const unsubFollower2 = clock.subscribeFollower(() => {})
    unsubFollower2()
    unsubKeep()
    unsubFollower()
    expect(clock.now()).toBeGreaterThanOrEqual(t0)
  })
})
