import { builtInCommandNames } from '../../commands.js'
import { COMMAND_NAME_TAG } from '../../constants/xml.js'
import { toAgentId } from '../../types/ids.js'
import type {
  AttributionSnapshotMessage,
  FileHistorySnapshotMessage,
  LogOption,
  SerializedMessage,
  TranscriptMessage,
} from '../../types/logs.js'
import type { Message } from '../../types/message.js'
import { isDisklessActive } from '../disklessGuards.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../envUtils.js'
import type { FileHistorySnapshot } from '../fileHistory.js'
import { logError } from '../log.js'
import { extractTag, isCompactBoundaryMessage } from '../messages.js'
import { getUserType } from '../sessionPaths.js'
import { jsonParse } from '../slowOperations.js'
import type { ContentReplacementRecord } from '../toolResultStorage.js'
import { REPL_TOOL_NAME } from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import { type UUID, randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { basename, join, resolve } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import {
  CHAIN_TIMESTAMP_FALLBACK_WINDOW_MS,
  DISALLOWED_PUT_BACK_ATTACHMENT_TYPES,
  FILE_ARRIVAL_ATTACHMENT_TYPES,
  type LegacyProgressEntry,
  MAX_CHAIN_GAP_BRIDGES,
  MAX_ORIGINAL_FILE_STORAGE_CHARS,
  MISSING_EARLIER_MESSAGES_WARNING,
  PUT_BACK_MAX_ROWS,
  type PreservedCompactMeta,
  type PreservedMessagesRef,
  RESERVED_AGENT_NAMES,
  SKIP_FIRST_PROMPT_PATTERN,
  SLIM_TOOL_USE_WINDOW_MAX,
  type StripForStorageTool,
  type TimedFallbackEntry,
  type TimedFallbackState,
  type ToolUseNameWindowLike,
  type Transcript,
} from './types.js'
import {
  getHostSessionStorageState,
  markNotChainParent,
} from './sessionState.js'

/**
 * Progress entries in transcripts written before PR #24099. They are not
 * in the Entry type union anymore but still exist on disk with uuid and
 * parentUuid fields. loadTranscriptFile bridges the chain across them.
 */
export function isLegacyProgressEntry(
  entry: unknown,
): entry is LegacyProgressEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'type' in entry &&
    entry.type === 'progress' &&
    'uuid' in entry &&
    typeof entry.uuid === 'string'
  )
}

/**
 * densable oHr — compact_boundary system message OR user compact summary.
 * These are the "compact pair" entries that must not be re-uploaded under
 * history-backfill suppression (2.1.225 #7).
 */
export function isCompactPairEntry(entry: {
  type?: string
  subtype?: string
  isCompactSummary?: boolean
}): boolean {
  if (isCompactBoundaryMessage(entry as Message)) return true
  return entry.type === 'user' && entry.isCompactSummary === true
}

/**
 * Official 2.1.323 #1981 (`h3i`): when a resumed session has an interrupted
 * prompt that is NOT resumed, strip any synthetic NRR loader sentinel and mark
 * the unresumed interrupted message so subsequent messages do NOT join their
 * `parentUuid` onto it (nor splice away a real user prompt on restart, #2142).
 */
export function stripUnresumedInterruptedMessages(
  messages: Message[],
  interrupted:
    | { kind: 'none' }
    | {
        kind: 'interrupted_prompt'
        message: Message
        loaderSentinelUuid?: string
      }
    | undefined,
  onSpliceIndex?: (removedIndex: number) => void,
): void {
  if (!interrupted || interrupted.kind === 'none') return
  const msgIdx = messages.findIndex(m => m.uuid === interrupted.message.uuid)
  const sentinelIdx =
    interrupted.loaderSentinelUuid !== undefined
      ? messages.findIndex(m => m.uuid === interrupted.loaderSentinelUuid)
      : msgIdx !== -1
        ? msgIdx + 1
        : -1
  const sentinel = sentinelIdx !== -1 ? messages[sentinelIdx] : undefined
  if (
    sentinel?.type === 'assistant' &&
    Array.isArray(sentinel.message?.content) &&
    sentinel.message.content.length === 1 &&
    sentinel.message.content[0]?.type === 'text' &&
    sentinel.message.content[0].text === 'No response requested.'
  ) {
    messages.splice(sentinelIdx, 1)
    onSpliceIndex?.(sentinelIdx)
  }
  const target = msgIdx !== -1 ? messages[msgIdx] : undefined
  if (target?.uuid) {
    // Always exclude the unresumed interrupted message from becoming the
    // parentUuid of the next user turn (#1981).
    markNotChainParent(target.uuid)
  }
  // If it was a synthetic meta continuation prompt (not a real user message),
  // remove it from the active array; real user prompts stay visible (#2142).
  if (target?.type === 'user' && target.isMeta === true) {
    messages.splice(msgIdx, 1)
    onSpliceIndex?.(msgIdx)
  }
}

/**
 * Official 2.1.323 #2078 (`Vut` + `U2r`): returns true when the tail of the
 * conversation was intentionally stopped by a hook returning `continue: false`
 * (`hook_stopped_continuation` attachment or `stop_hook_summary` with
 * `preventedContinuation: true`), so `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`
 * must NOT re-run the stopped turn.
 */
export function wasTurnStoppedByHook(messages: readonly Message[]): boolean {
  if (messages.length === 0) return false
  let sawHookStopped = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (
      m.type === 'attachment' &&
      (m.attachment as { type?: string } | undefined)?.type ===
        'hook_stopped_continuation'
    ) {
      sawHookStopped = true
      continue
    }
    if (
      m.type === 'system' &&
      (m as { subtype?: string; preventedContinuation?: boolean }).subtype ===
        'stop_hook_summary' &&
      (m as { preventedContinuation?: boolean }).preventedContinuation === true
    ) {
      sawHookStopped = true
      continue
    }
    if (m.type === 'system' || m.type === 'progress') {
      continue
    }
    if (m.type === 'user') {
      const content = m.message?.content
      const isToolResult =
        Array.isArray(content) &&
        content.some(
          b =>
            typeof b === 'object' &&
            b !== null &&
            (b as { type?: string }).type === 'tool_result',
        )
      if (isToolResult) {
        if (sawHookStopped) {
          logEvent('tengu_resume_hook_stopped_batch', {})
          return true
        }
        continue
      }
      if (sawHookStopped) {
        logEvent('tengu_resume_hook_stopped_batch', {})
        return true
      }
      if (!m.isMeta) {
        return false
      }
      continue
    }
    if (m.type === 'assistant') {
      if (sawHookStopped) {
        return true
      }
      return false
    }
    if (
      m.type === 'attachment' &&
      !sawHookStopped &&
      ((m.attachment as { type?: string } | undefined)?.type ===
        'queued_command' ||
        (m.attachment as { type?: string } | undefined)?.type === 'poll_events')
    ) {
      return false
    }
  }
  return sawHookStopped
}

/**
 * Official 2.1.323 #2144 (`Is` / `no_reply_note`): returns true when the tail
 * after a completed assistant reply (`stop_reason === 'end_turn'`) consists
 * only of file-arrival / `queueTranscriptOnly` context rows — so resuming a
 * cloud session must NOT trigger an unsolicited model call.
 */
export function isTrailingNoReplyNote(messages: readonly Message[]): boolean {
  if (messages.length === 0) return false
  let sawFileOrNote = false
  let lastTurnIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'system' || m.type === 'progress') continue
    if (
      m.type === 'attachment' &&
      FILE_ARRIVAL_ATTACHMENT_TYPES.has(
        (m.attachment as { type?: string } | undefined)?.type ?? '',
      )
    ) {
      sawFileOrNote = true
      continue
    }
    if (
      m.type === 'user' &&
      m.isMeta === true &&
      (m as { queueTranscriptOnly?: boolean }).queueTranscriptOnly === true
    ) {
      sawFileOrNote = true
      continue
    }
    if (
      m.type === 'attachment' &&
      ((m.attachment as { type?: string } | undefined)?.type ===
        'prompt_snapshot' ||
        (m.attachment as { type?: string } | undefined)?.type ===
          'deferred_tools_record' ||
        ((m.attachment as { hookEvent?: string; type?: string } | undefined)
          ?.hookEvent === 'SessionStart' &&
          ((m.attachment as { type?: string } | undefined)?.type ===
            'hook_success' ||
            (m.attachment as { type?: string } | undefined)?.type ===
              'hook_non_blocking_error')))
    ) {
      continue
    }
    lastTurnIdx = i
    break
  }
  if (!sawFileOrNote) return false
  if (lastTurnIdx < 0) return true
  const prev = messages[lastTurnIdx]!
  return (
    prev.type === 'assistant' &&
    !prev.isApiErrorMessage &&
    prev.message?.stop_reason === 'end_turn'
  )
}

export function setToolResultCopiesOnDisk(mode: 'whole' | 'slim'): void {
  const state = getHostSessionStorageState()
  state.toolResultCopiesOnDiskState = mode
  if (state.project) {
    state.project.appendToolUseWindow =
      mode === 'slim' ? new ToolUseNameWindow() : undefined
  }
}

/**
 * Official 2.1.328 `vsn` (`chunk@294254613.js @607248`): slim duplicated
 * `toolUseResult` payloads across an array of resumed transcript entries when
 * `toolResultCopiesOnDisk === 'slim'` (or forced via `force: true`).
 */
export function slimEntriesForResumeHydration<T extends TranscriptMessage>(
  entries: readonly T[],
  opts?: { force?: boolean },
): T[] {
  if (
    !opts?.force &&
    getHostSessionStorageState().toolResultCopiesOnDiskState !== 'slim'
  ) {
    return entries as T[]
  }
  const window = new ToolUseNameWindow()
  return entries.map(entry => slimToolUseResultForResume(entry, window))
}

export function extractFirstPrompt(transcript: TranscriptMessage[]): string {
  const textContent = getFirstMeaningfulUserMessageTextContent(transcript)
  if (textContent) {
    let result = textContent.replace(/\n/g, ' ').trim()

    // Store a reasonably long version for display-time truncation
    // The actual truncation will be applied at display time based on terminal width
    if (result.length > 200) {
      result = result.slice(0, 200).trim() + '…'
    }

    return result
  }

  return 'No prompt'
}

/**
 * Gets the last user message that was processed (i.e., before any non-user message appears).
 * Used to determine if a session has valid user interaction.
 */
