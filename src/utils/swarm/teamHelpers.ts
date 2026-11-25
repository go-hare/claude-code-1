import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSessionCreatedTeams } from '../../bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { getTeamsDir } from '../envUtils.js'
import { errorMessage, getErrnoCode } from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { gitExe } from '../git.js'
import * as lockfile from '../lockfile.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { getAgentName, getTeamName, isTeammate } from '../teammate.js'
import {
  clearTeamLeadEntryKeyForInbox,
  getInboxPath,
} from '../teammateMailbox.js'
import { type BackendType, isPaneBackend } from './backends/types.js'
import { TEAM_LEAD_NAME } from './constants.js'

export type TeamAllowedPath = {
  path: string // Directory path (absolute)
  toolName: string // The tool this applies to (e.g., "Edit", "Write")
  addedBy: string // Agent name who added this rule
  addedAt: number // Timestamp when added
}

/**
 * Official 2.1.331 — identity of the leader process that owns a session team
 * config file, used to safely reclaim stale team directories after a crash
 * without clobbering another live leader's team.
 */
export type LeadProcessInfo = {
  pid: number
  pidSpace: string
  claimedAt: number
  procStart?: string
}

export type TeamFile = {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId?: string // Actual session UUID of the leader (for discovery)
  leadProcess?: LeadProcessInfo
  hiddenPaneIds?: string[] // Pane IDs that are currently hidden from the UI
  teamAllowedPaths?: TeamAllowedPath[] // Paths all teammates can edit without asking
  members: Array<{
    agentId: string
    name: string
    agentType?: string
    model?: string
    prompt?: string
    color?: string
    planModeRequired?: boolean
    joinedAt: number
    tmuxPaneId: string
    cwd: string
    worktreePath?: string
    sessionId?: string
    subscriptions: string[]
    backendType?: BackendType
    isActive?: boolean // false when idle, undefined/true when active
    mode?: PermissionMode // Current permission mode for this teammate
  }>
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional check for control chars in agent/team names
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

/** Official 2.1.331 `fyl` — detect ASCII control characters in agent/team names. */
export function hasControlChars(value: string): boolean {
  return CONTROL_CHAR_RE.test(value)
}

/**
 * Sanitizes a name for use in tmux window names, worktree paths, and file paths.
 * Replaces all non-alphanumeric characters with hyphens and lowercases.
 */
export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
}

/**
 * Sanitizes an agent name for use in deterministic agent IDs.
 * Replaces @ with - to prevent ambiguity in the agentName@teamName format.
 */
export function sanitizeAgentName(name: string): string {
  return name.replace(/@/g, '-')
}

/**
 * Gets the path to a team's directory
 */
export function getTeamDir(teamName: string): string {
  return join(getTeamsDir(), sanitizeName(teamName))
}

/**
 * Gets the path to a team's config.json file
 */
export function getTeamFilePath(teamName: string): string {
  return join(getTeamDir(teamName), 'config.json')
}

function isValidLeadProcess(value: unknown): value is LeadProcessInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const rec = value as Record<string, unknown>
  return (
    typeof rec.pid === 'number' &&
    Number.isSafeInteger(rec.pid) &&
    typeof rec.pidSpace === 'string' &&
    typeof rec.claimedAt === 'number' &&
    Number.isFinite(rec.claimedAt) &&
    (!('procStart' in rec) ||
      rec.procStart === undefined ||
      typeof rec.procStart === 'string')
  )
}

function isValidTeamMember(
  value: unknown,
): value is TeamFile['members'][number] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const rec = value as Record<string, unknown>
  return typeof rec.agentId === 'string' && typeof rec.name === 'string'
}

/**
 * Official 2.1.331 `hEo` — validate/sanitize parsed team config JSON so
 * corrupt or partially written objects never crash downstream readers.
 */
