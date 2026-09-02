/**
 * densable Qem / ttm / Jem / Zem subset — frame live subscription mint (2.1.239).
 * Source: gold-Qem-239 / gold-ttm-239 / gold-Jem-239 / gold-Zem-239 / gold-vFe-239.
 *
 * Hits claude.ai control plane (`CLAUDE_AI_ORIGIN`) with OAuth Bearer + X-Frame-*.
 */
import { getOauthConfig } from '../../constants/oauth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import type { MintSubscriptionResult } from './arm.js'

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
}

type FrameBootErr = {
  err: string
  status?: number
  errorCode?: string
}

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
export async function fetchFrameBoot(
  slug: string,
  signal: AbortSignal,
  opts: { relayOnly?: boolean } = {},
): Promise<FrameBootOk | FrameBootErr> {
  const path = `/api/frame/${encodeURIComponent(slug)}?via=model_read`
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
  return { err: null, data, ver, assetToken }
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