export function getFirstMeaningfulUserMessageTextContent<T extends Message>(
  transcript: T[],
): string | undefined {
  for (const msg of transcript) {
    if (msg.type !== 'user' || msg.isMeta) continue
    // Skip compact summary messages - they should not be treated as the first prompt
    if ('isCompactSummary' in msg && msg.isCompactSummary) continue

    const content = msg.message?.content
    if (!content) continue

    // Collect all text values. For array content (common in VS Code where
    // IDE metadata tags come before the user's actual prompt), iterate all
    // text blocks so we don't miss the real prompt hidden behind
    // <ide_selection>/<ide_opened_file> blocks.
    const texts: string[] = []
    if (typeof content === 'string') {
      texts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          texts.push(block.text)
        }
      }
    }

    for (const textContent of texts) {
      if (!textContent) continue

      const commandNameTag = extractTag(textContent, COMMAND_NAME_TAG)
      if (commandNameTag) {
        const commandName = commandNameTag.replace(/^\//, '')

        // If it's a built-in command, then it's unlikely to provide
        // meaningful context (e.g. `/model sonnet`)
        if (builtInCommandNames().has(commandName)) {
          continue
        } else {
          // Otherwise, for custom commands, then keep it only if it has
          // arguments (e.g. `/review reticulate splines`)
          const commandArgs = extractTag(textContent, 'command-args')?.trim()
          if (!commandArgs) {
            continue
          }
          // Return clean formatted command instead of raw XML
          return `${commandNameTag} ${commandArgs}`
        }
      }

      // Format bash input with ! prefix (as user typed it). Checked before
      // the generic XML skip so bash-mode sessions get a meaningful title.
      const bashInput = extractTag(textContent, 'bash-input')
      if (bashInput) {
        return `! ${bashInput}`
      }

      // Skip non-meaningful messages (local command output, hook output,
      // autonomous tick prompts, task notifications, pure IDE metadata tags)
      if (SKIP_FIRST_PROMPT_PATTERN.test(textContent)) {
        continue
      }

      return textContent
    }
  }
  return undefined
}

export function removeExtraFields(
  transcript: TranscriptMessage[],
): SerializedMessage[] {
  return transcript.map(m => {
    const { isSidechain, parentUuid, ...serializedMessage } = m
    return serializedMessage
  })
}

/**
 * Official 2.1.328 (`oln`, `chunk@294254613.js @6056810`): null out oversized
 * `originalFile` strings on `toolUseResult` before persisting to JSONL.
 */
export function capOriginalFileForStorage<T>(toolUseResult: T): T {
  if (typeof toolUseResult !== 'object' || toolUseResult === null) {
    return toolUseResult
  }
  const rec = toolUseResult as Record<string, unknown>
  if (
    typeof rec.originalFile === 'string' &&
    rec.originalFile.length > MAX_ORIGINAL_FILE_STORAGE_CHARS
  ) {
    return { ...rec, originalFile: null } as unknown as T
  }
  return toolUseResult
}

function findStripToolByName(
  tools: readonly StripForStorageTool[],
  name: string,
): StripForStorageTool | undefined {
  return tools.find(
    tool => tool.name === name || Boolean(tool.aliases?.includes(name)),
  )
}

function getFallbackStripTools(): readonly StripForStorageTool[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FileWriteTool } =
      require('@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js') as {
        FileWriteTool?: StripForStorageTool
      }
    return FileWriteTool ? [FileWriteTool] : []
  } catch (err) {
    logError(err)
    return []
  }
}

/**
 * Official 2.1.328 (`Y1o` + `Bne`, `chunk@294254613.js @217740-218100`):
 * trim old `agent_progress` / `skill_progress` user `tool_result` bodies,
 * `toolUseResult`, and `mcpMeta` to bound memory/storage for aged progress rows.
 */
function stripProgressMessageForStorage(message: Message): Message {
  try {
    if (message.type !== 'progress') return message
    const data = message.data as
      | {
          type?: string
          message?: {
            type?: string
            message?: { role?: string; content?: unknown }
            toolUseResult?: unknown
            mcpMeta?: unknown
            [key: string]: unknown
          }
          [key: string]: unknown
        }
      | undefined
    if (
      !data ||
      (data.type !== 'agent_progress' && data.type !== 'skill_progress')
    ) {
      return message
    }
    const inner = data.message
    if (!inner || inner.type !== 'user') return message
    const content = inner.message?.content
    const firstBlock = Array.isArray(content) ? content[0] : undefined
    const toolResultBlock =
      firstBlock &&
      typeof firstBlock === 'object' &&
      (firstBlock as { type?: unknown }).type === 'tool_result'
        ? (firstBlock as Record<string, unknown>)
        : undefined
    const hasToolResultContent =
      toolResultBlock !== undefined &&
      toolResultBlock.content !== '' &&
      toolResultBlock.content !== undefined
    if (!hasToolResultContent && inner.mcpMeta === undefined) {
      return message
    }
    return {
      ...message,
      data: {
        ...data,
        message: {
          ...inner,
          ...(toolResultBlock !== undefined
            ? {
                message: {
                  role: 'user',
                  content: [{ ...toolResultBlock, content: '' }],
                },
                toolUseResult: undefined,
              }
            : {}),
          mcpMeta: undefined,
        },
      },
    } as Message
  } catch (err) {
    logError(err)
    return message
  }
}

/**
 * Official 2.1.328 (`Dqi`, `chunk@294254613.js @6058150-6058450`):
 * invoke `tool.stripForStorage` on completed calls inside old `poll_events`
 * `replEvals` attachments.
 */
function stripReplEvalsForStorage(
  replEvals: readonly unknown[],
  tools: readonly StripForStorageTool[],
  verbose: boolean,
): readonly unknown[] {
  let changed = false
  const nextEvals = replEvals.map(evalItem => {
    if (typeof evalItem !== 'object' || evalItem === null) return evalItem
    const rec = evalItem as { calls?: unknown[]; [key: string]: unknown }
    if (!Array.isArray(rec.calls)) return evalItem
    let evalChanged = false
    const nextCalls = rec.calls.map(callItem => {
      if (typeof callItem !== 'object' || callItem === null) return callItem
      const call = callItem as {
        kind?: unknown
        toolName?: unknown
        result?: unknown
        [key: string]: unknown
      }
      if (call.kind !== 'ok' || typeof call.toolName !== 'string') {
        return callItem
      }
      const tool = findStripToolByName(tools, call.toolName)
      if (!tool?.stripForStorage) return callItem
      let stripped: unknown
      try {
        stripped = tool.stripForStorage(call.result, verbose)
      } catch (err) {
        logError(err)
        return callItem
      }
      if (stripped === call.result) return callItem
      evalChanged = true
      return { ...call, result: stripped }
    })
    if (!evalChanged) return evalItem
    changed = true
    return { ...rec, calls: nextCalls }
  })
  return changed ? nextEvals : replEvals
}

/**
 * Official 2.1.328 (`f4r`, `chunk@294254613.js @6056943-6058350`):
 * strip heavy `toolUseResult` payloads (via `tool.stripForStorage`), aged
 * `progress` tool_result bodies (`Y1o`), and aged `poll_events.replEvals`
 * call results (`Dqi`) for messages older than `keepRecent`.
 * Returns the original array reference when no message changed.
 */
export function stripOldToolUseResultsForStorage(
  messages: Message[],
  tools: readonly StripForStorageTool[],
  keepRecent = 200,
  verbose = false,
): Message[] {
  const cutoff = messages.length - keepRecent
  if (cutoff <= 0) return messages

  let fallbackTools: readonly StripForStorageTool[] | undefined
  const toolByUseId = new Map<string, StripForStorageTool>()
  let result: Message[] | undefined

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          const tool =
            findStripToolByName(tools, block.name) ??
            findStripToolByName(
              (fallbackTools ??= getFallbackStripTools()),
              block.name,
            )
          if (tool?.stripForStorage) {
            toolByUseId.set(block.id, tool)
          }
        }
      }
      continue
    }

    if (i < cutoff && msg.type === 'progress') {
      const stripped = stripProgressMessageForStorage(msg)
      if (stripped !== msg) {
        if (!result) result = messages.slice()
        result[i] = stripped
      }
      continue
    }

    if (i < cutoff && msg.type === 'attachment') {
      const att = msg.attachment as
        | { type?: string; replEvals?: unknown[]; [key: string]: unknown }
        | undefined
      if (att?.type === 'poll_events' && Array.isArray(att.replEvals)) {
        const allTools = [
          ...tools,
          ...(fallbackTools ??= getFallbackStripTools()),
        ]
        const strippedEvals = stripReplEvalsForStorage(
          att.replEvals,
          allTools,
          verbose,
        )
        if (strippedEvals !== att.replEvals) {
          if (!result) result = messages.slice()
          result[i] = {
            ...msg,
            attachment: { ...att, replEvals: strippedEvals },
          } as unknown as Message
        }
      }
      continue
    }

    if (
      i >= cutoff ||
      msg.type !== 'user' ||
      msg.toolUseResult == null ||
      !Array.isArray(msg.message?.content)
    ) {
      continue
    }

    const toolResultBlock = msg.message.content.find(
      b => b.type === 'tool_result',
    )
    const tool =
      toolResultBlock && 'tool_use_id' in toolResultBlock
        ? toolByUseId.get(toolResultBlock.tool_use_id)
        : undefined
    if (!tool?.stripForStorage) continue

    let updated: Message = msg
    try {
      const stripped = tool.stripForStorage(msg.toolUseResult, verbose)
      if (stripped !== msg.toolUseResult) {
        updated = { ...msg, toolUseResult: stripped }
      }
    } catch (err) {
      logError(err)
      updated = msg
    }
    if (updated === msg) continue
    if (!result) result = messages.slice()
    result[i] = updated
  }

  return result ?? messages
}

/**
 * Official 2.1.328 (`nxe`, `chunk@294254613.js @2384797, @2424446`):
 * drop attachment messages with missing/malformed payloads on transcript load.
 * Lazy-required to avoid an ESM init cycle with `conversationRecovery.ts`.
 */
export function dropMalformedAttachmentsOnLoad<T extends Message>(
  messages: T[],
): T[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dropMalformedAttachments } =
      require('../conversationRecovery.js') as typeof import('../conversationRecovery.js')
    return dropMalformedAttachments(messages) as T[]
  } catch (err) {
    logError(err)
    return messages
  }
}

