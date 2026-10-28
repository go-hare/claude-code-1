/**
 * densable 2.1.289 `Lj` / `sie` / `$m` / `zse` / `JK` / `_L` / `zOe` /
 * `wPt` / `kPt` / `HOe` / `NOe` / `spo` / `f8o` / `Pnr`.
 *
 * Session latches match gold leftover `Oo` bag fields (module-level here, not
 * RequestLatches). NEVER `export function Lj`.
 */
import { feature } from 'bun:bundle'

import { leftoverTaintsInclude } from '../../cli/leftoverTulip.js'
import { DANGEROUS_TOOL_USE_BETA_HEADER } from '../../constants/betas.js'
import type { PermissionMode } from '../../types/permissions.js'
import {
  isStickyBetaRejected,
  isThirdPartyServerClassifierRefused,
} from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  classifyClassifierProviderKind,
  getAPIProvider,
  type APIProvider,
} from '../../utils/model/providers.js'
import { firstPartyNameToCanonical } from '../../utils/model/model.js'

const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/autoModeState.js') as typeof import('../../utils/permissions/autoModeState.js'))
  : null

export type AutoModeClassifierTransport =
  | 'arbiter'
  | 'arbiterWithLocalFallback'
  | 'off'

/** densable leftover `Oo.userServerClassifierSwitch` */
let userServerClassifierSwitch: boolean | null | undefined
/** densable leftover `Oo.thirdPartyServerClassifierEnabled` */
let thirdPartyServerClassifierEnabled: boolean | undefined
/** densable leftover `Oo.autoModeContextEnabled` */
let autoModeContextEnabled: boolean | undefined

export function resetAutoModeClassifierTransportForTests(): void {
  userServerClassifierSwitch = undefined
  thirdPartyServerClassifierEnabled = undefined
  autoModeContextEnabled = undefined
}

/**
 * densable `qi(mode, servedCall=false)` — inlined so this module does not
 * import `surfaces.ts` (cycle).
 */
function isClassifierDecidingMode(
  mode: PermissionMode,
  servedCall = false,
): boolean {
  return (
    mode === 'auto' ||
    (mode === 'plan' &&
      !servedCall &&
      (autoModeStateModule?.isAutoModeActive() ?? false))
  )
}

/** densable `h$` — anthropicAws || anthropicGoogleCloud only. */
export function isAnthropicAwsOrGoogleCloudProvider(
  provider: APIProvider = getAPIProvider(),
): boolean {
  return provider === 'anthropicAws' || provider === 'anthropicGoogleCloud'
}

/** densable `zse` — firstParty || h$ || foundry. */
export function isExperimentalBetasProvider(
  provider: APIProvider = getAPIProvider(),
): boolean {
  return (
    provider === 'firstParty' ||
    isAnthropicAwsOrGoogleCloudProvider(provider) ||
    provider === 'foundry'
  )
}

/**
 * densable `JK` — raw `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` truthiness
 * (including `"0"`) or leftover hipaa taint. Do not reuse `isEnvTruthy`.
 */
export function experimentalBetasDisabledRaw(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) || leftoverHipaa()
}

/** densable `_L` / `dl("hipaa")` */
function leftoverHipaa(): boolean {
  return leftoverTaintsInclude('hipaa')
}

/** densable `$m` — zse && !JK. Not `shouldIncludeFirstPartyOnlyBetas`. */
export function experimentalCapabilityBetasForClassifier(
  provider: APIProvider = getAPIProvider(),
): boolean {
  return (
    isExperimentalBetasProvider(provider) && !experimentalBetasDisabledRaw()
  )
}

/**
 * densable `sie` — switch on MV(), no default (openai/gemini/grok → falsy).
 */
export function serverClassifierBetasEligible(): boolean {
  switch (classifyClassifierProviderKind()) {
    case 'firstParty':
      return experimentalCapabilityBetasForClassifier()
    case 'thirdParty': {
      const provider = getAPIProvider()
      return provider === 'firstParty' ||
        isAnthropicAwsOrGoogleCloudProvider(provider)
        ? experimentalCapabilityBetasForClassifier(provider)
        : !leftoverHipaa()
    }
    default:
      return false
  }
}

/** densable `zOe` / `Le(CLAUDE_CODE_AUTO_MODE_SERVER)` — null if unset. */
export function readUserServerClassifierSwitch(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  if (userServerClassifierSwitch !== undefined) {
    return userServerClassifierSwitch
  }
  const raw = env.CLAUDE_CODE_AUTO_MODE_SERVER
  userServerClassifierSwitch = raw === undefined ? null : isEnvTruthy(raw)
  return userServerClassifierSwitch
}

/**
 * densable `wPt` — zOe() ?? !(DISABLE_EXPERIMENTAL_BETAS && !PROVIDER_MANAGED_BY_HOST).
 * Raw env, not isEnvTruthy.
 */
export function thirdPartyServerClassifierOn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (thirdPartyServerClassifierEnabled !== undefined) {
    return thirdPartyServerClassifierEnabled
  }
  const userSwitch = readUserServerClassifierSwitch(env)
  thirdPartyServerClassifierEnabled =
    userSwitch ??
    !(
      Boolean(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) &&
      !env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    )
  return thirdPartyServerClassifierEnabled
}

