/**
 * getAuthStatus — pure function; no network calls.
 *
 * Reads process.env + the local OAuth credential file (via the already-memoized
 * getClaudeAIOAuthTokens()) + globalConfig.workspaceApiKey to produce an
 * AuthStatus snapshot used by AuthPlaneSummary for the /login UI.
 *
 * Security contract:
 *   - ANTHROPIC_API_KEY / workspaceApiKey values are NEVER returned raw; only
 *     masked previews are exposed.
 *   - Third-party API key values are NEVER included; only boolean presence flags.
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import type { SubscriptionType } from '../../services/oauth/types.js'
import {
  describeAnthropicProfile,
  getActiveAnthropicProfileName,
  getAnthropicConfigDir,
  getAnthropicProfileSource,
  type AnthropicProfileSource,
} from '../../utils/anthropicProfile.js'
import { getOAuthTokenFromFileDescriptor } from '../../utils/authFileDescriptor.js'
import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
  getConfiguredApiKeyHelper,
} from '../../utils/auth.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import {
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  errorMessage,
  getErrnoCode,
  isEISDIR,
  isENOENT,
  isFsInaccessible,
} from '../../utils/errors.js'
import { sanitizeDisplayText } from '../../utils/displaySanitize.js'
import {
  getAPIProvider,
  type APIProvider,
} from '../../utils/model/providers.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AuthStatus {
  subscription: {
    /** true when a claude.ai OAuth token is present in local storage */
    active: boolean
    /** subscription tier, or null when not logged in / API-key-only mode */
    plan: 'free' | 'pro' | 'max' | 'team' | 'enterprise' | 'unknown' | null
    /** reserved — always null for security (email not included in masked output) */
    accountEmail: null
  }
  workspaceKey: {
    /**
     * true when a workspace API key is available from either the env var or
     * saved settings (workspaceApiKey in ~/.claude.json).
     */
    set: boolean
    /** true when key begins with the expected 'sk-ant-api03-' prefix */
    prefixValid: boolean
    /**
     * Masked preview of the key, e.g. 'sk-a...67 (48 chars)', or null when unset.
     * NEVER contains the raw key value.
     */
    keyPreview: string | null
    /**
     * Where the key came from:
     *   'env'      — ANTHROPIC_API_KEY environment variable
     *   'settings' — workspaceApiKey saved in ~/.claude.json via /login UI
     *   null       — not set
     */
    source: 'env' | 'settings' | null
  }
  /**
   * Local ~/.config/anthropic (or ANTHROPIC_CONFIG_DIR) stack.
   * Gold M$o / A5 / Ewn — no remote profile fetch.
   */
  profile: {
    source: AnthropicProfileSource
    label: string
  }
}

// thirdParty was removed 2026-05-06: fork's existing /login → "Anthropic
// Compatible Setup" form is the single source of truth for OpenAI-compat
// configuration. The summary intentionally only shows Anthropic-side planes
// (subscription / workspace key) which the fork form does not surface.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKSPACE_KEY_PREFIX = 'sk-ant-api03-'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce a masked preview of an API key value.
 * Format: first4 + '...' + last2 + ' (N chars)'
 * e.g.: 'sk-a...67 (48 chars)'
 *
 * E3 fix: keys shorter than 20 chars expose a high % of entropy per char
 * (e.g. 6/14 = 43% exposed). For short/malformed keys, show [redacted] only.
 *
 * Never returns the raw key value.
 */
