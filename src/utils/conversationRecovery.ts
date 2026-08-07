import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
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
import { logForDebugging } from './debug.js'
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
} from './messages.js'
import { copyPlanForResume } from './plans.js'
import { getResumePrompt } from './resumeReturn.js'
import { processSessionStartHooks } from './sessionStart.js'
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
export function deserializeMessages(serializedMessages: Message[]): Message[] {
  return deserializeMessagesWithInterruptDetection(serializedMessages).messages
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

    // Filter out unresolved tool uses and any synthetic messages that follow them
    const filteredToolUses = filterUnresolvedToolUses(
      migratedMessages,
    ) as NormalizedMessage[]

    // Filter out orphaned thinking-only assistant messages that can cause API errors
    // during resume. These occur when streaming yields separate messages per content
    // block and interleaved user messages prevent proper merging by message.id.
    const filteredThinking = filterOrphanedThinkingOnlyMessages(
      filteredToolUses,
    ) as NormalizedMessage[]

    // Filter out assistant messages with only whitespace text content.
    // This can happen when model outputs "\n\n" before thinking, user cancels mid-stream.
    const filteredMessages = filterWhitespaceOnlyAssistantMessages(
      filteredThinking,
    ) as NormalizedMessage[]

    // densable lrs: f = t?.size||r ? {kind:"none"} : N4g(p)
    // replyOnResume skips interrupt classification (REPL uses {replay:true}).
    // densable Szu: age-out → force none (+ tengu_resume_stale_turn_suppressed).
    let turnInterruptionState: TurnInterruptionState
    if (replyOnResume) {
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
function detectTurnInterruption(
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
    if (lastMessage.isMeta || lastMessage.isCompactSummary) {
      return { kind: 'none' }
    }
    if (isToolUseResultMessage(lastMessage)) {
      // Brief mode (#20467) drops the trailing assistant text block, so a
      // completed brief-mode turn legitimately ends on SendUserMessage's
      // tool_result. Without this check, resume misclassifies every
      // brief-mode session as interrupted mid-turn and injects a phantom
      // "Continue from where you left off." before the user's real next
      // prompt. Look back one step for the originating tool_use.
      if (isTerminalToolResult(lastMessage, messages, lastMessageIdx)) {
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
        return (
          ('name' in b ? b.name : undefined) === BRIEF_TOOL_NAME ||
          ('name' in b ? b.name : undefined) === LEGACY_BRIEF_TOOL_NAME ||
          ('name' in b ? b.name : undefined) === SEND_USER_FILE_TOOL_NAME
        )
      }
    }
  }
  return false
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
}> {
  const { messages: byUuid, leafUuids } = await loadTranscriptFile(path)
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
  return {
    messages: removeExtraFields(chain),
    // Leaf's sessionId — forked sessions copy chain[0] from the source
    // transcript, so the root retains the source session's ID. Matches
    // loadFullLog's mostRecentLeaf.sessionId.
    sessionId: tip.sessionId as UUID | undefined,
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
export async function loadConversationForResume(
  source: string | LogOption | undefined,
  sourceJsonlFile: string | undefined,
  /**
   * densable p1e / lrs replyOnResume — when true, skip interrupt+NRR sentinel
   * so interactive REPL can consume via initialMessage:{replay:true}.
   * densable 2.1.214 #47: forkSession → SessionStart source "fork".
   */
  opts?: { replyOnResume?: boolean; forkSession?: boolean },
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
} | null> {
  try {
    let log: LogOption | null = null
    let messages: Message[] | null = null
    let sessionId: UUID | undefined

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
        await copyPlanForResume(log, asSessionId(sessionId))
      }

      // Copy file history for resume
      void copyFileHistoryForResume(log)

      messages = log.messages
      checkResumeConsistency(messages)
    }

    // Restore skill state from invoked_skills attachments before deserialization.
    // This ensures skills survive multiple compaction cycles after resume.
    restoreSkillStateFromMessages(messages!)

    // Deserialize messages to handle unresolved tool uses and ensure proper format
    // densable lrs(..., replyOnResume) — skip interrupt+sentinel for mid-turn fork
    const deserialized = deserializeMessagesWithInterruptDetection(
      messages!,
      Boolean(opts?.replyOnResume),
    )
    messages = deserialized.messages

    // densable 2.1.214 #47: I1e(r.forkSession?"fork":"resume", ...)
    const hookMessages = await processSessionStartHooks(
      opts?.forkSession ? 'fork' : 'resume',
      { sessionId },
    )

    // Append hook messages to the conversation
    messages.push(...hookMessages)

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
    }
  } catch (error) {
    logError(error as Error)
    throw error
  }
}
