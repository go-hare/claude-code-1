import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BriefTool } from '../../../packages/builtin-tools/src/tools/BriefTool/BriefTool.js'
import {
  getPrecomputeArmThreshold,
  getScalarPrecomputeBufferFraction,
  resolveLivePrecomputeBufferFraction,
} from '../../query.js'
import type { Message } from '../../types/message.js'
import {
  enqueue,
  isFoldInFlight,
  isMidTurnFoldSuspended,
  promoteToNow,
  registerFoldInFlight,
  resetCommandQueue,
  suspendMidTurnFold,
  unregisterFoldInFlight,
} from '../../utils/messageQueueManager.js'
import {
  hasBriefRepliedInTranscript,
  isRequestEligibleForEmptyCompletionResend,
} from '../queryHelpers.js'

const queryDir = join(import.meta.dir, '..')
const querySrc = [
  readFileSync(join(import.meta.dir, '../../query.ts'), 'utf8'),
  ...readdirSync(queryDir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map(f => readFileSync(join(queryDir, f), 'utf8')),
].join('\n')

afterEach(() => {
  resetCommandQueue()
})

describe('Wave 2A [P1-#1]: Mid-turn human prompts fold-in-flight & side effects', () => {
  test('registerFoldInFlight blocks promoteToNow and unregisterFoldInFlight releases it', () => {
    resetCommandQueue()
    const cmdUuid = '00000000-0000-4000-8000-000000000001' as const
    enqueue({
      uuid: cmdUuid,
      value: 'hello mid-turn',
      mode: 'prompt',
      priority: 'next',
    })
    registerFoldInFlight([{ uuid: cmdUuid }])
    expect(isFoldInFlight(cmdUuid)).toBe(true)
    expect(promoteToNow(cmdUuid)).toBe(false)

    unregisterFoldInFlight([{ uuid: cmdUuid }])
    expect(isFoldInFlight(cmdUuid)).toBe(false)
    expect(promoteToNow(cmdUuid)).toBe(true)
  })

  test('suspendMidTurnFold flips isMidTurnFoldSuspended and resets cleanly', () => {
    resetCommandQueue()
    expect(isMidTurnFoldSuspended()).toBe(false)
    suspendMidTurnFold()
    expect(isMidTurnFoldSuspended()).toBe(true)
    resetCommandQueue()
    expect(isMidTurnFoldSuspended()).toBe(false)
  })

  test('query.ts wraps mid-turn fold in registerFoldInFlight/finally, guards consume with abort/suspend, and runs all side effects on consumedCommands', () => {
    expect(querySrc).toContain('registerFoldInFlight(foldInFlightCommands)')
    expect(querySrc).toContain('unregisterFoldInFlight(foldInFlightCommands)')
    expect(querySrc).toContain('isMidTurnFoldSuspended()')
    expect(querySrc).toContain('applyAbsorbedMidTurnEffects(consumedCommands)')
    expect(querySrc).toMatch(
      /applyAbsorbedMidTurnEffects\(\s*claimedConsumedCommands,?\s*\)/,
    )
    expect(querySrc).toContain(
      'addToHistory(cmd.historyEntry, { armUndo: false })',
    )
    expect(querySrc).toContain('emitMidTurnUserPromptOTelEvents(commands)')
    expect(querySrc).toContain('updateTurnAttributionFromCommands(commands)')
    expect(querySrc).toContain('clearGoalIdleCheckinCount(')
  })
})

describe('Wave 2A [P1-#6]: Recovery message yields, lastDeltaStopReason, and empty-completion resend/give-up', () => {
  test('query.ts yields recoveryMessage in both max_output_tokens_recovery and truncated_response_recovery', () => {
    const motIdx = querySrc.indexOf("reason: 'max_output_tokens_recovery'")
    expect(motIdx).toBeGreaterThan(0)
    const motWindow = querySrc.slice(motIdx - 900, motIdx)
    expect(motWindow).toContain('yield recoveryMessage')

    const truncIdx = querySrc.indexOf("reason: 'truncated_response_recovery'")
    expect(truncIdx).toBeGreaterThan(motIdx)
    const truncWindow = querySrc.slice(truncIdx - 900, truncIdx)
    expect(truncWindow).toContain('yield recoveryMessage')
  })

  test('query.ts tracks lastDeltaStopReason and threads it into malformed_tool_use and thinking_only / empty_completion recovery', () => {
    expect(querySrc).toContain(
      'lastDeltaStopReason = streamEv.delta.stop_reason',
    )
    expect(querySrc).toContain(
      'lastMessage?.message.stop_reason ?? lastDeltaStopReason',
    )
    expect(querySrc).toContain(
      'lastMessage?.message?.stop_reason ?? lastDeltaStopReason',
    )
    expect(querySrc).toContain('emptyCompletionResent: true')
    expect(querySrc).toContain("apiError: 'empty_completion'")
  })

  test('isRequestEligibleForEmptyCompletionResend matches official DS(e) / FS(e)', () => {
    const humanMsg = {
      type: 'user',
      uuid: 'u1',
      message: { role: 'user', content: 'hi' },
    } as unknown as Message
    expect(
      isRequestEligibleForEmptyCompletionResend([humanMsg], {
        gateOverride: true,
      }),
    ).toBe(true)
    expect(
      isRequestEligibleForEmptyCompletionResend([humanMsg], {
        gateOverride: false,
      }),
    ).toBe(false)

    // Tool result carrier is not eligible
    const toolResultMsg = {
      type: 'user',
      uuid: 'u2',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    } as unknown as Message
    expect(
      isRequestEligibleForEmptyCompletionResend([humanMsg, toolResultMsg], {
        gateOverride: true,
      }),
    ).toBe(false)

    // Trailing turnCompanion meta nudge skips over to find underlying human prompt
    const companionMsg = {
      type: 'user',
      uuid: 'u3',
      isMeta: true,
      turnCompanion: true,
      message: { role: 'user', content: '[nudge]' },
    } as unknown as Message
    expect(
      isRequestEligibleForEmptyCompletionResend([humanMsg, companionMsg], {
        gateOverride: true,
      }),
    ).toBe(true)

    // Non-human origin is not eligible
    const cronMsg = {
      type: 'user',
      uuid: 'u4',
      origin: { kind: 'cron' },
      message: { role: 'user', content: 'scheduled tick' },
    } as unknown as Message
    expect(
      isRequestEligibleForEmptyCompletionResend([cronMsg], {
        gateOverride: true,
      }),
    ).toBe(false)
  })
})

describe('Wave 2A [P1-#8] & [P1-#27]: Single autocompact path & live tengu_amber_moleskin wiring', () => {
  test('query.ts has no duplicate post-setup predictive autocompact block', () => {
    expect(querySrc).not.toContain('predictiveThreshold')
    expect(querySrc).not.toContain('estimateMaxTurnGrowth')
    const autocompactCalls =
      querySrc.match(/(?:deps|queryDeps)\.autocompact\(/g) ?? []
    expect(autocompactCalls).toHaveLength(1)
  })

  test('resolveLivePrecomputeBufferFraction and getPrecomputeArmThreshold compute valid thresholds', () => {
    const scalar = getScalarPrecomputeBufferFraction()
    expect(scalar).toBeGreaterThanOrEqual(0)
    expect(scalar).toBeLessThan(1)

    const resolved = resolveLivePrecomputeBufferFraction(
      'claude-sonnet-4-6',
      'repl_main_thread',
    )
    expect(resolved.fraction).toBeGreaterThanOrEqual(0)
    expect(resolved.fraction).toBeLessThan(1)

    const arm = getPrecomputeArmThreshold(
      'claude-sonnet-4-6',
      'repl_main_thread',
    )
    expect(arm.threshold).toBeGreaterThan(0)
    expect(arm.threshold).toBeLessThanOrEqual(arm.effectiveWindow)
    expect(querySrc).toContain('getPrecomputeArmThreshold(')
  })
})

describe('Wave 2A [P1-#33]: Transcript-based Brief reply detection (Pf) & non-suppressing BriefTool.call', () => {
  test('hasBriefRepliedInTranscript returns true only when last assistant turn delivered Brief with no intervening prompt or error', () => {
    const briefAssistant = {
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu-brief-1',
            name: 'SendUserMessage',
            input: { message: 'Done!', status: 'normal' },
          },
        ],
      },
    } as unknown as Message
    const briefResultOk = {
      type: 'user',
      uuid: 'u-res-1',
      toolUseResult: { message: 'Done!' },
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-brief-1',
            content: 'Message delivered to user.',
          },
        ],
      },
    } as unknown as Message

    expect(
      hasBriefRepliedInTranscript([briefAssistant, briefResultOk], {
        briefEnabled: true,
      }),
    ).toBe(true)
    expect(
      hasBriefRepliedInTranscript([briefAssistant, briefResultOk], {
        briefEnabled: false,
      }),
    ).toBe(false)

    // Intervening user prompt invalidates skip
    const newUserPrompt = {
      type: 'user',
      uuid: 'u-next',
      message: { role: 'user', content: 'follow-up question' },
    } as unknown as Message
    expect(
      hasBriefRepliedInTranscript(
        [briefAssistant, briefResultOk, newUserPrompt],
        { briefEnabled: true },
      ),
    ).toBe(false)

    // Intervening queued_command attachment invalidates skip
    const queuedAtt = {
      type: 'attachment',
      uuid: 'att-1',
      attachment: { type: 'queued_command', prompt: 'hi' },
    } as unknown as Message
    expect(
      hasBriefRepliedInTranscript([briefAssistant, briefResultOk, queuedAtt], {
        briefEnabled: true,
      }),
    ).toBe(false)

    // Undelivered / failed brief result invalidates skip
    const briefNotDelivered = {
      type: 'user',
      uuid: 'u-res-err',
      toolUseResult: {},
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-brief-1',
            content:
              'Attachment was NOT delivered to Remote Control (phone/web) viewers.',
          },
        ],
      },
    } as unknown as Message
    expect(
      hasBriefRepliedInTranscript([briefAssistant, briefNotDelivered], {
        briefEnabled: true,
      }),
    ).toBe(false)

    // Mixed non-Brief tool call in same assistant turn invalidates skip
    const mixedAssistant = {
      type: 'assistant',
      uuid: 'a2',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu-brief-1',
            name: 'SendUserMessage',
            input: { message: 'Checking...', status: 'normal' },
          },
          {
            type: 'tool_use',
            id: 'tu-bash-1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
    } as unknown as Message
    expect(
      hasBriefRepliedInTranscript([mixedAssistant, briefResultOk], {
        briefEnabled: true,
      }),
    ).toBe(false)
  })

  test('BriefTool.call does not suppress a legitimate second SendUserMessage call on the same AbortSignal', async () => {
    const ac = new AbortController()
    const fakeCtx = {
      abortController: ac,
      getAppState: () => ({ replBridgeEnabled: false }),
    } as never

    const first = await BriefTool.call(
      { message: 'Progress update', status: 'normal' },
      fakeCtx,
    )
    const second = await BriefTool.call(
      { message: 'Final answer', status: 'normal' },
      fakeCtx,
    )

    expect(
      (first.data as { duplicateSuppressed?: boolean }).duplicateSuppressed,
    ).toBeUndefined()
    expect(
      (second.data as { duplicateSuppressed?: boolean }).duplicateSuppressed,
    ).toBeUndefined()

    const block = BriefTool.mapToolResultToToolResultBlockParam(
      second.data,
      'tu-2',
    )
    expect(block.content).toBe('Message delivered to user.')
  })
})
