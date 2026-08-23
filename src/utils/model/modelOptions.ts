// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import {
  isClaudeAISubscriber,
  isMaxSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import { getModelStrings } from './modelStrings.js'
import { getAntModels } from './antModels.js'
import {
  COST_TIER_3_15,
  COST_HAIKU_35,
  COST_HAIKU_45,
  formatModelPricing,
} from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { checkOpus1mAccess, checkSonnet1mAccess } from './check1mAccess.js'
import { getAPIProvider } from './providers.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getGatewayModelsCachePath,
  parseGatewayModelOptionsFromCache,
} from '../residualMoreEnvGates.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { readFileSync } from 'node:fs'
import {
  getCanonicalName,
  getClaudeAiUserDefaultModelDescription,
  getDefaultSonnetModel,
  getDefaultOpusModel,
  getDefaultHaikuModel,
  getDefaultMainLoopModelSetting,
  getMarketingNameForModel,
  getUserSpecifiedModelSetting,
  isOpus1mMergeEnabled,
  getOpusPricingSuffix,
  renderDefaultModelSetting,
  type ModelSetting,
} from './model.js'
import { applyFableCreditsLabel } from './fableCreditsLabel.js'
import { DRAWS_FROM_USAGE_CREDITS_SUFFIX } from '../extraUsage.js'
import { has1mContext } from '../context.js'
import { getGlobalConfig } from '../config.js'
import {
  CHATGPT_CODEX_DEFAULT_MODEL,
  CHATGPT_CODEX_MODEL_OPTIONS,
  isChatGPTAuthMode,
} from './chatgptModels.js'

// @[MODEL LAUNCH]: Update all the available and default model option strings below.

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

export function getDefaultOptionForUser(fastMode = false): ModelOption {
  // densable idt/aRn: org → env (ANTHROPIC_DEFAULT_MODEL) → tier badge.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    resolveOrgDefaultSetting,
    resolveAnthropicDefaultModelEnv,
    getDefaultModelAttributionBadge,
  } = require('./orgDefaultModel.js') as typeof import('./orgDefaultModel.js')
  const orgDefault = resolveOrgDefaultSetting()
  const envDefault = !orgDefault ? resolveAnthropicDefaultModelEnv() : null
  const attributionBadge = orgDefault
    ? getDefaultModelAttributionBadge('org')
    : envDefault
      ? getDefaultModelAttributionBadge('env')
      : ''

  if (process.env.USER_TYPE === 'ant') {
    const currentModel = renderDefaultModelSetting(
      getDefaultMainLoopModelSetting(),
    )
    return {
      value: null,
      label: 'Default (recommended)',
      description: `Use the default model for Ants (currently ${currentModel})${attributionBadge}`,
      descriptionForModel: `Default model (currently ${currentModel})`,
    }
  }

  // Subscribers
  if (isClaudeAISubscriber()) {
    // When org/env default is set, show the resolved model name + badge
    // instead of the generic tier marketing string (official N1n org/env arm).
    if (orgDefault) {
      return {
        value: null,
        label: 'Default (recommended)',
        description: `${renderDefaultModelSetting(orgDefault)}${attributionBadge}`,
      }
    }
    if (envDefault) {
      return {
        value: null,
        label: 'Default (recommended)',
        description: `${renderDefaultModelSetting(envDefault)}${attributionBadge}`,
      }
    }
    return {
      value: null,
      label: 'Default (recommended)',
      description: getClaudeAiUserDefaultModelDescription(fastMode),
    }
  }

  // PAYG
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: null,
    label: 'Default (recommended)',
    description: `Use the default model (currently ${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}${attributionBadge}`,
  }
}

function getCustomSonnetOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const provider = getAPIProvider()
  // Use provider-specific DEFAULT_SONNET_MODEL
  const customSonnetModel =
    provider === 'openai'
      ? process.env.OPENAI_DEFAULT_SONNET_MODEL
      : provider === 'gemini'
        ? process.env.GEMINI_DEFAULT_SONNET_MODEL
        : process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  // When a 3P user has a custom sonnet model string, show it directly
  if (is3P && customSonnetModel) {
    const is1m = has1mContext(customSonnetModel)
    // Use appropriate NAME/DESCRIPTION env vars based on provider
    const nameEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_SONNET_MODEL_NAME
        : provider === 'gemini'
          ? process.env.GEMINI_DEFAULT_SONNET_MODEL_NAME
          : process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME
    const descEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_SONNET_MODEL_DESCRIPTION
        : provider === 'gemini'
          ? process.env.GEMINI_DEFAULT_SONNET_MODEL_DESCRIPTION
          : process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION
    return {
      value: 'sonnet',
      label: nameEnv ?? customSonnetModel,
      description:
        descEnv ?? `Custom Sonnet model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${descEnv ?? `Custom Sonnet model${is1m ? ' with 1M context' : ''}`} (${customSonnetModel})`,
    }
  }
}

// @[MODEL LAUNCH]: Update or add model option functions (getSonnetXXOption, getOpusXXOption, etc.)
// with the new model's label and description. These appear in the /model picker.
function getSonnet5Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  // When the default sonnet alias already resolves to Sonnet 5, use the alias.
  const defaultIsSonnet5 =
    !is3P && getCanonicalName(getDefaultSonnetModel()) === 'claude-sonnet-5'
  return {
    value: is3P
      ? getModelStrings().sonnet5
      : defaultIsSonnet5
        ? 'sonnet'
        : getModelStrings().sonnet5,
    label: 'Sonnet',
    description: `Sonnet 5 · Efficient for routine tasks${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'Sonnet 5 - efficient for routine tasks. Generally recommended for most coding tasks',
  }
}

function getSonnet46Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().sonnet46 : getModelStrings().sonnet46,
    label: 'Sonnet 4.6',
    description: 'Sonnet 4.6 · Previous Sonnet version',
    descriptionForModel: 'Sonnet 4.6 - previous Sonnet version',
  }
}

function getCustomOpusOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const provider = getAPIProvider()
  // Use provider-specific DEFAULT_OPUS_MODEL
  const customOpusModel =
    provider === 'openai'
      ? process.env.OPENAI_DEFAULT_OPUS_MODEL
      : provider === 'gemini'
        ? process.env.GEMINI_DEFAULT_OPUS_MODEL
        : process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  // When a 3P user has a custom opus model string, show it directly
  if (is3P && customOpusModel) {
    const is1m = has1mContext(customOpusModel)
    // Use appropriate NAME/DESCRIPTION env vars based on provider
    const nameEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_OPUS_MODEL_NAME
        : provider === 'gemini'
          ? process.env.GEMINI_DEFAULT_OPUS_MODEL_NAME
          : process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME
    const descEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_OPUS_MODEL_DESCRIPTION
        : provider === 'gemini'
          ? process.env.GEMINI_DEFAULT_OPUS_MODEL_DESCRIPTION
          : process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION
    return {
      value: 'opus',
      label: nameEnv ?? customOpusModel,
      description: descEnv ?? `Custom Opus model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${descEnv ?? `Custom Opus model${is1m ? ' with 1M context' : ''}`} (${customOpusModel})`,
    }
  }
}

/** densable 2.1.219 jUc — default Opus row (Opus 5). */
function getOpus5Option(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().opus5
  return {
    value: is3P ? model : 'opus',
    label: 'Opus',
    description: `Opus 5 · Best for everyday, complex tasks${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: 'Opus 5 - best for everyday, complex tasks',
  }
}