export function sanitizeTeamFile(raw: unknown): TeamFile | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const rec = raw as TeamFile
  if (typeof rec.name !== 'string') {
    return null
  }
  const members = Array.isArray(rec.members)
    ? rec.members.filter(isValidTeamMember)
    : []
  const leadProcess = isValidLeadProcess(rec.leadProcess)
    ? rec.leadProcess
    : undefined
  if (
    Array.isArray(rec.members) &&
    members.length === rec.members.length &&
    leadProcess === rec.leadProcess
  ) {
    return rec
  }
  return { ...rec, members, leadProcess }
}

/**
 * Reads a team file by name (sync — for sync contexts like React render paths)
 * @internal Exported for team discovery UI
 */
// sync IO: called from sync context
export function readTeamFile(teamName: string): TeamFile | null {
  try {
    const content = readFileSync(getTeamFilePath(teamName), 'utf-8')
    return sanitizeTeamFile(jsonParse(content))
  } catch (e) {
    if (getErrnoCode(e) === 'ENOENT') return null
    logForDebugging(
      `[TeammateTool] Failed to read team file for ${teamName}: ${errorMessage(e)}`,
    )
    return null
  }
}

/**
 * Reads a team file by name (async — for tool handlers and other async contexts)
 */
export async function readTeamFileAsync(
  teamName: string,
): Promise<TeamFile | null> {
  try {
    const content = await readFile(getTeamFilePath(teamName), 'utf-8')
    return sanitizeTeamFile(jsonParse(content))
  } catch (e) {
    if (getErrnoCode(e) === 'ENOENT') return null
    logForDebugging(
      `[TeammateTool] Failed to read team file for ${teamName}: ${errorMessage(e)}`,
    )
    return null
  }
}

/**
 * Writes a team file (async — for initial team creation)
 */
export async function writeTeamFileAsync(
  teamName: string,
  teamFile: TeamFile,
): Promise<void> {
  const teamDir = getTeamDir(teamName)
  await mkdir(teamDir, { recursive: true })
  await writeFile(getTeamFilePath(teamName), jsonStringify(teamFile, null, 2))
}

const TEAM_FILE_LOCK_OPTIONS = {
  realpath: false,
  retries: {
    retries: 10,
    minTimeout: 5,
    maxTimeout: 100,
  },
  onCompromised: () => {},
}

const inProcessTeamFileQueues = new Map<string, Promise<unknown>>()

async function withInProcessTeamFileQueue<T>(
  configPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = inProcessTeamFileQueues.get(configPath) ?? Promise.resolve()
  let releaseQueue: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    releaseQueue = resolve
  })
  const tail = prev.then(() => gate)
  inProcessTeamFileQueues.set(configPath, tail)

  await prev
  try {
    return await fn()
  } finally {
    releaseQueue()
    if (inProcessTeamFileQueues.get(configPath) === tail) {
      inProcessTeamFileQueues.delete(configPath)
    }
  }
}

function missingTeamFileError(teamName: string): Error {
  return new Error(
    `Internal error: team file for "${teamName}" not found. The session team should have been initialized at startup.`,
  )
}

/**
 * Official 2.1.331 `fke` — read-modify-write `config.json` while holding a
 * `proper-lockfile` lock on `${configPath}.lock` (plus in-process queue to
 * serialize concurrent same-process writers). Returning `false` from `updater`
 * aborts the write without rewriting the file.
 */
