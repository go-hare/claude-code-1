import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import uniqBy from 'lodash-es/uniqBy.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const sessionTranscriptModule = feature('KAIROS')
  ? (require('../sessionTranscript/sessionTranscript.js') as typeof import('../sessionTranscript/sessionTranscript.js'))
  : null

import { APIUserAbortError } from '@anthropic-ai/sdk'
import {
  getInvokedSkillsForAgent,
  markPostCompaction,
} from 'src/bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { SearchExtraToolsTool } from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/SearchExtraToolsTool.js'
import type { AgentId } from '../../types/ids.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  HookResultMessage,
  Message,
  PartialCompactDirection,
  StreamEvent,
  SystemAPIErrorMessage,
  SystemCompactBoundaryMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import {
  getEffortValueFromLayers,
  getMainLoopModelFromLayers,
} from '../../engine/permissionLayerReaders.js'
import {
  buildThinkingStripPlanFromMessages,
  carryThinkingStripFromSummarized,
  resolveCompactThinkingStrip,
  thinkingStrippedAttachment,
} from '../../utils/thinking.js'
import {
  createAttachmentMessage,
  generateFileAttachment,
  getAgentListingDeltaAttachment,
  getDeferredToolsDeltaAttachment,
  getMcpInstructionsDeltaAttachment,
  type Attachment,
} from '../../utils/attachments.js'
import { compactSpinnerHintText } from '../../utils/autoCompactWindow.js'
import { getMemoryPath } from '../../utils/config.js'
import { COMPACT_MAX_OUTPUT_TOKENS } from '../../utils/context.js'
import {
  analyzeContext,
  tokenStatsToStatsigMetrics,
} from '../../utils/contextAnalysis.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import { cacheToObject } from '../../utils/fileStateCache.js'
import {
  type CacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import {
  executePostCompactHooks,
  executePreCompactHooks,
} from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import { MEMORY_TYPE_VALUES } from '../../utils/memory/types.js'
import {
  buildAdvisorStripPlanFromMessages,
  createCompactBoundaryMessage,
  createUserMessage,
  getAssistantMessageText,
  getLastAssistantMessage,
  getMessagesAfterCompactBoundary,
  isCompactBoundaryMessage,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import { expandPath } from '../../utils/path.js'
import { getPlan, getPlanFilePath } from '../../utils/plans.js'
import {
  isSessionActivityTrackingActive,
  sendSessionActivitySignal,
} from '../../utils/sessionActivity.js'
import { processSessionStartHooks } from '../../utils/sessionStart.js'
import {
  getTranscriptPath,
  reAppendSessionMetadata,
} from '../../utils/sessionStorage.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import {
  getTokenUsage,
  tokenCountFromLastAPIResponse,
  tokenCountWithEstimation,
} from '../../utils/tokens.js'
import {
  extractDiscoveredToolNames,
  isSearchExtraToolsEnabled,
} from '../../utils/searchExtraTools.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  getMaxOutputTokensForModel,
  queryModelWithStreaming,
} from '../api/claude.js'
import {
  getPromptTooLongTokenGap,
  isMediaSizeErrorMessage,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  startsWithApiErrorPrefix,
} from '../api/errors.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import { getRetryDelay } from '../api/withRetry.js'
import { logPermissionContextForAnts } from '../internalLogging.js'
import {
  roughTokenCountEstimation,
  roughTokenCountEstimationForMessages,
} from '../tokenEstimation.js'
import { groupMessagesByApiRound } from './grouping.js'
import { getRuntimeMainLoopModel } from '../../utils/model/model.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import {
  collectToolNamesUsedBeforeCompact,
  COMPACT_REPLY_INSTRUCTIONS_TRAILER,
  getCompactPrompt,
  appendKeptMessagesCompactNote,
  getCompactUserSummaryMessage,
  getPartialCompactPrompt,
  hasCompactSummaryBlock,
  hasCompactSummaryTag,
  hasUnclosedCompactSummaryTag,
  LEFT_OUT_TOOL_RESULTS_NOTE,
  SUMMARY_DO_NOT_ANSWER_REMINDER,
  TOOL_RESULT_LEFT_OUT_PREFIX,
} from './prompt.js'
import { isLongContextCreditsRequiredMessage } from './reactiveCompact.js'

export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5
export const POST_COMPACT_TOKEN_BUDGET = 50_000
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000
// Skills can be large (verify=18.7KB, claude-api=20.1KB). Previously re-injected
// unbounded on every compact → 5-10K tok/compact. Per-skill truncation beats
// dropping — instructions at the top of a skill file are usually the critical
// part. Budget sized to hold ~5 skills at the per-skill cap.
export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000
const MAX_COMPACT_STREAMING_RETRIES = 2

/**
 * Strip image blocks from user messages before sending for compaction.
 * Images are not needed for generating a conversation summary and can
 * cause the compaction API call itself to hit the prompt-too-long limit,
 * especially in CCD sessions where users frequently attach images.
 * Replaces image blocks with a text marker so the summary still notes
 * that an image was shared.
 *
 * Note: Only user messages contain images (either directly attached or within
 * tool_result content from tools). Assistant messages contain text, tool_use,
 * and thinking blocks but not images.
 */
export function stripImagesFromMessages(messages: Message[]): Message[] {
  return messages.map(message => {
    if (message.type === 'attachment' && message.attachment) {
      const att = message.attachment as Record<string, unknown>
      if (att.type === 'queued_command' && Array.isArray(att.prompt)) {
        let changed = false
        const strippedPrompt = att.prompt.map(block => {
          if (block !== null && typeof block === 'object' && 'type' in block) {
            if ((block as { type: unknown }).type === 'image') {
              changed = true
              return { type: 'text', text: '[image]' }
            }
            if ((block as { type: unknown }).type === 'document') {
              changed = true
              return { type: 'text', text: '[document]' }
            }
          }
          return block
        })
        if (!changed) return message
        return {
          ...message,
          attachment: { ...att, prompt: strippedPrompt },
        } as unknown as Message
      }
      if (
        att.type === 'file' &&
        att.content !== null &&
        typeof att.content === 'object' &&
        'type' in att.content
      ) {
        const contentType = (att.content as { type: unknown }).type
        if (
          contentType === 'image' ||
          contentType === 'notebook' ||
          contentType === 'parts'
        ) {
          return {
            ...message,
            attachment: {
              ...att,
              content: {
                type: 'text',
                file: {
                  filePath: att.filename,
                  content: `[${contentType}]`,
                  numLines: 1,
                  startLine: 1,
                  totalLines: 1,
                },
              },
            },
          } as unknown as Message
        }
      }
      if (
        att.type === 'message_pdf_reads' &&
        Array.isArray(att.reads) &&
        att.reads.length > 0
      ) {
        return {
          ...message,
          attachment: { ...att, reads: [] },
        } as unknown as Message
      }
      return message
    }

    if (message.type !== 'user') {
      return message
    }

    const content = message.message!.content
    if (!Array.isArray(content)) {
      return message
    }

    let hasMediaBlock = false
    const newContent = content.flatMap(block => {
      if (block.type === 'image') {
        hasMediaBlock = true
        return [{ type: 'text' as const, text: '[image]' }]
      }
      if (block.type === 'document') {
        hasMediaBlock = true
        return [{ type: 'text' as const, text: '[document]' }]
      }
      // Also strip images/documents nested inside tool_result content arrays
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        let toolHasMedia = false
        const newToolContent = block.content.map(item => {
          if (item.type === 'image') {
            toolHasMedia = true
            return { type: 'text' as const, text: '[image]' }
          }
          if (item.type === 'document') {
            toolHasMedia = true
            return { type: 'text' as const, text: '[document]' }
          }
          return item
        })
        if (toolHasMedia) {
          hasMediaBlock = true
          return [{ ...block, content: newToolContent }]
        }
      }
      return [block]
    })

    if (!hasMediaBlock) {
      return message
    }

    return {
      ...message,
      message: {
        ...message.message,
        content: newContent,
      },
    } as typeof message
  })
}

/**
 * Strip attachment types that are re-injected post-compaction anyway.
 * skill_discovery/skill_listing are re-surfaced by resetSentSkillNames()
 * + the next turn's discovery signal, so feeding them to the summarizer
 * wastes tokens and pollutes the summary with stale skill suggestions.
 *
 * No-op when EXPERIMENTAL_SKILL_SEARCH is off (the attachment types
 * don't exist on external builds).
 */
const REINJECTED_TRANSIENT_ATTACHMENTS = new Set([
  'poll_events',
  'dir_sync_notice',
  'fork_briefing',
  'thinking_stripped',
  'advisor_stripped',
])

export function stripReinjectedAttachments(messages: Message[]): Message[] {
  return messages.filter(m => {
    if (m.type !== 'attachment' || !m.attachment) return true
    if (REINJECTED_TRANSIENT_ATTACHMENTS.has(m.attachment.type)) return false
    if (
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      (m.attachment.type === 'skill_discovery' ||
        m.attachment.type === 'skill_listing')
    ) {
      return false
    }
    return true
  })
}

const NON_ESSENTIAL_TOOL_TEXT_LIMIT = 100

function truncateToolTextForNonEssential(text: string): string {
  if (text.length <= NON_ESSENTIAL_TOOL_TEXT_LIMIT) return text
  let end = NON_ESSENTIAL_TOOL_TEXT_LIMIT
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end--
  return `${text.slice(0, end)}…[truncated, original ${text.length} chars]`
}

function truncateToolInputValue(value: unknown): unknown {
  if (typeof value === 'string') return truncateToolTextForNonEssential(value)
  if (Array.isArray(value)) {
    const next = value.map(truncateToolInputValue)
    return next.some((item, idx) => item !== value[idx]) ? next : value
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      const truncated = truncateToolInputValue(v)
      if (truncated !== v) changed = true
      next[k] = truncated
    }
    return changed ? next : value
  }
  return value
}

function isThinkingOrRedactedBlock(block: unknown): boolean {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    ((block as { type: unknown }).type === 'thinking' ||
      (block as { type: unknown }).type === 'redacted_thinking')
  )
}

/**
 * Official 2.1.300 (#792) `rJr` — when compacting in `stripNonEssential` mode,
 * strip thinking blocks, `wireToolInputs` / `wireIngestContext`, and truncate
 * `tool_use.input` strings and `tool_result.content` to 100 chars.
 */
export function stripToolPayloadsForNonEssential(
  messages: Message[],
): Message[] {
  return messages.map(msg => {
    if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (!Array.isArray(content)) return msg
      let changed = content.some(isThinkingOrRedactedBlock)
      const filtered = changed
        ? content.filter(b => !isThinkingOrRedactedBlock(b))
        : content
      const nextContent = filtered.map(block => {
        if (
          typeof block !== 'object' ||
          block === null ||
          !('type' in block) ||
          block.type !== 'tool_use'
        ) {
          return block
        }
        const truncatedInput = truncateToolInputValue(block.input)
        if (truncatedInput === block.input) return block
        changed = true
        return { ...block, input: truncatedInput }
      })
      const record = msg as Message & {
        wireToolInputs?: unknown
        wireIngestContext?: unknown
      }
      if (
        !changed &&
        record.wireToolInputs === undefined &&
        record.wireIngestContext === undefined
      ) {
        return msg
      }
      const {
        wireToolInputs: _wireToolInputs,
        wireIngestContext: _wireIngestContext,
        ...rest
      } = record
      return {
        ...rest,
        message: { ...msg.message, content: nextContent },
      } as Message
    }
    if (msg.type === 'user') {
      const content = msg.message?.content
      if (!Array.isArray(content)) return msg
      let changed = false
      const nextContent = content.map(block => {
        if (
          typeof block !== 'object' ||
          block === null ||
          !('type' in block) ||
          block.type !== 'tool_result'
        ) {
          return block
        }
        const raw =
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  .filter(
                    (b): b is { type: 'text'; text: string } =>
                      typeof b === 'object' &&
                      b !== null &&
                      'type' in b &&
                      b.type === 'text' &&
                      'text' in b &&
                      typeof b.text === 'string',
                  )
                  .map(b => b.text)
                  .join('')
              : ''
        const truncated = truncateToolTextForNonEssential(raw)
        if (block.content === truncated) return block
        changed = true
        return { ...block, content: truncated }
      })
      if (!changed) return msg
      return {
        ...msg,
        message: { ...msg.message, content: nextContent },
      } as Message
    }
    return msg
  })
}

