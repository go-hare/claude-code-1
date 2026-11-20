import { createContext, useContext, useEffect } from 'react'

/** Official 2.1.327 (#520) `jR = 150`: grace window after SIGCONT resume. */
export const SIGCONT_RESUME_GRACE_MS = 150

export type InputClock = (() => number) & {
  /** Timestamp (ms) of the latest SIGCONT resume, or undefined if none. */
  resumedAt?: () => number | undefined
  /**
   * Official 2.1.328 (#603): register an owner that wants every keypress
   * delivered without rapid-input gating (e.g. search inputs, theme color editor).
   */
  wantEveryKey?: (owner: unknown) => () => void
}

let moduleResumedAt: number | undefined

/**
 * Official 2.1.327 (#520) `noteResumed`: record a SIGCONT resume timestamp so
 * prompts ignore non-Escape answers for `SIGCONT_RESUME_GRACE_MS` ms after `fg`.
 */
export function noteResumed(now: number = Date.now()): void {
  moduleResumedAt = now
}

/** Return the most recent module-level SIGCONT resume timestamp (ms). */
export function getLastResumedAt(): number | undefined {
  return moduleResumedAt
}

/** Test helper — clear the SIGCONT resume grace timestamp. */
export function _resetSigcontResumeGraceForTesting(): void {
  moduleResumedAt = undefined
}

function isWithinResumeWindow(
  inputNow: () => number,
  stamp: number,
  graceMs: number,
): boolean {
  const delta = inputNow() - stamp
  if (delta >= 0) return delta < graceMs
  return stamp <= Date.now()
}

/**
 * Official 2.1.327 (#520) `KCs`: true while input arrived within `graceMs`
 * (default 150ms) of a SIGCONT resume (`fg`). Prompts should ignore answers
 * other than Escape while this returns true.
 */
export function isInSigcontResumeGrace(
  clock?: InputClock,
  graceMs: number = SIGCONT_RESUME_GRACE_MS,
): boolean {
  const inputNow = clock ?? (() => Date.now())
  const stamp = clock?.resumedAt?.() ?? moduleResumedAt
  return stamp !== undefined && isWithinResumeWindow(inputNow, stamp, graceMs)
}

/**
 * densable `SDn` — `jt(null)`. App.render `SDn.Provider` value=`this.inputClock`.
 * `ka()` = `ke(SDn)??Ho`; `Ho()` = `Date.now()`.
 */
const InputNowContext = createContext<InputClock | null>(null)

export default InputNowContext

/** densable `ka` — `ke(SDn)??Ho`. */
export function useInputNow(): InputClock {
  return useContext(InputNowContext) ?? (() => Date.now())
}

/**
 * Official 2.1.328 (#603) `DD`: opt the current interactive view into receiving
 * every keypress without rapid-input dropping.
 */
export function useWantEveryKey(enabled = true, owner: unknown = null): void {
  const clock = useInputNow()
  const register = clock.wantEveryKey
  useEffect(() => {
    if (!enabled || !register) return
    return register(owner)
  }, [enabled, register, owner])
}