export async function updateTeamFile<T>(
  teamName: string,
  updater: (teamFile: TeamFile) => T | false,
  options?: { bestEffortWrite?: boolean },
): Promise<T | undefined> {
  const configPath = getTeamFilePath(teamName)
  return withInProcessTeamFileQueue(configPath, async () => {
    let release: (() => Promise<void>) | undefined
    try {
      release = await lockfile.lock(configPath, {
        lockfilePath: `${configPath}.lock`,
        ...TEAM_FILE_LOCK_OPTIONS,
      })
    } catch (err) {
      if (getErrnoCode(err) === 'ENOENT') {
        throw missingTeamFileError(teamName)
      }
      throw err
    }

    try {
      const teamFile = await readTeamFileAsync(teamName)
      if (!teamFile) {
        throw new Error(
          'Team config file unreadable (lock acquired, read failed)',
        )
      }
      const result = updater(teamFile)
      if (result === false) {
        return undefined
      }
      try {
        const serialized = jsonStringify(teamFile, null, 2)
        const handle = await open(configPath, 'r+')
        try {
          await handle.writeFile(serialized, 'utf-8')
          await handle.truncate(Buffer.byteLength(serialized, 'utf-8'))
        } finally {
          await handle.close()
        }
      } catch (writeErr) {
        if (!options?.bestEffortWrite) {
          throw getErrnoCode(writeErr) === 'ENOENT'
            ? missingTeamFileError(teamName)
            : writeErr
        }
        logForDebugging(
          `[TeammateTool] Failed to write team file for ${teamName}: ${errorMessage(writeErr)}`,
          { level: 'error' },
        )
      }
      return result
    } finally {
      try {
        await release()
      } catch (releaseErr) {
        logForDebugging(
          `[TeammateTool] updateTeamFile lock release failed: ${errorMessage(releaseErr)}`,
        )
      }
    }
  })
}

/**
 * Adds a member to the team config file under lock.
 */
export async function addMemberToTeam(
  teamName: string,
  member: TeamFile['members'][number],
): Promise<boolean> {
  try {
    const added = await updateTeamFile(teamName, teamFile => {
      if (teamFile.members.some(m => m.agentId === member.agentId)) {
        return false
      }
      teamFile.members.push(member)
      return true
    })
    return added === true
  } catch (err) {
    logForDebugging(
      `[TeammateTool] addMemberToTeam(${member.agentId}) failed for team ${teamName}: ${errorMessage(err)}`,
    )
    return false
  }
}

/**
 * Official 2.1.331 `nNi` — removes a member by agentId under lock (used for
 * rollback when spawn fails after identity reservation).
 */
export async function removeTeamMember(
  teamName: string,
  agentId: string,
): Promise<void> {
  try {
    await updateTeamFile(teamName, teamFile => {
      const idx = teamFile.members.findIndex(m => m.agentId === agentId)
      if (idx === -1) return false
      teamFile.members.splice(idx, 1)
      return true
    })
  } catch (err) {
    logForDebugging(
      `[TeammateTool] removeTeamMember(${agentId}) failed: ${errorMessage(err)}`,
    )
  }
}

/**
 * Removes a teammate from the team file by agent ID or name.
 * Used by the leader when processing shutdown approvals.
 */
export async function removeTeammateFromTeamFile(
  teamName: string,
  identifier: { agentId?: string; name?: string },
): Promise<boolean> {
  const identifierStr = identifier.agentId || identifier.name
  if (!identifierStr) {
    logForDebugging(
      '[TeammateTool] removeTeammateFromTeamFile called with no identifier',
    )
    return false
  }

  let notFound = false
  try {
    const removed =
      (await updateTeamFile(
        teamName,
        teamFile => {
          notFound = false
          const originalLength = teamFile.members.length
          teamFile.members = teamFile.members.filter(m => {
            if (identifier.agentId && m.agentId === identifier.agentId) {
              return false
            }
            if (identifier.name && m.name === identifier.name) {
              return false
            }
            return true
          })
          const changed = teamFile.members.length !== originalLength
          notFound = !changed
          return changed ? true : false
        },
        { bestEffortWrite: true },
      )) ?? false

    if (removed) {
      if (identifier.name) {
        clearTeamLeadEntryKeyForInbox(getInboxPath(identifier.name, teamName))
      }
      logForDebugging(
        `[TeammateTool] Removed teammate from team file: ${identifierStr}`,
      )
    } else if (notFound) {
      logForDebugging(
        `[TeammateTool] Teammate ${identifierStr} not found in team file for "${teamName}"`,
      )
    }
    return removed
  } catch (err) {
    logForDebugging(
      `[TeammateTool] Cannot remove teammate ${identifierStr} from "${teamName}": ${errorMessage(err)}`,
    )
    return false
  }
}