function resolvePreservedFromCompactMeta(
  meta: PreservedCompactMeta,
  messages: Map<UUID, TranscriptMessage>,
): { preserved: PreservedMessagesRef; source: 'list' | 'walk' } | undefined {
  if (meta.preservedMessages) {
    return { preserved: meta.preservedMessages, source: 'list' }
  }
  const seg = meta.preservedSegment
  if (!seg) return undefined
  const seen = new Set<UUID>()
  const uuids: UUID[] = []
  let cur = messages.get(seg.tailUuid)
  while (cur && !seen.has(cur.uuid)) {
    seen.add(cur.uuid)
    uuids.push(cur.uuid)
    if (cur.uuid === seg.headUuid) {
      uuids.reverse()
      return {
        preserved: { anchorUuid: seg.anchorUuid, uuids },
        source: 'walk',
      }
    }
    cur = cur.parentUuid ? messages.get(cur.parentUuid) : undefined
  }
  logEvent('tengu_relink_walk_broken', {
    tailInTranscript: messages.has(seg.tailUuid),
    headInTranscript: messages.has(seg.headUuid),
    anchorInTranscript: messages.has(seg.anchorUuid),
    walkSteps: seen.size,
    transcriptSize: messages.size,
  })
  return undefined
}

export function applyPreservedSegmentRelinks(
  messages: Map<UUID, TranscriptMessage>,
): void {
  // Find the absolute-last boundary and the last seg/messages-boundary
  // (can differ: manual /compact after reactive compact → seg is stale).
  let lastMeta: PreservedCompactMeta | undefined
  let lastPreservedBoundaryIdx = -1
  let absoluteLastBoundaryIdx = -1
  const entryIndex = new Map<UUID, number>()
  let i = 0
  for (const entry of messages.values()) {
    entryIndex.set(entry.uuid, i)
    if (isCompactBoundaryMessage(entry)) {
      absoluteLastBoundaryIdx = i
      const meta = entry.compactMetadata as PreservedCompactMeta | undefined
      if (meta?.preservedMessages || meta?.preservedSegment) {
        lastMeta = meta
        lastPreservedBoundaryIdx = i
      }
    }
    i++
  }
  // No preserved metadata anywhere → no-op.
  if (!lastMeta) return

  // Stale (non-preserved boundary came after): skip relink, still prune at
  // absolute — otherwise the stale preserved chain becomes a phantom leaf.
  const segIsLive = lastPreservedBoundaryIdx === absoluteLastBoundaryIdx
  const resolved = segIsLive
    ? resolvePreservedFromCompactMeta(lastMeta, messages)
    : undefined
  if (segIsLive && !resolved) return

  const preserved =
    resolved && resolved.preserved.uuids.length > 0
      ? resolved.preserved
      : undefined
  if (preserved?.uuids.some(id => !messages.has(id))) {
    logEvent('tengu_relink_walk_broken', {
      anchorInTranscript: messages.has(preserved.anchorUuid),
      walkSteps: preserved.uuids.filter(id => messages.has(id)).length,
      transcriptSize: messages.size,
    })
    return
  }

  const uuids = preserved?.uuids ?? []
  const preservedUuids = new Set<UUID>(uuids)

  if (preserved) {
    let prevParent: UUID = preserved.anchorUuid
    for (const id of uuids) {
      const msg = messages.get(id)
      if (msg) {
        messages.set(id, { ...msg, parentUuid: prevParent })
      }
      prevParent = id
    }
    const tailUuid = uuids.at(-1)!
    // Tail-splice: anchor's other children → tail. No-op if already pointing
    // at tail (the useLogMessages race case).
    for (const [uuid, msg] of messages) {
      if (msg.parentUuid === preserved.anchorUuid && uuid !== uuids[0]) {
        messages.set(uuid, { ...msg, parentUuid: tailUuid })
      }
    }
    // Zero stale usage: on-disk input_tokens reflect pre-compact context
    // (~190K) — stripStaleUsage only patched in-memory copies that were
    // dedup-skipped. Without this, resume → immediate autocompact spiral.
    for (const uuid of preservedUuids) {
      const msg = messages.get(uuid)
      if (msg?.type !== 'assistant') continue
      messages.set(uuid, {
        ...msg,
        message: {
          ...msg.message!,
          usage: {
            ...msg.message!.usage,
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      })
    }
  }

  // Prune everything physically before the absolute-last boundary that
  // isn't preserved. preservedUuids empty when !segIsLive → full prune.
  const toDelete: UUID[] = []
  for (const [uuid] of messages) {
    const idx = entryIndex.get(uuid)
    if (
      idx !== undefined &&
      idx < absoluteLastBoundaryIdx &&
      !preservedUuids.has(uuid)
    ) {
      toDelete.push(uuid)
    }
  }
  for (const uuid of toDelete) messages.delete(uuid)

  // #794 SEA 325 x9o: if any post-boundary user/assistant message still has
  // parentUuid pointing to a pruned pre-boundary message (e.g. retried or
  // unfinished reply in the same turn), relink it to the preserved tail.
  if (preserved && toDelete.length > 0) {
    const tailUuid = uuids.at(-1)!
    const deletedSet = new Set(toDelete)
    for (const [uuid, msg] of messages) {
      if (
        (msg.type === 'user' || msg.type === 'assistant') &&
        msg.parentUuid !== null &&
        msg.parentUuid !== undefined &&
        deletedSet.has(msg.parentUuid)
      ) {
        messages.set(uuid, { ...msg, parentUuid: tailUuid })
      }
    }
  }
}

/**
 * Delete messages that Snip executions removed from the in-memory array,
 * and relink parentUuid across the gaps.
 *
 * Unlike compact_boundary which truncates a prefix, snip removes
 * middle ranges. The JSONL is append-only, so removed messages stay on disk
 * and the surviving messages' parentUuid chains walk through them. Without
 * this filter, buildConversationChain reconstructs the full unsnipped history
 * and resume immediately PTLs (adamr-20260320-165831: 397K displayed → 1.65M
 * actual).
 *
 * Deleting alone is not enough: the surviving message AFTER a removed range
 * has parentUuid pointing INTO the gap. buildConversationChain would hit
 * messages.get(undefined) and stop, orphaning everything before the gap. So
 * after delete we relink: for each survivor with a dangling parentUuid, walk
 * backward through the removed region's own parent links to the first
 * non-removed ancestor.
 *
 * The boundary records removedUuids at execution time so we can replay the
 * exact removal on load. Older boundaries without removedUuids are skipped —
 * resume loads their pre-snip history (the pre-fix behavior).
 *
 * Mutates the Map in place.
 */
export function applySnipRemovals(
  messages: Map<UUID, TranscriptMessage>,
): void {
  // Structural check — snipMetadata only exists on the boundary subtype.
  // Avoids the subtype literal which is in excluded-strings.txt
  // (HISTORY_SNIP is ant-only; the literal must not leak into external builds).
  type WithSnipMeta = { snipMetadata?: { removedUuids?: UUID[] } }
  const toDelete = new Set<UUID>()
  for (const entry of messages.values()) {
    const removedUuids = (entry as WithSnipMeta).snipMetadata?.removedUuids
    if (!removedUuids) continue
    for (const uuid of removedUuids) toDelete.add(uuid)
  }
  if (toDelete.size === 0) return

  // Capture each to-delete entry's own parentUuid BEFORE deleting so we can
  // walk backward through contiguous removed ranges. Entries not in the Map
  // (already absent, e.g. from a prior compact_boundary prune) contribute no
  // link; the relink walk will stop at the gap and pick up null (chain-root
  // behavior — same as if compact truncated there, which it did).
  const deletedParent = new Map<UUID, UUID | null>()
  let removedCount = 0
  for (const uuid of toDelete) {
    const entry = messages.get(uuid)
    if (!entry) continue
    deletedParent.set(uuid, entry.parentUuid)
    messages.delete(uuid)
    removedCount++
  }

  // Relink survivors with dangling parentUuid. Walk backward through
  // deletedParent until we hit a UUID not in toDelete (or null). Path
  // compression: after resolving, seed the map with the resolved link so
  // subsequent survivors sharing the same chain segment don't re-walk.
  const resolve = (start: UUID): UUID | null => {
    const path: UUID[] = []
    let cur: UUID | null | undefined = start
    while (cur && toDelete.has(cur)) {
      path.push(cur)
      cur = deletedParent.get(cur)
      if (cur === undefined) {
        cur = null
        break
      }
    }
    for (const p of path) deletedParent.set(p, cur)
    return cur
  }
  let relinkedCount = 0
  for (const [uuid, msg] of messages) {
    if (!msg.parentUuid || !toDelete.has(msg.parentUuid)) continue
    messages.set(uuid, { ...msg, parentUuid: resolve(msg.parentUuid) })
    relinkedCount++
  }

  logEvent('tengu_snip_resume_filtered', {
    removed_count: removedCount,
    relinked_count: relinkedCount,
  })
}

/**
 * O(n) single-pass: find the message with the latest timestamp matching a predicate.
 * Replaces the `[...values].filter(pred).sort((a,b) => Date(b)-Date(a))[0]` pattern
 * which is O(n log n) + 2n Date allocations.
 */
export function findLatestMessage<T extends { timestamp: string }>(
  messages: Iterable<T>,
  predicate: (m: T) => boolean,
): T | undefined {
  let latest: T | undefined
  let maxTime = -Infinity
  for (const m of messages) {
    if (!predicate(m)) continue
    const t = Date.parse(m.timestamp)
    if (t > maxTime) {
      maxTime = t
      latest = m
    }
  }
  return latest
}

/**
 * Official 2.1.328 (#370) `Grn(e)`: returns true when earlier messages of a
 * resumed transcript could not be loaded (either the read ended truncated or
 * the earliest loaded non-compact-boundary message references a missing
 * `parentUuid` absent from the loaded message map).
 */
export function hasMissingEarlierMessages(
  transcript: readonly TranscriptMessage[],
  messages: ReadonlyMap<UUID, TranscriptMessage>,
  readTruncated?: boolean,
): boolean {
  if (readTruncated) return true
  const first = transcript[0]
  if (!first) return false
  if (isCompactBoundaryTranscriptMessage(first)) return false
  return Boolean(first.parentUuid && !messages.has(first.parentUuid))
}

/**
 * Official 2.1.328 (#370) `tqs(e)`: build the non-persisted warning system
 * message (`persist: false`) for a truncated/damaged transcript load.
 */
export function createMissingEarlierMessagesWarning(): {
  type: 'system'
  subtype: 'informational'
  content: string
  level: 'warning'
  uuid: UUID
  timestamp: string
  persist: false
} {
  return {
    type: 'system',
    subtype: 'informational',
    content: MISSING_EARLIER_MESSAGES_WARNING,
    level: 'warning',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    persist: false,
  }
}

/**
 * Official 2.1.328 `Fsn`: true when a JSONL transcript line is a `last-prompt`
 * row carrying a `leafUuid` resume/rewind checkpoint.
 */
function isLeafCheckpointLine(line: string): boolean {
  if (!line.includes('"type":"last-prompt"') || !line.includes('"leafUuid":')) {
    return false
  }
  try {
    const parsed = jsonParse(line) as { type?: unknown; leafUuid?: unknown }
    return parsed.type === 'last-prompt' && parsed.leafUuid !== undefined
  } catch {
    return false
  }
}

export async function hasLeafCheckpointInTranscriptFile(
  filePath: string,
): Promise<boolean> {
  if (isDisklessActive()) return false
  try {
    const raw = await readFile(filePath, 'utf8')
    return raw.split('\n').some(isLeafCheckpointLine)
  } catch {
    return false
  }
}

/**
 * Official 2.1.328 (#391) `vrn`: re-link any message whose `parentUuid` points
 * at a dropped/empty/invalid row (`droppedParents`) to its nearest surviving
 * ancestor via path-compressed walks so empty replies or killed commands do
 * not sever the resumed conversation chain.
 */
export function relinkDroppedTranscriptRows(
  messages: Map<UUID, TranscriptMessage>,
  droppedParents: ReadonlyMap<UUID, UUID | null>,
): number {
  if (droppedParents.size === 0) return 0
  const resolvedCache = new Map<UUID, UUID | null>()
  const resolveSurvivingParent = (start: UUID): UUID | null => {
    const visited: UUID[] = []
    const seen = new Set<UUID>()
    let cur: UUID | null | undefined = start
    while (
      cur &&
      !messages.has(cur) &&
      droppedParents.has(cur) &&
      !seen.has(cur)
    ) {
      if (resolvedCache.has(cur)) {
        cur = resolvedCache.get(cur) ?? null
        break
      }
      seen.add(cur)
      visited.push(cur)
      cur = droppedParents.get(cur) ?? null
    }
    const target = cur && !seen.has(cur) ? cur : null
    for (const v of visited) {
      resolvedCache.set(v, target)
    }
    return target
  }

  let relinked = 0
  for (const [uuid, msg] of messages) {
    if (
      msg.parentUuid &&
      !messages.has(msg.parentUuid) &&
      droppedParents.has(msg.parentUuid)
    ) {
      const nextParent = resolveSurvivingParent(msg.parentUuid)
      if (nextParent !== msg.parentUuid) {
        messages.set(uuid, { ...msg, parentUuid: nextParent })
        relinked++
      }
    }
  }
  return relinked
}

/**
 * Official 2.1.328 `Crn` (#391): validate/repair `user`/`assistant` message
 * content during transcript load — drops null/non-object messages, drops empty
 * string assistant content, wraps non-empty string assistant content into a
 * single `{ type: 'text', text }` block, and filters malformed blocks from
 * content arrays (dropping the row if zero valid blocks remain).
 */
export function repairTranscriptMessageContent(
  role: 'user' | 'assistant',
  message: unknown,
):
  | 'keep'
  | 'drop'
  | {
      content: unknown[]
      droppedBlocks: number
      wrapped: boolean
    } {
  if (!message || typeof message !== 'object') return 'drop'
  const rec = message as { content?: unknown }
  const content = rec.content
  if (typeof content === 'string') {
    if (role !== 'assistant') return 'keep'
    if (content.trim() === '') return 'drop'
    return {
      content: [{ type: 'text', text: content }],
      droppedBlocks: 0,
      wrapped: true,
    }
  }
  if (!Array.isArray(content)) return 'drop'
  const isValidBlock = (block: unknown): boolean =>
    block !== null &&
    typeof block === 'object' &&
    typeof (block as { type?: unknown }).type === 'string'
  if (content.every(isValidBlock)) return 'keep'
  const valid = content.filter(isValidBlock)
  if (valid.length === 0) return 'drop'
  return {
    content: valid,
    droppedBlocks: content.length - valid.length,
    wrapped: false,
  }
}

/**
 * Official 2.1.328 (#390/#391/#392/#586) `KAe` (`CheckpointReachTracker`):
 * tracks explicit rewind vs non-rewound `/clear` checkpoints and verifies
 * whether a newly written post-checkpoint row actually extends past a rewind
 * (or whether an explicit `/clear` cleared the conversation).
 */
export class CheckpointReachTracker {
  cleared = false
  rewoundClear = false
  checkpointLeafUuid: UUID | undefined
  checkpointExplicit = false
  lastPromptWasRewound = false
  rewindCutUuid: UUID | undefined
  postRewindRows: Map<UUID, UUID | null> | undefined

  onMessage(entry: TranscriptMessage, isNewMessage: boolean): void {
    if (entry.isSidechain) return
    if (isNewMessage) {
      this.postRewindRows?.set(entry.uuid, entry.parentUuid ?? null)
    }
    this.checkpointExplicit = false
    this.cleared = false
    this.rewoundClear = false
    this.lastPromptWasRewound = false
  }

  onCompactBoundary(): void {
    this.checkpointLeafUuid = undefined
    this.checkpointExplicit = false
    this.lastPromptWasRewound = false
    this.rewindCutUuid = undefined
    this.postRewindRows = undefined
  }

  onLastPrompt(lp: {
    leafUuid?: UUID | null
    explicit?: boolean
    rewound?: boolean
    cutUuid?: UUID
  }): void {
    if (lp.leafUuid) {
      const isRewound = lp.rewound === true
      this.rewindCutUuid = isRewound
        ? lp.cutUuid
        : this.lastPromptWasRewound && lp.leafUuid === this.checkpointLeafUuid
          ? this.rewindCutUuid
          : undefined
      this.checkpointExplicit =
        lp.explicit === true ||
        (this.checkpointExplicit && lp.leafUuid === this.checkpointLeafUuid)
      this.lastPromptWasRewound =
        isRewound ||
        (this.lastPromptWasRewound && lp.leafUuid === this.checkpointLeafUuid)
      this.postRewindRows = isRewound ? new Map() : undefined
      this.checkpointLeafUuid = lp.leafUuid
      this.cleared = false
      this.rewoundClear = false
    } else if (lp.leafUuid === null && lp.explicit === true) {
      // Official 2.1.328 (#586): explicit non-rewound `/clear` clears rewind
      // tracking state completely so the cleared session never revives rewound turns.
      this.cleared = true
      this.rewoundClear = lp.rewound === true
      this.rewindCutUuid = lp.rewound === true ? lp.cutUuid : undefined
      this.checkpointLeafUuid = undefined
      this.checkpointExplicit = false
      this.lastPromptWasRewound = false
      if (!this.rewoundClear) {
        this.postRewindRows = undefined
      }
    }
  }
}

/**
 * Official 2.1.328 (#562) `Knn`: splice rows that were persisted ahead of a
 * late-saved put-back `tool_result` directly under `hangUnderUuid` so recent
 * messages or compaction summaries are not orphaned on cloud session resume.
 */
export function spliceRowsAheadOfPutBack(
  messages: Map<UUID, TranscriptMessage>,
  aheadRowUuids: readonly UUID[],
  hangUnderUuid: UUID,
): number {
  if (aheadRowUuids.length === 0 || !messages.has(hangUnderUuid)) return 0
  let parentUuid: UUID = hangUnderUuid
  let spliced = 0
  for (const rowUuid of aheadRowUuids) {
    const row = messages.get(rowUuid)
    if (!row || row.uuid === hangUnderUuid) continue
    if (row.parentUuid !== parentUuid) {
      messages.set(rowUuid, { ...row, parentUuid })
      spliced++
    }
    parentUuid = rowUuid
  }
  return spliced
}

function hasContentBlockOfType(content: unknown, blockType: string): boolean {
  if (!Array.isArray(content)) return false
  return content.some(
    b =>
      b !== null &&
      typeof b === 'object' &&
      (b as { type?: unknown }).type === blockType,
  )
}

/** Official 2.1.328 `_L`: auxiliary transcript row eligible for put-back splicing. */
function isPutBackAuxiliaryRow(row: TranscriptMessage): boolean {
  if (row.type === 'attachment') return true
  if (row.type === 'system') {
    return (row as { subtype?: string }).subtype !== 'compact_boundary'
  }
  return (
    row.type === 'user' &&
    row.isMeta === true &&
    !hasContentBlockOfType(row.message?.content, 'tool_result')
  )
}

/** Official 2.1.328 `tgr`: true when a slice still has an unmatched `tool_use`. */
function hasUnmatchedToolUseInSlice(
  slice: readonly TranscriptMessage[],
): boolean {
  const open = new Set<string>()
  for (const row of slice) {
    const content =
      row.type === 'assistant' || row.type === 'user'
        ? row.message?.content
        : undefined
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as { type?: unknown; id?: unknown; tool_use_id?: unknown }
      if (b.type === 'tool_use' && typeof b.id === 'string') {
        open.add(b.id)
      } else if (
        b.type === 'tool_result' &&
        typeof b.tool_use_id === 'string'
      ) {
        open.delete(b.tool_use_id)
      }
    }
  }
  return open.size > 0
}

/** Official 2.1.328 `ngr`: validate `rowsAheadOfPutBack` for a put-back `tool_result` row. */
function validateRowsAheadOfPutBack(
  row: TranscriptMessage,
  messages: ReadonlyMap<UUID, TranscriptMessage>,
  seen: ReadonlySet<UUID>,
): string | { rows: TranscriptMessage[]; hangUnder: UUID | null } {
  const raw = (row as unknown as { rowsAheadOfPutBack?: unknown })
    .rowsAheadOfPutBack
  if (
    !Array.isArray(raw) ||
    raw.length > PUT_BACK_MAX_ROWS ||
    row.type !== 'user' ||
    !hasContentBlockOfType(row.message?.content, 'tool_result')
  ) {
    return 'malformed'
  }
  const rows: TranscriptMessage[] = []
  let hangUnder: UUID | null = null
  for (const id of new Set(raw)) {
    const cand = typeof id === 'string' ? messages.get(id as UUID) : undefined
    if (cand === undefined) return 'row_not_loaded'
    if (seen.has(cand.uuid)) continue
    const attType =
      cand.type === 'attachment'
        ? (cand as { attachment?: { type?: string } }).attachment?.type
        : undefined
    const candRec = cand as unknown as {
      taskDelivery?: unknown
      queueTranscriptOnly?: unknown
    }
    if (
      cand.isSidechain !== row.isSidechain ||
      (cand.type === 'attachment' &&
        DISALLOWED_PUT_BACK_ATTACHMENT_TYPES.has(attType)) ||
      (cand.type === 'user' && candRec.taskDelivery !== undefined) ||
      !(
        isPutBackAuxiliaryRow(cand) ||
        (cand.type === 'user' &&
          candRec.queueTranscriptOnly === true &&
          !hasContentBlockOfType(cand.message?.content, 'tool_result'))
      )
    ) {
      return 'row_kind'
    }
    let parent: UUID | null = cand.parentUuid
    for (let hops = 0; parent === null || !seen.has(parent); hops++) {
      const parentRow = parent === null ? undefined : messages.get(parent)
      if (parentRow === undefined || hops > PUT_BACK_MAX_ROWS) {
        return 'row_hangs_elsewhere'
      }
      parent = parentRow.parentUuid
    }
    if (rows.length > 0 && parent !== hangUnder) {
      return 'row_hangs_elsewhere'
    }
    hangUnder = parent
    rows.push(cand)
  }
  return { rows, hangUnder }
}

/**
 * Official 2.1.328 `Knn` (#562): splice validated `rowsAheadOfPutBack` auxiliary
 * rows into the reconstructed chain array without mutating `messages`.
 */
export function splicePutBackAheadRows(
  messages: ReadonlyMap<UUID, TranscriptMessage>,
  chain: TranscriptMessage[],
  seen: Set<UUID>,
): { chain: TranscriptMessage[]; left: string[] } {
  let result = chain
  const left: string[] = []
  for (const row of chain) {
    if (
      row.type !== 'user' ||
      (row as unknown as { rowsAheadOfPutBack?: unknown })
        .rowsAheadOfPutBack === undefined
    ) {
      continue
    }
    const validated = validateRowsAheadOfPutBack(row, messages, seen)
    if (typeof validated === 'string') {
      left.push(validated)
      continue
    }
    if (validated.rows.length === 0) continue
    const parentRow = row.parentUuid ? messages.get(row.parentUuid) : undefined
    const assistantMsgId =
      parentRow?.type === 'assistant'
        ? (parentRow.message as { id?: string } | undefined)?.id
        : undefined
    const firstReplyIdx = assistantMsgId
      ? result.findIndex(
          w =>
            w.type === 'assistant' &&
            (w.message as { id?: string } | undefined)?.id === assistantMsgId,
        )
      : -1
    const hangIdx = result.findIndex(w => w.uuid === validated.hangUnder)
    const putBackIdx = result.indexOf(row)
    if (
      firstReplyIdx === -1 ||
      hangIdx === -1 ||
      hangIdx >= putBackIdx ||
      (hangIdx < firstReplyIdx &&
        validated.hangUnder !== result[firstReplyIdx]?.parentUuid) ||
      (result[hangIdx]?.type === 'assistant' &&
        hasUnmatchedToolUseInSlice(result.slice(firstReplyIdx, hangIdx + 1)) &&
        result.slice(hangIdx + 1, putBackIdx).some(w => w.type === 'assistant'))
    ) {
      left.push(
        firstReplyIdx === -1 ? 'reply_not_on_chain' : 'row_hangs_elsewhere',
      )
      continue
    }
    for (const spliced of validated.rows) {
      seen.add(spliced.uuid)
    }
    result = [
      ...result.slice(0, hangIdx + 1),
      ...validated.rows,
      ...result.slice(hangIdx + 1),
    ]
  }
  return { chain: result, left }
}

export class ToolUseNameWindow {
  private readonly map = new Map<string, string>()

  recordAssistantMessage(entry: TranscriptMessage): void {
    if (entry.type !== 'assistant') return
    const content = entry.message?.content
    if (!Array.isArray(content)) return
    for (const block of content as unknown as Array<Record<string, unknown>>) {
      if (
        block &&
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        this.map.set(block.id, block.name)
        if (this.map.size > SLIM_TOOL_USE_WINDOW_MAX) {
          const oldest = this.map.keys().next().value
          if (oldest !== undefined) this.map.delete(oldest)
        }
      }
    }
  }

  getToolName(toolUseId: string): string | undefined {
    return this.map.get(toolUseId)
  }
}

/**
 * Official 2.1.328 (#646): slim duplicated payloads in `entry.toolUseResult`
 * when resuming a session (especially sessions with many Read images/PDFs).
 */
export function slimToolUseResultForResume<T extends TranscriptMessage>(
  entry: T,
  window: ToolUseNameWindowLike,
): T {
  window.recordAssistantMessage(entry)
  if (entry.type !== 'user') return entry
  const rec = entry as unknown as {
    toolUseResult?: Record<string, unknown>
    message?: { content?: unknown }
  }
  if (!rec.toolUseResult || typeof rec.toolUseResult !== 'object') {
    return entry
  }
  const content = rec.message?.content
  let toolName: string | undefined
  if (Array.isArray(content)) {
    for (const block of content as Array<Record<string, unknown>>) {
      if (
        block &&
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string'
      ) {
        toolName = window.getToolName(block.tool_use_id)
        if (toolName) break
      }
    }
  }
  const res = rec.toolUseResult
  let slimmed: Record<string, unknown> | undefined
  if (
    toolName === 'Read' ||
    toolName === 'FileReadTool' ||
    (toolName === undefined &&
      (res.type === 'image' || res.type === 'pdf') &&
      typeof res.file === 'object' &&
      res.file !== null)
  ) {
    const file = res.file as Record<string, unknown> | undefined
    if (file && typeof file === 'object') {
      if (
        (res.type === 'image' || res.type === 'pdf') &&
        typeof file.base64 === 'string' &&
        file.base64.length > 0
      ) {
        slimmed = { ...res, file: { ...file, base64: '' } }
      } else if (
        res.type === 'text' &&
        typeof file.content === 'string' &&
        file.content.length > 0
      ) {
        slimmed = { ...res, file: { ...file, content: '' } }
      }
    }
  } else if (toolName === 'Bash') {
    if (
      (typeof res.stdout === 'string' && res.stdout.length > 0) ||
      (typeof res.stderr === 'string' && res.stderr.length > 0)
    ) {
      slimmed = { ...res, stdout: '', stderr: '' }
    }
  } else if (toolName === 'Edit') {
    if (typeof res.originalFile === 'string' && res.originalFile.length > 0) {
      slimmed = { ...res, originalFile: null }
    }
  } else if (toolName === 'Write' && res.type === 'update') {
    if (
      (typeof res.content === 'string' && res.content.length > 0) ||
      (typeof res.originalFile === 'string' && res.originalFile.length > 0)
    ) {
      slimmed = { ...res, content: '', originalFile: null }
    }
  }
  if (!slimmed) return entry
  return { ...entry, toolUseResult: slimmed }
}

/**
 * Official 2.1.328 (#645) `Jnn`: memoized parent-walk resolution for terminal
 * non-conversational entries, avoiding O(N^2) repeated walks on large sessions.
 */
export function resolveTerminalConversationalAncestors(
  terminalMessages: readonly TranscriptMessage[],
  messages: ReadonlyMap<UUID, TranscriptMessage>,
  hasUserAssistantChild?: ReadonlySet<UUID>,
): { leafUuids: Set<UUID>; hasCycle: boolean } {
  const leafUuids = new Set<UUID>()
  const memo = new Map<UUID, UUID | null>()
  let hasCycle = false

  for (const terminal of terminalMessages) {
    const visited: UUID[] = []
    const seen = new Set<UUID>()
    let current: TranscriptMessage | undefined = terminal
    let resolved: UUID | null = null

    while (current) {
      if (memo.has(current.uuid)) {
        resolved = memo.get(current.uuid) ?? null
        break
      }
      if (seen.has(current.uuid)) {
        hasCycle = true
        resolved = null
        break
      }
      seen.add(current.uuid)
      visited.push(current.uuid)
      if (current.type === 'user' || current.type === 'assistant') {
        resolved = current.uuid
        break
      }
      current = current.parentUuid
        ? messages.get(current.parentUuid)
        : undefined
    }

    for (const v of visited) {
      memo.set(v, resolved)
    }

    if (
      resolved !== null &&
      (!hasUserAssistantChild || !hasUserAssistantChild.has(resolved))
    ) {
      leafUuids.add(resolved)
    }
  }

  return { leafUuids, hasCycle }
}

function isCompactBoundaryTranscriptMessage(
  entry: TranscriptMessage | undefined,
): boolean {
  return (
    entry !== undefined &&
    entry.type === 'system' &&
    'subtype' in entry &&
    entry.subtype === 'compact_boundary'
  )
}

/**
 * Official 2.1.328 (#645) `Vnn`: O(N log N) pre-indexed preceding-leaf lookup
 * with union-find path compression (`previousCandidate`) so bridging multiple
 * broken parent links in large transcripts runs in O(1) amortized time instead
 * of rescanning all `messages` (O(N^2)).
 */
class FastParentGapIndex {
  private readonly ordered: TranscriptMessage[]
  private readonly indexByUuid = new Map<UUID, number>()
  private readonly nonSidechainChildren = new Map<UUID, number[]>()
  private readonly bridgedParents = new Set<UUID>()
  private readonly laterReferencedCandidates: number[] = []
  private readonly prevCandidate: Int32Array
  private readonly lastBoundaryBefore: Int32Array

  constructor(messages: ReadonlyMap<UUID, TranscriptMessage>) {
    this.ordered = [...messages.values()]
    const n = this.ordered.length
    this.prevCandidate = new Int32Array(n)
    this.lastBoundaryBefore = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const m = this.ordered[i]!
      this.indexByUuid.set(m.uuid, i)
      // Official 2.1.328 `i_r`: only non-sidechain rows mark a parent as
      // referenced on the main conversation chain.
      if (!m.isSidechain && m.parentUuid) {
        const list = this.nonSidechainChildren.get(m.parentUuid)
        if (list) {
          list.push(i)
        } else {
          this.nonSidechainChildren.set(m.parentUuid, [i])
        }
      }
    }
    const suffixMinTs = new Array<string>(n)
    if (n > 0) {
      let minTs = this.ordered[n - 1]!.timestamp
      suffixMinTs[n - 1] = minTs
      for (let i = n - 2; i >= 0; i--) {
        const ts = this.ordered[i]!.timestamp
        if (ts < minTs) {
          minTs = ts
        }
        suffixMinTs[i] = minTs
      }
    }
    let lastBoundary = -1
    for (let i = 0; i < n; i++) {
      const m = this.ordered[i]!
      this.lastBoundaryBefore[i] = lastBoundary
      if (isCompactBoundaryTranscriptMessage(m)) {
        lastBoundary = i
      }
      const isBaseEligible =
        !m.isSidechain && !(m.type === 'system' && !m.parentUuid)
      const children = this.nonSidechainChildren.get(m.uuid)
      const hasNonSidechainChild = children !== undefined && children.length > 0
      const eligibleLeaf = isBaseEligible && !hasNonSidechainChild
      this.prevCandidate[i] = eligibleLeaf ? i : i - 1
      // Track non-sidechain nodes whose earliest non-sidechain child is NOT
      // immediately adjacent, precedes `i`, or has a later timestamp than some
      // subsequent row (clock skew / out-of-order timestamps), so they remain
      // discoverable as leaves while preserving O(N) on monotonic transcripts.
      if (
        isBaseEligible &&
        hasNonSidechainChild &&
        (children[0]! > i + 1 ||
          children[0]! < i ||
          (i + 2 < n &&
            this.ordered[children[0]!]!.timestamp > suffixMinTs[i + 2]!))
      ) {
        this.laterReferencedCandidates.push(i)
      }
    }
  }

  private isReferencedBefore(
    uuid: UUID,
    orphanIdx: number,
    orphanTimestamp: string,
  ): boolean {
    const children = this.nonSidechainChildren.get(uuid)
    if (!children) return false
    for (const childIdx of children) {
      if (childIdx >= orphanIdx) break
      if (this.ordered[childIdx]!.timestamp <= orphanTimestamp) {
        return true
      }
    }
    return false
  }

  private findPrev(idx: number): number {
    if (idx < 0) return -1
    let cur = idx
    while (cur >= 0 && this.prevCandidate[cur] !== cur) {
      const next = this.prevCandidate[cur]!
      if (next >= 0 && this.prevCandidate[next] !== next) {
        this.prevCandidate[cur] = this.prevCandidate[next]!
      }
      cur = next
    }
    return cur
  }

  findNearestPrecedingLeaf(
    orphan: TranscriptMessage,
    seen: ReadonlySet<UUID>,
  ): TranscriptMessage | undefined {
    const orphanIdx = this.indexByUuid.get(orphan.uuid)
    if (orphanIdx === undefined || orphanIdx <= 0) return undefined
    const minBoundaryIdx = this.lastBoundaryBefore[orphanIdx]!
    let best: TranscriptMessage | undefined
    let bestIdx = -1

    const consider = (idx: number): void => {
      if (idx < minBoundaryIdx || idx >= orphanIdx) return
      const cand = this.ordered[idx]!
      if (cand.isSidechain) return
      if (cand.type === 'system' && !cand.parentUuid) return
      if (seen.has(cand.uuid) || this.bridgedParents.has(cand.uuid)) return
      if (this.isReferencedBefore(cand.uuid, orphanIdx, orphan.timestamp)) {
        return
      }
      if (cand.timestamp > orphan.timestamp) return
      // Official 2.1.328 `i_r`: prefer the highest timestamp; on equal
      // timestamps prefer the LATEST preceding leaf (larger index).
      if (
        !best ||
        cand.timestamp > best.timestamp ||
        (cand.timestamp === best.timestamp && idx > bestIdx)
      ) {
        best = cand
        bestIdx = idx
      }
    }

    for (
      let i = this.findPrev(orphanIdx - 1);
      i >= 0;
      i = this.findPrev(i - 1)
    ) {
      if (i < minBoundaryIdx) break
      const cand = this.ordered[i]!
      if (seen.has(cand.uuid) || this.bridgedParents.has(cand.uuid)) {
        this.prevCandidate[i] = i - 1
        continue
      }
      consider(i)
    }

    // Also check immediately preceding node (in case its only child is at
    // orphanIdx) and any node whose earliest non-sidechain child lies past i+1.
    consider(orphanIdx - 1)
    for (const idx of this.laterReferencedCandidates) {
      if (idx >= orphanIdx) break
      consider(idx)
    }

    if (best) {
      this.bridgedParents.add(best.uuid)
      if (this.prevCandidate[bestIdx] === bestIdx) {
        this.prevCandidate[bestIdx] = bestIdx - 1
      }
      return best
    }
    if (minBoundaryIdx >= 0) {
      const boundary = this.ordered[minBoundaryIdx]!
      // Official 2.1.328 (#562): when a late-saved message after compaction
      // has a broken parentUuid and no normal leaf precedes it, anchor to
      // the compact_boundary itself rather than losing the compaction summary.
      if (
        isCompactBoundaryTranscriptMessage(boundary) &&
        !seen.has(boundary.uuid)
      ) {
        return boundary
      }
    }
    return undefined
  }
}