export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES =
  'Not enough messages to compact. Send a few more messages first, then try again.'
const MAX_PTL_RETRIES = 3
const PTL_RETRY_MARKER = '[earlier conversation truncated for compaction retry]'

/**
 * Drops the oldest API-round groups from messages until tokenGap is covered.
 * Falls back to dropping 20% of groups when the gap is unparseable (some
 * Vertex/Bedrock error formats). Returns null when nothing can be dropped
 * without leaving an empty summarize set.
 *
 * This is the last-resort escape hatch for CC-1180 — when the compact request
 * itself hits prompt-too-long, the user is otherwise stuck. Dropping the
 * oldest context is lossy but unblocks them. The reactive-compact path
 * (compactMessages.ts) has the proper retry loop that peels from the tail;
 * this helper is the dumb-but-safe fallback for the proactive/manual path
 * that wasn't migrated in bfdb472f's unification.
 */
export function truncateHeadForPTLRetry(
  messages: Message[],
  ptlResponse: AssistantMessage | undefined,
  mediaStripped = false,
  explicitTokenGap?: number,
): Message[] | null {
  // Strip our own synthetic marker from a previous retry before grouping.
  // Otherwise it becomes its own group 0 and the 20% fallback stalls
  // (drops only the marker, re-adds it, zero progress on retry 2+).
  const input =
    messages[0]?.type === 'user' &&
    messages[0]?.isMeta &&
    messages[0]?.message?.content === PTL_RETRY_MARKER
      ? messages.slice(1)
      : messages

  // #1566: preserve leading isCompactSummary message when truncating head for PTL retry
  const leadingSummary =
    input[0]?.type === 'user' && input[0]?.isCompactSummary === true
      ? input[0]
      : undefined
  const body = leadingSummary ? input.slice(1) : input
  const bodyGroups = groupMessagesByApiRound(body)
  const keepLeadingSummary =
    leadingSummary !== undefined && bodyGroups.length >= 2
  const groups = keepLeadingSummary
    ? bodyGroups
    : groupMessagesByApiRound(input)
  if (groups.length < 2) return null

  const tokenGap =
    explicitTokenGap !== undefined && explicitTokenGap > 0
      ? explicitTokenGap
      : ptlResponse !== undefined
        ? getPromptTooLongTokenGap(ptlResponse)
        : undefined
  let dropCount: number
  if (tokenGap !== undefined) {
    let acc = 0
    dropCount = 0
    for (const g of groups) {
      const target = mediaStripped ? stripImagesFromMessages(g) : g
      acc += roughTokenCountEstimationForMessages(
        target as Parameters<typeof roughTokenCountEstimationForMessages>[0],
      )
      dropCount++
      if (acc >= tokenGap) break
    }
  } else {
    // When the error only reports the limit (e.g. Gemini "exceeds the maximum
    // number of tokens allowed 1048576"), dropping 20% of group *count* can
    // shed only a few tiny text turns while leaving 99% of token mass in later
    // tool-heavy rounds. Ensure we drop at least 20% of groups AND at least
    // 25% of estimated token volume across the groups.
    const minGroupDrop = Math.max(1, Math.floor(groups.length * 0.2))
    const groupTokens = groups.map(g => {
      const target = mediaStripped ? stripImagesFromMessages(g) : g
      return roughTokenCountEstimationForMessages(
        target as Parameters<typeof roughTokenCountEstimationForMessages>[0],
      )
    })
    const totalTokens = groupTokens.reduce((sum, n) => sum + n, 0)
    const targetTokenDrop = Math.ceil(totalTokens * 0.25)
    let accTokens = 0
    let tokenDropCount = 0
    for (const t of groupTokens) {
      accTokens += t
      tokenDropCount++
      if (accTokens >= targetTokenDrop) break
    }
    dropCount = Math.max(minGroupDrop, tokenDropCount)
  }

  // Keep at least one group so there's something to summarize.
  dropCount = Math.min(dropCount, groups.length - 1)
  if (dropCount < 1) return null

  const sliced = groups.slice(dropCount).flat()
  if (keepLeadingSummary && leadingSummary) {
    return [leadingSummary, ...sliced]
  }
  // groupMessagesByApiRound puts the preamble in group 0 and starts every
  // subsequent group with an assistant message. Dropping group 0 leaves an
  // assistant-first sequence which the API rejects (first message must be
  // role=user). Prepend a synthetic user marker — ensureToolResultPairing
  // already handles any orphaned tool_results this creates.
  if (sliced[0]?.type === 'assistant') {
    return [
      createUserMessage({ content: PTL_RETRY_MARKER, isMeta: true }),
      ...sliced,
    ]
  }
  return sliced
}

export { TOOL_RESULT_LEFT_OUT_PREFIX }

const COMPACT_LEAVE_OUT_GAP_MULTIPLIER = 1.1
const COMPACT_LEAVE_OUT_FRACTION = 0.5

/**
 * Official 2.1.328 `R9r()` (#567):
 * True for Claude Desktop sessions on third-party providers (excluding
 * host-scheduled tasks), gated by `tengu_generic_papert` (defaulting to the
 * 3P Desktop non-scheduled predicate).
 */
export function isThirdPartyDesktopLargeToolResultOmissionEnabled(opts?: {
  env?: NodeJS.ProcessEnv
  provider?: string
  flagValue?: boolean
}): boolean {
  const env = opts?.env ?? process.env
  const entrypoint = env.CLAUDE_CODE_ENTRYPOINT
  const isDesktop3p =
    isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) &&
    (entrypoint === 'claude-desktop-3p' ||
      (entrypoint === 'local-agent' &&
        (env.CLAUDE_CODE_DESKTOP_APP_VERSION ?? '') === ''))
  const isScheduledRun = isEnvTruthy(env.CLAUDE_CODE_HOST_SCHEDULED_RUN)
  const provider = opts?.provider ?? getAPIProvider()
  const isThirdParty = provider !== 'firstParty'
  const defaultEnabled = isDesktop3p && !isScheduledRun && isThirdParty
  if (opts?.flagValue !== undefined) {
    return opts.flagValue
  }
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_generic_papert',
    defaultEnabled,
  )
}

function estimateToolResultChars(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) {
    let total = 0
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      if (
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string'
      ) {
        total += block.text.length
      } else {
        try {
          total += JSON.stringify(block).length
        } catch {
          total += 1024
        }
      }
    }
    return total
  }
  return 0
}

