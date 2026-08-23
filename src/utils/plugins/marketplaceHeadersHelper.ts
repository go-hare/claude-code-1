/**
 * densable 2.1.238 — marketplace / catalog `headersHelper` mint + header filter.
 *
 * SEA gold: `m5n` / `N4S` / `W4S` / `G4S` / `b5n` / `q4S` memo.
 * Product-separate from MCP `src/services/mcp/headersHelper.ts`.
 */

import { getAllowedSettingSources } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isRemoteManagedPolicyConsented } from '../../services/remoteManagedSettings/syncCacheState.js'
import { checkHasTrustDialogAccepted } from '../config.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import type { SettingSource } from '../settings/constants.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../settings/settings.js'
import { jsonParse } from '../slowOperations.js'
import { getAddDirExtraMarketplaces } from './addDirPluginSettings.js'
import { areCommandPluginSourcesDisabledByPolicy } from './pluginCommandSource.js'
import { parsePluginIdentifier } from './pluginIdentifier.js'
import {
  headersHelperPolicyRefusal,
  isHeadersHelperDisabledByPolicy,
  type HeadersHelperPolicyRefusal,
} from './pluginPolicy.js'
import type { MarketplaceSource, PluginMarketplaceEntry } from './schemas.js'
import { isSameOrigin } from './pluginArchive.js'

/** SEA `U2a` — plugin ids safe to splice into a `claude plugin …` invocation. */
const SAFE_CLI_PLUGIN_ID = /^\w[\w.@-]*$/

/**
 * SEA `O3n` — remote managed-settings not yet verified/consented.
 */
export const ENTRY_HELPER_REMOTE_POLICY_UNCONSENTED =
  'it is declared by remotely managed settings that this session could not verify with the server, or that have not been approved on this machine yet — make sure Claude Code can reach your managed-settings server, and approve the managed-settings dialog once in an interactive session (or ask your admin)'

/**
 * SEA abort copy when explicit update disclosure is not accepted.
 */
export const ENTRY_HELPER_UPDATE_ABORT_MESSAGE =
  'Aborted — the headersHelper command was not confirmed, so it was not run.'

/**
 * SEA Oyw abort when Vgh returns declined or unconfirmed (not command-source
 * `Aborted.`). Unconfirmed still aborts here — it does not fall through to zgh.
 */
export const ENTRY_HELPER_INSTALL_ABORT_MESSAGE =
  'Aborted — the command was not run.'

/** SEA `M4S` */
export const HEADERS_HELPER_TIMEOUT_MS = 10_000
/** SEA `L4S` */
export const HEADERS_HELPER_MAX_BUFFER = 1_000_000
/** SEA `z4S` — marketplace helper memo TTL */
export const MARKETPLACE_HEADERS_HELPER_MEMO_TTL_MS = 60_000

export type HeadersHelperFailReason =
  | 'exec_failed'
  | 'parse_failed'
  | 'non_object'
  | 'non_string_value'
  | 'missing_trust'

export type HeadersHelperMintResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: HeadersHelperFailReason }

/**
 * SEA `s4o` + GITHUB_TOKEN/GH_TOKEN — fixed credential env names scrubbed from
 * non-operator helper child env (and whose values are REDACTED in helper env).
 */
const FIXED_CREDENTIAL_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_ARTIFACTS_API_TOKEN',
  'CLAUDE_CODE_MEMORY_API_TOKEN',
  'CLAUDE_CODE_SLACK_TAG_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
] as const

/** SEA `OUu` / `FF_` */
const CREDENTIAL_NAME_FRAGMENT_RE =
  /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|KEY|AUTH|COOKIE|PAT|DSN|CREDENTIAL|CREDENTIALS)(_|$)/i
/** SEA `BF_` — exclude GIT_CONFIG_KEY_N */
const GIT_CONFIG_KEY_RE = /^GIT_CONFIG_KEY_[0-9][A-Za-z0-9_]*$/

/**
 * SEA `V4S` — exact request-routing / identity header names (lowercased).
 */
const ROUTING_IDENTITY_HEADERS = new Set([
  'host',
  'cookie',
  'forwarded',
  'x-real-ip',
  'x-client-ip',
  'true-client-ip',
  'client-ip',
  'cf-connecting-ip',
  'fastly-client-ip',
  'x-originating-ip',
  'x-remote-ip',
  'x-remote-addr',
  'x-cluster-client-ip',
  'connection',
  'upgrade',
  'transfer-encoding',
  'content-length',
  'te',
  'trailer',
  'expect',
  'via',
])

/** SEA `K4S` — prefixes */
const ROUTING_IDENTITY_PREFIXES = ['x-forwarded-', 'x-original-', 'proxy-']

/** SEA `Y4S` — HTTP header name token */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

type MemoEntry = {
  expiresAt: number
  headers: Promise<Record<string, string>>
}

const marketplaceHelperMemo = new Map<string, MemoEntry>()

/** Test helper — clear marketplace helper memo. */
export function clearMarketplaceHeadersHelperMemo(): void {
  marketplaceHelperMemo.clear()
}

/**
 * SEA `LMr` (subset used by headersHelper scrub) — fixed keys + heuristic
 * credential-looking names present on process.env / overlay.
 */
export function listCredentialEnvKeysForHeadersHelper(
  overlay: NodeJS.ProcessEnv = {},
): string[] {
  const keys = new Set<string>(FIXED_CREDENTIAL_ENV_KEYS)
  for (const name of [...Object.keys(process.env), ...Object.keys(overlay)]) {
    if (
      CREDENTIAL_NAME_FRAGMENT_RE.test(name) &&
      !GIT_CONFIG_KEY_RE.test(name)
    ) {
      keys.add(name)
    }
  }
  return [...keys]
}

/**
 * SEA `N4S` — build child env for headersHelper.
 * Base is a process.env copy (tip stand-in for SEA `JP()`); when scrubbing,
 * delete credential keys and REDACT their values inside helper-supplied env.
 */
export function buildHeadersHelperChildEnv(options: {
  scrubCredentialEnv: boolean
  env?: Record<string, string>
}): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  if (!options.scrubCredentialEnv) {
    return { ...base, ...options.env }
  }
  const secrets: string[] = []
  for (const key of listCredentialEnvKeysForHeadersHelper(options.env ?? {})) {
    const value = process.env[key] ?? base[key]
    if (value !== undefined && value !== '') {
      secrets.push(value)
    }
    delete base[key]
  }
  secrets.sort((a, b) => b.length - a.length)
  const scrubbed: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.env ?? {})) {
    scrubbed[key] = secrets.reduce(
      (acc, secret) => acc.split(secret).join('REDACTED'),
      value,
    )
  }
  return { ...base, ...scrubbed }
}

