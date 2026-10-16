/**
 * densable 2.1.289 Artifact quickstart Ace / bt / yjn analog.
 * Semantic names only — do not export minify Ace/bt/yjn/he/Qps/tl/bu/ZKe/gjn/Te/ne.
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { DL } from 'src/services/artifactAutoReact/frameDl.js'
import { frameControlPlaneHeaders } from 'src/services/artifactAutoReact/mint.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import { isEnvDefinedFalsy, isEnvTruthy } from 'src/utils/envUtils.js'
import { sleep } from 'src/utils/sleep.js'

const CATALOG_MAX_BYTES = 4_194_304
const CATALOG_TIMEOUT_MS = 15_000

const OVERSIZE_ERR =
  'the Artifact type listing could not be read (the response was larger than this client accepts)'
const NETWORK_ERR =
  'the Artifact type listing could not be read (network error) — retry'
const MALFORMED_ERR =
  'the Artifact type listing could not be read (malformed response)'
const ALL_ROWS_ERR =
  'the Artifact type listing could not be read (response rows were unreadable)'
const FORBIDDEN_ERR =
  'the Artifact type listing: not available to this session — nothing to retry'
const RATE_LIMITED_ERR =
  'the Artifact type listing: rate limited — wait a little before asking again'
const TEMP_UNAVAILABLE_ERR =
  'the Artifact type listing temporarily unavailable — retry shortly; this is not an empty answer'
const NO_AUTH_ERR = 'the Artifact type listing could not be read (no-auth)'

export type QuickstartTypeRow = {
  slug: string
  title: string
  typeUrl: string
  description?: string
  tier?: 'core' | 'solution' | 'community'
  untitled?: boolean
}

export type QuickstartCatalogResult = {
  err: string | null
  rows: QuickstartTypeRow[]
  dropped: number
  more: boolean
  unavailable: boolean
  /** Gold `he` reason for `ty(reason, intent)` at callQuickstart — not applied here. */
  reason?: string
}

function artifactGateEnvOrGb(
  envValue: string | undefined,
  gbKey: string,
): boolean {
  if (envValue !== undefined && envValue !== '') {
    return !isEnvDefinedFalsy(envValue)
  }
  return getFeatureValue_CACHED_MAY_BE_STALE<boolean>(gbKey, false) === true
}

/** Gold first 503/429 sleep: retry-after header else 300–800ms. Tests pin via env. */
function catalogRetrySleepMs(retryAfter: string | null): number {
  const override = process.env.CLAUDE_CODE_ARTIFACT_CATALOG_RETRY_MS
  if (override !== undefined && override !== '') {
    const n = Number(override)
    if (Number.isFinite(n)) return n
  }
  if (typeof retryAfter === 'string') {
    const parsed = Number.parseInt(retryAfter, 10)
    let ms = 1000
    if (Number.isFinite(parsed)) {
      ms = parsed <= 100 ? parsed * 1000 : parsed
    }
    return Math.min(ms, 5000)
  }
  return 300 + Math.random() * 500
}

function dlRetryAfter(res: {
  ok: boolean
  headers?: { get(name: string): string | null }
}): string | null {
  if (!res.ok || res.headers === undefined) return null
  return res.headers.get('retry-after')
}

/**
 * Gold remote type-create analog: local always; remote needs cloud-create
 * env/GB (same larch as types) or linden GB.
 */
function isTypeCreateAllowed(typesOn: boolean): boolean {
  if (!typesOn) return false
  if (!isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) return true
  return (
    artifactGateEnvOrGb(
      process.env.CLAUDE_CODE_ARTIFACT_TYPE_CLOUD_CREATE,
      'tengu_cobalt_plinth_larch',
    ) ||
    getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
      'tengu_cobalt_plinth_linden',
      false,
    ) === true
  )
}

/** Gold `yjn` env/GB only — no frozen pin (used by freeze to avoid recursion). */
function isArtifactQuickstartEnvOn(): boolean {
  return artifactGateEnvOrGb(
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART,
    'tengu_cobalt_plinth_woad',
  )
}

/** Gold `yjn` / Qps / bu analog (frozen pin then env/GB). */
export function isArtifactQuickstartOn(): boolean {
  try {
    const { un } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/services/artifactAutoReact/store.js') as typeof import('src/services/artifactAutoReact/store.js')
    const frozen = un().frozenArtifactTypes
    if (frozen !== undefined) return frozen.quickstartOn === true
  } catch {
    /* store optional */
  }
  return isArtifactQuickstartEnvOn()
}

