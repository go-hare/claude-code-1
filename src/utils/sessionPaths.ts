/**
 * 会话路径与元数据助手 —— 刻意留在依赖环外的轻量模块。
 *
 * 这些函数原先住在 `sessionStorage.ts` 里。那个文件运行时可达 768 个模块
 * （一个强连通分量），冷加载约 8 秒，所以哪怕只想算一个 transcript 路径的
 * 调用方也得付这 8 秒。搬出来之后，只需要路径计算的调用方从这里 import。
 *
 * **硬约束：本模块不得 import `settings/settings.ts`，直接或间接。**
 * 它在环内（单独冷加载 7055ms），一旦引入，8 秒会悄无声息地回来。
 * `sessionPaths.loadbudget.test.ts` 用独立子进程守着这条线。
 *
 * 留在 `sessionStorage.ts` 没搬过来的：
 *   - `appendObserverRef`          调 `getProject()`，绑 Project 单例
 *   - `isTranscriptPersistenceDisabled`  调 `getSettings_DEPRECATED()`
 *   - `isLegacyProgressEntry` / `getEntrypoint`  仍被文件后段使用
 *
 * 详见 `docs/task/task-017-session-storage-hub-split.md`。
 */
import { feature } from 'bun:bundle'
import type { Dirent } from 'fs'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { dirname, join } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
} from '../bootstrap/state.js'
import { type AgentId, asAgentId } from '../types/ids.js'
import type { Entry, TranscriptMessage } from '../types/logs.js'
import type { Message } from '../types/message.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { isFsInaccessible } from './errors.js'
import { getFsImplementation } from './fsOperations.js'
import { sanitizePath } from './path.js'
import {
  getProjectDirNameOverride,
  projectDirNameOverrideCacheKey,
} from './sessionStoragePortable.js'

// ── isTranscriptMessage / isChainParticipant ──
/**
 * Type guard to check if an entry is a transcript message.
 * Transcript messages include user, assistant, attachment, and system messages.
 * IMPORTANT: This is the single source of truth for what constitutes a transcript message.
 * loadTranscriptFile() uses this to determine which messages to load into the chain.
 *
 * Progress messages are NOT transcript messages. They are ephemeral UI state
 * and must not be persisted to the JSONL or participate in the parentUuid
 * chain. Including them caused chain forks that orphaned real conversation
 * messages on resume (see #14373, #23537).
 */
export function isTranscriptMessage(entry: Entry): entry is TranscriptMessage {
  return (
    entry.type === 'user' ||
    entry.type === 'assistant' ||
    entry.type === 'attachment' ||
    entry.type === 'system'
  )
}

/**
 * Entries that participate in the parentUuid chain. Used on the write path
 * (insertMessageChain, useLogMessages) to skip progress when assigning
 * parentUuid. Old transcripts with progress already in the chain are handled
 * by the progressBridge rewrite in loadTranscriptFile.
 */
export function isChainParticipant(m: Pick<Message, 'type'>): boolean {
  return m.type !== 'progress'
}

// ── EPHEMERAL_PROGRESS_TYPES / isEphemeralToolProgress ──
/**
 * densable `XVt` / `mcn` — high-frequency ticks (bash/powershell/mcp,
 * tool_heartbeat, agent_api_retry, artifact_publish_retry) plus feature-gated
 * `sleep_progress`. Not ephemeral: agent_progress / hook_progress /
 * skill_progress. REPL replace-in-place; loadTranscriptFile skips legacy rows.
 */
const EPHEMERAL_PROGRESS_TYPES = new Set([
  'bash_progress',
  'powershell_progress',
  'mcp_progress',
  'tool_heartbeat',
  'agent_api_retry',
  'artifact_publish_retry',
  ...(feature('PROACTIVE') || feature('KAIROS')
    ? (['sleep_progress'] as const)
    : []),
])
/** densable `mcn` */
export function isEphemeralToolProgress(dataType: unknown): boolean {
  return typeof dataType === 'string' && EPHEMERAL_PROGRESS_TYPES.has(dataType)
}

// ── getProjectsDir … getAgentMetadataPath ──
export function getProjectsDir(): string {
  return join(getClaudeConfigHomeDir(), 'projects')
}

export function getTranscriptPath(): string {
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(projectDir, `${getSessionId()}.jsonl`)
}

