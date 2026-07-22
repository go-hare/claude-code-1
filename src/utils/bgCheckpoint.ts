/**
 * Official dOo / Dro / sQt / Nro portable subset — adopt.json checkpoint
 * payload shape + prefill truncation for mid-turn background forks.
 *
 * Full official path also serializes live shells/agents/workflows/cron and
 * checkpointAgents/disown/abandon against the task registry. Portable: pure
 * payload builders + merge helpers so consumers can write adopt.json without
 * the full agent runtime.
 */

import { createHash, randomBytes } from 'crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'

export const ADOPT_JSON_NAME = 'adopt.json'

/** Official partial-text cap before writing prefill (16384). */
export const PREFILL_MAX_CHARS = 16_384

/** Official adopt payload size guard on merge (entries). */
export const ADOPT_MAX_ENTRIES = 256

/** Official read size guard on existing adopt.json (bytes). */
export const ADOPT_JSON_MAX_BYTES = 1_000_000

export type BgPrefill = {
  text: string
  boundaryUuid?: string
}

export type BgCheckpointCron = {
  id: string
  cron: string
  prompt: string
  createdAt?: number
  recurring?: boolean
  agentId?: string
  kind?: string
}

export type BgCheckpointPayload = {
  writtenAtMs: number
  shells: unknown[]
  cron: BgCheckpointCron[]
  agents?: unknown[]
  workflows?: unknown[]
  prefill?: BgPrefill
  /**
   * Official exit-handoff marker. Stale age gate is skipped when origin is
   * `"exit"` (exit handoffs may sit longer before the fork resumes).
   */
  origin?: 'exit' | string
}

/** Official Ylr — non-exit adopt.json max age (ms) before claim rejects stale. */
export const ADOPT_STALE_MS = 120_000

/** Official nKy — retry delay when rename races / ENOENT during waitMs. */
export const ADOPT_CLAIM_RETRY_MS = 250

/** Official J3d — default waitMs when handoff is expected. */
export const ADOPT_CLAIM_WAIT_MS = 4_000

export type AdoptTelemetry = {
  adopted_shells: number
  adopted_agents: number
  adopted_workflows: number
  adopted_cron: number
}

/** Official Nro — telemetry counts from a checkpoint payload (or null). */
export function adoptTelemetry(
  payload: BgCheckpointPayload | null | undefined,
): AdoptTelemetry {
  return {
    adopted_shells: payload?.shells?.length ?? 0,
    adopted_agents: payload?.agents?.length ?? 0,
    adopted_workflows: payload?.workflows?.length ?? 0,
    adopted_cron: payload?.cron?.length ?? 0,
  }
}

/**
 * Official partial-text slice for prefill — trimEnd then keep last N chars.
 */
export function truncatePartialTextForPrefill(
  partialText: string | null | undefined,
  maxChars: number = PREFILL_MAX_CHARS,
): string {
  const trimmed = (partialText ?? '').trimEnd()
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.slice(-maxChars)
}

/**
 * Official prefill gate (abort-then-fork path): non-empty partial, not under
 * bridge (caller passes bridgeActive), and no live agents in the checkpoint.
 */
export function buildMidTurnPrefill(input: {
  via?: string
  partialText?: string | null
  boundaryUuid?: string
  bridgeActive?: boolean
  agentsCount?: number
}): BgPrefill | undefined {
  if (input.via !== 'abort-then-fork') return undefined
  if (input.bridgeActive) return undefined
  if ((input.agentsCount ?? 0) > 0) return undefined
  const text = truncatePartialTextForPrefill(input.partialText)
  if (!text) return undefined
  return {
    text,
    ...(input.boundaryUuid ? { boundaryUuid: input.boundaryUuid } : {}),
  }
}

/** Empty baseline payload (official writtenAtMs + empty arrays). */
export function emptyCheckpointPayload(
  writtenAtMs: number = Date.now(),
): BgCheckpointPayload {
  return {
    writtenAtMs,
    shells: [],
    cron: [],
  }
}

function dedupeByKey<T>(
  left: T[],
  right: T[],
  keyOf: (item: T) => string | number | undefined,
): T[] {
  const out: T[] = []
  const seen = new Set<string | number>()
  for (const item of [...left, ...right]) {
    const k = keyOf(item)
    if (k === undefined) {
      out.push(item)
      continue
    }
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

/**
 * Official FMg merge — prefer newer writtenAtMs; dedupe shells/cron/agents/
 * workflows by stable id; prefer incoming prefill.
 */
export function mergeCheckpointPayloads(
  existing: BgCheckpointPayload,
  incoming: BgCheckpointPayload,
): BgCheckpointPayload {
  const asRec = (x: unknown) =>
    x && typeof x === 'object' ? (x as Record<string, unknown>) : {}
  const shells = dedupeByKey(
    (existing.shells ?? []) as unknown[],
    (incoming.shells ?? []) as unknown[],
    s => {
      const r = asRec(s)
      return (r.pid as number | undefined) ?? (r.taskId as string | undefined)
    },
  )
  const cron = dedupeByKey(existing.cron ?? [], incoming.cron ?? [], c => c.id)
  const agents = dedupeByKey(
    (existing.agents ?? []) as unknown[],
    (incoming.agents ?? []) as unknown[],
    a => asRec(a).agentId as string | undefined,
  )
  const workflows = dedupeByKey(
    (existing.workflows ?? []) as unknown[],
    (incoming.workflows ?? []) as unknown[],
    w => asRec(w).taskId as string | undefined,
  )

  // densable uKy: writtenAtMs from incoming (t), origin t??e, prefill t??e
  return {
    writtenAtMs: incoming.writtenAtMs ?? existing.writtenAtMs ?? 0,
    shells,
    cron,
    ...(agents.length ? { agents } : {}),
    ...(workflows.length ? { workflows } : {}),
    prefill: incoming.prefill ?? existing.prefill,
    // Prefer incoming origin (exit handoff supersedes left-arrow).
    ...(incoming.origin !== undefined || existing.origin !== undefined
      ? { origin: incoming.origin ?? existing.origin }
      : {}),
  }
}

/** Build payload for sQt write: base Dro payload + optional prefill. */
export function buildAdoptWritePayload(input: {
  base?: BgCheckpointPayload | null
  prefill?: BgPrefill
  nowMs?: number
}): BgCheckpointPayload {
  const base = input.base ?? emptyCheckpointPayload(input.nowMs ?? Date.now())
  if (!input.prefill) return base
  return { ...base, prefill: input.prefill }
}

/** Official sQt path: `<jobDir>/adopt.json`. */
export function adoptJsonPath(jobDir: string): string {
  return join(jobDir, ADOPT_JSON_NAME)
}

/**
 * densable Cf portable — write via `${path}.tmp.<hex>` then rename into place
 * so readers never observe a partial adopt.json (Jlr write path).
 *
 * Rename fallback codes match official: EXDEV | EPERM | EEXIST | EBUSY
 * (Windows rename-over commonly returns EPERM/EEXIST). After success, chmod
 * to preserve mode. On partial-target write failure (ENOSPC/EIO/EDQUOT/EFBIG),
 * unlink the corrupt target so readers do not pick up a truncated adopt.json.
 */
export async function atomicWriteFile(
  targetPath: string,
  data: string,
  mode?: number,
): Promise<void> {
  const tmpPath = `${targetPath}.tmp.${randomBytes(4).toString('hex')}`
  const renameFallbackCodes = new Set(['EXDEV', 'EPERM', 'EEXIST', 'EBUSY'])
  const partialTargetUnlinkCodes = new Set(['ENOSPC', 'EIO', 'EDQUOT', 'EFBIG'])
  const errnoCode = (e: unknown): string | undefined =>
    e && typeof e === 'object' && 'code' in e
      ? String((e as { code?: unknown }).code)
      : undefined

  try {
    await writeFile(tmpPath, data, {
      encoding: 'utf8',
      ...(mode !== undefined ? { mode } : {}),
    })
    try {
      await rename(tmpPath, targetPath)
    } catch (e) {
      const code = errnoCode(e)
      if (code && renameFallbackCodes.has(code)) {
        const buf = await readFile(tmpPath)
        try {
          await writeFile(targetPath, buf, {
            ...(mode !== undefined ? { mode } : {}),
          })
        } catch (writeErr) {
          const wcode = errnoCode(writeErr)
          if (wcode && partialTargetUnlinkCodes.has(wcode)) {
            await unlink(targetPath).catch(() => {})
          }
          throw writeErr
        }
        await unlink(tmpPath).catch(() => {})
        if (mode !== undefined) {
          await chmod(targetPath, mode).catch(() => {})
        }
        return
      }
      throw e
    }
    if (mode !== undefined) {
      await chmod(targetPath, mode).catch(() => {})
    }
  } catch (e) {
    await unlink(tmpPath).catch(() => {})
    throw e
  }
}

/**
 * Official Jlr/sQt portable write — merge with existing adopt.json when present,
 * then densable Cf atomic write. Returns the payload written.
 */
export async function writeAdoptJson(
  jobDir: string,
  incoming: BgCheckpointPayload,
): Promise<BgCheckpointPayload> {
  await mkdir(jobDir, { recursive: true, mode: 0o700 })
  const path = adoptJsonPath(jobDir)
  let toWrite = incoming
  try {
    const raw = await readFile(path, 'utf-8')
    if (raw.length <= ADOPT_JSON_MAX_BYTES) {
      const existing = JSON.parse(raw) as BgCheckpointPayload
      const entryCount =
        (existing.shells?.length ?? 0) +
        (existing.cron?.length ?? 0) +
        (existing.agents?.length ?? 0) +
        (existing.workflows?.length ?? 0)
      if (entryCount <= ADOPT_MAX_ENTRIES) {
        toWrite = mergeCheckpointPayloads(existing, incoming)
      }
    }
  } catch {
    /* no existing or corrupt — write incoming */
  }
  await atomicWriteFile(path, JSON.stringify(toWrite), 0o600)
  return toWrite
}

/** Best-effort read of adopt.json prefill for reply-on-resume consumers. */
export async function readAdoptPrefill(
  jobDir: string,
): Promise<BgPrefill | null> {
  try {
    const raw = await readFile(adoptJsonPath(jobDir), 'utf-8')
    if (raw.length > ADOPT_JSON_MAX_BYTES) return null
    const data = JSON.parse(raw) as BgCheckpointPayload
    if (data.prefill?.text) return data.prefill
    return null
  } catch {
    return null
  }
}

export type ClaimAdoptResult =
  | { ok: true; payload: BgCheckpointPayload; claimPath: string }
  | {
      ok: false
      reason:
        | 'no_job_dir'
        | 'enoent'
        | 'rename_failed'
        | 'schema_rejected'
        | 'stale'
        | 'parse_failed'
      error?: string
    }

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms)
    t.unref?.()
  })
}

/**
 * Official e4d — claim adopt.json via rename to `adopt.json.<pid>`, parse,
 * stale-gate (Ylr=120s unless origin==="exit"), then unlink claim file.
 *
 * Returns the parsed payload (caller rehydrates shells/agents/cron/workflows).
 * Concurrent claimants: only one rename wins; losers get enoent / rename_failed.
 */
