import { lstat, mkdir, readFile, rename, rmdir } from 'fs/promises'
import { hostname } from 'os'
import { join } from 'path'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import { formatAgentId } from '../agentId.js'
import { logForDebugging } from '../debug.js'
import { getTeamsDir } from '../envUtils.js'
import { errorMessage } from '../errors.js'
import {
  getProcessLstartString,
  getProcessStartTimeMs,
  isProcessGone,
  provenSameProcessAsync,
} from '../genericProcessUtils.js'
import { logError } from '../log.js'
import {
  ensureTasksDir,
  getLeaderTeamName,
  getSessionTaskListId,
  getTasksDir,
  listTasks,
  SESSION_LIST_FILE,
  SESSION_TASK_LIST_FILE,
  setLeaderTeamName,
  setSessionTaskListId,
  unassignTeammateTasks,
} from '../tasks.js'
import { TEAM_LEAD_NAME } from './constants.js'
import { assignTeammateColor } from './teammateLayoutManager.js'
import {
  cleanupTeamDirectories,
  getTeamDir,
  getTeamFilePath,
  hasControlChars,
  type LeadProcessInfo,
  readTeamFileAsync,
  registerTeamForSessionCleanup,
  sanitizeName,
  type TeamFile,
  unregisterTeamForSessionCleanup,
  updateTeamFile,
  writeTeamFileAsync,
} from './teamHelpers.js'

const SESSION_TEAM_PREFIX = 'session'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_TASK_LIST_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/
const LEAD_PROCESS_CLOCK_SKEW_MS = 2000
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const MAX_CUSTOM_SESSION_SUFFIX_LEN = 120

let inheritedTeamName: string | null | undefined

/**
 * Official 2.1.331 `GE(e)` — decode an Anthropic tagged base58 session ID
 * (`session_01...` / `cse_01...`) into its canonical 36-char UUID string.
 */
