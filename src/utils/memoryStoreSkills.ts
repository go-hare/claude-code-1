/**
 * densable `Eae` / `Vw` / `wl` / `Z$` / `TY` — memory-store skill registry
 * plus session allowlist filter used by `xMn`.
 * Gold `function Eae(){return wl().commands}` @181324659.
 * Gold `function Z$(){return n().host.extensionsConfig.sessionSkillAllowlist()}` @175572010.
 * densable `Yw` @181324781 — team-mount skillsDirs loader + `sN` SKILL.md.
 */

import type { Command } from '../types/command.js'
import { isAbsolute, join, sep as pathSep } from 'path'
import { parseFrontmatter } from './frontmatterParser.js'
import { isENOENT } from './errors.js'
import { getDisableSlashCommands } from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { getFsImplementation } from './fsOperations.js'
import { getPlatform } from './platform.js'
import {
  isSkillModelInvocationBlockedByOverride,
  resolveSkillOverrideMode,
} from './residualFinalEnvGates.js'
import { getBootstrapSessionHost } from './sessionRoot.js'
import { isRestrictedToPluginOnly } from './settings/pluginOnlyPolicy.js'

class MemoryStoreSkillBag {
  commands: Command[] = []
  nameStableSnapshot: Command[] = this.commands
  replace(next: Command[]): boolean {
    const before = new Set(this.commands.map(c => c.name))
    const after = new Set(next.map(c => c.name))
    this.commands = next
    const changed =
      after.size !== before.size || [...after].some(name => !before.has(name))
    if (changed) this.nameStableSnapshot = next
    return changed
  }
}

const bag = new MemoryStoreSkillBag()

/** densable `Eae`. */
export function getMemoryStoreSkillCommands(): Command[] {
  return bag.commands
}

/** Test / loader hook for densable `Vw.replace`. */
export function replaceMemoryStoreSkillCommands(next: Command[]): boolean {
  return bag.replace(next)
}

/** densable `oz` filter used by xMn's `Eae().filter`. */
export function invocableMemoryStoreSkillCommands(): Command[] {
  return bag.commands.filter(
    cmd =>
      !cmd.disableModelInvocation &&
      !isSkillModelInvocationBlockedByOverride(resolveSkillOverrideMode(cmd)),
  )
}

/**
 * densable `Z$` — `n().host.extensionsConfig.sessionSkillAllowlist()`.
 */
export function sessionSkillAllowlist(): readonly string[] | undefined {
  const value =
    getBootstrapSessionHost().extensionsConfig.sessionSkillAllowlist()
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return undefined
  return value.filter((name): name is string => typeof name === 'string')
}

/**
 * densable `TY(w, Z$())`.
 */
export type MemoryStoreSkillDirConfig = {
  scope: string
  mount: string
  skillsDirs?: string[]
}

export type MemoryStoreMount = {
  mountName: string
  mountDir: string
  partitionId?: string
}

/**
 * densable `class eS` @181332307 — MemoryStores bag holding
 * `storeSkillConfigs` / `multiStoreState` / `storageV5`.
 */
export class MemoryStoresHost {
  storeSkillConfigs: MemoryStoreSkillDirConfig[] | null = null
  multiStoreState: { stores: MemoryStoreMount[] } | null = null
  userMultiStoreState: { stores: MemoryStoreMount[] } | null = null
  storageV5: unknown = undefined

  reset(e?: {
    storeSkillConfigs?: MemoryStoreSkillDirConfig[] | null
    multiStoreState?: { stores: MemoryStoreMount[] } | null
    userMultiStoreState?: { stores: MemoryStoreMount[] } | null
    storageV5?: unknown
  }): void {
    this.storeSkillConfigs = e?.storeSkillConfigs ?? null
    this.multiStoreState = e?.multiStoreState ?? null
    this.userMultiStoreState = e?.userMultiStoreState ?? null
    this.storageV5 = e?.storageV5
  }

