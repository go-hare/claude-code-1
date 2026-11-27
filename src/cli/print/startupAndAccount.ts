/**
 * Headless startup pre-flight checks, OAuth/account readiness, CCR folder restoration,
 * rescue-yield policy, cost metadata persistence, and settings validation reporting.
 */
import { type UUID, randomUUID } from 'crypto'
import { RootSessionSlot, getBootstrapSession } from 'src/utils/sessionRoot.js'
import type { ApiErrorYieldKind } from 'src/utils/conversationRecovery.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import { posix as posixPath } from 'path'
import {
  notifyInternalMetadataChanged,
  type RestoredWorkerState,
} from 'src/utils/sessionState.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  setAdditionalDirectoriesForClaudeMd,
  getSessionId,
  getModelUsage,
  getTotalCostUSD,
  setCostStateForRestore,
  getTotalAPIDuration,
  getTotalAPIDurationWithoutRetries,
  getTotalToolDuration,
  getTotalLinesAdded,
  getTotalLinesRemoved,
  getTotalDuration,
  getTotalInputTokens,
  getTotalOutputTokens,
  getTotalCacheReadInputTokens,
  getTotalCacheCreationInputTokens,
} from 'src/bootstrap/state.js'
import { logError } from 'src/utils/log.js'
import {
  getTranscriptFullDiskState,
  getTranscriptWriterDegraded,
} from 'src/utils/sessionStorage.js'
import { getFullDiskSaveCode } from 'src/utils/config.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import { writeExitCause, writeExitDetail } from 'src/daemon/bgWorker.js'
import { isClaudeAISubscriber, getClaudeAIOAuthTokens } from 'src/utils/auth.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { getSettingsWithErrors } from 'src/utils/settings/settings.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { getAPIProvider } from 'src/utils/model/providers.js'

// Track message UUIDs received during the current root session runtime
const MAX_RECEIVED_UUIDS = 10_000

type ReceivedMessageUuidsSessionState = {
  uuids: Set<UUID>
  order: UUID[]
}

const receivedMessageUuidsSlot =
  new RootSessionSlot<ReceivedMessageUuidsSessionState>(() => ({
    uuids: new Set<UUID>(),
    order: [],
  }))

export function getReceivedMessageUuidsState(): ReceivedMessageUuidsSessionState {
  return receivedMessageUuidsSlot.of(getBootstrapSession())
}

export function trackReceivedMessageUuid(uuid: UUID): boolean {
  const { uuids, order } = getReceivedMessageUuidsState()
  if (uuids.has(uuid)) {
    return false // duplicate
  }
  uuids.add(uuid)
  order.push(uuid)
  // Evict oldest entries when at capacity
  if (order.length > MAX_RECEIVED_UUIDS) {
    const toEvict = order.splice(0, order.length - MAX_RECEIVED_UUIDS)
    for (const old of toEvict) {
      uuids.delete(old)
    }
  }
  return true // new UUID
}

// ---------------------------------------------------------------------------
// Official 2.1.328 #1645 & #1646 (`chunk@323105654.js @90000-93000, @129655`):
// Yield an API-errored rescue re-run to a waiting human prompt instead of
// re-sending the errored prompt ahead of a newer message.
// ---------------------------------------------------------------------------

const RESCUE_YIELD_OTHER_FLAG = 'tengu_giggly_oasis'
const RESCUE_YIELD_HELD_PROMPT_FLAG = 'tengu_zippy_goose'
const RESCUE_YIELD_COWORK_FLAG = 'tengu_gleaming_pony'
const RESCUE_YIELD_PAST_CALLS_FLAG = 'tengu_mutable_goblet'

export type RescueYieldCommandHead = {
  yieldsToPersonPrompt?: ApiErrorYieldKind
  wentPastOpenCalls?: boolean
  drainOnly?: boolean
}

export type RescueQueuedItemLike = {
  mode?: unknown
  isMeta?: unknown
  shouldQuery?: unknown
  queryHeldForNextTurn?: unknown
  pollEmptyDispatch?: unknown
  origin?: { kind?: unknown }
}

function isQueuedPersonPrompt(item: RescueQueuedItemLike): boolean {
  if (item.mode !== 'prompt' || item.isMeta === true) return false
  if (item.shouldQuery === false && item.queryHeldForNextTurn !== true) {
    return false
  }
  if (item.pollEmptyDispatch === true) return false
  const originKind = item.origin?.kind
  if (
    originKind !== undefined &&
    originKind !== 'human' &&
    originKind !== 'user' &&
    originKind !== 'cli' &&
    originKind !== 'remote'
  ) {
    return false
  }
  return true
}

function resolveRescueYieldSwitch(
  errorKind: ApiErrorYieldKind,
  opts?: {
    isRemote?: boolean
    otherSwitch?: 'on' | 'off'
    coworkSwitch?: 'on' | 'off'
  },
): 'on' | 'off' {
  if (opts?.coworkSwitch !== undefined) return opts.coworkSwitch
  switch (errorKind) {
    case 'rate_limit':
    case 'no_request_token':
    case 'server_error':
    case 'model_not_found':
      return (opts?.isRemote ?? Boolean(process.env.CLAUDE_CODE_REMOTE))
        ? 'on'
        : 'off'
    case 'other':
      if (opts?.otherSwitch !== undefined) return opts.otherSwitch
      return getFeatureValue_CACHED_MAY_BE_STALE(
        RESCUE_YIELD_OTHER_FLAG,
        false,
      ) === true
        ? 'on'
        : 'off'
  }
}

