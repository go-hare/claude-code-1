/**
 * Shell-agnostic git operation tracking for usage metrics.
 *
 * Detects `git commit`, `git push`, `gh pr create`, `glab mr create`, and
 * curl-based PR creation in command strings, then increments OTLP counters
 * and fires analytics events. The regexes operate on raw command text so they
 * work identically for Bash and PowerShell (both invoke git/gh/glab/curl as
 * external binaries with the same argv syntax).
 *
 * densable 2.1.222 #7 — after `git push`, schedule `gh pr view` discovery so
 * PRs created later (incl. REST API) still link to the session.
 */
import {
  getCommitCounter,
  getPendingBranchLinks,
  getPendingPrLinks,
  getPrCounter,
  getSessionId,
} from 'src/bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getCwd } from 'src/utils/cwd.js'
import { execFileNoThrow } from 'src/utils/execFileNoThrow.js'
import { getCachedBranch } from 'src/utils/git/gitFilesystem.js'
import { isEssentialTrafficOnly } from 'src/utils/privacyLevel.js'

/** densable xv_ / Dc_ — max wait for pending PR-link flush on teardown */
export const PENDING_PR_LINKS_FLUSH_MS = 2000

/** densable kc_ — max gh pr view retries per pending branch after push */
export const PENDING_BRANCH_LINK_MAX_ATTEMPTS = 5

/** densable xc_ — max pending branch entries (evict oldest) */
const PENDING_BRANCH_LINKS_MAX = 8

/**
 * densable NFr — race promise vs timeout; resolves void on timeout (never rejects).
 */
export function raceWithTimeout(
  promise: Promise<unknown>,
  ms: number,
): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    const t = setTimeout(done, ms)
    t.unref?.()
    void promise.then(done, done).finally(() => clearTimeout(t))
  })
}

/**
 * densable But / BBt — track a pending PR-link promise so teardown can await it.
 * Swallows rejections; removes from set on settle.
 */
export function trackPendingPrLink(promise: Promise<unknown>): void {
  const set = getPendingPrLinks()
  const tracked = promise.catch(() => {})
  set.add(tracked)
  void tracked.finally(() => {
    set.delete(tracked)
  })
}

/**
 * densable DZr / odn — flush pending PR links with 2s cap (xv_).
 * Call before process/session cleanup completes.
 */
export async function flushPendingPrLinks(): Promise<void> {
  const set = getPendingPrLinks()
  if (set.size === 0) return
  await raceWithTimeout(Promise.allSettled([...set]), PENDING_PR_LINKS_FLUSH_MS)
}

/**
 * densable IZr / J$s — await linkSessionToPR for a resolved PR.
 * Kept internal; callers schedule via trackPendingPrLink.
 */
async function linkSessionToPrInfo(prInfo: {
  prNumber: number
  prUrl: string
  prRepository: string
}): Promise<void> {
  const { linkSessionToPR } = await import('src/utils/sessionStorage.js')
  const sessionId = getSessionId()
  if (!sessionId) return
  await linkSessionToPR(
    sessionId as `${string}-${string}-${string}-${string}-${string}`,
    prInfo.prNumber,
    prInfo.prUrl,
    prInfo.prRepository,
  )
}

/** densable Ywd — map key for pending branch links */
export function pendingBranchLinkKey(cwd: string, branch: string): string {
  return `${cwd}\0${branch}`
}

/**
 * densable Xwd — reject HEAD / flags / numeric PR-id-looking refs as branch names.
 */
export function isValidPendingBranchName(branch: string): boolean {
  return branch !== 'HEAD' && !branch.startsWith('-') && !/^#?\d+$/.test(branch)
}

/**
 * densable Ic_ — register a branch that was pushed without an immediate PR link.
 * Skipped under essential-traffic privacy (xa).
 */
export function registerPendingBranchLink(cwd: string, branch: string): void {
  if (isEssentialTrafficOnly()) return
  if (!isValidPendingBranchName(branch)) return
  const map = getPendingBranchLinks()
  const key = pendingBranchLinkKey(cwd, branch)
  map.delete(key)
  if (map.size >= PENDING_BRANCH_LINKS_MAX) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, { cwd, branch, attempts: 0 })
}

/**
 * densable Rc_ — clear all pending branch links for a cwd (PR was just linked).
 */
