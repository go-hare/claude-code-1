/**
 * densable NHo gates `k0` / `tqn` / `hn` (E1t) / desktop_forward.
 */
import { isSdkDialogHostActive } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { ToolUseContext } from '../../Tool.js'
import { isEnvTruthy } from '../envUtils.js'
import { getAutoModeConfig } from '../settings/settings.js'

/** densable `E1t`. */
export const SERVER_HELD_CLASSIFIER_REASON =
  'Auto mode held this command for the server-side classifier to review'

/** densable `mHo` — env then GB `tengu_ticklish_whisper` default false. */
export function isTicklishWhisper(): boolean {
  if (process.env.CLAUDE_CODE_TICKLISH_WHISPER !== undefined) {
    return isEnvTruthy(process.env.CLAUDE_CODE_TICKLISH_WHISPER)
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_ticklish_whisper', false)
}

/**
 * densable `k0(D.requestDialog!==void 0)` @185568778:
 * `mHo() && requestDialog && !k2()`. k2 = sdkDialogHostActive.
 * When true, consecutive-denial reset on allow is skipped.
 */
export function shouldHoldConsecutiveDenials(context: ToolUseContext): boolean {
  return (
    isTicklishWhisper() &&
    context.requestDialog !== undefined &&
    !isSdkDialogHostActive()
  )
}

/**
 * densable `tqn` @178506521:
 * main-thread (no agentId, not remote) `hookCaller`.
 */
export function pluginOriginCaller(
  context: ToolUseContext,
): string | undefined {
  if (context.agentId !== undefined) return undefined
  if (context.forRemoteExecution === true) return undefined
  return context.hookCaller
}

/**
 * densable `prt` @185572003:
 * `Yv().soft_deny/hard_deny length>0`. `$defaults` still counts (not PHo).
 */
export function autoModeConfigHasDenyRules(
  config: { soft_deny?: string[]; hard_deny?: string[] } | undefined | null,
): boolean {
  return (
    (config?.soft_deny?.length ?? 0) > 0 || (config?.hard_deny?.length ?? 0) > 0
  )
}

/** densable `prt()` — `Yv()` is live `getAutoModeConfig()`. */
export function autoModeHasDenyRules(): boolean {
  return autoModeConfigHasDenyRules(getAutoModeConfig())
}

/** densable `hn` — ask reason is E1t server-held classifier. */
export function isServerHeldClassifierAsk(result: {
  decisionReason?: { type?: string; reason?: string }
}): boolean {
  return (
    result.decisionReason?.type === 'other' &&
    result.decisionReason.reason === SERVER_HELD_CLASSIFIER_REASON
  )
}

/**
 * densable `wt` keys with `classifierRouted:!0`.
 * `e3` does not walk `also` (Yn) — primary `circuitBreaker` only.
 */
const CLASSIFIER_ROUTED_BREAKERS = new Set([
  'dangerousRemoval',
  'backgroundOperator',
  'suspiciousWindowsPath',
])

type NestedDecisionReason = {
  type?: string
  circuitBreaker?: string
  reasons?: Map<string, { decisionReason?: NestedDecisionReason }>
}

function asNestedReason(reason: {
  type?: string
  circuitBreaker?: string
  reasons?: Map<string, { decisionReason?: unknown }>
}): NestedDecisionReason {
  return reason as NestedDecisionReason
}

/**
 * densable `e3` @175992918:
 * `e.circuitBreaker!==void 0 && wt[e.circuitBreaker]?.classifierRouted===!0`.
 */
export function isClassifierRoutedSafetyCheck(check: {
  circuitBreaker?: string
}): boolean {
  return (
    check.circuitBreaker !== undefined &&
    CLASSIFIER_ROUTED_BREAKERS.has(check.circuitBreaker)
  )
}

/**
 * densable `_p(e, n=()=>!0)` — walk safetyCheck / nested subcommandResults.
 * Do not import permissions.ts (cycle).
 */
function findSafetyCheck(
  reason: NestedDecisionReason | undefined,
  pred: (check: NestedDecisionReason) => boolean = () => true,
): boolean {
  if (!reason) return false
  if (reason.type === 'safetyCheck') return pred(reason)
  if (reason.type === 'subcommandResults' && reason.reasons) {
    for (const sub of reason.reasons.values()) {
      if (findSafetyCheck(sub.decisionReason, pred)) return true
    }
  }
  return false
}

/** densable `_p(reason)` — any safetyCheck. Desktop-forward skip. */
function hasAnySafetyCheck(reason: NestedDecisionReason | undefined): boolean {
  return findSafetyCheck(reason)
}

/**
 * densable `_p(reason, e3)` — classifier-routed circuitBreaker blocks
 * tqn plugin-origin skip.
 */
export function hasClassifierRoutedSafetyCheck(
  reason: NestedDecisionReason | undefined,
): boolean {
  return findSafetyCheck(reason, isClassifierRoutedSafetyCheck)
}

/**
 * densable NHo desktop_forward predicate (minus Qe producer).
 * Stamp must equal this toolUseID; no workingDir / blockedPath / RUI /
 * hookAskFloor / any safetyCheck (`_p`).
 */
export function isDesktopForwardSkipClassifier(
  context: ToolUseContext,
  toolUseID: string | undefined,
  result: {
    decisionReason?: {
      type?: string
      reasons?: Map<
        string,
        { decisionReason?: { type?: string; reasons?: unknown } }
      >
    }
    blockedPath?: string
    checkIncomplete?: boolean
  },
  tool: { requiresUserInteraction?: () => boolean },
): boolean {
  if (context.desktopForwardToolUseId === undefined) return false
  if (toolUseID === undefined) return false
  if (context.desktopForwardToolUseId !== toolUseID) return false
  if (result.checkIncomplete === true) return false
  if (tool.requiresUserInteraction?.() === true) return false
  if (context.hookAskFloor === true) return false
  if (result.decisionReason?.type === 'workingDir') return false
  if (result.blockedPath !== undefined) return false
  if (
    result.decisionReason !== undefined &&
    hasAnySafetyCheck(asNestedReason(result.decisionReason))
  ) {
    return false
  }
  return true
}