export async function claimAdoptJson(
  jobDir: string | null | undefined,
  opts?: {
    waitMs?: number
    /** Override now for tests. */
    nowMs?: number
    /** Override stale threshold (default ADOPT_STALE_MS). */
    staleMs?: number
    /** Override retry delay (default ADOPT_CLAIM_RETRY_MS). */
    retryMs?: number
    /** Keep claim file for caller cleanup (default false — unlink in finally). */
    keepClaimFile?: boolean
  },
): Promise<ClaimAdoptResult> {
  if (!jobDir) {
    return { ok: false, reason: 'no_job_dir' }
  }
  const src = adoptJsonPath(jobDir)
  const claimPath = `${src}.${process.pid}`
  const deadline = (opts?.nowMs ?? Date.now()) + (opts?.waitMs ?? 0)
  const retryMs = opts?.retryMs ?? ADOPT_CLAIM_RETRY_MS
  let sawBusy = false

  // Official: loop rename until success or waitMs elapses on ENOENT.
  for (;;) {
    try {
      await rename(src, claimPath)
      break
    } catch (e) {
      const code =
        e && typeof e === 'object' && 'code' in e
          ? String((e as { code?: unknown }).code)
          : undefined
      if (code === 'ENOENT') {
        if (Date.now() < deadline) {
          await sleepMs(retryMs)
          continue
        }
        return { ok: false, reason: 'enoent' }
      }
      // EBUSY/EPERM/EACCES etc — give up (official Fci set → ebusy_gave_up)
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        sawBusy = true
      }
      return {
        ok: false,
        reason: 'rename_failed',
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }
  void sawBusy

  try {
    const raw = await readFile(claimPath, 'utf-8')
    if (raw.length > ADOPT_JSON_MAX_BYTES) {
      return { ok: false, reason: 'schema_rejected', error: 'too large' }
    }
    let data: BgCheckpointPayload
    try {
      data = JSON.parse(raw) as BgCheckpointPayload
    } catch (e) {
      return {
        ok: false,
        reason: 'parse_failed',
        error: e instanceof Error ? e.message : String(e),
      }
    }
    if (
      typeof data?.writtenAtMs !== 'number' ||
      !Array.isArray(data.shells) ||
      !Array.isArray(data.cron)
    ) {
      return {
        ok: false,
        reason: 'schema_rejected',
        error: 'missing writtenAtMs/shells/cron',
      }
    }
    const entryCount =
      (data.shells?.length ?? 0) +
      (data.cron?.length ?? 0) +
      (data.agents?.length ?? 0) +
      (data.workflows?.length ?? 0)
    if (entryCount > ADOPT_MAX_ENTRIES) {
      return {
        ok: false,
        reason: 'schema_rejected',
        error: `entries ${entryCount} > ${ADOPT_MAX_ENTRIES}`,
      }
    }
    const now = opts?.nowMs ?? Date.now()
    const age = now - data.writtenAtMs
    const staleMs = opts?.staleMs ?? ADOPT_STALE_MS
    // Official: skip stale when origin === "exit"
    if (data.origin !== 'exit' && age > staleMs) {
      return {
        ok: false,
        reason: 'stale',
        error: `age ${age}ms > ${staleMs}ms`,
      }
    }
    return { ok: true, payload: data, claimPath }
  } catch (e) {
    return {
      ok: false,
      reason: 'parse_failed',
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    if (!opts?.keepClaimFile) {
      await unlink(claimPath).catch(() => {})
    }
  }
}

/**
 * Portable bg-session mount helper — claim CLAUDE_JOB_DIR/adopt.json once.
 * Returns payload or null; never throws.
 */
export async function claimAdoptFromJobEnv(opts?: {
  waitMs?: number
  jobDir?: string | null
}): Promise<BgCheckpointPayload | null> {
  const jobDir = opts?.jobDir ?? process.env.CLAUDE_JOB_DIR
  if (!jobDir) return null
  try {
    const result = await claimAdoptJson(jobDir, {
      waitMs: opts?.waitMs ?? 0,
    })
    return result.ok ? result.payload : null
  } catch {
    return null
  }
}

// ── Official MVr / Fco / LVr (left-arrow mid-turn boundary + partial text) ──

/** Minimal message shape for fork-boundary / in-flight partial helpers. */
export type ForkBoundaryMessage = {
  type: string
  uuid?: string
  message?: {
    stop_reason?: string | null
    content?: unknown
  }
}

function isToolResultUserMessage(msg: ForkBoundaryMessage): boolean {
  if (msg.type !== 'user') return false
  const content = msg.message?.content
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every(
      (b: unknown) =>
        !!b &&
        typeof b === 'object' &&
        (b as { type?: string }).type === 'tool_result',
    )
  )
}

function isInFlightAssistantOrSystem(msg: ForkBoundaryMessage): boolean {
  if (msg.type === 'system') return true
  if (msg.type === 'assistant') {
    const stop = msg.message?.stop_reason
    return stop === null || stop === 'tool_use'
  }
  if (msg.type === 'user') return isToolResultUserMessage(msg)
  return false
}

/**
 * Official LVr portable — drop trailing in-flight assistant/tool-result
 * messages so the fork boundary sits on the last settled user/assistant turn.
 */
export function stripInFlightTail(
  messages: readonly ForkBoundaryMessage[],
): ForkBoundaryMessage[] {
  let t = messages.length
  while (t > 0) {
    const o = messages[t - 1]!
    if (o.type === 'user') {
      if (isToolResultUserMessage(o)) {
        t--
        continue
      }
      break
    }
    if (o.type === 'assistant') {
      if (!isInFlightAssistantOrSystem(o)) break
      t--
      continue
    }
    if (o.type === 'system') {
      t--
      continue
    }
    break
  }
  if (t === messages.length) return [...messages]
  return messages.slice(0, t)
}

/**
 * Official MVr — uuid of the last settled user/assistant (after LVr strip).
 * Used as adopt prefill `boundaryUuid`.
 */
export function findForkBoundaryUuid(
  messages: readonly ForkBoundaryMessage[],
): string | undefined {
  const t = stripInFlightTail(messages)
  for (let r = t.length - 1; r >= 0; r--) {
    const n = t[r]!.type
    if (n === 'user' || n === 'assistant') {
      const uuid = t[r]!.uuid
      return typeof uuid === 'string' && uuid.length > 0 ? uuid : undefined
    }
  }
  return undefined
}

/**
 * Official Fco — concatenate text from the trailing in-flight assistant
 * messages (stop_reason null / open tool_use window) plus live stream text.
 */
export function buildInFlightPartialText(
  messages: readonly ForkBoundaryMessage[],
  livePartial?: string | null,
): string {
  let r = messages.length
  for (let o = messages.length - 1; o >= 0; o--) {
    const i = messages[o]!
    if (i.type === 'assistant') {
      // Official Fco: only keep assistants with stop_reason === null (in-flight).
      if (i.message?.stop_reason !== null) break
      r = o
    } else if (i.type === 'user') {
      break
    }
  }
  let n = ''
  for (let o = r; o < messages.length; o++) {
    const i = messages[o]!
    if (i.type !== 'assistant') continue
    const content = i.message?.content
    if (!Array.isArray(content)) continue
    for (const s of content) {
      if (
        s &&
        typeof s === 'object' &&
        (s as { type?: string }).type === 'text' &&
        typeof (s as { text?: unknown }).text === 'string'
      ) {
        n += (s as { text: string }).text
      }
    }
  }
  return n + (livePartial ?? '')
}

/** Portable shell/agent snapshot fields for adopt.json (+ optional detach). */
export type PortableTaskLike = {
  id: string
  type: string
  status: string
  description?: string
  command?: string
  agentId?: string
  agentType?: string
  toolUseId?: string
  startTime?: number
  isBackgrounded?: boolean
  kind?: string
  lastReportedTotalLines?: number
  shellCommand?: {
    status?: string
    getPid?: () => number | undefined
    /**
     * Official fDs: shellCommand?.detach?.() unrefs child + returns pid.
     * When present, collectPortableCheckpoint prefers detach over getPid.
     */
    detach?: () => number | undefined
    kill?: () => void
    /** Official Hen non-handoff shell cleanup after kill. */
    cleanup?: () => void
    taskOutput?: { path?: string }
  } | null
  workflowRunId?: string
  scriptPath?: string
  /** Workflow script body for official hDs scriptSha256. */
  script?: string
  /** Workflow args object for official hDs argsJson. */
  args?: unknown
  /** Official mDs transcriptPath override (else resolved from agentId). */
  transcriptPath?: string
  /** Official hDs transcriptDir override. */
  transcriptDir?: string
  parentAgentId?: string
  spawnDepth?: number
  abortController?: { abort?: (reason?: unknown) => void } | null
}

export type PortableCronLike = {
  id: string
  cron: string
  prompt: string
  createdAt?: number
  recurring?: boolean
  agentId?: string
  kind?: string
}

/**
 * Official CAo portable result — payload for adopt.json plus serializable
 * disown/abandon helpers. Full taskRegistry callbacks can't cross REPL unmount;
 * consumers remove by id lists and kill detached pids on spawn fail.
 */
export type PortableCheckpointResult = {
  payload: BgCheckpointPayload
  /** Shell task ids snapshot (for AppState.tasks remove). */
  shellTaskIds: string[]
  /** Agent ids (agentId) for remove. */
  agentIds: string[]
  /** Workflow task ids. */
  workflowTaskIds: string[]
  /** Cron ids. */
  cronIds: string[]
  /** Detached child pids for abandon kill-by-pid. */
  detachedPids: number[]
  /**
   * Official Hen handoff set — task `id`s of shells/agents/workflows included
   * in the portable checkpoint (NOT agentId). Used to spare handoff work when
   * reaping residual running tasks after exit handoff.
   */
  handoffTaskIds: string[]
  /**
   * Official disown(u) portable: remove checkpointed shell/agent/workflow/cron
   * ids via the provided removers. Safe to call after snapshot.
   */
  disown: (removers: {
    removeTaskIds?: (ids: readonly string[]) => void
    removeAgentIds?: (ids: readonly string[]) => void
    removeCronIds?: (ids: readonly string[]) => void
  }) => void
  /**
   * Official CAo.checkpointAgents portable — after adopt.json write, abort
   * handoff workflows/agents (`"background"`), drop agent-owned shell task
   * ids from the registry, and optionally flush agent transcripts.
   * No-op when no agents were checkpointed (official early return after
   * workflow abort+zit).
   */
  checkpointAgents: (opts?: {
    removeTaskIds?: (ids: readonly string[]) => void
    /** Override abort reason (default official "background"). */
    reason?: string
    /**
     * Official zit(workflowId, reg) — mark workflow paused after abort.
     * Prefer `pauseWorkflowTask(id, setAppState)` (status `"paused"`).
     */
    markWorkflowPaused?: (workflowTaskId: string) => void
    /**
     * Official Gx() agent transcript flush after setImmediate.
     * Residual: callers may pass a real flush; default is no-op.
     */
    flushAgentTranscripts?: () => Promise<void> | void
  }) => Promise<{ abortedWorkflowIds: string[]; abortedAgentIds: string[] }>
  /**
   * Official abandon() portable: kill detached shell pids once (spawn fail)
   * and SAo-notify agents/workflows that were not resumed.
   */
  abandon: (killPid?: (pid: number) => void) => void
}

/**
 * densable vAo — adopt/handoff enabled unless CLAUDE_DISABLE_ADOPT is truthy.
 */
export function isAdoptEnabled(): boolean {
  const v = process.env.CLAUDE_DISABLE_ADOPT
  if (v === undefined || v === '') return true
  const lower = v.toLowerCase()
  return !(
    lower === '1' ||
    lower === 'true' ||
    lower === 'yes' ||
    lower === 'on'
  )
}

/**
 * densable H_e — per-task-id handoff eligibility map.
 *
 * A root (parent-less agent / unowned shell / workflow) is eligible only if the
 * entire descendant subtree is individually handoff-ready. Map entries are
 * `true` only for tasks in such a fully-eligible tree.
 *
 * When adopt is disabled (vAo false), returns empty map → CAo collects nothing.
 */
export function buildHandoffEligibilityMap(
  tasks: Record<string, PortableTaskLike> | null | undefined,
): Map<string, boolean> {
  const out = new Map<string, boolean>()
  if (!isAdoptEnabled()) return out
  const all = Object.values(tasks ?? {})

  const ownerOf = (t: PortableTaskLike): string | undefined => {
    if (t.type === 'local_agent') return t.parentAgentId
    // shells / workflows: agentId is the owning agent when nested
    if ('agentId' in t && t.agentId !== undefined) return t.agentId
    return undefined
  }

  const childrenByOwner = new Map<string, PortableTaskLike[]>()
  for (const t of all) {
    if (t.status !== 'running' && t.status !== 'pending') continue
    const owner = ownerOf(t)
    if (owner === undefined) continue
    const list = childrenByOwner.get(owner) ?? []
    list.push(t)
    childrenByOwner.set(owner, list)
  }

  const leafReady = (t: PortableTaskLike): boolean => {
    if (t.type === 'local_agent') {
      return (
        t.agentType !== 'main-session' &&
        t.status === 'running' &&
        t.isBackgrounded === true &&
        t.abortController !== undefined &&
        t.abortController !== null
      )
    }
    if (t.type === 'local_bash') {
      return (
        t.kind !== 'monitor' &&
        t.status === 'running' &&
        t.isBackgrounded === true &&
        t.shellCommand != null &&
        typeof t.shellCommand.detach === 'function'
      )
    }
    if (t.type === 'local_workflow') {
      return (
        t.status === 'running' &&
        t.scriptPath !== undefined &&
        t.workflowRunId !== undefined &&
        t.abortController !== undefined &&
        t.abortController !== null
      )
    }
    return false
  }

  const walk = (t: PortableTaskLike, acc: string[]): boolean => {
    acc.push(t.id)
    let ok = leafReady(t)
    for (const child of childrenByOwner.get(t.id) ?? []) {
      ok = walk(child, acc) && ok
    }
    return ok
  }

  const isRoot = (t: PortableTaskLike): boolean => {
    if (t.type === 'local_agent') return t.parentAgentId === undefined
    if (t.type === 'local_bash') return t.agentId === undefined
    if (t.type === 'local_workflow') return true
    return false
  }

  for (const t of all) {
    if (t.status !== 'running' && t.status !== 'pending') continue
    if (!isRoot(t)) continue
    const ids: string[] = []
    const eligible = walk(t, ids)
    for (const id of ids) out.set(id, eligible)
  }
  return out
}

/** densable fct — task id is in a fully-eligible handoff tree. */
export function isHandoffEligible(
  taskId: string,
  eligibility: Map<string, boolean>,
): boolean {
  return eligibility.get(taskId) ?? false
}

/**
 * densable lWe — cron is handoffable when adopt enabled and either unowned
 * or its agentId is in a fully-eligible tree.
 */
export function isCronHandoffEligible(
  cron: PortableCronLike,
  eligibility: Map<string, boolean>,
): boolean {
  if (!isAdoptEnabled()) return false
  if (cron.agentId === undefined) return true
  return eligibility.get(cron.agentId) ?? false
}

/**
 * Official CAo / fDs portable — snapshot live shells/agents/workflows/cron.
 * Shells: prefer shellCommand.detach() (unref + pid) then getPid.
 * Filtered by densable H_e subtree eligibility (CAo(yDs/_Ds/bDs/lWe)).
 */
export function collectPortableCheckpoint(input: {
  tasks?: Record<string, PortableTaskLike> | null
  cron?: readonly PortableCronLike[] | null
  nowMs?: number
  /**
   * When true (default), call detach() on shells so the parent can exit
   * without waiting. Official fDs always detaches.
   */
  detachShells?: boolean
  /**
   * Override H_e map (tests). Default: buildHandoffEligibilityMap(tasks).
   * Pass empty Map to force include-all legacy path is NOT supported —
   * densable always filters via H_e; empty map → no handoff.
   */
  handoffEligibility?: Map<string, boolean>
}): PortableCheckpointResult | null {
  const taskMap = input.tasks ?? {}
  const tasks = Object.values(taskMap)
  const eligibility =
    input.handoffEligibility ?? buildHandoffEligibilityMap(taskMap)
  const shells: unknown[] = []
  const agents: unknown[] = []
  const workflows: unknown[] = []
  const shellTaskIds: string[] = []
  const agentIds: string[] = []
  const workflowTaskIds: string[] = []
  const handoffTaskIds: string[] = []
  const detachedPids: number[] = []
  // Live abort handles for official checkpointAgents (workflows then agents).
  const liveWorkflowAborts: Array<{
    id: string
    abort?: (reason?: unknown) => void
  }> = []
  const liveAgentAborts: Array<{
    id: string
    abort?: (reason?: unknown) => void
  }> = []
  // Agent-owned shell taskIds — official removes these when agents checkpointed.
  const agentOwnedShellTaskIds: string[] = []
  const doDetach = input.detachShells !== false

  for (const t of tasks) {
    if (t.status !== 'running' && t.status !== 'pending') continue
    // densable CAo: only yDs/_Ds/bDs-eligible ids enter the payload.
    if (!isHandoffEligible(t.id, eligibility)) continue
    if (t.type === 'local_bash') {
      // Prefer backgrounded shells; still include running with shellCommand.
      // densable Jk leaf already requires isBackgrounded+detach; keep soft
      // guard for partial fixtures that force eligibility via override map.
      if (
        t.isBackgrounded === false &&
        t.shellCommand?.status !== 'backgrounded'
      ) {
        continue
      }
      // Official fDs: const t = e.shellCommand?.detach?.()
      let pid: number | undefined
      if (doDetach && typeof t.shellCommand?.detach === 'function') {
        pid = t.shellCommand.detach()
      } else {
        pid = t.shellCommand?.getPid?.()
      }
      // Official: if detach returns undefined, skip shell entry.
      if (
        doDetach &&
        typeof t.shellCommand?.detach === 'function' &&
        pid === undefined
      ) {
        continue
      }
      if (typeof pid === 'number' && pid > 0) {
        detachedPids.push(pid)
      }
      // Official fDs also awaits Ex(pid) for procStart — see
      // enrichShellsWithProcStart (async) used by exit/left-arrow writers.
      shells.push({
        taskId: t.id,
        ...(pid !== undefined ? { pid } : {}),
        command: t.command,
        description: t.description,
        outputPath: t.shellCommand?.taskOutput?.path,
        lastReportedTotalLines: t.lastReportedTotalLines,
        toolUseId: t.toolUseId,
        kind: t.kind,
        agentId: t.agentId,
      })
      shellTaskIds.push(t.id)
      // Official c4d/Hen handoff shells: yDs && agentId === undefined.
      // Agent-owned shells stay out of the handoff set so Hen reaps them.
      if (t.agentId === undefined) {
        handoffTaskIds.push(t.id)
      } else {
        agentOwnedShellTaskIds.push(t.id)
      }
      continue
    }
    if (t.type === 'local_agent') {
      if (t.agentType === 'main-session') continue
      if (t.isBackgrounded === false) continue
      const agentId = t.agentId ?? t.id
      // Official mDs: transcriptPath via realpath of agent transcript.
      let transcriptPath: string | undefined = t.transcriptPath
      if (!transcriptPath && agentId) {
        try {
          // Lazy require keeps bgCheckpoint free of session bootstrap cycles.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getAgentTranscriptPath } =
            require('./sessionStorage.js') as typeof import('./sessionStorage.js')
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { asAgentId } =
            require('../types/ids.js') as typeof import('../types/ids.js')
          transcriptPath = getAgentTranscriptPath(asAgentId(agentId))
        } catch {
          transcriptPath = undefined
        }
      }
      agents.push({
        agentId,
        agentType: t.agentType,
        description: t.description,
        toolUseId: t.toolUseId,
        spawnDepth: t.spawnDepth,
        startTime: t.startTime,
        parentAgentId: t.parentAgentId,
        ...(transcriptPath ? { transcriptPath } : {}),
      })
      agentIds.push(agentId)
      handoffTaskIds.push(t.id)
      if (t.abortController?.abort) {
        liveAgentAborts.push({
          id: agentId,
          abort: t.abortController.abort.bind(t.abortController),
        })
      }
      continue
    }
    if (t.type === 'local_workflow') {
      // Official hDs: scriptSha256 + argsJson + transcriptDir.
      let scriptSha256: string | undefined
      if (typeof t.script === 'string' && t.script.length > 0) {
        scriptSha256 = createHash('sha256').update(t.script).digest('hex')
      }
      let argsJson: string | undefined
      if (t.args !== undefined) {
        try {
          argsJson = JSON.stringify(t.args)
        } catch {
          argsJson = undefined
        }
      }
      // Official hDs: derivedTranscriptDir ?? YJ(workflowRunId), then realpath.
      let transcriptDir: string | undefined = t.transcriptDir
      if (!transcriptDir && t.workflowRunId) {
        transcriptDir =
          getCanonicalWorkflowTranscriptDir(String(t.workflowRunId)) ??
          undefined
      }
      if (transcriptDir) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { realpathSync } = require('fs') as typeof import('fs')
          const native = (
            realpathSync as typeof realpathSync & {
              native?: (p: string) => string
            }
          ).native
          transcriptDir = native
            ? native(transcriptDir)
            : realpathSync(transcriptDir)
        } catch {
          // keep unresolved path (official: realpath.catch(()=>r))
        }
      }
      workflows.push({
        taskId: t.id,
        workflowRunId: t.workflowRunId,
        scriptPath: t.scriptPath,
        ...(scriptSha256 ? { scriptSha256 } : {}),
        ...(argsJson ? { argsJson } : {}),
        description: t.description,
        startTime: t.startTime,
        ...(transcriptDir ? { transcriptDir } : {}),
      })
      workflowTaskIds.push(t.id)
      handoffTaskIds.push(t.id)
      if (t.abortController?.abort) {
        liveWorkflowAborts.push({
          id: t.id,
          abort: t.abortController.abort.bind(t.abortController),
        })
      }
    }
  }

  // densable CAo: zI().filter(lWe) — only unowned or eligible-owner crons.
  const cron = (input.cron ?? [])
    .filter(u => isCronHandoffEligible(u, eligibility))
    .map(u => ({
      id: u.id,
      cron: u.cron,
      prompt: u.prompt,
      createdAt: u.createdAt,
      recurring: u.recurring,
      agentId: u.agentId,
      kind: u.kind,
    }))
  const cronIds = cron.map(c => c.id)

  if (
    shells.length === 0 &&
    agents.length === 0 &&
    workflows.length === 0 &&
    cron.length === 0
  ) {
    return null
  }

  const payload: BgCheckpointPayload = {
    writtenAtMs: input.nowMs ?? Date.now(),
    shells,
    cron,
    ...(agents.length ? { agents } : {}),
    ...(workflows.length ? { workflows } : {}),
  }

  let abandoned = false
  return {
    payload,
    shellTaskIds,
    agentIds,
    workflowTaskIds,
    cronIds,
    detachedPids,
    handoffTaskIds,
    disown(removers) {
      const taskIds = [...shellTaskIds, ...workflowTaskIds]
      if (taskIds.length) removers.removeTaskIds?.(taskIds)
      if (agentIds.length) removers.removeAgentIds?.(agentIds)
      if (cronIds.length) removers.removeCronIds?.(cronIds)
    },
    async checkpointAgents(opts) {
      // densable J0("background") — DOMException AbortError for Yqe m()/RT
      const { createAbortErrorReason } = await import('./abortController.js')
      const reason =
        opts?.reason != null
          ? opts.reason
          : createAbortErrorReason('background')
      const abortedWorkflowIds: string[] = []
      const abortedAgentIds: string[] = []
      // Official: workflows first — abort(J0("background")) then zit(id, reg).
      for (const w of liveWorkflowAborts) {
        try {
          w.abort?.(reason)
          abortedWorkflowIds.push(w.id)
        } catch {
          /* ignore */
        }
        try {
          opts?.markWorkflowPaused?.(w.id)
        } catch {
          /* ignore */
        }
      }
      // Official: if no agents, return after workflow abort+zit only.
      if (agentIds.length === 0) {
        return { abortedWorkflowIds, abortedAgentIds }
      }
      // Official: remove agent-owned shells from registry before agent abort.
      if (agentOwnedShellTaskIds.length > 0) {
        try {
          opts?.removeTaskIds?.(agentOwnedShellTaskIds)
        } catch {
          /* ignore */
        }
      }
      for (const a of liveAgentAborts) {
        try {
          a.abort?.(reason)
          abortedAgentIds.push(a.id)
        } catch {
          /* ignore */
        }
      }
      // Official: await setImmediate then Gx() agent transcript flush.
      try {
        await new Promise<void>(resolve => {
          setImmediate(resolve)
        })
      } catch {
        /* ignore */
      }
      if (opts?.flushAgentTranscripts) {
        try {
          await opts.flushAgentTranscripts()
        } catch {
          /* official: catch + warn residual */
        }
      }
      return { abortedWorkflowIds, abortedAgentIds }
    },
    abandon(killPid) {
      if (abandoned) return
      abandoned = true
      const kill =
        killPid ??
        ((pid: number) => {
          try {
            process.kill(pid, 'SIGTERM')
          } catch {
            /* already gone */
          }
        })
      for (const pid of detachedPids) {
        try {
          kill(pid)
        } catch {
          /* ignore */
        }
      }
      // Official: SAo agents/workflows when fork spawn fails (no resume).
      notifyAbandonSpawnFailed(agents, workflows)
    },
  }
}

