/**
 * densable 2.1.228 #12 — harden skills synced from claude.ai.
 *
 * Gold (SEA):
 * - `efe` / `Bse`: Unicode-normalize skill names for collision checks
 * - `ULo` / `$ze` / `XBs` / `Vyn`: drop synced skills that collide with
 *   local/plugin/MCP/builtin names (or empty / `:` / `mcp__` prefixes)
 * - `xTt` / `n__` / `o__`: on the user's machine (not REMOTE/COWORK),
 *   synced skill bodies are untrusted — no `!` shell, no capability frontmatter
 * - `$vr` / `Phn` / `h9t` / `jp`: sanitize description text; label source
 * - `bDo`: empty capability frontmatter for hardened sources
 *
 * Full remote sync download remains denser; this is the portable harden core.
 */

import { getCommandName } from '../types/command.js'
import type { Command } from '../types/command.js'
import { AbortError } from '../utils/errors.js'
import { isEnvTruthy } from '../utils/envUtils.js'

export const CLAUDE_AI_SYNC_LABEL = 'claude.ai sync'

/** densable Bse — strip bidi/format chars then case-fold. */
export function caseFoldCommandName(name: string): string {
  return name
    .replace(/[‌-‏‪-‮⁪-⁯﻿]/g, '')
    .replace(/ẞ/g, '\xdf')
    .normalize('NFD')
    .toUpperCase()
    .toLowerCase()
}

/**
 * densable efe — normalize skill/command names for ownership / collision set.
 */
export function normalizeCommandNameKey(name: string): string {
  return caseFoldCommandName(
    name
      .normalize('NFKC')
      .replace(/[\p{Z}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu, '')
      .replace(/[\p{Pd}−]/gu, '-')
      .replace(/[꞉∶։׃ː]/g, ':'),
  )
}

/** densable jp — strip control / format chars from display text. */
export function stripControlCharsForDisplay(text: string): string {
  // U+2028/U+2029 LS/PS — unicode escapes so source stays single-line.
  return text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ')
}

/** densable h9t — HTML-escape angle brackets (description / arg sanitizer). */
export function escapeAngleBrackets(text: string): string {
  return text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** densable Phn — sanitize free-text skill fields. */
export function sanitizeSyncedSkillText(text: string): string {
  return escapeAngleBrackets(stripControlCharsForDisplay(text))
}

/**
 * densable $vr — sanitize description/whenToUse/argument fields for synced skills.
 * Descriptions are labeled with the densable source tag.
 */
export function sanitizeSyncedSkillDescription(description: string): string {
  const cleaned = sanitizeSyncedSkillText(description).trim()
  if (!cleaned) {
    return `[${CLAUDE_AI_SYNC_LABEL}]`
  }
  if (cleaned.includes(CLAUDE_AI_SYNC_LABEL)) {
    return cleaned
  }
  return `[${CLAUDE_AI_SYNC_LABEL}] ${cleaned}`
}

/**
 * densable bDo — capability frontmatter stripped for untrusted sources
 * (syncedSkills / MCP / memoryStore).
 */
export function emptyHardenedSkillCapabilities(): {
  hooks: undefined
  allowedTools: string[]
  disallowedTools: string[]
  executionContext: undefined
  agent: undefined
  background: undefined
  model: undefined
  effort: undefined
  shell: undefined
  paths: undefined
} {
  return {
    hooks: undefined,
    allowedTools: [],
    disallowedTools: [],
    executionContext: undefined,
    agent: undefined,
    background: undefined,
    model: undefined,
    effort: undefined,
    shell: undefined,
    paths: undefined,
  }
}

/**
 * densable o__ — remote/cowork environments trust the host's sync path.
 * On those hosts, synced skill bodies may run shell; on the user's machine they must not.
 */
export function isSyncedSkillRemoteHostEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_REMOTE) ||
    isEnvTruthy(env.CLAUDE_CODE_IS_COWORK) ||
    env.CLAUDE_CODE_ENTRYPOINT === 'remote_cowork'
  )
}

