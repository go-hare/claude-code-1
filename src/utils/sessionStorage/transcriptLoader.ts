import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
} from '../../bootstrap/state.js'
import { type AgentId, asAgentId } from '../../types/ids.js'
import type {
  AttributionSnapshotMessage,
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
  CostStateEntry,
  Entry,
  FileHistorySnapshotMessage,
  GoalState,
  LastPromptMessage,
  LogOption,
  PersistedWorktreeSession,
  SerializedMessage,
  TranscriptMessage,
} from '../../types/logs.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import type { PermissionMode } from '../../types/permissions.js'
import { uniq } from '../array.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { isDisklessActive } from '../disklessGuards.js'
import { isEnvTruthy } from '../envUtils.js'
import { parseJSONL } from '../json.js'
import {
  isCompactBoundaryMessage,
  rewriteResumedSubagentShutdownToolResults,
} from '../messages.js'
import { isPrecompactSkipDisabled } from '../residualFinalEnvGates.js'
import {
  getAgentTranscriptPath,
  getProjectDir,
  getTranscriptPath,
  isTranscriptMessage,
} from '../sessionPaths.js'
import {
  SKIP_PRECOMPACT_THRESHOLD,
  readTranscriptForLoad,
} from '../sessionStoragePortable.js'
import { jsonParse } from '../slowOperations.js'
import type { ContentReplacementRecord } from '../toolResultStorage.js'
import { validateUuid } from '../uuid.js'
import type { UUID } from 'crypto'
import type { Dirent } from 'fs'
import { open as fsOpen, readFile, readdir, stat } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { StringDecoder } from 'string_decoder'
import {
  LOW_MEMORY_CHUNK_BYTES,
  LOW_MEMORY_MAX_LINE_BYTES,
  MAX_CACHED_SESSION_FILES,
  METADATA_MARKER_BUFS,
  METADATA_PREFIX_BOUND,
} from './types.js'
import {
  awaitWithOptionalAbort,
  getActiveProjectSessionFile,
  getHostSessionStorageState,
  markTornTailForNextAppend,
} from './sessionState.js'
import { fileEndsWithNewline } from './fsHelpers.js'
import {
  getResumeHeadPath,
  planResumeHeadForTranscript,
  readCustomTitleSidecar,
  scheduleWriteResumeHead,
  tryLoadResumeHeadRows,
} from './sidecars.js'
import {
  CheckpointReachTracker,
  ToolUseNameWindow,
  applyPreservedSegmentRelinks,
  applySnipRemovals,
  bridgeBrokenParentChain,
  buildAttributionSnapshotChain,
  buildConversationChain,
  buildFileHistorySnapshotChain,
  convertToLogOption,
  countVisibleMessages,
  createMissingEarlierMessagesWarning,
  dropMalformedAttachmentsOnLoad,
  extractFirstPrompt,
  findLatestMessage,
  hasMissingEarlierMessages,
  isLegacyProgressEntry,
  isLiteLog,
  leftoverDevModsFolderMatches,
  relinkDroppedTranscriptRows,
  removeExtraFields,
  repairTranscriptMessageContent,
  resolveTerminalConversationalAncestors,
  slimToolUseResultForResume,
} from './transcriptChain.js'

/**
 * Loads a transcript from a JSON or JSONL file and converts it to LogOption format
 * @param filePath Path to the transcript file (.json or .jsonl)
 * @returns LogOption containing the transcript messages
 * @throws Error if file doesn't exist or contains invalid data
 */
export async function loadTranscriptFromFile(
  filePath: string,
): Promise<LogOption> {
  if (filePath.endsWith('.jsonl')) {
    const {
      messages,
      summaries,
      customTitles,
      aiTitles,
      tags,
      fileHistorySnapshots,
      attributionSnapshots,
      contextCollapseCommits,
      contextCollapseSnapshot,
      leafUuids,
      contentReplacements,
      modes,
      permissionModes,
      sessionModels,
      worktreeStates,
      replModes,
      devModsFolders,
      endedByModelSessions,
      relocatedCwds,
      bridgeSessionIds,
      bridgeLastSeqs,
      bridgeDialogKindsBySession,
      bridgeSessionGroupingIds,
      bridgeNoBackfill,
      bridgeOwnerAccountUuids,
      bridgeOwnerOrganizationUuids,
      historySuppressed,
      readTruncated,
    } = await loadTranscriptFile(filePath)

    if (messages.size === 0) {
      throw new Error('No messages found in JSONL file')
    }

    // Find the most recent leaf message using pre-computed leaf UUIDs
    const leafMessage = findLatestMessage(messages.values(), msg =>
      leafUuids.has(msg.uuid),
    )

    if (!leafMessage) {
      throw new Error('No valid conversation chain found in JSONL file')
    }

    // Build the conversation chain backwards from leaf to root
    const transcript = buildConversationChain(messages, leafMessage)
    const truncatedEarlier = hasMissingEarlierMessages(
      transcript,
      messages,
      readTruncated,
    )

    const summary = summaries.get(leafMessage.uuid)
    const customTitle = customTitles.get(leafMessage.sessionId as UUID)
    const tag = tags.get(leafMessage.sessionId as UUID)
    const sessionId = leafMessage.sessionId as UUID
    const bridgeSessionId = bridgeSessionIds.get(sessionId)
    const baseLog = convertToLogOption(
      transcript,
      0,
      summary,
      customTitle,
      buildFileHistorySnapshotChain(fileHistorySnapshots, transcript),
      tag,
      filePath,
      buildAttributionSnapshotChain(attributionSnapshots, transcript),
      undefined,
      contentReplacements.get(sessionId) ?? [],
    )
    // Official 2.1.328 (#370): prepend a non-persisted warning when earlier
    // messages couldn't be loaded due to a missing or damaged session file.
    if (truncatedEarlier) {
      baseLog.messages = [
        {
          ...createMissingEarlierMessagesWarning(),
          parentUuid: null,
          isSidechain: false,
          userType: 'external',
          cwd: getCwd(),
          sessionId,
          version: MACRO.VERSION,
        } as unknown as SerializedMessage,
        ...baseLog.messages,
      ]
    }
    const log = {
      ...baseLog,
      aiTitle: aiTitles.get(sessionId),
      mode: modes.get(sessionId) as LogOption['mode'],
      permissionMode: permissionModes.get(sessionId),
      sessionModel: sessionModels.get(sessionId),
      contextCollapseCommits: contextCollapseCommits.filter(
        e => e.sessionId === sessionId,
      ),
      contextCollapseSnapshot:
        contextCollapseSnapshot?.sessionId === sessionId
          ? contextCollapseSnapshot
          : undefined,
      worktreeSession: worktreeStates.has(sessionId)
        ? worktreeStates.get(sessionId)
        : undefined,
      ...(replModes.has(sessionId)
        ? { replMode: replModes.get(sessionId) }
        : {}),
      devModsFolder: devModsFolders.get(sessionId),
      // densable OGe({}, sessionId ? endedSet.has(sessionId) : false)
      endedByModel: endedByModelSessions.has(sessionId),
      // densable 2.1.224 #30 — non-empty bridge-session only (tombstone deleted map)
      ...(bridgeSessionId
        ? {
            bridgeSessionId,
            bridgeLastSeq: bridgeLastSeqs.get(sessionId),
            bridgeDialogKinds: bridgeDialogKindsBySession.get(sessionId),
            bridgeSessionGroupingId: bridgeSessionGroupingIds.get(sessionId),
            bridgeNoHistoryBackfill: bridgeNoBackfill.get(sessionId),
            bridgeOwnerAccountUuid: bridgeOwnerAccountUuids.get(sessionId),
            bridgeOwnerOrganizationUuid:
              bridgeOwnerOrganizationUuids.get(sessionId),
            sessionHistorySuppressed: historySuppressed.has(sessionId)
              ? true
              : undefined,
          }
        : {}),
    }
    // densable 2.1.223 #8 — prefer last relocated stamp for projectPath
    const relocated = relocatedCwds.get(sessionId)
    if (relocated) {
      log.projectPath = relocated
      log.relocatedCwd = relocated
    }
    return log
  }

  // json log files
  const content = await readFile(filePath, { encoding: 'utf-8' })
  let parsed: unknown

  try {
    parsed = jsonParse(content)
  } catch (error) {
    throw new Error(`Invalid JSON in transcript file: ${error}`)
  }

  let messages: TranscriptMessage[]

  if (Array.isArray(parsed)) {
    messages = parsed
  } else if (parsed && typeof parsed === 'object' && 'messages' in parsed) {
    if (!Array.isArray(parsed.messages)) {
      throw new Error('Transcript messages must be an array')
    }
    messages = parsed.messages
  } else {
    throw new Error(
      'Transcript must be an array of messages or an object with a messages array',
    )
  }

  return convertToLogOption(
    messages,
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    filePath,
  )
}

/**
 * Loads full messages for a lite log by reading its JSONL file.
 * Returns a new LogOption with populated messages array.
 * If the log is already full or loading fails, returns the original log.
 */
