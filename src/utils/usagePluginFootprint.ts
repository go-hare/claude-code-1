/**
 * densable `_Rt` / `h` / `Mft` / `XDt` / `Oft` / `YDt` / `ocr` / `Eh` / `rF` —
 * plugin skill-listing footprint on `/usage` (Cn/kn).
 */

import { type Command, getCommandName } from '../types/command.js'
import { getCanonicalName, parseUserSpecifiedModel } from './model/model.js'
import { getSettings_DEPRECATED } from './settings/settings.js'

/** densable `run` / `Q2t`. */
export const SKILL_LISTING_CHARS_PER_TOKEN = 4
/** densable `tcr` / `kFo`. */
const LISTING_CONTEXT_CHARS_DEFAULT = 200_000
/** densable `ecr` / `_Fo`. */
const LISTING_BUDGET_FRACTION_DEFAULT = 0.01
/** densable `ncr` / `SFo`. */
const LISTING_MAX_DESC_CHARS_DEFAULT = 1536

/** densable `rF` / `S0` — models using 4 chars/token; newer families use 3. */
const FOUR_CHARS_PER_TOKEN_MODELS = new Set([
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-3-7-sonnet',
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
])

/** densable `Eh` / `Yh`. */
export function skillListingCharsPerToken(model?: string | null): number {
  if (!model) return SKILL_LISTING_CHARS_PER_TOKEN
  const parsed = parseUserSpecifiedModel(model).replace(/\[1m\]$/i, '')
  const canonical = getCanonicalName(parsed).replace(/[._]/g, '-')
  return FOUR_CHARS_PER_TOKEN_MODELS.has(canonical) ? 4 : 3
}

/** densable `Mft` / `Twt`. */
export function skillListingDescription(cmd: {
  description?: string
  whenToUse?: string
}): string {
  const description = cmd.description ?? ''
  return cmd.whenToUse ? `${description} - ${cmd.whenToUse}` : description
}

type SkillListingSettings = {
  skillListingMaxDescChars?: number
  skillListingBudgetFraction?: number
}

function readSkillListingSettings(): SkillListingSettings {
  try {
    return (getSettings_DEPRECATED() ?? {}) as SkillListingSettings
  } catch {
    return {}
  }
}

/** densable `YDt` / `Awt`. */
export function skillListingMaxDescChars(): number {
  const configured = readSkillListingSettings().skillListingMaxDescChars
  return typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured > 0
    ? Math.floor(configured)
    : LISTING_MAX_DESC_CHARS_DEFAULT
}

/** densable `ocr` / `bFo`. */
export function skillListingBudgetFraction(): number {
  const configured = readSkillListingSettings().skillListingBudgetFraction
  return typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured > 0 &&
    configured <= 1
    ? configured
    : LISTING_BUDGET_FRACTION_DEFAULT
}

/** densable `Kgs`. */
function isValidSkillIdentifier(name: string): boolean {
  return name.length <= 256 && /^[\p{L}\p{M}\p{N}_:.-]+$/u.test(name)
}

/** densable `Hs(e, n)` — exact `.name` match first, else first alias/userFacingName match. */
function findCommandByListingName(
  name: string,
  all: readonly Command[],
): Command | undefined {
  let fallback: Command | undefined
  for (const cmd of all) {
    if (cmd.name === name) return cmd
    if (
      fallback === undefined &&
      (getCommandName(cmd) === name || cmd.aliases?.includes(name))
    ) {
      fallback = cmd
    }
  }
  return fallback
}

/** densable `XDt` / `Rwt`. */
export function skillListingDisplayName(
  cmd: Command,
  all: readonly Command[],
): string {
  const bare = getCommandName(cmd)
  if (
    bare === cmd.name ||
    cmd.name.endsWith(`:${bare}`) ||
    !isValidSkillIdentifier(bare) ||
    findCommandByListingName(bare, all)?.name !== cmd.name
  ) {
    return cmd.name
  }
  return `${cmd.name} (${bare})`
}

/** densable `h` @217016050 — 2 + cmd.name.length + 2 + clipped + 1. */
export function skillListingChars(
  cmd: Command,
  _all?: readonly Command[],
): number {
  const desc = skillListingDescription(cmd)
  const clipped = Math.min(desc.length, skillListingMaxDescChars())
  return 2 + cmd.name.length + 2 + clipped + 1
}

/** densable `Oft` / `ntt`. */
export function skillListingCharBudget(
  contextChars?: number,
  charsPerToken: number = SKILL_LISTING_CHARS_PER_TOKEN,
): number {
  const env = process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET
  if (env) {
    const n = Number(env)
    if (Number.isFinite(n) && n > 0) return n
  }
  const fraction = skillListingBudgetFraction()
  return Math.max(
    1,
    Math.floor(
      (contextChars ?? LISTING_CONTEXT_CHARS_DEFAULT) *
        charsPerToken *
        fraction,
    ),
  )
}

export type PluginSkillListingSkill = {
  name: string
  chars: number
  approxTokens: number
}

export type PluginSkillListingRow = {
  pluginName: string
  skillCount: number
  chars: number
  approxTokens: number
  skills: PluginSkillListingSkill[]
}

export type PluginSkillListingFootprint = {
  byPlugin: PluginSkillListingRow[]
  totalChars: number
  totalTokens: number
  overBudget: boolean
  budgetTokens: number
}

/** densable `_Rt(e, o, p)` / `xft`. */
export function aggregatePluginSkillListing(
  commands: readonly Command[],
  charsPerToken: number = SKILL_LISTING_CHARS_PER_TOKEN,
  contextChars?: number,
): PluginSkillListingFootprint {
  const byName = new Map<string, PluginSkillListingSkill[]>()
  for (const cmd of commands) {
    if (cmd.type !== 'prompt' || cmd.disableModelInvocation) continue
    const pluginName = cmd.pluginInfo?.pluginManifest.name
    if (!pluginName) continue
    const chars = skillListingChars(cmd, commands)
    const list = byName.get(pluginName) ?? []
    list.push({
      name: cmd.name,
      chars,
      approxTokens: Math.round(chars / charsPerToken),
    })
    byName.set(pluginName, list)
  }
  const byPlugin = [...byName.entries()]
    .map(([pluginName, skills]) => {
      skills.sort((a, b) => b.chars - a.chars)
      const chars = skills.reduce((sum, s) => sum + s.chars, 0)
      return {
        pluginName,
        skillCount: skills.length,
        chars,
        approxTokens: Math.round(chars / charsPerToken),
        skills,
      }
    })
    .sort((a, b) => b.chars - a.chars)
  const totalCharsRaw = byPlugin.reduce((sum, row) => sum + row.chars, 0)
  const budget = skillListingCharBudget(contextChars, charsPerToken)
  const overBudget = totalCharsRaw > budget
  const totalChars = overBudget ? budget : totalCharsRaw
  return {
    byPlugin,
    totalChars,
    totalTokens: Math.round(totalChars / charsPerToken),
    overBudget,
    budgetTokens: Math.round(budget / charsPerToken),
  }
}