function maskApiKey(key: string): string {
  const len = key.length
  // E3: short keys — show only length, no prefix
  if (len < 20) return `[redacted] (${len} chars)`
  const first4 = key.slice(0, 4)
  const last2 = key.slice(-2)
  return `${first4}...${last2} (${len} chars)`
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Returns a snapshot of the current auth state by reading:
 *   - process.env.ANTHROPIC_API_KEY (workspace key)
 *   - getClaudeAIOAuthTokens() from the local credential file (subscription OAuth)
 *
 * Third-party provider config (Cerebras / Groq / Qwen / DeepSeek) is owned by
 * fork's existing /login → "Anthropic Compatible Setup" form; the parallel
 * surface here was removed 2026-05-06.
 *
 * This function never throws and never makes network calls.
 */
export function getAuthStatus(): AuthStatus {
  // ---- 1. Subscription OAuth plane ----
  const oauthTokens = getClaudeAIOAuthTokens()
  const subscriptionActive =
    oauthTokens !== null && Boolean(oauthTokens.accessToken)

  let plan: AuthStatus['subscription']['plan'] = null
  if (subscriptionActive && oauthTokens) {
    // 本地持久化或历史 token 中可能出现 'free' 等未纳入 SubscriptionType 的字符串
    const raw = oauthTokens.subscriptionType as
      | (SubscriptionType | 'free')
      | null
    if (
      raw === 'free' ||
      raw === 'pro' ||
      raw === 'max' ||
      raw === 'team' ||
      raw === 'enterprise'
    ) {
      plan = raw
    } else if (raw !== null && raw !== undefined) {
      plan = 'unknown'
    } else {
      plan = null
    }
  }

  // ---- 2. Workspace API key plane (dual-source: env var > settings) ----
  const envKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  const settingsKey = getGlobalConfig().workspaceApiKey?.trim() ?? ''

  let rawKey: string
  let keySource: 'env' | 'settings' | null

  if (envKey.length > 0) {
    rawKey = envKey
    keySource = 'env'
  } else if (settingsKey.length > 0) {
    rawKey = settingsKey
    keySource = 'settings'
  } else {
    rawKey = ''
    keySource = null
  }

  const keySet = rawKey.length > 0
  const prefixValid = rawKey.startsWith(WORKSPACE_KEY_PREFIX)
  const keyPreview = keySet ? maskApiKey(rawKey) : null

  return {
    subscription: {
      active: subscriptionActive,
      plan,
      accountEmail: null,
    },
    workspaceKey: {
      set: keySet,
      prefixValid,
      keyPreview,
      source: keySource,
    },
    profile: {
      source: getAnthropicProfileSource(),
      label: describeAnthropicProfile(),
    },
  }
}

// ---------------------------------------------------------------------------
// densable 2.1.248 #13 — kxt / Ae / fallbackCures (SEA sha 0c86012344382869)
// ---------------------------------------------------------------------------

/** densable C0e — Console profile OAuth client_id. */
export const CONSOLE_PROFILE_CLIENT_ID = '41077d10-94b8-4194-be48-d251e9eb21b4'

/** densable x */
const PROFILE_NAME_RE = /^[A-Za-z0-9_.-]+$/

/** densable fE — labels used in kxt third_party_provider copy. */
const CONSOLE_PROVIDER_LABELS: Partial<
  Record<APIProvider | 'anthropicGoogleCloud', string>
> = {
  bedrock: 'Amazon Bedrock',
  vertex: 'Google Vertex AI',
  foundry: 'Microsoft Foundry',
  anthropicAws: 'Claude Platform on AWS',
  // densable AGC label; leftover APIProvider has no AGC slot — keep for copy only.
  anthropicGoogleCloud: 'Claude Platform on Google Cloud',
  mantle: 'Amazon Bedrock (Mantle)',
  gateway: 'Cloud gateway',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
}

function consoleProviderLabel(provider: APIProvider): string {
  return (
    CONSOLE_PROVIDER_LABELS[provider] ??
    (provider === 'firstParty' ? 'Anthropic' : provider)
  )
}

/**
 * densable O — vHn() returns this flag; fallbackCures only when true AND
 * the class is in N (wHn).
 */
export const CONSOLE_PROFILE_LOGIN_FALLBACK_CURES = {
  no_config_dir: true,
  invalid_profile_name: true,
  foreign_profile: true,
  custom_credentials_path: true,
  api_key_env_nondispatching: true,
  wif_env_quad: false,
  third_party_provider: false,
  api_key_env: false,
  env_credential_shadow: false,
  other_deployment_profile: false,
  federation_profile: false,
  unreadable_profile: false,
} as const

export type ConsoleProfileLoginErrorClass =
  keyof typeof CONSOLE_PROFILE_LOGIN_FALLBACK_CURES

/** densable N — wHn() causeSummary; only these classes can fallbackCures. */
export const CONSOLE_PROFILE_LOGIN_FALLBACK_SUMMARIES = {
  no_config_dir: 'no Anthropic config directory was found',
  invalid_profile_name: "the configured profile name isn't valid",
  foreign_profile: 'the profile on this machine belongs to another tool',
  custom_credentials_path:
    'the existing profile keeps its sign-in somewhere custom',
  api_key_env_nondispatching: 'ANTHROPIC_API_KEY is set in this environment',
} as const

export const KEYLESS_CONSOLE_FALLBACK_LOG =
  'Keyless Console sign-in unavailable here, continuing with the API-key sign-in:'

export const RECOMMENDED_SIGNIN_UNAVAILABLE =
  "The recommended sign-in isn't available on this machine"

type ConsoleProfileFileConfig = {
  created_by?: string
  base_url?: string
  authentication: {
    type: string
    client_id?: string
    credentials_path?: string
  }
}

/** densable Ae */
export class ConsoleProfileLoginError extends Error {
  fallbackCures: boolean
  causeSummary: string | null
  constructor(
    message: string,
    options: {
      fallbackCures: boolean
      causeSummary?: string | null
      cause?: unknown
    },
  ) {
    super(message, { cause: options.cause })
    this.name = 'ConsoleProfileLoginError'
    this.fallbackCures = options.fallbackCures
    this.causeSummary = options.fallbackCures
      ? (options.causeSummary ?? null)
      : null
  }
}

/** densable F */
function isValidConsoleProfileName(name: string | undefined): boolean {
  return !!name && PROFILE_NAME_RE.test(name) && name !== '.' && name !== '..'
}

/** densable Vv — host is api.anthropic.com only (not env Gd). */
function isConsoleProfileFirstPartyBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host === 'api.anthropic.com'
  } catch {
    return false
  }
}

