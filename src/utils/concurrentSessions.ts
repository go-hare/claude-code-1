import { feature } from 'bun:bundle'
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from 'fs/promises'
import { join } from 'path'
import {
  getAttacherCaps,
  getOriginalCwd,
  getSessionId,
  onSessionSwitch,
} from '../bootstrap/state.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage, isFsInaccessible } from './errors.js'
import {
  buildProcessStartIdentityFields,
  getProcessLstartString,
  isProcessRunning,
} from './genericProcessUtils.js'
import { getPlatform } from './platform.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import { getAgentId } from './teammate.js'

export type SessionKind = 'interactive' | 'bg' | 'daemon' | 'daemon-worker'
export type SessionStatus = 'busy' | 'idle' | 'waiting'

/** densable session-registry capability voucher for idle notices (tqo). */
export const SESSION_FEATURE_NOTIFY_IDLE = 'notify_idle'

/**
 * densable 2.1.238 #28 — `bornSpare && !claimed`.
 * Claimed = CLAUDE_JOB_DIR/state.json exists (LPd). No storageV5 poll.
 */
export function computeSpareFlag(opts: {
  kind: SessionKind
  bgSource?: string
  claimed: boolean
}): true | undefined {
  const born = opts.kind === 'bg' && opts.bgSource === 'spare'
  return born && !opts.claimed ? true : undefined
}

/** densable LPd — claimed iff jobDir/state.json is present. */
export async function isSpareJobClaimed(
  jobDir: string | undefined = process.env.CLAUDE_JOB_DIR,
): Promise<boolean> {
  if (!jobDir) return false
  try {
    await lstat(join(jobDir, 'state.json'))
    return true
  } catch {
    return false
  }
}

/** densable bornSpare — in-process stamp so first busy can clear spare. */
let sessionBornSpare = false

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

/**
 * Kind override from env. Set by the spawner (`claude --bg`, daemon
 * supervisor) so the child can register without the parent having to
 * write the file for it — cleanup-on-exit wiring then works for free.
 * Gated so the env-var string is DCE'd from external builds.
 */
function envSessionKind(): SessionKind | undefined {
  if (feature('BG_SESSIONS')) {
    const k = process.env.CLAUDE_CODE_SESSION_KIND
    if (k === 'bg' || k === 'daemon' || k === 'daemon-worker') return k
  }
  return undefined
}

/**
 * True when this REPL is running inside a `claude --bg` tmux session.
 * Exit paths (/exit, ctrl+c, ctrl+d) should detach the attached client
 * instead of killing the process.
 */
export function isBgSession(): boolean {
  return envSessionKind() === 'bg'
}

/**
 * densable Pte() = ts() && !uE()
 *   ts = SESSION_KIND === 'bg'
 *   uE = attacherCaps truthy (terminal attached via attach / agent-view)
 *
 * Interactive panels that need a TTY (MCP OAuth, /mcp settings,
 * /install-github-app) refuse when this is true; agent-view attach sets
 * caps so the same commands work after attach (#32).
 */
export function isBgSessionWithoutTerminal(): boolean {
  if (!isBgSession()) return false
  return !getAttacherCaps()
}

/** densable KGo — MCP OAuth while bg has no attached terminal. */
export const BG_NO_TERMINAL_MCP_AUTH_MSG =
  "Can't authenticate MCP servers while no terminal is attached to this background session. Attach to it and try again."

/** densable uYp — /mcp panel while bg has no attached terminal. */
export const BG_NO_TERMINAL_MCP_SETTINGS_MSG =
  "Can't open MCP settings while no terminal is attached to this background session. Attach to it and run /mcp again, or use `/mcp enable|disable|reconnect <server>` to steer without the panel."

/** densable install-github-app entry refuse. */
export const BG_NO_TERMINAL_INSTALL_GITHUB_APP_MSG =
  "Can't run /install-github-app while no terminal is attached to this background session. Attach to it and run the command again."