/**
 * Official 2.1.326 #30 + 2.1.328 #562/#645 (`s_r` / `Vnn`): repair broken
 * `parentUuid` chains when a message points at a missing parent UUID (empty
 * reply crash or late-saved message after compaction). Uses `FastParentGapIndex`
 * for O(N) performance on large transcripts and preserves compaction anchors.
 */
export function bridgeBrokenParentChain(
  messages: Map<UUID, TranscriptMessage>,
  leafUuid: UUID | undefined,
  maxBridges: number = MAX_CHAIN_GAP_BRIDGES,
): number {
  if (!leafUuid) return 0
  const seen = new Set<UUID>()
  let bridges = 0
  let index: FastParentGapIndex | undefined
  let current = messages.get(leafUuid)
  while (current?.parentUuid && !seen.has(current.uuid)) {
    if (isCompactBoundaryTranscriptMessage(current)) break
    seen.add(current.uuid)
    let parent = messages.get(current.parentUuid)
    if (!parent && bridges < maxBridges) {
      index ??= new FastParentGapIndex(messages)
      parent = index.findNearestPrecedingLeaf(current, seen)
      if (parent) {
        messages.set(current.uuid, {
          ...current,
          parentUuid: parent.uuid,
        })
        bridges++
      }
    }
    current = parent
  }
  return bridges
}