export function getTranscriptPathForSession(sessionId: string): string {
  // When asking for the CURRENT session's transcript, honor sessionProjectDir
  // the same way getTranscriptPath() does. Without this, hooks get a
  // transcript_path computed from originalCwd while the actual file was
  // written to sessionProjectDir (set by switchActiveSession on resume/branch)
  // — different directories, so the hook sees MISSING (gh-30217). CC-34
  // made sessionId + sessionProjectDir atomic precisely to prevent this
  // kind of drift; this function just wasn't updated to read both.
  //
  // For OTHER session IDs we can only guess via originalCwd — we don't
  // track a sessionId→projectDir map. Callers wanting a specific other
  // session's path should pass fullPath explicitly (most save* functions
  // already accept this).
  if (sessionId === getSessionId()) {
    return getTranscriptPath()
  }
  const projectDir = getProjectDir(getOriginalCwd())
  return join(projectDir, `${sessionId}.jsonl`)
}

// 50 MB — session JSONL can grow to multiple GB (inc-3930). Callers that
// read the raw transcript must bail out above this threshold to avoid OOM.
export const MAX_TRANSCRIPT_READ_BYTES = 50 * 1024 * 1024

// In-memory map of agentId → subdirectory for grouping related subagent
// transcripts (e.g. workflow runs write to subagents/workflows/<runId>/).
// Populated before the agent runs; consulted by getAgentTranscriptPath.
const agentTranscriptSubdirs = new Map<string, string>()

export function setAgentTranscriptSubdir(
  agentId: string,
  subdir: string,
): void {
  agentTranscriptSubdirs.set(agentId, subdir)
}

export function clearAgentTranscriptSubdir(agentId: string): void {
  agentTranscriptSubdirs.delete(agentId)
}

export function getAgentTranscriptPath(agentId: AgentId): string {
  // Same sessionProjectDir consistency as getTranscriptPathForSession —
  // subagent transcripts live under the session dir, so if the session
  // transcript is at sessionProjectDir, subagent transcripts are too.
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  const sessionId = getSessionId()
  const subdir = agentTranscriptSubdirs.get(agentId)
  const base = subdir
    ? join(projectDir, sessionId, 'subagents', subdir)
    : join(projectDir, sessionId, 'subagents')
  return join(base, `agent-${agentId}.jsonl`)
}

function getAgentMetadataPath(agentId: AgentId): string {
  return getAgentTranscriptPath(agentId).replace(/\.jsonl$/, '.meta.json')
}

// ── AgentMetadata / 读写 / MainSessionObserverPointer ──
export type AgentMetadata = {
  agentType: string
  /**
   * densable `isFork` — true when spawn was FORK_AGENT (agentType "fork").
   * Aye: `S?.isFork===true` short-circuits type lookup and forces fork
   * system-prompt + exact tool pool restore (prevents default-agent revert).
   */
  isFork?: boolean
  /** Worktree path if the agent was spawned with isolation: "worktree" */
  worktreePath?: string
  /** densable worktree branch name (paired with worktreePath). */
  worktreeBranch?: string
  /**
   * densable `cwd` — explicit cwd when not worktree-isolated (or host cwd
   * snapshot). Resume prefers meta.cwd, else live worktree path.
   */
  cwd?: string
  /**
   * densable `spawnMode` — worker permission mode at spawn (Aye mode chain:
   * observerCap ?? workerPermissionMode ?? spawnMode ?? agent.permissionMode).
   */
  spawnMode?: string
  /**
   * densable `permissionMode` on agent_metadata mirror — agent definition
   * permission mode snapshot when present.
   */
  permissionMode?: string
  /** densable model pin for non-observer resume (`S?.model`). */
  model?: string
  /** densable spawnDepth for nested agent analytics / depth caps. */
  spawnDepth?: number
  /** densable parentAgentId lineage. */
  parentAgentId?: string
  /** densable tool_use id that spawned this agent. */
  toolUseId?: string
  /** densable taskKind (workflow/teammate/etc.) when set. */
  taskKind?: string
  /** densable teamName for swarm teammates. */
  teamName?: string
  /** densable color label. */
  color?: string
  /** densable planModeRequired flag. */
  planModeRequired?: boolean
  /** densable customAgentType when agentType is a generic wrapper. */
  customAgentType?: string
  /** Original task description from the AgentTool input. Persisted so a
   * resumed agent's notification can show the original description instead
   * of a placeholder. Optional — older metadata files lack this field. */
  description?: string
  /**
   * Official observer pointer densable — observerTaskId armed for this
   * observed agent (HXt). Used by resume re-arm (zOu/KOu).
   */
  observerTaskId?: string
  /** Official armingPermissionMode snapshot for observer re-arm. */
  armingPermissionMode?: string
  /**
   * Official n5r/HXt observerStopped tombstone densable. Written on the
   * observer agent sidecar when pairing is stopped so KOu reattach blocks.
   */
  observerStopped?: boolean
  /**
   * densable Gzg/hAe — user-initiated stop marker on agent sidecar.
   * Aye resume blocks auto-resume unless userInitiated clears it.
   */
  stoppedByUser?: boolean
  /**
   * densable observer sidecar marker (lYy / Aye gate):
   * spawnFirstRun writes isObserver:true; Aye observer-activity refuses
   * delivery when sidecar is missing or isObserver !== true.
   */
  isObserver?: boolean
  /**
   * densable E8/T1e `name` — display name for SendMessage registry.
   * Aye re-registers when registry entry is missing after cold resume.
   */
  name?: string
}