export function isRoutingOrIdentityHeader(name: string): boolean {
  const n = name.toLowerCase().replaceAll('_', '-')
  return (
    ROUTING_IDENTITY_HEADERS.has(n) ||
    ROUTING_IDENTITY_PREFIXES.some(prefix => n.startsWith(prefix))
  )
}

/**
 * SEA `b5n` — drop malformed / non-operator routing-identity headers.
 */
export function filterPluginFetchHeaders(
  headers: Record<string, string> | undefined,
  label: string,
  options: { operatorAuthored?: boolean } = {},
): Record<string, string> {
  const operatorAuthored = options.operatorAuthored === true
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME_RE.test(name) || /[\r\n\0]/.test(value)) {
      logForDebugging(
        `Dropping header "${name}" for ${label}: malformed name or value`,
        { level: 'warn' },
      )
      continue
    }
    if (!operatorAuthored && isRoutingOrIdentityHeader(name)) {
      logForDebugging(
        `Dropping header "${name}" for ${label}: request-routing/identity headers are not accepted from non-operator sources`,
        { level: 'warn' },
      )
      continue
    }
    out[name] = value
  }
  return out
}

/**
 * SEA `m5n` — shell-run headersHelper → JSON object of string headers.
 */
export async function mintHeadersFromHelper(options: {
  command: string
  cwd: string
  scrubCredentialEnv: boolean
  env?: Record<string, string>
}): Promise<HeadersHelperMintResult> {
  const execResult = await execFileNoThrowWithCwd(options.command, [], {
    shell: true,
    timeout: HEADERS_HELPER_TIMEOUT_MS,
    maxBuffer: HEADERS_HELPER_MAX_BUFFER,
    cwd: options.cwd,
    env: buildHeadersHelperChildEnv({
      scrubCredentialEnv: options.scrubCredentialEnv,
      env: options.env,
    }),
    extendEnv: false,
  })
  if (execResult.code !== 0 || !execResult.stdout) {
    return { ok: false, reason: 'exec_failed' }
  }
  let parsed: unknown
  try {
    parsed = jsonParse(execResult.stdout.trim())
  } catch {
    return { ok: false, reason: 'parse_failed' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'non_object' }
  }
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (typeof value !== 'string') {
      return { ok: false, reason: 'non_string_value' }
    }
    headers[key] = value
  }
  return { ok: true, headers }
}

/**
 * SEA `S$a` — GrowthBook kill switch for marketplace-declared command helpers.
 * Default true (enabled) when unset/stale.
 */
export function isMarketplaceHeadersHelperKillSwitchEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
    'tengu_plugin_command_source_refresh',
    true,
  )
}

/**
 * SEA `W4S` — run marketplace url-source headersHelper once.
 */
export async function runMarketplaceHeadersHelper(
  command: string,
  marketplaceUrl: string,
  marketplaceName: string | undefined,
  operatorAuthored: boolean,
): Promise<Record<string, string>> {
  const result = await mintHeadersFromHelper({
    command,
    scrubCredentialEnv: !operatorAuthored,
    cwd: getClaudeConfigHomeDir(),
    env: {
      CLAUDE_CODE_MARKETPLACE_URL: marketplaceUrl,
      ...(marketplaceName !== undefined
        ? { CLAUDE_CODE_MARKETPLACE_NAME: marketplaceName }
        : {}),
    },
  })
  if (!result.ok) {
    throw new Error(`marketplace headersHelper failed (${result.reason})`)
  }
  return result.headers
}

/**
 * SEA `q4S` — memoize marketplace helper by command/url/name/tier for 60s.
 */
export async function runMarketplaceHeadersHelperMemoized(
  command: string,
  marketplaceUrl: string,
  marketplaceName: string | undefined,
  operatorAuthored: boolean,
): Promise<Record<string, string>> {
  const key = `${command}\0${marketplaceUrl}\0${marketplaceName ?? ''}\0${
    operatorAuthored ? 'operator' : 'repo'
  }`
  const now = Date.now()
  const hit = marketplaceHelperMemo.get(key)
  if (hit && hit.expiresAt > now) {
    return hit.headers
  }
  const pending = runMarketplaceHeadersHelper(
    command,
    marketplaceUrl,
    marketplaceName,
    operatorAuthored,
  )
  marketplaceHelperMemo.set(key, {
    expiresAt: now + MARKETPLACE_HEADERS_HELPER_MEMO_TTL_MS,
    headers: pending,
  })
  try {
    return await pending
  } catch (error) {
    marketplaceHelperMemo.delete(key)
    throw error
  }
}

/**
 * SEA `_5n` `trustedDeclaration` / `ret()` hit.
 * Mint only `trusted.headersHelper` — never `known_marketplaces.json` state helper.
 */
export type TrustedMarketplaceAuth = {
  headers?: Record<string, string>
  headersHelper?: string
  operatorAuthored: boolean
  authoredBy: string
}

export type ResolveUrlMarketplaceHeadersOptions = {
  marketplaceName?: string
  /**
   * SEA `_5n` `t.trustedDeclaration`.
   * Omit (`undefined`) → `lookupTrustedMarketplaceAuth` (`ret()`).
   * Pass `null` → no trusted declaration (state helper must not exec).
   */
  trustedDeclaration?: TrustedMarketplaceAuth | null
  /** Label for logs / errors (defaults to marketplace name or URL). */
  label?: string
}

/** SEA `ZKp` operator ranks — project/local are repo-tier, not scanned here. */
const OPERATOR_TRUST_TIERS: Array<{
  source: 'policySettings' | 'flagSettings' | 'userSettings'
  rank: number
}> = [
  { source: 'policySettings', rank: 0 },
  { source: 'flagSettings', rank: 1 },
  { source: 'userSettings', rank: 2 },
]

/**
 * SEA `iHe` — canonicalize marketplace URL for `ret()` matching.
 * `URL` already lowercases + punycode-encodes hostname (SEA `H3n`).
 */
export function canonicalizeMarketplaceUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.toString()
  } catch {
    return url
  }
}

function trustedFromKnownEntry(
  entry: { source: MarketplaceSource } | undefined,
  authoredBy: string,
  canonicalUrl: string,
): TrustedMarketplaceAuth | undefined {
  if (entry === undefined || entry.source.source !== 'url') {
    return undefined
  }
  if (canonicalizeMarketplaceUrl(entry.source.url) !== canonicalUrl) {
    return undefined
  }
  const helper = entry.source.headersHelper
  return {
    headers: entry.source.headers,
    headersHelper:
      typeof helper === 'string' && helper !== '' ? helper : undefined,
    operatorAuthored: authoredBy !== 'repo',
    authoredBy,
  }
}

