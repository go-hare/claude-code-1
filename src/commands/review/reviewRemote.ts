/**
 * Teleported /ultrareview execution. Creates a CCR session with the current repo,
 * sends the review prompt as the initial message, and registers a
 * RemoteAgentTask so the polling loop pipes results back into the local
 * session via task-notification. Mirrors the /ultraplan → CCR flow.
 *
 * densable 2.1.212 #15–18:
 * - PR arg normalize (yqr + #/PR N)
 * - origin branch fetch (YI_) + typo suggest (XI_/nst)
 * - overage confirm in AppState (survives only until /clear)
 * - Desktop not-git hint (Ibp/WW/Ghl)
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import { homedir } from 'os'
import { resolve as resolvePath } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { fetchUltrareviewQuota } from '../../services/api/ultrareviewQuota.js'
import { fetchUtilization } from '../../services/api/usage.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  checkRemoteAgentEligibility,
  formatPreconditionError,
  getRemoteTaskSessionUrl,
  registerRemoteAgentTask,
  type BackgroundRemoteSessionPrecondition,
} from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import { isEnterpriseSubscriber, isTeamSubscriber } from '../../utils/auth.js'
import { getCwd } from '../../utils/cwd.js'
import { detectCurrentRepositoryWithHost } from '../../utils/detectRepository.js'
import {
  execFileNoThrow,
  execFileNoThrowWithCwd,
} from '../../utils/execFileNoThrow.js'
import {
  findGitRoot,
  getBranch,
  getDefaultBranch,
  getIsGit,
  gitExe,
} from '../../utils/git.js'
import { getPlatform } from '../../utils/platform.js'
import { teleportToRemote } from '../../utils/teleport.js'

/** densable H1g — default CCR bundle cap (100 MiB) */
const DEFAULT_CCR_BUNDLE_MAX_BYTES = 100 * 1024 * 1024

/** Cast safe enum/tag strings into analytics metadata (densable `ke`/`be`). */
function meta(
  s: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return s as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * densable hde — cwd is the user's home directory (Windows case-insensitive).
 */
export function isCwdHome(
  cwd: string = getCwd(),
  home: string = homedir(),
): boolean {
  try {
    if (!home) return false
    const t = resolvePath(cwd)
    const r = resolvePath(home)
    return getPlatform() === 'windows'
      ? t.toLowerCase() === r.toLowerCase()
      : t === r
  } catch {
    return false
  }
}

/** densable base_ref_not_found diagnostic flags on the raw arg */
export function baseRefArgDiagnostics(arg: string): {
  looks_like_url: boolean
  looks_like_sha: boolean
  starts_with_hash: boolean
  has_slash: boolean
  has_whitespace: boolean
} {
  return {
    looks_like_url: /^https?:/i.test(arg),
    looks_like_sha: /^[0-9a-f]{7,40}$/i.test(arg),
    starts_with_hash: arg.startsWith('#'),
    has_slash: arg.includes('/'),
    has_whitespace: /\s/.test(arg),
  }
}

// densable Ghl — Desktop-like entrypoints that should not suggest terminal git init
const DESKTOP_LIKE_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
])

/** densable WW() */
export function isDesktopLikeEntrypoint(
  entrypoint: string | undefined = process.env.CLAUDE_CODE_ENTRYPOINT,
): boolean {
  return entrypoint !== undefined && DESKTOP_LIKE_ENTRYPOINTS.has(entrypoint)
}

/** densable Ibp() */
export function notGitRepoHint(
  entrypoint: string | undefined = process.env.CLAUDE_CODE_ENTRYPOINT,
): string {
  return isDesktopLikeEntrypoint(entrypoint)
    ? "Open your project's repository folder and try again."
    : 'Run "git init" here to create a repository, or cd into an existing one.'
}

/** densable yqr / pMg */
const GITHUB_PR_URL_RE =
  /^https:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/

export type ParsedGithubPullUrl = {
  url: string
  host: string
  owner: string
  repo: string
  num: number
}

export function parseGithubPullUrl(input: string): ParsedGithubPullUrl | null {
  const m = input.match(GITHUB_PR_URL_RE)
  if (!m) return null
  return {
    url: input,
    host: m[1]!,
    owner: m[2]!,
    repo: m[3]!,
    num: Number(m[4]),
  }
}

/**
 * densable YOo PR arg normalize:
 * yqr(url)?.num | /^(?:#|PR[\s#]*)(\d+)$/i | raw
 */
