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
import { PERMISSION_MODES } from '../types/permissions.js'
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
  createAssistantMessage,
  createUserMessage,
  filterOrphanedThinkingOnlyMessages,
  filterUnresolvedToolUses,
  filterWhitespaceOnlyAssistantMessages,
  isToolUseResultMessage,
  NO_RESPONSE_REQUESTED,
  normalizeMessages,
  rewriteResumedSubagentShutdownToolResults,
} from './messages.js'
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
  loadFullLog,
  loadMessageLogs,
  loadTranscriptFile,
  removeExtraFields,
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

/**
 * densable nXu — structural validation of attachment payloads before resume
 * migration. Null / non-object / missing required fields → invalid (drop).
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
      return !('names' in e) || e.names === undefined || Array.isArray(e.names)
    case 'hook_additional_context':
      return (
        'content' in e &&
        Array.isArray(e.content) &&
        e.content.every((t: unknown) => typeof t === 'string')
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

export type TurnInterruptionState =
  | { kind: 'none' }
  | { kind: 'interrupted_prompt'; message: NormalizedUserMessage }

export type DeserializeResult = {
  messages: Message[]
  turnInterruptionState: TurnInterruptionState
}

/**
 * densable Szu — suppress auto-resume of interrupted turns older than
 * CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS (default 1h when env set but
 * non-numeric; unset → never stale).
 */