/**
 * Adds a pane ID to the hidden panes list in the team file.
 * @param teamName - The name of the team
 * @param paneId - The pane ID to hide
 * @returns true if the pane was added or already present, false if team doesn't exist
 */
export async function addHiddenPaneId(
  teamName: string,
  paneId: string,
): Promise<boolean> {
  try {
    let existed = false
    const updated = await updateTeamFile(
      teamName,
      teamFile => {
        existed = true
        const hiddenPaneIds = teamFile.hiddenPaneIds ?? []
        if (hiddenPaneIds.includes(paneId)) {
          return false
        }
        hiddenPaneIds.push(paneId)
        teamFile.hiddenPaneIds = hiddenPaneIds
        return true
      },
      { bestEffortWrite: true },
    )
    if (updated) {
      logForDebugging(
        `[TeammateTool] Added ${paneId} to hidden panes for team ${teamName}`,
      )
    }
    return existed
  } catch (err) {
    logForDebugging(
      `[TeammateTool] addHiddenPaneId(${paneId}) failed for team ${teamName}: ${errorMessage(err)}`,
    )
    return false
  }
}

/**
 * Removes a pane ID from the hidden panes list in the team file.
 * @param teamName - The name of the team
 * @param paneId - The pane ID to show (remove from hidden list)
 * @returns true if the team exists, false otherwise
 */
export async function removeHiddenPaneId(
  teamName: string,
  paneId: string,
): Promise<boolean> {
  try {
    let existed = false
    const updated = await updateTeamFile(
      teamName,
      teamFile => {
        existed = true
        const hiddenPaneIds = teamFile.hiddenPaneIds ?? []
        const index = hiddenPaneIds.indexOf(paneId)
        if (index === -1) {
          return false
        }
        hiddenPaneIds.splice(index, 1)
        teamFile.hiddenPaneIds = hiddenPaneIds
        return true
      },
      { bestEffortWrite: true },
    )
    if (updated) {
      logForDebugging(
        `[TeammateTool] Removed ${paneId} from hidden panes for team ${teamName}`,
      )
    }
    return existed
  } catch (err) {
    logForDebugging(
      `[TeammateTool] removeHiddenPaneId(${paneId}) failed for team ${teamName}: ${errorMessage(err)}`,
    )
    return false
  }
}

/**
 * Removes a teammate from the team config file by pane ID.
 * Also removes from hiddenPaneIds if present.
 * @param teamName - The name of the team
 * @param tmuxPaneId - The pane ID of the teammate to remove
 * @returns true if the member was removed, false if team or member doesn't exist
 */
export async function removeMemberFromTeam(
  teamName: string,
  tmuxPaneId: string,
): Promise<boolean> {
  try {
    const removed =
      (await updateTeamFile(
        teamName,
        teamFile => {
          const memberIndex = teamFile.members.findIndex(
            m => m.tmuxPaneId === tmuxPaneId,
          )
          if (memberIndex === -1) {
            return false
          }
          teamFile.members.splice(memberIndex, 1)
          if (teamFile.hiddenPaneIds) {
            const hiddenIndex = teamFile.hiddenPaneIds.indexOf(tmuxPaneId)
            if (hiddenIndex !== -1) {
              teamFile.hiddenPaneIds.splice(hiddenIndex, 1)
            }
          }
          return true
        },
        { bestEffortWrite: true },
      )) ?? false
    if (removed) {
      logForDebugging(
        `[TeammateTool] Removed member with pane ${tmuxPaneId} from team ${teamName}`,
      )
    }
    return removed
  } catch (err) {
    logForDebugging(
      `[TeammateTool] removeMemberFromTeam(${tmuxPaneId}) failed for team ${teamName}: ${errorMessage(err)}`,
    )
    return false
  }
}

