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
import {
  getFeatureFlagsDisabledEnvVar,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../analytics/growthbook.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getFrozenStartupEnv } from '../../utils/managedEnv.js'
import {
  classifyClassifierProviderKind,
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
  type APIProvider,
} from '../../utils/model/providers.js'
import { firstPartyNameToCanonical } from '../../utils/model/model.js'
import { isTelemetryDisabled } from '../../utils/privacyLevel.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'

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
 * Official 2.1.319 `rGn()`: first-party provider routed through a non-Anthropic
 * base URL (e.g. an LLM gateway).
 */
export function isFirstPartyBehindLlmGateway(): boolean {
  return getAPIProvider() === 'firstParty' && !isFirstPartyAnthropicBaseUrl()
}

/**
 * Official 2.1.319 `Gse(key)`: read env var from managed/policy settings tier.
 */
function getManagedPolicyEnvVar(key: string): string | undefined {
  return getSettingsForSource('policySettings')?.env?.[key]
}

/**
 * Official 2.1.319 `F2(() => process.env.CLAUDE_CODE_AUTO_MODE_SERVER)` (#1806):
 * evaluate `CLAUDE_CODE_AUTO_MODE_SERVER` outside project/local/plugin settings
 * so a project's settings file or plugin cannot switch the server-side check
 * back on once turned off externally (or turn it on behind a gateway alone).
 */
export function readExternalAutoModeServerRaw(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const policyVal =
    getSettingsForSource('policySettings')?.env?.CLAUDE_CODE_AUTO_MODE_SERVER
  if (policyVal !== undefined) return policyVal

  const flagVal =
    getSettingsForSource('flagSettings')?.env?.CLAUDE_CODE_AUTO_MODE_SERVER
  if (flagVal !== undefined) return flagVal

  const userVal =
    getSettingsForSource('userSettings')?.env?.CLAUDE_CODE_AUTO_MODE_SERVER
  if (userVal !== undefined) return userVal

  if (env === process.env) {
    const startupVal = getFrozenStartupEnv().CLAUDE_CODE_AUTO_MODE_SERVER
    if (startupVal !== undefined) return startupVal
  }

  const projectVal =
    getSettingsForSource('projectSettings')?.env?.CLAUDE_CODE_AUTO_MODE_SERVER
  const localVal =
    getSettingsForSource('localSettings')?.env?.CLAUDE_CODE_AUTO_MODE_SERVER
  if (projectVal !== undefined || localVal !== undefined) {
    return undefined
  }
  return env.CLAUDE_CODE_AUTO_MODE_SERVER
}

/**
 * Official 2.1.319 `uwt` (`sie`) — switch on MV(), no default (openai/gemini/grok → falsy).
 * - #1700: behind an LLM gateway (`rGn()`), `CLAUDE_CODE_AUTO_MODE_SERVER=1` turns on
 *   the server-side check even with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` set; if
 *   managed settings set `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, managed settings
 *   must also set `CLAUDE_CODE_AUTO_MODE_SERVER=1`.
 * - #1777: when server-managed settings cannot be fetched (`remoteSettingsFailed`),
 *   `CLAUDE_CODE_AUTO_MODE_SERVER=1` in local managed settings is still honored.
 * - #1806: `CLAUDE_CODE_AUTO_MODE_SERVER` must be truthy outside project/local settings.
 */
export function serverClassifierBetasEligible(opts?: {
  remoteSettingsEligible?: boolean
  remoteSettingsUnavailable?: boolean
}): boolean {
  switch (classifyClassifierProviderKind()) {
    case 'firstParty':
      return experimentalCapabilityBetasForClassifier()
    case 'thirdParty': {
      const provider = getAPIProvider()
      const externalRaw = readExternalAutoModeServerRaw()
      const managedBetasOff = isEnvTruthy(
        getManagedPolicyEnvVar('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'),
      )
      const managedServerOn = isEnvTruthy(
        getManagedPolicyEnvVar('CLAUDE_CODE_AUTO_MODE_SERVER'),
      )
      const remoteGateOk =
        !opts?.remoteSettingsEligible ||
        (opts.remoteSettingsUnavailable === true && managedServerOn)
      if (
        isFirstPartyBehindLlmGateway() &&
        readUserServerClassifierSwitch() === true &&
        isEnvTruthy(externalRaw) &&
        (!managedBetasOff || managedServerOn) &&
        remoteGateOk &&
        !leftoverHipaa()
      ) {
        return true
      }
      return provider === 'firstParty' ||
        isAnthropicAwsOrGoogleCloudProvider(provider)
        ? experimentalCapabilityBetasForClassifier(provider)
        : !leftoverHipaa()
    }
    default:
      return false
  }
}

