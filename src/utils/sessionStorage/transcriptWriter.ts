import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
  isSessionPersistenceDisabled,
  switchSession,
} from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import * as sessionIngress from '../../services/api/sessionIngress.js'
import {
  type AgentId,
  type SessionId,
  asAgentId,
  asSessionId,
  toAgentId,
} from '../../types/ids.js'
import type {
  AttributionSnapshotMessage,
  Entry,
  GoalState,
  LastPromptMessage,
  PersistedWorktreeSession,
  RelocatedEntry,
} from '../../types/logs.js'
import type { Message } from '../../types/message.js'
import type { QueueOperationMessage } from '../../types/messageQueueTypes.js'
import type { PermissionMode } from '../../types/permissions.js'
import { updateSessionName } from '../concurrentSessions.js'
import { logForDebugging } from '../debug.js'
import { logForDiagnosticsNoPII } from '../diagLogs.js'
import { isDisklessActive, logDisklessWriteSkipped } from '../disklessGuards.js'
import {
  errorMessage,
  isAbortError,
  isENOENT,
  isFsInaccessible,
} from '../errors.js'
import type { FileHistorySnapshot } from '../fileHistory.js'
import { logError } from '../log.js'
import {
  getAgentTranscriptPath,
  getProjectDir,
  getTranscriptPath,
  getTranscriptPathForSession,
  isChainParticipant,
} from '../sessionPaths.js'
import {
  getPersistenceSuppressCause,
  isPersistenceSuppressed,
} from '../sessionPersistenceStatus.js'
import { LITE_READ_BUF_SIZE } from '../sessionStoragePortable.js'
import { jsonStringify } from '../slowOperations.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'
import { repointTaskOutputSymlinks } from '../task/diskOutput.js'
import type { ContentReplacementRecord } from '../toolResultStorage.js'
import { recordTranscriptWriteFailure } from '../transcriptWriterHealth.js'
import { validateUuid } from '../uuid.js'
import type { UUID } from 'crypto'
import {
  appendFile as fsAppendFile,
  rename as fsRename,
  utimes as fsUtimes,
  mkdir,
  stat,
} from 'fs/promises'
import { dirname, join } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  type CCRHydratePrefetch,
  HISTORY_SUPPRESSION_SCAN_LINE_LIMIT,
  type InternalEventReadResult,
  REHYDRATE_AGENT_NAME_RE,
  type RequestReplayRecords,
  type RequestReplayWriteResult,
  type TeamInfo,
} from './types.js'
import {
  getActiveSessionStorageKey,
  getHostSessionStorageState,
  getSessionMessagesCache,
  hostSessionStorageSlot,
  isForeignBoundSessionMismatch,
  isLiveBridgeSuppressed,
  isNotChainParent,
  isTranscriptPersistenceDisabled,
  notifySessionTitleChanged,
} from './sessionState.js'
import {
  appendEntryToFile,
  hasTornTailSync,
  iterateTranscriptFileLines,
  readFileTailAsync,
  renamePathWithCrossDeviceFallback,
  setAsideExistingTranscript,
  tryAppendRaw,
  writeFileAtomicDurably,
  writeTranscriptPayloads,
} from './fsHelpers.js'
import {
  bindMainSessionTranscriptPersistence,
  collectUuidsFromJsonlContent,
  findIntersectingUuid,
  getValidatedCCRTip,
  isContentBearingPayload,
  isTranscriptUuidPayload,
  lastTranscriptUuidInTail,
  localTranscriptHasContentBearing,
  normalizeInternalEventRead,
  writeCCRTip,
  writeCustomTitleSidecar,
} from './sidecars.js'
import {
  cleanMessagesForLogging,
  hasLeafCheckpointInTranscriptFile,
  isCanonicalSessionTranscriptBasename,
  isHistorySuppressionJsonlLine,
  isReservedAgentName,
  leftoverDevModsFolderMatches,
} from './transcriptChain.js'
import {
  doesMessageExistInSession,
  getSessionMessages,
} from './transcriptLoader.js'
import {
  getCurrentSessionBridge,
  getProject,
  hasInternalEventWriter,
  leftoverAppendEntryToFileAsync,
  leftoverSkn,
  leftoverWdr,
} from './project.js'

/**
 * Official xZi densable — append `observer-ref` to the session transcript.
 * VOu/IZi reads the last matching entry for cross-session reattach.
 */
