import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import * as React from 'react'
import { ModalScroller } from '../../../../../../src/components/ModalScroller.js'
import type { Message } from '../../../../../../src/types/message.js'
import {
  appendTranscriptMessage,
  createTaskRegistry,
  MAX_TASK_TRANSCRIPT_MESSAGES,
  mergeDiskAndLiveTranscriptMessages,
} from '../../../../../../src/utils/taskRegistry.js'
import { type Clock, ClockContext } from '../../components/ClockContext.js'
import type { ScrollBoxHandle } from '../../components/ScrollBox.js'
import { Box, Text, ThemeProvider } from '../../index.js'
import { activeElementReachesBottom } from '../../theme/Dialog.js'
import { offsetAtColumn } from '../../theme/SearchBox.js'
import {
  appendChildNode,
  createNode,
  createTextNode,
  type DOMElement,
  setStyle,
} from '../dom.js'
import { FocusManager } from '../focus.js'
import {
  getInkHostAdapter,
  registerInkHostAdapter,
  resetInkHostAdapterForTests,
} from '../hostAdapter.js'
import { IncrementalPainter } from '../incremental-painter.js'
import Ink from '../ink.js'
import {
  bindInkSessionHost,
  captureInkAlsSession,
  hasInkActiveSessionAls,
  inkSessionHost,
  Ns,
  resetInkSessionHostForTests,
  runWithCapturedInkAlsSession,
} from '../instances.js'
import {
  createNewRenderers,
  getTerminalRenderCapabilities,
  RowDrawer,
  TerminalEncoder,
} from '../new-renderer.js'
import {
  resetNonBlockingStdoutRemoteFlagForTests,
  shouldInstallNonBlockingStdout,
} from '../nonBlockingStdout.js'
import Output from '../output.js'
import reconciler from '../reconciler.js'
import { createRenderFrameContext } from '../render-node-to-output.js'
import {
  type Cell,
  CellWidth,
  CharPool,
  cellAt,
  createScreen,
  HyperlinkPool,
  type Screen,
  StylePool,
  setCellAt,
} from '../screen.js'
import { ScrollViewport } from '../scroll-viewport.js'
import { setTerminalEmojiWidthCalibrator } from '../stringWidth.js'
import {
  isDecstbmRendererEnabled,
  isNativeCursorEnabled,
  resetTerminalProbeForTests,
} from '../terminal.js'
import { wrapAnsi, wrapAnsiFallback } from '../wrapAnsi.js'

const INK_SRC = join(import.meta.dir, '../..')
const REPO_ROOT = join(INK_SRC, '../../../..')

function makeTtyStdout(columns = 80, rows = 24) {
  const chunks: string[] = []
  const stdout = new PassThrough() as PassThrough & {
    columns: number
    rows: number
    isTTY: boolean
    chunks: string[]
  }
  stdout.columns = columns
  stdout.rows = rows
  stdout.isTTY = true
  stdout.chunks = chunks
  const origWrite = stdout.write.bind(stdout)
  stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
    )
    return origWrite(chunk)
  }) as typeof stdout.write
  stdout.resume()
  return stdout
}

