/**
 * densable 2.1.214/246 C2e / ze — deleteJob: kill-confirm then worktree gates
 * then rm jobdir. Used by `claude rm` (gJ_) and AgentView delete (#28/#29).
 *
 * densable ze(e,t={},r) @220104528 — r is storageV5 passed to Ma/ywe.
 */
import { lstat, readFile, readdir, realpath, rm, unlink } from 'fs/promises'
import { isAbsolute, join, normalize, relative, resolve } from 'path'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage, getErrnoCode, isENOENT } from '../utils/errors.js'
import { execFileNoThrowWithCwd } from '../utils/execFileNoThrow.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getCwd } from '../utils/cwd.js'
import { findGitRoot, gitExe } from '../utils/git.js'
import {
  containsPathTraversal,
  isNetworkUncPath,
  isNtObjectNamespacePathNormalized,
  isWindowsDeviceNamespacePath,
} from '../utils/path.js'
import {
  canReapDespiteLock,
  isJobWorktreeFullyUpstream,
  isWorktreeToplevelElsewhere,
  listPorcelainWorktrees,
  parseClaudeWorktreeLockPid,
  removeAgentWorktree,
  resolveGitRootIfPresent,
  resolveJobWorktreeGitRoot,
  resolveOriginHeadRef,
  WORKTREE_RESOLUTION_CHANGED,
} from '../utils/worktree.js'
import {
  getJobDirPath,
  getJobsBaseDir,
  isTerminalState,
  listAllJobs,
  readBgJobState,
  type BgJobState,
} from './jobState.js'
import { sleep } from '../utils/sleep.js'
import { killJobConfirmed, probeJobPresent } from './xyrRespawn.js'

/** densable NHe — job short directory names are 8 hex chars. */
export const JOB_SHORT_RE = /^[a-f0-9]{8}$/

export type KeptWorktreeReason =
  | 'dirty'
  | 'unpushed'
  | 'in_use'
  | 'live_lock'
  | 'occupied'
  | 'shared_record'
  | 'records_unreadable'
  | 'remove_failed'
  | 'unverified'
  | 'identity_changed'

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
  /** densable ze 3rd arg `r` — persist slot into W7/ywe. */
  storageV5?: unknown
}

/** densable WX_ human phrases for kept reasons (CLI messaging). */
export const KEPT_WORKTREE_REASON_TEXT: Record<KeptWorktreeReason, string> = {
  dirty: 'has uncommitted changes',
  unpushed: 'has commits that are not pushed anywhere',
  in_use: 'is claimed by another running job',
  live_lock: 'is locked — in use by another live session, or locked by hand',
  occupied: 'is the working directory of a live Claude Code session',
  shared_record:
    "is also recorded by another finished session — its files may be that session's work",
  records_unreadable:
    "could not be verified against other sessions' records — a sibling record was unreadable; retry, or inspect ~/.claude/jobs",
  remove_failed: 'could not be removed',
  unverified:
    'has files but no repository to verify them against — remove the directory manually, or delete from the agents view to discard it',
  identity_changed:
    'could not be verified — its resolution changed while being checked; retry the delete (a settled path re-verifies cleanly)',
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
  opts?: { hookBased?: boolean },
): Promise<{ dirty: boolean; gitError: boolean }> {
  const { code, stdout } = await execFileNoThrowWithCwd(
    gitExe(),
    ['status', '--porcelain'],
    { cwd: worktreePath },
  )
  // densable LMs: git failure and Rjr are dirty+gitError.
  if (code !== 0) return { dirty: true, gitError: true }
  if (!opts?.hookBased && (await isWorktreeToplevelElsewhere(worktreePath))) {
    return { dirty: true, gitError: true }
  }
  return { dirty: stdout.trim().length > 0, gitError: false }
}

type LiveSessionLike = {
  pid: number
  sessionId: string
  cwd: string
  kind: string
  jobId?: string
  parkedJobId?: string
}

