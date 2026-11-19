import { lstat, realpath } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import { getOriginalCwd } from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getCwd } from './cwd.js'
import { parseGitRemote } from './detectRepository.js'
import { getErrnoCode } from './errors.js'
import { execFileNoThrow, execFileNoThrowWithCwd } from './execFileNoThrow.js'
import {
  findGitRoot,
  getBranch,
  getDefaultBranch,
  getIsGit,
  getRemoteUrl,
} from './git.js'
import { lazySchema } from './lazySchema.js'
import { logForDebugging } from './debug.js'
import { isEssentialTrafficOnly } from './privacyLevel.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import { jsonParse } from './slowOperations.js'
import { whichSync } from './which.js'
import { codeChangeProviderFromHostname } from './worktree.js'

export type PrReviewState =
  | 'approved'
  | 'pending'
  | 'changes_requested'
  | 'draft'
  | 'merged'
  | 'closed'

export type PrStatus = {
  number: number
  url: string
  reviewState: PrReviewState
  /** densable `kind:"mr"` when sourced from glab. */
  kind?: 'pr' | 'mr'
}

const GH_TIMEOUT_MS = 5000
/** densable `nWb` */
const GLAB_TIMEOUT_MS = 2500

/**
 * densable `qer` / `wya` / `Aya` / `npp` — validate glab `web_url` shape.
 */
const GLAB_SLUG = String.raw`(?!\.{1,2}(?:/|$))[A-Za-z0-9_.][\w.-]*`
const GLAB_HOST = String.raw`[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*`
const GLAB_MR_PATH = `(?:${GLAB_SLUG}/)+${GLAB_SLUG}/-/merge_requests`
const GLAB_WEB_URL_RE = new RegExp(
  `^https?://${GLAB_HOST}(?::\\d{1,5})?/${GLAB_MR_PATH}/\\d+$`,
)

/** densable `opp` */
const GLAB_UNAUTH_RE = /^\s*\S+ has not been authenticated with glab\s*$/m

const glabMrViewSchema = lazySchema(() =>
  z.object({
    iid: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    state: z.string(),
    draft: z.boolean().optional(),
    detailed_merge_status: z.string().optional(),
    web_url: z.string(),
  }),
)

/**
 * densable `app` — per-session glab probe cache (path + unauth hosts + ok once).
 */
class GlabMrBadgeSession {
  glabOnPath: boolean | undefined
  unauthenticatedHosts = new Set<string>()
  okEmitted = false
  sandboxSeen = false
  projectRoot: string | undefined
  foldersWithGlabConfig = new Set<string>()
  refusalsEmitted = new Set<string>()

  isGlabOnPath(): boolean {
    if (this.glabOnPath === undefined) {
      this.glabOnPath = whichSync('glab') !== null
    }
    return this.glabOnPath
  }

  noteProjectRoot(root: string): void {
    this.projectRoot ??= root
  }

  noteSandbox(enabled: boolean): void {
    if (enabled) this.sandboxSeen = true
  }

  hasSeenSandbox(): boolean {
    return this.sandboxSeen
  }

  sessionCheckout(fallbackRoot: string): string | null {
    const base = this.projectRoot ?? fallbackRoot
    return findGitRoot(base) ?? null
  }

  noteGlabConfig(folder: string): void {
    this.foldersWithGlabConfig.add(folder)
  }

  hasSeenGlabConfig(folder: string): boolean {
    return this.foldersWithGlabConfig.has(folder)
  }

