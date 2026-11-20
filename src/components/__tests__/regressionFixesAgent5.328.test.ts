import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  unwrapPastedContentForDisplay,
  wrapPastedContentBlock,
} from '../../history.js'
import { dispatchReplStreamEvent } from '../../screens/repl/runReplTurn.js'

describe('Regression Fix Agent 5 — UI / REPL / History', () => {
  test('P1-6: unwrapPastedContentForDisplay unwraps pasted_content blocks and unescapes nested tags', () => {
    const inner =
      'line 1\n<pasted_content id="1234">nested</pasted_content id="1234">\nline 2'
    const wrapped = `Please check this:${wrapPastedContentBlock(inner, 'abcd')}`
    expect(wrapped).toContain('<pasted_content id="abcd">')
    expect(wrapped).toContain('<\\pasted_content id="1234">')

    const unwrapped = unwrapPastedContentForDisplay(wrapped)
    expect(unwrapped).not.toContain('<pasted_content id="abcd">')
    expect(unwrapped).not.toContain('</pasted_content id="abcd">')
    expect(unwrapped).toContain(
      '<pasted_content id="1234">nested</pasted_content id="1234">',
    )
    expect(unwrapped).toContain('Please check this:')
    expect(unwrapped).toContain('line 1')
    expect(unwrapped).toContain('line 2')

    // Trimmed block (as produced by processUserInput) also unwraps cleanly
    const trimmed = wrapPastedContentBlock('hello world', 'cafe').trim()
    expect(unwrapPastedContentForDisplay(trimmed)).toBe('hello world')
    expect(unwrapPastedContentForDisplay(trimmed, 'cafe')).toBe('hello world')
    expect(unwrapPastedContentForDisplay(trimmed, 'dead')).toBe(trimmed)
  })

  test('P1-7: dispatchReplStreamEvent calls keepReply on stream_request_start and processes stream_event after handleMessageFromStream', () => {
    const responseLengthRef = { current: 0 }
    let latestLen = 0
    const setResponseLength = (fn: (prev: number) => number) => {
      latestLen = fn(responseLengthRef.current)
      responseLengthRef.current = latestLen
    }
    const baseDeps = {
      setMessages: () => {},
      messagesRef: { current: [] },
      setConversationId: () => {},
      setAppState: () => {},
      streamingDisplayStore: {
        getState: () => ({ salvage: null, exact: false }),
        setSalvage: () => {},
      },
      salvageRef: { current: null },
      refusalReplacesUuidsRef: { current: null },
      clearStreamingText: () => {},
      pipeReturnHadErrorRef: { current: false },
      relayPipeMessage: () => {},
      setResponseLength,
      setStreamMode: () => {},
      setStreamingToolUses: () => {},
      setStreamingThinking: () => {},
      responseLengthRef,
      apiMetricsRef: { current: [] },
      onStreamingText: undefined,
      displayTransform: undefined,
      setInProgressToolUseIDs: () => {},
      addNotification: () => {},
    }

    // First reply accumulates 40 chars via message_delta (10 tokens * 4 = 40)
    dispatchReplStreamEvent({
      ...baseDeps,
      event: {
        type: 'stream_event',
        event: { type: 'message_delta', usage: { output_tokens: 10 } },
      } as never,
    })
    expect(latestLen).toBe(40)

    // stream_request_start calls keepReply(), preserving 40 into keptLength
    dispatchReplStreamEvent({
      ...baseDeps,
      event: { type: 'stream_request_start' } as never,
    })

    // Next message_start with ttftMs resets replyLength to 0 while keeping keptLength=40
    dispatchReplStreamEvent({
      ...baseDeps,
      event: {
        type: 'stream_event',
        ttftMs: 120,
        event: { type: 'message_start' },
      } as never,
    })
    expect(latestLen).toBe(40)
  })

  test('P0-1..P0-5: no React hooks appear after early returns in REPL, PromptInput, PromptInputQueuedCommands, CollapsedReadSearchContent', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    const transcriptBranch = repl.indexOf("\n  if (screen === 'transcript') {")
    const dialogOverPanelRef = repl.indexOf(
      'const prevDialogOverPanelRef = useRef(false)',
    )
    expect(transcriptBranch).toBeGreaterThan(0)
    expect(dialogOverPanelRef).toBeGreaterThan(0)
    expect(dialogOverPanelRef).toBeLessThan(transcriptBranch)

    const promptInput = readFileSync(
      join(import.meta.dir, '../PromptInput/PromptInput.tsx'),
      'utf8',
    )
    const firstEarlyReturn = promptInput.indexOf('if (showBashesDialog)')
    const linesAboveMemo = promptInput.indexOf(
      'const { linesAbove, linesBelow } = useMemo',
    )
    const footerPasteCb = promptInput.indexOf(
      'const handleFooterPaste = useCallback',
    )
    expect(linesAboveMemo).toBeLessThan(firstEarlyReturn)
    expect(footerPasteCb).toBeLessThan(firstEarlyReturn)

    const queued = readFileSync(
      join(import.meta.dir, '../PromptInput/PromptInputQueuedCommands.tsx'),
      'utf8',
    )
    const queuedEarlyReturn = queued.indexOf(
      'if (viewingAgent || prepared === null)',
    )
    const sendNowCb = queued.indexOf(
      'const handleSendNowClick = React.useCallback',
    )
    expect(sendNowCb).toBeLessThan(queuedEarlyReturn)

    const collapsed = readFileSync(
      join(import.meta.dir, '../messages/CollapsedReadSearchContent.tsx'),
      'utf8',
    )
    const verboseGuard = collapsed.indexOf(
      'if (!tool || tool.isTransparentWrapper?.()) return null;',
    )
    const verboseTermSize = collapsed.indexOf(
      'const { columns, rows } = useTerminalSize();',
    )
    expect(verboseTermSize).toBeLessThan(verboseGuard)

    const verboseReturn = collapsed.indexOf('return wrapToolGroupHost(')
    const toolRunRef = collapsed.indexOf(
      'const toolRunStartedAtRef = useRef<Map<string, number>>',
    )
    expect(toolRunRef).toBeLessThan(verboseReturn)
  })

  test('P1-8/P2-9/P2-10: BaseTextInput, Messages, PluginRasterPanes, Markdown, VirtualMessageList, PromptInput wiring', () => {
    const bti = readFileSync(
      join(import.meta.dir, '../BaseTextInput.tsx'),
      'utf8',
    )
    expect(bti).toContain(
      "keepsImagePaths: () => props.getInputMode?.() === 'bash'",
    )
    expect(bti).toContain('<Box flexDirection="column" flexGrow={1}>')

    const msgs = readFileSync(join(import.meta.dir, '../Messages.tsx'), 'utf8')
    expect(msgs).toContain('useContext(TerminalWriteContext)')
    expect(msgs).not.toContain('TerminalWriteProvider as unknown')
    expect(msgs).toContain('return i >= lastContentIndex ? m.uuid : null;')

    const prp = readFileSync(
      join(import.meta.dir, '../PluginRasterPanes.tsx'),
      'utf8',
    )
    expect(prp).toContain(
      "new Set(['end', 'truncate', 'truncate-end', 'clip'])",
    )
    expect(prp).toContain("wrap: 'truncate-rows'")

    const md = readFileSync(join(import.meta.dir, '../Markdown.tsx'), 'utf8')
    expect(md).toContain('lexMarkdownSafely(marked, lexSource)')
    expect(md).toContain(
      "!(state.isListCut && (firstNonSpace?.type ?? 'list') === 'list')",
    )

    const vml = readFileSync(
      join(import.meta.dir, '../VirtualMessageList.tsx'),
      'utf8',
    )
    expect(vml).not.toContain('shrinkEpoch')
    expect(vml).not.toContain('prevMeasuredHeightsRef')

    const upm = readFileSync(
      join(import.meta.dir, '../messages/UserPromptMessage.tsx'),
      'utf8',
    )
    expect(upm).toContain(
      'shouldMarkPastedContent() ? unwrapPastedContentForDisplay(rawText) : rawText',
    )
  })
})
