import { afterEach, describe, expect, mock, test } from 'bun:test'
import { openSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import * as React from 'react'
import { ModalScroller } from '../../../../../../src/components/ModalScroller.js'
import { type Clock, ClockContext } from '../../components/ClockContext.js'
import { Box, Text, ThemeProvider } from '../../index.js'
import {
  appendChildNode,
  createNode,
  type DOMElement,
  setStyle,
} from '../dom.js'
import { FocusManager } from '../focus.js'
import {
  getInkHostAdapter,
  getInkHostAdapterGeneration,
  registerInkHostAdapter,
  resetInkHostAdapterForTests,
} from '../hostAdapter.js'
import Ink from '../ink.js'
import {
  bindInkSessionHost,
  resetInkSessionHostForTests,
} from '../instances.js'
import {
  _setProbeFdOverrideForTests,
  isNonBlockingStdoutInstalled,
  resetNonBlockingStdoutRemoteFlagForTests,
  shouldInstallNonBlockingStdout,
} from '../nonBlockingStdout.js'
import reconciler from '../reconciler.js'
import {
  blitRegion,
  type Cell,
  CellWidth,
  CharPool,
  cellAt,
  clearRegion,
  createScreen,
  HyperlinkPool,
  type Screen,
  StylePool,
  setCellAt,
} from '../screen.js'
import {
  isDecstbmRendererEnabled,
  isNativeCursorEnabled,
  resetTerminalProbeForTests,
  setSynchronizedOutputSupported,
} from '../terminal.js'
import { wrapAnsiFallback } from '../wrapAnsi.js'

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

function makeCell(char: string, width: CellWidth): Cell {
  return { char, styleId: 0, width, hyperlink: undefined }
}

function getScreenDamage(screen: Screen) {
  return screen.damage
}

function writeWideSpan(
  screen: Screen,
  x: number,
  y: number,
  char: string,
  width: number,
): void {
  setCellAt(screen, x, y, makeCell(char, CellWidth.Wide))
  for (let k = 2; k < width; k++) {
    setCellAt(screen, x + k, y, makeCell('', CellWidth.SpacerTail))
  }
}

describe('Re-Audit Ink Fixes (2.1.331)', () => {
  afterEach(() => {
    _setProbeFdOverrideForTests(undefined)
    resetInkSessionHostForTests()
    resetNonBlockingStdoutRemoteFlagForTests()
    resetTerminalProbeForTests()
  })

  // =========================================================================
  // P1-B1: HostAdapter generation invalidates pre-registration terminal pins
  // =========================================================================
  describe('P1-B1: hostAdapter generation invalidation for terminal pins', () => {
    test('late registerInkHostAdapter immediately invalidates pre-registration decstbmRendererEnabled and nativeCursorEnabled pins', () => {
      const prevAdapter = resetInkHostAdapterForTests()
      const origIsTTY = process.stdout.isTTY
      const savedEnv = {
        CLAUDE_CODE_DECSTBM: process.env.CLAUDE_CODE_DECSTBM,
        CLAUDE_CODE_NATIVE_CURSOR: process.env.CLAUDE_CODE_NATIVE_CURSOR,
        CLAUDE_CODE_ACCESSIBILITY: process.env.CLAUDE_CODE_ACCESSIBILITY,
        CLAUDE_AX_SCREEN_READER: process.env.CLAUDE_AX_SCREEN_READER,
        INK_SCREEN_READER: process.env.INK_SCREEN_READER,
        CLAUDE_BG_BACKEND: process.env.CLAUDE_BG_BACKEND,
        TMUX: process.env.TMUX,
        ZELLIJ: process.env.ZELLIJ,
        WT_SESSION: process.env.WT_SESSION,
        TERM_PROGRAM: process.env.TERM_PROGRAM,
        TERMINAL_EMULATOR: process.env.TERMINAL_EMULATOR,
        CLAUDE_CODE_NONBLOCKING_STDOUT:
          process.env.CLAUDE_CODE_NONBLOCKING_STDOUT,
      }
      try {
        for (const key of Object.keys(savedEnv) as Array<
          keyof typeof savedEnv
        >) {
          delete process.env[key]
        }
        Object.defineProperty(process.stdout, 'isTTY', {
          value: true,
          configurable: true,
        })

        const host = {}
        bindInkSessionHost(() => host)
        resetTerminalProbeForTests()
        setSynchronizedOutputSupported(true)

        const gen0 = getInkHostAdapterGeneration()
        expect(getInkHostAdapter()).toEqual({})
        // Pre-registration calls fall back to false without host callbacks
        expect(isDecstbmRendererEnabled()).toBe(false)
        expect(isNativeCursorEnabled()).toBe(false)
        expect(shouldInstallNonBlockingStdout()).toBe(false)

        // Late registration enables marlin_porch -> decstbmRendererEnabled flips to true
        // WITHOUT calling resetTerminalProbeForTests()!
        registerInkHostAdapter({
          getFeatureFlag: <T>(name: string, defaultValue: T): T => {
            if (name === 'tengu_marlin_porch') return true as unknown as T
            if (name === 'tengu_event_loop_stall') return true as unknown as T
            return defaultValue
          },
          isScreenReaderModeEnabled: () => false,
          isTmuxControlMode: () => false,
        })
        expect(getInkHostAdapterGeneration()).toBe(gen0 + 1)
        expect(isDecstbmRendererEnabled()).toBe(true)
        // decstbm=true suppresses nativeCursor unless screen reader / accessibility is on
        expect(isNativeCursorEnabled()).toBe(false)
        expect(shouldInstallNonBlockingStdout()).toBe(true)

        // Re-registering with tengu_native_cursor=true and marlin_porch=false immediately flips both
        registerInkHostAdapter({
          getFeatureFlag: <T>(name: string, defaultValue: T): T => {
            if (name === 'tengu_native_cursor') return true as unknown as T
            return defaultValue
          },
          isScreenReaderModeEnabled: () => false,
          isTmuxControlMode: () => false,
        })
        expect(getInkHostAdapterGeneration()).toBe(gen0 + 2)
        expect(isDecstbmRendererEnabled()).toBe(false)
        expect(isNativeCursorEnabled()).toBe(true)

        // Re-registering with isScreenReaderModeEnabled() -> true enables nativeCursor and disables DECSTBM
        registerInkHostAdapter({
          getFeatureFlag: <T>(_name: string, defaultValue: T): T =>
            defaultValue,
          isScreenReaderModeEnabled: () => true,
          isTmuxControlMode: () => false,
        })
        expect(isDecstbmRendererEnabled()).toBe(false)
        expect(isNativeCursorEnabled()).toBe(true)
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', {
          value: origIsTTY,
          configurable: true,
        })
        for (const [k, v] of Object.entries(savedEnv)) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
        resetInkHostAdapterForTests(prevAdapter)
      }
    })
  })

  // =========================================================================
  // P1-B2: Hidden subtree focus escape, reverse autoFocusStack scan, ModalScroller blur
  // =========================================================================
  describe('P1-B2: FocusManager.handleNodeHidden, autoFocusStack reverse scan, reconciler & ModalScroller', () => {
    test('handleNodeHidden blurs focused descendant and restores from focusStack or reverse autoFocusStack scan', () => {
      const root = createNode('ink-root')
      const baseAuto = createNode('ink-box')
      baseAuto.attributes.id = 'baseAuto'
      const hiddenAutoContainer = createNode('ink-box')
      const hiddenAuto = createNode('ink-box')
      hiddenAuto.attributes.id = 'hiddenAuto'
      appendChildNode(hiddenAutoContainer, hiddenAuto)

      const modal = createNode('ink-box')
      const modalInner = createNode('ink-box')
      modalInner.attributes.id = 'modalInner'
      appendChildNode(modal, modalInner)

      appendChildNode(root, baseAuto)
      appendChildNode(root, hiddenAutoContainer)
      appendChildNode(root, modal)

      const events: string[] = []
      const fm = new FocusManager((target, ev) => {
        events.push(`${ev.type}:${String(target.attributes.id ?? '?')}`)
        return true
      })
      root.focusManager = fm

      // Push two autoFocus fallbacks; hide the top one (hiddenAutoContainer)
      fm.pushAutoFocusFallback(baseAuto)
      fm.pushAutoFocusFallback(hiddenAuto)
      hiddenAutoContainer.isHidden = true

      // Focus modalInner directly (empty focusStack)
      fm.focus(modalInner)
      expect(fm.activeElement).toBe(modalInner)

      // Hide modal -> must blur modalInner, skip hiddenAuto at top of autoFocusStack,
      // and reverse-scan down to visible baseAuto!
      modal.isHidden = true
      fm.handleNodeHidden(modal, root)
      expect(fm.activeElement).toBe(baseAuto)
      expect(events).toEqual([
        'focus:modalInner',
        'blur:modalInner',
        'focus:baseAuto',
      ])

      // Calling handleNodeHidden on an unrelated node does NOT disturb activeElement
      const unrelated = createNode('ink-box')
      appendChildNode(root, unrelated)
      unrelated.isHidden = true
      fm.handleNodeHidden(unrelated, root)
      expect(fm.activeElement).toBe(baseAuto)
      expect(events).toHaveLength(3)
    })

    test('handleNodeRemoved reverse-scans autoFocusStack past hidden top entries', () => {
      const root = createNode('ink-root')
      const visibleAuto = createNode('ink-box')
      const hiddenAuto = createNode('ink-box')
      setStyle(hiddenAuto, { display: 'none' })
      const ephemeral = createNode('ink-box')

      appendChildNode(root, visibleAuto)
      appendChildNode(root, hiddenAuto)
      appendChildNode(root, ephemeral)

      const fm = new FocusManager(() => true)
      root.focusManager = fm

      fm.pushAutoFocusFallback(visibleAuto)
      fm.pushAutoFocusFallback(hiddenAuto)
      fm.focus(ephemeral)
      expect(fm.activeElement).toBe(ephemeral)

      // Detach ephemeral and notify focusManager
      ephemeral.parentNode = undefined
      fm.handleNodeRemoved(ephemeral, root)
      expect(fm.activeElement).toBe(visibleAuto)
    })

    test('reconciler.hideInstance and dom setStyle(display:none) / commitUpdate release trapped focus', async () => {
      // Direct reconciler.hideInstance & setStyle test
      const root = createNode('ink-root')
      const a = createNode('ink-box')
      const bWrap = createNode('ink-box')
      const bChild = createNode('ink-box')
      appendChildNode(bWrap, bChild)
      appendChildNode(root, a)
      appendChildNode(root, bWrap)

      const fm = new FocusManager(() => true)
      root.focusManager = fm

      fm.focus(a)
      fm.focus(bChild)
      expect(fm.activeElement).toBe(bChild)

      // Direct setStyle display:none releases focus back to a
      setStyle(bWrap, { display: 'none' })
      expect(fm.activeElement).toBe(a)

      // Reveal, refocus, and hide via reconciler hideInstance path (simulated)
      setStyle(bWrap, { display: 'flex' })
      fm.focus(bChild)
      expect(fm.activeElement).toBe(bChild)
      // Trigger commitUpdate display transition via real Ink render
      const stdout = makeTtyStdout(60, 20)
      const stdin = makeTtyStdin()
      const ink = new Ink({
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      })

      const promptRef: { current: DOMElement | null } = { current: null }
      const panelInnerRef: { current: DOMElement | null } = { current: null }

      function Harness({ panelHidden }: { panelHidden: boolean }) {
        return withChild(
          ThemeProvider,
          { initialState: 'dark' },
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
              { display: panelHidden ? 'none' : 'flex' },
              React.createElement(
                Box,
                {
                  ref: (el: DOMElement | null) => {
                    panelInnerRef.current = el
                  },
                },
                React.createElement(Text, null, 'Panel'),
              ),
            ),
          ),
        )
      }

      const flush = async () => {
        reconciler.flushSyncWork()
        await new Promise(resolve => setTimeout(resolve, 15))
      }

      try {
        ink.render(React.createElement(Harness, { panelHidden: false }))
        await flush()
        const inkFm = (ink as unknown as { rootNode: DOMElement }).rootNode
          .focusManager!
        inkFm.focus(promptRef.current!)
        inkFm.focus(panelInnerRef.current!)
        expect(inkFm.activeElement).toBe(panelInnerRef.current)

        // Transition panel Box to display: 'none' -> activeElement escapes back to promptRef
        ink.render(React.createElement(Harness, { panelHidden: true }))
        await flush()
        expect(inkFm.activeElement).toBe(promptRef.current)
      } finally {
        ink.unmount()
      }
    })

    test('reconciler.hideInstance (via React Suspense) blurs focused hidden subtree and restores focus', async () => {
      const stdout = makeTtyStdout(60, 20)
      const stdin = makeTtyStdin()
      const ink = new Ink({
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      })

      const baseRef: { current: DOMElement | null } = { current: null }
      const suspendTargetRef: { current: DOMElement | null } = { current: null }
      const pending = Promise.withResolvers<void>()

      function Suspendable({ shouldSuspend }: { shouldSuspend: boolean }) {
        if (shouldSuspend) {
          throw pending.promise
        }
        return React.createElement(Text, null, 'Ready')
      }

      function Harness({ shouldSuspend }: { shouldSuspend: boolean }) {
        return withChild(
          ThemeProvider,
          { initialState: 'dark' },
          React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(
              Box,
              {
                ref: (el: DOMElement | null) => {
                  baseRef.current = el
                },
              },
              React.createElement(Text, null, 'Base'),
            ),
            React.createElement(
              React.Suspense,
              { fallback: React.createElement(Text, null, 'Loading...') },
              React.createElement(
                Box,
                {
                  ref: (el: DOMElement | null) => {
                    if (el) suspendTargetRef.current = el
                  },
                },
                React.createElement(Suspendable, { shouldSuspend }),
              ),
            ),
          ),
        )
      }

      const flush = async () => {
        reconciler.flushSyncWork()
        await new Promise(resolve => setTimeout(resolve, 15))
      }

      try {
        ink.render(React.createElement(Harness, { shouldSuspend: false }))
        await flush()
        const fm = (ink as unknown as { rootNode: DOMElement }).rootNode
          .focusManager!
        expect(baseRef.current).not.toBeNull()
        expect(suspendTargetRef.current).not.toBeNull()
        const suspendedNode = suspendTargetRef.current!

        fm.focus(baseRef.current!)
        fm.focus(suspendedNode)
        expect(fm.activeElement).toBe(suspendedNode)

        // Trigger React Suspense -> react-reconciler calls hideInstance() on the hidden Box
        ink.render(React.createElement(Harness, { shouldSuspend: true }))
        await flush()
        expect(suspendedNode.isHidden).toBe(true)
        expect(fm.activeElement).toBe(baseRef.current)
      } finally {
        pending.resolve()
        ink.unmount()
      }
    })

    test('ModalScroller blurs active focus inside wrapRef when visible transitions true -> false without display:none', async () => {
      const stdout = makeTtyStdout(60, 20)
      const stdin = makeTtyStdin()
      const ink = new Ink({
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      })

      const fakeClock: Clock = {
        now: () => 1000,
        setTimeout: () => () => {},
        subscribeFollower: () => () => {},
        subscribeKeepAlive: () => () => {},
        setTickInterval: () => {},
      }

      const outsideRef: { current: DOMElement | null } = { current: null }

      function Harness({ visible }: { visible: boolean }) {
        return withChild(
          ThemeProvider,
          { initialState: 'dark' },
          React.createElement(
            ClockContext.Provider,
            { value: fakeClock },
            React.createElement(
              Box,
              { flexDirection: 'column' },
              React.createElement(
                Box,
                {
                  ref: (el: DOMElement | null) => {
                    outsideRef.current = el
                  },
                },
                React.createElement(Text, null, 'Outside'),
              ),
              withChild(
                ModalScroller,
                { maxRows: 10, visible },
                React.createElement(Text, null, 'Modal body'),
              ),
            ),
          ),
        )
      }

      const flush = async () => {
        reconciler.flushSyncWork()
        await new Promise(resolve => setTimeout(resolve, 15))
      }

      try {
        ink.render(React.createElement(Harness, { visible: true }))
        await flush()
        const fm = (ink as unknown as { rootNode: DOMElement }).rootNode
          .focusManager!
        expect(fm.activeElement).not.toBeNull()
        expect(fm.activeElement).not.toBe(outsideRef.current)

        // Flipping visible true -> false blurs focus inside ModalScroller
        ink.render(React.createElement(Harness, { visible: false }))
        await flush()
        expect(fm.activeElement).toBeNull()

        // If focus is outside ModalScroller when visible flips true -> false, do NOT blur it
        ink.render(React.createElement(Harness, { visible: true }))
        await flush()
        fm.focus(outsideRef.current!)
        expect(fm.activeElement).toBe(outsideRef.current)
        ink.render(React.createElement(Harness, { visible: false }))
        await flush()
        expect(fm.activeElement).toBe(outsideRef.current)
      } finally {
        ink.unmount()
      }
    })
  })

  // =========================================================================
  // P1-B5: Ink.unmount() and Ink.detachForShutdown() restore nonBlockingStdout & cancelAll
  // =========================================================================
  describe('P1-B5: Ink.unmount() and detachForShutdown() restore nonBlockingStdout and cancel scheduler', () => {
    test('Ink.unmount() flushes, restores, and clears nonBlockingStdout even if flush() throws', () => {
      const origWrite = process.stdout.write
      const prevEnv = process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
      process.env.CLAUDE_CODE_NONBLOCKING_STDOUT = '1'
      _setProbeFdOverrideForTests(() => ({ fd: openSync('/dev/null', 'w') }))

      try {
        const stdin = makeTtyStdin()
        const ink = new Ink({
          stdout: process.stdout,
          stdin: stdin as unknown as NodeJS.ReadStream,
          stderr: new PassThrough() as unknown as NodeJS.WriteStream,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        const inkInternal = ink as unknown as {
          nonBlockingStdout: { flush: () => void; restore: () => void } | null
        }
        expect(inkInternal.nonBlockingStdout).not.toBeNull()
        expect(isNonBlockingStdoutInstalled()).toBe(true)
        expect(process.stdout.write).not.toBe(origWrite)

        // Even if flush() throws, restore() must still run and clear nonBlockingStdout
        const handle = inkInternal.nonBlockingStdout!
        const origRestore = handle.restore
        let restoreCalls = 0
        handle.flush = () => {
          throw new Error('simulated flush failure')
        }
        handle.restore = () => {
          restoreCalls++
          origRestore()
        }

        expect(() => ink.unmount()).not.toThrow()
        expect(restoreCalls).toBe(1)
        expect(inkInternal.nonBlockingStdout).toBeNull()
        expect(isNonBlockingStdoutInstalled()).toBe(false)
        expect(process.stdout.write).toBe(origWrite)
      } finally {
        if (prevEnv === undefined) {
          delete process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
        } else {
          process.env.CLAUDE_CODE_NONBLOCKING_STDOUT = prevEnv
        }
      }
    })

    test('Ink.detachForShutdown() restores nonBlockingStdout, nulls it, and calls scheduler.cancelAll()', () => {
      const origWrite = process.stdout.write
      const prevEnv = process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
      process.env.CLAUDE_CODE_NONBLOCKING_STDOUT = '1'
      _setProbeFdOverrideForTests(() => ({ fd: openSync('/dev/null', 'w') }))

      try {
        const stdin = makeTtyStdin()
        const ink = new Ink({
          stdout: process.stdout,
          stdin: stdin as unknown as NodeJS.ReadStream,
          stderr: new PassThrough() as unknown as NodeJS.WriteStream,
          exitOnCtrlC: false,
          patchConsole: false,
        })
        const inkInternal = ink as unknown as {
          nonBlockingStdout: { flush: () => void; restore: () => void } | null
          scheduler: { cancelAll: () => void }
        }
        expect(inkInternal.nonBlockingStdout).not.toBeNull()
        expect(isNonBlockingStdoutInstalled()).toBe(true)

        const cancelAllSpy = mock(() => {})
        const origCancelAll = inkInternal.scheduler.cancelAll.bind(
          inkInternal.scheduler,
        )
        inkInternal.scheduler.cancelAll = () => {
          cancelAllSpy()
          origCancelAll()
        }

        ink.detachForShutdown()

        expect(inkInternal.nonBlockingStdout).toBeNull()
        expect(isNonBlockingStdoutInstalled()).toBe(false)
        expect(process.stdout.write).toBe(origWrite)
        expect(cancelAllSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
      } finally {
        if (prevEnv === undefined) {
          delete process.env.CLAUDE_CODE_NONBLOCKING_STDOUT
        } else {
          process.env.CLAUDE_CODE_NONBLOCKING_STDOUT = prevEnv
        }
      }
    })
  })

  // =========================================================================
  // P1-B6: clearRegion & blitRegion handle w >= 3 wide grapheme boundaries
  // =========================================================================
  describe('P1-B6: clearRegion and blitRegion w >= 3 boundary cleanup & damage expansion', () => {
    test('clearRegion clears owning Wide head and all contiguous SpacerTails across left/right edges for w >= 3', () => {
      const stylePool = new StylePool()
      const charPool = new CharPool()
      const linkPool = new HyperlinkPool()

      // Left boundary cuts at 2nd SpacerTail of w=3 span [1, 2, 3]
      const s1 = createScreen(10, 1, stylePool, charPool, linkPool)
      writeWideSpan(s1, 1, 0, '🏳️‍🌈', 3)
      setCellAt(s1, 4, 0, makeCell('X', CellWidth.Narrow))
      s1.damage = undefined
      clearRegion(s1, 3, 0, 2, 1) // clear [3, 5)
      expect(cellAt(s1, 1, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s1, 2, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s1, 3, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(s1)).toEqual({ x: 1, y: 0, width: 4, height: 1 })

      // Right boundary cuts at Wide head of w=3 span [3, 4, 5] -> clears cols 4 & 5
      const s2 = createScreen(10, 1, stylePool, charPool, linkPool)
      writeWideSpan(s2, 3, 0, '🏳️‍🌈', 3)
      setCellAt(s2, 6, 0, makeCell('Z', CellWidth.Narrow))
      s2.damage = undefined
      clearRegion(s2, 0, 0, 4, 1) // clear [0, 4)
      expect(cellAt(s2, 3, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s2, 4, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s2, 5, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(s2, 6, 0)).toMatchObject({
        char: 'Z',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(s2)).toEqual({ x: 0, y: 0, width: 6, height: 1 })

      // Right boundary cuts at 1st SpacerTail of w=3 span [2, 3, 4] -> clears col 4
      const s3 = createScreen(10, 1, stylePool, charPool, linkPool)
      writeWideSpan(s3, 2, 0, '🏳️‍🌈', 3)
      s3.damage = undefined
      clearRegion(s3, 0, 0, 4, 1) // clear [0, 4), maxX=4 is 2nd SpacerTail
      expect(cellAt(s3, 4, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(s3)).toEqual({ x: 0, y: 0, width: 5, height: 1 })

      // 1-column clear in the middle of a w=4 span [2, 3, 4, 5] clears all 4 cells
      const s4 = createScreen(10, 1, stylePool, charPool, linkPool)
      writeWideSpan(s4, 2, 0, '🏳️‍🌈', 4)
      s4.damage = undefined
      clearRegion(s4, 3, 0, 1, 1) // clear [3, 4)
      for (let col = 2; col <= 5; col++) {
        expect(cellAt(s4, col, 0)).toMatchObject({
          char: ' ',
          width: CellWidth.Narrow,
        })
      }
      expect(getScreenDamage(s4)).toEqual({ x: 2, y: 0, width: 4, height: 1 })
    })

    test('blitRegion clears orphaned heads and all contiguous SpacerTails across left/right edges for w >= 3', () => {
      const stylePool = new StylePool()
      const charPool = new CharPool()
      const linkPool = new HyperlinkPool()

      // Case 1: Left boundary cuts w=3 in dst at 2nd SpacerTail (col 3)
      const dst1 = createScreen(10, 1, stylePool, charPool, linkPool)
      const src1 = createScreen(10, 1, stylePool, charPool, linkPool)
      writeWideSpan(dst1, 1, 0, '🏳️‍🌈', 3)
      setCellAt(src1, 3, 0, makeCell('A', CellWidth.Narrow))
      setCellAt(src1, 4, 0, makeCell('B', CellWidth.Narrow))
      dst1.damage = undefined
      blitRegion(dst1, src1, 3, 0, 5, 1)
      expect(cellAt(dst1, 1, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(dst1, 2, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(dst1, 3, 0)).toMatchObject({
        char: 'A',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(dst1)).toEqual({ x: 1, y: 0, width: 4, height: 1 })

      // Case 2: Left boundary preserves intact w=2 char ending at regionX - 1
      const dst2 = createScreen(10, 1, stylePool, charPool, linkPool)
      const src2 = createScreen(10, 1, stylePool, charPool, linkPool)
      setCellAt(dst2, 0, 0, makeCell('中', CellWidth.Wide))
      setCellAt(dst2, 2, 0, makeCell('X', CellWidth.Narrow))
      setCellAt(src2, 2, 0, makeCell('A', CellWidth.Narrow))
      dst2.damage = undefined
      blitRegion(dst2, src2, 2, 0, 3, 1)
      expect(cellAt(dst2, 0, 0)).toMatchObject({
        char: '中',
        width: CellWidth.Wide,
      })
      expect(cellAt(dst2, 1, 0)).toMatchObject({ width: CellWidth.SpacerTail })
      expect(cellAt(dst2, 2, 0)).toMatchObject({
        char: 'A',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(dst2)).toEqual({ x: 2, y: 0, width: 1, height: 1 })

      // Case 3: Left boundary blitting orphaned w=3 tails from src clears BOTH tails
      const dst3 = createScreen(10, 1, stylePool, charPool, linkPool)
      const src3 = createScreen(10, 1, stylePool, charPool, linkPool)
      setCellAt(dst3, 1, 0, makeCell('X', CellWidth.Narrow))
      writeWideSpan(src3, 1, 0, '🏳️‍🌈', 3)
      setCellAt(src3, 4, 0, makeCell('Q', CellWidth.Narrow))
      dst3.damage = undefined
      blitRegion(dst3, src3, 2, 0, 5, 1)
      expect(cellAt(dst3, 1, 0)).toMatchObject({
        char: 'X',
        width: CellWidth.Narrow,
      })
      expect(cellAt(dst3, 2, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(dst3, 3, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(dst3, 4, 0)).toMatchObject({
        char: 'Q',
        width: CellWidth.Narrow,
      })

      // Case 4: Right boundary overwrites head of w=3 in dst with Narrow -> clears cols 3 & 4
      const dst4 = createScreen(10, 1, stylePool, charPool, linkPool)
      const src4 = createScreen(10, 1, stylePool, charPool, linkPool)
      writeWideSpan(dst4, 2, 0, '🏳️‍🌈', 3)
      setCellAt(dst4, 5, 0, makeCell('Z', CellWidth.Narrow))
      setCellAt(src4, 2, 0, makeCell('C', CellWidth.Narrow))
      dst4.damage = undefined
      blitRegion(dst4, src4, 0, 0, 3, 1)
      expect(cellAt(dst4, 2, 0)).toMatchObject({
        char: 'C',
        width: CellWidth.Narrow,
      })
      expect(cellAt(dst4, 3, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(dst4, 4, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(dst4, 5, 0)).toMatchObject({
        char: 'Z',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(dst4)).toEqual({ x: 0, y: 0, width: 5, height: 1 })

      // Case 5: Right boundary blits w=3 head at maxX-1 colliding with w=3 in dst at maxX
      const dst5 = createScreen(10, 1, stylePool, charPool, linkPool)
      const src5 = createScreen(10, 1, stylePool, charPool, linkPool)
      writeWideSpan(dst5, 3, 0, '👨‍👩‍👧‍👦', 3) // cols 3, 4, 5
      setCellAt(dst5, 6, 0, makeCell('Z', CellWidth.Narrow))
      writeWideSpan(src5, 2, 0, '🏳️‍🌈', 3) // cols 2, 3, 4
      dst5.damage = undefined
      blitRegion(dst5, src5, 0, 0, 3, 1) // copies cols [0, 3), Wide head at col 2
      expect(cellAt(dst5, 2, 0)).toMatchObject({
        char: '🏳️‍🌈',
        width: CellWidth.Wide,
      })
      expect(cellAt(dst5, 3, 0)).toMatchObject({ width: CellWidth.SpacerTail })
      expect(cellAt(dst5, 4, 0)).toMatchObject({ width: CellWidth.SpacerTail })
      expect(cellAt(dst5, 5, 0)).toMatchObject({
        char: ' ',
        width: CellWidth.Narrow,
      })
      expect(cellAt(dst5, 6, 0)).toMatchObject({
        char: 'Z',
        width: CellWidth.Narrow,
      })
      expect(getScreenDamage(dst5)).toEqual({ x: 0, y: 0, width: 6, height: 1 })
    })
  })

  // =========================================================================
  // P2-5: wrapAnsiFallback parity with Bun.wrapAnsi on \r, \t, and hard:true
  // =========================================================================
  describe('P2-5: wrapAnsiFallback matches Bun.wrapAnsi on standalone \\r, \\t, and hard:true mid-line overlong words', () => {
    test('matches Bun.wrapAnsi across standalone \\r, \\t, and hard:true matrix', () => {
      const cases: Array<
        [
          string,
          number,
          { hard?: boolean; trim?: boolean; wordWrap?: boolean }?,
        ]
      > = [
        // Standalone \r and mixed line endings
        ['a\rb', 5],
        ['a\r\nb', 5],
        ['a\r\rb', 5],
        ['a\r\nb\rc\nd', 10],
        ['hello\rworld', 10],
        // Tabs preserved (not treated as word-break spaces or stripped)
        ['a\tb', 10],
        ['\tabc', 5, { trim: true }],
        ['\tabc', 5, { trim: false }],
        ['abc\t  ', 5, { trim: true }],
        ['a \t b', 5, { trim: true }],
        ['hello\tworld', 8, { hard: false, trim: true }],
        ['hello\tworld', 8, { hard: true, trim: true }],
        ['\x1b[31mhello\tworld\x1b[39m', 8, { hard: true }],
        ['\x1b[31mhello\tworld\x1b[39m', 8, { hard: false }],
        ['a\tsuperlongword', 5, { hard: true }],
        // hard: true mid-line overlong words (fills remaining space when line-count optimal)
        ['a superlongword', 5, { hard: true }],
        ['hi superlongword', 5, { hard: true }],
        ['a superlongword', 5, { hard: true, trim: false }],
        ['hi superlongword', 5, { hard: true, trim: false }],
        ['foo barbazqux', 8, { hard: true }],
        ['a 123456', 5, { hard: true }],
        ['a 12345678', 5, { hard: true }],
        ['a 1234567890', 5, { hard: true }],
        ['a 12345678901', 5, { hard: true }],
        ['ab 1234567', 5, { hard: true }],
        ['ab 12345678', 5, { hard: true }],
        ['abc 123456', 5, { hard: true }],
        ['abc 1234567', 5, { hard: true }],
        ['a 中华人', 5, { hard: true }],
        ['ab 中华人', 5, { hard: true }],
        ['abc 中华人', 5, { hard: true }],
        ['a \x1b[31msuperlongword\x1b[39m', 5, { hard: true }],
        ['\x1b[31ma superlongword\x1b[39m', 5, { hard: true }],
        ['a \x1b[31m中华人\x1b[39m', 5, { hard: true }],
      ]

      const bunWrap =
        typeof Bun !== 'undefined' && typeof Bun.wrapAnsi === 'function'
          ? Bun.wrapAnsi
          : undefined
      expect(bunWrap).toBeDefined()

      for (const [input, cols, opts] of cases) {
        expect(wrapAnsiFallback(input, cols, opts)).toBe(
          bunWrap!(input, cols, opts),
        )
      }
    })
  })
})
