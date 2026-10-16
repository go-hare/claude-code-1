/**
 * densable 2.1.289 first-party MCP auto-auth (`o$` / `Jn` / `X` / `Bt` / `qr`).
 *
 * Gold connect: `X=(sse|http)&&!ce&&!re&&!me&&!hop&&o$(url)&&Jn()&&token`.
 * Skip `EFe` when X, then `N=Bt(N)` injects the claude.ai login bearer.
 * `jo` (Design permission classifier) is not X — do not skip OAuth on jo.
 * Hop `Kkn` stays analog-false. Do not invent hop tokens.
 * `e9` = ATo(!!Fhe) — designOauth slot present.
 * `Qon`/`f` = resolveDesignAccessToken + bearer kind (not jo).
 */
import type { FetchLike } from '@modelcontextprotocol/client'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
} from '../../utils/auth.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { DESIGN_CONSENT_BIT } from '../designConsent.js'
import {
  isConnectAuthFailureCandidate,
  type ConnectAuthFlags,
} from './connectAuthClassify.js'

export const FIRST_PARTY_AUTH_REJECTED = 'FIRST_PARTY_AUTH_REJECTED'

export type FirstPartyBearerBag = { last: string }

export type FirstPartyAuthRejection = {
  errorCode: typeof FIRST_PARTY_AUTH_REJECTED
  message: string
}

const FIRST_PARTY_MCP_HOSTS = ['api.anthropic.com'] as const
/** Gold `LF` — prefix if the entry ends with `/`, else exact pathname. */
const FIRST_PARTY_MCP_PATHS = [
  '/v1/design/',
  '/v1/claude/test/',
  '/v1/pages/mcp',
] as const
const DESIGN_PATH_PREFIX = '/v1/design/'
const DESIGN_READ_SCOPE = 'user:design:read'

/** Gold `Oke`. */
export class FirstPartyDesignNeedsConsentError extends Error {
  consent: string
  constructor(consent: string) {
    super('first-party design MCP server requires consent')
    this.consent = consent
    this.name = 'FirstPartyDesignNeedsConsentError'
  }
}

/** Gold `my` — `api.anthropic.com` host (port-sensitive, like jo). */
function isFirstPartyAnthropicHost(url: URL): boolean {
  return (FIRST_PARTY_MCP_HOSTS as readonly string[]).includes(url.host)
}

/**
 * Gold `o$`: https + my(href) + LF path.
 * `/v1/pages/mcp` is exact; design and claude/test are prefixes.
 */
export function isFirstPartyAnthropicMcpUrl(
  url: string | URL | undefined,
): boolean {
  if (url === undefined) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (!isFirstPartyAnthropicHost(parsed)) return false
    return FIRST_PARTY_MCP_PATHS.some(path =>
      path.endsWith('/')
        ? parsed.pathname.startsWith(path)
        : parsed.pathname === path,
    )
  } catch {
    return false
  }
}

/** Gold `Vx`: o$ and pathname starts with `/v1/design/`. */
export function isFirstPartyDesignMcpUrl(
  url: string | URL | undefined,
): boolean {
  if (!isFirstPartyAnthropicMcpUrl(url) || url === undefined) return false
  try {
    return new URL(url).pathname.startsWith(DESIGN_PATH_PREFIX)
  } catch {
    return false
  }
}

/** Gold `Jn()` — `He()==="firstParty"`. Analog host is getAPIProvider. */
export function isFirstPartyApiProvider(): boolean {
  return getAPIProvider() === 'firstParty'
}

/** Gold `e9` / ATo(`!!Fhe`) — designOauth slot exists. */
export async function hasDesignOauthCredential(
  credentials?: unknown,
): Promise<boolean> {
  const { readDesignOauth } = await import('../../cli/handlers/designOauth.js')
  const slot = await readDesignOauth(credentials)
  return !!slot?.accessToken
}

/**
 * Gold `X` / `Oe` without hop (`Kkn` KEEP false).
 * Token arm: `mn()?.accessToken || (Vx(url) && e9())`.
 */
export async function shouldUseFirstPartyAutoAuth(opts: {
  type?: string
  url?: string
  flags: ConnectAuthFlags
  cliOwned: boolean
}): Promise<boolean> {
  if (opts.type !== 'sse' && opts.type !== 'http') return false
  if (opts.flags.hasUserAuthHeader || opts.flags.helperMintsAuthHeader) {
    return false
  }
  if (opts.cliOwned) return false
  if (!isFirstPartyAnthropicMcpUrl(opts.url)) return false
  if (!isFirstPartyApiProvider()) return false
  if (getClaudeAIOAuthTokens()?.accessToken) return true
  if (!isFirstPartyDesignMcpUrl(opts.url)) return false
  return hasDesignOauthCredential()
}

/**
 * Gold `f` / `Qon` for Vx URLs; else `mn()` login bearer.
 */
async function resolveFirstPartyMcpBearer(
  url: string | URL,
): Promise<{ accessToken: string; bearer: string } | undefined> {
  if (isFirstPartyDesignMcpUrl(url)) {
    const { isEssentialTrafficOnly } = await import(
      '../../utils/privacyLevel.js'
    )
    if (!isFirstPartyApiProvider() || isEssentialTrafficOnly()) {
      return undefined
    }
    const { resolveDesignAccessToken } = await import('../designConsent.js')
    const { readDesignOauth } = await import(
      '../../cli/handlers/designOauth.js'
    )
    const token = await resolveDesignAccessToken()
    if (!token) return undefined
    const login = getClaudeAIOAuthTokens()
    const design = await readDesignOauth()
    let bearer = 'login'
    if (design?.accessToken === token) bearer = 'design_credential'
    else if (login?.scopes?.includes(DESIGN_READ_SCOPE)) {
      bearer = 'design_scoped_login'
    }
    return { accessToken: token, bearer }
  }
  const tokens = getClaudeAIOAuthTokens()
  if (!tokens?.accessToken) return undefined
  return {
    accessToken: tokens.accessToken,
    bearer: bearerKind(tokens.scopes),
  }
}

