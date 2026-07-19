/**
 * densable multiproject skill name qualification (NMy / XEs / XRd / FMy / aWr).
 *
 * When dynamic skills collide with cwd skills or share names across extra
 * skill roots, densable renames to `${relPath}:${name}` and stashes the bare
 * name on `unqualifiedName` for skillUsage / skill-doctor / overrides.
 *
 * densable aWr injects a meta note when an unscoped skill is invoked while
 * directory-scoped variants (`unqualifiedName === bare`) are also loaded.
 */
import { isAbsolute, relative, sep } from 'path'
import { SKILL_TOOL_NAME } from '@claude-code/builtin-tools/tools/SkillTool/constants.js'
import { toolMatchesName, type Tools } from '../Tool.js'
import { logEvent } from '../services/analytics/index.js'
import type { Command } from '../types/command.js'
import type { UserMessage } from '../types/message.js'
import { createUserMessage } from '../utils/messages.js'
import { getDynamicSkills } from './loadSkillsDir.js'

/** densable XEs */
export function scopedSkillName(
  scopePrefix: string,
  skillName: string,
): string {
  return `${scopePrefix}:${skillName}`
}

/**
 * densable lye: bare name for usage / variant matching (unqualifiedName when set).
 */
export function bareSkillName(skill: Command): string {
  if (skill.type === 'prompt' && skill.unqualifiedName != null) {
    return skill.unqualifiedName
  }
  return skill.name
}

/**
 * densable Gqe: model-invocable skill eligible for SkillTool / aWr variant listing.
 * Gates skillOverrides via densable Ber (user-invocable-only | off).
 */
export function isModelInvocableScopedSkill(
  skill: Command,
  skillOverrides?: Readonly<
    Record<
      string,
      'on' | 'name-only' | 'user-invocable-only' | 'off' | 'model-invocable'
    >
  >,
  settingsDisableBundledSkills?: boolean,
): boolean {
  if (skill.type !== 'prompt') return false
  if (skill.disableModelInvocation) return false
  try {
    // Lazy import avoids circular deps with residualFinalEnvGates consumers.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      isSkillModelInvocationBlockedByOverride,
      resolveSkillOverrideMode,
    } =
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    const mode = resolveSkillOverrideMode(skill, {
      skillOverrides,
      settingsDisableBundledSkills,
    })
    if (isSkillModelInvocationBlockedByOverride(mode)) return false
  } catch {
    // residual optional if gates module unavailable
  }
  const loaded = skill.loadedFrom
  return (
    skill.source === 'builtin' ||
    loaded === 'bundled' ||
    loaded === 'skills' ||
    loaded === 'commands_DEPRECATED' ||
    skill.hasUserSpecifiedDescription === true ||
    Boolean(skill.whenToUse)
  )
}

/** densable ber: skill tool name length gate. */
export function isValidSkillToolName(name: string): boolean {
  return name.length > 0 && name.length <= 256
}

/**
 * densable zrs: find qualified variants of `bareName` among loaded skills.
 * When spawnedBySkill is set, hide fork-context skills that resolve to that
 * bare name (avoid self-note inside a forked skill of the same family).
 */
export function findScopedSkillVariants(
  commands: readonly Command[],
  bareName: string,
  spawnedBySkill?: string,
): Command[] {
  return commands.filter(cmd => {
    if (cmd.type !== 'prompt') return false
    if (cmd.unqualifiedName !== bareName) return false
    if (!isModelInvocableScopedSkill(cmd)) return false
    if (!isValidSkillToolName(cmd.name)) return false
    if (
      cmd.context === 'fork' &&
      spawnedBySkill !== undefined &&
      bareSkillName(cmd) === spawnedBySkill
    ) {
      return false
    }
    return true
  })
}

/**
 * densable _er — Levenshtein with adjacent-transposition (same as task query).
 * Kept local so SkillTool not-found path does not import tasks/.
 */
export function skillNameEditDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i]![j] = Math.min(dp[i]![j]!, dp[i - 2]![j - 2]! + 1)
      }
    }
  }
  return dp[m]![n]!
}

/**
 * densable _it: closest name/alias within maxEditDistance (default 1).
 * Used by SkillTool unknown-skill path (maxEditDistance: 2).
 */
