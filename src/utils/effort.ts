// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { isUltrathinkEnabled } from './thinking.js'
import { getInitialSettings } from './settings/settings.js'
import { isProSubscriber, isMaxSubscriber, isTeamSubscriber } from './auth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { getAPIProvider } from './model/providers.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { isAlwaysEnableEffortEnvEnabled } from './residualFinalEnvGates.js'
import type { EffortLevel } from 'src/entrypoints/sdk/runtimeTypes.js'
import { resolveAntModel } from './model/antModels.js'
import { getAntModelOverrideConfig } from './model/antModels.js'
import {
  isChatGPTAuthMode,
  isChatGPTCodexReasoningModel,
} from './model/chatgptModels.js'

export type { EffortLevel }

// NOTE: 'ultracode' is NOT an EffortLevel / EffortValue. densable session
// flag AppState.ultracode + effortValue xhigh enables standing Workflow
// orchestration (ultra_effort_* attachments). /effort ultracode is a command
// alias that sets that pair — the effort parameter sent to the API is still
// 'xhigh'.
export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly EffortLevel[]

export type EffortValue = EffortLevel | number

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports the effort parameter.
export function modelSupportsEffort(model: string): boolean {
  const m = model.toLowerCase()
  if (isAlwaysEnableEffortEnvEnabled()) {
    return true
  }
  const supported3P = get3PModelCapabilityOverride(model, 'effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  if (
    getAPIProvider() === 'openai' &&
    isChatGPTAuthMode() &&
    isChatGPTCodexReasoningModel(model)
  ) {
    return true
  }
  // Supported by a subset of Claude 4/5 models
  if (
    m.includes('opus-4-7') ||
    m.includes('opus-4-6') ||
    m.includes('sonnet-5') ||
    m.includes('sonnet-4-6') ||
    m.includes('deepseek-v4-pro')
  ) {
    return true
  }
  // Exclude any other known legacy models (haiku, older opus/sonnet variants)
  if (m.includes('haiku') || m.includes('sonnet') || m.includes('opus')) {
    return false
  }

  // IMPORTANT: Do not change the default effort support without notifying
  // the model launch DRI and research. This is a sensitive setting that can
  // greatly affect model quality and bashing.

  // Default to true for unknown model strings on 1P.
  // Do not default to true for 3P as they have different formats for their
  // model strings (ex. anthropics/claude-code#30795)
  return getAPIProvider() === 'firstParty'
}

// Effort max/xhigh restrictions removed — all models that support effort
// can now use these levels. API errors are the user's responsibility.
export function modelSupportsMaxEffort(_model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(_model, 'max_effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  return true
}

export function modelSupportsXhighEffort(_model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(_model, 'xhigh_effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  return true
}

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

export function parseEffortValue(value: unknown): EffortValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'number' && isValidNumericEffort(value)) {
    return value
  }
  // densable qlc — med → medium; jlc ultracode alias handled by callers via
  // parseEffortUltracodeAlias (UBn) so API effort stays xhigh not 'ultracode'.
  const str = String(value).toLowerCase()
  const aliased = str === 'med' ? 'medium' : str
  if (isEffortLevel(aliased)) {
    return aliased
  }
  const numericValue = parseInt(aliased, 10)
  if (!isNaN(numericValue) && isValidNumericEffort(numericValue)) {
    return numericValue
  }
  return undefined
}

/**
 * densable XLr — true when the raw effortLevel string is the ultracode alias.
 */
export function isEffortUltracodeAlias(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'ultracode'
}

/**
 * densable UBn — map ultracode effort alias → xhigh API level.
 * Returns undefined for non-alias inputs (callers use parseEffortValue first).
 */
export function parseEffortUltracodeAlias(
  value: unknown,
): EffortValue | undefined {
  return isEffortUltracodeAlias(value) ? 'xhigh' : undefined
}

/**
 * Numeric values are model-default only and not persisted.
 * 'max' is session-scoped for external users (ants can persist it).
 * Write sites call this before saving to settings so the Zod schema
 * (which only accepts string levels) never rejects a write.
 */
export function toPersistableEffort(
  value: EffortValue | undefined,
): EffortLevel | undefined {
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  ) {
    return value
  }
  if (value === 'max' && process.env.USER_TYPE === 'ant') {
    return value
  }
  return undefined
}

