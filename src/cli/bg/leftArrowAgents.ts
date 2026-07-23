/**
 * Official Sj4 densable — left-arrow open AgentsView from REPL.
 *
 * Flow (2.1.211 aAf):
 *   seed → hcn/A8q write job (cwd=worktreePath, worktree meta when created)
 *   → adopt.json prefill (portable bgCheckpoint; heavy task carry optional)
 *   → bridge flush + teardown({skipArchive})
 *   → ky6/submitDispatch with rit() CLAUDE_BRIDGE_REATTACH_* env
 *   → mount FleetView with CLAUDE_AGENTS_SELECT = short
 */

import { randomUUID } from 'crypto'
import { copyFile, mkdir, rm } from 'fs/promises'
import { dirname } from 'path'
import {
  deriveBackgroundSeed,
  seedForLeftArrow,
  type BackgroundSeedMessage,
} from './helpers.js'
import {
  readBgJobState,
  writeA8qJobState,
  writeBgJobState,
} from '../../daemon/jobState.js'
import {
  getOriginalCwd,
  getSessionId,
  isSessionPersistenceDisabled,
} from '../../bootstrap/state.js'
import {
  getCurrentSessionTitle,
  getTranscriptPathForSession,
} from '../../utils/sessionStorage.js'
import { asSessionId } from '../../types/ids.js'
import { getCurrentWorktreeSession } from '../../utils/worktree.js'
import { clearBridgeSessionMeta } from '../../bridge/bridgeSessionMeta.js'
import { getReplBridgeHandle } from '../../bridge/replBridgeHandle.js'
import {
  abandonCheckpointShells,
  buildAdoptWritePayload,
  buildMidTurnPrefill,
  emptyCheckpointPayload,
  enrichShellsWithProcStart,
  runLeftArrowPostAdoptCheckpoint,
  takeLeftArrowCheckpointLive,
  type BgCheckpointPayload,
  writeAdoptJson,
} from '../../utils/bgCheckpoint.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'

export type LeftArrowOpenResult =
  | { ok: true; short: string; sessionId: string }
  | { ok: false; error: string }

export type LeftArrowOpenOptions = {
  /** Official Sj4 `z` — haiku/AI title when seed has no name. */
  haikuTitle?: string | null
  sessionTitle?: string | null
  agentColor?: string
  /**
   * Official aAf via — idle-fork | abort-then-fork.
   * Prefill only when abort-then-fork + partial text (portable gate).
   */
  via?: string
  /** Streaming partial assistant text for mid-turn prefill. */
  partialText?: string | null
  boundaryUuid?: string
  /** Live agents count — official skips prefill when agents present. */
  agentsCount?: number
  /** Optional cron/shell checkpoint payload (heavy task carry). */
  checkpoint?: {
    shells?: unknown[]
    cron?: Array<{
      id: string
      cron: string
      prompt: string
      createdAt?: number
      recurring?: boolean
      agentId?: string
      kind?: string
    }>
    agents?: unknown[]
    workflows?: unknown[]
  }
  /** Official aAf → hcn sessionPermissionRules. */
  sessionPermissionRules?: { allow: string[]; deny: string[] }
  /** Official aAf → hcn memoryToggledOff. */
  memoryToggledOff?: boolean
  /**
   * densable aAf `replyOnResume` — spawn with `--reply-on-resume` and
   * lengthen bridge flush cap to 5s (default 2s).
   */
  replyOnResume?: boolean
  /**
   * densable aAf `abortAfterFlush` — query AbortController. After bridge
   * teardown, session-storage flush (2s cap); after spawn kickoff, abort
   * with reason `"background"` (official J0("background")).
   */
  abortAfterFlush?: AbortController
}

/**
 * Official rit(session, seq, outboundOnly, grouping) → CLAUDE_BRIDGE_REATTACH_*.
 */
export function buildBridgeReattachEnv(
  bridgeSessionId: string | undefined | null,
  opts?: {
    seq?: number
    outboundOnly?: boolean
    grouping?: string
  },
): Record<string, string> | undefined {
  if (!bridgeSessionId) return undefined
  const env: Record<string, string> = {
    CLAUDE_BRIDGE_REATTACH_SESSION: bridgeSessionId,
  }
  if (opts?.seq !== undefined && opts.seq > 0) {
    env.CLAUDE_BRIDGE_REATTACH_SEQ = String(opts.seq)
  }
  if (opts?.grouping) {
    env.CLAUDE_BRIDGE_REATTACH_GROUPING = opts.grouping
  }
  // Official: outboundOnly defaults true when r !== false
  if (opts?.outboundOnly !== false) {
    env.CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY = '1'
  }
  return env
}

