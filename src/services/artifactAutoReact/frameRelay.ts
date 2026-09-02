/**
 * densable sEe / NYr / $Yr / Fdw — artifact content frame relay (2.1.239).
 * Gold: gold-sEe-relay / gold-NYr-relay / gold-Jgl (Fdw) / gold-SDi.
 *
 * sEe = R$t && !gei && tengu_cobalt_plinth_sorrel && SDi.
 * Cobalt sorrel uses densable GB default true; tip does NOT invent
 * tengu_cobalt_plinth (ASe) ON — that stays closed in artifactUrl.ts.
 *
 * Production host: ccr-gateway session-jwt GET against agent-proxy/artifact.
 * Host injectable via setArtifactFrameRelayHost / InstallProductOpts.
 */
import { resolveCcrIngressBaseUrl } from '../../utils/ccrProxyGates.js'
import {
  getSessionIngressAuthHeaders,
  getSessionIngressAuthToken,
} from '../../utils/sessionIngressAuth.js'
import { un } from './store.js'

const ARTIFACT_MOUNT = 'artifact_mount'
/** densable vZf — decline/served latch TTL (300s). */
const RELAY_TTL_MS = 300_000
const DEFAULT_RELAY_TIMEOUT_MS = 30_000

/** densable V.CLAUDE_CODE_REMOTE boolean — env 1/true/TRUE only (not arbitrary non-empty). */
export function isClaudeCodeRemoteEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.CLAUDE_CODE_REMOTE === '1' ||
    env.CLAUDE_CODE_REMOTE === 'true' ||
    env.CLAUDE_CODE_REMOTE === 'TRUE'
  )
}

/** densable NYr path under agent-proxy. */
export function artifactRelayServedPath(
  slug: string,
  servedPath: string,
): string {
  return `/v1/code/agent-proxy/artifact/${encodeURIComponent(slug)}${servedPath}`
}

/** densable wDi — rewrite /api/frame/* onto agent-proxy/frame mount. */
export function artifactRelayFramePath(frameApiPath: string): string {
  const trimmed = frameApiPath.startsWith('/api/frame/')
    ? frameApiPath.slice('/api/frame'.length)
    : frameApiPath
  return `/v1/code/agent-proxy/frame${trimmed}`
}

/** densable $Yr */
export function artifactRelayAssetHeaders(
  assetToken: string,
): Record<string, string> {
  return { 'x-frame-asset-token': assetToken }
}

/** densable R$t — Anthropic-hosted cloud remote (not bridge/byoc env kind). */
export function isAnthropicHostedRemoteSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isClaudeCodeRemoteEnv(env) && env.CLAUDE_CODE_ENVIRONMENT_KIND === undefined
  )
}

/**
 * densable gei — optional custom frame host override.
 * SEA returns undefined in this build; tip keeps the same closed stub.
 */
export function getArtifactFrameHostOverride(): string | undefined {
  return undefined
}

/**
 * densable knr portable — session gateway base URL.
 * Prefer last --sdk-url argv (densable), else SESSION_INGRESS_URL chain.
 */
export function resolveSessionGatewayBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): string | undefined {
  let sdk: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--sdk-url' && argv[i + 1]) {
      sdk = argv[i + 1]
      i++
      continue
    }
    if (a?.startsWith('--sdk-url=')) {
      sdk = a.slice('--sdk-url='.length)
    }
  }
  const fromSdk = sdk?.trim()
  if (fromSdk) {
    try {
      const u = new URL(fromSdk)
      if (u.protocol === 'wss:') u.protocol = 'https:'
      else if (u.protocol === 'ws:') u.protocol = 'http:'
      return u.origin.replace(/\/+$/, '')
    } catch {
      /* fall through to ingress */
    }
  }
  return resolveCcrIngressBaseUrl(env)
}

/**
 * densable SDi — knr().status==="ok" && P0()!==null.
 */