export async function appendObserverRef(input: {
  observerTaskId: string
  observerAgentType?: string
  armingPermissionMode?: string
  /** Observed agent id; omit for main-session observer. */
  agentId?: string
  sessionId?: string
}): Promise<void> {
  const entry = {
    type: 'observer-ref' as const,
    observerTaskId: input.observerTaskId,
    ...(input.observerAgentType
      ? { observerAgentType: input.observerAgentType }
      : {}),
    ...(input.armingPermissionMode
      ? { armingPermissionMode: input.armingPermissionMode }
      : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    timestamp: new Date().toISOString(),
    sessionId: (input.sessionId ?? getSessionId()) as UUID,
  }
  await getProject().appendEntry(entry)
}

export async function recordTranscript(
  messages: Message[],
  teamInfo?: TeamInfo,
  startingParentUuidHint?: UUID,
  allMessages?: readonly Message[],
): Promise<UUID | null> {
  const cleanedMessages = cleanMessagesForLogging(messages, allMessages)
  const sessionId = getSessionId() as UUID
  const messageSet = await getSessionMessages(sessionId)
  const newMessages: typeof cleanedMessages = []
  let startingParentUuid: UUID | undefined =
    startingParentUuidHint && !isNotChainParent(startingParentUuidHint)
      ? startingParentUuidHint
      : undefined
  let seenNewMessage = false
  for (const m of cleanedMessages) {
    if (messageSet.has(m.uuid as UUID)) {
      // Only track skipped messages that form a prefix. After compaction,
      // messagesToKeep appear AFTER new CB/summary, so this skips them.
      // Official 2.1.323 #1981 (`!F1(Xe.uuid)`): never chain onto an old
      // unresumed interrupted message or a virtualized/reordered row.
      if (
        !seenNewMessage &&
        isChainParticipant(m) &&
        !isNotChainParent(m.uuid) &&
        !(m as { isVirtual?: boolean }).isVirtual
      ) {
        startingParentUuid = m.uuid as UUID
      }
    } else {
      newMessages.push(m)
      seenNewMessage = true
    }
  }
  if (newMessages.length > 0) {
    await getProject().insertMessageChain(
      newMessages,
      false,
      undefined,
      startingParentUuid,
      teamInfo,
    )
  }
  // Return the last ACTUALLY recorded chain-participant's UUID, OR the
  // prefix-tracked UUID if no new chain participants were recorded. This lets
  // callers (useLogMessages) maintain the correct parent chain even when the
  // slice is all-recorded (rewind, /resume scenarios where every message is
  // already in messageSet). Progress is skipped — it's written to the JSONL
  // but nothing chains TO it (see isChainParticipant).
  const lastRecorded = newMessages.findLast(
    m => isChainParticipant(m) && !isNotChainParent(m.uuid),
  )
  return (lastRecorded?.uuid as UUID | undefined) ?? startingParentUuid ?? null
}

export async function recordSidechainTranscript(
  messages: Message[],
  agentId?: string,
  startingParentUuid?: UUID | null,
) {
  const { inFlightSidechainWrites } = getHostSessionStorageState()
  const work = getProject().insertMessageChain(
    cleanMessagesForLogging(messages),
    true,
    agentId,
    startingParentUuid,
  )
  if (!agentId) {
    await work
    return
  }
  const prev = inFlightSidechainWrites.get(agentId)
  const tracked = (prev ? prev.catch(() => {}).then(() => work) : work).finally(
    () => {
      if (inFlightSidechainWrites.get(agentId) === tracked) {
        inFlightSidechainWrites.delete(agentId)
      }
    },
  )
  inFlightSidechainWrites.set(agentId, tracked)
  await work
}

export async function recordQueueOperation(queueOp: QueueOperationMessage) {
  await getProject().insertQueueOperation(queueOp)
}

/**
 * Remove a message from the transcript by UUID.
 * Used when a tombstone is received for an orphaned message.
 */
export async function removeTranscriptMessage(targetUuid: UUID): Promise<void> {
  await getProject().removeMessageByUuid(targetUuid)
}

/**
 * Gold `hRs` @289230666 (#1205 & #1231) — remove a message from the transcript
 * only if it has already been persisted in the current session's transcript.
 */
export async function removeTranscriptMessageIfPersisted(
  targetUuid: UUID,
  _agentId?: AgentId,
): Promise<void> {
  const sessionId = validateUuid(getSessionId())
  if (!sessionId || !(await doesMessageExistInSession(sessionId, targetUuid))) {
    return
  }
  await getProject().removeMessageByUuid(targetUuid)
  const cached = getSessionMessagesCache().get(sessionId)
  if (cached !== undefined) {
    void cached.then(set => set.delete(targetUuid))
  }
}

export async function recordFileHistorySnapshot(
  messageId: UUID,
  snapshot: FileHistorySnapshot,
  isSnapshotUpdate: boolean,
) {
  await getProject().insertFileHistorySnapshot(
    messageId,
    snapshot,
    isSnapshotUpdate,
  )
}

export async function recordAttributionSnapshot(
  snapshot: AttributionSnapshotMessage,
) {
  await getProject().insertAttributionSnapshot(snapshot)
}

export async function recordContentReplacement(
  replacements: ContentReplacementRecord[],
  agentId?: AgentId,
) {
  await getProject().insertContentReplacement(replacements, agentId)
}

/**
 * Reset the session file pointer after switchSession/regenerateSessionId.
 * The new file is created lazily on the first user/assistant message.
 */
export async function resetSessionFilePointer() {
  getProject().resetSessionFile()
}

/**
 * densable tNt — rehome the current session transcript under the project dir
 * for the current originalCwd (after chdir / setOriginalCwd).
 *
 * Call sites: fVo (/cd, set_cwd), EnterWorktree, ExitWorktree.
 * On failure densable rolls back cwd in fVo; callers must treat throw as fatal
 * for the move when they need atomicity.
 */
function safeDisklessTranscriptPath(
  computePath: () => string,
  fallback: string,
): string {
  try {
    return computePath()
  } catch {
    return fallback
  }
}

export async function relocateSessionTranscript(): Promise<void> {
  const sessionId = getSessionId()
  const project = getProject()
  if (isDisklessActive()) {
    let targetProjectDir: string | null = null
    try {
      targetProjectDir = getProjectDir(getOriginalCwd())
    } catch {
      targetProjectDir = null
    }
    logDisklessWriteSkipped(
      'sessionStorage:relocateSessionTranscript',
      targetProjectDir
        ? join(targetProjectDir, `${sessionId}.jsonl`)
        : `${sessionId}.jsonl`,
    )
    project.currentSessionRelocatedCwd = getOriginalCwd()
    if (targetProjectDir !== null) {
      switchSession(asSessionId(sessionId), targetProjectDir)
    }
    return
  }
  const targetProjectDir = getProjectDir(getOriginalCwd())
  const { leftoverAppendSerial } = getHostSessionStorageState()
  const currentFile = project.sessionFile

  // densable: no materialised file or persistence suppressed → just pin relocated cwd + project dir
  if (currentFile === null || getPersistenceSuppressCause() !== null) {
    project.currentSessionRelocatedCwd = getOriginalCwd()
    switchSession(asSessionId(sessionId), targetProjectDir)
    return
  }

  const targetFile = join(targetProjectDir, `${sessionId}.jsonl`)

  // Same jsonl path — still may need a relocated stamp if cwd string changed
  if (currentFile === targetFile) {
    switchSession(asSessionId(sessionId), targetProjectDir)
    const cwd = getOriginalCwd()
    if (project.currentSessionRelocatedCwd !== cwd) {
      project.currentSessionRelocatedCwd = cwd
      const stamp: RelocatedEntry = {
        type: 'relocated',
        sessionId,
        relocatedCwd: cwd,
      }
      project.beginTranscriptRelocation()
      project.openAppendRelocationBracket(currentFile)
      try {
        await project.flush()
        await leftoverAppendSerial.settle()
        const line = jsonStringify(stamp) + '\n'
        if (await tryAppendRaw(currentFile, line)) {
          project.fireMirror(currentFile, [stamp])
        }
      } catch (e) {
        logForDebugging(
          `relocateSessionTranscript: same-target relocated stamp failed: ${e}`,
        )
      } finally {
        leftoverSkn(currentFile)
        await project.endTranscriptRelocation()
      }
    }
    return
  }

  // Real move: buffer mid-rehome writes, flush, rename jsonl + session sidecar dir
  project.beginTranscriptRelocation()
  project.openAppendRelocationBracket(currentFile)
  try {
    await project.flush()
    await leftoverAppendSerial.settle()
    await mkdir(targetProjectDir, { recursive: true, mode: 0o700 })

    // densable S0e: Promise.all(ly(Mg(d), {bigint:!0}), ly(o, {bigint:!0}))
    // compares project dirs, not jsonl. Y is ENOENT-only.
    let sameInode = false
    try {
      const [sourceStat, destStat] = await Promise.all([
        stat(dirname(currentFile), { bigint: true }),
        stat(targetProjectDir, { bigint: true }),
      ])
      sameInode =
        sourceStat.dev === destStat.dev && sourceStat.ino === destStat.ino
    } catch (e) {
      if (!isENOENT(e)) throw e
    }
    const setAside = sameInode
      ? undefined
      : await setAsideExistingTranscript(targetFile)

    let jsonlMoved = true
    try {
      await renamePathWithCrossDeviceFallback(currentFile, targetFile)
    } catch (e) {
      if (isENOENT(e)) {
        if (setAside !== undefined) {
          await fsRename(setAside, targetFile).catch(restoreErr => {
            logForDebugging(
              `relocateSessionTranscript: could not restore set-aside destination after ENOENT move: ${restoreErr}`,
              { level: 'warn' },
            )
          })
          throw e
        }
        logForDebugging(`relocateSessionTranscript: old file missing: ${e}`)
        jsonlMoved = false
      } else {
        if (setAside !== undefined) {
          await fsRename(setAside, targetFile).catch(restoreErr => {
            logForDebugging(
              `relocateSessionTranscript: could not restore set-aside destination after failed move: ${restoreErr}`,
              { level: 'warn' },
            )
          })
        }
        throw e
      }
    }

    const oldSide = join(dirname(currentFile), sessionId)
    const newSide = join(targetProjectDir, sessionId)
    let sideMoved = true
    try {
      await renamePathWithCrossDeviceFallback(oldSide, newSide)
    } catch (e) {
      sideMoved = false
      if (!isENOENT(e)) {
        logError(e)
      }
    }

    project.setSessionFile(targetFile)
    switchSession(asSessionId(sessionId), targetProjectDir)
    project.currentSessionRelocatedCwd = getOriginalCwd()

    if (jsonlMoved) {
      try {
        const stamp: RelocatedEntry = {
          type: 'relocated',
          sessionId,
          relocatedCwd: project.currentSessionRelocatedCwd,
        }
        await tryAppendRaw(targetFile, jsonStringify(stamp) + '\n')
      } catch (e) {
        logForDebugging(
          `relocateSessionTranscript: relocated stamp failed: ${e}`,
        )
      }
    }

    if (sideMoved) {
      try {
        await repointTaskOutputSymlinks(oldSide, newSide)
      } catch (e) {
        logError(e)
      }
    }
  } finally {
    leftoverSkn(project.sessionFile ?? currentFile)
    await project.endTranscriptRelocation()
  }
}

/**
 * Adopt the existing session file after --continue/--resume (non-fork).
 * Call after switchSession + resetSessionFilePointer + restoreSessionMetadata:
 * getTranscriptPath() now derives the resumed file's path from the switched
 * sessionId, and the cache holds the final metadata (--name title, resumed
 * mode/tag/agent).
 *
 * Setting sessionFile here — instead of waiting for materializeSessionFile
 * on the first user message — lets the exit cleanup handler's
 * reAppendSessionMetadata run (it bails when sessionFile is null). Without
 * this, `-c -n foo` + quit-before-message drops the title on the floor:
 * the in-memory cache is correct but never written. The resumed file
 * already exists on disk (we loaded from it), so this can't create an
 * orphan the way a fresh --name session would.
 *
 * skipTitleRefresh: restoreSessionMetadata populated the cache from the
 * same disk read microseconds ago, so refreshing from the tail here is a
 * no-op — unless --name was used, in which case it would clobber the fresh
 * CLI title with the stale disk value. After this write, disk == cache and
 * later calls (compaction, exit cleanup) absorb SDK writes normally.
 */
export function adoptResumedSessionFile(): void {
  const project = getProject()
  const sessionFile = getTranscriptPath()
  project.setSessionFile(sessionFile)
  if (hasTornTailSync(sessionFile)) {
    leftoverWdr(sessionFile)
  }
  if (!isDisklessActive()) {
    const now = new Date()
    fsUtimes(sessionFile, now, now).catch(() => {})
  }
  try {
    project.reAppendSessionMetadata(true)
  } catch (error) {
    if (isFsInaccessible(error)) {
      logForDebugging(
        `Resume re-append failed (${error.code}): ${errorMessage(error)}`,
        { level: 'error' },
      )
    } else {
      logError(error)
    }
    recordTranscriptWriteFailure(
      'adopt',
      error,
      project.sessionFile ?? sessionFile,
    )
  }
}

/**
 * Append a context-collapse commit entry to the transcript. One entry per
 * commit, in commit order. On resume these are collected into an ordered
 * array and handed to restoreFromEntries() which rebuilds the commit log.
 */
export async function recordContextCollapseCommit(commit: {
  collapseId: string
  summaryUuid: string
  summaryContent: string
  summary: string
  firstArchivedUuid: string
  lastArchivedUuid: string
}): Promise<void> {
  const sessionId = getSessionId() as UUID
  if (!sessionId) return
  await getProject().appendEntry({
    type: 'marble-origami-commit',
    sessionId,
    ...commit,
  })
}

/**
 * Snapshot the staged queue + spawn state. Written after each ctx-agent
 * spawn resolves (when staged contents may have changed). Last-wins on
 * restore — the loader keeps only the most recent snapshot entry.
 */
export async function recordContextCollapseSnapshot(snapshot: {
  staged: Array<{
    startUuid: string
    endUuid: string
    summary: string
    risk: number
    stagedAt: number
  }>
  armed: boolean
  lastSpawnTokens: number
}): Promise<void> {
  const sessionId = getSessionId() as UUID
  if (!sessionId) return
  await getProject().appendEntry({
    type: 'marble-origami-snapshot',
    sessionId,
    ...snapshot,
  })
}

export async function flushSessionStorage(): Promise<void> {
  await getProject().flush()
}

/**
 * Flush the active host's `Project` ONLY if one has already been initialized
 * (without lazily instantiating `new Project` on sessions that never persisted
 * anything).
 */
export async function flushSessionStorageIfInitialized(): Promise<void> {
  const state = hostSessionStorageSlot.peek(getActiveSessionStorageKey())
  if (!state || state.project === null) {
    return
  }
  await state.project.flush()
}

export async function hydrateRemoteSession(
  sessionId: string,
  ingressUrl: string,
): Promise<boolean> {
  switchSession(asSessionId(sessionId), null, 'remote_attach')

  const project = getProject()

  try {
    const remoteLogs =
      (await sessionIngress.getSessionLogs(sessionId, ingressUrl)) || []

    // Ensure the project directory and session file exist (#1992: honor sessionProjectDir)
    if (isDisklessActive()) {
      logDisklessWriteSkipped(
        'sessionStorage:hydrateRemoteSession',
        safeDisklessTranscriptPath(
          () => getTranscriptPathForSession(sessionId),
          `${sessionId}.jsonl`,
        ),
      )
    } else {
      const projectDir =
        getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
      await mkdir(projectDir, { recursive: true, mode: 0o700 })

      const sessionFile = getTranscriptPathForSession(sessionId)

      // Replace local logs atomically + fsync (#2138) so a sudden stop never
      // leaves an unreadable history file.
      const content = remoteLogs.map(e => jsonStringify(e) + '\n').join('')
      await writeFileAtomicDurably(sessionFile, content, 0o600)
    }

    logForDebugging(`Hydrated ${remoteLogs.length} entries from remote`)
    return remoteLogs.length > 0
  } catch (error) {
    logForDebugging(`Error hydrating session from remote: ${error}`)
    logForDiagnosticsNoPII('error', 'hydrate_remote_session_fail')
    return false
  } finally {
    // Set remote ingress URL after hydrating the remote session
    // to ensure we've always synced with the remote session
    // prior to enabling persistence
    project.setRemoteIngressUrl(ingressUrl)
  }
}

/**
 * densable Q0a — hydrate session state from CCR v2 internal events.
 *
 * With `tengu_ccr_delta_rehydrate` + validated `.ccr-tip.json` sidecar, fetch
 * only after_event_id and append the delta instead of rewriting the full
 * transcript (fixes 2.1.225 #10 growing backlog / false stuck on reconnect).
 *
 * Prefetch form: hydratePrefetch = [fgRead, subagentRead, tipValidation].
 */
export async function hydrateFromCCRv2InternalEvents(
  sessionId: string,
  prefetch?: CCRHydratePrefetch | null,
  enableDelta: boolean = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_ccr_delta_rehydrate',
    false,
  ),
  skipSubagentOnDelta: boolean = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_ccr_subagent_skip_on_delta',
    false,
  ),
): Promise<boolean> {
  const startMs = Date.now()
  switchSession(asSessionId(sessionId), null, 'remote_attach')

  const project = getProject()
  const reader = project.getInternalEventReader()
  if (!reader) {
    logForDebugging('No internal event reader registered for CCR v2 resume')
    return false
  }

  try {
    const sessionFile = isDisklessActive()
      ? safeDisklessTranscriptPath(
          () => getTranscriptPathForSession(sessionId),
          `${sessionId}.jsonl`,
        )
      : getTranscriptPathForSession(sessionId)
    const tailPromise = readFileTailAsync(
      sessionFile,
      LITE_READ_BUF_SIZE,
    ).catch(() => null)

    let fgRead: InternalEventReadResult | null
    let tipEventId: string | undefined
    let fallbackReason: string | undefined

    if (prefetch) {
      fgRead = normalizeInternalEventRead(prefetch[0] ?? null)
      tipEventId = prefetch[2]?.eventId
      fallbackReason = prefetch[2]?.fallbackReason
    } else {
      const tip = await getValidatedCCRTip(
        sessionId,
        enableDelta,
        await tailPromise,
      )
      tipEventId = tip.eventId
      fallbackReason = tip.fallbackReason
      const raw = await reader(tipEventId)
      fgRead = normalizeInternalEventRead(raw)
    }

    if (!fgRead) {
      logForDebugging('Failed to read internal events for resume')
      logForDiagnosticsNoPII('error', 'hydrate_ccr_v2_read_fail')
      return false
    }

    let events = fgRead.events
    const stats = fgRead.stats
    // Official 2.1.323 #1992: honor sessionProjectDir so hydrated transcripts
    // land in the pinned session directory.
    if (isDisklessActive()) {
      logDisklessWriteSkipped(
        'sessionStorage:hydrateFromCCRv2InternalEvents',
        safeDisklessTranscriptPath(
          () => getSessionProjectDir() ?? getProjectDir(getOriginalCwd()),
          sessionId,
        ),
      )
    } else {
      const projectDir =
        getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
      await mkdir(projectDir, { recursive: true, mode: 0o700 })
    }

    const onDisk = await tailPromise
    const onDiskBytes = onDisk?.bytesTotal ?? 0
    const onDiskLastUuid = onDisk
      ? lastTranscriptUuidInTail(onDisk.content)
      : undefined

    let intersect: { uuid: string; walkback: number } | undefined
    let anchorIndex: number | undefined
    if (onDisk) {
      if (tipEventId === undefined) {
        const serverMap = new Map<string, number>()
        for (let j = 0; j < events.length; j++) {
          const u = events[j]?.payload?.uuid
          if (typeof u === 'string') serverMap.set(u, j)
        }
        intersect = findIntersectingUuid(onDisk.content, serverMap)
        if (intersect) {
          anchorIndex = serverMap.get(intersect.uuid)
        }
      }
    }

    const deltaEvents =
      anchorIndex === undefined
        ? events.length
        : events.length - 1 - anchorIndex

    const anchorFallback = fgRead.anchorFallback !== undefined
    const tipInResponse =
      tipEventId !== undefined &&
      !anchorFallback &&
      events.some(ev =>
        ev.event_id !== undefined
          ? ev.event_id === tipEventId
          : ev.payload?.uuid === tipEventId,
      )
    const localUuidSet =
      tipEventId !== undefined && onDisk
        ? collectUuidsFromJsonlContent(onDisk.content)
        : null
    // Official 2.1.323 #2141: if delta events include a compact boundary whose
    // `preservedMessages.anchorUuid === uuid`, force a full rewrite instead of
    // delta-appending so answers/messages preserved across compaction are never
    // lost after a restart in a long conversation.
    const deltaHasPreservedCompactAnchor = events.some(ev => {
      const p = ev.payload as {
        uuid?: unknown
        compactMetadata?: { preservedMessages?: { anchorUuid?: unknown } }
      }
      return (
        typeof p?.uuid === 'string' &&
        p.compactMetadata?.preservedMessages?.anchorUuid === p.uuid
      )
    })
    const tipInLocalTailAndEndsCleanly =
      tipEventId !== undefined &&
      onDisk !== null &&
      localUuidSet !== null &&
      localUuidSet.has(tipEventId) &&
      onDisk.content.endsWith('\n') &&
      !deltaHasPreservedCompactAnchor

    let appliedDelta = false
    let wroteForeground = false
    let workingEvents = events

    if (tipEventId && !anchorFallback && !tipInResponse) {
      if (!tipInLocalTailAndEndsCleanly) {
        fallbackReason = 'tail-incoherent'
        const full = normalizeInternalEventRead(await reader())
        if (!full) {
          logForDebugging(
            'Failed to refetch full read after incoherent local tail',
          )
          logForDiagnosticsNoPII('error', 'hydrate_ccr_v2_read_fail')
          return false
        }
        workingEvents = full.events
      }
    }

    if (
      tipEventId &&
      !anchorFallback &&
      !tipInResponse &&
      tipInLocalTailAndEndsCleanly
    ) {
      const newPayloads = events
        .map(e => e.payload)
        .filter(p => {
          const u = p.uuid
          return typeof u !== 'string' || !localUuidSet!.has(u)
        })
      if (newPayloads.length > 0) {
        await writeTranscriptPayloads(sessionFile, newPayloads, 'a')
      }
      appliedDelta = true
      wroteForeground = true
      logForDebugging(
        `Hydrated delta: appended ${newPayloads.length}/${events.length} foreground entries from CCR v2 internal events`,
      )
    } else {
      if (tipEventId && fallbackReason !== 'tail-incoherent') {
        fallbackReason =
          fgRead.anchorFallback === 'rejected'
            ? 'anchor-rejected'
            : fgRead.anchorFallback === 'not-found'
              ? 'anchor-not-found'
              : 'anchor-in-response'
      }
      if (
        !workingEvents.some(e => isContentBearingPayload(e.payload)) &&
        !isDisklessActive() &&
        (await localTranscriptHasContentBearing(sessionFile))
      ) {
        logForDebugging(
          `Skipping CCR v2 foreground hydration: fetched set of ${workingEvents.length} events has no content-bearing entries but the local transcript does`,
        )
        logForDiagnosticsNoPII('info', 'hydrate_skip_zero_content_replace', {
          path: 'v2_foreground',
          server_entry_count: workingEvents.length,
        })
      } else {
        await writeTranscriptPayloads(
          sessionFile,
          workingEvents.map(e => e.payload),
          'w',
        )
        wroteForeground = true
        logForDebugging(
          `Hydrated ${workingEvents.length} foreground entries from CCR v2 internal events`,
        )
      }
    }

    // densable: after successful write, tip = last foreground transcript event
    const tipSource = appliedDelta ? events : workingEvents
    // densable Ctf(e, j.event_id ?? j.payload.uuid) — prefer server event_id
    // when present (matches after_event_id), else transcript payload uuid.
    if (wroteForeground) {
      for (let k = tipSource.length - 1; k >= 0; k--) {
        const row = tipSource[k]
        if (row && isTranscriptUuidPayload(row.payload)) {
          const tipId =
            typeof row.event_id === 'string' && row.event_id.length > 0
              ? row.event_id
              : row.payload.uuid
          await writeCCRTip(sessionId, tipId)
          break
        }
      }
    }

    let subagentEventCount = 0
    let subagentStats: InternalEventReadResult['stats'] | undefined
    const skipSubagent =
      skipSubagentOnDelta &&
      appliedDelta &&
      (!prefetch || prefetch[1] === undefined)
    const subagentReader = project.getInternalSubagentEventReader()
    if (subagentReader && !skipSubagent) {
      const subRaw =
        prefetch && prefetch[1] !== undefined
          ? prefetch[1]
          : await subagentReader()
      const subRead = normalizeInternalEventRead(subRaw ?? null)
      subagentStats = subRead?.stats
      const subEvents = subRead?.events
      if (subEvents && subEvents.length > 0) {
        subagentEventCount = subEvents.length
        const byAgent = new Map<string, Record<string, unknown>[]>()
        for (const e of subEvents) {
          const agentId = e.session_agent_id || e.agent_id || ''
          if (!agentId) continue
          let list = byAgent.get(agentId)
          if (!list) {
            list = []
            byAgent.set(agentId, list)
          }
          list.push(e.payload)
        }
        for (const [agentId, entries] of byAgent) {
          const agentFile = isDisklessActive()
            ? safeDisklessTranscriptPath(
                () => getAgentTranscriptPath(asAgentId(agentId)),
                `agent-${agentId}.jsonl`,
              )
            : getAgentTranscriptPath(asAgentId(agentId))
          if (isDisklessActive()) {
            logDisklessWriteSkipped(
              'sessionStorage:hydrateFromCCRv2InternalEvents:subagent',
              agentFile,
            )
            continue
          }
          if (
            !entries.some(isContentBearingPayload) &&
            (await localTranscriptHasContentBearing(agentFile))
          ) {
            logForDiagnosticsNoPII(
              'info',
              'hydrate_skip_zero_content_replace',
              {
                path: 'v2_subagent',
                server_entry_count: entries.length,
              },
            )
            continue
          }
          await mkdir(dirname(agentFile), { recursive: true, mode: 0o700 })
          await writeTranscriptPayloads(agentFile, entries, 'w')
        }
        logForDebugging(
          `Hydrated ${subEvents.length} subagent entries across ${byAgent.size} agents`,
        )
      }
    }

    const completedEvents = appliedDelta ? events : workingEvents
    logForDiagnosticsNoPII('info', 'hydrate_ccr_v2_completed', {
      duration_ms: Date.now() - startMs,
      event_count: completedEvents.length,
      subagent_event_count: subagentEventCount,
      page_count: stats?.pageCount,
      bytes_received: stats?.bytesReceived,
      content_encoding: stats?.contentEncoding,
      subagent_page_count: subagentStats?.pageCount,
      subagent_bytes_received: subagentStats?.bytesReceived,
      prefetched: prefetch?.[0] != null,
      on_disk_bytes: onDiskBytes,
      delta_events: deltaEvents,
      delta_fetch_attempted: tipEventId !== undefined,
      delta_fetch_applied: appliedDelta,
      subagent_skipped_local_reuse: skipSubagent,
      ...(fallbackReason ? { delta_fallback_reason: fallbackReason } : {}),
      delta_anchor:
        intersect !== undefined && intersect.walkback > 0
          ? 'intersected'
          : 'synced',
      on_disk_last_uuid: onDiskLastUuid,
      anchor_uuid: intersect?.uuid,
      anchor_walkback: intersect?.walkback,
      ccr_last_uuid: completedEvents.at(-1)?.payload?.uuid,
    })
    return completedEvents.length > 0
  } catch (error) {
    // Re-throw epoch mismatch so the worker doesn't race against gracefulShutdown
    if (
      error instanceof Error &&
      error.message === 'CCRClient: Epoch mismatch (409)'
    ) {
      throw error
    }
    logForDebugging(`Error hydrating session from CCR v2: ${error}`)
    logForDiagnosticsNoPII('error', 'hydrate_ccr_v2_fail')
    return false
  }
}