export async function loadFullLog(log: LogOption): Promise<LogOption> {
  // If already full, return as-is
  if (!isLiteLog(log)) {
    return log
  }

  // Use the fullPath from the index entry directly
  const sessionFile = log.fullPath
  if (!sessionFile) {
    return log
  }

  try {
    const {
      messages,
      summaries,
      customTitles,
      aiTitles,
      tags,
      agentNames,
      agentColors,
      agentSettings,
      prNumbers,
      prUrls,
      prRepositories,
      modes,
      permissionModes,
      sessionModels,
      worktreeStates,
      replModes,
      devModsFolders,
      goals,
      fileHistorySnapshots,
      attributionSnapshots,
      contentReplacements,
      contextCollapseCommits,
      contextCollapseSnapshot,
      leafUuids,
      endedByModelSessions,
      relocatedCwds,
      bridgeSessionIds,
      bridgeLastSeqs,
      bridgeDialogKindsBySession,
      bridgeSessionGroupingIds,
      bridgeNoBackfill,
      bridgeOwnerAccountUuids,
      bridgeOwnerOrganizationUuids,
      historySuppressed,
    } = await loadTranscriptFile(sessionFile)

    if (messages.size === 0) {
      const fallbackGoal = log.sessionId
        ? goals.get(log.sessionId as UUID)
        : undefined
      const relocated =
        log.sessionId != null
          ? relocatedCwds.get(log.sessionId as UUID)
          : undefined
      if (!fallbackGoal && !relocated) return log
      return {
        ...log,
        ...(fallbackGoal ? { goal: fallbackGoal } : {}),
        ...(relocated
          ? { relocatedCwd: relocated, projectPath: relocated }
          : {}),
      }
    }

    // Find the most recent user/assistant leaf message from the transcript
    const mostRecentLeaf = findLatestMessage(
      messages.values(),
      msg =>
        leafUuids.has(msg.uuid) &&
        (msg.type === 'user' || msg.type === 'assistant'),
    )
    if (!mostRecentLeaf) {
      // densable 2.1.223 #8 — no-leaf still hydrates relocated stamp (same as
      // empty-messages early return) so resume restore can reAppend.
      const fallbackGoal = log.sessionId
        ? goals.get(log.sessionId as UUID)
        : undefined
      const relocated =
        log.sessionId != null
          ? relocatedCwds.get(log.sessionId as UUID)
          : undefined
      if (!fallbackGoal && !relocated) return log
      return {
        ...log,
        ...(fallbackGoal ? { goal: fallbackGoal } : {}),
        ...(relocated
          ? { relocatedCwd: relocated, projectPath: relocated }
          : {}),
      }
    }

    // Build the conversation chain from this leaf
    const transcript = buildConversationChain(messages, mostRecentLeaf)
    // Leaf's sessionId — forked sessions copy chain[0] from the source, but
    // metadata entries (custom-title etc.) are keyed by the current session.
    const sessionId = mostRecentLeaf.sessionId as UUID | undefined
    return {
      ...log,
      messages: dropMalformedAttachmentsOnLoad(removeExtraFields(transcript)),
      firstPrompt: extractFirstPrompt(transcript),
      messageCount: countVisibleMessages(transcript),
      summary: mostRecentLeaf
        ? summaries.get(mostRecentLeaf.uuid)
        : log.summary,
      customTitle: sessionId ? customTitles.get(sessionId) : log.customTitle,
      aiTitle: sessionId ? aiTitles.get(sessionId) : log.aiTitle,
      tag: sessionId ? tags.get(sessionId) : log.tag,
      agentName: sessionId ? agentNames.get(sessionId) : log.agentName,
      agentColor: sessionId ? agentColors.get(sessionId) : log.agentColor,
      agentSetting: sessionId ? agentSettings.get(sessionId) : log.agentSetting,
      mode: sessionId ? (modes.get(sessionId) as LogOption['mode']) : log.mode,
      permissionMode: sessionId
        ? (permissionModes.get(sessionId) ?? log.permissionMode)
        : log.permissionMode,
      sessionModel: sessionId
        ? (sessionModels.get(sessionId) ?? log.sessionModel)
        : log.sessionModel,
      ...(sessionId && replModes.has(sessionId)
        ? { replMode: replModes.get(sessionId) }
        : (log as LogOption & { replMode?: boolean }).replMode !== undefined
          ? { replMode: (log as LogOption & { replMode?: boolean }).replMode }
          : {}),
      worktreeSession:
        sessionId && worktreeStates.has(sessionId)
          ? worktreeStates.get(sessionId)
          : log.worktreeSession,
      devModsFolder: sessionId
        ? (devModsFolders.get(sessionId) ?? log.devModsFolder)
        : log.devModsFolder,
      goal: sessionId ? goals.get(sessionId) : log.goal,
      endedByModel: sessionId
        ? endedByModelSessions.has(sessionId)
        : log.endedByModel,
      prNumber: sessionId ? prNumbers.get(sessionId) : log.prNumber,
      prUrl: sessionId ? prUrls.get(sessionId) : log.prUrl,
      prRepository: sessionId
        ? prRepositories.get(sessionId)
        : log.prRepository,
      gitBranch: mostRecentLeaf?.gitBranch ?? log.gitBranch,
      isSidechain: transcript[0]?.isSidechain ?? log.isSidechain,
      teamName: transcript[0]?.teamName ?? log.teamName,
      leafUuid: mostRecentLeaf?.uuid ?? log.leafUuid,
      // densable 2.1.223 #8 — prefer relocated stamp for resume projectPath
      projectPath: sessionId
        ? (relocatedCwds.get(sessionId) ?? log.projectPath)
        : log.projectPath,
      relocatedCwd: sessionId
        ? (relocatedCwds.get(sessionId) ?? log.relocatedCwd)
        : log.relocatedCwd,
      fileHistorySnapshots: buildFileHistorySnapshotChain(
        fileHistorySnapshots,
        transcript,
      ),
      attributionSnapshots: buildAttributionSnapshotChain(
        attributionSnapshots,
        transcript,
      ),
      contentReplacements: sessionId
        ? (contentReplacements.get(sessionId) ?? [])
        : log.contentReplacements,
      // Filter to the resumed session's entries. loadTranscriptFile reads
      // the file sequentially so the array is already in commit order;
      // filter preserves that.
      contextCollapseCommits: sessionId
        ? contextCollapseCommits.filter(e => e.sessionId === sessionId)
        : undefined,
      contextCollapseSnapshot:
        sessionId && contextCollapseSnapshot?.sessionId === sessionId
          ? contextCollapseSnapshot
          : undefined,
      // densable 2.1.224 #30 — hydrate non-empty bridge-session for resume force-on
      ...(sessionId && bridgeSessionIds.get(sessionId)
        ? {
            bridgeSessionId: bridgeSessionIds.get(sessionId),
            bridgeLastSeq: bridgeLastSeqs.get(sessionId),
            bridgeDialogKinds: bridgeDialogKindsBySession.get(sessionId),
            bridgeSessionGroupingId: bridgeSessionGroupingIds.get(sessionId),
            bridgeNoHistoryBackfill: bridgeNoBackfill.get(sessionId),
            bridgeOwnerAccountUuid: bridgeOwnerAccountUuids.get(sessionId),
            bridgeOwnerOrganizationUuid:
              bridgeOwnerOrganizationUuids.get(sessionId),
            sessionHistorySuppressed: sessionId
              ? historySuppressed.has(sessionId)
                ? true
                : undefined
              : undefined,
          }
        : { bridgeSessionId: undefined }),
    }
  } catch {
    // If loading fails, return the original log
    return log
  }
}

// null = carry spans whole chunk. Skips concat when carry provably isn't
// a metadata line (markers sit at byte 1 after `{`).
function resolveMetadataBuf(
  carry: Buffer | null,
  chunkBuf: Buffer,
): Buffer | null {
  if (carry === null || carry.length === 0) return chunkBuf
  if (carry.length < METADATA_PREFIX_BOUND) {
    return Buffer.concat([carry, chunkBuf])
  }
  if (carry[0] === 0x7b /* { */) {
    for (const m of METADATA_MARKER_BUFS) {
      if (carry.compare(m, 0, m.length, 1, 1 + m.length) === 0) {
        return Buffer.concat([carry, chunkBuf])
      }
    }
  }
  const firstNl = chunkBuf.indexOf(0x0a)
  return firstNl === -1 ? null : chunkBuf.subarray(firstNl + 1)
}

/**
 * Lightweight forward scan of [0, endOffset) collecting only metadata-entry lines.
 * Uses raw Buffer chunks and byte-level marker matching — no readline, no per-line
 * string conversion for the ~99% of lines that are message content.
 *
 * Fast path: if a chunk contains zero markers (the common case — metadata entries
 * are <50 per session), the entire chunk is skipped without line splitting.
 */
async function scanPreBoundaryMetadata(
  filePath: string,
  endOffset: number,
): Promise<string[]> {
  const { createReadStream } = await import('fs')
  const NEWLINE = 0x0a

  const stream = createReadStream(filePath, { end: endOffset - 1 })
  const metadataLines: string[] = []
  let carry: Buffer | null = null

  for await (const chunk of stream) {
    const chunkBuf = chunk as Buffer
    const buf = resolveMetadataBuf(carry, chunkBuf)
    if (buf === null) {
      carry = null
      continue
    }

    // Fast path: most chunks contain zero metadata markers. Skip line splitting.
    let hasAnyMarker = false
    for (const m of METADATA_MARKER_BUFS) {
      if (buf.includes(m)) {
        hasAnyMarker = true
        break
      }
    }

    if (hasAnyMarker) {
      let lineStart = 0
      let nl = buf.indexOf(NEWLINE)
      while (nl !== -1) {
        // Bounded marker check: only look within this line's byte range
        for (const m of METADATA_MARKER_BUFS) {
          const mIdx = buf.indexOf(m, lineStart)
          if (mIdx !== -1 && mIdx < nl) {
            metadataLines.push(buf.toString('utf-8', lineStart, nl))
            break
          }
        }
        lineStart = nl + 1
        nl = buf.indexOf(NEWLINE, lineStart)
      }
      carry = buf.subarray(lineStart)
    } else {
      // No markers in this chunk — just preserve the incomplete trailing line
      const lastNl = buf.lastIndexOf(NEWLINE)
      carry = lastNl >= 0 ? buf.subarray(lastNl + 1) : buf
    }

    // Guard against quadratic carry growth for pathological huge lines
    // (e.g., a 10 MB tool-output line with no newline). Real metadata entries
    // are <1 KB, so if carry exceeds this we're mid-message-content — drop it.
    if (carry.length > 64 * 1024) carry = null
  }

  // Final incomplete line (no trailing newline at endOffset)
  if (carry !== null && carry.length > 0) {
    for (const m of METADATA_MARKER_BUFS) {
      if (carry.includes(m)) {
        metadataLines.push(carry.toString('utf-8'))
        break
      }
    }
  }

  return metadataLines
}

/**
 * Byte-level pre-filter that excises dead fork branches before parseJSONL.
 *
 * Every rewind/ctrl-z leaves an orphaned chain branch in the append-only
 * JSONL forever. buildConversationChain walks parentUuid from the latest leaf
 * and discards everything else, but by then parseJSONL has already paid to
 * JSON.parse all of it. Measured on fork-heavy sessions:
 *
 *   41 MB, 99% dead: parseJSONL 56.0 ms -> 3.9 ms (-93%)
 *   151 MB, 92% dead: 47.3 ms -> 9.4 ms (-80%)
 *
 * Sessions with few dead branches (5-7%) see a small win from the overhead of
 * the index pass roughly canceling the parse savings, so this is gated on
 * buffer size (same threshold as SKIP_PRECOMPACT_THRESHOLD).
 *
 * Relies on two invariants verified across 25k+ message lines in local
 * sessions (0 violations):
 *
 *   1. Transcript messages always serialize with parentUuid as the first key.
 *      JSON.stringify emits keys in insertion order and recordTranscript's
 *      object literal puts parentUuid first. So `{"parentUuid":` is a stable
 *      line prefix that distinguishes transcript messages from metadata.
 *
 *   2. Top-level uuid detection is handled by a suffix check + depth check
 *      (see inline comment in the scan loop). toolUseResult/mcpMeta serialize
 *      AFTER uuid with arbitrary server-controlled objects, and agent_progress
 *      entries serialize a nested Message in data BEFORE uuid — both can
 *      produce nested `"uuid":"<36>","timestamp":"` bytes, so suffix alone
 *      is insufficient. When multiple suffix matches exist, a brace-depth
 *      scan disambiguates.
 *
 * The append-only write discipline guarantees parents appear at earlier file
 * offsets than children, so walking backward from EOF always finds them.
 */

