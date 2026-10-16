/**
 * densable Qem / ttm / Jem / Zem subset — frame live subscription mint (2.1.239).
 * Source: gold-Qem-239 / gold-ttm-239 / gold-Jem-239 / gold-Zem-239 / gold-vFe-239.
 *
 * Hits claude.ai control plane (`CLAUDE_AI_ORIGIN`) with OAuth Bearer + X-Frame-*.
 */
import { getOauthConfig } from '../../constants/oauth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import type { MintSubscriptionResult } from './arm.js'
import { Yw } from './readPerm/consent.js'
import { un } from './store.js'

/** densable yJr — boot / renew version shape. */
export const FRAME_VER_RE = /^[A-Za-z0-9_-]{1,64}$/

/** densable Azt — subscriptionToken gate (tengu_slate_lantern). */
export function isSubscriptionTokenGateOpen(): boolean {
  const env = process.env.CLAUDE_CODE_ARTIFACT_SUBSCRIPTION_TOKEN
  if (env !== undefined && env !== '') {
    const lower = env.toLowerCase()
    return !(
      lower === '0' ||
      lower === 'false' ||
      lower === 'no' ||
      lower === 'off'
    )
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_slate_lantern', false)
}

/** densable dR — frame control-plane headers (portable subset). */
export function frameControlPlaneHeaders(): Record<string, string> {
  const desktop = process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
  return {
    'X-Frame-CP': 'go',
    'X-Frame-Surface': 'code',
    'X-Frame-Platform': desktop ? 'desktop' : 'cli',
    'X-Frame-Client-Version':
      typeof MACRO !== 'undefined' && MACRO.VERSION ? MACRO.VERSION : 'unknown',
  }
}

function claudeAiOrigin(): string {
  return getOauthConfig().CLAUDE_AI_ORIGIN
}

async function oauthBearer(): Promise<string | null> {
  const tokens = getClaudeAIOAuthTokens()
  return tokens?.accessToken ?? null
}

type FrameBootOk = {
  err: null
  data: Record<string, unknown>
  ver: string
  assetToken: string | undefined
  route?: 'direct' | 'relay'
  reused?: boolean
}

type FrameBootErr = {
  err: string
  status?: number
  errorCode?: string
}

/** densable Ze — probeBoots TTL (ms). */
export const PROBE_BOOT_TTL_MS = 60_000

export type FetchFrameBootKind = 'probe' | 'read' | 'subscribe' | 'comments'

export type FetchFrameBootOpts = {
  relayOnly?: boolean
  /** densable bk=probe query; also implies kind "probe" when kind omitted. */
  probe?: boolean
  readBack?: boolean
  /**
   * densable aT kind — reuse allows any kind when cached boot has
   * `data.typeInstance === false`, else only `"probe"`.
   */
  kind?: FetchFrameBootKind
  /**
   * densable gatePublicRead — default true (probe arm). Content fetch paths
   * pass false and keep admitPublicRead after Yw.
   */
  gatePublicRead?: boolean
  /** densable probeToolUseId — reuse shareStatus.probeBoots for this tool use. */
  probeToolUseId?: string
  /**
   * densable agentPeer / actorId / syncLive / watchBoot / speculative /
   * lean — when any of these would skip reuse in gold, tip skips reuse too.
   * Pass-through flags only; no host invent.
   */
  agentPeer?: boolean
  actorId?: boolean
  syncLive?: boolean
  watchBoot?: boolean
  speculative?: boolean
  lean?: unknown
}

const PUBLIC_READ_DISABLED_ERR =
  'artifact read failed: this artifact is served to you as a public (non-member) reader, and reading public artifacts that way is not enabled yet'

/** densable Jem */
export function extractSubscriptionToken(
  data: Record<string, unknown>,
): string | undefined {
  if (!isSubscriptionTokenGateOpen()) return undefined
  const t = data.subscriptionToken
  return typeof t === 'string' && t.length > 0 ? t : undefined
}

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function isEditorRole(role: unknown): boolean {
  return role === 'owner' || role === 'writer'
}

/** densable $dw */
function isEditorFromBoot(boot: FrameBootOk): boolean {
  return (
    boot.assetToken !== undefined &&
    isEditorRole((boot.data.perm as { role?: unknown } | undefined)?.role)
  )
}

/**
 * densable Zem — GET /api/frame/${slug}?via=model_read via DL.get / getRelayOnly.
 */
/** densable Ft */
const BOOT_OTHER_ORG_MESSAGE =
  "this Artifact is in another of the user's organizations, not the one this session is signed in to \u2014 it opens here only after the user runs /login and signs in to that organization"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** densable It — `{error, reason: "org_mismatch", owner_org: <uuid>}`. */
function isOrgMismatchBody(data: unknown): boolean {
  if (data === null || typeof data !== 'object') return false
  const error = Reflect.get(data, 'error')
  const reason = Reflect.get(data, 'reason')
  const ownerOrg = Reflect.get(data, 'owner_org')
  return (
    typeof error === 'string' &&
    reason === 'org_mismatch' &&
    typeof ownerOrg === 'string' &&
    UUID_RE.test(ownerOrg)
  )
}

function pruneExpiredProbeBoots(now = Date.now()): void {
  const { probeBoots } = un().shareStatus
  for (const [slug, entry] of probeBoots) {
    if (now - entry.issuedAt > PROBE_BOOT_TTL_MS) probeBoots.delete(slug)
  }
}

/**
 * densable WHt live-behind check — KEEP stubbed: tip has no live supervisors
 * bag wired for this gate. Reuse still checks toolUseId + typeInstance.
 */
function isProbeBootLiveBehind(_slug: string, _ver: string): boolean {
  // KEEP: no WHt / live supervisors bag — do not invent behind=true.
  return false
}

function tryReuseProbeBoot(
  slug: string,
  opts: FetchFrameBootOpts,
  kind: FetchFrameBootKind,
  debugLabel: string,
): FrameBootOk | undefined {
  const probeToolUseId = opts.probeToolUseId
  if (
    probeToolUseId === undefined ||
    opts.agentPeer === true ||
    opts.actorId === true ||
    opts.syncLive === true ||
    opts.watchBoot === true ||
    opts.lean !== undefined ||
    opts.speculative === true
  ) {
    return undefined
  }
  const now = Date.now()
  pruneExpiredProbeBoots(now)
  const cached = un().shareStatus.probeBoots.get(slug)
  if (cached === undefined || cached.toolUseId !== probeToolUseId) {
    return undefined
  }
  if (!(kind === 'probe' || cached.boot.data.typeInstance === false)) {
    return undefined
  }
  // densable: !(relayOnly && Li() && boot.route !== "relay")
  // Li ≈ isAnthropicHostedRemoteSession
  if (opts.relayOnly === true) {
    // Lazy to keep mint free of frameRelay cycles at module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isAnthropicHostedRemoteSession } =
      require('./frameRelay.js') as typeof import('./frameRelay.js')
    if (
      isAnthropicHostedRemoteSession() &&
      cached.boot.route !== undefined &&
      cached.boot.route !== 'relay'
    ) {
      return undefined
    }
  }
  if (isProbeBootLiveBehind(slug, cached.boot.ver)) return undefined
  logForDebugging(
    `[artifact] ${debugLabel}: ${kind}-kind boot served from this tool use's share probe (probe issued ${now - cached.issuedAt}ms ago) slug=${slug}`,
  )
  return { ...cached.boot, reused: true }
}

/**
 * densable aT / kin portable — GET /api/frame/${slug}?via=model_read via DL,
 * with probeBoots reuse + gatePublicRead.
 */
export async function fetchFrameBoot(
  slug: string,
  signal: AbortSignal,
  opts: FetchFrameBootOpts = {},
): Promise<FrameBootOk | FrameBootErr> {
  const kind: FetchFrameBootKind =
    opts.kind ?? (opts.probe === true ? 'probe' : 'read')
  const gatePublicRead = opts.gatePublicRead !== false
  const asProbe = opts.probe === true || kind === 'probe'
  const reused = tryReuseProbeBoot(
    slug,
    opts,
    kind,
    asProbe ? 'artifact_share_probe' : 'artifact_frame_boot',
  )
  if (reused !== undefined) {
    if (gatePublicRead && reused.assetToken === undefined && !Yw()) {
      return {
        err: PUBLIC_READ_DISABLED_ERR,
        errorCode: 'public_read_disabled',
      }
    }
    return reused
  }

  const query = `via=model_read${asProbe ? '&bk=probe' : ''}${opts.readBack ? '&readback=1' : ''}`
  const path = `/api/frame/${encodeURIComponent(slug)}?${query}`
  // Lazy: frameDl imports frameRelay; keep mint free of cycles at load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DL } = require('./frameDl.js') as typeof import('./frameDl.js')
  let u: import('./frameDl.js').FrameDlResult
  try {
    u = opts.relayOnly
      ? await DL.getRelayOnly(path, { signal, timeoutMs: 15_000 })
      : await DL.get(path, { signal, timeoutMs: 15_000 })
  } catch (e) {
    if (
      signal.aborted ||
      (e instanceof DOMException && e.name === 'AbortError')
    ) {
      throw e instanceof DOMException
        ? e
        : new DOMException('Aborted', 'AbortError')
    }
    return {
      err: 'artifact read failed (network error)',
      errorCode: 'boot_request_error',
    }
  }
  if (!u.ok) {
    if (u.reason === 'relay-unavailable') {
      return {
        err: `artifact read failed (relay unavailable${u.status ? `, HTTP ${u.status}` : ''})`,
        ...(u.status !== undefined && u.status !== 0
          ? { status: u.status }
          : {}),
        errorCode: 'boot_relay_error',
      }
    }
    return {
      err:
        u.reason === 'no-auth'
          ? 'artifact read unavailable: no-auth'
          : `artifact read unavailable: ${u.reason}`,
      errorCode: u.reason.replace(/-/g, '_'),
    }
  }
  if (!u.fromFrame) {
    return {
      err: `artifact read failed (relay HTTP ${u.status})`,
      status: u.status,
      errorCode: 'boot_relay_error',
    }
  }
  if (u.status === 404) {
    return {
      err: 'artifact not found — it may have been deleted, or it has not been shared with you',
      status: 404,
      errorCode: 'boot_404',
    }
  }
  if (u.status === 403 && isOrgMismatchBody(u.data)) {
    return {
      err: BOOT_OTHER_ORG_MESSAGE,
      status: 403,
      errorCode: 'boot_org_mismatch',
    }
  }
  if (u.status < 200 || u.status >= 300) {
    return {
      err: `artifact read failed (HTTP ${u.status})`,
      status: u.status,
      errorCode: 'boot_failed',
    }
  }
  const raw = u.data
  const data: Record<string, unknown> =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const ver = data.ver
  const assetToken =
    typeof data.assetToken === 'string' && data.assetToken.length > 0
      ? data.assetToken
      : undefined
  const isPublic = data.mode === 'public' || data.kind === 'public'
  if (typeof ver !== 'string' || (!assetToken && !isPublic)) {
    return {
      err: 'artifact read failed: incomplete boot response',
      errorCode: 'boot_incomplete',
    }
  }
  if (!FRAME_VER_RE.test(ver)) {
    return {
      err: 'artifact read failed: malformed boot response',
      errorCode: 'boot_bad_ver',
    }
  }
  const boot: FrameBootOk = {
    err: null,
    data,
    ver,
    assetToken,
    route: u.route,
  }
  // densable kin: drop probeBoots when cached ver ≠ fresh boot ver.
  // (Avoid ownership import — ownership → mint cycle.)
  const cachedProbe = un().shareStatus.probeBoots.get(slug)
  if (cachedProbe !== undefined && cachedProbe.boot.ver !== ver) {
    un().shareStatus.probeBoots.delete(slug)
  }
  if (gatePublicRead && boot.assetToken === undefined && !Yw()) {
    return {
      err: PUBLIC_READ_DISABLED_ERR,
      errorCode: 'public_read_disabled',
    }
  }
  return boot
}

/**
 * densable Qem — mint live-channel subscription token from frame boot.
 */
export async function mintSubscriptionToken(
  slug: string,
  signal: AbortSignal,
): Promise<MintSubscriptionResult> {
  const boot = await fetchFrameBoot(slug, signal)
  if (boot.err !== null) {
    return {
      err: true,
      ...(boot.status !== undefined ? { status: boot.status } : {}),
    }
  }
  const token = extractSubscriptionToken(boot.data)
  if (token === undefined) {
    // densable may return err:null with undefined token; tip arm needs a string.
    return { err: true }
  }
  return {
    err: null,
    token,
    ver: boot.ver,
    editor: isEditorFromBoot(boot),
    tokenExp: finiteNumber(boot.data.subscriptionTokenExp),
    renewable: boot.data.watchTokenRenewEnabled === true,
  }
}

export type RenewWatchTokenResult =
  | {
      err: null
      token: string
      ver: string
      tokenExp?: number
      renewable: true
    }
  | { err: 'renew_miss'; status?: number }

/**
 * densable ttm — POST /api/frame/watch-token/${slug}
 */
export async function renewWatchToken(
  slug: string,
  signal: AbortSignal,
): Promise<RenewWatchTokenResult> {
  const bearer = await oauthBearer()
  if (!bearer) return { err: 'renew_miss' }
  const url = `${claudeAiOrigin()}/api/frame/watch-token/${encodeURIComponent(slug)}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...frameControlPlaneHeaders(),
      },
      body: '{}',
      signal,
    })
  } catch {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    return { err: 'renew_miss' }
  }
  if (res.status < 200 || res.status >= 300) {
    return { err: 'renew_miss', status: res.status }
  }
  let data: Record<string, unknown> = {}
  try {
    const raw = (await res.json()) as unknown
    if (raw && typeof raw === 'object') data = raw as Record<string, unknown>
  } catch {
    return { err: 'renew_miss', status: res.status }
  }
  const token = extractSubscriptionToken(data)
  const ver = data.ver
  if (
    typeof ver !== 'string' ||
    !FRAME_VER_RE.test(ver) ||
    token === undefined
  ) {
    return { err: 'renew_miss', status: res.status }
  }
  return {
    err: null,
    token,
    ver,
    tokenExp: finiteNumber(data.subscriptionTokenExp),
    renewable: true,
  }
}
