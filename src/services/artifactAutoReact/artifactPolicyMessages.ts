import { isEnvTruthy } from '../../utils/envUtils.js'

/** densable DualInk `A().artifactPolicyFetchAnswer` — G_n fetch fail stash. */
export type ArtifactPolicyFetchAnswer = {
  success: boolean
  retrying?: boolean
  errorCode?: string
  httpStatus?: number | null
  host?: string
  serverErrorCode?: string
}

const POLICY_LIMITS_PATH = '/api/claude_code/policy_limits'
const HOST_ONLY_RE = /^[A-Za-z0-9.-]+(:[0-9]+)?$/

function formatPolicyEndpoint(host: string | undefined): string {
  return host && HOST_ONLY_RE.test(host)
    ? `${host}${POLICY_LIMITS_PATH}`
    : `the API's ${POLICY_LIMITS_PATH} route`
}

/**
 * Official `ne` (2.1.292 #236) — distinguish Cowork cloud HTTP 403
 * `oauth_not_allowed_for_organization` from a proxy/network block.
 */
export function isCoworkOauthNotAllowedForOrg(params: {
  cause: string
  outcome?: ArtifactPolicyFetchAnswer
  isCoworkCloud?: boolean
}): boolean {
  const isCloud =
    params.isCoworkCloud ?? isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  return (
    params.cause === 'policy_fetch_failed' &&
    isCloud &&
    params.outcome?.httpStatus === 403 &&
    params.outcome?.serverErrorCode === 'oauth_not_allowed_for_organization'
  )
}

/** Official `xGo` (2.1.292 #236) — user-facing artifact policy error summary. */
export function formatArtifactPolicyUserMessage(params: {
  cause: string
  outcome?: ArtifactPolicyFetchAnswer
  isCoworkCloud?: boolean
}): string {
  if (isCoworkOauthNotAllowedForOrg(params)) {
    return "Artifacts aren't available: Anthropic couldn't confirm your organization's settings for this cloud session (HTTP 403). This isn't a problem with your network."
  }
  const host = params.outcome?.host ?? 'the API'
  const status = params.outcome?.httpStatus
  if (params.cause === 'policy_route_missing' || status === 404) {
    return `Artifacts aren't available: the request for your organization's policy got a 404 from ${host}, which usually means a proxy or gateway isn't forwarding ${POLICY_LIMITS_PATH}.`
  }
  if (status === 407) {
    return `Artifacts aren't available: your proxy asked for authentication before it would forward the request for your organization's policy to ${host}.`
  }
  if (
    status !== undefined &&
    status !== null &&
    (status >= 500 || status === 429)
  ) {
    return `Artifacts aren't available: your organization's policy couldn't be loaded from ${host} (HTTP ${status}). Try again later.`
  }
  return `Artifacts aren't available: couldn't verify your organization's policy from ${host}.`
}

/** Official `o4a` (2.1.292 #236) — model/tool guidance for artifact policy failures. */
export function formatArtifactPolicyToolGuidance(params: {
  cause: string
  outcome?: ArtifactPolicyFetchAnswer
  isCoworkCloud?: boolean
}): string {
  const target = formatPolicyEndpoint(params.outcome?.host)
  if (isCoworkOauthNotAllowedForOrg(params)) {
    return `Claude Code reads the organization's policy from ${target}. In this cloud session, Anthropic's API refused the request for the user's organization (HTTP 403). Do not retry this call now. Tell the user that artifacts are unavailable because Anthropic couldn't confirm their organization's settings for this cloud session, and that it isn't a problem with their network.`
  }
  if (params.cause === 'policy_route_missing') {
    return `Claude Code reads that policy from ${target}, and a proxy or gateway that does not forward that path will keep answering 404, so nothing in this session can load it. Do not retry this call. Tell the user that their IT admin needs to let that address through to the API.`
  }
  return `Claude Code reads that policy from ${target} and keeps retrying it in the background; whether artifacts are allowed is decided once it loads. Do not retry this call now. Tell the user why artifacts are unavailable and, if a proxy, VPN or web filter is involved, that their IT admin needs to let that address through.`
}

/** Official `CJn` (2.1.292 #236) — full artifact policy error message. */
export function formatArtifactPolicyError(params: {
  cause: string
  outcome?: ArtifactPolicyFetchAnswer
  isCoworkCloud?: boolean
}): string {
  return `${formatArtifactPolicyUserMessage(params)}\n\n${formatArtifactPolicyToolGuidance(params)}`
}
