import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import { randomUUID } from 'crypto'
import { relative } from 'path'
import { getCwd } from 'src/utils/cwd.js'
import { addInvokedSkill } from '../bootstrap/state.js'
import { asSessionId } from '../types/ids.js'
import type {
  AttributionSnapshotMessage,
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
  LogOption,
  PersistedWorktreeSession,
  SerializedMessage,
} from '../types/logs.js'
import type {
  Message,
  NormalizedMessage,
  NormalizedUserMessage,
} from '../types/message.js'
import { PERMISSION_MODES, type PermissionMode } from '../types/permissions.js'
import {
  type HookDeferredToolAttachment,
  suppressNextSkillDiscovery,
  suppressNextSkillListing,
} from './attachments.js'
import {
  copyFileHistoryForResume,
  type FileHistorySnapshot,
} from './fileHistory.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { errorMessage } from './errors.js'
import { logError } from './log.js'
import {
  collectMcpOnlyUnresolvedToolUseIds,
  createAssistantMessage,
  createUserMessage,
  dropApiInvalidAssistantBlocks,
  filterOrphanedThinkingAndWhitespaceMessages,
  filterUnresolvedToolUses,
  isToolUseResultMessage,
  NO_RESPONSE_REQUESTED,
  normalizeMessages,
  rewriteMcpShutdownInterruptedToolResults,
} from './messages.js'
import { WITHHELD_MEMORY_REASON_LABELS } from './claudemd.js'
import { copyPlanForResume } from './plans.js'
import { scanDeferredToolUseFromTranscriptTail } from './queryHelpers.js'
import { getResumePrompt } from './resumeReturn.js'
import { processSessionStartHooks } from './sessionStart.js'
import type { HookResultMessage } from '../types/message.js'
import {
  buildConversationChain,
  checkResumeConsistency,
  getLastSessionLog,
  getSessionIdFromLog,
  isLiteLog,
  isTrailingNoReplyNote,
  loadFullLog,
  loadMessageLogs,
  loadTranscriptFile,
  removeExtraFields,
  wasTurnStoppedByHook,
} from './sessionStorage.js'
import type { ContentReplacementRecord } from './toolResultStorage.js'

// Dead code elimination: ant-only tool names are conditionally required so
// their strings don't leak into external builds. Static imports always bundle.
/* eslint-disable @typescript-eslint/no-require-imports */
const BRIEF_TOOL_NAME: string | null =
  feature('KAIROS') || feature('KAIROS_BRIEF')
    ? (
        require('@claude-code/builtin-tools/tools/BriefTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/BriefTool/prompt.js')
      ).BRIEF_TOOL_NAME
    : null
const LEGACY_BRIEF_TOOL_NAME: string | null =
  feature('KAIROS') || feature('KAIROS_BRIEF')
    ? (
        require('@claude-code/builtin-tools/tools/BriefTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/BriefTool/prompt.js')
      ).LEGACY_BRIEF_TOOL_NAME
    : null
const SEND_USER_FILE_TOOL_NAME: string | null = feature('KAIROS')
  ? (
      require('@claude-code/builtin-tools/tools/SendUserFileTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/SendUserFileTool/prompt.js')
    ).SEND_USER_FILE_TOOL_NAME
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

const MAX_SKILL_LISTING_NAMES = 4096
const MAX_SKILL_LISTING_NAME_LENGTH = 512

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Official 2.1.328 `bgs` (`chunk@294254613.js:2383707-2384805`) — structural
 * validation of attachment payloads before resume/transcript loading.
 * Null / non-object / missing required fields / out-of-bounds payloads → invalid (drop).
 */
export function isValidAttachmentPayload(attachment: unknown): boolean {
  if (
    typeof attachment !== 'object' ||
    attachment === null ||
    !('type' in attachment) ||
    typeof (attachment as { type: unknown }).type !== 'string'
  ) {
    return false
  }
  const e = attachment as Record<string, unknown>
  switch (e.type) {
    case 'new_file':
      return 'filename' in e && typeof e.filename === 'string'
    case 'new_directory':
      return 'path' in e && typeof e.path === 'string'
    case 'invoked_skills':
      return (
        'skills' in e &&
        Array.isArray(e.skills) &&
        e.skills.every((t: unknown) => typeof t === 'object' && t !== null)
      )
    case 'hook_success':
      return 'content' in e && typeof e.content === 'string'
    case 'skill_listing':
      return (
        !('names' in e) ||
        e.names === undefined ||
        (Array.isArray(e.names) &&
          e.names.length <= MAX_SKILL_LISTING_NAMES &&
          e.names.every(
            (name: unknown) =>
              typeof name === 'string' &&
              name.length <= MAX_SKILL_LISTING_NAME_LENGTH,
          ))
      )
    case 'hook_additional_context':
      return (
        'content' in e &&
        Array.isArray(e.content) &&
        e.content.every((t: unknown) => typeof t === 'string')
      )
    case 'task_reminder':
    case 'todo_reminder':
      return (
        'content' in e &&
        Array.isArray(e.content) &&
        e.content.every(isPlainRecord)
      )
    case 'file':
    case 'already_read_file':
      return 'content' in e && isPlainRecord(e.content)
    case 'withheld_memory':
      return (
        'by' in e &&
        typeof e.by === 'string' &&
        e.by !== '' &&
        'entries' in e &&
        Array.isArray(e.entries) &&
        e.entries.every(
          (entry: unknown) =>
            isPlainRecord(entry) &&
            'path' in entry &&
            typeof entry.path === 'string' &&
            'why' in entry &&
            typeof entry.why === 'string' &&
            Object.hasOwn(WITHHELD_MEMORY_REASON_LABELS, entry.why) &&
            'displayPath' in entry &&
            typeof entry.displayPath === 'string',
        )
      )
    // densable 2.1.223: malformed diagnostics attachment must not crash resume
    case 'diagnostics':
      return !('files' in e) || e.files === undefined || Array.isArray(e.files)
    default:
      return true
  }
}

/**
 * densable dQr — drop attachment messages with missing/malformed payload so
 * resume never TypeErrors on `attachment.type` of null/undefined.
 */
export function dropMalformedAttachments(messages: Message[]): Message[] {
  let dropped = 0
  const kept = messages.filter(n => {
    if (n.type === 'attachment' && !isValidAttachmentPayload(n.attachment)) {
      dropped += 1
      return false
    }
    return true
  })
  if (dropped === 0) return messages
  const unit = dropped === 1 ? 'entry' : 'entries'
  logForDebugging(
    `resume: dropped ${dropped} attachment ${unit} with a missing or malformed payload — the session transcript appears partially corrupt`,
    { level: 'error' },
  )
  return kept
}

/**
 * Transforms legacy attachment types to current types for backward compatibility.
 * densable Hgy — assumes payload already passed nXu/dQr.
 */
function migrateLegacyAttachmentTypes(message: Message): Message {
  if (message.type !== 'attachment') {
    return message
  }

  // densable Hgy guard: null/malformed should already be dropped by dQr
  const raw = message.attachment
  if (raw == null || typeof raw !== 'object') {
    return message
  }

  const attachment = raw as {
    type: string
    [key: string]: unknown
  } // Handle legacy types not in current type system

  // Transform legacy attachment types
  if (attachment.type === 'new_file') {
    return {
      ...message,
      attachment: {
        ...attachment,
        type: 'file',
        displayPath: relative(getCwd(), attachment.filename as string),
      },
    } as unknown as SerializedMessage // Cast entire message since we know the structure is correct
  }

  if (attachment.type === 'new_directory') {
    return {
      ...message,
      attachment: {
        ...attachment,
        type: 'directory',
        displayPath: relative(getCwd(), attachment.path as string),
      },
    } as unknown as SerializedMessage // Cast entire message since we know the structure is correct
  }

  // Backfill displayPath for attachments from old sessions
  if (!('displayPath' in attachment)) {
    const path =
      typeof attachment.filename === 'string'
        ? attachment.filename
        : typeof attachment.path === 'string'
          ? attachment.path
          : typeof attachment.skillDir === 'string'
            ? attachment.skillDir
            : undefined
    if (path) {
      return {
        ...message,
        attachment: {
          ...attachment,
          displayPath: relative(getCwd(), path),
        },
      } as unknown as Message
    }
  }

  return message
}

export type TeleportRemoteResponse = {
  log: Message[]
  branch?: string
}

export type ApiErrorYieldKind =
  | 'no_request_token'
  | 'rate_limit'
  | 'model_not_found'
  | 'server_error'
  | 'other'

export type TurnInterruptionState =
  | { kind: 'none' }
  | {
      kind: 'interrupted_prompt'
      message: NormalizedUserMessage
      /** Official 2.1.328 #1645: set when the turn ended on an API error with no open tool calls. */
      endedOnApiError?: ApiErrorYieldKind
      /** Official 2.1.328 #1645/#1646: set when the turn ended on an API error past open tool calls. */
      endedOnApiErrorPastCalls?: ApiErrorYieldKind
      /** Official 2.1.328 #1645: set when a restored card sits behind a model refusal. */
      behindRefusal?: boolean
    }

export type DeserializeResult = {
  messages: Message[]
  turnInterruptionState: TurnInterruptionState
  /** #1736: true when auto-resume was held because re-running would leave plan mode. */
  rerunHeldForPlan?: boolean
}

export type PlanSegmentState = 'open' | 'exited' | 'none'

function getDuplicateToolUseIds(messages: Message[]): Set<string> {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const m of messages) {
    if (m.type !== 'assistant' || !Array.isArray(m.message?.content)) continue
    for (const block of m.message.content) {
      if (block.type !== 'tool_use') continue
      if (seen.has(block.id)) dupes.add(block.id)
      else seen.add(block.id)
    }
  }
  return dupes
}

