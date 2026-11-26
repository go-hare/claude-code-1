/**
 * Official proxyAuthHelper densable helpers + fkn runtime (Yyt / mNm / fkn / qCl / Oci / Lci).
 * Shell command outputs a Proxy-Authorization header value for corporate proxies.
 */

import { execa } from 'execa'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import {
  DEFAULT_PROXY_AUTH_HELPER_TTL_MS,
  getProxyAuthenticate,
  isProxyAuthHelperEnabled,
  resolveProxyAuthHelperCommand,
  resolveProxyAuthHelperTtlMs,
  shouldReuseProxyAuthHelperCache,
  shouldSkipProxyAuthHelperForTrust,
} from './residualFinalEnvGates.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'
import { checkHasTrustDialogAccepted } from './config.js'
import { getProxyUrl } from './proxy.js'
import {
  getBootstrapSessionHost,
  HostSlot,
  ofDefaultHost,
} from './sessionHost.js'

export {
  DEFAULT_PROXY_AUTH_HELPER_TTL_MS,
  isProxyAuthHelperEnabled,
  resolveProxyAuthHelperCommand,
  resolveProxyAuthHelperTtlMs,
  shouldReuseProxyAuthHelperCache,
  shouldSkipProxyAuthHelperForTrust,
} from './residualFinalEnvGates.js'

/** Official error prefix for failed helper runs. */
export const PROXY_AUTH_HELPER_FAILED_PREFIX = 'proxyAuthHelper failed: '

/** Official fkn subprocess timeout (30s). */
export const PROXY_AUTH_HELPER_EXEC_TIMEOUT_MS = 30_000

export function formatProxyAuthHelperFailure(detail: string): string {
  return `${PROXY_AUTH_HELPER_FAILED_PREFIX}${detail}`
}

/**
 * Build env extras official fkn injects into the helper subprocess.
 */
export function buildProxyAuthHelperChildEnv(input: {
  baseEnv?: NodeJS.ProcessEnv
  proxyUrl?: string
  proxyHost?: string
  proxyAuthenticate?: string
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(input.baseEnv ?? process.env) }
  if (input.proxyUrl) env.CLAUDE_CODE_PROXY_URL = input.proxyUrl
  if (input.proxyHost) env.CLAUDE_CODE_PROXY_HOST = input.proxyHost
  if (input.proxyAuthenticate) {
    env.CLAUDE_CODE_PROXY_AUTHENTICATE = input.proxyAuthenticate
  }
  return env
}

/**
 * Parse helper stdout into a Proxy-Authorization header value.
 * Official: non-empty trimmed stdout; failed/empty → null.
 */
export function parseProxyAuthHelperStdout(
  stdout: string | undefined | null,
): string | null {
  const v = stdout?.trim()
  return v && v.length > 0 ? v : null
}

/**
 * Classify official fkn failure reason from execa-style result.
 */
export function classifyProxyAuthHelperFailure(input: {
  timedOut?: boolean
  failed?: boolean
  exitCode?: number | null
  hasStdout?: boolean
}): string {
  if (input.timedOut) return 'timed out'
  if (input.failed) return `exited ${input.exitCode ?? 1}`
  if (!input.hasStdout) return 'did not return a value'
  return 'did not return a value'
}

// --- Host state (official m9t / HYe / dkn) ---

type ProxyAuthHelperConfig = {
  helper?: string
  fromProjectOrLocal: boolean
  trustAccepted: () => boolean
}

type ProxyAuthHelperHostState = {
  hasExplicitConfig: boolean
  config: ProxyAuthHelperConfig
  cache: { value: string; timestamp: number } | null
  /** Official dkn — force-refresh token (Proxy-Authenticate challenge). */
  forceProxyAuthenticate: string | undefined
}

function createDefaultProxyAuthHelperConfig(): ProxyAuthHelperConfig {
  return {
    helper: undefined,
    fromProjectOrLocal: false,
    trustAccepted: () => checkHasTrustDialogAccepted(),
  }
}

const proxyAuthHelperHostSlot = new HostSlot<ProxyAuthHelperHostState>(() => ({
  hasExplicitConfig: false,
  config: createDefaultProxyAuthHelperConfig(),
  cache: null,
  forceProxyAuthenticate: undefined,
}))

function getProxyAuthHelperHostState(): ProxyAuthHelperHostState {
  return proxyAuthHelperHostSlot.of(getBootstrapSessionHost())
}

function getEffectiveProxyAuthHelperConfig(): ProxyAuthHelperConfig {
  const own = proxyAuthHelperHostSlot.peek(getBootstrapSessionHost())
  if (own?.hasExplicitConfig) {
    return own.config
  }
  const defaultState = ofDefaultHost(proxyAuthHelperHostSlot)
  if (defaultState.hasExplicitConfig) {
    return defaultState.config
  }
  return getProxyAuthHelperHostState().config
}

