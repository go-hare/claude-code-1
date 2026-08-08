import { isRemoteManagedSettingsEligible } from '../services/remoteManagedSettings/syncCache.js'
import { clearCACertsCache } from './caCerts.js'
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'
import { logForDebugging } from './debug.js'
import {
  isHostProxyEnvVar,
  isHostTransportSensitiveEnvVar,
  isProviderManagedEnvVar,
  isSafeManagedEnv,
} from './managedEnvConstants.js'
import { clearMTLSCache } from './mtls.js'
import { clearProxyCache, configureGlobalAgents } from './proxy.js'
import { isSettingSourceEnabled } from './settings/constants.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'

/** densable $Ss — warn once per stripped settings.env key under host-managed. */
const hostManagedStripWarnedKeys = new Set<string>()

/**
 * densable s_o — warn that settings-sourced provider/auth/transport env is ignored.
 */
export function warnHostManagedSettingsEnvIgnored(
  key: string,
  source: string,
): void {
  if (hostManagedStripWarnedKeys.has(key)) return
  hostManagedStripWarnedKeys.add(key)
  logForDebugging(
    `Ignoring ${key} from ${source} — this session's provider routing is managed by the host (CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST or a host-auth-callback marker), so settings-sourced provider/auth configuration does not apply.`,
    { level: 'warn' },
  )
}

/** Test helper densable kyy fragment — clear strip-warn set. */
export function clearHostManagedSettingsEnvStripWarnsForTests(): void {
  hostManagedStripWarnedKeys.clear()
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
  return rest
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
    source?: string
    onStrip?: (key: string, source: string) => void
  },
): Record<string, string> {
  if (!env) return {}
  const { managedByHost, managedByHostFlag } = opts
  if (!managedByHost && !managedByHostFlag) {
    return env
  }
  const source = opts.source ?? 'settings'
  const onStrip = opts.onStrip ?? warnHostManagedSettingsEnvIgnored
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    // densable PLn provider routing — strip when managedByHost
    if (isProviderManagedEnvVar(key) && managedByHost) {
      onStrip(key, source)
      continue
    }
    // densable ANTHROPIC_CUSTOM_HEADERS under managedByHost
    if (managedByHost && key.toUpperCase() === 'ANTHROPIC_CUSTOM_HEADERS') {
      onStrip(key, source)
      continue
    }
    // densable LLn / KVt — only when managedByHostFlag (PROVIDER_MANAGED_BY_HOST)
    if (managedByHostFlag && isHostProxyEnvVar(key)) {
      onStrip(key, source)
      continue
    }
    if (managedByHostFlag && isHostTransportSensitiveEnvVar(key)) {
      onStrip(key, source)
      continue
    }
    out[key] = value
  }
  return out
}

function withoutHostManagedProviderVars(
  env: Record<string, string> | undefined,
  source = 'settings',
): Record<string, string> {
  return stripHostManagedSettingsEnv(env, {
    managedByHost: isManagedByHostSession(),
    managedByHostFlag: isProviderManagedByHostFlag(),
    source,
  })
}

/**
 * Snapshot of env keys present before any settings.env is applied — for CCD,
 * these are the keys the desktop host set to orchestrate the subprocess.
 * Settings must not override them (OTEL_LOGS_EXPORTER=console would corrupt
 * the stdio JSON-RPC transport). Keys added LATER by user/project settings
 * are not in this set, so mid-session settings.json changes still apply.
 * Lazy-captured on first applySafeConfigEnvironmentVariables() call.
 *
 * densable `ndr` — also consulted by OTEL supremacy drop so host-orchestrated
 * spawn keys are never deleted.
 */
let ccdSpawnEnvKeys: Set<string> | null | undefined

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
/** densable wDs — warn once per dropped key per process. */
const otelManagedDropWarned = new Set<string>()

/**
 * densable tdr — delete process.env[key] when not claimed by managed policy map
 * and not host-orchestrated spawn-protected.
 */