function getOpus47Option(fastMode = false): ModelOption {
  const model = getModelStrings().opus47
  return {
    value: model,
    label: 'Opus 4.7',
    description: `Opus 4.7 · Legacy${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: 'Opus 4.7 - legacy Opus version',
  }
}

/** densable previous Opus version row. */
function getOpus48Option(fastMode = false): ModelOption {
  const model = getModelStrings().opus48
  return {
    value: model,
    label: 'Opus 4.8',
    description: `Opus 4.8 · Previous Opus version${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: 'Opus 4.8 - previous Opus version',
  }
}

export function getOpus46Option(fastMode = false): ModelOption {
  // Always use the canonical 4.6 model string (not the 'opus' alias, which
  // resolves via getDefaultOpusModel() to opus47 on firstParty). Users
  // selecting "Opus 4.6" must get 4.6 actually dispatched, not alias-routed
  // to 4.7. The same string is correct for 3P (getModelStrings maps per
  // provider).
  const model = getModelStrings().opus46
  return {
    value: model,
    label: 'Opus 4.6',
    description: `Opus 4.6 · Previous generation Opus${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: 'Opus 4.6 - previous generation Opus model',
  }
}

export function getSonnet5_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().sonnet5 + '[1m]' : 'sonnet[1m]',
    label: 'Sonnet 5 (1M context)',
    description: `Sonnet 5 for long sessions${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'Sonnet 5 with 1M context window - for long sessions with large codebases',
  }
}

export function getSonnet46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P
      ? getModelStrings().sonnet46 + '[1m]'
      : getModelStrings().sonnet46 + '[1m]',
    label: 'Sonnet 4.6 (1M context)',
    description: `Sonnet 4.6 for long sessions${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'Sonnet 4.6 with 1M context window - for long sessions with large codebases',
  }
}

export function getOpus47_1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().opus5
  return {
    value: is3P ? model + '[1m]' : 'opus[1m]',
    // densable 2.1.219 #10
    label: 'Opus (1M context)',
    description: `Opus 5 for long sessions${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel:
      'Opus 5 with 1M context window - for long sessions with large codebases',
  }
}

export function getOpus46_1MOption(fastMode = false): ModelOption {
  const model = getModelStrings().opus46
  return {
    value: model + '[1m]',
    label: 'Opus 4.6 (1M context)',
    description: `Opus 4.6 with 1M context${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel:
      'Opus 4.6 with 1M context window - for long sessions with large codebases',
  }
}

function getCustomHaikuOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const provider = getAPIProvider()
  // Use provider-specific DEFAULT_HAIKU_MODEL
  const customHaikuModel =
    provider === 'openai'
      ? process.env.OPENAI_DEFAULT_HAIKU_MODEL
      : provider === 'gemini'
        ? process.env.GEMINI_DEFAULT_HAIKU_MODEL
        : process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  // When a 3P user has a custom haiku model string, show it directly
  if (is3P && customHaikuModel) {
    // Use appropriate NAME/DESCRIPTION env vars based on provider
    const nameEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_HAIKU_MODEL_NAME
        : provider === 'gemini'
          ? process.env.GEMINI_DEFAULT_HAIKU_MODEL_NAME
          : process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME
    const descEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_HAIKU_MODEL_DESCRIPTION
        : provider === 'gemini'
          ? process.env.GEMINI_DEFAULT_HAIKU_MODEL_DESCRIPTION
          : process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION
    return {
      value: 'haiku',
      label: nameEnv ?? customHaikuModel,
      description: descEnv ?? 'Custom Haiku model',
      descriptionForModel: `${descEnv ?? 'Custom Haiku model'} (${customHaikuModel})`,
    }
  }
}

function getHaiku45Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'haiku',
    label: 'Haiku',
    description: `Haiku 4.5 · Fastest for quick answers${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_45)}`}`,
    descriptionForModel:
      'Haiku 4.5 - fastest for quick answers. Lower cost but less capable than Sonnet 5.',
  }
}

function getHaiku35Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'haiku',
    label: 'Haiku',
    description: `Haiku 3.5 for simple tasks${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_35)}`}`,
    descriptionForModel:
      'Haiku 3.5 - faster and lower cost, but less capable than Sonnet. Use for simple tasks.',
  }
}

function getHaikuOption(): ModelOption {
  // Return correct Haiku option based on provider
  const haikuModel = getDefaultHaikuModel()
  return haikuModel === getModelStrings().haiku45
    ? getHaiku45Option()
    : getHaiku35Option()
}

function getMaxOpusOption(fastMode = false): ModelOption {
  // densable 2.1.219: alias "opus" → Opus 5
  const model = getModelStrings().opus5
  return {
    value: 'opus',
    label: 'Opus',
    description: `Opus 5 · Best for everyday, complex tasks${fastMode ? getOpusPricingSuffix(true, model) : ''}`,
  }
}

export function getMaxSonnet5_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const billingInfo = isClaudeAISubscriber()
    ? DRAWS_FROM_USAGE_CREDITS_SUFFIX
    : ''
  return {
    value: 'sonnet[1m]',
    label: 'Sonnet 5 (1M context)',
    description: `Sonnet 5 with 1M context${billingInfo}${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
  }
}