  emitRefusalOnce(code: string): void {
    if (this.refusalsEmitted.has(code)) return
    this.refusalsEmitted.add(code)
    logEvent('tengu_feature_bad', {
      feature_name:
        'gitlab_mr_badge' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  emitOkOnce(): void {
    if (this.okEmitted) return
    logEvent('tengu_feature_ok', {
      feature_name:
        'gitlab_mr_badge' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    this.okEmitted = true
  }
}

const glabSessions = new WeakMap<object, GlabMrBadgeSession>()
/** densable `oWb.of(e)` — session key; use a process singleton token. */
const GLAB_SESSION_KEY: object = {}

function getGlabSession(): GlabMrBadgeSession {
  let s = glabSessions.get(GLAB_SESSION_KEY)
  if (!s) {
    s = new GlabMrBadgeSession()
    glabSessions.set(GLAB_SESSION_KEY, s)
  }
  return s
}

/** densable `ypp` / local GitHub derive. */
export function deriveReviewState(
  isDraft: boolean,
  reviewDecision: string,
): PrReviewState {
  if (isDraft) return 'draft'
  switch (reviewDecision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    default:
      return 'pending'
  }
}

/** densable `lWb` — GitLab MR state → badge reviewState (null = hide). */
export function deriveGitlabMrReviewState(
  state: string,
  draft: boolean,
  detailedMergeStatus: string | undefined,
): PrReviewState | null {
  if (state !== 'opened') return null
  if (draft) return 'draft'
  return detailedMergeStatus === 'mergeable' ? 'approved' : 'pending'
}

/** densable `aWb` */
export function isValidGitlabMrWebUrl(url: string, iid: number): boolean {
  if (url.length > 2048 || !GLAB_WEB_URL_RE.test(url)) return false
  return Number(url.slice(url.lastIndexOf('/') + 1)) === iid
}

function glabFeatureBad(errorCode: string): 'fetch-failed' {
  logEvent('tengu_feature_bad', {
    feature_name:
      'gitlab_mr_badge' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  logForDebugging(`glab MR badge poll failed: ${errorCode}`, { level: 'warn' })
  return 'fetch-failed'
}

/** densable `iWb` — remote host for cwd repo. */
async function probeRemoteHost(): Promise<string | null> {
  try {
    const remote = await getRemoteUrl()
    if (!remote) return null
    const parsed = parseGitRemote(remote)
    return parsed?.host ?? null
  } catch (err) {
    logForDebugging(`glab MR badge repo probe failed: ${String(err)}`, {
      level: 'warn',
    })
    return null
  }
}

function tryJsonParse(raw: string): unknown {
  try {
    return jsonParse(raw)
  } catch {
    return undefined
  }
}

function isGlabErrorObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'object' &&
    (value as { error: unknown }).error !== null
  )
}

async function hasLocalGlabConfig(
  repoRoot: string,
): Promise<'found' | 'none' | 'unreadable'> {
  const glabDir = join(repoRoot, '.git', 'glab-cli')
  try {
    const dirStat = await lstat(glabDir)
    if (dirStat.isSymbolicLink()) return 'found'
    await lstat(join(glabDir, 'config.yml'))
    return 'found'
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'none'
    return 'unreadable'
  }
}

/**
 * Official 2.1.323 `T0` (#2181): when sandboxing is enabled, ensure the GitLab
 * MR badge only runs for the repository checkout the sandboxed session opened
 * in (refusing any other repo or local `.git/glab-cli` config).
 */
export async function resolveSandboxedGlabCwd(opts?: {
  session?: GlabMrBadgeSession
  sandboxEnabled?: boolean
  originalCwd?: string
  currentCwd?: string
  resolveGitRoot?: (dir: string) => string | null
  resolveRealpath?: (dir: string) => Promise<string>
  checkLocalGlabConfig?: (
    repoRoot: string,
  ) => Promise<'found' | 'none' | 'unreadable'>
}): Promise<string | null> {
  const session = opts?.session ?? getGlabSession()
  const originalCwd = opts?.originalCwd ?? getOriginalCwd()
  const currentCwd = opts?.currentCwd ?? getCwd()
  const resolveGitRoot =
    opts?.resolveGitRoot ?? (dir => findGitRoot(dir) ?? null)
  const resolveRealpath = opts?.resolveRealpath ?? (dir => realpath(dir))
  const checkLocalGlabConfig = opts?.checkLocalGlabConfig ?? hasLocalGlabConfig

  try {
    session.noteProjectRoot(originalCwd)
    const isSandboxed =
      opts?.sandboxEnabled !== undefined
        ? opts.sandboxEnabled
        : SandboxManager.isSandboxingEnabled()
    session.noteSandbox(isSandboxed)
  } catch (err) {
    session.noteSandbox(true)
    logForDebugging(
      `GitLab merge request badge: could not read the sandbox setting or the session's checkout, so the sandbox is treated as on: ${String(err)}`,
      { level: 'warn' },
    )
  }

  try {
    let targetRoot = resolveGitRoot(currentCwd)
    if (targetRoot === null) return null

    if (session.hasSeenSandbox()) {
      const sessionRoot = opts?.resolveGitRoot
        ? resolveGitRoot(session.projectRoot ?? originalCwd)
        : session.sessionCheckout(originalCwd)
      if (
        sessionRoot === null ||
        (await resolveRealpath(sessionRoot)) !==
          (await resolveRealpath(targetRoot))
      ) {
        session.emitRefusalOnce('outside_session_checkout')
        return null
      }
      targetRoot = sessionRoot
    }

    if (session.hasSeenGlabConfig(targetRoot)) return null
    if (session.hasSeenSandbox()) {
      const configStatus = await checkLocalGlabConfig(targetRoot)
      if (configStatus === 'found') {
        session.noteGlabConfig(targetRoot)
        session.emitRefusalOnce('glab_local_config')
        return null
      }
      if (configStatus === 'unreadable') {
        session.emitRefusalOnce('glab_config_unreadable')
        return null
      }
    }
    return targetRoot
  } catch (err) {
    logForDebugging(
      `GitLab merge request badge: could not check which folder to run glab in, so glab was not run: ${String(err)}`,
      { level: 'warn' },
    )
    return null
  }
}

/**
 * densable `lpp` — `glab mr view -F json` for non-github remotes.
 * Returns PrStatus | null | densable also returns "fetch-failed" string for
 * telemetry paths; we map those to null after logging.
 */
export async function fetchGitlabMrStatus(): Promise<PrStatus | null> {
  if (isEssentialTrafficOnly()) return null
  const session = getGlabSession()
  if (!session.isGlabOnPath()) return null
  const host = await probeRemoteHost()
  if (host === null) return null
  if (codeChangeProviderFromHostname(host) === 'github') return null
  if (session.unauthenticatedHosts.has(host)) return null

  const glabCwd = await resolveSandboxedGlabCwd({ session })
  if (glabCwd === null) return null

  const result = await execFileNoThrowWithCwd(
    'glab',
    ['mr', 'view', '-F', 'json'],
    {
      timeout: GLAB_TIMEOUT_MS,
      preserveOutputOnError: true,
      cwd: glabCwd,
      env: {
        ...process.env,
        GITLAB_TOKEN: undefined,
        GITLAB_ACCESS_TOKEN: undefined,
        OAUTH_TOKEN: undefined,
      },
    },
  )

  if (result.code !== 0) {
    if (
      GLAB_UNAUTH_RE.test(result.stdout) ||
      GLAB_UNAUTH_RE.test(result.stderr)
    ) {
      session.unauthenticatedHosts.add(host)
      return null
    }
    const parsedFail = tryJsonParse(result.stdout)
    if (parsedFail === undefined) {
      glabFeatureBad('glab_unresponsive')
      return null
    }
    if (isGlabErrorObject(parsedFail)) return null
    glabFeatureBad('glab_unresponsive')
    return null
  }

  const parsed = tryJsonParse(result.stdout)
  if (parsed === undefined) {
    glabFeatureBad('parse_failed')
    return null
  }
  if (isGlabErrorObject(parsed)) return null
  const safe = glabMrViewSchema().safeParse(parsed)
  if (!safe.success) {
    glabFeatureBad('parse_failed')
    return null
  }
  const data = safe.data
  if (!isValidGitlabMrWebUrl(data.web_url, data.iid)) {
    logEvent('tengu_feature_bad', {
      feature_name:
        'gitlab_mr_badge' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'web_url_rejected' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return null
  }
  const reviewState = deriveGitlabMrReviewState(
    data.state,
    data.draft === true,
    data.detailed_merge_status,
  )
  if (reviewState === null) return null
  session.emitOkOnce()
  return {
    number: data.iid,
    url: data.web_url,
    reviewState,
    kind: 'mr',
  }
}

/** densable `sJt` / `pWb` — `gh pr view` for current branch. No 304. */
export async function fetchGithubPrStatus(
  defaultBranch: string,
): Promise<PrStatus | null> {
  const { stdout, code } = await execFileNoThrow(
    'gh',
    [
      'pr',
      'view',
      '--json',
      'number,url,reviewDecision,isDraft,headRefName,state',
    ],
    { timeout: GH_TIMEOUT_MS, preserveOutputOnError: false },
  )

  if (code !== 0 || !stdout.trim()) return null

  try {
    const data = jsonParse(stdout) as {
      number: number
      url: string
      reviewDecision: string
      isDraft: boolean
      headRefName: string
      state: string
    }

    if (
      data.headRefName === defaultBranch ||
      data.headRefName === 'main' ||
      data.headRefName === 'master'
    ) {
      return null
    }

    if (data.state === 'MERGED' || data.state === 'CLOSED') {
      return null
    }

    // densable `pWb` — no `kind` field (GitHub PR default)
    return {
      number: data.number,
      url: data.url,
      reviewState: deriveReviewState(data.isDraft, data.reviewDecision),
    }
  } catch {
    return null
  }
}

/**
 * densable `_pp` — GitHub `gh` first, then glab MR fallback.
 * Returns null on any failure / default branch / no open change.
 */
export async function fetchPrStatus(): Promise<PrStatus | null> {
  const isGit = await getIsGit()
  if (!isGit) return null

  const [branch, defaultBranch] = await Promise.all([
    getBranch(),
    getDefaultBranch(),
  ])
  if (branch === defaultBranch) return null

  // densable eDt `Wen()?uJt:sJt` lives in prStatusPoller (footer hook).
  // This leftover `_pp` is sJt + tXe only — no 304.
  return (
    (await fetchGithubPrStatus(defaultBranch)) ?? (await fetchGitlabMrStatus())
  )
}