function dropLowerTrustOtelEnvKey(
  key: string,
  redirectTarget: string,
  claimSource: string,
  policyEnvUpper: Map<string, string>,
): void {
  // densable: if policy map already claims this key (same value in env), keep it.
  if (policyEnvUpper.get(key) === process.env[key]) return
  // densable ndr — host-orchestrated spawn keys are protected.
  if (ccdSpawnEnvKeys?.has(key)) return
  if (process.env[key] === undefined) return
  if (!otelManagedDropWarned.has(key)) {
    otelManagedDropWarned.add(key)
    logForDebugging(
      `Dropping ${key}: managed settings claim ${claimSource}, so lower-trust scopes cannot redirect ${redirectTarget}`,
      { level: 'warn' },
    )
  }
  delete process.env[key]
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
  if (!env && !hasHeadersHelper) return

  // densable: upper-case key map; prefer exact-case when both present.
  const policyEnvUpper = new Map<string, string>()
  for (const [k, v] of Object.entries(env ?? {})) {
    const upper = k.toUpperCase()
    if (!policyEnvUpper.has(upper) || k === upper) {
      policyEnvUpper.set(upper, String(v))
    }
  }

  if (hasHeadersHelper) {
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
  }

  for (const [key, value] of policyEnvUpper) {
    if (!key.startsWith(OTEL_OTLP_PREFIX)) continue
    if (value.trim() === '') continue
    // densable: only act when process.env already holds the managed value
    // (policy Object.assign just applied it).
    if (process.env[key] !== value) continue

    const signal = OTEL_SIGNALS.find(s =>
      key.startsWith(`${OTEL_OTLP_PREFIX}${s}_`),
    )
    if (signal) {
      // densable: signal-scoped HEADERS/CLIENT_* claims drop that signal's ENDPOINT.
      const suffix = key.slice(`${OTEL_OTLP_PREFIX}${signal}_`.length)
      if (OTEL_NON_ENDPOINT_SUFFIXES.has(suffix)) {
        dropLowerTrustOtelEnvKey(
          `${OTEL_OTLP_PREFIX}${signal}_ENDPOINT`,
          `the ${signal.toLowerCase()} signal`,
          key,
          policyEnvUpper,
        )
      }
      continue
    }

    // densable: base key OTEL_EXPORTER_OTLP_{SUFFIX}
    const suffix = key.slice(OTEL_OTLP_PREFIX.length)
    const isNonEndpoint = OTEL_NON_ENDPOINT_SUFFIXES.has(suffix)
    const suffixesToStrip = isNonEndpoint ? [suffix, 'ENDPOINT'] : [suffix]
    for (const strip of suffixesToStrip) {
      for (const s of OTEL_SIGNALS) {
        dropLowerTrustOtelEnvKey(
          `${OTEL_OTLP_PREFIX}${s}_${strip}`,
          `the ${s.toLowerCase()} signal`,
          key,
          policyEnvUpper,
        )
      }
    }
    if (isNonEndpoint) {
      dropLowerTrustOtelEnvKey(
        `${OTEL_OTLP_PREFIX}ENDPOINT`,
        'telemetry for any signal',
        key,
        policyEnvUpper,
      )
    }
  }
}

/** Test helper — clear densable wDs warn set. */
export function clearManagedOtelDropWarnsForTests(): void {
  otelManagedDropWarned.clear()
}

function withoutCcdSpawnEnvKeys(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env || !ccdSpawnEnvKeys) return env || {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!ccdSpawnEnvKeys.has(key)) out[key] = value
  }
  return out
}

/**
 * Compose the strip filters applied to every settings-sourced env object.
 */
function filterSettingsEnv(
  env: Record<string, string> | undefined,
  source = 'settings',
): Record<string, string> {
  return withoutCcdSpawnEnvKeys(
    withoutHostManagedProviderVars(withoutSSHTunnelVars(env), source),
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
  // Capture CCD spawn-env keys before any settings.env is applied (once).
  if (ccdSpawnEnvKeys === undefined) {
    ccdSpawnEnvKeys =
      process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
        ? new Set(Object.keys(process.env))
        : null
  }

  // Global config (~/.claude.json) is user-controlled. In CCD mode,
  // filterSettingsEnv strips keys that were in the spawn env snapshot so
  // the desktop host's operational vars (OTEL, etc.) are not overridden.
  Object.assign(
    process.env,
    filterSettingsEnv(getGlobalConfig().env, 'globalConfig'),
  )

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

  // Compute remote-managed-settings eligibility now, with userSettings and
  // flagSettings env applied. Eligibility reads CLAUDE_CODE_USE_BEDROCK,
  // ANTHROPIC_BASE_URL — both settable via settings.env.
  // getSettingsForSource('policySettings') below consults the remote cache,
  // which guards on this. The two-phase structure makes the ordering
  // dependency visible: non-policy env → eligibility → policy env.
  isRemoteManagedSettingsEligible()

  Object.assign(
    process.env,
    filterSettingsEnv(
      getSettingsForSource('policySettings')?.env,
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
 * Apply environment variables from settings to process.env.
 * This applies ALL environment variables (except provider-routing vars when
 * CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST is set — see filterSettingsEnv) and
 * should only be called after trust is established. This applies potentially
 * dangerous environment variables such as LD_PRELOAD, PATH, etc.
 */
export function applyConfigEnvironmentVariables(): void {
  Object.assign(
    process.env,
    filterSettingsEnv(getGlobalConfig().env, 'globalConfig'),
  )

  Object.assign(
    process.env,
    filterSettingsEnv(getSettings_DEPRECATED()?.env, 'settings'),
  )

  // densable Sz → dTd() after settings env Object.assign (policy wins merge).
  applyManagedOtelEndpointSupremacy()

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