/** @deprecated Use getMaxSonnet5_1MOption — kept as alias for existing callers. */
export function getMaxSonnet46_1MOption(): ModelOption {
  return getMaxSonnet5_1MOption()
}

export function getMaxOpus47_1MOption(fastMode = false): ModelOption {
  const billingInfo = isClaudeAISubscriber()
    ? DRAWS_FROM_USAGE_CREDITS_SUFFIX
    : ''
  const model = getModelStrings().opus5
  return {
    value: 'opus[1m]',
    // densable 2.1.219 #10 — merged Opus row label
    label: 'Opus (1M context)',
    description: `Opus 5 with 1M context${billingInfo}${getOpusPricingSuffix(fastMode, model)}`,
  }
}

function getMergedOpus1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().opus5
  return {
    // densable 2.1.219: merged default Opus 1M = opus5[1m] / opus[1m]
    value: is3P ? model + '[1m]' : 'opus[1m]',
    label: 'Opus (1M context)',
    description: `Opus 5 for long sessions${!is3P && fastMode ? getOpusPricingSuffix(fastMode, model) : ''}`,
    descriptionForModel:
      'Opus 5 with 1M context window - for long sessions with large codebases',
  }
}

const MaxSonnet5Option: ModelOption = {
  value: 'sonnet',
  label: 'Sonnet',
  description: 'Sonnet 5 · Efficient for routine tasks',
}

const MaxHaiku45Option: ModelOption = {
  value: 'haiku',
  label: 'Haiku',
  description: 'Haiku 4.5 · Fastest for quick answers',
}

function getOpusPlanOption(): ModelOption {
  // densable Tug(): label/desc version-agnostic (not pinned to 4.7/5)
  return {
    value: 'opusplan',
    label: 'Opus Plan Mode',
    description: 'Use Opus in plan mode, Sonnet otherwise',
  }
}

function getChatGPTCodexModelOptions(): ModelOption[] {
  return [
    {
      value: null,
      label: 'Default (recommended)',
      description: `Use the default ChatGPT Codex model (currently ${CHATGPT_CODEX_DEFAULT_MODEL})`,
      descriptionForModel: `Default ChatGPT Codex model (currently ${CHATGPT_CODEX_DEFAULT_MODEL})`,
    },
    ...CHATGPT_CODEX_MODEL_OPTIONS.map(model => ({
      value: model.value,
      label: model.label,
      description: model.description,
      descriptionForModel: `${model.description} (${model.value})`,
    })),
  ]
}