function scanExtraKnownMarketplaces(
  extra: Record<string, { source: MarketplaceSource }> | undefined,
  canonicalUrl: string,
  marketplaceName: string | undefined,
  authoredBy: string,
): TrustedMarketplaceAuth | undefined {
  if (extra === undefined) {
    return undefined
  }
  if (marketplaceName !== undefined) {
    const named = trustedFromKnownEntry(
      extra[marketplaceName],
      authoredBy,
      canonicalUrl,
    )
    if (named !== undefined) {
      return named
    }
  }
  for (const entry of Object.values(extra)) {
    const hit = trustedFromKnownEntry(entry, authoredBy, canonicalUrl)
    if (hit !== undefined) {
      return hit
    }
  }
  return undefined
}

/**
 * SEA `ret` — trusted marketplace auth from operator extraKnownMarketplaces,
 * else repo-tier merged settings when the trust dialog is accepted.
 * Never reads `known_marketplaces.json` state.
 */
export function lookupTrustedMarketplaceAuth(
  source: MarketplaceSource,
  marketplaceName?: string,
): TrustedMarketplaceAuth | undefined {
  if (source.source !== 'url') {
    return undefined
  }
  const canonicalUrl = canonicalizeMarketplaceUrl(source.url)
  const allowed = new Set(getAllowedSettingSources())
  const operatorTiers = OPERATOR_TRUST_TIERS.filter(tier =>
    allowed.has(tier.source),
  ).sort((a, b) => a.rank - b.rank)
  for (const tier of operatorTiers) {
    const extra = getSettingsForSource(tier.source)?.extraKnownMarketplaces
    const hit = scanExtraKnownMarketplaces(
      extra,
      canonicalUrl,
      marketplaceName,
      tier.source,
    )
    if (hit !== undefined) {
      return hit
    }
  }
  if (!checkHasTrustDialogAccepted()) {
    return undefined
  }
  return scanExtraKnownMarketplaces(
    getInitialSettings().extraKnownMarketplaces,
    canonicalUrl,
    marketplaceName,
    'repo',
  )
}

/**
 * SEA `Ryt`/`vBa` overlay from extraKnownMarketplaces settings-source plugins.
 * Distinct from url-marketplace `ret()` — named key only, never
 * `known_marketplaces.json`.
 */
export type TrustedSettingsEntryAuth = {
  origin: 'settings' | 'repo' | 'addDir'
  operatorTier?: 'policySettings' | 'flagSettings' | 'userSettings'
  archiveUrl: string
  headers?: Record<string, string>
  headersHelper?: string
}

/**
 * SEA DNt/G4S/J8p/g5n operate on overlay entries that may omit catalog
 * `source` and whose helper is a plain string (not the branded schema).
 */
export type OverlayableArchiveEntry = {
  name?: string
  headers?: Record<string, string>
  headersHelper?: string
  strict?: boolean
  source?: PluginMarketplaceEntry['source']
  version?: string
}

/** SEA `DNt` result — catalog entry rewritten (or emptied) before J8p/G4S/g5n. */
export type OverlayEntryAuth = {
  entry: OverlayableArchiveEntry
  operatorAuthored: boolean
  requireInlinedManifest: boolean
}

type ExtraKnownMarketplaceRecord = {
  source?: MarketplaceSource
}

function extraKnownNamed(
  extra: Record<string, ExtraKnownMarketplaceRecord> | undefined,
  marketplaceName: string,
): ExtraKnownMarketplaceRecord | undefined {
  if (extra === undefined || !Object.hasOwn(extra, marketplaceName)) {
    return undefined
  }
  return extra[marketplaceName]
}

/**
 * SEA `vBa` — settings-source extraKnown plugin row → overlay auth.
 * addDir always strips helper.
 */
function settingsEntryAuthFromKnown(
  extra: ExtraKnownMarketplaceRecord | undefined,
  pluginName: string,
  origin: TrustedSettingsEntryAuth['origin'],
  operatorTier?: TrustedSettingsEntryAuth['operatorTier'],
): TrustedSettingsEntryAuth | undefined {
  if (extra === undefined || extra.source?.source !== 'settings') {
    return undefined
  }
  const plugin = extra.source.plugins.find(p => p.name === pluginName)
  if (
    !plugin ||
    typeof plugin.source !== 'object' ||
    plugin.source === null ||
    plugin.source.source !== 'archive'
  ) {
    return undefined
  }
  const helper = plugin.headersHelper
  return {
    origin,
    ...(operatorTier !== undefined ? { operatorTier } : {}),
    archiveUrl: plugin.source.url,
    headers: plugin.headers,
    headersHelper:
      origin !== 'addDir' && typeof helper === 'string' && helper !== ''
        ? helper
        : undefined,
  }
}

/**
 * SEA `Ryt` — operator extraKnown named key, then (if trust dialog accepted)
 * repo merged settings, then addDir extraKnown. Never reads
 * `known_marketplaces.json`. Named-key miss does not URL-scan (unlike `ret`).
 */
export function lookupTrustedSettingsEntryAuth(
  marketplaceName: string | undefined,
  pluginName: string,
): TrustedSettingsEntryAuth | undefined {
  if (marketplaceName === undefined) {
    return undefined
  }
  const allowed = new Set(getAllowedSettingSources())
  const operatorTiers = OPERATOR_TRUST_TIERS.filter(tier =>
    allowed.has(tier.source),
  ).sort((a, b) => a.rank - b.rank)
  for (const tier of operatorTiers) {
    const named = extraKnownNamed(
      getSettingsForSource(tier.source)?.extraKnownMarketplaces,
      marketplaceName,
    )
    // SEA: key hit returns vBa even when vBa is undefined (no fallthrough).
    if (named !== undefined) {
      return settingsEntryAuthFromKnown(
        named,
        pluginName,
        'settings',
        tier.source,
      )
    }
  }
  if (!checkHasTrustDialogAccepted()) {
    return undefined
  }
  const repoNamed = extraKnownNamed(
    getInitialSettings().extraKnownMarketplaces,
    marketplaceName,
  )
  if (repoNamed !== undefined) {
    return settingsEntryAuthFromKnown(repoNamed, pluginName, 'repo')
  }
  const addDirNamed = extraKnownNamed(
    getAddDirExtraMarketplaces(),
    marketplaceName,
  )
  if (addDirNamed === undefined) {
    return undefined
  }
  return settingsEntryAuthFromKnown(addDirNamed, pluginName, 'addDir')
}

/**
 * SEA `KQe` — non-empty string headersHelper.
 */
