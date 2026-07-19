import chalk from 'chalk'
import type { ToolUseContext } from '../../Tool.js'
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js'
import {
  clearFastModeCooldown,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../../utils/fastMode.js'
import { MODEL_ALIASES } from '../../utils/model/aliases.js'
import {
  checkOpus1mAccess,
  checkSonnet1mAccess,
} from '../../utils/model/check1mAccess.js'
import {
  getDefaultMainLoopModelSetting,
  isOpus1mMergeEnabled,
  renderDefaultModelSetting,
} from '../../utils/model/model.js'
import { isModelAllowed } from '../../utils/model/modelAllowlist.js'
import { validateModel } from '../../utils/model/validateModel.js'
import { saveSessionModel } from '../../utils/sessionStorage.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

/** densable zAd */
export function modelUsageText(): string {
  return `Usage: /model <name>. Available: ${MODEL_ALIASES.join(', ')}, default, or a full model ID.`
}

export function formatCurrentModel(
  mainLoopModel: string | null,
  mainLoopModelForSession: string | null,
  effortValue: unknown,
): string {
  const displayModel = renderModelLabel(mainLoopModel)
  const effortInfo =
    effortValue !== undefined && effortValue !== null
      ? ` (effort: ${effortValue})`
      : ''
  if (mainLoopModelForSession) {
    return `Current model: ${chalk.bold(renderModelLabel(mainLoopModelForSession))} (session override from plan mode)\nBase model: ${displayModel}${effortInfo}`
  }
  return `Current model: ${displayModel}${effortInfo}`
}

function renderModelLabel(model: string | null): string {
  const rendered = renderDefaultModelSetting(
    model ?? getDefaultMainLoopModelSetting(),
  )
  return model === null ? `${rendered} (default)` : rendered
}

function isKnownAlias(model: string): boolean {
  return (MODEL_ALIASES as readonly string[]).includes(
    model.toLowerCase().trim(),
  )
}

function isOpus1mUnavailable(model: string): boolean {
  const m = model.toLowerCase()
  return (
    !checkOpus1mAccess() &&
    !isOpus1mMergeEnabled() &&
    m.includes('opus') &&
    m.includes('[1m]')
  )
}

function isSonnet1mUnavailable(model: string): boolean {
  const m = model.toLowerCase()
  return (
    !checkSonnet1mAccess() &&
    (m.includes('sonnet[1m]') ||
      m.includes('sonnet-5[1m]') ||
      m.includes('sonnet-4-6[1m]'))
  )
}

/**
 * densable _Ht + V7r — set model for interactive (persist default) or
 * non-interactive (session only).
 */
export async function applyModelSet(
  raw: string,
  context: Pick<ToolUseContext, 'getAppState' | 'setAppState'>,
  options: { persistDefault: boolean },
): Promise<string> {
  const model = raw === 'default' ? null : raw

  if (model && !isModelAllowed(model)) {
    return `Model '${model}' is not available. Your organization restricts model selection.`
  }
  if (model && isOpus1mUnavailable(model)) {
    return 'Opus 4.7 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m'
  }
  if (model && isSonnet1mUnavailable(model)) {
    return 'Sonnet 5 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m'
  }

  if (model && !isKnownAlias(model)) {
    try {
      const { valid, error } = await validateModel(model)
      if (!valid) {
        return error || `Model '${model}' not found`
      }
    } catch (error) {
      return `Failed to validate model: ${(error as Error).message}`
    }
  }

  const prev = context.getAppState()
  const wasFast = !!prev.fastMode
  context.setAppState(s => ({
    ...s,
    mainLoopModel: model,
    mainLoopModelForSession: null,
  }))
  saveSessionModel(model)

  if (options.persistDefault) {
    updateSettingsForSource('userSettings', { model: model ?? undefined })
  }

  let message = `Set model to ${chalk.bold(renderModelLabel(model))}${
    options.persistDefault
      ? ' and saved as your default for new sessions'
      : ' for this session only'
  }`

  let wasFastModeToggledOn: boolean | undefined
  if (isFastModeEnabled()) {
    clearFastModeCooldown()
    if (!isFastModeSupportedByModel(model) && wasFast) {
      context.setAppState(s => ({ ...s, fastMode: false }))
      wasFastModeToggledOn = false
    } else if (isFastModeSupportedByModel(model) && wasFast) {
      message += ` · Fast mode ON`
      wasFastModeToggledOn = true
    }
  }

  if (
    isBilledAsExtraUsage(
      model,
      wasFastModeToggledOn === true,
      isOpus1mMergeEnabled(),
    )
  ) {
    message += ` · Billed as extra usage`
  }
  if (wasFastModeToggledOn === false) {
    message += ` · Fast mode OFF`
  }
  return message
}