/**
 * Official Hen residual (non-handoff reap) portable.
 *
 * After exit handoff c4d/u4d selects handoff shells/agents/workflows, every
 * other still-running task is killed/aborted, SDK-stopped (unless monitor),
 * and removed from the task map. Handoff ids are the task `id`s collected by
 * collectPortableCheckpoint (shells/agents/workflows), matching official
 * `new Set([...shells,...workflows,...agents].map(o=>o.id))`.
 *
 * Returns the reaped task ids (in encounter order).
 */
export function reapNonHandoffTasks(input: {
  tasks?: Record<string, PortableTaskLike> | null
  /** Task ids that were handed off — not reaped. */
  handoffTaskIds?: Iterable<string> | null
  /** Optional registry remover (parent process may no-op on exit). */
  removeTaskIds?: (ids: readonly string[]) => void
  /** Test override for stopped emit. */
  emitStopped?: (
    taskId: string,
    opts: { toolUseId?: string; summary?: string },
  ) => void
}): { reapedIds: string[] } {
  const handoff = new Set(input.handoffTaskIds ?? [])
  const reapedIds: string[] = []
  const emitStopped =
    input.emitStopped ??
    ((taskId, opts) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { emitTaskTerminatedSdk } =
          require('./sdkEventQueue.js') as typeof import('./sdkEventQueue.js')
        emitTaskTerminatedSdk(taskId, 'stopped', {
          toolUseId: opts.toolUseId,
          summary: opts.summary,
        })
      } catch {
        /* best-effort */
      }
    })

  for (const t of Object.values(input.tasks ?? {})) {
    // Official: only status==="running" (pending not reaped here).
    if (t.status !== 'running') continue
    if (handoff.has(t.id)) continue
    try {
      // Official: Jk shell → kill+cleanup; else abortController abort.
      if (t.type === 'local_bash' || t.shellCommand) {
        try {
          t.shellCommand?.kill?.()
        } catch {
          /* ignore */
        }
        try {
          t.shellCommand?.cleanup?.()
        } catch {
          /* ignore */
        }
      } else if (t.abortController) {
        try {
          t.abortController.abort?.()
        } catch {
          /* ignore */
        }
      }
      // Official: if (!OH(o)) lf(...,"stopped",...) — skip monitor-kind.
      if (t.kind !== 'monitor') {
        emitStopped(t.id, {
          toolUseId: t.toolUseId,
          summary: t.description,
        })
      }
      reapedIds.push(t.id)
    } catch {
      /* ignore per-task */
    }
  }

  if (reapedIds.length > 0) {
    try {
      input.removeTaskIds?.(reapedIds)
    } catch {
      /* ignore */
    }
  }
  return { reapedIds }
}

