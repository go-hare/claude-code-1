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
  name: string
  sessionId: string
  cwd: string
  template: string
  routine?: string
  createdAt: string
  updatedAt: string
  firstTerminalAt: string | null
  output: Record<string, string> | null
  children: Array<{ id: string; href: string; kind: string }> | null
  /** Flags to pass on respawn */
  respawnFlags: string[]
  /** Session ID to use when resuming (may differ from sessionId after fork) */
  resumeSessionId?: string
  /** Origin CWD (before worktree) */
  originCwd?: string
  /** Worktree path if using worktree isolation */
  worktreePath?: string
  /** Link scan offset for PR detection */
  linkScanOffset?: number
  /** Backend that manages this job */
  backend?: 'daemon' | 'detached' | 'tmux'
  /** Color override */
  color?: string
  /** Sort order override */
  sortOrder?: number
  /** Bridge session sequence */
  bridgeSessionSeq?: number
  /** In-flight operation */
  inFlight?: string
  /** What the session needs from the user */
  needs?: string
  /** Permission block description */
  block?: string
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
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() }
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
      results.push({ short, state })
    } catch {
      // Corrupt or missing state file — skip
    }
  }
  return results
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
  name: string
  sessionId: string
  cwd: string
  template?: string
  agent?: string
  respawnFlags?: string[]
}): BgJobState {
  const now = new Date().toISOString()
  return {
    state: 'starting',
    detail: '',
    tempo: 'active',
    intent: opts.intent,
    name: opts.name,
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    template: opts.agent ?? opts.template ?? 'bg',
    createdAt: now,
    updatedAt: now,
    firstTerminalAt: null,
    output: null,
    children: null,
    respawnFlags: opts.respawnFlags ?? [],
    backend: 'daemon',
  }
}