/**
 * Official 2.1.328 (#586) `$8s` / `performLeafCheckpointWithdrawal`:
 * Withdraw an existing resume/rewind `last-prompt` checkpoint (`leafUuid: null,
 * explicit: true`) on `/clear` in remote CCR v2 sessions (where an
 * `internalEventWriter` is registered) so resuming a cloud session after rewind
 * + `/clear` stays cleared instead of reviving pre-clear messages.
 *
 * Local sessions (without an explicit `filePath` override and without a CCR
 * `internalEventWriter`) MUST NOT write a clear-checkpoint tombstone to the
 * pre-clear local `.jsonl` file, otherwise `claude --resume <prevSessionId>`
 * permanently fails with `No valid conversation chain found in JSONL file`.
 */
export async function saveExplicitClearCheckpoint(
  sessionId: string,
  filePath?: string,
): Promise<void> {
  const isLiveSessionCall = filePath === undefined
  if (isLiveSessionCall) {
    if (isTranscriptPersistenceDisabled() || !hasInternalEventWriter()) {
      return
    }
  }
  const targetPath = filePath ?? getTranscriptPathForSession(sessionId)
  if (isLiveSessionCall) {
    const hasCheckpoint = await hasLeafCheckpointInTranscriptFile(targetPath)
    if (!hasCheckpoint) {
      logForDebugging(
        `/clear: no resume checkpoint in the transcript it left, so none withdrawn: ${targetPath}`,
      )
      return
    }
  }
  const entry = {
    type: 'last-prompt',
    lastPrompt: '',
    sessionId,
    leafUuid: null,
    explicit: true,
    rewound: false,
  }
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:saveExplicitClearCheckpoint',
      targetPath,
    )
  } else {
    try {
      await fsAppendFile(targetPath, `${jsonStringify(entry)}\n`, {
        encoding: 'utf8',
      })
    } catch {
      // Best-effort — directory or file may not exist yet for an empty session
    }
  }
  if (isLiveSessionCall) {
    const writer = getProject().getInternalEventWriter()
    if (writer) {
      try {
        await writer('last-prompt', entry, {})
      } catch {
        // Best-effort CCR mirror
      }
    }
  }
}