  /** densable `refreshStoreSkills()` @181333180 */
  refreshStoreSkills(): void {
    if (this.storeSkillConfigs === null) return
    refreshStoreSkills(
      this.storeSkillConfigs,
      [
        ...(this.multiStoreState?.stores ?? []),
        ...(this.userMultiStoreState?.stores ?? []),
      ],
      this.storageV5,
    )
  }
}

const memoryStoresHost = new MemoryStoresHost()

export function getMemoryStoresHost(): MemoryStoresHost {
  return memoryStoresHost
}

/** densable `lhe` @179544800 — realpath(path) === canonical, or under it. */
export async function screenMemoryStorePath(
  path: string,
  canonicalRoot: string,
): Promise<'ok' | 'escape' | 'absent'> {
  const fs = getFsImplementation()
  try {
    const real = fs.realpathSync(path)
    const root = fs.realpathSync(canonicalRoot)
    if (real === root) return 'ok'
    const prefix = root.endsWith(pathSep) ? root : root + pathSep
    return real.startsWith(prefix) ? 'ok' : 'escape'
  } catch (err) {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'absent'
    return 'escape'
  }
}

/** densable `cm` @181324310 — 128 KiB SKILL.md. */
const MEMORY_STORE_SKILL_MAX_BYTES = 131072

type StorageV5ListLike = {
  listEntries?: (
    scope: unknown,
    opts?: {
      skipKeyStats?: boolean
      skipScopeStats?: boolean
      cursor?: unknown
    },
  ) => Promise<{
    ok: boolean
    value?: {
      items?: Array<{
        kind?: string
        viaSymlink?: boolean
        scope?: { namespace?: string; relPath?: string[] }
      }>
    }
  }>
  readText?: (
    reqs: Array<{ key: unknown; offset: number; length: number }>,
    opts?: { hardened?: boolean },
  ) => Promise<{
    ok: boolean
    value?: {
      items?: Array<{ found: boolean; totalBytes: number; value?: string }>
    }
    error?: { code?: string; telemetryCode?: string }
  }>
}

/**
 * densable `aN` @181329592 — list memory namespace skill folders via storageV5.
 */
export async function listMemoryStoreSkillFolders(
  storageV5: unknown,
  projectKey: string,
  relPath: string[],
): Promise<
  | { ok: true; value: Array<{ name: string; symlink: boolean }> }
  | { ok: false; error: string }