export function setProxyAuthHelperConfig(config: {
  helper?: string
  fromProjectOrLocal?: boolean
  trustAccepted?: () => boolean
}): void {
  const hostState = getProxyAuthHelperHostState()
  hostState.hasExplicitConfig = true
  hostState.config = {
    helper: config.helper,
    fromProjectOrLocal: config.fromProjectOrLocal ?? false,
    trustAccepted:
      config.trustAccepted ?? (() => checkHasTrustDialogAccepted()),
  }
}

/**
 * Load proxyAuthHelper from settings into host config (call after settings ready).
 * Official: m9t populated from settings schema field.
 */
export function configureProxyAuthHelperFromSettings(): void {
  const cmd = getConfiguredProxyAuthHelperCommand()
  if (!cmd) {
    setProxyAuthHelperConfig({
      helper: undefined,
      fromProjectOrLocal: false,
      trustAccepted: checkHasTrustDialogAccepted,
    })
    return
  }
  setProxyAuthHelperConfig({
    helper: cmd,
    fromProjectOrLocal: isProxyAuthHelperFromProjectOrLocalSettings(),
    trustAccepted: checkHasTrustDialogAccepted,
  })
}

/**
 * Official Yyt — env gate + configured helper command from host config or settings.
 */
export function getConfiguredProxyAuthHelperCommand(): string | undefined {
  const config = getEffectiveProxyAuthHelperConfig()
  // Prefer explicit host config (tests / late injection / boot config)
  if (config.helper) {
    return resolveProxyAuthHelperCommand({
      helperCommand: config.helper,
    })
  }
  const settings = getSettings_DEPRECATED() || {}
  return resolveProxyAuthHelperCommand({
    helperCommand: settings.proxyAuthHelper,
  })
}

export function isProxyAuthHelperFromProjectOrLocalSettings(): boolean {
  const cmd = getConfiguredProxyAuthHelperCommand()
  if (!cmd) return false
  const project = getSettingsForSource('projectSettings')
  const local = getSettingsForSource('localSettings')
  return project?.proxyAuthHelper === cmd || local?.proxyAuthHelper === cmd
}

/** Official qCl — last cached Proxy-Authorization value. */
export function getCachedProxyAuthHelperValue(): string | null {
  return getProxyAuthHelperHostState().cache?.value ?? null
}

/**
 * Official Oci — force next fkn to re-run with Proxy-Authenticate challenge.
 */
export function forceProxyAuthHelperRefresh(proxyAuthenticate?: string): void {
  const hostState = getProxyAuthHelperHostState()
  hostState.cache = null
  hostState.forceProxyAuthenticate = proxyAuthenticate
}

/** Official hNm — clear cache + config. */
export function clearProxyAuthHelperState(): void {
  const hostState = getProxyAuthHelperHostState()
  hostState.cache = null
  hostState.forceProxyAuthenticate = undefined
  hostState.hasExplicitConfig = false
  hostState.config = createDefaultProxyAuthHelperConfig()
}

/**
 * Official fkn — run proxyAuthHelper shell command with trust + TTL cache.
 * Returns Proxy-Authorization header value or null.
 */
