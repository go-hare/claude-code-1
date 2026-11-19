import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  computeFullscreenPromptMaxHeight,
  FULLSCREEN_MIN_PROMPT_ROWS,
  getJumpToBottomPillBaseLabel,
} from '../FullscreenLayout.js'
import {
  exceedsHighlightCodeCap,
  HIGHLIGHTED_CODE_MAX_CHARS,
  HIGHLIGHTED_CODE_MAX_LINE_CHARS,
  HIGHLIGHTED_CODE_MAX_LINES,
  normalizeTransparentCodeForeground,
  truncateLongCodeLines,
} from '../HighlightedCode.js'
import { streamingDisplayedPaintsLine } from '../StreamingTextPreview.js'
import { computeStickyPromptScan } from '../VirtualMessageList.js'
import {
  computeProportionalAnchorShift,
  computeSlideCapRange,
} from '../../hooks/useVirtualScroll.js'

const ROOT = join(import.meta.dir, '../../..')

describe('Wave 326 Group 4A — Fullscreen, VirtualScroll, Streaming & HighlightedCode', () => {
  test('#133: streamingDisplayedPaintsLine avoids blank jump on first incomplete line or partial table', () => {
    expect(streamingDisplayedPaintsLine(null)).toBe(false)
    expect(streamingDisplayedPaintsLine('Hello world')).toBe(false)
    expect(streamingDisplayedPaintsLine('   \n   ')).toBe(false)
    expect(
      streamingDisplayedPaintsLine('| Col A | Col B |\n| --- | --- |'),
    ).toBe(false)
    expect(
      streamingDisplayedPaintsLine(
        '| Col A | Col B |\n| --- | --- |\n| val1 |',
      ),
    ).toBe(false)
    expect(streamingDisplayedPaintsLine('Hello world\nsecond')).toBe(true)
    expect(
      streamingDisplayedPaintsLine(
        '| Col A | Col B |\n| --- | --- |\n| val1 | val2 |\n| val3',
      ),
    ).toBe(true)
  })

  test('#134: StreamingMarkdown guards long lists and fenced code chunks without dropping lines', () => {
    const src = readFileSync(join(ROOT, 'src/components/Markdown.tsx'), 'utf8')
    expect(src).toContain('typeBeforeTail')
    expect(src).toContain('STREAM_MD_ORDERED_PREFIX_RE')
    expect(src).toContain('isListCut')
  })

  test('#136: computeProportionalAnchorShift preserves reading position inside long items across resize', () => {
    // Same width -> 0 shift
    expect(computeProportionalAnchorShift(120, 100, 80, 40, 80, 40)).toBe(0)
    // Width narrowed -> item height doubled (40 -> 80); halfway down (offset 20) shifts +20 -> offset 40
    expect(computeProportionalAnchorShift(120, 100, 100, 40, 50, 80)).toBe(20)
    // Width widened -> item height halved (80 -> 40); halfway down (offset 40) shifts -20 -> offset 20
    expect(computeProportionalAnchorShift(140, 100, 50, 80, 100, 40)).toBe(-20)
  })

  test('#137: computeSlideCapRange bypasses clamp on far backward jump to prevent blank viewport', () => {
    // 200 items of height 10 -> offsets[i] = i * 10
    const offsets = Float64Array.from({ length: 201 }, (_, i) => i * 10)
    // Far backward jump from prev [150, 190) to item 5 (scrollTop = 50, viewportH = 30)
    // prevStart - 25 = 125, offsets[125] = 1250 >= 50 + 30 -> wouldBeBlank = true!
    const [start, end] = computeSlideCapRange({
      start: 2,
      end: 20,
      prevStart: 150,
      prevEnd: 190,
      isSticky: false,
      offsets,
      scrollTop: 50,
      listOrigin: 0,
      viewportH: 30,
      itemCount: 200,
    })
    expect(start).toBe(2)
    expect(end).toBe(27)

    // Normal adjacent fast scroll still throttles to prevStart - step
    const [s2, e2] = computeSlideCapRange({
      start: 110,
      end: 145,
      prevStart: 150,
      prevEnd: 190,
      isSticky: false,
      offsets,
      scrollTop: 1260,
      listOrigin: 0,
      viewportH: 30,
      itemCount: 200,
    })
    expect(s2).toBe(125)
    expect(e2).toBe(145)
  })

  test('#138: computeStickyPromptScan starts at end (not start), skips sticky & visible ❯, and header is noSelect', () => {
    const prompts: Record<number, string> = {
      0: 'older question',
      4: 'recent question',
    }
    const tops: Record<number, number> = {
      3: 10,
      4: 20,
      5: 30,
    }
    // Scrolled past all items in [3, 6) (target = 50 > top 30):
    // With firstVisible = end (6), finds item 4 ('recent question'), NOT item 0!
    const res = computeStickyPromptScan({
      start: 3,
      end: 6,
      target: 50,
      isSticky: false,
      getItemTop: i => tops[i] ?? -1,
      getPromptText: i => prompts[i] ?? null,
    })
    expect(res.firstVisible).toBe(6)
    expect(res.idx).toBe(4)
    expect(res.text).toBe('recent question')

    // When sticky (at bottom streaming), no sticky header is shown
    const stickyRes = computeStickyPromptScan({
      start: 3,
      end: 6,
      target: 50,
      isSticky: true,
      getItemTop: i => tops[i] ?? -1,
      getPromptText: i => prompts[i] ?? null,
    })
    expect(stickyRes.idx).toBe(-1)
    expect(stickyRes.text).toBeNull()

    // When prompt 4's ❯ row (top + 1 = 21) is still visible at target = 21, skip to older prompt 0
    const gapRes = computeStickyPromptScan({
      start: 3,
      end: 6,
      target: 21,
      isSticky: false,
      getItemTop: i => tops[i] ?? -1,
      getPromptText: i => prompts[i] ?? null,
    })
    expect(gapRes.idx).toBe(0)
    expect(gapRes.text).toBe('older question')

    // StickyPromptHeader marks outer Box as noSelect
    const flSrc = readFileSync(
      join(ROOT, 'src/components/FullscreenLayout.tsx'),
      'utf8',
    )
    expect(flSrc).toContain(
      '<Box noSelect flexShrink={0} width="100%" height={1} flexDirection="row">',
    )
  })

  test('#141 & #219: HighlightedCode caps huge files, truncates long lines, and normalizes transparent fg', () => {
    expect(
      exceedsHighlightCodeCap('a\n'.repeat(HIGHLIGHTED_CODE_MAX_LINES + 5)),
    ).toBe(true)
    expect(
      exceedsHighlightCodeCap('x'.repeat(HIGHLIGHTED_CODE_MAX_CHARS + 10)),
    ).toBe(true)
    expect(exceedsHighlightCodeCap('const x = 1;\nconst y = 2;')).toBe(false)

    const longLine = 'z'.repeat(HIGHLIGHTED_CODE_MAX_LINE_CHARS + 200)
    const truncated = truncateLongCodeLines(longLine)
    expect(truncated.length).toBeLessThan(longLine.length)
    expect(truncated).toContain('… [+200 chars]')

    expect(
      normalizeTransparentCodeForeground(
        '\x1b[38;2;248;248;242m\x1b[49mconst a = 1;',
      ),
    ).toBe('\x1b[39m\x1b[49mconst a = 1;')
  })

  test('#191 / #197 / #198: FullscreenLayout askBelow pill, subscribeFrames, and short-window prompt protection', () => {
    expect(getJumpToBottomPillBaseLabel(0, true)).toBe(
      'Waiting for your answer',
    )
    expect(getJumpToBottomPillBaseLabel(3, true)).toBe(
      'Waiting for your answer',
    )
    expect(getJumpToBottomPillBaseLabel(3, false)).toBe('3 new messages')
    expect(getJumpToBottomPillBaseLabel(0, false)).toBe('Jump to bottom')

    // #198: in a 14-row window (bottomMaxHeight = 7) with a 6-row abovePrompt banner,
    // old `bottomMaxHeight - abovePromptHeight = 1` crushed the prompt; new formula protects up to 5 rows.
    const protectedH = computeFullscreenPromptMaxHeight(7, 6, 14)
    expect(protectedH).toBe(FULLSCREEN_MIN_PROMPT_ROWS)
    expect(protectedH).toBeGreaterThan(1)

    // #197: FullscreenLayout subscribes pillVisible to subscribeFrames
    const flSrc = readFileSync(
      join(ROOT, 'src/components/FullscreenLayout.tsx'),
      'utf8',
    )
    expect(flSrc).toContain('subscribeFrames?.(listener)')
  })
})
