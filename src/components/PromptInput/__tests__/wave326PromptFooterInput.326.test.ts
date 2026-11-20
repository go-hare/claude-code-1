import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { TaskState } from '../../../tasks/types.js'
import { applyShellSuggestion } from '../../../hooks/useTypeahead.js'
import { computePromptViewportOverflow } from '../PromptInput.js'
import {
  hasResumableStoppedSubagentInFooter,
  isViewingStoppableSubagent,
} from '../PromptInputFooterLeftSide.js'
import { computeClassicQueuedMaxRows } from '../PromptInputQueuedCommands.js'
import { getFailedRequestPlaceholder } from '../usePromptInputPlaceholder.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('Wave 326 Group 4B — PromptInput / Footer / Hooks', () => {
  test('#7 getFailedRequestPlaceholder maps recovery actions', () => {
    expect(getFailedRequestPlaceholder('try_again')).toBe(
      'Resend your message to try again',
    )
    expect(getFailedRequestPlaceholder('fix_setup')).toBe(
      'Once fixed, resend your message',
    )
    expect(getFailedRequestPlaceholder('switch_model')).toBe(
      'Once fixed, resend your message',
    )
    expect(getFailedRequestPlaceholder('make_room')).toBe(
      'Once fixed, resend your message',
    )
    expect(getFailedRequestPlaceholder('edit_message', false)).toBe(
      'Run /rewind to go back',
    )
    expect(getFailedRequestPlaceholder('edit_message', true)).toBeUndefined()
    expect(getFailedRequestPlaceholder('wait')).toBeUndefined()
    expect(getFailedRequestPlaceholder('blocked')).toBeUndefined()
    expect(getFailedRequestPlaceholder(null)).toBeUndefined()
  })

  test('#8 isViewingStoppableSubagent only matches running local_agent in viewing-agent mode', () => {
    const runningAgent = {
      id: 'a1',
      type: 'local_agent',
      status: 'running',
    } as unknown as TaskState
    const killedAgent = {
      id: 'a2',
      type: 'local_agent',
      status: 'killed',
    } as unknown as TaskState
    const tasks = { a1: runningAgent, a2: killedAgent }

    expect(isViewingStoppableSubagent('viewing-agent', 'a1', tasks)).toBe(true)
    expect(isViewingStoppableSubagent('viewing-agent', 'a2', tasks)).toBe(false)
    expect(isViewingStoppableSubagent('leader', 'a1', tasks)).toBe(false)
    expect(isViewingStoppableSubagent('viewing-agent', undefined, tasks)).toBe(
      false,
    )
  })

  test('#283 hasResumableStoppedSubagentInFooter detects visible user-stopped subagents', () => {
    const stoppedAgent = {
      id: 'agent-stopped',
      type: 'local_agent',
      agentType: 'explore',
      description: 'explore',
      status: 'killed',
      stoppedByUser: true,
      startTime: 1000,
      endTime: 2000,
      isBackgrounded: true,
      pendingMessages: [],
      messages: [],
    } as unknown as TaskState
    const tasks = { 'agent-stopped': stoppedAgent }

    expect(
      hasResumableStoppedSubagentInFooter(tasks, undefined, undefined),
    ).toBe(true)
    // Viewing that agent itself does not advertise "↓ to resume subagent" for itself
    expect(
      hasResumableStoppedSubagentInFooter(tasks, undefined, 'agent-stopped'),
    ).toBe(false)
    // Hidden by empty decoration content suppresses the hint
    expect(
      hasResumableStoppedSubagentInFooter(
        tasks,
        { 'agent-stopped': { content: '' } },
        undefined,
      ),
    ).toBe(false)
  })

  test('#284 computePromptViewportOverflow computes hidden lines above and below', () => {
    const tenLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join(
      '\n',
    )
    // Cursor at start: 0 above, 6 below with maxVisibleLines=4
    const atTop = computePromptViewportOverflow(tenLines, 40, 0, 4)
    expect(atTop.linesAbove).toBe(0)
    expect(atTop.linesBelow).toBe(6)

    // Cursor at end: 6 above, 0 below
    const atBottom = computePromptViewportOverflow(
      tenLines,
      40,
      tenLines.length,
      4,
    )
    expect(atBottom.linesAbove).toBe(6)
    expect(atBottom.linesBelow).toBe(0)

    // Undefined maxVisibleLines (non-fullscreen): always 0/0
    expect(computePromptViewportOverflow(tenLines, 40, 0, undefined)).toEqual({
      linesAbove: 0,
      linesBelow: 0,
    })
  })

  test('#135 computeClassicQueuedMaxRows caps long queued prompt height in classic renderer', () => {
    expect(computeClassicQueuedMaxRows(24, 1)).toBe(8)
    expect(computeClassicQueuedMaxRows(24, 2)).toBe(4)
    expect(computeClassicQueuedMaxRows(12, 3)).toBe(3)
  })

  test('#143/#145/#165/#166/#168/#172/#181/#199/#200/#201/#287 production source wiring', () => {
    const pasteSrc = readFileSync(
      join(ROOT, 'src/hooks/usePasteHandler.ts'),
      'utf8',
    )
    expect(pasteSrc).toContain('shift: deferred.shift')
    expect(pasteSrc).toContain('option: deferred.option')
    expect(pasteSrc).toContain('subscribeImageReadStart')

    const typeaheadSrc = readFileSync(
      join(ROOT, 'src/hooks/useTypeahead.tsx'),
      'utf8',
    )
    expect(typeaheadSrc).toContain('shellQuoteCompletionPath')
    expect(typeaheadSrc).toContain('submitOverSuggestions')

    const cancelSrc = readFileSync(
      join(ROOT, 'src/hooks/useCancelRequest.ts'),
      'utf8',
    )
    expect(cancelSrc).toContain('hasPendingLoopWakeup && !inputValue')

    const truncSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/useMaybeTruncateInput.ts'),
      'utf8',
    )
    expect(truncSrc).toContain('keepsFullText')

    const notifSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/Notifications.tsx'),
      'utf8',
    )
    expect(notifSrc).toContain("n.key !== 'token-warning'")

    const queuedSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInputQueuedCommands.tsx'),
      'utf8',
    )
    expect(queuedSrc).toContain("'Queued · '")

    const statusLineSrc = readFileSync(
      join(ROOT, 'src/components/StatusLine.tsx'),
      'utf8',
    )
    expect(statusLineSrc).toContain('subscribeSessionTitleChanged')
    expect(statusLineSrc).toContain('useTerminalSize')

    const footerSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInputFooter.tsx'),
      'utf8',
    )
    expect(footerSrc).toContain(
      'allowInterruptHint={allowInterruptHintWithStatusLine}',
    )
    expect(footerSrc).toContain('showExpandPasteHint={showExpandPasteHint}')

    // #171: footer only shows expand-paste hint when !isLoading
    const footerLeftSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInputFooterLeftSide.tsx'),
      'utf8',
    )
    expect(footerLeftSrc).toContain(
      'if (showExpandPasteHint && !isSearching && !isLoading)',
    )

    // #284 & #147: PromptInput keeps stable 2-Box depth across bottomMoreBorderText
    // and clears removedPastedContentsRef on submit & /clear
    const promptInputSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(promptInputSrc).not.toContain(') : bottomMoreBorderText ? (')
    expect(promptInputSrc).toContain('removedPastedContentsRef.current = {}')
  })

  test('#165 single-pass shell quoting quotes spaced paths exactly once', () => {
    let appliedValue = ''
    let appliedCursor = 0
    applyShellSuggestion(
      {
        id: 'my file.txt ',
        displayText: 'my file.txt ',
        metadata: { completionType: 'file' },
      },
      'cat my',
      6,
      v => {
        appliedValue = v
      },
      c => {
        appliedCursor = c
      },
      'file',
    )
    expect(appliedValue).toBe("cat 'my file.txt' ")
    expect(appliedCursor).toBe(appliedValue.length)

    const shellCompSrc = readFileSync(
      join(ROOT, 'src/utils/bash/shellCompletion.ts'),
      'utf8',
    )
    expect(shellCompSrc).not.toContain(
      "completionType === 'file' ? shellQuoteCompletionPath(rawLine) : rawLine",
    )
  })
})
