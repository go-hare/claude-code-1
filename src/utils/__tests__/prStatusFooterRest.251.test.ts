/**
 * densable 2.1.251 #63 — n$t always REST ign ?? glab.
 * ign: Accept + API-version, 304/etag, same-origin redirect, agn review,
 * tengu events. Harbor prism stays the official poll-interval / focus gate.
 * gh pr view stays on the URL cache. No new GitHub token.
 *
 * GOLD: gold-251-l.md / gold-251-f.md ign @185402726 sha=5a676d2f3cc48c37
 * agn @185405349. f=_bad g=_sad _=_ok. logAuthState tengu_gh_pr_status_auth_state.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createPrStatusShared,
  githubGraphqlApi,
  GITHUB_PR_API_VERSION,
  isDirectApiEnabled,
  PR_STATUS_REVIEW_TTL_MS,
  restListConditionalHeaders,
  restReviewSchema,
  REVIEW_DECISION_QUERY,
  telemetryErrorName,
} from '../prStatusPoller.js'

const pollerSrc = readFileSync(
  join(import.meta.dir, '../prStatusPoller.ts'),
  'utf8',
)

describe('footer PR REST fetch (2.1.251 #63)', () => {
  test('n$t always calls ign then glab; ign skips essential-traffic and backoff', () => {
    const ignStart = pollerSrc.indexOf(
      'export async function fetchDirectPrStatus',
    )
    const nStart = pollerSrc.indexOf(
      'export async function fetchPrStatusForPoller',
    )
    const nEnd = pollerSrc.indexOf('export type PrStatusSnapshot')
    const ign = pollerSrc.slice(ignStart, nStart)
    const nDollar = pollerSrc.slice(nStart, nEnd)
    expect(ign).toContain('isEssentialTrafficOnly() || isGhPrBatchInBackoff()')
    expect(ign).not.toContain('isTelemetryDisabled()')
    expect(nDollar).toContain('fetchDirectPrStatus(branch)')
    expect(nDollar).toContain('fetchGitlabMrStatus()')
    expect(nDollar).not.toContain('fetchGithubPrStatus(')
    expect(nDollar).not.toContain('isDirectApiEnabled()')
    expect(pollerSrc).toContain("tengu_harbor_prism', false")
    expect(isDirectApiEnabled()).toBe(false)
  })

  test('ign list headers are Accept + API-version + optional If-None-Match', () => {
    expect(GITHUB_PR_API_VERSION).toBe('2022-11-28')
    expect(restListConditionalHeaders(null)).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    expect(restListConditionalHeaders('W/"v1"')).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'If-None-Match': 'W/"v1"',
    })
    const ignStart = pollerSrc.indexOf(
      'export async function fetchDirectPrStatus',
    )
    const nStart = pollerSrc.indexOf(
      'export async function fetchPrStatusForPoller',
    )
    const ign = pollerSrc.slice(ignStart, nStart)
    expect(ign).toContain('restListConditionalHeaders(state.etag)')
    expect(ign).toContain("redirect: 'manual'")
    expect(ign).toContain('redirected?.origin === origin')
    expect(ign).toContain('applyRestListResponse')
  })

  test('gh pr view stays on the URL cache, not the footer branch fetch', () => {
    const byUrlStart = pollerSrc.indexOf(
      'export async function fetchPrStatusByUrl',
    )
    const ignStart = pollerSrc.indexOf(
      'export async function fetchDirectPrStatus',
    )
    const byUrl = pollerSrc.slice(byUrlStart, ignStart)
    const ign = pollerSrc.slice(
      ignStart,
      pollerSrc.indexOf('export async function fetchPrStatusForPoller'),
    )
    expect(byUrl).toContain("'pr'")
    expect(byUrl).toContain("'view'")
    expect(ign).not.toContain("'pr'")
    expect(ign).not.toContain('fetchGithubPrStatus(')
    expect(pollerSrc).toContain('resolveGithubAuthToken')
    expect(pollerSrc).not.toContain('GH_ENTERPRISE_TOKEN')
  })
})

describe('densable 2.1.251 #63 agn review fetch', () => {
  test('ngn review TTL is 300000; lsr github.com vs GHE', () => {
    expect(PR_STATUS_REVIEW_TTL_MS).toBe(300_000)
    expect(githubGraphqlApi('github.com')).toBe(
      'https://api.github.com/graphql',
    )
    expect(githubGraphqlApi('www.github.com')).toBe(
      'https://api.github.com/graphql',
    )
    expect(githubGraphqlApi('ghe.example.com')).toBe(
      'https://ghe.example.com/api/graphql',
    )
  })

  test('sgn parses nullable reviewDecision', () => {
    expect(
      restReviewSchema().safeParse({
        data: {
          repository: {
            pullRequest: { reviewDecision: 'APPROVED' },
          },
        },
      }).success,
    ).toBe(true)
    expect(
      restReviewSchema().safeParse({
        data: { repository: { pullRequest: { reviewDecision: null } } },
      }).success,
    ).toBe(true)
    expect(restReviewSchema().safeParse({ data: {} }).success).toBe(false)
  })

  test('agn POSTs locked query; empty reviewDecision is ok, !ok/throw is null', () => {
    const agn = pollerSrc.slice(
      pollerSrc.indexOf('export async function fetchDirectReviewDecision'),
      pollerSrc.indexOf('export function restListConditionalHeaders'),
    )
    expect(REVIEW_DECISION_QUERY).toBe(
      'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewDecision}}}',
    )
    expect(agn).toContain('githubGraphqlApi(repo.host)')
    expect(agn).toContain("method: 'POST'")
    expect(agn).toContain("redirect: 'error'")
    expect(agn).toContain('keepalive: false')
    expect(agn).toContain('Authorization: `Bearer ${token}`')
    expect(agn).toContain("'Content-Type': 'application/json'")
    expect(agn).toContain("'User-Agent': getUserAgent()")
    expect(agn).not.toContain('Accept')
    expect(agn).toContain('REVIEW_DECISION_QUERY')
    expect(agn).toContain(
      'variables: { o: repo.owner, r: repo.repo, n: number }',
    )
    expect(agn).toContain('restReviewSchema()')
    expect(agn).toContain(
      "parsed.data.data.repository?.pullRequest?.reviewDecision ?? ''",
    )
    expect(agn).toContain('if (!resp.ok) return null')
    expect(agn).toContain('} catch {')
    expect(agn).toContain('return null')
  })

  test('ign wires lastReviewFetchAt + agn after list 304/update', () => {
    const ign = pollerSrc.slice(
      pollerSrc.indexOf('export async function fetchDirectPrStatus'),
      pollerSrc.indexOf('export async function fetchPrStatusForPoller'),
    )
    expect(ign).toContain('fetchDirectReviewDecision')
    expect(ign).toContain('PR_STATUS_REVIEW_TTL_MS')
    expect(ign).toContain('state.lastReviewFetchAt')
    expect(ign).toContain('buildDirectPrStatus')
  })
})

describe('densable 2.1.251 #63 tengu events', () => {
  test('logAuthState dedups; reset clears it', () => {
    const shared = createPrStatusShared()
    shared.logAuthState('token_present')
    expect(shared.lastLoggedGhAuthState).toBe('token_present')
    shared.logAuthState('token_present')
    expect(shared.lastLoggedGhAuthState).toBe('token_present')
    shared.logAuthState('needs_auth')
    expect(shared.lastLoggedGhAuthState).toBe('needs_auth')
    shared.reset()
    expect(shared.lastLoggedGhAuthState).toBeNull()
  })

  test('backOffFromResponse uses retry-after, else reset epoch, else 60s', () => {
    const shared = createPrStatusShared()
    const now = Date.now()
    shared.backOffFromResponse({
      headers: {
        get: name => (name === 'retry-after' ? '2' : null),
      },
    })
    expect(shared.ghBackoffUntil).toBeGreaterThanOrEqual(now + 2000)
    expect(shared.ghBackoffUntil).toBeLessThan(now + 4000)

    shared.backOffFromResponse({
      headers: {
        get: name => (name === 'x-ratelimit-reset' ? '1700000000' : null),
      },
    })
    expect(shared.ghBackoffUntil).toBe(1_700_000_000_000)

    const before = Date.now()
    shared.backOffFromResponse({ headers: { get: () => null } })
    expect(shared.ghBackoffUntil).toBeGreaterThanOrEqual(before + 60_000)
  })

  test('ign emits gold f/g/_ + auth_state event names', () => {
    const ign = pollerSrc.slice(
      pollerSrc.indexOf('export async function fetchDirectPrStatus'),
      pollerSrc.indexOf('export async function fetchPrStatusForPoller'),
    )
    expect(ign).toContain("logEvent('tengu_feature_bad'")
    expect(ign).toContain("logEvent('tengu_feature_sad'")
    expect(ign).toContain("logEvent('tengu_feature_ok'")
    expect(ign).toContain("'unauthorized'")
    expect(ign).toContain("'rate_limited'")
    expect(ign).toContain("'http_error'")
    expect(ign).toContain("'fetch_threw'")
    expect(ign).toContain("'review_decision_unavailable'")
    expect(pollerSrc).toContain("logEvent('tengu_gh_pr_status_auth_state'")
    expect(ign).toContain("logAuthState('token_present')")
    expect(ign).toContain("'gh_missing'")
    expect(ign).toContain("'needs_auth'")
  })

  test('lI telemetryErrorName keeps Error names and falls back', () => {
    expect(telemetryErrorName(new TypeError('x'))).toBe('TypeError')
    expect(telemetryErrorName(new Error('x'))).toBe('Error')
    expect(telemetryErrorName({ name: 'not-an-error' })).toBe('unknown')
    expect(telemetryErrorName(null)).toBe('unknown')
  })
})