// @[MODEL LAUNCH]: Update the model picker lists below to include/reorder options for the new model.
// Each user tier (ant, Max/Team Premium, Pro/Team Standard/Enterprise, PAYG 1P, PAYG 3P) has its own list.
function getModelOptionsBase(fastMode = false): ModelOption[] {
  if (process.env.USER_TYPE === 'ant') {
    // Build options from antModels config
    const antModelOptions: ModelOption[] = getAntModels().map(m => ({
      value: m.alias,
      label: m.label,
      description: m.description ?? `[ANT-ONLY] ${m.label} (${m.model})`,
    }))

    return [
      getDefaultOptionForUser(),
      ...antModelOptions,
      getMergedOpus1MOption(fastMode),
      getSonnet5Option(),
      getSonnet5_1MOption(),
      getSonnet46Option(),
      getHaiku45Option(),
    ]
  }

  if (getAPIProvider() === 'openai' && isChatGPTAuthMode()) {
    return getChatGPTCodexModelOptions()
  }

  if (isClaudeAISubscriber()) {
    if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
      // Max and Team Premium users: Default = Opus 4.7 1M (merged), plus Opus 4.6 1M
      const premiumOptions = [getDefaultOptionForUser(fastMode)]
      premiumOptions.push(getOpus46_1MOption(fastMode))

      premiumOptions.push(MaxSonnet5Option)
      if (checkSonnet1mAccess()) {
        premiumOptions.push(getMaxSonnet5_1MOption())
      }

      premiumOptions.push(MaxHaiku45Option)
      return premiumOptions
    }

    // Pro/Team Standard/Enterprise users: Sonnet is default, show Opus 4.7 1M + Opus 4.6 1M
    const standardOptions = [getDefaultOptionForUser(fastMode)]

    if (isOpus1mMergeEnabled()) {
      standardOptions.push(getMergedOpus1MOption(fastMode))
    } else {
      standardOptions.push(getMaxOpusOption(fastMode))
      if (checkOpus1mAccess()) {
        standardOptions.push(getMaxOpus47_1MOption(fastMode))
      }
    }
    standardOptions.push(getOpus46_1MOption(fastMode))

    if (checkSonnet1mAccess()) {
      standardOptions.push(getMaxSonnet5_1MOption())
    }

    standardOptions.push(MaxHaiku45Option)
    return standardOptions
  }

  // PAYG 1P API densable 2.1.219: Default + Opus 5 / Opus (1M) + Opus 4.8 + Opus 4.6 1M + Sonnet 5 1M + Haiku
  if (getAPIProvider() === 'firstParty') {
    const payg1POptions = [getDefaultOptionForUser(fastMode)]
    if (isOpus1mMergeEnabled()) {
      payg1POptions.push(getMergedOpus1MOption(fastMode))
    } else {
      payg1POptions.push(getOpus5Option(fastMode))
      if (checkOpus1mAccess()) {
        payg1POptions.push(getOpus47_1MOption(fastMode))
      }
    }
    payg1POptions.push(getOpus48Option(fastMode))
    payg1POptions.push(getOpus46_1MOption(fastMode))
    if (checkSonnet1mAccess()) {
      payg1POptions.push(getSonnet5_1MOption())
    }
    // Keep previous Sonnet as a pin-able concrete version.
    payg1POptions.push(getSonnet46Option())
    payg1POptions.push(getHaiku45Option())
    return payg1POptions
  }

  // PAYG 3P: Default + Sonnet (3P custom) or Sonnet 5/1M + previous Sonnet 4.6 + Opus + Haiku
  const payg3pOptions = [getDefaultOptionForUser(fastMode)]

  const customSonnet = getCustomSonnetOption()
  if (customSonnet !== undefined) {
    payg3pOptions.push(customSonnet)
  } else {
    payg3pOptions.push(getSonnet5Option())
    if (checkSonnet1mAccess()) {
      payg3pOptions.push(getSonnet5_1MOption())
    }
    payg3pOptions.push(getSonnet46Option())
  }

  const customOpus = getCustomOpusOption()
  if (customOpus !== undefined) {
    payg3pOptions.push(customOpus)
  } else {
    // Add Opus 4.7 1M + Opus 4.6 1M (no redundant non-1M entries)
    payg3pOptions.push(getOpus47_1MOption(fastMode))
    payg3pOptions.push(getOpus46_1MOption(fastMode))
  }
  const customHaiku = getCustomHaikuOption()
  if (customHaiku !== undefined) {
    payg3pOptions.push(customHaiku)
  } else {
    payg3pOptions.push(getHaikuOption())
  }
  return payg3pOptions
}

// @[MODEL LAUNCH]: Add the new model ID to the appropriate family pattern below
// so the "newer version available" hint works correctly.
/**
 * Map a full model name to its family alias and the marketing name of the
 * version the alias currently resolves to. Used to detect when a user has
 * a specific older version pinned and a newer one is available.
 */
function getModelFamilyInfo(
  model: string,
): { alias: string; currentVersionName: string } | null {
  const canonical = getCanonicalName(model)

  // Sonnet family
  if (
    canonical.includes('claude-sonnet-5') ||
    canonical.includes('claude-sonnet-4-6') ||
    canonical.includes('claude-sonnet-4-5') ||
    canonical.includes('claude-sonnet-4-') ||
    canonical.includes('claude-3-7-sonnet') ||
    canonical.includes('claude-3-5-sonnet')
  ) {
    const currentName = getMarketingNameForModel(getDefaultSonnetModel())
    if (currentName) {
      return { alias: 'Sonnet', currentVersionName: currentName }
    }
  }

  // Opus family
  if (canonical.includes('claude-opus-4')) {
    const currentName = getMarketingNameForModel(getDefaultOpusModel())
    if (currentName) {
      return { alias: 'Opus', currentVersionName: currentName }
    }
  }

  // Haiku family
  if (
    canonical.includes('claude-haiku') ||
    canonical.includes('claude-3-5-haiku')
  ) {
    const currentName = getMarketingNameForModel(getDefaultHaikuModel())
    if (currentName) {
      return { alias: 'Haiku', currentVersionName: currentName }
    }
  }

  return null
}