export function normalizeUltrareviewPrArg(raw: string): {
  trimmed: string
  prNumber: string | null
  parsedUrl: ParsedGithubPullUrl | null
  normalizedFrom: 'url' | 'prefix' | 'digits' | null
} {
  const trimmed = raw.trim()
  const parsedUrl = parseGithubPullUrl(trimmed)
  const fromPrefix = trimmed.match(/^(?:#|PR[\s#]*)(\d+)$/i)?.[1]
  const candidate = parsedUrl?.num.toString() ?? fromPrefix ?? trimmed
  if (/^\d+$/.test(candidate)) {
    const normalizedFrom =
      parsedUrl !== null
        ? 'url'
        : fromPrefix !== undefined
          ? 'prefix'
          : candidate === trimmed
            ? 'digits'
            : 'prefix'
    return {
      trimmed,
      prNumber: candidate,
      parsedUrl,
      normalizedFrom,
    }
  }
  return { trimmed, prNumber: null, parsedUrl: null, normalizedFrom: null }
}

/**
 * densable qqi — ultrareview diff size caps from tengu_review_bughunter_config.
 * Defaults: max_diff_files=500, max_diff_lines=8000.
 */
export function getUltrareviewDiffLimits(
  config: Record<
    string,
    unknown
  > | null = getFeatureValue_CACHED_MAY_BE_STALE<Record<
    string,
    unknown
  > | null>('tengu_review_bughunter_config', null),
): { maxFiles: number; maxLines: number } {
  const pos = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0
      ? Math.floor(v)
      : fallback
  return {
    maxFiles: pos(config?.max_diff_files, 500),
    maxLines: pos(config?.max_diff_lines, 8000),
  }
}

/**
 * densable Dro — parse `git diff --shortstat` English LC_ALL=C output.
 * e.g. " 3 files changed, 10 insertions(+), 2 deletions(-)"
 */
export function parseGitShortstat(stat: string): {
  filesCount: number
  linesAdded: number
  linesRemoved: number
} | null {
  const t = stat.match(
    /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
  )
  if (!t) return null
  return {
    filesCount: parseInt(t[1] ?? '0', 10),
    linesAdded: parseInt(t[2] ?? '0', 10),
    linesRemoved: parseInt(t[3] ?? '0', 10),
  }
}

/**
 * densable XCu — bundle max bytes from GrowthBook or H1g=104857600.
 */
export function getCcrBundleMaxBytes(): number {
  const v = getFeatureValue_CACHED_MAY_BE_STALE<number | null>(
    'tengu_ccr_bundle_max_bytes',
    null,
  )
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : DEFAULT_CCR_BUNDLE_MAX_BYTES
}

/**
 * densable JCu — `git count-objects -v` → size-pack (KiB→bytes) + in-pack.
 */
export async function countGitPackObjects(
  cwd: string,
  signal?: AbortSignal,
): Promise<{ sizeBytes: number | null; inPackCount: number | null }> {
  const r = await execFileNoThrowWithCwd(gitExe(), ['count-objects', '-v'], {
    cwd,
    preserveOutputOnError: false,
    ...(signal ? { abortSignal: signal } : {}),
  })
  if (r.code !== 0) return { sizeBytes: null, inPackCount: null }
  return parseCountObjectsStdout(r.stdout)
}

function parseCountObjectsStdout(stdout: string): {
  sizeBytes: number | null
  inPackCount: number | null
} {
  const n = stdout.match(/^size-pack:\s*(\d+)/m)
  const o = stdout.match(/^in-pack:\s*(\d+)/m)
  return {
    sizeBytes: n ? Number(n[1]) * 1024 : null,
    inPackCount: o ? Number(o[1]) : null,
  }
}

/**
 * densable QCu — early refuse if pack is far beyond bundle cap.
 * tooLarge = size > 3*max && (size > 100*max || inPack > 5_000_000)
 */
export async function probeRepoTooLargeToBundle(options?: {
  cwd?: string
  signal?: AbortSignal
}): Promise<{
  tooLarge: boolean
  sizeBytes: number | null
  inPackCount: number | null
}> {
  const root = findGitRoot(options?.cwd ?? getCwd())
  if (!root) {
    return { tooLarge: false, sizeBytes: null, inPackCount: null }
  }
  const { sizeBytes, inPackCount } = await countGitPackObjects(
    root,
    options?.signal,
  )
  if (sizeBytes === null) {
    return { tooLarge: false, sizeBytes: null, inPackCount }
  }
  const max = getCcrBundleMaxBytes()
  const tooLarge =
    sizeBytes > 3 * max &&
    (sizeBytes > 100 * max || (inPackCount !== null && inPackCount > 5_000_000))
  return { tooLarge, sizeBytes, inPackCount }
}

/** densable formula export for tests */
export function isRepoPackTooLarge(
  sizeBytes: number,
  inPackCount: number | null,
  maxBytes: number = DEFAULT_CCR_BUNDLE_MAX_BYTES,
): boolean {
  return (
    sizeBytes > 3 * maxBytes &&
    (sizeBytes > 100 * maxBytes ||
      (inPackCount !== null && inPackCount > 5_000_000))
  )
}

/**
 * densable kPr — normalize a host for comparison (lowercase, strip
 * control whitespace; if it parses as bare hostname URL, use hostname).
 */
export function normalizeReviewHost(host: string): string {
  const t = host
    .replace(/[\t\n\r]/g, '')
    .toLowerCase()
    .trim()
  if (t === '') return t
  try {
    const r = new URL(`https://${t}`)
    if (
      r.username !== '' ||
      r.password !== '' ||
      r.port !== '' ||
      r.pathname !== '/' ||
      r.search !== '' ||
      r.hash !== ''
    ) {
      return t
    }
    return r.hostname.toLowerCase()
  } catch {
    return t
  }
}

/** densable KJe — hosts equal after kPr */
export function reviewHostsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  const ra = normalizeReviewHost(a)
  return ra !== '' && ra === normalizeReviewHost(b)
}

/**
 * densable fm — github.com after kPr + strip leading www.
 * Enterprise hosts (ghe.example.com) are NOT github.com.
 */
export function isGithubComHost(host: string): boolean {
  let t = normalizeReviewHost(host)
  while (t.startsWith('www.')) t = t.slice(4)
  return t === 'github.com'
}

/**
 * densable monorepo_blocked — anthropics/anthropic on github.com (fm only).
 * 1:1 with densable; product may never hit this remote.
 */
export function isAnthropicMonorepoBlocked(repo: {
  host: string
  owner: string
  name: string
}): boolean {
  return (
    isGithubComHost(repo.host) &&
    repo.owner.toLowerCase() === 'anthropics' &&
    repo.name.toLowerCase() === 'anthropic'
  )
}

/** densable nst — Damerau-Levenshtein */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0
  const r = a.length
  const n = b.length
  const o: number[][] = Array.from({ length: r + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, s) => (i === 0 ? s : s === 0 ? i : 0)),
  )
  for (let i = 1; i <= r; i++) {
    for (let s = 1; s <= n; s++) {
      const cost = a[i - 1] === b[s - 1] ? 0 : 1
      o[i]![s] = Math.min(
        o[i - 1]![s]! + 1,
        o[i]![s - 1]! + 1,
        o[i - 1]![s - 1]! + cost,
      )
      if (i > 1 && s > 1 && a[i - 1] === b[s - 2] && a[i - 2] === b[s - 1]) {
        o[i]![s] = Math.min(o[i]![s]!, o[i - 2]![s - 2]! + 1)
      }
    }
  }
  return o[r]![n]!
}

function nonInteractiveGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND || 'ssh'} -o BatchMode=yes -o StrictHostKeyChecking=yes`,
    GIT_ALLOW_PROTOCOL: 'https:http:ssh',
  }
}

/**
 * densable YI_ — probe origin for branch and fetch into refs/remotes/origin/<name>
 */
export async function tryFetchOriginBranch(
  branch: string,
): Promise<'recovered' | 'fetch_failed' | 'not_found' | 'probe_failed'> {
  if (branch.startsWith('-') || branch.includes(':') || /\s/.test(branch)) {
    return 'not_found'
  }
  const env = nonInteractiveGitEnv()
  const probe = await execFileNoThrow(
    gitExe(),
    [
      '-c',
      'credential.helper=',
      '-c',
      'core.askPass=',
      'ls-remote',
      '--heads',
      '--exit-code',
      '--end-of-options',
      'origin',
      branch,
    ],
    { timeout: 4000, preserveOutputOnError: false, env },
  )
  if (probe.code !== 0) {
    return probe.code === 2 ? 'not_found' : 'probe_failed'
  }
  const hasRef = probe.stdout
    .split('\n')
    .some(line => line.split('\t')[1]?.trim() === `refs/heads/${branch}`)
  if (!hasRef) return 'not_found'
  const fetch = await execFileNoThrow(
    gitExe(),
    [
      '-c',
      'credential.helper=',
      '-c',
      'core.askPass=',
      'fetch',
      '--no-tags',
      '--end-of-options',
      'origin',
      `refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ],
    { timeout: 15000, preserveOutputOnError: false, env },
  )
  return fetch.code === 0 ? 'recovered' : 'fetch_failed'
}

/**
 * densable XI_ — main↔master swap, else closest branch by Damerau distance < 3
 */
export async function suggestClosestBranch(
  input: string,
): Promise<string | null> {
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    [
      'for-each-ref',
      '--format=%(refname:short)',
      '--count=2000',
      'refs/heads',
      'refs/remotes/origin',
    ],
    { preserveOutputOnError: false },
  )
  if (code !== 0) return null
  const map = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const l = line.trim()
    if (!l || l === 'origin' || l === 'origin/HEAD') continue
    const short = l.startsWith('origin/') ? l.slice(7) : l
    if (l.startsWith('origin/') || !map.has(short)) {
      map.set(short, l)
    }
  }
  const swap = input === 'main' ? 'master' : input === 'master' ? 'main' : null
  if (swap !== null) {
    const hit = map.get(swap)
    if (hit) return hit
  }
  let best: string | null = null
  let bestDist = 3
  for (const [short, full] of map) {
    if (Math.abs(short.length - input.length) >= bestDist) continue
    const d = damerauLevenshtein(input, short)
    if (d > 0 && d < bestDist) {
      bestDist = d
      best = full
    }
  }
  return best
}

async function revParseExists(ref: string): Promise<boolean> {
  const { code } = await execFileNoThrow(
    gitExe(),
    ['rev-parse', '--verify', '--quiet', ref],
    { preserveOutputOnError: false },
  )
  return code === 0
}

export type OverageGate =
  | { kind: 'proceed'; billingNote: string }
  | { kind: 'not-enabled' }
  | { kind: 'low-balance'; available: number }
  | { kind: 'needs-confirm'; body?: string; billingNote?: string }
  | {
      kind: 'blocked'
      message: string
      actionUrl?: string | null
      reason?: string
    }

/**
 * densable isUltrareviewOverageConfirmed — read AppState flag.
 */
export function isUltrareviewOverageConfirmed(
  context: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  return context.getAppState().ultrareviewOverageConfirmed === true
}

/**
 * densable M6e / markUltrareviewOverageConfirmed
 */
export function markUltrareviewOverageConfirmed(
  context: Pick<ToolUseContext, 'setAppState'>,
): void {
  context.setAppState(prev =>
    prev.ultrareviewOverageConfirmed
      ? prev
      : { ...prev, ultrareviewOverageConfirmed: true },
  )
}