/**
 * Official CAo.abandon SAo messaging — agents/workflows not resumed after
 * fork spawn failure. Shells are killed separately via killPid.
 */
export function notifyAbandonSpawnFailed(
  agents: unknown[] | null | undefined,
  workflows: unknown[] | null | undefined,
): { agentsNotified: number; workflowsNotified: number } {
  let agentsNotified = 0
  let workflowsNotified = 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { notifyAdoptTaskFailed } =
      require('./adoptFailNotify.js') as typeof import('./adoptFailNotify.js')

    for (const raw of agents ?? []) {
      if (!raw || typeof raw !== 'object') continue
      const a = raw as {
        agentId?: unknown
        description?: unknown
      }
      if (typeof a.agentId !== 'string' || !a.agentId) continue
      const desc =
        typeof a.description === 'string' && a.description
          ? a.description
          : a.agentId
      notifyAdoptTaskFailed(
        a.agentId,
        `Background agent "${desc}" was checkpointed for the background fork but the fork failed to spawn; the agent was not resumed.`,
      )
      agentsNotified++
    }

    for (const raw of workflows ?? []) {
      if (!raw || typeof raw !== 'object') continue
      const w = raw as {
        taskId?: unknown
        description?: unknown
        scriptPath?: unknown
        workflowRunId?: unknown
      }
      if (typeof w.taskId !== 'string' || !w.taskId) continue
      const desc =
        typeof w.description === 'string' && w.description
          ? w.description
          : w.taskId
      // Official Ul single-quote body; portable: strip ' that would break hint.
      // Official abandon always interpolates Workflow hint with ??"" (even empty).
      const sp =
        typeof w.scriptPath === 'string' ? w.scriptPath.replace(/'/g, '') : ''
      const rid =
        typeof w.workflowRunId === 'string'
          ? w.workflowRunId.replace(/'/g, '')
          : ''
      const hint = ` To resume manually: Workflow({scriptPath: '${sp}', resumeFromRunId: '${rid}'}).`
      notifyAdoptTaskFailed(
        w.taskId,
        `Background workflow "${desc}" was checkpointed for the background fork but the fork failed to spawn; it was not resumed.${hint}`,
      )
      workflowsNotified++
    }
  } catch {
    /* best-effort */
  }
  return { agentsNotified, workflowsNotified }
}

/**
 * Kill detached shell pids from an adopt checkpoint payload (spawn-fail path
 * when only the serializable payload is available — no live disown handle).
 * Also SAo-notifies agents/workflows (official CAo.abandon).
 */
export function abandonCheckpointShells(
  checkpoint: BgCheckpointPayload | PortableCheckpointResult | null | undefined,
  killPid?: (pid: number) => void,
): number {
  if (!checkpoint) return 0
  const payload = 'payload' in checkpoint ? checkpoint.payload : checkpoint
  const shells = payload.shells
  if ('abandon' in checkpoint && typeof checkpoint.abandon === 'function') {
    checkpoint.abandon(killPid)
    return checkpoint.detachedPids.length
  }
  let n = 0
  const kill =
    killPid ??
    ((pid: number) => {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* ignore */
      }
    })
  for (const s of shells ?? []) {
    if (!s || typeof s !== 'object') continue
    const pid = (s as { pid?: unknown }).pid
    if (typeof pid === 'number' && pid > 0) {
      try {
        kill(pid)
        n++
      } catch {
        /* ignore */
      }
    }
  }
  notifyAbandonSpawnFailed(payload.agents, payload.workflows)
  return n
}

/** Count agents that block mid-turn prefill (official y?.payload?.agents). */
export function countCheckpointAgents(
  checkpoint: BgCheckpointPayload | PortableCheckpointResult | null | undefined,
): number {
  if (!checkpoint) return 0
  if ('payload' in checkpoint) return checkpoint.payload.agents?.length ?? 0
  return checkpoint.agents?.length ?? 0
}

// ── Official Lvu / k$a rehydrate + u4d exit handoff ─────────────────────────

/** Serializable shell entry from adopt.json (official fDs). */
export type AdoptedShellEntry = {
  taskId: string
  pid?: number
  command?: string
  description?: string
  outputPath?: string
  lastReportedTotalLines?: number
  toolUseId?: string
  kind?: string
  agentId?: string
  procStart?: string
  startTimeTicks?: number
}

export type RehydrateShellsResult = {
  adopted: number
  skipped: number
}

function asAdoptedShellEntry(raw: unknown): AdoptedShellEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.taskId !== 'string' || !r.taskId) return null
  return {
    taskId: r.taskId,
    ...(typeof r.pid === 'number' ? { pid: r.pid } : {}),
    ...(typeof r.command === 'string' ? { command: r.command } : {}),
    ...(typeof r.description === 'string'
      ? { description: r.description }
      : {}),
    ...(typeof r.outputPath === 'string' ? { outputPath: r.outputPath } : {}),
    ...(typeof r.lastReportedTotalLines === 'number'
      ? { lastReportedTotalLines: r.lastReportedTotalLines }
      : {}),
    ...(typeof r.toolUseId === 'string' ? { toolUseId: r.toolUseId } : {}),
    ...(typeof r.kind === 'string' ? { kind: r.kind } : {}),
    ...(typeof r.agentId === 'string' ? { agentId: r.agentId } : {}),
    ...(typeof r.procStart === 'string' ? { procStart: r.procStart } : {}),
    ...(typeof r.startTimeTicks === 'number'
      ? { startTimeTicks: r.startTimeTicks }
      : {}),
  }
}

/**
 * Official HPe portable — link previous session output into current session
 * task path when source differs. Best-effort symlink (falls back to no-op).
 */
export async function linkAdoptedShellOutput(
  taskId: string,
  outputPath: string | undefined,
): Promise<'linked' | 'same' | 'skipped' | 'failed'> {
  if (!outputPath) return 'skipped'
  try {
    // Lazy require to keep bgCheckpoint free of diskOutput cycles in tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTaskOutputPath, initTaskOutputAsSymlink } =
      require('./task/diskOutput.js') as typeof import('./task/diskOutput.js')
    const dest = getTaskOutputPath(taskId)
    if (dest === outputPath) return 'same'
    await initTaskOutputAsSymlink(taskId, outputPath)
    return 'linked'
  } catch {
    return 'failed'
  }
}

/**
 * Official fDs identity enrichment — attach `procStart` (ps lstart string) to
 * each shell entry that has a live pid. Best-effort; leaves entry unchanged on fail.
 */
export async function enrichShellsWithProcStart(
  shells: unknown[] | null | undefined,
): Promise<unknown[]> {
  if (!shells?.length) return shells ?? []
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getProcessLstartString } =
    require('./genericProcessUtils.js') as typeof import('./genericProcessUtils.js')
  return Promise.all(
    shells.map(async raw => {
      const es = asAdoptedShellEntry(raw)
      if (!es || typeof es.pid !== 'number' || es.pid <= 0) return raw
      if (es.procStart) return raw
      try {
        const procStart = await getProcessLstartString(es.pid)
        if (!procStart) return raw
        return { ...(raw as object), procStart }
      } catch {
        return raw
      }
    }),
  )
}

/**
 * Official n4d / Klr portable — SIGTERM an adopted shell entry's pid, identity-
 * gated when procStart is present. When `killPid` override is provided (tests),
 * that path is used without identity check.
 */
export function killAdoptedShellEntry(
  entry: AdoptedShellEntry | unknown,
  killPid?: (pid: number) => void,
): boolean {
  const es =
    entry && typeof entry === 'object' && 'taskId' in (entry as object)
      ? (entry as AdoptedShellEntry)
      : asAdoptedShellEntry(entry)
  if (!es || typeof es.pid !== 'number' || es.pid <= 0) return false
  if (killPid) {
    try {
      killPid(es.pid)
      return true
    } catch {
      return false
    }
  }
  // Fire-and-forget: official Klr when identity present; pid-only SIGTERM when
  // adopt entry never got procStart (portable fDs without await Ex).
  void (async () => {
    try {
      if (es.procStart !== undefined || es.startTimeTicks !== undefined) {
        const { killPidIfIdentityMatches } = await import(
          './genericProcessUtils.js'
        )
        await killPidIfIdentityMatches(es.pid!, {
          procStart: es.procStart,
          startTimeTicks: es.startTimeTicks,
        })
        return
      }
      process.kill(es.pid!, 'SIGTERM')
    } catch {
      try {
        process.kill(es.pid!, 'SIGTERM')
      } catch {
        /* already gone */
      }
    }
  })()
  return true
}

/** Official c4d shell filter: only main-thread shells (agentId === undefined). */
export function isMainThreadAdoptedShell(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  return (raw as { agentId?: unknown }).agentId === undefined
}

/**
 * Official Lvu + k$a portable — rehydrate adopted shells from claim payload.
 * Registers local_bash tasks with createAdoptedShellCommand poll handles.
 * Skips shells whose agentId is set but not in adoptedAgentIds (orphan skip).
 * Dead pids (kill 0 fails) still register — official k$a finishes on first poll.
 */
