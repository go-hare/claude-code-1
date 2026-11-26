import { clearCACertsCache } from './caCerts.js'
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'
import { logForDebugging } from './debug.js'
import { HostSlot } from './hostSlot.js'
import { getBootstrapSessionHost, hasActiveSessionAls } from './sessionRoot.js'
import {
  isCoworkCloudBlockedEnvVar,
  isHostProxyEnvVar,
  isHostTransportSensitiveEnvVar,
  isPolicyTransportEnvVar,
  isProviderManagedEnvVar,
  isSafeManagedEnv,
  stripProjectScopeBlockedEnv,
} from './managedEnvConstants.js'
import { clearMTLSCache } from './mtls.js'
import {
  getProviderBoundRouteSnapshot,
  resetProviderBoundCachesIfMoved,
} from './model/modelStrings.js'
import {
  clearProxyCache,
  configureGlobalAgents,
  preserveRepairedProxyIfBare,
} from './proxy.js'
import { stripProjectScopedTracingEnv } from './projectScopedTracingStrip.js'
import { isSettingSourceEnabled } from './settings/constants.js'
import {
  envSelectsProviderOrGateway,
  isDesktopCodeTabSession,
  isLocalThirdPartyDesktopManagedSession,
  MANAGED_SUBAGENT_MODEL_ENV_KEYS,
} from './settings/hostModelOverlay.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'

type ManagedEnvHostState = {
  /** densable $Ss — warn once per stripped settings.env key under host-managed. */
  hostManagedStripWarnedKeys: Set<string>
  /**
   * Snapshot of env keys present before any settings.env is applied — for CCD,
   * these are the keys the desktop host set to orchestrate the subprocess.
   * Lazy-captured on first applySafeConfigEnvironmentVariables() call.
   * densable `ndr` — also consulted by OTEL supremacy drop.
   */
  ccdSpawnEnvKeys: Set<string> | null | undefined
  /**
   * densable VQr / gyo — freeze process.env before settings.env is applied.
   */
  frozenStartupEnv: Readonly<Record<string, string>> | undefined
  /** densable `_612` `appliedGlobalConfigEnv` / `Tn` / `QYb` */
  appliedGlobalConfigEnv: Record<string, string> | undefined
  /**
   * Official 2.1.323 (#2076): Retain organization's managed proxy and CA
   * transport env vars (`V7r`) across startup reloads.
   */
  latchedPolicyTransportEnv: Record<string, string>
  /** densable wDs — warn once per dropped key per host. */
  otelManagedDropWarned: Set<string>
}

/**
 * Clean process startup env snapshot captured at module evaluation time —
 * BEFORE `entry.ts` / `init.ts` mutates `process.env` with `userSettings.env`
 * or `globalConfig.env`.
 */
const PROCESS_BOOT_ENV_SNAPSHOT: Readonly<Record<string, string | undefined>> =
  Object.freeze({ ...process.env })

/**
 * Pre-settings startup env snapshot latched when the default boot host runs
 * `applySafeConfigEnvironmentVariables()` / `applyConfigEnvironmentVariables()`.
 */
let bootStartupEnvSnapshot: Readonly<Record<string, string>> | undefined

/**
 * Global config env applied on the default boot host (`!hasActiveSessionAls()`),
 * used as fallback for isolated ACP hosts whose own host state has not called
 * `applySafeConfigEnvironmentVariables()`.
 */
let bootAppliedGlobalConfigEnv: Record<string, string> | undefined

/**
 * Tracks whether `clearFrozenStartupEnvForTests()` reset the boot snapshot on
 * the default host so tests setting synthetic `process.env` vars before freeze
 * can re-capture them cleanly.
 */
let bootEnvClearedForTests = false

function snapshotDefinedEnv(
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const copy: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      copy[key] = value
    }
  }
  return Object.freeze(copy)
}

// Official 2.1.331 [W-062]: per-host managed env state on SessionHost.
const managedEnvHostSlot = new HostSlot<ManagedEnvHostState>(() => ({
  hostManagedStripWarnedKeys: new Set(),
  ccdSpawnEnvKeys: undefined,
  frozenStartupEnv: undefined,
  appliedGlobalConfigEnv: undefined,
  latchedPolicyTransportEnv: {},
  otelManagedDropWarned: new Set(),
}))

function getManagedEnvHostState(): ManagedEnvHostState {
  return managedEnvHostSlot.of(getBootstrapSessionHost())
}

/**
 * densable s_o — warn that settings-sourced provider/auth/transport env is ignored.
 */
export function warnHostManagedSettingsEnvIgnored(
  key: string,
  source: string,
): void {
  const { hostManagedStripWarnedKeys } = getManagedEnvHostState()
  if (hostManagedStripWarnedKeys.has(key)) return
  hostManagedStripWarnedKeys.add(key)
  logForDebugging(
    `Ignoring ${key} from ${source} — this session's provider routing is managed by the host (CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST or a host-auth-callback marker), so settings-sourced provider/auth configuration does not apply.`,
    { level: 'warn' },
  )
}

