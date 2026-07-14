/**
 * Official totalTokensReminder (AVn / RPe / wVn / PZc / HZc / DZc portable).
 *
 * Emits `<total_tokens>N tokens left</total_tokens>` as a total_tokens_reminder
 * attachment after tool-result batches (and optionally after each user turn).
 * Mode resolution: env > settings > GrowthBook (`tengu_lapis_anchor*`) > off.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { getInitialSettings } from './settings/settings.js'

export const TOTAL_TOKENS_REMINDER_MODES = [
  'off',
  'infinite',
  'fixed',
  'countdown',
  'padded-countdown',
] as const

export type TotalTokensReminderMode =
  (typeof TOTAL_TOKENS_REMINDER_MODES)[number]

/** Official Itg — fixed-mode display value. */
export const TOTAL_TOKENS_REMINDER_FIXED = 5_000_000

/** Official kZc — default padded-countdown budget. */
export const TOTAL_TOKENS_REMINDER_BUDGET_DEFAULT = 15_000_000

const sessionUsedAtAnchorByScope = new Map<string, number>()
const peakTaskUsedByScope = new Map<string, number>()

export function isTotalTokensReminderMode(
  value: unknown,
): value is TotalTokensReminderMode {
  return (
    typeof value === 'string' &&
    (TOTAL_TOKENS_REMINDER_MODES as readonly string[]).includes(value)
  )
}

/**
 * Official RPe — resolve mode: env > settings > GB `tengu_lapis_anchor` > off.
 */
export function resolveTotalTokensReminderMode(
  env: NodeJS.ProcessEnv = process.env,
  settingsMode?: unknown,
  gbMode?: unknown,
): TotalTokensReminderMode {
  const fromEnv = env.CLAUDE_CODE_TOTAL_TOKENS_REMINDER
  if (isTotalTokensReminderMode(fromEnv)) return fromEnv
  if (isTotalTokensReminderMode(settingsMode)) return settingsMode
  if (isTotalTokensReminderMode(gbMode)) return gbMode
  return 'off'
}

/**
 * Official wVn — budget for padded-countdown.
 * env (numeric) > settings > GB `tengu_lapis_anchor_budget` > 15_000_000.
 */
export function resolveTotalTokensReminderBudget(
  env: NodeJS.ProcessEnv = process.env,
  settingsBudget?: unknown,
  gbBudget?: unknown,
): number {
  const fromEnv = Number(env.CLAUDE_CODE_TOTAL_TOKENS_REMINDER_BUDGET)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv)
  if (
    typeof settingsBudget === 'number' &&
    Number.isFinite(settingsBudget) &&
    settingsBudget > 0
  ) {
    return Math.floor(settingsBudget)
  }
  if (
    typeof gbBudget === 'number' &&
    Number.isFinite(gbBudget) &&
    gbBudget > 0
  ) {
    return Math.floor(gbBudget)
  }
  return TOTAL_TOKENS_REMINDER_BUDGET_DEFAULT
}

/**
 * Official PZc — after-user-turn emit / re-anchor.
 * env > settings > GB `tengu_lapis_anchor_user_turn` > false.
 */
export function resolveTotalTokensReminderAfterUserTurn(
  env: NodeJS.ProcessEnv = process.env,
  settingsFlag?: unknown,
  gbFlag?: unknown,
): boolean {
  const raw = env.CLAUDE_CODE_TOTAL_TOKENS_REMINDER_AFTER_USER_TURN
  if (raw !== undefined) {
    if (isEnvTruthy(raw)) return true
    if (isEnvDefinedFalsy(raw)) return false
    // Non-empty unknown string: treat as defined-truthy only via isEnvTruthy.
    return isEnvTruthy(raw)
  }
  if (typeof settingsFlag === 'boolean') return settingsFlag
  if (typeof gbFlag === 'boolean') return gbFlag
  return false
}

/** Live resolve from env + settings + GrowthBook (official memoized path). */
export function getTotalTokensReminderMode(): TotalTokensReminderMode {
  const settings = getInitialSettings()
  return resolveTotalTokensReminderMode(
    process.env,
    settings.totalTokensReminder,
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_lapis_anchor', 'off'),
  )
}

export function getTotalTokensReminderBudget(): number {
  const settings = getInitialSettings()
  return resolveTotalTokensReminderBudget(
    process.env,
    settings.totalTokensReminderBudget,
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_lapis_anchor_budget',
      TOTAL_TOKENS_REMINDER_BUDGET_DEFAULT,
    ),
  )
}