export function entryDeclaresHeadersHelper(
  entry: Pick<{ headersHelper?: string }, 'headersHelper'>,
): boolean {
  return typeof entry.headersHelper === 'string' && entry.headersHelper !== ''
}

/**
 * SEA `DNt` — overlay catalog entry from extraKnown settings-source auth.
 *
 * Overlay from origin≠settings is discarded unless the marketplace itself is
 * settings-source. URL mismatch empties the entry (no helper). policySettings
 * helper + !psr throws before q9(). addDir helper is stripped. Settings-source
 * marketplace without overlay keeps static headers only (strips catalog helper).
 */
export function overlayTrustedSettingsEntryAuth(options: {
  entry: OverlayableArchiveEntry
  archiveUrl: string
  marketplaceSource?: MarketplaceSource
  trustedSettingsEntryAuth?: TrustedSettingsEntryAuth
}): OverlayEntryAuth {
  const trusted =
    options.trustedSettingsEntryAuth !== undefined &&
    options.trustedSettingsEntryAuth.origin !== 'settings' &&
    options.marketplaceSource?.source !== 'settings'
      ? undefined
      : options.trustedSettingsEntryAuth
  if (trusted !== undefined) {
    const operatorAuthored = trusted.origin === 'settings'
    if (
      canonicalizeMarketplaceUrl(trusted.archiveUrl) !==
      canonicalizeMarketplaceUrl(options.archiveUrl)
    ) {
      return {
        entry: {},
        operatorAuthored,
        requireInlinedManifest: false,
      }
    }
    if (
      trusted.headersHelper !== undefined &&
      trusted.operatorTier === 'policySettings' &&
      !isRemoteManagedPolicyConsented()
    ) {
      throw new Error(
        `This plugin's headersHelper was not run: ${ENTRY_HELPER_REMOTE_POLICY_UNCONSENTED}.`,
      )
    }
    return {
      entry: {
        headers: trusted.headers,
        headersHelper:
          trusted.origin === 'addDir' ? undefined : trusted.headersHelper,
      },
      operatorAuthored,
      requireInlinedManifest: false,
    }
  }
  if (
    options.marketplaceSource !== undefined &&
    options.marketplaceSource.source !== 'settings'
  ) {
    return {
      entry: options.entry,
      operatorAuthored: false,
      requireInlinedManifest: true,
    }
  }
  return {
    entry: { headers: options.entry.headers },
    operatorAuthored: false,
    requireInlinedManifest: true,
  }
}

/**
 * SEA `g5n` — helper shown/consented from the DNt overlay entry.
 * Overlay path (`requireInlinedManifest: false`) does not need `strict: false`.
 * Catalog path still requires `strict: false`. Pane identity remains
 * command + archiveUrl (no pluginId).
 */
export function getShownArchiveHeadersHelperFromOverlay(
  overlay: OverlayEntryAuth,
  archiveUrl: string,
): { command: string; archiveUrl: string } | null {
  const { entry } = overlay
  if (!entryDeclaresHeadersHelper(entry) || entry.headersHelper === undefined) {
    return null
  }
  if (!overlay.requireInlinedManifest || entry.strict === false) {
    return { command: entry.headersHelper, archiveUrl }
  }
  return null
}

/**
 * Resolve the helper a pane / qhi / bin should show: Ryt → DNt → g5n.
 * Overlay policy throw is swallowed when `catchOverlayRefusal` (UI/CLI bin).
 */
export function resolveShownArchiveHeadersHelper(options: {
  entry: OverlayableArchiveEntry & { name?: string }
  marketplaceName?: string
  marketplaceSource?: MarketplaceSource
  trustedSettingsEntryAuth?: TrustedSettingsEntryAuth
  /** SEA `bin` / pane: sve → null. ayi/ggw/P5r leave this false. */
  catchOverlayRefusal?: boolean
}): { command: string; archiveUrl: string } | null {
  if (
    typeof options.entry.source !== 'object' ||
    options.entry.source === null ||
    options.entry.source.source !== 'archive'
  ) {
    return null
  }
  const archiveUrl = options.entry.source.url
  const trusted =
    options.trustedSettingsEntryAuth !== undefined
      ? options.trustedSettingsEntryAuth
      : lookupTrustedSettingsEntryAuth(
          options.marketplaceName,
          options.entry.name ?? '',
        )
  try {
    const overlay = overlayTrustedSettingsEntryAuth({
      entry: options.entry,
      archiveUrl,
      marketplaceSource: options.marketplaceSource,
      trustedSettingsEntryAuth: trusted,
    })
    return getShownArchiveHeadersHelperFromOverlay(overlay, archiveUrl)
  } catch (error) {
    if (options.catchOverlayRefusal) {
      return null
    }
    throw error
  }
}

/**
 * SEA `bin` — CLI unconfirmed helper after refresh. Overlay sve → null;
 * YLa/fgt → null (install continues; J8p throws later).
 */
export function resolveCliUnconfirmedArchiveHelper(options: {
  entry: OverlayableArchiveEntry & { name?: string }
  marketplaceName?: string
  marketplaceSource?: MarketplaceSource
}): { command: string; archiveUrl: string } | null {
  const helper = resolveShownArchiveHeadersHelper({
    ...options,
    catchOverlayRefusal: true,
  })
  if (helper === null) {
    return null
  }
  if (
    isHeadersHelperDisabledByPolicy(
      options.marketplaceSource,
      options.marketplaceName,
    )
  ) {
    return null
  }
  return helper
}

/**
 * SEA `_5n` — static url marketplace headers ⊕ helper-minted overlay.
 * Mints only `trustedDeclaration.headersHelper` (from `ret()`), never state.
 * https-only for helper; policy/kill-switch gates; helper overrides static.
 */
