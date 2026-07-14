/**
 * Official dOo / Dro / sQt / Nro portable subset — adopt.json checkpoint
 * payload shape + prefill truncation for mid-turn background forks.
 *
 * Full official path also serializes live shells/agents/workflows/cron and
 * checkpointAgents/disown/abandon against the task registry. Portable: pure
 * payload builders + merge helpers so consumers can write adopt.json without
 * the full agent runtime.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
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
}

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

  return {
    writtenAtMs: Math.max(existing.writtenAtMs ?? 0, incoming.writtenAtMs ?? 0),
    shells,
    cron,
    ...(agents.length ? { agents } : {}),
    ...(workflows.length ? { workflows } : {}),
    prefill: incoming.prefill ?? existing.prefill,
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
 * Official sQt portable write — merge with existing adopt.json when present,
 * then atomic-ish write. Returns the payload written.
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
  await writeFile(path, JSON.stringify(toWrite), { mode: 0o600 })
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
