/**
 * Official 2.1.239 /model Fable row.
 *
 *   URa  — builtin Fable 5 option (slogan + Pyp credits suffix, no $10/$50)
 *   wyp  — ANTHROPIC_DEFAULT_FABLE_MODEL custom row (Rci-gated)
 *   W4r  — insert after Default, skipping the adjacent family cluster
 *   G4r  — fable / fable[1m] / fht includes("claude-fable-5")
 *   Iyp  — z4r fable-same-row
 *   kci  — picker family
 *   Rci  — !R_() || BZ() || !Vm()
 *   A1e("fable5") — catalog id on current provider, else modelOverrides
 *   Hyp  — Fable slogan
 *
 * C0v gates (do not invent extra rows):
 *   subscriber (ls) — no hardcoded URa
 *   R_() PAYG (firstParty / anthropicAws / gateway) — wyp, else URa only if BZ
 *   true 3P — wyp ?? URa when wyp or A1e
 *
 * Not invented: H0v "Fable (disabled)", $Ra inject, OPENAI_DEFAULT_FABLE_MODEL,
 * Nyp allowlist remap inside W4r (s stays null).
 */

import { isModelAlias } from './aliases.js'
import { ALL_MODEL_CONFIGS } from './configs.js'
import { getFableCreditsSuffix } from './fableCreditsLabel.js'
import { getDefaultMainLoopModelSetting } from './model.js'
import { isModelAllowed } from './modelAllowlist.js'
import { getModelStrings } from './modelStrings.js'
import {
  type APIProvider,
  getAPIProvider,
  isAnthropicStyleApiProvider,
  isFirstPartyAnthropicBaseUrl,
} from './providers.js'
import {
  getInitialSettings,
  getSettings_DEPRECATED,
} from '../settings/settings.js'

/** Official Hyp. */
export const FABLE_SLOGAN =
  'Most capable for your hardest and longest-running tasks'

/** Official URa descriptionForModel. */
export const FABLE_DESCRIPTION_FOR_MODEL =
  'Fable 5 - most capable for your hardest and longest-running tasks'

/** Minimal option shape — avoid a cycle with modelOptions.ts. */
export type FablePickerOption = {
  value: string | null
  label: string
  description: string
  descriptionForModel?: string
}

export type InsertFablePickerDeps = {
  defaultModelSetting?: string | null
  unrestrictedList?: boolean
  isAllowed?: (value: string) => boolean
}

/**
 * Official Iyp — fable aliases or a claude-fable-5 model id.
 */
export function isFablePickerRowValue(value: string): boolean {
  if (value === 'fable' || value === 'fable[1m]') {
    return true
  }
  return /(?:^|[./])claude-fable-5(?:[-@]\d{8})?(?:-v\d+(?::\d+)?)?(?:\[[12]m\])?$/i.test(
    value,
  )
}

/** Official G4r — aliases or fht (`includes("claude-fable-5")`). */
export function isFablePickerInsertValue(value: string): boolean {
  return (
    value === 'fable' ||
    value === 'fable[1m]' ||
    value.includes('claude-fable-5')
  )
}

/**
 * Official z4r value-equal + Iyp arm. Non-fable rows stay exact-value.
 */
export function isSameFablePickerRow(
  left: { value: string | null },
  right: { value: string | null },
): boolean {
  if (left.value === right.value) {
    return true
  }
  if (typeof left.value !== 'string' || typeof right.value !== 'string') {
    return false
  }
  return isFablePickerRowValue(left.value) && isFablePickerRowValue(right.value)
}

/** Official kci. */
export function pickerFamilyOf(
  value: string,
): 'fable' | 'opus' | 'sonnet' | 'haiku' | null {
  const t = value.toLowerCase()
  if (t.includes('fable')) {
    return 'fable'
  }
  if (t.includes('opus')) {
    return 'opus'
  }
  if (t.includes('sonnet')) {
    return 'sonnet'
  }
  if (t.includes('haiku')) {
    return 'haiku'
  }
  return null
}

/**
 * Official Rci — custom family-env rows (3P, anthropicAws, or non-1P base).
 * Local has no anthropicGoogleCloud; BZ is anthropicAws only.
 */
export function isCustomFamilyModelEnv(
  provider: APIProvider = getAPIProvider(),
): boolean {
  return (
    !isAnthropicStyleApiProvider(provider) ||
    provider === 'anthropicAws' ||
    !isFirstPartyAnthropicBaseUrl()
  )
}

/** Official BZ — local catalog has no anthropicGoogleCloud. */
export function isAnthropicAwsFamilyProvider(
  provider: APIProvider = getAPIProvider(),
): boolean {
  return provider === 'anthropicAws'
}

/** Official A1e("fable5"). */
export function isFable5AvailableOnProvider(
  provider: APIProvider = getAPIProvider(),
): boolean {
  const config = ALL_MODEL_CONFIGS.fable5
  if (config[provider] != null) {
    return true
  }
  try {
    return Boolean(getInitialSettings().modelOverrides?.[config.firstParty])
  } catch {
    return false
  }
}

function fable5IdFor(provider: APIProvider): string {
  if (provider === getAPIProvider()) {
    return getModelStrings().fable5
  }
  return ALL_MODEL_CONFIGS.fable5[provider]
}

