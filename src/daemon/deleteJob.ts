/**
 * densable 2.1.214 C2e — deleteJob: kill-confirm then worktree gates then rm jobdir.
 * Used by `claude rm` (gJ_) and AgentView delete (#28/#29).
 *
 * densable:
 *   async function C2e(e,t={}){
 *     r=va(job); kill xKe(...,{evict:!0});
 *     if(!confirmed) return {removed:!1,errorCode:"kill_unconfirmed"}
 *     worktree: dirty|unpushed|in_use|live_lock|remove_failed|left_in_place
 *     rm jobdir; return {removed:!0,leftWorktreeDir?}
 *   }
 */
import { readdir, realpath, rm, unlink } from 'fs/promises'
import { join } from 'path'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { execFileNoThrowWithCwd } from '../utils/execFileNoThrow.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { gitExe } from '../utils/git.js'
import { removeAgentWorktree } from '../utils/worktree.js'
import {
  getJobDirPath,
  getJobsBaseDir,
  isTerminalState,
  listAllJobs,
  readBgJobState,
  type BgJobState,
} from './jobState.js'
import { killJobConfirmed } from './xyrRespawn.js'

/** densable NHe — job short directory names are 8 hex chars. */
export const JOB_SHORT_RE = /^[a-f0-9]{8}$/

export type KeptWorktreeReason =
  | 'dirty'
  | 'unpushed'
  | 'in_use'
  | 'live_lock'
  | 'remove_failed'

export type DeleteJobResult = {
  removed: boolean
  error?: string
  errorCode?: string
  keptWorktree?: string
  keptReason?: KeptWorktreeReason
  keptErrorSummary?: string
  leftWorktreeDir?: string
}

export type DeleteJobOpts = {
  /** densable t.force — allow dirty/unpushed worktree remove (FleetView always force) */
  force?: boolean
  /** densable t.knownGone — kill path already knows process gone */
  knownGone?: boolean
  /** densable t.internal — spare/claim paths skip some analytics */
  internal?: boolean
}

/** densable WX_ human phrases for kept reasons (CLI messaging). */
export const KEPT_WORKTREE_REASON_TEXT: Record<KeptWorktreeReason, string> = {
  dirty: 'has uncommitted changes',
  unpushed: 'has commits that are not pushed anywhere',
  in_use: 'is claimed by another running job',
  live_lock: 'is locked — in use by another live session, or locked by hand',
  remove_failed: 'could not be removed',
}

/**
 * densable Kjo — human phrase for kept worktree reason (+ optional error summary).
 */
export function formatKeptWorktreeReason(
  reason: KeptWorktreeReason | undefined,
  errorSummary?: string,
): string {
  const base = KEPT_WORKTREE_REASON_TEXT[reason ?? 'remove_failed']
  if (!errorSummary) return base
  const n = errorSummary
  const clipped = n.length <= 120 ? n : `${n.slice(0, 40)}\u2026${n.slice(-79)}`
  return `${base} (${clipped})`
}

/**
 * densable job short match: directory name under jobs/ starts with prefix.
 * densable NHe filter: only 8-char hex job dirs.
 */
export async function resolveJobShortByPrefix(
  prefix: string,
): Promise<
  | { ok: true; short: string }
  | { ok: false; kind: 'none' | 'ambiguous'; matches: string[] }
> {
  const base = getJobsBaseDir()
  const names = await readdir(base).catch(() => [] as string[])
  const matches = names.filter(
    n => JOB_SHORT_RE.test(n) && n.startsWith(prefix),
  )
  if (matches.length === 1) return { ok: true, short: matches[0]! }
  if (matches.length === 0) return { ok: false, kind: 'none', matches: [] }
  return { ok: false, kind: 'ambiguous', matches }
}

/**
 * densable ZJt subset — dirty working tree + optional gitError.
 * Does not require headCommit (unlike hasWorktreeChanges).
 */
async function worktreeDirtyAndGitError(
  worktreePath: string,
): Promise<{ dirty: boolean; gitError: boolean }> {
  const { code, stdout } = await execFileNoThrowWithCwd(
    gitExe(),
    ['status', '--porcelain'],
    { cwd: worktreePath },
  )
  if (code !== 0) return { dirty: false, gitError: true }
  return { dirty: stdout.trim().length > 0, gitError: false }
}

/**
 * densable unpushed gate: commits not reachable from any remote.
 */
async function worktreeHasUnpushedCommits(
  worktreePath: string,
): Promise<boolean> {
  const { code, stdout } = await execFileNoThrowWithCwd(
    gitExe(),
    ['rev-list', '--all', '--not', '--remotes', '--max-count=1'],
    { cwd: worktreePath },
  )
  if (code !== 0) return false
  return stdout.trim().length > 0
}

/**
 * densable GX_ — another non-terminal job claims the same worktree path.
 */