export async function rehydrateAdoptedShells(
  shells: unknown[] | null | undefined,
  setAppState: (
    updater: (prev: { tasks: Record<string, unknown> }) => {
      tasks: Record<string, unknown>
    },
  ) => void,
  opts?: {
    adoptedAgentIds?: ReadonlySet<string>
    /**
     * When true (default), skip shells with agentId not in adoptedAgentIds.
     * Matches official adopt_owner_skipped for shells.
     */
    skipOrphanAgentShells?: boolean
    /**
     * Official n4d — when skipping orphan agent shells, SIGTERM their pids
     * (default true). Disable in tests that only assert skip counts.
     */
    killOrphanAgentShells?: boolean
    /** Override kill for tests. */
    killPid?: (pid: number) => void
  },
): Promise<RehydrateShellsResult> {
  let adopted = 0
  let skipped = 0
  if (!shells?.length) return { adopted, skipped }

  const skipOrphan = opts?.skipOrphanAgentShells !== false
  const killOrphan = opts?.killOrphanAgentShells !== false
  const adoptedAgents = opts?.adoptedAgentIds ?? new Set<string>()

  // Lazy requires for Task registration (avoid cycles at module load).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createTaskStateBase } =
    require('../Task.js') as typeof import('../Task.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerTask, updateTaskState } =
    require('./task/framework.js') as typeof import('./task/framework.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createAdoptedShellCommand } =
    require('./ShellCommand.js') as typeof import('./ShellCommand.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getCwd } = require('./cwd.js') as typeof import('./cwd.js')

  for (const raw of shells) {
    const es = asAdoptedShellEntry(raw)
    if (!es) {
      skipped++
      continue
    }
    if (
      skipOrphan &&
      es.agentId !== undefined &&
      !adoptedAgents.has(es.agentId)
    ) {
      // Official n4d(es) after adopt_owner_skipped for shells.
      if (killOrphan) killAdoptedShellEntry(es, opts?.killPid)
      skipped++
      continue
    }
    if (typeof es.pid !== 'number' || es.pid <= 0) {
      skipped++
      continue
    }

    try {
      await linkAdoptedShellOutput(es.taskId, es.outputPath)

      const shellCommand = createAdoptedShellCommand({
        taskId: es.taskId,
        pid: es.pid,
        procStart: es.procStart,
        startTimeTicks: es.startTimeTicks,
      })

      const description = es.description ?? es.command ?? 'adopted shell'
      const taskState = {
        ...createTaskStateBase(
          es.taskId,
          'local_bash',
          description,
          es.toolUseId,
        ),
        type: 'local_bash' as const,
        status: 'running' as const,
        command: es.command ?? '',
        cwd: (() => {
          try {
            return getCwd()
          } catch {
            return process.cwd()
          }
        })(),
        completionStatusSentInAttachment: false,
        shellCommand,
        lastReportedTotalLines: es.lastReportedTotalLines ?? 0,
        isBackgrounded: true,
        agentId: es.agentId,
        kind: es.kind === 'monitor' ? ('monitor' as const) : ('bash' as const),
      }

      // registerTask expects TaskState; portable cast is intentional.
      const setState = setAppState as unknown as Parameters<
        typeof registerTask
      >[1]
      registerTask(
        taskState as unknown as Parameters<typeof registerTask>[0],
        setState,
      )

      // Official Lvu: on result, mark terminal + clear shellCommand.
      void shellCommand.result.then(
        (result: { code?: number; interrupted?: boolean }) => {
          const status = result.interrupted ? 'killed' : 'completed'
          updateTaskState(es.taskId, setState, task => {
            if (
              task &&
              typeof task === 'object' &&
              'notified' in task &&
              (task as { notified?: boolean }).notified
            ) {
              return task
            }
            return {
              ...task,
              status,
              result: {
                code: result.code,
                interrupted: result.interrupted,
              },
              shellCommand: null,
              endTime: Date.now(),
            } as typeof task
          })
        },
      )

      adopted++
    } catch {
      skipped++
    }
  }

  return { adopted, skipped }
}

// ── Official r4d / PSu agent rehydrate ────────────────────────────────────

/** Serializable agent entry from adopt.json (official mDs). */
export type AdoptedAgentEntry = {
  agentId: string
  agentType?: string
  description?: string
  toolUseId?: string
  spawnDepth?: number
  startTime?: number
  transcriptPath?: string
  parentAgentId?: string
}

export type RehydrateAgentsResult = {
  adopted: number
  skipped: number
  /** Agent ids successfully registered (for shell/cron owner filter). */
  adoptedAgentIds: Set<string>
  /** Successfully rehydrated entries (for official t4d deferred resume). */
  adoptedEntries: AdoptedAgentEntry[]
}

function asAdoptedAgentEntry(raw: unknown): AdoptedAgentEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.agentId !== 'string' || !r.agentId) return null
  return {
    agentId: r.agentId,
    ...(typeof r.agentType === 'string' ? { agentType: r.agentType } : {}),
    ...(typeof r.description === 'string'
      ? { description: r.description }
      : {}),
    ...(typeof r.toolUseId === 'string' ? { toolUseId: r.toolUseId } : {}),
    ...(typeof r.spawnDepth === 'number' ? { spawnDepth: r.spawnDepth } : {}),
    ...(typeof r.startTime === 'number' ? { startTime: r.startTime } : {}),
    ...(typeof r.transcriptPath === 'string'
      ? { transcriptPath: r.transcriptPath }
      : {}),
    ...(typeof r.parentAgentId === 'string'
      ? { parentAgentId: r.parentAgentId }
      : {}),
  }
}

/**
 * Official r4d — symlink canonical agent transcript (+ .meta.json) to the
 * checkpointed transcriptPath when they differ. Requires source `.meta.json`
 * to exist (official `YH.stat(r(transcriptPath))`). No-ops when paths match
 * or already resolve to the same inode.
 */
export async function linkAdoptedAgentTranscript(
  entry: AdoptedAgentEntry | unknown,
): Promise<'linked' | 'same' | 'skipped' | 'failed'> {
  const es =
    entry && typeof entry === 'object' && 'agentId' in (entry as object)
      ? (entry as AdoptedAgentEntry)
      : asAdoptedAgentEntry(entry)
  if (!es?.transcriptPath) return 'skipped'
  try {
    const {
      realpath,
      mkdir: fsMkdir,
      symlink,
      unlink: fsUnlink,
      stat,
    } = await import('fs/promises')
    const { dirname: pathDirname } = await import('path')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAgentTranscriptPath } =
      require('./sessionStorage.js') as typeof import('./sessionStorage.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { asAgentId } =
      require('../types/ids.js') as typeof import('../types/ids.js')

    const metaOf = (p: string): string => p.replace(/\.jsonl$/, '.meta.json')
    // Official: await YH.stat(r(e.transcriptPath)) — fail if source meta missing.
    await stat(metaOf(es.transcriptPath))

    const canonical = getAgentTranscriptPath(asAgentId(es.agentId))
    if (canonical === es.transcriptPath) return 'same'
    try {
      if ((await realpath(canonical)) === es.transcriptPath) return 'same'
    } catch {
      // dest missing — proceed to link
    }
    await fsMkdir(pathDirname(canonical), { recursive: true })
    for (const [dest, src] of [
      [canonical, es.transcriptPath],
      [metaOf(canonical), metaOf(es.transcriptPath)],
    ] as const) {
      await fsUnlink(dest).catch(() => {})
      await symlink(src, dest)
    }
    return 'linked'
  } catch {
    return 'failed'
  }
}

/**
 * Official PSu portable — register a resumed agent as terminal completed
 * background task so UI can show it and shells can claim ownership.
 * Does not re-spawn the agent turn (transcript is already finished on disk).
 */
export function registerResumedAgentTask(
  entry: AdoptedAgentEntry,
  setAppState: (
    updater: (prev: { tasks: Record<string, unknown> }) => {
      tasks: Record<string, unknown>
    },
  ) => void,
): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createTaskStateBase } =
    require('../Task.js') as typeof import('../Task.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerTask } =
    require('./task/framework.js') as typeof import('./task/framework.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSessionId } =
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')

  let ownerAgentId: string | undefined
  try {
    ownerAgentId = entry.parentAgentId ?? getSessionId()
  } catch {
    ownerAgentId = entry.parentAgentId
  }

  const description = entry.description ?? '(resumed agent)'
  const base = createTaskStateBase(
    entry.agentId,
    'local_agent',
    description,
    entry.toolUseId,
  )
  const taskState = {
    ...base,
    ...(typeof entry.startTime === 'number'
      ? { startTime: entry.startTime }
      : {}),
    type: 'local_agent' as const,
    // Official PSu: status completed (shell ownership + Aye CAS can claim).
    // Do NOT set resuming/running here — densable Aye rejects those.
    status: 'completed' as const,
    agentId: entry.agentId,
    ownerAgentId,
    parentAgentId: entry.parentAgentId,
    spawnDepth: entry.spawnDepth,
    prompt: '',
    agentType: entry.agentType ?? 'general-purpose',
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    isIdle: false,
    pendingMessages: [] as Array<{ text: string; isMeta: boolean }>,
    retain: false,
    diskLoaded: false,
    notified: true,
    // Product UX: panel shows "resuming" until deferred Aye settles.
    adoptResumePending: true,
  }

  const setState = setAppState as unknown as Parameters<typeof registerTask>[1]
  registerTask(
    taskState as unknown as Parameters<typeof registerTask>[0],
    setState,
  )
}

/**
 * Official claim-loop agent rehydrate (r4d + PSu portable).
 * Sort by spawnDepth, skip when parentAgentId not yet adopted, link transcript,
 * register completed local_agent. Returns adoptedAgentIds for shell/cron filter.
 */
export async function rehydrateAdoptedAgents(
  agents: unknown[] | null | undefined,
  setAppState: (
    updater: (prev: { tasks: Record<string, unknown> }) => {
      tasks: Record<string, unknown>
    },
  ) => void,
  opts?: {
    /**
     * When false, skip r4d symlink (register only). Default true.
     */
    linkTranscripts?: boolean
  },
): Promise<RehydrateAgentsResult> {
  const adoptedAgentIds = new Set<string>()
  const adoptedEntries: AdoptedAgentEntry[] = []
  let adopted = 0
  let skipped = 0
  if (!agents?.length) {
    return { adopted, skipped, adoptedAgentIds, adoptedEntries }
  }

  const link = opts?.linkTranscripts !== false
  const entries = agents
    .map(asAdoptedAgentEntry)
    .filter((e): e is AdoptedAgentEntry => e !== null)
    // Official: sort by spawnDepth ascending so parents register first.
    .sort((a, b) => (a.spawnDepth ?? 0) - (b.spawnDepth ?? 0))

  for (const es of entries) {
    if (
      es.parentAgentId !== undefined &&
      !adoptedAgentIds.has(es.parentAgentId)
    ) {
      // Official RAo + adopt_owner_skipped — parent not registered.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { notifyAdoptAgentFailed } =
          require('./adoptFailNotify.js') as typeof import('./adoptFailNotify.js')
        notifyAdoptAgentFailed(es, 'owner not resumed', {
          parentRegistered: false,
        })
      } catch {
        /* best-effort */
      }
      skipped++
      continue
    }
    try {
      if (link && es.transcriptPath) {
        const result = await linkAdoptedAgentTranscript(es)
        if (result === 'failed') {
          // Official: RAo fail notify; still skip register.
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { notifyAdoptAgentFailed } =
              require('./adoptFailNotify.js') as typeof import('./adoptFailNotify.js')
            notifyAdoptAgentFailed(es, 'transcript link failed', {
              parentRegistered:
                es.parentAgentId !== undefined &&
                adoptedAgentIds.has(es.parentAgentId),
            })
          } catch {
            /* best-effort */
          }
          skipped++
          continue
        }
      }
      registerResumedAgentTask(es, setAppState)
      adoptedAgentIds.add(es.agentId)
      adoptedEntries.push(es)
      adopted++
    } catch {
      skipped++
    }
  }

  return { adopted, skipped, adoptedAgentIds, adoptedEntries }
}

// ── Official o4d / ess workflow rehydrate ─────────────────────────────────

/** Serializable workflow entry from adopt.json (official hDs). */
export type AdoptedWorkflowEntry = {
  taskId: string
  workflowRunId: string
  scriptPath?: string
  scriptSha256?: string
  argsJson?: string
  description?: string
  startTime?: number
  transcriptDir?: string
}

export type RehydrateWorkflowsResult = {
  adopted: number
  skipped: number
  /** Successfully rehydrated entries (for official t4d deferred resume). */
  adoptedEntries: AdoptedWorkflowEntry[]
}

function asAdoptedWorkflowEntry(raw: unknown): AdoptedWorkflowEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.taskId !== 'string' || !r.taskId) return null
  if (typeof r.workflowRunId !== 'string' || !r.workflowRunId) return null
  return {
    taskId: r.taskId,
    workflowRunId: r.workflowRunId,
    ...(typeof r.scriptPath === 'string' ? { scriptPath: r.scriptPath } : {}),
    ...(typeof r.scriptSha256 === 'string'
      ? { scriptSha256: r.scriptSha256 }
      : {}),
    ...(typeof r.argsJson === 'string' ? { argsJson: r.argsJson } : {}),
    ...(typeof r.description === 'string'
      ? { description: r.description }
      : {}),
    ...(typeof r.startTime === 'number' ? { startTime: r.startTime } : {}),
    ...(typeof r.transcriptDir === 'string'
      ? { transcriptDir: r.transcriptDir }
      : {}),
  }
}