function isFileSnapshotEntry(entry: TranscriptMessage): boolean {
  return (
    entry.type === 'system' &&
    (entry as { subtype?: string }).subtype === 'file_snapshot'
  )
}

/**
 * Official 2.1.328 `Vnn` (#645): non-mutating 5,000ms numeric-timestamp parent
 * fallback for broken `parentUuid` links, skipping `file_snapshot` rows and
 * already-visited entries via binary search + path-compressed `Int32Array`.
 */
function findNearestTimedFallbackParent(
  state: TimedFallbackState,
  messages: ReadonlyMap<UUID, TranscriptMessage>,
  orphan: TranscriptMessage,
  seen: ReadonlySet<UUID>,
): TranscriptMessage | undefined {
  const orphanTime = new Date(orphan.timestamp).getTime()
  if (Number.isNaN(orphanTime)) return undefined
  const isSidechain = Boolean(orphan.isSidechain)
  let sideIndex = state.timedSides.get(isSidechain)
  if (!sideIndex) {
    if (!state.entriesBySide) {
      state.entriesBySide = new Map<boolean, TranscriptMessage[]>()
      for (const m of messages.values()) {
        const side = Boolean(m.isSidechain)
        const list = state.entriesBySide.get(side)
        if (list) list.push(m)
        else state.entriesBySide.set(side, [m])
      }
    }
    const timed: TimedFallbackEntry[] = []
    for (const m of state.entriesBySide.get(isSidechain) ?? []) {
      if (seen.has(m.uuid)) continue
      if (isFileSnapshotEntry(m)) continue
      const t = new Date(m.timestamp).getTime()
      if (!Number.isNaN(t)) timed.push({ time: t, entry: m })
    }
    timed.reverse().sort((a, b) => a.time - b.time)
    const prev = new Int32Array(timed.length)
    for (let i = 0; i < timed.length; i++) prev[i] = i
    sideIndex = { timedEntries: timed, previousCandidate: prev }
    state.timedSides.set(isSidechain, sideIndex)
  }
  let hi = sideIndex.timedEntries.length
  let lo = 0
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sideIndex.timedEntries[mid]!.time <= orphanTime) lo = mid + 1
    else hi = mid
  }
  let idx = hi - 1
  while (idx >= 0) {
    const prev = sideIndex.previousCandidate[idx]!
    if (prev !== idx) {
      idx = prev
    } else if (seen.has(sideIndex.timedEntries[idx]!.entry.uuid)) {
      sideIndex.previousCandidate[idx] = idx - 1
      idx -= 1
    } else {
      break
    }
  }
  let compress = hi - 1
  while (compress > idx) {
    const next = sideIndex.previousCandidate[compress]!
    sideIndex.previousCandidate[compress] = idx
    compress = next
  }
  const match = idx >= 0 ? sideIndex.timedEntries[idx] : undefined
  return match && orphanTime - match.time <= CHAIN_TIMESTAMP_FALLBACK_WINDOW_MS
    ? match.entry
    : undefined
}