/** densable _d — desktop/local-agent entrypoints count as remote for U2t. */
const CONSOLE_PROFILE_REMOTE_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
])

/** densable tr — CLAUDE_CODE_REMOTE or _d(). */
function isConsoleProfileRemoteSession(): boolean {
  const entry = process.env.CLAUDE_CODE_ENTRYPOINT
  return Boolean(
    process.env.CLAUDE_CODE_REMOTE ||
      (entry !== undefined && CONSOLE_PROFILE_REMOTE_ENTRYPOINTS.has(entry)),
  )
}

/** densable U2t */
function envCredentialShadowsProfile(): boolean {
  return Boolean(
    isBareMode() ||
      process.env.ANTHROPIC_UNIX_SOCKET ||
      isConsoleProfileRemoteSession() ||
      process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      getOAuthTokenFromFileDescriptor() ||
      getConfiguredApiKeyHelper() ||
      process.env.CLAUDE_CODE_USE_BEDROCK ||
      process.env.CLAUDE_CODE_USE_VERTEX ||
      process.env.CLAUDE_CODE_USE_FOUNDRY ||
      process.env.CLAUDE_CODE_USE_ANTHROPIC_AWS ||
      process.env.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD ||
      process.env.CLAUDE_CODE_USE_MANTLE,
  )
}

/** densable Z2t */
async function getApiKeySourceForConsoleProfile(opts?: {
  skipRetrievingKeyFromApiKeyHelper?: boolean
}): Promise<{ key: string | null; source: string }> {
  try {
    return getAnthropicApiKeyWithSource(opts)
  } catch {
    return { key: null, source: 'none' }
  }
}

/** densable kt — unreadable existing file, not ENOENT. */
function isUnreadableProfileFsError(error: unknown): boolean {
  return (isFsInaccessible(error) && !isENOENT(error)) || isEISDIR(error)
}

/** densable A */
function resolveConsoleProfileName(configDir: string): string {
  const name =
    process.env.ANTHROPIC_PROFILE || getActiveAnthropicProfileName(configDir)
  if (!isValidConsoleProfileName(name)) {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `ANTHROPIC_PROFILE "${name}" is not a valid profile name (letters, digits, '_', '.', '-')`,
      'ANTHROPIC_PROFILE is not a valid profile name',
      'invalid_profile_name',
    )
  }
  return name
}

