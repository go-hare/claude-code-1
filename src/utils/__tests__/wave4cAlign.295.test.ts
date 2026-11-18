import { beforeEach, describe, expect, test } from 'bun:test'
import {
  appendKeptMessagesCompactNote,
  KEPT_MESSAGES_COMPACT_NOTE,
} from '../../services/compact/prompt.js'
import {
  createWithheldMemoryAttachments,
  filterWithheldMemoryDuplicates,
  isDuplicateSessionStartHookResponse,
  MAX_AT_MENTION_TELEMETRY_PER_PROMPT,
  processAgentMentions,
  type Attachment,
} from '../attachments.js'
import {
  collectWithheldMemorySeen,
  drainWithheldMemoryOwed,
  formatWithheldMemoryLine,
  formatWithheldMore,
  getWithheldMemoryToken,
  markWithheldMemoryLoaded,
  recordWithheldMemoryPaths,
  resetWithheldMemoryStateForTests,
  withheldShown,
} from '../claudemd.js'
import { createUserMessage, normalizeAttachmentForAPI } from '../messages.js'
import { toSDKRateLimitInfo } from '../messages/mappers.js'

describe('Wave 4C deep alignment (#216, #229, #288, #331, #412, #448)', () => {
  beforeEach(() => {
    resetWithheldMemoryStateForTests()
  })

  test('#216: normalizeAttachmentForAPI formats at_mention_reference for too_large, in_ranges, and unexamined', () => {
    const tooLargeWithHint = normalizeAttachmentForAPI({
      type: 'at_mention_reference',
      mentions: ['/tmp/big.log'],
      unread: 'too_large',
      fileSize: 180_000,
      readAllOfIt: 'over_size_limit',
    } as Attachment)
    expect(tooLargeWithHint).toHaveLength(1)
    const text1 = String(
      (tooLargeWithHint[0] as { message: { content: unknown } }).message
        .content,
    )
    expect(text1).toContain('/tmp/big.log')
    expect(text1).toContain('needs a limit for a file this large')
    expect(text1).toContain('about 3 calls')

    const inRanges = normalizeAttachmentForAPI({
      type: 'at_mention_reference',
      mentions: ['/tmp/ranged.txt'],
      unread: 'in_ranges',
      fileSize: 120_000,
      totalLines: 2000,
      ranges: [
        { offset: 1, limit: 1000 },
        { offset: 1001, limit: 1000 },
      ],
    } as Attachment)
    const text2 = String(
      (inRanges[0] as { message: { content: unknown } }).message.content,
    )
    expect(text2).toContain('offset 1 limit 1000; offset 1001 limit 1000')

    const unexamined = normalizeAttachmentForAPI({
      type: 'at_mention_reference',
      mentions: ['/tmp/locked.txt'],
      unread: 'unexamined',
    } as Attachment)
    const text3 = String(
      (unexamined[0] as { message: { content: unknown } }).message.content,
    )
    expect(text3).toContain('could not be examined and were not attached')
  })

  test('#229: withheld_memory tracks owed paths, clears on load, deduplicates against nested_memory, and formats lines', () => {
    recordWithheldMemoryPaths([
      { path: '/repo/sub/CLAUDE.md', why: 'outside' },
      { path: '/repo/other/CLAUDE.md', why: 'denied' },
    ])
    markWithheldMemoryLoaded(['/repo/other/CLAUDE.md'])

    const owed = drainWithheldMemoryOwed([])
    expect(owed).toEqual([{ path: '/repo/sub/CLAUDE.md', why: 'outside' }])

    const atts = createWithheldMemoryAttachments(owed, false)
    expect(atts).toHaveLength(1)
    expect(atts[0]).toMatchObject({
      type: 'withheld_memory',
      by: getWithheldMemoryToken(),
    })

    const deduped = filterWithheldMemoryDuplicates([
      {
        type: 'nested_memory',
        path: '/repo/sub/CLAUDE.md',
        content: {
          type: 'Project',
          path: '/repo/sub/CLAUDE.md',
          content: 'hi',
        },
        displayPath: 'sub/CLAUDE.md',
      } as Attachment,
      ...atts,
    ])
    expect(deduped).toHaveLength(1)
    expect(deduped[0]?.type).toBe('nested_memory')

    const seen = collectWithheldMemorySeen(
      atts as unknown as Array<{ type: string; [key: string]: unknown }>,
    )
    expect(seen.has('/repo/sub/CLAUDE.md')).toBe(true)

    expect(formatWithheldMemoryLine('denied', 'a/b\nCLAUDE.md')).toEqual({
      lead: 'Instruction file not loaded (a Read deny rule covers it):',
      mark: 'path:',
      path: 'a/b CLAUDE.md',
    })
    expect(formatWithheldMore(1)).toBe('and 1 more instruction file not loaded')
    expect(formatWithheldMore(3)).toBe(
      'and 3 more instruction files not loaded',
    )
    expect(withheldShown(Array.from({ length: 25 }, (_, i) => i))).toEqual({
      shown: Array.from({ length: 20 }, (_, i) => i),
      more: 5,
    })
  })

  test('#288: appendKeptMessagesCompactNote appends verbatim-kept warning for string and array content', () => {
    const strMsg = createUserMessage({ content: 'Summary body' })
    const updatedStr = appendKeptMessagesCompactNote(strMsg)
    expect(updatedStr.message.content).toBe(
      `Summary body\n\n${KEPT_MESSAGES_COMPACT_NOTE}`,
    )

    const arrMsg = createUserMessage({
      content: [{ type: 'text', text: 'Summary body' }],
    })
    const updatedArr = appendKeptMessagesCompactNote(arrMsg)
    expect(updatedArr.message.content).toEqual([
      { type: 'text', text: 'Summary body' },
      { type: 'text', text: KEPT_MESSAGES_COMPACT_NOTE },
    ])
  })

  test('#331: processAgentMentions respects 100-item telemetry cap without dropping attachments', () => {
    expect(MAX_AT_MENTION_TELEMETRY_PER_PROMPT).toBe(100)
    const agents = Array.from({ length: 105 }, (_, i) => ({
      agentType: `reviewer-${i}`,
    })) as unknown as Parameters<typeof processAgentMentions>[1]
    const prompt = Array.from(
      { length: 105 },
      (_, i) => `@agent-reviewer-${i}`,
    ).join(' ')
    const attachments = processAgentMentions(prompt, agents)
    expect(attachments).toHaveLength(105)
    expect(attachments[0]).toEqual({
      type: 'agent_mention',
      agentType: 'reviewer-0',
    })
  })

  test('#412: isDuplicateSessionStartHookResponse deduplicates identical SessionStart context across resume', () => {
    const prior: Attachment[] = [
      {
        type: 'async_hook_response',
        processId: 'p1',
        hookName: 'SessionStart',
        hookEvent: 'SessionStart',
        command: 'init.sh',
        pluginId: 'plug@mkt',
        response: {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'same context',
          },
        },
        stdout: '',
        stderr: '',
        exitCode: 0,
      },
    ]

    expect(
      isDuplicateSessionStartHookResponse(
        {
          command: 'init.sh',
          pluginId: 'plug@mkt',
          response: {
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext: 'same context',
            },
          },
        },
        prior,
      ),
    ).toBe(true)

    expect(
      isDuplicateSessionStartHookResponse(
        {
          command: 'init.sh',
          pluginId: 'plug@mkt',
          response: {
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext: 'new context',
            },
          },
        },
        prior,
      ),
    ).toBe(false)
  })

  test('#448: toSDKRateLimitInfo includes overageEnabled when provided', () => {
    const sampleLimits = {
      status: 'allowed_warning',
      rateLimitType: 'five_hour',
      utilization: 0.85,
    } as NonNullable<Parameters<typeof toSDKRateLimitInfo>[0]>

    const withOverage = toSDKRateLimitInfo(sampleLimits, {
      overageEnabled: true,
    }) as unknown as Record<string, unknown>
    expect(withOverage.overageEnabled).toBe(true)

    const withoutOverage = toSDKRateLimitInfo(
      sampleLimits,
    ) as unknown as Record<string, unknown>
    expect('overageEnabled' in withoutOverage).toBe(false)
  })
})
