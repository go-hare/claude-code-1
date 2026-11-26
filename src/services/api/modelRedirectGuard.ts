/**
 * Official Claude Code 2.1.331 outbound model API security hardening:
 * 1. Redirect refusal (`qo`, `jc`, `xp`, `MUo`, `sVl`, `DUr`, `RedirectRefused`,
 *    `CLAUDE_CODE_DISABLE_REDIRECT_CHECK`, killswitch `tengu_nifty_chipmunk`).
 * 2. Response compression policy (`CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION`,
 *    gate `tengu_velvety_duckling`, `accept-encoding: identity`).
 */

import { AsyncLocalStorage } from 'async_hooks'
import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  getFeatureValueWithSource,
} from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  isBareMode,
  isEnvDefinedFalsy,
  isEnvTruthy,
} from 'src/utils/envUtils.js'
import { getNoProxy, getProxyUrl, shouldBypassProxy } from 'src/utils/proxy.js'

/** Official `vr`: Anthropic first-party API hostnames subject to redirect check. */
const ANTHROPIC_API_HOST_RE = /^api(-staging)?\.anthropic\.com$/i

/** Official `$y`: HTTP redirect status codes inspected by `jc`. */
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])

/** Official `R === 5` max safe same-origin 307/308 redirect hops. */
export const MAX_SAFE_REDIRECT_HOPS = 5

/** Official killswitch flag for model API redirect refusal (safe default: true). */
export const REDIRECT_CHECK_KILLSWITCH_FLAG = 'tengu_nifty_chipmunk'

/** Official GrowthBook gate for disabling HTTPS proxy response compression. */
export const RESPONSE_COMPRESSION_DISABLE_FLAG = 'tengu_velvety_duckling'

export type RedirectRefusedError = Error & { code: 'RedirectRefused' }

export type ModelRedirectTrackingState = {
  modelCallRefused?: boolean
}

const redirectTrackingAls = new AsyncLocalStorage<ModelRedirectTrackingState>()
const countedRedirects = new Set<string>()

/** Official `oVl`: run callback under ALS tracking whether any model call redirect was refused. */
export function runWithModelRedirectTracking<T>(
  fn: () => T,
  state: ModelRedirectTrackingState = {},
): T {
  return redirectTrackingAls.run(state, fn)
}

/** Official `sVl`: mark current ALS scope as having experienced a refused model redirect. */
export function noteModelCallRefused(): void {
  const store = redirectTrackingAls.getStore()
  if (store !== undefined) {
    store.modelCallRefused = true
  }
}

export function getModelRedirectTrackingState():
  | ModelRedirectTrackingState
  | undefined {
  return redirectTrackingAls.getStore()
}

export function resetApiRedirectCountsForTests(): void {
  countedRedirects.clear()
}

/** Official `DUr(e)`: true when URL hostname is `api.anthropic.com` or `api-staging.anthropic.com`. */
export function isAnthropicApiHost(url: string): boolean {
  const normalized = url.startsWith('//') ? `https:${url}` : url
  let hostname: string
  try {
    hostname = new URL(normalized).hostname
  } catch {
    hostname = url.match(/^[^/:]+/)?.[0] ?? url
  }
  const stripped = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
  return ANTHROPIC_API_HOST_RE.test(stripped)
}

/** Official `sG`: true when two URLs share a non-opaque origin. */
function isSameOrigin(a: string, b: string): boolean {
  try {
    const originA = new URL(a).origin
    const originB = new URL(b).origin
    return originA !== 'null' && originA === originB
  } catch {
    return false
  }
}

