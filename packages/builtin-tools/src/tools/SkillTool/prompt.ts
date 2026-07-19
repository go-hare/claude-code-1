import { memoize } from 'lodash-es'
import type { Command } from 'src/commands.js'
import {
  getCommandName,
  getSkillToolCommands,
  getSlashCommandToolSkills,
} from 'src/commands.js'
import { COMMAND_NAME_TAG } from 'src/constants/xml.js'
import { stringWidth } from '@anthropic/ink'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { count } from 'src/utils/array.js'
import { logForDebugging } from 'src/utils/debug.js'
import { toError } from 'src/utils/errors.js'
import { truncate } from 'src/utils/format.js'
import { logError } from 'src/utils/log.js'
import {
  getSkillDescReframeBody,
  isSkillDescReframeEnabled,
} from 'src/utils/systemPromptArms.js'

// densable kpg / Bru / Ipg / Hpg / jqi defaults
export const SKILL_BUDGET_CONTEXT_PERCENT = 0.01
export const CHARS_PER_TOKEN = 4
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000
export const DEFAULT_CHAR_BUDGET = 8_000 // Fallback: 1% of 200k × 4

// Per-entry hard cap. The listing is for discovery only — the Skill tool loads
// full content on invoke, so verbose whenToUse strings waste turn-1 cache_creation
// tokens without improving match rate. Applies to all entries, including bundled,
// since the cap is generous enough to preserve the core use case.
// v2.1.117: raised from 250 → 1536 to allow richer skill descriptions.
export const MAX_LISTING_DESC_CHARS = 1536

/**
 * densable KAt — per-entry description cap from settings.skillListingMaxDescChars.
 */
export function getMaxListingDescChars(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getInitialSettings } =
      require('src/utils/settings/settings.js') as typeof import('src/utils/settings/settings.js')
    const n = getInitialSettings().skillListingMaxDescChars
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      return Math.floor(n)
    }
  } catch {
    // settings optional
  }
  return MAX_LISTING_DESC_CHARS
}

/**
 * densable Dpg — listing budget fraction from settings.skillListingBudgetFraction.
 */
export function getSkillListingBudgetFraction(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getInitialSettings } =
      require('src/utils/settings/settings.js') as typeof import('src/utils/settings/settings.js')
    const n = getInitialSettings().skillListingBudgetFraction
    if (typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1) {
      return n
    }
  } catch {
    // settings optional
  }
  return SKILL_BUDGET_CONTEXT_PERCENT
}

/** densable YAt — char budget for skill listing. */
export function getCharBudget(contextWindowTokens?: number): number {
  const envBudget = Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET)
  if (envBudget) {
    return envBudget
  }
  const fraction = getSkillListingBudgetFraction()
  const tokens = contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS
  return Math.max(1, Math.floor(tokens * CHARS_PER_TOKEN * fraction))
}

function getCommandDescription(cmd: Command): string {
  const desc = cmd.whenToUse
    ? `${cmd.description} - ${cmd.whenToUse}`
    : cmd.description
  const cap = getMaxListingDescChars()
  return desc.length > cap ? desc.slice(0, cap - 1) + '\u2026' : desc
}

function formatCommandDescription(cmd: Command): string {
  // Debug: log if userFacingName differs from cmd.name for plugin skills
  const displayName = getCommandName(cmd)
  if (
    cmd.name !== displayName &&
    cmd.type === 'prompt' &&
    cmd.source === 'plugin'
  ) {
    logForDebugging(
      `Skill prompt: showing "${cmd.name}" (userFacingName="${displayName}")`,
    )
  }

  return `- ${cmd.name}: ${getCommandDescription(cmd)}`
}

const MIN_DESC_LENGTH = 20

/**
 * densable KOe name-only set for listing (Vqi). Best-effort — if settings
 * unavailable, treat as empty (all full descriptions).
 */
function getNameOnlySkillNames(commands: Command[]): Set<string> {
  const names = new Set<string>()
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSkillOverrideMode } =
      require('src/utils/residualFinalEnvGates.js') as typeof import('src/utils/residualFinalEnvGates.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getInitialSettings } =
      require('src/utils/settings/settings.js') as typeof import('src/utils/settings/settings.js')
    let skillOverrides:
      | Readonly<
          Record<
            string,
            import('src/utils/residualFinalEnvGates.js').SkillOverrideMode
          >
        >
      | undefined
    let settingsDisableBundledSkills: boolean | undefined
    try {
      const settings = getInitialSettings()
      skillOverrides = settings.skillOverrides
      settingsDisableBundledSkills = settings.disableBundledSkills
    } catch {
      // settings optional
    }
    for (const cmd of commands) {
      const mode = resolveSkillOverrideMode(cmd, {
        skillOverrides,
        settingsDisableBundledSkills,
      })
      if (mode === 'name-only') names.add(cmd.name)
    }
  } catch {
    // residual optional
  }
  return names
}

