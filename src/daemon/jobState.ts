/**
 * Job State — persistent state for background sessions.
 *
 * Upstream equivalent: `o7` (readJobState) / `nf` (writeJobState) in the official binary.
 *
 * Each bg session has a job directory at `~/.claude/jobs/<short>/state.json`.
 * The daemon writes state transitions; FleetView polls these files for display.
 *
 * State machine:
 *   starting → working → done | failed | stopped
 *                      → blocked → working (when user replies)
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { readdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BgSessionState =
  | 'starting'
  | 'working'
  | 'blocked'
  | 'stopped'
  | 'failed'
  | 'done'
  | 'crashed'
  | 'resuming'

export type BgSessionTempo = 'active' | 'idle' | 'blocked'

export interface BgJobState {
  state: BgSessionState
  detail: string
  tempo: BgSessionTempo
  intent: string
  name?: string
  nameSource?: 'user' | 'auto'
  initialPrompt?: string
  sessionId: string
  resumeSessionId?: string
  daemonShort?: string
  cwd: string
  template: string
  routine?: string
  agent?: string
  color?: string
  createdAt: string
  updatedAt: string
  firstTerminalAt: string | null
  output: Record<string, string> | null
  children: Array<{ id: string; href: string; kind?: string }> | null
  linkScanOffset?: number
  linkScanPath?: string
  /** Flags to pass on respawn */
  respawnFlags: string[]
  /**
   * Worktree isolation mode.
   * densable keepParent /fork writes `default` (not a handoff of the parent's
   * owned worktree); left-arrow may write `worktree` when handing off.
   */
  bgIsolation?: 'none' | 'worktree' | 'default'
  /** Origin CWD (before worktree) */
  originCwd?: string
  /** Worktree path if using worktree isolation */
  worktreePath?: string
  worktreeBranch?: string
  worktreeHookBased?: boolean
  /** Bridge session */
  bridgeSessionId?: string
  bridgeOutboundOnly?: boolean
  bridgeSessionSeq?: number
  /**
   * densable bridgeSessionGroupingId → CLAUDE_BRIDGE_REATTACH_GROUPING (rit n).
   * Pattern in gold: /^sgrp_[A-Za-z0-9_]{1,128}$/
   */
  bridgeSessionGroupingId?: string
  /** Backend that manages this job */
  backend?: 'daemon' | 'peer'
  /** PTY socket path */
  sock?: string
  /** Worker PID */
  pid?: number
  /** CLI version that wrote this state */
  cliVersion?: string
  /** Sort order override */
  sortOrder?: number
  stateSortOrder?: number
  /** Pinned in FleetView */
  pinned?: boolean
  /**
   * Custom FleetView group label (official job.state.group).
   * Used by group mode / Ctrl+E assign — local daemon jobs only.
   */
  group?: string
  /**
   * Soft-removed from main FleetView list (official archive).
   * Archived jobs can reappear under "Earlier" without hard delete.
   */
  archived?: boolean
  /** In-flight operations */
  inFlight?: { tasks: number; queued: number; kinds: string[] }
  /** What the session needs from the user */
  needs?: string
  /** Permission/question block */
  block?: {
    questions: Array<{
      question: string
      options: Array<{ label: string; description: string }>
    }>
  }
  /** Suggested reply for blocked sessions */
  suggestedReply?: string
  /** Provider environment overrides */
  providerEnv?: Record<string, string>
  /** Session permission rules */
  sessionPermissionRules?: { allow: string[]; deny: string[] }
  /** Memory toggled off */
  memoryToggledOff?: boolean
  /**
   * densable keepParent /fork (D$t): parent REPL still owns the source
   * transcript — child resume uses a job-local snapshot; do not treat parent
   * as handed-off/dead for live-parent protection.
   */
  forkSourceAlive?: boolean
  /** densable forkBoundaryAt — ISO timestamp of last parent message at fork. */
  forkBoundaryAt?: string
  /** densable forkSessionId — child session id allocated for the fork. */
  forkSessionId?: string
  /** densable forkParentSessionId — parent session that stayed live. */
  forkParentSessionId?: string
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getJobsBaseDir(): string {
  return join(getClaudeConfigHomeDir(), 'jobs')
}

export function getJobDirPath(short: string): string {
  return join(getJobsBaseDir(), short)
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export function readBgJobState(short: string): BgJobState | null {
  const stateFile = join(getJobDirPath(short), 'state.json')
  try {
    const raw = readFileSync(stateFile, 'utf-8')
    return jsonParse(raw) as BgJobState
  } catch {
    return null
  }
}

export function writeBgJobState(short: string, state: BgJobState): void {
  const dir = getJobDirPath(short)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), jsonStringify(state), 'utf-8')
}