/**
 * Official rEe / Gu subset — remote UNC or volume device paths that must not
 * be used as adopt scriptPath.
 */
export function isRemoteAdoptPath(p: string): boolean {
  if (!p) return false
  // \\?\volume{...} device paths
  if (/^\\\\\?\\volume\{/i.test(p)) return true
  // Windows UNC \\server\share
  if (/^\\\\[^\\]/.test(p)) return true
  // POSIX-style //server/share (or after realpath on some platforms)
  if (/^\/\/[^/]/.test(p)) return true
  // Official rEe also rejects paths with / after win32 root conversion edge cases
  // when already classified UNC — covered above.
  return false
}

/**
 * Official lEe portable — walk path components via lstat/readlink looking for
 * a symlink/junction that resolves to a remote UNC. Returns the remote path
 * string when found, else undefined.
 *
 * Caps follow depth at 64 (official a=64). Pure local absolute/relative links
 * are followed; only remote UNC targets trip the reject.
 */
export function findRemoteUncViaSymlinkWalk(
  scriptPath: string,
): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path')

  if (isRemoteAdoptPath(scriptPath)) return scriptPath

  let resolvedInput: string
  try {
    resolvedInput = path.resolve(scriptPath)
  } catch {
    return undefined
  }
  if (isRemoteAdoptPath(resolvedInput)) return resolvedInput

  const parsed = path.parse(resolvedInput)
  let cur = parsed.root
  const parts = resolvedInput
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)
  let hops = 0
  const maxHops = 64

  while (parts.length > 0 && hops < maxHops) {
    const next = path.join(cur, parts[0]!)
    if (isRemoteAdoptPath(next)) {
      return parts.length === 1 ? next : path.join(next, ...parts.slice(1))
    }
    let st: import('fs').Stats
    try {
      st = fs.lstatSync(next)
    } catch {
      return undefined
    }
    if (!st.isSymbolicLink()) {
      parts.shift()
      cur = next
      continue
    }
    hops++
    let link: string
    try {
      link = fs.readlinkSync(next)
    } catch {
      return undefined
    }
    const target = path.isAbsolute(link) ? link : path.resolve(cur, link)
    if (isRemoteAdoptPath(target)) {
      parts.shift()
      return parts.length === 0 ? target : path.join(target, ...parts)
    }
    parts.shift()
    const tParsed = path.parse(target)
    cur = tParsed.root || path.sep
    parts.unshift(
      ...target.slice(tParsed.root.length).split(path.sep).filter(Boolean),
    )
  }
  return undefined
}

/**
 * Official i4d / EAo portable — scriptPath must resolve under
 * `~/.claude/projects` (w6). Rejects UNC, symlink→UNC walks, unresolvable,
 * and out-of-root paths. Returns realpath string on success; throws Error
 * with official-toned message for AAo.
 */
export function validateAdoptScriptPath(scriptPath: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { realpathSync } = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    join: pathJoin,
    relative: pathRelative,
    isAbsolute,
  } = require('path') as typeof import('path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getClaudeConfigHomeDir } =
    require('./envUtils.js') as typeof import('./envUtils.js')

  if (typeof scriptPath !== 'string' || !scriptPath) {
    throw new Error('scriptPath rejected')
  }
  // Official rEe: remote UNC / device paths on the raw string.
  if (isRemoteAdoptPath(scriptPath)) {
    throw new Error(`adopt path is remote UNC: ${scriptPath}`)
  }
  // Official lEe: component walk for symlink/junction → remote UNC.
  const viaLink = findRemoteUncViaSymlinkWalk(scriptPath)
  if (viaLink !== undefined) {
    throw new Error(
      `adopt path traverses symlink/junction to remote UNC: ${viaLink}`,
    )
  }

  let resolved: string
  try {
    // Prefer native realpath when available (official iHe).
    const native = (
      realpathSync as typeof realpathSync & {
        native?: (p: string) => string
      }
    ).native
    resolved = (
      native ? native(scriptPath) : realpathSync(scriptPath)
    ).normalize('NFC')
  } catch {
    throw new Error(`adopt path unresolvable: ${scriptPath}`)
  }
  if (isRemoteAdoptPath(resolved)) {
    throw new Error(`adopt path is remote UNC: ${resolved}`)
  }

  const rootCandidate = pathJoin(getClaudeConfigHomeDir(), 'projects')
  let root: string
  try {
    const native = (
      realpathSync as typeof realpathSync & {
        native?: (p: string) => string
      }
    ).native
    root = (
      native ? native(rootCandidate) : realpathSync(rootCandidate)
    ).normalize('NFC')
  } catch {
    throw new Error('adopt path roots unresolvable')
  }

  const rel = pathRelative(root, resolved)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolved
  }
  throw new Error(`adopt path outside allowed roots: ${resolved}`)
}

/**
 * Official YJ portable — `<projectDir>/<sessionId>/subagents/workflows/<runId>`.
 * Best-effort; returns null when session bootstrap is unavailable.
 */
export function getCanonicalWorkflowTranscriptDir(
  workflowRunId: string,
): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSessionId, getSessionProjectDir, getOriginalCwd } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getProjectDir } =
      require('./sessionStoragePortable.js') as typeof import('./sessionStoragePortable.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join: pathJoin } = require('path') as typeof import('path')
    const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
    const sessionId = getSessionId()
    return pathJoin(
      projectDir,
      sessionId,
      'subagents',
      'workflows',
      workflowRunId,
    )
  } catch {
    return null
  }
}

/**
 * Official o4d — symlink canonical workflow transcript dir to checkpointed
 * transcriptDir when they differ. Requires `journal.jsonl` under source.
 * Official always runs o4d; missing transcriptDir fails (not skip).
 */
export async function linkAdoptedWorkflowTranscript(
  entry: AdoptedWorkflowEntry | unknown,
): Promise<'linked' | 'same' | 'failed'> {
  const es =
    entry && typeof entry === 'object' && 'workflowRunId' in (entry as object)
      ? (entry as AdoptedWorkflowEntry)
      : asAdoptedWorkflowEntry(entry)
  if (!es?.transcriptDir) return 'failed'
  try {
    const {
      realpath,
      mkdir: fsMkdir,
      symlink,
      unlink: fsUnlink,
      rmdir,
      rm,
      stat,
    } = await import('fs/promises')
    const { dirname: pathDirname, join: pathJoin } = await import('path')

    // Official: await YH.stat(join(transcriptDir, "journal.jsonl"))
    await stat(pathJoin(es.transcriptDir, 'journal.jsonl'))

    const canonical =
      getCanonicalWorkflowTranscriptDir(es.workflowRunId) ?? undefined
    if (!canonical) return 'failed'
    if (canonical === es.transcriptDir) return 'same'
    try {
      if ((await realpath(canonical)) === es.transcriptDir) return 'same'
    } catch {
      // dest missing
    }
    await fsMkdir(pathDirname(canonical), { recursive: true })
    try {
      await fsUnlink(canonical)
    } catch {
      try {
        await rmdir(canonical)
      } catch (e) {
        const code =
          e && typeof e === 'object' && 'code' in e
            ? String((e as { code?: unknown }).code)
            : ''
        if (code === 'ENOTEMPTY') {
          await rm(canonical, { recursive: true, force: true })
        }
      }
    }
    await symlink(es.transcriptDir, canonical)
    return 'linked'
  } catch {
    return 'failed'
  }
}

/**
 * Official ess portable — register adopted workflow as local_workflow with
 * status `"paused"` + `notified: true` (empty script/prompt/progress). Claim
 * path later resumes via w5u/AGr which removes the paused stub when launching.
 */
export function registerResumedWorkflowTask(
  entry: AdoptedWorkflowEntry,
  setAppState: (
    updater: (prev: { tasks: Record<string, unknown> }) => {
      tasks: Record<string, unknown>
    },
  ) => void,
): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createTaskStateBase } =
    require('../Task.js') as typeof import('../Task.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerTask } =
    require('./task/framework.js') as typeof import('./task/framework.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { basename } = require('path') as typeof import('path')

  const description = entry.description ?? '(resumed workflow)'
  const scriptPath = entry.scriptPath ?? ''
  const base = createTaskStateBase(entry.taskId, 'local_workflow', description)
  const taskState = {
    ...base,
    ...(typeof entry.startTime === 'number'
      ? { startTime: entry.startTime }
      : {}),
    type: 'local_workflow' as const,
    // Official ess: status "paused", notified:!0
    status: 'paused' as const,
    workflowName:
      (scriptPath ? basename(scriptPath, '.ts') : undefined) ||
      (scriptPath ? basename(scriptPath) : 'workflow'),
    workflowFile: scriptPath,
    summary: description,
    workflowRunId: entry.workflowRunId,
    scriptPath: entry.scriptPath,
    scriptSha256: entry.scriptSha256,
    argsJson: entry.argsJson,
    transcriptDir: entry.transcriptDir,
    // Official ess sets empty script/prompt + progress fields; keep thin.
    script: '',
    prompt: '',
    workflowProgress: [] as unknown[],
    progressVersion: 0,
    agentCount: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    logs: [] as unknown[],
    notified: true,
  }

  const setState = setAppState as unknown as Parameters<typeof registerTask>[1]
  registerTask(
    taskState as unknown as Parameters<typeof registerTask>[0],
    setState,
  )
}

/**
 * Official claim-loop workflow rehydrate (i4d + o4d + ess portable).
 * Requires i4d-valid scriptPath. On scriptPath reject → AAo. On o4d fail → AAo.
 * linkTranscripts:false skips o4d (unit tests); product path always links.
 */
export async function rehydrateAdoptedWorkflows(
  workflows: unknown[] | null | undefined,
  setAppState: (
    updater: (prev: { tasks: Record<string, unknown> }) => {
      tasks: Record<string, unknown>
    },
  ) => void,
  opts?: {
    linkTranscripts?: boolean
    /** Skip i4d for unit tests that use temp paths outside projects/. */
    skipScriptPathValidation?: boolean
  },
): Promise<RehydrateWorkflowsResult> {
  let adopted = 0
  let skipped = 0
  const adoptedEntries: AdoptedWorkflowEntry[] = []
  if (!workflows?.length) return { adopted, skipped, adoptedEntries }

  const link = opts?.linkTranscripts !== false
  const validatePath = opts?.skipScriptPathValidation !== true
  for (const raw of workflows) {
    const base = asAdoptedWorkflowEntry(raw)
    if (!base) {
      skipped++
      continue
    }
    try {
      // Official: Li = {...es, scriptPath: i4d(es.scriptPath)}
      let es = base
      if (validatePath) {
        try {
          const scriptPath = validateAdoptScriptPath(base.scriptPath)
          es = { ...base, scriptPath }
        } catch (e) {
          const reason =
            e instanceof Error ? e.message : 'adopt scriptPath rejected'
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { notifyAdoptWorkflowFailed } =
              require('./adoptFailNotify.js') as typeof import('./adoptFailNotify.js')
            // Official AAo(Pm without scriptPath) when i4d throws pre-assign.
            const { scriptPath: _sp, ...pm } = base
            notifyAdoptWorkflowFailed(
              pm as AdoptedWorkflowEntry,
              reason.includes('adopt') ? reason : 'adopt scriptPath rejected',
            )
          } catch {
            /* best-effort */
          }
          skipped++
          continue
        }
      } else if (!es.scriptPath) {
        skipped++
        continue
      }

      if (link) {
        const result = await linkAdoptedWorkflowTranscript(es)
        if (result === 'failed') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { notifyAdoptWorkflowFailed } =
              require('./adoptFailNotify.js') as typeof import('./adoptFailNotify.js')
            notifyAdoptWorkflowFailed(es, 'transcript link failed')
          } catch {
            /* best-effort */
          }
          skipped++
          continue
        }
      }
      registerResumedWorkflowTask(es, setAppState)
      adoptedEntries.push(es)
      adopted++
    } catch {
      skipped++
    }
  }
  return { adopted, skipped, adoptedEntries }
}

// ── Official t4d / wAo deferred resume stash ────────────────────────────────

type DeferredAdoptStash = {
  jobDir: string
  agents: AdoptedAgentEntry[]
  workflows: AdoptedWorkflowEntry[]
}