/**
 * Removes a teammate from a team's member list by agent ID.
 * Use this for in-process teammates which all share the same tmuxPaneId.
 * @param teamName - The name of the team
 * @param agentId - The agent ID of the teammate to remove (e.g., "researcher@my-team")
 * @returns true if the member was removed, false if team or member doesn't exist
 */
export async function removeMemberByAgentId(
  teamName: string,
  agentId: string,
  options?: { onlyIfJoinedBefore?: number },
): Promise<boolean> {
  let skippedStale = false
  try {
    const removed =
      (await updateTeamFile(
        teamName,
        teamFile => {
          const memberIndex = teamFile.members.findIndex(
            m => m.agentId === agentId,
          )
          const member = teamFile.members[memberIndex]
          if (!member) {
            skippedStale = false
            return false
          }
          if (
            options?.onlyIfJoinedBefore !== undefined &&
            member.joinedAt >= options.onlyIfJoinedBefore
          ) {
            skippedStale = true
            return false
          }
          skippedStale = false
          teamFile.members.splice(memberIndex, 1)
          return true
        },
        { bestEffortWrite: true },
      )) ?? false
    if (removed) {
      logForDebugging(
        `[TeammateTool] Removed member ${agentId} from team ${teamName}`,
      )
    } else if (skippedStale) {
      logForDebugging(
        `[TeammateTool] Skipped stale removal of ${agentId} from team ${teamName} (re-added after removal was initiated)`,
      )
    }
    return removed
  } catch (err) {
    logForDebugging(
      `[TeammateTool] removeMemberByAgentId(${agentId}) failed for team ${teamName}: ${errorMessage(err)}`,
    )
    return false
  }
}

/**
 * Sets a team member's permission mode.
 * Called when the team leader changes a teammate's mode via the TeamsDialog.
 * @param teamName - The name of the team
 * @param memberName - The name of the member to update
 * @param mode - The new permission mode
 */
export async function setMemberMode(
  teamName: string,
  memberName: string,
  mode: PermissionMode,
): Promise<boolean> {
  const outcome: { status: 'unchanged' | 'absent' | 'set' } = {
    status: 'unchanged',
  }
  try {
    await updateTeamFile(teamName, teamFile => {
      const member = teamFile.members.find(m => m.name === memberName)
      if (!member) {
        outcome.status = 'absent'
        return false
      }
      if (member.mode === mode) {
        outcome.status = 'unchanged'
        return false
      }
      outcome.status = 'set'
      member.mode = mode
      return true
    })
    if (outcome.status === 'absent') {
      logForDebugging(
        `[TeammateTool] Cannot set member mode: member ${memberName} not found in team ${teamName}`,
      )
      return false
    }
    if (outcome.status === 'set') {
      logForDebugging(
        `[TeammateTool] Set member ${memberName} in team ${teamName} to mode: ${mode}`,
      )
    }
    return true
  } catch (err) {
    logForDebugging(
      `[TeammateTool] Cannot set member mode: ${errorMessage(err)}`,
    )
    return false
  }
}

/**
 * Sync the current teammate's mode to config.json so team lead sees it.
 * No-op if not running as a teammate.
 * @param mode - The permission mode to sync
 * @param teamNameOverride - Optional team name override (uses env var if not provided)
 */
export function syncTeammateMode(
  mode: PermissionMode,
  teamNameOverride?: string,
): void {
  if (!isTeammate()) return
  const teamName = teamNameOverride ?? getTeamName()
  const agentName = getAgentName()
  if (teamName && agentName) {
    void setMemberMode(teamName, agentName, mode)
  }
}

/**
 * Sets multiple team members' permission modes in a single atomic locked operation.
 * Avoids race conditions when updating multiple teammates at once.
 * @param teamName - The name of the team
 * @param modeUpdates - Array of {memberName, mode} to update
 */