/** densable aAf bridge flush cap (ms) when not replyOnResume. */
export const BRIDGE_FLUSH_CAP_MS = 2000
/** densable aAf bridge flush cap (ms) when replyOnResume. */
export const BRIDGE_FLUSH_CAP_REPLY_ON_RESUME_MS = 5000
/** densable aAf session-storage flush cap when abortAfterFlush (ms). */
export const SESSION_FLUSH_CAP_MS = 2000
/** Official pqb task-list carry cap (ms). */
const TASK_LIST_CARRY_CAP_MS = 2000

/**
 * densable bridge flush timeout: replyOnResume → 5s else 2s.
 */
export function bridgeFlushCapMs(replyOnResume?: boolean): number {
  return replyOnResume
    ? BRIDGE_FLUSH_CAP_REPLY_ON_RESUME_MS
    : BRIDGE_FLUSH_CAP_MS
}

/**
 * densable nzu(je, tl) — idle-fork replyOnResume when turn-start snapshot
 * still prefixes current messages and only non-user/assistant rows were
 * appended since (no new user/assistant turn content).
 */
export function shouldReplyOnIdleFork(
  snap: { length: number; uuid?: string } | null | undefined,
  messages: readonly { type?: string; uuid?: string }[],
): boolean {
  if (snap == null || snap.length < 1 || snap.length > messages.length) {
    return false
  }
  if (messages[snap.length - 1]?.uuid !== snap.uuid) {
    return false
  }
  for (let i = snap.length; i < messages.length; i++) {
    const t = messages[i]?.type
    if (t === 'user' || t === 'assistant') return false
  }
  return true
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), ms)
        timer.unref?.()
      }),
    ])
  } catch {
    return undefined
  } finally {
    if (timer) clearTimeout(timer)
  }
  void label
}

/**
 * Official pqb portable — copy `~/.claude/tasks/<fromSession>` entries into
 * the fork session task list when neither CLAUDE_CODE_TASK_LIST_ID nor a
 * non-session id is already active. Best-effort; aborts after cap.
 */
export async function carryTaskListToFork(
  toSessionId: string,
  fromSessionId: string | undefined | null,
  opts?: { signal?: AbortSignal; capMs?: number },
): Promise<void> {
  if (!fromSessionId || fromSessionId === toSessionId) return
  if (process.env.CLAUDE_CODE_TASK_LIST_ID) return

  const { readdir, copyFile, mkdir } = await import('fs/promises')
  const { join } = await import('path')
  const { getTasksDir, ensureTasksDir } = await import('../../utils/tasks.js')

  const fromDir = getTasksDir(fromSessionId)
  const toDir = getTasksDir(toSessionId)
  let entries: string[]
  try {
    entries = await readdir(fromDir)
  } catch {
    return
  }
  if (entries.length === 0) return

  await ensureTasksDir(toSessionId)
  // ensureTasksDir already mkdir; keep explicit mkdir for race-safety
  await mkdir(toDir, { recursive: true }).catch(() => {})

  const signal = opts?.signal
  const capMs = opts?.capMs ?? TASK_LIST_CARRY_CAP_MS
  const deadline = Date.now() + capMs
  for (const name of entries) {
    if (signal?.aborted || Date.now() > deadline) break
    // Official: only file entries; skip lock/high-water special files by name.
    if (name === '.lock' || name === '.high-water-mark') continue
    try {
      await copyFile(join(fromDir, name), join(toDir, name))
    } catch {
      // skip individual failures
    }
  }
}

/**
 * densable jo: attach telemetryMessage when object is extensible and field free.
 * Swallows assign failures (same as official).
 */
export function attachErrorTelemetryMessage(
  error: object,
  telemetryMessage: string,
): void {
  try {
    if (!('telemetryMessage' in error) && Object.isExtensible(error)) {
      Object.assign(error, { telemetryMessage })
    }
  } catch {
    /* densable jo swallows */
  }
}

/**
 * densable yNo reason suffix from err.code when it looks like a Node system code
 * (`_p`: /^[A-Z][A-Z0-9_]{0,63}$/), else `spawn_failed_unknown`.
 */