/**
 * densable `$Ns` — observer pairing keys preserved across full sidecar
 * rewrites (H4d). When a write omits these, keep prior values so runAgent
 * spawn metadata cannot clobber observer pointer/tombstone fields.
 */
export const AGENT_METADATA_PRESERVE_KEYS = [
  'isObserver',
  'observerStopped',
  'observerTaskId',
  'armingPermissionMode',
] as const satisfies ReadonlyArray<keyof AgentMetadata>

/**
 * Persist agent identity used to launch a subagent. Read by resume to
 * restore prompt + tool restrictions — without agentType/isFork/model,
 * resuming silently degrades to general-purpose (changelog #7). Sidecar
 * file avoids JSONL schema changes.
 *
 * densable H4d: when the write omits `$Ns` observer keys, merge prior
 * values from disk so spawn rewrites cannot drop observer pairing state.
 */
export async function writeAgentMetadata(
  agentId: AgentId,
  metadata: AgentMetadata,
): Promise<void> {
  const path = getAgentMetadataPath(agentId)
  let toWrite: AgentMetadata = metadata
  if (AGENT_METADATA_PRESERVE_KEYS.some(key => metadata[key] === undefined)) {
    try {
      const prev = await readAgentMetadata(agentId)
      if (prev) {
        let merged = metadata
        for (const key of AGENT_METADATA_PRESERVE_KEYS) {
          if (metadata[key] === undefined && prev[key] !== undefined) {
            merged = { ...merged, [key]: prev[key] }
          }
        }
        toWrite = merged
      }
    } catch {
      // Best-effort preserve; fall through to write as given.
    }
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(toWrite))
}

export async function readAgentMetadata(
  agentId: AgentId,
): Promise<AgentMetadata | null> {
  const path = getAgentMetadataPath(agentId)
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as AgentMetadata
  } catch (e) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}

/**
 * Official HXt densable — merge-patch agent sidecar metadata (read-merge-write).
 * Used by observer tombstone / pointer writes so concurrent fields survive.
 */
export async function patchAgentMetadata(
  agentId: AgentId,
  patch: Partial<AgentMetadata> & { agentType?: string },
): Promise<AgentMetadata> {
  const prev = await readAgentMetadata(agentId)
  const next: AgentMetadata = {
    ...(prev ?? {}),
    ...patch,
    agentType: patch.agentType ?? prev?.agentType ?? 'unknown',
  }
  await writeAgentMetadata(agentId, next)
  return next
}

/**
 * Official main-session observer HXt densable — pointer from the *main*
 * session to its armed observerTaskId (mirrors observed-agent agent meta).
 * Lives next to the session transcript so resume/reattach can re-arm VOu
 * across process restarts without a subagent observed sidecar.
 */
export type MainSessionObserverPointer = {
  observerTaskId: string
  /** Snapshot of permission mode at arm time (zOu re-arm). */
  armingPermissionMode?: string
  /** Observer agent type used when arming (KOu type-match). */
  observerAgentType?: string
}

// ── readLatestObserverRef / isObserverSidecarReattachable ──
/**
 * Official IZi densable — scan transcript tail-first for last observer-ref.
 * When agentId is provided, match that observed agent; when omitted, match
 * main-session refs (no agentId on the entry).
 *
 * Also falls back to `${sessionId}.observer.meta.json` when no transcript
 * entry exists (compat with earlier densable pointer files).
 */