export function decodeTaggedSessionUuid(sessionId: string): string | undefined {
  const underscoreIdx = sessionId.lastIndexOf('_')
  if (underscoreIdx < 0) return undefined
  const payload = sessionId.slice(underscoreIdx + 1)
  if (!payload.startsWith('01')) return undefined
  let value = 0n
  for (const ch of payload.slice(2)) {
    const digit = BASE58_ALPHABET.indexOf(ch)
    if (digit < 0) return undefined
    value = value * 58n + BigInt(digit)
  }
  const hex = value.toString(16).padStart(32, '0')
  if (hex.length !== 32) return undefined
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Official 2.1.331 `H2t` / sessionTeamName:
 * - UUID session IDs → `session-${sessionId.slice(0, 8).toLowerCase()}`
 * - Tagged base58 session IDs (`session_01...`) → `session-${decodedUuid}`
 * - Arbitrary non-UUID session IDs → sanitized & length-bounded `session-<safe>`
 */
export function sessionTeamName(sessionId: string): string {
  if (UUID_RE.test(sessionId)) {
    return `${SESSION_TEAM_PREFIX}-${sessionId.slice(0, 8).toLowerCase()}`
  }
  const decodedUuid = decodeTaggedSessionUuid(sessionId)
  if (decodedUuid !== undefined) {
    return `${SESSION_TEAM_PREFIX}-${decodedUuid}`
  }
  const safe = sanitizeName(sessionId).slice(0, MAX_CUSTOM_SESSION_SUFFIX_LEN)
  return `${SESSION_TEAM_PREFIX}-${/[a-z0-9]/i.test(safe) ? safe : 'default'}`
}

/**
 * Official 2.1.331 `tbs` — validates a persisted or env-injected session task list ID.
 * Rejects control characters, path separators, traversal, and oversized IDs while
 * accepting UUIDs, tagged session IDs, `session-<8hex>`, and safe task list IDs.
 */
export function isValidSessionTaskListId(id: string): boolean {
  if (!id || hasControlChars(id) || !VALID_TASK_LIST_ID_RE.test(id)) {
    return false
  }
  const prefix = `${SESSION_TEAM_PREFIX}-`
  const stripped = id.startsWith(prefix) ? id.slice(prefix.length) : undefined
  if (
    UUID_RE.test(id) ||
    decodeTaggedSessionUuid(id) !== undefined ||
    (stripped !== undefined &&
      (UUID_RE.test(stripped) ||
        decodeTaggedSessionUuid(stripped) !== undefined ||
        /^[0-9a-f]{8}$/i.test(stripped)))
  ) {
    return true
  }
  return !id.includes('..')
}

/**
 * densable PQA — first call consumes CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME
 * into the process latch (official inheritedTeamName host).
 */
function consumeInheritedTeamName(): string | null {
  if (inheritedTeamName === undefined) {
    const fromEnv = process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME || null
    delete process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME
    inheritedTeamName = fromEnv
  }
  return inheritedTeamName ?? null
}

/** densable DQA / _resetInheritedTeamNameForTesting */
export function _resetInheritedTeamNameForTesting(): void {
  inheritedTeamName = undefined
}

/** Official 2.1.331 `A()` — build current leader process claim metadata. */
async function buildLeadProcess(): Promise<LeadProcessInfo> {
  const procStart =
    process.platform === 'linux'
      ? await getProcessLstartString(process.pid)
      : undefined
  return {
    pid: process.pid,
    pidSpace: hostname(),
    claimedAt: Date.now(),
    ...(procStart !== undefined ? { procStart } : {}),
  }
}

/**
 * Official 2.1.331 `P7o` — determine whether a recorded leader process on this
 * host is definitely dead (ESRCH or PID recycled). Cross-host claims return
 * `false` so we never steal a remote host's live team.
 */
async function isLeadProcessDead(
  leadProcess: LeadProcessInfo,
): Promise<boolean> {
  if (leadProcess.pidSpace !== hostname()) {
    return false
  }
  if (isProcessGone(leadProcess.pid)) {
    return true
  }
  if (leadProcess.procStart !== undefined) {
    const same = await provenSameProcessAsync(
      leadProcess.pid,
      leadProcess.procStart,
    )
    return same === false
  }
  const startMs = await getProcessStartTimeMs(leadProcess.pid)
  return (startMs ?? 0) > leadProcess.claimedAt + LEAD_PROCESS_CLOCK_SKEW_MS
}

/**
 * Official 2.1.331 `y()` — atomically claim a dead leader's team config under lock.
 */
async function tryClaimDeadTeam(
  teamName: string,
  existingFile: TeamFile,
): Promise<boolean> {
  const prevLead = existingFile.leadProcess
  if (!prevLead || !(await isLeadProcessDead(prevLead))) {
    return false
  }
  const nextLead = await buildLeadProcess()
  const claimed = await updateTeamFile(teamName, file => {
    if (
      file.leadProcess?.pid !== prevLead.pid ||
      file.leadProcess?.claimedAt !== prevLead.claimedAt
    ) {
      return false
    }
    file.leadProcess = nextLead
    return true
  }).catch(() => undefined)
  return claimed === true
}

/**
 * Official 2.1.331 `f()` — resolve whether a resumed session has a task list
 * override (post-`/clear` `.session-list` pointer or legacy session-ID keyed tasks).
 */
async function resolveSessionTaskListId(
  sessionId: string,
): Promise<string | undefined> {
  const teamKey = sessionTeamName(sessionId)
  if ((await listTasks(teamKey)).length > 0) {
    return undefined
  }
  const teamTasksDir = getTasksDir(teamKey)
  try {
    const dirInfo = await lstat(teamTasksDir)
    if (dirInfo.isDirectory() && !dirInfo.isSymbolicLink()) {
      for (const filename of [SESSION_LIST_FILE, SESSION_TASK_LIST_FILE]) {
        try {
          const content = (
            await readFile(join(teamTasksDir, filename), 'utf-8')
          )
            .slice(0, 64)
            .trim()
          if (content && isValidSessionTaskListId(content)) {
            return content
          }
        } catch {
          // Pointer file absent; try next
        }
      }
    }
  } catch {
    // Tasks dir absent
  }
  if ((await listTasks(sessionId)).length > 0) {
    return sessionId
  }
  return undefined
}

export type InitializeSessionTeamResult = {
  teamContext: NonNullable<AppState['teamContext']>
  teammateColors: {
    assignments: Map<string, ReturnType<typeof assignTeammateColor>>
    index: number
  }
}

/**
 * densable MQA / initializeSessionTeam — one implicit team per session
 * when agent swarms are enabled. Team name is session-derived unless
 * `existingTeamName` or CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME is set.
 */
export async function initializeSessionTeam(opts?: {
  existingTeamName?: string
  keepSessionKeyedTaskList?: boolean
}): Promise<InitializeSessionTeamResult> {
  const existing = opts?.existingTeamName || consumeInheritedTeamName()
  if (existing && hasControlChars(existing)) {
    throw new Error(
      'Invalid team_name: control characters are not allowed in agent or team names',
    )
  }
  const teamName = existing ?? sessionTeamName(getSessionId())
  const leadAgentId = formatAgentId(TEAM_LEAD_NAME, teamName)
  const teamFilePath = getTeamFilePath(teamName)
  const existingFile = existing ? await readTeamFileAsync(teamName) : null
  const leadProcess = await buildLeadProcess()

  if (existingFile) {
    await updateTeamFile(
      teamName,
      file => {
        file.leadProcess = leadProcess
        return true
      },
      { bestEffortWrite: true },
    ).catch(error => {
      logForDebugging(
        `[TeammateTool] Failed to update leadProcess for ${teamName}: ${errorMessage(error)}`,
        { level: 'error' },
      )
    })
  } else {
    const teamFile: TeamFile = {
      name: teamName,
      createdAt: Date.now(),
      leadAgentId,
      leadSessionId: getSessionId(),
      leadProcess,
      members: [
        {
          agentId: leadAgentId,
          name: TEAM_LEAD_NAME,
          agentType: TEAM_LEAD_NAME,
          joinedAt: Date.now(),
          tmuxPaneId: 'leader',
          // Official 2.1.325 #2365: start in session's original folder, not last shell cd.
          cwd: getOriginalCwd(),
          subscriptions: [],
          backendType: 'in-process',
        },
      ],
    }
    await writeTeamFileAsync(teamName, teamFile).catch(error => {
      logForDebugging(
        `[TeammateTool] Failed to write team file for ${teamName}: ${errorMessage(error)}`,
        { level: 'error' },
      )
      logError(error)
    })
  }

  setLeaderTeamName(teamName)
  const envTaskListId = process.env.CLAUDE_INTERNAL_SESSION_TASK_LIST_ID?.trim()
  delete process.env.CLAUDE_INTERNAL_SESSION_TASK_LIST_ID
  if (envTaskListId && isValidSessionTaskListId(envTaskListId)) {
    setSessionTaskListId(envTaskListId, { persist: false })
  }

  const sessionId = getSessionId()
  if (teamName !== sessionId && !opts?.keepSessionKeyedTaskList) {
    await rename(getTasksDir(sessionId), getTasksDir(teamName)).catch(() => {})
  }
  await ensureTasksDir(teamName)
  registerTeamForSessionCleanup(teamName)

  const color = assignTeammateColor(leadAgentId)
  return {
    teamContext: {
      teamName,
      teamFilePath,
      leadAgentId,
      teammates: {
        [leadAgentId]: {
          name: TEAM_LEAD_NAME,
          agentType: TEAM_LEAD_NAME,
          color,
          tmuxSessionName: 'in-process',
          tmuxPaneId: 'leader',
          // Official 2.1.325 #2365: start in session's original folder, not last shell cd.
          cwd: getOriginalCwd(),
          spawnedAt: Date.now(),
        },
      },
    },
    teammateColors: {
      assignments: new Map([[leadAgentId, color]]),
      index: 1,
    },
  }
}

/**
 * Official 2.1.331 `I()` — rekey the implicit startup session team after
 * switching to a resumed session ID (`--resume`, `--continue`, or `/resume`).
 */
async function rekeySessionTeam(): Promise<
  InitializeSessionTeamResult | undefined
> {
  const oldTeam = getLeaderTeamName()
  const prevSessionListId = getSessionTaskListId()
  const sessionId = getSessionId()
  const targetTeam = sessionTeamName(sessionId)
  if (!oldTeam) return undefined

  try {
    const oldFile = await readTeamFileAsync(oldTeam)
    if (
      !oldTeam.startsWith(`${SESSION_TEAM_PREFIX}-`) ||
      !oldFile ||
      oldFile.members.some(m => m.name !== TEAM_LEAD_NAME)
    ) {
      return undefined
    }
    if (oldTeam === targetTeam) {
      setSessionTaskListId(await resolveSessionTaskListId(sessionId), {
        persist: false,
      })
      return undefined
    }

    const targetFile = await readTeamFileAsync(targetTeam)
    let claimed: boolean
    if (targetFile) {
      claimed = await tryClaimDeadTeam(targetTeam, targetFile)
    } else {
      await mkdir(getTeamsDir(), { recursive: true }).catch(() => {})
      claimed = await mkdir(getTeamDir(targetTeam)).then(
        () => true,
        () => false,
      )
    }

    if (!claimed) {
      setSessionTaskListId(
        (await resolveSessionTaskListId(sessionId)) ?? targetTeam,
        { persist: false },
      )
      await rmdir(getTasksDir(oldTeam)).catch(() => {})
      return undefined
    }

    if (targetFile) {
      await cleanupTeamDirectories(targetTeam).catch(() => {})
    }

    const result = await initializeSessionTeam({
      keepSessionKeyedTaskList: true,
    })
    setSessionTaskListId(await resolveSessionTaskListId(sessionId), {
      persist: false,
    })

    await Promise.allSettled(
      (targetFile?.members ?? [])
        .filter(
          m => m.name !== TEAM_LEAD_NAME && m.backendType === 'in-process',
        )
        .map(m =>
          unassignTeammateTasks(targetTeam, m.agentId, m.name, 'terminated'),
        ),
    )

    unregisterTeamForSessionCleanup(oldTeam)
    await cleanupTeamDirectories(oldTeam).catch(() => {})
    await rmdir(getTasksDir(oldTeam)).catch(() => {})
    return result
  } catch (err) {
    setLeaderTeamName(oldTeam)
    setSessionTaskListId(prevSessionListId, { persist: false })
    logForDebugging(
      `[sessionTeam] Could not move the session team to the current session: ${errorMessage(err)}`,
      { level: 'error' },
    )
    return undefined
  }
}

/**
 * Official 2.1.331 `q()` — rekey session team on startup `--resume` / `--continue`.
 * Skips rekeying when this process inherited an explicit assistant team name.
 */
export async function rekeySessionTeamAtStartup(): Promise<
  InitializeSessionTeamResult | undefined
> {
  return inheritedTeamName ? undefined : rekeySessionTeam()
}

/**
 * Official 2.1.331 `J()` — rekey session team on mid-session `/resume`.
 * Clears any inherited assistant team latch before moving to the resumed session.
 */
export async function rekeySessionTeamInSession(): Promise<
  InitializeSessionTeamResult | undefined
> {
  inheritedTeamName = null
  return rekeySessionTeam()
}
