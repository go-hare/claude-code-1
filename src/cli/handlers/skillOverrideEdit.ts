/**
 * densable 2.1.283 `runSkillOverrideEdit` / `x` @205281551 plus lock helpers
 * `Ttr`/`vIe`/`CIe`/`j_t` @205263208.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { getCommands } from '../../commands.js'
import type { Command } from '../../types/command.js'
import {
  persistSettingsForSource,
  getSettingsForSource,
} from '../../utils/settings/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import type { SkillOverrideMode } from '../../utils/residualFinalEnvGates.js'

const STATES = ['on', 'name-only', 'user-invocable-only', 'off'] as const

const editSchema = lazySchema(() =>
  z.object({
    name: z.string().min(1).max(500),
    state: z.enum(STATES),
    handles: z
      .object({
        unqualified_name: z.string().max(500).optional(),
        aliases: z.array(z.string().max(500)).max(20).optional(),
        bare_name_reserved: z.boolean().optional(),
      })
      .optional(),
  }),
)

export type SkillOverrideEdit = z.infer<ReturnType<typeof editSchema>>

export type SkillOverrideEditResult =
  | { ok: true; written: SkillOverrideEdit; changed: boolean }
  | { ok: false; error: string }

type SkillLike = {
  name: string
  type?: string
  source?: string
  loadedFrom?: string
  disableModelInvocation?: boolean
  unqualifiedName?: string
  aliases?: string[]
  bareNameReserved?: boolean
}

type Lock = { value: SkillOverrideMode; source: string }

function canStoreSkillName(name: string): boolean {
  return name !== '__proto__'
}

function isPromptSkill(cmd: SkillLike): boolean {
  return (
    cmd.type === 'prompt' &&
    (cmd.loadedFrom === 'skills' ||
      cmd.loadedFrom === 'syncedSkills' ||
      cmd.loadedFrom === 'commands_DEPRECATED' ||
      cmd.loadedFrom === 'plugin' ||
      cmd.loadedFrom === 'mcp')
  )
}

function lockFor(cmd: SkillLike): Lock | undefined {
  const policy = isSettingSourceEnabled('policySettings')
    ? getSettingsForSource('policySettings')?.skillOverrides
    : undefined
  const flag = isSettingSourceEnabled('flagSettings')
    ? getSettingsForSource('flagSettings')?.skillOverrides
    : undefined
  if (policy?.[cmd.name] !== undefined) {
    return { value: policy[cmd.name] as SkillOverrideMode, source: 'policy' }
  }
  if (flag?.[cmd.name] !== undefined) {
    return { value: flag[cmd.name] as SkillOverrideMode, source: 'flag' }
  }
  if (!canStoreSkillName(cmd.name)) {
    return {
      value: cmd.disableModelInvocation ? 'user-invocable-only' : 'on',
      source: 'reserved-name',
    }
  }
  if (cmd.disableModelInvocation) {
    return { value: 'user-invocable-only', source: 'author' }
  }
  if (cmd.source === 'plugin') {
    return { value: 'on', source: 'plugin' }
  }
  return undefined
}

function inheritedOverride(cmd: SkillLike): SkillOverrideMode | undefined {
  const project = isSettingSourceEnabled('projectSettings')
    ? getSettingsForSource('projectSettings')?.skillOverrides
    : undefined
  const user = isSettingSourceEnabled('userSettings')
    ? getSettingsForSource('userSettings')?.skillOverrides
    : undefined
  const local = getSettingsForSource('localSettings')?.skillOverrides
  const fromProjectOrUser = (name: string): SkillOverrideMode | undefined =>
    (project?.[name] as SkillOverrideMode | undefined) ??
    (user?.[name] as SkillOverrideMode | undefined)
  const bare = cmd.unqualifiedName
  const localBare =
    bare != null ? (local?.[bare] as SkillOverrideMode | undefined) : undefined
  return (
    fromProjectOrUser(cmd.name) ??
    (bare != null ? (localBare ?? fromProjectOrUser(bare)) : undefined)
  )
}

function promptSkills(commands: Command[]): SkillLike[] {
  return commands
    .filter(cmd => cmd.type === 'prompt' && isPromptSkill(cmd))
    .map(cmd => ({
      name: cmd.name,
      type: cmd.type,
      source: cmd.type === 'prompt' ? cmd.source : undefined,
      loadedFrom: cmd.loadedFrom,
      disableModelInvocation: cmd.disableModelInvocation,
      aliases: cmd.aliases,
    }))
}

function collectState(skills: SkillLike[]): {
  localOverrides: Record<string, SkillOverrideMode>
  lowerTier: Map<string, SkillOverrideMode>
  locked: Map<SkillLike, Lock>
} {
  const localOverrides = Object.assign(
    Object.create(null),
    getSettingsForSource('localSettings')?.skillOverrides ?? {},
  ) as Record<string, SkillOverrideMode>
  const lowerTier = new Map<string, SkillOverrideMode>()
  const locked = new Map<SkillLike, Lock>()
  for (const skill of skills) {
    const inherited = inheritedOverride(skill)
    if (inherited) lowerTier.set(skill.name, inherited)
    const lock = lockFor(skill)
    if (lock) locked.set(skill, lock)
  }
  return { localOverrides, lowerTier, locked }
}

function currentMap(
  skills: SkillLike[],
  state: ReturnType<typeof collectState>,
): Record<string, SkillOverrideMode> {
  const map = Object.create(null) as Record<string, SkillOverrideMode>
  for (const skill of skills) {
    if (Object.hasOwn(map, skill.name)) continue
    map[skill.name] =
      state.locked.get(skill)?.value ??
      state.localOverrides[skill.name] ??
      state.lowerTier.get(skill.name) ??
      'on'
  }
  return map
}

function diffOverrides(
  targets: SkillLike[],
  desired: Record<string, SkillOverrideMode>,
  state: ReturnType<typeof collectState>,
): {
  diff: Record<string, SkillOverrideMode | undefined>
  writes: number
  effectiveChanged: number
} {
  const { localOverrides, lowerTier, locked } = state
  const seenLocked = new Set(Array.from(locked.keys(), skill => skill.name))
  const seen = new Set(seenLocked)
  const diff: Record<string, SkillOverrideMode | undefined> =
    Object.create(null)
  let writes = 0
  let effectiveChanged = 0
  for (const skill of targets) {
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    const next = desired[skill.name] ?? 'on'
    const inherited = lowerTier.get(skill.name) ?? 'on'
    const currentLocal = localOverrides[skill.name] ?? inherited
    const writeValue = next === inherited ? undefined : next
    if (writeValue !== localOverrides[skill.name]) {
      diff[skill.name] = writeValue
      writes++
    }
    if (next !== currentLocal) effectiveChanged++
  }
  return { diff, writes, effectiveChanged }
}

export async function runSkillOverrideEdit(
  raw: unknown,
  cwd: string,
  storageV5?: unknown,
): Promise<SkillOverrideEditResult> {
  const parsed = editSchema().safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue
        ? `Not a skill state edit (${issue.path.map(String).join('.') || 'edit'}: ${issue.message}).`
        : 'Not a skill state edit.',
    }
  }
  const written = parsed.data
  if (!canStoreSkillName(written.name)) {
    return {
      ok: false,
      error:
        "Settings can't store an entry with this skill's name; rename its folder or file to configure it.",
    }
  }
  const skills = promptSkills(await getCommands(cwd))
  let matches = skills.filter(skill => skill.name === written.name)
  if (matches.length > 0 && written.handles?.bare_name_reserved !== undefined) {
    matches = matches.map(skill => {
      const next = {
        ...skill,
        bareNameReserved: written.handles?.bare_name_reserved,
      }
      skills[skills.indexOf(skill)] = next
      return next
    })
  }
  if (matches.length === 0) {
    const synthetic: SkillLike = {
      name: written.name,
      type: 'prompt',
      unqualifiedName: written.handles?.bare_name_reserved
        ? undefined
        : written.handles?.unqualified_name,
      aliases: written.handles?.aliases,
    }
    matches = [synthetic]
    skills.push(synthetic)
  }
  const state = collectState(skills)
  const lock = matches
    .map(skill => state.locked.get(skill) ?? lockFor(skill))
    .find(Boolean)
  if (lock) {
    const error =
      lock.source === 'plugin'
        ? 'A plugin skill is managed with the plugin, not here.'
        : lock.source === 'author'
          ? "This skill's own file turns model invocation off; its state cannot be changed here."
          : lock.source === 'reserved-name'
            ? "Settings can't store an entry with this skill's name; rename its folder or file to configure it."
            : "A higher-priority configuration sets this skill's state; it cannot be changed here."
    return { ok: false, error }
  }
  const desired = Object.assign(
    Object.create(null),
    currentMap(skills, state),
    { [written.name]: written.state },
  ) as Record<string, SkillOverrideMode>
  const { diff, writes, effectiveChanged } = diffOverrides(
    matches,
    desired,
    state,
  )
  if (writes > 0) {
    const { error } = await persistSettingsForSource(
      'localSettings',
      { skillOverrides: diff as Record<string, SkillOverrideMode> },
      undefined,
      storageV5,
    )
    if (error) return { ok: false, error: error.message }
    resetSettingsCache()
  }
  return { ok: true, written, changed: effectiveChanged > 0 }
}
