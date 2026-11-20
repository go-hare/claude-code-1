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
 * Official 2.1.326 `Mot` circuit-breaker policy table (#311 / #312).
 *
 * `waivableInBypass: false` means bypassPermissions mode MUST NOT waive the
 * safety check (unlike `dangerousRemoval` which can be waived in some bypass
 * flows unless blocked by host-card / splendid horizon).
 */
export type CircuitBreakerName =
  | 'dangerousRemoval'
  | 'backgroundOperator'
  | 'suspiciousWindowsPath'
  | 'isolatePeerMachines'
  | 'restrictedMode'
  | 'outsideReadsBlocked'
  | 'claudeSettingsFile'
  | 'internalHardDeny'
  | 'connectorFileSend'
  | 'unfinishedCheck'

export type CircuitBreakerPolicy = {
  readonly bypassImmune: boolean
  readonly waivableInBypass: boolean
  readonly classifierRouted: boolean
  readonly autoModeDeny: boolean
  readonly hostPersonOnly: boolean
  readonly localProjectionOnly: boolean
  readonly servedUnplaceable: boolean
}

export const CIRCUIT_BREAKER_POLICY: Readonly<
  Record<CircuitBreakerName, CircuitBreakerPolicy>
> = Object.freeze({
  dangerousRemoval: Object.freeze({
    bypassImmune: true,
    waivableInBypass: true,
    classifierRouted: true,
    autoModeDeny: true,
    hostPersonOnly: false,
    localProjectionOnly: false,
    servedUnplaceable: false,
  }),
  backgroundOperator: Object.freeze({
    bypassImmune: false,
    waivableInBypass: false,
    classifierRouted: true,
    autoModeDeny: false,
    hostPersonOnly: false,
    localProjectionOnly: false,
    servedUnplaceable: false,
  }),
  suspiciousWindowsPath: Object.freeze({
    bypassImmune: false,
    waivableInBypass: false,
    classifierRouted: true,
    autoModeDeny: false,
    hostPersonOnly: false,
    localProjectionOnly: false,
    servedUnplaceable: false,
  }),
  isolatePeerMachines: Object.freeze({
    bypassImmune: true,
    waivableInBypass: false,
    classifierRouted: false,
    autoModeDeny: false,
    hostPersonOnly: false,
    localProjectionOnly: false,
    servedUnplaceable: false,
  }),
  restrictedMode: Object.freeze({
    bypassImmune: true,
    waivableInBypass: false,
    classifierRouted: false,
    autoModeDeny: false,
    hostPersonOnly: false,
    localProjectionOnly: false,
    servedUnplaceable: false,
  }),
  outsideReadsBlocked: Object.freeze({
    bypassImmune: true,
    waivableInBypass: false,
    classifierRouted: false,
    autoModeDeny: false,
    hostPersonOnly: false,
    localProjectionOnly: false,
    servedUnplaceable: false,
  }),
  claudeSettingsFile: Object.freeze({
    bypassImmune: false,
    waivableInBypass: false,
    classifierRouted: false,
    autoModeDeny: false,
    hostPersonOnly: true,
    localProjectionOnly: false,
    servedUnplaceable: false,
  }),
  internalHardDeny: Object.freeze({
    bypassImmune: false,
    waivableInBypass: false,
    classifierRouted: false,
    autoModeDeny: false,
    hostPersonOnly: false,
    localProjectionOnly: false,
    servedUnplaceable: true,
  }),
  connectorFileSend: Object.freeze({
    bypassImmune: true,
    waivableInBypass: false,
    classifierRouted: false,
    autoModeDeny: false,
    hostPersonOnly: false,
    localProjectionOnly: false,
    servedUnplaceable: false,
  }),
  unfinishedCheck: Object.freeze({
    bypassImmune: true,
    waivableInBypass: false,
    classifierRouted: false,
    autoModeDeny: false,
    hostPersonOnly: true,
    localProjectionOnly: false,
    servedUnplaceable: false,
  }),
})

function lookupCircuitBreakerPolicy(
  name: string | undefined,
): CircuitBreakerPolicy | undefined {
  if (name === undefined) return undefined
  if (!Object.hasOwn(CIRCUIT_BREAKER_POLICY, name)) return undefined
  return CIRCUIT_BREAKER_POLICY[name as CircuitBreakerName]
}

function listCircuitBreakers(check: {
  circuitBreaker?: string
  also?: readonly string[]
}): string[] {
  return [
    ...(check.circuitBreaker !== undefined ? [check.circuitBreaker] : []),
    ...(check.also ?? []),
  ]
}

/** Official `Zz(e)`: any breaker on this check (or `also`) is bypassImmune. */
export function isBypassImmuneSafetyCheck(check: {
  circuitBreaker?: string
  also?: readonly string[]
}): boolean {
  return listCircuitBreakers(check).some(
    name => lookupCircuitBreakerPolicy(name)?.bypassImmune === true,
  )
}

/**
 * Official `Xgo(e)` (#311): bypassImmune AND NOT waivableInBypass.
 * Must ask (or deny when non-interactive) even in `bypassPermissions` mode.
 */
export function isUnwaivableBypassImmuneSafetyCheck(check: {
  circuitBreaker?: string
  also?: readonly string[]
}): boolean {
  return listCircuitBreakers(check).some(name => {
    const policy = lookupCircuitBreakerPolicy(name)
    return policy?.bypassImmune === true && !policy.waivableInBypass
  })
}

/** Official `e6(e)`: hostPersonOnly breaker (claudeSettingsFile / unfinishedCheck). */
export function isHostPersonOnlySafetyCheck(check: {
  circuitBreaker?: string
  also?: readonly string[]
}): boolean {
  return listCircuitBreakers(check).some(
    name => lookupCircuitBreakerPolicy(name)?.hostPersonOnly === true,
  )
}

type NestedDecisionReason = {
  type?: string
  reason?: string
  circuitBreaker?: string
  also?: readonly string[]
  standsForDenyRules?: boolean
  replaces?: unknown
  rule?: { ruleBehavior?: string }
  reasons?: Map<
    string,
    { behavior?: string; decisionReason?: NestedDecisionReason }
  >
}

function asNestedReason(reason: {
  type?: string
  reason?: string
  circuitBreaker?: string
  also?: readonly string[]
  standsForDenyRules?: boolean
  replaces?: unknown
  rule?: { ruleBehavior?: string }
  reasons?: Map<string, { behavior?: string; decisionReason?: unknown }>
}): NestedDecisionReason {
  return reason as NestedDecisionReason
}

/**
 * densable `e3` / `p2` @283889643:
 * `e.circuitBreaker!==void 0 && Mot[e.circuitBreaker]?.classifierRouted===!0`.
 * Does not walk `also` — primary `circuitBreaker` only.
 */
export function isClassifierRoutedSafetyCheck(check: {
  circuitBreaker?: string
}): boolean {
  return (
    lookupCircuitBreakerPolicy(check.circuitBreaker)?.classifierRouted === true
  )
}

/**
 * Official 2.1.328 `DNi` (@283889913):
 * `(e.also ?? []).some(o => { const s = Mot[o]; return s?.bypassImmune === true && !s.classifierRouted })`.
 * Prevents a classifier-routed primary circuitBreaker from bypassing a
 * bypass-immune non-classifier secondary breaker listed in `also`.
 */
export function hasBypassImmuneNonClassifierAlsoBreaker(check: {
  also?: readonly string[]
}): boolean {
  return (check.also ?? []).some(breaker => {
    const policy = lookupCircuitBreakerPolicy(breaker)
    return policy?.bypassImmune === true && !policy.classifierRouted
  })
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

/** Official `ha(reason, Zz) !== undefined` (#311). */
export function hasBypassImmuneSafetyCheck(
  reason: NestedDecisionReason | undefined,
): boolean {
  return findSafetyCheck(reason, isBypassImmuneSafetyCheck)
}

/** Official `ha(reason, Xgo) !== undefined` (#311). */
export function hasUnwaivableBypassImmuneSafetyCheck(
  reason: NestedDecisionReason | undefined,
): boolean {
  return findSafetyCheck(reason, isUnwaivableBypassImmuneSafetyCheck)
}

/** Official `ha(reason, e6) !== undefined` (#311 / #312): host-person-only ask. */
export function hasHostPersonOnlySafetyCheck(
  reason: NestedDecisionReason | undefined,
): boolean {
  return findSafetyCheck(reason, isHostPersonOnlySafetyCheck)
}

/**
 * Official 2.1.326 `vzr(reason)` (#312 / #318):
 * True when a deny decision is a deny rule OR stands in for deny rules
 * (`standsForDenyRules: true`, e.g. unparseable/too-long command when deny rules
 * exist or null byte in PowerShell path).
 */
export function isStandsForDenyRules(
  reason: NestedDecisionReason | undefined,
): boolean {
  if (!reason) return false
  if (reason.type === 'other') return reason.standsForDenyRules === true
  if (reason.type === 'rule') return reason.rule?.ruleBehavior === 'deny'
  if (reason.type === 'subcommandResults' && reason.reasons) {
    for (const sub of reason.reasons.values()) {
      if (sub.behavior === 'deny' && isStandsForDenyRules(sub.decisionReason)) {
        return true
      }
    }
  }
  return false
}

/** Official `Jgo` — cloud auto-mode held reason (excluded from Vdt suffix). */
export const CLOUD_AUTO_MODE_HELD_REASON =
  'Auto mode reviews this action before it runs in the cloud environment'

/** Official `nUo` (#253): breakers whose reason is already the message itself. */
function isSelfDescribedCircuitBreaker(check: {
  circuitBreaker?: string
  also?: readonly string[]
}): boolean {
  return listCircuitBreakers(check).some(
    b => b === 'outsideReadsBlocked' || b === 'unfinishedCheck',
  )
}

/**
 * Official 2.1.326 `Vdt(reason)` (#253):
 * Extract the human-readable cause from a decisionReason so non-interactive
 * runs and background agents name why approval was required or why a check failed.
 */
export function extractDecisionReasonCause(
  reason: NestedDecisionReason | undefined,
): string | undefined {
  if (!reason) return undefined
  switch (reason.type) {
    case 'rule':
    case 'mode':
    case 'subcommandResults':
    case 'permissionPromptTool':
      return undefined
    case 'safetyCheck':
      return isSelfDescribedCircuitBreaker(reason) ? undefined : reason.reason
    case 'classifier':
    case 'hook':
    case 'asyncAgent':
    case 'workingDir':
      return reason.reason
    case 'sandboxOverride':
      return reason.replaces === undefined ? reason.reason : undefined
    case 'other':
      return reason.reason === SERVER_HELD_CLASSIFIER_REASON ||
        reason.reason === CLOUD_AUTO_MODE_HELD_REASON
        ? undefined
        : reason.reason
    default:
      return undefined
  }
}

export const NO_APPROVAL_SURFACE_PREFIX =
  'Permission for this tool use was denied. It requires approval, and this session has no approval surface'

/**
 * Official 2.1.326 `Kdt` + `idr` (#253):
 * Combine an ask decision's message with `Vdt(decisionReason)` (when not already
 * included) so non-interactive runs and background agents name the exact cause.
 */
export function formatNonInteractiveAskCauseMessage(ask: {
  message: string
  decisionReason?: NestedDecisionReason
}): string {
  const cause = extractDecisionReasonCause(ask.decisionReason)
  const detail =
    cause !== undefined && !ask.message.includes(cause)
      ? `${ask.message} ${cause}`
      : ask.message
  return `${NO_APPROVAL_SURFACE_PREFIX} — nobody can answer a permission prompt here — so it was denied automatically. The action was NOT performed; do not claim it succeeded, and do not retry it: this action, and anything else that requires approval, will be denied the same way for the rest of this session. Tell the user what was blocked and why you needed it, then continue with the parts of the task that do not require approval. What required approval: ${detail}`
}

/**
 * Official 2.1.326 `bts` / `Ets` / `LIn` (#311 / #312):
 * Build an `unfinishedCheck` safetyCheck ask that is bypass-immune (`waivableInBypass: false`),
 * non-classifier-approvable, suppresses always-allow rules, and marks `checkIncomplete: true`.
 */
export const UNFINISHED_CHECK_DEFAULT_MESSAGE =
  'The permission check for this command did not finish, so its safety checks did not run.'

export function buildUnfinishedCheckAsk(
  reasonOrOpts:
    | string
    | {
        message: string
        reason: string
        blockReadsOutsideWorkingDirectories?: boolean
      } = UNFINISHED_CHECK_DEFAULT_MESSAGE,
  opts?: { blockReadsOutsideWorkingDirectories?: boolean },
): {
  behavior: 'ask'
  message: string
  decisionReason: {
    type: 'safetyCheck'
    reason: string
    classifierApprovable: false
    circuitBreaker: 'outsideReadsBlocked' | 'unfinishedCheck'
    also?: ['unfinishedCheck']
  }
  suggestions: []
  suppressAlwaysAllowRule: true
  checkIncomplete: true
} {
  const message =
    typeof reasonOrOpts === 'string' ? reasonOrOpts : reasonOrOpts.message
  const reason =
    typeof reasonOrOpts === 'string' ? reasonOrOpts : reasonOrOpts.reason
  const outsideBlocked =
    (typeof reasonOrOpts === 'string'
      ? opts?.blockReadsOutsideWorkingDirectories
      : reasonOrOpts.blockReadsOutsideWorkingDirectories) === true
  return {
    behavior: 'ask',
    message,
    decisionReason: {
      type: 'safetyCheck',
      reason,
      classifierApprovable: false,
      circuitBreaker: outsideBlocked
        ? 'outsideReadsBlocked'
        : 'unfinishedCheck',
      ...(outsideBlocked
        ? { also: ['unfinishedCheck'] as ['unfinishedCheck'] }
        : {}),
    },
    suggestions: [],
    suppressAlwaysAllowRule: true,
    checkIncomplete: true,
  }
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
