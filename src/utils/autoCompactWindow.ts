/**
 * densable 2.1.234 /autocompact — parse + resolve + apply autoCompactWindow.
 * Gold: bDn (parse), Nq (resolve sources), CVr (apply).
 */

import { resolveAutoCompactWindowOverride } from './residualFinalEnvGates.js'
import { getSdkBetas } from '../bootstrap/state.js'
import { getContextWindowForModel } from './context.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from './settings/settings.js'
import { formatTokens } from './format.js'
import { logEvent } from '../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'

/** densable GYo */
export const AUTO_COMPACT_WINDOW_MIN = 100_000
/** densable Gca */
export const AUTO_COMPACT_WINDOW_MAX = 1_000_000
/** densable dialog step zQr */
export const AUTO_COMPACT_WINDOW_STEP = 100_000

export type AutoCompactWindowSource =
  | 'env'
  | 'settings'
  | 'auto'
  | 'unknown-model'
  | 'model-default'
  | 'experiment'
  | 'clientdata'

export type ResolvedAutoCompactWindow = {
  /** Effective window used for threshold (min with model max). */
  window: number
  /** Configured value before model cap. */
  configured: number
  source: AutoCompactWindowSource
}

/**
 * densable bDn — parse `auto` | `500k` | `200000` | `200` (100–1000 → ×1000).
 * Returns `'auto'` | token count in [100k, 1M], or undefined if invalid.
 */
export function parseAutoCompactWindowArg(
  raw: string,
): 'auto' | number | undefined {
  const t = raw.trim().toLowerCase()
  if (t === 'auto' || t === 'reset' || t === 'unset' || t === 'default') {
    return 'auto'
  }
  let n: number
  if (t.endsWith('m')) {
    n = parseFloat(t.slice(0, -1)) * 1e6
  } else if (t.endsWith('k')) {
    n = parseFloat(t.slice(0, -1)) * 1000
  } else {
    const parsed = Number(t)
    if (!Number.isFinite(parsed)) return undefined
    // densable: 100–1000 treated as shorthand thousands
    n = parsed >= 100 && parsed <= 1000 ? parsed * 1000 : parsed
  }
  if (
    !Number.isFinite(n) ||
    n < AUTO_COMPACT_WINDOW_MIN ||
    n > AUTO_COMPACT_WINDOW_MAX
  ) {
    return undefined
  }
  return Math.round(n)
}

/**
 * densable Nq core (env → settings → auto). Full clientdata/experiment tables
 * are optional product surfaces; env + settings + model max match the command.
 */
export function resolveAutoCompactWindow(
  model: string,
  settingsWindow: number | undefined = getInitialSettings().autoCompactWindow,
): ResolvedAutoCompactWindow {
  const modelMax = getContextWindowForModel(model, getSdkBetas())

  const envOverride = resolveAutoCompactWindowOverride()
  if (envOverride !== null) {
    const configured = Math.max(AUTO_COMPACT_WINDOW_MIN, envOverride)
    return {
      window: Math.min(modelMax, configured),
      configured,
      source: 'env',
    }
  }

  if (settingsWindow !== undefined) {
    return {
      window: Math.min(modelMax, settingsWindow),
      configured: settingsWindow,
      source: 'settings',
    }
  }

  return {
    window: modelMax,
    configured: modelMax,
    source: 'auto',
  }
}

export function describeAutoCompactWindowSource(
  resolved: ResolvedAutoCompactWindow,
): string {
  const { source, configured, window } = resolved
  const capped =
    configured > window ? ` · capped to ${formatTokens(window)} by model` : ''
  if (source === 'auto') return 'auto'
  if (source === 'env') {
    return `${formatTokens(configured)} tokens (from CLAUDE_CODE_AUTO_COMPACT_WINDOW)${capped}`
  }
  if (source === 'settings') {
    return `${formatTokens(configured)} tokens (from settings)${capped}`
  }
  if (source === 'unknown-model') {
    return `${formatTokens(configured)} tokens (default for an unrecognized model)${capped}`
  }
  if (source === 'model-default') {
    return `${formatTokens(configured)} tokens (default for this model)${capped}`
  }
  return `${formatTokens(configured)} tokens (${source})${capped}`
}

export function formatAutoCompactWindowStatus(model: string): string {
  const resolved = resolveAutoCompactWindow(model)
  const lines = [
    `Auto-compact window: ${describeAutoCompactWindowSource(resolved)}`,
    '',
    "Auto-compact summarizes the conversation when context usage approaches this limit. The actual threshold is the minimum of this setting and your model's maximum context window.",
    'The auto setting picks a window tuned for your model and is strongly recommended for the best cost and performance.',
  ]
  if (resolved.source === 'env' || resolved.source === 'settings') {
    lines.push(
      'Overriding auto may result in high token usage, especially when resuming long sessions.',
    )
  }
  return lines.join('\n')
}

/**
 * densable CVr — persist autoCompactWindow (or clear for auto).
 */
export function applyAutoCompactWindow(raw: string, model: string): string {
  if (resolveAutoCompactWindowOverride() !== null) {
    return 'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting.'
  }

  const parsed = parseAutoCompactWindowArg(raw)
  if (parsed === undefined) {
    return `Couldn't parse '${raw}'. Expected 'auto' or 100k–1M tokens (e.g. 500k, 200000, or 200 as shorthand)`
  }

  const value = parsed === 'auto' ? undefined : parsed
  const { error } = updateSettingsForSource('userSettings', {
    autoCompactWindow: value,
  })
  if (error) {
    return `Couldn't save setting: ${error.message}`
  }

  const after = getInitialSettings().autoCompactWindow
  const { window, source } = resolveAutoCompactWindow(model, after)
  const higherPriority =
    source === 'env' || (value !== undefined && after !== value)

  logEvent('tengu_autocompact_command', {
    action: (parsed === 'auto'
      ? 'auto'
      : 'set') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(typeof value === 'number' ? { tokens: value } : {}),
  })

  if (parsed === 'auto') {
    return higherPriority
      ? `Auto-compact window set to auto in settings, but a higher-priority override is active (${formatTokens(window)} tokens)`
      : 'Auto-compact window set to auto'
  }

  let suffix = ''
  if (higherPriority) {
    suffix = `, but a higher-priority override is active (${formatTokens(window)} tokens)`
  } else if (window < parsed) {
    suffix = ` (capped to model limit of ${formatTokens(window)})`
  }
  return `Auto-compact window set to ${formatTokens(parsed)} tokens${suffix}`
}