export async function readLatestObserverRef(input?: {
  sessionId?: string
  agentId?: string
}): Promise<{
  observerTaskId: string
  observerAgentType?: string
  armingPermissionMode?: string
  agentId?: string
  timestamp?: string
} | null> {
  const sessionId = input?.sessionId ?? getSessionId()
  const path = getTranscriptPathForSession(sessionId)
  try {
    const st = await stat(path)
    if (st.size > MAX_TRANSCRIPT_READ_BYTES) {
      // Fall through to meta pointer for huge transcripts
    } else {
      const raw = await readFile(path, 'utf-8')
      const lines = raw.split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        if (!line || !line.includes('"observer-ref"')) continue
        try {
          const parsed = JSON.parse(line) as {
            type?: string
            observerTaskId?: string
            observerAgentType?: string
            armingPermissionMode?: string
            agentId?: string
            timestamp?: string
          }
          if (parsed?.type !== 'observer-ref') continue
          if (typeof parsed.observerTaskId !== 'string') continue
          if (input?.agentId) {
            if (parsed.agentId !== input.agentId) continue
          } else if (parsed.agentId) {
            // main-session read skips agent-scoped refs
            continue
          }
          return {
            observerTaskId: parsed.observerTaskId,
            ...(typeof parsed.observerAgentType === 'string'
              ? { observerAgentType: parsed.observerAgentType }
              : {}),
            ...(typeof parsed.armingPermissionMode === 'string'
              ? { armingPermissionMode: parsed.armingPermissionMode }
              : {}),
            ...(typeof parsed.agentId === 'string'
              ? { agentId: parsed.agentId }
              : {}),
            ...(typeof parsed.timestamp === 'string'
              ? { timestamp: parsed.timestamp }
              : {}),
          }
        } catch {
          // skip bad lines
        }
      }
    }
  } catch (e) {
    if (!isFsInaccessible(e)) throw e
  }
  // Compat fallback: side-file pointer (pre-observer-ref densable).
  if (!input?.agentId) {
    return readMainSessionObserverPointer(sessionId)
  }
  return null
}

/**
 * Official kZi densable — whether an observer agent sidecar transcript still
 * exists on disk (reattachable).
 */
export async function isObserverSidecarReattachable(
  observerTaskId: string,
): Promise<boolean> {
  try {
    const path = getAgentTranscriptPath(asAgentId(observerTaskId))
    await stat(path)
    return true
  } catch {
    return false
  }
}

// ── observer pointer 路径与读写 ──
export function getMainSessionObserverPointerPath(
  sessionId: string = getSessionId(),
): string {
  // Same projectDir resolution as getTranscriptPath / getTranscriptPathForSession.
  const projectDir =
    sessionId === getSessionId()
      ? (getSessionProjectDir() ?? getProjectDir(getOriginalCwd()))
      : getProjectDir(getOriginalCwd())
  return join(projectDir, `${sessionId}.observer.meta.json`)
}

export async function writeMainSessionObserverPointer(
  pointer: MainSessionObserverPointer,
  sessionId?: string,
): Promise<void> {
  const path = getMainSessionObserverPointerPath(sessionId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(pointer))
}

export async function readMainSessionObserverPointer(
  sessionId?: string,
): Promise<MainSessionObserverPointer | null> {
  const path = getMainSessionObserverPointerPath(sessionId)
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<MainSessionObserverPointer>
    if (
      typeof parsed.observerTaskId !== 'string' ||
      parsed.observerTaskId.length === 0
    ) {
      return null
    }
    return {
      observerTaskId: parsed.observerTaskId,
      ...(typeof parsed.armingPermissionMode === 'string'
        ? { armingPermissionMode: parsed.armingPermissionMode }
        : {}),
      ...(typeof parsed.observerAgentType === 'string'
        ? { observerAgentType: parsed.observerAgentType }
        : {}),
    }
  } catch (e) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}

/**
 * Merge-patch main-session observer pointer (read-merge-write).
 * Requires observerTaskId either in patch or existing file.
 */
export async function patchMainSessionObserverPointer(
  patch: Partial<MainSessionObserverPointer>,
  sessionId?: string,
): Promise<MainSessionObserverPointer | null> {
  const prev = await readMainSessionObserverPointer(sessionId)
  const observerTaskId = patch.observerTaskId ?? prev?.observerTaskId
  if (!observerTaskId) return null
  const next: MainSessionObserverPointer = {
    observerTaskId,
    ...(patch.armingPermissionMode !== undefined
      ? { armingPermissionMode: patch.armingPermissionMode }
      : prev?.armingPermissionMode !== undefined
        ? { armingPermissionMode: prev.armingPermissionMode }
        : {}),
    ...(patch.observerAgentType !== undefined
      ? { observerAgentType: patch.observerAgentType }
      : prev?.observerAgentType !== undefined
        ? { observerAgentType: prev.observerAgentType }
        : {}),
  }
  await writeMainSessionObserverPointer(next, sessionId)
  return next
}

