import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { getScreenReaderChildEnv } from './screenReaderGate.js'

/**
 * Env vars to strip from subprocess environments when running inside GitHub
 * Actions. This prevents prompt-injection attacks from exfiltrating secrets
 * via shell expansion (e.g., ${ANTHROPIC_API_KEY}) in Bash tool commands.
 *
 * The parent claude process keeps these vars (needed for API calls, lazy
 * credential reads). Only child processes (bash, shell snapshot, MCP stdio, LSP, hooks) are scrubbed.
 *
 * GITHUB_TOKEN / GH_TOKEN are intentionally NOT scrubbed — wrapper scripts
 * (gh.sh) need them to call the GitHub API. That token is job-scoped and
 * expires when the workflow ends.
 */
const GHA_SUBPROCESS_SCRUB = [
  // Anthropic auth — claude re-reads these per-request, subprocesses don't need them
  // densable R_s (2.1.227): includes ARTIFACTS + MEMORY tokens and FOUNDRY_AUTH_TOKEN
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_BEDROCK_MANTLE_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_ARTIFACTS_API_TOKEN',
  'CLAUDE_CODE_MEMORY_API_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',

  // OTLP exporter headers — documented to carry Authorization=Bearer tokens
  // for monitoring backends; read in-process by OTEL SDK, subprocesses never need them
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',

  // CA certificate bundle overrides — if leaked, an attacker-controlled subprocess
  // could point these at a malicious CA bundle and MITM tooling (curl, git, pip,
  // node, cargo, etc.). All CA bundles are read in-process before subprocess spawn.
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE',
  'PIP_CERT',
  'GIT_SSL_CAINFO',
  'AWS_CA_BUNDLE',
  'CARGO_HTTP_CAINFO',
  'DENO_CERT',

  // Cloud provider creds — same pattern (lazy SDK reads)
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',

  // GitHub Actions OIDC — consumed by the action's JS before claude spawns;
  // leaking these allows minting an App installation token → repo takeover
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',

  // GitHub Actions artifact/cache API — cache poisoning → supply-chain pivot
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',

  // claude-code-action-specific duplicates — action JS consumes these during
  // prepare, before spawning claude. ALL_INPUTS contains anthropic_api_key as JSON.
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
] as const

/**
 * Returns a copy of process.env with sensitive secrets stripped, for use when
 * spawning subprocesses (Bash tool, shell snapshot, MCP stdio servers, LSP
 * servers, shell hooks).
 *
 * Gated on CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. claude-code-action sets this
 * automatically when `allowed_non_write_users` is configured — the flag that
 * exposes a workflow to untrusted content (prompt injection surface).
 */
// Registered by init.ts after the upstreamproxy module is dynamically imported
// in CCR sessions. Stays undefined in non-CCR startups so we never pull in the
// upstreamproxy module graph (upstreamproxy.ts + relay.ts) via a static import.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

/**
 * Called from init.ts to wire up the proxy env function after the upstreamproxy
 * module has been lazily loaded. Must be called before any subprocess is spawned.
 */
export function registerUpstreamProxyEnvFn(
  fn: () => Record<string, string>,
): void {
  _getUpstreamProxyEnv = fn
}

/**
 * Official kVt densable accessor — injected upstream-proxy env for subprocesses.
 * Returns {} when proxy is disabled or not registered (non-CCR).
 */
export function getRegisteredUpstreamProxyEnv(): Record<string, string> {
  return _getUpstreamProxyEnv?.() ?? {}
}

/**
 * Returns true when the subprocess environment should be scrubbed of sensitive
 * secrets. Equivalent to official uP1() / isScrubEnabled logic.
 *
 * Three paths to scrubbing:
 * 1. CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is truthy → always scrub (GHA mode)
 * 2. CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is explicitly falsy → never scrub
 * 3. Neither — check CLAUDE_CODE_ENTRYPOINT; local-agent auto-scrubs
 */
function shouldScrubSubprocessEnv(): boolean {
  const envVar = process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
  if (isEnvTruthy(envVar)) return true
  if (isEnvDefinedFalsy(envVar)) return false
  return process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent'
}

export function subprocessEnv(): NodeJS.ProcessEnv {
  // CCR upstreamproxy: inject HTTPS_PROXY + CA bundle vars so curl/gh/python
  // in agent subprocesses route through the local relay. Returns {} when the
  // proxy is disabled or not registered (non-CCR), so this is a no-op outside
  // CCR containers.
  const proxyEnv = _getUpstreamProxyEnv?.() ?? {}
  // Official FXe — propagate CLAUDE_AX_SCREEN_READER=1 when screen-reader mode is on.
  const screenReaderEnv = getScreenReaderChildEnv()

  if (!shouldScrubSubprocessEnv()) {
    if (
      Object.keys(proxyEnv).length === 0 &&
      Object.keys(screenReaderEnv).length === 0
    ) {
      return process.env
    }
    return { ...process.env, ...proxyEnv, ...screenReaderEnv }
  }
  const env = { ...process.env, ...proxyEnv, ...screenReaderEnv }
  for (const k of GHA_SUBPROCESS_SCRUB) {
    delete env[k]
    // GitHub Actions auto-creates INPUT_<NAME> for `with:` inputs, duplicating
    // secrets like INPUT_ANTHROPIC_API_KEY. No-op for vars that aren't action inputs.
    delete env[`INPUT_${k}`]
  }
  return env
}