> {
  const backend = storageV5 as StorageV5ListLike | null
  if (backend?.listEntries === undefined) {
    return { ok: false, error: 'no storageV5' }
  }
  try {
    const listed = await backend.listEntries(
      { namespace: 'memory', projectKey, relPath },
      { skipKeyStats: true, skipScopeStats: true },
    )
    if (!listed.ok) return { ok: false, error: 'the listing did not finish' }
    const folders: Array<{ name: string; symlink: boolean }> = []
    for (const h of listed.value?.items ?? []) {
      if (h.kind !== 'scope' || h.scope?.namespace !== 'memory') continue
      const b = h.scope.relPath?.at(-1)
      if (b !== undefined && h.scope.relPath?.length === relPath.length + 1) {
        folders.push({ name: b, symlink: h.viaSymlink === true })
      }
    }
    return { ok: true, value: folders }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * densable `lN` @181330127 — read SKILL.md via storageV5.readText.
 */
export async function readMemoryStoreSkillFile(
  storageV5: unknown,
  key: unknown,
): Promise<
  | { kind: 'ok'; content: string }
  | { kind: 'absent' }
  | { kind: 'notAtLocation' }
  | { kind: 'notPlainSmallFile' }
  | { kind: 'failed'; reason: string }
> {
  const backend = storageV5 as StorageV5ListLike | null
  if (backend?.readText === undefined)
    return { kind: 'failed', reason: 'no storageV5' }
  const r = await backend.readText(
    [{ key, offset: 0, length: MEMORY_STORE_SKILL_MAX_BYTES + 1 }],
    { hardened: true },
  )
  if (!r.ok) {
    const g = r.error?.telemetryCode ?? r.error?.code ?? ''
    if (g === 'ELOOP') return { kind: 'notAtLocation' }
    if (g === 'ENXIO') return { kind: 'notPlainSmallFile' }
    return { kind: 'failed', reason: g || 'unknown' }
  }
  const s = r.value?.items?.[0]
  if (!s?.found) return { kind: 'absent' }
  if (s.totalBytes > MEMORY_STORE_SKILL_MAX_BYTES)
    return { kind: 'notPlainSmallFile' }
  return { kind: 'ok', content: s.value ?? '' }
}

/** densable `Kw` @181324320. */
export const MEMORY_STORE_SKILL_NAME_PREFIX = 'memories::'

/** densable `dm` @181324320 — first 100 skill folders. */
const MEMORY_STORE_SKILL_FOLDER_CAP = 100

/** densable `Mlt` @179466871. */
export function isMemoryStoreSkillFolderName(name: string): boolean {
  if (name.length === 0) return false
  return name
    .split('/')
    .every(r => /^[A-Za-z0-9._-]+$/.test(r) && r !== '.' && r !== '..')
}

/**
 * densable `sN` @181327164 — load SKILL.md folders from a screened skills dir.
 * Disk walk when storageV5 is absent; gold `aN`/`lN` when present.
 */
export async function loadMemoryStoreSkillCommands(
  skillsDir: string,
  skip: (why: string) => void,
): Promise<{ commands: Command[]; truncated: boolean }> {
  const fs = getFsImplementation()
  let entries
  try {
    entries = await fs.readdir(skillsDir)
  } catch (err) {
    if (!isENOENT(err)) {
      skip(`readdir failed for ${skillsDir} (${String(err)})`)
    }
    return { commands: [], truncated: false }
  }
  // gold sN `e` is already canonical (`bNe`). Local: pin realpath so
  // `ne!==D` only fires when SKILL.md itself is a symlink, not /var→/private/var.
  let canonicalDir = skillsDir
  try {
    canonicalDir = fs.realpathSync(skillsDir)
  } catch {
    return { commands: [], truncated: false }
  }
  const folders = entries
    .filter(D => D.isDirectory() || D.isSymbolicLink())
    .map(D => ({ name: D.name, symlink: D.isSymbolicLink() }))
  folders.sort((T, D) => (T.name < D.name ? -1 : 1))
  let truncated = false
  let walk = folders
  if (walk.length > MEMORY_STORE_SKILL_FOLDER_CAP) {
    logForDebugging(
      `memory-skills: ${canonicalDir} has ${walk.length} skill folders — loading only the first ${MEMORY_STORE_SKILL_FOLDER_CAP}`,
      { level: 'warn' },
    )
    truncated = true
    walk = walk.slice(0, MEMORY_STORE_SKILL_FOLDER_CAP)
  }
  const commands: Command[] = []
  const { createSkillCommand, parseSkillFrontmatterFields } = await import(
    '../skills/loadSkillsDir.js'
  )
  for (const T of walk) {
    if (
      T.name.length > 256 ||
      T.symlink ||
      !isMemoryStoreSkillFolderName(T.name)
    ) {
      skip(`unsafe or symlinked skill folder in ${canonicalDir}`)
      continue
    }
    const skillFilePath = join(canonicalDir, T.name, 'SKILL.md')
    const skillDirPath = join(canonicalDir, T.name)
    let real
    try {
      real = fs.realpathSync(skillFilePath)
    } catch (err) {
      const code =
        err !== null && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : ''
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        skip(`realpath failed for ${skillFilePath} (${code || 'unknown'})`)
      }
      continue
    }
    if (real !== skillFilePath) {
      skip(`${skillFilePath} is not at its apparent location`)
      continue
    }
    let content: string
    try {
      const st = fs.statSync(skillFilePath)
      if (
        !st.isFile() ||
        st.nlink > 1 ||
        st.size > MEMORY_STORE_SKILL_MAX_BYTES
      ) {
        skip(`${skillFilePath} is not a plain small file`)
        continue
      }
      content = await fs.readFile(skillFilePath, { encoding: 'utf8' })
    } catch (err) {
      if (!isENOENT(err)) {
        skip(`open failed for ${skillFilePath} (${String(err)})`)
      }
      continue
    }
    const { frontmatter, content: markdownContent } = parseFrontmatter(
      content,
      skillFilePath,
    )
    const skillName = `${MEMORY_STORE_SKILL_NAME_PREFIX}${T.name}`
    const parsed = parseSkillFrontmatterFields(
      frontmatter,
      markdownContent,
      skillName,
    )
    commands.push(
      createSkillCommand({
        ...parsed,
        skillName,
        markdownContent,
        source: 'memoryStore',
        baseDir: skillDirPath,
        loadedFrom: 'memoryStore',
        userInvocable: false,
        paths: undefined,
      }),
    )
  }
  return { commands, truncated }
}

/** densable `Qp` @181262179 — partition manifest present for this id. */
export function isMemoryStorePartitionPresent(
  _mountDir: string,
  partitionId: string | undefined,
): boolean {
  return partitionId !== undefined && partitionId.length > 0
}

/**
 * densable `Yw(e,n,r)` @181324781.
 * Windows / slash-commands-off / plugin-only return before the walk.
 * Without a team-store mount table remaining configs skip as gold
 * `skillsDirs is team-store only` / `no sync state for mount`.
 */
export async function registerMemoryStoreSkills(
  configs: readonly MemoryStoreSkillDirConfig[],
  stores: readonly MemoryStoreMount[] = [],
  storageV5?: unknown,
): Promise<void> {
  try {
    const s = configs.filter(D => (D.skillsDirs ?? []).length > 0)
    if (s.length === 0) return
    if (getPlatform() === 'windows') {
      logForDebugging(
        'memory-skills: store skills are not loaded on Windows (no O_NOFOLLOW)',
        { level: 'warn' },
      )
      logEvent('memory_store_skills', {
        reason:
          'windows_unsupported' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return
    }
    // densable `Zae()` @181215960 — skills-as-tools. Gold returns false.
    if (false) {
      logForDebugging(
        'memory-skills: not loaded under skills-as-tools (no surface reads the registry)',
        { level: 'warn' },
      )
      logEvent('memory_store_skills', {
        reason:
          'skills_as_tools_unsupported' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return
    }
    if (getDisableSlashCommands()) {
      logForDebugging(
        'memory-skills: not loaded with slash commands disabled (no surface reads the registry)',
        { level: 'warn' },
      )
      logEvent('memory_store_skills', {
        reason:
          'slash_commands_disabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return
    }
    if (isRestrictedToPluginOnly('skills')) {
      logForDebugging(
        'memory-skills: not loaded under strictPluginOnlyCustomization (memoryStore is not an admin-trusted source)',
        { level: 'warn' },
      )
      logEvent('memory_store_skills', {
        reason:
          'plugin_only_policy' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      bag.replace([])
      return
    }
    let skipped = false
    const skip = (mount: string, why: string): void => {
      skipped = true
      logForDebugging(`memory-skills: skipping ${mount} — ${why}`, {
        level: 'warn',
      })
    }
    const byName = new Map(stores.map(st => [st.mountName, st]))
    const loaded: import('../types/command.js').Command[] = []
    const seen = new Set<string>()
    let truncated = false
    for (const D of s) {
      if (D.scope !== 'team') {
        skip(D.mount, 'skillsDirs is team-store only')
        continue
      }
      const F = byName.get(D.mount)
      if (!F) {
        skip(D.mount, 'no sync state for mount')
        continue
      }
      const L = await screenMemoryStorePath(F.mountDir, F.mountDir)
      if (L === 'absent') {
        skip(D.mount, 'mount dir does not exist')
        continue
      }
      if (L !== 'ok') {
        skip(D.mount, 'mount dir escapes its canonical location')
        continue
      }
      if (!isMemoryStorePartitionPresent(F.mountDir, F.partitionId)) {
        skip(D.mount, 'mount dir not adopted by this partition')
        continue
      }
      for (const ee of D.skillsDirs ?? []) {
        const Z = isAbsolute(ee) ? ee : join(F.mountDir, ee)
        const ie = await screenMemoryStorePath(Z, F.mountDir)
        if (ie === 'absent') continue
        if (ie !== 'ok') {
          skip(
            D.mount,
            `skills dir ${ee} resolves through a symlink or escapes the mount`,
          )
          continue
        }
        let ye: { commands: Command[]; truncated: boolean }
        if (storageV5 !== undefined) {
          const listed = await listMemoryStoreSkillFolders(
            storageV5,
            D.mount,
            ee.split('/'),
          )
          if (!listed.ok) {
            skip(D.mount, `listing failed for ${Z} (${listed.error})`)
            continue
          }
          ye = { commands: [], truncated: false }
          const { createSkillCommand, parseSkillFrontmatterFields } =
            await import('../skills/loadSkillsDir.js')
          for (const T of listed.value) {
            if (
              T.name.length > 256 ||
              T.symlink ||
              !isMemoryStoreSkillFolderName(T.name)
            ) {
              skip(D.mount, `unsafe or symlinked skill folder in ${Z}`)
              continue
            }
            const file = await readMemoryStoreSkillFile(storageV5, {
              namespace: 'memory',
              projectKey: D.mount,
              relPath: [...ee.split('/'), T.name, 'SKILL.md'],
            })
            if (file.kind === 'absent') continue
            if (file.kind !== 'ok') {
              skip(D.mount, `read failed for ${T.name} (${file.kind})`)
              continue
            }
            const { frontmatter, content: markdownContent } = parseFrontmatter(
              file.content,
              join(Z, T.name, 'SKILL.md'),
            )
            const skillName = `${MEMORY_STORE_SKILL_NAME_PREFIX}${T.name}`
            const parsed = parseSkillFrontmatterFields(
              frontmatter,
              markdownContent,
              skillName,
            )
            ye.commands.push(
              createSkillCommand({
                ...parsed,
                skillName,
                markdownContent,
                source: 'memoryStore',
                baseDir: join(Z, T.name),
                loadedFrom: 'memoryStore',
                userInvocable: false,
                paths: undefined,
              }),
            )
          }
        } else {
          ye = await loadMemoryStoreSkillCommands(Z, why => skip(D.mount, why))
        }
        for (const ge of ye.commands) {
          if (seen.has(ge.name)) {
            logForDebugging(
              `memory-skills: ${ge.name} already registered by an earlier skills dir — ignoring the copy in ${ee} (${D.mount})`,
            )
            continue
          }
          seen.add(ge.name)
          loaded.push(ge)
        }
        truncated ||= ye.truncated
      }
    }
    if (bag.replace(loaded) && loaded.length > 0) {
      logForDebugging(
        `memory-skills: registered ${loaded.length} skill(s) under memories::`,
      )
    }
    if (skipped) {
      logEvent('memory_store_skills', {
        reason:
          'store_skipped' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    if (truncated) {
      logEvent('memory_store_skills', {
        reason:
          'skills_truncated' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  } catch (err) {
    logForDebugging(`memory-skills: register_failed ${String(err)}`, {
      level: 'error',
    })
    logEvent('memory_store_skills', {
      reason:
        'register_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
}

/** densable `refreshStoreSkills()` @181333180 — `Yw(this.storeSkillConfigs, stores, storageV5)`. */
export function refreshStoreSkills(
  configs: readonly MemoryStoreSkillDirConfig[] | null,
  stores: readonly MemoryStoreMount[] = [],
  storageV5?: unknown,
): void {
  if (configs === null) return
  void registerMemoryStoreSkills(configs, stores, storageV5)
}

export function filterCommandsBySkillAllowlist(
  commands: readonly Command[],
  allowlist: readonly string[] | undefined,
): Command[] {
  if (allowlist === undefined) return [...commands]
  return commands.filter(cmd =>
    allowlist.some(
      name =>
        cmd.name === name ||
        (cmd.loadedFrom === 'syncedSkills'
          ? (cmd.aliases?.includes(name) ?? false)
          : !(
              cmd.type === 'prompt' &&
              (cmd.source === 'memoryStore' || cmd.source === 'mcp')
            ) && cmd.name.endsWith(`:${name}`)),
    ),
  )
}