export function getInitialEffortSetting(): EffortLevel | undefined {
  // toPersistableEffort filters 'max' for non-ants on read, so a manually
  // edited settings.json doesn't leak session-scoped max into a fresh session.
  return toPersistableEffort(getInitialSettings().effortLevel)
}

/**
 * Decide what effort level (if any) to persist when the user selects a model
 * in ModelPicker. Keeps an explicit prior /effort choice sticky even when it
 * matches the picked model's default, while letting purely-default and
 * session-ephemeral effort (CLI --effort, EffortCallout default) fall through
 * to undefined so it follows future model-default changes.
 *
 * priorPersisted must come from userSettings on disk
 * (getSettingsForSource('userSettings')?.effortLevel), NOT merged settings
 * (project/policy layers would leak into the user's global settings.json)
 * and NOT AppState.effortValue (includes session-scoped sources that
 * deliberately do not write to settings.json).
 */
export function resolvePickerEffortPersistence(
  picked: EffortLevel | undefined,
  modelDefault: EffortLevel,
  priorPersisted: EffortLevel | undefined,
  toggledInPicker: boolean,
): EffortLevel | undefined {
  const hadExplicit = priorPersisted !== undefined || toggledInPicker
  return hadExplicit || picked !== modelDefault ? picked : undefined
}

export function getEffortEnvOverride(): EffortValue | null | undefined {
  // Official EFFORT_LEVEL densable pure parse (resolveEffortLevelOverride).
  let envOverride: string | null | undefined
  try {
    const { resolveEffortLevelOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    envOverride = resolveEffortLevelOverride()
  } catch {
    envOverride = process.env.CLAUDE_CODE_EFFORT_LEVEL?.toLowerCase() ?? null
  }
  if (envOverride === null || envOverride === undefined || envOverride === '') {
    return undefined
  }
  // auto/unset mapping densable at call sites — suppress effort param.
  if (envOverride === 'unset' || envOverride === 'auto') {
    return null
  }
  return parseEffortValue(envOverride)
}

/**
 * Resolve the effort value that will actually be sent to the API for a given
 * model, following the full precedence chain:
 *   env CLAUDE_CODE_EFFORT_LEVEL → appState.effortValue → model default
 *
 * Returns undefined when no effort parameter should be sent (env set to
 * 'unset', or no default exists for the model).
 */
export function resolveAppliedEffort(
  model: string,
  appStateEffortValue: EffortValue | undefined,
): EffortValue | undefined {
  const envOverride = getEffortEnvOverride()
  if (envOverride === null) {
    return undefined
  }
  return envOverride ?? appStateEffortValue ?? getDefaultEffortForModel(model)
}

/**
 * Resolve the effort level to show the user. Wraps resolveAppliedEffort
 * with the 'high' fallback (what the API uses when no effort param is sent).
 * Single source of truth for the status bar and /effort output (CC-1088).
 */
export function getDisplayedEffortLevel(
  model: string,
  appStateEffort: EffortValue | undefined,
): EffortLevel {
  const resolved = resolveAppliedEffort(model, appStateEffort) ?? 'high'
  return convertEffortValueToLevel(resolved)
}

/**
 * densable Dee — ultracode session active for ultra_effort attachments:
 * AppState.ultracode && workflows feature on && resolved effort === xhigh.
 */
export function isUltraEffortSessionActive(
  model: string,
  appStateEffort: EffortValue | undefined,
  ultracode: boolean | undefined,
): boolean {
  if (ultracode !== true) return false
  try {
    const { isWorkflowsFeatureEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./workflowDisableGate.js') as typeof import('./workflowDisableGate.js')
    if (!isWorkflowsFeatureEnabled()) return false
  } catch {
    return false
  }
  return resolveAppliedEffort(model, appStateEffort) === 'xhigh'
}

/** densable Lxd */
export const ULTRA_EFFORT_CONFIG = {
  TURNS_BETWEEN_MAINTENANCE: 10,
} as const

export type UltraEffortEnterAttachment = {
  type: 'ultra_effort_enter'
  reminderType: 'full' | 'sparse'
}

export type UltraEffortExitAttachment = {
  type: 'ultra_effort_exit'
}

export type UltraEffortAttachment =
  | UltraEffortEnterAttachment
  | UltraEffortExitAttachment

/**
 * densable zxd / A2y — user content that carries a tool_result block is a
 * tool-result turn, not a human turn for maintenance counting.
 */
function contentHasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      block =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'tool_result' &&
        typeof (block as { tool_use_id?: unknown }).tool_use_id === 'string',
    )
  )
}

