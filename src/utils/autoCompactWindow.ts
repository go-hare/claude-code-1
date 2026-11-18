/**
 * densable 2.1.234 /autocompact — parse + resolve + apply autoCompactWindow.
 * Gold: bDn (parse), Nq (resolve sources), CVr (apply).
 */

import {
  getAutoCompactWindowEnvWarning,
  resolveAutoCompactWindowOverride,
} from './residualFinalEnvGates.js'
import { logForDebugging } from './debug.js'
import { getAutoCompactWindowSurface, getSdkBetas } from '../bootstrap/state.js'
import { getBootstrapSessionHost } from './sessionRoot.js'
import {
  getContextWindowForModel,
  isRecognizedModelForWindowEnforcement,
  isUnknownModelWindowEnforcementDisabled,
} from './context.js'
import { canonicalEffortModelKey } from './effort.js'
import { getCanonicalName } from './model/model.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from './settings/settings.js'
import type { SettingsJson } from './settings/types.js'
import { formatTokens } from './format.js'
import { logEvent } from '../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'

/**
 * densable 2.1.247 y3n — model-default auto-compact window table.
 * 246 LYn defaulted claude-sonnet-5 to 967000; 247 is 1e6.
 */
export const MODEL_AUTO_COMPACT_WINDOW_DEFAULTS: Record<
  string,
  { default: number; surfaces?: Record<string, { default: number }> }
> = {
  'claude-sonnet-5': {
    surfaces: {
      remote_cowork: { default: 500_000 },
      'local-agent': { default: 500_000 },
    },
    default: 1_000_000,
  },
}

/** densable _3n */
function lookupWindowEntryDefault(
  entry: { default?: number } & Record<string, unknown>,
  key: string | undefined,
): number | undefined {
  if (key && Object.hasOwn(entry, key)) {
    const v = entry[key]
    return typeof v === 'number' ? v : undefined
  }
  return typeof entry.default === 'number' ? entry.default : undefined
}

/** densable C3n — ENTRYPOINT surface, then default. Ig() not locked: no per-surface model key. */
export function resolveModelAutoCompactWindowEntry(
  entry:
    | number
    | {
        default?: number
        surfaces?: Record<string, { default: number }>
      },
): number | undefined {
  if (typeof entry === 'number') return entry
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return undefined
  }
  const { surfaces, ...rest } = entry
  const entrypoint =
    getAutoCompactWindowSurface() ?? process.env.CLAUDE_CODE_ENTRYPOINT
  const surface =
    entrypoint && surfaces && Object.hasOwn(surfaces, entrypoint)
      ? surfaces[entrypoint]
      : undefined
  if (surface) {
    const fromSurface = lookupWindowEntryDefault(surface, undefined)
    if (fromSurface !== undefined) return fromSurface
  }
  return lookupWindowEntryDefault(rest, undefined)
}

/** densable I8o — gated by Nm() (isAutoCompactEnabled). */
export function lookupModelAutoCompactWindow(
  model: string,
): number | undefined {
  let enabled = true
  try {
    const { isAutoCompactEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/compact/autoCompact.js') as typeof import('../services/compact/autoCompact.js')
    enabled = isAutoCompactEnabled()
  } catch {
    enabled = true
  }
  if (!enabled) return undefined
  const key = getCanonicalName(model)
  if (!Object.hasOwn(MODEL_AUTO_COMPACT_WINDOW_DEFAULTS, key)) return undefined
  return resolveModelAutoCompactWindowEntry(
    MODEL_AUTO_COMPACT_WINDOW_DEFAULTS[key]!,
  )
}

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

export type AutoCompactWindowValue = 'auto' | number
export type AutoCompactWindowsMap = Record<string, AutoCompactWindowValue>

export type AutoCompactWindowMetadataSink = {
  notifyInternalMetadataChanged: (metadata: {
    auto_compact_windows: AutoCompactWindowsMap
  }) => void
}

type SessionAutoCompactWindowsState = {
  windows: AutoCompactWindowsMap
  sink?: AutoCompactWindowMetadataSink
}

/** Gold `xlt` — per-host session auto_compact_windows + metadata sink. */
const sessionAutoCompactWindows = new WeakMap<
  object,
  SessionAutoCompactWindowsState
>()

function getOrCreateSessionWindowsState(
  host: object,
): SessionAutoCompactWindowsState {
  let state = sessionAutoCompactWindows.get(host)
  if (state === undefined) {
    state = { windows: {} }
    sessionAutoCompactWindows.set(host, state)
  }
  return state
}

function isValidAutoCompactWindowValue(
  value: unknown,
): value is AutoCompactWindowValue {
  return (
    value === 'auto' ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= AUTO_COMPACT_WINDOW_MIN &&
      value <= AUTO_COMPACT_WINDOW_MAX)
  )
}

