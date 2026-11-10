import { memoize } from 'lodash-es'
import type { Command } from 'src/commands.js'
import {
  getCommandName,
  getSlashCommandToolSkills,
  mergeSkillToolCommands,
} from 'src/commands.js'
import { COMMAND_NAME_TAG } from 'src/constants/xml.js'
import { stringWidth } from '@anthropic/ink'
import { logForDebugging } from 'src/utils/debug.js'
import { toError } from 'src/utils/errors.js'
import { logError } from 'src/utils/log.js'
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js'
import { resolveSkillOverrideMode } from 'src/utils/residualFinalEnvGates.js'
import { getInitialSettings } from 'src/utils/settings/settings.js'
import {
  getSkillDescReframeBody,
  isSkillDescReframeEnabled,
} from 'src/utils/systemPromptArms.js'

// Skill listing gets 1% of the context window (in characters)
export const SKILL_BUDGET_CONTEXT_PERCENT = 0.01
export const CHARS_PER_TOKEN = 4
export const DEFAULT_CHAR_BUDGET = 8_000 // Fallback: 1% of 200k × 4

// Per-entry hard cap. The listing is for discovery only — the Skill tool loads
// full content on invoke, so verbose whenToUse strings waste turn-1 cache_creation
// tokens without improving match rate. Applies to all entries, including bundled,
// since the cap is generous enough to preserve the core use case.
// v2.1.117: raised from 250 → 1536 to allow richer skill descriptions.
export const MAX_LISTING_DESC_CHARS = 1536

function getSkillListingMaxDescChars(): number {
  try {
    return (
      (getInitialSettings() as { skillListingMaxDescChars?: number })
        .skillListingMaxDescChars ?? MAX_LISTING_DESC_CHARS
    )
  } catch {
    return MAX_LISTING_DESC_CHARS
  }
}

function getSkillListingBudgetFraction(): number {
  try {
    return (
      (getInitialSettings() as { skillListingBudgetFraction?: number })
        .skillListingBudgetFraction ?? SKILL_BUDGET_CONTEXT_PERCENT
    )
  } catch {
    return SKILL_BUDGET_CONTEXT_PERCENT
  }
}

export function getCharBudget(
  contextWindowTokens?: number,
  charsPerToken: number = CHARS_PER_TOKEN,
): number {
  const envBudget = Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET)
  if (envBudget > 0) {
    return envBudget
  }
  const fraction = getSkillListingBudgetFraction()
  const raw = (contextWindowTokens ?? 200_000) * charsPerToken * fraction
  return Math.max(1, Math.floor(raw))
}

function getCommandDescription(cmd: Command): string {
  const desc = cmd.whenToUse
    ? `${cmd.description} - ${cmd.whenToUse}`
    : cmd.description
  const maxChars = getSkillListingMaxDescChars()
  return desc.length > maxChars ? desc.slice(0, maxChars - 1) + '…' : desc
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

function isCommandNameOnly(cmd: Command): boolean {
  try {
    const settings = getInitialSettings()
    return (
      resolveSkillOverrideMode(cmd, {
        skillOverrides: settings.skillOverrides,
        settingsDisableBundledSkills: settings.disableBundledSkills,
      }) === 'name-only'
    )
  } catch {
    return false
  }
}

/**
 * Official `Len(commands, rankFn, contextWindowTokens, charsPerToken)`.
 * Also supports `(commands, contextWindowTokens)` for callers that omit `rankFn`.
 */
export function formatCommandsWithinBudget(
  commands: Command[],
  contextWindowTokensOrRankFn?: number | ((cmd: Command) => number),
  contextWindowTokens?: number,
  charsPerToken: number = CHARS_PER_TOKEN,
): string {
  if (commands.length === 0) return ''

  const rankFn: (cmd: Command) => number =
    typeof contextWindowTokensOrRankFn === 'function'
      ? contextWindowTokensOrRankFn
      : () => 0
  const resolvedContextTokens =
    typeof contextWindowTokensOrRankFn === 'number'
      ? contextWindowTokensOrRankFn
      : contextWindowTokens

  const budget = getCharBudget(resolvedContextTokens, charsPerToken)

  const nameOnlyIndices = new Set<number>()
  const fullEntries = commands.map((cmd, i) => {
    if (isCommandNameOnly(cmd)) {
      nameOnlyIndices.add(i)
      return { cmd, full: `- ${cmd.name}` }
    }
    return { cmd, full: formatCommandDescription(cmd) }
  })

  // join('\n') produces N-1 newlines for N entries
  const fullTotal =
    fullEntries.reduce((sum, e) => sum + stringWidth(e.full), 0) +
    (fullEntries.length - 1)

  if (fullTotal <= budget) {
    return fullEntries.map(e => e.full).join('\n')
  }

  logForDebugging(
    `Skill listing over budget: ${commands.length} skills, ${fullTotal} chars > ${budget} budget — descriptions will be truncated. Run /skills to disable some, or raise skillListingBudgetFraction in settings.`,
    { level: 'warn' },
  )

  const fixedIndices = new Set(nameOnlyIndices)
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    if (cmd.type === 'prompt' && cmd.source === 'bundled') {
      fixedIndices.add(i)
    }
  }

  const candidateIndices = commands
    .map((_, i) => i)
    .filter(i => !fixedIndices.has(i))
  if (candidateIndices.length === 0) {
    return fullEntries.map(e => e.full).join('\n')
  }

  const nameOnlyWidth = (i: number): number =>
    stringWidth(commands[i]!.name) + 2
  const fullWidth = (i: number): number => stringWidth(fullEntries[i]!.full)
  const baseUsed =
    commands.reduce(
      (sum, _, i) =>
        sum + (fixedIndices.has(i) ? fullWidth(i) : nameOnlyWidth(i)),
      0,
    ) +
    (commands.length - 1)
  let remaining = budget - baseUsed
  const keptFullIndices = new Set<number>()

  candidateIndices.sort((a, b) => rankFn(commands[b]!) - rankFn(commands[a]!))
  for (const i of candidateIndices) {
    const extra = fullWidth(i) - nameOnlyWidth(i)
    if (extra <= remaining) {
      keptFullIndices.add(i)
      remaining -= extra
    }
  }

  return commands
    .map((cmd, i) =>
      fixedIndices.has(i) || keptFullIndices.has(i)
        ? fullEntries[i]!.full
        : `- ${cmd.name}`,
    )
    .join('\n')
}