/**
 * Returns a ModelOption for a known Anthropic model with a human-readable
 * label, and an upgrade hint if a newer version is available via the alias.
 * Returns null if the model is not recognized.
 */
function getKnownModelOption(model: string): ModelOption | null {
  const marketingName = getMarketingNameForModel(model)
  if (!marketingName) return null

  const familyInfo = getModelFamilyInfo(model)
  if (!familyInfo) {
    return {
      value: model,
      label: marketingName,
      description: model,
    }
  }

  // Check if the alias currently resolves to a different (newer) version
  if (marketingName !== familyInfo.currentVersionName) {
    return {
      value: model,
      label: marketingName,
      description: `Newer version available · select ${familyInfo.alias} for ${familyInfo.currentVersionName}`,
    }
  }

  // Same version as the alias — just show the friendly name
  return {
    value: model,
    label: marketingName,
    description: model,
  }
}

export function getModelOptions(fastMode = false): ModelOption[] {
  const options = getModelOptionsBase(fastMode)

  // Add the custom model from the ANTHROPIC_CUSTOM_MODEL_OPTION env var
  const envCustomModel = process.env.ANTHROPIC_CUSTOM_MODEL_OPTION
  if (
    envCustomModel &&
    !options.some(existing => existing.value === envCustomModel)
  ) {
    options.push({
      value: envCustomModel,
      label: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME ?? envCustomModel,
      description:
        process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION ??
        `Custom model (${envCustomModel})`,
    })
  }

  // Official mkr densable — merge cached gateway /v1/models options when $5l.
  // Full q5l download/write remains denser (bootstrap path).
  for (const opt of readGatewayModelOptionsFromCache()) {
    if (!options.some(existing => existing.value === opt.value)) {
      options.push(opt)
    }
  }

  // densable 2.1.219 #9: U1e additional options pass through hug() strip/reapply
  // of " · Requires usage credits" so stale bootstrap cache cannot bake the label.
  for (const opt of getGlobalConfig().additionalModelOptionsCache ?? []) {
    const refreshed = applyFableCreditsLabel(opt)
    if (!options.some(existing => existing.value === refreshed.value)) {
      options.push(refreshed)
    }
  }

  // Add custom model from either the current model value or the initial one
  // if it is not already in the options.
  let customModel: ModelSetting = null
  const currentMainLoopModel = getUserSpecifiedModelSetting()
  const initialMainLoopModel = getInitialMainLoopModel()
  if (currentMainLoopModel !== undefined && currentMainLoopModel !== null) {
    customModel = currentMainLoopModel
  } else if (initialMainLoopModel !== null) {
    customModel = initialMainLoopModel
  }
  if (customModel === null || options.some(opt => opt.value === customModel)) {
    return filterModelOptionsByAllowlist(options)
  } else if (customModel === 'opusplan') {
    return filterModelOptionsByAllowlist([...options, getOpusPlanOption()])
  } else if (customModel === 'opus' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMaxOpusOption(fastMode),
    ])
  } else if (customModel === 'opus[1m]' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMergedOpus1MOption(fastMode),
    ])
  } else {
    // Try to show a human-readable label for known Anthropic models, with an
    // upgrade hint if the alias now resolves to a newer version.
    const knownOption = getKnownModelOption(customModel)
    if (knownOption) {
      options.push(knownOption)
    } else {
      options.push({
        value: customModel,
        label: customModel,
        description: 'Custom model',
      })
    }
    return filterModelOptionsByAllowlist(options)
  }
}

/**
 * Official mkr consumer — read gateway-models.json cache if present.
 * Pure parse lives in residualMoreEnvGates; full q5l fetch denser.
 */
function readGatewayModelOptionsFromCache(): ModelOption[] {
  let raw: string | null = null
  try {
    raw = readFileSync(
      getGatewayModelsCachePath(getClaudeConfigHomeDir()),
      'utf-8',
    )
  } catch {
    raw = null
  }
  return parseGatewayModelOptionsFromCache({ raw }) as ModelOption[]
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  if (!settings.availableModels) {
    return options // No restrictions
  }
  return options.filter(
    opt =>
      opt.value === null || (opt.value !== null && isModelAllowed(opt.value)),
  )
}
