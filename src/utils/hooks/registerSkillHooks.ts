import { createHash } from 'crypto'
import { dirname } from 'path'
import { HOOK_EVENTS } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppState.js'
import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import type { HooksSettings } from '../settings/types.js'
import {
  addSessionHook,
  getSkillHookDraws,
  removeSessionHook,
} from './sessionHooks.js'

/** Upstream v2.1.304 `Idn = 1024`, `THr = 16384`, `Wt = 64`. */
export const MAX_SKILL_HOOKS_PER_SOURCE = 1024
export const MAX_SKILL_MATCHER_CHARS_PER_SOURCE = 16384
const MAX_UNFIT_SKILL_HOOK_TEXTS = 64

export type SkillHooksBoundsFailure = 'count' | 'characters' | 'matcher'

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

function hashSkillHookText(skillName: string, hooks: HooksSettings): string {
  return createHash('sha256')
    .update(`${skillName}\0${stableStringify(hooks)}`)
    .digest('hex')
}

export function checkSkillHooksBounds(
  sessionId: string,
  sourceKind: string,
  sourceId: string | undefined,
  skillName: string,
  hooks: HooksSettings,
): SkillHooksBoundsFailure | undefined {
  const draws = getSkillHookDraws(sessionId)
  const key = sourceId ?? sourceKind
  let entry = draws.get(key)
  if (!entry) {
    entry = { hooks: 0, characters: 0, texts: new Map(), unfitTexts: 0 }
    draws.set(key, entry)
  }

  const textHash = hashSkillHookText(skillName, hooks)
  if (entry.texts.has(textHash)) {
    return entry.texts.get(textHash)
  }

  let hooksAsked = 0
  let charsAsked = 0
  for (const matchers of Object.values(hooks)) {
    if (!matchers) continue
    for (const matcher of matchers) {
      const count = Math.max(1, matcher.hooks.length)
      hooksAsked += count
      charsAsked += (matcher.matcher?.length ?? 0) * count
    }
  }

  let failure: SkillHooksBoundsFailure | undefined
  if (entry.characters + charsAsked > MAX_SKILL_MATCHER_CHARS_PER_SOURCE) {
    failure = 'characters'
  } else if (entry.hooks + hooksAsked > MAX_SKILL_HOOKS_PER_SOURCE) {
    failure = 'count'
  }

  if (failure !== undefined) {
    if (entry.unfitTexts === MAX_UNFIT_SKILL_HOOK_TEXTS) {
      return failure
    }
    entry.unfitTexts++
  }

  entry.texts.set(textHash, failure)
  logEvent('tengu_skill_hooks_bounds_checked', {
    outcome: failure ?? 'fits',
    source_kind: sourceKind,
    hooks_asked: hooksAsked,
    characters_asked: charsAsked,
    hooks_drawn_before: entry.hooks,
    characters_drawn_before: entry.characters,
    hooks_bound: MAX_SKILL_HOOKS_PER_SOURCE,
    characters_bound: MAX_SKILL_MATCHER_CHARS_PER_SOURCE,
  } as never)

  if (failure === undefined) {
    entry.hooks += hooksAsked
    entry.characters += charsAsked
    return undefined
  }

  logForDebugging(
    `Skill '${skillName}' registers none of its hooks and grants no tools (${failure}): the skills of one source hold at most ${MAX_SKILL_HOOKS_PER_SOURCE} hooks and ${MAX_SKILL_MATCHER_CHARS_PER_SOURCE} characters of matchers in a session, and a cloud session tests some matchers only`,
    { level: 'warn' },
  )
  return failure
}

/**
 * Registers hooks from a skill's frontmatter as session hooks.
 *
 * Hooks are registered as session-scoped hooks that persist for the duration
 * of the session. If a hook has `once: true`, it will be automatically removed
 * after its first successful execution.
 *
 * @param setAppState - Function to update the app state
 * @param sessionId - The current session ID
 * @param hooks - The hooks settings from the skill's frontmatter
 * @param skillName - The name of the skill (for logging)
 * @param skillRoot - The base directory of the skill (for CLAUDE_PLUGIN_ROOT env var)
 */
export function registerSkillHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  hooks: HooksSettings,
  skillName: string,
  skillRoot?: string,
  options?: {
    sourceKind?: string
    sourceId?: string
  },
): SkillHooksBoundsFailure | undefined {
  const sourceKind = options?.sourceKind ?? 'skill'
  const sourceId =
    options?.sourceId ??
    (skillRoot !== undefined ? dirname(skillRoot) : undefined)
  const boundsFailure = checkSkillHooksBounds(
    sessionId,
    sourceKind,
    sourceId,
    skillName,
    hooks,
  )
  if (boundsFailure !== undefined) {
    return boundsFailure
  }

  let registeredCount = 0

  for (const eventName of HOOK_EVENTS) {
    const matchers = hooks[eventName]
    if (!matchers) continue

    for (const matcher of matchers) {
      for (const hook of matcher.hooks) {
        // For once: true hooks, use onHookSuccess callback to remove after execution
        const onHookSuccess = hook.once
          ? () => {
              logForDebugging(
                `Removing one-shot hook for event ${eventName} in skill '${skillName}'`,
              )
              removeSessionHook(setAppState, sessionId, eventName, hook, {
                skillRoot,
              })
            }
          : undefined

        addSessionHook(
          setAppState,
          sessionId,
          eventName,
          matcher.matcher || '',
          hook,
          onHookSuccess,
          skillRoot,
        )
        registeredCount++
      }
    }
  }

  if (registeredCount > 0) {
    logForDebugging(
      `Registered ${registeredCount} hooks from skill '${skillName}'`,
    )
  }
  return undefined
}