/** Test helper densable kyy fragment — clear strip-warn set. */
export function clearHostManagedSettingsEnvStripWarnsForTests(): void {
  getManagedEnvHostState().hostManagedStripWarnedKeys.clear()
}

/**
 * `claude ssh` remote: ANTHROPIC_UNIX_SOCKET routes auth through a -R forwarded
 * socket to a local proxy, and the launcher sets a handful of placeholder auth
 * env vars that the remote's ~/.claude settings.env MUST NOT clobber (see
 * isAnthropicAuthEnabled). Strip them from any settings-sourced env object.
 */
function withoutSSHTunnelVars(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env || !process.env.ANTHROPIC_UNIX_SOCKET) return env || {}
  const {
    ANTHROPIC_UNIX_SOCKET: _1,
    ANTHROPIC_BASE_URL: _2,
    ANTHROPIC_API_KEY: _3,
    ANTHROPIC_AUTH_TOKEN: _4,
    CLAUDE_CODE_OAUTH_TOKEN: _5,
    ...rest
  } = env
  // densable's scrub set also covers every CLAUDE_CODE_ARTIFACT* key: artifact
  // hosting is wired up by the local launcher, so a remote's settings.env must
  // not redirect it. Upstream ORs in one further predicate we have not
  // identified; the prefix half is unambiguous, so only it is ported.
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(rest)) {
    if (key.toUpperCase().startsWith('CLAUDE_CODE_ARTIFACT')) continue
    out[key] = value
  }
  return out
}

/**
 * densable managedByHostFlag — CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST only
 * (not HOST_AUTH_ENV_VAR alone; that is managedByHost for provider strip).
 */
function isProviderManagedByHostFlag(): boolean {
  let providerManagedByHost = isEnvTruthy(
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST,
  )
  try {
    const { isProviderManagedByHostEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    providerManagedByHost = isProviderManagedByHostEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  return providerManagedByHost
}

/**
 * densable managedByHost — PROVIDER_MANAGED_BY_HOST or host-auth-callback marker.
 */
function isManagedByHostSession(): boolean {
  if (isProviderManagedByHostFlag()) return true
  return Boolean(process.env.CLAUDE_CODE_HOST_AUTH_ENV_VAR)
}

/**
 * densable byy host-managed branch of settings.env filter (pure).
 * When the host owns inference routing (CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
 * and/or host-auth marker), strip provider-selection / model-default vars,
 * and under managedByHostFlag also strip densable LGm (mTLS/CA/OAuth scopes/
 * TLS reject) + PGm (HTTP(S)_PROXY/NO_PROXY) so repo settings cannot break
 * Desktop host-injected transport (2.1.212 #19).
 *
 * densable s_o warns once per stripped key when `onStrip` is provided (or
 * default warnHostManagedSettingsEnvIgnored when source is set).
 */
export function stripHostManagedSettingsEnv(
  env: Record<string, string> | undefined,
  opts: {
    managedByHost: boolean
    managedByHostFlag: boolean
    desktopHost?: boolean
    desktopCodeTab?: boolean
    localThirdPartyDesktop?: boolean
    coworkCloud?: boolean
    policyTransportEnv?: boolean
    source?: string
    onStrip?: (key: string, source: string) => void
  },
): Record<string, string> {
  if (!env) return {}
  const {
    managedByHost,
    managedByHostFlag,
    desktopHost = false,
    desktopCodeTab = false,
    localThirdPartyDesktop = false,
    coworkCloud = false,
    policyTransportEnv = false,
  } = opts
  if (
    !managedByHost &&
    !managedByHostFlag &&
    !coworkCloud &&
    !policyTransportEnv
  ) {
    return env
  }
  const source = opts.source ?? 'settings'
  const isProjectOrLocal =
    source === 'projectSettings' || source === 'localSettings'
  const stripTransportAndProxy =
    managedByHostFlag && (!desktopHost || isProjectOrLocal)
  const onStrip = opts.onStrip ?? warnHostManagedSettingsEnvIgnored
  const selectsProviderOrGateway =
    desktopCodeTab && source === 'policySettings'
      ? envSelectsProviderOrGateway(env)
      : false
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    // Official 2.1.319 (#1808): coworkCloud blocks all proxy/transport vars
    // (including CLAUDE_CODE_PROXY_RESOLVES_HOSTS) from any settings file.
    if (coworkCloud && isCoworkCloudBlockedEnvVar(key)) {
      onStrip(key, source)
      continue
    }
    // Official 2.1.319 (#1808): policyTransportEnv blocks V7r transport vars
    // (including CLAUDE_CODE_PROXY_RESOLVES_HOSTS) from settings files where
    // the host manages the network.
    if (policyTransportEnv && isPolicyTransportEnvVar(key)) {
      onStrip(key, source)
      continue
    }
    if (!managedByHost && !managedByHostFlag) {
      out[key] = value
      continue
    }
    const upper = key.toUpperCase()
    // Official 2.1.323 (#1968) `le`: preserve CLAUDE_CODE_AUTO_MODE_MODEL in
    // managed settings for local Claude Desktop sessions on third-party providers.
    if (
      localThirdPartyDesktop &&
      source === 'policySettings' &&
      upper === 'CLAUDE_CODE_AUTO_MODE_MODEL'
    ) {
      out[key] = value
      continue
    }
    // Official 2.1.326 (#21) `Le` + `Jns`: preserve managed subagent model env
    // vars in Claude Desktop Code tab sessions unless the same managed settings
    // env also selects a third-party provider or gateway.
    if (
      desktopCodeTab &&
      source === 'policySettings' &&
      MANAGED_SUBAGENT_MODEL_ENV_KEYS.has(upper)
    ) {
      if (selectsProviderOrGateway) {
        onStrip(key, source)
      } else {
        out[key] = value
      }
      continue
    }
    // densable PLn provider routing — strip when managedByHost
    if (isProviderManagedEnvVar(key) && managedByHost) {
      onStrip(key, source)
      continue
    }
    // densable ANTHROPIC_CUSTOM_HEADERS under managedByHost
    if (managedByHost && upper === 'ANTHROPIC_CUSTOM_HEADERS') {
      onStrip(key, source)
      continue
    }
    // densable LLn / KVt (#809) — when managedByHostFlag, strip proxy/CA/git-TLS/git-config
    // vars; under Claude Desktop (`desktopHost`), only in project/local settings (`hfe`).
    if (stripTransportAndProxy && isHostProxyEnvVar(key)) {
      onStrip(key, source)
      continue
    }
    if (stripTransportAndProxy && isHostTransportSensitiveEnvVar(key)) {
      onStrip(key, source)
      continue
    }
    out[key] = value
  }
  return out
}

function isCoworkCloudSession(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK) ||
    process.env.CLAUDE_CODE_ENTRYPOINT === 'cowork-cloud'
  )
}

