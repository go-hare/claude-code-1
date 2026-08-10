/**
 * Official residual densable env gates (mostly pure helpers for remaining MISS).
 * Many remaining official envs are telemetry/proxy/internal; this batch covers
 * the densable product-facing ones without full denser UI consumers.
 */

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export function isFeedbackSurveyForOtelEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL)
}

/** Official CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY densable force-off. */
export function isFeedbackSurveyEnvDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY)
}

export function isProxyAuthHelperEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER)
}

/** Official fNm default TTL for proxyAuthHelper cache (5 min). */
export const DEFAULT_PROXY_AUTH_HELPER_TTL_MS = 300_000

/**
 * Official mNm — PROXY_AUTH_HELPER_TTL_MS, allows 0; default 300_000.
 */
export function resolveProxyAuthHelperTtlMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_PROXY_AUTH_HELPER_TTL_MS
  if (raw) {
    const n = parseInt(raw, 10)
    if (!Number.isNaN(n) && n >= 0) return n
  }
  return DEFAULT_PROXY_AUTH_HELPER_TTL_MS
}

/**
 * Official Yyt — env gate + configured helper command.
 * Full shell execution / trust / cache remains denser (fkn).
 */
export function resolveProxyAuthHelperCommand(input: {
  env?: NodeJS.ProcessEnv
  helperCommand?: string | null
}): string | undefined {
  const env = input.env ?? process.env
  if (!isProxyAuthHelperEnabled(env)) return undefined
  const cmd = input.helperCommand?.trim()
  return cmd && cmd.length > 0 ? cmd : undefined
}

/**
 * Official UCl densable check — helper from project/local settings requires trust.
 * Returns true when execution should be skipped.
 */
export function shouldSkipProxyAuthHelperForTrust(input: {
  fromProjectOrLocal: boolean
  isNonInteractive?: boolean
  trustAccepted: boolean
}): boolean {
  if (!input.fromProjectOrLocal) return false
  if (input.isNonInteractive) return false
  return !input.trustAccepted
}

/**
 * Official fkn cache hit: reuse last value when age < TTL and no force-refresh.
 */
export function shouldReuseProxyAuthHelperCache(input: {
  cachedAtMs: number | undefined
  nowMs?: number
  ttlMs: number
  forceRefresh?: boolean
}): boolean {
  if (input.forceRefresh) return false
  if (input.cachedAtMs === undefined) return false
  const now = input.nowMs ?? Date.now()
  return now - input.cachedAtMs < input.ttlMs
}

/**
 * Official oKn — experimental observer agents.
 * Off when background tasks disabled; requires env + GB (default true when
 * env is on and GB not injected).
 */
/** Official CLAUDE_CODE_DISABLE_BACKGROUND_TASKS densable. */
export function isBackgroundTasksDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS)
}

export function isExperimentalObserverAgentsEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (isBackgroundTasksDisabled(env)) return false
  if (!isEnvTruthy(env.CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS)) return false
  if (input?.gbValue !== undefined) return input.gbValue
  return true
}

/** Official y1y default when env unset. */
export const DEFAULT_FABLE_BRIDGE_DIALOG_TIMEOUT_MS = 60_000

export function resolveFableBridgeDialogTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.CLAUDE_CODE_FABLE_BRIDGE_DIALOG_TIMEOUT_MS
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

/**
 * Official y1y — FABLE_BRIDGE_DIALOG_TIMEOUT_MS when >0, else 60_000.
 */
export function resolveFableBridgeDialogTimeoutMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    resolveFableBridgeDialogTimeoutMs(env) ??
    DEFAULT_FABLE_BRIDGE_DIALOG_TIMEOUT_MS
  )
}

/**
 * Official frame timing sample stride — default 1 when unset/invalid.
 * Math.max(1, env || 1).
 */
export function resolveFrameTimingSampleEvery(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_FRAME_TIMING_SAMPLE_EVERY
  if (!raw) return 1
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return 1
  return n
}

/** Official CLAUDE_CODE_FRAME_TIMING_LOG path when set. */
export function getFrameTimingLogPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_FRAME_TIMING_LOG?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function resolveGbRefreshIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.CLAUDE_CODE_GB_REFRESH_INTERVAL_MS
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

export function getOpus46FastModeOverride(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

/**
 * Official B$y — env CLAUDE_CODE_PLUGIN_BINARY_ASSETS OR GB
 * tengu_plugin_binary_assets (default false). Inject gbValue in tests.
 * When gbValue omitted, reads cached GrowthBook (lazy import avoided —
 * use pluginBinaryAssets.ts for the GB-wired consumer path).
 */
export function isPluginBinaryAssetsEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_PLUGIN_BINARY_ASSETS)) return true
  if (input?.gbValue !== undefined) return input.gbValue
  return false
}

export type PowerupOnboardingMode = 'banner' | 'step' | 'off'

/**
 * Official EVs — CLAUDE_CODE_POWERUP_ONBOARDING is "banner"|"step", else
 * GB tengu_birch_lantern default "off". Truthy legacy "1" maps to "banner".
 */
export function resolvePowerupOnboardingMode(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: PowerupOnboardingMode | string
}): PowerupOnboardingMode {
  const env = input?.env ?? process.env
  const raw = env.CLAUDE_CODE_POWERUP_ONBOARDING?.trim().toLowerCase()
  if (raw === 'banner' || raw === 'step') return raw
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return 'banner'
  }
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') {
    return 'off'
  }
  const gb = input?.gbValue
  if (gb === 'banner' || gb === 'step') return gb
  return 'off'
}

export function isPowerupOnboardingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolvePowerupOnboardingMode({ env }) !== 'off'
}

/**
 * Official tmn — CLAUDE_CODE_REMOTE && CLAUDE_CODE_REMOTE_HERMETIC_MODE.
 */
export function isRemoteHermeticModeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_REMOTE) &&
    isEnvTruthy(env.CLAUDE_CODE_REMOTE_HERMETIC_MODE)
  )
}

export type RemoteHermeticMode = boolean

export function getRemoteRawEventsFile(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_REMOTE_RAW_EVENTS_FILE?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function getRemoteSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_REMOTE_SETTINGS_PATH?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function resolveRemoteSettingsPollMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.CLAUDE_CODE_REMOTE_SETTINGS_POLL_MS
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

export function hasSdkOauthRefresh(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH)
}

/**
 * Official cRi — entrypoints that may register SDK OAuth refresh callback.
 */
export const SDK_OAUTH_REFRESH_ENTRYPOINTS = new Set([
  'claude-desktop',
  'local-agent',
  'claude-vscode',
])

/**
 * Official lfm — entrypoints that may register host-auth refresh callback.
 */
export const SDK_HOST_AUTH_REFRESH_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
])

export function hasSdkHostAuthRefresh(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH)
}

/**
 * Official: HAS_OAUTH_REFRESH && cRi.has(ENTRYPOINT).
 */
export function shouldRegisterSdkOauthRefreshCallback(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!hasSdkOauthRefresh(env)) return false
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  return entry !== undefined && SDK_OAUTH_REFRESH_ENTRYPOINTS.has(entry)
}

/**
 * Official LQ — ENTRYPOINT is in host-auth refresh allowlist.
 */
export function isSdkHostAuthRefreshEntrypoint(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  return entry !== undefined && SDK_HOST_AUTH_REFRESH_ENTRYPOINTS.has(entry)
}

/**
 * Official: HAS_HOST_AUTH_REFRESH && LQ().
 */
export function shouldRegisterSdkHostAuthRefreshCallback(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return hasSdkHostAuthRefresh(env) && isSdkHostAuthRefreshEntrypoint(env)
}

/** Official fNb / mNb default for structuredIO OAuth/host refresh control requests. */
export const DEFAULT_SDK_AUTH_REFRESH_CONTROL_TIMEOUT_MS = 30_000

export function shouldSimulateProxyUsage(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SIMULATE_PROXY_USAGE)
}

/**
 * Official SIMULATE_PROXY_USAGE filter: keep only the oauth beta header so
 * requests resemble a corporate proxy that strips other anthropic-beta values.
 */
export function filterBetasForSimulateProxyUsage(
  betas: readonly string[],
  oauthBetaHeader: string,
): string[] {
  return betas.filter(b => b === oauthBetaHeader)
}

export function getInvokedSkillName(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_SKILL_NAME?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function getInvokedSkillDescription(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_SKILL_DESCRIPTION?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function shouldSkipAnthropicAwsAuth(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH)
}

export function shouldSkipHfiVersionCheck(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_HFI_VERSION_CHECK)
}

export function shouldSkipMantleAuth(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_MANTLE_AUTH)
}

export function isAnthropicAwsProviderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_ANTHROPIC_AWS)
}