// ── RemoteAgentMetadata 与读写 ──
export type RemoteAgentMetadata = {
  taskId: string
  remoteTaskType: string
  /** CCR session ID — used to fetch live status from the Sessions API on resume. */
  sessionId: string
  title: string
  command: string
  spawnedAt: number
  toolUseId?: string
  isLongRunning?: boolean
  isUltraplan?: boolean
  isRemoteReview?: boolean
  /** densable 2.1.218 — apply findings locally when review completes */
  applyFixesOnComplete?: boolean
  /** densable 2.1.218 — prose findings note (not a base branch) */
  reviewInstructions?: string
  remoteTaskMetadata?: Record<string, unknown>
}

function getRemoteAgentsDir(): string {
  // Same sessionProjectDir fallback as getAgentTranscriptPath — the project
  // dir (containing the .jsonl), not the session dir, so sessionId is joined.
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(projectDir, getSessionId(), 'remote-agents')
}

function getRemoteAgentMetadataPath(taskId: string): string {
  return join(getRemoteAgentsDir(), `remote-agent-${taskId}.meta.json`)
}

/**
 * Persist metadata for a remote-agent task so it can be restored on session
 * resume. Per-task sidecar file (sibling dir to subagents/) survives
 * hydrateSessionFromRemote's .jsonl wipe; status is always fetched fresh
 * from CCR on restore — only identity is persisted locally.
 */
export async function writeRemoteAgentMetadata(
  taskId: string,
  metadata: RemoteAgentMetadata,
): Promise<void> {
  const path = getRemoteAgentMetadataPath(taskId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(metadata))
}

export async function readRemoteAgentMetadata(
  taskId: string,
): Promise<RemoteAgentMetadata | null> {
  const path = getRemoteAgentMetadataPath(taskId)
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as RemoteAgentMetadata
  } catch (e) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}

export async function deleteRemoteAgentMetadata(taskId: string): Promise<void> {
  const path = getRemoteAgentMetadataPath(taskId)
  try {
    await unlink(path)
  } catch (e) {
    if (isFsInaccessible(e)) return
    throw e
  }
}

/**
 * Scan the remote-agents/ directory for all persisted metadata files.
 * Used by restoreRemoteAgentTasks to reconnect to still-running CCR sessions.
 */
export async function listRemoteAgentMetadata(): Promise<
  RemoteAgentMetadata[]
> {
  const dir = getRemoteAgentsDir()
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e) {
    if (isFsInaccessible(e)) return []
    throw e
  }
  const results: RemoteAgentMetadata[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.meta.json')) continue
    try {
      const raw = await readFile(join(dir, entry.name), 'utf-8')
      results.push(JSON.parse(raw) as RemoteAgentMetadata)
    } catch (e) {
      // Skip unreadable or corrupt files — a partial write from a crashed
      // fire-and-forget persist shouldn't take down the whole restore.
      logForDebugging(
        `listRemoteAgentMetadata: skipping ${entry.name}: ${String(e)}`,
      )
    }
  }
  return results
}

// ── sessionIdExists / getNodeEnv ──
export function sessionIdExists(sessionId: string): boolean {
  const projectDir = getProjectDir(getOriginalCwd())
  const sessionFile = join(projectDir, `${sessionId}.jsonl`)
  const fs = getFsImplementation()
  try {
    fs.statSync(sessionFile)
    return true
  } catch {
    return false
  }
}

// exported for testing
export function getNodeEnv(): string {
  return process.env.NODE_ENV || 'development'
}

// ── getUserType ──
// exported for testing
export function getUserType(): string {
  return process.env.USER_TYPE || 'external'
}

// ── isCustomTitleEnabled ──
export function isCustomTitleEnabled(): boolean {
  return true
}

// ── getProjectDir ──
// Memoized: called 12+ times per turn via hooks.ts createBaseHookInput
// (PostToolUse path, 5×/turn) + various save* functions. Input is a cwd
// string; homedir/env/regex are all session-invariant so the result is
// stable for a given input. Worktree switches just change the key — no
// cache clear needed.
// densable 2.1.234 #1 / XLe: honor CLAUDE_CODE_PROJECT_DIR_NAME when
// CLAUDE_CONFIG_DIR is set. Memo key includes both env vars (densable ify).
export const getProjectDir = memoize(
  (projectDir: string): string => {
    const override = getProjectDirNameOverride()
    return join(getProjectsDir(), override ?? sanitizePath(projectDir))
  },
  (projectDir: string) => `${projectDir}\0${projectDirNameOverrideCacheKey()}`,
)
