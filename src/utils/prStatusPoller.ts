/**
 * densable 2.1.248 #41 — PR-badge unchanged: REST 304/etag + streak.
 *
 * GOLD: gold-248-na-41-A$.txt / gold-248-na-41-dXe.txt / gold-248-na-41-304.txt
 * A$ @178817076 sha=e64adecbbf14ad90
 * dXe @184546378 — pollerNotModifiedStreak + bump.emit reset (247=0)
 * uJt @184548939 — REST list `status===304` empty-ok
 * y5e / wY #T @203022837 — streak bump; interval uses 4th arg H
 *
 * Footer hook (densable nge / leftover usePrStatus) constructs wY with
 * `shared:JE()` + `fetchPrStatus:eDt` + `isDirectApiEnabled:Wen`.
 * Leftover `ghPrStatus.ts` `sJt` (`gh pr view`) has no 304.
 * 247 Wut leftover stays as p5e=60000 sibling inside wY #b.
 */
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from './debug.js'
import { parseGitRemote } from './detectRepository.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import {
  deriveReviewState,
  fetchGithubPrStatus,
  fetchGitlabMrStatus,
  type PrStatus,
} from './ghPrStatus.js'
import { getBranch, getDefaultBranch, getIsGit, getRemoteUrl } from './git.js'
import { getUserAgent } from './http.js'
import { lazySchema } from './lazySchema.js'
import {
  githubRestApiBase,
  resolveGithubAuthToken,
} from './permissions/autoModeRepoVisibility.js'
import type { PrStatusCacheEntry } from './prStatusCache.js'
import { isEssentialTrafficOnly } from './privacyLevel.js'
import { createSignal, type Signal } from './signal.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import { whichSync } from './which.js'

/** densable mH */
const GH_TIMEOUT_MS = 5000

/** densable mXe */
export const GITHUB_PR_API_VERSION = '2022-11-28'

/** densable A$(_Jt, 30000) */
export const PR_STATUS_BY_URL_TTL_MS = 30_000

/** densable A$ default `u=300000` */
export const ASYNC_TTL_CACHE_DEFAULT_MS = 300_000

/** densable g5e / Vut — unfocused floor */
export const PR_STATUS_UNFOCUSED_MIN_MS = 300_000

/** densable a5e / Hut — CLI poll interval when Wen() is off */
export const PR_STATUS_CLI_INTERVAL_MS = 60_000

/** densable l5e / jut — slow fetch disables the poller */
export const PR_STATUS_SLOW_MS = 4_000

/** densable u5e / $ut — stop polling after this idle */
export const PR_STATUS_IDLE_STOP_MS = 3_600_000

/** densable p5e / 247 Wut — focus recheck sibling (name Wut is gone) */
export const PR_STATUS_FOCUS_RECHECK_MS = 60_000

/** densable f5e / qut */
export const PR_STATUS_BAD_STREAK_DISABLE = 3

/** densable aJt */
const REST_REDIRECT_STATUSES = new Set([301, 302, 307, 308])

export type DirectPr = {
  number: number
  url: string
  isDraft: boolean
}

export type DirectState = {
  branch: string
  etag: string | null
  pr: DirectPr | null
  reviewDecision: string
  lastReviewFetchAt: number
  redirectedListUrl: string | null
}

export type DirectPrStatus = PrStatus & { notModified?: true }

export type PollerFetchResult =
  | DirectPrStatus
  | 'needs-auth'
  | 'gh-missing'
  | 'fetch-failed'
  | null

export type RestListResponse = {
  status: number
  ok: boolean
  headers: { get: (name: string) => string | null }
  json: () => Promise<unknown>
}

type TtlEntry<T> = {
  value: T
  timestamp: number
  refreshing: boolean
  lifetimeMs: number
  refreshPromise?: Promise<T>
}

type AsyncTtlFn<Args extends unknown[], Result> = ((
  ...args: Args
) => Promise<Result>) & {
  cache: { clear: () => void }
}

/**
 * densable A$ — async TTL cache (stale-while-revalidate + in-flight dedup).
 * `prStatusByUrl=A$(_Jt,30000)`.
 */