/** densable leftover `zS()??Du()` — `sessionFile ?? getTranscriptPath()`. */
export function getActiveSessionTranscriptPath(): string {
  return getProject().sessionFile ?? getTranscriptPath()
}

export async function saveCustomTitle(
  sessionId: UUID,
  customTitle: string,
  fullPath?: string,
  source: 'user' | 'auto' | 'remote' | 'hook' = 'user',
  storageV5?: unknown,
) {
  const diskless = isDisklessActive()
  // Fall back to computed path if fullPath is not provided
  const resolvedPath =
    fullPath ??
    (diskless
      ? safeDisklessTranscriptPath(
          () => getTranscriptPathForSession(sessionId),
          `${sessionId}.jsonl`,
        )
      : getTranscriptPathForSession(sessionId))
  if (diskless) {
    logDisklessWriteSkipped('sessionStorage:saveCustomTitle', resolvedPath)
  } else {
    appendEntryToFile(resolvedPath, {
      type: 'custom-title',
      customTitle,
      sessionId,
    })
  }
  // densable YAt: if(!dp()) { let i=e===We()?gu(e):s; await Reo(...) }
  // Current-session sidecar is always gu(e)=getTranscriptPathForSession,
  // even when jsonl used n=zS()??Du(). Other sessions use resolvedPath.
  // Preserved in diskless mode so StorageV5 sidecar persistence still runs.
  if (!isPersistenceSuppressed()) {
    const sidecarPath =
      sessionId === getSessionId()
        ? diskless
          ? safeDisklessTranscriptPath(
              () => getTranscriptPathForSession(sessionId),
              resolvedPath,
            )
          : getTranscriptPathForSession(sessionId)
        : resolvedPath
    await writeCustomTitleSidecar(
      sidecarPath,
      sessionId,
      customTitle,
      storageV5,
    )
  }
  // Cache for current session only (for immediate visibility).
  // densable: empty string clears (h||void 0 on tail); never leave "" so
  // title chain `??` cannot produce "prefix + blank" in the terminal tab.
  if (sessionId === getSessionId()) {
    getProject().currentSessionTitle = customTitle || undefined
    notifySessionTitleChanged()
  }
  logEvent('tengu_session_renamed', {
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * Persist an AI-generated title to the JSONL as a distinct `ai-title` entry.
 *
 * Writing a separate entry type (vs. reusing `custom-title`) is load-bearing:
 * - Read preference: readers prefer `customTitle` field over `aiTitle`, so
 *   a user rename always wins regardless of append order.
 * - Resume safety: `loadTranscriptFile` only populates the `customTitles`
 *   Map from `custom-title` entries, so `restoreSessionMetadata` never
 *   caches an AI title and `reAppendSessionMetadata` never re-appends one
 *   at EOF — avoiding the clobber-on-resume bug where a stale AI title
 *   overwrites a mid-session user rename.
 * - CAS semantics: VS Code's `onlyIfNoCustomTitle` check scans for the
 *   `customTitle` field only, so AI can overwrite its own previous AI
 *   title but never a user title.
 * - Metrics: `tengu_session_renamed` is not fired for AI titles.
 *
 * Because the entry is never re-appended, it scrolls out of the 64KB tail
 * window once enough messages accumulate. Readers (`readLiteMetadata`,
 * `listSessionsImpl`, VS Code `fetchSessions`) fall back to scanning the
 * head buffer for `aiTitle` in that case. Both head and tail reads are
 * bounded (64KB each via `extractLastJsonStringField`), never a full scan.
 *
 * Callers with a stale-write guard (e.g., VS Code client) should prefer
 * passing `persist: false` to the SDK control request and persisting
 * through their own rename path after the guard passes, to avoid a race
 * where the AI title lands after a mid-flight user rename.
 */
export function saveAiGeneratedTitle(sessionId: UUID, aiTitle: string): void {
  // densable JCe: cache aiTitle for v$e() / M9e seed (user title still wins)
  if (sessionId === getSessionId()) {
    const project = getProject()
    if (project.currentSessionAiTitle === undefined) {
      project.currentSessionAiTitle = aiTitle
      notifySessionTitleChanged()
    }
  }
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:saveAiGeneratedTitle',
      safeDisklessTranscriptPath(
        () => getTranscriptPathForSession(sessionId),
        `${sessionId}.jsonl`,
      ),
    )
    return
  }
  appendEntryToFile(getTranscriptPathForSession(sessionId), {
    type: 'ai-title',
    aiTitle,
    sessionId,
  })
}

/**
 * Append a periodic task summary for `claude ps`. Unlike ai-title this is
 * not re-appended by reAppendSessionMetadata — it's a rolling snapshot of
 * what the agent is doing *now*, so staleness is fine; ps reads the most
 * recent one from the tail.
 */
export function saveTaskSummary(sessionId: UUID, summary: string): void {
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:saveTaskSummary',
      safeDisklessTranscriptPath(
        () => getTranscriptPathForSession(sessionId),
        `${sessionId}.jsonl`,
      ),
    )
    return
  }
  appendEntryToFile(getTranscriptPathForSession(sessionId), {
    type: 'task-summary',
    summary,
    sessionId,
    timestamp: new Date().toISOString(),
  })
}