/**
 * Disambiguate multiple `"uuid":"<36>","timestamp":"` matches in one line by
 * finding the one at JSON nesting depth 1. String-aware brace counter:
 * `{`/`}` inside string values don't count; `\"` and `\\` inside strings are
 * handled. Candidates is sorted ascending (the scan loop produces them in
 * byte order). Returns the first depth-1 candidate, or the last candidate if
 * none are at depth 1 (shouldn't happen for well-formed JSONL — depth-1 is
 * where the top-level object's fields live).
 *
 * Only called when ≥2 suffix matches exist (agent_progress with a nested
 * Message, or mcpMeta with a coincidentally-suffixed object). Cost is
 * O(max(candidates) - lineStart) — one forward byte pass, stopping at the
 * first depth-1 hit.
 */
function pickDepthOneUuidCandidate(
  buf: Buffer,
  lineStart: number,
  candidates: number[],
): number {
  const QUOTE = 0x22
  const BACKSLASH = 0x5c
  const OPEN_BRACE = 0x7b
  const CLOSE_BRACE = 0x7d
  let depth = 0
  let inString = false
  let escapeNext = false
  let ci = 0
  for (let i = lineStart; ci < candidates.length; i++) {
    if (i === candidates[ci]) {
      if (depth === 1 && !inString) return candidates[ci]!
      ci++
    }
    const b = buf[i]!
    if (escapeNext) {
      escapeNext = false
    } else if (inString) {
      if (b === BACKSLASH) escapeNext = true
      else if (b === QUOTE) inString = false
    } else if (b === QUOTE) inString = true
    else if (b === OPEN_BRACE) depth++
    else if (b === CLOSE_BRACE) depth--
  }
  return candidates.at(-1)!
}

function walkChainBeforeParse(buf: Buffer): Buffer {
  const NEWLINE = 0x0a
  const OPEN_BRACE = 0x7b
  const QUOTE = 0x22
  const PARENT_PREFIX = Buffer.from('{"parentUuid":')
  const UUID_KEY = Buffer.from('"uuid":"')
  const SIDECHAIN_TRUE = Buffer.from('"isSidechain":true')
  const UUID_LEN = 36
  const TS_SUFFIX = Buffer.from('","timestamp":"')
  const TS_SUFFIX_LEN = TS_SUFFIX.length
  const PREFIX_LEN = PARENT_PREFIX.length
  const KEY_LEN = UUID_KEY.length

  // Stride-3 flat index of transcript messages: [lineStart, lineEnd, parentStart].
  // parentStart is the byte offset of the parent uuid's first char, or -1 for null.
  // Metadata lines (summary, mode, file-history-snapshot, etc.) go in metaRanges
  // unfiltered - they lack the parentUuid prefix and downstream needs all of them.
  const msgIdx: number[] = []
  const metaRanges: number[] = []
  const uuidToSlot = new Map<string, number>()

  let pos = 0
  const len = buf.length
  while (pos < len) {
    const nl = buf.indexOf(NEWLINE, pos)
    const lineEnd = nl === -1 ? len : nl + 1
    if (
      lineEnd - pos > PREFIX_LEN &&
      buf[pos] === OPEN_BRACE &&
      buf.compare(PARENT_PREFIX, 0, PREFIX_LEN, pos, pos + PREFIX_LEN) === 0
    ) {
      // `{"parentUuid":null,` or `{"parentUuid":"<36 chars>",`
      const parentStart =
        buf[pos + PREFIX_LEN] === QUOTE ? pos + PREFIX_LEN + 1 : -1
      // The top-level uuid is immediately followed by `","timestamp":"` in
      // user/assistant/attachment entries (the create* helpers put them
      // adjacent; both always defined). But the suffix is NOT unique:
      //   - agent_progress entries carry a nested Message in data.message,
      //     serialized BEFORE top-level uuid — that inner Message has its
      //     own uuid,timestamp adjacent, so its bytes also satisfy the
      //     suffix check.
      //   - mcpMeta/toolUseResult come AFTER top-level uuid and hold
      //     server-controlled Record<string,unknown> — a server returning
      //     {uuid:"<36>",timestamp:"..."} would also match.
      // Collect all suffix matches; a single one is unambiguous (common
      // case), multiple need a brace-depth check to pick the one at
      // JSON nesting depth 1. Entries with NO suffix match (some progress
      // variants put timestamp BEFORE uuid → `"uuid":"<36>"}` at EOL)
      // have only one `"uuid":"` and the first-match fallback is sound.
      let firstAny = -1
      let suffix0 = -1
      let suffixN: number[] | undefined
      let from = pos
      for (;;) {
        const next = buf.indexOf(UUID_KEY, from)
        if (next < 0 || next >= lineEnd) break
        if (firstAny < 0) firstAny = next
        const after = next + KEY_LEN + UUID_LEN
        if (
          after + TS_SUFFIX_LEN <= lineEnd &&
          buf.compare(
            TS_SUFFIX,
            0,
            TS_SUFFIX_LEN,
            after,
            after + TS_SUFFIX_LEN,
          ) === 0
        ) {
          if (suffix0 < 0) suffix0 = next
          else (suffixN ??= [suffix0]).push(next)
        }
        from = next + KEY_LEN
      }
      const uk = suffixN
        ? pickDepthOneUuidCandidate(buf, pos, suffixN)
        : suffix0 >= 0
          ? suffix0
          : firstAny
      if (uk >= 0) {
        const uuidStart = uk + KEY_LEN
        // UUIDs are pure ASCII so latin1 avoids UTF-8 decode overhead.
        const uuid = buf.toString('latin1', uuidStart, uuidStart + UUID_LEN)
        uuidToSlot.set(uuid, msgIdx.length)
        msgIdx.push(pos, lineEnd, parentStart)
      } else {
        metaRanges.push(pos, lineEnd)
      }
    } else {
      metaRanges.push(pos, lineEnd)
    }
    pos = lineEnd
  }

  // Leaf = last non-sidechain entry. isSidechain is the 2nd or 3rd key
  // (after parentUuid, maybe logicalParentUuid) so indexOf from lineStart
  // finds it within a few dozen bytes when present; when absent it spills
  // into the next line, caught by the bounds check.
  let leafSlot = -1
  for (let i = msgIdx.length - 3; i >= 0; i -= 3) {
    const sc = buf.indexOf(SIDECHAIN_TRUE, msgIdx[i]!)
    if (sc === -1 || sc >= msgIdx[i + 1]!) {
      leafSlot = i
      break
    }
  }
  if (leafSlot < 0) return buf

  // Walk parentUuid to root. Collect kept-message line starts and sum their
  // byte lengths so we can decide whether the concat is worth it. A dangling
  // parent (uuid not in file) is the normal termination for forked sessions
  // and post-boundary chains -- same semantics as buildConversationChain.
  // Correctness against index poisoning rests on the timestamp suffix check
  // above: a nested `"uuid":"` match without the suffix never becomes uk.
  const seen = new Set<number>()
  const chain = new Set<number>()
  let chainBytes = 0
  let slot: number | undefined = leafSlot
  while (slot !== undefined) {
    if (seen.has(slot)) break
    seen.add(slot)
    chain.add(msgIdx[slot]!)
    chainBytes += msgIdx[slot + 1]! - msgIdx[slot]!
    const parentStart = msgIdx[slot + 2]!
    if (parentStart < 0) break
    const parent = buf.toString('latin1', parentStart, parentStart + UUID_LEN)
    slot = uuidToSlot.get(parent)
  }

  // parseJSONL cost scales with bytes, not entry count. A session can have
  // thousands of dead entries by count but only single-digit-% of bytes if
  // the dead branches are short turns and the live chain holds the fat
  // assistant responses (measured: 107 MB session, 69% dead entries, 30%
  // dead bytes - index+concat overhead exceeded parse savings). Gate on
  // bytes: only stitch if we would drop at least half the buffer. Metadata
  // is tiny so len - chainBytes approximates dead bytes closely enough.
  // Near break-even the concat memcpy (copying chainBytes into a fresh
  // allocation) dominates, so a conservative 50% gate stays safely on the
  // winning side.
  if (len - chainBytes < len >> 1) return buf

  // Merge chain entries with metadata in original file order. Both msgIdx and
  // metaRanges are already sorted by offset; interleave them into subarray
  // views and concat once.
  const parts: Buffer[] = []
  let m = 0
  for (let i = 0; i < msgIdx.length; i += 3) {
    const start = msgIdx[i]!
    while (m < metaRanges.length && metaRanges[m]! < start) {
      parts.push(buf.subarray(metaRanges[m]!, metaRanges[m + 1]!))
      m += 2
    }
    if (chain.has(start)) {
      parts.push(buf.subarray(start, msgIdx[i + 1]!))
    }
  }
  while (m < metaRanges.length) {
    parts.push(buf.subarray(metaRanges[m]!, metaRanges[m + 1]!))
    m += 2
  }
  return Buffer.concat(parts)
}

/**
 * densable bridge-session last-wins: non-empty id sets maps; empty tombstone
 * deletes (user turned RC off — 2.1.224 #30).
 */
function applyBridgeSessionEntry(
  entry: {
    sessionId?: UUID
    bridgeSessionId?: string
    lastSequenceNum?: number
    declaredDialogKinds?: string[]
    sessionGroupingId?: string
    noHistoryBackfill?: boolean
    ownerAccountUuid?: string
    ownerOrganizationUuid?: string
  },
  bridgeSessionIds: Map<UUID, string>,
  bridgeLastSeqs: Map<UUID, number>,
  bridgeDialogKindsBySession: Map<UUID, string[]>,
  bridgeSessionGroupingIds: Map<UUID, string>,
  bridgeNoBackfill: Map<UUID, boolean>,
  bridgeOwnerAccountUuids: Map<UUID, string>,
  bridgeOwnerOrganizationUuids: Map<UUID, string>,
): void {
  if (!entry.sessionId) return
  const sid = entry.sessionId
  const id = entry.bridgeSessionId
  if (id) {
    bridgeSessionIds.set(sid, id)
    if (typeof entry.lastSequenceNum === 'number') {
      bridgeLastSeqs.set(sid, entry.lastSequenceNum)
    }
    if (entry.declaredDialogKinds?.length) {
      bridgeDialogKindsBySession.set(sid, entry.declaredDialogKinds)
    } else {
      bridgeDialogKindsBySession.delete(sid)
    }
    if (entry.sessionGroupingId) {
      bridgeSessionGroupingIds.set(sid, entry.sessionGroupingId)
    } else {
      bridgeSessionGroupingIds.delete(sid)
    }
    if (entry.noHistoryBackfill) {
      bridgeNoBackfill.set(sid, true)
    } else {
      bridgeNoBackfill.delete(sid)
    }
    // densable FKt: invalid uuid on either owner field drops both maps.
    const ownerAccountUuid = entry.ownerAccountUuid
    const ownerOrganizationUuid = entry.ownerOrganizationUuid
    const ownerInvalid =
      (ownerAccountUuid !== undefined &&
        validateUuid(ownerAccountUuid) === null) ||
      (ownerOrganizationUuid !== undefined &&
        validateUuid(ownerOrganizationUuid) === null)
    if (!ownerInvalid && ownerAccountUuid) {
      bridgeOwnerAccountUuids.set(sid, ownerAccountUuid)
    } else {
      bridgeOwnerAccountUuids.delete(sid)
    }
    if (!ownerInvalid && ownerOrganizationUuid) {
      bridgeOwnerOrganizationUuids.set(sid, ownerOrganizationUuid)
    } else {
      bridgeOwnerOrganizationUuids.delete(sid)
    }
  } else {
    // Empty-string tombstone (clearBridgeSession) — drop pointer
    bridgeSessionIds.delete(sid)
    bridgeLastSeqs.delete(sid)
    bridgeDialogKindsBySession.delete(sid)
    bridgeSessionGroupingIds.delete(sid)
    bridgeNoBackfill.delete(sid)
    bridgeOwnerAccountUuids.delete(sid)
    bridgeOwnerOrganizationUuids.delete(sid)
  }
}