export function spawnFailReasonFromError(err: unknown): string {
  const code =
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : undefined
  if (code && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
    return `spawn_failed_${code}`
  }
  return 'spawn_failed_unknown'
}

/**
 * densable aAf yNo fail branch gate:
 *   reason undefined | spawn_failed_unknown | spawn_failed_ERR_* → xe
 *   else → C warn
 * Note: spawn_failed_ENOENT (plain system codes) is **warn**, not xe.
 */
export function isBackgroundSpawnLogErrorReason(reason?: string): boolean {
  return (
    reason === undefined ||
    reason === 'spawn_failed_unknown' ||
    reason.startsWith('spawn_failed_ERR_')
  )
}

/**
 * densable aAf yNo fail branch:
 *   logError path → xe(jo(Error(`background spawn failed: ${error}`), telemetry))
 *   else → C(…, {level:"warn"})
 *
 * Local: logError ≈ xe; logForDebugging warn ≈ C. No UI toast (official none).
 */
export function reportBackgroundSpawnFail(
  errorText: string,
  reason?: string,
): void {
  if (isBackgroundSpawnLogErrorReason(reason)) {
    const err = new Error(`background spawn failed: ${errorText}`)
    attachErrorTelemetryMessage(
      err,
      `background spawn failed: ${reason ?? 'unclassified'}`,
    )
    logError(err)
    return
  }
  logForDebugging(`background spawn failed: ${errorText}`, { level: 'warn' })
}

/** densable left-arrow fail detail when adopt delayed expire / retry. */
export const LEFT_ARROW_SPAWN_FAIL_RETRY_DETAIL =
  "couldn't start in the background \u2014 press Enter to retry"

/**
 * densable yNo fail branch when `!x.ok && left_arrow && providedSessionId &&
 * resumeTranscript && !x.alive`:
 *   copy resume jsonl → fork session jsonl
 *   patch job state failed/idle + linkScanPath + respawnFlags
 *   → We("repl_background_fork","queued_for_later")
 *
 * Returns true when job is kept for Enter-to-retry (do NOT rm job dir).
 * densable short_alive skips this (`!x.alive` gate).
 */
