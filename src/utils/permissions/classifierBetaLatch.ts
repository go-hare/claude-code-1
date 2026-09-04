/**
 * densable 2.1.243 #14 — official `bzr` / `p$s` / `f$s`.
 *
 * `Pzr` / `VO` = H("auto_mode_classifier","auto-mode-classifier-2026-07-16").
 * `ASe` / `$O` is `null` in 2.1.243 — `p$s` always returns null (latch dead).
 * `bzr` still attaches `Pzr` when provider is firstParty and `hh()&&td()`.
 */
import { APIError } from '@anthropic-ai/sdk'
import { AUTO_MODE_CLASSIFIER_BETA_HEADER } from '../../constants/betas.js'
import { logEvent } from '../../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/metadata.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { isHipaaPolicy } from '../midConversationSystem.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
  type APIProvider,
} from '../model/providers.js'
import type { SideQueryOptions } from '../sideQuery.js'

/** Official `$O` / `ASe` — null in 2.1.243; latch never matches. */
const AUTO_MODE_CLASSIFIER_LATCH_BETA: string | null = null

let controlMonitorsBetaRejected = false

export function clearClassifierBetaLatchForTests(): void {
  controlMonitorsBetaRejected = false
}

export function isControlMonitorsBetaRejectedForTests(): boolean {
  return controlMonitorsBetaRejected
}

/**
 * Official `hh` = `Qa()&&!Li()`. `Qa` is firstParty|anthropicAws|foundry;
 * `bzr` already requires `e==="firstParty"`, so this is `!Li()&&td()`.
 * `Li` = DISABLE_EXPERIMENTAL_BETAS || hipaa. `td` = 1P Anthropic base URL.
 */
function hhAndTd(): boolean {
  return (
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) &&
    !isHipaaPolicy() &&
    isFirstPartyAnthropicBaseUrl()
  )
}

/** Official `bzr(e)` — `e` is `Jd(classifierModel)` (session provider). */
export function autoModeClassifierExtraBetas(
  provider: APIProvider = getAPIProvider(),
): string[] {
  if (provider !== 'firstParty') return []
  if (!hhAndTd()) return []
  return [AUTO_MODE_CLASSIFIER_BETA_HEADER]
}

/**
 * Official `Wzr` last arm — too-long classifier errors skip the latch retry.
 */
function isClassifierTooLongError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.message
    .toLowerCase()
    .includes('input is too long for requested model')
}

/**
 * Official `p$s(e,t)`. 243 `ASe===null` → always null.
 */
export function dropRejectedAutoModeClassifierBeta(
  err: unknown,
  opts: SideQueryOptions,
): SideQueryOptions | null {
  if (
    AUTO_MODE_CLASSIFIER_LATCH_BETA === null ||
    !opts.extraBetas?.includes(AUTO_MODE_CLASSIFIER_LATCH_BETA) ||
    !(err instanceof APIError) ||
    err.status !== 400 ||
    isClassifierTooLongError(err)
  ) {
    return null
  }
  return {
    ...opts,
    extraBetas: opts.extraBetas.filter(
      beta => beta !== AUTO_MODE_CLASSIFIER_LATCH_BETA,
    ),
  }
}

export type ClassifierBetaLatchContext = {
  classifierModel: string
  classifierStage: string
}

/**
 * Official `f$s(e,t)` — session-sticky drop after a successful retry.
 */
export function latchAutoModeClassifierBetaRejected(
  err: unknown,
  context: ClassifierBetaLatchContext,
): void {
  if (controlMonitorsBetaRejected) return
  controlMonitorsBetaRejected = true
  const name = AUTO_MODE_CLASSIFIER_LATCH_BETA ?? 'auto_mode_classifier'
  logForDebugging(
    `Auto mode classifier: ${name} beta rejected (HTTP 400) and the retry without it succeeded \u2014 dropping the beta for the rest of the session`,
    { level: 'warn' },
  )
  const noRetry =
    err instanceof APIError && err.headers?.get('x-should-retry') === 'false'
  logEvent('tengu_auto_mode_beta_latch', {
    classifierModel:
      context.classifierModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    classifierStage:
      context.classifierStage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    errorKind: (noRetry
      ? 'http_400_no_retry'
      : 'http_400') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}