/**
 * Reconstructs the full conversation chain from a leaf message by following parentUuid links.
 * Returns messages in chronological order (root to leaf).
 *
 * @param messages Map of all loaded messages keyed by UUID
 * @param leafMessage The leaf message to start from
 * @returns Array of messages from root to leaf
 */
export function buildConversationChain(
  messages: Map<UUID, TranscriptMessage>,
  leafMessage: TranscriptMessage,
): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = []
  const seen = new Set<UUID>()
  let fallbackState: TimedFallbackState | undefined
  let currentMsg: TranscriptMessage | undefined =
    messages.get(leafMessage.uuid) ?? leafMessage
  while (currentMsg) {
    if (seen.has(currentMsg.uuid)) {
      logError(
        new Error(
          `Cycle detected in parentUuid chain at message ${currentMsg.uuid}. Returning partial transcript.`,
        ),
      )
      logEvent('tengu_chain_parent_cycle', {})
      break
    }
    seen.add(currentMsg.uuid)
    transcript.push(currentMsg)
    if (!currentMsg.parentUuid) {
      currentMsg = undefined
      continue
    }
    let nextMsg = messages.get(currentMsg.parentUuid)
    if (!nextMsg) {
      fallbackState ??= { timedSides: new Map() }
      nextMsg = findNearestTimedFallbackParent(
        fallbackState,
        messages,
        currentMsg,
        seen,
      )
    }
    currentMsg = nextMsg
  }
  transcript.reverse()
  const recovered = recoverOrphanedParallelToolResults(
    messages,
    transcript,
    seen,
  )
  return splicePutBackAheadRows(messages, recovered, seen).chain
}