/**
 * densable n__ — is this loadedFrom an untrusted remote-ish source?
 * densable xTt for syncedSkills: !o__() (harden only on local machine).
 */
export function isUntrustedRemoteSkillSource(
  loadedFrom: string | undefined,
): boolean {
  switch (loadedFrom) {
    case 'skills':
    case 'commands_DEPRECATED':
    case 'plugin':
    case 'managed':
    case 'bundled':
      return false
    case 'syncedSkills':
    case 'mcp':
    case 'memoryStore':
    case 'attachedFolder':
      return true
    default:
      return false
  }
}

/**
 * densable xTt — true when skill body must be hardened (no ! shell, no @ expand).
 * syncedSkills → harden on local machine only; mcp/memoryStore always untrusted.
 */
export function shouldHardenSkillBody(
  loadedFrom: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (loadedFrom === 'syncedSkills') {
    return !isSyncedSkillRemoteHostEnv(env)
  }
  return isUntrustedRemoteSkillSource(loadedFrom)
}

/** densable $ze — add command name + display + aliases into ownership set. */
export function addCommandNamesToOwnedSet(
  owned: Set<string>,
  cmd: Pick<Command, 'name' | 'aliases' | 'userFacingName'>,
): void {
  owned.add(normalizeCommandNameKey(cmd.name))
  owned.add(normalizeCommandNameKey(getCommandName(cmd)))
  for (const alias of cmd.aliases ?? []) {
    owned.add(normalizeCommandNameKey(alias))
  }
}

/**
 * SEA `iG(e)`: true when a prompt command came from the host skill catalog
 * (`CLAUDE_CODE_HOST_SKILL_CATALOG`), e.g. claude.ai Directory plugins in Cowork.
 */
export function isFromHostCatalog(
  cmd: Pick<Command, 'type'> & { fromHostCatalog?: boolean },
): boolean {
  return cmd.type === 'prompt' && cmd.fromHostCatalog === true
}

/**
 * SEA `oB(e)`: true when a command is an account-synced skill (not host catalog).
 */
export function isAccountSyncedSkill(
  cmd: Pick<Command, 'type' | 'loadedFrom'> & { fromHostCatalog?: boolean },
): boolean {
  return cmd.loadedFrom === 'syncedSkills' && !isFromHostCatalog(cmd)
}

/**
 * densable ULo — seed ownership set from non-synced commands.
 */
export function buildOwnedCommandNameSet(
  commands: readonly Pick<
    Command,
    'name' | 'aliases' | 'userFacingName' | 'loadedFrom' | 'type'
  >[],
): Set<string> {
  const owned = new Set<string>()
  for (const cmd of commands) {
    if (isAccountSyncedSkill(cmd)) continue
    addCommandNamesToOwnedSet(owned, cmd)
  }
  return owned
}

/**
 * densable XBs — true if synced skill must be dropped (empty / colon / mcp__ / owned).
 */
export function isSyncedSkillNameBlocked(
  cmd: Pick<Command, 'name' | 'aliases' | 'userFacingName'>,
  owned: Set<string>,
): boolean {
  const keys = [cmd.name, getCommandName(cmd), ...(cmd.aliases ?? [])].map(
    normalizeCommandNameKey,
  )
  return keys.some(
    n => n === '' || n.includes(':') || n.startsWith('mcp__') || owned.has(n),
  )
}

/**
 * densable Vyn — keep non-synced; filter synced against owned names, claiming names as we go
 * so earlier synced skills own later ones.
 */
export function filterSyncedSkillsAgainstOwnedNames<
  T extends Pick<
    Command,
    'name' | 'aliases' | 'userFacingName' | 'loadedFrom' | 'type'
  >,
>(skills: readonly T[], owned: Set<string>): T[] {
  return skills.filter(cmd => {
    if (!isAccountSyncedSkill(cmd)) return true
    if (isSyncedSkillNameBlocked(cmd, owned)) return false
    addCommandNamesToOwnedSet(owned, cmd)
    return true
  })
}