/**
 * densable Xe analog — session-pin Artifact type gates.
 * Unique English: Artifact gates frozen.
 */
export function freezeArtifactTypes(): void {
  try {
    const { un } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/services/artifactAutoReact/store.js') as typeof import('src/services/artifactAutoReact/store.js')
    if (un().frozenArtifactTypes !== undefined) return
    const typesOn =
      artifactGateEnvOrGb(
        process.env.CLAUDE_CODE_ARTIFACT_TYPES,
        'tengu_cobalt_plinth_larch',
      ) &&
      artifactGateEnvOrGb(
        process.env.CLAUDE_CODE_ARTIFACT_MULTI_FILE,
        'tengu_cobalt_plinth_bracken',
      )
    const typeCreateOn = isTypeCreateAllowed(typesOn)
    const typeCatalogOn =
      typesOn &&
      artifactGateEnvOrGb(
        process.env.CLAUDE_CODE_ARTIFACT_TYPE_CATALOG,
        'tengu_cobalt_plinth_larch',
      )
    const quickstartOn =
      typeCatalogOn && typeCreateOn && isArtifactQuickstartEnvOn()
    un().frozenArtifactTypes = {
      typesOn,
      typeCreateOn,
      typeCatalogOn,
      ...(quickstartOn ? { quickstartOn: true } : {}),
    }
  } catch {
    /* store optional */
  }
}

/** Gold `bt` analog. */
export function typesPath(query?: string, firstParty?: boolean): string {
  const parts: string[] = [
    ...(firstParty === true ? ['scopes=anthropic'] : []),
    ...(query ? [`q=${encodeURIComponent(query)}`] : []),
  ]
  return parts.length === 0
    ? '/api/frame/types'
    : `/api/frame/types?${parts.join('&')}`
}

function claudeAiOrigin(): string {
  return getOauthConfig().CLAUDE_AI_ORIGIN
}

function typeUrlForSlug(slug: string, origin: string): string {
  return new URL(
    `/code/artifact/${slug}`,
    `${origin.replace(/\/$/, '')}/`,
  ).toString()
}

function listingTier(
  listings: unknown,
): 'core' | 'solution' | 'community' | undefined {
  if (!Array.isArray(listings)) return undefined
  const tiers = listings
    .map(item =>
      item !== null && typeof item === 'object'
        ? (item as { tier?: unknown }).tier
        : undefined,
    )
    .filter(
      (t): t is 'core' | 'solution' | 'community' =>
        t === 'core' || t === 'solution' || t === 'community',
    )
  if (tiers.includes('core')) return 'core'
  if (tiers.includes('solution')) return 'solution'
  if (tiers.includes('community')) return 'community'
  return undefined
}

function hasAnthropicListing(listings: unknown): boolean {
  if (!Array.isArray(listings)) return false
  return listings.some(
    item =>
      item !== null &&
      typeof item === 'object' &&
      (item as { scope?: unknown }).scope === 'anthropic',
  )
}

function parseTypeRow(
  raw: unknown,
  origin: string,
): QuickstartTypeRow | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const slug = typeof rec.slug === 'string' ? rec.slug : ''
  if (!slug) return undefined
  const titleRaw = typeof rec.title === 'string' ? rec.title : ''
  const title = titleRaw.trim() || 'Untitled'
  const row: QuickstartTypeRow = {
    slug,
    title,
    typeUrl: typeUrlForSlug(slug, origin),
    ...(titleRaw.trim() === '' ? { untitled: true } : {}),
  }
  if (typeof rec.description === 'string' && rec.description) {
    row.description = rec.description
  }
  const tier = listingTier(rec.listings)
  if (tier) row.tier = tier
  return row
}

function httpRetryable(status: number | undefined): boolean {
  return status === 503 || status === 429
}

function emptyCatalog(
  patch: Partial<QuickstartCatalogResult>,
): QuickstartCatalogResult {
  return {
    err: null,
    rows: [],
    dropped: 0,
    more: false,
    unavailable: false,
    ...patch,
  }
}

function dlStatus(res: { ok: boolean; status?: number }): number | undefined {
  return res.status
}

function dlReason(res: { ok: boolean; reason?: string }): string | undefined {
  return res.ok ? undefined : res.reason
}

function isOversizeListing(res: {
  ok: boolean
  reason?: string
  status?: number
}): boolean {
  if (res.status === 413) return true
  const reason = dlReason(res)
  if (reason === undefined) return false
  return reason === 'max_content_length' || /oversize|413/i.test(reason)
}