export function isMantleProviderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_MANTLE)
}

/**
 * Official kTt — peel Authorization header for skip-auth / bearer paths
 * (anthropicAws + mantle). Full SDK client branches remain denser.
 */
export function extractAuthorizationHeader(headers: Record<string, string>): {
  value: string | undefined
  rest: Record<string, string>
} {
  const rest: Record<string, string> = {}
  let value: string | undefined
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') {
      value = val
    } else {
      rest[key] = val
    }
  }
  return { value, rest }
}

/**
 * Official skip-auth apiKey from Authorization: Bearer <token> (or raw).
 */
export function apiKeyFromAuthorizationHeader(
  authorization: string | undefined,
): string | undefined {
  if (!authorization) return undefined
  const m = authorization.match(/^Bearer (.+)$/i)
  return m?.[1] ?? authorization
}

/**
 * Official DEFAULT_GB_REFRESH hardcode is still RSh(){return 21600000}.
 * Pure helper reads env when set; consumers should fall back to 6h when
 * undefined so behavior matches official until env is wired.
 */
export const OFFICIAL_GB_REFRESH_INTERVAL_MS = 21_600_000

export function resolveGbRefreshIntervalMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveGbRefreshIntervalMs(env) ?? OFFICIAL_GB_REFRESH_INTERVAL_MS
}

export function getSubscriptionType(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_SUBSCRIPTION_TYPE?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function isSyncPluginsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SYNC_PLUGINS)
}

/** Official CLAUDE_CODE_SYNC_PLUGIN_INSTALL (singular) densable. */
export function isSyncPluginInstallEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SYNC_PLUGIN_INSTALL)
}

/**
 * Official print/setup gate — SYNC_PLUGIN_INSTALL or SYNC_PLUGINS.
 */
export function isSyncPluginsOrInstallEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isSyncPluginInstallEnabled(env) || isSyncPluginsEnabled(env)
}

/** Official CLAUDE_CODE_SKIP_PROMPT_HISTORY densable. */
export function shouldSkipPromptHistory(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_PROMPT_HISTORY)
}

export function isSyncSkillsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SYNC_SKILLS)
}

/** Official Lmn default when env unset / invalid. */
export const DEFAULT_SYNC_PLUGINS_INSTALL_TIMEOUT_MS = 30_000
/** Official Jbf default. */
export const DEFAULT_SYNC_PLUGINS_MCP_TIMEOUT_MS = 10_000
/** Official GXi default download stall. */
export const DEFAULT_SYNC_PLUGINS_DOWNLOAD_STALL_MS = 60_000
/** Official Obf default. */
export const DEFAULT_SYNC_SKILLS_INSTALL_TIMEOUT_MS = 30_000
/** Official Pbf default. */
export const DEFAULT_SYNC_SKILLS_WAIT_TIMEOUT_MS = 5_000

/**
 * Official Lmn — SYNC_PLUGINS_INSTALL_TIMEOUT_MS, default 30s.
 * Also honors singular CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS (print path).
 */
export function resolveSyncPluginsInstallTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw =
    env.CLAUDE_CODE_SYNC_PLUGINS_INSTALL_TIMEOUT_MS ||
    env.CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS
  if (raw) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return DEFAULT_SYNC_PLUGINS_INSTALL_TIMEOUT_MS
}

/**
 * Optional override only — when unset returns undefined so callers can
 * await without a deadline (print path historical behavior).
 */
export function resolveSyncPluginInstallTimeoutOverrideMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw =
    env.CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS ||
    env.CLAUDE_CODE_SYNC_PLUGINS_INSTALL_TIMEOUT_MS
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

/** Official Jbf — allows 0; default 10s. */
export function resolveSyncPluginsMcpTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_SYNC_PLUGINS_MCP_TIMEOUT_MS
  if (raw !== undefined && raw !== '') {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return DEFAULT_SYNC_PLUGINS_MCP_TIMEOUT_MS
}

/** Official xHg / GXi — default 60s stall. */
export function resolveSyncPluginsDownloadStallMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_SYNC_PLUGINS_DOWNLOAD_STALL_MS
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return DEFAULT_SYNC_PLUGINS_DOWNLOAD_STALL_MS
}

export function isSyncPluginsBufferedDownloadEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SYNC_PLUGINS_BUFFERED_DOWNLOAD)
}

/**
 * Official SYNC_PLUGIN_INSTALL race helper: Promise.race against a timeout.
 * When timeoutMs <= 0, awaits work only (no deadline).
 * Returns 'timeout' | 'completed' — matches print/setup install race.
 */
export async function raceWithTimeoutMs<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ status: 'completed'; value: T } | { status: 'timeout' }> {
  if (!(timeoutMs > 0)) {
    return { status: 'completed', value: await work }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      work.then(value => ({ status: 'completed' as const, value })),
      new Promise<{ status: 'timeout' }>(resolve => {
        timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs)
      }),
    ])
    return result
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Official timeout log prefix for sync plugin install. */
export const SYNC_PLUGIN_INSTALL_TIMEOUT_LOG_PREFIX =
  'CLAUDE_CODE_SYNC_PLUGIN_INSTALL: plugin installation timed out after '

export function formatSyncPluginInstallTimeoutLog(timeoutMs: number): string {
  return `${SYNC_PLUGIN_INSTALL_TIMEOUT_LOG_PREFIX}${timeoutMs}ms`
}

/** Official Obf — default 30s. */
export function resolveSyncSkillsInstallTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_SYNC_SKILLS_INSTALL_TIMEOUT_MS
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return DEFAULT_SYNC_SKILLS_INSTALL_TIMEOUT_MS
}

/** Official Pbf — default 5s. */
export function resolveSyncSkillsWaitTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_SYNC_SKILLS_WAIT_TIMEOUT_MS
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return DEFAULT_SYNC_SKILLS_WAIT_TIMEOUT_MS
}

export function shouldTeeSdkStdout(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_TEE_SDK_STDOUT)
}

export function isTestForceDenyEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_TEST_FORCE_DENY)
}

export function isTestNoGitBash(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_TEST_NO_GIT_BASH)
}

export function isTestNoPwsh(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_TEST_NO_PWSH)
}

export function getTriggerId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_TRIGGER_ID?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

/**
 * Official CLAUDE_CODE_TUI_JUST_SWITCHED — set on /tui relaunch to
 * "fullscreen" | "default" (and similar). Presence means just switched.
 */
export function getTuiJustSwitchedValue(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_TUI_JUST_SWITCHED
  if (raw === undefined || raw === '') return undefined
  return raw
}

/** Official: env is set after a /tui renderer switch relaunch. */
export function isTuiJustSwitched(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getTuiJustSwitchedValue(env) !== undefined
}

/**
 * Official bounce detection: switched FROM fullscreen (env==="fullscreen")
 * back TO default in the same relaunch chain.
 */
export function isTuiJustSwitchedFromFullscreen(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getTuiJustSwitchedValue(env) === 'fullscreen'
}

/** Official CLAUDE_CODE_BENCH_LIVE_COUNTS — Ink live DOM/fiber sampling. */
export function isBenchLiveCountsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_BENCH_LIVE_COUNTS)
}

/** Official Ink LIVE_COUNTS_INTERVAL_MS. */
export const BENCH_LIVE_COUNTS_INTERVAL_MS = 100

