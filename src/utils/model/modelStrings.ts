import {
  getModelStrings as getModelStringsState,
  setModelStrings as setModelStringsState,
} from 'src/bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { getAWSRegion } from '../envUtils.js'
import { logError } from '../log.js'
import { sequential } from '../sequential.js'
import { getInitialSettings } from '../settings/settings.js'
import {
  applyBedrockRegionPrefix,
  deriveBedrockRegionPrefixFromAwsRegion,
  findFirstMatch,
  formatBedrockRegionPrefixMismatchWarn,
  formatBedrockRegionPrefixNoDiscoveryWarn,
  getBedrockInferenceProfiles,
  getBedrockRegionPrefix,
  resolveBedrockRegionPrefix,
  type BedrockRegionPrefix,
} from './bedrock.js'
import {
  ALL_MODEL_CONFIGS,
  CANONICAL_ID_TO_KEY,
  type CanonicalModelId,
  type ModelKey,
} from './configs.js'
import { type APIProvider, getAPIProvider } from './providers.js'

/**
 * Maps each model version to its provider-specific model ID string.
 * Derived from ALL_MODEL_CONFIGS — adding a model there extends this type.
 */
export type ModelStrings = Record<ModelKey, string>

const MODEL_KEYS = Object.keys(ALL_MODEL_CONFIGS) as ModelKey[]

function getBuiltinModelStrings(provider: APIProvider): ModelStrings {
  const out = {} as ModelStrings
  for (const key of MODEL_KEYS) {
    out[key] = ALL_MODEL_CONFIGS[key][provider]
  }
  return out
}

/** densable Bpt — rewrite/add preferred cross-region prefix on a bedrock model id. */
function applyPreferredBedrockPrefix(
  modelId: string,
  preferred: BedrockRegionPrefix,
): string {
  return applyBedrockRegionPrefix(modelId, preferred)
}

/**
 * densable Xo_ / getBedrockModelStrings (2.1.224 #4):
 *   preferred = Qcr(AWS_REGION)  // env ANTHROPIC_BEDROCK_REGION_PREFIX ?? Upt
 *   derived   = Upt(AWS_REGION)
 *   discovery fail/empty → warn if preferred≠derived; builtins with preferred applied
 *   discovery ok → prefer profile under preferred prefix + needle; warn mismatches
 */
async function getBedrockModelStrings(): Promise<ModelStrings> {
  const awsRegion = getAWSRegion()
  const preferred = resolveBedrockRegionPrefix(awsRegion)
  const derived = deriveBedrockRegionPrefixFromAwsRegion(awsRegion)
  const builtin = getBuiltinModelStrings('bedrock')
  const fallback = {} as ModelStrings
  for (const key of MODEL_KEYS) {
    fallback[key] = applyPreferredBedrockPrefix(builtin[key], preferred)
  }

  const warnNoDiscovery = (): void => {
    if (preferred !== derived) {
      logForDebugging(
        formatBedrockRegionPrefixNoDiscoveryWarn(preferred, derived),
      )
    }
  }

  let profiles: string[] | undefined
  try {
    profiles = await getBedrockInferenceProfiles()
  } catch (error) {
    logError(error as Error)
    warnNoDiscovery()
    return fallback
  }
  if (!profiles?.length) {
    warnNoDiscovery()
    return fallback
  }

  // Prefer a profile under the preferred prefix that includes the first-party
  // needle; else any match; else hardcoded bedrock id with preferred applied.
  const out = {} as ModelStrings
  const mismatched: string[] = []
  for (const key of MODEL_KEYS) {
    const needle = ALL_MODEL_CONFIGS[key].firstParty
    const preferredHit = profiles.find(
      p => p.startsWith(`${preferred}.`) && p.includes(needle),
    )
    const anyHit = findFirstMatch(profiles, needle)
    const chosen = preferredHit || anyHit || fallback[key]
    out[key] = chosen
    if (preferred !== derived && getBedrockRegionPrefix(chosen) !== preferred) {
      mismatched.push(needle)
    }
  }
  if (mismatched.length > 0) {
    logForDebugging(
      formatBedrockRegionPrefixMismatchWarn(preferred, mismatched),
    )
  }
  return out
}

/**
 * Layer user-configured modelOverrides (from settings.json) on top of the
 * provider-derived model strings. Overrides are keyed by canonical first-party
 * model ID (e.g. "claude-opus-4-6") and map to arbitrary provider-specific
 * strings — typically Bedrock inference profile ARNs.
 */
function applyModelOverrides(ms: ModelStrings): ModelStrings {
  const overrides = getInitialSettings().modelOverrides
  if (!overrides) {
    return ms
  }
  const out = { ...ms }
  for (const [canonicalId, override] of Object.entries(overrides)) {
    const key = CANONICAL_ID_TO_KEY[canonicalId as CanonicalModelId]
    if (key && override) {
      out[key] = override
    }
  }
  return out
}

/**
 * Resolve an overridden model ID (e.g. a Bedrock ARN) back to its canonical
 * first-party model ID. If the input doesn't match any current override value,
 * it is returned unchanged. Safe to call during module init (no-ops if settings
 * aren't loaded yet).
 */
export function resolveOverriddenModel(modelId: string): string {
  let overrides: Record<string, string> | undefined
  try {
    overrides = getInitialSettings().modelOverrides
  } catch {
    return modelId
  }
  if (!overrides) {
    return modelId
  }
  for (const [canonicalId, override] of Object.entries(overrides)) {
    if (override === modelId) {
      return canonicalId
    }
  }
  return modelId
}

const updateBedrockModelStrings = sequential(async () => {
  if (getModelStringsState() !== null) {
    // Already initialized. Doing the check here, combined with
    // `sequential`, allows the test suite to reset the state
    // between tests while still preventing multiple API calls
    // in production.
    return
  }
  try {
    const ms = await getBedrockModelStrings()
    setModelStringsState(ms)
  } catch (error) {
    logError(error as Error)
  }
})

function initModelStrings(): void {
  const ms = getModelStringsState()
  if (ms !== null) {
    // Already initialized
    return
  }
  // Initial with default values for non-Bedrock providers
  if (getAPIProvider() !== 'bedrock') {
    setModelStringsState(getBuiltinModelStrings(getAPIProvider()))
    return
  }
  // On Bedrock, update model strings in the background without blocking.
  // Don't set the state in this case so that we can use `sequential` on
  // `updateBedrockModelStrings` and check for existing state on multiple
  // calls.
  void updateBedrockModelStrings()
}

export function getModelStrings(): ModelStrings {
  const ms = getModelStringsState()
  if (ms === null) {
    initModelStrings()
    // Bedrock path falls through here while the profile fetch runs in the
    // background — still honor overrides on the interim defaults.
    return applyModelOverrides(getBuiltinModelStrings(getAPIProvider()))
  }
  return applyModelOverrides(ms)
}

/**
 * Ensure model strings are fully initialized.
 * For Bedrock users, this waits for the profile fetch to complete.
 * Call this before generating model options to ensure correct region strings.
 */
export async function ensureModelStringsInitialized(): Promise<void> {
  const ms = getModelStringsState()
  if (ms !== null) {
    return
  }

  // For non-Bedrock, initialize synchronously
  if (getAPIProvider() !== 'bedrock') {
    setModelStringsState(getBuiltinModelStrings(getAPIProvider()))
    return
  }

  // For Bedrock, wait for the profile fetch
  await updateBedrockModelStrings()
}