/**
 * Gold `_4i` — hydrate per-session `auto_compact_windows` from resumed/session
 * internal metadata and bind the metadata sink.
 */
export function hydrateSessionAutoCompactWindows(
  host: object,
  metadata: {
    readFailed?: boolean
    internal?: { auto_compact_windows?: unknown }
  } | null,
  sink?: AutoCompactWindowMetadataSink,
  onHydrated?: (windows: AutoCompactWindowsMap) => void,
): void {
  if (metadata === null || metadata.readFailed === true) return
  try {
    const state = getOrCreateSessionWindowsState(host)
    if (sink !== undefined) {
      state.sink = sink
    }
    const raw = metadata.internal?.auto_compact_windows
    const filtered: AutoCompactWindowsMap = {}
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      for (const [key, val] of Object.entries(raw)) {
        if (
          !Object.hasOwn(Object.prototype, key) &&
          isValidAutoCompactWindowValue(val)
        ) {
          filtered[key] = val
        }
      }
    }
    state.windows = filtered
    if (Object.keys(filtered).length === 0) return
    onHydrated?.(filtered)
  } catch (err) {
    logForDebugging(
      `[autocompact] hydrateSessionAutoCompactWindows failed: ${String(err)}`,
      { level: 'warn' },
    )
  }
}

/**
 * Gold `y4i` — update per-session `auto_compact_windows` and notify the
 * internal metadata sink.
 */
export function persistSessionAutoCompactWindow(
  modelKey: string,
  value: AutoCompactWindowValue,
  host: object = getBootstrapSessionHost(),
): void {
  const state = sessionAutoCompactWindows.get(host)
  if (state?.sink === undefined || Object.hasOwn(Object.prototype, modelKey)) {
    return
  }
  try {
    state.windows = { ...state.windows, [modelKey]: value }
    state.sink.notifyInternalMetadataChanged({
      auto_compact_windows: state.windows,
    })
  } catch (err) {
    logForDebugging(
      `[autocompact] persistSessionAutoCompactWindow failed: ${String(err)}`,
      { level: 'warn' },
    )
  }
}

export function getSessionAutoCompactWindows(
  host: object = getBootstrapSessionHost(),
): AutoCompactWindowsMap {
  return sessionAutoCompactWindows.get(host)?.windows ?? {}
}

/**
 * Official #900 — resolve per-model `modelSettings.<canonical>.autoCompactWindow`
 * (or top-level `autoCompactWindow` fallback; `'auto'` resolves to `undefined`).
 */
export function resolvePerModelSettingsAutoCompactWindow(
  model: string,
  settings: Pick<
    SettingsJson,
    'autoCompactWindow' | 'modelSettings'
  > = getInitialSettings(),
): number | undefined {
  const targetKey = canonicalEffortModelKey(model)
  let matched: 'auto' | number | undefined
  for (const [rawKey, entry] of Object.entries(settings.modelSettings ?? {})) {
    const win = entry?.autoCompactWindow
    if (win === undefined) continue
    const canonical = canonicalEffortModelKey(rawKey)
    if (canonical !== targetKey) continue
    if (rawKey === canonical) {
      matched = win
      break
    }
    matched ??= win
  }
  if (matched !== undefined) {
    return matched === 'auto' ? undefined : matched
  }
  return settings.autoCompactWindow
}