export async function tryQueueLeftArrowSpawnFail(opts: {
  short: string
  providedSessionId: string
  resumeSessionId: string
  respawnFlags?: string[]
}): Promise<boolean> {
  const state = readBgJobState(opts.short)
  if (!state) return false
  const src = getTranscriptPathForSession(opts.resumeSessionId)
  const dest = getTranscriptPathForSession(opts.providedSessionId)
  try {
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(src, dest)
    writeBgJobState(opts.short, {
      ...state,
      state: 'failed',
      tempo: 'idle',
      needs: undefined,
      block: undefined,
      inFlight: undefined,
      detail: LEFT_ARROW_SPAWN_FAIL_RETRY_DETAIL,
      linkScanPath: dest,
      respawnFlags: opts.respawnFlags ?? state.respawnFlags ?? [],
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch (err) {
    logError(err)
    // densable: copy/rm fail → I=false, drop linkScanPath file best-effort
    await rm(dest, { force: true }).catch(() => {})
    return false
  }
}

/**
 * densable left_arrow fail telemetry:
 *   queued → We / tengu_feature_sad queued_for_later
 *   else → me / tengu_feature_bad spawn_failed
 */
export function reportLeftArrowSpawnFailOutcome(queued: boolean): void {
  if (queued) {
    logEvent('tengu_feature_sad', {
      feature_name:
        'repl_background_fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'queued_for_later' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else {
    logEvent('tengu_feature_bad', {
      feature_name:
        'repl_background_fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'spawn_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
}

/**
 * Official Sj4/aAf body (without process.exit). Returns short/sessionId for FleetView.
 * Spawn is fire-and-forget like official ky6().then(...).
 */
export async function openAgentsViaLeftArrow(
  messages: readonly BackgroundSeedMessage[],
  options?: LeftArrowOpenOptions,
): Promise<LeftArrowOpenResult> {
  let resumeSessionId: string | undefined
  try {
    resumeSessionId = getSessionId()
  } catch {
    resumeSessionId = undefined
  }

  // Handoff requires a resumable session. Without resumeSessionId we cannot
  // submitDispatch — must not checkpoint/disown (would kill agents with no
  // worker to resume them) and must not report ok.
  if (!resumeSessionId) {
    try {
      takeLeftArrowCheckpointLive()
    } catch {
      /* best-effort — drop stashed CAo without abort */
    }
    return {
      ok: false,
      error:
        'Cannot open agents — no active session id; background handoff requires a resumable session.',
    }
  }

  const sessionTitle =
    options?.sessionTitle ??
    getCurrentSessionTitle(asSessionId(resumeSessionId))

  // Official Sj4: Vy6 non-null + persistence disabled → refuse.
  // Empty conversation (Vy6 null) still opens agents.
  // densable aAf: return error string only — do NOT checkpoint/disown (would
  // abort live agents with no fork to resume). Drop stashed CAo like the
  // !resumeSessionId / job-state write-fail paths.
  if (
    isSessionPersistenceDisabled() &&
    deriveBackgroundSeed(messages, '', {
      sessionTitle,
      sessionAiTitle: options?.haikuTitle,
      agentColor: options?.agentColor,
    }) !== null
  ) {
    try {
      takeLeftArrowCheckpointLive()
    } catch {
      /* best-effort — drop stashed CAo without abort */
    }
    return {
      ok: false,
      error:
        'Cannot open agents — session persistence is disabled, so this conversation cannot be backgrounded.',
    }
  }

  const seed = seedForLeftArrow(messages, {
    sessionTitle,
    haikuTitle: options?.haikuTitle,
    agentColor: options?.agentColor,
  })

  // Official A8q: always allocate a fresh job session id.
  const providedSessionId = randomUUID()

  // Official: cwd = worktreePath ?? originalCwd; worktree meta only when created
  // (not mere enter-existing). Local: creationDurationMs is set on create, unset
  // on enterExistingWorktreeSession / restore.
  const wt = getCurrentWorktreeSession()
  const cwd = wt?.worktreePath ?? getOriginalCwd()
  const createdWorktree = Boolean(wt && wt.creationDurationMs !== undefined)
  const worktree = createdWorktree
    ? {
        path: wt!.worktreePath,
        branch: wt!.worktreeBranch,
        hookBased: wt!.hookBased ?? false,
        originCwd: wt!.originalCwd,
      }
    : undefined

  // Capture bridge handle BEFORE teardown clears the global pointer.
  const bridge = getReplBridgeHandle()
  const bridgeSessionId = bridge?.bridgeSessionId
  const seq =
    bridge?.getLastSequenceNum?.() ?? bridge?.getSSESequenceNum?.() ?? undefined
  const reattachEnv = buildBridgeReattachEnv(bridgeSessionId, {
    seq,
    outboundOnly: bridge?.outboundOnly,
    grouping: bridge?.sessionGroupingId,
  })

  let short: string
  let jobDir: string
  try {
    ;({ short, jobDir } = writeA8qJobState({
      sessionId: providedSessionId,
      cwd,
      intent: seed.intent ?? '',
      name: seed.name,
      nameSource: seed.nameSource,
      detail: seed.detail,
      color: seed.color,
      resumeSessionId,
      worktree,
      bridgeSessionId,
      bridgeOutboundOnly: reattachEnv
        ? reattachEnv.CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY === '1'
        : undefined,
      bridgeSessionSeq: seq,
      // densable hcn bridgeSessionGroupingId for rit n on worker respawn
      bridgeSessionGroupingId: bridge?.sessionGroupingId,
      sessionPermissionRules: options?.sessionPermissionRules,
      memoryToggledOff: options?.memoryToggledOff,
    }))
  } catch (e) {
    // densable: job-state write failed before handoff — drop stashed CAo
    // without checkpointAgents/disown so session cron/agents stay in parent.
    try {
      const { takeLeftArrowCheckpointLive } = await import(
        '../../utils/bgCheckpoint.js'
      )
      takeLeftArrowCheckpointLive()
    } catch {
      /* best-effort */
    }
    return {
      ok: false,
      error: `Cannot open agents — ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Official pqb: copy task-list files from resume session → new fork session
  // (capped; best-effort; skip when CLAUDE_CODE_TASK_LIST_ID is set or ids match).
  if (resumeSessionId) {
    try {
      await carryTaskListToFork(providedSessionId, resumeSessionId)
    } catch {
      // ignore — spawn still proceeds
    }
  }

  // Official aAf: write adopt.json (checkpoint + optional mid-turn prefill)
  // before bridge teardown / spawn. Keep payload for abandon on spawn fail.
  // Official wraps Jlr + checkpointAgents + disown in one try — write fail
  // skips abort so agents keep running (catch sets y=null).
  let writtenCheckpoint: BgCheckpointPayload | undefined
  let adoptWriteOk = false
  try {
    const prefill = buildMidTurnPrefill({
      via: options?.via,
      partialText: options?.partialText,
      boundaryUuid: options?.boundaryUuid,
      bridgeActive: Boolean(bridge),
      agentsCount: options?.agentsCount ?? options?.checkpoint?.agents?.length,
    })
    const base = emptyCheckpointPayload()
    if (options?.checkpoint) {
      // Official fDs: attach procStart (Ex/lstart) identity before adopt write.
      base.shells = await enrichShellsWithProcStart(
        options.checkpoint.shells ?? [],
      )
      base.cron = options.checkpoint.cron ?? []
      if (options.checkpoint.agents?.length) {
        base.agents = options.checkpoint.agents
      }
      if (options.checkpoint.workflows?.length) {
        base.workflows = options.checkpoint.workflows
      }
    }
    const payload = buildAdoptWritePayload({ base, prefill })
    // Always write baseline adopt.json so job dir has a checkpoint surface
    // (even empty shells/cron) — matches official Jlr write when y||w.
    if (
      prefill ||
      (options?.checkpoint &&
        ((options.checkpoint.shells?.length ?? 0) > 0 ||
          (options.checkpoint.cron?.length ?? 0) > 0 ||
          (options.checkpoint.agents?.length ?? 0) > 0 ||
          (options.checkpoint.workflows?.length ?? 0) > 0))
    ) {
      writtenCheckpoint = await writeAdoptJson(jobDir, payload)
    } else {
      // Nothing to write — still treat as ok so post-adopt cleanup can run
      // when a live CAo was stashed (empty snapshot case).
      writtenCheckpoint = payload
    }
    adoptWriteOk = true
  } catch {
    // Official: Jlr fail → no checkpointAgents/disown (agents stay alive).
    if (options?.checkpoint) {
      writtenCheckpoint = {
        writtenAtMs: Date.now(),
        shells: options.checkpoint.shells ?? [],
        cron: options.checkpoint.cron ?? [],
        agents: options.checkpoint.agents,
        workflows: options.checkpoint.workflows,
      }
    }
    adoptWriteOk = false
  }

  if (adoptWriteOk) {
    // Official aAf after Jlr: await y.checkpointAgents(reg); y.disown(reg).
    // Live handle was stashed by REPL before unmount (abort closures valid).
    try {
      await runLeftArrowPostAdoptCheckpoint()
    } catch {
      /* best-effort */
    }
  } else {
    // Drop stashed CAo without abort — official catch leaves y=null.
    takeLeftArrowCheckpointLive()
  }

  // Official aAf: bridge flush (capped; 5s when replyOnResume) +
  // teardown({skipArchive:true}) before spawn.
  if (bridge) {
    if (bridge.flush) {
      await withTimeout(
        bridge.flush(),
        bridgeFlushCapMs(options?.replyOnResume),
        'bridge flush',
      )
    }
    try {
      await bridge.teardown({ skipArchive: true })
    } catch {
      // ignore
    }
    // densable useReplBridge Rt&&!Be → kEo: left-arrow child has rit env;
    // drop process-local wXr so parent re-init cannot reattach the same Se.
    clearBridgeSessionMeta()
  }

  // densable yNo: await Ca(Gx(), 2000, "flush timeout") UNCONDITIONAL before
  // Fbe spawn (idle-fork and abort-then-fork). Local previously only flushed
  // when abortAfterFlush was set — idle left-arrow missed mid-turn bytes.
  try {
    const { flushSessionStorage } = await import(
      '../../utils/sessionStorage.js'
    )
    await withTimeout(
      flushSessionStorage(),
      SESSION_FLUSH_CAP_MS,
      'flush timeout',
    )
  } catch {
    /* best-effort */
  }

  const abandonOnSpawnFail = (): void => {
    // Official CAo.abandon: kill detached shell pids when fork spawn fails.
    if (writtenCheckpoint) {
      abandonCheckpointShells(writtenCheckpoint)
      return
    }
    if (options?.checkpoint?.shells?.length) {
      abandonCheckpointShells({
        writtenAtMs: Date.now(),
        shells: options.checkpoint.shells,
        cron: options.checkpoint.cron ?? [],
        agents: options.checkpoint.agents,
        workflows: options.checkpoint.workflows,
      })
    }
  }

  // densable yNo: eit(pNo(w)) → store non-resume/session-id flags for Enter retry.
  // Local launch already encodes --resume/--fork; respawnFlags carry extras only.
  const leftArrowRespawnFlags = options?.replyOnResume
    ? ['--reply-on-resume']
    : []

  // Official ky6 fire-and-forget; on failure densable yNo may queue_for_later
  // (copy transcript + failed job) instead of rm when !alive.
  // densable gate: left_arrow && providedSessionId && resume && !x.alive
  // short_alive (alive:true) must NOT queue — session already running.
  // resumeSessionId is required (early return above); always dispatch.
  void (async () => {
    const handleSpawnFail = async (
      errorText: string,
      reason?: string,
      /** densable x.alive — short already running skips queue_for_later */
      alreadyAlive?: boolean,
    ): Promise<void> => {
      // densable M("tengu_background_spawn_failed",{})
      logEvent('tengu_background_spawn_failed', {})
      // densable: !x.alive required for queue; short_alive → spawn_failed only
      let queued = false
      if (!alreadyAlive) {
        queued = await tryQueueLeftArrowSpawnFail({
          short,
          providedSessionId,
          resumeSessionId,
          respawnFlags: leftArrowRespawnFlags,
        })
      }
      if (!queued) {
        abandonOnSpawnFail()
        // densable short_alive keeps job dir (attach target); only rm when
        // queue failed / soft fail without alive worker.
        if (!alreadyAlive) {
          await rm(jobDir, { recursive: true, force: true }).catch(() => {})
        }
      }
      // densable: if(I) We queued_for_later else me spawn_failed
      reportLeftArrowSpawnFailOutcome(queued)
      reportBackgroundSpawnFail(errorText, reason)
    }

    try {
      const { ensureDaemonRunning } = await import(
        '../../daemon/installPrompt.js'
      )
      // quiet: REPL already unmounted with alt-screen frozen (handoffAltScreen).
      // stderr takeover / Starting… would paint over the old footer and flash.
      const daemon = await ensureDaemonRunning({
        forceTransient: true,
        mayPromptInstall: false,
        quiet: true,
      })
      if (!daemon.ok) {
        // densable: no {ok,reason} from yNo here — map soft daemon fail via
        // reason text; non-spawn_failed_* → warn path after promote unknown.
        const text =
          typeof daemon.reason === 'string' && daemon.reason.length > 0
            ? daemon.reason
            : 'daemon not running'
        // Soft probe fails are not Node ERR_* — use unknown so xe/logError fires
        // (matches densable unclassified / spawn_failed_unknown severity).
        // alive undefined → !alive → may queue.
        await handleSpawnFail(text, 'spawn_failed_unknown', false)
        return
      }
      const { submitDispatch } = await import('../../daemon/bgManager.js')
      await submitDispatch({
        intent: seed.intent ?? '',
        name: seed.name,
        cwd,
        source: 'left_arrow',
        resumeSessionId,
        forkSession: true,
        providedSessionId,
        isolation: worktree ? 'worktree' : undefined,
        worktree: worktree ? { path: worktree.path } : undefined,
        reattachEnv,
        // densable yNo: ...c?.replyOnResume?["--reply-on-resume"]:[]
        extraArgs: options?.replyOnResume ? ['--reply-on-resume'] : undefined,
        // Official BF_: CLAUDE_BG_SESSION_PERMISSION_RULES / MEMORY_TOGGLED_OFF
        sessionPermissionRules: options?.sessionPermissionRules,
        memoryToggledOff: options?.memoryToggledOff,
      })
    } catch (err) {
      // densable yNo: x.alive from BF_ short_alive — gate queue on !alive
      const alreadyAlive =
        typeof err === 'object' &&
        err !== null &&
        'alive' in err &&
        (err as { alive?: unknown }).alive === true
      await handleSpawnFail(
        errorMessage(err),
        spawnFailReasonFromError(err),
        alreadyAlive,
      )
    }
  })()

  // densable aAf: after yNo fire-and-forget kickoff —
  //   a?.abortAfterFlush?.abort(J0("background"))
  // J0 caches DOMException AbortError("background") so Yqe m()/RT matches.
  if (options?.abortAfterFlush) {
    const { createAbortErrorReason } = await import(
      '../../utils/abortController.js'
    )
    options.abortAfterFlush.abort(createAbortErrorReason('background'))
  }

  return { ok: true, short, sessionId: providedSessionId }
}