export function getUltrareviewPreflightFixture(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_ULTRAREVIEW_PREFLIGHT_FIXTURE?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

/**
 * Official zlp densable pure parse — JSON fixture for ultrareview preflight.
 * Returns parsed object when valid JSON object/array; null otherwise.
 * Live network path: fetchUltrareviewPreflight in services/api/ultrareviewQuota.ts.
 */
export function parseUltrareviewPreflightFixture(input?: {
  env?: NodeJS.ProcessEnv
  raw?: string | null
}): unknown | null {
  const raw =
    input?.raw !== undefined
      ? input.raw
      : getUltrareviewPreflightFixture(input?.env)
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** Official Vlp densable shape for ULTRAREVIEW_PREFLIGHT_FIXTURE. */
export type UltrareviewPreflightAction = 'proceed' | 'confirm' | 'blocked'

export type UltrareviewPreflightFixture = {
  action: UltrareviewPreflightAction
  billing_note?: string | null
  confirm?: { title?: string; body: string } | null
  blocked?: {
    message: string
    action_url?: string | null
    reason?: string
  } | null
}

/**
 * Official Vlp densable — parse + shape-check fixture JSON (no zod dependency).
 * Invalid action / non-object → null (same as schema mismatch).
 */
export function parseUltrareviewPreflightFixtureTyped(input?: {
  env?: NodeJS.ProcessEnv
  raw?: string | null
}): UltrareviewPreflightFixture | null {
  const parsed = parseUltrareviewPreflightFixture(input)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const o = parsed as Record<string, unknown>
  if (
    o.action !== 'proceed' &&
    o.action !== 'confirm' &&
    o.action !== 'blocked'
  ) {
    return null
  }
  const result: UltrareviewPreflightFixture = {
    action: o.action,
  }
  if (o.billing_note === null || typeof o.billing_note === 'string') {
    result.billing_note = o.billing_note as string | null
  }
  if (o.confirm === null) {
    result.confirm = null
  } else if (
    o.confirm &&
    typeof o.confirm === 'object' &&
    !Array.isArray(o.confirm)
  ) {
    const c = o.confirm as Record<string, unknown>
    if (typeof c.body === 'string') {
      result.confirm = {
        body: c.body,
        ...(typeof c.title === 'string' ? { title: c.title } : {}),
      }
    }
  }
  if (o.blocked === null) {
    result.blocked = null
  } else if (
    o.blocked &&
    typeof o.blocked === 'object' &&
    !Array.isArray(o.blocked)
  ) {
    const b = o.blocked as Record<string, unknown>
    if (typeof b.message === 'string') {
      result.blocked = {
        message: b.message,
        ...(b.action_url === null || typeof b.action_url === 'string'
          ? { action_url: b.action_url as string | null }
          : {}),
        ...(typeof b.reason === 'string' ? { reason: b.reason } : {}),
      }
    }
  }
  return result
}

/**
 * Official zko densable pure — map preflight fixture to overage gate shape.
 * sessionOverageConfirmed mirrors Wzs (skip confirm after one accept).
 */
export function resolveOverageGateFromPreflightFixture(input: {
  fixture: UltrareviewPreflightFixture | null | undefined
  sessionOverageConfirmed?: boolean
}):
  | { kind: 'proceed'; billingNote: string }
  | { kind: 'needs-confirm'; body?: string; billingNote: string }
  | {
      kind: 'blocked'
      message: string
      actionUrl?: string | null
      reason?: string
    }
  | null {
  const e = input.fixture
  if (!e) return null
  const billingNote = e.billing_note ?? ''
  switch (e.action) {
    case 'proceed':
      return { kind: 'proceed', billingNote }
    case 'blocked':
      return {
        kind: 'blocked',
        message:
          e.blocked?.message ??
          'Ultrareview is unavailable for your organization.',
        actionUrl: e.blocked?.action_url ?? null,
        reason: e.blocked?.reason ?? 'server',
      }
    case 'confirm':
      if (input.sessionOverageConfirmed) {
        return { kind: 'proceed', billingNote }
      }
      return {
        kind: 'needs-confirm',
        body: e.confirm?.body,
        billingNote,
      }
    default:
      return null
  }
}

export function shouldUseGateway(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_GATEWAY)
}

/**
 * @deprecated Prefer resolveGatewayFromEnv from gatewayEnv.ts for full
 * BASE_URL + AUTH_TOKEN validation (official uRi).
 */
export { resolveGatewayFromEnv } from './gatewayEnv.js'

/** Optional workflows root / flag (official CLAUDE_CODE_WORKFLOWS). */
export function getWorkflowsEnvPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_WORKFLOWS?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export const AGENT_VIEW_RELAUNCH_ENV_KEY = 'CLAUDE_CODE_AGENT_VIEW_RELAUNCH'

export function getAgentViewRelaunch(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env[AGENT_VIEW_RELAUNCH_ENV_KEY]?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

/**
 * Official GRi — truthy CLAUDE_CODE_AGENT_VIEW_RELAUNCH then delete the env
 * key (one-shot relaunch signal for fleet/agent view).
 */
export function consumeAgentViewRelaunch(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const on = isEnvTruthy(env[AGENT_VIEW_RELAUNCH_ENV_KEY])
  delete env[AGENT_VIEW_RELAUNCH_ENV_KEY]
  return on
}

/**
 * Residual densable for CLAUDE_CODE_AGENT_RULE_DISABLED.
 * Official 2.1.207 `_5e`/`_nt` Agent(x) deny has no product consumer for this
 * env (string only appears near Bun schema noise). Kept as pure densable only.
 */
export function isAgentRuleDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_AGENT_RULE_DISABLED)
}

/**
 * Official CLAUDE_CODE_ARTIFACT force-enable densable.
 * Prefer {@link isArtifactEnvForceEnabled} from artifactGates (also respects
 * DISABLE_ARTIFACT). This residual helper is the raw env half.
 */
export function isArtifactEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // CLAUDE_CODE_ARTIFACT without DISABLE_ prefix — force-enable signal.
  return isEnvTruthy(env.CLAUDE_CODE_ARTIFACT)
}

export function getRateLimitTier(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_RATE_LIMIT_TIER?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function getBridgeSessionId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_BRIDGE_SESSION_ID?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function getProxyUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw =
    env.CLAUDE_CODE_PROXY_URL?.trim() ||
    env.CLAUDE_CODE_HTTPS_PROXY?.trim() ||
    env.CLAUDE_CODE_HTTP_PROXY?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function getProxyHost(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_PROXY_HOST?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function getProxyAuthenticate(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_PROXY_AUTHENTICATE?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function getExecPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_EXECPATH?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function getDevRawChangelogUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_DEV_RAW_CHANGELOG_URL?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function getHfiBearerToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_HFI_BEARER_TOKEN?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export function isMockRemoteSettingsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_MOCK_REMOTE_SETTINGS)
}

export function isMockTrialEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_MOCK_TRIAL)
}

export function isOtelDiagStderrEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_OTEL_DIAG_STDERR)
}

export function isByocDatadogEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_BYOC_ENABLE_DATADOG)
}

/**
 * Raw CLAUDE_CODE_CERT_STORE string (comma-separated sources and/or path).
 * Prefer {@link parseCertStoreSources} for official JEm densable.
 */
export function getCertStorePath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_CERT_STORE?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

export type CertStoreSource = 'bundled' | 'system'

/**
 * Official JEm densable — parse CLAUDE_CODE_CERT_STORE into ordered unique
 * `bundled`/`system` sources. Unrecognized tokens are reported via `onUnrecognized`
 * and skipped. Empty/missing → [].
 */
export function parseCertStoreSources(input?: {
  env?: NodeJS.ProcessEnv
  onUnrecognized?: (token: string) => void
}): CertStoreSource[] {
  const env = input?.env ?? process.env
  const raw = env.CLAUDE_CODE_CERT_STORE
  if (!raw) return []
  const out: CertStoreSource[] = []
  for (const part of raw.split(',')) {
    const n = part.trim().toLowerCase()
    if (n === 'bundled' || n === 'system') {
      if (!out.includes(n)) out.push(n)
    } else if (n) {
      input?.onUnrecognized?.(n)
    }
  }
  return out
}

/**
 * Official JEm densable resolve — CERT_STORE sources when non-empty; else
 * NODE_OPTIONS --use-system-ca/--use-openssl-ca → ['system']; else defaultSources.
 */
export function resolveCertStoreSources(input?: {
  env?: NodeJS.ProcessEnv
  nodeOptions?: string
  defaultSources?: CertStoreSource[]
  onUnrecognized?: (token: string) => void
}): CertStoreSource[] {
  const parsed = parseCertStoreSources({
    env: input?.env,
    onUnrecognized: input?.onUnrecognized,
  })
  if (parsed.length > 0) return parsed
  const nodeOptions =
    input?.nodeOptions ?? input?.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS
  if (
    typeof nodeOptions === 'string' &&
    (nodeOptions.split(/\s+/).includes('--use-system-ca') ||
      nodeOptions.split(/\s+/).includes('--use-openssl-ca'))
  ) {
    return ['system']
  }
  return input?.defaultSources ?? []
}

/**
 * Official GPo densable env branch — CLAUDE_CODE_DAEMON_COLD_START is
 * "transient"|"ask", else undefined (caller falls through to settings/GB).
 */
export function resolveDaemonColdStartMode(
  env: NodeJS.ProcessEnv = process.env,
): 'transient' | 'ask' | undefined {
  const raw = env.CLAUDE_CODE_DAEMON_COLD_START?.trim().toLowerCase()
  if (raw === 'transient' || raw === 'ask') return raw
  return undefined
}

/**
 * Official GPo full densable pure resolve:
 * env "transient"|"ask" → that; else settingsMode if set; else gbDefault ?? "transient".
 * Consumer: {@link planDaemonColdStart} + AgentView ensureDaemonRunning.
 */
export function resolveDaemonColdStartModeFull(input?: {
  env?: NodeJS.ProcessEnv
  settingsMode?: 'transient' | 'ask'
  gbDefault?: 'transient' | 'ask'
}): 'transient' | 'ask' {
  const fromEnv = resolveDaemonColdStartMode(input?.env)
  if (fromEnv) return fromEnv
  if (input?.settingsMode === 'transient' || input?.settingsMode === 'ask') {
    return input.settingsMode
  }
  return input?.gbDefault ?? 'transient'
}

