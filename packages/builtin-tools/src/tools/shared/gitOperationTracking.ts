/**
 * Shell-agnostic git operation tracking for usage metrics.
 *
 * Detects `git commit`, `git push`, `gh pr create`, `glab mr create`, and
 * curl-based PR creation in command strings, then increments OTLP counters
 * and fires analytics events. The regexes operate on raw command text so they
 * work identically for Bash and PowerShell (both invoke git/gh/glab/curl as
 * external binaries with the same argv syntax).
 */

import {
  getCommitCounter,
  getPendingPrLinks,
  getPrCounter,
  getSessionId,
} from 'src/bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'

/** densable xv_ — max wait for pending PR-link flush on teardown */
export const PENDING_PR_LINKS_FLUSH_MS = 2000

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
 * densable But — track a pending PR-link promise so teardown can await it.
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
 * densable DZr — flush pending PR links with 2s cap (xv_).
 * Call before process/session cleanup completes.
 */
export async function flushPendingPrLinks(): Promise<void> {
  const set = getPendingPrLinks()
  if (set.size === 0) return
  await raceWithTimeout(Promise.allSettled([...set]), PENDING_PR_LINKS_FLUSH_MS)
}

/**
 * densable IZr — emit optional code_change_published + await linkSessionToPR.
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

/**
 * Parse PR info from a GitHub PR URL.
 * Returns { prNumber, prUrl, prRepository } or null if not a valid PR URL.
 */
function parsePrUrl(
  url: string,
): { prNumber: number; prUrl: string; prRepository: string } | null {
  const match = url.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (match?.[1] && match?.[2]) {
    return {
      prNumber: parseInt(match[2], 10),
      prUrl: url,
      prRepository: match[1],
    }
  }
  return null
}

/** Find a GitHub PR URL embedded anywhere in stdout and parse it. */
function findPrInStdout(stdout: string): ReturnType<typeof parsePrUrl> {
  const m = stdout.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/)
  return m ? parsePrUrl(m[0]) : null
}

// Exported for testing purposes
export function parseGitCommitId(stdout: string): string | undefined {
  // git commit output: [branch abc1234] message
  // or for root commit: [branch (root-commit) abc1234] message
  const match = stdout.match(/\[[\w./-]+(?: \(root-commit\))? ([0-9a-f]+)\]/)
  return match?.[1]
}

/**
 * Parse branch name from git push output. Push writes progress to stderr but
 * the ref update line ("abc..def  branch -> branch", "* [new branch]
 * branch -> branch", or " + abc...def  branch -> branch (forced update)") is
 * the signal. Works on either stdout or stderr. Git prefixes each ref line
 * with a status flag (space, +, -, *, !, =); the char class tolerates any.
 */
function parseGitPushBranch(output: string): string | undefined {
  const match = output.match(
    /^\s*[+\-*!= ]?\s*(?:\[new branch\]|\S+\.\.+\S+)\s+\S+\s*->\s*(\S+)/m,
  )
  return match?.[1]
}

/**
 * gh pr merge/close/ready print "✓ <Verb> pull request owner/repo#1234" with
 * no URL. Extract the PR number from the text.
 */
function parsePrNumberFromText(stdout: string): number | undefined {
  const match = stdout.match(/[Pp]ull request (?:\S+#)?#?(\d+)/)
  return match?.[1] ? parseInt(match[1], 10) : undefined
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
      if (num) result.pr = { number: num, action: prAction }
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
    // densable Ubo/But: track PR-link promise (not fire-and-forget) so DZr flush on exit
    if (stdout) {
      const prInfo = findPrInStdout(stdout)
      if (prInfo) {
        trackPendingPrLink(linkSessionToPrInfo(prInfo))
      }
    }
  } else if (prHit && stdout) {
    // densable: other PR actions with URL also IZr via But
    const prInfo = findPrInStdout(stdout)
    if (prInfo) {
      trackPendingPrLink(linkSessionToPrInfo(prInfo))
    }
  }
  if (command.match(/\bglab\s+mr\s+create\b/)) {
    logEvent('tengu_git_operation', {
      operation:
        'pr_create' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    getPrCounter()?.add(1)
    if (stdout) {
      const prInfo = findPrInStdout(stdout)
      if (prInfo) {
        trackPendingPrLink(linkSessionToPrInfo(prInfo))
      }
    }
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
    if (stdout) {
      const prInfo = findPrInStdout(stdout)
      if (prInfo) {
        trackPendingPrLink(linkSessionToPrInfo(prInfo))
      }
    }
  }
}