/**
 * Official 2.1.326 #31: detect memory-pressure / allocation failures thrown
 * when attempting to read or stringify an entire transcript in one buffer.
 */
export function isLowMemoryReadError(err: unknown): boolean {
  if (err instanceof RangeError) return true
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code
    if (
      code === 'ENOMEM' ||
      code === 'EFBIG' ||
      code === 'ERR_STRING_TOO_LONG' ||
      code === 'ERR_OUT_OF_MEMORY' ||
      code === 'ERR_FILE_TOO_LARGE'
    ) {
      return true
    }
    const msg = (err as { message?: unknown }).message
    if (
      typeof msg === 'string' &&
      /out of memory|allocation failed|cannot create a string longer|string length|enomem/i.test(
        msg,
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * Official 2.1.326 #31: streaming low-memory transcript reader. Reads fixed
 * small chunks from disk and parses line-by-line (skipping `attribution-snapshot`
 * rows and oversized corrupt lines) so resumed sessions retain earlier
 * conversation history even when Claude Code runs low on memory.
 */
export async function streamTranscriptFileLowMemory(
  filePath: string,
  onEntries: (entries: Entry[]) => void,
  opts?: { chunkBytes?: number; maxLineBytes?: number },
): Promise<{ linesParsed: number; linesSkipped: number }> {
  const chunkBytes = Math.max(4096, opts?.chunkBytes ?? LOW_MEMORY_CHUNK_BYTES)
  const maxLineBytes = opts?.maxLineBytes ?? LOW_MEMORY_MAX_LINE_BYTES
  const chunkBuf = Buffer.allocUnsafe(chunkBytes)
  const fh = await fsOpen(filePath, 'r')
  let carry = ''
  let droppingOversizedLine = false
  let linesParsed = 0
  let linesSkipped = 0

  const flushLine = (rawLine: string): void => {
    const trimmed = rawLine.trim()
    if (!trimmed) return
    if (trimmed.includes('"type":"attribution-snapshot"')) return
    try {
      const parsed = jsonParse(trimmed) as Entry
      if (parsed && typeof parsed === 'object') {
        onEntries([parsed])
        linesParsed++
      }
    } catch {
      linesSkipped++
    }
  }

  const decoder = new StringDecoder('utf8')

  const processDecodedChunk = (sliceText: string): void => {
    let start = 0
    for (;;) {
      const nl = sliceText.indexOf('\n', start)
      if (nl === -1) {
        const tail = sliceText.slice(start)
        if (!droppingOversizedLine) {
          if (carry.length + tail.length > maxLineBytes) {
            carry = ''
            droppingOversizedLine = true
            linesSkipped++
          } else {
            carry += tail
          }
        }
        break
      }
      const piece = sliceText.slice(start, nl)
      start = nl + 1
      if (droppingOversizedLine) {
        droppingOversizedLine = false
        carry = ''
        continue
      }
      const fullLine = carry ? carry + piece : piece
      carry = ''
      flushLine(fullLine)
    }
  }

  try {
    let offset = 0
    for (;;) {
      const { bytesRead } = await fh.read(chunkBuf, 0, chunkBytes, offset)
      if (bytesRead === 0) break
      offset += bytesRead
      processDecodedChunk(decoder.write(chunkBuf.subarray(0, bytesRead)))
    }
    const trailing = decoder.end()
    if (trailing) {
      processDecodedChunk(trailing)
    }
    if (!droppingOversizedLine && carry) {
      flushLine(carry)
    }
  } finally {
    await fh.close()
  }
  return { linesParsed, linesSkipped }
}

/**
 * Loads and parses a JSONL transcript file.
 * Returns the messages, summaries, custom titles, tags, file history snapshots, and attribution snapshots.
 */
export async function loadTranscriptFile(
  filePath: string,
  opts?: {
    keepAllLeaves?: boolean
    lowMemoryMode?: boolean
    /** Official 2.1.328 (#479): internal flag preventing >1 retry when transcript read ends early. */
    afterEarlyEnd?: boolean
    /** Official 2.1.328 (`vsn`): force slimming duplicated toolUseResult payloads during hydration. */
    slimToolUseResults?: boolean
  },
): Promise<{
  messages: Map<UUID, TranscriptMessage>
  summaries: Map<UUID, string>
  customTitles: Map<UUID, string>
  /** AI-generated tab titles (`ai-title` entries). Distinct from customTitles. */
  aiTitles: Map<UUID, string>
  tags: Map<UUID, string>
  agentNames: Map<UUID, string>
  agentColors: Map<UUID, string>
  agentSettings: Map<UUID, string>
  prNumbers: Map<UUID, number>
  prUrls: Map<UUID, string>
  prRepositories: Map<UUID, string>
  modes: Map<UUID, string>
  /** Official 2.1.328 (`chunk@294254613.js @491708`): last-wins `type:"permission-mode"` per sessionId. */
  permissionModes: Map<UUID, PermissionMode>
  /** Persisted `type:"session-model"` user model selection per sessionId. */
  sessionModels: Map<UUID, string>
  replModes: Map<UUID, boolean>
  worktreeStates: Map<UUID, PersistedWorktreeSession | null>
  /** densable currentSessionDevModsFolder last-wins. */
  devModsFolders: Map<UUID, string>
  goals: Map<UUID, GoalState>
  fileHistorySnapshots: Map<UUID, FileHistorySnapshotMessage>
  attributionSnapshots: Map<UUID, AttributionSnapshotMessage>
  contentReplacements: Map<UUID, ContentReplacementRecord[]>
  agentContentReplacements: Map<AgentId, ContentReplacementRecord[]>
  contextCollapseCommits: ContextCollapseCommitEntry[]
  contextCollapseSnapshot: ContextCollapseSnapshotEntry | undefined
  leafUuids: Set<UUID>
  /**
   * densable 2.1.214 — sessionIds that have an `ended-by-model` marker
   * (unless hard-disable stub eKn() is true — always false in 214).
   */
  endedByModelSessions: Set<UUID>
  /** densable 2.1.223 #8 — last relocatedCwd per sessionId (mid-session /cd). */
  relocatedCwds: Map<UUID, string>
  /**
   * densable bridgeSessionIds — last-wins non-empty bridge-session pointer.
   * Empty-string tombstone deletes the map entry (user-off, 2.1.224 #30).
   */
  bridgeSessionIds: Map<UUID, string>
  bridgeLastSeqs: Map<UUID, number>
  bridgeDialogKindsBySession: Map<UUID, string[]>
  bridgeSessionGroupingIds: Map<UUID, string>
  bridgeNoBackfill: Map<UUID, boolean>
  bridgeOwnerAccountUuids: Map<UUID, string>
  bridgeOwnerOrganizationUuids: Map<UUID, string>
  historySuppressed: Set<UUID>
  /** densable costStates — last-wins `type:"cost-state"` per sessionId. */
  costStates: Map<UUID, CostStateEntry>
  /** Official 2.1.328 (#370/#479): true when transcript read ended short or damaged. */
  readTruncated?: boolean
}> {
  const messages = new Map<UUID, TranscriptMessage>()
  const summaries = new Map<UUID, string>()
  const customTitles = new Map<UUID, string>()
  const aiTitles = new Map<UUID, string>()
  const tags = new Map<UUID, string>()
  const agentNames = new Map<UUID, string>()
  const agentColors = new Map<UUID, string>()
  const agentSettings = new Map<UUID, string>()
  const prNumbers = new Map<UUID, number>()
  const prUrls = new Map<UUID, string>()
  const prRepositories = new Map<UUID, string>()
  const modes = new Map<UUID, string>()
  const permissionModes = new Map<UUID, PermissionMode>()
  const sessionModels = new Map<UUID, string>()
  const replModes = new Map<UUID, boolean>()
  const worktreeStates = new Map<UUID, PersistedWorktreeSession | null>()
  const devModsFolders = new Map<UUID, string>()
  const goals = new Map<UUID, GoalState>()
  const bridgeSessionIds = new Map<UUID, string>()
  const bridgeLastSeqs = new Map<UUID, number>()
  const bridgeDialogKindsBySession = new Map<UUID, string[]>()
  const bridgeSessionGroupingIds = new Map<UUID, string>()
  const bridgeNoBackfill = new Map<UUID, boolean>()
  const bridgeOwnerAccountUuids = new Map<UUID, string>()
  const bridgeOwnerOrganizationUuids = new Map<UUID, string>()
  const historySuppressed = new Set<UUID>()
  const costStates = new Map<UUID, CostStateEntry>()
  const fileHistorySnapshots = new Map<UUID, FileHistorySnapshotMessage>()
  const attributionSnapshots = new Map<UUID, AttributionSnapshotMessage>()
  const contentReplacements = new Map<UUID, ContentReplacementRecord[]>()
  const agentContentReplacements = new Map<
    AgentId,
    ContentReplacementRecord[]
  >()
  // densable: sessions with ended-by-model marker (i.add when !eKn())
  const endedByModelSessions = new Set<UUID>()
  /** densable 2.1.223 #8 — last relocatedCwd per sessionId (mid-session /cd). */
  const relocatedCwds = new Map<UUID, string>()
  // Array, not Map — commit order matters (nested collapses).
  const contextCollapseCommits: ContextCollapseCommitEntry[] = []
  // Last-wins — later entries supersede.
  let contextCollapseSnapshot: ContextCollapseSnapshotEntry | undefined

  // Official #437 + 2.1.328 (#390/#391/#392/#586): track last-prompt
  // rewind/checkpoint state via CheckpointReachTracker so removed turns do not
  // come back, rewind + /clear stays cleared, and new prompts after Stop/rewind
  // are preserved.
  const checkpoint = new CheckpointReachTracker()
  let lastNonSidechainUuid: UUID | undefined
  let readEndedEarly = false
  let expectedFileSize: number | undefined
  const droppedParentMap = new Map<UUID, UUID | null>()

  function isTypedUserPromptRow(msg: TranscriptMessage | undefined): boolean {
    if (!msg || msg.type !== 'user') return false
    const rec = msg as unknown as {
      promptSource?: string
      isMeta?: boolean
    }
    return (
      rec.promptSource !== undefined &&
      rec.promptSource !== 'system' &&
      rec.isMeta !== true
    )
  }

  function findPromptRoot(
    startUuid: UUID,
    cutUuid: UUID | undefined,
  ): UUID | undefined {
    const seen = new Set<UUID>()
    let cur = messages.get(startUuid)
    while (cur && cur.uuid !== cutUuid && !seen.has(cur.uuid)) {
      const rec = cur as unknown as { promptSource?: string }
      if (
        (cur.type === 'user' && rec.promptSource !== undefined) ||
        (cur.type === 'user' && cur.isMeta !== true) ||
        !cur.parentUuid
      ) {
        return cur.uuid
      }
      seen.add(cur.uuid)
      cur = messages.get(cur.parentUuid)
    }
    return undefined
  }

  function hasNewPromptPastRewind(
    rows: Map<UUID, UUID | null> | undefined,
    lastRowUuid: UUID,
    cpUuid: UUID,
    cutUuid: UUID | undefined,
  ): boolean {
    if (!rows) return false
    let sawPrompt = false
    let cur: UUID | null | undefined = lastRowUuid
    for (let i = 0; cur && rows.has(cur) && i < rows.size; i++) {
      const msg = messages.get(cur)
      if (
        !msg ||
        cur === cutUuid ||
        (msg.parentUuid ?? null) !== rows.get(cur)
      ) {
        return false
      }
      if (
        isTypedUserPromptRow(msg) ||
        (msg.type === 'user' && msg.isMeta !== true)
      ) {
        sawPrompt = true
      }
      cur = msg.parentUuid
    }
    if (!sawPrompt || !cur || rows.has(cur)) return false
    const root = findPromptRoot(cur, cutUuid)
    return root !== undefined && root === findPromptRoot(cpUuid, cutUuid)
  }

  try {
    // For large transcripts, avoid materializing megabytes of stale content.
    // Single forward chunked read: attribution-snapshot lines are skipped at
    // the fd level (never buffered), compact boundaries truncate the
    // accumulator in-stream. Peak allocation is the OUTPUT size, not the
    // file size — a 151 MB session that is 84% stale attr-snaps allocates
    // ~32 MB instead of 159+64 MB. This matters because mimalloc does not
    // return those pages to the OS even after JS-level GC frees the backing
    // buffers (measured: arrayBuffers=0 after Bun.gc(true) but RSS stuck at
    // ~316 MB on the old scan+strip path vs ~155 MB here).
    //
    // Pre-boundary metadata (agent-setting, mode, pr-link, etc.) is recovered
    // via a cheap byte-level forward scan of [0, boundary).
    let buf: Buffer | null = null
    let metadataLines: string[] | null = null
    let hasPreservedSegment = false
    let tailTorn: boolean | undefined
    let useStreamingLowMemory = opts?.lowMemoryMode === true
    // Official DISABLE_PRECOMPACT_SKIP densable.
    const precompactSkipDisabled = isPrecompactSkipDisabled()
    if (!useStreamingLowMemory) {
      try {
        if (!precompactSkipDisabled) {
          const { size } = await stat(filePath)
          expectedFileSize = size
          if (size > SKIP_PRECOMPACT_THRESHOLD) {
            const fastHead = !opts?.keepAllLeaves
              ? await tryLoadResumeHeadRows(filePath, size).catch(() => null)
              : null
            if (fastHead) {
              buf = fastHead.postBoundaryBuf
              hasPreservedSegment = fastHead.hasPreservedSegment
              tailTorn = !(await fileEndsWithNewline(filePath, size))
              const preLines: string[] = []
              fastHead.preservedRows.scan((rowBuf, start, length) => {
                preLines.push(rowBuf.toString('utf8', start, start + length))
              })
              metadataLines = preLines
            } else {
              const scan = await readTranscriptForLoad(filePath, size)
              buf = scan.postBoundaryBuf
              hasPreservedSegment = scan.hasPreservedSegment
              tailTorn = !(await fileEndsWithNewline(filePath, size))
              if (scan.boundaryStartOffset > 0) {
                metadataLines = await scanPreBoundaryMetadata(
                  filePath,
                  scan.boundaryStartOffset,
                )
                // Official 2.1.328 (`Pde`, `chunk@294254613.js @420598, @714199`):
                // persist `resume-head.jsonl` so subsequent loads skip pre-compact bytes.
                const headPath = getResumeHeadPath(
                  filePath,
                  dirname(dirname(filePath)),
                )
                if (headPath) {
                  void planResumeHeadForTranscript(
                    filePath,
                    size,
                    scan.boundaryStartOffset,
                  )
                    .then(planned => {
                      if (planned) {
                        scheduleWriteResumeHead(headPath, planned)
                      }
                    })
                    .catch(() => {})
                }
              }
            }
          }
        }
        if (buf === null) {
          if (expectedFileSize === undefined) {
            try {
              expectedFileSize = (await stat(filePath)).size
            } catch {
              // ignore stat error before readFile
            }
          }
          buf = await readFile(filePath)
          if (
            expectedFileSize !== undefined &&
            expectedFileSize > 0 &&
            buf.length < expectedFileSize
          ) {
            readEndedEarly = true
          }
          tailTorn = buf.length > 0 && buf[buf.length - 1] !== 0x0a
        }
      } catch (readErr) {
        if (isLowMemoryReadError(readErr)) {
          logForDebugging(
            `loadTranscriptFile: low memory reading ${filePath}, falling back to chunked streaming reader`,
            { level: 'warn' },
          )
          buf = null
          useStreamingLowMemory = true
        } else {
          throw readErr
        }
      }
    }
    if (
      buf !== null &&
      tailTorn &&
      !opts?.keepAllLeaves &&
      (filePath === getActiveProjectSessionFile() ||
        filePath === getTranscriptPath())
    ) {
      markTornTailForNextAppend(filePath)
    }
    if (
      buf !== null &&
      !opts?.keepAllLeaves &&
      !hasPreservedSegment &&
      !precompactSkipDisabled &&
      buf.length > SKIP_PRECOMPACT_THRESHOLD
    ) {
      try {
        buf = walkChainBeforeParse(buf)
      } catch (walkErr) {
        if (isLowMemoryReadError(walkErr)) {
          logForDebugging(
            `loadTranscriptFile: low memory in walkChainBeforeParse for ${filePath}, keeping full buffer for chunked parse`,
            { level: 'warn' },
          )
        } else {
          throw walkErr
        }
      }
    }

    // First pass: process metadata-only lines collected during the boundary scan.
    // These populate the session-scoped maps (agentSettings, modes, prNumbers,
    // etc.) for entries written before the compact boundary. Any overlap with
    // the post-boundary buffer is harmless — later values overwrite earlier ones.
    if (metadataLines && metadataLines.length > 0) {
      const metaEntries = parseJSONL<Entry>(
        Buffer.from(metadataLines.join('\n')),
      )
      for (const entry of metaEntries) {
        if (entry.type === 'summary' && entry.leafUuid) {
          summaries.set(entry.leafUuid, entry.summary)
        } else if (entry.type === 'custom-title' && entry.sessionId) {
          customTitles.set(entry.sessionId, entry.customTitle)
        } else if (entry.type === 'ai-title' && entry.sessionId) {
          aiTitles.set(entry.sessionId, entry.aiTitle)
        } else if (entry.type === 'ended-by-model' && entry.sessionId) {
          // densable: eKn() always false → always record marker
          endedByModelSessions.add(entry.sessionId)
        } else if (entry.type === 'tag' && entry.sessionId) {
          tags.set(entry.sessionId, entry.tag)
        } else if (entry.type === 'agent-name' && entry.sessionId) {
          agentNames.set(entry.sessionId, entry.agentName)
        } else if (entry.type === 'agent-color' && entry.sessionId) {
          agentColors.set(entry.sessionId, entry.agentColor)
        } else if (entry.type === 'agent-setting' && entry.sessionId) {
          agentSettings.set(entry.sessionId, entry.agentSetting)
        } else if (entry.type === 'mode' && entry.sessionId) {
          modes.set(entry.sessionId, entry.mode)
        } else if (entry.type === 'permission-mode' && entry.sessionId) {
          permissionModes.set(entry.sessionId, entry.permissionMode)
        } else if (entry.type === 'session-model' && entry.sessionId) {
          sessionModels.set(entry.sessionId, entry.model)
        } else if (
          (entry as { type?: string }).type === 'repl-mode' &&
          'sessionId' in entry &&
          typeof (entry as unknown as { sessionId?: unknown }).sessionId ===
            'string' &&
          typeof (entry as unknown as { replMode?: unknown }).replMode ===
            'boolean'
        ) {
          replModes.set(
            (entry as unknown as { sessionId: UUID }).sessionId,
            (entry as unknown as { replMode: boolean }).replMode,
          )
        } else if (entry.type === 'worktree-state' && entry.sessionId) {
          worktreeStates.set(entry.sessionId, entry.worktreeSession)
        } else if (entry.type === 'dev-mods' && entry.sessionId) {
          if (
            typeof entry.folder === 'string' &&
            leftoverDevModsFolderMatches(entry.folder, entry.sessionId)
          ) {
            devModsFolders.set(entry.sessionId, entry.folder)
          } else {
            logForDebugging(
              'dev mods: dropped a dev-mods entry naming a folder not its own',
            )
          }
        } else if (entry.type === 'goal' && entry.sessionId) {
          goals.set(entry.sessionId, entry.state)
        } else if (entry.type === 'goal-cleared' && entry.sessionId) {
          goals.delete(entry.sessionId)
        } else if (entry.type === 'pr-link' && entry.sessionId) {
          prNumbers.set(entry.sessionId, entry.prNumber)
          prUrls.set(entry.sessionId, entry.prUrl)
          prRepositories.set(entry.sessionId, entry.prRepository)
        } else if (
          entry.type === 'relocated' &&
          entry.sessionId &&
          entry.relocatedCwd
        ) {
          relocatedCwds.set(entry.sessionId as UUID, entry.relocatedCwd)
        } else if (entry.type === 'bridge-session') {
          applyBridgeSessionEntry(
            entry,
            bridgeSessionIds,
            bridgeLastSeqs,
            bridgeDialogKindsBySession,
            bridgeSessionGroupingIds,
            bridgeNoBackfill,
            bridgeOwnerAccountUuids,
            bridgeOwnerOrganizationUuids,
          )
        } else if (entry.type === 'history-suppression' && entry.sessionId) {
          historySuppressed.add(entry.sessionId)
        } else if (entry.type === 'cost-state' && entry.sessionId) {
          costStates.set(entry.sessionId as UUID, entry)
        }
      }
    }

    const progressBridge = new Map<UUID, UUID | null>()
    const hydrateToolUseWindow =
      opts?.slimToolUseResults === true ||
      getHostSessionStorageState().toolResultCopiesOnDiskState === 'slim'
        ? new ToolUseNameWindow()
        : undefined

    const processEntries = (entries: Entry[]): void => {
      for (const entry of entries) {
        // Legacy progress check runs before the Entry-typed else-if chain —
        // progress is not in the Entry union, so checking it after TypeScript
        // has narrowed `entry` intersects to `never`.
        if (isLegacyProgressEntry(entry)) {
          // Chain-resolve through consecutive progress entries so a later
          // message pointing at the tail of a progress run bridges to the
          // nearest non-progress ancestor in one lookup.
          const parent = entry.parentUuid
          progressBridge.set(
            entry.uuid,
            parent && progressBridge.has(parent)
              ? (progressBridge.get(parent) ?? null)
              : parent,
          )
          continue
        }
        let admittedTranscriptEntry: TranscriptMessage | undefined
        if (isTranscriptMessage(entry)) {
          if (entry.type === 'user' || entry.type === 'assistant') {
            const repair = repairTranscriptMessageContent(
              entry.type,
              entry.message,
            )
            if (repair === 'keep') {
              admittedTranscriptEntry = entry
            } else if (repair !== 'drop') {
              admittedTranscriptEntry = {
                ...entry,
                message: {
                  ...(entry.message as unknown as Record<string, unknown>),
                  content: repair.content,
                },
              } as TranscriptMessage
            }
          } else {
            admittedTranscriptEntry = entry
          }
        }
        if (admittedTranscriptEntry) {
          if (
            admittedTranscriptEntry.parentUuid &&
            progressBridge.has(admittedTranscriptEntry.parentUuid)
          ) {
            admittedTranscriptEntry = {
              ...admittedTranscriptEntry,
              parentUuid:
                progressBridge.get(admittedTranscriptEntry.parentUuid) ?? null,
            }
          }
          const isNewMessage = !messages.has(admittedTranscriptEntry.uuid)
          // Official 2.1.328 (#390): when a headless/remote message is resent
          // with the same UUID after a process kill, do NOT clobber its
          // already-recorded parentUuid chain link with null or a disconnected
          // parent.
          const existing = isNewMessage
            ? undefined
            : messages.get(admittedTranscriptEntry.uuid)
          const mergedEntryRaw =
            existing &&
            existing.parentUuid &&
            !admittedTranscriptEntry.parentUuid
              ? { ...admittedTranscriptEntry, parentUuid: existing.parentUuid }
              : admittedTranscriptEntry
          const mergedEntry = hydrateToolUseWindow
            ? slimToolUseResultForResume(mergedEntryRaw, hydrateToolUseWindow)
            : mergedEntryRaw
          messages.set(mergedEntry.uuid, mergedEntry)
          checkpoint.onMessage(mergedEntry, isNewMessage)
          if (!mergedEntry.isSidechain) {
            lastNonSidechainUuid = mergedEntry.uuid
          }
          // Compact boundary: prior marble-origami-commit entries reference
          // messages that won't be in the post-boundary chain. The >5MB
          // backward-scan path discards them naturally by never reading the
          // pre-boundary bytes; the <5MB path reads everything, so discard
          // here. Without this, getStats().collapsedSpans in /context
          // overcounts (projectView silently skips the stale commits but
          // they're still in the log).
          if (isCompactBoundaryMessage(mergedEntry)) {
            contextCollapseCommits.length = 0
            contextCollapseSnapshot = undefined
            checkpoint.onCompactBoundary()
          }
        } else if (entry.type === 'last-prompt') {
          const lp = entry as LastPromptMessage & { cutUuid?: UUID }
          checkpoint.onLastPrompt({
            leafUuid: lp.leafUuid as UUID | null | undefined,
            explicit: lp.explicit,
            rewound: lp.rewound,
            cutUuid: lp.cutUuid,
          })
        } else if (
          'uuid' in entry &&
          typeof (entry as unknown as { uuid?: unknown }).uuid === 'string' &&
          'parentUuid' in entry &&
          ['user', 'assistant', 'system', 'attachment', 'progress'].includes(
            (entry as unknown as { type?: string }).type ?? '',
          )
        ) {
          // Official 2.1.328 (#391) `vrn`: remember dropped/non-transcript row
          // parent pointers (only when uuid is not already admitted) so
          // surviving children re-link cleanly.
          const droppedRec = entry as unknown as {
            uuid: UUID
            parentUuid?: UUID | null
          }
          if (!messages.has(droppedRec.uuid)) {
            const rawParent = droppedRec.parentUuid ?? null
            const bridgedParent =
              rawParent && progressBridge.has(rawParent)
                ? (progressBridge.get(rawParent) ?? null)
                : rawParent
            droppedParentMap.set(droppedRec.uuid, bridgedParent)
          }
        } else if (entry.type === 'summary' && entry.leafUuid) {
          summaries.set(entry.leafUuid, entry.summary)
        } else if (entry.type === 'custom-title' && entry.sessionId) {
          customTitles.set(entry.sessionId, entry.customTitle)
        } else if (entry.type === 'ai-title' && entry.sessionId) {
          aiTitles.set(entry.sessionId, entry.aiTitle)
        } else if (entry.type === 'ended-by-model' && entry.sessionId) {
          // densable: if (X.type==="ended-by-model"&&X.sessionId&&!eKn()) i.add
          endedByModelSessions.add(entry.sessionId)
        } else if (entry.type === 'tag' && entry.sessionId) {
          tags.set(entry.sessionId, entry.tag)
        } else if (entry.type === 'agent-name' && entry.sessionId) {
          agentNames.set(entry.sessionId, entry.agentName)
        } else if (entry.type === 'agent-color' && entry.sessionId) {
          agentColors.set(entry.sessionId, entry.agentColor)
        } else if (entry.type === 'agent-setting' && entry.sessionId) {
          agentSettings.set(entry.sessionId, entry.agentSetting)
        } else if (entry.type === 'mode' && entry.sessionId) {
          modes.set(entry.sessionId, entry.mode)
        } else if (entry.type === 'permission-mode' && entry.sessionId) {
          permissionModes.set(entry.sessionId, entry.permissionMode)
        } else if (entry.type === 'session-model' && entry.sessionId) {
          sessionModels.set(entry.sessionId, entry.model)
        } else if (
          (entry as { type?: string }).type === 'repl-mode' &&
          'sessionId' in entry &&
          typeof (entry as unknown as { sessionId?: unknown }).sessionId ===
            'string' &&
          typeof (entry as unknown as { replMode?: unknown }).replMode ===
            'boolean'
        ) {
          replModes.set(
            (entry as unknown as { sessionId: UUID }).sessionId,
            (entry as unknown as { replMode: boolean }).replMode,
          )
        } else if (entry.type === 'worktree-state' && entry.sessionId) {
          worktreeStates.set(entry.sessionId, entry.worktreeSession)
        } else if (entry.type === 'dev-mods' && entry.sessionId) {
          if (
            typeof entry.folder === 'string' &&
            leftoverDevModsFolderMatches(entry.folder, entry.sessionId)
          ) {
            devModsFolders.set(entry.sessionId, entry.folder)
          } else {
            logForDebugging(
              'dev mods: dropped a dev-mods entry naming a folder not its own',
            )
          }
        } else if (entry.type === 'goal' && entry.sessionId) {
          goals.set(entry.sessionId, entry.state)
        } else if (entry.type === 'goal-cleared' && entry.sessionId) {
          goals.delete(entry.sessionId)
        } else if (entry.type === 'pr-link' && entry.sessionId) {
          prNumbers.set(entry.sessionId, entry.prNumber)
          prUrls.set(entry.sessionId, entry.prUrl)
          prRepositories.set(entry.sessionId, entry.prRepository)
        } else if (entry.type === 'file-history-snapshot') {
          fileHistorySnapshots.set(entry.messageId, entry)
        } else if (entry.type === 'attribution-snapshot') {
          attributionSnapshots.set(entry.messageId, entry)
        } else if (entry.type === 'content-replacement') {
          // Subagent decisions key by agentId (sidechain resume); main-thread
          // decisions key by sessionId (/resume).
          if (entry.agentId) {
            const existing = agentContentReplacements.get(entry.agentId) ?? []
            agentContentReplacements.set(entry.agentId, existing)
            existing.push(...entry.replacements)
          } else {
            const existing = contentReplacements.get(entry.sessionId) ?? []
            contentReplacements.set(entry.sessionId, existing)
            existing.push(...entry.replacements)
          }
        } else if (entry.type === 'marble-origami-commit') {
          contextCollapseCommits.push(entry)
        } else if (entry.type === 'marble-origami-snapshot') {
          contextCollapseSnapshot = entry
        } else if (
          entry.type === 'relocated' &&
          entry.sessionId &&
          entry.relocatedCwd
        ) {
          // densable 2.1.223 #8 — last-wins per sessionId
          relocatedCwds.set(entry.sessionId as UUID, entry.relocatedCwd)
        } else if (entry.type === 'bridge-session') {
          applyBridgeSessionEntry(
            entry,
            bridgeSessionIds,
            bridgeLastSeqs,
            bridgeDialogKindsBySession,
            bridgeSessionGroupingIds,
            bridgeNoBackfill,
            bridgeOwnerAccountUuids,
            bridgeOwnerOrganizationUuids,
          )
        } else if (entry.type === 'history-suppression' && entry.sessionId) {
          historySuppressed.add(entry.sessionId)
        } else if (entry.type === 'cost-state' && entry.sessionId) {
          costStates.set(entry.sessionId as UUID, entry)
        }
      }
    }

    // #139 + #31: parse & process large transcripts in chunks with setImmediate
    // yields, or stream directly from disk when low on memory so earlier
    // conversation history is preserved.
    const TRANSCRIPT_PARSE_CHUNK_BYTES = 256 * 1024
    if (useStreamingLowMemory) {
      await streamTranscriptFileLowMemory(filePath, processEntries)
    } else if (buf !== null && buf.length <= TRANSCRIPT_PARSE_CHUNK_BYTES) {
      try {
        processEntries(parseJSONL<Entry>(buf))
      } catch (parseErr) {
        if (isLowMemoryReadError(parseErr)) {
          await streamTranscriptFileLowMemory(filePath, processEntries)
        } else {
          throw parseErr
        }
      }
    } else if (buf !== null) {
      let offset = 0
      while (offset < buf.length) {
        let end = Math.min(offset + TRANSCRIPT_PARSE_CHUNK_BYTES, buf.length)
        if (end < buf.length) {
          const nl = buf.indexOf(0x0a, end)
          end = nl === -1 ? buf.length : nl + 1
        }
        processEntries(parseJSONL<Entry>(buf.subarray(offset, end)))
        offset = end
        if (offset < buf.length) {
          await new Promise<void>(resolve => setImmediate(resolve))
        }
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }

  // Official 2.1.328 (#391): re-link children whose parent was a dropped row.
  relinkDroppedTranscriptRows(messages, droppedParentMap)
  applyPreservedSegmentRelinks(messages)
  applySnipRemovals(messages)

  // Official 2.1.326 #30 + 2.1.328 #562/#645: bridge dangling parentUuid gaps
  // on cloud/CCR sessions (local sessions use non-mutating 5s fallback in
  // buildConversationChain).
  const isCloudOrCcrSession =
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
    Boolean(process.env.CLAUDE_CODE_REMOTE_SESSION_ID)
  if (lastNonSidechainUuid && isCloudOrCcrSession) {
    bridgeBrokenParentChain(messages, lastNonSidechainUuid)
  }

  // Compute leaf UUIDs once at load time
  const allMessages = [...messages.values()]

  // Standard leaf computation using parent relationships
  const parentUuids = new Set(
    allMessages
      .map(msg => msg.parentUuid)
      .filter((uuid): uuid is UUID => uuid !== null),
  )

  // Find all terminal messages (messages with no children)
  const terminalMessages = allMessages.filter(msg => !parentUuids.has(msg.uuid))

  let leafUuids = new Set<UUID>()
  let hasCycle = false

  if (!opts?.keepAllLeaves && checkpoint.cleared) {
    // Rewound to before the first message or explicitly cleared via `/clear`:
    // return empty leafUuids so removed/cleared turns do not come back on resume.
  } else if (
    !opts?.keepAllLeaves &&
    checkpoint.checkpointLeafUuid &&
    messages.has(checkpoint.checkpointLeafUuid)
  ) {
    let selectedUuid: UUID = checkpoint.checkpointLeafUuid
    if (
      lastNonSidechainUuid &&
      lastNonSidechainUuid !== checkpoint.checkpointLeafUuid &&
      hasNewPromptPastRewind(
        checkpoint.postRewindRows,
        lastNonSidechainUuid,
        checkpoint.checkpointLeafUuid,
        checkpoint.rewindCutUuid,
      )
    ) {
      selectedUuid = lastNonSidechainUuid
    }
    const seen = new Set<UUID>()
    let current: TranscriptMessage | undefined = messages.get(selectedUuid)
    while (current) {
      if (seen.has(current.uuid)) {
        hasCycle = true
        break
      }
      seen.add(current.uuid)
      if (current.type === 'user' || current.type === 'assistant') {
        leafUuids.add(current.uuid)
        break
      }
      current = current.parentUuid
        ? messages.get(current.parentUuid)
        : undefined
    }
  } else {
    // Official 2.1.328 (`chunk@294254613.js @705342`): unconditionally build
    // `hasUserAssistantChild` and pass it into `Jnn` (no invented GB gate).
    const hasUserAssistantChild = new Set<UUID>()
    for (const msg of allMessages) {
      if (msg.parentUuid && (msg.type === 'user' || msg.type === 'assistant')) {
        hasUserAssistantChild.add(msg.parentUuid)
      }
    }
    const resolved = resolveTerminalConversationalAncestors(
      terminalMessages,
      messages,
      hasUserAssistantChild,
    )
    leafUuids = resolved.leafUuids
    hasCycle = resolved.hasCycle
  }

  if (hasCycle) {
    logEvent('tengu_transcript_parent_cycle', {})
  }

  // 2.1.309 #1139: Fall back to `<dir>/<sessionId>/custom-title.json` sidecar
  // when custom-title is absent from the JSONL transcript.
  const fileSessionId = validateUuid(basename(filePath, '.jsonl'))
  if (fileSessionId && !customTitles.has(fileSessionId)) {
    const sidecarTitle = await readCustomTitleSidecar(filePath, fileSessionId)
    if (sidecarTitle) {
      customTitles.set(fileSessionId, sidecarTitle)
    }
  }

  const firstResult = {
    messages,
    summaries,
    customTitles,
    aiTitles,
    tags,
    agentNames,
    agentColors,
    agentSettings,
    prNumbers,
    prUrls,
    prRepositories,
    modes,
    permissionModes,
    sessionModels,
    worktreeStates,
    replModes,
    devModsFolders,
    goals,
    fileHistorySnapshots,
    attributionSnapshots,
    contentReplacements,
    agentContentReplacements,
    contextCollapseCommits,
    contextCollapseSnapshot,
    leafUuids,
    endedByModelSessions,
    relocatedCwds,
    bridgeSessionIds,
    bridgeLastSeqs,
    bridgeDialogKindsBySession,
    bridgeSessionGroupingIds,
    bridgeNoBackfill,
    bridgeOwnerAccountUuids,
    bridgeOwnerOrganizationUuids,
    historySuppressed,
    costStates,
    readTruncated: readEndedEarly,
  }

  // Official 2.1.328 (#479) `Wxe`: if the transcript read ended early (fewer
  // bytes than stat size), retry ONCE before returning. Keep the retry result
  // if it returned at least one message; otherwise keep the first read.
  if (readEndedEarly) {
    if (!opts?.afterEarlyEnd) {
      logForDebugging(
        `[sessionStorage] transcript_read_ended_early (loaded_again): ${filePath}`,
      )
      const secondResult = await loadTranscriptFile(filePath, {
        ...opts,
        afterEarlyEnd: true,
      })
      if (secondResult.messages.size > 0) {
        return secondResult
      }
      logForDebugging(
        `[sessionStorage] transcript_read_ended_early (kept_first): ${filePath}`,
      )
      return firstResult
    }
    logForDebugging(
      `[sessionStorage] transcript_read_ended_early (kept_short): ${filePath}`,
    )
  }

  return firstResult
}

/**
 * Loads all messages, summaries, file history snapshots, and attribution snapshots from a specific session file.
 * Return type follows loadTranscriptFile (incl. densable bridge-session maps).
 */
export async function loadSessionFile(
  sessionId: UUID,
): Promise<Awaited<ReturnType<typeof loadTranscriptFile>>> {
  const sessionFile = join(
    getSessionProjectDir() ?? getProjectDir(getOriginalCwd()),
    `${sessionId}.jsonl`,
  )
  return loadTranscriptFile(sessionFile)
}

/**
 * Gets message UUIDs for a specific session without loading all sessions.
 * Cached (bounded per host) to avoid re-reading the same session file multiple
 * times. Concurrent calls for the same `sessionId` share one in-flight
 * load promise.
 *
 * Exported so tests can verify cache eviction behavior directly; not
 * intended as a public API — prefer {@link doesMessageExistInSession}.
 */
export async function getSessionMessages(sessionId: UUID): Promise<Set<UUID>> {
  const sessionMessagesCache = getHostSessionStorageState().sessionMessagesCache
  const existing = sessionMessagesCache.get(sessionId)
  if (existing !== undefined) {
    return existing
  }
  // Evict oldest entry when at capacity so the Map stays bounded.
  if (sessionMessagesCache.size >= MAX_CACHED_SESSION_FILES) {
    const oldestKey = sessionMessagesCache.keys().next().value
    if (oldestKey !== undefined) {
      sessionMessagesCache.delete(oldestKey)
    }
  }
  const promise: Promise<Set<UUID>> = loadSessionFile(sessionId).then(
    ({ messages }) => new Set(messages.keys()),
    err => {
      // #1896: On OOM / RangeError / ERR_STRING_TOO_LONG / read failure, evict
      // the failed promise from the cache and degrade gracefully to an empty
      // Set so transcript appends never hang or stay stuck on a rejected entry.
      if (sessionMessagesCache.get(sessionId) === promise) {
        sessionMessagesCache.delete(sessionId)
      }
      logForDebugging(
        `getSessionMessages: loadSessionFile failed: ${err instanceof Error ? err.message : String(err)}`,
        { level: 'error' },
      )
      return new Set<UUID>()
    },
  )
  sessionMessagesCache.set(sessionId, promise)
  return promise
}

/**
 * Check if a message UUID exists in the session storage
 */
export async function doesMessageExistInSession(
  sessionId: UUID,
  messageUuid: UUID,
): Promise<boolean> {
  const messageSet = await getSessionMessages(sessionId)
  return messageSet.has(messageUuid)
}

/**
 * Retrieves the transcript for a specific agent by agentId.
 * Directly loads the agent-specific transcript file.
 * @param agentId The agent ID to search for
 * @returns The conversation chain and budget replacement records for the agent,
 *          or null if not found
 */
export async function getAgentTranscript(
  agentId: AgentId,
  options?: { signal?: AbortSignal },
): Promise<{
  messages: Message[]
  contentReplacements: ContentReplacementRecord[]
} | null> {
  const signal = options?.signal
  if (signal?.aborted) {
    return null
  }
  const agentFile = getAgentTranscriptPath(agentId)

  // Official 2.1.331 `bde` / `_td` (@316271011): settle in-flight sidechain
  // writes and flush queued writes for this file before reading disk so
  // entering a newly spawned subagent's view never races ENOENT.
  const hostState = getHostSessionStorageState()
  const pendingWrite = hostState.inFlightSidechainWrites.get(agentId)
  if (pendingWrite) {
    await awaitWithOptionalAbort(pendingWrite, signal)
    if (signal?.aborted) {
      return null
    }
  }
  if (hostState.project?.hasPendingWritesForFile(agentFile)) {
    await awaitWithOptionalAbort(hostState.project.flush(), signal)
    if (signal?.aborted) {
      return null
    }
  }

  try {
    const { messages, agentContentReplacements } =
      await loadTranscriptFile(agentFile)
    if (signal?.aborted) {
      return null
    }

    // Find messages with matching agentId
    const agentMessages = Array.from(messages.values()).filter(
      msg => msg.agentId === agentId && msg.isSidechain,
    )

    if (agentMessages.length === 0) {
      return null
    }

    // Find the most recent leaf message with this agentId
    // Official 2.1.328 (@294985027): exclude trailing compact_boundary leaves.
    const parentUuids = new Set(agentMessages.map(msg => msg.parentUuid))
    const leafMessage = findLatestMessage(
      agentMessages,
      msg =>
        !parentUuids.has(msg.uuid) &&
        !(
          msg.type === 'system' &&
          'subtype' in msg &&
          msg.subtype === 'compact_boundary'
        ),
    )

    if (!leafMessage) {
      return null
    }

    // Build the conversation chain
    const transcript = buildConversationChain(messages, leafMessage)

    // Filter to only include messages with this agentId
    const agentTranscript = transcript.filter(msg => msg.agentId === agentId)

    return {
      // Convert TranscriptMessage[] to Message[], drop malformed attachments
      // (`nxe`), and rewrite shutdown-interrupted tool_result blocks (#499 SEA HKr/bxn, updated 2.1.309 #1166 YR)
      messages: rewriteResumedSubagentShutdownToolResults(
        dropMalformedAttachmentsOnLoad(
          agentTranscript.map(({ isSidechain, parentUuid, ...msg }) => msg),
        ),
        "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]",
      ),
      contentReplacements: agentContentReplacements.get(agentId) ?? [],
    }
  } catch {
    return null
  }
}

/**
 * Extract agent IDs from progress messages in the conversation.
 * Agent/skill progress messages have type 'progress' with data.type
 * 'agent_progress' or 'skill_progress' and data.agentId.
 * This captures sync agents that emit progress messages during execution.
 */
export function extractAgentIdsFromMessages(messages: Message[]): string[] {
  const agentIds: string[] = []

  for (const message of messages) {
    if (
      message.type === 'progress' &&
      message.data &&
      typeof message.data === 'object' &&
      'type' in message.data &&
      (message.data.type === 'agent_progress' ||
        message.data.type === 'skill_progress') &&
      'agentId' in message.data &&
      typeof message.data.agentId === 'string'
    ) {
      agentIds.push(message.data.agentId)
    }
  }

  return uniq(agentIds)
}

/**
 * Extract teammate transcripts directly from AppState tasks.
 * In-process teammates store their messages in task.messages,
 * which is more reliable than loading from disk since each teammate turn
 * uses a random agentId for transcript storage.
 */
export function extractTeammateTranscriptsFromTasks(
  tasks: {
    [taskId: string]: {
      type: string
      identity?: { agentId: string }
      messages?: Message[]
    }
  },
  appTranscripts?: {
    [taskId: string]: { messages: readonly Message[] } | undefined
  },
): { [agentId: string]: Message[] } {
  const transcripts: { [agentId: string]: Message[] } = {}

  for (const [taskId, task] of Object.entries(tasks)) {
    if (task.type === 'in_process_teammate' && task.identity?.agentId) {
      const fromStore = appTranscripts?.[taskId]?.messages
      const msgs =
        fromStore && fromStore.length > 0 ? [...fromStore] : task.messages
      if (msgs && msgs.length > 0) {
        transcripts[task.identity.agentId] = msgs
      }
    }
  }

  return transcripts
}

/**
 * Load subagent transcripts for the given agent IDs
 */
export async function loadSubagentTranscripts(
  agentIds: string[],
): Promise<{ [agentId: string]: Message[] }> {
  const results = await Promise.all(
    agentIds.map(async agentId => {
      try {
        const result = await getAgentTranscript(asAgentId(agentId))
        if (result && result.messages.length > 0) {
          return { agentId, transcript: result.messages }
        }
        return null
      } catch {
        // Skip if transcript can't be loaded
        return null
      }
    }),
  )

  const transcripts: { [agentId: string]: Message[] } = {}
  for (const result of results) {
    if (result) {
      transcripts[result.agentId] = result.transcript
    }
  }
  return transcripts
}

// Globs the session's subagents dir directly — unlike AppState.tasks, this survives task eviction.
export async function loadAllSubagentTranscriptsFromDisk(): Promise<{
  [agentId: string]: Message[]
}> {
  if (isDisklessActive()) return {}
  const subagentsDir = join(
    getSessionProjectDir() ?? getProjectDir(getOriginalCwd()),
    getSessionId(),
    'subagents',
  )
  let entries: Dirent[]
  try {
    entries = await readdir(subagentsDir, { withFileTypes: true })
  } catch {
    return {}
  }
  // Filename format is the inverse of getAgentTranscriptPath() — keep in sync.
  const agentIds = entries
    .filter(
      d =>
        d.isFile() && d.name.startsWith('agent-') && d.name.endsWith('.jsonl'),
    )
    .map(d => d.name.slice('agent-'.length, -'.jsonl'.length))
  return loadSubagentTranscripts(agentIds)
}

/**
 * Looks up unresolved tool uses in the transcript by tool_use_id.
 * Returns the assistant message containing the tool_use, or null if not found
 * or the tool call already has a tool_result.
 */
export async function findUnresolvedToolUse(
  toolUseId: string,
): Promise<AssistantMessage | null> {
  try {
    const transcriptPath = getTranscriptPath()
    const { messages } = await loadTranscriptFile(transcriptPath)

    let toolUseMessage = null

    // Find the tool use but make sure there's not also a result
    for (const message of messages.values()) {
      if (message.type === 'assistant') {
        const content = message.message!.content
        if (Array.isArray(content)) {
          for (const block of content as Array<{ type: string; id: string }>) {
            if (block.type === 'tool_use' && block.id === toolUseId) {
              toolUseMessage = message
              break
            }
          }
        }
      } else if (message.type === 'user') {
        const content = message.message!.content
        if (Array.isArray(content)) {
          for (const block of content as Array<{
            type: string
            tool_use_id: string
          }>) {
            if (
              block.type === 'tool_result' &&
              block.tool_use_id === toolUseId
            ) {
              // Found tool result, bail out
              return null
            }
          }
        }
      }
    }

    return toolUseMessage as AssistantMessage | null
  } catch {
    return null
  }
}

/**
 * Loads all logs from a single session file with full message data.
 * Builds a LogOption for each leaf message in the file.
 */
export async function loadAllLogsFromSessionFile(
  sessionFile: string,
  projectPathOverride?: string,
): Promise<LogOption[]> {
  const {
    messages,
    summaries,
    customTitles,
    aiTitles,
    tags,
    agentNames,
    agentColors,
    agentSettings,
    prNumbers,
    prUrls,
    prRepositories,
    modes,
    permissionModes,
    sessionModels,
    replModes,
    fileHistorySnapshots,
    attributionSnapshots,
    contentReplacements,
    leafUuids,
    endedByModelSessions,
    relocatedCwds,
    bridgeSessionIds,
    bridgeLastSeqs,
    bridgeDialogKindsBySession,
    bridgeSessionGroupingIds,
    bridgeNoBackfill,
    bridgeOwnerAccountUuids,
    bridgeOwnerOrganizationUuids,
    historySuppressed,
  } = await loadTranscriptFile(sessionFile, { keepAllLeaves: true })

  if (messages.size === 0) return []

  const leafMessages: TranscriptMessage[] = []
  // Build parentUuid → children index once (O(n)), so trailing-message lookup is O(1) per leaf
  const childrenByParent = new Map<UUID, TranscriptMessage[]>()
  for (const msg of messages.values()) {
    if (leafUuids.has(msg.uuid)) {
      leafMessages.push(msg)
    } else if (msg.parentUuid) {
      const siblings = childrenByParent.get(msg.parentUuid)
      if (siblings) {
        siblings.push(msg)
      } else {
        childrenByParent.set(msg.parentUuid, [msg])
      }
    }
  }

  const logs: LogOption[] = []

  for (const leafMessage of leafMessages) {
    const chain = buildConversationChain(messages, leafMessage)
    if (chain.length === 0) continue

    // Append trailing messages that are children of the leaf
    const trailingMessages = childrenByParent.get(leafMessage.uuid)
    if (trailingMessages) {
      // ISO-8601 UTC timestamps are lexically sortable
      trailingMessages.sort((a, b) =>
        a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
      )
      chain.push(...trailingMessages)
    }

    const firstMessage = chain[0]!
    const sessionId = leafMessage.sessionId as UUID
    const bridgeSessionId = bridgeSessionIds.get(sessionId)

    logs.push({
      date: leafMessage.timestamp,
      messages: dropMalformedAttachmentsOnLoad(removeExtraFields(chain)),
      fullPath: sessionFile,
      value: 0,
      created: new Date(firstMessage.timestamp),
      modified: new Date(leafMessage.timestamp),
      firstPrompt: extractFirstPrompt(chain),
      messageCount: countVisibleMessages(chain),
      isSidechain: firstMessage.isSidechain ?? false,
      sessionId,
      leafUuid: leafMessage.uuid,
      summary: summaries.get(leafMessage.uuid),
      customTitle: customTitles.get(sessionId),
      aiTitle: aiTitles.get(sessionId),
      tag: tags.get(sessionId),
      agentName: agentNames.get(sessionId),
      agentColor: agentColors.get(sessionId),
      agentSetting: agentSettings.get(sessionId),
      mode: modes.get(sessionId) as LogOption['mode'],
      permissionMode: permissionModes.get(sessionId),
      sessionModel: sessionModels.get(sessionId),
      ...(replModes.has(sessionId)
        ? { replMode: replModes.get(sessionId) }
        : {}),
      prNumber: prNumbers.get(sessionId),
      prUrl: prUrls.get(sessionId),
      prRepository: prRepositories.get(sessionId),
      gitBranch: leafMessage.gitBranch,
      // densable 2.1.223 #8 — prefer relocated stamp over first-message cwd
      projectPath:
        projectPathOverride ?? relocatedCwds.get(sessionId) ?? firstMessage.cwd,
      relocatedCwd: relocatedCwds.get(sessionId),
      fileHistorySnapshots: buildFileHistorySnapshotChain(
        fileHistorySnapshots,
        chain,
      ),
      attributionSnapshots: buildAttributionSnapshotChain(
        attributionSnapshots,
        chain,
      ),
      contentReplacements: contentReplacements.get(sessionId) ?? [],
      endedByModel: endedByModelSessions.has(sessionId),
      // densable 2.1.224 #30
      ...(bridgeSessionId
        ? {
            bridgeSessionId,
            bridgeLastSeq: bridgeLastSeqs.get(sessionId),
            bridgeDialogKinds: bridgeDialogKindsBySession.get(sessionId),
            bridgeSessionGroupingId: bridgeSessionGroupingIds.get(sessionId),
            bridgeNoHistoryBackfill: bridgeNoBackfill.get(sessionId),
            bridgeOwnerAccountUuid: bridgeOwnerAccountUuids.get(sessionId),
            bridgeOwnerOrganizationUuid:
              bridgeOwnerOrganizationUuids.get(sessionId),
            sessionHistorySuppressed: historySuppressed.has(sessionId)
              ? true
              : undefined,
          }
        : {}),
    })
  }

  return logs
}