/**
 * densable Nq core (env → settings → auto). Full clientdata/experiment tables
 * are optional product surfaces; env + settings + model max match the command.
 */
export function resolveAutoCompactWindow(
  model: string,
  settingsWindow: number | undefined = resolvePerModelSettingsAutoCompactWindow(
    model,
  ),
): ResolvedAutoCompactWindow {
  const modelMax = getContextWindowForModel(model, getSdkBetas())

  const envOverride = resolveAutoCompactWindowOverride()
  if (envOverride !== null) {
    const warning = getAutoCompactWindowEnvWarning()
    if (warning) {
      logForDebugging(`[autocompact] ${warning}`, { level: 'warn' })
    }
    const configured = Math.max(AUTO_COMPACT_WINDOW_MIN, envOverride)
    return {
      window: Math.min(modelMax, configured),
      configured,
      source: 'env',
    }
  }
  const ignoredWarning = getAutoCompactWindowEnvWarning()
  if (ignoredWarning) {
    logForDebugging(`[autocompact] ${ignoredWarning}`, { level: 'warn' })
  }

  if (settingsWindow !== undefined) {
    return {
      window: Math.min(modelMax, settingsWindow),
      configured: settingsWindow,
      source: 'settings',
    }
  }

  const sessionWindows = getSessionAutoCompactWindows()
  const canonicalModel = getCanonicalName(model)
  const sessionWindow = Object.hasOwn(sessionWindows, model)
    ? sessionWindows[model]
    : Object.hasOwn(sessionWindows, canonicalModel)
      ? sessionWindows[canonicalModel]
      : undefined
  if (typeof sessionWindow === 'number') {
    return {
      window: Math.min(modelMax, sessionWindow),
      configured: sessionWindow,
      source: 'settings',
    }
  }

  // densable 2.1.247 I8o / EL model-default (after env/settings; skip
  // clientdata/experiment — those helpers are not this bullet).
  const modelDefault = lookupModelAutoCompactWindow(model)
  if (modelDefault !== undefined) {
    return {
      window: Math.min(modelMax, modelDefault),
      configured: modelDefault,
      source: 'model-default',
    }
  }

  let autoCompactEnabled = true
  try {
    const { isAutoCompactEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/compact/autoCompact.js') as typeof import('../services/compact/autoCompact.js')
    autoCompactEnabled = isAutoCompactEnabled()
  } catch {
    autoCompactEnabled = true
  }

  if (
    autoCompactEnabled &&
    !isUnknownModelWindowEnforcementDisabled() &&
    !isRecognizedModelForWindowEnforcement(model)
  ) {
    return {
      window: modelMax,
      configured: modelMax,
      source: 'unknown-model',
    }
  }

  return {
    window: modelMax,
    configured: modelMax,
    source: 'auto',
  }
}

/**
 * densable tBo — spinner slot while compacting.
 * Null unless the resolved window source is experiment or clientdata and
 * the configured window is below the model context window. QPe (the
 * experiment table) is what makes those sources exist; this resolver
 * returns neither today, so the hint stays empty and Next still shows.
 */
export function compactSpinnerHintText(model: string): string | null {
  const resolved = resolveAutoCompactWindow(model)
  if (resolved.source !== 'experiment' && resolved.source !== 'clientdata') {
    return null
  }
  const contextWindow = getContextWindowForModel(model, getSdkBetas())
  if (resolved.configured >= contextWindow) return null
  const tokens = formatTokens(resolved.configured)
  return `Compacting at auto window (${tokens} tokens) · /autocompact to configure`
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
  persistSessionAutoCompactWindow(getCanonicalName(model), parsed)

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