/** Truthy cold-start flag (legacy boolean gate; prefer resolveDaemonColdStartMode). */
export function isDaemonColdStart(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (resolveDaemonColdStartMode(env) !== undefined) return true
  return isEnvTruthy(env.CLAUDE_CODE_DAEMON_COLD_START)
}

export type DaemonColdStartPlan =
  | { action: 'already_up' }
  | {
      action: 'ask_install'
      reason: string
    }
  | {
      action: 'spawn_transient'
      origin: 'transient'
    }

/**
 * Official KF densable pure plan for cold daemon start (no UI):
 * - forceTransient → always spawn_transient
 * - mode "ask" + not dismissed + interactive → ask_install
 * - else → spawn_transient
 * Full install-prompt denser: daemon/installPrompt.ts + DaemonInstallDialog.
 */
export function planDaemonColdStart(input?: {
  env?: NodeJS.ProcessEnv
  settingsMode?: 'transient' | 'ask'
  gbDefault?: 'transient' | 'ask'
  forceTransient?: boolean
  /** Official daemonInstallPromptDismissed (global config). */
  installPromptDismissed?: boolean
  /** Official tsK — interactive TTY-like surface may show ask. Default true. */
  mayPromptInstall?: boolean
}): DaemonColdStartPlan {
  if (input?.forceTransient) {
    return { action: 'spawn_transient', origin: 'transient' }
  }
  const mode = resolveDaemonColdStartModeFull({
    env: input?.env,
    settingsMode: input?.settingsMode,
    gbDefault: input?.gbDefault,
  })
  const mayPrompt = input?.mayPromptInstall !== false
  if (mode === 'ask' && mayPrompt && input?.installPromptDismissed !== true) {
    return {
      action: 'ask_install',
      reason:
        "No background daemon is running. Run 'claude daemon install' to set it up as a persistent service.",
    }
  }
  return { action: 'spawn_transient', origin: 'transient' }
}

export function resolveDdErrorTrackingFlushIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.CLAUDE_CODE_DD_ERROR_TRACKING_FLUSH_INTERVAL_MS
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

/** Official YJg / KJg default stall for native binary download. */
export const DEFAULT_STALL_TIMEOUT_MS_FOR_TESTING = 60_000

/** Official JJg / fzu default total download deadline. */
export const DEFAULT_DOWNLOAD_DEADLINE_MS_FOR_TESTING = 5 * 60_000

/**
 * Official YJg — STALL_TIMEOUT_MS_FOR_TESTING when >0, else undefined.
 */
export function resolveStallTimeoutMsForTesting(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

/**
 * Official YJg — STALL_TIMEOUT_MS_FOR_TESTING || 60_000.
 */
export function resolveStallTimeoutMsForTestingOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    resolveStallTimeoutMsForTesting(env) ?? DEFAULT_STALL_TIMEOUT_MS_FOR_TESTING
  )
}

/**
 * Official JJg — DOWNLOAD_DEADLINE_MS_FOR_TESTING when >0, else undefined.
 */
export function resolveDownloadDeadlineMsForTesting(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.CLAUDE_CODE_DOWNLOAD_DEADLINE_MS_FOR_TESTING
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

/**
 * Official JJg — DOWNLOAD_DEADLINE_MS_FOR_TESTING || 5 min.
 */
export function resolveDownloadDeadlineMsForTestingOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    resolveDownloadDeadlineMsForTesting(env) ??
    DEFAULT_DOWNLOAD_DEADLINE_MS_FOR_TESTING
  )
}

/**
 * Official $qa densable — CCR_SPAWN_TIMESTAMP_MS ?? CLAUDE_CODE_SPAWN_TIMESTAMP_MS.
 * Used for spawn_to_first_checkpoint_ms in tengu_startup_perf.
 */
export function resolveSpawnTimestampMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw =
    env.CCR_SPAWN_TIMESTAMP_MS ?? env.CLAUDE_CODE_SPAWN_TIMESTAMP_MS ?? ''
  if (!raw) return undefined
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return undefined
  return n
}

/**
 * Official spawn_to_first_checkpoint_ms = firstCheckpointMs - spawnTs.
 * Returns undefined when either side is missing.
 */
export function resolveSpawnToFirstCheckpointMs(input: {
  firstCheckpointMs: number | undefined
  spawnTimestampMs?: number | undefined
  env?: NodeJS.ProcessEnv
}): number | undefined {
  const spawn =
    input.spawnTimestampMs ?? resolveSpawnTimestampMs(input.env ?? process.env)
  if (spawn === undefined || input.firstCheckpointMs === undefined) {
    return undefined
  }
  return Math.round(input.firstCheckpointMs - spawn)
}

export const RELAUNCH_TERMINAL_SIZE_ENV_KEY =
  'CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE'

/**
 * Official Kro — snapshot current stdout size for child relaunch env inject.
 * Returns `{}` when columns/rows missing.
 */
export function buildRelaunchTerminalSizeEnv(input?: {
  columns?: number
  rows?: number
}): Record<string, string> {
  const columns = input?.columns ?? process.stdout.columns
  const rows = input?.rows ?? process.stdout.rows
  if (!columns || !rows) return {}
  return { [RELAUNCH_TERMINAL_SIZE_ENV_KEY]: `${columns}x${rows}` }
}

/**
 * Official t2u parse — `WxH` with 1–4 digit positive ints.
 * Returns null when unset/invalid (including bare truthy flags).
 */
export function parseRelaunchTerminalSize(
  raw: string | undefined,
): { columns: number; rows: number } | null {
  if (raw === undefined) return null
  const m = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/.exec(raw)
  if (!m) return null
  return { columns: Number(m[1]), rows: Number(m[2]) }
}

/**
 * True when CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE holds a valid WxH snapshot.
 * (Not a simple truthy flag — official stores `columnsxrows`.)
 */
export function isRelaunchTerminalSizeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseRelaunchTerminalSize(env[RELAUNCH_TERMINAL_SIZE_ENV_KEY]) !== null
}

/**
 * Official t2u — apply relaunch size onto stdout if TTY and env valid,
 * then delete the one-shot env key. No-op when not TTY / invalid / unset.
 */
export function applyRelaunchTerminalSizeFromEnv(input?: {
  env?: NodeJS.ProcessEnv
  isTTY?: boolean
  stdout?: { columns?: number; rows?: number }
}): { columns: number; rows: number } | null {
  const env = input?.env ?? process.env
  const raw = env[RELAUNCH_TERMINAL_SIZE_ENV_KEY]
  delete env[RELAUNCH_TERMINAL_SIZE_ENV_KEY]
  const isTTY = input?.isTTY ?? process.stdout.isTTY === true
  if (raw === undefined || !isTTY) return null
  const parsed = parseRelaunchTerminalSize(raw)
  if (!parsed) return null
  const stdout = input?.stdout ?? process.stdout
  stdout.columns ||= parsed.columns
  stdout.rows ||= parsed.rows
  return parsed
}

export function is3pProbeWroteOpusDefault(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_3P_PROBE_WROTE_OPUS_DEFAULT)
}

export function is3pProbeWroteSonnetDefault(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_3P_PROBE_WROTE_SONNET_DEFAULT)
}

/** CLAUDE_CODE_INVOKED_SKILLS — comma-separated skill names already invoked. */
export function getInvokedSkills(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.CLAUDE_CODE_INVOKED_SKILLS ?? ''
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/** Official CLAUDE_CODE_DISABLE_CRON densable force-off. */
export function isCronDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_CRON)
}

/**
 * Official T9 densable — cron enabled when !DISABLE_CRON && GB tengu_kairos_cron.
 * Default GB true so Bedrock/Vertex/Foundry + DISABLE_TELEMETRY still get /loop.
 * Full scheduler/tool consumers remain in ScheduleCronTool.
 */
export function resolveKairosCronEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (isCronDisabled(env)) return false
  return input?.gbValue !== false
}

/**
 * Official brief-attachment upload eligibility densable:
 * replBridgeEnabled || BRIEF_UPLOAD || REMOTE_ENVIRONMENT_TYPE set || REMOTE.
 * Full /api/oauth/file_upload path remains denser (upload.ts).
 */
export function shouldUploadBriefAttachments(input: {
  env?: NodeJS.ProcessEnv
  replBridgeEnabled?: boolean
}): boolean {
  const env = input.env ?? process.env
  if (input.replBridgeEnabled) return true
  if (isEnvTruthy(env.CLAUDE_CODE_BRIEF_UPLOAD)) return true
  if (
    typeof env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE === 'string' &&
    env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE.length > 0
  ) {
    return true
  }
  return isEnvTruthy(env.CLAUDE_CODE_REMOTE)
}