function foldWorktreePathIdentity(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function worktreePathsIdentityEqual(a: string, b: string): boolean {
  return foldWorktreePathIdentity(a) === foldWorktreePathIdentity(b)
}

function isRefusedWorktreeRecordPath(path: string): boolean {
  const normalized = normalize(path)
  return (
    containsPathTraversal(normalized) ||
    isNetworkUncPath(normalized) ||
    isWindowsDeviceNamespacePath(path) ||
    isNtObjectNamespacePathNormalized(path)
  )
}

/** densable Ha — stored path vs realpath/raw. unverifiable → in_use / records. */
function worktreeRecordPathMatch(
  stored: string,
  resolved: string,
  raw: string,
): 'match' | 'no_match' | 'unverifiable' {
  if (
    worktreePathsIdentityEqual(stored, raw) ||
    worktreePathsIdentityEqual(stored, resolved)
  ) {
    return 'match'
  }
  // Relative: the record's base CWD is unknown, so resolve() against ours would
  // be meaningless. Unknown, not negative.
  if (!isAbsolute(stored)) return 'unverifiable'
  const normalized = resolve(stored)
  if (
    worktreePathsIdentityEqual(normalized, raw) ||
    worktreePathsIdentityEqual(normalized, resolved)
  ) {
    return 'match'
  }
  // A traversal/UNC/device-namespace record cannot be canonicalised, so we
  // cannot prove it is a different worktree; report unknown and let the callers
  // fail closed. An absolute, well-formed path that did not match above is a
  // definite non-match — the callers' realpath comparison is what catches
  // symlink/junction aliases, and it is only reachable through 'no_match'.
  return isRefusedWorktreeRecordPath(stored) ? 'unverifiable' : 'no_match'
}

function pathIsInsideWorktree(cwd: string, worktree: string): boolean {
  const rel = relative(
    foldWorktreePathIdentity(worktree),
    foldWorktreePathIdentity(cwd),
  )
  return rel.split(/[/\\]/, 1)[0] !== '..' && !isAbsolute(rel)
}

/** densable la — path presence via lstat. */
async function worktreePathPresence(
  path: string,
): Promise<'present' | 'gone' | 'unreadable'> {
  return lstat(path).then(
    () => 'present',
    (error: unknown) =>
      isENOENT(error) || getErrnoCode(error) === 'ENOTDIR'
        ? 'gone'
        : 'unreadable',
  )
}

async function resolveWorktreeRecordPath(path: string): Promise<string> {
  return realpath(path).catch(() => path)
}

/** densable El — another non-terminal job claims the same worktree (Ha/Ka). */
async function worktreeClaimedByOtherJob(
  short: string,
  resolved: string,
  raw: string,
): Promise<boolean> {
  const jobs = await listAllJobs().catch(
    () => [] as Array<{ short: string; state: BgJobState }>,
  )
  for (const j of jobs) {
    if (j.short === short) continue
    if (!j.state.worktreePath) continue
    if (isTerminalState(j.state)) continue
    const hit = worktreeRecordPathMatch(j.state.worktreePath, resolved, raw)
    if (hit === 'match' || hit === 'unverifiable') return true
    const other = await resolveWorktreeRecordPath(j.state.worktreePath)
    if (worktreePathsIdentityEqual(other, resolved)) return true
  }
  return false
}

/**
 * densable Al — sibling settled job recorded the same path.
 * readdir ENOENT → skip (null). Unreadable sibling → unreadable.
 */
async function siblingSettledWorktreeRecord(
  short: string,
  resolved: string,
  raw: string,
): Promise<'claimed' | 'unreadable' | null> {
  const base = getJobsBaseDir()
  let names: string[]
  try {
    names = await readdir(base)
  } catch (error) {
    if (isENOENT(error)) return null
    return 'unreadable'
  }
  for (const name of names) {
    if (name === short || name.startsWith('.')) continue
    const stateFile = join(base, name, 'state.json')
    let rawState: string
    try {
      rawState = await readFile(stateFile, 'utf-8')
    } catch (error) {
      if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') continue
      return 'unreadable'
    }
    let state: BgJobState
    try {
      state = JSON.parse(rawState) as BgJobState
    } catch {
      return 'unreadable'
    }
    if (!state.worktreePath || !isTerminalState(state)) continue
    const hit = worktreeRecordPathMatch(state.worktreePath, resolved, raw)
    if (hit === 'match') return 'claimed'
    if (hit === 'unverifiable') return 'unreadable'
    const other = await resolveWorktreeRecordPath(state.worktreePath)
    if (worktreePathsIdentityEqual(other, resolved)) return 'claimed'
  }
  return null
}

async function jobStateFilePresence(
  short: string,
): Promise<'missing' | 'present'> {
  try {
    await lstat(join(getJobDirPath(short), 'state.json'))
    return 'present'
  } catch {
    return 'missing'
  }
}

/** densable vl — live interactive/bg session whose cwd is inside the worktree. */
async function liveSessionOccupyingWorktree(
  sessions: LiveSessionLike[],
  short: string,
  jobPids: Set<number>,
  resolved: string,
  raw: string,
): Promise<LiveSessionLike | undefined> {
  for (const session of sessions) {
    if (session.kind !== 'interactive' && session.kind !== 'bg') continue
    if (jobPids.has(session.pid) || session.parkedJobId === short) continue
    if (session.pid === process.pid && session.parkedJobId === undefined) {
      continue
    }
    const cwd = session.pid === process.pid ? getCwd() : session.cwd
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) continue
    if (
      !pathIsInsideWorktree(cwd, resolved) &&
      !pathIsInsideWorktree(cwd, raw)
    ) {
      continue
    }
    if (
      session.kind === 'bg' &&
      typeof session.jobId === 'string' &&
      JOB_SHORT_RE.test(session.jobId) &&
      (await jobStateFilePresence(session.jobId)) === 'missing'
    ) {
      continue
    }
    return session
  }
  return undefined
}