function isPolicyTransportManagedByHost(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
    Boolean(process.env.ANTHROPIC_UNIX_SOCKET)
  )
}

function withoutHostManagedProviderVars(
  env: Record<string, string> | undefined,
  source = 'settings',
): Record<string, string> {
  return stripHostManagedSettingsEnv(env, {
    managedByHost: isManagedByHostSession(),
    managedByHostFlag: isProviderManagedByHostFlag(),
    desktopHost: process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop',
    desktopCodeTab: isDesktopCodeTabSession(),
    localThirdPartyDesktop: isLocalThirdPartyDesktopManagedSession(),
    coworkCloud: isCoworkCloudSession(),
    policyTransportEnv: isPolicyTransportManagedByHost(),
    source,
  })
}

function pickPolicyTransportEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (isPolicyTransportEnvVar(key)) {
      out[key] = value
    }
  }
  return out
}

/**
 * Official 2.1.323 (#2193): Environment for managed settings `policyHelper`
 * execution — constructed ONLY from the launching shell snapshot
 * (`getFrozenStartupEnv()`) overlaid with managed `policySettings.env`
 * (never taking env vars from user, project, local, or `--settings` files).
 */
export function getPolicyHelperEnv(): Record<string, string> {
  return getMcpPolicyPrimaryEnv()
}

/**
 * densable VQr — capture and freeze process.env on first call.
 * Safe to call repeatedly; subsequent calls return the same snapshot.
 * Fresh isolated SessionHosts initialize from the clean pre-settings boot
 * snapshot (`bootStartupEnvSnapshot` / `PROCESS_BOOT_ENV_SNAPSHOT`) so they are
 * never polluted by `entry.ts`'s `userSettings.env` / `globalConfig.env`.
 */
export function getFrozenStartupEnv(): Readonly<Record<string, string>> {
  const state = getManagedEnvHostState()
  if (state.frozenStartupEnv === undefined) {
    if (bootStartupEnvSnapshot !== undefined) {
      state.frozenStartupEnv = Object.freeze({ ...bootStartupEnvSnapshot })
    } else if (!bootEnvClearedForTests) {
      state.frozenStartupEnv = snapshotDefinedEnv(PROCESS_BOOT_ENV_SNAPSHOT)
    } else {
      state.frozenStartupEnv = snapshotDefinedEnv(process.env)
    }
  }
  return state.frozenStartupEnv
}

/** Test helper densable Qmy/q_s — clear VQr freeze so tests can re-capture. */
export function clearFrozenStartupEnvForTests(): void {
  const state = getManagedEnvHostState()
  state.frozenStartupEnv = undefined
  state.appliedGlobalConfigEnv = undefined
  state.latchedPolicyTransportEnv = {}
  if (!hasActiveSessionAls()) {
    bootStartupEnvSnapshot = undefined
    bootAppliedGlobalConfigEnv = undefined
    bootEnvClearedForTests = true
  }
}