/**
 * Official stt densable — CLAUDE_CODE_PEWTER_OWL_TOOL when set, else optional
 * GrowthBook pewter_owl_tool (default false). Forces SendUserMessage tool on.
 */
export function isPewterOwlToolEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (env.CLAUDE_CODE_PEWTER_OWL_TOOL !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_PEWTER_OWL_TOOL)
  }
  return input?.gbValue ?? false
}

/**
 * Official z6i densable — GrowthBook pewter_owl_brief (default false).
 * When true, brief mode activates without userMsgOptIn (WCt OR path).
 */
export function isPewterOwlBriefEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  // Env CLAUDE_CODE_PEWTER_OWL is a related force flag in inventory; brief
  // path officially reads GB only, but accept explicit env for densable tests.
  const env = input?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_PEWTER_OWL)) return true
  return input?.gbValue ?? false
}

/**
 * Official Ztg densable pure — prefer non-empty GB stop-hook text, else default.
 */
export function getBriefEnforceText(input: {
  gbText?: string | null
  defaultText: string
}): string {
  const gb = input.gbText
  if (typeof gb === 'string' && gb.length > 0) return gb
  return input.defaultText
}

/**
 * Official KO densable — REPL mode enable composition.
 * falsy CLAUDE_CODE_REPL → off; truthy CLAUDE_CODE_REPL → on;
 * else optional CLAUDE_REPL_MODE; else cli|remote entrypoint + GB/ant default.
 */
export function resolveReplModeEnabled(input?: {
  env?: NodeJS.ProcessEnv
  /** Official tengu_slate_harbor when entrypoint is cli/remote. */
  gbValue?: boolean
  /** Local ant-native default when GB not injected. */
  antDefault?: boolean
}): boolean {
  const env = input?.env ?? process.env
  const raw = env.CLAUDE_CODE_REPL
  if (raw !== undefined) {
    // isEnvDefinedFalsy-style: explicit falsy → off; otherwise truthy check
    const lower = raw.trim().toLowerCase()
    if (
      lower === '0' ||
      lower === 'false' ||
      lower === 'no' ||
      lower === 'off'
    ) {
      return false
    }
    if (isEnvTruthy(raw)) return true
  }
  if (isEnvTruthy(env.CLAUDE_REPL_MODE)) return true
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  if (entry === 'cli' || entry === 'remote') {
    if (input?.gbValue !== undefined) return input.gbValue
    return input?.antDefault ?? false
  }
  return false
}

/** Official DISABLE_BRIEF_MODE_STOP_HOOK densable force-off. */
export function isBriefModeStopHookDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.DISABLE_BRIEF_MODE_STOP_HOOK)
}

export type BriefEnforceMessageLike = {
  type?: string
  isMeta?: boolean
  message?: {
    content?: string | Array<{ type?: string; name?: string; text?: string }>
  }
}

/**
 * Official densable pure — does any message contain tool_use of brief names.
 */
export function messagesIncludeBriefToolUse(
  messages: BriefEnforceMessageLike[],
  briefToolNames: readonly string[],
): boolean {
  const names = new Set(briefToolNames)
  for (const m of messages) {
    if (m.type !== 'assistant') continue
    const content = m.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        block.type === 'tool_use' &&
        typeof block.name === 'string' &&
        names.has(block.name)
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Official densable pure — already-nudged when a meta user message includes sentinel.
 */
export function messagesIncludeBriefEnforceSentinel(
  messages: BriefEnforceMessageLike[],
  sentinel: string,
): boolean {
  for (const m of messages) {
    if (m.type !== 'user' || !m.isMeta) continue
    const content = m.message?.content
    if (typeof content === 'string' && content.includes(sentinel)) return true
  }
  return false
}

/**
 * Official brief-mode stop-hook densable gate:
 * main/sdk source, brief enabled, not DISABLE_BRIEF_MODE_STOP_HOOK, not agent,
 * tools list includes brief, no brief tool_use this turn, no prior sentinel.
 * Returns meta content string when enforce should fire; null otherwise.
 */
export function resolveBriefModeStopHookEnforce(input: {
  querySource: string
  isBriefEnabled: boolean
  agentId?: string | null
  toolsIncludeBrief: boolean
  messagesSinceLastUser: BriefEnforceMessageLike[]
  assistantMessages: BriefEnforceMessageLike[]
  briefToolNames: readonly string[]
  sentinel: string
  enforceText: string
  env?: NodeJS.ProcessEnv
}): string | null {
  if (
    !(
      input.querySource.startsWith('repl_main_thread') ||
      input.querySource === 'sdk'
    )
  ) {
    return null
  }
  if (!input.isBriefEnabled) return null
  if (isBriefModeStopHookDisabled(input.env)) return null
  if (input.agentId) return null
  if (!input.toolsIncludeBrief) return null
  if (
    messagesIncludeBriefToolUse(
      input.messagesSinceLastUser,
      input.briefToolNames,
    ) ||
    messagesIncludeBriefToolUse(input.assistantMessages, input.briefToolNames)
  ) {
    return null
  }
  if (
    messagesIncludeBriefEnforceSentinel(
      input.messagesSinceLastUser,
      input.sentinel,
    )
  ) {
    return null
  }
  return `${input.sentinel} ${input.enforceText}`
}

/** Official CLAUDE_CODE_NEW_INIT densable force-on (env half of cQy). */
export function isNewInitEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_NEW_INIT)
}

/**
 * Official cQy densable — NEW_INIT env || GB tengu_slate_harbor_experiment.
 * Local feature('NEW_INIT') remains a separate build-time DCE gate at call sites.
 */
export function resolveNewInitEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  if (isNewInitEnvEnabled(input?.env)) return true
  return input?.gbValue ?? false
}

/**
 * Official cae densable — DISABLE_BUNDLED_SKILLS env OR settings.disableBundledSkills.
 * Full IVn builtin-prompt filter remains denser at command load sites.
 */
export function isBundledSkillsDisabled(input?: {
  env?: NodeJS.ProcessEnv
  settingsDisableBundledSkills?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS)) return true
  return input?.settingsDisableBundledSkills === true
}

/**
 * Official skillOverrides densable modes (settings enum).
 * "name-only" lists without description; "user-invocable-only" hides from model
 * but keeps /name; "off" hides from both; absent/"on" = full enable.
 * "model-invocable" kept for fork compatibility with earlier residual ports.
 */
export type SkillOverrideMode =
  | 'on'
  | 'name-only'
  | 'user-invocable-only'
  | 'off'
  | 'model-invocable'

/** Official Is_ / wjs — cycle order for skill override UI. */
export const SKILL_OVERRIDE_CYCLE_MODES = [
  'on',
  'name-only',
  'user-invocable-only',
  'off',
] as const satisfies readonly SkillOverrideMode[]

export type SkillOverrideLockSource =
  | 'policy'
  | 'flag'
  | 'author'
  | 'local'
  | 'project'
  | 'user'
  | string

/**
 * Official IVn densable — prompt builtin skill killed by cae
 * (DISABLE_BUNDLED_SKILLS env or settings.disableBundledSkills).
 */
export function isBuiltinPromptSkillDisabledByBundledSetting(
  cmd: { type?: string; source?: string },
  input?: {
    env?: NodeJS.ProcessEnv
    settingsDisableBundledSkills?: boolean
  },
): boolean {
  return (
    cmd.type === 'prompt' &&
    cmd.source === 'builtin' &&
    isBundledSkillsDisabled(input)
  )
}

/**
 * Official RQd densable — next skill override mode for UI cycle.
 * policy/flag locks; author frontmatter toggles off ↔ user-invocable-only;
 * otherwise walks SKILL_OVERRIDE_CYCLE_MODES.
 */
export function cycleSkillOverrideMode(
  current: SkillOverrideMode,
  lockSource?: SkillOverrideLockSource,
): SkillOverrideMode {
  if (lockSource === 'policy' || lockSource === 'flag') return current
  if (lockSource === 'author') {
    return current === 'off' ? 'user-invocable-only' : 'off'
  }
  const modes = SKILL_OVERRIDE_CYCLE_MODES as readonly SkillOverrideMode[]
  const idx = modes.indexOf(current === 'model-invocable' ? 'on' : current)
  const from = idx >= 0 ? idx : 0
  return modes[(from + 1) % modes.length]!
}

/**
 * Official OQd densable — value to write into localSettings.skillOverrides.
 * Returns undefined when desired mode equals inherited effective mode so the
 * local key can be cleared (no redundant override).
 */