export async function resolveUrlMarketplaceHeaders(
  source: Extract<MarketplaceSource, { source: 'url' }>,
  options: ResolveUrlMarketplaceHeadersOptions = {},
): Promise<Record<string, string>> {
  const trusted =
    options.trustedDeclaration === undefined
      ? lookupTrustedMarketplaceAuth(source, options.marketplaceName)
      : (options.trustedDeclaration ?? undefined)

  const label =
    options.label ??
    (options.marketplaceName
      ? `marketplace ${options.marketplaceName}`
      : `marketplace ${source.url}`)
  const operatorAuthored = trusted?.operatorAuthored === true
  const filter = (
    headers: Record<string, string> | undefined,
    provenance: string,
  ) =>
    filterPluginFetchHeaders(headers, `${label} (${provenance})`, {
      operatorAuthored,
    })

  const staticHeaders = trusted
    ? filter(
        trusted.headers,
        trusted.operatorAuthored
          ? 'operator declaration'
          : 'repo-tier declaration',
      )
    : filter(source.headers, 'state copy')

  if (trusted?.headersHelper === undefined) {
    return staticHeaders
  }
  if (!/^https:\/\//i.test(source.url)) {
    logForDebugging(
      `${label}: headersHelper not run — marketplace URL is not https`,
      { level: 'warn' },
    )
    return staticHeaders
  }

  if (
    trusted.authoredBy === 'policySettings' &&
    !isRemoteManagedPolicyConsented()
  ) {
    throw new Error(
      `${label}: headersHelper not run — ${ENTRY_HELPER_REMOTE_POLICY_UNCONSENTED}. The marketplace was not fetched.`,
    )
  }
  if (
    areCommandPluginSourcesDisabledByPolicy() &&
    trusted.authoredBy !== 'policySettings'
  ) {
    throw new Error(
      `${label}: your organization's managed settings disable marketplace-declared commands ` +
        `(disableCommandPluginSources / allowManagedHooksOnly), and this marketplace's headersHelper ` +
        `is not declared in managed settings. The marketplace was not fetched and the command was not run; ` +
        `ask your admin to allow it or to declare the marketplace in managed settings.`,
    )
  }

  if (!isMarketplaceHeadersHelperKillSwitchEnabled()) {
    logForDebugging(
      `${label}: headersHelper not run — disabled by the plugin command kill switch`,
      { level: 'warn' },
    )
    return staticHeaders
  }

  const minted = await runMarketplaceHeadersHelperMemoized(
    trusted.headersHelper,
    source.url,
    options.marketplaceName,
    operatorAuthored,
  )
  return {
    ...staticHeaders,
    ...filter(minted, 'helper output'),
  }
}

export type ResolvePluginArchiveHeadersOptions = {
  pluginName: string
  archiveUrl: string
  runEntryHelper: boolean
  operatorAuthored?: boolean
  requireInlinedManifest?: boolean
  marketplaceSource?: MarketplaceSource
  marketplaceName?: string
  marketplaceHeaders?: Record<string, string>
  /** densable P5r `S5n(i,t)` — marketplace catalog URL vs archive URL. */
  marketplaceUrl?: string
}

/**
 * SEA `G4S` + `J8p` — entry static/helper headers overlaid on marketplace headers.
 * Entry helper runs only when `runEntryHelper` (install/update path).
 */
export async function resolvePluginArchiveHeaders(
  entry: OverlayableArchiveEntry,
  options: ResolvePluginArchiveHeadersOptions,
): Promise<Record<string, string>> {
  const operatorAuthored = options.operatorAuthored === true
  const filter = (headers: Record<string, string> | undefined) =>
    filterPluginFetchHeaders(headers, `plugin ${options.pluginName}`, {
      operatorAuthored,
    })

  // densable P5r: marketplace headers only if url-source AND S5n; G4S entry always.
  const base = mergeSameOriginArchiveHeaders({
    marketplaceUrl: options.marketplaceUrl,
    archiveUrl: options.archiveUrl,
    marketplaceHeaders: options.marketplaceHeaders,
    entryHeaders: filter(entry.headers),
  })

  // SEA G4S: `if(!KQe(e)||e.headersHelper===void 0)return n` — overlay entries
  // have no `source` field; do not require catalog archive source here.
  if (typeof entry.headersHelper !== 'string' || entry.headersHelper === '') {
    return base
  }

  assertEntryHeadersHelperMayRun(entry, options)

  const minted = await mintHeadersFromHelper({
    command: entry.headersHelper,
    scrubCredentialEnv: !operatorAuthored,
    cwd: getClaudeConfigHomeDir(),
    env: {
      CLAUDE_CODE_PLUGIN_NAME: options.pluginName,
      CLAUDE_CODE_PLUGIN_ARCHIVE_URL: options.archiveUrl,
    },
  })
  if (!minted.ok) {
    throw new Error(
      `plugin headersHelper for "${options.pluginName}" failed (${minted.reason})`,
    )
  }
  return { ...base, ...filter(minted.headers) }
}

/**
 * SEA `J8p` — policy / strict:false / runEntryHelper gates before entry helper.
 */
export function assertEntryHeadersHelperMayRun(
  entry: Pick<OverlayableArchiveEntry, 'headersHelper' | 'strict'>,
  options: {
    pluginName: string
    runEntryHelper: boolean
    requireInlinedManifest?: boolean
    marketplaceSource?: MarketplaceSource
    marketplaceName?: string
  },
): void {
  const refusal = headersHelperPolicyRefusal(
    options.marketplaceSource,
    options.marketplaceName,
  )
  if (refusal !== null) {
    if (refusal === 'remote_policy_unconsented') {
      throw new Error(
        `This plugin's headersHelper was not run: remote managed settings not yet verified and consented.`,
      )
    }
    throw new Error(
      `Plugin "${options.pluginName}" fetches its archive through a marketplace-declared headersHelper command, and your organization's managed settings disable marketplace-declared commands (disableCommandPluginSources / allowManagedHooksOnly).`,
    )
  }

  if (options.requireInlinedManifest !== false && entry.strict !== false) {
    throw new Error(
      `Plugin "${options.pluginName}" declares a headersHelper but is not strict:false — an entry with headersHelper must inline its manifest so its capabilities can be reviewed before the command runs.`,
    )
  }

  if (!options.runEntryHelper) {
    throw new Error(
      `Plugin "${options.pluginName}" fetches its archive through a headersHelper, ` +
        'which only runs when you install or update it from its own details view — open this plugin in /plugin (or run `claude plugin install`/`update`), where the command is shown first.',
    )
  }
}

/**
 * Whether an entry declares a headersHelper that applies to its archive source.
 * SEA KQe: empty string is absent (same gate as entryDeclaresHeadersHelper).
 */
export function entryHasArchiveHeadersHelper(
  entry: Pick<PluginMarketplaceEntry, 'headersHelper' | 'source'>,
): boolean {
  if (!entryDeclaresHeadersHelper(entry)) return false
  return (
    typeof entry.source === 'object' &&
    entry.source !== null &&
    'source' in entry.source &&
    entry.source.source === 'archive'
  )
}

/**
 * Merge marketplace + entry headers for same-origin archive install.
 * Marketplace headers only apply when archive shares marketplace origin.
 */
export function mergeSameOriginArchiveHeaders(options: {
  marketplaceUrl?: string
  archiveUrl: string
  marketplaceHeaders?: Record<string, string>
  entryHeaders?: Record<string, string>
}): Record<string, string> {
  const entry = options.entryHeaders ?? {}
  if (
    options.marketplaceUrl &&
    options.marketplaceHeaders &&
    Object.keys(options.marketplaceHeaders).length > 0 &&
    isSameOrigin(options.marketplaceUrl, options.archiveUrl)
  ) {
    return { ...options.marketplaceHeaders, ...entry }
  }
  return { ...entry }
}

