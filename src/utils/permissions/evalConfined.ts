import { isEnvTruthy } from '../envUtils.js'
import { logForDebugging } from '../debug.js'

/** densable `Qlt` — plugin-eval child. */
export function isEvalConfined(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_EVAL_CONFINED)
}

/**
 * densable `QLn` @185141233 — confined sessions take grants only from argv.
 * Mutates in place like gold (void allow, keep deny/ask/defer).
 */
export function stripEvalConfinedHookAllow<
  T extends {
    permissionBehavior?: unknown
    permissionRequestResult?: { behavior?: unknown } | null
  },
>(result: T, source: string): T {
  if (!isEvalConfined()) return result
  if (result.permissionBehavior === 'allow') {
    logForDebugging(
      `${source} permissionDecision=allow ignored: a confined session takes grants only from its command line`,
    )
    result.permissionBehavior = undefined
  }
  if (result.permissionRequestResult?.behavior === 'allow') {
    logForDebugging(
      `${source} PermissionRequest allow ignored: a confined session takes grants only from its command line`,
    )
    result.permissionRequestResult = undefined
  }
  return result
}
