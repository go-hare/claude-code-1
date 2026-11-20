import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import {
  _resetSigcontResumeGraceForTesting,
  getLastResumedAt,
  isInSigcontResumeGrace,
  noteResumed,
  SIGCONT_RESUME_GRACE_MS,
} from '../../components/InputNowContext.js'
import {
  eraseViewportInPlace,
  eraseViewportInPlaceForGhostty,
  isGhosttyErasedRowsStayJoined,
} from '../clearTerminal.js'
import { clampChalkLevelForTmux } from '../colorize.js'
import { createNode, rebuildYogaSubtree } from '../dom.js'
import { LayoutDisplay } from '../layout/node.js'
import { KeyboardEvent } from '../events/keyboard-event.js'
import instances, { resetEverMountedForTests } from '../instances.js'
import {
  INITIAL_STATE,
  isEscPrefixedKey,
  isKonsoleTerminal,
  parseMultipleKeypresses,
} from '../parse-keypress.js'
import {
  CharPool,
  createScreen,
  HyperlinkPool,
  StylePool,
  setCellAt,
} from '../screen.js'
import {
  captureScrolledRows,
  createSelectionState,
  getSelectedText,
  startSelection,
  updateSelection,
} from '../selection.js'
import { packSoftWrap } from '../softWrap.js'
import { supportsHyperlinkStream } from '../supports-hyperlinks.js'
import { spawnDetachedClipboardCopy } from '../termio/osc.js'
import { Cursor } from '../utils/Cursor.js'

const INK_SRC = path.resolve(import.meta.dir, '../..')