export async function setMultipleMemberModes(
  teamName: string,
  modeUpdates: Array<{ memberName: string; mode: PermissionMode }>,
): Promise<boolean> {
  const updateMap = new Map(modeUpdates.map(u => [u.memberName, u.mode]))
  try {
    let anyChanged = false
    await updateTeamFile(teamName, teamFile => {
      anyChanged = false
      for (const member of teamFile.members) {
        const newMode = updateMap.get(member.name)
        if (newMode !== undefined && member.mode !== newMode) {
          member.mode = newMode
          anyChanged = true
        }
      }
      return anyChanged ? true : false
    })
    if (anyChanged) {
      logForDebugging(
        `[TeammateTool] Set ${modeUpdates.length} member modes in team ${teamName}`,
      )
    }
    return true
  } catch (err) {
    logForDebugging(
      `[TeammateTool] Cannot set multiple member modes: ${errorMessage(err)}`,
    )
    return false
  }
}

/**
 * Sets a team member's active status.
 * Called when a teammate becomes idle (isActive=false) or starts a new turn (isActive=true).
 * @param teamName - The name of the team
 * @param memberName - The name of the member to update
 * @param isActive - Whether the member is active (true) or idle (false)
 */
export async function setMemberActive(
  teamName: string,
  memberName: string,
  isActive: boolean,
): Promise<void> {
  const outcome: { status: 'unchanged' | 'absent' | 'set' } = {
    status: 'unchanged',
  }
  try {
    await updateTeamFile(teamName, teamFile => {
      const member = teamFile.members.find(m => m.name === memberName)
      if (!member) {
        outcome.status = 'absent'
        return false
      }
      if (member.isActive === isActive) {
        outcome.status = 'unchanged'
        return false
      }
      outcome.status = 'set'
      member.isActive = isActive
      return true
    })
    if (outcome.status === 'absent') {
      logForDebugging(
        `[TeammateTool] Cannot set member active: member ${memberName} not found in team ${teamName}`,
      )
    } else if (outcome.status === 'set') {
      logForDebugging(
        `[TeammateTool] Set member ${memberName} in team ${teamName} to ${isActive ? 'active' : 'idle'}`,
      )
    }
  } catch (err) {
    logForDebugging(
      `[TeammateTool] Cannot set member active: ${errorMessage(err)}`,
    )
  }
}

/**
 * Sets multiple team members' active status in a single locked operation.
 */
export async function setMultipleMembersActive(
  teamName: string,
  activeUpdates: Array<{ memberName: string; isActive: boolean }>,
): Promise<void> {
  const updateMap = new Map(activeUpdates.map(u => [u.memberName, u.isActive]))
  try {
    await updateTeamFile(teamName, teamFile => {
      let anyChanged = false
      for (const member of teamFile.members) {
        const nextActive = updateMap.get(member.name)
        if (nextActive !== undefined && member.isActive !== nextActive) {
          member.isActive = nextActive
          anyChanged = true
        }
      }
      return anyChanged ? true : false
    })
  } catch (err) {
    logForDebugging(
      `[TeammateTool] Cannot set multiple members active: ${errorMessage(err)}`,
    )
  }
}

/**
 * Destroys a git worktree at the given path.
 * First attempts to use `git worktree remove`, then falls back to rm -rf.
 * Safe to call on non-existent paths.
 */