export function createAsyncTtlCache<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  ttlMs: number | ((value: Result) => number) = ASYNC_TTL_CACHE_DEFAULT_MS,
  isValid?: (value: Result, timestamp: number) => boolean,
): AsyncTtlFn<Args, Result> {
  const lifetimeOf = (value: Result): number =>
    typeof ttlMs === 'function' ? ttlMs(value) : ttlMs
  const cache = new Map<string, TtlEntry<Result>>()
  const inFlight = new Map<string, Promise<Result>>()

  const memoized = async (...args: Args): Promise<Result> => {
    const key = jsonStringify(args)
    let entry = cache.get(key)
    if (entry && isValid && !isValid(entry.value, entry.timestamp)) {
      if (entry.refreshPromise) return entry.refreshPromise
      cache.delete(key)
      entry = undefined
    }
    const now = Date.now()
    if (!entry) {
      const pending = inFlight.get(key)
      if (pending) return pending
      const promise = fn(...args)
      inFlight.set(key, promise)
      try {
        const value = await promise
        if (inFlight.get(key) === promise) {
          cache.set(key, {
            value,
            timestamp: Date.now(),
            refreshing: false,
            lifetimeMs: lifetimeOf(value),
          })
        }
        return value
      } finally {
        if (inFlight.get(key) === promise) inFlight.delete(key)
      }
    }
    if (now - entry.timestamp > entry.lifetimeMs && !entry.refreshing) {
      entry.refreshing = true
      const stale = entry
      const refresh = fn(...args)
      stale.refreshPromise = refresh
      void refresh
        .then(value => {
          if (cache.get(key) === stale) {
            cache.set(key, {
              value,
              timestamp: Date.now(),
              refreshing: false,
              lifetimeMs: lifetimeOf(value),
            })
          }
        })
        .catch(err => {
          logForDebugging(String(err), { level: 'error' })
          if (cache.get(key) === stale) cache.delete(key)
        })
      return stale.value
    }
    return cache.get(key)!.value
  }

  memoized.cache = {
    clear: () => {
      cache.clear()
      inFlight.clear()
    },
  }
  return memoized
}

/**
 * densable yJt — statusCheckRollup → {passed,failed,pending}.
 */
export function countCheckRollup(
  rollup:
    | ReadonlyArray<{
        conclusion?: string
        state?: string
        status?: string
      }>
    | null
    | undefined,
): { passed: number; failed: number; pending: number } {
  let passed = 0
  let failed = 0
  let pending = 0
  for (const item of rollup ?? []) {
    const p = (item.conclusion ?? item.state)?.toUpperCase()
    if (p === 'SUCCESS' || p === 'NEUTRAL' || p === 'SKIPPED') passed++
    else if (p === 'FAILURE' || p === 'ERROR') failed++
    else if (
      p == null ||
      p === 'ACTION_REQUIRED' ||
      p === 'PENDING' ||
      p === 'EXPECTED' ||
      item.status?.toUpperCase() !== 'COMPLETED'
    ) {
      pending++
    } else failed++
  }
  return { passed, failed, pending }
}

/**
 * densable _Jt — `gh pr view <url>` fleet cache row.
 */
export async function fetchPrStatusByUrl(
  url: string,
): Promise<PrStatusCacheEntry | null> {
  const { stdout, code } = await execFileNoThrow(
    'gh',
    [
      'pr',
      'view',
      url,
      '--json',
      'number,title,state,isDraft,statusCheckRollup,reviewDecision,additions,deletions',
    ],
    { timeout: GH_TIMEOUT_MS, preserveOutputOnError: false },
  )
  if (code !== 0 || !stdout.trim()) return null
  try {
    const data = jsonParse(stdout) as {
      number: number
      title: string
      state: string
      isDraft: boolean
      statusCheckRollup:
        | Array<{
            conclusion?: string
            state?: string
            status?: string
          }>
        | undefined
      reviewDecision: string
      additions: number
      deletions: number
    }
    return {
      number: data.number,
      title: data.title,
      state:
        data.state === 'MERGED'
          ? 'MERGED'
          : data.state === 'CLOSED'
            ? 'CLOSED'
            : data.isDraft
              ? 'DRAFT'
              : 'OPEN',
      checks: countCheckRollup(data.statusCheckRollup),
      review:
        data.reviewDecision === 'APPROVED' ||
        data.reviewDecision === 'CHANGES_REQUESTED' ||
        data.reviewDecision === 'REVIEW_REQUIRED'
          ? data.reviewDecision
          : null,
      additions: data.additions,
      deletions: data.deletions,
    }
  } catch {
    return null
  }
}

/** densable eJt — `tst` parse. */
export const GITHUB_PULL_URL_RE =
  /^https:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/