type UltraEffortScanMessage = {
  type?: string
  isMeta?: boolean
  message?: { content?: unknown }
  attachment?: { type?: string; reminderType?: string }
}

/**
 * densable f2y — emit ultra_effort_enter (full / sparse) or ultra_effort_exit
 * based on session ultracode active state and recent message history.
 *
 * - active && never entered → full enter
 * - active && last was enter && ≥10 human turns since → sparse enter
 * - !active && last was enter → exit
 * - else → []
 */
export function getUltraEffortAttachments(
  messages: UltraEffortScanMessage[] | undefined,
  active: boolean,
): UltraEffortAttachment[] {
  let last: 'none' | 'enter' | 'exit' = 'none'
  let humanTurns = 0
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m === undefined) continue
      if (m.type === 'attachment') {
        const t = m.attachment?.type
        if (t === 'ultra_effort_enter') {
          last = 'enter'
          break
        }
        if (t === 'ultra_effort_exit') {
          last = 'exit'
          break
        }
      } else if (
        m.type === 'user' &&
        !m.isMeta &&
        !contentHasToolResult(m.message?.content)
      ) {
        humanTurns++
      }
    }
  }

  if (active) {
    if (last !== 'enter') {
      return [{ type: 'ultra_effort_enter', reminderType: 'full' }]
    }
    if (humanTurns >= ULTRA_EFFORT_CONFIG.TURNS_BETWEEN_MAINTENANCE) {
      return [{ type: 'ultra_effort_enter', reminderType: 'sparse' }]
    }
    return []
  }
  if (last === 'enter') {
    return [{ type: 'ultra_effort_exit' }]
  }
  return []
}

/** densable ultra_effort_enter / exit meta copy (messages.ts). */
export function buildUltraEffortEnterMessage(
  reminderType: 'full' | 'sparse',
): string {
  if (reminderType === 'full') {
    return "Ultracode is on: optimize for the most exhaustive, correct answer — not the fastest or cheapest. Use the Workflow tool on every substantive task; token cost is not a constraint. See the Workflow tool's **Ultracode** section and quality patterns. Solo only on conversational/trivial turns."
  }
  return 'Ultracode is still on — use the Workflow tool; see its Ultracode section.'
}

export function buildUltraEffortExitMessage(): string {
  return "Ultracode is off — the Workflow tool's standard opt-in rule applies again."
}

/**
 * Whether effort-related UI should be shown for the current model.
 *
 * OpenAI-compatible requests can carry explicit `reasoning_effort` even for
 * custom model strings, so an explicit env or session override must remain
 * visible in the UI even when the Claude-family heuristic cannot classify the
 * model as supporting effort.
 */
export function shouldShowEffortUI(
  model: string,
  appStateEffort: EffortValue | undefined,
): boolean {
  if (modelSupportsEffort(model)) {
    return true
  }
  if (getAPIProvider() === 'openai') {
    const envOverride = getEffortEnvOverride()
    return envOverride !== undefined || appStateEffort !== undefined
  }
  return false
}

/**
 * Build the ` with {level} effort` suffix shown in Logo/Spinner.
 * Returns empty string if the user hasn't explicitly set an effort value.
 * Delegates to resolveAppliedEffort() so the displayed level matches what
 * the API actually receives (including max→high clamp for non-Opus models).
 */
export function getEffortSuffix(
  model: string,
  effortValue: EffortValue | undefined,
): string {
  const envOverride = getEffortEnvOverride()
  if (effortValue === undefined && envOverride === undefined) return ''
  if (!shouldShowEffortUI(model, effortValue)) return ''
  const resolved = resolveAppliedEffort(model, effortValue)
  if (resolved === undefined) return ''
  return ` with ${convertEffortValueToLevel(resolved)} effort`
}

export function isValidNumericEffort(value: number): boolean {
  return Number.isInteger(value)
}

export function convertEffortValueToLevel(value: EffortValue): EffortLevel {
  if (typeof value === 'string') {
    // Runtime guard: value may come from remote config (GrowthBook) where
    // TypeScript types can't help us. Coerce unknown strings to 'high'
    // rather than passing them through unchecked.
    return isEffortLevel(value) ? value : 'high'
  }
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    if (value <= 50) return 'low'
    if (value <= 85) return 'medium'
    if (value <= 100) return 'high'
    return 'max'
  }
  return 'high'
}