/**
 * Write a PID file for this session and register cleanup.
 *
 * Registers all top-level sessions — interactive CLI, SDK (vscode, desktop,
 * typescript, python, -p), bg/daemon spawns — so `claude ps` sees everything
 * the user might be running. Skips only teammates/subagents, which would
 * conflate swarm usage with genuine concurrency and pollute ps with noise.
 *
 * Returns true if registered, false if skipped.
 * Errors logged to debug, never thrown.
 */
export async function registerSession(): Promise<boolean> {
  if (getAgentId() != null) return false

  const kind: SessionKind = envSessionKind() ?? 'interactive'
  const dir = getSessionsDir()
  const pidFile = join(dir, `${process.pid}.json`)

  registerCleanup(async () => {
    try {
      await unlink(pidFile)
    } catch {
      // ENOENT is fine (already deleted or never written)
    }
  })

  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
    // Official CLAUDE_CODE_BRIDGE_SESSION_ID densable — seed PID file when
    // child is spawned already attached to a bridge session (peer dedup).
    let envBridgeSessionId: string | undefined
    try {
      const { getBridgeSessionId } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
      envBridgeSessionId = getBridgeSessionId()
    } catch {
      const raw = process.env.CLAUDE_CODE_BRIDGE_SESSION_ID?.trim()
      envBridgeSessionId = raw && raw.length > 0 ? raw : undefined
    }
    // densable 2.1.232 #4 YM_: stamp process-start identity so live holders
    // are only sessions with a real procStart/procStartFt (not PID recycle).
    let processStartFields: { procStart?: string; procStartFt?: string } = {}
    try {
      const identity = await getProcessLstartString(process.pid)
      processStartFields = buildProcessStartIdentityFields(identity)
    } catch (e) {
      logForDebugging(
        `[concurrentSessions] procStart stamp failed: ${errorMessage(e)}`,
      )
    }
    // densable 2.1.238 #28 — bornSpare in-process; spare:true only while unclaimed.
    sessionBornSpare = kind === 'bg' && process.env.CLAUDE_BG_SOURCE === 'spare'
    const spare = sessionBornSpare
      ? computeSpareFlag({
          kind,
          bgSource: process.env.CLAUDE_BG_SOURCE,
          claimed: await isSpareJobClaimed(),
        })
      : undefined
    await writeFile(
      pidFile,
      jsonStringify({
        pid: process.pid,
        sessionId: getSessionId(),
        cwd: getOriginalCwd(),
        startedAt: Date.now(),
        kind,
        entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT,
        ...processStartFields,
        ...(envBridgeSessionId ? { bridgeSessionId: envBridgeSessionId } : {}),
        ...(feature('UDS_INBOX')
          ? {
              messagingSocketPath: process.env.CLAUDE_CODE_MESSAGING_SOCKET,
              // densable tqo voucher — peers read this to accept notify_when_idle.
              features: [SESSION_FEATURE_NOTIFY_IDLE],
            }
          : {}),
        ...(feature('BG_SESSIONS')
          ? {
              name: process.env.CLAUDE_CODE_SESSION_NAME,
              logPath: process.env.CLAUDE_CODE_SESSION_LOG,
              agent: process.env.CLAUDE_CODE_AGENT,
            }
          : {}),
        ...(spare ? { spare: true } : {}),
      }),
    )
    // --resume / /resume mutates getSessionId() via switchSession. Without
    // this, the PID file's sessionId goes stale and `claude ps` sparkline
    // reads the wrong transcript.
    onSessionSwitch(id => {
      void updatePidFile({ sessionId: id })
    })
    return true
  } catch (e) {
    logForDebugging(`[concurrentSessions] register failed: ${errorMessage(e)}`)
    return false
  }
}

/**
 * Update this session's name in its PID registry file so ListAgents
 * can surface it. Best-effort: silently no-op if name is falsy, the
 * file doesn't exist (session not registered), or read/write fails.
 */
async function updatePidFile(patch: Record<string, unknown>): Promise<void> {
  const pidFile = join(getSessionsDir(), `${process.pid}.json`)
  try {
    const data = jsonParse(await readFile(pidFile, 'utf8')) as Record<
      string,
      unknown
    >
    const next: Record<string, unknown> = { ...data, ...patch }
    // densable zMn — first busy clears spare (JSON omit).
    if (Object.hasOwn(patch, 'spare') && patch.spare === undefined) {
      delete next.spare
    }
    await writeFile(pidFile, jsonStringify(next))
  } catch (e) {
    logForDebugging(
      `[concurrentSessions] updatePidFile failed: ${errorMessage(e)}`,
    )
  }
}