/** densable aXe / EJt / CJt / AJt / xfe */
export const PR_STATUS_BATCH_CHUNK = 20
export const PR_STATUS_BATCH_CONCURRENCY = 6
export const PR_STATUS_BATCH_TIMEOUT_MS = 15_000
export const PR_STATUS_BATCH_GH_CACHE = '30s'
export const PR_STATUS_BATCH_BACKOFF_MS = 60_000

const RATE_LIMIT_RE = /rate limit/i

/** densable vJt */
const PR_GRAPHQL_FRAGMENT = `fragment pr on PullRequest {
  number title state isDraft additions deletions
  reviewDecision
  commits(last:1){nodes{commit{statusCheckRollup{
    state
    contexts(first:0){
      checkRunCountsByState{state count}
      statusContextCountsByState{state count}
    }
  }}}}
}`

export type ParsedGithubPullUrl = {
  url: string
  host: string
  owner: string
  repo: string
  num: number
}

export type PrStatusBatchResult = {
  statuses: Map<string, PrStatusCacheEntry | null>
  rateLimit: { remaining: number; resetAt?: string } | null
  unbatched: string[]
}

/** densable `tst` */
export function parseGithubPullUrl(url: string): ParsedGithubPullUrl | null {
  const match = url.match(GITHUB_PULL_URL_RE)
  if (!match) return null
  return {
    url,
    host: match[1]!,
    owner: match[2]!,
    repo: match[3]!,
    num: Number(match[4]),
  }
}

/** densable `iXe` */
function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = groups.get(k)
    if (bucket) bucket.push(item)
    else groups.set(k, [item])
  }
  return groups
}

type GraphqlStateCount = { state: string; count: number }

type GraphqlPrNode = {
  number: number
  title: string
  state: string
  isDraft: boolean
  additions: number
  deletions: number
  reviewDecision: string | null
  commits: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          contexts?: {
            checkRunCountsByState?: GraphqlStateCount[]
            statusContextCountsByState?: GraphqlStateCount[]
          }
        } | null
      }
    }>
  }
}

/** densable `SJt` */
export function countGraphqlCheckStates(
  checkRunCounts: ReadonlyArray<GraphqlStateCount> | null | undefined,
  statusContextCounts: ReadonlyArray<GraphqlStateCount> | null | undefined,
): { passed: number; failed: number; pending: number } {
  let passed = 0
  let failed = 0
  let pending = 0
  for (const { state, count } of checkRunCounts ?? []) {
    switch (state) {
      case 'SUCCESS':
      case 'NEUTRAL':
      case 'SKIPPED':
        passed += count
        break
      case 'FAILURE':
      case 'CANCELLED':
      case 'TIMED_OUT':
      case 'STALE':
      case 'STARTUP_FAILURE':
        failed += count
        break
      case 'ACTION_REQUIRED':
      case 'IN_PROGRESS':
      case 'QUEUED':
      case 'PENDING':
      case 'WAITING':
      case 'REQUESTED':
      case 'COMPLETED':
        pending += count
        break
      default:
        failed += count
    }
  }
  for (const { state, count } of statusContextCounts ?? []) {
    switch (state) {
      case 'SUCCESS':
        passed += count
        break
      case 'FAILURE':
      case 'ERROR':
        failed += count
        break
      default:
        pending += count
    }
  }
  return { passed, failed, pending }
}

/** densable `wJt` */
function isGraphqlPrNode(value: unknown): value is GraphqlPrNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    'number' in value &&
    typeof (value as { number: unknown }).number === 'number' &&
    'state' in value &&
    typeof (value as { state: unknown }).state === 'string'
  )
}

/** densable `kJt` */
export function mapGraphqlPullRequest(node: GraphqlPrNode): PrStatusCacheEntry {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup ?? null
  return {
    number: node.number,
    title: node.title,
    state:
      node.state === 'MERGED'
        ? 'MERGED'
        : node.state === 'CLOSED'
          ? 'CLOSED'
          : node.isDraft
            ? 'DRAFT'
            : 'OPEN',
    checks: countGraphqlCheckStates(
      rollup?.contexts?.checkRunCountsByState,
      rollup?.contexts?.statusContextCountsByState,
    ),
    review:
      node.reviewDecision === 'APPROVED' ||
      node.reviewDecision === 'CHANGES_REQUESTED' ||
      node.reviewDecision === 'REVIEW_REQUIRED'
        ? node.reviewDecision
        : null,
    additions: node.additions,
    deletions: node.deletions,
  }
}

