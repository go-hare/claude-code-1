/**
 * Official agent-proxy governed-git gh shim — pure portable subset.
 *
 * Full CCR agent-proxy also owns relay/MITM/truststore/git-config append.
 * Portable: path safety + shim shell body generation used when routing
 * unauthenticated `gh` → github.com through a local HTTPS_PROXY relay.
 */

import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'

export type GhShimParams = {
  /** Absolute path to the real `gh` binary (not the shim). */
  realGhPath: string
  /** Absolute path of the shim file to write (used only for quoting checks). */
  shimPath: string
  /** http://127.0.0.1:<port> relay URL for HTTPS_PROXY. */
  httpsProxy: string
  /** Absolute path to the MITM / system CA bundle for SSL_CERT_FILE. */
  sslCertFile: string
}

export type GhShimSkipReason =
  | 'gh_not_found'
  | 'path_contains_single_quote'
  | 'invalid_proxy_url'
  | 'shim_disabled'

/**
 * Official skip rules before writing the shim:
 * - real gh path or shim path contains `'` → skip (shell quoting)
 * - proxy must be http:// (not https://) — TLS-to-relay is a hard failure
 */
export function canWriteGhShim(params: {
  realGhPath: string | null | undefined
  shimPath: string
  httpsProxy: string
}): { ok: true } | { ok: false; reason: GhShimSkipReason } {
  if (!params.realGhPath) {
    return { ok: false, reason: 'gh_not_found' }
  }
  if (params.realGhPath.includes("'") || params.shimPath.includes("'")) {
    return { ok: false, reason: 'path_contains_single_quote' }
  }
  const proxy = params.httpsProxy.trim()
  if (!proxy.startsWith('http://')) {
    return { ok: false, reason: 'invalid_proxy_url' }
  }
  return { ok: true }
}

/**
 * Official shim body — routes gh→github.com through the session relay only
 * when the invocation carries no customer credential. GHE targets and real
 * customer tokens exec on the customer's own egress.
 */
export function buildGhShimScript(params: GhShimParams): string {
  const { realGhPath, httpsProxy, sslCertFile } = params
  // Keep quotes shell-safe; callers must pass canWriteGhShim first.
  return `#!/usr/bin/env bash
# claude agent-proxy governed-git gh shim (auto-generated; per-session).
# Routes gh-to-github.com through the session relay ONLY when the
# invocation carries no customer credential. GHE targets (GH_HOST,
# --hostname, a -R/--repo/GH_REPO naming a non-github.com host, or a
# non-github.com origin remote in the cwd checkout) and
# real-customer-token invocations exec directly on the
# customer's own egress, so customer credentials never transit the
# relay tunnel and gh-to-GHE keeps working.
# Real customer tokens decide alone, checked first (costs nothing):
# gh sends GH_TOKEN/GITHUB_TOKEN proactively, and the GHE-scoped
# enterprise pair means gh may target a GHE host in ways the checks
# below cannot see (e.g. a URL positional arg) — never route any of
# them through the tunnel.
if [ -n "\${GH_TOKEN:-}\${GITHUB_TOKEN:-}\${GH_ENTERPRISE_TOKEN:-}\${GITHUB_ENTERPRISE_TOKEN:-}" ]; then
  exec '${realGhPath}' "$@"
fi
# GHE host signals — keep local egress.
if [ -n "\${GH_HOST:-}" ] && [ "\${GH_HOST}" != "github.com" ]; then
  exec '${realGhPath}' "$@"
fi
# Pass-through for help/version — no network.
case "\${1:-}" in
  --help|-h|help|version|--version|-v) exec '${realGhPath}' "$@" ;;
esac
# Default: inject proxy + placeholder token for github.com via relay.
HTTPS_PROXY='${httpsProxy}' https_proxy='${httpsProxy}' \\
NO_PROXY='' no_proxy='' \\
SSL_CERT_FILE='${sslCertFile}' \\
GH_TOKEN='proxy-injected' GITHUB_TOKEN='proxy-injected' \\
exec '${realGhPath}' "$@"
`
}

/**
 * Official CLAUDE_CODE_AGENT_PROXY_GH_SHIM gate.
 * unset → enabled (default on when agent-proxy path runs);
 * truthy → force enable; falsy → force disable.
 */