export function resolveSkillOverrideWriteValue(
  desired: SkillOverrideMode,
  input: {
    cmdName: string
    unqualifiedName?: string
    lockSource?: SkillOverrideLockSource
    localOverrides?: Readonly<Record<string, SkillOverrideMode>>
    projectOverrides?: Readonly<Record<string, SkillOverrideMode>>
    userOverrides?: Readonly<Record<string, SkillOverrideMode>>
  },
): SkillOverrideMode | undefined {
  const projectOrUser = (name: string): SkillOverrideMode | undefined =>
    input.projectOverrides?.[name] ?? input.userOverrides?.[name]
  const inherited =
    projectOrUser(input.cmdName) ??
    (input.unqualifiedName != null
      ? (input.localOverrides?.[input.unqualifiedName] ??
        projectOrUser(input.unqualifiedName))
      : undefined)
  const effective: SkillOverrideMode =
    input.lockSource === 'author'
      ? inherited === 'off'
        ? 'off'
        : 'user-invocable-only'
      : (inherited ?? 'on')
  return desired === effective ? undefined : desired
}

/**
 * Official m6e densable — resolve effective skill override mode.
 * Plugin skills always "on". cae forces builtin prompts to user-invocable-only
 * (or keeps explicit "off").
 */
export function resolveSkillOverrideMode(
  cmd: {
    type?: string
    source?: string
    name: string
    unqualifiedName?: string
  },
  input?: {
    skillOverrides?: Readonly<Record<string, SkillOverrideMode>>
    settingsDisableBundledSkills?: boolean
    env?: NodeJS.ProcessEnv
  },
): SkillOverrideMode {
  if (cmd.type !== 'prompt' || cmd.source === 'plugin') return 'on'
  const overrides = input?.skillOverrides
  const n: SkillOverrideMode =
    overrides?.[cmd.name] ??
    (cmd.unqualifiedName != null
      ? overrides?.[cmd.unqualifiedName]
      : undefined) ??
    'on'
  if (isBuiltinPromptSkillDisabledByBundledSetting(cmd, input)) {
    return n === 'off' ? 'off' : 'user-invocable-only'
  }
  return n
}

/** Official k1o densable — model invocation blocked by override mode. */
export function isSkillModelInvocationBlockedByOverride(
  mode: SkillOverrideMode,
): boolean {
  return (
    mode === 'user-invocable-only' || mode === 'off' || mode === 'name-only'
  )
}

/** Official IJ densable — skill fully off (slash + model). */
export function isSkillFullyDisabledByOverride(
  mode: SkillOverrideMode,
): boolean {
  return mode === 'off'
}

/** Official densable — short UI label for skill override mode. */
export function formatSkillOverrideModeLabel(mode: SkillOverrideMode): string {
  switch (mode) {
    case 'on':
    case 'model-invocable':
      return 'on (default)'
    case 'name-only':
      return 'name only'
    case 'user-invocable-only':
      return 'user-invocable-only'
    case 'off':
      return 'off'
  }
}

/**
 * Official Lqe densable — skill is model-listable for SkillTool.
 * Includes builtin prompt skills unless cae/override blocks them.
 */
export function isSkillModelListable(
  cmd: {
    type?: string
    source?: string
    name: string
    unqualifiedName?: string
    disableModelInvocation?: boolean
    loadedFrom?: string
    hasUserSpecifiedDescription?: boolean
    whenToUse?: string
  },
  input?: {
    skillOverrides?: Readonly<Record<string, SkillOverrideMode>>
    settingsDisableBundledSkills?: boolean
    env?: NodeJS.ProcessEnv
  },
): boolean {
  if (cmd.type !== 'prompt' || cmd.disableModelInvocation) return false
  const mode = resolveSkillOverrideMode(cmd, input)
  if (isSkillModelInvocationBlockedByOverride(mode)) return false
  return (
    cmd.source === 'builtin' ||
    cmd.loadedFrom === 'bundled' ||
    cmd.loadedFrom === 'skills' ||
    cmd.loadedFrom === 'commands_DEPRECATED' ||
    !!cmd.hasUserSpecifiedDescription ||
    !!cmd.whenToUse
  )
}

/**
 * Official Ryt densable — any settings source has disableClaudeAiConnectors.
 * Full connector fetch/suppress remains denser at MCP sites.
 */
export function isClaudeAiConnectorsDisabledBySources(
  sourcesDisableFlags: readonly (boolean | undefined)[],
): boolean {
  return sourcesDisableFlags.some(v => v === true)
}

/**
 * Official P7t densable — first defined enableArtifact across settings sources.
 */
export function resolveEnableArtifactFromSources(
  values: readonly (boolean | undefined)[],
): boolean | undefined {
  for (const v of values) {
    if (v !== undefined) return v
  }
  return undefined
}

/**
 * Official peh densable — settings.enableWorkflows when present.
 */
export function resolveEnableWorkflowsSetting(
  enableWorkflows?: boolean,
): boolean | undefined {
  return enableWorkflows
}

/**
 * Official M1t densable — settings.disableRemoteControl managed policy force-off.
 */
export function isRemoteControlDisabledBySettings(
  settingsDisableRemoteControl?: boolean,
): boolean {
  return settingsDisableRemoteControl === true
}

/** Official DISABLE_BG_EXIT_HANDOFF densable — skip process-level bg handoff on exit. */
export function isBgExitHandoffDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF)
}

/** Official AUTO_COMPACT_WINDOW densable — positive int tokens or null. */
export function resolveAutoCompactWindowOverride(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Official BLOCKING_LIMIT_OVERRIDE densable — positive int tokens or null. */
export function resolveBlockingLimitOverride(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Official GLOB_TIMEOUT_SECONDS densable — positive seconds or null. */
export function resolveGlobTimeoutSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_GLOB_TIMEOUT_SECONDS
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Official EMIT_TOOL_USE_SUMMARIES densable. */
export function isEmitToolUseSummariesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES)
}

/** Official EMIT_SESSION_STATE_EVENTS densable. */
export function isEmitSessionStateEventsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS)
}

/** Official DONT_INHERIT_ENV densable — shell snapshot skips parent env. */
export function isDontInheritEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DONT_INHERIT_ENV)
}

/** Official ADDITIONAL_PROTECTION densable — x-anthropic-additional-protection. */
export function isAdditionalProtectionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ADDITIONAL_PROTECTION)
}

/** Official ADDITIONAL_DIRECTORIES_CLAUDE_MD densable. */
export function isAdditionalDirectoriesClaudeMdEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD)
}

/** Official MAX_CONTEXT_TOKENS densable — positive int or null (ant override). */
export function resolveMaxContextTokensOverride(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Official SLOW_OPERATION_THRESHOLD_MS densable.
 * ≥0 ms override, else 20 (dev) / 300 (ant) / Infinity.
 */
export function resolveSlowOperationThresholdMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS
  if (raw !== undefined) {
    const n = Number(raw)
    if (!Number.isNaN(n) && n >= 0) return n
  }
  if (env.NODE_ENV === 'development') return 20
  if (env.USER_TYPE === 'ant') return 300
  return Number.POSITIVE_INFINITY
}

/** Official PLUGIN_GIT_TIMEOUT_MS densable — positive ms, default 120_000. */
export const DEFAULT_PLUGIN_GIT_TIMEOUT_MS = 120_000

export function resolvePluginGitTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS
  if (raw) {
    const n = parseInt(raw, 10)
    if (!Number.isNaN(n) && n > 0) return n
  }
  return DEFAULT_PLUGIN_GIT_TIMEOUT_MS
}

/**
 * Official MAX_OUTPUT_TOKENS densable pure parse — positive int or null.
 */
export function resolveMaxOutputTokensOverride(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Official MAX_OUTPUT_TOKENS densable bounded clamp.
 * Mirrors validateBoundedIntEnvVar for pure call sites (no logging side effects).
 * Returns default when unset/invalid; upperLimit when over cap.
 */
export function clampMaxOutputTokensOverride(
  raw: string | number | null | undefined,
  defaultValue: number,
  upperLimit: number,
): { effective: number; status: 'valid' | 'capped' | 'invalid' | 'default' } {
  if (raw === null || raw === undefined || raw === '') {
    return { effective: defaultValue, status: 'default' }
  }
  const parsed =
    typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { effective: defaultValue, status: 'invalid' }
  }
  if (parsed > upperLimit) {
    return { effective: upperLimit, status: 'capped' }
  }
  return { effective: parsed, status: 'valid' }
}

/** Official DISABLE_1M_CONTEXT densable. */
export function is1mContextEnvDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_1M_CONTEXT)
}

/** Official DISABLE_THINKING densable. */
export function isThinkingDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_THINKING)
}

/** Official DISABLE_ADAPTIVE_THINKING densable. */
export function isAdaptiveThinkingDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING)
}

