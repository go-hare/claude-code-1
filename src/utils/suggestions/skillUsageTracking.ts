import { getGlobalConfig, saveGlobalConfig } from '../config.js'

const SKILL_USAGE_DEBOUNCE_MS = 60_000
const DAY_MS = 86_400_000

// Process-lifetime debounce cache — avoids lock + read + parse on debounced
// calls. Same pattern as lastConfigStatTime / globalConfigWriteCount in config.ts.
const lastWriteBySkill = new Map<string, number>()

type SkillUsageEntry = { usageCount: number; lastUsedAt: number }

function lookupUsage(
  usage: Record<string, SkillUsageEntry> | undefined,
  skillName: string,
  alias?: string,
): SkillUsageEntry | undefined {
  return usage?.[skillName] ?? (alias ? usage?.[alias] : undefined)
}

/**
 * Records a skill usage for ranking purposes.
 * Updates both usage count and last used timestamp.
 */
export function recordSkillUsage(skillName: string): void {
  const now = Date.now()
  const lastWrite = lastWriteBySkill.get(skillName)
  // The ranking algorithm uses a 7-day half-life, so sub-minute granularity
  // is irrelevant. Bail out before saveGlobalConfig to avoid lock + file I/O.
  if (lastWrite !== undefined && now - lastWrite < SKILL_USAGE_DEBOUNCE_MS) {
    return
  }
  lastWriteBySkill.set(skillName, now)
  saveGlobalConfig(current => {
    const existing = current.skillUsage?.[skillName]
    return {
      ...current,
      skillUsage: {
        ...current.skillUsage,
        [skillName]: {
          usageCount: (existing?.usageCount ?? 0) + 1,
          lastUsedAt: now,
        },
      },
    }
  })
}

/**
 * densable `rmo` — usage count + whole days since last use for /skill-doctor.
 * Looks up `skillName`, then optional unqualified alias.
 */
export function getSkillUsageSnapshot(
  skillName: string,
  alias?: string,
): { usageCount: number; daysSinceUse: number } | null {
  const usage = lookupUsage(getGlobalConfig().skillUsage, skillName, alias)
  if (!usage) return null
  return {
    usageCount: usage.usageCount,
    daysSinceUse: Math.floor((Date.now() - usage.lastUsedAt) / DAY_MS),
  }
}

/**
 * Calculates a usage score for a skill based on frequency and recency.
 * Higher scores indicate more frequently and recently used skills.
 *
 * The score uses exponential decay with a half-life of 7 days,
 * meaning usage from 7 days ago is worth half as much as usage today.
 */
export function getSkillUsageScore(skillName: string): number {
  const config = getGlobalConfig()
  const usage = config.skillUsage?.[skillName]
  if (!usage) return 0

  // Recency decay: halve score every 7 days
  const daysSinceUse = (Date.now() - usage.lastUsedAt) / DAY_MS
  const recencyFactor = 0.5 ** (daysSinceUse / 7)

  // Minimum recency factor of 0.1 to avoid completely dropping old but heavily used skills
  return usage.usageCount * Math.max(recencyFactor, 0.1)
}