/** densable `rt` / `QYb` / `Tn` — latch written by applySafeConfigEnvironmentVariables. */
export function getAppliedGlobalConfigEnv():
  | Record<string, string>
  | undefined {
  return (
    getManagedEnvHostState().appliedGlobalConfigEnv ??
    bootAppliedGlobalConfigEnv
  )
}

/**
 * densable SLt-filtered settings.env for a source (strips host-managed /
 * SSH tunnel / CCD spawn keys). Used by MCP policy predicate expansion.
 */
export function getFilteredSettingsEnv(
  env: Record<string, string> | undefined,
  source = 'settings',
): Record<string, string> {
  return filterSettingsEnv(env, source)
}

/**
 * densable Y6u — primary env for MCP policy `${VAR}` expansion:
 * frozen startup process.env overlaid with managed/policy settings.env.
 * Project/user settings-file env is intentionally NOT included.
 */
export function getMcpPolicyPrimaryEnv(): Record<string, string> {
  const managed: Record<string, string> = {}
  // densable zQ managed tiers → first-wins into e, then {...VQr(), ...e}.
  // Local policySettings is the merged managed settings object.
  const policyEnv = filterSettingsEnv(
    getSettingsForSource('policySettings')?.env,
    'policySettings',
  )
  for (const [key, value] of Object.entries(policyEnv)) {
    managed[key] ??= value
  }
  return { ...getFrozenStartupEnv(), ...managed }
}

/**
 * densable Hyy — deny-path expansion env + fallbackEnv chain
 * (globalConfig / user / flag / policy settings.env after SLt filters).
 * Allow path uses only getMcpPolicyPrimaryEnv() (Y6u), no fallback.
 */
export function getMcpPolicyDenyExpansionEnv(): {
  env: Record<string, string>
  fallbackEnv: Record<string, string>
} {
  const fallbackEnv: Record<string, string> = {
    ...filterSettingsEnv(getGlobalConfig().env, 'globalConfig'),
    ...(isSettingSourceEnabled('userSettings')
      ? filterSettingsEnv(
          getSettingsForSource('userSettings')?.env,
          'userSettings',
        )
      : {}),
    ...filterSettingsEnv(
      getSettingsForSource('flagSettings')?.env,
      'flagSettings',
    ),
    ...filterSettingsEnv(
      getSettingsForSource('policySettings')?.env,
      'policySettings',
    ),
  }
  return { env: getMcpPolicyPrimaryEnv(), fallbackEnv }
}

/**
 * densable 2.1.217 #9 — managed OTEL supremacy (`dTd` / `tdr`).
 *
 * When policySettings sets `OTEL_EXPORTER_OTLP_ENDPOINT` (or signal-specific
 * OTEL keys / otelHeadersHelper), lower-trust scopes must not keep
 * OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS,PROFILES}_* overrides that would
 * redirect telemetry away from the managed endpoint (OTEL SDK prefers
 * signal-specific env over the base ENDPOINT).
 */
const OTEL_OTLP_PREFIX = 'OTEL_EXPORTER_OTLP_'
const OTEL_SIGNALS = ['TRACES', 'METRICS', 'LOGS', 'PROFILES'] as const
const OTEL_NON_ENDPOINT_SUFFIXES = new Set([
  'HEADERS',
  'CLIENT_KEY',
  'CLIENT_CERTIFICATE',
])

/**
 * densable `dropDominatedOtelKey` / `tdr` — delete process.env[key] when not
 * claimed by managed policy map and not host-orchestrated spawn-protected.
 * Warn format: `${claimKey} is claimed by ${claimSource}`.
 */
function dropLowerTrustOtelEnvKey(
  key: string,
  redirectTarget: string,
  claimKey: string,
  policyEnvUpper: Map<string, string>,
  claimSource = 'managed settings',
): void {
  // densable: if policy map already claims this key (same value in env), keep it.
  if (policyEnvUpper.get(key) === process.env[key]) return
  // densable hostSpawnEnvKeys?.has(t.toUpperCase()) — case-insensitive protect.
  if (hostSpawnHasKey(key)) return
  if (process.env[key] === undefined) return
  const { otelManagedDropWarned } = getManagedEnvHostState()
  if (!otelManagedDropWarned.has(key)) {
    otelManagedDropWarned.add(key)
    logForDebugging(
      `Dropping ${key}: ${claimKey} is claimed by ${claimSource}, so lower-trust scopes cannot redirect ${redirectTarget}`,
      { level: 'warn' },
    )
  }
  delete process.env[key]
}

const BETA_TRACING_ENDPOINT = 'BETA_TRACING_ENDPOINT'
const BETA_TRACING_REDIRECT =
  'the logs and traces signals through detailed beta tracing'