/**
 * densable t3 — resolveAppliedEffort (cme) then level string (NDe), default high.
 */
export function resolveEffortLevelForModel(
  model: string,
  appStateEffort: EffortValue | undefined,
): EffortLevel {
  const resolved = resolveAppliedEffort(model, appStateEffort) ?? 'high'
  return convertEffortValueToLevel(resolved)
}

/**
 * densable y$ — analytics `effort_level` when modelSupportsEffort (kk); else
 * undefined (omit from event). Callers pass densable P_ effort when available.
 */
export function effortLevelForAnalytics(
  model: string,
  appStateEffort: EffortValue | undefined,
): EffortLevel | undefined {
  if (!modelSupportsEffort(model)) return undefined
  return resolveEffortLevelForModel(model, appStateEffort)
}

/**
 * Get user-facing description for effort levels
 *
 * @param level The effort level to describe
 * @returns Human-readable description
 */
export function getEffortLevelDescription(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return 'Quick, straightforward implementation with minimal overhead'
    case 'medium':
      return 'Balanced approach with standard implementation and testing'
    case 'high':
      return 'Comprehensive implementation with extensive testing and documentation'
    case 'xhigh':
      return 'Extended reasoning beyond high, short of max'
    case 'max':
      return 'Maximum capability with deepest reasoning'
  }
}

/**
 * Get user-facing description for effort values (both string and numeric)
 *
 * @param value The effort value to describe
 * @returns Human-readable description
 */
export function getEffortValueDescription(value: EffortValue): string {
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    return `[ANT-ONLY] Numeric effort value of ${value}`
  }

  if (typeof value === 'string') {
    return getEffortLevelDescription(value)
  }
  return 'Balanced approach with standard implementation and testing'
}

export type OpusDefaultEffortConfig = {
  enabled: boolean
  dialogTitle: string
  dialogDescription: string
}

const OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT: OpusDefaultEffortConfig = {
  enabled: true,
  dialogTitle: 'We recommend medium effort for Opus',
  dialogDescription:
    'Effort determines how long Claude thinks for when completing your task. We recommend medium effort for most tasks to balance speed and intelligence and maximize rate limits. Use ultrathink to trigger high effort when needed.',
}

export function getOpusDefaultEffortConfig(): OpusDefaultEffortConfig {
  const config = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_grey_step2',
    OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
  )
  return {
    ...OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
    ...config,
  }
}

// @[MODEL LAUNCH]: Update the default effort levels for new models
export function getDefaultEffortForModel(
  model: string,
): EffortValue | undefined {
  if (process.env.USER_TYPE === 'ant') {
    const config = getAntModelOverrideConfig()
    const isDefaultModel =
      config?.defaultModel !== undefined &&
      model.toLowerCase() === (config.defaultModel as string).toLowerCase()
    if (isDefaultModel && config?.defaultModelEffortLevel) {
      return config.defaultModelEffortLevel as EffortValue
    }
    const antModel = resolveAntModel(model)
    if (antModel) {
      if (antModel.defaultEffortLevel) {
        return antModel.defaultEffortLevel
      }
      if (antModel.defaultEffortValue !== undefined) {
        return antModel.defaultEffortValue
      }
    }
    // Always default ants to undefined/high
    return undefined
  }

  // IMPORTANT: Do not change the default effort level without notifying
  // the model launch DRI and research. Default effort is a sensitive setting
  // that can greatly affect model quality and bashing.

  if (
    getAPIProvider() === 'openai' &&
    isChatGPTAuthMode() &&
    isChatGPTCodexReasoningModel(model)
  ) {
    return 'medium'
  }

  // Default effort on Opus 4.6 to medium for Pro.
  // Max/Team also get medium when the tengu_grey_step2 config is enabled.
  if (
    model.toLowerCase().includes('opus-4-7') ||
    model.toLowerCase().includes('opus-4-6')
  ) {
    if (isProSubscriber()) {
      return 'high'
    }
    if (
      getOpusDefaultEffortConfig().enabled &&
      (isMaxSubscriber() || isTeamSubscriber())
    ) {
      return 'high'
    }
  }

  // When ultrathink feature is on, default effort to medium (ultrathink bumps to high)
  if (isUltrathinkEnabled() && modelSupportsEffort(model)) {
    return 'medium'
  }

  // Fallback to undefined, which means we don't set an effort level. This
  // should resolve to high effort level in the API.
  return undefined
}