/**
 * Post-pass for buildConversationChain: recover sibling assistant blocks and
 * tool_results that the single-parent walk orphaned.
 *
 * Streaming (claude.ts:~2024) emits one AssistantMessage per content_block_stop
 * — N parallel tool_uses → N messages, distinct uuid, same message.id. Each
 * tool_result's sourceToolAssistantUUID points to its own one-block assistant,
 * so insertMessageChain's override (line ~894) writes each TR's parentUuid to a
 * DIFFERENT assistant. The topology is a DAG; the walk above is a linked-list
 * traversal and keeps only one branch.
 *
 * Two loss modes observed in production (both fixed here):
 *   1. Sibling assistant orphaned: walk goes prev→asstA→TR_A→next, drops asstB
 *      (same message.id, chained off asstA) and TR_B.
 *   2. Progress-fork (legacy, pre-#23537): each tool_use asst had a progress
 *      child (continued the write chain) AND a TR child. Walk followed
 *      progress; TRs were dropped. No longer written (progress removed from
 *      transcript persistence), but old transcripts still have this shape.
 *
 * Read-side fix: the write topology is already on disk for old transcripts;
 * this recovery pass handles them.
 */
function recoverOrphanedParallelToolResults(
  messages: Map<UUID, TranscriptMessage>,
  chain: TranscriptMessage[],
  seen: Set<UUID>,
): TranscriptMessage[] {
  type ChainAssistant = TranscriptMessage & { type: 'assistant' }
  const chainAssistants = chain.filter(
    (m): m is ChainAssistant => m.type === 'assistant',
  )
  if (chainAssistants.length === 0) return chain

  // Anchor = last on-chain member of each sibling group. chainAssistants is
  // already in chain order, so later iterations overwrite → last wins.
  const anchorByMsgId = new Map<string, ChainAssistant>()
  for (const a of chainAssistants) {
    if (a.message!.id) anchorByMsgId.set(a.message!.id, a)
  }

  // O(n) precompute: sibling groups and TR index.
  // Official 2.1.328 (#587) `l_r`: index tool_result user rows not only by
  // parentUuid, but also by sourceToolAssistantUUID and by matching
  // tool_use_id -> emitting assistant (with matching isSidechain & agentId)
  // so retried dropped model streams never lose a turn's tool calls & results.
  const siblingsByMsgId = new Map<string, TranscriptMessage[]>()
  const toolResultsByAsst = new Map<UUID, TranscriptMessage[]>()
  const assistantByToolUseId = new Map<string, TranscriptMessage>()
  const addToolResultForAsst = (
    asstUuid: UUID,
    tr: TranscriptMessage,
  ): void => {
    const group = toolResultsByAsst.get(asstUuid)
    if (group) {
      if (!group.includes(tr)) group.push(tr)
    } else {
      toolResultsByAsst.set(asstUuid, [tr])
    }
  }
  for (const m of messages.values()) {
    if (m.type === 'assistant') {
      if (m.message?.id) {
        const group = siblingsByMsgId.get(m.message.id)
        if (group) group.push(m)
        else siblingsByMsgId.set(m.message.id, [m])
      }
      if (Array.isArray(m.message?.content)) {
        for (const block of m.message.content as unknown as Array<
          Record<string, unknown>
        >) {
          if (block?.type === 'tool_use' && typeof block.id === 'string') {
            assistantByToolUseId.set(block.id, m)
          }
        }
      }
    }
  }
  for (const m of messages.values()) {
    if (
      m.type === 'user' &&
      Array.isArray(m.message?.content) &&
      (m.message.content as Array<{ type: string }>).some(
        b => b.type === 'tool_result',
      )
    ) {
      if (m.parentUuid) {
        addToolResultForAsst(m.parentUuid, m)
      }
      const srcAsst = (m as unknown as { sourceToolAssistantUUID?: UUID })
        .sourceToolAssistantUUID
      if (srcAsst && srcAsst !== m.parentUuid) {
        addToolResultForAsst(srcAsst, m)
      }
      const mAgentId = (m as unknown as { agentId?: string }).agentId
      for (const block of m.message.content as unknown as Array<
        Record<string, unknown>
      >) {
        if (
          block?.type === 'tool_result' &&
          typeof block.tool_use_id === 'string'
        ) {
          const ownerAsst = assistantByToolUseId.get(block.tool_use_id)
          if (ownerAsst) {
            const ownerAgentId = (ownerAsst as unknown as { agentId?: string })
              .agentId
            if (
              Boolean(ownerAsst.isSidechain) === Boolean(m.isSidechain) &&
              ownerAgentId === mAgentId
            ) {
              addToolResultForAsst(ownerAsst.uuid, m)
            }
          }
        }
      }
    }
  }

  // For each message.id group touching the chain: collect off-chain siblings,
  // then off-chain TRs for ALL members. Splice right after the last on-chain
  // member so the group stays contiguous for normalizeMessagesForAPI's merge
  // and every TR lands after its tool_use.
  const processedGroups = new Set<string>()
  const inserts = new Map<UUID, TranscriptMessage[]>()
  let recoveredCount = 0
  for (const asst of chainAssistants) {
    const msgId = asst.message!.id
    if (!msgId || processedGroups.has(msgId)) continue
    processedGroups.add(msgId)

    const group = siblingsByMsgId.get(msgId) ?? [asst]
    const orphanedSiblings = group.filter(s => !seen.has(s.uuid))
    const orphanedTRs: TranscriptMessage[] = []
    for (const member of group) {
      const trs = toolResultsByAsst.get(member.uuid)
      if (!trs) continue
      for (const tr of trs) {
        if (!seen.has(tr.uuid)) orphanedTRs.push(tr)
      }
    }
    if (orphanedSiblings.length === 0 && orphanedTRs.length === 0) continue

    // Timestamp sort keeps content-block / completion order; stable-sort
    // preserves JSONL write order on ties.
    orphanedSiblings.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    orphanedTRs.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    const anchor = anchorByMsgId.get(msgId)!
    const recovered = [...orphanedSiblings, ...orphanedTRs]
    for (const r of recovered) seen.add(r.uuid)
    recoveredCount += recovered.length
    inserts.set(anchor.uuid, recovered)
  }

  if (recoveredCount === 0) return chain
  logEvent('tengu_chain_parallel_tr_recovered', {
    recovered_count: recoveredCount,
  })

  const result: TranscriptMessage[] = []
  for (const m of chain) {
    result.push(m)
    const toInsert = inserts.get(m.uuid)
    if (toInsert) result.push(...toInsert)
  }
  return result
}

/**
 * Find the latest turn_duration checkpoint in the reconstructed chain and
 * compare its recorded messageCount against the chain's position at that
 * point. Emits tengu_resume_consistency_delta for BigQuery monitoring of
 * write→load round-trip drift — the class of bugs where snip/compact/
 * parallel-TR operations mutate in-memory but the parentUuid walk on disk
 * reconstructs a different set (adamr-20260320-165831: 397K displayed →
 * 1.65M actual on resume).
 *
 * delta > 0: resume loaded MORE than in-session (the usual failure mode)
 * delta < 0: resume loaded FEWER (chain truncation — #22453 class)
 * delta = 0: round-trip consistent
 *
 * Called from loadConversationForResume — fires once per resume, not on
 * /share or log-listing chain rebuilds.
 */
export function checkResumeConsistency(chain: Message[]): void {
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i]!
    if (m.type !== 'system' || m.subtype !== 'turn_duration') continue
    const expected = m.messageCount as number | undefined
    if (expected === undefined) return
    // `i` is the 0-based index of the checkpoint in the reconstructed chain.
    // The checkpoint was appended AFTER messageCount messages, so its own
    // position should be messageCount (i.e., i === expected).
    const actual = i
    logEvent('tengu_resume_consistency_delta', {
      expected,
      actual,
      delta: actual - expected,
      chain_length: chain.length,
      checkpoint_age_entries: chain.length - 1 - i,
    })
    return
  }
}

/**
 * Builds a filie history snapshot chain from the conversation
 */
export function buildFileHistorySnapshotChain(
  fileHistorySnapshots: Map<UUID, FileHistorySnapshotMessage>,
  conversation: TranscriptMessage[],
): FileHistorySnapshot[] {
  const snapshots: FileHistorySnapshot[] = []
  // messageId → last index in snapshots[] for O(1) update lookup
  const indexByMessageId = new Map<string, number>()
  for (const message of conversation) {
    const snapshotMessage = fileHistorySnapshots.get(message.uuid)
    if (!snapshotMessage) {
      continue
    }
    const { snapshot, isSnapshotUpdate } = snapshotMessage
    const existingIndex = isSnapshotUpdate
      ? indexByMessageId.get(snapshot.messageId)
      : undefined
    if (existingIndex === undefined) {
      indexByMessageId.set(snapshot.messageId, snapshots.length)
      snapshots.push(snapshot)
    } else {
      snapshots[existingIndex] = snapshot
    }
  }
  return snapshots
}

/**
 * Builds an attribution snapshot chain from the conversation.
 * Unlike file history snapshots, attribution snapshots are returned in full
 * because they use generated UUIDs (not message UUIDs) and represent
 * cumulative state that should be restored on session resume.
 */
export function buildAttributionSnapshotChain(
  attributionSnapshots: Map<UUID, AttributionSnapshotMessage>,
  _conversation: TranscriptMessage[],
): AttributionSnapshotMessage[] {
  // Return all attribution snapshots - they will be merged during restore
  return Array.from(attributionSnapshots.values())
}