async function parseDesignNeedsConsent(
  response: Response,
): Promise<string | null> {
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return null
  }
  if (body === null || typeof body !== 'object') return null
  const rec = body as { error?: unknown; consent?: unknown }
  if (rec.error !== 'needs_consent') return null
  return rec.consent === DESIGN_CONSENT_BIT ? DESIGN_CONSENT_BIT : null
}

function bearerKind(scopes: unknown): string {
  return Array.isArray(scopes) && scopes.includes(DESIGN_READ_SCOPE)
    ? 'design_scoped_login'
    : 'login'
}

/**
 * Gold `Ur` — first-party 401/403 is not OAuth `Yo`.
 */
export function classifyFirstPartyAuthRejection(opts: {
  error: unknown
  statusCode?: number
  serverRef: { type?: string; url?: string; headers?: Record<string, string> }
  firstPartyBearer: string
}): FirstPartyAuthRejection | undefined {
  if (!isConnectAuthFailureCandidate(opts)) return undefined
  const status = opts.statusCode ?? 401
  let host = 'api.anthropic.com'
  try {
    if (typeof opts.serverRef.url === 'string') {
      host = new URL(opts.serverRef.url).host
    }
  } catch {
    // gold: keep api.anthropic.com
  }
  const http = `HTTP ${status}`
  const design = isFirstPartyDesignMcpUrl(opts.serverRef.url)
  const kind = opts.firstPartyBearer
  let message: string
  switch (kind) {
    case 'design_credential':
      message =
        status === 403
          ? `${host} rejected your /design-login credential (HTTP 403). Check that your account has access to Claude Design, or run /design-login to re-authorize it and retry.`
          : `${host} rejected your /design-login credential (${http}). Run /design-login to re-authorize it and retry.`
      break
    case 'none':
      message = `${host} needs a claude.ai sign-in and Claude Code had no usable credential to send (${http}). Run ${design ? '/design-login' : '/login'} and retry.`
      break
    case 'design_scoped_login':
    case 'login': {
      if (status === 403 && design) {
        message =
          kind === 'design_scoped_login'
            ? `${host} rejected your claude.ai login for Claude Design (HTTP 403) even though that login already includes Claude Design permissions, so this is most likely an account or project access problem. Check that your account has access to Claude Design; if it does, run /design-login and retry.`
            : `${host} rejected your claude.ai login for Claude Design (HTTP 403), most likely because a /login token carries no Claude Design access. Run /design-login and retry, or check that your account has access to Claude Design.`
      } else if (status === 403) {
        message = `${host} rejected your claude.ai login (HTTP 403). Check that your account has access to this server. If it does, your token may be missing a scope — run /login and retry.`
      } else {
        message = `${host} rejected your claude.ai login (${http}). Run /login and retry.`
      }
      break
    }
    default:
      message = `${host} rejected your claude.ai login (${http}). Run /login and retry.`
  }
  return { errorCode: FIRST_PARTY_AUTH_REJECTED, message }
}

/**
 * Gold `Bt` / `oo` — inject claude.ai login bearer on first-party MCP fetches.
 * Pass through when Authorization is already set, URL is not o$, or not Jn.
 * Design 403 `needs_consent` throws FirstPartyDesignNeedsConsentError (`Oke`).
 */
export function wrapFirstPartyAutoAuthFetch(
  inner: FetchLike,
  bag: FirstPartyBearerBag = { last: 'none' },
): FetchLike {
  return async (url, init) => {
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const existing = new Headers(init?.headers)
    if (
      existing.has('Authorization') ||
      !isFirstPartyAnthropicMcpUrl(url) ||
      !isFirstPartyApiProvider()
    ) {
      return inner(url, init)
    }

    const doRequest = async () => {
      await checkAndRefreshOAuthTokenIfNeeded()
      const resolved = await resolveFirstPartyMcpBearer(url)
      if (!resolved) {
        bag.last = 'none'
        return {
          response: await inner(url, init),
          sentToken: undefined as string | undefined,
        }
      }
      bag.last = resolved.bearer
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${resolved.accessToken}`)
      return {
        response: await inner(url, { ...init, headers }),
        sentToken: resolved.accessToken,
      }
    }

    const throwIfDesignNeedsConsent = async (sent: {
      response: Response
      sentToken: string | undefined
    }): Promise<void> => {
      if (sent.response.status !== 403 || !sent.sentToken) return
      if (!isFirstPartyDesignMcpUrl(url)) return
      const bit = await parseDesignNeedsConsent(sent.response)
      if (bit !== null) throw new FirstPartyDesignNeedsConsentError(bit)
    }

    const first = await doRequest()
    await throwIfDesignNeedsConsent(first)
    if (first.response.status !== 401 || !first.sentToken) {
      return first.response
    }
    const tokenChanged = await handleOAuth401Error(first.sentToken).catch(
      () => false,
    )
    if (!tokenChanged) {
      const now = getClaudeAIOAuthTokens()?.accessToken
      if (!now || now === first.sentToken) return first.response
    }
    try {
      const retry = await doRequest()
      await throwIfDesignNeedsConsent(retry)
      return retry.response
    } catch (error) {
      if (error instanceof FirstPartyDesignNeedsConsentError) throw error
      return first.response
    }
  }
}