/** densable pid registry `nameSource` for uniqueness / Bid. */
export type SessionNameSource = 'user' | 'collision' | 'derived' | 'auto'

/**
 * densable `JEe` subset — persist session display name into the PID registry
 * so ListAgents / uniqueness see the claim. Optional `nameSource` + `nameSince`
 * align densable 2.1.232 #4.
 */
export async function updateSessionName(
  name: string | undefined,
  source?: SessionNameSource,
): Promise<void> {
  if (!name) return
  await updatePidFile({
    name,
    nameSince: Date.now(),
    ...(source !== undefined ? { nameSource: source } : {}),
  })
}

/**
 * Toggle the pinned state for this session's PID file.
 */
export async function updateSessionPinned(pinned: boolean): Promise<void> {
  await updatePidFile({ pinned })
}

/**
 * Link a PR to this session's PID file for agent view display.
 */
export async function updateSessionPr(
  prNumber: number | undefined,
  prRepository: string | undefined,
): Promise<void> {
  await updatePidFile({ prNumber, prRepository })
}

/**
 * Patch another session's PID file by PID. Used by the agent view to
 * pin/rename/update sessions that belong to other processes.
 */
export async function patchSessionByPid(
  pid: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const pidFile = join(getSessionsDir(), `${pid}.json`)
  try {
    const data = jsonParse(await readFile(pidFile, 'utf8')) as Record<
      string,
      unknown
    >
    await writeFile(pidFile, jsonStringify({ ...data, ...patch }))
  } catch (e) {
    logForDebugging(
      `[concurrentSessions] patchSessionByPid(${pid}) failed: ${errorMessage(e)}`,
    )
  }
}

/**
 * Record this session's Remote Control session ID so peer enumeration can
 * dedup: a session reachable over both UDS and bridge should only appear
 * once (local wins). Cleared on bridge teardown so stale IDs don't
 * suppress a legitimately-remote session after reconnect.
 */
export async function updateSessionBridgeId(
  bridgeSessionId: string | null,
): Promise<void> {
  await updatePidFile({ bridgeSessionId })
}

/**
 * Push live activity state for `claude ps`. Fire-and-forget from REPL's
 * status-change effect — a dropped write just means ps falls back to
 * transcript-tail derivation for one refresh.
 */
export async function updateSessionActivity(patch: {
  status?: SessionStatus
  waitingFor?: string
  lastMessage?: string
}): Promise<void> {
  if (!feature('BG_SESSIONS')) return
  // densable zMn — first busy of a bornSpare worker clears spare:true.
  const clearSpare = sessionBornSpare && patch.status === 'busy'
  await updatePidFile({
    ...patch,
    updatedAt: Date.now(),
    ...(clearSpare ? { spare: undefined } : {}),
  })
}

/**
 * densable kla / messaging-socket stamp — refresh PID registry socket path +
 * `features: ["notify_idle"]` voucher after the inbox binds (or clears).
 */
export async function updateSessionMessagingSocket(
  messagingSocketPath: string | undefined,
): Promise<void> {
  if (!feature('UDS_INBOX')) return
  await updatePidFile({
    messagingSocketPath,
    features: messagingSocketPath ? [SESSION_FEATURE_NOTIFY_IDLE] : undefined,
  })
}

/**
 * densable 2.1.232 #4 `u2e` / `listLive` — live session records from the PID
 * registry (`~/.claude/sessions/<pid>.json`), including names for uniqueness.
 * Stale PID files are swept (same rules as {@link countConcurrentSessions}).
 */