/** densable R */
async function readConsoleProfileConfig(
  path: string,
): Promise<ConsoleProfileFileConfig | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT') return null
    if (isUnreadableProfileFsError(error)) {
      return { authentication: { type: 'unreadable' } }
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    logForDebugging(
      `Profile config is not JSON, treating as foreign: ${errorMessage(error)}`,
    )
    return { authentication: { type: 'unreadable' } }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { authentication: { type: 'unreadable' } }
  }
  const record = parsed as Record<string, unknown>
  const auth = record.authentication
  if (auth === null || typeof auth !== 'object') {
    return { authentication: { type: 'unreadable' } }
  }
  const authRecord = auth as Record<string, unknown>
  if (typeof authRecord.type !== 'string') {
    return { authentication: { type: 'unreadable' } }
  }
  return {
    created_by:
      typeof record.created_by === 'string' ? record.created_by : undefined,
    base_url: typeof record.base_url === 'string' ? record.base_url : undefined,
    authentication: {
      type: authRecord.type,
      client_id:
        typeof authRecord.client_id === 'string'
          ? authRecord.client_id
          : undefined,
      credentials_path:
        typeof authRecord.credentials_path === 'string'
          ? authRecord.credentials_path
          : undefined,
    },
  }
}

/** densable G */
function isConsoleProfileLoginErrorClass(
  value: string | undefined,
): value is ConsoleProfileLoginErrorClass {
  return (
    value !== undefined &&
    Object.hasOwn(CONSOLE_PROFILE_LOGIN_FALLBACK_CURES, value)
  )
}

/** densable vHn */
export function consoleProfileLoginFallbackFlag(
  error: unknown,
): boolean | null {
  if (
    !(
      error instanceof
      TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    ) ||
    error.errorClass === undefined ||
    !isConsoleProfileLoginErrorClass(error.errorClass)
  ) {
    return null
  }
  return CONSOLE_PROFILE_LOGIN_FALLBACK_CURES[error.errorClass]
}

/** densable Y / wHn */
export function consoleProfileLoginFallbackSummary(
  error: unknown,
): string | null {
  if (
    !(
      error instanceof
      TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    ) ||
    error.errorClass === undefined ||
    !Object.hasOwn(CONSOLE_PROFILE_LOGIN_FALLBACK_SUMMARIES, error.errorClass)
  ) {
    return null
  }
  return CONSOLE_PROFILE_LOGIN_FALLBACK_SUMMARIES[
    error.errorClass as keyof typeof CONSOLE_PROFILE_LOGIN_FALLBACK_SUMMARIES
  ]
}

/** densable Kt catch — wrap kxt P into Ae. */
export function wrapConsoleProfileLoginRefusal(error: unknown): never {
  const flag = consoleProfileLoginFallbackFlag(error)
  if (flag === null) throw error
  const summary = consoleProfileLoginFallbackSummary(error)
  throw new ConsoleProfileLoginError(errorMessage(error), {
    fallbackCures: Boolean(flag && summary !== null),
    causeSummary: summary,
    cause: error,
  })
}

/**
 * densable kxt @193501380 sha=0c86012344382869
 * Full SEA body. Throws TelemetrySafeError (P) with errorClass.
 */