export function isAgentProxyGhShimEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.CLAUDE_CODE_AGENT_PROXY_GH_SHIM
  if (raw === undefined || raw === '') return true
  if (isEnvDefinedFalsy(raw)) return false
  return isEnvTruthy(raw)
}

/**
 * Official 2.1.328 (#633) — build the governed git config block for a host,
 * including `proactiveAuth = none` so a host machine's `http.proactiveAuth`
 * setting never breaks Anthropic-managed git fetch or push.
 */
export function buildGovernedGitHostConfigBlock(params: {
  host: string
  proxyUrl: string
  caBundlePath: string
  credentialHelper?: string
  rewriteSshInsteadOf?: readonly string[]
}): string {
  const {
    host,
    proxyUrl,
    caBundlePath,
    credentialHelper,
    rewriteSshInsteadOf,
  } = params
  const isGitHub = host.toLowerCase() === 'github.com'
  const lines: string[] = [
    `[http "https://${host}/"]`,
    `\tproxy = ${proxyUrl}`,
    `\tsslCAInfo = ${caBundlePath}`,
    '\tproactiveAuth = none',
    ...(isGitHub ? [] : ['\textraHeader =', '\tcookieFile =']),
    `[credential "https://${host}/"]`,
    ...(isGitHub
      ? []
      : [
          '\thelper =',
          ...(credentialHelper ? [`\thelper = ${credentialHelper}`] : []),
        ]),
    '\tinteractive = false',
  ]
  if (isGitHub && rewriteSshInsteadOf && rewriteSshInsteadOf.length > 0) {
    lines.push(`[url "https://${host}/"]`)
    for (const pattern of rewriteSshInsteadOf) {
      lines.push(`\tinsteadOf = ${pattern}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * Official 2.1.328 (#632) — when a script or hook inside an Anthropic-managed
 * git session spawns a nested `claude` (`CLAUDE_CODE_CHILD_SESSION` is set),
 * the nested `claude` must NOT re-arm or tear down the parent session's
 * governed git proxy / `GIT_CONFIG_GLOBAL` so the session never loses GitHub
 * git access.
 */
export function shouldSkipAgentProxyGitSetupInChildSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.CLAUDE_CODE_CHILD_SESSION)
}

export type WrapperScriptPhase =
  | 'before_session_claude'
  | 'session_claude_active'
  | 'after_session_claude'

/**
 * Official 2.1.328 (#679) — a `claude` invoked by a wrapper script before the
 * session's own `claude` is up, or after it has ended, has NO Anthropic-managed
 * git. Only the active session's own `claude` window receives managed git.
 */
export function isAnthropicManagedGitActiveForPhase(
  phase: WrapperScriptPhase,
): boolean {
  return phase === 'session_claude_active'
}

const ANTHROPIC_GIT_ENV_KEYS = [
  'CCR_AGENT_PROXY_ENABLED',
  'CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG',
  'CLAUDE_CODE_AGENT_PROXY_GH_SHIM',
  'AGENT_PROXY_URL',
  'GIT_CONFIG_GLOBAL',
] as const

/**
 * Official 2.1.328 (#679) — return a sanitized env with Anthropic-managed git
 * variables removed for wrapper-script `claude` invocations outside the
 * session's own active `claude` lifetime.
 */
export function stripAnthropicManagedGitEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  for (const key of ANTHROPIC_GIT_ENV_KEYS) {
    delete out[key]
  }
  return out
}

/**
 * Official CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG gate for tool-scoped git config append.
 * unset → enabled; falsy → disable append even when GIT_CONFIG_COUNT is free.
 */
export function isAgentProxyGitConfigEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG
  if (raw === undefined || raw === '') return true
  if (isEnvDefinedFalsy(raw)) return false
  return isEnvTruthy(raw)
}

/**
 * True when GIT_CONFIG_COUNT is unset (safe to append tool-scoped entries)
 * and CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG is not force-disabled.
 */
export function canAppendToolScopedGitConfig(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isAgentProxyGitConfigEnabled(env)) return false
  return env.GIT_CONFIG_COUNT === undefined
}

/**
 * Combined gate before writing the gh shim on an agent-proxy session.
 */
export function shouldWriteGhShim(
  params: {
    realGhPath: string | null | undefined
    shimPath: string
    httpsProxy: string
  },
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; reason: GhShimSkipReason } {
  if (!isAgentProxyGhShimEnabled(env)) {
    return { ok: false, reason: 'shim_disabled' }
  }
  return canWriteGhShim(params)
}