export function clearPendingBranchLinksForCwd(cwd: string): void {
  const map = getPendingBranchLinks()
  for (const [key, entry] of map) {
    if (entry.cwd === cwd) map.delete(key)
  }
}

/**
 * densable kPo — parse PR info from multi-host PR URL (github / ghe / gitlab / bb).
 * Exported for tests.
 */
export function parsePrUrl(url: string): {
  prNumber: number
  prUrl: string
  prRepository: string
  provider: string
} | null {
  const match = url.match(
    /https?:\/\/[^/\s"]+\/([^\s"]+?)\/(?:pull|pull-requests|-\/merge_requests)\/(\d+)/,
  )
  if (match?.[1] && match?.[2]) {
    return {
      prNumber: parseInt(match[2], 10),
      prUrl: match[0],
      prRepository: match[1],
      provider: providerFromPrUrl(match[0]),
    }
  }
  return null
}

function providerFromPrUrl(url: string): string {
  if (url.includes('/-/merge_requests/')) return 'gitlab'
  if (url.includes('/pull-requests/')) return 'bitbucket'
  try {
    const host = new URL(url).hostname
    if (host === 'github.com' || host === 'www.github.com') return 'github'
  } catch {
    return 'github-enterprise'
  }
  return 'github-enterprise'
}

/** densable Y$s — last PR URL in stdout */
function findPrInStdout(stdout: string): ReturnType<typeof parsePrUrl> {
  const matches = stdout.match(
    new RegExp(
      /https?:\/\/[^/\s"]+\/([^\s"]+?)\/(?:pull|pull-requests|-\/merge_requests)\/(\d+)/
        .source,
      'g',
    ),
  )
  if (!matches?.length) return null
  return parsePrUrl(matches[matches.length - 1]!)
}

/**
 * densable ndn — `gh pr view … --json url` then linkSessionToPR.
 * Returns true when a PR was found and linked.
 */
export async function resolvePrViaGhView(
  branchOrNumber?: string,
  repo?: string,
): Promise<boolean> {
  if (isEssentialTrafficOnly()) return false
  if (
    repo !== undefined &&
    !/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(repo)
  ) {
    return false
  }
  const selector =
    branchOrNumber &&
    !branchOrNumber.startsWith('-') &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(branchOrNumber)
      ? branchOrNumber
      : undefined
  const args = [
    'pr',
    'view',
    ...(selector ? [selector] : []),
    ...(repo ? ['--repo', repo] : []),
    '--json',
    'url',
  ]
  const { code, stdout } = await execFileNoThrow('gh', args, {
    timeout: 5000,
    preserveOutputOnError: false,
    useCwd: true,
  })
  if (code !== 0) return false
  let url: string | undefined
  try {
    url = (JSON.parse(stdout) as { url?: string }).url
  } catch {
    return false
  }
  if (!url) return false
  const prInfo = parsePrUrl(url)
  if (!prInfo) return false
  await linkSessionToPrInfo(prInfo)
  return true
}

/**
 * densable jwd — after concurrent gh pr view + branch resolution:
 * if view succeeded drop pending; else register pending for later Pc_ retries.
 */
async function schedulePostPushPrDiscovery(
  map: ReturnType<typeof getPendingBranchLinks>,
  cwd: string,
  branchPromise: Promise<string | undefined> | string | undefined,
  viewPromise: Promise<boolean>,
): Promise<void> {
  const resolved = await viewPromise
  const branch =
    typeof branchPromise === 'string' || branchPromise === undefined
      ? branchPromise
      : await branchPromise
  if (branch === undefined || !isValidPendingBranchName(branch)) return
  if (resolved) {
    map.delete(pendingBranchLinkKey(cwd, branch))
  } else {
    registerPendingBranchLink(cwd, branch)
  }
}

/**
 * densable Pc_ — on subsequent git/gh/curl success, retry pending branch PR views.
 */
function retryPendingBranchLinks(command: string): void {
  const map = getPendingBranchLinks()
  if (map.size === 0) return
  if (!/\b(?:git|gh|glab|curl)\b/.test(command)) return
  const cwd = getCwd()
  for (const [key, entry] of map) {
    if (entry.cwd !== cwd) continue
    if (entry.attempts >= PENDING_BRANCH_LINK_MAX_ATTEMPTS) {
      map.delete(key)
      continue
    }
    entry.attempts++
    trackPendingPrLink(
      resolvePrViaGhView(entry.branch).then(ok => {
        if (ok) map.delete(key)
      }),
    )
  }
}