export function isSessionGatewayReady(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  return (
    resolveSessionGatewayBaseUrl(env, argv) !== undefined &&
    getSessionIngressAuthToken() !== null
  )
}

/**
 * densable it("tengu_cobalt_plinth_sorrel", true).
 * Env CLAUDE_CODE_ARTIFACT_FRAME_RELAY forces on/off for tests.
 * Does not open tengu_cobalt_plinth (ASe) — separate gate.
 */
export function isCobaltPlinthSorrelOpen(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const force = env.CLAUDE_CODE_ARTIFACT_FRAME_RELAY
  if (force !== undefined && force !== '') {
    const lower = force.toLowerCase()
    if (
      lower === '0' ||
      lower === 'false' ||
      lower === 'no' ||
      lower === 'off'
    ) {
      return false
    }
    if (
      lower === '1' ||
      lower === 'true' ||
      lower === 'yes' ||
      lower === 'on'
    ) {
      return true
    }
  }
  // Lazy: avoid growthbook ↔ artifact cycles at module load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getFeatureValue_CACHED_MAY_BE_STALE } =
    require('../analytics/growthbook.js') as typeof import('../analytics/growthbook.js')
  // densable default !0 === true
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_plinth_sorrel', true)
}

/**
 * densable sEe — frame relay eligible.
 */
export function isArtifactFrameRelayOpen(): boolean {
  if (!isAnthropicHostedRemoteSession()) return false
  if (getArtifactFrameHostOverride() !== undefined) return false
  if (!isCobaltPlinthSorrelOpen()) return false
  return isSessionGatewayReady()
}

/** densable tgr */
export function isFrameRelayDeclined(family = ARTIFACT_MOUNT): boolean {
  return (un().frameRelay.declinedUntil.get(family) ?? 0) > Date.now()
}

/** densable Xeo */
export function declineFrameRelay(family = ARTIFACT_MOUNT): void {
  un().frameRelay.declinedUntil.set(family, Date.now() + RELAY_TTL_MS)
}

/** densable fhl */
export function isFrameRelayServed(family = ARTIFACT_MOUNT): boolean {
  return (un().frameRelay.servedUntil.get(family) ?? 0) > Date.now()
}

/** densable _zt */
export function markFrameRelayServed(family = ARTIFACT_MOUNT): void {
  const t = un().frameRelay
  t.declinedUntil.delete(family)
  t.servedUntil.set(family, Date.now() + RELAY_TTL_MS)
}

export type FrameRelayFetchResult =
  | {
      ok: true
      status: number
      bytes: Buffer
      contentType: string | undefined
    }
  | { ok: false; reason: string; status?: number }

export type ArtifactFrameRelayHost = {
  fetchArtifactMount: (input: {
    method: 'GET'
    path: string
    headers: Record<string, string>
    signal?: AbortSignal
    maxBytes: number
  }) => Promise<FrameRelayFetchResult>
}

let relayHost: ArtifactFrameRelayHost | null = null

export function getArtifactFrameRelayHost(): ArtifactFrameRelayHost | null {
  return relayHost
}

export function setArtifactFrameRelayHost(
  host: ArtifactFrameRelayHost | null,
): void {
  relayHost = host
}

export function resetArtifactFrameRelayHostForTests(): void {
  relayHost = null
}

/**
 * densable gs host:"ccr-gateway" auth:"session-jwt" deps — injectable for tests.
 */