/** densable `TJt` */
function isGraphqlRepoNode(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !('cost' in value)
}

/** densable `KX` */
export function isGhPrBatchInBackoff(
  now: number = Date.now(),
  shared: PrStatusShared = getPrStatusShared(),
): boolean {
  return now < shared.ghBackoffUntil
}

/** densable `Ao(i,s)` */
async function mapLimit<T>(
  limit: number,
  items: readonly T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let active = 0
  const waiting: Array<() => void> = []
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active++
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      waiting.push(resolve)
    })
  }
  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
  await Promise.all(
    items.map(async item => {
      await acquire()
      try {
        await fn(item)
      } finally {
        release()
      }
    }),
  )
}

/**
 * densable `V$n` — GraphQL batch. Unparsed `/pull/\d+` hrefs go to
 * `unbatched` for leftover `G$n`. Empty / `Tt()` / `KX()` → all null.
 */
export async function fetchPrStatusBatch(
  hrefs: readonly string[],
): Promise<PrStatusBatchResult> {
  const statuses = new Map<string, PrStatusCacheEntry | null>()
  const unbatched: string[] = []
  let rateLimit: PrStatusBatchResult['rateLimit'] = null
  const shared = getPrStatusShared()
  if (
    hrefs.length === 0 ||
    isEssentialTrafficOnly() ||
    isGhPrBatchInBackoff()
  ) {
    for (const href of hrefs) statuses.set(href, null)
    return { statuses, rateLimit, unbatched: [] }
  }
  const parsed: ParsedGithubPullUrl[] = []
  for (const href of hrefs) {
    const row = parseGithubPullUrl(href)
    if (row) parsed.push(row)
    else if (/\/pull\/\d+/.test(href)) unbatched.push(href)
  }
  parsed.sort((a, b) => a.url.localeCompare(b.url))
  const chunks: Array<{ host: string; chunk: ParsedGithubPullUrl[] }> = []
  for (const [host, rows] of groupBy(parsed, row => row.host)) {
    for (let i = 0; i < rows.length; i += PR_STATUS_BATCH_CHUNK) {
      chunks.push({ host, chunk: rows.slice(i, i + PR_STATUS_BATCH_CHUNK) })
    }
  }
  await mapLimit(
    PR_STATUS_BATCH_CONCURRENCY,
    chunks,
    async ({ host, chunk }) => {
      if (isGhPrBatchInBackoff()) {
        for (const row of chunk) statuses.set(row.url, null)
        return
      }
      const aliasToUrl = new Map<string, string>()
      const repoFields = [
        ...groupBy(chunk, row => `${row.owner}/${row.repo}`),
      ].map(([repoKey, rows], repoIdx) => {
        const [owner, repo] = repoKey.split('/')
        const fields = rows
          .map((row, prIdx) => {
            const alias = `p${repoIdx}_${prIdx}`
            aliasToUrl.set(alias, row.url)
            return `${alias}: pullRequest(number: ${row.num}) { ...pr }`
          })
          .join(' ')
        return `r${repoIdx}: repository(owner:"${owner}", name:"${repo}") { ${fields} }`
      })
      const query = `${PR_GRAPHQL_FRAGMENT}
query { rateLimit{cost remaining resetAt} ${repoFields.join(' ')} }`
      const { stdout, stderr, code } = await execFileNoThrow(
        'gh',
        [
          'api',
          'graphql',
          '--hostname',
          host,
          '--cache',
          PR_STATUS_BATCH_GH_CACHE,
          '-F',
          'query=@-',
        ],
        {
          timeout: PR_STATUS_BATCH_TIMEOUT_MS,
          input: query,
          preserveOutputOnError: true,
        },
      )
      let parsedJson: { data?: Record<string, unknown> } | null = null
      if (stdout.trim()) {
        try {
          parsedJson = jsonParse(stdout) as { data?: Record<string, unknown> }
        } catch {
          parsedJson = null
        }
      }
      if (!parsedJson?.data) {
        if (RATE_LIMIT_RE.test(stderr) || RATE_LIMIT_RE.test(stdout)) {
          shared.backOffUntil(Date.now() + PR_STATUS_BATCH_BACKOFF_MS)
          logForDebugging(
            `[ghPrStatus] GitHub rate-limited on ${host}; backing off 60s`,
            { level: 'warn' },
          )
        } else {
          logForDebugging(
            `[ghPrStatus] batch query failed on ${host} (exit ${code}); keeping last-known`,
          )
        }
        for (const row of chunk) statuses.set(row.url, null)
        return
      }
      const limit = parsedJson.data.rateLimit as
        | { remaining?: number; resetAt?: string }
        | undefined
      if (limit && typeof limit.remaining === 'number') {
        if (!rateLimit || limit.remaining < rateLimit.remaining) {
          rateLimit = {
            remaining: limit.remaining,
            resetAt: limit.resetAt,
          }
        }
        if (limit.remaining < 50) {
          shared.backOffUntil(
            Date.parse(limit.resetAt ?? '') ||
              Date.now() + PR_STATUS_BATCH_BACKOFF_MS,
          )
        }
      }
      for (const [key, repoNode] of Object.entries(parsedJson.data)) {
        if (!key.startsWith('r') || !isGraphqlRepoNode(repoNode)) continue
        for (const [alias, prNode] of Object.entries(repoNode)) {
          const url = aliasToUrl.get(alias)
          if (!url) continue
          statuses.set(
            url,
            isGraphqlPrNode(prNode) ? mapGraphqlPullRequest(prNode) : null,
          )
        }
      }
      for (const url of aliasToUrl.values()) {
        if (!statuses.has(url)) statuses.set(url, null)
      }
    },
  )
  return { statuses, rateLimit, unbatched }
}