/**
 * densable Ams / markSessionEndedByModel — append `ended-by-model` transcript
 * marker when EndConversation successfully ends the main session.
 * Skips when session persistence is disabled (densable JM()).
 */
export async function markSessionEndedByModel(
  sessionId: UUID | string,
): Promise<void> {
  if (isSessionPersistenceDisabled()) return
  const id = sessionId as UUID
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:markSessionEndedByModel',
      safeDisklessTranscriptPath(
        () => getTranscriptPathForSession(id),
        `${id}.jsonl`,
      ),
    )
    return
  }
  try {
    appendEntryToFile(getTranscriptPathForSession(id), {
      type: 'ended-by-model',
      timestamp: new Date().toISOString(),
      sessionId: id,
    })
  } catch (err) {
    logForDebugging(
      `markSessionEndedByModel: transcript append failed: ${errorMessage(err)}`,
    )
  }
}

export async function saveTag(sessionId: UUID, tag: string, fullPath?: string) {
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:saveTag',
      fullPath ??
        safeDisklessTranscriptPath(
          () => getTranscriptPathForSession(sessionId),
          `${sessionId}.jsonl`,
        ),
    )
  } else {
    // Fall back to computed path if fullPath is not provided
    const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
    appendEntryToFile(resolvedPath, { type: 'tag', tag, sessionId })
  }
  // Cache for current session only (for immediate visibility)
  if (sessionId === getSessionId()) {
    getProject().currentSessionTag = tag
  }
  logEvent('tengu_session_tagged', {})
}

/**
 * Link a session to a GitHub pull request.
 * This stores the PR number, URL, and repository for tracking and navigation.
 */
export async function linkSessionToPR(
  sessionId: UUID,
  prNumber: number,
  prUrl: string,
  prRepository: string,
  fullPath?: string,
): Promise<void> {
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:linkSessionToPR',
      fullPath ??
        safeDisklessTranscriptPath(
          () => getTranscriptPathForSession(sessionId),
          `${sessionId}.jsonl`,
        ),
    )
  } else {
    const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
    appendEntryToFile(resolvedPath, {
      type: 'pr-link',
      sessionId,
      prNumber,
      prUrl,
      prRepository,
      timestamp: new Date().toISOString(),
    })
  }
  // Cache for current session so reAppendSessionMetadata can re-write after compaction
  if (sessionId === getSessionId()) {
    const project = getProject()
    project.currentSessionPrNumber = prNumber
    project.currentSessionPrUrl = prUrl
    project.currentSessionPrRepository = prRepository
  }
  logEvent('tengu_session_linked_to_pr', { prNumber })
}

export function getCurrentSessionTag(sessionId: UUID): string | undefined {
  // Only returns tag for current session (the only one we cache)
  if (sessionId === getSessionId()) {
    return getProject().currentSessionTag
  }
  return undefined
}

export function getCurrentSessionTitle(
  sessionId: SessionId,
): string | undefined {
  // Only returns title for current session (the only one we cache)
  if (sessionId === getSessionId()) {
    return getProject().currentSessionTitle
  }
  return undefined
}

/** densable leftover `l1e` — currentSessionAgentName, no sid gate. */
export function getCurrentSessionAgentName(): string | undefined {
  return getProject().currentSessionAgentName
}

/**
 * densable `v$e(sessionId)` — process-level AI title cache for M9e seed.
 * User custom title still wins via getCurrentSessionTitle / nameSource.
 */
export function getCurrentSessionAiTitle(
  sessionId?: SessionId,
): string | undefined {
  if (sessionId === undefined || sessionId === getSessionId()) {
    return getProject().currentSessionAiTitle
  }
  return undefined
}

export function getCurrentSessionAgentColor(): string | undefined {
  return getProject().currentSessionAgentColor
}

/**
 * densable `D6e(leafUuid)` / `Q_a(e,t)` — write last-prompt leaf before
 * keepParent fork flush or rewind persist.
 *
 * densable:
 *   r.currentSessionLeafUuid = e
 *   r.currentSessionLeafTs = now
 *   await r.appendEntry({
 *     type:"last-prompt", lastPrompt?, leafUuid, explicit:true,
 *     ...t?.rewound&&{rewound:!0}, sessionId
 *   })
 *
 * Local: append last-prompt with leafUuid/explicit so the snapshot resume
 * path has a hard boundary marker at the fork point. Optional `rewound`
 * matches densable 2.1.227 rewind-before-first-message anchor.
 */
export async function recordForkBoundaryLeaf(
  leafUuid: string | null | undefined,
  options?: { rewound?: boolean; cutUuid?: string },
): Promise<void> {
  const project = getProject()
  const entry = {
    type: 'last-prompt' as const,
    sessionId: getSessionId() as UUID,
    ...(project.currentSessionLastPrompt
      ? { lastPrompt: project.currentSessionLastPrompt }
      : {}),
    leafUuid: leafUuid ?? null,
    explicit: true,
    ...(options?.rewound
      ? {
          rewound: true,
          ...(options.cutUuid ? { cutUuid: options.cutUuid } : {}),
        }
      : {}),
    timestamp: new Date().toISOString(),
  } as LastPromptMessage
  await project.appendEntry(entry)
}

/**
 * densable 2.1.227 `d2p` / `transcriptHasBytes` — true when the session
 * transcript file has size > 0 (local path). Used by `/tui` relaunch
 * (`freshIfNoTranscript`) so rewound-empty / never-started sessions do not
 * `--resume` a hollow conversation.
 *
 * densable also checks remote backend meta when present; local only has the
 * filesystem path (no cloud transcript backend).
 */
export async function transcriptHasBytes(
  transcriptPath?: string,
): Promise<boolean> {
  if (isDisklessActive()) return false
  try {
    const st = await stat(transcriptPath ?? getTranscriptPath())
    return st.size > 0
  } catch {
    return false
  }
}

/**
 * Restore session metadata into in-memory cache on resume.
 * Populates the cache so metadata is available for display (e.g. the
 * agent banner) and re-appended on session exit via reAppendSessionMetadata.
 */