/** @deprecated use markUltrareviewOverageConfirmed(context) */
export function confirmOverage(
  context?: Pick<ToolUseContext, 'setAppState'>,
): void {
  if (context) {
    markUltrareviewOverageConfirmed(context)
  }
}

/**
 * Determine whether the user can launch an ultrareview and under what
 * billing terms. Fetches quota and utilization in parallel.
 *
 * densable XOo({overageConfirmed}) — pass AppState flag so /clear re-prompts.
 */
export async function checkOverageGate(options?: {
  overageConfirmed?: boolean
}): Promise<OverageGate> {
  const sessionOverageConfirmed = options?.overageConfirmed === true

  // Official zlp densable — CLAUDE_CODE_ULTRAREVIEW_PREFLIGHT_FIXTURE short-circuits
  // the network preflight (zko).
  try {
    const {
      parseUltrareviewPreflightFixtureTyped,
      resolveOverageGateFromPreflightFixture,
    } = await import('../../utils/residualFinalEnvGates.js')
    const fromFixture = resolveOverageGateFromPreflightFixture({
      fixture: parseUltrareviewPreflightFixtureTyped(),
      sessionOverageConfirmed,
    })
    if (fromFixture) return fromFixture
  } catch {
    // Fixture parse optional — fall through to live preflight / quota path.
  }

  // Official zko densable — live /v1/ultrareview/preflight when available.
  // Falls through to quota/utilization when endpoint missing or errors.
  try {
    const { fetchUltrareviewPreflight } = await import(
      '../../services/api/ultrareviewQuota.js'
    )
    const { resolveOverageGateFromPreflightFixture } = await import(
      '../../utils/residualFinalEnvGates.js'
    )
    const live = await fetchUltrareviewPreflight()
    if (live) {
      const fromLive = resolveOverageGateFromPreflightFixture({
        fixture: live,
        sessionOverageConfirmed,
      })
      if (fromLive) return fromLive
    }
  } catch {
    // Network preflight optional.
  }

  // Team and Enterprise plans include ultrareview — no free-review quota
  // or Extra Usage dialog. The quota endpoint is scoped to consumer plans
  // (pro/max); hitting it on team/ent would surface a confusing dialog.
  if (isTeamSubscriber() || isEnterpriseSubscriber()) {
    return { kind: 'proceed', billingNote: '' }
  }

  const [quota, utilization] = await Promise.all([
    fetchUltrareviewQuota(),
    fetchUtilization().catch(() => null),
  ])

  // No quota info (non-subscriber or endpoint down) — let it through,
  // server-side billing will handle it.
  if (!quota) {
    return { kind: 'proceed', billingNote: '' }
  }

  if (quota.reviews_remaining > 0) {
    return {
      kind: 'proceed',
      billingNote: ` This is free ultrareview ${quota.reviews_used + 1} of ${quota.reviews_limit}.`,
    }
  }

  // Utilization fetch failed (transient network error, timeout, etc.) —
  // let it through, same rationale as the quota fallback above.
  if (!utilization) {
    return { kind: 'proceed', billingNote: '' }
  }

  // Free reviews exhausted — check Extra Usage setup.
  const extraUsage = utilization.extra_usage
  if (!extraUsage?.is_enabled) {
    logEvent('tengu_review_overage_not_enabled', {})
    return { kind: 'not-enabled' }
  }

  // Check available balance (null monthly_limit = unlimited).
  const monthlyLimit = extraUsage.monthly_limit
  const usedCredits = extraUsage.used_credits ?? 0
  const available =
    monthlyLimit === null || monthlyLimit === undefined
      ? Infinity
      : monthlyLimit - usedCredits

  if (available < 10) {
    logEvent('tengu_review_overage_low_balance', { available })
    return { kind: 'low-balance', available }
  }

  if (!sessionOverageConfirmed) {
    logEvent('tengu_review_overage_dialog_shown', {})
    return { kind: 'needs-confirm' }
  }

  return {
    kind: 'proceed',
    billingNote: ' This review bills as Extra Usage.',
  }
}

const DEFAULT_INVOCATION = '/ultrareview'

/**
 * Launch a teleported review session. Returns ContentBlockParam[] describing
 * the launch outcome for injection into the local conversation (model is then
 * queried with this content, so it can narrate the launch to the user).
 *
 * Returns ContentBlockParam[] with user-facing error messages on recoverable
 * failures (missing merge-base, empty diff, bundle too large), or null on
 * other failures so the caller falls through to the local-review prompt.
 * Reason is captured in analytics.
 *
 * Caller must run checkOverageGate() BEFORE calling this function
 * (ultrareviewCommand.tsx handles the dialog).
 */