export function isResumeInterruptedTurnStale(
  messages: Array<{ type: string; timestamp?: string }>,
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
    if (m.type === 'system' || m.type === 'progress') continue
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
): DeserializeResult {
  try {
    // densable dQr before Hgy — drop malformed attachments so resume never
    // TypeErrors on null/missing attachment payloads (2.1.217 #10).
    const sanitizedMessages = dropMalformedAttachments(serializedMessages)
    // Transform legacy attachment types before processing (densable Hgy)
    const migratedMessages = sanitizedMessages.map(migrateLegacyAttachmentTypes)

    // Strip invalid permissionMode values from deserialized user messages.
    // The field is unvalidated JSON from disk and may contain modes from a different build.
    const validModes = new Set<string>(PERMISSION_MODES)
    for (const msg of migratedMessages) {
      if (
        msg.type === 'user' &&
        msg.permissionMode !== undefined &&
        !validModes.has(msg.permissionMode as string)
      ) {
        msg.permissionMode = undefined
      }
    }

    // Official `Wxn` (#1166): rewrite `interruptedByShutdown` tool_result blocks
    // to `YR` (`SESSION_ENDED_TOOL_RESULT_MESSAGE`), and when
    // `CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS` is set, synthesize `YR`
    // tool_result blocks for cut-off `tool_use` calls.
    const foamySpring = isFoamySpringEnabled()
    const afterShutdownRewrite = foamySpring
      ? rewriteResumedSubagentShutdownToolResults(
          migratedMessages,
          SESSION_ENDED_TOOL_RESULT_MESSAGE,
        )
      : migratedMessages
    const showsCutOffCalls =
      foamySpring &&
      !replyOnResume &&
      isEnvTruthy(process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS) &&
      !getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_mutable_phoenix_killswitch',
        false,
      )
    const withCutOffToolResults = showsCutOffCalls
      ? synthesizeInterruptedToolResultsForCutOffCalls(
          afterShutdownRewrite,
          preserveUnresolvedToolUseIds,
        )
      : afterShutdownRewrite

    // Filter out unresolved tool uses and any synthetic messages that follow them
    const filteredToolUses = filterUnresolvedToolUses(
      withCutOffToolResults,
      preserveUnresolvedToolUseIds,
    ) as NormalizedMessage[]

    // Filter out orphaned thinking-only assistant messages that can cause API errors
    // during resume. These occur when streaming yields separate messages per content
    // block and interleaved user messages prevent proper merging by message.id.
    const filteredThinking = filterOrphanedThinkingOnlyMessages(
      filteredToolUses,
    ) as NormalizedMessage[]

    // Filter out assistant messages with only whitespace text content.
    // This can happen when model outputs "\n\n" before thinking, user cancels mid-stream.
    const filteredMessages = stampIdLessAssistantMessages(
      filterWhitespaceOnlyAssistantMessages(
        filteredThinking,
      ) as NormalizedMessage[],
    ) as NormalizedMessage[]

    // densable lrs: f = t?.size||r ? {kind:"none"} : N4g(p)
    // replyOnResume skips interrupt classification (REPL uses {replay:true}).
    // Official M2l: preserve-set size also forces none (deferred resume).
    // densable Szu: age-out → force none (+ tengu_resume_stale_turn_suppressed).
    let turnInterruptionState: TurnInterruptionState
    if (replyOnResume || (preserveUnresolvedToolUseIds?.size ?? 0) > 0) {
      turnInterruptionState = { kind: 'none' }
    } else {
      const internalState = detectTurnInterruption(filteredMessages)

      if (
        internalState.kind !== 'none' &&
        isResumeInterruptedTurnStale(filteredMessages)
      ) {
        if (process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN) {
          logEvent('tengu_resume_stale_turn_suppressed', {
            kind: internalState.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
        }
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

    return { messages: filteredMessages, turnInterruptionState }
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
  | { kind: 'interrupted_turn' }

/**
 * Determines whether the conversation was interrupted mid-turn based on the
 * last message after filtering. An assistant as last message (after filtering
 * unresolved tool_uses) is treated as a completed turn because stop_reason is
 * always null on persisted messages in the streaming path.
 *
 * System and progress messages are skipped when finding the last turn-relevant
 * message — they are bookkeeping artifacts that should not mask a genuine
 * interruption. Attachments are kept as part of the turn.
 */
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

export function detectTurnInterruption(
  messages: NormalizedMessage[],
): InternalInterruptionState {
  if (messages.length === 0) {
    return { kind: 'none' }
  }

  // Find the last turn-relevant message, skipping system/progress and
  // synthetic API error assistants. Error assistants are already filtered
  // before API send (normalizeMessagesForAPI) — skipping them here lets
  // auto-resume fire after retry exhaustion instead of reading the error as
  // a completed turn.
  const lastMessageIdx = messages.findLastIndex(
    m =>
      m.type !== 'system' &&
      m.type !== 'progress' &&
      !(m.type === 'assistant' && m.isApiErrorMessage),
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
        if (inner.kind === 'interrupted_prompt') {
          return { kind: 'interrupted_turn' }
        }
        return inner
      }
      return { kind: 'none' }
    }
    if (lastMessage.isCompactSummary) {
      return { kind: 'none' }
    }
    if (isToolUseResultMessage(lastMessage)) {
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
      return { kind: 'interrupted_turn' }
    }
    // Plain text user prompt — CC hadn't started responding
    return {
      kind: 'interrupted_prompt',
      message: lastMessage as NormalizedUserMessage,
    }
  }

  if (lastMessage.type === 'attachment') {
    // Attachments are part of the user turn — the user provided context but
    // the assistant never responded.
    return { kind: 'interrupted_turn' }
  }

  return { kind: 'none' }
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
}> {
  const {
    messages: byUuid,
    leafUuids,
    relocatedCwds,
    bridgeSessionIds,
    aiTitles,
    devModsFolders,
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
  },
): Promise<{
  messages: Message[]
  turnInterruptionState: TurnInterruptionState
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
  /** #520: SessionStart hooks still running after CLAUDE_CODE_RESUME_SESSIONSTART_HOOKS_WAIT_MS. */
  overdueSessionStartHooks?: OverdueSessionStartHooks
} | null> {
  let resolvedHookPromise: Promise<void | (() => void) | undefined> | undefined
  const fireSessionResolved = (
    resolvedSessionId: string,
    transcriptPath: string | undefined,
  ) => {
    const hook = opts?.onSessionResolved
    if (hook === undefined) return
    resolvedHookPromise ??= Promise.resolve()
      .then(() => hook({ sessionId: resolvedSessionId, transcriptPath }))
      .catch(err => {
        logForDebugging(
          `resume: onSessionResolved hook failed: ${errorMessage(err)}`,
        )
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
      deferredToolUse,
      overdueSessionStartHooks,
    }
  } catch (error) {
    cleanupSessionResolved()
    logError(error as Error)
    throw error
  }
}