function isCatalogOff(res: {
  ok: boolean
  reason?: string
  status?: number
}): boolean {
  if (dlStatus(res) === 404) return true
  const reason = dlReason(res)
  return (
    reason === 'catalog_off' ||
    reason === 'relay_unserved' ||
    reason === 'relay-unavailable'
  )
}

function forbiddenReason(data: unknown): string {
  if (typeof data === 'string' && /credential/i.test(data)) {
    return 'ccr_credential_refused'
  }
  if (data !== null && typeof data === 'object' && 'error' in data) {
    return 'denied'
  }
  return 'forbidden'
}

/**
 * Gold `Ace` / `he` analog — GET `/api/frame/types` via DL.
 * Gold `he` feature:"artifact_type_list" / getRelayBound / credentials remain
 * on DL (no public minify he).
 */
export async function fetchTypeCatalog(opts: {
  query?: string
  firstParty: boolean
  signal?: AbortSignal
  credentials?: unknown
}): Promise<QuickstartCatalogResult> {
  const path = typesPath(opts.query, opts.firstParty)
  const req = {
    refreshOAuth: true as const,
    timeoutMs: CATALOG_TIMEOUT_MS,
    maxContentLength: CATALOG_MAX_BYTES,
    signal: opts.signal,
    headers: frameControlPlaneHeaders(),
    ...(opts.credentials !== undefined
      ? { credentials: opts.credentials }
      : {}),
  }
  try {
    const frameGet = DL.getRelayBound ?? DL.get
    let res = await frameGet(path, req)
    if (httpRetryable(dlStatus(res))) {
      await sleep(catalogRetrySleepMs(dlRetryAfter(res)), opts.signal, {
        throwOnAbort: true,
        abortError: () => new DOMException('Aborted', 'AbortError'),
      })
      res = await frameGet(path, req)
    }
    if (isOversizeListing(res)) {
      return emptyCatalog({ err: OVERSIZE_ERR, reason: 'oversize_body' })
    }
    if (isCatalogOff(res)) {
      return emptyCatalog({ unavailable: true })
    }
    if (!res.ok) {
      if (res.reason === 'no-auth') {
        return emptyCatalog({ err: NO_AUTH_ERR, reason: 'no-auth' })
      }
      if (res.reason === 'request_error') {
        return emptyCatalog({ err: NETWORK_ERR, reason: 'request_error' })
      }
      return emptyCatalog({
        err: `the Artifact type listing could not be read (${res.reason})`,
        reason: res.reason,
      })
    }
    if (res.status === 403) {
      return emptyCatalog({
        err: FORBIDDEN_ERR,
        reason: forbiddenReason(res.data),
      })
    }
    if (res.status === 429) {
      return emptyCatalog({ err: RATE_LIMITED_ERR, reason: 'rate_limited' })
    }
    if (res.status === 503) {
      return emptyCatalog({
        err: TEMP_UNAVAILABLE_ERR,
        reason: 'unavailable',
      })
    }
    if (res.status < 200 || res.status >= 300) {
      return emptyCatalog({
        err: `the Artifact type listing could not be read (HTTP ${res.status})`,
      })
    }
    const origin = claudeAiOrigin()
    const body = res.data
    const rec =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : undefined
    if (rec === undefined) {
      return emptyCatalog({ err: MALFORMED_ERR, reason: 'malformed_body' })
    }
    const types = rec.types
    const more =
      typeof rec.next_page_token === 'string' && rec.next_page_token !== ''
    if (!Array.isArray(types)) {
      return emptyCatalog({
        err: ALL_ROWS_ERR,
        reason: 'all_rows_dropped',
        more,
      })
    }
    const rows: QuickstartTypeRow[] = []
    let dropped = 0
    let parsed = 0
    for (const raw of types) {
      const row = parseTypeRow(raw, origin)
      if (!row) {
        dropped++
        continue
      }
      parsed++
      if (
        opts.firstParty &&
        !hasAnthropicListing(
          raw !== null && typeof raw === 'object'
            ? (raw as { listings?: unknown }).listings
            : undefined,
        )
      ) {
        dropped++
        continue
      }
      rows.push(row)
    }
    if (types.length > 0 && parsed === 0) {
      return emptyCatalog({
        err: ALL_ROWS_ERR,
        reason: 'all_rows_dropped',
        dropped,
        more,
      })
    }
    return { err: null, rows, dropped, more, unavailable: false }
  } catch (error) {
    if (opts.signal?.aborted) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    return emptyCatalog({
      err: NETWORK_ERR,
      reason: 'request_error',
    })
  }
}