function makeTtyStdin() {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    isRaw: boolean
    rawModeCalls: boolean[]
    setRawMode: (raw: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.isRaw = true
  stdin.rawModeCalls = []
  stdin.setRawMode = (raw: boolean) => {
    stdin.rawModeCalls.push(raw)
    stdin.isRaw = raw
  }
  stdin.ref = () => {}
  stdin.unref = () => {}
  return stdin
}

function makeCell(char: string, width: CellWidth, hyperlink?: string): Cell {
  return { char, styleId: 0, width, hyperlink }
}

function getScreenDamage(screen: Screen): Screen['damage'] {
  return screen.damage
}

function withChild<P extends { children: React.ReactNode }>(
  Comp: React.ComponentType<P>,
  props: Omit<P, 'children'>,
  child: React.ReactNode,
): React.ReactElement {
  return React.createElement(
    Comp as React.ComponentType<Omit<P, 'children'>>,
    props,
    child,
  )
}

function makeFakeMessage(id: string): Message {
  return {
    type: 'user',
    uuid: id,
    message: { role: 'user', content: id },
  } as unknown as Message
}

describe('Engine 2 Ink & UI Hardening (2.1.331)', () => {
  afterEach(() => {
    resetInkSessionHostForTests()
    resetNonBlockingStdoutRemoteFlagForTests()
    resetTerminalProbeForTests()
    setTerminalEmojiWidthCalibrator(undefined)
  })

  // =========================================================================
  // E2-P0-1: Hidden ModalScroller focus non-stealing + FocusManager hidden guard
  // =========================================================================
  describe('E2-P0-1: FocusManager hidden subtree guard & ModalScroller visibility', () => {
    test('FocusManager.focus rejects nodes with display:none or isHidden on self or ancestor', () => {
      const root = createNode('ink-root')
      const visible = createNode('ink-box')
      const hiddenSelf = createNode('ink-box')
      setStyle(hiddenSelf, { display: 'none' })
      const hiddenParent = createNode('ink-box')
      setStyle(hiddenParent, { display: 'none' })
      const childInHiddenParent = createNode('ink-box')
      appendChildNode(hiddenParent, childInHiddenParent)

      const isHiddenSelf = createNode('ink-box')
      isHiddenSelf.isHidden = true
      const isHiddenParent = createNode('ink-box')
      isHiddenParent.isHidden = true
      const childInIsHiddenParent = createNode('ink-box')
      appendChildNode(isHiddenParent, childInIsHiddenParent)

      appendChildNode(root, visible)
      appendChildNode(root, hiddenSelf)
      appendChildNode(root, hiddenParent)
      appendChildNode(root, isHiddenSelf)
      appendChildNode(root, isHiddenParent)

      const events: string[] = []
      const fm = new FocusManager((_target, ev) => {
        events.push(ev.type)
        return true
      })

      fm.focus(visible)
      expect(fm.activeElement).toBe(visible)

      fm.focus(hiddenSelf)
      expect(fm.activeElement).toBe(visible)

      fm.focus(childInHiddenParent)
      expect(fm.activeElement).toBe(visible)

      fm.focus(isHiddenSelf)
      expect(fm.activeElement).toBe(visible)

      fm.focus(childInIsHiddenParent)
      expect(fm.activeElement).toBe(visible)

      // Only the single initial focus event should have fired
      expect(events).toEqual(['focus'])
    })

    test('ModalScroller with visible={false} neither steals focus nor arms 50ms interval; visible={true} reclaims focus', async () => {
      const stdout = makeTtyStdout(60, 20)
      const stdin = makeTtyStdin()
      const ink = new Ink({
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      })

      let scheduledTimeouts = 0
      const pendingTimers: Array<() => void> = []
      const fakeClock: Clock = {
        now: () => 1000,
        setTimeout: (cb: () => void, _ms: number) => {
          scheduledTimeouts++
          pendingTimers.push(cb)
          return () => {
            const idx = pendingTimers.indexOf(cb)
            if (idx !== -1) pendingTimers.splice(idx, 1)
          }
        },
        subscribeFollower: () => () => {},
        subscribeKeepAlive: () => () => {},
        setTickInterval: () => {},
      }

      const promptRef: { current: DOMElement | null } = { current: null }

      function Harness({ modalVisible }: { modalVisible: boolean }) {
        const tree = React.createElement(
          ClockContext.Provider,
          { value: fakeClock },
          React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(
              Box,
              {
                ref: (el: DOMElement | null) => {
                  promptRef.current = el
                },
              },
              React.createElement(Text, null, 'Prompt'),
            ),
            React.createElement(
              Box,
              { display: modalVisible ? 'flex' : 'none' },
              withChild(
                ModalScroller,
                { maxRows: 10, visible: modalVisible },
                React.createElement(Text, null, 'Modal body'),
              ),
            ),
          ),
        )
        return withChild(ThemeProvider, { initialState: 'dark' }, tree)
      }

      const flush = async () => {
        reconciler.flushSyncWork()
        await new Promise(resolve => setTimeout(resolve, 20))
      }

      try {
        ink.render(React.createElement(Harness, { modalVisible: false }))
        await flush()
        const fm = (ink as unknown as { rootNode: DOMElement }).rootNode
          .focusManager!
        expect(promptRef.current).not.toBeNull()
        fm.focus(promptRef.current!)
        expect(fm.activeElement).toBe(promptRef.current)

        // When hidden, ModalScroller must NOT arm the 50ms clock interval
        expect(scheduledTimeouts).toBe(0)
        expect(pendingTimers).toHaveLength(0)

        // Re-render while still hidden: focus stays on promptRef
        ink.render(React.createElement(Harness, { modalVisible: false }))
        await flush()
        expect(fm.activeElement).toBe(promptRef.current)
        expect(scheduledTimeouts).toBe(0)

        // Flipping visible to true arms the interval and reclaims focus onto modal
        ink.render(React.createElement(Harness, { modalVisible: true }))
        await flush()
        expect(scheduledTimeouts).toBeGreaterThan(0)
        expect(fm.activeElement).not.toBe(promptRef.current)
        expect(fm.activeElement).not.toBeNull()
      } finally {
        ink.unmount()
      }
    })

    test('FullscreenLayout passes visible={modalVisible} to ModalScroller', () => {
      const src = readFileSync(
        join(REPO_ROOT, 'src/components/FullscreenLayout.tsx'),
        'utf8',
      )
      expect(src).toContain('visible={modalVisible}')
    })
  })

  // =========================================================================
  // E2-P0-2: Ink.unmount() throw-safe cleanup in finally
  // =========================================================================
  describe('E2-P0-2: Ink.unmount() completes full cleanup when onRender() throws', () => {
    test('throwing onRender() never aborts terminal mode restore, raw mode disable, console restore, scheduler cancel, or registry removal', () => {
      const stdout = makeTtyStdout(80, 24)
      const stdin = makeTtyStdin()
      const loggedErrors: unknown[] = []
      const origConsoleLog = console.log

      const ink = new Ink({
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: true,
        logger: {
          debug: () => {},
          error: err => {
            loggedErrors.push(err)
          },
        },
      })

      Ns().set(stdout as unknown as NodeJS.WriteStream, ink)
      // Console is patched while mounted
      expect(console.log).not.toBe(origConsoleLog)

      // Enable a terminal mode so restoreTerminalModes emits a reset sequence
      const inkInternal = ink as unknown as {
        modes: { set: (mode: 'bracketedPaste') => string }
        scheduler: { cancelAll: () => void }
        onRender: () => void
      }
      inkInternal.modes.set('bracketedPaste')

      const cancelAllSpy = mock(() => {})
      const origCancelAll = inkInternal.scheduler.cancelAll.bind(
        inkInternal.scheduler,
      )
      inkInternal.scheduler.cancelAll = () => {
        cancelAllSpy()
        origCancelAll()
      }

      // Force onRender() to throw even when unwritten is undefined
      inkInternal.onRender = () => {
        throw new Error('simulated fatal render crash during unmount')
      }

      expect(() => ink.unmount()).not.toThrow()

      // Error was logged, not rethrown
      expect(
        loggedErrors.some(
          e =>
            e instanceof Error &&
            e.message.includes('simulated fatal render crash'),
        ),
      ).toBe(true)
      // Console restored
      expect(console.log).toBe(origConsoleLog)
      // Terminal modes restored (bracketed paste disable \x1b[?2004l)
      expect(stdout.chunks.join('')).toContain('\x1b[?2004l')
      // Raw mode explicitly disabled
      expect(stdin.rawModeCalls).toContain(false)
      expect(stdin.isRaw).toBe(false)
      // Scheduler cancelled
      expect(cancelAllSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
      // Marked unmounted and removed from registry
      expect(ink.hasUnmounted).toBe(true)
      expect(Ns().get(stdout as unknown as NodeJS.WriteStream)).toBeUndefined()
    })

    test('Ink.unmount() respects handoffRawMode() and skips setRawMode(false)', () => {
      const stdout = makeTtyStdout(80, 24)
      const stdin = makeTtyStdin()
      const ink = new Ink({
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      })

      ink.handoffRawMode()
      ink.unmount()

      expect(stdin.rawModeCalls).toEqual([])
      expect(stdin.isRaw).toBe(true)
      expect(ink.hasUnmounted).toBe(true)
    })
  })

  // =========================================================================
  // E2-P1-3: Pure-JS ANSI- & grapheme-aware word-wrap fallback (Node compat)
  // =========================================================================
  describe('E2-P1-3: wrapAnsiFallback pure-JS ANSI & grapheme word-wrap', () => {
    test('honors wordWrap: true with trim: true and trim: false', () => {
      expect(wrapAnsiFallback('hello world foo', 10)).toBe('hello\nworld foo')
      expect(wrapAnsiFallback('hello world foo', 10, { trim: false })).toBe(
        'hello \nworld foo',
      )
      expect(wrapAnsiFallback('  hello   world  ', 8, { trim: true })).toBe(
        'hello\nworld',
      )
      expect(wrapAnsiFallback('  hello   world  ', 8, { trim: false })).toBe(
        '  hello \n  world \n ',
      )
    })

    test('honors hard: false (never splits long words) vs hard: true (splits long words)', () => {
      expect(wrapAnsiFallback('superlongword next', 5, { hard: false })).toBe(
        'superlongword\nnext',
      )
      expect(wrapAnsiFallback('superlongword next', 5, { hard: true })).toBe(
        'super\nlongw\nord\nnext',
      )
      expect(wrapAnsiFallback('hi superlongword', 5, { hard: true })).toBe(
        'hi\nsuper\nlongw\nord',
      )
    })

    test('honors wordWrap: false', () => {
      expect(
        wrapAnsiFallback('hello world', 5, { wordWrap: false, trim: true }),
      ).toBe('hello\nworld')
      expect(
        wrapAnsiFallback('hello world', 5, { wordWrap: false, trim: false }),
      ).toBe('hello\n worl\nd')
    })

    test('preserves ANSI SGR and OSC 8 hyperlinks cleanly across wrapped lines', () => {
      expect(wrapAnsiFallback('\x1b[31mhello world\x1b[39m', 7)).toBe(
        '\x1b[31mhello\x1b[39m\n\x1b[31mworld\x1b[39m',
      )
      expect(
        wrapAnsiFallback('\x1b]8;;https://a.com\x07hello world\x1b]8;;\x07', 7),
      ).toBe(
        '\x1b]8;;https://a.com\x07hello\x1b]8;;\x07\n\x1b]8;;https://a.com\x07world\x1b]8;;\x07',
      )
      expect(wrapAnsiFallback('\x1b[38;2;255;0;0mhello world\x1b[39m', 7)).toBe(
        '\x1b[38;2;255;0;0mhello\x1b[39m\n\x1b[38;2;255;0;0mworld\x1b[39m',
      )
    })

    test('never splits ZWJ emoji or combining marks mid-grapheme and never loops on oversized graphemes', () => {
      const family = '👨‍👩‍👧‍👦'
      const wrapped = wrapAnsiFallback(`a ${family}b`, 1, { hard: true })
      expect(wrapped).toBe(`a\n${family}\nb`)

      const combining = 'cafe\u0301 test'
      const wrappedCombining = wrapAnsiFallback(combining, 4, { hard: true })
      expect(wrappedCombining.split('\n')).toEqual(['cafe\u0301', 'test'])
    })

    test('wrapAnsi dispatches cleanly to pure-JS fallback when Bun.wrapAnsi is absent', () => {
      const bunObj = globalThis.Bun as unknown as {
        wrapAnsi?: typeof Bun.wrapAnsi
      }
      const origWrapAnsi = bunObj.wrapAnsi
      try {
        bunObj.wrapAnsi = undefined
        expect(wrapAnsi('hello world foo', 10)).toBe('hello\nworld foo')
        expect(wrapAnsi('superlongword next', 5, { hard: false })).toBe(
          'superlongword\nnext',
        )
        expect(wrapAnsi('\x1b[38;2;10;20;30mhello world\x1b[0m', 7)).toContain(
          '\x1b[39m\n\x1b[38;2;10;20;30m',
        )
      } finally {
        bunObj.wrapAnsi = origWrapAnsi
      }
    })
  })

  // =========================================================================
  // E2-P1-4: w >= 3 graphemes in RowDrawer.draw and screen.setCellAt
  // =========================================================================
  describe('E2-P1-4: w >= 3 wide grapheme spans in RowDrawer & setCellAt', () => {
    function writeWidth3Span(
      screen: ReturnType<typeof createScreen>,
      x: number,
      y: number,
      char: string,
    ): void {
      setCellAt(screen, x, y, makeCell(char, CellWidth.Wide))
      setCellAt(screen, x + 2, y, makeCell('', CellWidth.SpacerTail))
    }

    test('RowDrawer.draw steps back past multiple SpacerTails and advances by 1 + tailCount', () => {
      const stylePool = new StylePool()
      const charPool = new CharPool()
      const hyperlinkPool = new HyperlinkPool()

      const shown = createScreen(10, 1, stylePool, charPool, hyperlinkPool)
      const next = createScreen(10, 1, stylePool, charPool, hyperlinkPool)

      // Both screens have identical w=3 grapheme at cols 2..4 except col 4 differs in shown
      writeWidth3Span(shown, 2, 0, '🏳️‍🌈')
      setCellAt(shown, 5, 0, makeCell('Z', CellWidth.Narrow))
      // Corrupt shown col 4 so diff lands directly on the 2nd SpacerTail (col 4)
      shown.cells[(4 << 1) + 1] = CellWidth.Narrow

      writeWidth3Span(next, 2, 0, '🏳️‍🌈')
      setCellAt(next, 5, 0, makeCell('Z', CellWidth.Narrow))

      const encoder = new TerminalEncoder(stylePool)
      const drawer = new RowDrawer(encoder)
      const caps = getTerminalRenderCapabilities()
      encoder.begin(0)
      drawer.begin(caps, charPool)
      drawer.draw(shown, 0, next, 0)

      // Must step back all the way from col 4 -> col 2 (CSI 3G = 1-indexed col 3),
      // write the grapheme once, and advance encoder.x to 2 + 3 = 5.
      expect(encoder.bytes).toContain('\x1b[3G🏳️‍🌈')
      expect(encoder.x).toBe(5)
      // Shown screen is now synchronized at cols 2..4
      expect(cellAt(shown, 2, 0)?.width).toBe(CellWidth.Wide)
      expect(cellAt(shown, 3, 0)?.width).toBe(CellWidth.SpacerTail)
      expect(cellAt(shown, 4, 0)?.width).toBe(CellWidth.SpacerTail)
    })

    test('setCellAt clears all contiguous SpacerTails and owning Wide head in both directions for w >= 3', () => {
      const stylePool = new StylePool()
      const charPool = new CharPool()
      const hyperlinkPool = new HyperlinkPool()

      // Case 1: overwrite 2nd SpacerTail (col 4) -> clears col 2 (Wide) & col 3 (SpacerTail)
      const s1 = createScreen(10, 1, stylePool, charPool, hyperlinkPool)
      writeWidth3Span(s1, 2, 0, '🏳️‍🌈')
      s1.damage = undefined
      setCellAt(s1, 4, 0, makeCell('A', CellWidth.Narrow))
      expect(cellAt(s1, 2, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s1, 3, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s1, 4, 0)).toMatchObject({
        char: 'A',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(s1)).toEqual({ x: 2, y: 0, width: 3, height: 1 })

      // Case 2: overwrite middle SpacerTail (col 3) -> clears col 2 (Wide) AND col 4 (SpacerTail)
      const s2 = createScreen(10, 1, stylePool, charPool, hyperlinkPool)
      writeWidth3Span(s2, 2, 0, '🏳️‍🌈')
      s2.damage = undefined
      setCellAt(s2, 3, 0, makeCell('B', CellWidth.Narrow))
      expect(cellAt(s2, 2, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s2, 3, 0)).toMatchObject({
        char: 'B',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s2, 4, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(s2)).toEqual({ x: 2, y: 0, width: 3, height: 1 })

      // Case 3: overwrite Wide head (col 2) with w=2 Wide char -> clears col 4 orphan tail
      const s3 = createScreen(10, 1, stylePool, charPool, hyperlinkPool)
      writeWidth3Span(s3, 2, 0, '🏳️‍🌈')
      s3.damage = undefined
      setCellAt(s3, 2, 0, makeCell('中', CellWidth.Wide))
      expect(cellAt(s3, 2, 0)).toMatchObject({
        char: '中',
        width: CellWidth.Wide,
      })
      expect(cellAt(s3, 3, 0)).toMatchObject({ width: CellWidth.SpacerTail })
      expect(cellAt(s3, 4, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(s3)).toEqual({ x: 2, y: 0, width: 3, height: 1 })

      // Case 4: overwrite col 1 with w=2 Wide whose SpacerTail lands on col 2 (w=3 head)
      const s4 = createScreen(10, 1, stylePool, charPool, hyperlinkPool)
      writeWidth3Span(s4, 2, 0, '🏳️‍🌈')
      s4.damage = undefined
      setCellAt(s4, 1, 0, makeCell('本', CellWidth.Wide))
      expect(cellAt(s4, 1, 0)).toMatchObject({
        char: '本',
        width: CellWidth.Wide,
      })
      expect(cellAt(s4, 2, 0)).toMatchObject({ width: CellWidth.SpacerTail })
      expect(cellAt(s4, 3, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s4, 4, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(s4)).toEqual({ x: 1, y: 0, width: 4, height: 1 })
    })
  })

  // =========================================================================
  // E2-P1-5: Zero upward require('../../../../../src/...') via InkHostAdapter
  // =========================================================================
  describe('E2-P1-5: InkHostAdapter removes upward src requires from @ant/ink', () => {
    test('core modules have zero upward relative imports/requires into src/', () => {
      for (const rel of [
        'core/instances.ts',
        'core/nonBlockingStdout.ts',
        'core/terminal.ts',
        'core/hostAdapter.ts',
      ]) {
        const content = readFileSync(join(INK_SRC, rel), 'utf8')
        expect(content).not.toContain('../../../../../src/')
      }
    })

    test('registerInkHostAdapter wires sessionRoot, growthbook flags, screenReaderGate, and fullscreen cleanly with standalone fallbacks', () => {
      const prevAdapter = resetInkHostAdapterForTests()
      const prevEnvStall = process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
      const prevEnvNative = process.env.CLAUDE_CODE_NATIVE_CURSOR
      const prevEnvSr = process.env.CLAUDE_AX_SCREEN_READER
      const prevEnvInkSr = process.env.INK_SCREEN_READER
      const prevEnvAcc = process.env.CLAUDE_CODE_ACCESSIBILITY
      try {
        delete process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
        delete process.env.CLAUDE_CODE_NATIVE_CURSOR
        delete process.env.CLAUDE_AX_SCREEN_READER
        delete process.env.INK_SCREEN_READER
        delete process.env.CLAUDE_CODE_ACCESSIBILITY

        // Unregistered standalone defaults
        expect(getInkHostAdapter()).toEqual({})
        expect(hasInkActiveSessionAls()).toBe(false)
        expect(captureInkAlsSession()).toBeUndefined()
        expect(shouldInstallNonBlockingStdout()).toBe(false)
        bindInkSessionHost(() => ({}))
        resetTerminalProbeForTests()
        expect(isNativeCursorEnabled()).toBe(false)
        resetInkSessionHostForTests()

        // Registered adapter drives all 4 host integrations
        const fakeHost = { tag: 'adapter-host' }
        const fakeSession = { host: fakeHost }
        let activeSession: object | undefined = fakeSession
        let ranWithSession = false

        registerInkHostAdapter({
          sessionRoot: {
            getBootstrapSession: () => fakeSession,
            hasActiveSessionAls: () => activeSession !== undefined,
            getActiveSessionFromAls: () => activeSession,
            runWithSession: (session, fn) => {
              ranWithSession = true
              const saved = activeSession
              activeSession = session
              try {
                return fn()
              } finally {
                activeSession = saved
              }
            },
          },
          getFeatureFlag: <T>(name: string, defaultValue: T): T => {
            if (name === 'tengu_event_loop_stall') return true as unknown as T
            if (name === 'tengu_native_cursor') return true as unknown as T
            return defaultValue
          },
          isScreenReaderModeEnabled: () => false,
          isTmuxControlMode: () => true,
        })

        expect(inkSessionHost()).toBe(fakeHost)
        expect(hasInkActiveSessionAls()).toBe(true)
        expect(captureInkAlsSession()).toBe(fakeSession)

        const otherSession = { host: { tag: 'other' } }
        activeSession = undefined
        runWithCapturedInkAlsSession(otherSession, () => {
          expect(captureInkAlsSession()).toBe(otherSession)
        })
        expect(ranWithSession).toBe(true)

        expect(shouldInstallNonBlockingStdout()).toBe(true)

        resetTerminalProbeForTests()
        // isTmuxControlMode() === true disables DECSTBM renderer
        expect(isDecstbmRendererEnabled()).toBe(false)
        // tengu_native_cursor === true enables native cursor
        expect(isNativeCursorEnabled()).toBe(true)
      } finally {
        resetInkHostAdapterForTests(prevAdapter)
        if (prevEnvStall === undefined)
          delete process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
        else process.env.CLAUDE_CODE_NONBLOCKING_STDOUT = prevEnvStall
        if (prevEnvNative === undefined)
          delete process.env.CLAUDE_CODE_NATIVE_CURSOR
        else process.env.CLAUDE_CODE_NATIVE_CURSOR = prevEnvNative
        if (prevEnvSr === undefined) delete process.env.CLAUDE_AX_SCREEN_READER
        else process.env.CLAUDE_AX_SCREEN_READER = prevEnvSr
        if (prevEnvInkSr === undefined) delete process.env.INK_SCREEN_READER
        else process.env.INK_SCREEN_READER = prevEnvInkSr
        if (prevEnvAcc === undefined)
          delete process.env.CLAUDE_CODE_ACCESSIBILITY
        else process.env.CLAUDE_CODE_ACCESSIBILITY = prevEnvAcc
      }
    })
  })

  // =========================================================================
  // E2-P1-6: ScrollViewport emits on handle change & attach(null) preserves stack
  // =========================================================================
  describe('E2-P1-6: ScrollViewport emit & attach(null) stack safety', () => {
    function makeHandle() {
      const listeners = new Set<() => void>()
      return {
        listeners,
        handle: {
          subscribe: (fn: () => void) => {
            listeners.add(fn)
            return () => listeners.delete(fn)
          },
        } as unknown as ScrollBoxHandle,
      }
    }

    test('setActiveHandle emits when active handle changes and attach(null) pops without wiping stack', () => {
      const vp = new ScrollViewport()
      const seen: Array<ScrollBoxHandle | null> = []
      const unsub = vp.subscribe(() => {
        seen.push(vp.handle)
      })

      const a = makeHandle()
      const b = makeHandle()

      // attach(null) on empty stack is a no-op
      vp.attach(null)
      expect(seen).toEqual([])

      const detachA = vp.attach(a.handle)
      expect(vp.handle).toBe(a.handle)
      expect(seen).toEqual([a.handle])

      vp.attach(b.handle)
      expect(vp.handle).toBe(b.handle)
      expect(seen).toEqual([a.handle, b.handle])

      // attach(null) pops top handle b, restoring a instead of wiping stack to []
      vp.attach(null)
      expect(vp.handle).toBe(a.handle)
      expect(seen).toEqual([a.handle, b.handle, a.handle])
      expect(a.listeners.size).toBe(1)

      // Detaching a emits transition to null
      detachA()
      expect(vp.handle).toBeNull()
      expect(seen).toEqual([a.handle, b.handle, a.handle, null])

      unsub()
    })
  })

  // =========================================================================
  // E2-P2-7: Pools (charPool/hyperlinkPool), IncrementalPainter, taskRegistry, PromptInput, REPL
  // =========================================================================
  describe('E2-P2-7: Pool resets, IncrementalPainter charPool sync, taskRegistry cap, PromptInput & REPL hygiene', () => {
    test('InlineRenderer.blankFront syncs updated charPool and hyperlinkPool across pool resets', () => {
      const stylePool = new StylePool()
      const charPool1 = new CharPool()
      const linkPool1 = new HyperlinkPool()
      const { inline } = createNewRenderers(stylePool)
      const caps = getTerminalRenderCapabilities()

      const s1 = createScreen(10, 2, stylePool, charPool1, linkPool1)
      setCellAt(s1, 0, 0, {
        char: '★',
        styleId: 0,
        width: CellWidth.Narrow,
        hyperlink: 'https://old.example',
      })
      const empty = createScreen(10, 0, stylePool, charPool1, linkPool1)
      inline.render(
        {
          screen: empty,
          top: 0,
          viewport: { width: 10, height: 5 },
          cursor: { x: 0, y: 0, visible: false },
        },
        {
          screen: s1,
          top: 0,
          viewport: { width: 10, height: 5 },
          cursor: { x: 0, y: 2, visible: false },
        },
        caps,
      )

      // Replace both pools and render again
      const charPool2 = new CharPool()
      const linkPool2 = new HyperlinkPool()
      const s2 = createScreen(10, 2, stylePool, charPool2, linkPool2)
      setCellAt(s2, 0, 0, {
        char: '☆',
        styleId: 0,
        width: CellWidth.Narrow,
        hyperlink: 'https://new.example',
      })
      const res = inline.render(
        {
          screen: s1,
          top: 0,
          viewport: { width: 10, height: 5 },
          cursor: { x: 0, y: 2, visible: false },
        },
        {
          screen: s2,
          top: 0,
          viewport: { width: 10, height: 5 },
          cursor: { x: 0, y: 2, visible: false },
        },
        caps,
      )

      const inlineInternal = inline as unknown as { front?: typeof s2 }
      expect(inlineInternal.front?.charPool).toBe(charPool2)
      expect(inlineInternal.front?.hyperlinkPool).toBe(linkPool2)
      expect(res.bytes).toContain('☆')
      expect(res.bytes).toContain('https://new.example')
    })

    test('IncrementalPainter invalidates previous cache when screen.charPool is replaced and syncs previous.charPool', () => {
      const stylePool = new StylePool()
      const charPool1 = new CharPool()
      const linkPool = new HyperlinkPool()
      const root = createNode('ink-root')
      setStyle(root, { flexDirection: 'column', width: 20 })
      const txt = createNode('ink-text')
      appendChildNode(txt, createTextNode('αβγ') as unknown as DOMElement)
      appendChildNode(root, txt)
      root.yogaNode!.calculateLayout(20, 5)

      const screen1 = createScreen(20, 3, stylePool, charPool1, linkPool)
      const output = new Output({
        width: 20,
        height: 3,
        stylePool,
        screen: screen1,
      })
      const ctx = createRenderFrameContext()
      const painter = new IncrementalPainter(output, ctx, stylePool)
      painter.paint(root, screen1, 0, false)

      expect(cellAt(screen1, 0, 0)?.char).toBe('α')

      // Swap to a brand-new CharPool (different intern IDs) while keeping root clean
      const charPool2 = new CharPool()
      charPool2.intern('DUMMY_OFFSET_SHIFT')
      const screen2 = createScreen(20, 3, stylePool, charPool2, linkPool)
      output.reset(20, 3, screen2)
      painter.paint(root, screen2, 0, false)

      // Must NOT have blindly copied stale char IDs from charPool1
      expect(cellAt(screen2, 0, 0)?.char).toBe('α')
      expect(cellAt(screen2, 1, 0)?.char).toBe('β')
      expect(cellAt(screen2, 2, 0)?.char).toBe('γ')
      const painterInternal = painter as unknown as {
        previous?: typeof screen2
      }
      expect(painterInternal.previous?.charPool).toBe(charPool2)
    })

    test('Ink.resetPools resets charPool when exceeding 16384 entries and migrates frontFrame/backFrame', () => {
      const stdout = makeTtyStdout(20, 5)
      const stdin = makeTtyStdin()
      const ink = new Ink({
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      })
      try {
        const inkInternal = ink as unknown as {
          stylePool: StylePool
          charPool: CharPool
          hyperlinkPool: HyperlinkPool
          frontFrame: { screen: ReturnType<typeof createScreen> }
          backFrame: { screen: ReturnType<typeof createScreen> }
          resetPools: () => void
        }
        inkInternal.frontFrame.screen = createScreen(
          20,
          5,
          inkInternal.stylePool,
          inkInternal.charPool,
          inkInternal.hyperlinkPool,
        )
        setCellAt(
          inkInternal.frontFrame.screen,
          0,
          0,
          makeCell('★', CellWidth.Narrow),
        )
        const oldPool = inkInternal.charPool
        for (let i = 0; i < 16_400; i++) {
          oldPool.intern(`g_${i}`)
        }
        expect(oldPool.size).toBeGreaterThan(16_384)

        inkInternal.resetPools()

        expect(inkInternal.charPool).not.toBe(oldPool)
        expect(inkInternal.charPool.size).toBeLessThan(100)
        expect(inkInternal.frontFrame.screen.charPool).toBe(
          inkInternal.charPool,
        )
        expect(inkInternal.backFrame.screen.charPool).toBe(inkInternal.charPool)
        // Live glyph on frontFrame survived migration
        expect(cellAt(inkInternal.frontFrame.screen, 0, 0)?.char).toBe('★')
      } finally {
        ink.unmount()
      }
    })

    test('taskRegistry caps per-task transcript messages at MAX_TASK_TRANSCRIPT_MESSAGES keeping latest', () => {
      const total = MAX_TASK_TRANSCRIPT_MESSAGES + 50
      let msgs: Message[] = []
      for (let i = 0; i < total; i++) {
        msgs = appendTranscriptMessage(msgs, makeFakeMessage(`m-${i}`))
      }
      const uuidOf = (m: Message | undefined): string | undefined =>
        (m as { uuid?: string } | undefined)?.uuid
      expect(msgs.length).toBe(MAX_TASK_TRANSCRIPT_MESSAGES)
      expect(uuidOf(msgs[0])).toBe('m-50')
      expect(uuidOf(msgs.at(-1))).toBe(`m-${total - 1}`)

      const disk = Array.from({ length: 1500 }, (_, i) =>
        makeFakeMessage(`d-${i}`),
      )
      const live = Array.from({ length: 1000 }, (_, i) =>
        makeFakeMessage(`l-${i}`),
      )
      const merged = mergeDiskAndLiveTranscriptMessages(disk, live)
      expect(merged.length).toBe(MAX_TASK_TRANSCRIPT_MESSAGES)
      expect(uuidOf(merged[0])).toBe('d-500')
      expect(uuidOf(merged.at(-1))).toBe('l-999')

      let state = { tasks: {}, transcripts: {} } as unknown as Parameters<
        Parameters<typeof createTaskRegistry>[1]
      >[0] extends (prev: infer S) => infer S
        ? S
        : never
      const registry = createTaskRegistry(
        () => state,
        updater => {
          state = updater(state)
        },
      )
      registry.updateTranscript('task-cap', prev => ({
        ...prev,
        messages: Array.from(
          { length: MAX_TASK_TRANSCRIPT_MESSAGES + 25 },
          (_, i) => makeFakeMessage(`u-${i}`),
        ),
      }))
      const stored = registry.getTranscript('task-cap')
      expect(stored?.messages.length).toBe(MAX_TASK_TRANSCRIPT_MESSAGES)
      expect(uuidOf(stored?.messages[0])).toBe('u-25')
    })

    test('PromptInput & REPL render-body side effects and transcript cleanup invariants', () => {
      const promptSrc = readFileSync(
        join(REPO_ROOT, 'src/components/PromptInput/PromptInput.tsx'),
        'utf8',
      )
      expect(promptSrc).toContain('const MAX_REMOVED_PASTED_CONTENTS = 10')
      expect(promptSrc).toContain('removedPastedContentsOrderRef')
      expect(promptSrc).toContain('const onImagePaste = useCallback(')
      expect(promptSrc).toContain(
        '}, [mode, captureImagePasteAnchor, addNotification, onImagePaste])',
      )
      // promptChangeCoordinatorRef.current.changed moved into useLayoutEffect
      expect(promptSrc).toMatch(
        /useLayoutEffect\(\(\) => \{\s*const ext = pendingExternalChangeRef\.current;/,
      )

      const replSandboxSrc = readFileSync(
        join(REPO_ROOT, 'src/screens/repl/useReplSandboxAndPermissions.tsx'),
        'utf8',
      )
      // SandboxManager.initialize moved into useEffect
      expect(replSandboxSrc).toMatch(
        /useEffect\(\(\) => \{\s*if \(SandboxManager\.isSandboxingEnabled\(\)\)/,
      )
      const replBgAdoptSrc = readFileSync(
        join(REPO_ROOT, 'src/screens/repl/useReplBgAdopt.ts'),
        'utf8',
      )
      // removeTask deletes prev.transcripts[taskId] alongside prev.tasks[taskId]
      expect(replBgAdoptSrc).toContain(
        'const { [taskId]: _removedTranscript, ...restTranscripts } =\n',
      )
    })
  })

  // =========================================================================
  // E2-P2-9: moveCursorBelowFrame() post-uncover cursor position (no double move)
  // =========================================================================
  describe('E2-P2-9: Ink.moveCursorBelowFrame() avoids double cursor move after uncover()', () => {
    test('moveCursorBelowFrame uncovers and lands at frontFrame.cursor without appending a duplicate cursorMove', () => {
      const stdout = makeTtyStdout(40, 6)
      const stdin = makeTtyStdin()
      const ink = new Ink({
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
        newRenderer: true,
      })

      try {
        const inkInternal = ink as unknown as {
          stylePool: StylePool
          charPool: CharPool
          hyperlinkPool: HyperlinkPool
          frontFrame: {
            screen: ReturnType<typeof createScreen>
            top?: number
            viewport: { width: number; height: number }
            cursor: { x: number; y: number; visible: boolean }
          }
          displayCursor: { x: number; y: number; emittedRows: number } | null
          renderers: NonNullable<ReturnType<typeof createNewRenderers>>
        }

        const screen = createScreen(
          40,
          10,
          inkInternal.stylePool,
          inkInternal.charPool,
          inkInternal.hyperlinkPool,
        )
        for (let r = 0; r < 10; r++) {
          setCellAt(screen, 0, r, makeCell(String(r), CellWidth.Narrow))
        }
        const emptyScreen = createScreen(
          40,
          0,
          inkInternal.stylePool,
          inkInternal.charPool,
          inkInternal.hyperlinkPool,
        )
        const caps = getTerminalRenderCapabilities()

        // Establish a covered state with a popover at row 7 (height 2) and cursor at (5, 7)
        inkInternal.renderers.covering.render(
          {
            screen: emptyScreen,
            top: 0,
            viewport: { width: 40, height: 6 },
            cursor: { x: 0, y: 0, visible: false },
          },
          {
            screen,
            top: 0,
            viewport: { width: 40, height: 6 },
            cursor: { x: 5, y: 7, visible: true },
            popover: { top: 7, height: 2 },
          },
          caps,
        )

        expect(
          inkInternal.renderers.covering.countIn({ screen }),
        ).toBeGreaterThan(0)

        inkInternal.frontFrame = {
          screen,
          top: 0,
          viewport: { width: 40, height: 6 },
          cursor: { x: 0, y: 10, visible: false },
        }
        inkInternal.displayCursor = { x: 5, y: 7, emittedRows: 6 }

        const seq = ink.moveCursorBelowFrame()

        expect(seq.length).toBeGreaterThan(0)
        expect(inkInternal.displayCursor).toBeNull()
        // Should NOT contain the stale post-uncover relative move (left 5 + down 3)
        expect(seq).not.toContain('\x1b[5D\x1b[3B')
        // And post-uncover cursor should already be at frontFrame.cursor (0, 10)
        expect(inkInternal.renderers.inline.lastCursor).toEqual({ x: 0, y: 10 })
      } finally {
        ink.unmount()
      }
    })
  })

  // =========================================================================
  // E2-P2-10: SearchBox grapheme offsetAtColumn & DialogWait non-descendant
  // =========================================================================
  describe('E2-P2-10: SearchBox grapheme click mapping & DialogWait non-descendant check', () => {
    test('offsetAtColumn segments by grapheme clusters and never splits ZWJ emoji or combining marks', () => {
      const family = '👨‍👩‍👧‍👦'
      const line = `${family}abc`
      // Col 0 -> 0; Col 1 (inside width-2 emoji) -> 0 (never mid-emoji!)
      expect(offsetAtColumn(line, 0)).toBe(0)
      expect(offsetAtColumn(line, 1)).toBe(0)
      // Col 2 -> right after entire ZWJ grapheme cluster
      expect(offsetAtColumn(line, 2)).toBe(family.length)
      expect(offsetAtColumn(line, 3)).toBe(family.length + 1)

      const skin = '👍🏽x'
      expect(offsetAtColumn(skin, 1)).toBe(0)
      expect(offsetAtColumn(skin, 2)).toBe('👍🏽'.length)
      expect(offsetAtColumn(skin, 3)).toBe(skin.length)

      const accented = 'e\u0301z'
      expect(offsetAtColumn(accented, 1)).toBe('e\u0301'.length)
      expect(offsetAtColumn(accented, 2)).toBe(accented.length)
    })

    test('activeElementReachesBottom returns false when activeElement is NOT a descendant of parent', () => {
      const root = createNode('ink-root')
      const dialogBox = createNode('ink-box')
      const dialogWait = createNode('ink-box')
      const unrelatedBranch = createNode('ink-box')
      const unrelatedActive = createNode('ink-box')

      setStyle(root, { flexDirection: 'column', width: 40, height: 20 })
      setStyle(dialogBox, { flexDirection: 'column', height: 5 })
      setStyle(dialogWait, { height: 1 })
      setStyle(unrelatedBranch, { flexDirection: 'column', height: 10 })
      setStyle(unrelatedActive, { height: 8 })

      appendChildNode(dialogBox, dialogWait)
      appendChildNode(unrelatedBranch, unrelatedActive)
      appendChildNode(root, dialogBox)
      appendChildNode(root, unrelatedBranch)
      root.yogaNode!.calculateLayout(40, 20)

      const fm = new FocusManager(() => true)
      root.focusManager = fm

      // Focus an unrelated element whose height (8) > dialogBox height (5)
      fm.focus(unrelatedActive)
      expect(activeElementReachesBottom(dialogWait)).toBe(false)

      // Focus a real descendant reaching the bottom of dialogBox
      const bottomChild = createNode('ink-box')
      setStyle(bottomChild, { height: 4 })
      appendChildNode(dialogBox, bottomChild)
      root.yogaNode!.calculateLayout(40, 20)
      fm.focus(bottomChild)
      expect(activeElementReachesBottom(dialogWait)).toBe(true)
    })
  })
})