/** densable `u` — pinned claim in applyOtelFamilyClaims. */
const CLAUDE_CODE_ENABLE_TELEMETRY = 'CLAUDE_CODE_ENABLE_TELEMETRY'
/** densable `P` — logs/traces exporter keys that can dominate beta tracing. */
const OTEL_LOGS_OR_TRACES_EXPORTER = new Set([
  'OTEL_LOGS_EXPORTER',
  'OTEL_TRACES_EXPORTER',
])

function hostSpawnHasKey(key: string): boolean {
  const { ccdSpawnEnvKeys } = getManagedEnvHostState()
  if (!ccdSpawnEnvKeys) return false
  const upper = key.toUpperCase()
  for (const spawnKey of ccdSpawnEnvKeys) {
    if (spawnKey.toUpperCase() === upper) return true
  }
  return false
}

/** densable `j` — comma list does not include the `otlp` exporter token. */
function isNonOtlpLogsOrTracesExporter(value: string): boolean {
  return !value
    .split(',')
    .map(s => s.trim())
    .includes('otlp')
}

/**
 * densable `dropDominatedBetaTracingEndpoint` — delete BETA_TRACING_ENDPOINT
 * via dropDominatedOtelKey when a higher-trust claim is pinned.
 * Exported for unit tests.
 */
export function dropDominatedBetaTracingEndpoint(
  claimKey: string,
  policyEnvUpper: Map<string, string>,
  claimSource = 'managed settings',
): void {
  dropLowerTrustOtelEnvKey(
    BETA_TRACING_ENDPOINT,
    BETA_TRACING_REDIRECT,
    claimKey,
    policyEnvUpper,
    claimSource,
  )
}

/**
 * densable `hostSpawnOtelClaims` — host-orchestrated spawn keys that may pin
 * beta-tracing dominance (`P` exporters, `u` telemetry flag, or OTLP family
 * when an OTLP `_ENDPOINT` / `BETA_TRACING_ENDPOINT` is already pinned).
 */
function hostSpawnOtelClaims(): Map<string, string> {
  const claims = new Map<string, string>()
  const { ccdSpawnEnvKeys } = getManagedEnvHostState()
  if (!ccdSpawnEnvKeys) return claims
  const pinned = [...ccdSpawnEnvKeys].some(key => {
    const upper = key.toUpperCase()
    return (
      ((upper.startsWith(OTEL_OTLP_PREFIX) && upper.endsWith('_ENDPOINT')) ||
        upper === BETA_TRACING_ENDPOINT) &&
      (process.env[key] ?? '').trim() !== ''
    )
  })
  for (const key of ccdSpawnEnvKeys) {
    const upper = key.toUpperCase()
    const exporterOrTelemetry =
      OTEL_LOGS_OR_TRACES_EXPORTER.has(upper) ||
      upper === CLAUDE_CODE_ENABLE_TELEMETRY
    const otlpFamily = pinned && upper.startsWith(OTEL_OTLP_PREFIX)
    if (!exporterOrTelemetry && !otlpFamily) continue
    const value = process.env[key]
    // densable hostSpawnOtelClaims t.set(o,C) — spawn key identity (`c` is id).
    if (value !== undefined) claims.set(key, value)
  }
  return claims
}

/**
 * densable `applyOtelFamilyClaims` — drop BETA_TRACING_ENDPOINT (and dominated
 * OTLP signal keys) when a higher-trust claim is pinned.
 *
 * Exported for unit tests.
 */