export type CcrGatewayArtifactFrameRelayHostDeps = {
  resolveBaseUrl?: () => string | undefined
  getAuthToken?: () => string | null
  getAuthHeaders?: () => Record<string, string>
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

/**
 * Production ccr-gateway JWT host (densable Fdw gs.get wire).
 * Resolves SESSION_INGRESS_URL (etc.) + session access token Bearer/Cookie.
 */
export function createCcrGatewayArtifactFrameRelayHost(
  deps: CcrGatewayArtifactFrameRelayHostDeps = {},
): ArtifactFrameRelayHost {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS
  return {
    async fetchArtifactMount(input) {
      const token = deps.getAuthToken
        ? deps.getAuthToken()
        : getSessionIngressAuthToken()
      if (!token) {
        return { ok: false, reason: 'no_auth' }
      }
      const base = deps.resolveBaseUrl
        ? deps.resolveBaseUrl()
        : (resolveSessionGatewayBaseUrl() ?? undefined)
      if (!base) {
        return { ok: false, reason: 'no_ingress' }
      }
      const authHeaders = deps.getAuthHeaders
        ? deps.getAuthHeaders()
        : getSessionIngressAuthHeaders()
      const url = `${base.replace(/\/+$/, '')}${input.path}`
      const fetchImpl = deps.fetch ?? globalThis.fetch
      const controller = new AbortController()
      const onAbort = (): void => {
        controller.abort()
      }
      if (input.signal) {
        if (input.signal.aborted) {
          controller.abort()
        } else {
          input.signal.addEventListener('abort', onAbort, { once: true })
        }
      }
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: { ...authHeaders, ...input.headers },
          signal: controller.signal,
          redirect: 'manual',
        })
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.byteLength > input.maxBytes) {
          return {
            ok: false,
            reason: 'too_large',
            status: res.status,
          }
        }
        const ct =
          res.headers.get('x-frame-asset-content-type') ??
          res.headers.get('content-type') ??
          undefined
        if (res.status < 200 || res.status >= 300) {
          return {
            ok: false,
            reason: `http_${res.status}`,
            status: res.status,
          }
        }
        return {
          ok: true,
          status: res.status,
          bytes: buf,
          contentType: ct ?? undefined,
        }
      } finally {
        clearTimeout(timer)
        input.signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}

/**
 * densable Fdw portable — GET served path via ccr-gateway host (default or injected).
 */
export async function fetchViaArtifactFrameRelay(input: {
  slug: string
  servedPath: string
  assetToken: string
  signal?: AbortSignal
  maxBytes: number
  fileRead?: boolean
}): Promise<
  | { relayed: true; result: FrameRelayFetchResult }
  | { relayed: false; why: string; code: string; status?: number }
> {
  if (!isArtifactFrameRelayOpen() || isFrameRelayDeclined()) {
    return {
      relayed: false,
      why: 'relay unavailable',
      code: 'relay_unavailable',
    }
  }
  const host = getArtifactFrameRelayHost()
  if (!host) {
    return {
      relayed: false,
      why: 'no frame relay host bound in this build',
      code: 'relay_unbound',
    }
  }
  const path = artifactRelayServedPath(input.slug, input.servedPath)
  try {
    const res = await host.fetchArtifactMount({
      method: 'GET',
      path,
      headers: artifactRelayAssetHeaders(input.assetToken),
      signal: input.signal,
      maxBytes: input.maxBytes,
    })
    if (!res.ok) {
      if (res.reason === 'no_auth') {
        return {
          relayed: false,
          why: 'this session holds no gateway credential',
          code: 'no_auth',
        }
      }
      if (res.status === undefined) {
        return {
          relayed: false,
          why: `the gateway request was skipped (${res.reason})`,
          code: 'client_policy',
        }
      }
      if (res.status === 404 && input.fileRead) {
        return { relayed: true, result: res }
      }
      if (res.status === 404) {
        declineFrameRelay()
        return {
          relayed: false,
          why: 'artifact reads through the session gateway are not enabled for this session, or the artifact service no longer serves this version',
          code: 'not_served',
          status: 404,
        }
      }
      return {
        relayed: false,
        why: `the gateway refused the relay with HTTP ${res.status}`,
        code: 'http',
        status: res.status,
      }
    }
    markFrameRelayServed()
    return { relayed: true, result: res }
  } catch {
    declineFrameRelay()
    return {
      relayed: false,
      why: 'the gateway request failed in transport',
      code: 'request_error',
    }
  }
}