export type HeadersHelperConsentResult =
  | { kind: 'accepted'; command: string; archiveUrl: string }
  | { kind: 'declined' }
  | { kind: 'unconfirmed' }

/** SEA `f3l` return: accepted / declined / unconfirmed. */
export type EntryHelperConfirmVerdict = 'accepted' | 'declined' | 'unconfirmed'

/**
 * SEA `BXi` (origin destination; skip inventing `hiddenCharactersWarning`).
 */
export function formatEntryHelperDisclosure(options: {
  command: string
  archiveUrl: string
}): string {
  let destination = options.archiveUrl
  try {
    destination = new URL(options.archiveUrl).origin
  } catch {
    // keep raw url
  }
  return (
    `Fetching this plugin's archive sends helper-minted headers to ${destination}; ` +
    `the local command it runs (headersHelper) is: ${options.command}`
  )
}

/**
 * SEA `f3l` — TTY / `-y` / session-ignore-yes. Does not print the disclosure.
 */
export async function promptEntryHeadersHelperConfirm(options: {
  yes?: boolean
  write?: (text: string) => void
}): Promise<EntryHelperConfirmVerdict> {
  const { readYesFromStdin } = await import('./pluginCommandSource.js')
  const write =
    options.write ??
    ((text: string) => {
      try {
        process.stdout.write(text)
      } catch {
        // ignore
      }
    })

  const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY)
  const yes = options.yes === true
  const inSession = Boolean(
    process.env.CLAUDE_CODE_CHILD_SESSION || process.env.CLAUDECODE,
  )
  if (yes) {
    if (!inSession) {
      return 'accepted'
    }
    if (!isTty) {
      write(
        '-y/--yes is ignored inside a Claude Code session: run this in your own terminal to accept the command shown above.\n',
      )
      return 'unconfirmed'
    }
  }
  if (!isTty) {
    write(
      inSession
        ? 'Not an interactive terminal, so the command was only displayed, not accepted. Run this in your own terminal (outside the Claude Code session) to confirm the command shown above.\n'
        : 'Not an interactive terminal, so the command was only displayed, not accepted. Re-run in a terminal to confirm it, or pass -y/--yes to accept the command shown above.\n',
    )
    return 'unconfirmed'
  }
  write('Run this command now? [y/N] ')
  const ok = await readYesFromStdin()
  return ok ? 'accepted' : 'declined'
}

/**
 * densable `BXi`-style disclosure + `f3l` `[y/N]` / `-y` for catalog entry
 * headersHelper (install/update only). Reuses command-source TTY/-y rules.
 */
export async function promptEntryHeadersHelperConsent(options: {
  pluginName: string
  command: string
  archiveUrl: string
  yes?: boolean
  write?: (text: string) => void
}): Promise<HeadersHelperConsentResult> {
  const write =
    options.write ??
    ((text: string) => {
      try {
        process.stdout.write(text)
      } catch {
        // ignore
      }
    })

  write(`${formatEntryHelperDisclosure(options)}\n`)

  const verdict = await promptEntryHeadersHelperConfirm({
    yes: options.yes,
    write,
  })
  if (verdict === 'accepted') {
    return {
      kind: 'accepted',
      command: options.command,
      archiveUrl: options.archiveUrl,
    }
  }
  // SEA Vgh: l==="accepted"?a:l — unconfirmed is distinct from declined.
  return { kind: verdict }
}

/**
 * densable ftm-style: resolve archive entry with headersHelper and prompt.
 * Returns undefined when entry has no archive headersHelper.
 */
export async function announceEntryHeadersHelperForInstall(
  plugin: string,
  options: { yes?: boolean } = {},
): Promise<HeadersHelperConsentResult | undefined> {
  const { getPluginById, loadKnownMarketplacesConfig, getMarketplace } =
    await import('./marketplaceManager.js')
  const { parsePluginIdentifier } = await import('./pluginIdentifier.js')

  const { name, marketplace } = parsePluginIdentifier(plugin)
  if (!name) return undefined

  let pluginId = marketplace ? `${name}@${marketplace}` : name
  let entry: PluginMarketplaceEntry | undefined
  let marketplaceName = marketplace
  let marketplaceSource: MarketplaceSource | undefined

  if (marketplace) {
    const info = await getPluginById(pluginId)
    entry = info?.entry
    const known = await loadKnownMarketplacesConfig()
    marketplaceSource = known[marketplace]?.source
  } else {
    const known = await loadKnownMarketplacesConfig()
    for (const mktName of Object.keys(known)) {
      try {
        const mkt = await getMarketplace(mktName)
        const ent = mkt.plugins.find(p => p.name === name)
        if (!ent) continue
        const helper = resolveShownArchiveHeadersHelper({
          entry: ent,
          marketplaceName: mktName,
          marketplaceSource: known[mktName]?.source,
          catchOverlayRefusal: true,
        })
        if (helper) {
          pluginId = `${name}@${mktName}`
          entry = ent
          marketplaceName = mktName
          marketplaceSource = known[mktName]?.source
          break
        }
      } catch {
        // skip
      }
    }
  }

  if (!entry) {
    return undefined
  }
  const helper = resolveShownArchiveHeadersHelper({
    entry,
    marketplaceName,
    marketplaceSource,
    catchOverlayRefusal: true,
  })
  if (!helper) {
    return undefined
  }

  return promptEntryHeadersHelperConsent({
    pluginName: name,
    command: helper.command,
    archiveUrl: helper.archiveUrl,
    yes: options.yes,
  })
}

/**
 * densable 2.1.238 — non-fatal marketplace authoring advisories for catalog
 * entry `headers` / `headersHelper`.
 *
 * SEA emits these beside `plugins[i].headersHelper` / `.headers` / `.source.sha256`
 * as soft issues (parse still succeeds). Tip collects them after a successful
 * `PluginMarketplaceSchema` parse — Zod `fatal:false` still fails `safeParse`,
 * and marketplace load treats any schema issue as hard failure.
 */
export type MarketplaceHeadersHelperAdvisory = {
  pluginName: string
  path: string
  message: string
}