/**
 * Checks if a user message has visible content (text or image, not just tool_result).
 * Tool results are displayed as part of collapsed groups, not as standalone messages.
 * Also excludes meta messages which are not shown to the user.
 */
function hasVisibleUserContent(message: TranscriptMessage): boolean {
  if (message.type !== 'user') return false

  // Meta messages are not shown to the user
  if (message.isMeta) return false

  const content = message.message?.content
  if (!content) return false

  // String content is always visible
  if (typeof content === 'string') {
    return content.trim().length > 0
  }

  // Array content: check for text or image blocks (not tool_result)
  if (Array.isArray(content)) {
    return content.some(
      block =>
        block.type === 'text' ||
        block.type === 'image' ||
        block.type === 'document',
    )
  }

  return false
}

/**
 * Checks if an assistant message has visible text content (not just tool_use blocks).
 * Tool uses are displayed as grouped/collapsed UI elements, not as standalone messages.
 */
function hasVisibleAssistantContent(message: TranscriptMessage): boolean {
  if (message.type !== 'assistant') return false

  const content = message.message?.content
  if (!content || !Array.isArray(content)) return false

  // Check for text block (not just tool_use/thinking blocks)
  return content.some(
    block =>
      block.type === 'text' &&
      typeof block.text === 'string' &&
      block.text.trim().length > 0,
  )
}

/**
 * Counts visible messages that would appear as conversation turns in the UI.
 * Excludes:
 * - System, attachment, and progress messages
 * - User messages with isMeta flag (hidden from user)
 * - User messages that only contain tool_result blocks (displayed as collapsed groups)
 * - Assistant messages that only contain tool_use blocks (displayed as collapsed groups)
 */
export function countVisibleMessages(transcript: TranscriptMessage[]): number {
  let count = 0
  for (const message of transcript) {
    switch (message.type) {
      case 'user':
        // Count user messages with visible content (text, image, not just tool_result or meta)
        if (hasVisibleUserContent(message)) {
          count++
        }
        break
      case 'assistant':
        // Count assistant messages with text content (not just tool_use)
        if (hasVisibleAssistantContent(message)) {
          count++
        }
        break
      case 'attachment':
      case 'system':
      case 'progress':
        // These message types are not counted as visible conversation turns
        break
    }
  }
  return count
}

export function convertToLogOption(
  transcript: TranscriptMessage[],
  value: number = 0,
  summary?: string,
  customTitle?: string,
  fileHistorySnapshots?: FileHistorySnapshot[],
  tag?: string,
  fullPath?: string,
  attributionSnapshots?: AttributionSnapshotMessage[],
  agentSetting?: string,
  contentReplacements?: ContentReplacementRecord[],
): LogOption {
  const lastMessage = transcript.at(-1)!
  const firstMessage = transcript[0]!

  // Get the first user message for the prompt
  const firstPrompt = extractFirstPrompt(transcript)

  // Create timestamps from message timestamps
  const created = new Date(firstMessage.timestamp)
  const modified = new Date(lastMessage.timestamp)

  return {
    date: lastMessage.timestamp,
    messages: dropMalformedAttachmentsOnLoad(removeExtraFields(transcript)),
    fullPath,
    value,
    created,
    modified,
    firstPrompt,
    messageCount: countVisibleMessages(transcript),
    isSidechain: firstMessage.isSidechain,
    teamName: firstMessage.teamName,
    agentName: firstMessage.agentName,
    agentSetting,
    leafUuid: lastMessage.uuid,
    summary,
    customTitle,
    tag,
    fileHistorySnapshots: fileHistorySnapshots,
    attributionSnapshots: attributionSnapshots,
    contentReplacements,
    gitBranch: lastMessage.gitBranch,
    projectPath: firstMessage.cwd,
  }
}

/** densable leftover `JJe`. Persist `ur` `Je(o,a)`. */
export function isCanonicalSessionTranscriptBasename(
  sessionId: string | undefined,
  sessionFile: string | null,
): boolean {
  return (
    sessionId !== undefined &&
    sessionFile != null &&
    basename(sessionFile) === `${sessionId}.jsonl`
  )
}

/** densable leftover `Tno`. */
export function isHistorySuppressionJsonlLine(
  line: string,
  opts: { sid?: string } = {},
): boolean {
  if (!line.includes('"history-suppression"')) return false
  try {
    const n = jsonParse(line) as {
      type?: string
      sessionId?: string
    }
    return (
      n.type === 'history-suppression' &&
      (opts.sid === undefined || n.sessionId === opts.sid)
    )
  } catch {
    return false
  }
}

/**
 * Record the session's worktree state for --resume. Written to disk by
 * materializeSessionFile on the first user message and re-stamped by
 * reAppendSessionMetadata on exit. Pass null when exiting a worktree
 * so --resume knows not to cd back into it.
 */
/**
 * densable eln — `/^[A-Za-z0-9_-]+$/.test(n) && resolve(e)===resolve(join(rft(), n))`.
 */
export function leftoverDevModsFolderMatches(
  folder: string,
  sessionId: string,
): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return false
  const expected = join(getClaudeConfigHomeDir(), 'dev-mods', sessionId)
  return resolve(folder) === resolve(expected)
}

/**
 * Extracts the session ID from a log.
 * For lite logs, uses the sessionId field directly.
 * For full logs, extracts from the first message.
 */
export function getSessionIdFromLog(log: LogOption): UUID | undefined {
  // For lite logs, use the direct sessionId field
  if (log.sessionId) {
    return log.sessionId as UUID
  }
  // Fall back to extracting from first message (full logs)
  return log.messages[0]?.sessionId as UUID | undefined
}

/**
 * Checks if a log is a lite log that needs full loading.
 * Lite logs have messages: [] and sessionId set.
 */
export function isLiteLog(log: LogOption): boolean {
  return log.messages.length === 0 && log.sessionId !== undefined
}

// Exported so useLogMessages can sync-compute the last loggable uuid
// without awaiting recordTranscript's return value (race-free hint tracking).
export function isLoggableMessage(m: Message): boolean {
  if (m.type === 'progress') return false
  // IMPORTANT: We deliberately filter out most attachments for non-ants because
  // they have sensitive info for training that we don't want exposed to the public.
  // When enabled, we allow hook_additional_context through since it contains
  // user-configured hook output that is useful for session context on resume.
  if (m.type === 'attachment' && getUserType() !== 'ant') {
    // densable: goal_status must persist so /resume keeps Goal achieved.
    if (m.attachment!.type === 'goal_status') {
      return true
    }
    // Official SAVE_HOOK_ADDITIONAL_CONTEXT densable.
    let saveHookAdditionalContext = isEnvTruthy(
      process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT,
    )
    try {
      const { isSaveHookAdditionalContextEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
      saveHookAdditionalContext = isSaveHookAdditionalContextEnabled()
    } catch {
      // keep raw env fallback
    }
    if (
      m.attachment!.type === 'hook_additional_context' &&
      saveHookAdditionalContext
    ) {
      return true
    }
    return false
  }
  return true
}

function collectReplIds(messages: readonly Message[]): Set<string> {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.type === 'assistant' && Array.isArray(m.message!.content)) {
      for (const b of m.message!.content as Array<{
        type: string
        name: string
        id: string
      }>) {
        if (b.type === 'tool_use' && b.name === REPL_TOOL_NAME) {
          ids.add(b.id)
        }
      }
    }
  }
  return ids
}

/**
 * For external users, make REPL invisible in the persisted transcript: strip
 * REPL tool_use/tool_result pairs and promote isVirtual messages to real. On
 * --resume the model then sees a coherent native-tool-call history (assistant
 * called Bash, got result, called Read, got result) without the REPL wrapper.
 * Ant transcripts keep the wrapper so /share training data sees REPL usage.
 *
 * replIds is pre-collected from the FULL session array, not the slice being
 * transformed — recordTranscript receives incremental slices where the REPL
 * tool_use (earlier render) and its tool_result (later render, after async
 * execution) land in separate calls. A fresh per-call Set would miss the id
 * and leave an orphaned tool_result on disk.
 */
function transformMessagesForExternalTranscript(
  messages: Transcript,
  replIds: Set<string>,
): Transcript {
  return messages.flatMap(m => {
    if (m.type === 'assistant' && Array.isArray(m.message.content)) {
      const content = m.message.content
      const hasRepl = content.some(
        b => b.type === 'tool_use' && b.name === REPL_TOOL_NAME,
      )
      const filtered = hasRepl
        ? content.filter(
            b => !(b.type === 'tool_use' && b.name === REPL_TOOL_NAME),
          )
        : content
      if (filtered.length === 0) return []
      if (m.isVirtual) {
        const { isVirtual: _omit, ...rest } = m
        return [{ ...rest, message: { ...m.message, content: filtered } }]
      }
      if (filtered !== content) {
        return [{ ...m, message: { ...m.message, content: filtered } }]
      }
      return [m]
    }
    if (m.type === 'user' && Array.isArray(m.message.content)) {
      const content = m.message.content
      const hasRepl = content.some(
        b => b.type === 'tool_result' && replIds.has(b.tool_use_id),
      )
      const filtered = hasRepl
        ? content.filter(
            b => !(b.type === 'tool_result' && replIds.has(b.tool_use_id)),
          )
        : content
      if (filtered.length === 0) return []
      if (m.isVirtual) {
        const { isVirtual: _omit, ...rest } = m
        return [{ ...rest, message: { ...m.message, content: filtered } }]
      }
      if (filtered !== content) {
        return [{ ...m, message: { ...m.message, content: filtered } }]
      }
      return [m]
    }
    // string-content user, system, attachment
    if ('isVirtual' in m && m.isVirtual) {
      const { isVirtual: _omit, ...rest } = m
      return [rest]
    }
    return [m]
  }) as Transcript
}

export function cleanMessagesForLogging(
  messages: Message[],
  allMessages: readonly Message[] = messages,
): Transcript {
  const filtered = messages.filter(isLoggableMessage) as Transcript
  return getUserType() !== 'ant'
    ? transformMessagesForExternalTranscript(
        filtered,
        collectReplIds(allMessages),
      )
    : filtered
}

export function isReservedAgentName(name: string): boolean {
  const lower = name.trim().toLowerCase()
  return RESERVED_AGENT_NAMES.has(lower) || toAgentId(lower) !== null
}
