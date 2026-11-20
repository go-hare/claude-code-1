import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { marked } from 'marked'
import tuiCommand from '../../commands/tui/index.js'
import { shouldShowModalDividerNotification } from '../FullscreenLayout.js'
import {
  advanceSearchMatchPointer,
  resolveSearchAnchorScrollTop,
  type SearchAnchor,
} from '../VirtualMessageList.js'
import {
  hasSettledAssistantReply,
  isStreamingSkippable,
  shouldFocusHoldPreviewDuringStopHook,
} from '../../utils/focusTranscript.js'
import { FULLSCREEN_CLASSIC_FALLBACK_MESSAGE } from '../../utils/fullscreen.js'
import {
  escapePipesInInlineCode,
  hasOverlongMarkdownLine,
  lexMarkdownSafely,
  MARKDOWN_WINDOW_LINES,
  MAX_MARKDOWN_LINE_LENGTH,
  sliceMarkdownWindowEnd,
} from '../../utils/markdown.js'
import { renderTruncatedContent } from '../../utils/terminal.js'
import { renderableSearchText } from '../../utils/transcriptSearch.js'

const REPO_ROOT = path.resolve(import.meta.dir, '../../..')

describe('Wave 327-328 Fullscreen / Markdown / Search / Theme / CLI Suite', () => {
  test('#375 /tui classic is documented and referenced in fullscreen fallback message', () => {
    expect(tuiCommand.description).toContain('classic')
    expect(tuiCommand.argumentHint).toBe('[classic|fullscreen]')
    expect(FULLSCREEN_CLASSIC_FALLBACK_MESSAGE).toContain('/tui classic')
  })

  test('#409 FileWriteTool/UI.tsx renders FileEditToolUseRejectedMessage directly without full-file Myers diff', () => {
    const uiSrc = fs.readFileSync(
      path.join(
        REPO_ROOT,
        'packages/builtin-tools/src/tools/FileWriteTool/UI.tsx',
      ),
      'utf8',
    )
    expect(uiSrc).toContain('<FileEditToolUseRejectedMessage')
    expect(uiSrc).not.toContain('WriteRejectionDiff')
    expect(uiSrc).not.toContain('loadRejectionDiff')
  })

  test('#434 focusTranscript skips progress (Stop hook) and does not hide finished reply while Stop hook runs', () => {
    const progressMsg = {
      type: 'progress',
      uuid: 'p1',
      data: { type: 'hook_progress', hookEvent: 'Stop' },
    } as unknown as Parameters<typeof isStreamingSkippable>[0]
    expect(isStreamingSkippable(progressMsg)).toBe(true)

    const assistantMsg = {
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'All done!' }],
      },
    } as unknown as Parameters<typeof hasSettledAssistantReply>[0][number]

    const streamingMsg = {
      type: 'assistant',
      uuid: 'a2',
      message: {
        role: 'assistant',
        stop_reason: null,
        content: [{ type: 'text', text: 'Working...' }],
      },
    } as unknown as Parameters<typeof hasSettledAssistantReply>[0][number]

    expect(hasSettledAssistantReply([assistantMsg, progressMsg])).toBe(true)
    expect(
      shouldFocusHoldPreviewDuringStopHook([assistantMsg, progressMsg]),
    ).toBe(false)
    expect(shouldFocusHoldPreviewDuringStopHook([streamingMsg])).toBe(true)
    expect(shouldFocusHoldPreviewDuringStopHook([progressMsg])).toBe(true)
  })

  test('#457 advanceSearchMatchPointer advances without skipping matches and handles 1-message wraparound', () => {
    expect(advanceSearchMatchPointer(0, 1, 1, 0)).toEqual({
      nextPtr: 0,
      canSkipMore: false,
    })
    expect(advanceSearchMatchPointer(0, 1, 3, 0)).toEqual({
      nextPtr: 1,
      canSkipMore: true,
    })
    expect(advanceSearchMatchPointer(2, 1, 3, 0)).toEqual({
      nextPtr: 0,
      canSkipMore: true,
    })
    expect(advanceSearchMatchPointer(0, -1, 3, 0)).toEqual({
      nextPtr: 2,
      canSkipMore: true,
    })
    expect(advanceSearchMatchPointer(0, 1, 50, 19)).toEqual({
      nextPtr: 1,
      canSkipMore: false,
    })
    expect(advanceSearchMatchPointer(0, 1, 0, 0)).toBeNull()
  })

  test('#458 resolveSearchAnchorScrollTop restores exact keyed message + row offset instead of drifting', () => {
    const keys = ['m0', 'm1', 'm2', 'm3']
    const offsets = [0, 10, 25, 40]
    const anchor: SearchAnchor = { key: 'm2', rowsPast: 3 }
    expect(
      resolveSearchAnchorScrollTop(anchor, keys, offsets, 0, 100, 20, 5),
    ).toBe(28)
    expect(
      resolveSearchAnchorScrollTop('bottom', keys, offsets, 0, 100, 20, 5),
    ).toBe(80)
    expect(
      resolveSearchAnchorScrollTop(
        { key: 'missing', rowsPast: 1 },
        keys,
        offsets,
        0,
        100,
        20,
        5,
      ),
    ).toBe(5)
  })

  test('#465 renderTruncatedContent strips ANSI/OSC8 before estimating "+N lines" count', () => {
    const oscLink = (label: string) =>
      `\x1b]8;;https://example.com/very/long/path/that/must/not/inflate/line/count\x07\x1b[38;2;215;119;87m${label}\x1b[0m\x1b]8;;\x07`
    const content = Array.from({ length: 5 }, (_, i) =>
      oscLink(`line ${i}`),
    ).join('\n')
    const rendered = renderTruncatedContent(content, 48, false)
    // Visible lines are 5, MAX_LINES_TO_SHOW is 3 → +2 lines (NOT inflated by OSC8/ANSI bytes!)
    expect(rendered).toContain('+2 lines')
  })

  test('#490 renderableSearchText indexes edits, written files, notebook edits, and structuredPatch', () => {
    const writeMsg = {
      type: 'assistant',
      uuid: 'u-write',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Write',
            input: {
              file_path: '/tmp/foo.ts',
              content: 'export const magicWrittenNeedle = 42',
            },
          },
          {
            type: 'tool_use',
            id: 't2',
            name: 'Edit',
            input: {
              file_path: '/tmp/bar.ts',
              old_string: 'legacyTokenAlpha',
              new_string: 'updatedTokenBeta',
            },
          },
          {
            type: 'tool_use',
            id: 't3',
            name: 'MultiEdit',
            input: {
              file_path: '/tmp/baz.ts',
              edits: [
                { old_string: 'multiOldGamma', new_string: 'multiNewDelta' },
              ],
            },
          },
        ],
      },
    } as unknown as Parameters<typeof renderableSearchText>[0]

    const searchText = renderableSearchText(writeMsg)
    expect(searchText).toContain('magicwrittenneedle')
    expect(searchText).toContain('legacytokenalpha')
    expect(searchText).toContain('updatedtokenbeta')
    expect(searchText).toContain('multioldgamma')
    expect(searchText).toContain('multinewdelta')

    const resultMsg = {
      type: 'user',
      uuid: 'u-res',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't2', content: '' }],
      },
      toolUseResult: {
        oldString: 'resultOldNeedle',
        newString: 'resultNewNeedle',
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ['-removedPatchLine', '+addedPatchLine'],
          },
        ],
      },
    } as unknown as Parameters<typeof renderableSearchText>[0]

    const resText = renderableSearchText(resultMsg)
    expect(resText).toContain('resultoldneedle')
    expect(resText).toContain('resultnewneedle')
    expect(resText).toContain('removedpatchline')
    expect(resText).toContain('addedpatchline')
  })

  test('#529 system, thinking, inbound, cross-session, and teammate message glyphs use NoSelect', () => {
    const files = [
      'src/components/messages/SystemTextMessage.tsx',
      'src/components/messages/AssistantThinkingMessage.tsx',
      'src/components/messages/AgentInboundMessage.tsx',
      'src/components/messages/UserCrossSessionMessage.tsx',
      'src/components/messages/UserTeammateMessage.tsx',
    ]
    for (const rel of files) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
      expect(src).toContain('<NoSelect fromLeftEdge minWidth={2}>')
    }
  })

  test('#556 markdown freeze guards handle overlong lines, windowing, and O(N) backtick pipe escaping', () => {
    expect(hasOverlongMarkdownLine('short\nline')).toBe(false)
    expect(
      hasOverlongMarkdownLine('a'.repeat(MAX_MARKDOWN_LINE_LENGTH + 1)),
    ).toBe(true)

    // Overlong line returns plain paragraph without freezing marked.lexer
    const hugeLine = `${'*_~'.repeat(Math.ceil((MAX_MARKDOWN_LINE_LENGTH + 500) / 3))}`
    const t0 = performance.now()
    const safeTokens = lexMarkdownSafely(marked, hugeLine)
    expect(performance.now() - t0).toBeLessThan(200)
    expect(safeTokens.length).toBe(1)
    expect(safeTokens[0]?.type).toBe('paragraph')

    // Window slicer splits large multi-line documents cleanly
    const manyLines = Array.from(
      { length: MARKDOWN_WINDOW_LINES + 50 },
      (_, i) => `Paragraph line ${i}`,
    ).join('\n\n')
    const windowEnd = sliceMarkdownWindowEnd(
      manyLines,
      0,
      MARKDOWN_WINDOW_LINES,
    )
    expect(windowEnd).toBeGreaterThan(0)
    expect(windowEnd).toBeLessThan(manyLines.length)

    // Linear-time escapePipesInInlineCode does not hang on 5,000 unmatched backticks
    const adversarial = '`'.repeat(5000) + ' | ' + '`'.repeat(4999)
    const t1 = performance.now()
    const escaped = escapePipesInInlineCode(adversarial)
    expect(performance.now() - t1).toBeLessThan(100)
    expect(escaped.length).toBeGreaterThanOrEqual(adversarial.length)
    expect(escapePipesInInlineCode('| `a|b` | c |')).toBe('| `a\\|b` | c |')
  })

  test('#600a/#600c Markdown blockquote bar uses NoSelect and FullscreenLayout hides Jump to bottom during selection', () => {
    const mdSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'src/components/Markdown.tsx'),
      'utf8',
    )
    expect(mdSrc).toContain('function QuoteBarGutter')
    expect(mdSrc).toContain('<NoSelect')
    expect(mdSrc).toContain('borderStyle="quote"')

    const fsSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'src/components/FullscreenLayout.tsx'),
      'utf8',
    )
    expect(fsSrc).toContain('const hideOnSelection = !askBelow && !hover')
    expect(fsSrc).toContain('if (hasActiveSelection && !askBelow && !hover)')
  })

  test('#603 ThemePicker enables useWantEveryKey(true) and guards post-commit batched keys', () => {
    const tpSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'src/components/ThemePicker.tsx'),
      'utf8',
    )
    expect(tpSrc).toContain('useWantEveryKey(true)')
    expect(tpSrc).toContain('committedRef')
  })

  test('#605 shouldShowModalDividerNotification only admits immediate-priority notifications', () => {
    expect(shouldShowModalDividerNotification({ priority: 'low' }, false)).toBe(
      false,
    )
    expect(
      shouldShowModalDividerNotification({ priority: 'medium' }, false),
    ).toBe(false)
    expect(
      shouldShowModalDividerNotification({ priority: 'high' }, false),
    ).toBe(false)
    expect(
      shouldShowModalDividerNotification({ priority: 'immediate' }, false),
    ).toBe(true)
    expect(
      shouldShowModalDividerNotification({ priority: 'immediate' }, true),
    ).toBe(false)
    expect(shouldShowModalDividerNotification(null, false)).toBe(false)
  })

  test('#626 cli.tsx sanitizes negative FORCE_COLOR before chalk loads', () => {
    const cliSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'src/entrypoints/cli.tsx'),
      'utf8',
    )
    expect(cliSrc).toContain('export function sanitizeForceColorEnv')
    const callIdx = cliSrc.indexOf('sanitizeForceColorEnv()')
    const firstDynamicImportIdx = cliSrc.indexOf('await import(')
    expect(callIdx).toBeGreaterThan(-1)
    expect(firstDynamicImportIdx).toBeGreaterThan(callIdx)
  })
})
