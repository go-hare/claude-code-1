/**
 * densable 2.1.243 #14 — official `tBt` / `wzr` / `$ae` / `Dae` / `hon`.
 * densable 2.1.246 #17 — official `qin` / `GLs` / `e1t` / `D1r` deadline scale.
 *
 * Stage 1 (`xml_s1`): wall-clock `c=qin(...)` with `"per_attempt"` (reset on
 * each fetch). Stage 2 (`xml_s2`): `W6=120000` with `"per_call"` (shared).
 * `e1t` passes `timeout: attemptTimeoutMs`. `D1r` optional `ceilingMs` → `$u`.
 * `wzr` catch: `p$s` then retry remaining budget; 243 `ASe===null` so no retry.
 */
import { sideQuery, type SideQueryOptions } from '../sideQuery.js'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import {
  autoModeClassifierExtraBetas,
  dropRejectedAutoModeClassifierBeta,
  latchAutoModeClassifierBetaRejected,
} from './classifierBetaLatch.js'

/** Official `vst` / `$ae` — xml_s1 wall-clock base, reset on each fetch. */
export const CLASSIFIER_XML_S1_WALL_CLOCK_MS = 60_000
/** Official `W6` / `Dae` — xml_s2 wall-clock, one budget for the whole call. */
export const CLASSIFIER_XML_S2_WALL_CLOCK_MS = 120_000
/** Official `Bin` / `hon` — API-client timeout floor / default `attemptTimeoutMs`. */
export const CLASSIFIER_SIDE_QUERY_TIMEOUT_MS = 60_000

export type ClassifierWallClockPolicy = 'per_attempt' | 'per_call'

/** Official `GLs` / `e1t` / `D1r` timing bag. */
export type ClassifierWallClockTiming = {
  deadlineMs: number
  scope: ClassifierWallClockPolicy
  attemptTimeoutMs: number
  ceilingMs?: number
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  timer.unref?.()
}

/**
 * Official `qin` — scale xml_s1 deadline with prompt size.
 * `t=max(0,ceil((e-50000)/50000)); return min(W6,vst+t*1e4)`
 */
export function scaleClassifierDeadlineMs(tokens: number): number {
  const steps = Math.max(0, Math.ceil((tokens - 50_000) / 50_000))
  return Math.min(
    CLASSIFIER_XML_S2_WALL_CLOCK_MS,
    CLASSIFIER_XML_S1_WALL_CLOCK_MS + steps * 10_000,
  )
}

/**
 * Official `tBt` / `e1t` + `wzr` catch (`p$s` / `f$s`) + `D1r` `ceilingMs`.
 *
 * `e` = parent signal, `t` = sideQuery opts, timing = `{deadlineMs,scope,attemptTimeoutMs,ceilingMs?}`,
 * `i` = `{ count }`.
 */
export async function sideQueryWithClassifierWallClock(
  parentSignal: AbortSignal | undefined,
  opts: SideQueryOptions,
  timing: ClassifierWallClockTiming,
  fetchAttempts: { count: number } = { count: 0 },
): Promise<BetaMessage> {
  const started = Date.now()
  const { deadlineMs, scope, attemptTimeoutMs, ceilingMs } = timing
  const ceiling =
    ceilingMs === undefined
      ? undefined
      : createCombinedAbortSignal(parentSignal, { timeoutMs: ceilingMs })
  const wallParent = ceiling?.signal ?? parentSignal
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
    const signal = wallParent
      ? AbortSignal.any([wallParent, abort.signal])
      : abort.signal
    try {
      return await sideQuery({
        ...queryOpts,
        timeout: attemptTimeoutMs,
        signal,
        onFetchAttempt: () => {
          fetchAttempts.count++
          if (scope === 'per_attempt' && !signal.aborted) {
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
    return await run(deadlineMs)
  } catch (err) {
    const retried = dropRejectedAutoModeClassifierBeta(err, queryOpts)
    const remaining = deadlineMs - (Date.now() - started)
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
  } finally {
    ceiling?.cleanup()
  }
}