export function applyOtelFamilyClaims(
  claims: Map<string, string>,
  policyEnvUpper: Map<string, string>,
  claimSource = 'managed settings',
): void {
  for (const [claimKey, value] of claims) {
    // densable `c(o)` is identity; gold hostSpawnEnvKeys are already uppercase.
    const E = claimKey.toUpperCase()
    if (E === CLAUDE_CODE_ENABLE_TELEMETRY) {
      if (process.env[claimKey] === value && !isEnvTruthy(value)) {
        dropDominatedBetaTracingEndpoint(claimKey, policyEnvUpper, claimSource)
      }
      continue
    }
    if (OTEL_LOGS_OR_TRACES_EXPORTER.has(E)) {
      if (
        process.env[claimKey] === value &&
        isNonOtlpLogsOrTracesExporter(value)
      ) {
        dropDominatedBetaTracingEndpoint(claimKey, policyEnvUpper, claimSource)
      }
      continue
    }
    if (!E.startsWith(OTEL_OTLP_PREFIX)) continue
    if (value.trim() === '') continue
    if (process.env[claimKey] !== value) continue

    const signal = OTEL_SIGNALS.find(s =>
      E.startsWith(`${OTEL_OTLP_PREFIX}${s}_`),
    )
    if (signal) {
      const suffix = E.slice(`${OTEL_OTLP_PREFIX}${signal}_`.length)
      const tracesOrLogs = signal === 'TRACES' || signal === 'LOGS'
      if (OTEL_NON_ENDPOINT_SUFFIXES.has(suffix)) {
        dropLowerTrustOtelEnvKey(
          `${OTEL_OTLP_PREFIX}${signal}_ENDPOINT`,
          `the ${signal.toLowerCase()} signal`,
          claimKey,
          policyEnvUpper,
          claimSource,
        )
        if (tracesOrLogs) {
          dropDominatedBetaTracingEndpoint(
            claimKey,
            policyEnvUpper,
            claimSource,
          )
        }
      } else if (suffix === 'ENDPOINT' && tracesOrLogs) {
        dropDominatedBetaTracingEndpoint(claimKey, policyEnvUpper, claimSource)
      }
      continue
    }

    const suffix = E.slice(OTEL_OTLP_PREFIX.length)
    const isNonEndpoint = OTEL_NON_ENDPOINT_SUFFIXES.has(suffix)
    const suffixesToStrip = isNonEndpoint ? [suffix, 'ENDPOINT'] : [suffix]
    for (const strip of suffixesToStrip) {
      for (const s of OTEL_SIGNALS) {
        dropLowerTrustOtelEnvKey(
          `${OTEL_OTLP_PREFIX}${s}_${strip}`,
          `the ${s.toLowerCase()} signal`,
          claimKey,
          policyEnvUpper,
          claimSource,
        )
      }
    }
    if (isNonEndpoint) {
      dropLowerTrustOtelEnvKey(
        `${OTEL_OTLP_PREFIX}ENDPOINT`,
        'telemetry for any signal',
        claimKey,
        policyEnvUpper,
        claimSource,
      )
    }
    if (suffixesToStrip.includes('ENDPOINT')) {
      dropDominatedBetaTracingEndpoint(claimKey, policyEnvUpper, claimSource)
    }
  }
}

/**
 * densable dTd — after policy env is applied, strip lower-trust OTEL signal
 * overrides that would bypass managed endpoint / headers.
 *
 * Exported for unit tests.
 */
export function applyManagedOtelEndpointSupremacy(): void {
  const policy = getSettingsForSource('policySettings')
  const env = policy?.env
  const headersHelper =
    typeof policy?.otelHeadersHelper === 'string'
      ? policy.otelHeadersHelper.trim()
      : ''
  const hasHeadersHelper = headersHelper !== ''

  const policyEnvUpper = new Map<string, string>()
  for (const [k, v] of Object.entries(env ?? {})) {
    const upper = k.toUpperCase()
    if (!policyEnvUpper.has(upper) || k === upper) {
      policyEnvUpper.set(upper, String(v))
    }
  }

  applyOtelFamilyClaims(
    hostSpawnOtelClaims(),
    policyEnvUpper,
    'the host spawn env',
  )
  if (!env && !hasHeadersHelper) return

  if (hasHeadersHelper) {
    // densable: claimKey is literal "otelHeadersHelper"; claimSource default.
    for (const signal of OTEL_SIGNALS) {
      dropLowerTrustOtelEnvKey(
        `${OTEL_OTLP_PREFIX}${signal}_ENDPOINT`,
        `the ${signal.toLowerCase()} signal`,
        'otelHeadersHelper',
        policyEnvUpper,
      )
    }
    dropLowerTrustOtelEnvKey(
      `${OTEL_OTLP_PREFIX}ENDPOINT`,
      'telemetry for any signal',
      'otelHeadersHelper',
      policyEnvUpper,
    )
    dropDominatedBetaTracingEndpoint('otelHeadersHelper', policyEnvUpper)
  }

  applyOtelFamilyClaims(policyEnvUpper, policyEnvUpper)
}

/** Test helper — clear densable wDs warn set. */
export function clearManagedOtelDropWarnsForTests(): void {
  getManagedEnvHostState().otelManagedDropWarned.clear()
}

/** densable `I` — strip keys present in host spawn (case-insensitive). */
function withoutCcdSpawnEnvKeys(
  env: Record<string, string> | undefined,
  source = 'settings',
): Record<string, string> {
  const { ccdSpawnEnvKeys } = getManagedEnvHostState()
  if (!env || !ccdSpawnEnvKeys) return env || {}
  const allowManagedSubagent =
    source === 'policySettings' && isDesktopCodeTabSession()
  const allowManagedAutoMode =
    source === 'policySettings' && isLocalThirdPartyDesktopManagedSession()
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase()
    if (
      !hostSpawnHasKey(key) ||
      (allowManagedSubagent && MANAGED_SUBAGENT_MODEL_ENV_KEYS.has(upper)) ||
      (allowManagedAutoMode && upper === 'CLAUDE_CODE_AUTO_MODE_MODEL')
    ) {
      out[key] = value
    }
  }
  return out
}

function applyEnvWithBareProxyGuard(
  env: Record<string, string>,
): Record<string, string> {
  let out: Record<string, string> | undefined
  for (const [key, value] of Object.entries(env)) {
    const guarded = preserveRepairedProxyIfBare(key, value)
    if (guarded !== value) {
      out ??= { ...env }
      out[key] = guarded
    }
  }
  return out ?? env
}