function formatByteSizeForSummaryNote(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)} MB`
  if (chars >= 1_000) return `${Math.round(chars / 1_000)} KB`
  return `${chars} B`
}

export type OmitLargestToolResultsResult = {
  messages: Message[]
  leftOutIds: string[]
  tokensFreed: number
}

/**
 * Official 2.1.328 `c6n()` / `Sws()` (#567):
 * Single consolidated PTL tool-result omission pass replacing the largest
 * `tool_result` payloads with a bracketed `[Tool result left out: ...]`
 * placeholder so compaction requests recover from "Prompt is too long".
 */
export function omitLargestToolResultsForSummary(
  messages: Message[],
  opts?: {
    tokenGap?: number
    omitAll?: boolean
    alreadyLeftOut?: ReadonlySet<string>
    bytesPerToken?: number
  },
): OmitLargestToolResultsResult | null {
  const bytesPerToken = opts?.bytesPerToken ?? 3
  const alreadyLeftOut = opts?.alreadyLeftOut ?? new Set<string>()
  type Candidate = {
    id: string
    chars: number
    tokens: number
  }
  const candidates: Candidate[] = []
  for (const msg of messages) {
    if (msg.type !== 'user') continue
    const content = msg.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        !block ||
        typeof block !== 'object' ||
        block.type !== 'tool_result' ||
        typeof block.tool_use_id !== 'string'
      ) {
        continue
      }
      if (alreadyLeftOut.has(block.tool_use_id)) continue
      if (
        typeof block.content === 'string' &&
        block.content.startsWith(TOOL_RESULT_LEFT_OUT_PREFIX)
      ) {
        continue
      }
      const chars = estimateToolResultChars(block.content)
      if (chars <= 0) continue
      candidates.push({
        id: block.tool_use_id,
        chars,
        tokens: Math.ceil(chars / bytesPerToken),
      })
    }
  }
  if (candidates.length === 0) return null

  const totalTokens = candidates.reduce((acc, c) => acc + c.tokens, 0)
  const targetTokens = opts?.omitAll
    ? Number.POSITIVE_INFINITY
    : opts?.tokenGap !== undefined && opts.tokenGap > 0
      ? opts.tokenGap * COMPACT_LEAVE_OUT_GAP_MULTIPLIER
      : totalTokens * COMPACT_LEAVE_OUT_FRACTION

  const sorted = [...candidates].sort((a, b) => b.tokens - a.tokens)
  const replacements = new Map<string, string>()
  let freed = 0
  for (const item of sorted) {
    if (freed >= targetTokens && replacements.size > 0) break
    replacements.set(
      item.id,
      `${TOOL_RESULT_LEFT_OUT_PREFIX} too large for this summary request (${formatByteSizeForSummaryNote(item.chars)}). The call was made and may have had effects; its output is not available.]`,
    )
    freed += item.tokens
  }
  if (replacements.size === 0) return null

  const rewritten = messages.map(msg => {
    if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) {
      return msg
    }
    let changed = false
    const nextContent = msg.message.content.map(block => {
      if (
        block &&
        typeof block === 'object' &&
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string'
      ) {
        const placeholder = replacements.get(block.tool_use_id)
        if (placeholder !== undefined) {
          changed = true
          return { ...block, content: placeholder }
        }
      }
      return block
    })
    return changed
      ? ({
          ...msg,
          message: { ...msg.message, content: nextContent },
        } as Message)
      : msg
  })

  return {
    messages: rewritten,
    leftOutIds: [...replacements.keys()],
    tokensFreed: freed,
  }
}

/** Official 2.1.328 `QTa()` (#567): check whether leaving out tool results can recover PTL. */
export function canOmitToolResultsToRecoverPTL(
  messages: Message[],
  opts?: {
    env?: NodeJS.ProcessEnv
    provider?: string
    flagValue?: boolean
  },
): boolean {
  if (!isThirdPartyDesktopLargeToolResultOmissionEnabled(opts)) {
    return false
  }
  return omitLargestToolResultsForSummary(messages) !== null
}

/**
 * Check whether any message already contains a `[Tool result left out:` placeholder.
 */
export function hasLeftOutToolResultPlaceholders(messages: Message[]): boolean {
  for (const msg of messages) {
    if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) continue
    for (const block of msg.message.content) {
      if (
        block &&
        typeof block === 'object' &&
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.startsWith(TOOL_RESULT_LEFT_OUT_PREFIX)
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Official 2.1.328 `b6n` prompt assembly: append `LEFT_OUT_TOOL_RESULTS_NOTE`
 * whenever any tool result has been left out of the summary request.
 */
export function buildCompactSummaryRequestContent(opts: {
  basePrompt: string
  hasLeftOutToolResults: boolean
  includeReplyInstructionsTrailer?: boolean
}): string {
  return (
    opts.basePrompt +
    (opts.hasLeftOutToolResults ? LEFT_OUT_TOOL_RESULTS_NOTE : '') +
    (opts.includeReplyInstructionsTrailer
      ? COMPACT_REPLY_INSTRUCTIONS_TRAILER
      : '')
  )
}

/**
 * Back-compat wrapper around `omitLargestToolResultsForSummary` (`c6n`/`Sws`).
 */
export function leaveOutToolResultsForPTLRetry(
  messages: Message[],
  tokenGap?: number,
  leaveAll = false,
): Message[] | null {
  return (
    omitLargestToolResultsForSummary(messages, {
      tokenGap,
      omitAll: leaveAll,
    })?.messages ?? null
  )
}

export const ERROR_MESSAGE_PROMPT_TOO_LONG =
  'Conversation too long to summarize. Try /compact to manually clear conversation history, or start a new session with /clear.'
export const ERROR_MESSAGE_USER_ABORT = 'API Error: Request was aborted.'
export const ERROR_MESSAGE_INCOMPLETE_RESPONSE =
  'Compaction interrupted · This may be due to network issues — please try again.'

export class CompactionBlockedByHookError extends Error {}

export function throwIfCompactBlockedByHook(
  result: { blockedBy?: string },
  context: Pick<ToolUseContext, 'addNotification'>,
  options?: { suppressNotification?: boolean },
): void {
  if (!result.blockedBy) return
  logForDebugging(
    `Compaction blocked by PreCompact hook: ${result.blockedBy}`,
    { level: 'warn' },
  )
  if (!options?.suppressNotification)
    context.addNotification?.({
      key: 'compaction-blocked-by-hook',
      text: 'compaction blocked by PreCompact hook',
      priority: 'immediate',
      color: 'warning',
    })
  throw new CompactionBlockedByHookError(
    `Compaction blocked by PreCompact hook: ${result.blockedBy}`,
  )
}

export interface CompactionResult {
  boundaryMarker: SystemMessage
  summaryMessages: UserMessage[]
  attachments: AttachmentMessage[]
  hookResults: HookResultMessage[]
  messagesToKeep?: Message[]
  userDisplayMessage?: string
  preCompactTokenCount?: number
  postCompactTokenCount?: number
  truePostCompactTokenCount?: number
  compactionUsage?: ReturnType<typeof getTokenUsage>
}

/**
 * Diagnosis context passed from autoCompactIfNeeded into compactConversation.
 * Lets the tengu_compact event disambiguate same-chain loops (H2) from
 * cross-agent (H1/H5) and manual-vs-auto (H3) compactions without joins.
 */
export type RecompactionInfo = {
  isRecompactionInChain: boolean
  turnsSincePreviousCompact: number
  previousCompactTurnId?: string
  autoCompactThreshold: number
  querySource?: QuerySource
}

/**
 * Build the base post-compact messages array from a CompactionResult.
 * This ensures consistent ordering across all compaction paths.
 * densable `cze`: boundaryMarker, summaryMessages, messagesToKeep, attachments, hookResults
 * (full compact; messagesToKeep usually empty — does NOT zero usage).
 */
export function buildPostCompactMessages(result: CompactionResult): Message[] {
  return ([result.boundaryMarker] as Message[]).concat(
    result.summaryMessages,
    stripToolUseResults(result.messagesToKeep),
    result.attachments,
    result.hookResults,
  )
}

/**
 * densable `Edt` — zero API usage on preserved assistant messages after
 * partial compact (message picker). Kept assistants still carry pre-compact
 * usage; without this, `/context` / status-line `getCurrentUsage`/`zfr` read
 * the last kept assistant and report stale pre-compact token totals
 * (official 2.1.218 #6).
 */
export function zeroKeptAssistantUsage(message: Message): Message {
  if (message.type !== 'assistant') return message
  const usage = message.message?.usage
  return {
    ...message,
    message: {
      ...message.message,
      usage: {
        ...(usage && typeof usage === 'object' ? usage : {}),
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as Message
}

/**
 * densable `Pid` — assemble post-partial-compact transcript:
 * zero kept-assistant usage, order summary vs keep by direction, then
 * boundary + ordered + attachments + hookResults.
 */
export function buildPartialPostCompactMessages(
  result: CompactionResult,
  direction: PartialCompactDirection = 'from',
): Message[] {
  const kept = (result.messagesToKeep ?? []).map(zeroKeptAssistantUsage)
  const ordered =
    direction === 'up_to'
      ? [...result.summaryMessages, ...kept]
      : [...kept, ...result.summaryMessages]
  return [
    result.boundaryMarker,
    ...ordered,
    ...result.attachments,
    ...result.hookResults,
  ]
}

/** Release large tool result payloads from kept messages after compaction.
 *  toolUseResult is only used for UI rendering, not API calls. */
function stripToolUseResults(messages: Message[] | undefined): Message[] {
  if (!messages) return []
  return messages.map(msg => {
    if (
      msg.type === 'user' &&
      'toolUseResult' in msg &&
      msg.toolUseResult !== undefined
    ) {
      const { toolUseResult, ...rest } = msg as Message & {
        toolUseResult: unknown
      }
      return rest as Message
    }
    return msg
  })
}

/**
 * Annotate a compact boundary with relink metadata for messagesToKeep.
 * Preserved messages keep their original parentUuids on disk (dedup-skipped);
 * the loader uses this to patch head→anchor and anchor's-other-children→tail.
 *
 * `anchorUuid` = what sits immediately before keep[0] in the desired chain:
 *   - suffix-preserving (reactive/session-memory): last summary message
 *   - prefix-preserving (partial compact): the boundary itself
 */
export function annotateBoundaryWithPreservedSegment(
  boundary: SystemCompactBoundaryMessage,
  anchorUuid: UUID,
  messagesToKeep: readonly Message[] | undefined,
): SystemCompactBoundaryMessage {
  const keep = messagesToKeep ?? []
  if (keep.length === 0) return boundary
  return {
    ...boundary,
    compactMetadata: {
      ...boundary.compactMetadata,
      preservedSegment: {
        headUuid: keep[0]!.uuid,
        anchorUuid,
        tailUuid: keep.at(-1)!.uuid,
      },
    },
  }
}

const MAX_PRE_COMPACT_ARTIFACT_READ_VERSIONS = 256

function isMainArtifactObserver(
  observers: Record<string, string> | undefined,
): boolean {
  return observers === undefined || Object.hasOwn(observers, 'main')
}

export type PreCompactArtifactAppState = {
  artifactReadVersions?: Record<string, string>
  artifactReadObservers?: Record<string, Record<string, string>>
}

export function collectPreCompactArtifactReadVersions(
  appState: PreCompactArtifactAppState,
): Array<{ slug: string; ver: string }> | undefined {
  const versions = appState.artifactReadVersions
  if (versions === undefined) return undefined
  const out: Array<{ slug: string; ver: string }> = []
  for (const [slug, ver] of Object.entries(versions)) {
    if (isMainArtifactObserver(appState.artifactReadObservers?.[slug])) {
      out.push({ slug, ver })
    }
  }
  return out.reverse().slice(0, MAX_PRE_COMPACT_ARTIFACT_READ_VERSIONS)
}

export function attachPreCompactArtifactReadVersions(
  boundaryMarker: SystemCompactBoundaryMessage,
  agentId: AgentId | undefined,
  appState: PreCompactArtifactAppState | undefined,
): void {
  if (agentId !== undefined || appState === undefined) return
  const versions = collectPreCompactArtifactReadVersions(appState)
  if (versions !== undefined) {
    boundaryMarker.compactMetadata.preCompactArtifactReadVersions = versions
  }
}

/**
 * Merges user-supplied custom instructions with hook-provided instructions.
 * User instructions come first; hook instructions are appended.
 * Empty strings normalize to undefined.
 */
export function mergeHookInstructions(
  userInstructions: string | undefined,
  hookInstructions: string | undefined,
): string | undefined {
  if (!hookInstructions) return userInstructions || undefined
  if (!userInstructions) return hookInstructions
  return `${userInstructions}\n\n${hookInstructions}`
}

/**
 * Creates a compact version of a conversation by summarizing older messages
 * and preserving recent conversation history.
 */
export async function compactConversation(
  messages: Message[],
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  suppressFollowUpQuestions: boolean,
  customInstructions?: string,
  isAutoCompact: boolean = false,
  recompactionInfo?: RecompactionInfo,
  stripNonEssential: boolean = false,
  preCompactHookResult?: Awaited<ReturnType<typeof executePreCompactHooks>>,
  initialTokenGap?: number,
): Promise<CompactionResult> {
  try {
    // densable 2.1.214: refuse compact when EndConversation ended the session
    const endedAppState = context.getAppState()
    if (endedAppState.endedByModel) {
      const { END_CONVERSATION_SESSION_ENDED_MESSAGE } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@claude-code/builtin-tools/tools/EndConversationTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/EndConversationTool/prompt.js')
      throw new Error(END_CONVERSATION_SESSION_ENDED_MESSAGE)
    }

    if (messages.length === 0) {
      throw new Error(ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
    }

    const preCompactTokenCount = tokenCountWithEstimation(messages)

    const appState = context.getAppState()
    void logPermissionContextForAnts(appState.toolPermissionContext, 'summary')

    let hookResult = preCompactHookResult
    if (!hookResult) {
      context.onCompactProgress?.({
        type: 'hooks_start',
        hookType: 'pre_compact',
      })

      // Execute PreCompact hooks
      context.setSDKStatus?.('compacting')
      hookResult = await executePreCompactHooks(
        {
          trigger: isAutoCompact ? 'auto' : 'manual',
          customInstructions: customInstructions ?? null,
        },
        context.abortController.signal,
        undefined,
        context,
      )
      throwIfCompactBlockedByHook(hookResult, context, {
        suppressNotification: isAutoCompact,
      })
    }
    customInstructions = mergeHookInstructions(
      customInstructions,
      hookResult.newCustomInstructions,
    )
    const userDisplayMessage = hookResult.userDisplayMessage

    // Show requesting mode with up arrow and custom message
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    const spinnerHintText = isAutoCompact
      ? compactSpinnerHintText(context.options.mainLoopModel)
      : null
    context.onCompactProgress?.({
      type: 'compact_start',
      ...(spinnerHintText ? { hintText: spinnerHintText } : {}),
    })

    // 3P default: true — forked-agent path reuses main conversation's prompt cache.
    // Experiment (Jan 2026) confirmed: false path is 98% cache miss, costs ~0.76% of
    // fleet cache_creation (~38B tok/day), concentrated in ephemeral envs (CCR/GHA/SDK)
    // with cold GB cache and 3P providers where GB is disabled. GB gate kept as kill-switch.
    const promptCacheSharingEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_compact_cache_prefix',
      true,
    )

    const compactPrompt = getCompactPrompt(customInstructions)
    let messagesToSummarize = messages
    let hasLeftOutToolResults =
      hasLeftOutToolResultPlaceholders(messagesToSummarize)
    let summaryBlockRetried = false
    let retryCacheSafeParams = cacheSafeParams
    let seededTokenGapTrimmed = false

    // Official 2.1.328 (`chunk@294254613.js @2689000`): when invoked reactively
    // after a PTL refusal with a known tokenGap, seed initial tool-result
    // omission or head truncation before the first summary API call so we do
    // not burn an extra guaranteed-413 round trip.
    if (initialTokenGap !== undefined && initialTokenGap > 0) {
      const canSeedLeaveOut =
        isThirdPartyDesktopLargeToolResultOmissionEnabled() &&
        groupMessagesByApiRound(messagesToSummarize).length < 3
      const seededLeftOut = canSeedLeaveOut
        ? omitLargestToolResultsForSummary(messagesToSummarize, {
            tokenGap: initialTokenGap,
          })
        : null
      if (seededLeftOut) {
        messagesToSummarize = seededLeftOut.messages
        hasLeftOutToolResults = true
        seededTokenGapTrimmed = true
        logForDebugging(
          `Compact initial tokenGap=${initialTokenGap}: left out ${seededLeftOut.leftOutIds.length} large tool result(s) (~${seededLeftOut.tokensFreed} tokens)`,
          { level: 'warn' },
        )
      } else {
        const seededTruncated = truncateHeadForPTLRetry(
          messagesToSummarize,
          undefined,
          false,
          initialTokenGap,
        )
        if (seededTruncated) {
          logForDebugging(
            `Compact initial tokenGap=${initialTokenGap}: head-truncated ${messagesToSummarize.length - seededTruncated.length} message(s)`,
            { level: 'warn' },
          )
          messagesToSummarize = seededTruncated
          seededTokenGapTrimmed = true
        }
      }
      if (seededTokenGapTrimmed) {
        retryCacheSafeParams = {
          ...retryCacheSafeParams,
          forkContextMessages: messagesToSummarize,
        }
      }
    }

    let summaryRequest = createUserMessage({
      content: buildCompactSummaryRequestContent({
        basePrompt: compactPrompt,
        hasLeftOutToolResults,
        includeReplyInstructionsTrailer: false,
      }),
    })

    let summaryResponse: AssistantMessage
    let summary: string | null
    let ptlAttempts = 0
    for (;;) {
      const streamResult = await streamCompactSummary({
        messages: messagesToSummarize,
        summaryRequest,
        appState,
        context,
        preCompactTokenCount,
        cacheSafeParams: retryCacheSafeParams,
        // densable Pqn/qjt: full compact does not pass thinking/advisor plans.
        // Once head truncation triggers (ptlAttempts > 0 or seeded trim), the
        // prompt-cache prefix is already broken — enable stripNonEssential so
        // retry skips the doomed cache-sharing fork and strips thinking/tool payloads.
        stripNonEssential:
          stripNonEssential ||
          seededTokenGapTrimmed ||
          ptlAttempts > 0 ||
          summaryBlockRetried,
      })
      summaryResponse = streamResult.response
      summary = getAssistantMessageText(summaryResponse)
      const isPtlOrCredits =
        summary?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE) ||
        isLongContextCreditsRequiredMessage(summaryResponse)
      // v2.1.310 (#1200): SEA Xft — if request is refused for size even after
      // media stripping (e.g. dense base64/SVG text), fall through to head truncation.
      const isDenseSizeRefusal =
        streamResult.mediaStripped && isMediaSizeErrorMessage(summaryResponse)
      if (isPtlOrCredits || isDenseSizeRefusal) {
        // CC-1180 + Official 2.1.328 c6n/QTa/Sws (#567, #1200): when gated by
        // tengu_generic_papert and < 3 API-round groups, leave out the largest
        // tool results with `[Tool result left out: ...]` and append
        // LEFT_OUT_TOOL_RESULTS_NOTE; otherwise fall back to head truncation.
        ptlAttempts++
        const canLeaveOut =
          ptlAttempts <= MAX_PTL_RETRIES &&
          isThirdPartyDesktopLargeToolResultOmissionEnabled() &&
          groupMessagesByApiRound(messagesToSummarize).length < 3
        const leftOutResult = canLeaveOut
          ? omitLargestToolResultsForSummary(messagesToSummarize, {
              tokenGap: getPromptTooLongTokenGap(summaryResponse),
              omitAll: ptlAttempts >= MAX_PTL_RETRIES,
            })
          : null
        if (leftOutResult) {
          hasLeftOutToolResults = true
          summaryRequest = createUserMessage({
            content: buildCompactSummaryRequestContent({
              basePrompt: compactPrompt,
              hasLeftOutToolResults,
              includeReplyInstructionsTrailer: summaryBlockRetried,
            }),
          })
          logForDebugging(
            `Compact PTL retry: left out ${leftOutResult.leftOutIds.length} large tool result(s) (~${leftOutResult.tokensFreed} tokens)`,
            { level: 'warn' },
          )
        }
        const truncated =
          leftOutResult?.messages ??
          (ptlAttempts <= MAX_PTL_RETRIES
            ? truncateHeadForPTLRetry(
                messagesToSummarize,
                summaryResponse,
                streamResult.mediaStripped,
              )
            : null)
        if (!truncated) {
          logEvent('tengu_compact_failed', {
            reason:
              'prompt_too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            preCompactTokenCount,
            promptCacheSharingEnabled,
            ptlAttempts,
          })
          throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)
        }
        logEvent('tengu_compact_ptl_retry', {
          attempt: ptlAttempts,
          droppedMessages: messagesToSummarize.length - truncated.length,
          remainingMessages: truncated.length,
        })
        messagesToSummarize = truncated
        // The forked-agent path reads from cacheSafeParams.forkContextMessages,
        // not the messages param — thread the truncated set through both paths.
        retryCacheSafeParams = {
          ...retryCacheSafeParams,
          forkContextMessages: truncated,
        }
        continue
      }

      // v2.1.311 (#1279) + Official 2.1.328 (`chunk@294254613.js @3023250`):
      // when the reply has no <summary> block (and is NOT an API error message),
      // ask once more with COMPACT_REPLY_INSTRUCTIONS_TRAILER before giving up.
      if (
        summary &&
        !summaryResponse.isApiErrorMessage &&
        !startsWithApiErrorPrefix(summary) &&
        !hasCompactSummaryTag(summary) &&
        !hasUnclosedCompactSummaryTag(summary)
      ) {
        if (
          !summaryBlockRetried &&
          getFeatureValue_CACHED_MAY_BE_STALE('tengu_dapper_fountain', true)
        ) {
          summaryBlockRetried = true
          summaryRequest = createUserMessage({
            content: buildCompactSummaryRequestContent({
              basePrompt: compactPrompt,
              hasLeftOutToolResults,
              includeReplyInstructionsTrailer: true,
            }),
          })
          logForDebugging(
            'Compact: the reply has no <summary> block, asking for the summary once more',
            { level: 'info' },
          )
          continue
        }
        if (summaryBlockRetried) {
          logEvent('tengu_compact_failed', {
            reason:
              'no_summary_block' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            preCompactTokenCount,
            promptCacheSharingEnabled,
          })
          throw new Error(
            "Failed to generate conversation summary - the model's reply has no <summary> block",
          )
        }
      }

      break
    }

    if (!summary) {
      logForDebugging(
        `Compact failed: no summary text in response. Response: ${jsonStringify(summaryResponse)}`,
        { level: 'error' },
      )
      logEvent('tengu_compact_failed', {
        reason:
          'no_summary' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        preCompactTokenCount,
        promptCacheSharingEnabled,
      })
      throw new Error(
        `Failed to generate conversation summary - response did not contain valid text content`,
      )
    } else if (
      summaryResponse.isApiErrorMessage ||
      startsWithApiErrorPrefix(summary)
    ) {
      logEvent('tengu_compact_failed', {
        reason:
          'api_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        preCompactTokenCount,
        promptCacheSharingEnabled,
      })
      throw new Error(summary)
    }

    // Store the current file state before clearing
    let preCompactReadFileState = cacheToObject(context.readFileState)

    // Clear the cache
    context.readFileState.clearForCompaction()
    context.loadedNestedMemoryPaths?.clear()

    // Intentionally NOT resetting sentSkillNames: re-injecting the full
    // skill_listing (~4K tokens) post-compact is pure cache_creation with
    // marginal benefit. The model still has SkillTool in its schema and
    // invoked_skills attachment (below) preserves used-skill content. Ants
    // with EXPERIMENTAL_SKILL_SEARCH already skip re-injection via the
    // early-return in getSkillListingAttachments.

    // Run async attachment generation in parallel
    const [fileAttachments, asyncAgentAttachments] = await Promise.all([
      createPostCompactFileAttachments(
        preCompactReadFileState,
        context,
        POST_COMPACT_MAX_FILES_TO_RESTORE,
      ),
      createAsyncAgentAttachmentsIfNeeded(context),
    ])
    // Release the readFileState snapshot — it can hold 25+ MB of file content
    preCompactReadFileState =
      undefined as unknown as typeof preCompactReadFileState

    const postCompactFileAttachments: AttachmentMessage[] = [
      ...fileAttachments,
      ...asyncAgentAttachments,
    ]
    const planAttachment = createPlanAttachmentIfNeeded(context.agentId)
    if (planAttachment) {
      postCompactFileAttachments.push(planAttachment)
    }

    // Add plan mode instructions if currently in plan mode, so the model
    // continues operating in plan mode after compaction
    const planModeAttachment = await createPlanModeAttachmentIfNeeded(context)
    if (planModeAttachment) {
      postCompactFileAttachments.push(planModeAttachment)
    }

    // Add skill attachment if skills were invoked in this session
    const skillAttachment = createSkillAttachmentIfNeeded(context.agentId)
    if (skillAttachment) {
      postCompactFileAttachments.push(skillAttachment)
    }

    // Compaction ate prior delta attachments. Re-announce from the current
    // state so the model has tool/instruction context on the first
    // post-compact turn. Empty message history → diff against nothing →
    // announces the full set.
    for (const att of getDeferredToolsDeltaAttachment(
      context.options.tools,
      context.options.mainLoopModel,
      [],
      { callSite: 'compact_full' },
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getAgentListingDeltaAttachment(context, [])) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getMcpInstructionsDeltaAttachment(
      context.options.mcpClients,
      context.options.tools,
      context.options.mainLoopModel,
      [],
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'session_start',
    })
    // Execute SessionStart hooks after successful compaction
    const hookMessages = await processSessionStartHooks('compact', {
      model: context.options.mainLoopModel,
    })

    // Create the compact boundary marker and summary messages before the
    // event so we can compute the true resulting-context size.
    const boundaryMarker = createCompactBoundaryMessage(
      isAutoCompact ? 'auto' : 'manual',
      preCompactTokenCount ?? 0,
      messages.at(-1)?.uuid,
    )
    // Carry loaded-tool state — the summary doesn't preserve tool_reference
    // blocks, so the post-compact schema filter needs this to keep sending
    // already-loaded deferred tool schemas to the API.
    const preCompactDiscovered = extractDiscoveredToolNames(messages)
    if (preCompactDiscovered.size > 0) {
      boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
        ...preCompactDiscovered,
      ].sort()
    }
    attachPreCompactArtifactReadVersions(
      boundaryMarker,
      context.agentId,
      context.getAppState(),
    )

    const transcriptPath = getTranscriptPath()
    const summaryMessages: UserMessage[] = [
      createUserMessage({
        content: getCompactUserSummaryMessage(summary, {
          suppressFollowUpQuestions,
          transcriptPath,
          headTruncated: ptlAttempts > 0,
          toolNamesUsed: collectToolNamesUsedBeforeCompact(messages),
          isTranscriptSuppressed: isEnvTruthy(process.env.CLAUDE_CODE_REMOTE),
        }),
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
      }),
    ]

    // Previously "postCompactTokenCount" — renamed because this is the
    // compact API call's total usage (input_tokens ≈ preCompactTokenCount),
    // NOT the size of the resulting context. Kept for event-field continuity.
    const compactionCallTotalTokens = tokenCountFromLastAPIResponse([
      summaryResponse,
    ])

    // Message-payload estimate of the resulting context. The next iteration's
    // shouldAutoCompact will see this PLUS ~20-40K for system prompt + tools +
    // userContext (via API usage.input_tokens). So `willRetriggerNextTurn: true`
    // is a strong signal; `false` may still retrigger when this is close to threshold.
    const truePostCompactTokenCount = roughTokenCountEstimationForMessages([
      boundaryMarker,
      ...summaryMessages,
      ...postCompactFileAttachments,
      ...hookMessages,
    ] as Parameters<typeof roughTokenCountEstimationForMessages>[0])

    // Extract compaction API usage metrics
    const compactionUsage = getTokenUsage(summaryResponse)
    // Release the full API response — it holds content blocks + usage metadata
    summaryResponse = undefined as unknown as typeof summaryResponse

    const querySourceForEvent =
      recompactionInfo?.querySource ?? context.options.querySource ?? 'unknown'

    logEvent('tengu_compact', {
      stripNonEssential,
      preCompactTokenCount,
      // Kept for continuity — semantically the compact API call's total usage
      postCompactTokenCount: compactionCallTotalTokens,
      truePostCompactTokenCount,
      autoCompactThreshold: recompactionInfo?.autoCompactThreshold ?? -1,
      willRetriggerNextTurn:
        recompactionInfo !== undefined &&
        truePostCompactTokenCount >= recompactionInfo.autoCompactThreshold,
      isAutoCompact,
      querySource:
        querySourceForEvent as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryChainId: (context.queryTracking?.chainId ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: context.queryTracking?.depth ?? -1,
      isRecompactionInChain: recompactionInfo?.isRecompactionInChain ?? false,
      turnsSincePreviousCompact:
        recompactionInfo?.turnsSincePreviousCompact ?? -1,
      previousCompactTurnId: (recompactionInfo?.previousCompactTurnId ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      compactionInputTokens: compactionUsage?.input_tokens,
      compactionOutputTokens: compactionUsage?.output_tokens,
      compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
      compactionCacheCreationTokens:
        compactionUsage?.cache_creation_input_tokens ?? 0,
      compactionTotalTokens: compactionUsage
        ? compactionUsage.input_tokens +
          (compactionUsage.cache_creation_input_tokens ?? 0) +
          (compactionUsage.cache_read_input_tokens ?? 0) +
          compactionUsage.output_tokens
        : 0,
      promptCacheSharingEnabled,
      // analyzeContext walks every content block (~11ms on a 4.5K-message
      // session) purely for this telemetry breakdown. Computed here, past
      // the compaction-API await, so the sync walk doesn't starve the
      // render loop before compaction even starts. Same deferral pattern
      // as reactiveCompact.ts.
      ...(() => {
        try {
          return tokenStatsToStatsigMetrics(analyzeContext(messages))
        } catch (error) {
          logError(error as Error)
          return {}
        }
      })(),
    })

    // Reset cache read baseline so the post-compact drop isn't flagged as a break
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(
        context.options.querySource ?? 'compact',
        context.agentId,
      )
    }
    markPostCompaction()

    // Re-append session metadata (custom title, tag) so it stays within
    // the 16KB tail window that readLiteMetadata reads for --resume display.
    // Without this, enough post-compaction messages push the metadata entry
    // out of the window, causing --resume to show the auto-generated title
    // instead of the user-set session name.
    reAppendSessionMetadata()

    // Write a reduced transcript segment for the pre-compaction messages
    // (assistant mode only). Fire-and-forget — errors are logged internally.
    if (feature('KAIROS')) {
      void sessionTranscriptModule?.writeSessionTranscriptSegment(messages)
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'post_compact',
    })
    const postCompactHookResult = await executePostCompactHooks(
      {
        trigger: isAutoCompact ? 'auto' : 'manual',
        compactSummary: summary,
      },
      context.abortController.signal,
      undefined,
      context,
    )

    const combinedUserDisplayMessage = [
      userDisplayMessage,
      postCompactHookResult.userDisplayMessage,
    ]
      .filter(Boolean)
      .join('\n')

    // Official 2.1.321 (#1862) + 2.1.323 (#1980): preserve trailing unanswered
    // user messages (including after a prior /compact or local command such as
    // /context) and unanswered background subagent `<task-notification>` messages
    // so compaction never summarizes away a message Claude has not answered yet.
    const preservedTrailingMessages =
      extractUnansweredTrailingMessages(messages)

    return {
      boundaryMarker,
      summaryMessages,
      ...(preservedTrailingMessages.length > 0
        ? { messagesToKeep: preservedTrailingMessages }
        : {}),
      attachments: postCompactFileAttachments,
      hookResults: hookMessages,
      userDisplayMessage: combinedUserDisplayMessage || undefined,
      preCompactTokenCount,
      postCompactTokenCount: compactionCallTotalTokens,
      truePostCompactTokenCount,
      compactionUsage,
    }
  } catch (error) {
    // Only show the error notification for manual /compact.
    // Auto-compact failures are retried on the next turn and the
    // notification is confusing when compaction eventually succeeds.
    if (!isAutoCompact) {
      addErrorNotificationIfNeeded(error, context)
    }
    throw error
  } finally {
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_end' })
    context.setSDKStatus?.(null)
  }
}

/**
 * Performs a partial compaction around the selected message index.
 * Direction 'from': summarizes messages after the index, keeps earlier ones.
 *   Prompt cache for kept (earlier) messages is preserved.
 * Direction 'up_to': summarizes messages before the index, keeps later ones.
 *   Prompt cache is invalidated since the summary precedes the kept messages.
 */
export async function partialCompactConversation(
  allMessages: Message[],
  pivotIndex: number,
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  userFeedback?: string,
  direction: PartialCompactDirection = 'from',
): Promise<CompactionResult> {
  try {
    const messagesToSummarize =
      direction === 'up_to'
        ? allMessages.slice(0, pivotIndex)
        : allMessages.slice(pivotIndex)
    // 'up_to' must strip old compact boundaries/summaries: for 'up_to',
    // summary_B sits BEFORE kept, so a stale boundary_A in kept wins
    // findLastCompactBoundaryIndex's backward scan and drops summary_B.
    // 'from' keeps them: summary_B sits AFTER kept (backward scan still
    // works), and removing an old summary would lose its covered history.
    const messagesToKeep =
      direction === 'up_to'
        ? allMessages
            .slice(pivotIndex)
            .filter(
              m =>
                m.type !== 'progress' &&
                !isCompactBoundaryMessage(m) &&
                !(m.type === 'user' && m.isCompactSummary),
            )
        : allMessages.slice(0, pivotIndex).filter(m => m.type !== 'progress')

    // densable `igo`: `up_to` → `xPe(Ee,r)` with gold `qf` = last-wins
    // permissionLayers model. `from` → `WNn(Ee,ve)` when KEEP has assistant.
    const compactModel = getMainLoopModelFromLayers(context)
    if (direction === 'up_to') {
      const compactStrip = resolveCompactThinkingStrip(
        messagesToKeep,
        compactModel,
      )
      if (compactStrip.thinkingBlockCount > 0) {
        logForDebugging(
          `compact: kept tail holds ${compactStrip.thinkingBlockCount} thinking block(s); strip=${compactStrip.strip ? 'on' : 'off'} (decided by ${compactStrip.source}; model=${compactModel}, thinking=${compactStrip.thinkingType})`,
          { level: 'info' },
        )
      }
      if (compactStrip.strip) {
        messagesToKeep.push(
          createAttachmentMessage(thinkingStrippedAttachment('all')),
        )
      }
    } else if (messagesToKeep.some(m => m.type === 'assistant')) {
      const carried = carryThinkingStripFromSummarized(
        messagesToKeep,
        messagesToSummarize,
      )
      if (carried) {
        messagesToKeep.push(createAttachmentMessage(carried))
      }
      if (
        messagesToKeep.some(m => m.type === 'assistant') &&
        messagesToSummarize.some(
          m =>
            m.type === 'attachment' &&
            m.attachment?.type === 'advisor_stripped',
        )
      ) {
        messagesToKeep.push(
          createAttachmentMessage({ type: 'advisor_stripped' }),
        )
      }
    }

    // densable compact-path `lXn` — remint poll_events envelopes on the kept tail.
    {
      const { remintPollEventsAttachmentEnvelopes } = await import(
        '../../cli/printControlExtras.js'
      )
      for (let i = 0; i < messagesToKeep.length; i++) {
        const msg = messagesToKeep[i]
        if (msg?.type !== 'attachment') {
          continue
        }
        const attachment = msg.attachment
        if (attachment?.type !== 'poll_events') {
          continue
        }
        const envelopes = Array.isArray(attachment.envelopes)
          ? attachment.envelopes.filter(
              (envelope): envelope is string => typeof envelope === 'string',
            )
          : []
        const kinds = Array.isArray(attachment.kinds)
          ? attachment.kinds.filter(
              (kind): kind is string => typeof kind === 'string',
            )
          : []
        const provenance = Array.isArray(attachment.provenance)
          ? attachment.provenance
          : []
        const media = Array.isArray(attachment.media) ? attachment.media : []
        const merged: Array<{
          envelope: string
          kind: string
          provenance: unknown
          media: unknown[]
          at: string
        }> = envelopes.map((envelope, index) => {
          const atMatch = /^<event\b[^>]*?\bat="([^"]*)"/.exec(envelope)
          return {
            envelope,
            kind: kinds[index] ?? 'unknown',
            provenance: provenance[index] ?? null,
            media: (media[index] as unknown[] | undefined) ?? [],
            at: (() => {
              if (atMatch?.[1]) {
                return atMatch[1]
              }
              if (typeof attachment.timestamp === 'string') {
                return attachment.timestamp
              }
              if (typeof msg.timestamp === 'string') {
                return msg.timestamp
              }
              return ''
            })(),
          }
        })
        const queued = messagesToKeep.flatMap(entry => {
          if (entry?.type !== 'attachment') {
            return []
          }
          const queuedAttachment = entry.attachment
          if (queuedAttachment?.type !== 'queued_command') {
            return []
          }
          const at = entry.timestamp
          if (typeof at !== 'string') {
            return []
          }
          const prompt = queuedAttachment.prompt
          const text =
            typeof prompt === 'string'
              ? prompt
              : Array.isArray(prompt)
                ? prompt
                    .filter(
                      (block): block is { type: 'text'; text: string } =>
                        Boolean(block) &&
                        typeof block === 'object' &&
                        (block as { type?: string }).type === 'text' &&
                        typeof (block as { text?: unknown }).text === 'string',
                    )
                    .map(block => block.text)
                    .join('\n')
                : ''
          if (text === '') {
            return []
          }
          return [
            {
              envelope: text,
              kind: 'unknown',
              provenance: null,
              media: [] as unknown[],
              at,
            },
          ]
        })
        const rows = [...merged, ...queued].sort((left, right) => {
          const leftAt = Date.parse(left.at)
          const rightAt = Date.parse(right.at)
          if (Number.isNaN(leftAt) || Number.isNaN(rightAt)) {
            return 0
          }
          return leftAt - rightAt
        })
        const hasMedia = rows.some(row => row.media.length > 0)
        messagesToKeep[i] = {
          ...msg,
          attachment: {
            ...attachment,
            envelopes: remintPollEventsAttachmentEnvelopes(
              rows.map(row => row.envelope),
            ),
            kinds: rows.map(row => row.kind),
            provenance: rows.map(row => row.provenance),
            ...(hasMedia && { media: rows.map(row => row.media) }),
          },
        }
      }
    }

    if (messagesToSummarize.length === 0) {
      throw new Error(
        direction === 'up_to'
          ? 'Nothing to summarize before the selected message.'
          : 'Nothing to summarize after the selected message.',
      )
    }

    const preCompactTokenCount = tokenCountWithEstimation(allMessages)

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'pre_compact',
    })

    context.setSDKStatus?.('compacting')
    const hookResult = await executePreCompactHooks(
      {
        trigger: 'manual',
        customInstructions: null,
      },
      context.abortController.signal,
      undefined,
      context,
    )
    throwIfCompactBlockedByHook(hookResult, context)

    // Merge hook instructions with user feedback
    let customInstructions: string | undefined
    if (hookResult.newCustomInstructions && userFeedback) {
      customInstructions = `${hookResult.newCustomInstructions}\n\nUser context: ${userFeedback}`
    } else if (hookResult.newCustomInstructions) {
      customInstructions = hookResult.newCustomInstructions
    } else if (userFeedback) {
      customInstructions = `User context: ${userFeedback}`
    }

    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_start' })

    const compactPrompt = getPartialCompactPrompt(customInstructions, direction)
    let summaryRequest = createUserMessage({
      content: compactPrompt,
    })

    const failureMetadata = {
      preCompactTokenCount,
      direction:
        direction as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messagesSummarized: messagesToSummarize.length,
    }

    // 'up_to' prefix hits cache directly; 'from' sends all (tail wouldn't cache).
    // PTL retry breaks the cache prefix but unblocks the user (CC-1180).
    let apiMessages = direction === 'up_to' ? messagesToSummarize : allMessages
    let retryCacheSafeParams =
      direction === 'up_to'
        ? { ...cacheSafeParams, forkContextMessages: messagesToSummarize }
        : cacheSafeParams
    let summaryResponse: AssistantMessage
    let summary: string | null
    let ptlAttempts = 0
    let summaryBlockRetried = false
    for (;;) {
      const streamResult = await streamCompactSummary({
        messages: apiMessages,
        summaryRequest,
        appState: context.getAppState(),
        context,
        preCompactTokenCount,
        cacheSafeParams: retryCacheSafeParams,
        thinkingStripPlan: buildThinkingStripPlanFromMessages(allMessages),
        advisorStripPlan: buildAdvisorStripPlanFromMessages(allMessages),
      })
      summaryResponse = streamResult.response
      summary = getAssistantMessageText(summaryResponse)
      if (summary?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) {
        ptlAttempts++
        const truncated =
          ptlAttempts <= MAX_PTL_RETRIES
            ? truncateHeadForPTLRetry(
                apiMessages,
                summaryResponse,
                streamResult.mediaStripped,
              )
            : null
        if (!truncated) {
          logEvent('tengu_partial_compact_failed', {
            reason:
              'prompt_too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            ...failureMetadata,
            ptlAttempts,
          })
          throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)
        }
        logEvent('tengu_compact_ptl_retry', {
          attempt: ptlAttempts,
          droppedMessages: apiMessages.length - truncated.length,
          remainingMessages: truncated.length,
          path: 'partial' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        apiMessages = truncated
        retryCacheSafeParams = {
          ...retryCacheSafeParams,
          forkContextMessages: truncated,
        }
        continue
      }

      // #1630 + Official 2.1.328: reject non-summary replies (excluding API
      // error messages) before they can replace conversation.
      if (
        summary &&
        !summaryResponse.isApiErrorMessage &&
        !startsWithApiErrorPrefix(summary) &&
        !hasCompactSummaryTag(summary) &&
        !hasUnclosedCompactSummaryTag(summary)
      ) {
        if (
          !summaryBlockRetried &&
          getFeatureValue_CACHED_MAY_BE_STALE('tengu_dapper_fountain', true)
        ) {
          summaryBlockRetried = true
          summaryRequest = createUserMessage({
            content: compactPrompt + COMPACT_REPLY_INSTRUCTIONS_TRAILER,
          })
          logForDebugging(
            'Compact: the reply has no <summary> block, asking for the summary once more',
            { level: 'info' },
          )
          continue
        }
        logEvent('tengu_partial_compact_failed', {
          reason:
            'no_summary_block' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...failureMetadata,
        })
        throw new Error(
          "Failed to generate conversation summary - the model's reply has no <summary> block",
        )
      }

      break
    }
    if (!summary) {
      logEvent('tengu_partial_compact_failed', {
        reason:
          'no_summary' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...failureMetadata,
      })
      throw new Error(
        'Failed to generate conversation summary - response did not contain valid text content',
      )
    } else if (
      summaryResponse.isApiErrorMessage ||
      startsWithApiErrorPrefix(summary)
    ) {
      logEvent('tengu_partial_compact_failed', {
        reason:
          'api_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...failureMetadata,
      })
      throw new Error(summary)
    }

    // Store the current file state before clearing
    let preCompactReadFileState = cacheToObject(context.readFileState)
    context.readFileState.clearForCompaction()
    context.loadedNestedMemoryPaths?.clear()
    // Intentionally NOT resetting sentSkillNames — see compactConversation()
    // for rationale (~4K tokens saved per compact event).

    const [fileAttachments, asyncAgentAttachments] = await Promise.all([
      createPostCompactFileAttachments(
        preCompactReadFileState,
        context,
        POST_COMPACT_MAX_FILES_TO_RESTORE,
        messagesToKeep,
      ),
      createAsyncAgentAttachmentsIfNeeded(context),
    ])
    // Release the readFileState snapshot — it can hold 25+ MB of file content
    preCompactReadFileState =
      undefined as unknown as typeof preCompactReadFileState

    const postCompactFileAttachments: AttachmentMessage[] = [
      ...fileAttachments,
      ...asyncAgentAttachments,
    ]
    const planAttachment = createPlanAttachmentIfNeeded(context.agentId)
    if (planAttachment) {
      postCompactFileAttachments.push(planAttachment)
    }

    // Add plan mode instructions if currently in plan mode
    const planModeAttachment = await createPlanModeAttachmentIfNeeded(context)
    if (planModeAttachment) {
      postCompactFileAttachments.push(planModeAttachment)
    }

    const skillAttachment = createSkillAttachmentIfNeeded(context.agentId)
    if (skillAttachment) {
      postCompactFileAttachments.push(skillAttachment)
    }

    // Re-announce only what was in the summarized portion — messagesToKeep
    // is scanned, so anything already announced there is skipped.
    for (const att of getDeferredToolsDeltaAttachment(
      context.options.tools,
      context.options.mainLoopModel,
      messagesToKeep,
      { callSite: 'compact_partial' },
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getAgentListingDeltaAttachment(context, messagesToKeep)) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getMcpInstructionsDeltaAttachment(
      context.options.mcpClients,
      context.options.tools,
      context.options.mainLoopModel,
      messagesToKeep,
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'session_start',
    })
    const hookMessages = await processSessionStartHooks('compact', {
      model: context.options.mainLoopModel,
    })

    const postCompactTokenCount = tokenCountFromLastAPIResponse([
      summaryResponse,
    ])
    const compactionUsage = getTokenUsage(summaryResponse)
    // Release the full API response — it holds content blocks + usage metadata
    summaryResponse = undefined as unknown as typeof summaryResponse

    logEvent('tengu_partial_compact', {
      preCompactTokenCount,
      postCompactTokenCount,
      messagesKept: messagesToKeep.length,
      messagesSummarized: messagesToSummarize.length,
      direction:
        direction as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      hasUserFeedback: !!userFeedback,
      trigger:
        'message_selector' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      compactionInputTokens: compactionUsage?.input_tokens,
      compactionOutputTokens: compactionUsage?.output_tokens,
      compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
      compactionCacheCreationTokens:
        compactionUsage?.cache_creation_input_tokens ?? 0,
    })

    // Progress messages aren't loggable, so forkSessionImpl would null out
    // a logicalParentUuid pointing at one. Both directions skip them.
    const lastPreCompactUuid =
      direction === 'up_to'
        ? allMessages.slice(0, pivotIndex).findLast(m => m.type !== 'progress')
            ?.uuid
        : messagesToKeep.at(-1)?.uuid
    const boundaryMarker = createCompactBoundaryMessage(
      'manual',
      preCompactTokenCount ?? 0,
      lastPreCompactUuid,
      userFeedback,
      messagesToSummarize.length,
    )
    // allMessages not just messagesToSummarize — set union is idempotent,
    // simpler than tracking which half each tool lived in.
    const preCompactDiscovered = extractDiscoveredToolNames(allMessages)
    if (preCompactDiscovered.size > 0) {
      boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
        ...preCompactDiscovered,
      ].sort()
    }
    attachPreCompactArtifactReadVersions(
      boundaryMarker,
      context.agentId,
      context.getAppState(),
    )

    const transcriptPath = getTranscriptPath()
    const summaryMessages: UserMessage[] = [
      createUserMessage({
        content: getCompactUserSummaryMessage(summary, {
          suppressFollowUpQuestions: false,
          transcriptPath,
          headTruncated: ptlAttempts > 0,
          toolNamesUsed: collectToolNamesUsedBeforeCompact(allMessages),
          isTranscriptSuppressed: isEnvTruthy(process.env.CLAUDE_CODE_REMOTE),
        }),
        isCompactSummary: true,
        ...(messagesToKeep.length > 0
          ? {
              summarizeMetadata: {
                messagesSummarized: messagesToSummarize.length,
                userContext: userFeedback,
                direction,
              },
            }
          : { isVisibleInTranscriptOnly: true as const }),
      }),
    ]

    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(
        context.options.querySource ?? 'compact',
        context.agentId,
      )
    }
    markPostCompaction()

    // Re-append session metadata (custom title, tag) so it stays within
    // the 16KB tail window that readLiteMetadata reads for --resume display.
    reAppendSessionMetadata()

    if (feature('KAIROS')) {
      void sessionTranscriptModule?.writeSessionTranscriptSegment(
        messagesToSummarize,
      )
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'post_compact',
    })
    const postCompactHookResult = await executePostCompactHooks(
      {
        trigger: 'manual',
        compactSummary: summary,
      },
      context.abortController.signal,
      undefined,
      context,
    )

    const annotatedSummaryMessages =
      direction === 'up_to' && messagesToKeep.length > 0
        ? summaryMessages.map(appendKeptMessagesCompactNote)
        : summaryMessages
    // 'from': prefix-preserving → boundary; 'up_to': suffix → last summary
    const anchorUuid =
      direction === 'up_to'
        ? (annotatedSummaryMessages.at(-1)?.uuid ?? boundaryMarker.uuid)
        : boundaryMarker.uuid
    return {
      boundaryMarker: annotateBoundaryWithPreservedSegment(
        boundaryMarker,
        anchorUuid,
        messagesToKeep,
      ),
      summaryMessages: annotatedSummaryMessages,
      messagesToKeep,
      attachments: postCompactFileAttachments,
      hookResults: hookMessages,
      userDisplayMessage: postCompactHookResult.userDisplayMessage,
      preCompactTokenCount,
      postCompactTokenCount,
      compactionUsage,
    }
  } catch (error) {
    addErrorNotificationIfNeeded(error, context)
    throw error
  } finally {
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_end' })
    context.setSDKStatus?.(null)
  }
}

function addErrorNotificationIfNeeded(
  error: unknown,
  context: Pick<ToolUseContext, 'addNotification'>,
) {
  if (
    !(error instanceof CompactionBlockedByHookError) &&
    !hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT) &&
    !hasExactErrorMessage(error, ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
  ) {
    context.addNotification?.({
      key: 'error-compacting-conversation',
      text: 'Error compacting conversation',
      priority: 'immediate',
      color: 'error',
    })
  }
}

export function createCompactCanUseTool(): CanUseToolFn {
  return async () => ({
    behavior: 'deny' as const,
    message: 'Tool use is not allowed during compaction',
    decisionReason: {
      type: 'other' as const,
      reason: 'compaction agent should only produce text summary',
    },
  })
}

async function streamCompactSummary({
  messages,
  summaryRequest,
  appState,
  context,
  preCompactTokenCount,
  cacheSafeParams,
  stripNonEssential = false,
  thinkingStripPlan,
  advisorStripPlan,
}: {
  messages: Message[]
  summaryRequest: UserMessage
  appState: Awaited<ReturnType<ToolUseContext['getAppState']>>
  context: ToolUseContext
  preCompactTokenCount: number
  cacheSafeParams: CacheSafeParams
  /** densable qjt `stripNonEssential:b=!1` — skip cache-prefix fork + strip thinking/advisor. */
  stripNonEssential?: boolean
  thinkingStripPlan?: import('../../utils/thinking.js').ThinkingStripPlan
  advisorStripPlan?: import('../../utils/messages.js').AdvisorStripPlan
}): Promise<{ response: AssistantMessage; mediaStripped: boolean }> {
  // Official 2.1.326 (#332): always resolve runtime model (e.g. `opusplan` in
  // plan mode -> Opus) for compaction requests.
  const compactModel = getRuntimeMainLoopModel({
    permissionMode: appState.toolPermissionContext.mode,
    mainLoopModel: context.options.mainLoopModel,
    isSubagent: Boolean(context.agentId),
  })

  // When prompt cache sharing is enabled, use forked agent to reuse the
  // main conversation's cached prefix (system prompt, tools, context messages).
  // Falls back to regular streaming path on failure.
  // 3P default: true — see comment at the other tengu_compact_cache_prefix read above.
  // densable qjt `V=!b&&k("tengu_compact_cache_prefix",!0)`
  const promptCacheSharingEnabled =
    !stripNonEssential &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_compact_cache_prefix', true)
  // densable qjt: plans go to qC/Gut; do not peel summarizer input here.
  const summarizerMessages = messages
  // Send keep-alive signals during compaction to prevent remote session
  // WebSocket idle timeouts from dropping bridge connections. Compaction
  // API calls can take 5-10+ seconds, during which no other messages
  // flow through the transport — without keep-alives, the server may
  // close the WebSocket for inactivity.
  // Two signals: (1) PUT /worker heartbeat via sessionActivity, and
  // (2) re-emit 'compacting' status so the SDK event stream stays active
  // and the server doesn't consider the session stale.
  const activityInterval = isSessionActivityTrackingActive()
    ? setInterval(
        (statusSetter?: (status: 'compacting' | null) => void) => {
          sendSessionActivitySignal()
          statusSetter?.('compacting')
        },
        30_000,
        context.setSDKStatus,
      )
    : undefined

  try {
    if (promptCacheSharingEnabled) {
      try {
        // DO NOT set maxOutputTokens here. The fork piggybacks on the main thread's
        // prompt cache by sending identical cache-key params (system, tools, model,
        // messages prefix, thinking config). Setting maxOutputTokens would clamp
        // budget_tokens via Math.min(budget, maxOutputTokens-1) in claude.ts,
        // creating a thinking config mismatch that invalidates the cache.
        // The streaming fallback path (below) can safely set maxOutputTokensOverride
        // since it doesn't share cache with the main thread.
        const result = await runForkedAgent({
          promptMessages: [summaryRequest],
          cacheSafeParams,
          thinkingStripPlan,
          advisorStripPlan,
          canUseTool: createCompactCanUseTool(),
          querySource: 'compact',
          forkLabel: 'compact',
          maxTurns: 1,
          skipCacheWrite: true,
          // Pass the compact context's abortController so user Esc aborts the
          // fork — same signal the streaming fallback uses at
          // `signal: context.abortController.signal` below.
          // Share setResponseLength so streamed summary tokens drive the
          // compaction progress bar (the fork path is the default; without
          // this the bar sits at 0% until compact_end).
          overrides: {
            abortController: context.abortController,
            shareSetResponseLength: true,
          },
        })
        const assistantMsg = getLastAssistantMessage(result.messages)
        const assistantText = assistantMsg
          ? getAssistantMessageText(assistantMsg)
          : null
        // Guard isApiErrorMessage: query() catches API errors (including
        // APIUserAbortError on ESC) and yields them as synthetic assistant
        // messages. Without this check, an aborted compact "succeeds" with
        // "Request was aborted." as the summary — the text doesn't start with
        // "API Error" so the caller's startsWithApiErrorPrefix guard misses it.
        if (assistantMsg && assistantText && !assistantMsg.isApiErrorMessage) {
          const isPtl = assistantText.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)
          // Official 2.1.326 (#49): on Bedrock/Vertex/Foundry or telemetry-off
          // paths, verify the model actually produced a `<summary>` block rather
          // than replying conversationally to the user's last turn.
          if (isPtl || hasCompactSummaryBlock(assistantText)) {
            if (!isPtl) {
              logEvent('tengu_compact_cache_sharing_success', {
                preCompactTokenCount,
                outputTokens: result.totalUsage.output_tokens,
                cacheReadInputTokens: result.totalUsage.cache_read_input_tokens,
                cacheCreationInputTokens:
                  result.totalUsage.cache_creation_input_tokens,
                cacheHitRate:
                  result.totalUsage.cache_read_input_tokens > 0
                    ? result.totalUsage.cache_read_input_tokens /
                      (result.totalUsage.cache_read_input_tokens +
                        result.totalUsage.cache_creation_input_tokens +
                        result.totalUsage.input_tokens)
                    : 0,
              })
            }
            return { response: assistantMsg, mediaStripped: false }
          }
          logForDebugging(
            'Compact cache sharing: reply omitted <summary> block, falling back to streaming summarizer',
            { level: 'warn' },
          )
        }
        logForDebugging(
          `Compact cache sharing: no text in response, falling back. Response: ${jsonStringify(assistantMsg)}`,
          { level: 'warn' },
        )
        logEvent('tengu_compact_cache_sharing_fallback', {
          reason:
            'no_text_response' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          preCompactTokenCount,
        })
      } catch (error) {
        logError(error)
        logEvent('tengu_compact_cache_sharing_fallback', {
          reason:
            'error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          preCompactTokenCount,
        })
      }
    }

    // Regular streaming path (fallback when cache sharing fails or is disabled)
    const retryEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_compact_streaming_retry',
      false,
    )
    const maxAttempts = retryEnabled ? MAX_COMPACT_STREAMING_RETRIES : 1
    let reinforcedNoSummaryRetry = false

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Reset state for retry
      let hasStartedStreaming = false
      let response: AssistantMessage | undefined
      context.setResponseLength?.(() => 0)

      // Check if tool search is enabled using the main loop's tools list.
      // context.options.tools includes MCP tools merged via useMergedTools.
      const useSearchExtraTools =
        !stripNonEssential &&
        (await isSearchExtraToolsEnabled(
          compactModel,
          context.options.tools,
          async () => appState.toolPermissionContext,
          context.options.agentDefinitions.activeAgents,
          'compact',
        ))
      const tools: Tool[] = stripNonEssential
        ? []
        : useSearchExtraTools
          ? uniqBy(
              [
                FileReadTool,
                SearchExtraToolsTool,
                ...context.options.tools.filter(t => t.isMcp),
              ],
              'name',
            )
          : [FileReadTool]

      // densable qjt: stripNonEssential → tools []. Else SearchExtraTools + MCP
      // when enabled (defer_loading), else FileReadTool only.

      // Official 2.1.326 (#49): ensure the summary request carries the
      // do-not-answer reminder and keep the full conversation including
      // Claude's last assistant reply before appending `effectiveSummaryRequest`.
      const effectiveSummaryRequest: UserMessage =
        typeof summaryRequest.message.content === 'string' &&
        !summaryRequest.message.content.includes(
          'Every message before those instructions',
        )
          ? createUserMessage({
              content:
                summaryRequest.message.content + SUMMARY_DO_NOT_ANSWER_REMINDER,
            })
          : summaryRequest

      const baseSummaryMessages = stripReinjectedAttachments([
        ...getMessagesAfterCompactBoundary(summarizerMessages),
        effectiveSummaryRequest,
      ])
      const normalizedSummaryMessages = normalizeMessagesForAPI(
        stripImagesFromMessages(baseSummaryMessages),
        context.options.tools,
      ) as Message[]
      const streamingMessages = stripNonEssential
        ? stripToolPayloadsForNonEssential(normalizedSummaryMessages)
        : normalizedSummaryMessages

      const streamingGen = queryModelWithStreaming({
        // No model arg → no api_system at runtime; cast for Message[] query path
        messages: streamingMessages,
        systemPrompt: asSystemPrompt([
          'You are a helpful AI assistant tasked with summarizing conversations.',
        ]),
        thinkingConfig: { type: 'disabled' as const },
        tools,
        signal: context.abortController.signal,
        options: {
          async getToolPermissionContext() {
            const appState = context.getAppState()
            return appState.toolPermissionContext
          },
          model: compactModel,
          toolChoice: undefined,
          isNonInteractiveSession: context.options.isNonInteractiveSession,
          hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
          maxOutputTokensOverride: Math.min(
            COMPACT_MAX_OUTPUT_TOKENS,
            getMaxOutputTokensForModel(compactModel),
          ),
          querySource: 'compact',
          agents: context.options.agentDefinitions.activeAgents,
          mcpTools: [],
          effortValue: getEffortValueFromLayers(context),
          langfuseTrace: context.langfuseTrace,
          thinkingStripPlan,
          advisorStripPlan,
        },
      })
      const streamIter = streamingGen[Symbol.asyncIterator]()
      let next = await streamIter.next()

      while (!next.done) {
        const event = next.value as
          | StreamEvent
          | AssistantMessage
          | SystemAPIErrorMessage
        const streamEvent = event as {
          type: string
          event: {
            type: string
            content_block: { type: string }
            delta: { type: string; text: string }
          }
        }

        if (
          !hasStartedStreaming &&
          streamEvent.type === 'stream_event' &&
          streamEvent.event?.type === 'content_block_start' &&
          streamEvent.event?.content_block?.type === 'text'
        ) {
          hasStartedStreaming = true
          context.setStreamMode?.('responding')
        }

        if (
          streamEvent.type === 'stream_event' &&
          streamEvent.event?.type === 'content_block_delta' &&
          streamEvent.event?.delta?.type === 'text_delta'
        ) {
          const charactersStreamed = streamEvent.event.delta.text.length
          context.setResponseLength?.(length => length + charactersStreamed)
        }

        if (event.type === 'assistant') {
          response = event as AssistantMessage
        }

        next = await streamIter.next()
      }

      if (response) {
        const replyText = getAssistantMessageText(response)
        if (
          !reinforcedNoSummaryRetry &&
          !response.isApiErrorMessage &&
          replyText &&
          !replyText.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE) &&
          !hasCompactSummaryBlock(replyText)
        ) {
          reinforcedNoSummaryRetry = true
          logForDebugging(
            'Compact streaming fallback replied without a <summary> block; retrying once with explicit summary reminder',
            { level: 'warn' },
          )
          attempt--
          continue
        }
        return { response, mediaStripped: true }
      }

      if (attempt < maxAttempts) {
        logEvent('tengu_compact_streaming_retry', {
          attempt,
          preCompactTokenCount,
          hasStartedStreaming,
        })
        await sleep(getRetryDelay(attempt), context.abortController.signal, {
          abortError: () => new APIUserAbortError(),
        })
        continue
      }

      logForDebugging(
        `Compact streaming failed after ${attempt} attempts. hasStartedStreaming=${hasStartedStreaming}`,
        { level: 'error' },
      )
      logEvent('tengu_compact_failed', {
        reason:
          'no_streaming_response' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        preCompactTokenCount,
        hasStartedStreaming,
        retryEnabled,
        attempts: attempt,
        promptCacheSharingEnabled,
      })
      throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
    }

    // This should never be reached due to the throw above, but TypeScript needs it
    throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
  } finally {
    clearInterval(activityInterval)
  }
}

/**
 * Creates attachment messages for recently accessed files to restore them after compaction.
 * This prevents the model from having to re-read files that were recently accessed.
 * Re-reads files using FileReadTool to get fresh content with proper validation.
 * Files are selected based on recency, but constrained by both file count and token budget limits.
 *
 * Files already present as Read tool results in preservedMessages are skipped —
 * re-injecting identical content the model can already see in the preserved tail
 * is pure waste (up to 25K tok/compact). Mirrors the diff-against-preserved
 * pattern that getDeferredToolsDeltaAttachment uses at the same call sites.
 *
 * @param readFileState The current file state tracking recently read files
 * @param toolUseContext The tool use context for calling FileReadTool
 * @param maxFiles Maximum number of files to restore (default: 5)
 * @param preservedMessages Messages kept post-compact; Read results here are skipped
 * @returns Array of attachment messages for the most recently accessed files that fit within token budget
 */
export async function createPostCompactFileAttachments(
  readFileState: Record<string, { content: string; timestamp: number }>,
  toolUseContext: ToolUseContext,
  maxFiles: number,
  preservedMessages: Message[] = [],
): Promise<AttachmentMessage[]> {
  const preservedReadPaths = collectReadToolFilePaths(preservedMessages)
  const recentFiles = Object.entries(readFileState)
    .map(([filename, state]) => ({ filename, ...state }))
    .filter(
      file =>
        !shouldExcludeFromPostCompactRestore(
          file.filename,
          toolUseContext.agentId,
        ) && !preservedReadPaths.has(expandPath(file.filename)),
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxFiles)

  const results = await Promise.all(
    recentFiles.map(async file => {
      const attachment = await generateFileAttachment(
        file.filename,
        {
          ...toolUseContext,
          fileReadingLimits: {
            maxTokens: POST_COMPACT_MAX_TOKENS_PER_FILE,
          },
        },
        'tengu_post_compact_file_restore_success',
        'tengu_post_compact_file_restore_error',
        'compact',
      )
      return attachment ? createAttachmentMessage(attachment) : null
    }),
  )

  let usedTokens = 0
  return results.filter((result): result is AttachmentMessage<Attachment> => {
    if (result === null) {
      return false
    }
    const attachmentTokens = roughTokenCountEstimation(jsonStringify(result))
    if (usedTokens + attachmentTokens <= POST_COMPACT_TOKEN_BUDGET) {
      usedTokens += attachmentTokens
      return true
    }
    return false
  })
}

/**
 * Creates a plan file attachment if a plan file exists for the current session.
 * This ensures the plan is preserved after compaction.
 */
export function createPlanAttachmentIfNeeded(
  agentId?: AgentId,
): AttachmentMessage | null {
  const planContent = getPlan(agentId)

  if (!planContent) {
    return null
  }

  const planFilePath = getPlanFilePath(agentId)

  return createAttachmentMessage({
    type: 'plan_file_reference',
    planFilePath,
    planContent,
  })
}

/**
 * Creates an attachment for invoked skills to preserve their content across compaction.
 * Only includes skills scoped to the given agent (or main session when agentId is null/undefined).
 * This ensures skill guidelines remain available after the conversation is summarized
 * without leaking skills from other agent contexts.
 */
export function createSkillAttachmentIfNeeded(
  agentId?: string,
): AttachmentMessage | null {
  const invokedSkills = getInvokedSkillsForAgent(agentId)

  if (invokedSkills.size === 0) {
    return null
  }

  // Sorted most-recent-first so budget pressure drops the least-relevant skills.
  // Per-skill truncation keeps the head of each file (where setup/usage
  // instructions typically live) rather than dropping whole skills.
  let usedTokens = 0
  const skills = Array.from(invokedSkills.values())
    .sort((a, b) => b.invokedAt - a.invokedAt)
    .map(skill => ({
      name: skill.skillName,
      path: skill.skillPath,
      content: truncateToTokens(
        skill.content,
        POST_COMPACT_MAX_TOKENS_PER_SKILL,
      ),
    }))
    .filter(skill => {
      const tokens = roughTokenCountEstimation(skill.content)
      if (usedTokens + tokens > POST_COMPACT_SKILLS_TOKEN_BUDGET) {
        return false
      }
      usedTokens += tokens
      return true
    })

  if (skills.length === 0) {
    return null
  }

  return createAttachmentMessage({
    type: 'invoked_skills',
    skills,
  })
}

/**
 * Creates a plan_mode attachment if the user is currently in plan mode.
 * This ensures the model continues to operate in plan mode after compaction
 * (otherwise it would lose the plan mode instructions since those are
 * normally only injected on tool-use turns via getAttachmentMessages).
 */
export async function createPlanModeAttachmentIfNeeded(
  context: ToolUseContext,
): Promise<AttachmentMessage | null> {
  const appState = context.getAppState()
  if (appState.toolPermissionContext.mode !== 'plan') {
    return null
  }

  const planFilePath = getPlanFilePath(context.agentId)
  const planExists = getPlan(context.agentId) !== null

  return createAttachmentMessage({
    type: 'plan_mode',
    reminderType: 'full',
    isSubAgent: !!context.agentId,
    planFilePath,
    planExists,
  })
}

/**
 * Official 2.1.321 (#1862): detect whether a message is a background subagent
 * `<task-notification>` report.
 */
export function isTaskNotificationMessage(msg: Message): boolean {
  if (msg.type !== 'user') return false
  const content = msg.message?.content
  if (typeof content === 'string') {
    return content.includes('<task-notification>')
  }
  if (Array.isArray(content)) {
    return content.some(
      block =>
        typeof block === 'object' &&
        block !== null &&
        block.type === 'text' &&
        typeof block.text === 'string' &&
        block.text.includes('<task-notification>'),
    )
  }
  return false
}

/**
 * Official 2.1.321 (#1862): extract background subagent `<task-notification>`
 * messages from an unanswered trailing turn (after the last assistant message)
 * so compaction before Claude answers them does not drop the report.
 */
export function extractUnansweredTaskNotifications(
  messages: readonly Message[],
): Message[] {
  let lastAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === 'assistant') {
      lastAssistantIdx = i
      break
    }
  }
  const trailing = messages.slice(lastAssistantIdx + 1)
  return trailing.filter(isTaskNotificationMessage)
}

function isLocalCommandUserMessage(msg: Message): boolean {
  if (msg.type !== 'user') return false
  const content = msg.message?.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter(
              (b): b is { type: 'text'; text: string } =>
                typeof b === 'object' &&
                b !== null &&
                b.type === 'text' &&
                typeof (b as { text?: unknown }).text === 'string',
            )
            .map(b => b.text)
            .join('\n')
        : ''
  return (
    text.includes('<command-name>') ||
    text.includes('<local-command-stdout>') ||
    text.includes('<local-command-stderr>') ||
    text.includes('<local-command-caveat>')
  )
}

function isToolResultUserMessage(msg: Message): boolean {
  if (msg.type !== 'user') return false
  const content = msg.message?.content
  return (
    Array.isArray(content) &&
    content.some(
      b => typeof b === 'object' && b !== null && b.type === 'tool_result',
    )
  )
}

/**
 * Official 2.1.323 (#1980) `Yft` / `Tue` / `P$n`:
 * Split messages so an unanswered user prompt after the last real assistant
 * reply (even if followed by local commands like `/context` or another
 * `/compact`) is kept verbatim rather than summarized away.
 */
export function splitUnansweredTrailingTurn(messages: readonly Message[]): {
  toSummarize: Message[]
  toKeep: Message[]
} {
  let lastAnsweredIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    const isRealAssistant = m.type === 'assistant' && !m.isApiErrorMessage
    const isToolResult = isToolResultUserMessage(m)
    if (isRealAssistant || isToolResult) {
      lastAnsweredIdx = i
      break
    }
  }
  const tailStart = lastAnsweredIdx + 1
  for (let i = messages.length - 1; i >= tailStart; i--) {
    const m = messages[i]
    if (!m || m.type !== 'user') continue
    if (
      m.isMeta ||
      m.isCompactSummary ||
      isToolResultUserMessage(m) ||
      isLocalCommandUserMessage(m)
    ) {
      continue
    }
    return {
      toSummarize: messages.slice(0, i),
      toKeep: messages.slice(i),
    }
  }
  return {
    toSummarize: [...messages],
    toKeep: [],
  }
}

/**
 * Combined #1862 + #1980 helper: return any trailing unanswered user turn
 * (skipping local-command / compact-summary / meta rows) or unanswered
 * `<task-notification>` messages so compaction preserves them verbatim.
 */
export function extractUnansweredTrailingMessages(
  messages: readonly Message[],
): Message[] {
  const { toKeep } = splitUnansweredTrailingTurn(messages)
  if (toKeep.length > 0) {
    // Filter out trailing local-command rows (e.g. /context) while preserving
    // the unanswered user message and any task notifications.
    return toKeep.filter(
      m => isTaskNotificationMessage(m) || !isLocalCommandUserMessage(m),
    )
  }
  return extractUnansweredTaskNotifications(messages)
}

/**
 * Official 2.1.319 (#1790): decide whether a background `local_agent` task
 * belongs to the compacting agent (`contextAgentId`), matching `ownerAgentId`
 * (or `parentAgentId` when `ownerAgentId` is absent). Prevents subagents from
 * being told after compaction to expect completion notices for background
 * agents they neither started nor took over.
 */
export function isAsyncAgentOwnedByContext(
  agent: Pick<
    LocalAgentTaskState,
    'agentId' | 'ownerAgentId' | 'parentAgentId'
  >,
  contextAgentId: string | undefined,
): boolean {
  if (contextAgentId !== undefined && agent.agentId === contextAgentId) {
    return false
  }
  const effectiveOwner = agent.ownerAgentId ?? agent.parentAgentId
  if (contextAgentId === undefined) {
    // Main thread owns agents with no explicit owner/parent (or explicit 'main')
    return effectiveOwner === undefined || effectiveOwner === 'main'
  }
  return effectiveOwner === contextAgentId
}

/**
 * Creates attachments for async agents so the model knows about them after
 * compaction. Covers both agents still running in the background (so the model
 * doesn't spawn a duplicate) and agents that have finished but whose results
 * haven't been retrieved yet.
 */
/**
 * Official 2.1.327 (#482): format the post-compaction retrieval instruction for
 * a completed subagent. When an output file path is available AND the caller can
 * continue agents via `SendMessage`, tell Claude to fall back to asking the
 * agent with `SendMessage` if it cannot read the output file. When no output
 * file path is available (e.g. Read/Bash unavailable), tell Claude directly to
 * ask the agent with `SendMessage`.
 */
export function formatCompletedSubagentCompactReminder(opts: {
  taskId: string
  status: string
  outputFilePath?: string
  canContinueAgent?: boolean
  shimmeringClockEnabled?: boolean
}): string | undefined {
  const canContinue = opts.canContinueAgent !== false
  const clockEnabled =
    opts.shimmeringClockEnabled !== undefined
      ? opts.shimmeringClockEnabled
      : getFeatureValue_CACHED_MAY_BE_STALE('tengu_shimmering_clock', true) !==
        false
  if (opts.outputFilePath) {
    const fallbackNote =
      canContinue && opts.status === 'completed' && clockEnabled
        ? ` (if you cannot read it and do not already have its result, ask agent ${opts.taskId} with SendMessage)`
        : ''
    return `Read the output file to retrieve the result: ${opts.outputFilePath}${fallbackNote}`
  }
  if (canContinue) {
    return 'Send it a message with SendMessage to retrieve its result.'
  }
  return undefined
}

function contextHasOutputFileReadTools(context: ToolUseContext): boolean {
  const tools = context.options?.tools ?? []
  if (tools.length === 0) return true
  return tools.some(
    tool =>
      tool.name === FILE_READ_TOOL_NAME ||
      tool.name === 'Bash' ||
      tool.name === 'PowerShell',
  )
}

function contextHasSendMessageTool(context: ToolUseContext): boolean {
  const tools = context.options?.tools ?? []
  if (tools.length === 0) return true
  return tools.some(tool => tool.name === 'SendMessage')
}

export async function createAsyncAgentAttachmentsIfNeeded(
  context: ToolUseContext,
): Promise<AttachmentMessage[]> {
  const appState = context.getAppState()
  const asyncAgents = Object.values(appState.tasks).filter(
    (task): task is LocalAgentTaskState => task.type === 'local_agent',
  )
  const canReadOutputFile = contextHasOutputFileReadTools(context)
  const canContinueAgent = contextHasSendMessageTool(context)

  return asyncAgents.flatMap(agent => {
    if (
      agent.retrieved ||
      agent.status === 'pending' ||
      !isAsyncAgentOwnedByContext(agent, context.agentId)
    ) {
      return []
    }
    const outputFilePath = canReadOutputFile
      ? getTaskOutputPath(agent.agentId)
      : undefined
    const completedHint =
      agent.status === 'completed' && canContinueAgent
        ? formatCompletedSubagentCompactReminder({
            taskId: agent.agentId,
            status: agent.status,
            outputFilePath,
            canContinueAgent,
          })
        : undefined
    return [
      createAttachmentMessage({
        type: 'task_status',
        taskId: agent.agentId,
        taskType: 'local_agent',
        description: agent.description,
        status: agent.status,
        deltaSummary:
          agent.status === 'running'
            ? (agent.progress?.summary ?? null)
            : (agent.error ?? completedHint ?? null),
        outputFilePath,
        canContinueAgent,
      } as Parameters<typeof createAttachmentMessage>[0]),
    ]
  })
}

/**
 * Scan messages for Read tool_use blocks and collect their file_path inputs
 * (normalized via expandPath). Used to dedup post-compact file restoration
 * against what's already visible in the preserved tail.
 *
 * Skips Reads whose tool_result is a dedup stub — the stub points at an
 * earlier full Read that may have been compacted away, so we want
 * createPostCompactFileAttachments to re-inject the real content.
 */
function collectReadToolFilePaths(messages: Message[]): Set<string> {
  const paths = new Set<string>()
  for (const message of messages) {
    if (
      message.type !== 'assistant' ||
      !Array.isArray(message.message!.content)
    ) {
      continue
    }
    for (const block of message.message!.content) {
      if (block.type !== 'tool_use' || block.name !== FILE_READ_TOOL_NAME) {
        continue
      }
      const input = block.input
      if (
        input &&
        typeof input === 'object' &&
        'file_path' in input &&
        typeof input.file_path === 'string'
      ) {
        paths.add(expandPath(input.file_path))
      }
    }
  }
  return paths
}

const SKILL_TRUNCATION_MARKER =
  '\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]'

/**
 * Truncate content to roughly maxTokens, keeping the head. roughTokenCountEstimation
 * uses ~4 chars/token (its default bytesPerToken), so char budget = maxTokens * 4
 * minus the marker so the result stays within budget. Marker tells the model it
 * can Read the full file if needed.
 */
function truncateToTokens(content: string, maxTokens: number): string {
  if (roughTokenCountEstimation(content) <= maxTokens) {
    return content
  }
  const charBudget = maxTokens * 4 - SKILL_TRUNCATION_MARKER.length
  return content.slice(0, charBudget) + SKILL_TRUNCATION_MARKER
}

function shouldExcludeFromPostCompactRestore(
  filename: string,
  agentId?: AgentId,
): boolean {
  const normalizedFilename = expandPath(filename)
  // Exclude plan files
  try {
    const planFilePath = expandPath(getPlanFilePath(agentId))
    if (normalizedFilename === planFilePath) {
      return true
    }
  } catch {
    // If we can't get plan file path, continue with other checks
  }

  // Exclude all types of claude.md files
  // TODO: Refactor to use isMemoryFilePath() from claudemd.ts for consistency
  // and to also match child directory memory files (.claude/rules/*.md, etc.)
  try {
    const normalizedMemoryPaths = new Set(
      MEMORY_TYPE_VALUES.map(type => expandPath(getMemoryPath(type))),
    )

    if (normalizedMemoryPaths.has(normalizedFilename)) {
      return true
    }
  } catch {
    // If we can't get memory paths, continue
  }

  return false
}