export function patchBgJobState(
  short: string,
  patch: Partial<BgJobState>,
): BgJobState | null {
  const current = readBgJobState(short)
  if (!current) return null
  // Explicit undefined clears optional fields (JSON.stringify drops them on write).
  const updated: BgJobState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  for (const key of Object.keys(patch) as Array<keyof BgJobState>) {
    if (patch[key] === undefined) {
      delete updated[key]
    }
  }
  writeBgJobState(short, updated)
  return updated
}

// ---------------------------------------------------------------------------
// Terminal state helpers
// ---------------------------------------------------------------------------

export function isTerminalState(state: BgJobState): boolean {
  return (
    state.state === 'done' ||
    state.state === 'failed' ||
    state.state === 'stopped'
  )
}

// ---------------------------------------------------------------------------
// List all jobs
// ---------------------------------------------------------------------------

export async function listAllJobs(): Promise<
  Array<{ short: string; state: BgJobState }>
> {
  const baseDir = getJobsBaseDir()
  let dirs: string[]
  try {
    dirs = await readdir(baseDir)
  } catch {
    return []
  }

  const results: Array<{ short: string; state: BgJobState }> = []
  for (const short of dirs) {
    if (short.startsWith('.')) continue
    const stateFile = join(baseDir, short, 'state.json')
    try {
      const raw = await readFile(stateFile, 'utf-8')
      const state = jsonParse(raw) as BgJobState
      // If detail is empty, try to read last assistant message from transcript
      if (!state.detail && state.sessionId) {
        const detail = await readLastAssistantLine(state.sessionId, state.cwd)
        if (detail) state.detail = detail
      }
      results.push({ short, state })
    } catch {
      // Corrupt or missing state file — skip
    }
  }
  return results
}

/**
 * Read the last assistant text line from a session's transcript file.
 * Used to populate detail when the classifier hasn't written it yet.
 */
async function readLastAssistantLine(
  sessionId: string,
  cwd: string,
): Promise<string | undefined> {
  try {
    const { getClaudeConfigHomeDir } = await import('../utils/envUtils.js')
    const { readdirSync, statSync } = await import('fs')
    const projectsDir = join(getClaudeConfigHomeDir(), 'projects')
    // Find the transcript file — it's at ~/.claude/projects/<project-hash>/<sessionId>.jsonl
    let transcriptPath: string | undefined
    try {
      const projectDirs = readdirSync(projectsDir)
      for (const pd of projectDirs) {
        const candidate = join(projectsDir, pd, `${sessionId}.jsonl`)
        try {
          statSync(candidate)
          transcriptPath = candidate
          break
        } catch {}
      }
    } catch {}
    if (!transcriptPath) return undefined

    // Read last 8KB of the file to find the last assistant message
    const fs = await import('fs')
    const fd = fs.openSync(transcriptPath, 'r')
    const st = fs.fstatSync(fd)
    const readSize = Math.min(8192, st.size)
    const buf = Buffer.alloc(readSize)
    fs.readSync(fd, buf, 0, readSize, Math.max(0, st.size - readSize))
    fs.closeSync(fd)

    const lines = buf
      .toString('utf-8')
      .split('\n')
      .filter(l => l.trim())
    // Find last assistant message with text content
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const msg = jsonParse(lines[i]!) as Record<string, unknown>
        if (msg.type !== 'assistant') continue
        const content = (msg.message as Record<string, unknown>)?.content
        if (!Array.isArray(content)) continue
        for (let j = content.length - 1; j >= 0; j--) {
          const block = content[j] as Record<string, unknown>
          if (block.type === 'text' && typeof block.text === 'string') {
            const textLines = (block.text as string)
              .split('\n')
              .filter((l: string) => l.trim())
            if (textLines.length > 0) {
              return textLines[textLines.length - 1]!.slice(0, 120)
            }
          }
        }
      } catch {}
    }
  } catch {}
  return undefined
}

/**
 * Remove a job directory entirely.
 */