/**
 * Compose the strip filters applied to every settings-sourced env object.
 */
function filterSettingsEnv(
  env: Record<string, string> | undefined,
  source = 'settings',
): Record<string, string> {
  // densable N first in the gold filter chain (project/local vyr keys),
  // followed by SEA Q() PROJECT_SCOPE_BLOCKED_ENV_VARS stripping.
  return applyEnvWithBareProxyGuard(
    withoutCcdSpawnEnvKeys(
      withoutHostManagedProviderVars(
        withoutSSHTunnelVars(
          stripProjectScopeBlockedEnv(
            stripProjectScopedTracingEnv(env, source),
            source,
          ),
        ),
        source,
      ),
      source,
    ),
  )
}

/**
 * Trusted setting sources whose env vars can be applied before the trust dialog.
 *
 * - userSettings (~/.claude/settings.json): controlled by the user, not project-specific
 * - flagSettings (--settings CLI flag or SDK inline settings): explicitly passed by the user
 * - policySettings (managed settings from enterprise API or local managed-settings.json):
 *   controlled by IT/admin (highest priority, cannot be overridden)
 *
 * Project-scoped sources (projectSettings, localSettings) are excluded because they live
 * inside the project directory and could be committed by a malicious actor to redirect
 * traffic (e.g., ANTHROPIC_BASE_URL) to an attacker-controlled server.
 */
const TRUSTED_SETTING_SOURCES = [
  'userSettings',
  'flagSettings',
  'policySettings',
] as const

/**
 * Apply environment variables from trusted sources to process.env.
 * Called before the trust dialog so that user/enterprise env vars like
 * ANTHROPIC_BASE_URL take effect during first-run/onboarding.
 *
 * For trusted sources (user settings, managed settings, CLI flags), ALL env vars
 * are applied — including ones like ANTHROPIC_BASE_URL that would be dangerous
 * from project-scoped settings.
 *
 * For project-scoped sources (projectSettings, localSettings), only safe env vars
 * from the SAFE_ENV_VARS allowlist are applied. These are applied after trust is
 * fully established via applyConfigEnvironmentVariables().
 */
export function applySafeConfigEnvironmentVariables(): void {
  const state = getManagedEnvHostState()
  const isDefaultBootHost = !hasActiveSessionAls()
  // densable Put/VQr — freeze process.env before any settings.env Object.assign.
  const startupSnapshot = getFrozenStartupEnv()
  if (isDefaultBootHost && bootStartupEnvSnapshot === undefined) {
    bootStartupEnvSnapshot = startupSnapshot
  }

  // Capture CCD spawn-env keys before any settings.env is applied (once).
  if (state.ccdSpawnEnvKeys === undefined) {
    state.ccdSpawnEnvKeys =
      process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
        ? new Set(Object.keys(process.env))
        : null
  }

  // Global config (~/.claude.json) is user-controlled. In CCD mode,
  // filterSettingsEnv strips keys that were in the spawn env snapshot so
  // the desktop host's operational vars (OTEL, etc.) are not overridden.
  // densable Tn latch: appliedGlobalConfigEnv = filterSettingsEnv(L().env)
  state.appliedGlobalConfigEnv = filterSettingsEnv(
    getGlobalConfig().env,
    'globalConfig',
  )
  if (isDefaultBootHost) {
    bootAppliedGlobalConfigEnv = state.appliedGlobalConfigEnv
  }
  Object.assign(process.env, state.appliedGlobalConfigEnv)

  // Apply ALL env vars from trusted setting sources, policySettings last.
  // Gate on isSettingSourceEnabled so SDK settingSources: [] (isolation mode)
  // doesn't get clobbered by ~/.claude/settings.json env (gh#217). policy/flag
  // sources are always enabled, so this only ever filters userSettings.
  for (const source of TRUSTED_SETTING_SOURCES) {
    if (source === 'policySettings') continue
    if (!isSettingSourceEnabled(source)) continue
    Object.assign(
      process.env,
      filterSettingsEnv(getSettingsForSource(source)?.env, source),
    )
  }

  const policySettings = getSettingsForSource('policySettings')
  if (policySettings !== null) {
    state.latchedPolicyTransportEnv = pickPolicyTransportEnv(policySettings.env)
  }
  Object.assign(
    process.env,
    filterSettingsEnv(
      { ...policySettings?.env, ...state.latchedPolicyTransportEnv },
      'policySettings',
    ),
  )

  // densable gdt → dTd() after policy Object.assign: strip lower-trust OTEL
  // signal endpoints so OTEL SDK cannot prefer them over managed ENDPOINT.
  applyManagedOtelEndpointSupremacy()

  // Apply only safe env vars from the fully-merged settings (which includes
  // project-scoped sources). For safe vars that also exist in trusted sources,
  // the merged value (which may come from a higher-priority project source)
  // will overwrite the trusted value — this is acceptable since these vars are
  // in the safe allowlist. Only policySettings values are guaranteed to survive
  // unchanged (it has the highest merge priority in both loops) — except
  // provider-routing vars + densable LGm transport vars, which filterSettingsEnv
  // strips from every source when CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST is set.
  // Note: SAFE_ENV_VARS does not include OTEL_*_ENDPOINT, so project cannot
  // re-introduce signal endpoints after dTd.
  const settingsEnv = filterSettingsEnv(
    getSettings_DEPRECATED()?.env,
    'settings',
  )
  for (const [key, value] of Object.entries(settingsEnv)) {
    // densable B7t: LEh always-safe OR MEh when truthy
    if (isSafeManagedEnv(key, value)) {
      process.env[key] = value
    }
  }
}