async function destroyWorktree(worktreePath: string): Promise<void> {
  // Read the .git file in the worktree to find the main repo
  const gitFilePath = join(worktreePath, '.git')
  let mainRepoPath: string | null = null

  try {
    const gitFileContent = (await readFile(gitFilePath, 'utf-8')).trim()
    // The .git file contains something like: gitdir: /path/to/repo/.git/worktrees/worktree-name
    const match = gitFileContent.match(/^gitdir:\s*(.+)$/)
    if (match && match[1]) {
      // Extract the main repo .git directory (go up from .git/worktrees/name to .git)
      const worktreeGitDir = match[1]
      // Go up 2 levels from .git/worktrees/name to get to .git, then get parent for repo root
      const mainGitDir = join(worktreeGitDir, '..', '..')
      mainRepoPath = join(mainGitDir, '..')
    }
  } catch {
    // Ignore errors reading .git file (path doesn't exist, not a file, etc.)
  }

  // Try to remove using git worktree remove command
  if (mainRepoPath) {
    const result = await execFileNoThrowWithCwd(
      gitExe(),
      ['worktree', 'remove', '--force', worktreePath],
      { cwd: mainRepoPath },
    )

    if (result.code === 0) {
      logForDebugging(
        `[TeammateTool] Removed worktree via git: ${worktreePath}`,
      )
      return
    }

    // Check if the error is "not a working tree" (already removed)
    if (result.stderr?.includes('not a working tree')) {
      logForDebugging(
        `[TeammateTool] Worktree already removed: ${worktreePath}`,
      )
      return
    }

    logForDebugging(
      `[TeammateTool] git worktree remove failed, falling back to rm: ${result.stderr}`,
    )
  }

  // Fallback: manually remove the directory
  try {
    await rm(worktreePath, { recursive: true, force: true })
    logForDebugging(
      `[TeammateTool] Removed worktree directory manually: ${worktreePath}`,
    )
  } catch (error) {
    logForDebugging(
      `[TeammateTool] Failed to remove worktree ${worktreePath}: ${errorMessage(error)}`,
    )
  }
}

/**
 * Mark a team as created this session so it gets cleaned up on exit.
 * Call this right after the initial writeTeamFile.
 * Backing Set lives in bootstrap/state.ts so resetStateForTests()
 * clears it between tests (avoids the PR #17615 cross-shard leak class).
 */
export function registerTeamForSessionCleanup(teamName: string): void {
  getSessionCreatedTeams().add(teamName)
}

/**
 * Remove a team from session cleanup tracking.
 */
export function unregisterTeamForSessionCleanup(teamName: string): void {
  getSessionCreatedTeams().delete(teamName)
}

/**
 * Process-owned pane tracking (official 2.1.331 `sNi` / `fVs`).
 * Ensures session cleanup only kills panes spawned by THIS leader process,
 * never panes owned by another session sharing or reclaiming a team name.
 */
const spawnedTeammatePanes = new Set<string>()

function paneOwnershipKey(backendType: BackendType, paneId: string): string {
  return `${backendType}:${paneId}`
}

/** Official 2.1.331 `sNi` — record a pane spawned by this leader process. */
export function recordSpawnedTeammatePane(
  backendType: BackendType,
  paneId: string,
): void {
  if (isPaneBackend(backendType) && paneId) {
    spawnedTeammatePanes.add(paneOwnershipKey(backendType, paneId))
  }
}

export function untrackSpawnedTeammatePane(
  backendType: BackendType,
  paneId: string,
): void {
  if (isPaneBackend(backendType) && paneId) {
    spawnedTeammatePanes.delete(paneOwnershipKey(backendType, paneId))
  }
}

export function _resetSpawnedTeammatePanesForTesting(): void {
  spawnedTeammatePanes.clear()
}

/**
 * Clean up all teams created this session that weren't explicitly deleted.
 * Registered with gracefulShutdown from init.ts.
 */
export async function cleanupSessionTeams(): Promise<void> {
  const sessionCreatedTeams = getSessionCreatedTeams()
  if (sessionCreatedTeams.size === 0) return
  const teams = Array.from(sessionCreatedTeams)
  logForDebugging(
    `cleanupSessionTeams: removing ${teams.length} orphan team dir(s): ${teams.join(', ')}`,
  )
  // Kill panes first — on SIGINT the teammate processes are still running;
  // deleting directories alone would orphan them in open tmux/iTerm2 panes.
  await Promise.allSettled(teams.map(name => killOrphanedTeammatePanes(name)))
  await Promise.allSettled(teams.map(name => cleanupTeamDirectories(name)))
  sessionCreatedTeams.clear()
}