export async function removeJob(short: string): Promise<void> {
  const dir = getJobDirPath(short)
  await rm(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createInitialJobState(opts: {
  intent: string
  name?: string
  nameSource?: 'user' | 'auto'
  sessionId: string
  cwd: string
  template?: string
  agent?: string
  respawnFlags?: string[]
  short?: string
  detail?: string
  color?: string
  /** Resume/fork source transcript (left-arrow / exit handoff). */
  resumeSessionId?: string
  /** Worktree isolation (official hcn/A8q / densable keepParent). */
  bgIsolation?: 'none' | 'worktree' | 'default'
  originCwd?: string
  worktreePath?: string
  worktreeBranch?: string
  worktreeHookBased?: boolean
  bridgeSessionId?: string
  bridgeOutboundOnly?: boolean
  bridgeSessionSeq?: number
  bridgeSessionGroupingId?: string
  /** Official hcn/aAf session permission allow/deny rules. */
  sessionPermissionRules?: { allow: string[]; deny: string[] }
  /** Official hcn memoryToggledOff when auto-memory is off. */
  memoryToggledOff?: boolean
  /** densable keepParent live-parent fields (D$t). */
  forkSourceAlive?: boolean
  forkBoundaryAt?: string
  forkSessionId?: string
  forkParentSessionId?: string
}): BgJobState {
  const now = new Date().toISOString()
  // Official A8q/tHH: empty intent+detail → idle blocked needs prompt.
  const empty = opts.intent === '' && !opts.detail
  return {
    state: empty ? 'working' : 'starting',
    detail:
      opts.detail ?? (empty ? '(idle \u2014 send a prompt to start)' : ''),
    tempo: empty ? 'blocked' : 'active',
    intent: opts.intent,
    name: opts.name,
    nameSource: opts.nameSource,
    sessionId: opts.sessionId,
    resumeSessionId: opts.resumeSessionId,
    daemonShort: opts.short,
    cwd: opts.cwd,
    template: opts.agent ?? opts.template ?? 'bg',
    agent: opts.agent,
    color: opts.color,
    createdAt: now,
    updatedAt: now,
    firstTerminalAt: null,
    output: null,
    children: null,
    respawnFlags: opts.respawnFlags ?? [],
    needs: empty ? 'send a prompt to start' : undefined,
    backend: 'daemon',
    cliVersion: MACRO.VERSION,
    bgIsolation: opts.bgIsolation,
    originCwd: opts.originCwd,
    worktreePath: opts.worktreePath,
    worktreeBranch: opts.worktreeBranch,
    worktreeHookBased: opts.worktreeHookBased,
    bridgeSessionId: opts.bridgeSessionId,
    bridgeOutboundOnly: opts.bridgeOutboundOnly,
    bridgeSessionSeq: opts.bridgeSessionSeq,
    bridgeSessionGroupingId: opts.bridgeSessionGroupingId,
    sessionPermissionRules: opts.sessionPermissionRules,
    memoryToggledOff: opts.memoryToggledOff,
    forkSourceAlive: opts.forkSourceAlive,
    forkBoundaryAt: opts.forkBoundaryAt,
    forkSessionId: opts.forkSessionId,
    forkParentSessionId: opts.forkParentSessionId,
  }
}

/**
 * Official A8q / hcn — write job dir + state.json for left-arrow open before spawn.
 * densable keepParent /fork also uses this with forkSourceAlive + snapshot resume.
 * Returns short + jobDir for CLAUDE_AGENTS_SELECT / FleetView origin.
 */
export function writeA8qJobState(opts: {
  sessionId: string
  cwd: string
  intent: string
  name?: string
  nameSource?: 'user' | 'auto'
  detail?: string
  color?: string
  resumeSessionId?: string
  worktree?: {
    path: string
    branch?: string
    hookBased?: boolean
    originCwd?: string
  }
  /**
   * densable keepParent: `default` (parent keeps worktree).
   * When omitted: `worktree` if worktree meta present, else `none`.
   */
  bgIsolation?: 'none' | 'worktree' | 'default'
  bridgeSessionId?: string
  bridgeOutboundOnly?: boolean
  bridgeSessionSeq?: number
  /** densable bridgeSessionGroupingId for rit GROUPING on respawn. */
  bridgeSessionGroupingId?: string
  /** Official aAf → hcn sessionPermissionRules. */
  sessionPermissionRules?: { allow: string[]; deny: string[] }
  /** Official aAf → hcn memoryToggledOff. */
  memoryToggledOff?: boolean
  /** densable keepParent live-parent protection fields. */
  forkSourceAlive?: boolean
  forkBoundaryAt?: string
  forkSessionId?: string
  forkParentSessionId?: string
}): { short: string; jobDir: string } {
  const short = opts.sessionId.slice(0, 8)
  const jobDir = getJobDirPath(short)
  const bgIsolation = opts.bgIsolation ?? (opts.worktree ? 'worktree' : 'none')
  const state = createInitialJobState({
    intent: opts.intent,
    name: opts.name,
    nameSource: opts.nameSource,
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    detail: opts.detail,
    color: opts.color,
    short,
    template: 'bg',
    resumeSessionId: opts.resumeSessionId,
    bgIsolation,
    originCwd: opts.worktree?.originCwd,
    worktreePath: opts.worktree?.path,
    worktreeBranch: opts.worktree?.branch,
    worktreeHookBased: opts.worktree?.hookBased,
    bridgeSessionId: opts.bridgeSessionId,
    bridgeOutboundOnly: opts.bridgeOutboundOnly,
    bridgeSessionSeq: opts.bridgeSessionSeq,
    bridgeSessionGroupingId: opts.bridgeSessionGroupingId,
    sessionPermissionRules: opts.sessionPermissionRules,
    memoryToggledOff: opts.memoryToggledOff,
    forkSourceAlive: opts.forkSourceAlive,
    forkBoundaryAt: opts.forkBoundaryAt,
    forkSessionId: opts.forkSessionId,
    forkParentSessionId: opts.forkParentSessionId,
  })
  writeBgJobState(short, state)
  return { short, jobDir }
}