/** Official `MUo(kind, requestUrl, target)`: emit deduplicated `api_redirect` telemetry for Anthropic hosts. */
export function recordApiRedirect(
  kind: string,
  requestUrl: string,
  target?: { href?: string },
): void {
  try {
    const isSettings =
      new URL(requestUrl).pathname === '/api/claude_code/settings'
    const originLabel =
      target?.href !== undefined
        ? isSameOrigin(requestUrl, target.href)
          ? 'same'
          : 'other'
        : 'unknown'
    const bucket = `${isSettings ? 'settings_request' : kind}_${originLabel}_origin`
    if (isAnthropicApiHost(requestUrl) && !countedRedirects.has(bucket)) {
      countedRedirects.add(bucket)
      logEvent('tengu_api_redirect', {
        bucket:
          bucket as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  } catch {
    // never let telemetry break network calls
  }
}

/** Official `Object.assign(Error("Claude Code refused a redirect of this request"), { code: "RedirectRefused" })`. */
export function createRedirectRefusedError(): RedirectRefusedError {
  return Object.assign(
    new Error('Claude Code refused a redirect of this request'),
    { code: 'RedirectRefused' as const },
  )
}

export function isRedirectRefusedError(
  err: unknown,
): err is RedirectRefusedError {
  return (
    err instanceof Error &&
    (err as { code?: unknown }).code === 'RedirectRefused'
  )
}

/** Walk error + cause chain looking for a matching predicate (official `BL`). */
function findInErrorChain(
  error: unknown,
  predicate: (err: Error) => boolean,
  maxDepth = 10,
): Error | undefined {
  let current: unknown = error
  for (let i = 0; i < maxDepth; i++) {
    if (!(current instanceof Error)) return undefined
    if (predicate(current)) return current
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

/** True when `fetch(..., { redirect: 'error' })` failed due to an unexpected HTTP redirect. */
export function isUnexpectedRedirectError(error: unknown): boolean {
  if (
    error !== null &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'UnexpectedRedirect'
  ) {
    return true
  }
  return (
    findInErrorChain(
      error,
      err =>
        (err as { code?: unknown }).code === 'UnexpectedRedirect' ||
        err.message === 'unexpected redirect',
    ) !== undefined
  )
}

/**
 * Official `Se('tengu_nifty_chipmunk', { safe: true })`:
 * Defaults to `true` unless a live GrowthBook `payload` explicitly switches it off.
 */
export function isRedirectCheckEnabled(opts?: {
  env?: NodeJS.ProcessEnv
  killswitchValue?: boolean
}): boolean {
  const env = opts?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_REDIRECT_CHECK)) {
    return false
  }
  if (opts?.killswitchValue !== undefined) {
    return opts.killswitchValue
  }
  try {
    const { value, source } = getFeatureValueWithSource<boolean>(
      REDIRECT_CHECK_KILLSWITCH_FLAG,
      true,
    )
    return value === false && source === 'payload' ? false : true
  } catch {
    return true
  }
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

/** Official `vMe(e, n)`: extract normalized HTTP method and URL string from fetch arguments. */
export function extractFetchMethodAndUrl(
  input: RequestInfo | URL,
  init?: RequestInit,
): { method: string; url: string } {
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  if (input instanceof Request) {
    return {
      method: (init?.method ?? input.method).toUpperCase(),
      url: input.url,
    }
  }
  return {
    method: (init?.method ?? 'GET').toUpperCase(),
    url: String(input),
  }
}

type ManualRedirectInspectionResult = {
  answer?: Response
  followed?: boolean
  to?: string
  fault?: { thrown: unknown }
}

/**
 * Official `jc(e, n, r, h)`:
 * Replays a POST with `redirect: 'manual'` and `keepalive: false`, following
 * ONLY same-origin `307`/`308` redirects up to `MAX_SAFE_REDIRECT_HOPS` (5).
 * Refuses `301`/`302`/`303`, cross-origin or protocol-downgrade redirects,
 * missing/unparseable `Location`, >5 hops, and non-replayable bodies/Requests.
 */
export async function inspectAndFollowModelRedirects(
  dispatch: FetchLike,
  input: RequestInfo | URL,
  url: string,
  init: RequestInit | undefined,
): Promise<ManualRedirectInspectionResult> {
  const body = init?.body ?? ''
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  if (
    input instanceof Request ||
    !(typeof body === 'string' || ArrayBuffer.isView(body))
  ) {
    return {}
  }
  let current = new URL(url)
  for (let hop = 0; ; hop++) {
    let response: Response
    try {
      response = await dispatch(current.href, {
        ...init,
        redirect: 'manual',
        keepalive: false,
      })
    } catch (err) {
      if (hop > 0) throw err
      return { fault: { thrown: err } }
    }
    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return { answer: response, followed: hop > 0 }
    }
    response.body?.cancel().catch(() => {})
    const location = response.headers.get('location')
    const nextUrl = location ? URL.parse(location, current) : null
    if (nextUrl === null) {
      return {}
    }
    if (
      (response.status !== 307 && response.status !== 308) ||
      nextUrl.protocol !== current.protocol ||
      nextUrl.host !== current.host ||
      hop === MAX_SAFE_REDIRECT_HOPS
    ) {
      return { to: nextUrl.href }
    }
    nextUrl.username = current.username
    nextUrl.password = current.password
    current = nextUrl
  }
}

function recordFollowedModelRedirect(
  requestUrl: string,
  response: Response,
): void {
  try {
    const requestId = response.headers.get('request-id')
    const hasAnthropicReqId =
      typeof requestId === 'string' && requestId.startsWith('req_')
    const kind = response.ok ? 'model_call_worked' : 'model_call_api_error'
    recordApiRedirect(
      hasAnthropicReqId ? kind : 'model_call_failed',
      requestUrl,
      {
        href: response.url,
      },
    )
  } catch {
    // ignore telemetry errors
  }
}

/**
 * Official `qo(e, n)` redirect guard wrapper:
 * Refuses unexpected redirects on POST requests to `api(-staging)?.anthropic.com`
 * unless `CLAUDE_CODE_DISABLE_REDIRECT_CHECK` is truthy or the killswitch is off.
 */
export function wrapFetchWithModelRedirectGuard(
  baseFetch: FetchLike,
  opts?: {
    env?: NodeJS.ProcessEnv
    killswitchValue?: boolean
  },
): FetchLike {
  const guardedFetch: FetchLike = async (input, init) => {
    const { method, url } = extractFetchMethodAndUrl(input, init)
    if (
      method === 'POST' &&
      init?.redirect === undefined &&
      isAnthropicApiHost(url) &&
      isRedirectCheckEnabled(opts)
    ) {
      try {
        return await guardedFetch(input, { ...init, redirect: 'error' })
      } catch (err) {
        if (!isUnexpectedRedirectError(err)) {
          throw err
        }
        const { answer, followed, to, fault } =
          await inspectAndFollowModelRedirects(guardedFetch, input, url, init)
        if (answer !== undefined && followed) {
          recordFollowedModelRedirect(url, answer)
          return answer
        }
        if (answer !== undefined) {
          recordApiRedirect('model_call_refused', url)
          return answer
        }
        noteModelCallRefused()
        recordApiRedirect(
          'model_call_refused',
          url,
          to === undefined ? undefined : { href: to },
        )
        if (fault !== undefined) {
          throw fault.thrown
        }
        throw createRedirectRefusedError()
      }
    }

    const response = await baseFetch(input, init)
    if (response.redirected) {
      recordFollowedModelRedirect(url, response)
    }
    return response
  }
  return guardedFetch
}

/** Official `L.triBool()` parser: true / false / undefined (unset or invalid). */
export function parseTriBoolEnv(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  if (isEnvTruthy(raw)) return true
  if (isEnvDefinedFalsy(raw)) return false
  return undefined
}

/** Official `Sfe()`: true when any HTTP(S)/ALL proxy env var is configured. */
export function hasAnyProxyConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(getProxyUrl(env) || env.ALL_PROXY || env.all_proxy)
}

/** Official `JJ()`: true in Anthropic-hosted remote cloud sessions (not BYOC/bridge). */
function isRemoteAnthropicCloudSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const kind = env.CLAUDE_CODE_ENVIRONMENT_KIND ?? ''
  return (
    isEnvTruthy(env.CLAUDE_CODE_REMOTE) && kind !== 'byoc' && kind !== 'bridge'
  )
}

/**
 * Official 2.1.331 response-compression disable check (`28_response_compression.js`):
 * Returns `true` when Claude Code should set `accept-encoding: identity` on an
 * outbound HTTPS model API request going through a proxy.
 */
export function shouldDisableResponseCompression(opts: {
  url: string
  headers: Headers
  unix?: string
  provider: string
  env?: NodeJS.ProcessEnv
  isDiskless?: boolean
  gbValue?: boolean
}): boolean {
  const env = opts.env ?? process.env
  if (opts.headers.has('accept-encoding')) return false
  if (!/^https:/i.test(opts.url)) return false
  if (opts.unix !== undefined) return false
  if (!hasAnyProxyConfigured(env)) return false
  if (shouldBypassProxy(opts.url, getNoProxy(env))) return false

  const explicit = parseTriBoolEnv(env.CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION)
  if (explicit !== undefined) {
    return explicit
  }

  const isDiskless = opts.isDiskless ?? isBareMode()
  const gateOn =
    opts.gbValue !== undefined
      ? opts.gbValue
      : getFeatureValue_CACHED_MAY_BE_STALE(
          RESPONSE_COMPRESSION_DISABLE_FLAG,
          false,
        ) === true
  return (
    opts.provider === 'firstParty' &&
    !isRemoteAnthropicCloudSession(env) &&
    !isDiskless &&
    gateOn
  )
}

/**
 * Apply `accept-encoding: identity` to `headers` when
 * `shouldDisableResponseCompression` returns true.
 */
export function applyResponseCompressionPolicy(
  url: string,
  headers: Headers,
  opts: {
    unix?: string
    provider: string
    env?: NodeJS.ProcessEnv
    isDiskless?: boolean
    gbValue?: boolean
  },
): boolean {
  if (shouldDisableResponseCompression({ url, headers, ...opts })) {
    headers.set('accept-encoding', 'identity')
    return true
  }
  return false
}