/** Official DISABLE_ATTACHMENTS densable. */
export function isAttachmentsDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_ATTACHMENTS)
}

/** Official DISABLE_CLAUDE_MDS densable. */
export function isClaudeMdsDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS)
}

/** Official DISABLE_TERMINAL_TITLE densable. */
export function isTerminalTitleDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE)
}

/** Official DISABLE_FILE_CHECKPOINTING densable. */
export function isFileCheckpointingDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING)
}

/** Official DISABLE_POLICY_SKILLS densable. */
export function isPolicySkillsDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_POLICY_SKILLS)
}

/** Official DISABLE_NONSTREAMING_FALLBACK densable. */
export function isNonstreamingFallbackDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK)
}

/** Official DISABLE_EXPERIMENTAL_BETAS densable. */
export function isExperimentalBetasDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)
}

/** Official DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL densable. */
export function isOfficialMarketplaceAutoinstallDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL)
}

/** Official DISABLE_FAST_MODE densable. */
export function isFastModeDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_FAST_MODE)
}

/** Official DISABLE_VIRTUAL_SCROLL densable. */
export function isVirtualScrollDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL)
}

/** Official DISABLE_MESSAGE_ACTIONS densable. */
export function isMessageActionsDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_MESSAGE_ACTIONS)
}

/** Official DISABLE_PRECOMPACT_SKIP densable. */
export function isPrecompactSkipDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP)
}

/** Official ENABLE_TOKEN_USAGE_ATTACHMENT densable. */
export function isTokenUsageAttachmentEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_TOKEN_USAGE_ATTACHMENT)
}

/** Official FORCE_INTERACTIVE densable. */
export function isForceInteractiveEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_FORCE_INTERACTIVE)
}

/** Official ENABLE_TASKS densable force-on. */
export function isTasksEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_TASKS)
}

/** Official ENABLE_AWAY_SUMMARY densable force-on. */
export function isAwaySummaryEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY)
}

/** Official ENABLE_SDK_FILE_CHECKPOINTING densable. */
export function isSdkFileCheckpointingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING)
}

/**
 * Official DISABLE_GIT_INSTRUCTIONS densable pure env half.
 * true → force off, false → force on, null → fall through to settings.
 */
export function resolveGitInstructionsEnvOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const raw = env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS
  if (isEnvTruthy(raw)) return false
  if (isEnvDefinedFalsy(raw)) return true
  return null
}

/**
 * Official DISABLE_AUTO_MEMORY densable pure env half.
 * true → force off, false → force on, null → fall through.
 */
export function resolveAutoMemoryEnvOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const raw = env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  if (isEnvTruthy(raw)) return false
  if (isEnvDefinedFalsy(raw)) return true
  return null
}

/**
 * Official ENABLE_PROMPT_SUGGESTION densable pure env half.
 * true/false when set, null when unset.
 */
export function resolvePromptSuggestionEnvOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const raw = env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
  if (isEnvDefinedFalsy(raw)) return false
  if (isEnvTruthy(raw)) return true
  return null
}

/**
 * Official MAX_RETRIES densable pure parse — finite ≥0 or null.
 * Clamp-to-ufa / watchdog remain denser at getDefaultMaxRetries.
 */
export function resolveMaxRetriesOverride(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_MAX_RETRIES
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (Number.isNaN(n) || n < 0) return null
  return n
}

/** Official ENABLE_XAA densable. */
export function isXaaEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_XAA)
}

/** Official DISABLE_LOCAL_GATES densable. */
export function isLocalGatesDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_LOCAL_GATES)
}

/**
 * Official DATADOG_FLUSH_INTERVAL_MS densable pure parse — positive ms or null.
 */
export function resolveDatadogFlushIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_DATADOG_FLUSH_INTERVAL_MS
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (Number.isNaN(n) || n <= 0) return null
  return n
}

/** Official INCLUDE_PARTIAL_MESSAGES densable. */
export function isIncludePartialMessagesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES)
}

/** Official PROACTIVE densable. */
export function isProactiveEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PROACTIVE)
}

/** Official EXCLUDE_DYNAMIC_CONTEXT densable. */
export function isExcludeDynamicContextEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_EXCLUDE_DYNAMIC_CONTEXT)
}

/** Official BUBBLEWRAP densable (root+bypass allow). */
export function isBubblewrapEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_BUBBLEWRAP)
}

/** Official DISABLE_SESSION_DATA_UPLOAD densable. */
export function isSessionDataUploadDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_SESSION_DATA_UPLOAD)
}

/** Official STREAMLINED_OUTPUT densable. */
export function isStreamlinedOutputEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_STREAMLINED_OUTPUT)
}

/**
 * densable 2.1.221 — RESUME_INTERRUPTED_TURN.
 * Honor falsy values (`0`/`false`/`no`/`off`); only truthy enables.
 * Pre-221 used Boolean(env) which treated `"0"` as enabled.
 */
export function isResumeInterruptedTurnEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN)
}

/**
 * Official ATTRIBUTION_HEADER densable pure env half.
 * false when explicitly falsy; null when unset (fall through to GB).
 */
export function resolveAttributionHeaderEnvOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const raw = env.CLAUDE_CODE_ATTRIBUTION_HEADER
  if (isEnvDefinedFalsy(raw)) return false
  if (isEnvTruthy(raw)) return true
  return null
}

/** Official DISABLE_BG_SHELL_PRESSURE_REAP densable. */
export function isBgShellPressureReapDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP)
}

/** Official SAVE_HOOK_ADDITIONAL_CONTEXT densable. */
export function isSaveHookAdditionalContextEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT)
}

/** Official CCR_MIRROR densable env force-on. */
export function isCcrMirrorEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_CCR_MIRROR)
}

/** Official ENABLE_TELEMETRY densable. */
export function isTelemetryEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_TELEMETRY)
}

/** Official PROFILE_STARTUP densable. */
export function isProfileStartupEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PROFILE_STARTUP)
}

/** Official OVERRIDE_DATE densable — raw string when set. */
export function resolveOverrideDate(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.CLAUDE_CODE_OVERRIDE_DATE
  return raw && raw.length > 0 ? raw : null
}

/** Official POST_FOR_SESSION_INGRESS_V2 densable. */
export function isPostForSessionIngressV2Enabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2)
}

/**
 * Official EFFORT_LEVEL densable pure parse — lowercased string or null.
 * auto/unset/mapping remains denser at call sites.
 */
export function resolveEffortLevelOverride(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.CLAUDE_CODE_EFFORT_LEVEL
  if (!raw) return null
  return raw.toLowerCase()
}

/**
 * Official USE_POWERSHELL_TOOL densable pure env half.
 * true when force-on, false when force-off, null when unset.
 */
export function resolvePowerShellToolEnvOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const raw = env.CLAUDE_CODE_USE_POWERSHELL_TOOL
  if (raw === undefined) return null
  if (isEnvTruthy(raw)) return true
  if (isEnvDefinedFalsy(raw)) return false
  return null
}

/** Official GIT_BASH_PATH densable — raw path when set. */
export function resolveGitBashPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.CLAUDE_CODE_GIT_BASH_PATH
  return raw && raw.length > 0 ? raw : null
}

/**
 * Official OTEL_HEADERS_HELPER_DEBOUNCE_MS densable pure parse —
 * positive ms or null.
 */
export function resolveOtelHeadersHelperDebounceMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (Number.isNaN(n) || n <= 0) return null
  return n
}

/** Official API_KEY_FILE_DESCRIPTOR densable — raw fd string when set. */
export function resolveApiKeyFileDescriptor(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR
  return raw && raw.length > 0 ? raw : null
}

/**
 * Official WORKER_EPOCH densable pure parse — finite int or null.
 */
export function resolveWorkerEpoch(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_WORKER_EPOCH
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return null
  return n
}

/** Official ENVIRONMENT_RUNNER_VERSION densable — raw string when set. */
export function resolveEnvironmentRunnerVersion(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.CLAUDE_CODE_ENVIRONMENT_RUNNER_VERSION
  return raw && raw.length > 0 ? raw : null
}

/** Official CLAUDE_CODE_SIMPLE densable. */
export function isSimpleModeEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SIMPLE)
}

/** Official COORDINATOR_MODE densable. */
export function isCoordinatorModeEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_COORDINATOR_MODE)
}

/** Official CLAUDE_CODE_BRIEF densable. */
export function isBriefEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_BRIEF)
}

/** Official SHELL_PREFIX densable — raw template when set. */
export function resolveShellPrefix(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.CLAUDE_CODE_SHELL_PREFIX
  return raw && raw.length > 0 ? raw : null
}