function isPlanSubmittedToTeamLead(msg: Message, content: unknown): boolean {
  const tur = (msg as { toolUseResult?: unknown }).toolUseResult
  if (
    tur !== null &&
    typeof tur === 'object' &&
    (tur as { awaitingLeaderApproval?: unknown }).awaitingLeaderApproval ===
      true
  ) {
    return true
  }
  return (
    typeof content === 'string' &&
    content.startsWith('Your plan has been submitted to the team lead')
  )
}

/**
 * #1736 / official `Bfr(messages)` — determine whether the transcript ends
 * inside an open plan-mode segment, an exited plan-mode segment, or none.
 */
export function planSegmentState(messages: Message[]): PlanSegmentState {
  const planCmdPrefix = '<command-name>/plan</command-name>'
  const erroredToolIds = new Set<string>()
  const succeededToolIds = new Set<string>()
  const duplicateToolIds = getDuplicateToolUseIds(messages)
  let sawLaterNonPlanUser = false
  const openOrNone = (): PlanSegmentState =>
    sawLaterNonPlanUser ? 'none' : 'open'

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'attachment') {
      const attType = (m as { attachment?: { type?: string } }).attachment?.type
      if (attType === 'plan_mode' || attType === 'plan_mode_reentry') {
        return openOrNone()
      }
      if (attType === 'plan_mode_exit') {
        return 'exited'
      }
      continue
    }
    if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
      const blocks = m.message.content
      for (let j = blocks.length - 1; j >= 0; j--) {
        const block = blocks[j]!
        if (block.type !== 'tool_use') continue
        if (
          block.name === 'ExitPlanMode' &&
          succeededToolIds.has(block.id) &&
          !erroredToolIds.has(block.id) &&
          !duplicateToolIds.has(block.id)
        ) {
          return 'exited'
        }
        if (
          block.name === 'EnterPlanMode' &&
          succeededToolIds.has(block.id) &&
          (!erroredToolIds.has(block.id) || duplicateToolIds.has(block.id))
        ) {
          return openOrNone()
        }
      }
      continue
    }
    if (m.type === 'user') {
      const content = m.message?.content
      if (
        Array.isArray(content) &&
        content.some(b => b.type === 'tool_result')
      ) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            if (block.is_error || isPlanSubmittedToTeamLead(m, block.content)) {
              erroredToolIds.add(block.tool_use_id)
            } else {
              succeededToolIds.add(block.tool_use_id)
            }
          }
        }
        continue
      }
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter(
                  (b): b is { type: 'text'; text: string } =>
                    b.type === 'text' && typeof b.text === 'string',
                )
                .map(b => b.text)
                .join('\n')
            : undefined
      if (text?.trimStart().startsWith(planCmdPrefix)) {
        return openOrNone()
      }
      if (m.permissionMode === 'plan') {
        return openOrNone()
      }
      if (m.permissionMode !== undefined && !m.isMeta) {
        sawLaterNonPlanUser = true
      }
    }
  }
  return 'none'
}

/**
 * #1736 / official `brs(messages, currentMode, willRestorePlanMode)` —
 * returns true when re-running an interrupted turn would leave an open plan
 * mode segment (resumed in another permission mode).
 */
export function rerunWouldLeavePlanMode(
  messages: Message[],
  currentMode: string | undefined,
  willRestorePlanMode = false,
): boolean {
  if (currentMode === 'plan' || planSegmentState(messages) !== 'open') {
    return false
  }
  return !willRestorePlanMode
}

function invokeRerunWouldLeaveMode(
  messages: Message[],
  check: (messages: Message[]) => boolean,
): boolean {
  try {
    return check(messages)
  } catch (err) {
    logError(
      err instanceof Error ? err : new Error('rerunWouldLeaveMode failed'),
    )
    return true
  }
}

const RESUME_INTERRUPTED_TURN_FLAG = 'tengu_steady_scroll'
const RESUME_INTERRUPTED_TURN_FLAG_MIN_MS = 5_400_000
const RESUME_INTERRUPTED_TURN_FLAG_MAX_MS = 2_592_000_000

export const API_ERROR_RESUME_DEFAULT_MAX_AGE_MS = 21_600_000
const API_ERROR_RESUME_FLAG = 'tengu_shimmering_cherny'
const API_ERROR_RESUME_FLAG_MIN_MS = 60_000
const API_ERROR_RESUME_FLAG_MAX_MS = 2_592_000_000
const RESUME_REFUSED_FOR_LATER_COMMAND_FLAG = 'tengu_wise_brook'
const CCS_NO_REQUEST_TOKEN_CODE = 'ccs_no_request_token'

export type ApiErrorRowLike = {
  type?: unknown
  uuid?: unknown
  timestamp?: unknown
  isApiErrorMessage?: unknown
  apiError?: unknown
  apiErrorCode?: unknown
  apiErrorStatus?: unknown
  error?: unknown
  failedResponseHadNoToolCall?: unknown
  retractedMessageUuids?: unknown
  message?: {
    id?: unknown
    stop_reason?: unknown
    content?: unknown
  }
}

/** Official `whs` (`chunk@294254613.js @2429507`): terminal API errors that end the turn. */
export function isTerminalApiErrorMessage(msg: ApiErrorRowLike): boolean {
  return (
    msg.message?.stop_reason === 'refusal' ||
    msg.apiError === 'dlp_request_denied' ||
    msg.apiError === 'safety_monitor_blocked' ||
    msg.apiError === 'unattended_start_limit' ||
    (msg.isApiErrorMessage === true && Array.isArray(msg.retractedMessageUuids))
  )
}

/** Official `qGr` (`chunk@294254613.js @2429685`): non-terminal API errors stepped over by resume. */
export function isSteppableApiErrorMessage(msg: ApiErrorRowLike): boolean {
  return msg.isApiErrorMessage === true && !isTerminalApiErrorMessage(msg)
}

/** Official `$qt` (`chunk@294254613.js @2429740`): ignored API errors not counted as skippedApiErrorRow. */
export function isIgnoredApiErrorForResume(msg: ApiErrorRowLike): boolean {
  return (
    msg.isApiErrorMessage === true &&
    (msg.apiError === 'unattended_start_unconfirmed' ||
      msg.apiError === 'message_over_context_limit')
  )
}

/**
 * Official 2.1.328 `Gqn` (`chunk@294254613.js @2392826`): classify a skipped
 * API error assistant row into a yield kind for `#1645` / `#1646`.
 */
export function classifyApiErrorYieldKind(
  row: ApiErrorRowLike | undefined,
): ApiErrorYieldKind | undefined {
  if (!row) return undefined
  if (row.apiErrorCode === CCS_NO_REQUEST_TOKEN_CODE) return 'no_request_token'
  if (row.error === 'rate_limit' || row.error === 'model_not_found') {
    return row.error
  }
  if (typeof row.apiErrorStatus === 'number' && row.apiErrorStatus >= 500) {
    return 'server_error'
  }
  if (row.failedResponseHadNoToolCall) return 'other'
  return undefined
}

/** Official `rKn` (`chunk@294254613.js @2430105`): analytics bucket for skipped API error row. */
function classifySkippedApiErrorBucket(
  row: ApiErrorRowLike,
): 'overloaded' | 'rate_limit' | 'server_error' | 'other' {
  switch (row.error) {
    case 'overloaded':
    case 'rate_limit':
    case 'server_error':
      return row.error
    default:
      return 'other'
  }
}

/** Official `fee` (`chunk@294254613.js @2388125`): max age for API-error resume recovery. */
export function getApiErrorResumeMaxAge(env: NodeJS.ProcessEnv = process.env): {
  maxAgeMs: number
  source: 'env' | 'flag' | 'default'
} {
  const raw = env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS
  if (raw) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
      return { maxAgeMs: parsed, source: 'env' }
    }
  }
  const flagVal = getFeatureValue_CACHED_MAY_BE_STALE<number | null>(
    API_ERROR_RESUME_FLAG,
    null,
  )
  if (
    typeof flagVal === 'number' &&
    Number.isFinite(flagVal) &&
    flagVal >= API_ERROR_RESUME_FLAG_MIN_MS &&
    flagVal <= API_ERROR_RESUME_FLAG_MAX_MS
  ) {
    return { maxAgeMs: flagVal, source: 'flag' }
  }
  return { maxAgeMs: API_ERROR_RESUME_DEFAULT_MAX_AGE_MS, source: 'default' }
}

/** Official `t4` (`chunk@294254613.js @2388290`): true if timestamp is missing or >= maxAgeMs old. */
export function isRowPastMaxAge(
  row: { timestamp?: unknown },
  maxAgeMs: number,
  nowMs: number = Date.now(),
): boolean {
  const ts = Date.parse(typeof row.timestamp === 'string' ? row.timestamp : '')
  return !Number.isFinite(ts) || Math.abs(nowMs - ts) >= maxAgeMs
}

/** Official `jgs` (`chunk@294254613.js @2388390`): pick the newer of two skipped API error rows. */
export function pickNewerSkippedApiErrorRow<T extends { timestamp?: unknown }>(
  a: T | undefined,
  b: T | undefined,
): T | undefined {
  if (a === undefined || b === undefined) return a ?? b
  const tsA = Date.parse(typeof a.timestamp === 'string' ? a.timestamp : '')
  const tsB = Date.parse(typeof b.timestamp === 'string' ? b.timestamp : '')
  if (!Number.isFinite(tsA)) return a
  if (!Number.isFinite(tsB)) return b
  return tsB > tsA ? b : a
}

function extractMatchingToolUseIds(
  msg: Message,
  unresolvedIds: ReadonlySet<string>,
): string[] {
  if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) {
    return []
  }
  const ids: string[] = []
  for (const block of msg.message.content) {
    if (block.type === 'tool_use' && unresolvedIds.has(block.id)) {
      ids.push(block.id)
    }
  }
  return ids
}