export function restoreSessionMetadata(meta: {
  customTitle?: string
  /** densable JCe aiTitle → currentSessionAiTitle for v$e/M9e. */
  aiTitle?: string
  tag?: string
  /** densable 2.1.223 #8 — last mid-session /cd relocated stamp. */
  relocatedCwd?: string
  agentName?: string
  agentColor?: string
  agentSetting?: string
  mode?: 'coordinator' | 'normal'
  /** Official 2.1.328: restored permission mode (`permission-mode` JSONL entry). */
  permissionMode?: PermissionMode
  /** Official 2.1.328: restored Code Mode (`repl-mode`) session flag. */
  replMode?: boolean
  sessionModel?: string
  worktreeSession?:
    | (PersistedWorktreeSession & { extensionRoot?: string })
    | null
  prNumber?: number
  prUrl?: string
  prRepository?: string
  goal?: GoalState
  /** densable Xye: only hydrate when bridgeSessionId is truthy (not tombstone). */
  bridgeSessionId?: string
  bridgeLastSeq?: number
  bridgeDialogKinds?: string[]
  bridgeSessionGroupingId?: string
  bridgeNoHistoryBackfill?: boolean
  /** densable e.bridgeOwnerAccountUuid → currentSessionBridgeOwnerAccountUuid. */
  bridgeOwnerAccountUuid?: string
  /** densable e.bridgeOwnerOrganizationUuid → currentSessionBridgeOwnerOrganizationUuid. */
  bridgeOwnerOrganizationUuid?: string
  /** densable e.sessionHistorySuppressed → currentSessionHistorySuppressed + QJe. */
  sessionHistorySuppressed?: boolean
  /** densable e.devModsFolder → currentSessionDevModsFolder when eln matches. */
  devModsFolder?: string
}): void {
  const project = getProject()
  // ??= so --name (cacheSessionTitle) wins over the resumed
  // session's title. REPL.tsx clears before calling, so /resume is unaffected.
  const beforeTitle = project.currentSessionTitle
  const beforeAiTitle = project.currentSessionAiTitle
  if (meta.customTitle) project.currentSessionTitle ??= meta.customTitle
  // densable JCe: e.aiTitle → currentSessionAiTitle ??=
  if (meta.aiTitle) project.currentSessionAiTitle ??= meta.aiTitle
  if (
    project.currentSessionTitle !== beforeTitle ||
    project.currentSessionAiTitle !== beforeAiTitle
  ) {
    notifySessionTitleChanged()
  }
  if (meta.tag !== undefined) project.currentSessionTag = meta.tag || undefined
  // densable MMe: e.relocatedCwd → currentSessionRelocatedCwd ??=
  if (meta.relocatedCwd)
    project.currentSessionRelocatedCwd ??= meta.relocatedCwd
  if (meta.agentName) project.currentSessionAgentName = meta.agentName
  if (meta.agentColor) project.currentSessionAgentColor = meta.agentColor
  if (meta.agentSetting) project.currentSessionAgentSetting = meta.agentSetting
  if (meta.mode) project.currentSessionMode = meta.mode
  if (meta.permissionMode)
    project.currentSessionPermissionMode = meta.permissionMode
  if (meta.replMode !== undefined)
    project.currentSessionCodeMode = meta.replMode
  if (meta.sessionModel) project.currentSessionModel = meta.sessionModel
  if (meta.worktreeSession !== undefined)
    project.currentSessionWorktree = meta.worktreeSession
  if (meta.devModsFolder) {
    const folder = meta.devModsFolder
    const sessionId = getSessionId()
    // densable eln — sessionId charset + resolve(folder)===resolve(join(rft(), id))
    if (leftoverDevModsFolderMatches(folder, sessionId)) {
      project.currentSessionDevModsFolder = folder
    } else {
      logForDebugging(
        "dev mods: dropped a restored dev-mods folder not this session's",
      )
    }
  }
  if (meta.prNumber !== undefined)
    project.currentSessionPrNumber = meta.prNumber
  if (meta.prUrl) project.currentSessionPrUrl = meta.prUrl
  if (meta.prRepository) project.currentSessionPrRepository = meta.prRepository
  // densable: if(e.bridgeSessionId) hydrate — empty string / missing is a no-op
  // (user-off tombstone must not re-seed force-on).
  if (meta.bridgeSessionId) {
    project.currentSessionBridgeId = meta.bridgeSessionId
    project.currentSessionBridgeSeq = meta.bridgeLastSeq
    project.currentSessionBridgeDialogKinds = meta.bridgeDialogKinds?.length
      ? meta.bridgeDialogKinds
      : undefined
    project.currentSessionBridgeGroupingId = meta.bridgeSessionGroupingId
    project.currentSessionBridgeNoBackfill = meta.bridgeNoHistoryBackfill
      ? true
      : undefined
    project.currentSessionBridgeOwnerAccountUuid = meta.bridgeOwnerAccountUuid
    project.currentSessionBridgeOwnerOrganizationUuid =
      meta.bridgeOwnerOrganizationUuid
  }
  if (meta.sessionHistorySuppressed) {
    markSessionHistorySuppressed(getSessionId() as UUID)
  }
}

/**
 * Clear all cached session metadata (title, tag, agent name/color).
 * Called when /clear creates a new session so stale metadata
 * from the previous session does not leak into the new one.
 */
export function clearSessionMetadata(
  options: { keepTitle?: boolean } = {},
): void {
  const project = getProject()
  // densable 2.1.243 #31 — /clear keeps the /rename title for the new session.
  if (!options.keepTitle) {
    project.currentSessionTitle = undefined
  }
  project.currentSessionAiTitle = undefined
  project.currentSessionTag = undefined
  project.currentSessionRelocatedCwd = undefined
  project.currentSessionAgentName = undefined
  project.currentSessionAgentColor = undefined
  project.currentSessionLastPrompt = undefined
  project.currentSessionAgentSetting = undefined
  project.currentSessionMode = undefined
  project.currentSessionPermissionMode = undefined
  project.currentSessionCodeMode = undefined
  project.currentSessionModel = undefined
  project.currentSessionWorktree = undefined
  project.currentSessionDevModsFolder = undefined
  project.currentSessionPrNumber = undefined
  project.currentSessionPrUrl = undefined
  project.currentSessionPrRepository = undefined
  project.currentSessionBridgeId = undefined
  project.currentSessionBridgeSeq = undefined
  project.currentSessionBridgeDialogKinds = undefined
  project.currentSessionBridgeGroupingId = undefined
  project.currentSessionBridgeNoBackfill = undefined
  project.currentSessionBridgeOwnerAccountUuid = undefined
  project.currentSessionBridgeOwnerOrganizationUuid = undefined
  // Scoped to the session that was vetoed, not the process: markSessionHistorySuppressed
  // sets this only when the tainted sid is the live one. The per-sid taint lives on in
  // knownTaintedSessionIds, so the new session starts clean. Leaving it set makes
  // reAppendSessionMetadata stamp a durable history-suppression entry into the *new*
  // session's transcript, which restoreSessionMetadata then re-reads on every resume —
  // an unrecoverable suppression of a session that was never vetoed.
  project.currentSessionHistorySuppressed = undefined
  notifySessionTitleChanged()
}

/**
 * densable Bkn — persist live bridge session onto the transcript + process cache.
 * Called on host_exit cleanup and after connect so --resume can force RC on.
 */
export function saveBridgeSession(
  sessionId: UUID,
  bridgeSessionId: string,
  lastSequenceNum: number,
  fullPath?: string,
  declaredDialogKinds?: string[],
  sessionGroupingId?: string,
  noHistoryBackfill?: boolean,
  /** densable FXs `a` — live OAuth account stamped onto the pointer. */
  owner?: {
    accountUuid?: string
    organizationUuid?: string
  },
): void {
  if (!bridgeSessionId) return
  const project = getProject()
  if (project.sessionFile || fullPath) {
    if (isDisklessActive()) {
      logDisklessWriteSkipped(
        'sessionStorage:saveBridgeSession',
        fullPath ??
          safeDisklessTranscriptPath(
            () => getTranscriptPathForSession(sessionId),
            `${sessionId}.jsonl`,
          ),
      )
    } else {
      const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
      try {
        appendEntryToFile(resolvedPath, {
          type: 'bridge-session',
          sessionId,
          bridgeSessionId,
          lastSequenceNum,
          ...(declaredDialogKinds?.length ? { declaredDialogKinds } : {}),
          ...(sessionGroupingId ? { sessionGroupingId } : {}),
          ...(noHistoryBackfill ? { noHistoryBackfill: true } : {}),
          ...(owner?.accountUuid
            ? { ownerAccountUuid: owner.accountUuid }
            : {}),
          ...(owner?.organizationUuid
            ? { ownerOrganizationUuid: owner.organizationUuid }
            : {}),
        })
      } catch (err) {
        logForDebugging(
          `saveBridgeSession: transcript append failed: ${errorMessage(err)}`,
        )
      }
    }
  }
  if (sessionId === getSessionId()) {
    project.currentSessionBridgeId = bridgeSessionId
    project.currentSessionBridgeSeq = lastSequenceNum
    project.currentSessionBridgeDialogKinds = declaredDialogKinds?.length
      ? [...declaredDialogKinds]
      : undefined
    project.currentSessionBridgeGroupingId = sessionGroupingId
    project.currentSessionBridgeNoBackfill = noHistoryBackfill
      ? true
      : undefined
    project.currentSessionBridgeOwnerAccountUuid = owner?.accountUuid
    project.currentSessionBridgeOwnerOrganizationUuid = owner?.organizationUuid
  }
  logForDebugging(
    `[bridge:session] Bkn session=${sessionId} bridge=${bridgeSessionId} seq=${lastSequenceNum}`,
  )
}

/**
 * densable g4t / JKt / QJe / Sno — permanent history-suppression taint.
 * Kn calls this on owner-mismatch veto (unless the transcript pair is TORN).
 */
export function writeHistorySuppression(
  sessionId?: UUID,
  fullPath?: string,
  cause?: string,
  vetoedAgainstAccountUuid?: string,
): void {
  const sid = sessionId ?? (getSessionId() as UUID | undefined)
  if (!sid) return
  // densable g4t: if (!dp()) Nf(t ?? gu(s), JKt(...)) — path from sid,
  // not gated on project.sessionFile already being materialized.
  if (!isSessionPersistenceDisabled()) {
    if (isDisklessActive()) {
      logDisklessWriteSkipped(
        'sessionStorage:writeHistorySuppression',
        fullPath ??
          safeDisklessTranscriptPath(
            () => getTranscriptPathForSession(sid),
            `${sid}.jsonl`,
          ),
      )
    } else {
      const resolvedPath = fullPath ?? getTranscriptPathForSession(sid)
      try {
        appendEntryToFile(resolvedPath, {
          type: 'history-suppression',
          sessionId: sid,
          cause: cause ?? 'restored_owner_mismatch',
          ...(vetoedAgainstAccountUuid ? { vetoedAgainstAccountUuid } : {}),
          ts: new Date().toISOString(),
        })
      } catch (err) {
        logForDebugging(
          `writeHistorySuppression: transcript append failed: ${errorMessage(err)}`,
        )
      }
    }
  }
  markSessionHistorySuppressed(sid)
}

/** densable QJe + HXs — taint sid and set currentSessionHistorySuppressed when live. */
export function markSessionHistorySuppressed(sessionId?: UUID): void {
  if (sessionId === undefined) return
  const project = getProject()
  project.knownTaintedSessionIds ??= new Set()
  project.knownTaintedSessionIds.add(sessionId)
  if (sessionId === getSessionId()) {
    project.currentSessionHistorySuppressed = true
  }
}

/** densable Sno. */
export function isSessionHistorySuppressed(): boolean {
  return getProject().currentSessionHistorySuppressed === true
}