/**
 * Best-effort kill of pane-backed teammate panes owned by this process.
 * Called from cleanupSessionTeams on ungraceful leader exit (SIGINT/SIGTERM).
 * Dynamic imports avoid adding registry/detection to this module's static
 * dep graph — this only runs at shutdown, so the import cost is irrelevant.
 */
export async function killOrphanedTeammatePanes(
  teamName: string,
  ownedPanes?: ReadonlySet<string>,
): Promise<void> {
  const teamFile = await readTeamFileAsync(teamName)
  if (!teamFile) return

  const owned = ownedPanes ?? spawnedTeammatePanes
  const paneMembers = teamFile.members.filter(
    m =>
      m.name !== TEAM_LEAD_NAME &&
      m.tmuxPaneId &&
      m.backendType &&
      isPaneBackend(m.backendType) &&
      (owned.has(paneOwnershipKey(m.backendType, m.tmuxPaneId)) ||
        owned.has(m.tmuxPaneId)),
  )
  if (paneMembers.length === 0) return

  const [{ ensureBackendsRegistered, getBackendByType }, { isInsideTmux }] =
    await Promise.all([
      import('./backends/registry.js'),
      import('./backends/detection.js'),
    ])
  await ensureBackendsRegistered()
  const useExternalSession = !(await isInsideTmux())

  await Promise.allSettled(
    paneMembers.map(async m => {
      // filter above guarantees these; narrow for the type system
      if (!m.tmuxPaneId || !m.backendType || !isPaneBackend(m.backendType)) {
        return
      }
      const ok = await getBackendByType(m.backendType).killPane(
        m.tmuxPaneId,
        useExternalSession,
      )
      logForDebugging(
        `cleanupSessionTeams: killPane ${m.name} (${m.backendType} ${m.tmuxPaneId}) → ${ok}`,
      )
    }),
  )
}

const CLEANUP_DELETE_ATTEMPTS = 3

/**
 * Official 2.1.331 `rSr` — cleans up ONLY `~/.claude/teams/{team}` (and any
 * recorded teammate git worktrees) using atomic rename (`${dir}.deleted-${id}`)
 * plus retry delete. NEVER deletes `~/.claude/tasks/{team}` so session tasks
 * survive exit for `--resume`.
 */
export async function cleanupTeamDirectories(teamName: string): Promise<void> {
  // Read team file to get worktree paths BEFORE deleting the team directory
  const teamFile = await readTeamFileAsync(teamName)
  const worktreePaths: string[] = []
  if (teamFile) {
    for (const member of teamFile.members) {
      if (member.worktreePath) {
        worktreePaths.push(member.worktreePath)
      }
    }
  }

  // Clean up worktrees first
  for (const worktreePath of worktreePaths) {
    await destroyWorktree(worktreePath)
  }

  // Clean up team directory (~/.claude/teams/{team-name}/) only — never tasks!
  const teamDir = getTeamDir(teamName)
  try {
    const tombstoneDir = `${teamDir}.deleted-${randomUUID()}`
    const targetDir = await rename(teamDir, tombstoneDir).then(
      () => tombstoneDir,
      () => teamDir,
    )
    for (let attempt = 1; ; attempt++) {
      await rm(targetDir, { recursive: true, force: true })
      const gone = await stat(targetDir).then(
        () => false,
        err => getErrnoCode(err) === 'ENOENT',
      )
      if (gone) break
      if (attempt === CLEANUP_DELETE_ATTEMPTS) {
        logForDebugging(
          `[TeammateTool] ${targetDir} still exists after ${attempt} delete attempts`,
        )
        throw new Error('team folder still exists after every delete attempt')
      }
    }
    logForDebugging(`[TeammateTool] Cleaned up team directory: ${teamDir}`)
  } catch (error) {
    logForDebugging(
      `[TeammateTool] Failed to clean up team directory ${teamDir}: ${errorMessage(error)}`,
    )
  }
}