/**
 * Official 2.1.328 `gje` (`chunk@294254613.js @2408400`): collect the trailing
 * assistant response's unresolved `tool_use` IDs, resetting across
 * `model_refusal_fallback` or API error rows when `allowApiErrorBoundary` is set.
 */
export function collectTrailingUnresolvedToolUseIds(
  messages: readonly Message[],
  unresolvedIds: ReadonlySet<string>,
  allowApiErrorBoundary: boolean,
): Set<string> {
  const seenResponseIds = new Set<string>()
  const endedMarker = Symbol('ended')
  let activeResponseId: string | symbol = endedMarker
  let trailingIds = new Set<string>()
  let pendingUserBoundary:
    | { toolResult: boolean; classified: boolean }
    | undefined = { toolResult: false, classified: false }

  const isToolResultUser = (m: Message): boolean =>
    m.type === 'user' &&
    Array.isArray(m.message?.content) &&
    m.message.content.some(b => b.type === 'tool_result')

  const isSidechain = (m: Message): boolean =>
    'isSidechain' in m && (m as { isSidechain?: unknown }).isSidechain === true

  for (const msg of messages) {
    const isApiErr =
      msg.type === 'assistant' &&
      (msg as ApiErrorRowLike).isApiErrorMessage === true
    const skipAssistant =
      isSidechain(msg) || (!allowApiErrorBoundary && isApiErr)
    if (msg.type === 'assistant' && !skipAssistant) {
      if (allowApiErrorBoundary && isApiErr) {
        activeResponseId = endedMarker
        trailingIds = new Set<string>()
        continue
      }
      if (pendingUserBoundary && !pendingUserBoundary.classified) {
        if (!pendingUserBoundary.toolResult) {
          seenResponseIds.clear()
        }
        pendingUserBoundary.classified = true
      }
      const responseId = msg.message?.id ?? msg.uuid
      if (seenResponseIds.has(responseId)) {
        if (responseId === activeResponseId) {
          for (const id of extractMatchingToolUseIds(msg, unresolvedIds)) {
            trailingIds.add(id)
          }
        }
        continue
      }
      seenResponseIds.add(responseId)
      activeResponseId = responseId
      trailingIds = new Set(extractMatchingToolUseIds(msg, unresolvedIds))
      pendingUserBoundary = undefined
      continue
    }
    if (
      (msg.type === 'user' && !isSidechain(msg)) ||
      (msg.type === 'system' && msg.subtype === 'compact_boundary')
    ) {
      pendingUserBoundary ??= { toolResult: false, classified: false }
      if (isToolResultUser(msg)) {
        pendingUserBoundary.toolResult = true
      }
      continue
    }
    if (
      allowApiErrorBoundary &&
      msg.type === 'system' &&
      msg.subtype === 'model_refusal_fallback'
    ) {
      activeResponseId = endedMarker
      trailingIds = new Set<string>()
    }
  }
  return trailingIds
}

/**
 * Official 2.1.328 `hje` (`chunk@294254613.js @2409000`): synthesize
 * `[Tool call interrupted: ...]` error `tool_result` messages (with
 * `toolDenialKind: 'interrupted'` and optional `toolDenialEndsTurn`) for
 * cut-off `tool_use` blocks.
 */
export function synthesizeCutOffToolResults(
  messages: Message[],
  preserveIds: Set<string> | undefined,
  cutOffIds: ReadonlySet<string>,
  synthIds: ReadonlySet<string>,
  toolResultText: string = SESSION_ENDED_TOOL_RESULT_MESSAGE,
  endsTurn = false,
): Message[] {
  const combinedPreserve = new Set<string>([
    ...(preserveIds ?? []),
    ...cutOffIds,
  ])
  const filtered = filterUnresolvedToolUses(
    messages,
    combinedPreserve,
  ) as Message[]
  const out = filtered.slice()
  const synthRows: Message[] = []
  for (const msg of out) {
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) {
      continue
    }
    for (const block of msg.message.content) {
      if (block.type !== 'tool_use' || !synthIds.has(block.id)) continue
      const row = createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: toolResultText,
            is_error: true,
            tool_use_id: block.id,
          },
        ],
        toolUseResult: toolResultText,
        sourceToolAssistantUUID: msg.uuid,
      }) as Message & {
        toolDenialKind?: string
        toolDenialEndsTurn?: boolean
      }
      row.toolDenialKind = 'interrupted'
      if (endsTurn) row.toolDenialEndsTurn = true
      synthRows.push(row)
    }
  }
  out.push(...synthRows)
  return out
}

/**
 * Official 2.1.328 `Lu` (`chunk@294254613.js @2403800`): refuse auto-resuming
 * an API-errored prompt when a later system/slash command (`submitUuid`) sits
 * at the end of the transcript (gated by `tengu_wise_brook`).
 */
export function shouldRefuseResumeForLaterCommand(opts: {
  messages: readonly Message[]
  endedOnApiError: ApiErrorYieldKind | undefined
  resumeInterruptedTurn: boolean
  hasPreservedOrRestoredCalls: boolean
  flagEnabled?: boolean
}): boolean {
  if (
    !opts.resumeInterruptedTurn ||
    opts.endedOnApiError === undefined ||
    opts.hasPreservedOrRestoredCalls
  ) {
    return false
  }
  const flagOn =
    opts.flagEnabled ??
    getFeatureValue_CACHED_MAY_BE_STALE(
      RESUME_REFUSED_FOR_LATER_COMMAND_FLAG,
      false,
    ) === true
  if (!flagOn) return false
  const lastRelevant = opts.messages.findLast(m => {
    if (m.type === 'user') return true
    if (m.type === 'assistant') {
      return !isSteppableApiErrorMessage(m as ApiErrorRowLike)
    }
    if (m.type === 'system') {
      return typeof (m as { submitUuid?: unknown }).submitUuid === 'string'
    }
    return false
  })
  if (lastRelevant?.type === 'system') {
    logEvent('resume_refused_for_later_command', {})
    return true
  }
  return false
}

function findUnresolvedToolUseIds(
  messages: readonly Message[],
  preserveIds?: ReadonlySet<string>,
): Set<string> {
  const resolved = new Set<string>(preserveIds)
  for (const msg of messages) {
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result') {
          resolved.add(block.tool_use_id)
        }
      }
    }
  }
  const unresolved = new Set<string>()
  for (const msg of messages) {
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) {
      continue
    }
    for (const block of msg.message.content) {
      if (block.type === 'tool_use' && !resolved.has(block.id)) {
        unresolved.add(block.id)
      }
    }
  }
  return unresolved
}

/**
 * Official `zFt` (#1599) — synthetic assistant error emitted when an unattended
 * start is unconfirmed; skipped during stale-turn timestamp lookup and recovery.
 */
export function isUnattendedStartUnconfirmedError(message: {
  type?: unknown
  isApiErrorMessage?: unknown
  apiError?: unknown
}): boolean {
  return (
    message.type === 'assistant' &&
    message.isApiErrorMessage === true &&
    message.apiError === 'unattended_start_unconfirmed'
  )
}

/**
 * Official `Syo(e)` (#1599) — resolve max age for interrupted-turn auto-resume
 * from `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` or GrowthBook
 * `tengu_steady_scroll` (clamped to [5_400_000, 2_592_000_000]).
 */
export function getResumeInterruptedTurnMaxAge(
  excludeCcr = false,
  env: NodeJS.ProcessEnv = process.env,
): { maxAgeMs: number; source: 'env' | 'flag' } | undefined {
  const raw = env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS
  if (raw) {
    const parsed = Number(raw)
    if (parsed === 0) return undefined
    const maxAgeMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 3_600_000
    return { maxAgeMs, source: 'env' }
  }
  if (excludeCcr) return undefined
  const flagVal = getFeatureValue_CACHED_MAY_BE_STALE<number | null>(
    RESUME_INTERRUPTED_TURN_FLAG,
    null,
  )
  if (
    typeof flagVal === 'number' &&
    flagVal >= RESUME_INTERRUPTED_TURN_FLAG_MIN_MS &&
    flagVal <= RESUME_INTERRUPTED_TURN_FLAG_MAX_MS
  ) {
    return { maxAgeMs: flagVal, source: 'flag' }
  }
  return undefined
}

/**
 * densable Szu — suppress auto-resume of interrupted turns older than
 * CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS (default 1h when env set but
 * non-numeric; unset → never stale).
 */
export function isResumeInterruptedTurnStale(
  messages: Array<{
    type: string
    timestamp?: string
    isApiErrorMessage?: unknown
    apiError?: unknown
  }>,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): boolean {
  const raw = env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS
  if (!raw) return false
  const parsed = Number(raw)
  if (parsed === 0) return false
  const maxAge = Number.isFinite(parsed) && parsed > 0 ? parsed : 3_600_000
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (
      m.type === 'system' ||
      m.type === 'progress' ||
      isUnattendedStartUnconfirmedError(m)
    ) {
      continue
    }
    const ts = Date.parse(m.timestamp ?? '')
    if (Number.isFinite(ts)) return nowMs - ts >= maxAge
  }
  // No timestamped turn message → treat as stale (densable: return true)
  return true
}

/**
 * Deserializes messages from a log file into the format expected by the REPL.
 * Filters unresolved tool uses, orphaned thinking messages, and appends a
 * synthetic assistant sentinel when the last message is from the user.
 * @internal Exported for testing - use loadConversationForResume instead
 */
type IdLessAssistant = {
  type?: unknown
  requestId?: unknown
  message?: { id?: unknown }
}

function stampOneIdLessAssistant<T>(entry: T): T {
  if (typeof entry !== 'object' || entry === null) return entry
  const rec = entry as IdLessAssistant
  if (rec.type !== 'assistant' || rec.message === undefined) return entry
  if (rec.requestId !== undefined) return entry
  if (typeof rec.message.id === 'string' && rec.message.id.length > 0) {
    return entry
  }
  return {
    ...(entry as object),
    message: { ...rec.message, id: randomUUID() },
  } as T
}

