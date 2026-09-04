/**
 * densable 2.1.243 #14 — official `tBt` / `wzr` / `$ae` / `Dae` / `hon`.
 *
 * Stage 1 (`xml_s1`): wall-clock `$ae=60000` with `"per_attempt"` (reset on
 * each fetch). Stage 2 (`xml_s2`): `Dae=120000` with `"per_call"` (shared).
 * sideQuery always gets `timeout: hon=60000`.
 * `wzr` catch: `p$s` then retry remaining budget; 243 `ASe===null` so no retry.
 */
import { sideQuery, type SideQueryOptions } from '../sideQuery.js'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages.js'
import {
  autoModeClassifierExtraBetas,
  dropRejectedAutoModeClassifierBeta,
  latchAutoModeClassifierBetaRejected,
} from './classifierBetaLatch.js'

/** Official `$ae` — xml_s1 wall-clock, reset on each fetch. */
export const CLASSIFIER_XML_S1_WALL_CLOCK_MS = 60_000
/** Official `Dae` — xml_s2 wall-clock, one budget for the whole call. */
export const CLASSIFIER_XML_S2_WALL_CLOCK_MS = 120_000
/** Official `hon` — API-client timeout passed through `tBt` → `A$`. */
export const CLASSIFIER_SIDE_QUERY_TIMEOUT_MS = 60_000

export type ClassifierWallClockPolicy = 'per_attempt' | 'per_call'

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  timer.unref?.()
}

/**
 * Official `tBt` + `wzr` catch (`p$s` / `f$s`).
 *
 * `e` = parent signal, `t` = sideQuery opts, `o` = wall-clock ms,
 * `s` = `"per_attempt"` | `"per_call"`, `i` = `{ count }`.
 */
export async function sideQueryWithClassifierWallClock(
  parentSignal: AbortSignal | undefined,
  opts: SideQueryOptions,
  wallClockMs: number,
  policy: ClassifierWallClockPolicy,
  fetchAttempts: { count: number } = { count: 0 },
): Promise<BetaMessage> {
  const started = Date.now()
  let queryOpts: SideQueryOptions = {
    ...opts,
    extraBetas: opts.extraBetas ?? autoModeClassifierExtraBetas(),
  }
  const run = async (remainingMs: number): Promise<BetaMessage> => {
    const abort = new AbortController()
    const abortWallClock = (): void => abort.abort()
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      abortWallClock,
      remainingMs,
    )
    unrefTimer(timer)
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, abort.signal])
      : abort.signal
    try {
      return await sideQuery({
        ...queryOpts,
        timeout: CLASSIFIER_SIDE_QUERY_TIMEOUT_MS,
        signal,
        onFetchAttempt: () => {
          fetchAttempts.count++
          if (policy === 'per_attempt' && !signal.aborted) {
            if (timer !== undefined) clearTimeout(timer)
            timer = setTimeout(abortWallClock, remainingMs)
            unrefTimer(timer)
          }
        },
      })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  try {
    return await run(wallClockMs)
  } catch (err) {
    const retried = dropRejectedAutoModeClassifierBeta(err, queryOpts)
    const remaining = wallClockMs - (Date.now() - started)
    if (retried === null || remaining <= 0) throw err
    const priorFetches = fetchAttempts.count
    fetchAttempts.count = 0
    try {
      queryOpts = retried
      const raw = await run(remaining)
      latchAutoModeClassifierBetaRejected(err, {
        classifierModel: queryOpts.model,
        classifierStage: 'retry',
      })
      return raw
    } catch {
      fetchAttempts.count = priorFetches
      throw err
    }
  }
}