export const BASE_SKILL_PROMPT = `Invoke a skill.

A skill is a packaged set of instructions the user or project has set up for a particular kind of task (deploy steps, a review checklist, a repo-specific workflow). Available skills appear in a system-reminder listing with one-line descriptions. When the task at hand is one a listed skill covers, call this tool first — the skill's instructions load into the turn for you to follow in place of your default approach; some skills instead run in a subagent and return the finished result. A skill that runs in the background returns only the agent's name — its result arrives later as a task notification, so don't wait on it or invoke it again in the meantime. Users may also ask for one by name (\`/<name>\`, or "slash command"); that's a request to invoke it.

- \`skill\`: exact name from the listing, no leading slash. Plugin skills use \`plugin:skill\`. Directory-scoped skills are listed with a path prefix (\`apps/web:deploy\`); when both scoped and unscoped variants of a name exist, pick the one whose directory contains the files you're working on (most specific wins; unscoped otherwise).
- \`args\`: optional arguments to pass through.

Only names from the listing (or that the user typed explicitly) are valid. Built-in CLI commands (\`/help\`, \`/clear\`, …) aren't skills. If a \`<${COMMAND_NAME_TAG}>\` block is already present this turn, the skill is loaded — follow it directly rather than calling again.
`

export const COORDINATOR_SKILL_APPENDIX = `
In a coordinator session, the coordinator's own use of this tool is read-only: it loads the skill's instructions to inform replies, triage, and coordination but does not run the skill — no fork, no permission grants, no hooks, no preamble shell commands. Execution happens in workers: hand the skill to one worker, or when its recipe is orchestration, spawn workers per that recipe and synthesize their results. Worker skill invocations execute normally. A \`<${COMMAND_NAME_TAG}>\` block that arrived with only a delegation summary (no skill content) does not mean the skill is loaded — calling this tool to load it is still appropriate then.
`

export const getPrompt = memoize(async (_cwd?: string): Promise<string> => {
  // Official skill_desc_reframe arm: denser Skill tool description emphasizing
  // exact names, directory-scoped variants, and no inventing skill names.
  if (isSkillDescReframeEnabled()) {
    return getSkillDescReframeBody(COMMAND_NAME_TAG)
  }
  return isCoordinatorMode()
    ? BASE_SKILL_PROMPT + COORDINATOR_SKILL_APPENDIX
    : BASE_SKILL_PROMPT
})

export async function getSkillToolInfo(cwd: string): Promise<{
  totalCommands: number
  includedCommands: number
}> {
  const { merged, included } = await mergeSkillToolCommands()
  void cwd
  return {
    totalCommands: merged.length,
    includedCommands: included.length,
  }
}

// Returns the commands included in the SkillTool prompt.
// All commands are always included (descriptions may be truncated to fit budget).
// Used by analyzeContext to count skill tokens.
export async function getLimitedSkillToolCommands(
  cwd: string,
): Promise<Command[]> {
  const { included } = await mergeSkillToolCommands()
  void cwd
  return included
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