export async function runProxyAuthHelper(input?: {
  proxyUrl?: string | null
  env?: NodeJS.ProcessEnv
  nowMs?: number
  /** Override for tests; defaults to session non-interactive flag. */
  isNonInteractive?: boolean
}): Promise<string | null> {
  const command = getConfiguredProxyAuthHelperCommand()
  if (!command) return null

  const hostState = getProxyAuthHelperHostState()
  const effectiveConfig = getEffectiveProxyAuthHelperConfig()
  const fromProjectOrLocal =
    effectiveConfig.fromProjectOrLocal ||
    isProxyAuthHelperFromProjectOrLocalSettings()
  if (
    shouldSkipProxyAuthHelperForTrust({
      fromProjectOrLocal,
      isNonInteractive: input?.isNonInteractive ?? getIsNonInteractiveSession(),
      trustAccepted: effectiveConfig.trustAccepted(),
    })
  ) {
    logForDebugging(
      'proxyAuthHelper configured in project/local settings but workspace trust not yet accepted — skipping',
      { level: 'warn' },
    )
    return null
  }

  const forceAuth =
    hostState.forceProxyAuthenticate ?? getProxyAuthenticate(input?.env)
  const ttlMs = resolveProxyAuthHelperTtlMs(input?.env)
  if (
    !hostState.forceProxyAuthenticate &&
    hostState.cache &&
    shouldReuseProxyAuthHelperCache({
      cachedAtMs: hostState.cache.timestamp,
      nowMs: input?.nowMs,
      ttlMs,
    })
  ) {
    return hostState.cache.value
  }
  hostState.forceProxyAuthenticate = undefined

  const proxyUrl = input?.proxyUrl ?? getProxyUrl(input?.env)
  let proxyHost: string | undefined
  try {
    proxyHost = proxyUrl ? new URL(proxyUrl).hostname : undefined
  } catch {
    proxyHost = undefined
  }

  const childEnv = buildProxyAuthHelperChildEnv({
    baseEnv: input?.env ?? process.env,
    proxyUrl: proxyUrl ?? undefined,
    proxyHost,
    proxyAuthenticate: forceAuth,
  })

  const result = await execa(command, {
    shell: true,
    timeout: PROXY_AUTH_HELPER_EXEC_TIMEOUT_MS,
    reject: false,
    env: childEnv,
  })

  const stdout = parseProxyAuthHelperStdout(result.stdout)
  if (result.failed || !stdout) {
    const reason = classifyProxyAuthHelperFailure({
      timedOut: result.timedOut,
      failed: result.failed,
      exitCode: result.exitCode,
      hasStdout: !!stdout,
    })
    const stderr = result.stderr?.trim()
    const detail = stderr ? `${reason}: ${stderr}` : reason
    console.error(formatProxyAuthHelperFailure(detail))
    return hostState.cache?.value ?? null
  }

  hostState.cache = { value: stdout, timestamp: input?.nowMs ?? Date.now() }
  return stdout
}

/**
 * Official Lci — fire-and-forget warmup when helper configured + trust OK.
 */
export function prefetchProxyAuthHelper(): void {
  if (!getConfiguredProxyAuthHelperCommand()) return
  const effectiveConfig = getEffectiveProxyAuthHelperConfig()
  const fromProjectOrLocal =
    effectiveConfig.fromProjectOrLocal ||
    isProxyAuthHelperFromProjectOrLocalSettings()
  if (
    shouldSkipProxyAuthHelperForTrust({
      fromProjectOrLocal,
      isNonInteractive: getIsNonInteractiveSession(),
      trustAccepted: effectiveConfig.trustAccepted(),
    })
  ) {
    return
  }
  void runProxyAuthHelper()
}

/**
 * Build undici/Bun proxy option with optional Proxy-Authorization header.
 * Official k_ densable slice: proxy: auth ? {url, headers} : url
 */
export function buildProxyOptionWithAuth(input: {
  proxyUrl: string
  proxyAuthorization: string | null | undefined
}): string | { url: string; headers: Record<string, string> } {
  if (input.proxyAuthorization) {
    return {
      url: input.proxyUrl,
      headers: { 'Proxy-Authorization': input.proxyAuthorization },
    }
  }
  return input.proxyUrl
}

/**
 * Official undici ProxyAgent densable — when Proxy-Authorization is present,
 * return ProxyAgent constructor options with `token` (undici sets the header).
 * Without auth, return null so callers keep EnvHttpProxyAgent (NO_PROXY).
 */
export function buildUndiciProxyAgentAuthOptions(input: {
  proxyUrl: string
  proxyAuthorization: string | null | undefined
  requestTls?: {
    cert?: string | Buffer
    key?: string | Buffer
    passphrase?: string
    ca?: string | string[] | Buffer
  }
  connect?: {
    cert?: string | Buffer
    key?: string | Buffer
    passphrase?: string
    ca?: string | string[] | Buffer
  }
}): {
  uri: string
  token: string
  requestTls?: {
    cert?: string | Buffer
    key?: string | Buffer
    passphrase?: string
    ca?: string | string[] | Buffer
  }
  connect?: {
    cert?: string | Buffer
    key?: string | Buffer
    passphrase?: string
    ca?: string | string[] | Buffer
  }
} | null {
  const auth = input.proxyAuthorization?.trim()
  if (!auth) return null
  return {
    uri: input.proxyUrl,
    // undici ProxyAgent `token` becomes Proxy-Authorization value
    token: auth,
    ...(input.requestTls ? { requestTls: input.requestTls } : {}),
    ...(input.connect ? { connect: input.connect } : {}),
  }
}

/**
 * Official axios/https-proxy-agent densable — headers for CONNECT with auth.
 */
export function buildHttpsProxyAgentAuthHeaders(
  proxyAuthorization: string | null | undefined,
): Record<string, string> | undefined {
  const auth = proxyAuthorization?.trim()
  if (!auth) return undefined
  return { 'Proxy-Authorization': auth }
}