/** densable lJt */
export const restListSchema = lazySchema(() =>
  z.array(
    z.object({
      number: z.number(),
      html_url: z.string(),
      draft: z.boolean(),
    }),
  ),
)

/**
 * densable uJt headers — `...g.etag&&{"If-None-Match":g.etag}`.
 */
export function restListConditionalHeaders(
  etag: string | null,
): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_PR_API_VERSION,
    ...(etag && { 'If-None-Match': etag }),
  }
}

/**
 * densable uJt 304 arm:
 * `if(N=Te.status,Te.status===304);else if(Te.ok){g.etag=...}else fetch-failed`
 * 304 is empty-ok (do not parse body; keep etag/pr).
 */
export async function applyRestListResponse(
  state: DirectState,
  resp: RestListResponse,
): Promise<'not-modified' | 'updated' | 'fetch-failed'> {
  if (resp.status === 304) return 'not-modified'
  if (resp.ok) {
    state.etag = resp.headers.get('etag')
    const parsed = restListSchema().safeParse(await resp.json())
    const item = parsed.success ? parsed.data[0] : undefined
    if (item && state.pr?.number !== item.number) state.reviewDecision = ''
    state.pr = item
      ? { number: item.number, url: item.html_url, isDraft: item.draft }
      : null
    return 'updated'
  }
  return 'fetch-failed'
}

/**
 * densable uJt `fe` — same number/url/draft/review → `{notModified:!0}`.
 */
export function buildDirectPrStatus(
  prev: (DirectPr & { reviewDecision: string }) | null | undefined,
  current: DirectPr,
  reviewDecision: string,
  reviewFailed: boolean,
): DirectPrStatus {
  const unchanged =
    !reviewFailed &&
    prev?.number === current.number &&
    prev.url === current.url &&
    prev.isDraft === current.isDraft &&
    prev.reviewDecision === reviewDecision
  const status: PrStatus = {
    number: current.number,
    url: current.url,
    reviewState: deriveReviewState(current.isDraft, reviewDecision),
  }
  if (unchanged) return { ...status, notModified: true }
  return status
}

/**
 * densable dXe — shared poller state. 248-new: pollerNotModifiedStreak,
 * bump.emit resets streak, prStatusByUrl=A$(_Jt,30000).
 */
export class PrStatusShared {
  #inner: Signal = createSignal()
  bump: Signal
  pollerDisabled = false
  pollerBadStreak = 0
  pollerNotModifiedStreak = 0
  directState: DirectState | null = null
  prStatusByUrl = createAsyncTtlCache(
    fetchPrStatusByUrl,
    PR_STATUS_BY_URL_TTL_MS,
  )
  /** densable dXe.lastPersistedCacheBody — q$n / JE() persist dedup. */
  lastPersistedCacheBody = ''
  /** densable dXe.ghBackoffUntil — V$n `KX()`. */
  ghBackoffUntil = 0

  constructor() {
    const inner = this.#inner
    this.bump = {
      ...inner,
      emit: () => {
        this.pollerNotModifiedStreak = 0
        inner.emit()
      },
    }
  }