function occupiedSessionSummary(session: LiveSessionLike): string {
  if (session.pid === process.pid) {
    const parked =
      typeof session.parkedJobId === 'string' &&
      JOB_SHORT_RE.test(session.parkedJobId)
        ? `session ${session.parkedJobId},`
        : 'a session'
    return `${parked} moved to the background from this window, pid ${session.pid}`
  }
  if (
    session.kind === 'bg' &&
    typeof session.jobId === 'string' &&
    JOB_SHORT_RE.test(session.jobId)
  ) {
    return `background session ${session.jobId}, pid ${session.pid}`
  }
  return `pid ${session.pid}, ${session.kind}`
}

/**
 * densable C2e — delete background job + optional worktree.
 */
export async function deleteJob(
  short: string,
  opts: DeleteJobOpts = {},
  storageV5?: unknown,
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

  // kill.confirmed is the supervisor ack, not "worker gone". Poll so a
  // still-running worker cannot rewrite state.json after we rm the job dir.
  {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && (await probeJobPresent(short))) {
      await sleep(50)
    }
  }

  let leftWorktreeDir: string | undefined

  if (state?.worktreePath) {
    const wt = state.worktreePath
    const persist = storageV5 ?? opts.storageV5
    const { dirty, gitError } = await worktreeDirtyAndGitError(wt, {
      hookBased: state.worktreeHookBased,
    })
    const gitRoot = resolveJobWorktreeGitRoot(wt, state.originCwd) ?? undefined
    const resolved = await realpath(wt).catch(() => wt)
    const listed =
      !gitError && gitRoot
        ? await listPorcelainWorktrees(gitRoot).catch(() => null)
        : null
    let porcelain: { worktreePath: string; lockReason?: string } | undefined
    for (const row of listed ?? []) {
      if (
        (await realpath(row.worktreePath).catch(() => row.worktreePath)) ===
        resolved
      ) {
        porcelain = row
        break
      }
    }
    const lockPid = parseClaudeWorktreeLockPid(porcelain?.lockReason)
    let live: LiveSessionLike[] = []
    let liveSessionsUnread = false
    try {
      const { listLiveSessions } = await import('../cli/bg.js')
      live = (await listLiveSessions()) as LiveSessionLike[]
    } catch (error) {
      liveSessionsUnread = true
      logForDebugging(
        `deleteJob: could not list live sessions (${errorMessage(error)}) — cannot rule out an occupant`,
        { level: 'warn' },
      )
    }
    const jobPids = new Set<number>()
    for (const session of live) {
      const jobId = session.jobId
      if (
        session.kind === 'bg' &&
        (jobId === short || session.sessionId?.startsWith(short))
      ) {
        jobPids.add(session.pid)
      }
    }

    let keptReason: KeptWorktreeReason | undefined
    let keptErrorSummary: string | undefined

    if (await worktreeClaimedByOtherJob(short, resolved, wt)) {
      logForDebugging(
        `deleteJob: ${wt} is claimed by another running job's state.json — not ours to remove`,
        { level: 'warn' },
      )
      keptReason = 'in_use'
    } else if ((await resolveGitRootIfPresent(wt)) === null) {
      const presence = await worktreePathPresence(wt)
      if (presence !== 'gone') {
        const sibling =
          presence === 'unreadable'
            ? 'unreadable'
            : await siblingSettledWorktreeRecord(short, resolved, wt)
        if (sibling !== null) {
          keptReason =
            sibling === 'claimed' ? 'shared_record' : 'records_unreadable'
          logForDebugging(
            sibling === 'claimed'
              ? `deleteJob: ${wt} is also recorded by another settled job's state.json — not removing another session's output`
              : `deleteJob: could not verify ${wt} against sibling records — refusing until records are readable`,
            { level: 'warn' },
          )
        }
      }
    }
    // canReapDespiteLock(undefined) means "no lock reason recorded, go ahead",
    // which is only sound when the records were actually read. A git error or a
    // failed porcelain list leaves porcelain undefined too, and that silently
    // disables the live-lock gate below — enough to force-unlock and remove a
    // worktree held by another live process. Unknown is not unlocked. A worktree
    // that is simply gone still gets its job record cleaned up.
    const lockRecordsUnread = gitError || (Boolean(gitRoot) && listed === null)
    if (
      keptReason === undefined &&
      lockRecordsUnread &&
      (await worktreePathPresence(wt)) !== 'gone'
    ) {
      logForDebugging(
        `deleteJob: could not read ${wt}'s git worktree records (${gitError ? 'git errored' : 'porcelain list failed'}) — cannot rule out a live lock, keeping`,
        { level: 'warn' },
      )
      keptReason = 'records_unreadable'
    }
    if (
      keptReason === undefined &&
      !canReapDespiteLock(porcelain?.lockReason) &&
      !(lockPid !== null && jobPids.has(lockPid))
    ) {
      logForDebugging(
        `deleteJob: ${wt} is locked by a live Claude Code process, or with a reason we did not write (${porcelain?.lockReason}) — not ours to remove`,
        { level: 'warn' },
      )
      keptReason = 'live_lock'
    }
    if (
      keptReason === undefined &&
      liveSessionsUnread &&
      (await worktreePathPresence(wt)) !== 'gone'
    ) {
      logForDebugging(
        `deleteJob: could not list live sessions for ${wt} — cannot rule out an occupant, keeping`,
        { level: 'warn' },
      )
      keptReason = 'records_unreadable'
    }
    if (keptReason === undefined) {
      const occupant = await liveSessionOccupyingWorktree(
        live,
        short,
        jobPids,
        resolved,
        wt,
      )
      if (
        occupant !== undefined &&
        (await worktreePathPresence(wt)) !== 'gone'
      ) {
        keptReason = 'occupied'
        keptErrorSummary = occupiedSessionSummary(occupant)
        logForDebugging(
          `deleteJob: ${wt} is the working directory of a live session (pid ${occupant.pid}, ${occupant.kind}) — not ours to remove`,
          { level: 'warn' },
        )
      }
    }
    if (keptReason === undefined && dirty && !gitError && !opts.force) {
      logForDebugging(
        `deleteJob: worktree has uncommitted changes, kept ${wt}`,
        { level: 'warn' },
      )
      keptReason = 'dirty'
    }
    // densable 248 oG: !b1t(k, mGe(N), {primaryCheckoutVouches:true})
    if (
      keptReason === undefined &&
      !gitError &&
      gitRoot &&
      !opts.force &&
      !(await isJobWorktreeFullyUpstream(
        wt,
        await resolveOriginHeadRef(gitRoot),
        { primaryCheckoutVouches: true },
      ))
    ) {
      logForDebugging(
        `deleteJob: ${wt} has commits that are on no remote, kept`,
        { level: 'warn' },
      )
      keptReason = 'unpushed'
    }
    if (keptReason) {
      return {
        removed: false,
        keptWorktree: wt,
        keptReason,
        ...(keptErrorSummary !== undefined ? { keptErrorSummary } : {}),
      }
    }

    // densable Ma W7 — te=CMs, P=realpath, q=Sa(originCwd).
    try {
      const extra = state.originCwd
        ? (findGitRoot(state.originCwd) ?? undefined)
        : undefined
      const removed = await removeAgentWorktree(
        wt,
        state.worktreeBranch,
        gitRoot,
        state.worktreeHookBased,
        opts.force ? 'job_delete_force' : 'job_delete',
        resolved,
        extra,
        { storageV5: persist },
      )
      if (removed.outcome === 'failed') {
        if (removed.needsForce) {
          return {
            removed: false,
            keptWorktree: wt,
            keptReason: 'unverified',
          }
        }
        if (removed.errorSummary === WORKTREE_RESOLUTION_CHANGED) {
          return {
            removed: false,
            keptWorktree: wt,
            keptReason: 'identity_changed',
            keptErrorSummary: removed.errorSummary,
          }
        }
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
            keptErrorSummary:
              removed.errorSummary ?? 'git worktree remove failed',
          }
        }
      } else if (removed.outcome === 'left_in_place') {
        leftWorktreeDir = wt
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