/** densable `spo` — empty. */
function spoAutoModeContextOverride(): boolean | undefined {
  return undefined
}

/** densable `kPt` — spo() ?? tengu_smooth_chipmunk default true. */
export function autoModeContextOn(): boolean {
  if (autoModeContextEnabled !== undefined) return autoModeContextEnabled
  autoModeContextEnabled =
    spoAutoModeContextOverride() ?? featureBool('tengu_smooth_chipmunk', true)
  return autoModeContextEnabled
}

/** densable `HOe` — tengu_iridescent_crystal default false. */
export function iridescentCrystalOff(): boolean {
  return featureBool('tengu_iridescent_crystal', false)
}

/** densable `NOe` — always false. */
export function serverClassifierKillswitch(): boolean {
  return false
}

function featureBool(name: string, fallback: boolean): boolean {
  const value = getFeatureValue_CACHED_MAY_BE_STALE(name, fallback)
  return typeof value === 'boolean' ? value : fallback
}

/**
 * densable `Lj(mode)` @188545187.
 */
export function resolveAutoModeClassifierTransport(
  mode: PermissionMode,
): AutoModeClassifierTransport {
  if (!isClassifierDecidingMode(mode) || !serverClassifierBetasEligible()) {
    return 'off'
  }
  if (classifyClassifierProviderKind() === 'thirdParty') {
    return thirdPartyServerClassifierOn() &&
      !isThirdPartyServerClassifierRefused() &&
      !serverClassifierKillswitch() &&
      !(getAPIProvider() === 'firstParty' && iridescentCrystalOff())
      ? 'arbiterWithLocalFallback'
      : 'off'
  }
  const userSwitch = readUserServerClassifierSwitch()
  if (userSwitch === false) return 'off'
  if (
    (userSwitch ?? autoModeContextOn()) &&
    !iridescentCrystalOff() &&
    !isThirdPartyServerClassifierRefused() &&
    !serverClassifierKillswitch()
  ) {
    return 'arbiter'
  }
  return 'off'
}

/** densable `lut` */
export function isServerClassifierTransport(
  transport: AutoModeClassifierTransport,
): boolean {
  return transport === 'arbiter' || transport === 'arbiterWithLocalFallback'
}

/**
 * densable `dcn(mode)` — lut(Lj(e)) && !Gp(si(), fA).
 */
export function isAutoModeServerEnabled(mode: PermissionMode): boolean {
  return (
    isServerClassifierTransport(resolveAutoModeClassifierTransport(mode)) &&
    !isStickyBetaRejected(DANGEROUS_TOOL_USE_BETA_HEADER)
  )
}

/** densable `PPt` — vf() && Lj("auto") !== "off". */
export function isServerClassifierActiveForAuto(): boolean {
  return (
    (autoModeStateModule?.isAutoModeActive() ?? false) &&
    resolveAutoModeClassifierTransport('auto') !== 'off'
  )
}

/** densable `za` — Lj(mode) !== "off". */
export function isServerClassifierTransportOn(mode: PermissionMode): boolean {
  return resolveAutoModeClassifierTransport(mode) !== 'off'
}

/**
 * densable `oc` @182067269 — canonical is an old model (bedrock/mantle Yl).
 */
export function isOldModelForBedrockMantleClassifier(
  canonical: string,
): boolean {
  if (canonical.startsWith('claude-3-')) return true
  return (
    canonical === 'claude-opus-4-0' ||
    canonical === 'claude-opus-4-1' ||
    canonical === 'claude-opus-4-5' ||
    canonical === 'claude-opus-4-6' ||
    canonical === 'claude-sonnet-4-0' ||
    canonical === 'claude-sonnet-4-5' ||
    canonical === 'claude-sonnet-4-6' ||
    canonical === 'claude-haiku-4-5'
  )
}

/**
 * densable `f8o(provider, model)` — !bedrock/mantle → true; else !oc(canonical).
 */
export function modelAllowsDangerousToolUseBeta(
  provider: APIProvider,
  model: string,
): boolean {
  if (provider !== 'bedrock' && provider !== 'mantle') return true
  return !isOldModelForBedrockMantleClassifier(firstPartyNameToCanonical(model))
}

/**
 * densable `Pnr` — zse → keep all; else filter to Av (1P-style headers that
 * 3P may still send). Av here is the dangerous-tool-use header only for this
 * land; other betas keep their own filters.
 */
const THIRD_PARTY_ALLOWED_CLASSIFIER_BETAS = new Set([
  DANGEROUS_TOOL_USE_BETA_HEADER,
])

export function filterBetasForClassifierProvider(
  betas: readonly string[],
  provider: APIProvider = getAPIProvider(),
): string[] {
  if (isExperimentalBetasProvider(provider)) return [...betas]
  return betas.filter(beta => THIRD_PARTY_ALLOWED_CLASSIFIER_BETAS.has(beta))
}