/** densable y4t. */
export function isKnownTaintedSession(sessionId?: string): boolean {
  return (
    sessionId !== undefined &&
    getProject().knownTaintedSessionIds?.has(sessionId as UUID) === true
  )
}

/** densable qXs — add sid to currentSessionPrecautionarySuppression. */
export function markPrecautionarySessionSuppression(sessionId?: string): void {
  if (!sessionId) return
  const project = getProject()
  project.currentSessionPrecautionarySuppression ??= new Set()
  project.currentSessionPrecautionarySuppression.add(sessionId)
}

/** densable leftover KXs / te. */
export function markResilientPrecautionSid(sessionId?: string): void {
  if (sessionId === undefined) return
  const project = getProject()
  project.clearResilientPrecautionSids ??= new Set()
  project.clearResilientPrecautionSids.add(sessionId)
}

/** densable leftover YXs / Me. Init scan applyScanPrecautionHold 调; torn/gone 不调. */
export function markScanUncertaintyHoldSid(sessionId?: string): void {
  if (sessionId === undefined) return
  const project = getProject()
  project.scanUncertaintyHoldSids ??= new Set()
  project.scanUncertaintyHoldSids.add(sessionId)
}

/** densable leftover ZXs / _e. */
export function clearScanUncertaintyHoldSid(sessionId?: string): void {
  if (sessionId === undefined) return
  getProject().scanUncertaintyHoldSids?.delete(sessionId)
}

/** densable leftover `XXs` / `ui`. `e!==void 0 && hold.has(e)===!0`. */
export function isScanUncertaintyHeld(sessionId?: string): boolean {
  return (
    sessionId !== undefined &&
    getProject().scanUncertaintyHoldSids?.has(sessionId) === true
  )
}

/** densable leftover `wno`. */
export function isSessionTranscriptRelocating(): boolean {
  return getProject().isTranscriptRelocationInProgress()
}

/**
 * densable leftover `h4t` @218126573.
 * `r=Be()&&n!==void 0?uE(e,n):void 0; o=r!==void 0?xeo(r.backend,r.key):pto(e)`.
 */
export async function scanFileForHistorySuppression(
  filePath: string,
  opts: { sid?: string } = {},
  storageV5?: unknown,
): Promise<'found' | 'clean' | 'budget-exhausted'> {
  const r =
    isHoverRestOn() && storageV5 !== undefined
      ? bindMainSessionTranscriptPersistence(filePath, storageV5)
      : undefined
  const o =
    r !== undefined
      ? (
          await import('../sessionPersistenceSync.js')
        ).iterateTranscriptRecordPages(r.backend, r.key)
      : iterateTranscriptFileLines(filePath)
  let s = 0
  for await (const i of o) {
    if (isHistorySuppressionJsonlLine(i, opts)) return 'found'
    if (++s >= HISTORY_SUPPRESSION_SCAN_LINE_LIMIT) return 'budget-exhausted'
  }
  return 'clean'
}

/**
 * densable leftover `UXs` / `ci`.
 * `zS` = project.sessionFile. `Du` = getTranscriptPath. `vno` = sid jsonl.
 * Official `Et` not fully locked; leftover uses `isAbortError`.
 */
export async function probeActiveSessionHistorySuppression(
  storageV5?: unknown,
): Promise<'found' | 'clean' | 'torn' | 'budget-exhausted' | 'read-error'> {
  const t = getSessionId()
  const n = getProject().sessionFile
  const r =
    Boolean(t) && n !== null && !isCanonicalSessionTranscriptBasename(t, n)
  try {
    const o = r ? getTranscriptPathForSession(t) : (n ?? getTranscriptPath())
    const s = await scanFileForHistorySuppression(
      o,
      { sid: t || undefined },
      storageV5,
    )
    return r && s === 'clean' ? 'torn' : s
  } catch (err) {
    if (isAbortError(err)) {
      if (r) return 'torn'
      return isSessionTranscriptRelocating() ? 'read-error' : 'clean'
    }
    return 'read-error'
  }
}

/** densable leftover `JXs` / `li`. */
export function releaseScanPrecautionHold(sessionId?: string): void {
  if (sessionId === undefined) return
  const project = getProject()
  if (!project.scanUncertaintyHoldSids?.has(sessionId)) return
  project.scanUncertaintyHoldSids.delete(sessionId)
  project.clearResilientPrecautionSids?.delete(sessionId)
  project.currentSessionPrecautionarySuppression?.delete(sessionId)
}

/**
 * densable leftover init/persist-sync `L,te,!re&&Me`.
 * persist-sync host leftover `ur` / `backfillPersistedTranscripts`. Official `Qt`/`zr`/`yo` leftover-wired.
 */
export function applyScanPrecautionHold(sessionId?: string): void {
  const already = isPrecautionarySuppressed(sessionId)
  markPrecautionarySessionSuppression(sessionId)
  markResilientPrecautionSid(sessionId)
  if (!already) markScanUncertaintyHoldSid(sessionId)
}

/** densable _4t. */
export function isPrecautionarySuppressed(sessionId?: string): boolean {
  return (
    sessionId !== undefined &&
    getProject().currentSessionPrecautionarySuppression?.has(sessionId) === true
  )
}

/** densable Cno = _4t(Xg(We())). Xg/B is identity. */
export function isCurrentSessionPrecautionarySuppressed(): boolean {
  return isPrecautionarySuppressed(getSessionId())
}

/**
 * densable pV / en(sid). Official Ne=()=>en(B(k())).
 * B = Xg = identity, so B(k()) is k().
 * Pno = Sno || xno()?.noHistoryBackfill || Ano || Cno.
 * Ano = liveSuppressionProbe?.()===true.
 * _4t(e) = currentSessionPrecautionarySuppression.has(e).
 */
export function shouldSuppressSessionTitleHistory(sessionId?: string): boolean {
  return (
    isForeignBoundSessionMismatch(sessionId) ||
    isSessionHistorySuppressed() ||
    getCurrentSessionBridge()?.noHistoryBackfill === true ||
    isLiveBridgeSuppressed() ||
    isPrecautionarySuppressed(sessionId) ||
    isCurrentSessionPrecautionarySuppressed() ||
    isKnownTaintedSession(sessionId)
  )
}

/**
 * densable EGt / clearBridgeSession — user turned RC off.
 * Appends tombstone `bridgeSessionId:""` so loadTranscriptFile drops the pointer
 * (truthy check), preventing resume force-on (2.1.224 #30).
 */
export function clearBridgeSession(
  sessionId?: UUID,
  fullPath?: string,
  opts?: { targetExists?: boolean },
): void {
  const n = sessionId ?? (getSessionId() as UUID)
  const project = getProject()
  if (project.sessionFile || (opts?.targetExists && fullPath !== undefined)) {
    if (isDisklessActive()) {
      logDisklessWriteSkipped(
        'sessionStorage:clearBridgeSession',
        fullPath ??
          safeDisklessTranscriptPath(
            () => getTranscriptPathForSession(n),
            `${n}.jsonl`,
          ),
      )
    } else {
      const resolvedPath = fullPath ?? getTranscriptPathForSession(n)
      try {
        appendEntryToFile(resolvedPath, {
          type: 'bridge-session',
          sessionId: n,
          bridgeSessionId: '',
          lastSequenceNum: 0,
        })
      } catch (err) {
        logForDebugging(
          `clearBridgeSession: transcript append failed: ${errorMessage(err)}`,
        )
      }
    }
  }
  if (n === getSessionId()) {
    project.currentSessionBridgeId = undefined
    project.currentSessionBridgeSeq = undefined
    project.currentSessionBridgeDialogKinds = undefined
    project.currentSessionBridgeGroupingId = undefined
    project.currentSessionBridgeNoBackfill = undefined
    project.currentSessionBridgeOwnerAccountUuid = undefined
    project.currentSessionBridgeOwnerOrganizationUuid = undefined
  }
  logForDebugging(`[bridge:session] EGt cleared session=${n}`)
}

/** densable zri — drop process-local bridge cache without writing a tombstone. */
export function clearBridgeSessionCache(): void {
  const project = getProject()
  project.currentSessionBridgeId = undefined
  project.currentSessionBridgeSeq = undefined
  project.currentSessionBridgeDialogKinds = undefined
  project.currentSessionBridgeGroupingId = undefined
  project.currentSessionBridgeNoBackfill = undefined
  project.currentSessionBridgeOwnerAccountUuid = undefined
  project.currentSessionBridgeOwnerOrganizationUuid = undefined
}

/**
 * Re-append cached session metadata (custom title, tag) to the end of the
 * transcript file. Call this after compaction so the metadata stays within
 * the 16KB tail window that readLiteMetadata reads during progressive loading.
 * Without this, enough post-compaction messages can push the metadata entry
 * out of the window, causing `--resume` to show the auto-generated firstPrompt
 * instead of the user-set session name.
 */
export function reAppendSessionMetadata(): void {
  getProject().reAppendSessionMetadata()
}

export async function saveAgentName(
  sessionId: UUID,
  agentName: string,
  fullPath?: string,
  source: 'user' | 'auto' | 'hook' = 'user',
) {
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:saveAgentName',
      fullPath ??
        safeDisklessTranscriptPath(
          () => getTranscriptPathForSession(sessionId),
          `${sessionId}.jsonl`,
        ),
    )
  } else {
    const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
    appendEntryToFile(resolvedPath, {
      type: 'agent-name',
      agentName,
      sessionId,
    })
  }
  // Cache for current session only (for immediate visibility)
  if (sessionId === getSessionId()) {
    getProject().currentSessionAgentName = agentName
    void updateSessionName(agentName)
  }
  logEvent('tengu_agent_name_set', {
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

export async function saveAgentColor(
  sessionId: UUID,
  agentColor: string,
  fullPath?: string,
) {
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:saveAgentColor',
      fullPath ??
        safeDisklessTranscriptPath(
          () => getTranscriptPathForSession(sessionId),
          `${sessionId}.jsonl`,
        ),
    )
  } else {
    const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
    appendEntryToFile(resolvedPath, {
      type: 'agent-color',
      agentColor,
      sessionId,
    })
  }
  // Cache for current session only (for immediate visibility)
  if (sessionId === getSessionId()) {
    getProject().currentSessionAgentColor = agentColor
  }
  logEvent('tengu_agent_color_set', {})
}