/**
 * Apply safe config environment variables for a sole ACP session (including
 * project-scoped `<repo>/.claude/settings.json` and `settings.local.json` safe
 * `env` vars) while snapshotting the previous `process.env` value of every
 * modified key. Returns an idempotent rollback callback that restores
 * `process.env` cleanly on teardown (or if a second concurrent session starts).
 */
export function applySafeConfigEnvironmentVariablesForAcpSession(
  preloadedMergedSettingsEnv?: Record<string, string>,
): () => void {
  const state = getManagedEnvHostState()
  getFrozenStartupEnv()

  if (state.ccdSpawnEnvKeys === undefined) {
    state.ccdSpawnEnvKeys =
      process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
        ? new Set(Object.keys(process.env))
        : null
  }

  const previousValues = new Map<string, string | undefined>()
  const setTracked = (key: string, value: string): void => {
    if (!previousValues.has(key)) {
      previousValues.set(
        key,
        Object.hasOwn(process.env, key) ? process.env[key] : undefined,
      )
    }
    process.env[key] = value
  }

  const mergedEnv =
    preloadedMergedSettingsEnv !== undefined
      ? preloadedMergedSettingsEnv
      : getSettings_DEPRECATED()?.env
  const settingsEnv = filterSettingsEnv(mergedEnv, 'settings')
  for (const [key, value] of Object.entries(settingsEnv)) {
    if (isSafeManagedEnv(key, value)) {
      setTracked(key, value)
    }
  }

  let rolledBack = false
  return () => {
    if (rolledBack) return
    rolledBack = true
    for (const [key, prev] of previousValues) {
      if (prev === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = prev
      }
    }
    previousValues.clear()
  }
}

/**
 * Apply environment variables from settings to process.env.
 * This applies ALL environment variables (except provider-routing vars when
 * CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST is set — see filterSettingsEnv) and
 * should only be called after trust is established. This applies potentially
 * dangerous environment variables such as LD_PRELOAD, PATH, etc.
 */
export function applyConfigEnvironmentVariables(): void {
  const isDefaultBootHost = !hasActiveSessionAls()
  // densable pz/Put — ensure VQr freeze even if safe-path was skipped.
  const startupSnapshot = getFrozenStartupEnv()
  if (isDefaultBootHost && bootStartupEnvSnapshot === undefined) {
    bootStartupEnvSnapshot = startupSnapshot
  }

  // Official 2.1.327 (#436) `V_l` / `Rxl`: snapshot provider/routing env before
  // applying project settings so setting ANTHROPIC_BASE_URL to an LLM gateway
  // invalidates stale first-party model caches.
  const previousProviderRoute = getProviderBoundRouteSnapshot()

  const state = getManagedEnvHostState()
  state.appliedGlobalConfigEnv = filterSettingsEnv(
    getGlobalConfig().env,
    'globalConfig',
  )
  if (isDefaultBootHost) {
    bootAppliedGlobalConfigEnv = state.appliedGlobalConfigEnv
  }
  Object.assign(process.env, state.appliedGlobalConfigEnv)

  Object.assign(
    process.env,
    filterSettingsEnv(getSettings_DEPRECATED()?.env, 'settings'),
  )

  // densable Sz → dTd() after settings env Object.assign (policy wins merge).
  applyManagedOtelEndpointSupremacy()

  // Official 2.1.327 (#436): reset provider-bound model caches if route moved.
  resetProviderBoundCachesIfMoved(previousProviderRoute)

  // Clear caches so agents are rebuilt with the new env vars
  clearCACertsCache()
  clearMTLSCache()
  clearProxyCache()

  // Reconfigure proxy/mTLS agents to pick up any proxy env vars from settings
  configureGlobalAgents()

  // Official b4t densable — async reload client cert/key file contents after
  // settings env may have changed CLAUDE_CODE_CLIENT_CERT/KEY paths.
  void import('./mtls.js')
    .then(m => m.reloadMtlsCertsFromEnvAsync())
    .then(changed => {
      if (changed) {
        clearProxyCache()
        configureGlobalAgents()
      }
    })
    .catch(() => {
      // densable optional
    })
}