describe('Wave 327-328 Ink Core & Input Suite', () => {
  afterEach(() => {
    _resetSigcontResumeGraceForTesting()
    resetEverMountedForTests()
  })

  test('#604 clamps truecolor to 256-color under GNU screen ($STY) and $TMUX unless override set', () => {
    const screenTarget: { level: 0 | 1 | 2 | 3 } = { level: 3 }
    expect(
      clampChalkLevelForTmux({ STY: '12345.pts-0.host' }, screenTarget),
    ).toBe(true)
    expect(screenTarget.level).toBe(2)

    const tmuxTarget: { level: 0 | 1 | 2 | 3 } = { level: 3 }
    expect(
      clampChalkLevelForTmux({ TMUX: '/tmp/tmux-1000/default' }, tmuxTarget),
    ).toBe(true)
    expect(tmuxTarget.level).toBe(2)

    const overrideTarget: { level: 0 | 1 | 2 | 3 } = { level: 3 }
    expect(
      clampChalkLevelForTmux(
        { STY: '12345.pts-0.host', CLAUDE_CODE_TMUX_TRUECOLOR: '1' },
        overrideTarget,
      ),
    ).toBe(false)
    expect(overrideTarget.level).toBe(3)

    const plainTarget: { level: 0 | 1 | 2 | 3 } = { level: 3 }
    expect(clampChalkLevelForTmux({}, plainTarget)).toBe(false)
    expect(plainTarget.level).toBe(3)
  })

  test('#451a Ghostty eraseViewportInPlace emits CSI K per row so erased rows do not stay joined', () => {
    expect(isGhosttyErasedRowsStayJoined({ TERM: 'xterm-ghostty' })).toBe(true)
    expect(isGhosttyErasedRowsStayJoined({ TERM_PROGRAM: 'ghostty' })).toBe(
      true,
    )
    expect(isGhosttyErasedRowsStayJoined({ TERM: 'xterm-256color' })).toBe(
      false,
    )

    const ghosttySeq = eraseViewportInPlace(3, true)
    expect(ghosttySeq).toBe(eraseViewportInPlaceForGhostty(3))
    expect(ghosttySeq).toBe(
      '\x1b[H\x1b[2K' + '\x1b[K\x1b[1B'.repeat(3) + '\x1b[H',
    )

    const normalSeq = eraseViewportInPlace(3, false)
    expect(normalSeq).toBe('\x1b[H' + '\x1b[2K\x1b[1B'.repeat(3) + '\x1b[H')
  })

  test('#451b supportsHyperlinkStream rejects WT_SESSION inside tmux and VTE 0.50.0', () => {
    const tty = { isTTY: true }
    // Windows Terminal outside tmux → true
    expect(
      supportsHyperlinkStream(
        tty,
        { WT_SESSION: 'abc', TERM: 'xterm-256color' },
        undefined,
        [],
      ),
    ).toBe(true)
    // Windows Terminal inside tmux → false (must fall through to tmux >= 3.4 check)
    expect(
      supportsHyperlinkStream(
        tty,
        { WT_SESSION: 'abc', TMUX: '/tmp/tmux/1', TERM: 'tmux-256color' },
        undefined,
        [],
      ),
    ).toBe(false)
    expect(
      supportsHyperlinkStream(
        tty,
        { WT_SESSION: 'abc', TERM_PROGRAM: 'tmux', TERM: 'xterm-256color' },
        undefined,
        [],
      ),
    ).toBe(false)
    // VTE 0.50.0 / 5000 → false; VTE 5001 / 0.50.1 → true
    expect(
      supportsHyperlinkStream(
        tty,
        { VTE_VERSION: '5000', TERM: 'xterm-256color' },
        undefined,
        [],
      ),
    ).toBe(false)
    expect(
      supportsHyperlinkStream(
        tty,
        { VTE_VERSION: '0.50.0', TERM: 'xterm-256color' },
        undefined,
        [],
      ),
    ).toBe(false)
    expect(
      supportsHyperlinkStream(
        tty,
        { VTE_VERSION: '5001', TERM: 'xterm-256color' },
        undefined,
        [],
      ),
    ).toBe(true)
  })

  test('#451c StylePool.withSelectionBg strips fg+bg+inverse on 16-color null fallback', () => {
    const pool = new StylePool()
    const base = pool.intern([
      { type: 'ansi', code: '\x1b[32m', endCode: '\x1b[39m' },
      { type: 'ansi', code: '\x1b[44m', endCode: '\x1b[49m' },
      { type: 'ansi', code: '\x1b[1m', endCode: '\x1b[22m' },
    ])
    pool.setSelectionBg(null)
    const fallbackCodes = pool.get(pool.withSelectionBg(base))
    expect(fallbackCodes.some(c => c.code === '\x1b[7m')).toBe(true)
    expect(fallbackCodes.some(c => c.endCode === '\x1b[39m')).toBe(false)
    expect(fallbackCodes.some(c => c.endCode === '\x1b[49m')).toBe(false)
    expect(fallbackCodes.some(c => c.code === '\x1b[1m')).toBe(true)

    // With explicit selection bg, foreground color is preserved while bg is replaced
    pool.setSelectionBg({
      type: 'ansi',
      code: '\x1b[48;5;24m',
      endCode: '\x1b[49m',
    })
    const solidCodes = pool.get(pool.withSelectionBg(base))
    expect(solidCodes.some(c => c.code === '\x1b[32m')).toBe(true)
    expect(solidCodes.some(c => c.code === '\x1b[48;5;24m')).toBe(true)
    expect(solidCodes.some(c => c.code === '\x1b[44m')).toBe(false)
  })

  test('#459 Cursor.up and Cursor.down preserve sticky column across short/blank lines', () => {
    const text = '0123456789\n\nab\n0123456789'
    let cur = Cursor.fromText(text, 80, 7) // row 0, col 7
    expect(cur.getPosition()).toEqual({ line: 0, column: 7 })
    cur = cur.down() // blank line → col 0, stickyColumn stays 7
    expect(cur.getPosition()).toEqual({ line: 1, column: 0 })
    expect(cur.stickyColumn).toBe(7)
    cur = cur.down() // "ab" → col 2, stickyColumn stays 7
    expect(cur.getPosition()).toEqual({ line: 2, column: 2 })
    expect(cur.stickyColumn).toBe(7)
    cur = cur.down() // row 3 → restores col 7!
    expect(cur.getPosition()).toEqual({ line: 3, column: 7 })

    // Horizontal move resets stickyColumn
    cur = cur.left()
    expect(cur.stickyColumn).toBeUndefined()
    expect(cur.getPosition()).toEqual({ line: 3, column: 6 })
    cur = cur.up().up().up()
    expect(cur.getPosition()).toEqual({ line: 0, column: 6 })
  })

  test('#520 SIGCONT resume grace window tracks noteResumed() and expires after 150ms', () => {
    expect(SIGCONT_RESUME_GRACE_MS).toBe(150)
    expect(isInSigcontResumeGrace(() => 1000)).toBe(false)
    noteResumed(1000)
    expect(getLastResumedAt()).toBe(1000)
    expect(isInSigcontResumeGrace(() => 1050)).toBe(true)
    expect(isInSigcontResumeGrace(() => 1149)).toBe(true)
    expect(isInSigcontResumeGrace(() => 1150)).toBe(false)
  })

  test('#559 reassembles split bracketed paste and OSC/DCS/APC/DECRPM replies across flushed prefixes', () => {
    // Split bracketed paste: ESC[ flushed, then 200~hello\x1b[201~ arrives
    let [keys1, st1] = parseMultipleKeypresses({ ...INITIAL_STATE }, '\x1b[')
    expect(keys1).toEqual([])
    let [keys2, st2] = parseMultipleKeypresses(st1, null) // 50ms flush
    expect(st2.flushedEscapePrefix).toBe('\x1b[')
    const [keys3] = parseMultipleKeypresses(st2, '200~hello\x1b[201~')
    expect(keys3).toEqual([{ kind: 'paste', text: 'hello' }])

    // Split OSC reply: ESC] flushed, then 11;rgb:00/00/00\x07 arrives
    const [, osc1] = parseMultipleKeypresses({ ...INITIAL_STATE }, '\x1b]')
    const [, osc2] = parseMultipleKeypresses(osc1, null)
    expect(osc2.flushedEscapePrefix).toBe('\x1b]')
    const [oscKeys] = parseMultipleKeypresses(osc2, '11;rgb:00/00/00\x07')
    expect(oscKeys.length).toBe(1)
    expect(oscKeys[0]?.kind).toBe('response')

    // Split DCS XTVERSION reply: ESC P flushed, then >|ghostty 1.2\x1b\\ arrives
    const [, dcs1] = parseMultipleKeypresses({ ...INITIAL_STATE }, '\x1bP')
    const [, dcs2] = parseMultipleKeypresses(dcs1, null)
    expect(dcs2.flushedEscapePrefix).toBe('\x1bP')
    const [dcsKeys] = parseMultipleKeypresses(dcs2, '>|ghostty 1.2\x1b\\')
    expect(dcsKeys.length).toBe(1)
    expect(dcsKeys[0]?.kind).toBe('response')

    // Split APC kitty graphics reply: ESC _ flushed, then Gi=31;OK\x1b\\ arrives
    const [, apc1] = parseMultipleKeypresses({ ...INITIAL_STATE }, '\x1b_')
    const [, apc2] = parseMultipleKeypresses(apc1, null)
    expect(apc2.flushedEscapePrefix).toBe('\x1b_')
    const [apcKeys] = parseMultipleKeypresses(apc2, 'Gi=31;OK\x1b\\')
    expect(apcKeys.length).toBe(1)
    expect(apcKeys[0]?.kind).toBe('response')

    // Lost PASTE_START with PASTE_END present still recovers chunk as paste
    const [pasteEndOnly] = parseMultipleKeypresses(
      { ...INITIAL_STATE },
      'pasted body\x1b[201~',
    )
    expect(pasteEndOnly).toEqual([{ kind: 'paste', text: 'pasted body' }])

    // isEscPrefixedKey matches ESC+letter but rejects CSI/OSC/DCS/APC
    expect(isEscPrefixedKey('\x1ba')).toBe(true)
    expect(isEscPrefixedKey('\x1b[A')).toBe(false)
    expect(isEscPrefixedKey('\x1b]11;')).toBe(false)
    expect(isEscPrefixedKey('\x1b_G')).toBe(false)
  })

  test('#595 Cmd+letter (CSI u super modifier) suppresses KeyboardEvent.key while preserving shortcutKey', () => {
    const [parsed] = parseMultipleKeypresses({ ...INITIAL_STATE }, '\x1b[97;9u')
    expect(parsed.length).toBe(1)
    const key = parsed[0]!
    expect(key.kind).toBe('key')
    if (key.kind === 'key') {
      expect(key.super).toBe(true)
      expect(key.name).toBe('a')
      const ev = new KeyboardEvent(key)
      expect(ev.superKey).toBe(true)
      expect(ev.key).toBe('')
      expect(ev.shortcutKey).toBe('a')
    }
  })

  test('#596 side mouse buttons (128/129) do not emit mouse clicks, and App clears sel.anchor on click release', () => {
    const [sidePress] = parseMultipleKeypresses(
      { ...INITIAL_STATE },
      '\x1b[<128;10;5M',
    )
    expect(sidePress.length).toBe(1)
    expect(sidePress[0]?.kind).toBe('key')
    if (sidePress[0]?.kind === 'key') {
      expect(sidePress[0].name).toBe('mouse')
    }
    const [sideRelease] = parseMultipleKeypresses(
      { ...INITIAL_STATE },
      '\x1b[<129;10;5m',
    )
    expect(sideRelease.length).toBe(1)
    expect(sideRelease[0]?.kind).toBe('key')
    if (sideRelease[0]?.kind === 'key') {
      expect(sideRelease[0].name).toBe('mouse')
    }
    // Normal left click still produces kind: 'mouse'
    const [leftPress] = parseMultipleKeypresses(
      { ...INITIAL_STATE },
      '\x1b[<0;10;5M',
    )
    expect(leftPress[0]?.kind).toBe('mouse')

    // GNOME Terminal double-open guard: sel.anchor = null on click release
    const appSrc = fs.readFileSync(
      path.join(INK_SRC, 'components/App.tsx'),
      'utf8',
    )
    expect(appSrc).toContain('if (!hasSelection(sel) && sel.anchor)')
    expect(appSrc).toContain('sel.anchor = null;')
  })

  test('#597 Konsole Shift+Enter (ESC O M) and kitty CSI u Alt+non-Latin base layout key', () => {
    const origKonsole = process.env.KONSOLE_VERSION
    const origTermProg = process.env.TERM_PROGRAM
    const origTmux = process.env.TMUX
    const origSty = process.env.STY
    try {
      delete process.env.TERM_PROGRAM
      delete process.env.TMUX
      delete process.env.STY
      process.env.KONSOLE_VERSION = '230805'
      expect(isKonsoleTerminal()).toBe(true)
      const [konsoleKeys] = parseMultipleKeypresses(
        { ...INITIAL_STATE },
        '\x1bOM',
      )
      expect(konsoleKeys.length).toBe(1)
      const k = konsoleKeys[0]!
      expect(k.kind).toBe('key')
      if (k.kind === 'key') {
        expect(k.name).toBe('return')
        expect(k.shift).toBe(true)
      }
      // Inside tmux, isKonsoleTerminal is false
      expect(
        isKonsoleTerminal({ KONSOLE_VERSION: '230805', TMUX: '/tmp/tmux' }),
      ).toBe(false)
    } finally {
      if (origKonsole === undefined) delete process.env.KONSOLE_VERSION
      else process.env.KONSOLE_VERSION = origKonsole
      if (origTermProg === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = origTermProg
      if (origTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = origTmux
      if (origSty === undefined) delete process.env.STY
      else process.env.STY = origSty
    }

    // Kitty CSI u Alt + Cyrillic 'и' (1080) with ASCII base layout 'b' (98) → Alt+b
    const [altNonLatin] = parseMultipleKeypresses(
      { ...INITIAL_STATE },
      '\x1b[1080::98;3u',
    )
    expect(altNonLatin.length).toBe(1)
    const anl = altNonLatin[0]!
    expect(anl.kind).toBe('key')
    if (anl.kind === 'key') {
      expect(anl.meta).toBe(true)
      expect(anl.name).toBe('b')
    }

    // Latin-1 (< 880) with Alt is NOT remapped to base layout
    const [altLatin] = parseMultipleKeypresses(
      { ...INITIAL_STATE },
      '\x1b[228::97;3u',
    )
    expect(altLatin[0]?.kind).toBe('key')
    if (altLatin[0]?.kind === 'key') {
      expect(altLatin[0].meta).toBe(true)
      expect(altLatin[0].name).toBe(String.fromCodePoint(228))
    }
  })

  test('#598 spawnDetachedClipboardCopy spawns detached with pipe+ignore stdio and calls unref()', async () => {
    let capturedOpts: Record<string, unknown> | undefined
    let unrefCalled = false
    let written = ''
    const fakeSpawn = ((
      _cmd: string,
      _args: readonly string[],
      opts: Record<string, unknown>,
    ) => {
      capturedOpts = opts
      const child = Object.assign(new EventEmitter(), {
        stdin: {
          write(chunk: string) {
            written += chunk
          },
          end() {
            queueMicrotask(() => child.emit('close', 0))
          },
        },
        unref() {
          unrefCalled = true
        },
      })
      return child
    }) as unknown as typeof import('child_process').spawn

    const code = await spawnDetachedClipboardCopy(
      'wl-copy',
      [],
      5000,
      'hello clipboard',
      fakeSpawn,
    )
    expect(code).toBe(0)
    expect(written).toBe('hello clipboard')
    expect(capturedOpts?.detached).toBe(true)
    expect(capturedOpts?.stdio).toEqual(['pipe', 'ignore', 'ignore'])
    expect(unrefCalled).toBe(true)
  })

  test('#600b captureScrolledRows(below) preserves trailing spaces before soft-wrapped continuation row', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const screen = createScreen(10, 3, stylePool, charPool, hyperlinkPool)

    const writeRow = (row: number, text: string) => {
      for (let c = 0; c < text.length; c++) {
        setCellAt(screen, c, row, {
          char: text[c]!,
          styleId: stylePool.none,
          width: 0,
          hyperlink: undefined,
        })
      }
    }
    writeRow(0, 'hello ')
    writeRow(1, 'world')
    // Row 1 is a soft-wrap continuation of row 0 (contentEnd = 6, startCol = 0)
    screen.softWrap[1] = packSoftWrap(6, 0)

    const sel = createSelectionState()
    startSelection(sel, 0, 0)
    updateSelection(sel, 4, 1)

    // Scroll row 1 off the bottom while row 0 remains on screen
    captureScrolledRows(sel, screen, 1, 1, 'below')
    expect(sel.scrolledOffBelow).toEqual([' world'])
    expect(sel.scrolledOffBelowSW).toEqual([true])

    // Now simulate row 1 scrolled away: row 0 has no continuation on screen
    screen.softWrap[1] = 0
    sel.focus = { col: 9, row: 0 }
    expect(getSelectedText(sel, screen)).toBe('hello world')
  })

  test('#404/#557 rebuildYogaSubtree replaces yoga nodes cleanly, preserves LayoutDisplay.None for hidden nodes, and resets cachedLayout', () => {
    const root = createNode('ink-root')
    const child = createNode('ink-box')
    child.style = { width: 20, height: 5 }
    const hiddenChild = createNode('ink-box')
    hiddenChild.style = { width: 10, height: 3 }
    hiddenChild.isHidden = true
    root.childNodes.push(child, hiddenChild)
    child.parentNode = root
    hiddenChild.parentNode = root
    const oldRootYoga = root.yogaNode
    const oldChildYoga = child.yogaNode
    child.cachedLayout = { x: 0, y: 0, width: 10, height: 2 }

    const rebuilt = rebuildYogaSubtree(root)
    expect(rebuilt.rootYoga).not.toBe(oldRootYoga)
    rebuilt.commit()
    expect(root.yogaNode).toBe(rebuilt.rootYoga)
    expect(child.yogaNode).not.toBe(oldChildYoga)
    expect(child.cachedLayout).toBeUndefined()
    expect(child.dirty).toBe(true)
    expect(hiddenChild.yogaNode?.getDisplay()).toBe(LayoutDisplay.None)
  })

  test('#603 & #598 regressions: App.tsx tracks wantEveryKey without bypassing attachQuietDrain and osc.ts unrefs clipboard timeout', () => {
    const appSrc = fs.readFileSync(
      path.join(INK_SRC, 'components/App.tsx'),
      'utf8',
    )
    expect(appSrc).toContain('wantEveryKey: (owner: unknown)')
    expect(appSrc).toContain(
      'const attachQuiet = !skipAttachQuiet && isAttachUnstable(Date.now())',
    )
    expect(appSrc).not.toContain('!wantEveryKey &&')

    const oscSrc = fs.readFileSync(
      path.join(INK_SRC, 'core/termio/osc.ts'),
      'utf8',
    )
    expect(oscSrc).toContain('timer.unref?.()')
  })

  test('#403/#411/#452/#448 source invariants in ink.tsx, App.tsx, instances.ts', () => {
    const inkSrc = fs.readFileSync(path.join(INK_SRC, 'core/ink.tsx'), 'utf8')
    // #411 EPERM-safe SIGWINCH while keeping exact call
    expect(inkSrc).toContain("process.kill(process.pid, 'SIGWINCH')")
    expect(inkSrc).toContain("process.emit('SIGWINCH')")
    // #452 tmux allow-passthrough skipSync
    expect(inkSrc).toContain('isTmuxPassthrough')
    expect(inkSrc).toContain('this.terminalImages.size > 0 || imageSeq !==')
    // #403 unwritten rollback & retry
    expect(inkSrc).toContain('takeBackUnwrittenFrame')
    expect(inkSrc).toContain('MAX_UNWRITTEN_RETRIES')

    const appSrc = fs.readFileSync(
      path.join(INK_SRC, 'components/App.tsx'),
      'utf8',
    )
    // #411 EPERM-safe SIGTSTP
    expect(appSrc).toContain("process.kill(0, 'SIGTSTP')")
    expect(appSrc).toContain('catch {')
    // #520 noteResumed wired on SIGCONT
    expect(appSrc).toContain('this.noteResumed()')

    // #448 instances.restoredAtExit slot exists
    expect('restoredAtExit' in instances).toBe(true)
  })
})
