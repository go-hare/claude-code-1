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