export async function kxt(): Promise<{
  profile: string
  configDir: string
  isNewProfile: boolean
}> {
  if (
    !isValidConsoleProfileName(process.env.ANTHROPIC_PROFILE) &&
    process.env.ANTHROPIC_FEDERATION_RULE_ID &&
    process.env.ANTHROPIC_ORGANIZATION_ID
  ) {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      'Workload identity federation is configured in this environment (ANTHROPIC_FEDERATION_RULE_ID and ANTHROPIC_ORGANIZATION_ID), and it takes precedence over the default profile. Set ANTHROPIC_PROFILE to a profile name to sign in with a profile that outranks it.',
      'Console profile login refused: env-quad federation outranks the implicit profile',
      'wif_env_quad',
    )
  }
  const provider = getAPIProvider()
  if (provider !== 'firstParty') {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `This session uses ${consoleProviderLabel(provider)}, which does not use Anthropic Console sign-in.`,
      'This session uses a third-party provider, which does not use Anthropic Console sign-in.',
      'third_party_provider',
    )
  }
  const envApiKey = process.env.ANTHROPIC_API_KEY
  if (envApiKey) {
    const resolved = await getApiKeySourceForConsoleProfile({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (resolved.source === 'ANTHROPIC_API_KEY' && resolved.key === envApiKey) {
      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        'ANTHROPIC_API_KEY is set in this environment and takes precedence over a profile, so a profile sign-in would not be used. Unset it to sign in this way.',
        'Console profile login refused: env credential shadows the profile',
        'api_key_env',
      )
    }
  }
  if (envCredentialShadowsProfile()) {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      'Something in this environment \u2014 an API key helper, an injected token, or a third-party provider setting \u2014 takes precedence over a profile sign-in, so it would not be used here.',
      'Console profile login refused: env credential shadows the profile',
      'env_credential_shadow',
    )
  }
  const configDir = getAnthropicConfigDir()
  if (configDir === null) {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      'Cannot locate the Anthropic config directory. Set ANTHROPIC_CONFIG_DIR (or HOME) and try again.',
      'Console profile login refused: no config directory',
      'no_config_dir',
    )
  }
  const profile = resolveConsoleProfileName(configDir)
  const existing = await readConsoleProfileConfig(
    join(configDir, 'configs', `${profile}.json`),
  )
  if (existing !== null) {
    if (
      existing.base_url &&
      !isConsoleProfileFirstPartyBaseUrl(existing.base_url)
    ) {
      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        'This profile is bound to a different Anthropic deployment, so Claude Code will not replace it here. Sign out of it with the tool that created it, then try again.',
        'Console profile login refused: profile bound to another deployment',
        'other_deployment_profile',
      )
    }
    if (existing.authentication.type === 'oidc_federation') {
      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        'This machine is set up for workload identity federation, which signs in on its own. If you need a different sign-in, ask whoever configured it.',
        'Console profile login refused: federation profile',
        'federation_profile',
      )
    }
    if (existing.authentication.type !== 'user_oauth') {
      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        'Claude Code cannot read the existing sign-in on this machine, so it will not overwrite it. Check the permissions on your Anthropic config directory, then try again.',
        'Console profile login refused: unreadable or unrecognized profile config',
        'unreadable_profile',
      )
    }
    if (existing.authentication.client_id !== CONSOLE_PROFILE_CLIENT_ID) {
      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        'This machine already has a sign-in from another tool that Claude Code cannot replace. Sign out with that tool, then try again.',
        'Console profile login refused: profile is not a same-client login',
        'foreign_profile',
      )
    }
    if (existing.authentication.credentials_path) {
      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        'This profile keeps its sign-in somewhere custom, so Claude Code cannot replace it. Sign out of it with the tool that created it, then try again.',
        'Console profile login refused: custom credentials_path',
        'custom_credentials_path',
      )
    }
  }
  if (envApiKey) {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      'ANTHROPIC_API_KEY is set in this environment. Unset it to sign in without an API key.',
      'Console profile login refused: non-dispatching env API key present',
      'api_key_env_nondispatching',
    )
  }
  return {
    profile,
    configDir,
    isNewProfile: existing === null,
  }
}

/** densable pt/Kt preflight — kxt then Ae wrap. */
export async function startConsoleProfileLoginPreflight(): Promise<void> {
  try {
    await kxt()
  } catch (error) {
    wrapConsoleProfileLoginRefusal(error)
  }
}

/**
 * densable startOAuth catch — st() + Keyless warn. Caller continues
 * startOAuthFlow (API-key).
 */
export function noteKeylessConsoleFallback(error: ConsoleProfileLoginError): {
  cause: string
  message: string
} {
  const message = sanitizeDisplayText(errorMessage(error))
  const reason = {
    cause:
      error.causeSummary !== null
        ? sanitizeDisplayText(error.causeSummary)
        : message,
    message,
  }
  logForDebugging(`${KEYLESS_CONSOLE_FALLBACK_LOG} ${message}`, {
    level: 'warn',
  })
  return reason
}