/**
 * Cache the session agent setting. Written to disk by materializeSessionFile
 * on the first user message, and re-stamped by reAppendSessionMetadata on exit.
 * Cache-only here to avoid creating metadata-only session files at startup.
 */
export function saveAgentSetting(agentSetting: string): void {
  getProject().currentSessionAgentSetting = agentSetting
}

/**
 * Cache a session title set at startup (--name). Written to disk by
 * materializeSessionFile on the first user message. Cache-only here so no
 * orphan metadata-only file is created before the session ID is finalized.
 */
export function cacheSessionTitle(customTitle: string): void {
  // densable SQt: empty clears so REPL title falls through to AI/product name.
  getProject().currentSessionTitle = customTitle || undefined
  notifySessionTitleChanged()
}

/**
 * Cache the session mode. Written to disk by materializeSessionFile on the
 * first user message, and re-stamped by reAppendSessionMetadata on exit.
 * Cache-only here to avoid creating metadata-only session files at startup.
 */
export function saveMode(mode: 'coordinator' | 'normal'): void {
  getProject().currentSessionMode = mode
}

/**
 * Official 2.1.328 (`chunk@294254613.js @491708, @535149`):
 * Cache the session's permission mode and append `{ type: 'permission-mode',
 * permissionMode, sessionId }` to the active transcript when available.
 */
export function savePermissionMode(
  permissionMode: PermissionMode,
  sessionId?: UUID,
): void {
  const proj = getProject()
  const changed = proj.currentSessionPermissionMode !== permissionMode
  proj.currentSessionPermissionMode = permissionMode
  if (!changed) return
  const sid = sessionId ?? (getSessionId() as UUID | undefined)
  if (sid) {
    void proj
      .appendEntry(
        {
          type: 'permission-mode',
          permissionMode,
          sessionId: sid,
        },
        sid,
      )
      .catch(() => {})
  }
}

export function getCurrentSessionPermissionMode(): PermissionMode | undefined {
  return getProject().currentSessionPermissionMode
}

/**
 * Official 2.1.328 (`y`/`Gj`/`fJe` repl-mode persistence): record the session's
 * Code Mode (`replMode`) flag in project state and persist a `type: 'repl-mode'`
 * entry to the active session transcript when available.
 */
export function saveReplMode(
  replMode: boolean,
  sessionId?: UUID,
  opts?: { typedEvents?: boolean },
): void {
  const project = getProject()
  const changed = project.currentSessionCodeMode !== replMode
  project.currentSessionCodeMode = replMode
  if (!changed) return
  const sid = sessionId ?? (getSessionId() as UUID | undefined)
  if (sid) {
    void project
      .appendEntry(
        {
          type: 'repl-mode',
          replMode,
          ...(opts?.typedEvents ? { typedEvents: true } : {}),
          sessionId: sid,
        } as unknown as Entry,
        sid,
      )
      .catch(() => {})
  }
}

export function getCurrentSessionReplMode(): boolean | undefined {
  return getProject().currentSessionCodeMode
}

/**
 * Record the model the user selected via /model so it survives resume.
 */
export function saveSessionModel(model: string | null, sessionId?: UUID): void {
  const proj = getProject()
  const next = model ?? undefined
  const changed = proj.currentSessionModel !== next
  proj.currentSessionModel = next
  if (!changed || !next) return
  const sid = sessionId ?? (getSessionId() as UUID | undefined)
  if (sid && proj.sessionFile !== null) {
    void proj
      .appendEntry(
        {
          type: 'session-model',
          model: next,
          sessionId: sid,
        },
        sid,
      )
      .catch(() => {})
  }
}

/**
 * densable iLr — persist the consented session mods folder (last-wins JSONL).
 * Same-path no-op. Appends when sessionFile exists. Gold `KC(..., storageV5).catch`.
 */
export function saveDevModsFolder(folder: string, storageV5?: unknown): void {
  const project = getProject()
  if (project.currentSessionDevModsFolder === folder) return
  project.currentSessionDevModsFolder = folder
  if (project.sessionFile) {
    const sessionFile = project.sessionFile
    const entry: Entry = {
      type: 'dev-mods',
      folder,
      sessionId: getSessionId() as UUID,
    }
    leftoverAppendEntryToFileAsync(sessionFile, entry, storageV5).catch(
      (error: unknown) => {
        if (isFsInaccessible(error)) {
          logForDebugging(
            `saveDevModsFolder: failed to append dev-mods entry to ${sessionFile} (${error.code}): ${errorMessage(error)}`,
            { level: 'error' },
          )
        } else {
          logError(error)
        }
        recordTranscriptWriteFailure('dev_mods', error, sessionFile)
      },
    )
  }
}

/** densable aLr */
export function getCurrentSessionDevModsFolder(): string | undefined {
  return getProject().currentSessionDevModsFolder
}

export function saveWorktreeState(
  worktreeSession:
    | (PersistedWorktreeSession & { extensionRoot?: string })
    | null,
): void {
  // Strip ephemeral fields (creationDurationMs, usedSparsePaths) that callers
  // may pass via full WorktreeSession objects — TypeScript structural typing
  // allows this, but we don't want them serialized to the transcript.
  const stripped:
    | (PersistedWorktreeSession & { extensionRoot?: string })
    | null = worktreeSession
    ? {
        originalCwd: worktreeSession.originalCwd,
        worktreePath: worktreeSession.worktreePath,
        worktreeName: worktreeSession.worktreeName,
        worktreeBranch: worktreeSession.worktreeBranch,
        originalBranch: worktreeSession.originalBranch,
        originalHeadCommit: worktreeSession.originalHeadCommit,
        sessionId: worktreeSession.sessionId,
        tmuxSessionName: worktreeSession.tmuxSessionName,
        hookBased: worktreeSession.hookBased,
        ...(worktreeSession.extensionRoot !== undefined
          ? { extensionRoot: worktreeSession.extensionRoot }
          : {}),
      }
    : null
  const project = getProject()
  project.currentSessionWorktree = stripped
  // densable hne → Tmo.emit(worktreeSession) so c7u → l7u can patch job state
  // in bg workers. Dynamic import keeps sessionStorage free of hard bridge deps.
  void import('../bgNeedsInputBridge.js')
    .then(({ emitBgWorktreeMeta }) => {
      if (!stripped) {
        emitBgWorktreeMeta(null)
        return
      }
      emitBgWorktreeMeta({
        worktreePath: stripped.worktreePath,
        worktreeBranch: stripped.worktreeBranch,
        worktreeHookBased: stripped.hookBased,
      })
    })
    .catch(() => {})
  // Write eagerly when the file already exists (mid-session enter/exit).
  // For --worktree startup, sessionFile is null — materializeSessionFile
  // will write it on the first message via reAppendSessionMetadata.
  if (project.sessionFile) {
    if (isDisklessActive()) {
      logDisklessWriteSkipped(
        'sessionStorage:saveWorktreeState',
        project.sessionFile,
      )
    } else {
      appendEntryToFile(project.sessionFile, {
        type: 'worktree-state',
        worktreeSession: stripped,
        sessionId: getSessionId(),
      })
    }
  }
}

export async function writeRequestReplayRecords(
  records: RequestReplayRecords,
): Promise<RequestReplayWriteResult> {
  return getProject().writeRequestReplayRecords(records)
}

/**
 * Official `xpr` (2.1.299 #688): rebuild `agentNameRegistry` from resumed
 * transcript messages so `SendMessage` can find named subagents after a CLI
 * restart/resume (for names given after the last compaction).
 */
export function rehydrateAgentNameRegistry(
  messages: readonly Message[],
  existing: ReadonlyMap<string, AgentId>,
): Map<string, AgentId> | null {
  const pendingByToolUseId = new Map<string, string>()
  const recovered = new Map<string, AgentId>()

  for (const msg of messages) {
    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (
          block.type === 'tool_use' &&
          (block.name === 'Agent' || block.name === 'Task') &&
          block.input !== null &&
          typeof block.input === 'object'
        ) {
          const name = (block.input as { name?: unknown }).name
          if (
            typeof name === 'string' &&
            REHYDRATE_AGENT_NAME_RE.test(name) &&
            !isReservedAgentName(name) &&
            !existing.has(name)
          ) {
            pendingByToolUseId.set(block.id, name)
          }
        }
      }
    } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      const toolResults = msg.message.content.filter(
        b => b.type === 'tool_result',
      )
      const first = toolResults[0]
      const name =
        first !== undefined && toolResults.length === 1 && !first.is_error
          ? pendingByToolUseId.get(first.tool_use_id)
          : undefined
      if (name === undefined) continue

      const result = msg.toolUseResult as
        | { status?: unknown; agentId?: unknown }
        | undefined
      if (
        result !== null &&
        typeof result === 'object' &&
        (result.status === 'async_launched' || result.status === 'completed') &&
        typeof result.agentId === 'string'
      ) {
        const agentId = toAgentId(result.agentId)
        if (agentId !== null) {
          recovered.set(name, agentId)
        }
      }
    }
  }

  return recovered.size > 0 ? new Map([...existing, ...recovered]) : null
}
