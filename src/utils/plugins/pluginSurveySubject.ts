/**
 * densable Y0f / Jae — pick a plugin feedback survey subject from drained
 * session activity (sJ / Wwt), with per-plugin cooldowns and scope filters.
 */
import { createHash } from 'crypto'
import type {
  PluginActivityEntry,
  PluginActivityTrigger,
} from './pluginActivity.js'
import { isOfficialMarketplaceName } from './pluginIdentifier.js'

/** densable UGo defaults (GrowthBook may raise probability). */
export const DEFAULT_PLUGIN_SURVEY_CONFIG = {
  probability: 0,
  minTimeBetweenGlobalMs: 86_400_000, // 1 day
  minTimeBetweenPerPluginMs: 604_800_000, // 7 days
  enabledTriggers: [
    'skill',
    'subagent',
    'command',
    'mcp',
  ] as PluginActivityTrigger[],
  /** densable enabledScopes; undefined = all scopes allowed. */
  enabledScopes: undefined as PluginSurveyScope[] | undefined,
}

export type PluginSurveyConfig = {
  probability: number
  minTimeBetweenGlobalMs: number
  minTimeBetweenPerPluginMs: number
  enabledTriggers: PluginActivityTrigger[]
  enabledScopes?: PluginSurveyScope[]
}

export type PluginSurveyScope =
  | 'default-bundle'
  | 'official'
  | 'community'
  | 'org'
  | 'user-local'

export type PluginSurveySubject = {
  name: string
  marketplace: string | undefined
  trigger: PluginActivityTrigger
}

const TELEMETRY_SALT = 'claude-plugin-telemetry-v1'

/**
 * densable Jae / b7t: short hash for per-plugin survey pacing keys.
 * marketplace is lowercased when present (`name@marketplace`).
 */
export function pluginSurveyKeyHash(
  name: string,
  marketplace: string | undefined,
): string {
  const raw = marketplace ? `${name}@${marketplace.toLowerCase()}` : name
  return createHash('sha256')
    .update(raw + TELEMETRY_SALT)
    .digest('hex')
    .slice(0, 16)
}

/**
 * densable E6e simplified: classify plugin scope for enabledScopes filter.
 * orgPluginNames: policySettings enabledPlugins names with @ (SP()).
 */
export function classifyPluginSurveyScope(
  name: string,
  marketplace: string | undefined,
  orgPluginNames: Set<string> | null,
): PluginSurveyScope {
  if (marketplace === 'builtin') return 'default-bundle'
  if (isOfficialMarketplaceName(marketplace)) return 'official'
  // densable community marketplaces — local residual keeps official-only special;
  // unknown third-party marketplaces fall through to user-local unless org.
  if (orgPluginNames?.has(name)) return 'org'
  return 'user-local'
}

/**
 * densable Y0f: walk drained activity newest→oldest; first eligible subject
 * with least-recent (or never) per-plugin show time wins among candidates
 * that pass trigger/scope/cooldown filters.
 */
export function selectPluginSurveySubject(
  activities: readonly PluginActivityEntry[],
  config: PluginSurveyConfig,
  perPluginLastShown: Record<string, number>,
  orgPluginNames: Set<string> | null,
  now: number,
): PluginSurveySubject | null {
  const enabledTriggers = new Set(config.enabledTriggers)
  const enabledScopes =
    config.enabledScopes && config.enabledScopes.length > 0
      ? new Set(config.enabledScopes)
      : null
  let best: { subject: PluginSurveySubject; lastShown: number } | null = null
  const seen = new Set<string>()

  for (let i = activities.length - 1; i >= 0; i--) {
    const entry = activities[i]
    if (!entry) continue
    if (!enabledTriggers.has(entry.trigger)) continue
    if (enabledScopes) {
      const scope = classifyPluginSurveyScope(
        entry.name,
        entry.marketplace,
        orgPluginNames,
      )
      if (!enabledScopes.has(scope)) continue
    }
    const key = pluginSurveyKeyHash(entry.name, entry.marketplace)
    if (seen.has(key)) continue
    seen.add(key)
    const lastShown = perPluginLastShown[key] ?? 0
    if (now - lastShown < config.minTimeBetweenPerPluginMs) continue
    if (best === null || lastShown < best.lastShown) {
      best = {
        subject: {
          name: entry.name,
          marketplace: entry.marketplace,
          trigger: entry.trigger,
        },
        lastShown,
      }
    }
  }
  return best?.subject ?? null
}

/** densable survey prompt: strip ANSI + control chars from plugin name. */
export function formatPluginSurveyMessage(
  subject: PluginSurveySubject | null,
): string {
  if (!subject) return 'How helpful has this plugin been? (optional)'
  let name = subject.name
  try {
    // Bun.stripANSI when available (runtime)
    const strip = (globalThis as { Bun?: { stripANSI?: (s: string) => string } })
      .Bun?.stripANSI
    if (strip) name = strip(name)
  } catch {
    // ignore
  }
  name = name.replace(/[\x00-\x1f\x7f-\x9f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
  return `How helpful has the ${name} plugin been? (optional)`
}
