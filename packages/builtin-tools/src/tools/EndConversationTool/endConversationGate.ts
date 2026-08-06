/**
 * densable 2.1.214 EndConversation enable/floor/flag helpers — extract 1:1.
 * Official: parseEndConversationFlagValue / modelMeetsEndConversationFloor /
 * isEndConversationToolEnabled / compileAllowedEntrypointsRegex.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { getMainLoopModel } from 'src/utils/model/model.js'
import { isSearchExtraToolsEnabledOptimistic } from 'src/utils/searchExtraTools.js'
import {
  END_CONVERSATION_GB_FLAG,
  END_CONVERSATION_TOOL_NAME,
  getEndConversationDeferredHint,
} from './prompt.js'

/** densable ety — model family floors (major.minor component vectors). */
export const END_CONVERSATION_MODEL_FLOORS: ReadonlyArray<
  readonly [string, readonly number[]]
> = [
  ['opus', [4, 8]],
  ['sonnet', [5]],
  ['fable', [5]],
  ['mythos', [5]],
]

/** densable _ms — default allowed entrypoints when flag is bare true. */
export const END_CONVERSATION_DEFAULT_ENTRYPOINTS = /^cli$/i

export type EndConversationFlagValue = {
  enabled: boolean
  allowedEntrypoints: RegExp
}

/**
 * densable Dqu — compile GrowthBook `scope` string into anchored case-insensitive
 * alternation. Invalid patterns fall back to null (caller uses default).
 */
export function compileAllowedEntrypointsRegex(scope: unknown): RegExp | null {
  if (typeof scope !== 'string') return null
  try {
    // Validate the user pattern first (throws on invalid syntax).
    // eslint-disable-next-line no-new
    new RegExp(scope)
    return new RegExp(`^(?:${scope})$`, 'i')
  } catch {
    return null
  }
}

/**
 * densable Pqu — parse GrowthBook feature payload.
 * - `true` → enabled, default entrypoints
 * - `{ scope?: string }` → enabled, compiled scope or default
 * - anything else → disabled
 */
export function parseEndConversationFlagValue(
  value: unknown,
): EndConversationFlagValue {
  if (value === true) {
    return {
      enabled: true,
      allowedEntrypoints: END_CONVERSATION_DEFAULT_ENTRYPOINTS,
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const scope = (value as { scope?: unknown }).scope
    return {
      enabled: true,
      allowedEntrypoints:
        compileAllowedEntrypointsRegex(scope) ??
        END_CONVERSATION_DEFAULT_ENTRYPOINTS,
    }
  }
  return {
    enabled: false,
    allowedEntrypoints: END_CONVERSATION_DEFAULT_ENTRYPOINTS,
  }
}

/**
 * densable Iqu/Rqu — `claude-<family>-<version>` meets floor vector.
 * Version components compared left-to-right; missing components treated as 0.
 */
export function modelMeetsEndConversationFloor(
  model: string,
  floors: ReadonlyArray<
    readonly [string, readonly number[]]
  > = END_CONVERSATION_MODEL_FLOORS,
): boolean {
  // Strip common date / revision suffixes so claude-opus-4-8-20260… still matches.
  const normalized = model
    .replace(/@.*$/, '')
    .replace(/-\d{8}(?:[a-z].*)?$/i, '')
    .trim()
  const m = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(normalized)
  const family = m?.[1]
  const versionStr = m?.[2]
  if (!family || !versionStr) return false
  const floor = floors.find(([name]) => name === family)?.[1]
  if (!floor) return false
  const parts = versionStr.split('-').map(Number)
  for (let i = 0; i < Math.max(parts.length, floor.length); i++) {
    const delta = (parts[i] ?? 0) - (floor[i] ?? 0)
    if (delta !== 0) return delta > 0
  }
  return true
}

/**
 * densable eKn — always false in 2.1.214 product binary (hard-disable stub).
 * Kept as a named function so future densable wiring can flip it without
 * rewriting call sites.
 */
export function isEndConversationHardDisabled(): boolean {
  return false
}

function getClaudeCodeEntrypoint(): string | undefined {
  return process.env.CLAUDE_CODE_ENTRYPOINT
}

/**
 * densable _fo — full enable gate:
 * entrypoint present + model floor + GB flag + entrypoint regex + !hardDisable.
 */
export function isEndConversationToolEnabled(
  model: string = getMainLoopModel(),
): boolean {
  const entrypoint = getClaudeCodeEntrypoint()
  if (entrypoint === undefined) return false
  if (!modelMeetsEndConversationFloor(model)) return false
  const { enabled, allowedEntrypoints } = parseEndConversationFlagValue(
    getFeatureValue_CACHED_MAY_BE_STALE(END_CONVERSATION_GB_FLAG, false),
  )
  if (isEndConversationHardDisabled()) return false
  return enabled && allowedEntrypoints.test(entrypoint)
}

/**
 * densable tty / getDeferredHintSection — one-line deferred-tool announcement
 * when the tool is enabled and tool-search (deferred loading) is active.
 */
export function getEndConversationDeferredHintSection(
  model: string = getMainLoopModel(),
): string | null {
  if (!isEndConversationToolEnabled(model)) return null
  if (!isSearchExtraToolsEnabledOptimistic()) return null
  return getEndConversationDeferredHint(END_CONVERSATION_TOOL_NAME)
}