export type LiveSessionRecord = {
  pid: number
  sessionId?: string
  name?: string
  startedAt: number
  nameSince?: number
  /** densable unix / non-FFI win32 process-start identity. */
  procStart?: string
  /** densable win32 kernel32 FFI FILETIME identity. */
  procStartFt?: string
  /** densable nameSource: user | collision | derived | auto */
  nameSource?: SessionNameSource
  kind?: SessionKind
  messagingSocketPath?: string
  /**
   * densable session-registry `features` voucher list.
   * Idle subscribe treats a present record that lacks `notify_idle` as peer-unsupported.
   */
  features?: string[]
  /** densable 2.1.238 #28 — unclaimed pre-warm spare. */
  spare?: boolean
}

export async function listLiveSessionRecords(): Promise<LiveSessionRecord[]> {
  const dir = getSessionsDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (e) {
    if (!isFsInaccessible(e)) {
      logForDebugging(
        `[concurrentSessions] listLive readdir failed: ${errorMessage(e)}`,
      )
    }
    return []
  }

  const live: LiveSessionRecord[] = []
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (Number.isNaN(pid)) continue
    if (pid !== process.pid && !isProcessRunning(pid)) {
      if (getPlatform() !== 'wsl') {
        void unlink(join(dir, file)).catch(() => {})
      }
      continue
    }
    try {
      const data = jsonParse(await readFile(join(dir, file), 'utf8')) as Record<
        string,
        unknown
      >
      const startedAt =
        typeof data.startedAt === 'number' ? data.startedAt : Date.now()
      const name = typeof data.name === 'string' ? data.name : undefined
      const nameSince =
        typeof data.nameSince === 'number' ? data.nameSince : undefined
      const procStart =
        typeof data.procStart === 'string' ? data.procStart : undefined
      const procStartFt =
        typeof data.procStartFt === 'string' ? data.procStartFt : undefined
      const nameSourceRaw = data.nameSource
      const nameSource =
        nameSourceRaw === 'user' ||
        nameSourceRaw === 'collision' ||
        nameSourceRaw === 'derived' ||
        nameSourceRaw === 'auto'
          ? nameSourceRaw
          : undefined
      const sessionId =
        typeof data.sessionId === 'string' ? data.sessionId : undefined
      const kind =
        data.kind === 'interactive' ||
        data.kind === 'bg' ||
        data.kind === 'daemon' ||
        data.kind === 'daemon-worker'
          ? data.kind
          : undefined
      const messagingSocketPath =
        typeof data.messagingSocketPath === 'string'
          ? data.messagingSocketPath
          : undefined
      const features = Array.isArray(data.features)
        ? data.features.filter((f): f is string => typeof f === 'string')
        : undefined
      live.push({
        pid,
        sessionId,
        name,
        startedAt,
        nameSince,
        procStart,
        procStartFt,
        nameSource,
        kind,
        messagingSocketPath,
        features,
        ...(data.spare === true ? { spare: true } : {}),
      })
    } catch (e) {
      logForDebugging(
        `[concurrentSessions] listLive read ${file} failed: ${errorMessage(e)}`,
      )
    }
  }
  return live
}

/**
 * Count live concurrent CLI sessions (including this one).
 * Filters out stale PID files (crashed sessions) and deletes them.
 * Returns 0 on any error (conservative).
 */
export async function countConcurrentSessions(): Promise<number> {
  const dir = getSessionsDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (e) {
    if (!isFsInaccessible(e)) {
      logForDebugging(`[concurrentSessions] readdir failed: ${errorMessage(e)}`)
    }
    return 0
  }

  let count = 0
  for (const file of files) {
    // Strict filename guard: only `<pid>.json` is a candidate. parseInt's
    // lenient prefix-parsing means `2026-03-14_notes.md` would otherwise
    // parse as PID 2026 and get swept as stale — silent user data loss.
    // See anthropics/claude-code#34210.
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (pid === process.pid) {
      count++
      continue
    }
    if (isProcessRunning(pid)) {
      count++
    } else if (getPlatform() !== 'wsl') {
      // Stale file from a crashed session — sweep it. Skip on WSL: if
      // ~/.claude/sessions/ is shared with Windows-native Claude (symlink
      // or CLAUDE_CONFIG_DIR), a Windows PID won't be probeable from WSL
      // and we'd falsely delete a live session's file. This is just
      // telemetry so conservative undercount is acceptable.
      void unlink(join(dir, file)).catch(() => {})
    }
  }
  return count
}