/**
 * densable `aVn` — stamp message.id on assistant entries that have no id and
 * no requestId, before same-id merge. Live stream-json injection and resume
 * of older sessions share this rule.
 */
export function stampIdLessAssistantEntry<T>(entry: T): T {
  const next = stampOneIdLessAssistant(entry)
  if (next !== entry) {
    logForDebugging(
      'deserializeMessages: stamped a message.id on 1 id-less assistant entry (pre-#61940 stream-json injection)',
    )
  }
  return next
}

export function stampIdLessAssistantMessages<T>(messages: readonly T[]): T[] {
  let count = 0
  const next = messages.map(message => {
    const stamped = stampOneIdLessAssistant(message)
    if (stamped !== message) count += 1
    return stamped
  })
  if (count > 0) {
    logForDebugging(
      `deserializeMessages: stamped a message.id on ${count} id-less assistant entr${count === 1 ? 'y' : 'ies'} (pre-#61940 stream-json injection)`,
    )
  }
  return next
}

export function deserializeMessages(serializedMessages: Message[]): Message[] {
  return deserializeMessagesWithInterruptDetection(serializedMessages).messages
}

/**
 * Official 2.1.309 (#1166) `YR`: tool result text for tool calls whose result
 * was not recorded before the session/runner ended.
 */
export const SESSION_ENDED_TOOL_RESULT_MESSAGE =
  "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]"

/** Official `Hxn` / `Fc` — `tengu_foamy_spring` defaults true. */
function isFoamySpringEnabled(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_foamy_spring', true) !== false
  )
}

/**
 * Official `bLe` — synthesize `[Tool call interrupted: ...]` tool_result user
 * messages for trailing unresolved `tool_use` blocks when resuming with
 * `CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS=1` (#1166).
 */
function synthesizeInterruptedToolResultsForCutOffCalls(
  messages: Message[],
  preserveUnresolvedToolUseIds?: Set<string>,
): Message[] {
  const resolvedIds = new Set<string>(preserveUnresolvedToolUseIds)
  for (const msg of messages) {
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result') {
          resolvedIds.add(block.tool_use_id)
        }
      }
    }
  }
  const synthesized: Message[] = []
  for (const msg of messages) {
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) {
      continue
    }
    for (const block of msg.message.content) {
      if (block.type === 'tool_use' && !resolvedIds.has(block.id)) {
        synthesized.push(
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: SESSION_ENDED_TOOL_RESULT_MESSAGE,
                is_error: true,
                tool_use_id: block.id,
              },
            ],
            toolUseResult: SESSION_ENDED_TOOL_RESULT_MESSAGE,
            sourceToolAssistantUUID: msg.uuid,
          }),
        )
      }
    }
  }
  return synthesized.length > 0 ? [...messages, ...synthesized] : messages
}

/**
 * Like deserializeMessages, but also detects whether the session was
 * interrupted mid-turn. Used by the SDK resume path to auto-continue
 * interrupted turns after a gateway-triggered restart.
 * @internal Exported for testing
 */