/** Official TAo — one-shot stash until MCP settle resumes them. */
let deferredAdoptStash: DeferredAdoptStash | null = null

/**
 * Official t4d — stash successfully rehydrated agents/workflows for deferred
 * engine resume after MCP clients settle. Cleared by takeDeferredAdoptStash.
 */
export function stashDeferredAdoptResume(
  jobDir: string | null | undefined,
  agents: AdoptedAgentEntry[],
  workflows: AdoptedWorkflowEntry[],
): void {
  if (!jobDir) {
    deferredAdoptStash = null
    return
  }
  deferredAdoptStash =
    agents.length > 0 || workflows.length > 0
      ? { jobDir, agents, workflows }
      : null
}

/**
 * Official wAo — take-and-clear stash when jobDir matches.
 */
export function takeDeferredAdoptStash(jobDir: string | null | undefined): {
  agents: AdoptedAgentEntry[]
  workflows: AdoptedWorkflowEntry[]
} {
  if (
    jobDir === undefined ||
    jobDir === null ||
    deferredAdoptStash?.jobDir !== jobDir
  ) {
    return { agents: [], workflows: [] }
  }
  const { agents, workflows } = deferredAdoptStash
  deferredAdoptStash = null
  return { agents, workflows }
}

/**
 * Peek TAo without clearing (tests / diagnostics). Official only has wAo take.
 */
export function peekDeferredAdoptStash(jobDir: string | null | undefined): {
  agents: AdoptedAgentEntry[]
  workflows: AdoptedWorkflowEntry[]
} {
  if (
    jobDir === undefined ||
    jobDir === null ||
    deferredAdoptStash?.jobDir !== jobDir
  ) {
    return { agents: [], workflows: [] }
  }
  return {
    agents: deferredAdoptStash.agents,
    workflows: deferredAdoptStash.workflows,
  }
}

/** Test helper — clear TAo without matching jobDir. */
export function resetDeferredAdoptStash(): void {
  deferredAdoptStash = null
}

// ── Left-arrow live CAo handle (parent → openAgentsViaLeftArrow) ────────────

/**
 * Official aAf keeps CAo live across Jlr write then calls checkpointAgents +
 * disown in-process. Local left-arrow unmounts REPL first, so the collected
 * PortableCheckpointResult (with abort closures) is stashed here and consumed
 * after adopt.json write in openAgentsViaLeftArrow.
 */
let leftArrowCheckpointLive: PortableCheckpointResult | null = null

/** Stash live CAo handle from REPL left-arrow before unmount. */
export function stashLeftArrowCheckpointLive(
  cp: PortableCheckpointResult | null | undefined,
): void {
  leftArrowCheckpointLive = cp ?? null
}

/**
 * Take-and-clear left-arrow CAo handle. Returns null if none stashed.
 * Call after adopt write (official: after Jlr, before/with disown).
 */
export function takeLeftArrowCheckpointLive(): PortableCheckpointResult | null {
  const cp = leftArrowCheckpointLive
  leftArrowCheckpointLive = null
  return cp
}

/** Test helper — drop stashed left-arrow handle. */
export function resetLeftArrowCheckpointLive(): void {
  leftArrowCheckpointLive = null
}

/**
 * Official aAf post-Jlr: `await y.checkpointAgents(reg); y.disown(reg)`.
 * Portable: abort workflows/agents ("background"), drop agent-owned shells,
 * then disown cron (session-global). Task registry remove is best-effort —
 * parent REPL AppState is usually already unmounted.
 */
export async function runLeftArrowPostAdoptCheckpoint(opts?: {
  removeTaskIds?: (ids: readonly string[]) => void
  removeAgentIds?: (ids: readonly string[]) => void
  removeCronIds?: (ids: readonly string[]) => void
  /**
   * Official Gx after setImmediate. Default: flushSessionStorage
   * (project transcript writer). Override in tests.
   */
  flushAgentTranscripts?: () => Promise<void> | void
  /** Official zit — mark workflow paused after abort. Best-effort post-unmount. */
  markWorkflowPaused?: (workflowTaskId: string) => void
  /**
   * When set and markWorkflowPaused omitted, default zit uses
   * pauseWorkflowTask(id, setAppState) (status `"paused"`).
   * Left-arrow usually unmounts first so this is often unavailable.
   */
  setAppState?: (
    updater: (prev: { tasks: Record<string, unknown> }) => {
      tasks: Record<string, unknown>
    },
  ) => void
}): Promise<{
  ran: boolean
  abortedWorkflowIds: string[]
  abortedAgentIds: string[]
}> {
  const live = takeLeftArrowCheckpointLive()
  if (!live) {
    return { ran: false, abortedWorkflowIds: [], abortedAgentIds: [] }
  }
  let abortedWorkflowIds: string[] = []
  let abortedAgentIds: string[] = []
  try {
    const flush =
      opts?.flushAgentTranscripts ??
      (async () => {
        try {
          // Official Gx() = await Hd().flush() — sessionStorage project flush.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { flushSessionStorage } =
            require('./sessionStorage.js') as typeof import('./sessionStorage.js')
          await flushSessionStorage()
        } catch {
          /* official: catch + warn residual */
        }
      })
    const markWorkflowPaused =
      opts?.markWorkflowPaused ??
      (opts?.setAppState
        ? (workflowTaskId: string) => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { pauseWorkflowTask } =
                require('../tasks/LocalWorkflowTask/LocalWorkflowTask.js') as typeof import('../tasks/LocalWorkflowTask/LocalWorkflowTask.js')
              pauseWorkflowTask(workflowTaskId, opts.setAppState as never)
            } catch {
              /* best-effort zit */
            }
          }
        : undefined)
    const r = await live.checkpointAgents({
      removeTaskIds: opts?.removeTaskIds,
      markWorkflowPaused,
      flushAgentTranscripts: flush,
    })
    abortedWorkflowIds = r.abortedWorkflowIds
    abortedAgentIds = r.abortedAgentIds
  } catch {
    /* best-effort */
  }
  try {
    // densable aAf disown after Jlr: default cron remover is session-global
    // removeSessionCronTasks — REPL must NOT pre-detach cron (irreversible
    // if adopt/spawn fails). Callers can override for tests.
    let removeCronIds = opts?.removeCronIds
    if (!removeCronIds) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { removeSessionCronTasks } =
          require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
        removeCronIds = ids => {
          removeSessionCronTasks(ids)
        }
      } catch {
        removeCronIds = undefined
      }
    }
    live.disown({
      removeTaskIds: opts?.removeTaskIds,
      removeAgentIds: opts?.removeAgentIds,
      removeCronIds,
    })
  } catch {
    /* best-effort */
  }
  return { ran: true, abortedWorkflowIds, abortedAgentIds }
}

/**
 * densable gDs — MCP ready only when `clientsInitialized === true` and no
 * client is still `"pending"`. Missing mcp / missing flag is NOT ready
 * (official: `e.mcp.clientsInitialized===!0&&!e.mcp.clients.some(...)`).
 */
export function isMcpClientsSettled(state: {
  mcp?: { clientsInitialized?: boolean; clients?: Array<{ type?: string }> }
}): boolean {
  const mcp = state.mcp
  if (!mcp) return false
  if (mcp.clientsInitialized !== true) return false
  const clients = mcp.clients ?? []
  return !clients.some(c => c.type === 'pending')
}

/**
 * Official x$a portable — wait until predicate(store) is true or timeout.
 * Returns true if settled, false on timeout.
 */
export function waitForStorePredicate(
  getState: () => unknown,
  predicate: (state: unknown) => boolean,
  opts: { timeoutMs: number; subscribe?: (listener: () => void) => () => void },
): Promise<boolean> {
  try {
    if (predicate(getState())) return Promise.resolve(true)
  } catch {
    /* fall through to wait */
  }
  const subscribe = opts.subscribe
  if (!subscribe) {
    return new Promise(resolve => {
      setTimeout(() => {
        try {
          resolve(predicate(getState()))
        } catch {
          resolve(false)
        }
      }, opts.timeoutMs)
    })
  }
  return new Promise(resolve => {
    let unsub: () => void = () => {}
    const timer = setTimeout(() => {
      unsub()
      try {
        resolve(predicate(getState()))
      } catch {
        resolve(false)
      }
    }, opts.timeoutMs)
    unsub = subscribe(() => {
      try {
        if (predicate(getState())) {
          clearTimeout(timer)
          unsub()
          resolve(true)
        }
      } catch {
        /* keep waiting */
      }
    })
  })
}

/**
 * Official w5u portable — re-launch a stashed workflow after adopt.
 *
 * Steps (official order):
 * 1. read script from scriptPath
 * 2. require scriptSha256 pin + verify content hash
 * 3. parseScript early validation (Ux/Git portable — engine parseScript)
 * 4. if another local_workflow with same workflowRunId is already running,
 *    remove the adopted taskId and return (no double-launch)
 * 5. WorkflowService.launch({ scriptPath, resumeFromRunId, args })
 *
 * Product path may pass getTasks/removeTask for the running-dedupe step;
 * when omitted, dedupe is a no-op (tests / thin context).
 */