export function collectPluginMarketplaceEntryHeadersHelperAdvisories(
  entry: Pick<
    PluginMarketplaceEntry,
    'name' | 'headers' | 'headersHelper' | 'strict' | 'source'
  >,
  pluginIndex?: number,
): MarketplaceHeadersHelperAdvisory[] {
  const out: MarketplaceHeadersHelperAdvisory[] = []
  const idx = pluginIndex ?? 0
  const name = entry.name
  const base = `plugins[${idx}]`

  const hasHeaders =
    entry.headers !== undefined && Object.keys(entry.headers).length > 0
  const hasHelper = entry.headersHelper !== undefined
  const isArchive =
    typeof entry.source === 'object' &&
    entry.source !== null &&
    'source' in entry.source &&
    entry.source.source === 'archive'

  if (hasHelper && entry.strict !== false) {
    out.push({
      pluginName: name,
      path: `${base}.headersHelper`,
      message: `Plugin "${name}" sets headersHelper but is not "strict": false. An entry with headersHelper must inline its full manifest (strict: false, with commands/agents/hooks/mcpServers declared in the entry) so users can review what it ships before the command runs; Claude Code refuses to run the helper otherwise.`,
    })
  }

  if ((hasHeaders || hasHelper) && !isArchive) {
    out.push({
      pluginName: name,
      path: `${base}.headersHelper`,
      message: `"${name}" sets headers/headersHelper, which only apply to "archive" sources; they have no effect on this entry.`,
    })
  }

  if (hasHelper && isArchive) {
    const sha =
      typeof entry.source === 'object' &&
      entry.source !== null &&
      'sha256' in entry.source
        ? entry.source.sha256
        : undefined
    if (sha === undefined || sha === '') {
      out.push({
        pluginName: name,
        path: `${base}.source.sha256`,
        message: `"${name}" fetches its archive with a headersHelper but sets no sha256 pin. Consider pinning the digest so the bytes users install are exactly the ones you reviewed (omit it only if you rely on digest-versioned updates).`,
      })
    }
  }

  if (hasHeaders && entry.headers) {
    for (const headerName of Object.keys(entry.headers)) {
      if (isRoutingOrIdentityHeader(headerName)) {
        out.push({
          pluginName: name,
          path: `${base}.headers`,
          message: `Header "${headerName}" is a request-routing/identity header that catalog entries may not set; Claude Code drops it at download time.`,
        })
      }
    }
  }

  return out
}

export function collectMarketplaceHeadersHelperAdvisories(marketplace: {
  plugins: Array<
    Pick<
      PluginMarketplaceEntry,
      'name' | 'headers' | 'headersHelper' | 'strict' | 'source'
    >
  >
}): MarketplaceHeadersHelperAdvisory[] {
  return marketplace.plugins.flatMap((entry, index) =>
    collectPluginMarketplaceEntryHeadersHelperAdvisories(entry, index),
  )
}

/** densable /plugin pane mismatch codes for headersHelper consent. */
export type HeadersHelperPaneMismatchCode =
  | 'unshown'
  | 'command'
  | 'archive_url'

export type HeadersHelperPaneShown = {
  command: string
  archiveUrl: string
}

export type HeadersHelperPaneConsentResult =
  | { ok: true }
  | {
      ok: false
      code: HeadersHelperPaneMismatchCode
      message: string
      hint: string
    }

/**
 * SEA `dwo` identity — per-view consent ref clears when the shown helper
 * (command + archive URL) changes. Not a session-wide Map.
 */
export function headersHelperPaneIdentity(
  helper: HeadersHelperPaneShown | null | undefined,
): string {
  if (!helper) return ''
  return `${helper.command}\0${helper.archiveUrl}`
}

/**
 * SEA `zgh` post-refresh missing shownEntryHelper — helper appeared (or was
 * never bound) so CLI must re-confirm in a terminal.
 */
export function formatEntryHelperCliUnconfirmedMessage(helper: {
  command: string
  archiveUrl: string
}): string {
  return (
    `${formatEntryHelperDisclosure(helper)}\n` +
    'This install runs that command; confirm it by running `claude plugin install` in a terminal (or with -y/--yes).'
  )
}

/**
 * SEA `qhi(e,t)` — pure compare of consented snapshot vs the helper that
 * would run. Does **not** record consent. `helper` null → ok (nothing to
 * gate). `consented` null/undefined + helper → unshown.
 */
export function compareConsentedEntryHelper(options: {
  consented?: HeadersHelperPaneShown | null
  helper?: HeadersHelperPaneShown | null
  pluginName: string
  kind: 'install' | 'update'
}): HeadersHelperPaneConsentResult {
  const helper = options.helper
  if (!helper) {
    return { ok: true }
  }
  const shown = options.consented
  if (!shown) {
    if (options.kind === 'update') {
      return {
        ok: false,
        code: 'unshown',
        message: `This update would run a headersHelper command for "${options.pluginName}" that was not shown on this pane.`,
        hint: 'Review the command now shown, then update again.',
      }
    }
    return {
      ok: false,
      code: 'unshown',
      // SEA Ghi(install, unshown): full sentence; no separate Reopen suffix.
      message: `This install would run a headersHelper command for "${options.pluginName}" that was not shown to you first. Retry the same install to review the command before it runs.`,
      hint: '',
    }
  }
  if (shown.command !== helper.command) {
    return {
      ok: false,
      code: 'command',
      message: `The headersHelper command for "${options.pluginName}" changed since it was shown.`,
      hint:
        options.kind === 'update'
          ? 'Review the command now shown, then update again.'
          : 'Reopen its details in /plugin to review it, then install again.',
    }
  }
  if (shown.archiveUrl !== helper.archiveUrl) {
    return {
      ok: false,
      code: 'archive_url',
      message: `The archive URL for "${options.pluginName}" changed since its headersHelper command was shown.`,
      hint:
        options.kind === 'update'
          ? 'Review the command now shown, then update again.'
          : 'Reopen its details in /plugin to review it, then install again.',
    }
  }
  return { ok: true }
}

/**
 * @deprecated SEA `qhi` is snapshot-compare (`compareConsentedEntryHelper`).
 * Kept as a thin alias for call sites that still pass command/archiveUrl.
 */
export function checkHeadersHelperPaneConsent(options: {
  pluginName: string
  command: string
  archiveUrl: string
  kind: 'install' | 'update'
  consented?: HeadersHelperPaneShown | null
  /** ignored — pane consent is per-view, not a pluginId Map */
  pluginId?: string
}): HeadersHelperPaneConsentResult {
  return compareConsentedEntryHelper({
    consented: options.consented,
    helper: { command: options.command, archiveUrl: options.archiveUrl },
    pluginName: options.pluginName,
    kind: options.kind,
  })
}

/**
 * Format pane mismatch for UI / CLI error surfaces (message + hint).
 * SEA Ghi(install, unshown) is message-only; other codes append the hint.
 */