export function formatCommandsWithinBudget(
  commands: Command[],
  contextWindowTokens?: number,
): string {
  if (commands.length === 0) return ''

  const budget = getCharBudget(contextWindowTokens)
  // densable Vqi: name-only skills always list as `- name` (no description).
  const nameOnly = getNameOnlySkillNames(commands)

  // Try full descriptions first (name-only forced to names-only entry)
  const fullEntries = commands.map(cmd => ({
    cmd,
    full: nameOnly.has(cmd.name)
      ? `- ${cmd.name}`
      : formatCommandDescription(cmd),
  }))
  // join('\n') produces N-1 newlines for N entries
  const fullTotal =
    fullEntries.reduce((sum, e) => sum + stringWidth(e.full), 0) +
    (fullEntries.length - 1)

  if (fullTotal <= budget) {
    return fullEntries.map(e => e.full).join('\n')
  }

  // densable Vqi over-budget warn (when not env-forced budget)
  logForDebugging(
    `Skill listing over budget: ${commands.length} skills, ${fullTotal} chars > ${budget} budget — descriptions will be truncated. Run /skills to disable some, or raise skillListingBudgetFraction in settings.`,
  )

  // Partition into bundled/name-only (never truncated) and rest
  const bundledIndices = new Set<number>()
  const restCommands: Command[] = []
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    if (nameOnly.has(cmd.name)) {
      bundledIndices.add(i) // treat as preserved (already name-only)
    } else if (cmd.type === 'prompt' && cmd.source === 'bundled') {
      bundledIndices.add(i)
    } else {
      restCommands.push(cmd)
    }
  }

  // Compute space used by bundled/name-only skills (always preserved)
  const bundledChars = fullEntries.reduce(
    (sum, e, i) =>
      bundledIndices.has(i) ? sum + stringWidth(e.full) + 1 : sum,
    0,
  )
  const remainingBudget = budget - bundledChars

  // Calculate max description length for non-bundled commands
  if (restCommands.length === 0) {
    return fullEntries.map(e => e.full).join('\n')
  }

  const restNameOverhead =
    restCommands.reduce((sum, cmd) => sum + stringWidth(cmd.name) + 4, 0) +
    (restCommands.length - 1)
  const availableForDescs = remainingBudget - restNameOverhead
  const maxDescLen = Math.floor(availableForDescs / restCommands.length)

  if (maxDescLen < MIN_DESC_LENGTH) {
    // Extreme case: non-bundled go names-only, bundled/name-only keep their form
    if (process.env.USER_TYPE === 'ant') {
      logEvent('tengu_skill_descriptions_truncated', {
        skill_count: commands.length,
        budget,
        full_total: fullTotal,
        truncation_mode:
          'names_only' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        max_desc_length: maxDescLen,
        bundled_count: bundledIndices.size,
        bundled_chars: bundledChars,
      })
    }
    return commands
      .map((cmd, i) =>
        bundledIndices.has(i) ? fullEntries[i]!.full : `- ${cmd.name}`,
      )
      .join('\n')
  }

  // Truncate non-bundled descriptions to fit within budget
  const truncatedCount = count(
    restCommands,
    cmd => stringWidth(getCommandDescription(cmd)) > maxDescLen,
  )
  if (process.env.USER_TYPE === 'ant') {
    logEvent('tengu_skill_descriptions_truncated', {
      skill_count: commands.length,
      budget,
      full_total: fullTotal,
      truncation_mode:
        'description_trimmed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      max_desc_length: maxDescLen,
      truncated_count: truncatedCount,
      // Count of bundled skills included in this prompt (excludes skills with disableModelInvocation)
      bundled_count: bundledIndices.size,
      bundled_chars: bundledChars,
    })
  }
  return commands
    .map((cmd, i) => {
      // Bundled / name-only skills keep their precomputed entry
      if (bundledIndices.has(i)) return fullEntries[i]!.full
      const description = getCommandDescription(cmd)
      return `- ${cmd.name}: ${truncate(description, maxDescLen)}`
    })
    .join('\n')
}

export const getPrompt = memoize(async (_cwd: string): Promise<string> => {
  // Official skill_desc_reframe arm: denser Skill tool description emphasizing
  // exact names, directory-scoped variants, and no inventing skill names.
  if (isSkillDescReframeEnabled()) {
    return getSkillDescReframeBody(COMMAND_NAME_TAG)
  }
  return `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - \`skill: "pdf"\` - invoke the pdf skill
  - \`skill: "commit", args: "-m 'Fix bug'"\` - invoke with arguments
  - \`skill: "review-pr", args: "123"\` - invoke with arguments
  - \`skill: "ms-office-suite:pdf"\` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <${COMMAND_NAME_TAG}> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
`
})

export async function getSkillToolInfo(cwd: string): Promise<{
  totalCommands: number
  includedCommands: number
}> {
  const agentCommands = await getSkillToolCommands(cwd)

  return {
    totalCommands: agentCommands.length,
    includedCommands: agentCommands.length,
  }
}

// Returns the commands included in the SkillTool prompt.
// All commands are always included (descriptions may be truncated to fit budget).
// Used by analyzeContext to count skill tokens.
export function getLimitedSkillToolCommands(cwd: string): Promise<Command[]> {
  return getSkillToolCommands(cwd)
}

export function clearPromptCache(): void {
  getPrompt.cache?.clear?.()
}

export async function getSkillInfo(cwd: string): Promise<{
  totalSkills: number
  includedSkills: number
}> {
  try {
    const skills = await getSlashCommandToolSkills(cwd)

    return {
      totalSkills: skills.length,
      includedSkills: skills.length,
    }
  } catch (error) {
    logError(toError(error))

    // Return zeros rather than throwing - let caller decide how to handle
    return {
      totalSkills: 0,
      includedSkills: 0,
    }
  }
}