  directStateForBranch(branch: string): DirectState {
    if (this.directState?.branch !== branch) {
      this.directState = {
        branch,
        etag: null,
        pr: null,
        reviewDecision: '',
        lastReviewFetchAt: 0,
        redirectedListUrl: null,
      }
    }
    return this.directState
  }

  /**
   * densable dXe.notePersistedCacheBody
   * `if(e===this.lastPersistedCacheBody)return!1;return this.lastPersistedCacheBody=e,!0`
   */
  notePersistedCacheBody(body: string): boolean {
    if (body === this.lastPersistedCacheBody) return false
    this.lastPersistedCacheBody = body
    return true
  }

  /** densable dXe.backOffUntil */
  backOffUntil(until: number): void {
    this.ghBackoffUntil = until
  }

  reset(): void {
    this.pollerDisabled = false
    this.pollerBadStreak = 0
    this.pollerNotModifiedStreak = 0
    this.directState = null
    this.lastPersistedCacheBody = ''
    this.ghBackoffUntil = 0
    this.prStatusByUrl.cache.clear()
  }
}

/**
 * densable wY #T streak update:
 * `x.pollerNotModifiedStreak=Re?x.pollerNotModifiedStreak+1:0`
 */
export function applyPollerFetchResult(
  shared: PrStatusShared,
  result: PollerFetchResult,
): {
  pr: PrStatus | null
  needsAuth: false | 'needs-auth' | 'gh-missing'
  notModified: boolean
} {
  const needsAuth =
    result === 'needs-auth' || result === 'gh-missing' ? result : false
  const failed = result === 'fetch-failed'
  let pr: PrStatus | null = null
  let notModified = false
  if (
    result !== null &&
    result !== 'needs-auth' &&
    result !== 'gh-missing' &&
    result !== 'fetch-failed'
  ) {
    const { notModified: flag = false, ...rest } = result
    notModified = flag === true
    pr = rest
  }
  shared.pollerBadStreak = failed ? shared.pollerBadStreak + 1 : 0
  shared.pollerNotModifiedStreak = notModified
    ? shared.pollerNotModifiedStreak + 1
    : 0
  return { pr, needsAuth, notModified }
}

/**
 * densable y5e(d,C,x,H) — 248 adds 4th arg H = pollerNotModifiedStreak.
 * `ee=H<=0?90000:H===1?120000:H===2?240000:300000`
 */
export function prStatusPollIntervalMs(
  focused: boolean,
  idleMs: number,
  emptyStreak: number,
  notModifiedStreak: number,
): number {
  const idle =
    idleMs < 30_000
      ? 90_000
      : idleMs < 300_000
        ? 180_000
        : idleMs < 1_800_000
          ? 600_000
          : 1_800_000
  const empty =
    emptyStreak <= 0
      ? 90_000
      : emptyStreak === 1
        ? 300_000
        : emptyStreak === 2
          ? 900_000
          : 1_800_000
  const unchanged =
    notModifiedStreak <= 0
      ? 90_000
      : notModifiedStreak === 1
        ? 120_000
        : notModifiedStreak === 2
          ? 240_000
          : 300_000
  return Math.max(
    idle,
    empty,
    unchanged,
    focused ? 0 : PR_STATUS_UNFOCUSED_MIN_MS,
  )
}

export function createPrStatusShared(): PrStatusShared {
  return new PrStatusShared()
}

let shared: PrStatusShared | undefined

export function getPrStatusShared(): PrStatusShared {
  if (!shared) shared = new PrStatusShared()
  return shared
}

/**
 * densable Wen — `R("tengu_harbor_prism",!1)`.
 */
export function isDirectApiEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_prism', false)
}

function isGithubLikeHost(host: string): boolean {
  const t = host.toLowerCase()
  if (t === 'github.com' || t.endsWith('.github.com')) return true
  const ghHost = process.env.GH_HOST
  return Boolean(ghHost && t === ghHost.toLowerCase())
}

/**
 * densable uJt — REST list + 304 empty-ok. Called from eDt when Wen().
 */
