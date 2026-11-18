/**
 * Official 2.1.293 #324 (`L1o` / `i9n`): 3s stalled policy fetch hedge delay.
 */
export const STALLED_POLICY_FETCH_HEDGE_DELAY_MS = 3000

export type AbortableAttempt<T> = {
  attempt: Promise<T>
  abort: () => void
}

/** Official `i9n` — start an AbortController-backed attempt. */
export function startAbortableAttempt<T>(
  send: (signal: AbortSignal) => Promise<T>,
): AbortableAttempt<T> {
  const controller = new AbortController()
  return {
    attempt: send(controller.signal),
    abort: () => controller.abort(),
  }
}

/**
 * Official `L1o` (2.1.293 #324) — race a stalled first attempt against a
 * hedged second attempt launched after `delayMs` (default 3000ms).
 */
export function hedgeStalledRequest<T>(opts: {
  first: AbortableAttempt<T>
  send: (signal: AbortSignal) => Promise<T>
  isAnswer: (value: T, otherInFlight: boolean) => boolean
  delayMs?: number
  stillWanted?: () => boolean
  retryFollows?: boolean
}): Promise<{ result: T; hedged: boolean }> {
  const {
    first,
    send,
    isAnswer,
    delayMs = STALLED_POLICY_FETCH_HEDGE_DELAY_MS,
    stillWanted = () => true,
    retryFollows = true,
  } = opts
  return new Promise((resolve, reject) => {
    let settled = false
    let hedgedAttempt: AbortableAttempt<T> | undefined
    let inFlight = 1
    let heldAnswer: { value: T } | undefined
    let heldFailure: { ok: true; value: T } | undefined

    const finish = (
      outcome: { ok: true; value: T } | { ok: false; error: unknown },
    ) => {
      settled = true
      clearTimeout(timer)
      first.abort()
      hedgedAttempt?.abort()
      if (outcome.ok) {
        resolve({ result: outcome.value, hedged: hedgedAttempt !== undefined })
      } else {
        reject(outcome.error)
      }
    }

    const onOutcome = (
      outcome: { ok: true; value: T } | { ok: false; error: unknown },
    ) => {
      if (settled) return
      inFlight--
      const otherInFlight = inFlight > 0
      if (outcome.ok && isAnswer(outcome.value, otherInFlight)) {
        finish(
          heldFailure && !isAnswer(outcome.value, true) ? heldFailure : outcome,
        )
        return
      }
      if (otherInFlight) {
        if (outcome.ok && isAnswer(outcome.value, false)) {
          heldAnswer ??= { value: outcome.value }
        } else if (outcome.ok && retryFollows) {
          heldFailure ??= outcome
        }
        return
      }
      finish(
        heldAnswer && !(outcome.ok && retryFollows)
          ? { ok: true, value: heldAnswer.value }
          : outcome,
      )
    }

    const track = (p: Promise<T>) => {
      p.then(
        value => onOutcome({ ok: true, value }),
        error => onOutcome({ ok: false, error }),
      )
    }

    const timer = setTimeout(() => {
      if (settled || !stillWanted()) return
      inFlight++
      hedgedAttempt = startAbortableAttempt(send)
      track(hedgedAttempt.attempt)
    }, delayMs)
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref()
    }

    track(first.attempt)
  })
}