export function suggestClosestSkillName(
  query: string,
  candidates: ReadonlyArray<{ name: string; aliases?: string[] }>,
  { maxEditDistance = 1 }: { maxEditDistance?: number } = {},
): string | undefined {
  const names = candidates.flatMap(c => [c.name, ...(c.aliases ?? [])])
  let best: string | undefined
  let bestDist = maxEditDistance + 1
  for (const name of names) {
    if (Math.abs(name.length - query.length) > maxEditDistance) continue
    const d = skillNameEditDistance(query, name)
    if (d < bestDist) {
      bestDist = d
      best = name
    }
  }
  return best
}

/**
 * densable skill_invoke_fork_recursion gate: forked skill subagent is trying
 * to re-invoke the same skill family (lye match) via the Skill tool.
 */
export function isSkillForkRecursion(
  skill: Command,
  spawnedBySkill?: string,
): boolean {
  return (
    skill.type === 'prompt' &&
    skill.context === 'fork' &&
    spawnedBySkill !== undefined &&
    spawnedBySkill === bareSkillName(skill)
  )
}

/**
 * densable SkillTool not-found message: prefer scoped-variant list, else
 * did-you-mean via _it, else plain unknown.
 */
export function formatUnknownSkillMessage(
  requestedName: string,
  commands: readonly Command[],
  spawnedBySkill?: string,
): string {
  const variants = findScopedSkillVariants(
    commands,
    requestedName,
    spawnedBySkill,
  )
  if (variants.length > 0) {
    return `Unknown skill: ${requestedName}. Directory-scoped variants exist: ${variants.map(v => v.name).join(', ')} — invoke the variant whose directory contains the files you are working on.`
  }
  const suggestion = suggestClosestSkillName(
    requestedName,
    commands.map(c => ({ name: c.name, aliases: c.aliases })),
    { maxEditDistance: 2 },
  )
  if (suggestion) {
    return `Unknown skill: ${requestedName}. Did you mean ${suggestion}?`
  }
  return `Unknown skill: ${requestedName}`
}

/**
 * densable aWr: if invoking an unscoped skill while multiproject variants
 * exist, return a meta user message listing qualified names. Null otherwise.
 *
 * densable gates on _io() dynamic skill map non-empty, Skill tool present in
 * tools, and sqr()=false (always false in residual).
 */
export function maybeNoteScopedSkillVariants(
  skill: Command,
  opts: {
    tools: Tools
    /** densable Xw(cwd) command list (includes qualified multiproject variants). */
    commands: readonly Command[]
    /** densable spawnedBySkill (lye of invoker) for fork filter. */
    spawnedBySkill?: string
  },
): UserMessage | null {
  if (skill.type !== 'prompt') return null
  // densable: only unscoped skills (no unqualifiedName yet)
  if (skill.unqualifiedName != null) return null
  // densable _io(): no multiproject dynamics loaded → skip
  if (getDynamicSkills().length === 0) return null
  // densable sqr residual is always false
  if (!opts.tools.some(t => toolMatchesName(t, SKILL_TOOL_NAME))) return null

  const variants = findScopedSkillVariants(
    opts.commands,
    skill.name,
    opts.spawnedBySkill,
  )
  if (variants.length === 0) return null

  const lines = variants.map(v => {
    const prefix = v.name.slice(0, v.name.length - skill.name.length - 1)
    return `- \`${v.name}\` — for files under ${prefix}/`
  })
  logEvent('tengu_skill_scoped_variant_note', {
    variant_count: variants.length,
  })
  return createUserMessage({
    content: [
      `Directory-scoped variants of the "${skill.name}" skill exist in this repo:`,
      ...lines,
      `The bare name always resolves to this unscoped skill; the variants are reachable only by their exact qualified names. If the files you are working on are under a variant's directory, invoke that variant now with the ${SKILL_TOOL_NAME} tool and follow it instead — it carries that subtree's own instructions. If your changes span more than one variant's directory, run each matching variant.`,
    ].join('\n'),
    isMeta: true,
  })
}

/**
 * densable NMy: if skillRoot is under `{project}/.claude/...`, return the
 * project path relative to cwd (posix separators). Otherwise null.
 */