/** Official `BC` (`chunk@323105654.js @91838`). */
export function resolveRescueYieldErrorKind(
  head: RescueYieldCommandHead,
  opts?: {
    pastOpenCallsEnabled?: boolean
    coworkSwitch?: 'on' | 'off'
  },
): ApiErrorYieldKind | undefined {
  if (head.yieldsToPersonPrompt === undefined) return undefined
  const pastOpenCallsOn =
    opts?.pastOpenCallsEnabled ??
    getFeatureValue_CACHED_MAY_BE_STALE(RESCUE_YIELD_PAST_CALLS_FLAG, false) ===
      true
  if (head.wentPastOpenCalls && !pastOpenCallsOn) {
    return undefined
  }
  return head.yieldsToPersonPrompt
}

/**
 * Official 2.1.328 `HC` (`chunk@323105654.js @91050`): decide whether an
 * auto-resumed turn that ended on an API error should yield to a waiting
 * person prompt, emitting `tengu_resume_rescue_yield` and
 * `ccr_rescue_yields_to_prompt`.
 */
export function shouldRescueYieldToPersonPrompt(opts: {
  head: RescueYieldCommandHead
  queued: readonly RescueQueuedItemLike[]
  promptHeld: boolean
  stopLatched: boolean
  decidedAt: 'before_start' | 'during_wait'
  promptWait?: string
  isRemote?: boolean
  otherSwitch?: 'on' | 'off'
  coworkSwitch?: 'on' | 'off'
  pastOpenCallsEnabled?: boolean
  heldPromptEnabled?: boolean
}): boolean {
  const errorKind = resolveRescueYieldErrorKind(opts.head, {
    pastOpenCallsEnabled: opts.pastOpenCallsEnabled,
    coworkSwitch: opts.coworkSwitch,
  })
  if (errorKind === undefined) return false

  const heldFlagOn =
    opts.heldPromptEnabled ??
    getFeatureValue_CACHED_MAY_BE_STALE(
      RESCUE_YIELD_HELD_PROMPT_FLAG,
      false,
    ) === true
  const promptWaiting =
    opts.queued.some(isQueuedPersonPrompt) ||
    (opts.promptHeld && opts.decidedAt === 'before_start' && heldFlagOn)
  const coworkSwitch =
    opts.coworkSwitch ??
    (getFeatureValue_CACHED_MAY_BE_STALE<string>(
      RESCUE_YIELD_COWORK_FLAG,
      '',
    ) === 'on'
      ? 'on'
      : undefined)
  const switchState = resolveRescueYieldSwitch(errorKind, {
    isRemote: opts.isRemote,
    otherSwitch: opts.otherSwitch,
    coworkSwitch,
  })
  const yielded = promptWaiting && !opts.stopLatched && switchState === 'on'

  if (yielded || opts.decidedAt === 'before_start') {
    logEvent('tengu_resume_rescue_yield', {
      outcome: (yielded
        ? 'yielded'
        : 'kept') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      decided_at:
        opts.decidedAt as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      switch_state:
        switchState as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      prompt_waiting: promptWaiting,
      stop_latched: opts.stopLatched,
      drain_only: opts.head.drainOnly === true,
      ...(opts.promptWait !== undefined
        ? {
            prompt_wait:
              opts.promptWait as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
      error_kind:
        errorKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(coworkSwitch !== undefined ? { plain_cowork_switch: true } : {}),
      ...(opts.head.wentPastOpenCalls ? { went_past_open_calls: true } : {}),
    })
    if (yielded) {
      logEvent('ccr_rescue_yields_to_prompt', {
        outcome:
          'ok' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else if (promptWaiting && switchState === 'on') {
      logEvent('ccr_rescue_yields_to_prompt', {
        outcome:
          'stop_latched' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else if (promptWaiting && !opts.stopLatched && errorKind === 'other') {
      logEvent('ccr_rescue_yields_to_prompt', {
        outcome:
          'error_kind_other_switch_not_on' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  }
  return yielded
}

// ---------------------------------------------------------------------------
// Official 2.1.328 #1640 (`nw` / `tw` / `ccr_folder_restore` in
// `chunk@323105654.js @350500-353400`): persist and restore added container
// folders across cloud/CCR restarts.
// ---------------------------------------------------------------------------

const CCR_FOLDER_RESTORE_FLAG = 'tengu_twinkly_whale'
const CCR_FOLDER_RESTORE_TIMEOUT_MS = 5_000
const MAX_RESTORED_FOLDERS = 32

function parseMountPathEntry(
  raw: unknown,
): { folder: string; mountPath: string } | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.includes('\0')) return undefined
  const folder = posixPath.dirname(trimmed) + posixPath.sep
  return { folder, mountPath: trimmed }
}

export type CcrFolderStageDeps = {
  stageFile: (opts: { mount_path: string; force: boolean }) => Promise<{
    ok: boolean
    error?: string
    notFound?: boolean
  }>
  addDirectoryDestFromMountPath: (mountPath: string) => string
  isAdditionalDirsEnabled?: () => boolean
  onDirectoryAdded?: (stagedDir: string) => Promise<void> | void
}

export class CcrFolderRestorer {
  hasRestoredAFolder = false
  private isListRead = false
  private readonly mountPaths = new Map<string, string>()
  private readonly attachedHere = new Set<string>()
  private readonly notifyInternalMetadata: (
    metadata: Record<string, unknown>,
  ) => void
  private readonly isFeatureEnabled: () => boolean

  constructor(opts?: {
    notifyInternalMetadata?: (metadata: Record<string, unknown>) => void
    isFeatureEnabled?: () => boolean
  }) {
    this.notifyInternalMetadata =
      opts?.notifyInternalMetadata ?? notifyInternalMetadataChanged
    this.isFeatureEnabled =
      opts?.isFeatureEnabled ??
      (() =>
        getFeatureValue_CACHED_MAY_BE_STALE(CCR_FOLDER_RESTORE_FLAG, false) ===
        true)
  }

  getListedMountPaths(): string[] {
    return [...this.mountPaths.values()]
  }

  private hold(raw: unknown): boolean {
    const parsed = parseMountPathEntry(raw)
    if (
      parsed === undefined ||
      this.mountPaths.get(parsed.folder) === parsed.mountPath ||
      (!this.mountPaths.has(parsed.folder) &&
        this.mountPaths.size >= MAX_RESTORED_FOLDERS)
    ) {
      return false
    }
    this.mountPaths.set(parsed.folder, parsed.mountPath)
    return true
  }

  private write(): void {
    this.notifyInternalMetadata({
      added_directories: [...this.mountPaths.values()],
    })
  }

  attached(mountPath: string): void {
    const parsed = parseMountPathEntry(mountPath)
    if (parsed !== undefined) {
      this.attachedHere.add(parsed.folder)
    }
    if (this.isListRead && this.hold(mountPath) && this.isFeatureEnabled()) {
      this.write()
    }
  }

  async restore(
    restoredWorkerState: {
      readFailed?: boolean
      internal?: { added_directories?: unknown }
    } | null,
    getDeps: () => Promise<CcrFolderStageDeps>,
    timeoutMs: number = CCR_FOLDER_RESTORE_TIMEOUT_MS,
  ): Promise<void> {
    if (
      restoredWorkerState === null ||
      restoredWorkerState.readFailed === true
    ) {
      return
    }
    this.isListRead = true
    const listed = restoredWorkerState.internal?.added_directories
    for (const item of Array.isArray(listed) ? listed : []) {
      this.hold(item)
    }
    if (this.mountPaths.size === 0) return

    const completed = await Promise.race([
      this.attachListed(getDeps),
      new Promise<undefined>(resolve => {
        const timer = setTimeout(() => resolve(undefined), timeoutMs)
        timer.unref?.()
      }),
    ])
    if (completed === undefined) {
      logEvent('ccr_folder_restore', {
        outcome:
          'timed_out' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  }

  private async attachListed(
    getDeps: () => Promise<CcrFolderStageDeps>,
  ): Promise<boolean> {
    const entries = [...this.mountPaths]
    let failedStep: string | undefined
    let restoredCount = 0
    let removedCount = 0
    try {
      if (!this.isFeatureEnabled()) return true
      const deps = await getDeps()
      for (const [folder, mountPath] of entries) {
        let destPath: string
        try {
          destPath = deps.addDirectoryDestFromMountPath(mountPath)
        } catch {
          failedStep ??= 'dest'
          continue
        }
        const envEnabled =
          deps.isAdditionalDirsEnabled?.() ??
          isEnvTruthy(process.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD)
        if (!envEnabled) {
          failedStep ??= 'env'
          continue
        }
        const staged = await deps.stageFile({
          mount_path: mountPath,
          force: true,
        })
        if (staged.ok) {
          const stagedDir = posixPath.dirname(destPath)
          const currentDirs = getAdditionalDirectoriesForClaudeMd()
          if (!currentDirs.includes(stagedDir)) {
            setAdditionalDirectoriesForClaudeMd([...currentDirs, stagedDir])
          }
          await deps.onDirectoryAdded?.(stagedDir)
          restoredCount++
          this.hasRestoredAFolder = true
        } else if (staged.notFound && this.attachedHere.has(folder)) {
          restoredCount++
        } else if (staged.notFound) {
          removedCount++
          this.mountPaths.delete(folder)
        } else {
          failedStep ??= 'stage'
        }
      }
      if (removedCount > 0) {
        this.write()
      }
    } catch {
      logError(
        new Error(
          "Could not attach the session's folders again at this start. They stay listed for the next start.",
        ),
      )
      failedStep ??= 'threw'
    }
    const failedCount = entries.length - restoredCount - removedCount
    if (failedStep === undefined) {
      logEvent('ccr_folder_restore', {
        outcome:
          'ok' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        count: restoredCount,
      })
    } else {
      logEvent('ccr_folder_restore', {
        outcome:
          failedStep as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        count: failedCount,
      })
    }
    return true
  }
}

/** #1774: Filter hidden commands out of cloud session slash command menus. */
export function filterCloudSlashCommands<
  T extends { isHidden?: boolean; userInvocable?: boolean },
>(commands: readonly T[]): T[] {
  return commands.filter(cmd => cmd.userInvocable !== false && !cmd.isHidden)
}

/**
 * #1735 & #1912 / official `NT(e)` — check transcript (including Linux NFS
 * `0x6969` `sync()`) and global config full-disk errors on print exit.
 * - Always writes the stderr error message (text, json, AND stream-json).
 * - Sets exitCode = 1 for text and json.
 * - Emits `session_writes_lost` ONLY when `outputFormat === 'stream-json'` and
 *   `exitCode === 0` (never overwriting `lastErrorResultText`).
 */
export async function handlePrintFullDiskExit(opts: {
  exitCode: number
  outputFormat: string | undefined
  sdkUrl?: string
  writeStreamMessage?: (msg: Record<string, unknown>) => Promise<void> | void
  writeStderr?: (text: string) => void
  transcriptFullDiskCode?: 'ENOSPC' | 'EDQUOT' | undefined
  transcriptFullDiskPaths?: ReadonlySet<string>
  configFullDiskCode?: string | undefined
  sessionId?: string
}): Promise<{
  exitCode: number
  emittedSessionWritesLost: boolean
  stderrWritten: boolean
}> {
  const originalExitCode = opts.exitCode
  let nextExitCode = originalExitCode
  if (opts.sdkUrl) {
    return {
      exitCode: nextExitCode,
      emittedSessionWritesLost: false,
      stderrWritten: false,
    }
  }
  const fullDiskState = getTranscriptFullDiskState()
  const degraded = getTranscriptWriterDegraded()
  const degradedFullDisk: 'ENOSPC' | 'EDQUOT' | undefined =
    degraded?.code === 'ENOSPC' || degraded?.code === 'EDQUOT'
      ? degraded.code
      : undefined
  const transcriptCode =
    opts.transcriptFullDiskCode ??
    fullDiskState.fullDiskCode ??
    degradedFullDisk
  const configCode = opts.configFullDiskCode ?? getFullDiskSaveCode()
  const effectiveCode = transcriptCode ?? configCode
  if (effectiveCode === undefined) {
    return {
      exitCode: nextExitCode,
      emittedSessionWritesLost: false,
      stderrWritten: false,
    }
  }
  const format =
    opts.outputFormat === 'stream-json' || opts.outputFormat === 'json'
      ? opts.outputFormat
      : 'text'
  if (format !== 'stream-json') {
    nextExitCode = 1
  }
  const sessionId = opts.sessionId ?? getSessionId()
  const paths = opts.transcriptFullDiskPaths ?? fullDiskState.fullDiskPaths
  const affectedSessionIds = new Set<string>()
  for (const p of paths) {
    const base = p
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.jsonl$/, '')
    if (base) affectedSessionIds.add(base)
  }
  if (transcriptCode !== undefined && affectedSessionIds.size === 0) {
    affectedSessionIds.add(sessionId)
  }
  const what =
    transcriptCode !== undefined && configCode !== undefined
      ? "all of this session's transcript and changes this run made to Claude config"
      : transcriptCode !== undefined
        ? "all of this session's transcript"
        : 'changes this run made to Claude config'
  const reason =
    effectiveCode === 'EDQUOT'
      ? 'your disk quota is used up (EDQUOT)'
      : `the disk is full (${effectiveCode})`
  const parts = [`Error: Claude Code could not save ${what} because ${reason}.`]
  if (transcriptCode !== undefined) {
    parts.push(
      'If you resume this session, part of the conversation may be missing.',
    )
  }
  parts.push(
    effectiveCode === 'EDQUOT'
      ? 'Free up space, or ask for a larger quota, before the next run.'
      : 'Free up space on that disk before the next run.',
  )
  const writeStderr = opts.writeStderr ?? (t => process.stderr.write(t))
  writeStderr(`${parts.join(' ')}\n`)

  let emittedSessionWritesLost = false
  if (format === 'stream-json' && originalExitCode === 0) {
    const lost: string[] = []
    if (transcriptCode !== undefined) lost.push('transcript')
    if (configCode !== undefined) lost.push('global_config')
    await opts.writeStreamMessage?.({
      type: 'system',
      subtype: 'session_writes_lost',
      error_code: effectiveCode === 'EDQUOT' ? 'EDQUOT' : 'ENOSPC',
      lost,
      ...(affectedSessionIds.size > 0
        ? { transcript_session_ids: Array.from(affectedSessionIds) }
        : {}),
      uuid: randomUUID(),
      session_id: sessionId,
    })
    emittedSessionWritesLost = true
  }
  return {
    exitCode: nextExitCode,
    emittedSessionWritesLost,
    stderrWritten: true,
  }
}

/**
 * #1918 / official `sendsLeftToReRun` — tracks subagent/peer messages that an
 * interrupted-turn re-run is responsible for answering so a restarted cloud
 * session preserves and answers them instead of dropping or withdrawing them.
 */
export class PendingReRunSendsTracker {
  private sendsLeftToReRun = new Set<string>()
  private sendsTheRescueWouldAnswer = new Set<string>()
  private reRunToEnd:
    | {
        uuid: string
        started: boolean
        listedByAStop: boolean
        namedBy: (aim: string) => boolean
      }
    | undefined

  noteRescueWillAnswer(sendIds: Iterable<string>): void {
    for (const id of sendIds) {
      if (id) this.sendsTheRescueWouldAnswer.add(id)
    }
  }

  leaveItsSendsTo(cmd: {
    uuid?: string
    isMeta?: boolean
    resumedTurnUserMessageUuid?: string
    sendsOfItsCompactedTurn?: string[]
    alsoLeftToThisReRun?: string[]
  }): string[] {
    if (cmd.uuid === undefined) return []
    if (
      cmd.isMeta === true &&
      cmd.resumedTurnUserMessageUuid === undefined &&
      cmd.sendsOfItsCompactedTurn === undefined
    ) {
      return []
    }
    this.sendsLeftToReRun = new Set(this.sendsTheRescueWouldAnswer)
    const left = [...this.sendsLeftToReRun]
    if (left.length > 0) {
      cmd.alsoLeftToThisReRun = left
    }
    this.reRunToEnd = {
      uuid: cmd.uuid,
      started: false,
      listedByAStop: false,
      namedBy: aim => aim === cmd.uuid,
    }
    return left
  }

  markReRunStarted(uuid: string): void {
    if (this.reRunToEnd?.uuid === uuid) {
      this.reRunToEnd = { ...this.reRunToEnd, started: true }
    }
  }

  reRunAnswers(sendId: string): boolean {
    return this.sendsLeftToReRun.has(sendId)
  }

  reRunHasStillToEnd(
    isUuidQueuedOrPending: (uuid: string) => boolean = () => false,
  ): boolean {
    const r = this.reRunToEnd
    return r !== undefined && (r.started || isUuidQueuedOrPending(r.uuid))
  }

  waitsForItsReRun(
    sendId: string,
    isUuidQueuedOrPending?: (uuid: string) => boolean,
  ): boolean {
    return (
      this.sendsLeftToReRun.has(sendId) &&
      this.reRunHasStillToEnd(isUuidQueuedOrPending)
    )
  }

  declinesWithdrawalOf(
    uuid: string,
    isUuidQueuedOrPending?: (uuid: string) => boolean,
  ): boolean {
    const r = this.reRunToEnd
    return (
      r?.uuid === uuid &&
      !r.listedByAStop &&
      this.sendsLeftToReRun.size > 0 &&
      this.reRunHasStillToEnd(isUuidQueuedOrPending)
    )
  }

  noteAStopsReceipt(
    receipt: { still_queued?: string[]; cancelled?: string[] },
    opts?: { aim?: string; lateBind?: boolean },
  ): string[] {
    const r = this.reRunToEnd
    if (
      r !== undefined &&
      !opts?.lateBind &&
      receipt.still_queued?.includes(r.uuid) &&
      (opts?.aim === undefined || r.namedBy(opts.aim))
    ) {
      this.reRunToEnd = { ...r, listedByAStop: true }
    }
    return this.takeWhatWasLeftToTheReRun(receipt.cancelled ?? [])
  }

  takeWhatWasLeftToTheReRun(cancelledUuids: readonly string[]): string[] {
    const r = this.reRunToEnd
    if (r === undefined || !cancelledUuids.includes(r.uuid)) return []
    const left = [...this.sendsLeftToReRun]
    this.reRunToEnd = undefined
    this.sendsLeftToReRun = new Set()
    return left
  }

  clearAfterReRunEnded(uuid: string): void {
    if (this.reRunToEnd?.uuid === uuid) {
      this.reRunToEnd = undefined
      this.sendsLeftToReRun = new Set()
    }
  }
}

/**
 * #1947 / official `F_r` + `Q0n` + `KQt` — deny a host permission answer on
 * `AskUserQuestion` in `claude -p` / SDK sessions that attempts to set the
 * undocumented `afkTimeoutMs` input field.
 */
export const ASK_USER_QUESTION_AFK_TIMEOUT_DENY_MESSAGE =
  'Claude Code did not accept a report that nobody answered'

export function validateAskUserQuestionPermissionAnswer<
  T extends {
    behavior: string
    updatedInput?: Record<string, unknown>
    message?: string
    decisionReason?: unknown
  },
>(
  tool: { name: string; isMcp?: boolean },
  result: T,
  toolUseId?: string,
):
  | T
  | import('src/utils/permissions/PermissionResult.js').PermissionDenyDecision {
  if (
    result.behavior === 'allow' &&
    tool.name === 'AskUserQuestion' &&
    tool.isMcp !== true &&
    result.updatedInput !== undefined &&
    result.updatedInput !== null &&
    typeof result.updatedInput === 'object' &&
    'afkTimeoutMs' in result.updatedInput &&
    (result.updatedInput as { afkTimeoutMs?: unknown }).afkTimeoutMs !==
      undefined
  ) {
    logForDiagnosticsNoPII('warn', 'ask_user_question_no_answer_offer', {
      reason: 'not_offered',
    })
    return {
      behavior: 'deny',
      message: ASK_USER_QUESTION_AFK_TIMEOUT_DENY_MESSAGE,
      ...(toolUseId !== undefined ? { toolUseID: toolUseId } : {}),
      decisionReason: {
        type: 'other',
        reason: ASK_USER_QUESTION_AFK_TIMEOUT_DENY_MESSAGE,
      },
    }
  }
  return result
}

export function guardAskUserQuestionAfkTimeout(
  baseCanUseTool: CanUseToolFn,
): CanUseToolFn {
  return async (
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseId,
    forceDecision,
  ) => {
    const res = await baseCanUseTool(
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseId,
      forceDecision,
    )
    return validateAskUserQuestionPermissionAnswer(
      tool,
      res as Parameters<typeof validateAskUserQuestionPermissionAnswer>[1],
      toolUseId,
    ) as typeof res
  }
}

/** #1959: True when this headless process serves a Remote Control client. */
export function isRemoteControlOriginForSetCwd(
  opts: { sdkUrl?: string; hasBridgeHandle?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    opts.hasBridgeHandle ||
      env.CLAUDE_CODE_BRIDGE_SESSION_ID ||
      env.CLAUDE_CODE_REMOTE_CONTROL ||
      (opts.sdkUrl &&
        env.CLAUDE_CODE_REMOTE_SESSION_ORIGIN === 'remote_control'),
  )
}

/** #1927: Record fatal startup/worktree error in CLAUDE_JOB_DIR/exit-detail. */
export function reportPrintStartupFatalToJobDir(
  cause: string,
  detail: string,
  jobDir?: string,
): void {
  writeExitCause(cause, jobDir)
  writeExitDetail(cause, detail, jobDir)
}

/**
 * Official 2.1.325 #2376:
 * When `claude -p` runs in a clean environment with no cached OAuth account
 * data yet (`oauthAccount` absent or missing `billingType`/`accountCreatedAt`/
 * `subscriptionCreatedAt`), wait for `populateOAuthAccountInfoIfNeeded()` to
 * finish (bounded by timeout) before sending the first API request.
 */
export const PRINT_ACCOUNT_DATA_WAIT_TIMEOUT_MS = 10_000

export function hasCachedOAuthAccountData(
  oauthAccount:
    | {
        accountUuid?: string
        organizationUuid?: string
        billingType?: unknown
        accountCreatedAt?: unknown
        subscriptionCreatedAt?: unknown
      }
    | undefined
    | null,
): boolean {
  return Boolean(
    oauthAccount &&
      oauthAccount.accountUuid &&
      oauthAccount.organizationUuid &&
      oauthAccount.billingType !== undefined &&
      oauthAccount.accountCreatedAt !== undefined &&
      oauthAccount.subscriptionCreatedAt !== undefined,
  )
}

export async function waitForCachedAccountDataBeforePrint(deps?: {
  isSubscriber?: () => boolean
  hasProfileScope?: () => boolean
  getOAuthAccount?: () =>
    | {
        accountUuid?: string
        organizationUuid?: string
        billingType?: unknown
        accountCreatedAt?: unknown
        subscriptionCreatedAt?: unknown
      }
    | undefined
  populateAccountInfo?: () => Promise<boolean>
  timeoutMs?: number
}): Promise<{ waited: boolean; populated: boolean; timedOut: boolean }> {
  const isSubscriber = deps?.isSubscriber ?? isClaudeAISubscriber
  if (!isSubscriber()) {
    return { waited: false, populated: false, timedOut: false }
  }
  let profileScopeOk = true
  if (deps?.hasProfileScope) {
    profileScopeOk = deps.hasProfileScope()
  } else {
    try {
      const { hasProfileScope } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/auth.js') as typeof import('../../utils/auth.js')
      profileScopeOk = hasProfileScope()
    } catch {
      profileScopeOk = false
    }
  }
  if (!profileScopeOk) {
    return { waited: false, populated: false, timedOut: false }
  }
  const currentAccount = deps?.getOAuthAccount
    ? deps.getOAuthAccount()
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (
        require('../../utils/config.js') as typeof import('../../utils/config.js')
      ).getGlobalConfig().oauthAccount
  if (hasCachedOAuthAccountData(currentAccount)) {
    return { waited: false, populated: false, timedOut: false }
  }
  const populate =
    deps?.populateAccountInfo ??
    (async () => {
      const { populateOAuthAccountInfoIfNeeded } = await import(
        '../../services/oauth/client.js'
      )
      return populateOAuthAccountInfoIfNeeded()
    })
  const timeoutMs = deps?.timeoutMs ?? PRINT_ACCOUNT_DATA_WAIT_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      populate().then(populated => ({ populated, timedOut: false })),
      new Promise<{ populated: boolean; timedOut: boolean }>(resolve => {
        timer = setTimeout(
          () => resolve({ populated: false, timedOut: true }),
          timeoutMs,
        )
        timer.unref?.()
      }),
    ])
    return { waited: true, ...result }
  } catch (err) {
    logForDebugging(
      `[print.ts] waitForCachedAccountDataBeforePrint failed: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    return { waited: true, populated: false, timedOut: false }
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/**
 * Official 2.1.328 (#545): returns true when `CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME`
 * is truthy, disabling automatic resumption of hook-deferred tool calls on
 * `claude -p --resume` / `--continue`.
 */
export function isDeferredToolResumeDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME)
}

const SETTINGS_ERRORS_PER_FILE_LIMIT = 10
const SETTINGS_ERROR_MAX_CODE_UNITS = 500

function truncateCodeUnits(value: string, maxCodeUnits: number): string {
  if (value.length <= maxCodeUnits) return value
  return `${value.slice(0, maxCodeUnits)}…`
}

function formatSettingsValidationGroup(
  errors: Array<{ file?: string; path?: unknown; message: string }>,
): string {
  const byFile = new Map<
    string,
    Array<{ file?: string; path?: unknown; message: string }>
  >()
  for (const err of errors) {
    const file = err.file ?? '<unknown>'
    const list = byFile.get(file)
    if (list) list.push(err)
    else byFile.set(file, [err])
  }
  const lines: string[] = []
  for (const [file, list] of byFile) {
    const fileLabel = truncateCodeUnits(file, SETTINGS_ERROR_MAX_CODE_UNITS)
    for (const err of list.slice(0, SETTINGS_ERRORS_PER_FILE_LIMIT)) {
      const pathStr = err.path
        ? truncateCodeUnits(String(err.path), SETTINGS_ERROR_MAX_CODE_UNITS)
        : ''
      const msgStr = truncateCodeUnits(
        err.message,
        SETTINGS_ERROR_MAX_CODE_UNITS,
      )
      lines.push(`  ${fileLabel}${pathStr ? ` (${pathStr})` : ''}: ${msgStr}`)
    }
    if (list.length > SETTINGS_ERRORS_PER_FILE_LIMIT) {
      lines.push(
        `  … and ${list.length - SETTINGS_ERRORS_PER_FILE_LIMIT} more in ${fileLabel}`,
      )
    }
  }
  return lines.join('\n')
}

/**
 * Official 2.1.299 (#640) `tF(outputFormat)`: log settings validation errors
 * and print them to stderr in `claude -p` text-output mode.
 */
export function reportHeadlessSettingsValidationErrors(
  outputFormat: string | undefined,
  writeStderr: (text: string) => void = text => process.stderr.write(text),
): void {
  const { errors } = getSettingsWithErrors()
  const filtered = errors.filter(
    e =>
      !e.mcpErrorMetadata &&
      !(e as { statusOnly?: boolean }).statusOnly &&
      !(e as { startupFatal?: boolean }).startupFatal,
  )
  if (filtered.length === 0) return
  const notLoaded = filtered.filter(
    e => (e as { severity?: string }).severity !== 'warning',
  )
  const notLoadedFiles = new Set(notLoaded.map(e => e.file))
  const skipped = filtered.filter(e => !notLoadedFiles.has(e.file))
  for (const e of filtered) {
    logForDebugging(
      `Invalid setting skipped without dialog (automated session): ${e.file ?? '<unknown>'}: ${String(e.path ?? '')}: ${e.message}`,
      { level: 'error' },
    )
  }
  logEvent('tengu_own_settings_validation_errors', {
    not_loaded_file_count: notLoadedFiles.size,
    skipped_entry_count: skipped.length,
  })
  if (outputFormat === 'json' || outputFormat === 'stream-json') return
  const sections: string[] = []
  if (notLoaded.length > 0) {
    sections.push(
      `These settings files did not load, so nothing in them is in effect, including hooks and permission rules. Each loads again once the problem listed for it is fixed:\n${formatSettingsValidationGroup(notLoaded)}`,
    )
  }
  if (skipped.length > 0) {
    sections.push(
      `These settings entries were skipped; the rest of each file is in effect:\n${formatSettingsValidationGroup(skipped)}`,
    )
  }
  if (sections.length > 0) {
    writeStderr(`${sections.join('\n')}\n`)
  }
}

/**
 * Official 2.1.299 (#599) `DE({running, runPhase, inputClosed})`:
 * Allow scheduled wakeups to fire while waiting for background agents.
 */
export function isHeadlessCronLoading(opts: {
  running: boolean
  runPhase: string | undefined
  inputClosed: boolean
  hasPendingWakeup?: boolean
}): boolean {
  if (opts.inputClosed) {
    return !(
      opts.running &&
      opts.runPhase === 'waiting_for_agents' &&
      opts.hasPendingWakeup === true
    )
  }
  return opts.running && opts.runPhase !== 'waiting_for_agents'
}

/**
 * Official 2.1.299 (#632): resize/downsample inline base64 image blocks in
 * stream-json SDK user messages before queuing.
 */
export async function resizeInboundImageBlocks(
  content: string | ContentBlockParam[],
): Promise<string | ContentBlockParam[]> {
  if (!Array.isArray(content)) return content
  const hasImage = content.some(
    b =>
      b !== null &&
      typeof b === 'object' &&
      b.type === 'image' &&
      b.source?.type === 'base64' &&
      typeof b.source.data === 'string',
  )
  if (!hasImage) return content
  const { maybeResizeAndDownsampleImageBuffer } = await import(
    '../../utils/imageResizer.js'
  )
  return Promise.all(
    content.map(async block => {
      if (
        block === null ||
        typeof block !== 'object' ||
        block.type !== 'image' ||
        block.source?.type !== 'base64' ||
        typeof block.source.data !== 'string'
      ) {
        return block
      }
      try {
        const buf = Buffer.from(block.source.data, 'base64')
        const ext = block.source.media_type?.split('/')[1] || 'png'
        const resized = await maybeResizeAndDownsampleImageBuffer(
          buf,
          buf.length,
          ext,
        )
        const normalized =
          resized.mediaType === 'jpg' ? 'jpeg' : resized.mediaType
        return {
          ...block,
          source: {
            ...block.source,
            type: 'base64' as const,
            media_type:
              `image/${normalized}` as import('@anthropic-ai/sdk/resources').Base64ImageSource['media_type'],
            data: resized.buffer.toString('base64'),
          },
        }
      } catch {
        return block
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// #917: Cloud session cost restore & metadata push (official dA / Qy)
// ---------------------------------------------------------------------------

const MAX_COST_STATE_METADATA_BYTES = 16_384

type PersistedCostStatePayload = {
  totalCostUSD: number
  totalAPIDuration: number
  totalAPIDurationWithoutRetries: number
  totalToolDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  lastDuration?: number
  modelUsage?: ReturnType<typeof getModelUsage>
}

function isValidPersistedCostState(
  raw: unknown,
): raw is PersistedCostStatePayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const rec = raw as Record<string, unknown>
  return (
    typeof rec.totalCostUSD === 'number' &&
    Number.isFinite(rec.totalCostUSD) &&
    typeof rec.totalAPIDuration === 'number' &&
    Number.isFinite(rec.totalAPIDuration) &&
    typeof rec.totalAPIDurationWithoutRetries === 'number' &&
    Number.isFinite(rec.totalAPIDurationWithoutRetries) &&
    typeof rec.totalToolDuration === 'number' &&
    Number.isFinite(rec.totalToolDuration) &&
    typeof rec.totalLinesAdded === 'number' &&
    Number.isFinite(rec.totalLinesAdded) &&
    typeof rec.totalLinesRemoved === 'number' &&
    Number.isFinite(rec.totalLinesRemoved)
  )
}

export function restoreCostStateFromWorker(
  restored: RestoredWorkerState | null | undefined,
): boolean {
  const raw = restored?.internal?.cost_state
  if (
    typeof raw !== 'string' ||
    Buffer.byteLength(raw) > MAX_COST_STATE_METADATA_BYTES
  ) {
    return false
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isValidPersistedCostState(parsed)) return false
    if (parsed.totalCostUSD < getTotalCostUSD()) return false
    setCostStateForRestore({
      totalCostUSD: parsed.totalCostUSD,
      totalAPIDuration: parsed.totalAPIDuration,
      totalAPIDurationWithoutRetries: parsed.totalAPIDurationWithoutRetries,
      totalToolDuration: parsed.totalToolDuration,
      totalLinesAdded: parsed.totalLinesAdded,
      totalLinesRemoved: parsed.totalLinesRemoved,
      lastDuration: parsed.lastDuration,
      modelUsage: parsed.modelUsage,
    })
    return true
  } catch {
    return false
  }
}

export class CostMetadataPusher {
  private lastPushedCostUsd = 0
  private lastSavedTotalCostUsd = getTotalCostUSD()
  constructor(
    private readonly notifyInternal: (patch: Record<string, unknown>) => void,
  ) {}

  pushIfChanged(extra?: Record<string, unknown>): void {
    const totalCost = getTotalCostUSD()
    const costChanged = totalCost !== this.lastPushedCostUsd
    if (!costChanged && totalCost === this.lastSavedTotalCostUsd) {
      if (extra !== undefined) {
        this.notifyInternal(extra)
      }
      return
    }
    const snapshot: PersistedCostStatePayload = {
      totalCostUSD: totalCost,
      totalAPIDuration: getTotalAPIDuration(),
      totalAPIDurationWithoutRetries: getTotalAPIDurationWithoutRetries(),
      totalToolDuration: getTotalToolDuration(),
      totalLinesAdded: getTotalLinesAdded(),
      totalLinesRemoved: getTotalLinesRemoved(),
      lastDuration: getTotalDuration(),
      modelUsage: getModelUsage(),
    }
    const serialized = JSON.stringify(snapshot)
    this.notifyInternal({
      ...extra,
      ...(costChanged
        ? {
            cumulative_cost_usd: totalCost,
            cumulative_input_tokens: getTotalInputTokens(),
            cumulative_output_tokens: getTotalOutputTokens(),
            cumulative_cache_read_tokens: getTotalCacheReadInputTokens(),
            cumulative_cache_write_tokens: getTotalCacheCreationInputTokens(),
          }
        : {}),
      ...(Buffer.byteLength(serialized) <= MAX_COST_STATE_METADATA_BYTES
        ? { cost_state: serialized }
        : {}),
    })
    this.lastSavedTotalCostUsd = totalCost
    this.lastPushedCostUsd = totalCost
  }
}

const OAUTH_EXPIRY_DAY_MS = 86_400_000
const OAUTH_EXPIRY_WINDOW_DAYS = 3
const OAUTH_EXPIRY_WARN_LEAD_DAYS = 7 + OAUTH_EXPIRY_WINDOW_DAYS

/**
 * Official `Syi` (#1619) — warn on stderr (single line) within 10 days of
 * claude.ai refresh token expiry in non-json/non-stream-json print mode.
 */
export function warnOAuthExpiryBeforePrint(
  nowMs: number = Date.now(),
  tokens: {
    refreshToken?: string
    refreshTokenExpiresAt?: number
    expiresAt?: number
  } | null = getAPIProvider() === 'firstParty' && isClaudeAISubscriber()
    ? getClaudeAIOAuthTokens()
    : null,
  writeStderr: (line: string) => void = line => {
    process.stderr.write(line)
  },
): boolean {
  try {
    if (
      !tokens?.refreshToken ||
      typeof tokens.refreshTokenExpiresAt !== 'number' ||
      !Number.isFinite(tokens.refreshTokenExpiresAt)
    ) {
      return false
    }
    const expiresAtMs = tokens.refreshTokenExpiresAt
    if (
      typeof tokens.expiresAt === 'number' &&
      tokens.expiresAt >
        expiresAtMs + OAUTH_EXPIRY_WINDOW_DAYS * OAUTH_EXPIRY_DAY_MS
    ) {
      return false
    }
    const remainingMs = expiresAtMs - nowMs
    if (remainingMs >= OAUTH_EXPIRY_WARN_LEAD_DAYS * OAUTH_EXPIRY_DAY_MS) {
      return false
    }
    const earliestMs =
      expiresAtMs - OAUTH_EXPIRY_WINDOW_DAYS * OAUTH_EXPIRY_DAY_MS
    const earliest = new Date(earliestMs).toISOString().slice(0, 10)
    const latest = new Date(expiresAtMs).toISOString().slice(0, 10)
    const daysToEarliest =
      Math.floor(earliestMs / OAUTH_EXPIRY_DAY_MS) -
      Math.floor(nowMs / OAUTH_EXPIRY_DAY_MS)
    const line =
      remainingMs <= 0
        ? `Warning: this sign-in may have ended between ${earliest} and ${latest}. If requests are refused, run claude auth login, or use claude setup-token for unattended jobs.\n`
        : daysToEarliest < 1
          ? `Warning: this sign-in can end at any time from now until ${latest}. Renewing it does not move that date. Run claude auth login now, or use claude setup-token for unattended jobs.\n`
          : `Warning: this sign-in ends between ${earliest} and ${latest} (in ${daysToEarliest} ${daysToEarliest === 1 ? 'day' : 'days'} at the earliest). Renewing it does not move those dates. Run claude auth login before then, or use claude setup-token for unattended jobs.\n`
    writeStderr(line)
    logEvent('oauth_expiry_warning', {})
    return true
  } catch (e) {
    logError(e)
    return false
  }
}