export async function launchRemoteReview(
  args: string,
  context: ToolUseContext,
  billingNote?: string,
  options?: { invocation?: string },
): Promise<ContentBlockParam[] | null> {
  const invocation = options?.invocation ?? DEFAULT_INVOCATION
  const eligibility = await checkRemoteAgentEligibility()
  // Synthetic DEFAULT_CODE_REVIEW_ENVIRONMENT_ID works without per-org CCR
  // setup, so no_remote_environment isn't a blocker. Server-side quota
  // consume at session creation routes billing: first N zero-rate, then
  // anthropic:cccr org-service-key (overage-only).
  if (!eligibility.eligible) {
    const blockers = (
      eligibility as { eligible: false; errors: Array<{ type: string }> }
    ).errors.filter(e => e.type !== 'no_remote_environment')
    if (blockers.length > 0) {
      // densable JOo: reason=remote_agent_ineligible + precondition_errors + cwd_is_home
      logEvent('tengu_review_remote_precondition_failed', {
        reason: meta('remote_agent_ineligible'),
        precondition_errors: meta(blockers.map(e => e.type).join(',')),
        cwd_is_home: isCwdHome(),
      })
      const reasons = (blockers as BackgroundRemoteSessionPrecondition[])
        .map(e => {
          if (e.type === 'not_in_git_repo') {
            return `${invocation} needs a git repository so it can clone your code into a cloud sandbox, but ${getCwd()} is not inside one. ${notGitRepoHint()}`
          }
          // densable JOo no_git_remote ultrareview-specific copy
          if (e.type === 'no_git_remote') {
            return `${invocation} needs a GitHub remote so it can clone this repository into the cloud. If this project is not on GitHub yet, run "gh repo create --source=. --push" to create one; if a GitHub repo already exists, run "git remote add origin REPO_URL && git push -u origin HEAD".`
          }
          return formatPreconditionError(e)
        })
        .join('\n')
      return [
        {
          type: 'text',
          text: `Ultrareview cannot launch:\n${reasons}`,
        },
      ]
    }
  }

  // densable YOo: early not_git_repo with Desktop Ibp
  if (!(await getIsGit())) {
    logEvent('tengu_review_remote_precondition_failed', {
      reason: meta('not_git_repo'),
      cwd_is_home: isCwdHome(),
    })
    return [
      {
        type: 'text',
        text: `${invocation} needs a git repository so it can clone your code into a cloud sandbox, but ${getCwd()} is not inside one. ${notGitRepoHint()}`,
      },
    ]
  }

  const resolvedBillingNote = billingNote ?? ''

  // densable YOo PR normalize
  const { trimmed, prNumber, parsedUrl } = normalizeUltrareviewPrArg(args)
  const isPrNumber = prNumber !== null

  // Synthetic code_review env. Go taggedid.FromUUID(TagEnvironment,
  // UUID{...,0x02}) encodes with version prefix '01' — NOT Python's
  // legacy tagged_id() format. Verified in prod.
  const CODE_REVIEW_ENV_ID = 'env_011111111111111111111113'
  // Lite-review bypasses bughunter.go entirely, so it doesn't see the
  // webhook's bug_hunter_config (different GB project). These env vars are
  // the only tuning surface — without them, run_hunt.sh's bash defaults
  // apply (60min, 120s agent timeout), and 120s kills verifiers mid-run
  // which causes infinite respawn.
  //
  // total_wallclock must stay below RemoteAgentTask's 30min poll timeout
  // with headroom for finalization (~3min synthesis). Per-field guards
  // match autoDream.ts — GB cache can return stale wrong-type values.
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<Record<
    string,
    unknown
  > | null>('tengu_review_bughunter_config', null)
  const posInt = (v: unknown, fallback: number, max?: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
    const n = Math.floor(v)
    if (n <= 0) return fallback
    return max !== undefined && n > max ? fallback : n
  }
  // Upper bounds: 27min on wallclock leaves ~3min for finalization under
  // RemoteAgentTask's 30min poll timeout. If GB is set above that, the
  // hang we're fixing comes back — fall to the safe default instead.
  const bughunterModel =
    typeof raw?.model === 'string' && raw.model.length > 0
      ? raw.model
      : undefined
  const commonEnvVars = {
    BUGHUNTER_DRY_RUN: '1',
    BUGHUNTER_FLEET_SIZE: String(posInt(raw?.fleet_size, 5, 20)),
    BUGHUNTER_MAX_DURATION: String(posInt(raw?.max_duration_minutes, 10, 25)),
    BUGHUNTER_AGENT_TIMEOUT: String(
      posInt(raw?.agent_timeout_seconds, 600, 1800),
    ),
    BUGHUNTER_TOTAL_WALLCLOCK: String(
      posInt(raw?.total_wallclock_minutes, 22, 27),
    ),
    ...(bughunterModel ? { BUGHUNTER_MODEL: bughunterModel } : {}),
    ...(process.env.BUGHUNTER_DEV_BUNDLE_B64 && {
      BUGHUNTER_DEV_BUNDLE_B64: process.env.BUGHUNTER_DEV_BUNDLE_B64,
    }),
  }

  let session
  let command
  let target
  let scopeDiffStat = ''
  let launchMode: 'pr' | 'branch' = 'branch'
  let createFailMessage: string | undefined
  let createFailReason: string | undefined
  let createFailStatus: number | undefined
  let createFailServerType: string | undefined
  let createFailServerReason: string | undefined
  let bundleFailMessage: string | undefined
  let bundleFailKind: string | undefined
  if (isPrNumber && prNumber) {
    // densable YOo: recovery outcome helper for pr_arg_normalization
    const logPrArgRecovery = (outcome: 'succeeded' | 'failed') => {
      if (prNumber === trimmed) return
      logEvent('tengu_review_remote_precondition_recovery', {
        reason: meta('base_ref_not_found'),
        method: meta('pr_arg_normalization'),
        outcome: meta(outcome),
      })
    }

    // densable YOo PR path: k$() remote → wrong_repo (yqr) → no_github_remote → monorepo → size
    // densable does NOT hard-require host === 'github.com' (GHE may proceed with gh --repo).
    const repo = await detectCurrentRepositoryWithHost()
    if (parsedUrl) {
      // densable: E = KJe(o.host,S.host) || (o&&S&&fm(o)&&fm(S)); fail if o && (!E||owner/repo)
      const hostOk =
        reviewHostsEqual(parsedUrl.host, repo?.host) ||
        (!!repo &&
          isGithubComHost(parsedUrl.host) &&
          isGithubComHost(repo.host))
      if (
        !repo ||
        !hostOk ||
        parsedUrl.owner.toLowerCase() !== repo.owner.toLowerCase() ||
        parsedUrl.repo.toLowerCase() !== repo.name.toLowerCase()
      ) {
        logEvent('tengu_review_remote_precondition_failed', {
          reason: meta('pr_url_wrong_repo'),
          has_remote: !!repo,
          cwd_is_home: isCwdHome(),
        })
        logPrArgRecovery('failed')
        const link = `${parsedUrl.owner}/${parsedUrl.repo} on ${parsedUrl.host}`
        const here = repo
          ? `you're in ${repo.owner}/${repo.name} on ${repo.host}`
          : 'this directory has no GitHub remote'
        return [
          {
            type: 'text',
            text: `That link is for ${link}, but ${here}. cd into a checkout of that repo and run ${invocation} ${parsedUrl.num} from there.`,
          },
        ]
      }
    }
    if (!repo) {
      logEvent('tengu_review_remote_precondition_failed', {
        reason: meta('no_github_remote'),
        cwd_is_home: isCwdHome(),
      })
      logPrArgRecovery('failed')
      return [
        {
          type: 'text',
          text: `${invocation} <PR#> needs a GitHub remote so it knows which repository the PR is in. If this project is not on GitHub yet, run "gh repo create --source=. --push" to create one; if a GitHub repo already exists, run "git remote add origin REPO_URL". Or run ${invocation} with no argument to review your current branch instead.`,
        },
      ]
    }

    // densable monorepo_blocked (fm(host) + anthropics/anthropic)
    if (isAnthropicMonorepoBlocked(repo)) {
      logEvent('tengu_review_remote_precondition_failed', {
        reason: meta('monorepo_blocked'),
        cwd_is_home: isCwdHome(),
      })
      logPrArgRecovery('failed')
      return [
        {
          type: 'text',
          text: `${invocation} doesn't support the Anthropic monorepo — monorepo PRs are reviewed automatically by bughunter. Re-trigger it from the PR checks page, or run /bughunter here for a local hunt.`,
        },
      ]
    }

    // densable: gh pr view --json additions,deletions,changedFiles → pr_diff_too_large
    const { maxFiles, maxLines } = getUltrareviewDiffLimits(raw)
    const prView = await execFileNoThrow(
      'gh',
      [
        'pr',
        'view',
        prNumber,
        '--repo',
        `${repo.host}/${repo.owner}/${repo.name}`,
        '--json',
        'additions,deletions,changedFiles',
      ],
      { timeout: 5000, preserveOutputOnError: false },
    )
    if (prView.code === 0 && prView.stdout.trim()) {
      try {
        const info = JSON.parse(prView.stdout) as {
          additions?: number
          deletions?: number
          changedFiles?: number
        }
        const lines = (info.additions ?? 0) + (info.deletions ?? 0)
        const files = info.changedFiles ?? 0
        if (files > maxFiles || lines > maxLines) {
          logEvent('tengu_review_remote_precondition_failed', {
            reason: meta('pr_diff_too_large'),
            files,
            lines,
            max_files: maxFiles,
            max_lines: maxLines,
            cwd_is_home: isCwdHome(),
          })
          logPrArgRecovery('failed')
          return [
            {
              type: 'text',
              text: `PR #${prNumber} is too large for ultrareview (${files} files, ${lines.toLocaleString()} lines). Split it into smaller PRs, or run \`${invocation}\` on a narrower local diff.`,
            },
          ]
        }
      } catch {
        // densable: catch {} — ignore parse/gh shape failures
      }
    }

    logPrArgRecovery('succeeded')
    launchMode = 'pr'
    session = await teleportToRemote({
      initialMessage: null,
      description: `ultrareview: ${repo.owner}/${repo.name}#${prNumber}`,
      signal: context.abortController.signal,
      branchName: `refs/pull/${prNumber}/head`,
      environmentId: CODE_REVIEW_ENV_ID,
      // densable JOo: source + tags:["ultrareview"]
      source: 'ultrareview',
      tags: ['ultrareview'],
      environmentVariables: {
        BUGHUNTER_PR_NUMBER: prNumber,
        BUGHUNTER_REPOSITORY: `${repo.owner}/${repo.name}`,
        ...commonEnvVars,
      },
      // densable JOo: onCreateFail (msg, reason, meta)
      onCreateFail: (message, reason, meta) => {
        createFailMessage = message
        createFailReason = reason
        createFailStatus = meta?.status
        createFailServerType = meta?.serverType
        createFailServerReason = meta?.serverReason
      },
    })
    command = `${invocation} ${prNumber}`
    target = `${repo.owner}/${repo.name}#${prNumber}`
  } else {
    // densable QCu — early refuse if pack far beyond CCR bundle cap
    const packProbe = await probeRepoTooLargeToBundle({
      signal: context.abortController.signal,
    })
    if (packProbe.tooLarge) {
      logEvent('tengu_review_remote_precondition_failed', {
        reason: meta('repo_too_large_to_bundle'),
        pack_bytes: packProbe.sizeBytes ?? undefined,
        pack_objects: packProbe.inPackCount ?? undefined,
        cwd_is_home: isCwdHome(),
      })
      return [
        {
          type: 'text',
          text: `Repo is too large to bundle. Push a PR and use \`${invocation} <PR#>\` instead.`,
        },
      ]
    }

    // Branch mode: densable treats `n` as base branch (or default when empty).
    // Fetch from origin when missing (YI_), suggest closest on typo (XI_).
    let fetchedFromOrigin = false
    if (trimmed) {
      const localOrRemote =
        (await revParseExists(`origin/${trimmed}`)) ||
        (await revParseExists(trimmed))
      if (!localOrRemote) {
        const fetchResult = await tryFetchOriginBranch(trimmed)
        if (
          fetchResult === 'recovered' &&
          (await revParseExists(`origin/${trimmed}`))
        ) {
          fetchedFromOrigin = true
          // densable: recovery success is logged later via l("succeeded") after merge-base
        } else {
          // densable: non-not_found probe failures log fetch_retry failed
          if (fetchResult !== 'not_found') {
            logEvent('tengu_review_remote_precondition_recovery', {
              reason: meta('base_ref_not_found'),
              method: meta('fetch_retry'),
              outcome: meta('failed'),
            })
          }
          const hasRemote = !!(await detectCurrentRepositoryWithHost())
          const diag = {
            ...baseRefArgDiagnostics(trimmed),
            has_remote: hasRemote,
            cwd_is_home: isCwdHome(),
          }
          if (fetchResult === 'fetch_failed') {
            logEvent('tengu_review_remote_precondition_failed', {
              reason: meta('base_ref_not_found'),
              ...diag,
            })
            return [
              {
                type: 'text',
                text: `"${trimmed}" exists on origin but couldn't be fetched. Run \`git fetch origin ${trimmed}\` and try ${invocation} again.`,
              },
            ]
          }
          const suggestion = await suggestClosestBranch(trimmed)
          if (suggestion) {
            logEvent('tengu_review_remote_precondition_recovery', {
              reason: meta('base_ref_not_found'),
              method: meta('branch_suggestion'),
              outcome: meta('offered'),
            })
          }
          logEvent('tengu_review_remote_precondition_failed', {
            reason: meta('base_ref_not_found'),
            ...diag,
          })
          const didYouMean = suggestion
            ? ` Did you mean \`${suggestion}\`?`
            : ''
          return [
            {
              type: 'text',
              text: `"${trimmed}" is not a branch in this repo.${didYouMean} ${invocation} takes a PR number, a branch name, or no argument (reviews your current branch). Try ${invocation} by itself.`,
            },
          ]
        }
      }
    }

    const baseBranch = trimmed || (await getDefaultBranch()) || 'main'
    const headBranch = (await getBranch()) || 'HEAD'
    // Env-manager's `git remote remove origin` after bundle-clone
    // deletes refs/remotes/origin/* — the base branch name won't resolve
    // in the container. Pass the merge-base SHA instead: it's reachable
    // from HEAD's history so `git diff <sha>` works without a named ref.
    let mbOut = ''
    let mbCode = 1
    ;({ stdout: mbOut, code: mbCode } = await execFileNoThrow(
      gitExe(),
      ['merge-base', `origin/${baseBranch}`, 'HEAD'],
      { preserveOutputOnError: false },
    ))
    if (mbCode !== 0) {
      ;({ stdout: mbOut, code: mbCode } = await execFileNoThrow(
        gitExe(),
        ['merge-base', baseBranch, 'HEAD'],
        { preserveOutputOnError: false },
      ))
    }
    const mergeBaseSha = mbOut.trim()
    // densable l(outcome): only when branch was recovered via YI_ fetch
    const logFetchRecovery = (outcome: 'succeeded' | 'failed') => {
      if (!fetchedFromOrigin) return
      logEvent('tengu_review_remote_precondition_recovery', {
        reason: meta('base_ref_not_found'),
        method: meta('fetch_retry'),
        outcome: meta(outcome),
      })
    }
    if (mbCode !== 0 || !mergeBaseSha) {
      logEvent('tengu_review_remote_precondition_failed', {
        reason: meta('no_merge_base'),
        cwd_is_home: isCwdHome(),
      })
      logFetchRecovery('failed')
      const hint = fetchedFromOrigin
        ? `${baseBranch} was fetched from origin but shares no history with HEAD — this can happen in shallow clones. Try \`git fetch --unshallow origin\` (or deepen the clone) and rerun.`
        : trimmed
          ? `Make sure ${baseBranch} exists locally or on origin (try \`git fetch origin ${baseBranch}\`).`
          : `Pass the base branch explicitly (e.g. \`${invocation} develop\`) or make sure you're in a git repo with a ${baseBranch} branch.`
      return [
        {
          type: 'text',
          text: `Could not find merge-base with ${baseBranch}. ${hint}`,
        },
      ]
    }

    // Bail early on empty diffs instead of launching a container that
    // will just echo "no changes".
    const { stdout: diffStat, code: diffCode } = await execFileNoThrow(
      gitExe(),
      ['diff', '--no-ext-diff', '--no-textconv', '--shortstat', mergeBaseSha],
      {
        preserveOutputOnError: false,
        env: { ...process.env, LC_ALL: 'C' },
      },
    )
    if (diffCode === 0 && !diffStat.trim()) {
      logEvent('tengu_review_remote_precondition_failed', {
        reason: meta('empty_diff'),
        cwd_is_home: isCwdHome(),
      })
      logFetchRecovery('failed')
      return [
        {
          type: 'text',
          text: `It doesn't look like you have any new commits or changes to review against your ${baseBranch} branch. Stage or commit them first?`,
        },
      ]
    }

    // densable Dro + qqi → local_diff_too_large
    const parsedStat = parseGitShortstat(diffStat)
    if (parsedStat) {
      const { maxFiles, maxLines } = getUltrareviewDiffLimits(raw)
      const totalLines = parsedStat.linesAdded + parsedStat.linesRemoved
      if (parsedStat.filesCount > maxFiles || totalLines > maxLines) {
        logEvent('tengu_review_remote_precondition_failed', {
          reason: meta('local_diff_too_large'),
          files: parsedStat.filesCount,
          lines: totalLines,
          max_files: maxFiles,
          max_lines: maxLines,
          cwd_is_home: isCwdHome(),
        })
        logFetchRecovery('failed')
        return [
          {
            type: 'text',
            text: `Diff is too large for ultrareview: ${diffStat.trim()}. Pass a closer base branch (\`${invocation} <branch>\`) to narrow the scope, or split the change.`,
          },
        ]
      }
    }

    logFetchRecovery('succeeded')
    launchMode = 'branch'
    scopeDiffStat = diffStat.trim()
    session = await teleportToRemote({
      initialMessage: null,
      // densable JOo: description uses headBranch (k), not baseBranch
      description: `ultrareview: ${headBranch}`,
      signal: context.abortController.signal,
      // densable JOo: useBundle + bundleBaseRef:mergeBaseSha + tags
      useBundle: true,
      bundleBaseRef: mergeBaseSha,
      environmentId: CODE_REVIEW_ENV_ID,
      source: 'ultrareview',
      tags: ['ultrareview'],
      environmentVariables: {
        BUGHUNTER_BASE_BRANCH: mergeBaseSha,
        ...commonEnvVars,
      },
      onBundleFail: (message, kind) => {
        bundleFailMessage = message
        bundleFailKind = kind
      },
      onCreateFail: (message, reason, failMeta) => {
        createFailMessage = message
        createFailReason = reason
        createFailStatus = failMeta?.status
        createFailServerType = failMeta?.serverType
        createFailServerReason = failMeta?.serverReason
      },
    })
    if (!session) {
      // densable JOo branch fail: onBundleFail msg || createFail || short "Repo is too large."
      // telemetry: mode/reason/bundle_fail_kind/status_code/server_type/server_reason
      logEvent('tengu_review_remote_teleport_failed', {
        mode: meta('branch'),
        ...(createFailReason ? { reason: meta(createFailReason) } : {}),
        ...(bundleFailKind ? { bundle_fail_kind: meta(bundleFailKind) } : {}),
        ...(createFailStatus !== undefined
          ? { status_code: createFailStatus }
          : {}),
        ...(createFailServerType
          ? { server_type: meta(createFailServerType) }
          : {}),
        ...(createFailServerReason
          ? { server_reason: meta(createFailServerReason) }
          : {}),
      })
      return [
        {
          type: 'text',
          text:
            bundleFailMessage ??
            (createFailMessage
              ? `Ultrareview could not start the cloud session: ${createFailMessage}`
              : `Repo is too large. Push a PR and use \`${invocation} <PR#>\` instead.`),
        },
      ]
    }
    command = invocation
    target =
      headBranch === baseBranch ? baseBranch : `${headBranch} → ${baseBranch}`
  }

  if (!session) {
    // densable JOo PR path fail telemetry
    logEvent('tengu_review_remote_teleport_failed', {
      mode: meta(launchMode),
      ...(createFailReason ? { reason: meta(createFailReason) } : {}),
      ...(createFailStatus !== undefined
        ? { status_code: createFailStatus }
        : {}),
      ...(createFailServerType
        ? { server_type: meta(createFailServerType) }
        : {}),
      ...(createFailServerReason
        ? { server_reason: meta(createFailServerReason) }
        : {}),
    })
    if (createFailMessage) {
      return [
        {
          type: 'text',
          text: `Ultrareview could not start the cloud session: ${createFailMessage}`,
        },
      ]
    }
    return null
  }
  registerRemoteAgentTask({
    remoteTaskType: 'ultrareview',
    session,
    command,
    context,
    isRemoteReview: true,
  })
  // densable: tengu_review_remote_launched {mode, had_arg}
  logEvent('tengu_review_remote_launched', {
    mode: meta(launchMode),
    had_arg: trimmed.length > 0,
  })
  const sessionUrl = getRemoteTaskSessionUrl(session.id)
  // densable JOo: optional Scope: ${diffStat} line for branch launches
  const scopeLine = scopeDiffStat ? `\nScope: ${scopeDiffStat}` : ''
  // Concise — the tool-output block is visible to the user, so the model
  // shouldn't echo the same info. Just enough for Claude to acknowledge the
  // launch without restating the target/URL (both already printed above).
  return [
    {
      type: 'text',
      text: `Ultrareview launched for ${target} (~10–20 min, runs in the cloud). Track: ${sessionUrl}${resolvedBillingNote}${scopeLine} Findings arrive via task-notification. Briefly acknowledge the launch to the user without repeating the target or URL — both are already visible in the tool output above.`,
    },
  ]
}