export function formatHeadersHelperPaneMismatch(
  result: Extract<HeadersHelperPaneConsentResult, { ok: false }>,
): string {
  if (!result.hint) return result.message
  return `${result.message} ${result.hint}`
}

/**
 * Resolve archive headersHelper fields for pane display / consent checks.
 */
export function getArchiveHeadersHelperForPane(
  entry: Pick<PluginMarketplaceEntry, 'headersHelper' | 'source'>,
): { command: string; archiveUrl: string } | undefined {
  if (!entryHasArchiveHeadersHelper(entry)) return undefined
  if (
    typeof entry.source !== 'object' ||
    entry.source === null ||
    entry.source.source !== 'archive'
  ) {
    return undefined
  }
  return {
    command: entry.headersHelper!,
    archiveUrl: entry.source.url,
  }
}

/**
 * SEA `w0` / `U2a` — `claude <subcommand> <pluginId>` when the id is safe.
 */
export function formatClaudePluginCliInvocation(
  subcommand: string,
  pluginId: string,
  extra?: string,
): string | null {
  if (!SAFE_CLI_PLUGIN_ID.test(pluginId)) return null
  return `claude ${subcommand} ${pluginId}${extra ? ` ${extra}` : ''}`
}

/**
 * SEA `ggw` skip copy (`entry_helper_deferred`).
 */
export function formatEntryHelperDeferredUpdateSkipMessage(
  pluginName: string,
  pluginId: string,
): string {
  const cli = formatClaudePluginCliInvocation('plugin update', pluginId)
  return (
    `Skipped — "${pluginName}" fetches its archive through a headersHelper, which only runs when you update it yourself. Update it from /plugin` +
    (cli ? ` (or \`${cli}\`).` : '.')
  )
}

/**
 * SEA `y5n` — policy refusal on install/update (name quoted).
 */
export function formatEntryHelperPolicyRefusalMessage(
  pluginName: string,
  refusal: HeadersHelperPolicyRefusal = 'lockdown',
): string {
  if (refusal === 'remote_policy_unconsented') {
    return `"${pluginName}" fetches its archive through a headersHelper command that was not run: ${ENTRY_HELPER_REMOTE_POLICY_UNCONSENTED}. The plugin was not installed or updated.`
  }
  return `"${pluginName}" fetches its archive through a marketplace-declared headersHelper command, and your organization's managed settings disable marketplace-declared commands (disableCommandPluginSources / allowManagedHooksOnly). The plugin was not installed or updated and the command was not run; ask your admin to allow it or to declare the marketplace in managed settings.`
}

export type KnownMarketplaceLookup = Record<
  string,
  { source?: MarketplaceSource } | undefined
>

/**
 * Look up `name@marketplace` against known_marketplaces.json.
 */
export function marketplaceSourceFromKnown(
  pluginId: string,
  known: KnownMarketplaceLookup,
): {
  pluginName: string
  marketplaceName: string | undefined
  marketplaceSource: MarketplaceSource | undefined
} {
  const { name, marketplace } = parsePluginIdentifier(pluginId)
  const marketplaceName = marketplace
  const marketplaceSource =
    marketplaceName !== undefined ? known[marketplaceName]?.source : undefined
  return {
    pluginName: name,
    marketplaceName,
    marketplaceSource,
  }
}

export type ArchiveEntryHelperPlan =
  | {
      kind: 'fail'
      message: string
      failureCode:
        | 'entry_helper_disabled_by_policy'
        | 'entry_helper_remote_policy_unconsented'
    }
  | {
      kind: 'up_to_date'
      version: string
    }
  | {
      kind: 'skip'
      skipReason: 'entry_helper_deferred'
      message: string
    }
  | {
      kind: 'run'
      runEntryHelper: boolean
    }

/**
 * SEA `ggw` archive-helper order (no storageV5 / trustedSettings invent):
 * 1. explicit + policy → fail
 * 2. !explicit + helper: declaredVersion===installed → up_to_date;
 *    else policy fail; else skip `entry_helper_deferred`
 * 3. else run with `runEntryHelper: explicit`
 */
export function planArchiveEntryHelperUpdate(options: {
  pluginId: string
  pluginName: string
  entry: OverlayableArchiveEntry
  installedVersion?: string
  explicit: boolean
  marketplaceSource?: MarketplaceSource
  marketplaceName?: string
  trustedSettingsEntryAuth?: TrustedSettingsEntryAuth
}): ArchiveEntryHelperPlan {
  const source = options.entry.source
  const helper =
    typeof source === 'object' && source !== null && source.source === 'archive'
      ? getShownArchiveHeadersHelperFromOverlay(
          overlayTrustedSettingsEntryAuth({
            entry: options.entry,
            archiveUrl: source.url,
            marketplaceSource: options.marketplaceSource,
            trustedSettingsEntryAuth:
              options.trustedSettingsEntryAuth !== undefined
                ? options.trustedSettingsEntryAuth
                : lookupTrustedSettingsEntryAuth(
                    options.marketplaceName,
                    options.pluginName,
                  ),
          }),
          source.url,
        )
      : null
  const refusal = helper
    ? headersHelperPolicyRefusal(
        options.marketplaceSource,
        options.marketplaceName,
      )
    : null

  if (options.explicit && refusal !== null) {
    return {
      kind: 'fail',
      message: formatEntryHelperPolicyRefusalMessage(
        options.pluginName,
        refusal,
      ),
      failureCode:
        refusal === 'remote_policy_unconsented'
          ? 'entry_helper_remote_policy_unconsented'
          : 'entry_helper_disabled_by_policy',
    }
  }

  if (!options.explicit && helper) {
    const source = options.entry.source
    const declaredVersion =
      options.entry.version ??
      (typeof source === 'object' &&
      source !== null &&
      source.source === 'archive' &&
      source.sha256 !== undefined
        ? source.sha256.toLowerCase().substring(0, 12)
        : undefined)
    if (
      declaredVersion !== undefined &&
      declaredVersion === options.installedVersion
    ) {
      return { kind: 'up_to_date', version: declaredVersion }
    }
    if (refusal !== null) {
      return {
        kind: 'fail',
        message: formatEntryHelperPolicyRefusalMessage(
          options.pluginName,
          refusal,
        ),
        failureCode:
          refusal === 'remote_policy_unconsented'
            ? 'entry_helper_remote_policy_unconsented'
            : 'entry_helper_disabled_by_policy',
      }
    }
    return {
      kind: 'skip',
      skipReason: 'entry_helper_deferred',
      message: formatEntryHelperDeferredUpdateSkipMessage(
        options.pluginName,
        options.pluginId,
      ),
    }
  }

  return { kind: 'run', runEntryHelper: options.explicit }
}