export function deserializeMessagesWithInterruptDetection(
  serializedMessages: Message[],
  /**
   * densable lrs third arg `r=replyOnResume`. When true: skip N4g interrupt
   * detection (turnInterruptionState = none) and skip NRR sentinel — the
   * interactive REPL replay path owns continue via initialMessage:{replay}.
   */
  replyOnResume = false,
  /**
   * Official `M2l` second arg — `$2l` deferred tool_use IDs. Non-empty
   * skips interrupt classification (`t?.size || r` → kind none).
   */
  preserveUnresolvedToolUseIds?: Set<string>,
  /**
   * #1736 / official `rerunWouldLeaveMode` — returns true when auto-resuming
   * an interrupted turn would leave plan mode (resumed in another mode).
   */
  rerunWouldLeaveMode?: (messages: Message[]) => boolean,
): DeserializeResult {
  try {
    // densable dQr before Hgy — drop malformed attachments so resume never
    // TypeErrors on null/missing attachment payloads (2.1.217 #10).
    const sanitizedMessages = dropMalformedAttachments(serializedMessages)
    // Transform legacy attachment types before processing (densable Hgy)
    const migratedMessages = sanitizedMessages.map(migrateLegacyAttachmentTypes)

    // Official 2.1.328 `zct` (`chunk@294254613.js:2396061`): drop API-invalid
    // assistant blocks (assistant tool_result, non-Anthropic server_tool_use,
    // assistant-only-answered tool_use) and truncate overlong tool_use names.
    const apiValidMessages = dropApiInvalidAssistantBlocks(migratedMessages, {
      site: 'resume',
    })

    // Strip invalid permissionMode values from deserialized user messages.
    // The field is unvalidated JSON from disk and may contain modes from a different build.
    const validModes = new Set<string>(PERMISSION_MODES)
    for (const msg of apiValidMessages) {
      if (
        msg.type === 'user' &&
        msg.permissionMode !== undefined &&
        !validModes.has(msg.permissionMode as string)
      ) {
        msg.permissionMode = undefined
      }
    }

    // Official 2.1.328 `Uqn` / `Bqn` (`chunk@294254613.js:2382675-2383680`):
    // rewrite `interruptedByShutdown` tool_result blocks scoped to MCP-only
    // (`mcp__`) assistant tool_use groups, stripping `interruptedByShutdown`
    // and stamping `toolDenialKind: 'interrupted'`.
    const foamySpring = isFoamySpringEnabled()
    const rewrittenShutdownIds = new Set<string>()
    const afterShutdownRewrite = foamySpring
      ? rewriteMcpShutdownInterruptedToolResults(
          apiValidMessages,
          SESSION_ENDED_TOOL_RESULT_MESSAGE,
          rewrittenShutdownIds,
          preserveUnresolvedToolUseIds,
        )
      : apiValidMessages
    // Official 2.1.328 #1645/#1646 (`gje` / `hje` / `_je` in
    // `chunk@294254613.js @2403000-2410000`): capture trailing unresolved
    // tool_use IDs BEFORE filtering so we distinguish `endedOnApiError` (no open
    // calls) from `endedOnApiErrorPastCalls` (API error past open calls).
    const preFilterUnresolvedIds = findUnresolvedToolUseIds(
      afterShutdownRewrite,
      preserveUnresolvedToolUseIds,
    )
    const trailingUnresolvedIds =
      preFilterUnresolvedIds.size > 0
        ? collectTrailingUnresolvedToolUseIds(
            afterShutdownRewrite,
            preFilterUnresolvedIds,
            true,
          )
        : new Set<string>()

    const showsCutOffCalls =
      foamySpring &&
      !replyOnResume &&
      isEnvTruthy(process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS) &&
      !getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_mutable_phoenix_killswitch',
        false,
      )
    // Official 2.1.328 `Bqn` (`chunk@294254613.js:2399031`): even without
    // CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS, synthesize cut-off interrupted
    // results for trailing MCP-only unresolved tool_use groups.
    const trailingMcpCutOffIds =
      !showsCutOffCalls &&
      foamySpring &&
      !replyOnResume &&
      trailingUnresolvedIds.size > 0
        ? collectTrailingUnresolvedToolUseIds(
            afterShutdownRewrite,
            collectMcpOnlyUnresolvedToolUseIds(
              afterShutdownRewrite,
              preFilterUnresolvedIds,
            ),
            true,
          )
        : new Set<string>()
    const withCutOffToolResults = showsCutOffCalls
      ? trailingUnresolvedIds.size > 0
        ? synthesizeCutOffToolResults(
            afterShutdownRewrite,
            preserveUnresolvedToolUseIds,
            trailingUnresolvedIds,
            trailingUnresolvedIds,
            SESSION_ENDED_TOOL_RESULT_MESSAGE,
            false,
          )
        : synthesizeInterruptedToolResultsForCutOffCalls(
            afterShutdownRewrite,
            preserveUnresolvedToolUseIds,
          )
      : trailingMcpCutOffIds.size > 0
        ? synthesizeCutOffToolResults(
            afterShutdownRewrite,
            preserveUnresolvedToolUseIds,
            trailingMcpCutOffIds,
            trailingMcpCutOffIds,
            SESSION_ENDED_TOOL_RESULT_MESSAGE,
            false,
          )
        : afterShutdownRewrite

    // Filter out unresolved tool uses and any synthetic messages that follow them
    const filteredToolUses = filterUnresolvedToolUses(
      withCutOffToolResults,
      preserveUnresolvedToolUseIds,
    ) as NormalizedMessage[]

    // Official 2.1.328 `C4` (`chunk@294254613.js:2399235`): iterate orphaned
    // thinking-only (`rXo`) + whitespace-only (`Z3o`) filtering to a fixpoint
    // so cascading orphans exposed by whitespace removal are eliminated.
    const filteredMessages = stampIdLessAssistantMessages(
      filterOrphanedThinkingAndWhitespaceMessages(
        filteredToolUses,
      ) as NormalizedMessage[],
    ) as NormalizedMessage[]

    // densable lrs: f = t?.size||r ? {kind:"none"} : N4g(p)
    // replyOnResume skips interrupt classification (REPL uses {replay:true}).
    // Official M2l: preserve-set size also forces none (deferred resume).
    // densable Szu: age-out → force none (+ tengu_resume_stale_turn_suppressed).
    // #1736: rerunWouldLeaveMode → force none and mark rerunHeldForPlan so a
    // turn interrupted in plan mode is not re-run under a different mode.
    // #1645/#1646: track skippedApiErrorRow (`_je`), `endedOnApiError`,
    // `endedOnApiErrorPastCalls`, `behindRefusal`, and
    // `resume_refused_for_later_command`.
    let turnInterruptionState: TurnInterruptionState
    let rerunHeldForPlan = false
    if (replyOnResume || (preserveUnresolvedToolUseIds?.size ?? 0) > 0) {
      turnInterruptionState = { kind: 'none' }
    } else {
      const classified = classifyTurnTailWithApiErrors(
        filteredMessages,
        preFilterUnresolvedIds.size > 0,
      )
      const internalState = classified.state
      const rawClassified = classifyTurnTailWithApiErrors(
        afterShutdownRewrite as NormalizedMessage[],
        preFilterUnresolvedIds.size > 0,
      )
      const skippedApiErrorRow = pickNewerSkippedApiErrorRow(
        classified.skippedApiErrorRow,
        rawClassified.skippedApiErrorRow,
      )
      const resumeInterruptedTurn = Boolean(
        process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN,
      )
      const apiErrorAgeLimit = getApiErrorResumeMaxAge()
      const apiErrorTooOld =
        internalState.kind !== 'none' &&
        skippedApiErrorRow !== undefined &&
        skippedApiErrorRow.timestamp !== undefined &&
        isRowPastMaxAge(skippedApiErrorRow, apiErrorAgeLimit.maxAgeMs)
      const endedOnApiError =
        preFilterUnresolvedIds.size === 0
          ? classifyApiErrorYieldKind(skippedApiErrorRow)
          : undefined
      const skippedIdx =
        skippedApiErrorRow?.uuid !== undefined
          ? afterShutdownRewrite.findIndex(
              m => m.uuid === skippedApiErrorRow.uuid,
            )
          : -1
      const hasLaterTrailingCallAfterError =
        skippedIdx !== -1 &&
        afterShutdownRewrite
          .slice(skippedIdx + 1)
          .some(
            m =>
              extractMatchingToolUseIds(m, preFilterUnresolvedIds).length > 0,
          )
      const endedOnApiErrorPastCalls =
        preFilterUnresolvedIds.size > 0 &&
        skippedApiErrorRow?.failedResponseHadNoToolCall &&
        !hasLaterTrailingCallAfterError
          ? classifyApiErrorYieldKind(skippedApiErrorRow)
          : undefined
      const refusedForLaterCommand =
        internalState.kind !== 'none' &&
        !apiErrorTooOld &&
        shouldRefuseResumeForLaterCommand({
          messages: filteredMessages,
          endedOnApiError,
          resumeInterruptedTurn,
          hasPreservedOrRestoredCalls:
            (preserveUnresolvedToolUseIds?.size ?? 0) > 0,
        })

      if (
        internalState.kind !== 'none' &&
        rerunWouldLeaveMode &&
        invokeRerunWouldLeaveMode(filteredMessages, rerunWouldLeaveMode)
      ) {
        rerunHeldForPlan = true
        turnInterruptionState = { kind: 'none' }
      } else if (
        internalState.kind !== 'none' &&
        isResumeInterruptedTurnStale(filteredMessages)
      ) {
        if (resumeInterruptedTurn) {
          logEvent('tengu_resume_stale_turn_suppressed', {
            kind: internalState.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
        }
        turnInterruptionState = { kind: 'none' }
      } else if (apiErrorTooOld) {
        if (resumeInterruptedTurn && skippedApiErrorRow !== undefined) {
          const ageMs =
            Date.now() -
            Date.parse(
              typeof skippedApiErrorRow.timestamp === 'string'
                ? skippedApiErrorRow.timestamp
                : '',
            )
          logEvent('tengu_resume_stale_turn_suppressed', {
            kind: internalState.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            tail: 'api_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            error_kind: classifySkippedApiErrorBucket(
              skippedApiErrorRow,
            ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            ...(Number.isFinite(ageMs)
              ? { age_min: Math.floor(ageMs / 60_000) }
              : {}),
            bound_source:
              apiErrorAgeLimit.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            bound_min: Math.floor(apiErrorAgeLimit.maxAgeMs / 60_000),
          })
        }
        turnInterruptionState = { kind: 'none' }
      } else if (refusedForLaterCommand) {
        turnInterruptionState = { kind: 'none' }
      } else if (internalState.kind === 'interrupted_turn') {
        // Transform mid-turn interruptions into interrupted_prompt by appending
        // a synthetic continuation message. Official kdo —
        // CLAUDE_CODE_RESUME_PROMPT overrides default.
        const [continuationMessage] = normalizeMessages([
          createUserMessage({
            content: getResumePrompt(),
            isMeta: true,
          }),
        ])
        filteredMessages.push(continuationMessage!)
        turnInterruptionState = {
          kind: 'interrupted_prompt',
          message: continuationMessage!,
          ...(endedOnApiError !== undefined ? { endedOnApiError } : {}),
          ...(endedOnApiErrorPastCalls !== undefined
            ? { endedOnApiErrorPastCalls }
            : {}),
          ...(internalState.behindRefusal ? { behindRefusal: true } : {}),
        }
      } else if (internalState.kind === 'interrupted_prompt') {
        turnInterruptionState = {
          ...internalState,
          ...(endedOnApiError !== undefined ? { endedOnApiError } : {}),
          ...(endedOnApiErrorPastCalls !== undefined
            ? { endedOnApiErrorPastCalls }
            : {}),
        }
      } else {
        turnInterruptionState = internalState
      }
    }

    // Append a synthetic assistant sentinel after the last user message so
    // the conversation is API-valid if no resume action is taken. Skip past
    // trailing system/progress messages and insert right after the user
    // message so removeInterruptedMessage's splice(idx, 2) removes the
    // correct pair.
    // densable lrs: if (!r && last is user) inject NRR sentinel.
    if (!replyOnResume) {
      const lastRelevantIdx = filteredMessages.findLastIndex(
        m => m.type !== 'system' && m.type !== 'progress',
      )
      if (
        lastRelevantIdx !== -1 &&
        filteredMessages[lastRelevantIdx]!.type === 'user'
      ) {
        filteredMessages.splice(
          lastRelevantIdx + 1,
          0,
          createAssistantMessage({
            content: NO_RESPONSE_REQUESTED,
          }) as NormalizedMessage,
        )
      }
    }

    return {
      messages: filteredMessages,
      turnInterruptionState,
      ...(rerunHeldForPlan ? { rerunHeldForPlan: true } : {}),
    }
  } catch (error) {
    logError(error as Error)
    throw error
  }
}

/**
 * Internal 3-way result from detection, before transforming interrupted_turn
 * into interrupted_prompt with a synthetic continuation message.
 */
type InternalInterruptionState =
  | TurnInterruptionState
  | { kind: 'interrupted_turn'; behindRefusal?: boolean }

export type ClassifiedTurnTail = {
  state: InternalInterruptionState
  skippedApiErrorRow?: ApiErrorRowLike
}

function findMessageBeforeContextRows(
  messages: NormalizedMessage[],
  lastIdx: number,
): number {
  let sawMetaContext = false
  for (let i = lastIdx; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.type === 'user' && isToolUseResultMessage(msg)) {
      return i < lastIdx ? i : -1
    }
    const isMetaWrapper =
      msg.type === 'user' &&
      (msg.isMeta === true ||
        msg.isCompactSummary === true ||
        (msg as { turnCompanion?: boolean }).turnCompanion === true ||
        typeof (msg as { sourceToolUseID?: unknown }).sourceToolUseID ===
          'string')
    if (msg.type === 'user' && !isMetaWrapper) {
      return i < lastIdx && !sawMetaContext ? i : -1
    }
    sawMetaContext ||=
      msg.type === 'user' &&
      msg.isMeta === true &&
      (msg as { turnCompanion?: boolean }).turnCompanion !== true &&
      typeof (msg as { sourceToolUseID?: unknown }).sourceToolUseID !== 'string'
    if (
      msg.type === 'assistant' ||
      (msg.type === 'user' && msg.isMeta !== true) ||
      (msg.type === 'attachment' &&
        (msg.attachment?.type === 'hook_stopped_continuation' ||
          msg.attachment?.type === 'max_turns_reached'))
    ) {
      return -1
    }
  }
  return -1
}

/**
 * Official 2.1.328 `_je` (`chunk@294254613.js @2409791`): classify the tail of
 * a resumed transcript while tracking any stepped-over non-terminal API error
 * assistant row (`skippedApiErrorRow`) and handling `behindRefusal` (`Kqn`).
 */