/** Official DISABLE_EXPLORE_PLAN_AGENTS densable. */
export function isExplorePlanAgentsDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS)
}

/** Official DISABLE_COMMAND_INJECTION_CHECK densable. */
export function isCommandInjectionCheckDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK)
}

/** Official BASH_SANDBOX_SHOW_INDICATOR densable. */
export function isBashSandboxShowIndicatorEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR)
}

/**
 * Official AGENT_LIST_IN_MESSAGES densable pure env half.
 * true/false when set, null when unset.
 */
export function resolveAgentListInMessagesEnvOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const raw = env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES
  if (isEnvDefinedFalsy(raw)) return false
  if (isEnvTruthy(raw)) return true
  return null
}

/** Official ACCESSIBILITY densable. */
export function isAccessibilityEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ACCESSIBILITY)
}

/** Official CLAUDE_CODE_REMOTE densable. */
export function isRemoteEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_REMOTE)
}

/** Official CLAUDE_CODE_USE_CCR_V2 densable. */
export function isCcrV2EnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_CCR_V2)
}

/** Official CLAUDE_CODE_ACTION densable (GitHub Action entrypoint). */
export function isActionEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ACTION)
}

/** Official CLAUDE_CODE_UNATTENDED_RETRY densable. */
export function isUnattendedRetryEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_UNATTENDED_RETRY)
}

/**
 * Official ENABLE_BUDDY densable pure env half.
 * true/false when set, null when unset.
 */
export function resolveBuddyEnvOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const raw = env.CLAUDE_CODE_ENABLE_BUDDY
  if (isEnvDefinedFalsy(raw)) return false
  if (isEnvTruthy(raw)) return true
  return null
}

/** Official CLAUDE_CODE_USE_BEDROCK densable. */
export function isUseBedrockEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_BEDROCK)
}

/** Official CLAUDE_CODE_USE_VERTEX densable. */
export function isUseVertexEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_VERTEX)
}

/** Official CLAUDE_CODE_USE_FOUNDRY densable. */
export function isUseFoundryEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_FOUNDRY)
}

/** Official CLAUDE_CODE_USE_OPENAI densable. */
export function isUseOpenAIEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)
}

/** Official CLAUDE_CODE_USE_GEMINI densable. */
export function isUseGeminiEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_GEMINI)
}

/** Official CLAUDE_CODE_USE_GROK densable. */
export function isUseGrokEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_GROK)
}

/** Official CLAUDE_CODE_SKIP_BEDROCK_AUTH densable. */
export function isSkipBedrockAuthEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)
}

/** Official CLAUDE_CODE_SKIP_VERTEX_AUTH densable. */
export function isSkipVertexAuthEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_VERTEX_AUTH)
}

/** Official CLAUDE_CODE_SKIP_FOUNDRY_AUTH densable. */
export function isSkipFoundryAuthEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH)
}

/** Official CLAUDE_CODE_SKIP_AWS_CRED_CACHE densable. */
export function isSkipAwsCredCacheEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_AWS_CRED_CACHE)
}

/** Official CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST densable. */
export function isProviderManagedByHostEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
}

/** Official CLAUDE_CODE_AUTO_CONNECT_IDE densable. */
export function isAutoConnectIdeEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_AUTO_CONNECT_IDE)
}

/** Official CLAUDE_CODE_REMOTE_SEND_KEEPALIVES densable. */
export function isRemoteSendKeepalivesEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_REMOTE_SEND_KEEPALIVES)
}

/** Official CLAUDE_CODE_USE_NATIVE_FILE_SEARCH densable. */
export function isNativeFileSearchEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH)
}

/** Official CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS_DISABLED densable. */
export function isExperimentalAgentTeamsDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS_DISABLED)
}

/** Official CLAUDE_CODE_VERIFY_PLAN densable. */
export function isVerifyPlanEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_VERIFY_PLAN)
}

/** Official CLAUDE_CODE_TERMINAL_RECORDING densable. */
export function isTerminalRecordingEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_TERMINAL_RECORDING)
}

/** Official CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING densable. */
export function isFineGrainedToolStreamingEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING)
}

/** Official CLAUDE_CODE_ALWAYS_ENABLE_EFFORT densable. */
export function isAlwaysEnableEffortEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT)
}

/** Official CLAUDE_CODE_ENABLE_CFC densable. */
export function isCfcEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_CFC)
}

/** Official CLAUDE_CODE_DUMP_AUTO_MODE densable. */
export function isDumpAutoModeEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DUMP_AUTO_MODE)
}

/** Official CLAUDE_CODE_AUTO_MODE_EXTERNAL_PERMISSIONS densable. */
export function isAutoModeExternalPermissionsEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_AUTO_MODE_EXTERNAL_PERMISSIONS)
}

/** Official CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE densable. */
export function isPluginZipCacheEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE)
}

/** Official CLAUDE_CODE_USE_COWORK_PLUGINS densable. */
export function isCoworkPluginsEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_USE_COWORK_PLUGINS)
}

/** Official CLAUDE_CODE_IDE_SKIP_VALID_CHECK densable. */
export function isIdeSkipValidCheckEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_IDE_SKIP_VALID_CHECK)
}

/** Official CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL densable. */
export function isIdeSkipAutoInstallEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL)
}

/**
 * Official Xtg densable — tools-list opt-in to brief when list includes
 * SendUserMessage/Brief, not pewter-owl-tool force path, and brief entitled.
 */
export function shouldToolsListOptInToBrief(input: {
  toolNames: readonly string[]
  briefToolNames: readonly string[]
  isPewterOwlTool?: boolean
  isBriefEntitled: boolean
}): boolean {
  if (!input.toolNames.some(n => input.briefToolNames.includes(n))) {
    return false
  }
  if (input.isPewterOwlTool) return false
  return input.isBriefEntitled
}

/**
 * Official Nkr env fallback densable — CLAUDE_CODE_PLAN_MODE_REQUIRED when no
 * teammate/dynamic context. Full isPlanModeRequired remains in teammate.ts.
 */
export function isPlanModeRequiredFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PLAN_MODE_REQUIRED)
}

/** Official CLAUDE_CODE_NO_FLICKER densable force-on for fullscreen/no-flicker. */
export function isNoFlickerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_NO_FLICKER)
}

/**
 * Official cYn densable — skill `!` shell execution disabled when
 * CLAUDE_CODE_IS_COWORK or settings.disableSkillShellExecution.
 */
export function isSkillShellExecutionDisabled(input?: {
  env?: NodeJS.ProcessEnv
  policyDisableSkillShellExecution?: boolean
  settingsDisableSkillShellExecution?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_IS_COWORK)) return true
  if (input?.policyDisableSkillShellExecution === true) return true
  return input?.settingsDisableSkillShellExecution === true
}

/** Official Q_u densable — placeholder when skill shell is policy-disabled. */
export const SKILL_SHELL_DISABLED_PLACEHOLDER =
  '[shell command execution disabled by policy]'

const SKILL_SHELL_BLOCK_PATTERN = /```!\s*\n?[\s\S]*?\n?```/g
// eslint-disable-next-line custom-rules/no-lookbehind-regex -- gated by includes('!`')
const SKILL_SHELL_INLINE_PATTERN = /(?<=^|\s)!`[^`]+`/gm

/**
 * Official uYn densable pure — replace ```! blocks and !`inline` shell
 * patterns with SKILL_SHELL_DISABLED_PLACEHOLDER (no execution).
 */
export function stripSkillShellCommands(
  text: string,
  placeholder: string = SKILL_SHELL_DISABLED_PLACEHOLDER,
): string {
  let out = text.replace(SKILL_SHELL_BLOCK_PATTERN, placeholder)
  if (!out.includes('!`')) return out
  // Official rYn densable: mask non-shell markdown code spans so the inline
  // pattern only hits real !`cmd` (avoids `foo`!`bar` false positives).
  const masked = out.replace(/`[^`\n]+`/g, (match, offset: number) => {
    const prev = out[offset - 1]
    if (prev === '!' || prev === '`') return match
    return '`' + ' '.repeat(Math.max(0, match.length - 2)) + '`'
  })
  const matches = [...masked.matchAll(SKILL_SHELL_INLINE_PATTERN)].reverse()
  for (const m of matches) {
    if (m.index === undefined) continue
    out = out.slice(0, m.index) + placeholder + out.slice(m.index + m[0].length)
  }
  return out
}

/**
 * Official EXIT_AFTER_STOP_DELAY densable pure parse — positive ms or null.
 * Full idle timeout manager remains in idleTimeout.ts.
 */
export function resolveExitAfterStopDelayMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_EXIT_AFTER_STOP_DELAY
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Official EXIT_AFTER_FIRST_RENDER densable force-on. */
export function isExitAfterFirstRenderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER)
}
