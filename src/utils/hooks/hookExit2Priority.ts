/**
 * densable 2.1.214 #40 — hooks exit 2 still blocks when stdout JSON schema fails.
 *
 * densable command-hook path:
 *   if (validationError && status !== 2) { non_blocking schema error; return }
 *   later: if (status === 2 && !blockingError) synthesize stderr blockingError
 *   yield outcome = blockingError ? "blocking" : "success"
 *
 * densable secondary path (file/watch hooks):
 *   if (validationError && status !== 2) throw
 *   blocked = status === 2 || decision === "block"
 */

export type HookExit2ValidationGate = {
  /** Whether to short-circuit as non-blocking schema failure */
  treatAsSchemaNonBlocking: boolean
  /** Whether exit code 2 should still produce blocking outcome */
  shouldBlockOnExit2: boolean
}

/**
 * Gate for command-hook JSON validation vs exit code 2.
 * Schema failure only short-circuits when status is not 2.
 */
export function resolveHookExit2ValidationGate(
  status: number | null | undefined,
  hasValidationError: boolean,
): HookExit2ValidationGate {
  const isExit2 = status === 2
  return {
    treatAsSchemaNonBlocking: Boolean(hasValidationError) && !isExit2,
    shouldBlockOnExit2: isExit2,
  }
}

/**
 * densable: after processing JSON, if exit 2 and no JSON blockingError yet,
 * synthesize stderr-based blockingError.
 */
export function ensureExit2BlockingError<T extends { blockingError?: unknown }>(
  status: number | null | undefined,
  processed: T,
  synthesize: () => NonNullable<T['blockingError']>,
): T {
  if (status === 2 && !processed.blockingError) {
    return { ...processed, blockingError: synthesize() }
  }
  return processed
}

/**
 * densable yield outcome when JSON path was taken:
 *   pe.blockingError ? "blocking" : "success"
 */
export function resolveJsonPathHookOutcome(
  hasBlockingError: boolean,
): 'blocking' | 'success' {
  return hasBlockingError ? 'blocking' : 'success'
}