export async function fetchDirectPrStatus(
  branch: string,
): Promise<PollerFetchResult> {
  if (isEssentialTrafficOnly()) return null
  if (branch === 'main' || branch === 'master') return null
  const remote = await getRemoteUrl()
  const parsed = remote ? parseGitRemote(remote) : null
  if (!parsed) return null
  const token = await resolveGithubAuthToken(parsed.host)
  if (!token) {
    if (!isGithubLikeHost(parsed.host)) return null
    return whichSync('gh') === null ? 'gh-missing' : 'needs-auth'
  }
  const poller = getPrStatusShared()
  const state = poller.directStateForBranch(branch)
  const prev = state.pr
    ? { ...state.pr, reviewDecision: state.reviewDecision }
    : null
  const apiBase = githubRestApiBase(parsed.host)
  const origin = new URL(apiBase).origin
  const listUrl = `${apiBase}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}/pulls?head=${encodeURIComponent(parsed.owner)}:${encodeURIComponent(branch)}&state=open&per_page=1`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'User-Agent': getUserAgent(),
    ...restListConditionalHeaders(state.etag),
  }
  try {
    const getList = (href: string): Promise<Response> =>
      fetch(href, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(GH_TIMEOUT_MS),
      })
    let resp = await getList(state.redirectedListUrl ?? listUrl)
    const location = REST_REDIRECT_STATUSES.has(resp.status)
      ? resp.headers.get('location')
      : null
    const redirected = location ? new URL(location, listUrl) : null
    if (redirected?.origin === origin) {
      state.redirectedListUrl = redirected.href
      resp = await getList(redirected.href)
    }
    const applied = await applyRestListResponse(state, {
      status: resp.status,
      ok: resp.ok,
      headers: { get: name => resp.headers.get(name) },
      json: () => resp.json(),
    })
    if (applied === 'fetch-failed') return 'fetch-failed'
  } catch (err) {
    logForDebugging(String(err), { level: 'error' })
    return 'fetch-failed'
  }
  if (!state.pr) return null
  return buildDirectPrStatus(prev, state.pr, state.reviewDecision, false)
}

/**
 * densable eDt — `Wen()?uJt(r):sJt(o) ?? tXe(e)`.
 */
export async function fetchPrStatusForPoller(): Promise<PollerFetchResult> {
  if (!(await getIsGit())) return null
  const [branch, defaultBranch] = await Promise.all([
    getBranch(),
    getDefaultBranch(),
  ])
  if (branch === defaultBranch) return null
  const primary = isDirectApiEnabled()
    ? await fetchDirectPrStatus(branch)
    : await fetchGithubPrStatus(defaultBranch)
  return primary ?? (await fetchGitlabMrStatus())
}

export type PrStatusSnapshot = {
  pr: PrStatus | null
  needsAuth: false | 'needs-auth' | 'gh-missing'
  lastUpdated: number
}

const EMPTY_SNAPSHOT: PrStatusSnapshot = {
  pr: null,
  needsAuth: false,
  lastUpdated: 0,
}

export type PrStatusPollerDeps = {
  setTimeout: (fn: () => void, ms: number) => () => void
  now: () => number
  getLastInteractionTime: () => number
  fetchPrStatus: () => Promise<PollerFetchResult>
  isDirectApiEnabled: () => boolean
  shared: PrStatusShared
}

export type PrStatusPollerInputs = {
  isLoading: boolean
  enabled: boolean
  focused: boolean
}

/**
 * densable wY @203020715 — footer poller. 248: y5e 4th arg + notModified streak.
 */
export class PrStatusPoller {
  #e: PrStatusPollerDeps
  #t: PrStatusPollerInputs
  #o: PrStatusSnapshot = EMPTY_SNAPSHOT
  #s: Signal = createSignal()
  #n = 0
  #r = false
  #l: (() => void) | null = null
  #a = 0
  #i = false
  #m: (() => void) | null = null
  #d = 0
  #u = 0
  #p = -1
  #c = 0

  constructor(deps: PrStatusPollerDeps, inputs: PrStatusPollerInputs) {
    this.#e = deps
    this.#t = inputs
  }

  getSnapshot = (): PrStatusSnapshot => this.#o

