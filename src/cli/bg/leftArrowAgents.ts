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
import { rm } from 'fs/promises'
import {
  deriveBackgroundSeed,
  seedForLeftArrow,
  type BackgroundSeedMessage,
} from './helpers.js'
import { writeA8qJobState } from '../../daemon/jobState.js'
import {
  getOriginalCwd,
  getSessionId,
  isSessionPersistenceDisabled,
} from '../../bootstrap/state.js'
import { getCurrentSessionTitle } from '../../utils/sessionStorage.js'
import { asSessionId } from '../../types/ids.js'
import { getCurrentWorktreeSession } from '../../utils/worktree.js'
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

const BRIDGE_FLUSH_CAP_MS = 2000
/** Official pqb task-list carry cap (ms). */
const TASK_LIST_CARRY_CAP_MS = 2000

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

  const sessionTitle =
    options?.sessionTitle ??
    (resumeSessionId
      ? getCurrentSessionTitle(asSessionId(resumeSessionId))
      : undefined)

  // Official Sj4: Vy6 non-null + persistence disabled → refuse.
  // Empty conversation (Vy6 null) still opens agents.
  if (
    isSessionPersistenceDisabled() &&
    deriveBackgroundSeed(messages, '', {
      sessionTitle,
      sessionAiTitle: options?.haikuTitle,
      agentColor: options?.agentColor,
    }) !== null
  ) {
    // Still run post-adopt cleanup on stashed CAo so parent aborts don't leak.
    try {
      await runLeftArrowPostAdoptCheckpoint()
    } catch {
      /* best-effort */
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
      sessionPermissionRules: options?.sessionPermissionRules,
      memoryToggledOff: options?.memoryToggledOff,
    }))
  } catch (e) {
    try {
      await runLeftArrowPostAdoptCheckpoint()
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

  // Official aAf: bridge flush (capped) + teardown({skipArchive:true}) before spawn.
  if (bridge) {
    if (bridge.flush) {
      await withTimeout(bridge.flush(), BRIDGE_FLUSH_CAP_MS, 'bridge flush')
    }
    try {
      await bridge.teardown({ skipArchive: true })
    } catch {
      // ignore
    }
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

  // Official ky6 fire-and-forget; on failure abandon shells + rm job dir.
  if (resumeSessionId) {
    void (async () => {
      try {
        const { ensureDaemonRunning } = await import(
          '../../daemon/installPrompt.js'
        )
        const daemon = await ensureDaemonRunning({
          forceTransient: true,
          mayPromptInstall: false,
        })
        if (!daemon.ok) {
          abandonOnSpawnFail()
          await rm(jobDir, { recursive: true, force: true }).catch(() => {})
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
          // Official BF_: CLAUDE_BG_SESSION_PERMISSION_RULES / MEMORY_TOGGLED_OFF
          sessionPermissionRules: options?.sessionPermissionRules,
          memoryToggledOff: options?.memoryToggledOff,
        })
      } catch {
        abandonOnSpawnFail()
        await rm(jobDir, { recursive: true, force: true }).catch(() => {})
      }
    })()
  }

  return { ok: true, short, sessionId: providedSessionId }
}