export function classifyTurnTailWithApiErrors(
  messages: NormalizedMessage[],
  hasTrailingUnresolvedCalls = false,
  allowBehindRefusal = false,
): ClassifiedTurnTail {
  if (messages.length === 0) {
    return { state: { kind: 'none' } }
  }

  const skippedApiErrors: ApiErrorRowLike[] = []
  let lastMessageIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'system' || m.type === 'progress') continue
    if (
      m.type === 'assistant' &&
      isSteppableApiErrorMessage(m as ApiErrorRowLike)
    ) {
      if (!isIgnoredApiErrorForResume(m as ApiErrorRowLike)) {
        skippedApiErrors.push(m as ApiErrorRowLike)
      }
      continue
    }
    lastMessageIdx = i
    break
  }

  const skippedApiErrorRow = skippedApiErrors[0]
  const lastMessage =
    lastMessageIdx !== -1 ? messages[lastMessageIdx] : undefined
  if (!lastMessage) {
    return { state: { kind: 'none' }, skippedApiErrorRow }
  }

  if (lastMessage.type === 'assistant') {
    const rec = lastMessage as ApiErrorRowLike
    if (rec.isApiErrorMessage === true) {
      // Official `Kqn` (`chunk@294254613.js @2415342`): terminal API errors
      // (refusal, dlp_request_denied, safety_monitor_blocked, etc.) end the turn
      // unless a restored permission card sits behind a refusal.
      if (allowBehindRefusal && rec.message?.stop_reason === 'refusal') {
        return {
          state: { kind: 'interrupted_turn', behindRefusal: true },
          skippedApiErrorRow,
        }
      }
      if (isTerminalApiErrorMessage(rec)) {
        logEvent('tengu_refusal_turn_classified_complete', {
          verdict: (rec.apiError === 'dlp_request_denied'
            ? 'dlp_denied'
            : typeof rec.apiError === 'string'
              ? rec.apiError
              : 'refusal') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
      return { state: { kind: 'none' }, skippedApiErrorRow }
    }
    void hasTrailingUnresolvedCalls
    return { state: { kind: 'none' }, skippedApiErrorRow }
  }

  const state = detectTurnInterruption(messages.slice(0, lastMessageIdx + 1))
  return { state, skippedApiErrorRow }
}

export function detectTurnInterruption(
  messages: NormalizedMessage[],
): InternalInterruptionState {
  if (messages.length === 0) {
    return { kind: 'none' }
  }

  // Find the last turn-relevant message, skipping system/progress and
  // steppable (non-terminal) synthetic API error assistants. Terminal API
  // errors (refusal, dlp_request_denied, safety_monitor_blocked, etc.) are
  // NOT stepped over so they classify as complete instead of auto-retrying.
  const lastMessageIdx = messages.findLastIndex(
    m =>
      m.type !== 'system' &&
      m.type !== 'progress' &&
      !(
        m.type === 'assistant' &&
        isSteppableApiErrorMessage(m as ApiErrorRowLike)
      ),
  )
  const lastMessage =
    lastMessageIdx !== -1 ? messages[lastMessageIdx] : undefined

  if (!lastMessage) {
    return { kind: 'none' }
  }

  if (lastMessage.type === 'assistant') {
    // In the streaming path, stop_reason is always null on persisted messages
    // because messages are recorded at content_block_stop time, before
    // message_delta delivers the stop_reason. After filterUnresolvedToolUses
    // has removed assistant messages with unmatched tool_uses, an assistant as
    // the last message means the turn most likely completed normally.
    return { kind: 'none' }
  }

  let result: InternalInterruptionState = { kind: 'none' }

  if (lastMessage.type === 'user') {
    if (lastMessage.isMeta) {
      // 2.1.299 #691 (SEA H2r / tengu_partitioned_finch): if trailing meta
      // context rows sit on top of an unanswered user prompt (e.g. after
      // compaction + worker replacement), look back past them. Respect
      // queueTranscriptOnly no-reply notes so silent stops are not re-triggered.
      if (
        (lastMessage as { queueTranscriptOnly?: boolean })
          .queueTranscriptOnly === true
      ) {
        return { kind: 'none' }
      }
      const prevIdx = findMessageBeforeContextRows(messages, lastMessageIdx)
      if (prevIdx !== -1) {
        const inner = detectTurnInterruption(messages.slice(0, prevIdx + 1))
        result =
          inner.kind === 'interrupted_prompt'
            ? { kind: 'interrupted_turn' }
            : inner
      }
    } else if (lastMessage.isCompactSummary) {
      return { kind: 'none' }
    } else if (isToolUseResultMessage(lastMessage)) {
      // Brief mode (#20467) drops the trailing assistant text block, so a
      // completed brief-mode turn legitimately ends on SendUserMessage's
      // tool_result. Without this check, resume misclassifies every
      // brief-mode session as interrupted mid-turn and injects a phantom
      // "Continue from where you left off." before the user's real next
      // prompt. Look back one step for the originating tool_use.
      // #692 (SEA Nxn / Kut): also check CLAUDE_CODE_TERMINAL_MCP_TOOLS and
      // sibling tool_results from the same assistant response for endTurn.
      if (
        isTerminalToolResult(lastMessage, messages, lastMessageIdx) ||
        isMcpEndTurnToolResult(lastMessage) ||
        hasSiblingEndTurnToolResult(messages, lastMessageIdx)
      ) {
        return { kind: 'none' }
      }
      result = { kind: 'interrupted_turn' }
    } else {
      // Plain text user prompt — CC hadn't started responding
      result = {
        kind: 'interrupted_prompt',
        message: lastMessage as NormalizedUserMessage,
      }
    }
  } else if (lastMessage.type === 'attachment') {
    // Attachments are part of the user turn — the user provided context but
    // the assistant never responded.
    result = { kind: 'interrupted_turn' }
  }

  // Official 2.1.323 (#2078 & #2144): do not classify a turn as interrupted
  // when a hook intentionally stopped continuation (`continue: false`) or when
  // the tail consists solely of file-arrival / `queueTranscriptOnly` no-reply
  // context rows after a completed assistant reply.
  if (
    result.kind !== 'none' &&
    (wasTurnStoppedByHook(messages) || isTrailingNoReplyNote(messages))
  ) {
    return { kind: 'none' }
  }

  return result
}

/**
 * Is this tool_result the output of a tool that legitimately terminates a
 * turn? SendUserMessage is the canonical case: in brief mode, calling it is
 * the turn's final act — there is no follow-up assistant text (#20467
 * removed it). A transcript ending here means the turn COMPLETED, not that
 * it was killed mid-tool.
 *
 * Walks back to find the assistant tool_use that this result belongs to and
 * checks its name. The matching tool_use is typically the immediately
 * preceding relevant message (filterUnresolvedToolUses has already dropped
 * unpaired ones), but we walk just in case system/progress noise is
 * interleaved.
 */
function getTerminalMcpTools(): Set<string> {
  return new Set(
    (process.env.CLAUDE_CODE_TERMINAL_MCP_TOOLS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )
}

function isTerminalToolResult(
  result: NormalizedUserMessage,
  messages: NormalizedMessage[],
  resultIdx: number,
): boolean {
  const content = result.message.content
  if (!Array.isArray(content)) return false
  const block = content[0]
  if (block?.type !== 'tool_result') return false
  const toolUseId = block.tool_use_id
  const terminalMcpTools = getTerminalMcpTools()

  for (let i = resultIdx - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.type !== 'assistant') continue
    const msgContent = msg.message!.content
    if (!Array.isArray(msgContent)) continue
    for (const b of msgContent) {
      if (
        typeof b !== 'string' &&
        'type' in b &&
        b.type === 'tool_use' &&
        'id' in b &&
        b.id === toolUseId
      ) {
        const name = 'name' in b ? b.name : undefined
        if (
          name === BRIEF_TOOL_NAME ||
          name === LEGACY_BRIEF_TOOL_NAME ||
          name === SEND_USER_FILE_TOOL_NAME
        ) {
          return true
        }
        if (
          typeof name === 'string' &&
          terminalMcpTools.has(name) &&
          block.is_error !== true
        ) {
          return true
        }
        return false
      }
    }
  }
  return false
}

/**
 * Official `Kut` (#692) — true when any sibling tool_result in the same
 * assistant response (matching `message.id`) had `isMcpEndTurnToolResult`.
 */
export function hasSiblingEndTurnToolResult(
  messages: NormalizedMessage[],
  resultIdx: number,
): boolean {
  let seenAssistantMsgId: string | undefined
  let sawEndTurn = false
  for (let i = resultIdx; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.type === 'assistant') {
      const id = msg.message?.id
      if (
        !id ||
        (seenAssistantMsgId !== undefined && seenAssistantMsgId !== id)
      ) {
        return false
      }
      if (sawEndTurn) return true
      seenAssistantMsgId = id
    } else if (
      msg.type === 'user' &&
      (msg as { turnCompanion?: boolean }).turnCompanion !== true &&
      typeof (msg as { sourceToolUseID?: unknown }).sourceToolUseID !== 'string'
    ) {
      if (!isToolUseResultMessage(msg)) return false
      sawEndTurn ||= isMcpEndTurnToolResult(msg)
    }
  }
  return false
}

/**
 * densable `hnt` / `Oxn` — true when an MCP tool_result (via
 * `mcpMeta._meta['claude/endTurn']`, `toolEndsTurn`, or `toolDenialEndsTurn`)
 * legitimately ended the turn so CLAUDE_CODE_RESUME_INTERRUPTED_TURN does not
 * re-run it after a restart.
 */
export function isMcpEndTurnToolResult(result: NormalizedUserMessage): boolean {
  const rec = result as NormalizedUserMessage & {
    toolEndsTurn?: boolean
    toolDenialEndsTurn?: boolean
    mcpMeta?: { _meta?: Record<string, unknown> }
  }
  if (rec.toolDenialEndsTurn === true) return true
  const hasEndTurnFlag =
    rec.toolEndsTurn === true || rec.mcpMeta?._meta?.['claude/endTurn'] === true
  if (!hasEndTurnFlag) return false
  const content = result.message.content
  if (
    Array.isArray(content) &&
    content.some(b => b.type === 'tool_result' && b.is_error === true)
  ) {
    return false
  }
  return true
}

/**
 * Restores skill state from invoked_skills attachments in messages.
 * This ensures that skills are preserved across resume after compaction.
 * Without this, if another compaction happens after resume, the skills would be lost
 * because STATE.invokedSkills would be empty.
 * @internal Exported for testing - use loadConversationForResume instead
 */
export function restoreSkillStateFromMessages(messages: Message[]): void {
  for (const message of messages) {
    if (message.type !== 'attachment') {
      continue
    }
    if (message.attachment!.type === 'invoked_skills') {
      const skills = message.attachment!.skills as Array<{
        name?: string
        path?: string
        content?: string
      }>
      for (const skill of skills) {
        if (skill.name && skill.path && skill.content) {
          // Resume only happens for the main session, so agentId is null
          addInvokedSkill(skill.name, skill.path, skill.content, null)
        }
      }
    }
    // A prior process already injected the skills-available reminder — it's
    // in the transcript the model is about to see. sentSkillNames is
    // process-local, so without this every resume re-announces the same
    // ~600 tokens. Fire-once latch; consumed on the first attachment pass.
    if (message.attachment!.type === 'skill_listing') {
      suppressNextSkillListing()
    }
  }

  // Unconditionally suppress skill_listing and skill_discovery on resume.
  // Attachments are not persisted to transcript for non-ant users
  // (isLoggableMessage filters them out), so the per-type checks above may
  // never find them even though the prior process already injected the content
  // into the conversation via <system-reminder> blocks. Without this, every
  // resume re-injects ~1K tokens of duplicate content and busts the Anthropic
  // prompt cache prefix (which requires 100% byte-identical segments).
  suppressNextSkillListing()
  suppressNextSkillDiscovery()
}

/**
 * Chain-walk a transcript jsonl by path.  Same sequence loadFullLog
 * runs internally — loadTranscriptFile → find newest non-sidechain
 * leaf → buildConversationChain → removeExtraFields — just starting
 * from an arbitrary path instead of the sid-derived one.
 *
 * leafUuids is populated by loadTranscriptFile as "uuids that no
 * other message's parentUuid points at" — the chain tips.  There can
 * be several (sidechains, orphans); newest non-sidechain is the main
 * conversation's end.
 */
export async function loadMessagesFromJsonlPath(path: string): Promise<{
  messages: SerializedMessage[]
  sessionId: UUID | undefined
  /** densable 2.1.223 #8 — last relocatedCwd stamp for this session (if any). */
  relocatedCwd?: string
  /** densable 2.1.224 #30 — non-empty bridge-session pointer (tombstone → absent). */
  bridgeSessionId?: string
  /** AI-generated tab title (`ai-title` entry) for restoreSessionMetadata. */
  aiTitle?: string
  /** densable currentSessionDevModsFolder last-wins. */
  devModsFolder?: string
  /** Persisted permissionMode (`permission-mode` JSONL entry). */
  permissionMode?: PermissionMode
  /** Persisted user-selected model (`session-model` JSONL entry). */
  sessionModel?: string
}> {
  const {
    messages: byUuid,
    leafUuids,
    relocatedCwds,
    bridgeSessionIds,
    aiTitles,
    devModsFolders,
    permissionModes,
    sessionModels,
  } = await loadTranscriptFile(path)
  let tip: (typeof byUuid extends Map<UUID, infer T> ? T : never) | null = null
  let tipTs = 0
  for (const m of byUuid.values()) {
    if (m.isSidechain || !leafUuids.has(m.uuid)) continue
    const ts = new Date(m.timestamp).getTime()
    if (ts > tipTs) {
      tipTs = ts
      tip = m
    }
  }
  if (!tip) return { messages: [], sessionId: undefined }
  const chain = buildConversationChain(byUuid, tip)
  // Leaf's sessionId — forked sessions copy chain[0] from the source
  // transcript, so the root retains the source session's ID. Matches
  // loadFullLog's mostRecentLeaf.sessionId.
  const sessionId = tip.sessionId as UUID | undefined
  return {
    messages: removeExtraFields(chain),
    sessionId,
    relocatedCwd: sessionId ? relocatedCwds.get(sessionId) : undefined,
    bridgeSessionId: sessionId ? bridgeSessionIds.get(sessionId) : undefined,
    aiTitle: sessionId ? aiTitles.get(sessionId) : undefined,
    devModsFolder: sessionId ? devModsFolders.get(sessionId) : undefined,
    permissionMode: sessionId ? permissionModes?.get(sessionId) : undefined,
    sessionModel: sessionId ? sessionModels?.get(sessionId) : undefined,
  }
}

/**
 * Loads a conversation for resume from various sources.
 * This is the centralized function for loading and deserializing conversations.
 *
 * @param source - The source to load from:
 *   - undefined: load most recent conversation
 *   - string: session ID to load
 *   - LogOption: already loaded conversation
 * @param sourceJsonlFile - Alternate: path to a transcript jsonl.
 *   Used when --resume receives a .jsonl path (cli/print.ts routes
 *   on suffix), typically for cross-directory resume where the
 *   transcript lives outside the current project dir.
 * @returns Object containing the deserialized messages and the original log, or null if not found
 */
const COMPACT_TRANSCRIPT_PATH_MARKER =
  'If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: '

/**
 * #870 (aligning with `eeo` / `Message.tsx:getResumedCompactBoundaryInfo`):
 * Populate `leadsToSummary` and `savedIn` on a leading `compact_boundary`
 * message's `compactMetadata` during recovery when resuming from a local
 * transcript.
 */
export function populateResumedCompactBoundarySavedIn(
  messages: Message[],
  transcriptPath: string | undefined,
): void {
  const firstIdx = messages.findIndex(
    m =>
      m.type === 'user' ||
      m.type === 'assistant' ||
      (m.type === 'system' && m.subtype === 'compact_boundary'),
  )
  if (firstIdx === -1) return
  const boundary = messages[firstIdx]
  if (
    !boundary ||
    boundary.type !== 'system' ||
    boundary.subtype !== 'compact_boundary' ||
    !boundary.compactMetadata
  ) {
    return
  }

  let summaryText: string | undefined
  for (let i = firstIdx + 1; i < messages.length; i++) {
    const m = messages[i]!
    if (m.type === 'system' && m.subtype === 'compact_boundary') break
    if (m.type === 'user' && m.isCompactSummary) {
      const content = m.message?.content
      if (typeof content === 'string') {
        summaryText = content
      } else if (Array.isArray(content)) {
        summaryText = content
          .map(b =>
            typeof b === 'object' &&
            b !== null &&
            'type' in b &&
            b.type === 'text' &&
            'text' in b &&
            typeof b.text === 'string'
              ? b.text
              : '',
          )
          .join('')
      }
      break
    }
  }

  const meta = boundary.compactMetadata as Record<string, unknown>
  if (summaryText === undefined) {
    if (meta.leadsToSummary === undefined) {
      messages[firstIdx] = {
        ...boundary,
        compactMetadata: {
          ...boundary.compactMetadata,
          leadsToSummary: false,
        } as typeof boundary.compactMetadata,
      }
    }
    return
  }

  const markerIdx = summaryText.lastIndexOf(
    `\n${COMPACT_TRANSCRIPT_PATH_MARKER}`,
  )
  let savedIn: string | undefined
  if (markerIdx !== -1) {
    const pathStart = markerIdx + 1 + COMPACT_TRANSCRIPT_PATH_MARKER.length
    const lineEnd = summaryText.indexOf('\n', pathStart)
    const extractedPath = summaryText.slice(
      pathStart,
      lineEnd === -1 ? undefined : lineEnd,
    )
    const gcEnabled =
      process.env.CLAUDE_CODE_TRANSCRIPT_LOCAL_GC === '1' ||
      process.env.CLAUDE_CODE_TRANSCRIPT_LOCAL_GC === 'true'
    if (!gcEnabled && transcriptPath && extractedPath === transcriptPath) {
      savedIn = extractedPath
    }
  }

  messages[firstIdx] = {
    ...boundary,
    compactMetadata: {
      ...boundary.compactMetadata,
      leadsToSummary: true,
      ...(savedIn !== undefined && { savedIn }),
    } as typeof boundary.compactMetadata,
  }
}

export type OverdueSessionStartHooks = {
  promise: Promise<HookResultMessage[]>
  abort: () => void
}

export async function loadConversationForResume(
  source: string | LogOption | undefined,
  sourceJsonlFile: string | undefined,
  /**
   * densable p1e / lrs replyOnResume — when true, skip interrupt+NRR sentinel
   * so interactive REPL can consume via initialMessage:{replay:true}.
   * densable 2.1.214 #47: forkSession → SessionStart source "fork".
   */
  opts?: {
    replyOnResume?: boolean
    forkSession?: boolean
    supportOverdueSessionStartHooks?: boolean
    /** Official `xxe` `onSessionResolved` (#1007) — invoked as soon as sessionId is known. */
    onSessionResolved?: (resolved: {
      sessionId: string
      transcriptPath?: string
    }) => Promise<(() => void) | undefined> | (() => void) | void
    /** #1736: suppress auto-resume when re-running would leave plan mode. */
    rerunWouldLeaveMode?: (messages: Message[]) => boolean
  },
): Promise<{
  messages: Message[]
  turnInterruptionState: TurnInterruptionState
  rerunHeldForPlan?: boolean
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contentReplacements?: ContentReplacementRecord[]
  contextCollapseCommits?: ContextCollapseCommitEntry[]
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry
  sessionId: UUID | undefined
  // Session metadata for restoring agent context
  agentName?: string
  agentColor?: string
  agentSetting?: string
  customTitle?: string
  /** AI-generated tab title (`ai-title` entry) for restoreSessionMetadata. */
  aiTitle?: string
  tag?: string
  mode?: 'coordinator' | 'normal'
  worktreeSession?: PersistedWorktreeSession | null
  prNumber?: number
  prUrl?: string
  prRepository?: string
  // Full path to the session file (for cross-directory resume)
  fullPath?: string
  // Goal state for hydration on resume
  goal?: import('../types/logs.js').GoalState
  /** densable 2.1.214 EndConversation marker → AppState.endedByModel */
  endedByModel?: boolean
  /**
   * densable 2.1.223 #8 — last mid-session /cd relocated stamp. Passed through
   * to restoreSessionMetadata so reAppend can re-pin after resume.
   */
  relocatedCwd?: string
  /**
   * densable 2.1.224 #30 — non-empty bridge-session id. Resume force-on only
   * when present; clearBridgeSession tombstone leaves this undefined.
   */
  bridgeSessionId?: string
  /** Official `$2l` / `Jqy` `deferredToolUse`. */
  deferredToolUse?: HookDeferredToolAttachment
  /** densable currentSessionDevModsFolder — last-wins `type:"dev-mods"`. */
  devModsFolder?: string
  /** Persisted permissionMode (`permission-mode` JSONL entry). */
  permissionMode?: PermissionMode
  /** Persisted user-selected model (`session-model` JSONL entry). */
  sessionModel?: string
  /** #520: SessionStart hooks still running after CLAUDE_CODE_RESUME_SESSIONSTART_HOOKS_WAIT_MS. */
  overdueSessionStartHooks?: OverdueSessionStartHooks
} | null> {
  let resolvedHookPromise: Promise<(() => void) | undefined> | undefined
  const fireSessionResolved = (
    resolvedSessionId: string,
    transcriptPath: string | undefined,
  ) => {
    const hook = opts?.onSessionResolved
    if (hook === undefined) return
    resolvedHookPromise ??= Promise.resolve()
      .then(() => hook({ sessionId: resolvedSessionId, transcriptPath }))
      .then(res => (typeof res === 'function' ? res : undefined))
      .catch(err => {
        logForDebugging(
          `resume: onSessionResolved hook failed: ${errorMessage(err)}`,
        )
        return undefined
      })
  }
  const cleanupSessionResolved = () => {
    void resolvedHookPromise?.then(cleanup => cleanup?.()).catch(() => {})
  }
  try {
    let log: LogOption | null = null
    let messages: Message[] | null = null
    let sessionId: UUID | undefined
    /** densable 2.1.223 #8 — from jsonl path branch when no LogOption. */
    let relocatedFromJsonl: string | undefined
    /** densable 2.1.224 #30 — from jsonl path branch when no LogOption. */
    let bridgeFromJsonl: string | undefined
    /** From jsonl path branch when no LogOption. */
    let aiTitleFromJsonl: string | undefined
    /** densable iLr — from jsonl path branch when no LogOption. */
    let devModsFromJsonl: string | undefined
    let permissionModeFromJsonl: PermissionMode | undefined
    let sessionModelFromJsonl: string | undefined

    if (source === undefined) {
      // --continue: most recent session, skipping live --bg/daemon sessions
      // that are actively writing their own transcript.
      const logsPromise = loadMessageLogs()
      let skip = new Set<string>()
      if (feature('BG_SESSIONS')) {
        try {
          const { listAllLiveSessions } = await import('./udsClient.js')
          const live = await listAllLiveSessions()
          skip = new Set(
            live.flatMap(s =>
              s.kind && s.kind !== 'interactive' && s.sessionId
                ? [s.sessionId]
                : [],
            ),
          )
        } catch {
          // UDS unavailable — treat all sessions as continuable
        }
      }
      const logs = await logsPromise
      log =
        logs.find(l => {
          const id = getSessionIdFromLog(l)
          return !id || !skip.has(id)
        }) ?? null
    } else if (sourceJsonlFile) {
      // --resume with a .jsonl path (cli/print.ts routes on suffix).
      // Same chain walk as the sid branch below — only the starting
      // path differs.
      const loaded = await loadMessagesFromJsonlPath(sourceJsonlFile)
      messages = loaded.messages
      sessionId = loaded.sessionId
      relocatedFromJsonl = loaded.relocatedCwd
      bridgeFromJsonl = loaded.bridgeSessionId
      aiTitleFromJsonl = loaded.aiTitle
      devModsFromJsonl = loaded.devModsFolder
      permissionModeFromJsonl = loaded.permissionMode
      sessionModelFromJsonl = loaded.sessionModel
      if (sessionId) {
        fireSessionResolved(sessionId, sourceJsonlFile)
        await resolvedHookPromise
      }
    } else if (typeof source === 'string') {
      // Load specific session by ID
      log = await getLastSessionLog(source as UUID)
      sessionId = source as UUID
    } else {
      // Already have a LogOption
      log = source
    }

    if (!log && !messages) {
      return null
    }

    if (log) {
      // Load full messages for lite logs
      if (isLiteLog(log)) {
        log = await loadFullLog(log)
      }

      // Determine sessionId first so we can pass it to copy functions
      if (!sessionId) {
        sessionId = getSessionIdFromLog(log) as UUID
      }
      // Pass the original session ID to ensure the plan slug is associated with
      // the session we're resuming, not the temporary session ID before resume
      if (sessionId) {
        fireSessionResolved(sessionId, log.fullPath)
        if (resolvedHookPromise === undefined) {
          await copyPlanForResume(log, asSessionId(sessionId))
        } else {
          await Promise.all([
            copyPlanForResume(log, asSessionId(sessionId)),
            resolvedHookPromise,
          ])
        }
      }

      // Copy file history for resume
      void copyFileHistoryForResume(log)

      messages = log.messages
      checkResumeConsistency(messages)
    }

    // Restore skill state from invoked_skills attachments before deserialization.
    // This ensures skills survive multiple compaction cycles after resume.
    restoreSkillStateFromMessages(messages!)

    // Official `$2l` before `M2l`: `p=s?.fullPath??t`, `f=p?await $2l(p)??void 0`
    const transcriptPath = log?.fullPath ?? sourceJsonlFile
    const deferredToolUse = transcriptPath
      ? ((await scanDeferredToolUseFromTranscriptTail(transcriptPath)) ??
        undefined)
      : undefined

    // Deserialize messages to handle unresolved tool uses and ensure proper format
    // densable lrs(..., replyOnResume) — skip interrupt+sentinel for mid-turn fork
    // Official M2l(a, f?new Set([f.toolUseID]):void 0, ...)
    const deserialized = deserializeMessagesWithInterruptDetection(
      messages!,
      Boolean(opts?.replyOnResume),
      deferredToolUse ? new Set([deferredToolUse.toolUseID]) : undefined,
      opts?.rerunWouldLeaveMode,
    )
    messages = deserialized.messages
    populateResumedCompactBoundarySavedIn(messages, transcriptPath)

    // densable 2.1.214 #47: I1e(r.forkSession?"fork":"resume", ...)
    // #520: When CLAUDE_CODE_RESUME_SESSIONSTART_HOOKS_WAIT_MS is set and
    // caller supports overdue SessionStart hooks, race against the wait budget.
    const waitMsRaw = process.env.CLAUDE_CODE_RESUME_SESSIONSTART_HOOKS_WAIT_MS
    const waitMs =
      waitMsRaw !== undefined && waitMsRaw !== '' ? Number(waitMsRaw) : NaN
    let overdueSessionStartHooks: OverdueSessionStartHooks | undefined
    if (
      opts?.supportOverdueSessionStartHooks &&
      Number.isFinite(waitMs) &&
      waitMs >= 0 &&
      messages.length > 0
    ) {
      const overdueController = new AbortController()
      const hookPromise = processSessionStartHooks(
        opts.forkSession ? 'fork' : 'resume',
        { sessionId, messages, orphaned: overdueController.signal },
      )
      const RACE_TIMEOUT = Symbol('overdue')
      let timer: ReturnType<typeof setTimeout> | undefined
      const raceResult = await Promise.race([
        hookPromise,
        new Promise<typeof RACE_TIMEOUT>(resolve => {
          timer = setTimeout(() => resolve(RACE_TIMEOUT), waitMs)
          timer.unref?.()
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer)
      })
      if (raceResult === RACE_TIMEOUT) {
        logForDebugging(
          `SessionStart hooks are still running after ${waitMs} ms: reading messages now, their output joins a later turn`,
        )
        overdueSessionStartHooks = {
          promise: hookPromise,
          abort: () => overdueController.abort(),
        }
      } else {
        messages.push(...raceResult)
      }
    } else {
      const hookMessages = await processSessionStartHooks(
        opts?.forkSession ? 'fork' : 'resume',
        { sessionId, messages },
      )
      // Append hook messages to the conversation
      messages.push(...hookMessages)
    }

    return {
      messages,
      turnInterruptionState: deserialized.turnInterruptionState,
      ...(deserialized.rerunHeldForPlan ? { rerunHeldForPlan: true } : {}),
      fileHistorySnapshots: log?.fileHistorySnapshots,
      attributionSnapshots: log?.attributionSnapshots,
      contentReplacements: log?.contentReplacements,
      contextCollapseCommits: log?.contextCollapseCommits,
      contextCollapseSnapshot: log?.contextCollapseSnapshot,
      sessionId,
      // Include session metadata for restoring agent context on resume
      agentName: log?.agentName,
      agentColor: log?.agentColor,
      agentSetting: log?.agentSetting,
      customTitle: log?.customTitle,
      aiTitle: log?.aiTitle ?? aiTitleFromJsonl,
      tag: log?.tag,
      mode: log?.mode,
      worktreeSession: log?.worktreeSession,
      prNumber: log?.prNumber,
      prUrl: log?.prUrl,
      prRepository: log?.prRepository,
      // Include full path for cross-directory resume
      fullPath: log?.fullPath,
      // Goal state for hydration on resume
      goal: log?.goal,
      // densable 2.1.214: hydrate ended-by-model into AppState
      endedByModel: log?.endedByModel,
      // densable 2.1.223 #8 — hydrate relocate for restoreSessionMetadata
      relocatedCwd: log?.relocatedCwd ?? relocatedFromJsonl,
      // densable 2.1.224 #30 — non-empty bridge pointer for resume force-on
      bridgeSessionId: log?.bridgeSessionId ?? bridgeFromJsonl,
      // densable iLr — consented mods folder for restoreSessionMetadata / bOn
      devModsFolder: log?.devModsFolder ?? devModsFromJsonl,
      // Persisted permissionMode & sessionModel for processResumedConversation
      permissionMode: log?.permissionMode ?? permissionModeFromJsonl,
      sessionModel: log?.sessionModel ?? sessionModelFromJsonl,
      deferredToolUse,
      overdueSessionStartHooks,
    }
  } catch (error) {
    cleanupSessionResolved()
    logError(error as Error)
    throw error
  }
}