  subscribe = (listener: () => void): (() => void) => {
    const unsub = this.#s.subscribe(listener)
    this.#n++
    if (!this.#r) this.#g()
    let dead = false
    return () => {
      if (dead) return
      dead = true
      unsub()
      this.#n--
      if (this.#n === 0) this.#f()
    }
  }

  setInputs(next: PrStatusPollerInputs): void {
    const prev = this.#t
    this.#t = next
    if (!this.#r) return
    if (next.enabled && !prev.enabled) {
      this.#u = 0
      this.#e.shared.pollerNotModifiedStreak = 0
    }
    if (
      (next.focused !== prev.focused && this.#b()) ||
      next.isLoading !== prev.isLoading ||
      next.enabled !== prev.enabled
    ) {
      this.#h()
    }
  }

  #g(): void {
    this.#r = true
    this.#i = false
    this.#l = this.#e.shared.bump.subscribe(() => {
      if (this.#e.shared.pollerDisabled) return
      this.#u = 0
      this.#d = 0
      this.#h()
    })
    this.#y()
  }

  #f(): void {
    this.#r = false
    this.#i = false
    this.#l?.()
    this.#l = null
    this.#k()
  }

  #h(): void {
    if (this.#i) return
    this.#i = true
    queueMicrotask(() => {
      if (!this.#i) return
      this.#i = false
      this.#y()
    })
  }

  /** densable #b — p5e/Wut sibling; only when Wen(). */
  #b(): boolean {
    if (!this.#e.isDirectApiEnabled()) return false
    if (!this.#t.focused || this.#e.shared.pollerDisabled) return false
    if (this.#d === 0) return false
    this.#e.shared.pollerNotModifiedStreak = 0
    if (this.#e.now() - this.#d >= PR_STATUS_FOCUS_RECHECK_MS) {
      this.#u = 0
      this.#d = 0
    }
    return true
  }

  #k(): void {
    this.#a++
    if (this.#m) {
      this.#m()
      this.#m = null
    }
  }

  #y(): void {
    this.#k()
    if (!this.#t.enabled) return
    if (this.#e.shared.pollerDisabled) return
    const gen = this.#a
    this.#p = -1
    this.#c = this.#e.now()
    const interval = this.#S(true)
    const elapsed = this.#e.now() - this.#d
    if (elapsed >= interval) this.#w(gen)
    else this.#C(gen, interval - elapsed)
  }

  #C(gen: number, waitMs: number): void {
    this.#m = this.#e.setTimeout(() => {
      this.#m = null
      this.#w(gen)
    }, waitMs)
  }

  #w(gen: number): void {
    void this.#T(gen).catch(err => {
      logForDebugging(String(err), { level: 'error' })
    })
  }

  /** densable #S — a5e when !Wen, else y5e(..., H). */
  #S(fresh: boolean): number {
    if (!this.#e.isDirectApiEnabled()) return PR_STATUS_CLI_INTERVAL_MS
    return prStatusPollIntervalMs(
      this.#t.focused,
      this.#e.now() - this.#e.getLastInteractionTime(),
      fresh ? 0 : this.#u,
      this.#e.shared.pollerNotModifiedStreak,
    )
  }

  async #T(gen: number): Promise<void> {
    if (gen !== this.#a) return
    const { now, shared } = this.#e
    const interaction = this.#e.getLastInteractionTime()
    if (this.#p !== interaction) {
      this.#p = interaction
      this.#c = now()
    } else if (now() - this.#c >= PR_STATUS_IDLE_STOP_MS) {
      return
    }
    const started = now()
    let result: PollerFetchResult
    try {
      result = await this.#e.fetchPrStatus()
    } catch (err) {
      logForDebugging(String(err), { level: 'error' })
      result = null
    }
    if (gen !== this.#a) return
    this.#d = started
    const applied = applyPollerFetchResult(shared, result)
    this.#u = applied.needsAuth ? 1 : applied.pr === null ? this.#u + 1 : 0
    this.#_(applied.pr, applied.needsAuth)
    if (shared.pollerBadStreak >= PR_STATUS_BAD_STREAK_DISABLE) {
      shared.pollerDisabled = true
      return
    }
    const elapsed = now() - started
    if (elapsed > PR_STATUS_SLOW_MS) {
      shared.pollerDisabled = true
      return
    }
    this.#C(gen, this.#S(false))
  }

  #_(
    pr: PrStatus | null,
    needsAuth: false | 'needs-auth' | 'gh-missing',
  ): void {
    const prev = this.#o
    if (
      prev.lastUpdated > 0 &&
      prev.pr?.number === pr?.number &&
      prev.pr?.url === pr?.url &&
      prev.pr?.reviewState === pr?.reviewState &&
      prev.pr?.kind === pr?.kind &&
      prev.needsAuth === needsAuth
    ) {
      return
    }
    this.#o = { pr, needsAuth, lastUpdated: this.#e.now() }
    try {
      this.#s.emit()
    } catch (err) {
      logForDebugging(String(err), { level: 'error' })
    }
  }
}