export function getTotalTokensReminderAfterUserTurn(): boolean {
  const settings = getInitialSettings()
  return resolveTotalTokensReminderAfterUserTurn(
    process.env,
    settings.totalTokensReminderAfterUserTurn,
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_lapis_anchor_user_turn', false),
  )
}

/**
 * Official HZc — re-anchor padded-countdown task budget at a user-turn boundary.
 * Stores session-used-at-anchor and clears peak task-used for the scope.
 */
export function reanchorTotalTokensReminder(
  scopeId: string,
  sessionUsedTokens: number,
): void {
  sessionUsedAtAnchorByScope.set(scopeId, sessionUsedTokens)
  peakTaskUsedByScope.set(scopeId, 0)
}

/**
 * Official DZc — peak task-used since last re-anchor for the scope.
 * taskUsed = (sessionUsed - anchoredSessionUsed), peak is max over time.
 */
export function peakTaskUsedSinceAnchor(
  scopeId: string,
  sessionUsedTokens: number,
): number {
  const anchored = sessionUsedAtAnchorByScope.get(scopeId) ?? 0
  const taskUsed = sessionUsedTokens - anchored
  const prev = peakTaskUsedByScope.get(scopeId) ?? 0
  const peak = Math.max(prev, taskUsed)
  peakTaskUsedByScope.set(scopeId, peak)
  return peak
}

/** Test helper — clear process-local maps. */
export function resetTotalTokensReminderStateForTests(): void {
  sessionUsedAtAnchorByScope.clear()
  peakTaskUsedByScope.clear()
}

/**
 * Official AVn — fence body for a mode + remaining (countdown/padded only).
 * infinite → "Infinite"; fixed → 5000000; else Math.max(0, remaining).
 */
export function formatTotalTokensReminderText(
  mode: TotalTokensReminderMode,
  remaining: number = 0,
): string {
  const value =
    mode === 'infinite'
      ? 'Infinite'
      : mode === 'fixed'
        ? String(TOTAL_TOKENS_REMINDER_FIXED)
        : String(Math.max(0, Math.floor(remaining)))
  return `<total_tokens>${value} tokens left</total_tokens>`
}

export type TotalTokensReminderAttachment = {
  type: 'total_tokens_reminder'
  text: string
}

/**
 * Official EFy — build attachment list for current mode.
 * @param reanchor when true (after-user-turn path), re-anchor padded-countdown first.
 */
export function buildTotalTokensReminderAttachments(input: {
  mode?: TotalTokensReminderMode
  sessionUsedTokens: number
  contextWindowTokens: number
  scopeId?: string
  reanchor?: boolean
  budget?: number
}): TotalTokensReminderAttachment[] {
  const mode = input.mode ?? getTotalTokensReminderMode()
  if (mode === 'off') return []

  const scopeId = input.scopeId ?? 'main'
  if (input.reanchor) {
    reanchorTotalTokensReminder(scopeId, input.sessionUsedTokens)
  }

  let remaining = 0
  if (mode === 'countdown') {
    remaining = input.contextWindowTokens - input.sessionUsedTokens
  } else if (mode === 'padded-countdown') {
    const budget = input.budget ?? getTotalTokensReminderBudget()
    const peak = peakTaskUsedSinceAnchor(scopeId, input.sessionUsedTokens)
    remaining = budget - peak
  }

  return [
    {
      type: 'total_tokens_reminder',
      text: formatTotalTokensReminderText(mode, remaining),
    },
  ]
}

/**
 * Official system-prompt section for totalTokensReminder (pre-attachment path).
 * When mode is off or CLAUDE_CODE_SIMPLE is set, returns null.
 * For padded-countdown uses the configured budget as the remaining display
 * (session peak is tracked only on attachment path).
 */
export function buildTotalTokensSystemPromptSection(input: {
  mode?: TotalTokensReminderMode
  contextWindowTokens: number
  sessionUsedTokens?: number
  budget?: number
  simpleMode?: boolean
}): string | null {
  if (input.simpleMode) return null
  const mode = input.mode ?? getTotalTokensReminderMode()
  if (mode === 'off') return null
  let remaining = 0
  if (mode === 'countdown') {
    remaining = input.contextWindowTokens - (input.sessionUsedTokens ?? 0)
  } else if (mode === 'padded-countdown') {
    remaining = input.budget ?? getTotalTokensReminderBudget()
  }
  return formatTotalTokensReminderText(mode, remaining)
}
