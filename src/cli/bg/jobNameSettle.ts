/**
 * densable 2.1.246 #15 — `ro` / `Ln` / `co` (SEA @229810400).
 *
 * Background handoff numbers a colliding job name `my-session (2)`.
 * Live session uniqueness (`JM_` `name-word-word`) is a different path.
 */
import { logForDebugging } from '../../utils/debug.js'
import { normalizeSessionNameKey } from '../../utils/sessionNameUniqueness.js'
import {
  SESSION_TITLE_MAX_CODE_POINTS,
  capSessionTitleCodePoints,
  sanitizeSessionTitle,
} from '../../utils/sessionTitleSanitize.js'
import { withDeadline } from '../../utils/sleep.js'
import type { BackgroundSeed } from './helpers.js'

/** densable `On` */
export const JOB_NAME_GENERATION_RE = /^(.*\S) \((\d{1,6})\)$/

/** densable `En` — listJobs budget for seed settle. */
export const SEED_NAME_SETTLE_TIMEOUT_MS = 1500

/** densable `io` cap after sanitize — session title OMb. */
const NAME_CAP = SESSION_TITLE_MAX_CODE_POINTS

export type JobNameGeneration = {
  base: string
  generation: number
}

/** densable `ro` */
export function parseJobNameGeneration(name: string): JobNameGeneration {
  const match = JOB_NAME_GENERATION_RE.exec(name)
  return match
    ? { base: match[1]!, generation: Number(match[2]) }
    : { base: name, generation: 1 }
}

/**
 * densable `Ln` — if `name` is already occupied, append ` (${n})` from
 * max sibling generation + 1. Compare via `q` = normalizeSessionNameKey.
 */
export function allocateNumberedJobName(
  name: string,
  occupied: readonly string[],
): string {
  const nameKey = normalizeSessionNameKey(name)
  const { base } = parseJobNameGeneration(name)
  const baseKey = normalizeSessionNameKey(base)
  const keys = new Set<string>()
  let generation = 1
  for (const existing of occupied) {
    keys.add(normalizeSessionNameKey(existing))
    const parsed = parseJobNameGeneration(existing)
    if (normalizeSessionNameKey(parsed.base) === baseKey) {
      generation = Math.max(generation, parsed.generation)
    }
  }
  if (!keys.has(nameKey)) return name
  const sanitized = sanitizeSessionTitle(base) || base
  for (let n = generation + 1; ; n++) {
    const suffix = ` (${n})`
    const candidate = `${capSessionTitleCodePoints(sanitized, NAME_CAP - suffix.length)}${suffix}`
    if (!keys.has(normalizeSessionNameKey(candidate))) return candidate
  }
}

export type SettleBackgroundSeedNameDeps = {
  listNames?: () => Promise<string[]>
  timeoutMs?: number
}

async function defaultListJobNames(): Promise<string[]> {
  const { listAllJobs } = await import('../../daemon/jobState.js')
  const jobs = await listAllJobs()
  return jobs.flatMap(job => (job.state.name ? [job.state.name] : []))
}

/**
 * densable `co` — settle seed.name against live job names.
 * Timeout / list failure: log and return seed unchanged.
 */
export async function settleBackgroundSeedName<T extends BackgroundSeed>(
  seed: T,
  deps?: SettleBackgroundSeedNameDeps,
): Promise<T | (T & { name: string; nameSource: 'collision' })> {
  if (!seed.name) return seed
  const listNames = deps?.listNames ?? defaultListJobNames
  const timeoutMs = deps?.timeoutMs ?? SEED_NAME_SETTLE_TIMEOUT_MS
  let names: string[] | undefined
  try {
    names = await withDeadline(listNames(), timeoutMs)
  } catch (error) {
    logForDebugging(
      `[background] seed name settle skipped: ${error instanceof Error ? error.message : String(error)}`,
    )
    return seed
  }
  if (names === undefined) {
    logForDebugging('[background] seed name settle skipped: timed out')
    return seed
  }
  const next = allocateNumberedJobName(seed.name, names)
  if (next === seed.name) return seed
  return { ...seed, name: next, nameSource: 'collision' }
}