export function skillRootProjectRelativeToCwd(
  skill: Command,
  cwd: string,
): string | null {
  if (skill.type !== 'prompt' || !skill.skillRoot) return null
  const marker = `${sep}.claude${sep}`
  const idx = skill.skillRoot.lastIndexOf(marker)
  if (idx === -1) return null
  const projectRoot = skill.skillRoot.slice(0, idx)
  const rel = relative(cwd, projectRoot)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

/** densable XRd — description-only annotation (no name change). */
export function annotateSkillFromExtraDir(
  skill: Command,
  scopePrefix: string,
): Command {
  if (skill.type !== 'prompt') return skill
  return {
    ...skill,
    description: `${skill.description} (from ${scopePrefix}/.claude/skills — applies when working on files under ${scopePrefix}/)`,
  }
}

/**
 * densable FMy — qualify name with multiproject prefix; stash bare name.
 * @param shadowsBase when true, description says "use this instead of unscoped"
 */
export function qualifyScopedSkillCommand(
  skill: Command,
  scopePrefix: string,
  shadowsBase: boolean,
): Command {
  if (skill.type !== 'prompt') return skill
  const qualified = scopedSkillName(scopePrefix, skill.name)
  const descSuffix = shadowsBase
    ? `scoped to ${scopePrefix}/ — use this instead of the unscoped "${skill.name}" skill when the files being changed are under ${scopePrefix}/`
    : `from ${scopePrefix}/.claude/skills — applies when working on files under ${scopePrefix}/`
  return {
    ...skill,
    name: qualified,
    unqualifiedName: skill.unqualifiedName ?? skill.name,
    aliases: undefined,
    userFacingName: () => qualified,
    description: `${skill.description} (${descSuffix})`,
  }
}

/**
 * densable Xw dynamic-skill merge: qualify / annotate multiproject dynamics
 * that would collide with base commands or with each other.
 */
export function mergeDynamicSkillsDensable(
  baseCommands: Command[],
  dynamicSkills: Command[],
  cwd: string,
): Command[] {
  if (dynamicSkills.length === 0) return baseCommands

  const baseNames = new Set(baseCommands.map(c => c.name))
  const baseSkillRoots = new Set(
    baseCommands
      .filter(
        (c): c is Command & { type: 'prompt'; skillRoot: string } =>
          c.type === 'prompt' && typeof c.skillRoot === 'string',
      )
      .map(c => c.skillRoot),
  )

  const nameCounts = new Map<string, number>()
  for (const s of dynamicSkills) {
    // densable skips fallback skills in the collision tally
    if (s.type === 'prompt' && (s as { fallback?: boolean }).fallback) continue
    nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1)
  }

  const merged: Command[] = []
  const usedNames = new Set<string>()

  for (const skill of dynamicSkills) {
    if (
      skill.type === 'prompt' &&
      skill.skillRoot &&
      baseSkillRoots.has(skill.skillRoot)
    ) {
      // Same root already loaded via cwd skills — skip duplicate dynamic
      continue
    }

    const scopePrefix = skillRootProjectRelativeToCwd(skill, cwd)
    const shadowsBase = baseNames.has(skill.name)

    // densable fallback branch (rare) — keep out if name taken
    if (skill.type === 'prompt' && (skill as { fallback?: boolean }).fallback) {
      if (
        shadowsBase ||
        (nameCounts.get(skill.name) ?? 0) > 0 ||
        usedNames.has(skill.name)
      ) {
        continue
      }
      merged.push(
        scopePrefix ? annotateSkillFromExtraDir(skill, scopePrefix) : skill,
      )
      usedNames.add(skill.name)
      continue
    }

    // No name collision with base and unique among dynamics → keep bare name
    if (!shadowsBase && (nameCounts.get(skill.name) ?? 0) <= 1) {
      merged.push(
        scopePrefix ? annotateSkillFromExtraDir(skill, scopePrefix) : skill,
      )
      usedNames.add(skill.name)
      continue
    }

    // Collision without multiproject path → only keep if name free
    if (!scopePrefix) {
      if (shadowsBase || usedNames.has(skill.name)) continue
      merged.push(skill)
      usedNames.add(skill.name)
      continue
    }

    const qualified = scopedSkillName(scopePrefix, skill.name)
    if (baseNames.has(qualified) || usedNames.has(qualified)) continue
    merged.push(
      qualifyScopedSkillCommand(
        skill,
        scopePrefix,
        shadowsBase || usedNames.has(skill.name),
      ),
    )
    usedNames.add(qualified)
  }

  if (merged.length === 0) return baseCommands

  // densable: insert before first built-in (caller may re-order); here append
  // after base — getCommands places dynamics before COMMANDS() separately.
  return [...baseCommands, ...merged]
}