/**
 * densable Fzt-ish + assemble helper: when any command is syncedSkills, re-filter
 * the list so synced entries cannot shadow local/plugin/MCP/builtins.
 */
export function applySyncedSkillShadowFilter(commands: Command[]): Command[] {
  if (!commands.some(c => isAccountSyncedSkill(c))) {
    return commands
  }
  const nonSynced = commands.filter(c => !isAccountSyncedSkill(c))
  const synced = commands.filter(c => isAccountSyncedSkill(c))
  const owned = buildOwnedCommandNameSet(nonSynced)
  const keptSynced = filterSyncedSkillsAgainstOwnedNames(synced, owned)
  // Preserve original relative order: non-synced first (as densable d=...), then kept synced
  // densable inserts synced among others; for local, append kept after non-synced is safe
  // and matches "local wins" shadow semantics.
  const keptSet = new Set(keptSynced)
  const out: Command[] = []
  for (const c of commands) {
    if (!isAccountSyncedSkill(c)) {
      out.push(c)
    } else if (keptSet.has(c)) {
      out.push(c)
    }
  }
  return out
}

export type PendingSkillDownloadOutcome =
  | { ok: true }
  | { ok: false; reason: string }

type PendingSkillDownloadEntry = {
  promise: Promise<PendingSkillDownloadOutcome>
  resolve: (outcome: PendingSkillDownloadOutcome) => void
  start?: (signal?: AbortSignal) => void
  controller: AbortController
}

const pendingSkillDownloads = new Map<string, PendingSkillDownloadEntry>()

/**
 * Official nGi (#1226) — register a pending skill download with an AbortController
 * so callers can cancel/race against an AbortSignal.
 */
export function registerPendingSkillDownload(
  skillName: string,
  start?: (signal?: AbortSignal) => void,
): (outcome: PendingSkillDownloadOutcome) => void {
  let resolve!: (outcome: PendingSkillDownloadOutcome) => void
  const promise = new Promise<PendingSkillDownloadOutcome>(r => {
    resolve = r
  })
  const controller = new AbortController()
  pendingSkillDownloads.set(skillName, {
    promise,
    resolve,
    start,
    controller,
  })
  return outcome => {
    pendingSkillDownloads.delete(skillName)
    resolve(outcome)
  }
}

/**
 * Official tFe + ir(tFe(e), signal, () => new AbortError) (#1226) —
 * start (if deferred) and await a pending skill download, cancelling via
 * AbortController if `signal` aborts.
 */
export function awaitPendingSkillDownload(
  skillName: string,
  signal?: AbortSignal,
): Promise<PendingSkillDownloadOutcome> {
  if (signal?.aborted) {
    const entry = pendingSkillDownloads.get(skillName)
    if (entry) {
      entry.start = undefined
      entry.controller.abort(signal.reason)
    }
    return Promise.reject(new AbortError('Skill download aborted'))
  }
  const entry = pendingSkillDownloads.get(skillName)
  if (!entry) {
    return Promise.resolve({ ok: true })
  }
  const start = entry.start
  entry.start = undefined
  if (start !== undefined) {
    try {
      start(entry.controller.signal)
    } catch {
      entry.resolve({ ok: false, reason: 'download could not start' })
    }
  }
  if (!signal) {
    return entry.promise
  }
  return new Promise<PendingSkillDownloadOutcome>((resolve, reject) => {
    const onAbort = () => {
      entry.controller.abort(signal.reason)
      reject(new AbortError('Skill download aborted'))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(
      outcome => {
        signal.removeEventListener('abort', onAbort)
        resolve(outcome)
      },
      err => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

export function hasPendingSkillDownload(skillName: string): boolean {
  return pendingSkillDownloads.has(skillName)
}

export function clearPendingSkillDownloads(): void {
  for (const entry of pendingSkillDownloads.values()) {
    entry.controller.abort()
  }
  pendingSkillDownloads.clear()
}