async function worktreeClaimedByOtherJob(
  short: string,
  worktreePath: string,
): Promise<boolean> {
  let resolved: string
  try {
    resolved = await realpath(worktreePath)
  } catch {
    resolved = worktreePath
  }
  const jobs = await listAllJobs().catch(
    () => [] as Array<{ short: string; state: BgJobState }>,
  )
  for (const j of jobs) {
    if (j.short === short) continue
    if (!j.state.worktreePath) continue
    if (isTerminalState(j.state)) continue
    let other: string
    try {
      other = await realpath(j.state.worktreePath)
    } catch {
      other = j.state.worktreePath
    }
    if (other === resolved) return true
  }
  return false
}

/**
 * densable C2e — delete background job + optional worktree.
 */
export async function deleteJob(
  short: string,
  opts: DeleteJobOpts = {},
): Promise<DeleteJobResult> {
  const state = readBgJobState(short)

  // densable xKe kill with evict. knownGone still attempts confirm path;
  // ENOJOB/ENOCONN fall through to confirmed via killJobConfirmed.
  void opts.knownGone
  const kill = await killJobConfirmed(short, { force: opts.force }).catch(
    (err: unknown) => ({
      confirmed: false as const,
      error: errorMessage(err),
    }),
  )
  if (!kill.confirmed) {
    logForDebugging(
      `deleteJob: kill unconfirmed for ${short} — skipping jobdir/worktree removal to avoid stranding a live worker`,
      { level: 'warn' },
    )
    return {
      removed: false,
      error: kill.error,
      errorCode: 'kill_unconfirmed',
    }
  }

  let leftWorktreeDir: string | undefined

  if (state?.worktreePath) {
    const wt = state.worktreePath
    // densable ZJt: gitError short-circuits dirty/unpushed/in_use gates
    const { dirty, gitError } = await worktreeDirtyAndGitError(wt)

    if (!gitError && (await worktreeClaimedByOtherJob(short, wt))) {
      logForDebugging(
        `deleteJob: ${wt} is claimed by another running job's state.json — not ours to remove`,
        { level: 'warn' },
      )
      return {
        removed: false,
        keptWorktree: wt,
        keptReason: 'in_use',
      }
    }

    // densable live_lock via worktree registry lockReason ($0e/e5e/U9i) —
    // local has no full lock registry yet; skip inventing. in_use covers
    // multi-job claim; kill_unconfirmed covers live workers.

    if (dirty && !gitError && !opts.force) {
      logForDebugging(
        `deleteJob: worktree has uncommitted changes, kept ${wt}`,
        { level: 'warn' },
      )
      return {
        removed: false,
        keptWorktree: wt,
        keptReason: 'dirty',
      }
    }

    if (!gitError && !opts.force && (await worktreeHasUnpushedCommits(wt))) {
      logForDebugging(
        `deleteJob: ${wt} has commits that are on no remote, kept`,
        { level: 'warn' },
      )
      return {
        removed: false,
        keptWorktree: wt,
        keptReason: 'unpushed',
      }
    }

    // densable F0e removeAgentWorktree — outcome failed | left_in_place | ok
    try {
      const ok = await removeAgentWorktree(
        wt,
        state.worktreeBranch,
        state.originCwd,
        state.worktreeHookBased,
      )
      if (!ok) {
        // hook-based with no hook, or non-git/orphan dir: densable left_in_place
        // still removes jobdir (session deleted; worktree dir retained).
        // force (FleetView) also left_in_place rather than block #29 non-git.
        if (state.worktreeHookBased || opts.force || gitError) {
          leftWorktreeDir = wt
        } else {
          return {
            removed: false,
            keptWorktree: wt,
            keptReason: 'remove_failed',
            keptErrorSummary: 'git worktree remove failed',
          }
        }
      }
    } catch (err) {
      logForDebugging(
        `deleteJob: removeAgentWorktree threw for ${wt}: ${errorMessage(err)}`,
        { level: 'error' },
      )
      return {
        removed: false,
        keptWorktree: wt,
        keptReason: 'remove_failed',
        keptErrorSummary: errorMessage(err),
      }
    }
  }

  const jobDir = getJobDirPath(short)
  try {
    await rm(jobDir, { recursive: true, force: true })
  } catch (err) {
    logForDebugging(
      `deleteJob: failed to remove job dir for ${short}: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    return {
      removed: false,
      error: `couldn't remove the session's state directory (${errorMessage(err)})`,
      errorCode: 'jobdir_rm_failed',
    }
  }

  // densable: unlink DFe(e) spare/pty residual path best-effort
  const spareMarker = join(
    getClaudeConfigHomeDir(),
    'sessions',
    `${short}.json`,
  )
  await unlink(spareMarker).catch(() => {})

  return {
    removed: true,
    ...(leftWorktreeDir ? { leftWorktreeDir } : {}),
  }
}