function readRawUserServerClassifierSwitch(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const evalCurrent = (): boolean | null => {
    const raw = env.CLAUDE_CODE_AUTO_MODE_SERVER
    return raw === undefined ? null : isEnvTruthy(raw)
  }
  const externalRaw = readExternalAutoModeServerRaw(env)
  if (externalRaw !== undefined && !isEnvTruthy(externalRaw)) {
    return false
  }
  return evalCurrent()
}

/**
 * Official 2.1.319 `F$e` / `nt` (#1806) — cached read of `CLAUDE_CODE_AUTO_MODE_SERVER`.
 * Once switched off outside project/plugin settings, project/plugin settings cannot
 * switch it back on.
 */
export function readUserServerClassifierSwitch(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  if (userServerClassifierSwitch !== undefined) {
    return userServerClassifierSwitch
  }
  userServerClassifierSwitch = readRawUserServerClassifierSwitch(env)
  return userServerClassifierSwitch
}

/** Official 2.1.319 `NHr`: peek without latching if unset. */
export function peekUserServerClassifierSwitch(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  return userServerClassifierSwitch === undefined
    ? readRawUserServerClassifierSwitch(env)
    : userServerClassifierSwitch
}

/**
 * Official 2.1.319 `crt({ handoffReview, outsideAutoMode })` (#1699):
 * When telemetry or feature flags are disabled (including behind LLM gateways on
 * `firstParty`), calls the server cannot check do NOT fall back to the built-in
 * local classifier — they are asked about or denied instead.
 * Set `CLAUDE_CODE_AUTO_MODE_SERVER=0` to keep using the built-in classifier.
 * Bedrock, Vertex, and Foundry are unchanged (`getAPIProvider() !== 'firstParty'`).
 */
export function isLocalAutoModeClassifierSwitchedOff(
  opts: { handoffReview?: boolean; outsideAutoMode?: boolean } = {},
): boolean {
  const { handoffReview = false, outsideAutoMode = false } = opts
  if (isEnvTruthy(process.env.CLAUDE_CODE_USER_DELEGATED_SESSION_DIRECT_API)) {
    return false
  }
  if (getAPIProvider() !== 'firstParty') {
    return false
  }
  const flagRaw: string = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_bright_dragonfly',
    'off',
  )
  type BrightDragonflyMode =
    | 'off'
    | 'direct'
    | 'all'
    | 'direct_and_handoffs'
    | 'all_and_handoffs'
  const flag: BrightDragonflyMode =
    flagRaw === 'direct' ||
    flagRaw === 'all' ||
    flagRaw === 'direct_and_handoffs' ||
    flagRaw === 'all_and_handoffs'
      ? flagRaw
      : 'off'

  const noTelemetryOrFfOff =
    flag === 'off' &&
    !isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
    (isTelemetryDisabled() || getFeatureFlagsDisabledEnvVar() !== null) &&
    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL === undefined &&
    !isEnvTruthy(process.env.CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF) &&
    !isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)

  const effective: BrightDragonflyMode = noTelemetryOrFfOff ? 'all' : flag
  if (
    effective === 'off' ||
    ((handoffReview || outsideAutoMode) &&
      (effective === 'direct' || effective === 'all'))
  ) {
    return false
  }
  if (leftoverHipaa() || experimentalBetasDisabledRaw()) {
    return false
  }
  const userSwitch = peekUserServerClassifierSwitch()
  if (
    iridescentCrystalOff() ||
    (userSwitch === null &&
      isFirstPartyAnthropicBaseUrl() &&
      !autoModeContextOn())
  ) {
    return false
  }
  if (noTelemetryOrFfOff && userSwitch === false) {
    return false
  }
  return (
    effective === 'all' ||
    effective === 'all_and_handoffs' ||
    isFirstPartyAnthropicBaseUrl()
  )
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