export async function resumeAdoptedWorkflow(
  entry: AdoptedWorkflowEntry,
  opts?: {
    /** Live AppState.tasks snapshot for official running-dedupe. */
    getTasks?: () => Record<string, unknown> | null | undefined
    /** Remove adopted taskId when same run already running. */
    removeTask?: (taskId: string) => void
    /** Override launch for tests (skips getWorkflowService). */
    launch?: (input: {
      scriptPath: string
      resumeFromRunId: string
      args?: unknown
      description?: string
      script: string
    }) => Promise<void>
    /** Override parse for tests — throw to simulate parse fail. */
    parseScript?: (source: string) => unknown
    /**
     * densable w5u `toolUseContext` — required for product launch path.
     * Tests that pass `launch` may omit.
     */
    toolUseContext?: unknown
    /**
     * densable w5u `canUseTool` — required for product launch path.
     * Tests that pass `launch` may omit.
     */
    canUseTool?: (
      input: unknown,
      toolUseContext: unknown,
    ) => Promise<unknown> | unknown
  },
): Promise<void> {
  if (!entry.scriptPath) {
    throw new Error('adopted workflow missing scriptPath')
  }
  if (entry.scriptSha256 === undefined) {
    throw new Error(
      'workflow was checkpointed without a content pin; resume via the Workflow tool',
    )
  }
  let script: string
  try {
    const { readFile: fsReadFile } = await import('fs/promises')
    script = await fsReadFile(entry.scriptPath, 'utf8')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`adopted workflow script read failed: ${msg}`)
  }
  const hash = createHash('sha256').update(script).digest('hex')
  if (hash !== entry.scriptSha256) {
    throw new Error(
      'script content changed since it was approved; resume via the Workflow tool to re-approve',
    )
  }

  // Official Ux/Git early validation — fail before launch with parse errors.
  try {
    if (opts?.parseScript) {
      opts.parseScript(script)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { parseScript } =
        require('@claude-code/workflow-engine') as typeof import('@claude-code/workflow-engine')
      parseScript(script)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Invalid workflow script: ${msg}`)
  }

  // Official w5u + AGr isResume cleanup against live task map:
  // - if same workflowRunId already running → drop adopted taskId and return
  // - else remove other non-running local_workflow stubs with same run id
  //   (ess paused placeholder) so launch can re-own the run.
  try {
    const tasks = opts?.getTasks?.() ?? null
    if (tasks) {
      const staleIds: string[] = []
      for (const [id, d] of Object.entries(tasks)) {
        if (!d || typeof d !== 'object') continue
        const t = d as {
          type?: unknown
          workflowRunId?: unknown
          status?: unknown
        }
        if (
          t.type !== 'local_workflow' ||
          t.workflowRunId !== entry.workflowRunId
        ) {
          continue
        }
        if (t.status === 'running') {
          opts?.removeTask?.(entry.taskId)
          return
        }
        // Official AGr isResume: remove non-running same-runId entries
        // (includes the ess paused placeholder for this taskId).
        staleIds.push(id)
      }
      for (const id of staleIds) {
        opts?.removeTask?.(id)
      }
    }
  } catch {
    /* best-effort dedupe */
  }

  let args: unknown
  if (entry.argsJson !== undefined) {
    try {
      args = JSON.parse(entry.argsJson)
    } catch {
      args = undefined
    }
  }

  if (opts?.launch) {
    await opts.launch({
      scriptPath: entry.scriptPath,
      resumeFromRunId: entry.workflowRunId,
      script,
      ...(args !== undefined ? { args } : {}),
      ...(entry.description ? { description: entry.description } : {}),
    })
    return
  }

  // densable w5u: AGr({..., toolUseContext, canUseTool}) — never empty allow-all.
  if (opts?.toolUseContext == null || opts?.canUseTool == null) {
    throw new Error(
      'adopted workflow resume requires toolUseContext and canUseTool (densable w5u)',
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getWorkflowService } =
    require('../workflow/service.js') as typeof import('../workflow/service.js')
  const svc = getWorkflowService()
  await svc.launch(
    {
      scriptPath: entry.scriptPath,
      resumeFromRunId: entry.workflowRunId,
      ...(args !== undefined ? { args: args as never } : {}),
      ...(entry.description ? { description: entry.description } : {}),
    },
    opts.toolUseContext as never,
    opts.canUseTool as never,
  )
}

/**
 * Official BSe deferred path subset — after claim, wait for MCP settle then
 * resume stashed workflows (w5u) and agents when `resumeAgent` is provided
 * (Aye portable via resumeAgentBackground at the call site).
 * Ylr/4 = 30000ms official settle timeout.
 */
export async function scheduleDeferredAdoptResume(input: {
  jobDir: string
  getState: () => unknown
  subscribe?: (listener: () => void) => () => void
  /** When false, skip MCP wait (tests). Default true. */
  waitForMcp?: boolean
  /** Override resume for tests. */
  resumeWorkflow?: (entry: AdoptedWorkflowEntry) => Promise<void>
  /**
   * Official Aye portable — when set, resume stashed agents after MCP settle.
   * Product path supplies resumeAgentBackground-backed adapter with
   * `continueInterruptedTurn: true` (official BSe `Aye({... continueInterruptedTurn:!0})`).
   * Claim path is fire-and-forget (no EAf); orphan ese maps alreadyCompleted separately.
   * Tests mock.
   */
  resumeAgent?: (entry: AdoptedAgentEntry) => Promise<void>
  /** Still-held jobDir check — official hQe()===vr. Default always true. */
  isJobDirCurrent?: (jobDir: string) => boolean
  /**
   * Official w5u running-dedupe: remove adopted taskId when same workflowRunId
   * already running. Product path supplies setAppState remover.
   */
  removeTask?: (taskId: string) => void
  /**
   * densable w5u toolUseContext — product path must supply (same as Aye adapter).
   * Tests that pass resumeWorkflow may omit.
   */
  toolUseContext?: unknown
  /**
   * densable w5u canUseTool — product path must supply.
   */
  canUseTool?: (
    input: unknown,
    toolUseContext: unknown,
  ) => Promise<unknown> | unknown
  /**
   * Lazy product-path resolver when context is not ready at schedule time
   * (REPL closes over deferredResumeRefs after first paint).
   */
  getWorkflowResumeContext?: () => {
    toolUseContext?: unknown
    canUseTool?: (
      input: unknown,
      toolUseContext: unknown,
    ) => Promise<unknown> | unknown
  } | null
}): Promise<{
  resumed: number
  failed: number
  agentsResumed: number
  agentsFailed: number
}> {
  const timeoutMs = 30_000 // Ylr/4
  if (input.waitForMcp !== false) {
    await waitForStorePredicate(
      input.getState,
      s =>
        isMcpClientsSettled(
          s as { mcp?: { clients?: Array<{ type?: string }> } },
        ),
      { timeoutMs, subscribe: input.subscribe },
    )
  }
  if (input.isJobDirCurrent && !input.isJobDirCurrent(input.jobDir)) {
    return { resumed: 0, failed: 0, agentsResumed: 0, agentsFailed: 0 }
  }
  const { agents, workflows } = takeDeferredAdoptStash(input.jobDir)
  let resumed = 0
  let failed = 0
  let agentsResumed = 0
  let agentsFailed = 0
  const resume =
    input.resumeWorkflow ??
    ((e: AdoptedWorkflowEntry) => {
      const lazy = input.getWorkflowResumeContext?.() ?? null
      const toolUseContext = input.toolUseContext ?? lazy?.toolUseContext
      const canUseTool = input.canUseTool ?? lazy?.canUseTool
      return resumeAdoptedWorkflow(e, {
        getTasks: () => {
          try {
            const s = input.getState() as {
              tasks?: Record<string, unknown>
            }
            return s?.tasks
          } catch {
            return null
          }
        },
        removeTask: input.removeTask,
        toolUseContext,
        canUseTool,
      })
    })
  for (const w of workflows) {
    try {
      await resume(w)
      resumed++
    } catch (e) {
      failed++
      // Official BSe: Je.remove(qn.taskId) then AAo on w5u fail.
      try {
        input.removeTask?.(w.taskId)
      } catch {
        /* best-effort */
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { notifyAdoptWorkflowFailed } =
          require('./adoptFailNotify.js') as typeof import('./adoptFailNotify.js')
        notifyAdoptWorkflowFailed(
          w,
          e instanceof Error ? e.message : 'resume failed',
        )
      } catch {
        /* best-effort */
      }
    }
  }

  // Official: for (let qn of ft) Aye({... continueInterruptedTurn:!0 ...})
  // agentId-level in-flight de-dupe vs orphan ese (shared process Set).
  if (input.resumeAgent) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tryClaimAgentResumeInFlight, releaseAgentResumeInFlight } =
      require('./orphanAgentResume.js') as typeof import('./orphanAgentResume.js')
    for (const a of agents) {
      if (!tryClaimAgentResumeInFlight(a.agentId)) {
        continue
      }
      try {
        await input.resumeAgent(a)
        agentsResumed++
      } catch (e) {
        agentsFailed++
        // Official BSe: Je.remove(qn.agentId) then RAo on Aye fail.
        try {
          input.removeTask?.(a.agentId)
        } catch {
          /* best-effort */
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { notifyAdoptAgentFailed } =
            require('./adoptFailNotify.js') as typeof import('./adoptFailNotify.js')
          notifyAdoptAgentFailed(
            a,
            e instanceof Error ? e.message : 'resume failed',
            { parentRegistered: false },
          )
        } catch {
          /* best-effort */
        }
      } finally {
        releaseAgentResumeInFlight(a.agentId)
      }
    }
  }

  return { resumed, failed, agentsResumed, agentsFailed }
}

/**
 * Official u4d pre-serialize abort — workflows then agents:
 * `abortController?.abort("background")` so in-process work stops before
 * adopt.json write. Shells are detached (not aborted) via fDs.
 * Returns aborted task ids (encounter order).
 */
export function abortHandoffLiveTasks(input: {
  tasks?: Record<string, PortableTaskLike> | null
  /** Task ids in the handoff set (agents + workflows). Shells ignored. */
  handoffTaskIds?: Iterable<string> | null
  /** Override abort reason (default official "background"). */
  reason?: string
}): { abortedIds: string[] } {
  const handoff = new Set(input.handoffTaskIds ?? [])
  const reason = input.reason ?? 'background'
  const abortedIds: string[] = []
  for (const t of Object.values(input.tasks ?? {})) {
    if (handoff.size > 0 && !handoff.has(t.id)) continue
    if (t.type !== 'local_agent' && t.type !== 'local_workflow') continue
    if (!t.abortController) continue
    try {
      t.abortController.abort?.(reason)
      abortedIds.push(t.id)
    } catch {
      /* ignore */
    }
  }
  return { abortedIds }
}

/**
 * Official u4d/Jlr + c4d portable — write adopt.json with `origin: "exit"` for
 * the next wake. Cron cleared. Shells filtered to main-thread only
 * (`agentId === undefined`); agent-owned shells are SIGTERM'd (Hen residual).
 * Prefer `payload` when already snapshotted; otherwise collect from tasks.
 */
export async function writeExitHandoffAdopt(
  jobDir: string | null | undefined,
  input: {
    tasks?: Record<string, PortableTaskLike> | null
    payload?: BgCheckpointPayload | null
    /** Optional pre-collected portable result (uses its payload + detaches already done). */
    checkpoint?: PortableCheckpointResult | null
    nowMs?: number
    /** Override kill for tests. */
    killPid?: (pid: number) => void
    /**
     * When true (default if tasks provided), abort handoff agent/workflow
     * abortControllers with reason "background" (official u4d).
     */
    abortLive?: boolean
  },
): Promise<BgCheckpointPayload | null> {
  if (!jobDir) return null

  let payload: BgCheckpointPayload | null = null
  let handoffTaskIds: string[] | undefined
  if (input.payload) {
    payload = input.payload
  } else if (input.checkpoint?.payload) {
    payload = input.checkpoint.payload
    handoffTaskIds = input.checkpoint.handoffTaskIds
  } else if (input.tasks) {
    const cp = collectPortableCheckpoint({
      tasks: input.tasks,
      cron: [],
      nowMs: input.nowMs,
      detachShells: true,
    })
    payload = cp?.payload ?? null
    handoffTaskIds = cp?.handoffTaskIds
  }

  if (!payload) return null

  // Official u4d: abort live agents/workflows before serialize.
  if (input.abortLive !== false && input.tasks) {
    let abortIds = handoffTaskIds
    if (!abortIds) {
      // Fall back without checkpoint: match payload agentId/taskId against
      // live task map ids (agents often use agentId as task id).
      const agentIds = new Set(
        ((payload.agents ?? []) as Array<{ agentId?: string }>)
          .map(a => a.agentId)
          .filter((x): x is string => typeof x === 'string'),
      )
      const workflowIds = new Set(
        ((payload.workflows ?? []) as Array<{ taskId?: string }>)
          .map(w => w.taskId)
          .filter((x): x is string => typeof x === 'string'),
      )
      abortIds = Object.values(input.tasks)
        .filter(t => {
          if (t.type === 'local_workflow') return workflowIds.has(t.id)
          if (t.type === 'local_agent') {
            return agentIds.has(t.id) || agentIds.has(t.agentId ?? '')
          }
          return false
        })
        .map(t => t.id)
    }
    abortHandoffLiveTasks({
      tasks: input.tasks,
      handoffTaskIds: abortIds,
    })
  }

  // Official c4d: shells = yDs && agentId === undefined. Agent-owned shells
  // are not handed off — kill them (Hen non-handoff reap subset).
  const allShells = payload.shells ?? []
  const mainShells: unknown[] = []
  for (const s of allShells) {
    if (isMainThreadAdoptedShell(s)) {
      mainShells.push(s)
    } else {
      killAdoptedShellEntry(s, input.killPid)
    }
  }

  // Official fDs: attach procStart identity before write.
  const shells = await enrichShellsWithProcStart(mainShells)

  // Official c4d/u4d: wAo(jobDir) unresumedAgents/unresumedWorkflows merge into
  // exit handoff (agents that were rehydrated but not yet engine-resumed).
  // Official: u.push(...n) / p=[...hDs,...o] — live payload first, unresumed
  // appended; dedupe keeps the first (live) entry on id collision.
  const unresumed = takeDeferredAdoptStash(jobDir)
  const agents = dedupeByKey(
    (payload.agents ?? []) as unknown[],
    unresumed.agents as unknown[],
    e => {
      if (e && typeof e === 'object' && 'agentId' in e) {
        const id = (e as { agentId?: unknown }).agentId
        return typeof id === 'string' && id.length > 0 ? id : undefined
      }
      return undefined
    },
  ).filter(e => {
    if (!e || typeof e !== 'object') return false
    return typeof (e as { agentId?: unknown }).agentId === 'string'
  })
  const workflows = dedupeByKey(
    (payload.workflows ?? []) as unknown[],
    unresumed.workflows as unknown[],
    e => {
      if (e && typeof e === 'object' && 'taskId' in e) {
        const id = (e as { taskId?: unknown }).taskId
        return typeof id === 'string' && id.length > 0 ? id : undefined
      }
      return undefined
    },
  ).filter(e => {
    if (!e || typeof e !== 'object') return false
    return typeof (e as { taskId?: unknown }).taskId === 'string'
  })
  if (shells.length === 0 && agents.length === 0 && workflows.length === 0) {
    return null
  }

  return writeAdoptJson(jobDir, {
    writtenAtMs: input.nowMs ?? Date.now(),
    origin: 'exit',
    shells,
    cron: [], // official exit handoff always clears cron
    ...(agents.length ? { agents } : {}),
    ...(workflows.length ? { workflows } : {}),
  })
}
