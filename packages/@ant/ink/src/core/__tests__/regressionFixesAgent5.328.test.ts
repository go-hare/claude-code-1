import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'
import { appendChildNode, createNode, createTextNode } from '../dom.js'
import { KeyboardEvent } from '../events/keyboard-event.js'
import Output from '../output.js'
import type { ParsedKey } from '../parse-keypress.js'
import renderNodeToOutput, {
  createRenderFrameContext,
  runWithRenderFrameContext,
} from '../render-node-to-output.js'
import {
  CharPool,
  cellAt,
  createScreen,
  HyperlinkPool,
  StylePool,
} from '../screen.js'
import { TerminalModes } from '../terminalModes.js'
import {
  printsUnknownSequences,
  setClipboardAttacherCapsGetter,
} from '../termio/osc.js'
import wrapText from '../wrap-text.js'

const ORIGINAL_TERM_PROGRAM = process.env.TERM_PROGRAM
const ORIGINAL_VTE_VERSION = process.env.VTE_VERSION

afterEach(() => {
  setClipboardAttacherCapsGetter(null)
  if (ORIGINAL_TERM_PROGRAM === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = ORIGINAL_TERM_PROGRAM
  if (ORIGINAL_VTE_VERSION === undefined) delete process.env.VTE_VERSION
  else process.env.VTE_VERSION = ORIGINAL_VTE_VERSION
})

function makeParsedKey(overrides: Partial<ParsedKey>): ParsedKey {
  return {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: '',
    raw: '',
    col: undefined,
    row: undefined,
    ...overrides,
  }
}

describe('Regression Fix Agent 5 — Ink Core', () => {
  test('P0-1: wrapText splits newlines only for truncate-rows and clip; end/truncate/truncate-end stay single-unit', () => {
    expect(wrapText('abcdefghij\n1234567890', 5, 'clip')).toBe('abcde\n12345')
    expect(wrapText('abcdefghij\n1234567890', 5, 'truncate-rows')).toBe(
      'abcd…\n1234…',
    )
    for (const mode of ['end', 'truncate', 'truncate-end'] as const) {
      const out = wrapText('abcdefghij\n1234567890', 5, mode)
      expect(out.includes('\n')).toBe(false)
      expect(out).toBe('abcd…')
    }
  })

  test('P0-1: render-node-to-output preserves per-segment styles on lines 2+ in truncate-rows mode', () => {
    const prevLevel = chalk.level
    chalk.level = 3
    try {
      const root = createNode('ink-box')
      root.style = { flexDirection: 'column', width: 8 }
      const textNode = createNode('ink-text')
      textNode.style = { textWrap: 'truncate-rows' }

      const seg1 = createNode('ink-virtual-text')
      seg1.textStyles = { color: 'ansi:red', bold: true }
      seg1.childNodes.push(createTextNode('123456789012345\n'))

      const seg2 = createNode('ink-virtual-text')
      seg2.textStyles = { color: 'ansi:green', italic: true }
      seg2.childNodes.push(createTextNode('secondline'))

      appendChildNode(textNode, seg1)
      appendChildNode(textNode, seg2)
      appendChildNode(root, textNode)

      root.yogaNode!.calculateLayout(8, 4)
      const stylePool = new StylePool()
      const screen = createScreen(
        8,
        4,
        stylePool,
        new CharPool(),
        new HyperlinkPool(),
      )
      const output = new Output({ width: 8, height: 4, stylePool, screen })
      runWithRenderFrameContext(createRenderFrameContext(), () => {
        renderNodeToOutput(root, output, { prevScreen: undefined })
      })
      const painted = output.get()

      const row0Text = Array.from(
        { length: 8 },
        (_, x) => cellAt(painted, x, 0)?.char ?? '',
      ).join('')
      const row1Text = Array.from(
        { length: 8 },
        (_, x) => cellAt(painted, x, 1)?.char ?? '',
      ).join('')
      expect(row0Text.trim()).toBe('1234567…')
      expect(row1Text.trim()).toBe('secondl…')

      const row0Cell = cellAt(painted, 0, 0)!
      const row1Cell = cellAt(painted, 0, 1)!
      expect(row0Cell.styleId).not.toBe(0)
      expect(row1Cell.styleId).not.toBe(0)
      expect(row0Cell.styleId).not.toBe(row1Cell.styleId)
      expect(stylePool.get(row0Cell.styleId)).not.toEqual(
        stylePool.get(row1Cell.styleId),
      )
    } finally {
      chalk.level = prevLevel
    }
  })

  test('P1-4: KeyboardEvent suppresses .key for Ctrl+digit and Ctrl+space while preserving shortcutKey', () => {
    const ctrl1 = new KeyboardEvent(
      makeParsedKey({ name: '1', ctrl: true, sequence: '\x1b[49;5u' }),
    )
    expect(ctrl1.shortcutKey).toBe('1')
    expect(ctrl1.key).toBe('')

    const ctrlSpace = new KeyboardEvent(
      makeParsedKey({ name: 'space', ctrl: true, sequence: '\x00' }),
    )
    expect(ctrlSpace.shortcutKey).toBe(' ')
    expect(ctrlSpace.key).toBe('')

    // Ctrl+letter still keeps shortcutKey in key (matching official 328 @307105742)
    const ctrlA = new KeyboardEvent(
      makeParsedKey({ name: 'a', ctrl: true, sequence: '\x01' }),
    )
    expect(ctrlA.shortcutKey).toBe('a')
    expect(ctrlA.key).toBe('a')
  })

  test('P1-6: printsUnknownSequences respects attacherCaps and extendedKeysOff returns empty string', () => {
    process.env.TERM_PROGRAM = 'iTerm.app'
    delete process.env.VTE_VERSION
    expect(printsUnknownSequences()).toBe(false)

    setClipboardAttacherCapsGetter(() => ({ printsUnknownSequences: true }))
    expect(printsUnknownSequences()).toBe(true)

    const modes = new TerminalModes()
    modes.set('extendedKeys')
    const off = modes.reset('extendedKeys')
    expect(off).toBe('')
  })

  test('P1-2, P1-3, P1-5: ink.tsx clears unwritten on early returns and App.tsx handles readAsEscapeThenKey + wantEveryKey', () => {
    const inkSrc = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
    const srIdx = inkSrc.indexOf('if (this.isScreenReaderEnabled)')
    expect(srIdx).toBeGreaterThan(-1)
    expect(inkSrc.slice(srIdx, srIdx + 260)).toContain(
      'this.unwritten = undefined;',
    )

    const sinkIdx = inkSrc.indexOf('if (sinkResult) {')
    expect(sinkIdx).toBeGreaterThan(-1)
    expect(inkSrc.slice(sinkIdx, sinkIdx + 700)).toContain(
      'this.unwritten = undefined;',
    )

    const appSrc = readFileSync(
      join(import.meta.dir, '../../components/App.tsx'),
      'utf8',
    )
    expect(appSrc).toContain('=> boolean | undefined;')
    expect(appSrc).toContain('readKeys(this.keyReader, input, now, late)')
    expect(appSrc).toContain("splitEscPrefixedKey(item.sequence ?? '')")
    expect(appSrc).not.toContain('const soloKeypress = wantEveryKey ||')
    expect(appSrc).toContain(
      'const rewritten = rewriteJediTermInput(app.jediTermInput, items, performance.now(), app.emitJediTermScrollBug);',
    )
  })
})