/**
 * densable K$s — link PR found in create stdout and clear pending for cwd.
 */
function linkPrFromCreateStdout(stdout: string | undefined): void {
  const prInfo = stdout ? findPrInStdout(stdout) : null
  if (!prInfo) return
  trackPendingPrLink(linkSessionToPrInfo(prInfo))
  clearPendingBranchLinksForCwd(getCwd())
}

/**
 * densable qwd — portion of command after `git push` (first segment).
 */
function pushArgsSegment(command: string): string {
  return (command.split(GIT_PUSH_RE)[1] ?? '').split(/[&|;\n]/)[0] ?? ''
}

/**
 * densable RPo `f` — only colon refspecs yield an explicit post-push branch:
 * `git push origin HEAD:refs/heads/foo` → foo; `git push origin main:feature` → feature.
 * Plain `git push origin feature` is NOT `f` — densable relies on current-branch
 * discovery (`dT` / getCachedBranch) for that case.
 */
export function extractPushTargetBranch(command: string): string | undefined {
  const after = pushArgsSegment(command)
  const tokens = after.match(/\S+/g)?.filter(t => !t.startsWith('-'))
  // tokens[0] is typically remote; tokens[1] is refspec
  const refspec = tokens?.[1]
  if (!refspec) return undefined
  const colon = refspec.indexOf(':')
  if (colon > 0 && colon < refspec.length - 1) {
    return refspec.slice(colon + 1).replace(/^refs\/heads\//, '')
  }
  return undefined
}

/**
 * Build a regex that matches `git <subcmd>` while tolerating git's global
 * options between `git` and the subcommand (e.g. `-c key=val`, `-C path`,
 * `--git-dir=path`). Common when the model retries with
 * `git -c commit.gpgsign=false commit` after a signing failure.
 */
function gitCmdRe(subcmd: string, suffix = ''): RegExp {
  return new RegExp(
    `\\bgit(?:\\s+-[cC]\\s+\\S+|\\s+--\\S+=\\S+)*\\s+${subcmd}\\b${suffix}`,
  )
}

const GIT_COMMIT_RE = gitCmdRe('commit')
const GIT_PUSH_RE = gitCmdRe('push')
const GIT_CHERRY_PICK_RE = gitCmdRe('cherry-pick')
const GIT_MERGE_RE = gitCmdRe('merge', '(?!-)')
const GIT_REBASE_RE = gitCmdRe('rebase')
const GIT_PUSH_DRY_RUN_RE = /(?:^|\s)(?:-n|--dry-run)(?=\s|$)/
/** densable gc_ — `gh pr checkout <n>` links via ndn(prNumber) */
const GH_PR_CHECKOUT_RE = /\bgh\s+pr\s+checkout\b[^&|;]*\s(\d+)(?=\s|$|[&|;])/

export type CommitKind = 'committed' | 'amended' | 'cherry-picked'
export type BranchAction = 'merged' | 'rebased'
export type PrAction =
  | 'created'
  | 'edited'
  | 'merged'
  | 'commented'
  | 'closed'
  | 'ready'

const GH_PR_ACTIONS: readonly { re: RegExp; action: PrAction; op: string }[] = [
  { re: /\bgh\s+pr\s+create\b/, action: 'created', op: 'pr_create' },
  { re: /\bgh\s+pr\s+edit\b/, action: 'edited', op: 'pr_edit' },
  { re: /\bgh\s+pr\s+merge\b/, action: 'merged', op: 'pr_merge' },
  { re: /\bgh\s+pr\s+comment\b/, action: 'commented', op: 'pr_comment' },
  { re: /\bgh\s+pr\s+close\b/, action: 'closed', op: 'pr_close' },
  { re: /\bgh\s+pr\s+ready\b/, action: 'ready', op: 'pr_ready' },
]

/** densable Kwd — PR number (+ optional owner/repo#) from checkmark lines */
export function parsePrNumberFromText(
  stdout: string,
): { prNumber: number; prRepository?: string } | undefined {
  const match = stdout.match(/[Pp]ull request (?:(\S+)#)?#?(\d{1,9})\b/)
  if (!match?.[2]) return undefined
  return {
    prNumber: parseInt(match[2], 10),
    prRepository: match[1],
  }
}

// Exported for testing purposes
export function parseGitCommitId(stdout: string): string | undefined {
  // git commit output: [branch abc1234] message
  // or for root commit: [branch (root-commit) abc1234] message
  const match = stdout.match(/\[[\w./-]+(?: \(root-commit\))? ([0-9a-f]+)\]/)
  return match?.[1]
}

/**
 * densable 2.1.223 #15 — parse branch name from git push output.
 * Push writes progress to stderr but the ref update line
 * ("abc..def  branch -> branch", "* [new branch] branch -> branch", or
 * " + abc...def  branch -> branch (forced update)") is the signal.
 * Works on either stdout or stderr. Git prefixes each ref line with a status
 * flag (space, +, -, *, !, =); the char class tolerates any.
 *
 * SEA gold (no catastrophic backtrack on long non-hex `\S+..\S+` runs):
 * `/^\s*[+\-*!= ]?\s*(?:\[new branch\]|[0-9a-f]+\.\.+[0-9a-f]+)\s+\S+\s*->\s*(\S+)/m`
 * Local previously used `\S+\.\.+\S+` which can hang on pathological output.
 */
export function parseGitPushBranch(output: string): string | undefined {
  const match = output.match(
    /^\s*[+\-*!= ]?\s*(?:\[new branch\]|[0-9a-f]+\.\.+[0-9a-f]+)\s+\S+\s*->\s*(\S+)/m,
  )
  return match?.[1]
}

/**
 * Extract target ref from `git merge <ref>` / `git rebase <ref>` command.
 * Skips flags and keywords — first non-flag argument is the ref.
 */
function parseRefFromCommand(
  command: string,
  verb: string,
): string | undefined {
  const after = command.split(gitCmdRe(verb))[1]
  if (!after) return undefined
  for (const t of after.trim().split(/\s+/)) {
    if (/^[&|;><]/.test(t)) break
    if (t.startsWith('-')) continue
    return t
  }
  return undefined
}

/**
 * Scan bash command + output for git operations worth surfacing in the
 * collapsed tool-use summary ("committed a1b2c3, created PR #42, ran 3 bash
 * commands"). Checks the command to avoid matching SHAs/URLs that merely
 * appear in unrelated output (e.g. `git log`).
 *
 * Pass stdout+stderr concatenated — git push writes the ref update to stderr.
 */
export function detectGitOperation(
  command: string,
  output: string,
): {
  commit?: { sha: string; kind: CommitKind }
  push?: { branch: string }
  branch?: { ref: string; action: BranchAction }
  pr?: { number: number; url?: string; action: PrAction }
} {
  const result: ReturnType<typeof detectGitOperation> = {}
  // commit and cherry-pick both produce "[branch sha] msg" output
  const isCherryPick = GIT_CHERRY_PICK_RE.test(command)
  if (GIT_COMMIT_RE.test(command) || isCherryPick) {
    const sha = parseGitCommitId(output)
    if (sha) {
      result.commit = {
        sha: sha.slice(0, 6),
        kind: isCherryPick
          ? 'cherry-picked'
          : /--amend\b/.test(command)
            ? 'amended'
            : 'committed',
      }
    }
  }
  if (GIT_PUSH_RE.test(command)) {
    const branch = parseGitPushBranch(output)
    if (branch) result.push = { branch }
  }
  if (
    GIT_MERGE_RE.test(command) &&
    /(Fast-forward|Merge made by)/.test(output)
  ) {
    const ref = parseRefFromCommand(command, 'merge')
    if (ref) result.branch = { ref, action: 'merged' }
  }
  if (GIT_REBASE_RE.test(command) && /Successfully rebased/.test(output)) {
    const ref = parseRefFromCommand(command, 'rebase')
    if (ref) result.branch = { ref, action: 'rebased' }
  }
  const prAction = GH_PR_ACTIONS.find(a => a.re.test(command))?.action
  if (prAction) {
    const pr = findPrInStdout(output)
    if (pr) {
      result.pr = { number: pr.prNumber, url: pr.prUrl, action: prAction }
    } else {
      const num = parsePrNumberFromText(output)
      if (num) result.pr = { number: num.prNumber, action: prAction }
    }
  }
  return result
}

// Exported for testing purposes
export function trackGitOperations(
  command: string,
  exitCode: number,
  stdout?: string,
): void {
  const success = exitCode === 0
  if (!success) {
    return
  }

  if (GIT_COMMIT_RE.test(command)) {
    logEvent('tengu_git_operation', {
      operation:
        'commit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (command.match(/--amend\b/)) {
      logEvent('tengu_git_operation', {
        operation:
          'commit_amend' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    getCommitCounter()?.add(1)
  }
  if (GIT_PUSH_RE.test(command)) {
    logEvent('tengu_git_operation', {
      operation:
        'push' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  const prHit = GH_PR_ACTIONS.find(a => a.re.test(command))
  if (prHit) {
    logEvent('tengu_git_operation', {
      operation:
        prHit.op as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  if (prHit?.action === 'created') {
    getPrCounter()?.add(1)
    // densable K$s: link + clear pending branch links for cwd
    linkPrFromCreateStdout(stdout)
  } else if (prHit && stdout) {
    // densable: other PR actions — URL in stdout or checkmark + gh pr view
    const prInfo = findPrInStdout(stdout)
    if (prInfo) {
      trackPendingPrLink(linkSessionToPrInfo(prInfo))
    } else {
      const checkLine = stdout.match(/^✓.*$/m)?.[0]
      const parsed = checkLine ? parsePrNumberFromText(checkLine) : undefined
      if (parsed) {
        trackPendingPrLink(
          resolvePrViaGhView(String(parsed.prNumber), parsed.prRepository),
        )
      }
    }
  }

  // densable RPo: `gh pr checkout <n>` → ndn(n); else push without concurrent PR
  // action → discover PR via gh pr view and register pendingBranchLinks when
  // none yet (PR created later / REST).
  const checkoutMatch = command.match(GH_PR_CHECKOUT_RE)
  if (checkoutMatch?.[1]) {
    trackPendingPrLink(resolvePrViaGhView(checkoutMatch[1]))
  } else if (GIT_PUSH_RE.test(command) && !prHit) {
    const pushSeg = pushArgsSegment(command)
    const dryRun = GIT_PUSH_DRY_RUN_RE.test(pushSeg)
    const cwd = getCwd()
    const map = getPendingBranchLinks()
    // densable f: only colon refspec (HEAD:refs/heads/foo)
    const explicitBranch = extractPushTargetBranch(command)
    const currentBranchPromise =
      dryRun || isEssentialTrafficOnly()
        ? Promise.resolve(undefined)
        : getCachedBranch().then(b => b || undefined)

    if (explicitBranch && isValidPendingBranchName(explicitBranch) && !dryRun) {
      trackPendingPrLink(
        schedulePostPushPrDiscovery(
          map,
          cwd,
          explicitBranch,
          resolvePrViaGhView(explicitBranch),
        ),
      )
    }
    // Always also try current branch (densable: BBt(jwd(h,m,_,ndn())))
    trackPendingPrLink(
      schedulePostPushPrDiscovery(
        map,
        cwd,
        currentBranchPromise,
        resolvePrViaGhView(),
      ),
    )
  }

  if (command.match(/\bglab\s+mr\s+create\b/)) {
    logEvent('tengu_git_operation', {
      operation:
        'pr_create' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    getPrCounter()?.add(1)
    linkPrFromCreateStdout(stdout)
  }
  // Detect PR creation via curl to REST APIs (Bitbucket, GitHub API, GitLab API)
  // Check for POST method and PR endpoint separately to handle any argument order
  // Also detect implicit POST when -d is used (curl defaults to POST with data)
  const isCurlPost =
    command.match(/\bcurl\b/) &&
    (command.match(/-X\s*POST\b/i) ||
      command.match(/--request\s*=?\s*POST\b/i) ||
      command.match(/\s-d\s/))
  // Match PR endpoints in URLs, but not sub-resources like /pulls/123/comments
  // Require https?:// prefix to avoid matching text in POST body or other params
  const isPrEndpoint = command.match(
    /https?:\/\/[^\s'"]*\/(pulls|pull-requests|merge[-_]requests)(?!\/\d)/i,
  )
  if (isCurlPost && isPrEndpoint) {
    logEvent('tengu_git_operation', {
      operation:
        'pr_create' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    getPrCounter()?.add(1)
    // densable K$s on curl REST create
    linkPrFromCreateStdout(stdout)
  }

  // densable Pc_: any successful git/gh/glab/curl may retry pending branch links
  retryPendingBranchLinks(command)
}