/** Official URa. */
export function getFable5Option(
  provider: APIProvider = getAPIProvider(),
): FablePickerOption {
  const useConcreteId = !isAnthropicStyleApiProvider(provider)
  return {
    value: useConcreteId ? fable5IdFor(provider) : 'fable',
    label: 'Fable',
    description: `Fable 5 · ${FABLE_SLOGAN}${getFableCreditsSuffix()}`,
    descriptionForModel: FABLE_DESCRIPTION_FOR_MODEL,
  }
}

/**
 * Official wyp. Only ANTHROPIC_DEFAULT_FABLE_MODEL (+ NAME/DESCRIPTION).
 * Do not invent OPENAI_/GEMINI_DEFAULT_FABLE_MODEL.
 */
export function getCustomFableOption(
  provider: APIProvider = getAPIProvider(),
): FablePickerOption | undefined {
  const id = process.env.ANTHROPIC_DEFAULT_FABLE_MODEL
  if (!isCustomFamilyModelEnv(provider) || !id) {
    return undefined
  }
  const description =
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION ??
    'Custom Fable model'
  return {
    value: 'fable',
    label: process.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME ?? id,
    description,
    descriptionForModel: `${description} (${id})`,
  }
}

/**
 * Official W4r. Nyp sibling-remap is not ported (s stays null), so the
 * keep-next-family flag is Lyp≈!availableModels or Gu≈isModelAllowed.
 */
export function insertFablePickerOption<T extends FablePickerOption>(
  options: T[],
  option: T,
  deps?: InsertFablePickerDeps,
): void {
  if (
    !(
      typeof option.value === 'string' && isFablePickerInsertValue(option.value)
    )
  ) {
    options.push(option)
    return
  }
  const defaultIdx = options.findIndex(row => row.value === null)
  if (defaultIdx === -1) {
    options.splice(0, 0, option)
    return
  }
  const defaultSetting =
    deps?.defaultModelSetting !== undefined
      ? deps.defaultModelSetting
      : getDefaultMainLoopModelSetting()
  const defaultFamily =
    typeof defaultSetting === 'string' ? pickerFamilyOf(defaultSetting) : null
  const next = options[defaultIdx + 1]?.value
  const unrestricted =
    deps?.unrestrictedList ?? !(getSettings_DEPRECATED() || {}).availableModels
  const allowed = deps?.isAllowed ?? ((value: string) => isModelAllowed(value))
  const keepNextFamilyOnly =
    typeof next === 'string' && (unrestricted || allowed(next))
  const strippedAlias =
    typeof next === 'string' ? next.replace(/\[1m\]$/i, '') : ''
  const nextFamily =
    typeof next === 'string' && isModelAlias(strippedAlias)
      ? pickerFamilyOf(next)
      : null
  const skip = new Set<string>()
  if (nextFamily !== null) {
    skip.add(nextFamily)
    if (!keepNextFamilyOnly && defaultFamily !== null) {
      skip.add(defaultFamily)
    }
  } else if (defaultFamily !== null) {
    skip.add(defaultFamily)
  }
  let insertAt = defaultIdx + 1
  while (insertAt < options.length) {
    const value = options[insertAt]?.value
    if (typeof value !== 'string') {
      break
    }
    const family = pickerFamilyOf(value)
    if (
      (family !== null && skip.has(family)) ||
      isFablePickerInsertValue(value)
    ) {
      insertAt++
      continue
    }
    break
  }
  options.splice(insertAt, 0, option)
}

/**
 * Official I0v `else if (G4r(s))` — pin the current fable value onto an
 * existing Iyp-same row, else W4r URa with that value.
 */
export function applyPinnedFablePickerValue<T extends FablePickerOption>(
  options: T[],
  pinned: string,
  deps?: InsertFablePickerDeps & { provider?: APIProvider },
): void {
  const probe = { value: pinned, label: '', description: '' }
  const idx = options.findIndex(row => isSameFablePickerRow(row, probe))
  if (idx !== -1) {
    options[idx] = { ...options[idx], value: pinned }
    return
  }
  insertFablePickerOption(
    options,
    { ...getFable5Option(deps?.provider), value: pinned } as T,
    deps,
  )
}

/**
 * Official C0v Fable insert. Caller supplies isSubscriber (ls) so PAYG
 * branches do not re-query auth.
 */
export function maybeInsertFablePickerRow<T extends FablePickerOption>(
  options: T[],
  deps: {
    isSubscriber: boolean
    provider?: APIProvider
    insertDeps?: InsertFablePickerDeps
  },
): void {
  if (deps.isSubscriber) {
    return
  }
  const provider = deps.provider ?? getAPIProvider()
  const custom = getCustomFableOption(provider)
  if (isAnthropicStyleApiProvider(provider)) {
    if (custom) {
      insertFablePickerOption(options, custom as T, deps.insertDeps)
    } else if (
      isAnthropicAwsFamilyProvider(provider) &&
      isFable5AvailableOnProvider(provider)
    ) {
      insertFablePickerOption(
        options,
        getFable5Option(provider) as T,
        deps.insertDeps,
      )
    }
    return
  }
  if (custom || isFable5AvailableOnProvider(provider)) {
    insertFablePickerOption(
      options,
      (custom ?? getFable5Option(provider)) as T,
      deps.insertDeps,
    )
  }
}
