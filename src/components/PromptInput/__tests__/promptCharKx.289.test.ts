/**
 * densable 2.1.289 live qK / s0 prompt indicator (JFe() returns false):
 * - PromptChar uses dimColor={isLoading} (bright when idle, dimmed while loading)
 * - Bash `!` uses color="bashBorder" and dimColor={isLoading}
 * - Screen-reader (AccessibilityContext) renders `$ ` instead of `❯ ` and
 *   sets aria-hidden={!isScreenReader || (!viewingAgentName && mode === 'bash')}
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { remapHighlightsToRenderedText } from '../../BaseTextInput.js'
import {
  resolveStatusLineRefreshIntervalMs,
  splitStatusLineOutput,
} from '../../StatusLine.js'
import { Cursor } from '../../../utils/Cursor.js'
import { formatIdeSelectionLeadingPill } from '../PromptInput.js'
import { suggestionRowHeight } from '../PromptInputFooterSuggestions.js'

const src = readFileSync(
  join(import.meta.dir, '../PromptInputModeIndicator.tsx'),
  'utf8',
)

describe('densable 2.1.289 live qK / s0 PromptInputModeIndicator', () => {
  test('PromptChar dims only while loading and renders $ in screen-reader mode', () => {
    expect(src).toContain('useContext(AccessibilityContext)')
    expect(src).toContain('<Text color={color} dimColor={isLoading}>')
    expect(src).not.toContain('<Text dimColor>{figures.pointer}')
    expect(src).not.toContain("process.env.USER_TYPE === 'ant'")
    expect(src).not.toContain("isAnt ? 'subtle'")
    expect(src).toContain(
      'isScreenReader ? <>$&nbsp;</> : <>{figures.pointer}&nbsp;</>',
    )
  })

  test('bash `!` dims while loading and Box sets live qK aria-hidden', () => {
    expect(src).toContain(
      "const ariaHidden = !isScreenReader || (!viewingAgentName && mode === 'bash')",
    )
    expect(src).toContain('aria-hidden={ariaHidden}')
    const bash = src.slice(
      src.indexOf("mode === 'bash'"),
      src.indexOf('<PromptChar\n          isLoading={isLoading}'),
    )
    expect(bash).toContain('color="bashBorder"')
    expect(bash).toContain('dimColor={isLoading}')
  })
})

describe('densable 2.1.289 PromptInput / Cursor / StatusLine alignments', () => {
  test('formatIdeSelectionLeadingPill sanitizes brackets/newlines and middle-truncates at 32 cols', () => {
    expect(formatIdeSelectionLeadingPill('⧉ 3 lines selected')).toBe(
      '[⧉ 3 lines selected] ',
    )
    expect(formatIdeSelectionLeadingPill('⧉ In a[b]\nc.ts')).toBe(
      '[⧉ In a[b) c.ts] ',
    )
    const long = formatIdeSelectionLeadingPill(
      '⧉ 12 lines from very-long-directory-name-example.tsx',
    )
    expect(long.startsWith('[')).toBe(true)
    expect(long.endsWith('] ')).toBe(true)
    expect(long).toContain('…')
  })

  test('remapHighlightsToRenderedText accounts for soft-wrapped rows and trimmed leading spaces', () => {
    const cursor = Cursor.fromText('hello world', 7, 11)
    const rendered = cursor.render(' ', '', s => s)
    const rowOffsets = cursor.getRenderedRowStartOffsets()
    expect(rowOffsets).toEqual([0, 6])
    const remapped = remapHighlightsToRenderedText(
      [{ start: 6, end: 11, color: 'warning', priority: 10 }],
      rendered,
      rowOffsets,
    )
    expect(remapped).toEqual([
      { start: 6, end: 11, color: 'warning', priority: 10 },
    ])

    // Hard wrap without spaces inserts \n into renderedValue — highlight shifts +1 on row 1
    const hard = Cursor.fromText('abcdefghij', 6, 10)
    const hardRendered = hard.render(' ', '', s => s)
    const hardOffsets = hard.getRenderedRowStartOffsets()
    expect(hardOffsets).toEqual([0, 5])
    const hardRemapped = remapHighlightsToRenderedText(
      [{ start: 5, end: 10, color: 'suggestion', priority: 5 }],
      hardRendered,
      hardOffsets,
    )
    expect(hardRemapped).toEqual([
      { start: 6, end: 11, color: 'suggestion', priority: 5 },
    ])
  })

  test('Cursor.startOfLogicalLine handles offset 0 with leading newline', () => {
    const c = Cursor.fromText('\nsecond', 80, 0)
    expect(c.startOfLogicalLine().offset).toBe(0)
  })

  test('splitStatusLineOutput carries SGR and OSC-8 sequences across lines', () => {
    expect(splitStatusLineOutput('single')).toEqual(['single'])
    expect(
      splitStatusLineOutput('\x1b[32mgreen\nstill green\n\x1b[0mplain'),
    ).toEqual(['\x1b[32mgreen', '\x1b[32mstill green', '\x1b[32m\x1b[0mplain'])
    expect(resolveStatusLineRefreshIntervalMs(undefined)).toBeNull()
    expect(resolveStatusLineRefreshIntervalMs(0)).toBe(1000)
    expect(resolveStatusLineRefreshIntervalMs(5)).toBe(5000)
  })

  test('mcp-template suggestions are treated as single-row unified items', () => {
    expect(
      suggestionRowHeight(
        {
          id: 'mcp-template::srv::uri',
          displayText: 'uri',
          description: 'x'.repeat(200),
        },
        80,
        20,
      ),
    ).toBe(1)
  })
})
