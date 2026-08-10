import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from './errors.js'
import { isEnvTruthy } from './envUtils.js'
import { logForDebugging } from './debug.js'
import { resolveAwsChainResolveTimeoutMs } from './residualMsEnvGates.js'

/** AWS short-term credentials format. */
export type AwsCredentials = {
  AccessKeyId: string
  SecretAccessKey: string
  SessionToken: string
  Expiration?: string
}

/** Output from `aws sts get-session-token` or `aws sts assume-role`. */
export type AwsStsOutput = {
  Credentials: AwsCredentials
}

/** Normalized credentials returned by export / default chain. */
export type AwsResolvedCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  /** Epoch ms when known; used for cache TTL (official 2.1.207). */
  expiration?: number
}

type AwsError = {
  name: string
}

/** Default cache lifetime when no Expiration is present (1h STS). */
export const AWS_CREDENTIAL_DEFAULT_TTL_MS = 60 * 60 * 1000
/** Refresh this far before Expiration (official G_c). */
export const AWS_CREDENTIAL_REFRESH_MARGIN_MS = 5 * 60 * 1000
/** If remaining lifetime is at or below this + margin, fall back to default TTL. */
export const AWS_CREDENTIAL_MIN_REMAINING_MS = 60 * 1000
/** After awsAuthRefresh finishes, suppress re-run for this long (SSO thrash). */
export const AWS_AUTH_REFRESH_COOLDOWN_MS = 30 * 1000
/** Default-chain resolve hard timeout (Windows Cred Manager stall). */
export const AWS_CHAIN_RESOLVE_TIMEOUT_MS = 60 * 1000
/** Debounce window for default-chain cache invalidation. */
export const AWS_CHAIN_INVALIDATE_DEBOUNCE_MS = 10 * 1000

export function isAwsCredentialsProviderError(err: unknown) {
  return (err as AwsError | undefined)?.name === 'CredentialsProviderError'
}

/**
 * Official cZm — x-amzn-errortype / message patterns that mean the ambient
 * credential material itself is bad (full cache wipe), not a transient 403.
 */
export const AWS_AUTH_MATERIAL_ERROR_RE =
  /ExpiredToken|InvalidSignature|SignatureDoesNotMatch|UnrecognizedClient|InvalidClientTokenId|security token.*(invalid|expired)|signature we calculated does not match/i

export function isAwsAuthMaterialError(
  errType: string | null | undefined,
  message: string | null | undefined,
): boolean {
  return AWS_AUTH_MATERIAL_ERROR_RE.test(`${errType ?? ''} ${message ?? ''}`)
}

/** Typeguard to validate AWS STS assume-role / flat credential objects. */
export function isValidAwsCredentialsShape(
  obj: unknown,
): obj is AwsCredentials {
  if (!obj || typeof obj !== 'object') {
    return false
  }
  const credentials = obj as Record<string, unknown>
  return (
    typeof credentials.AccessKeyId === 'string' &&
    typeof credentials.SecretAccessKey === 'string' &&
    typeof credentials.SessionToken === 'string' &&
    credentials.AccessKeyId.length > 0 &&
    credentials.SecretAccessKey.length > 0 &&
    credentials.SessionToken.length > 0
  )
}

/** Typeguard to validate AWS STS assume-role output */
export function isValidAwsStsOutput(obj: unknown): obj is AwsStsOutput {
  if (!obj || typeof obj !== 'object') {
    return false
  }
  const output = obj as Record<string, unknown>
  return isValidAwsCredentialsShape(output.Credentials)
}

/**
 * Official 2.1.207 flexible STS parser (zKl): accepts either
 * `{ Credentials: {...} }` or a flat `{ AccessKeyId, ... }` object.
 */
export function parseAwsCredentialExport(obj: unknown): AwsCredentials | null {
  if (!obj || typeof obj !== 'object') {
    return null
  }
  const record = obj as Record<string, unknown>
  if (isValidAwsCredentialsShape(record.Credentials)) {
    return record.Credentials
  }
  if (isValidAwsCredentialsShape(record)) {
    return record
  }
  return null
}

/**
 * Cache TTL for a credential value with optional Expiration epoch ms.
 * Official ibc: default 1h when missing/near-expiry; otherwise remaining − 5m margin.
 */
export function awsCredentialCacheTtlMs(
  expirationEpochMs: number | undefined,
): number {
  if (expirationEpochMs === undefined) {
    return AWS_CREDENTIAL_DEFAULT_TTL_MS
  }
  const remaining = expirationEpochMs - Date.now()
  if (
    remaining <=
    AWS_CREDENTIAL_REFRESH_MARGIN_MS + AWS_CREDENTIAL_MIN_REMAINING_MS
  ) {
    return AWS_CREDENTIAL_DEFAULT_TTL_MS
  }
  return remaining - AWS_CREDENTIAL_REFRESH_MARGIN_MS
}

/**
 * Hard-timeout wrapper for the AWS default credential chain.
 * Official resolveWithStallGuard / sbc — prevents Windows Credential Manager
 * hangs of ~60s+ from blocking the event loop on every request.
 */
export async function resolveWithStallGuard<T>(
  promise: Promise<T>,
  timeoutMs: number = resolveAwsChainResolveTimeoutMs(),
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(
              new Error('AWS default-chain credential resolve timed out'),
              { name: 'CredentialsProviderError' },
            ),
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // Prevent unhandled rejection if the underlying resolve loses the race
    promise.catch(() => {})
  }
}

/** Throws if STS caller identity cannot be retrieved. */
export async function checkStsCallerIdentity(): Promise<void> {
  const { STSClient, GetCallerIdentityCommand } = await import(
    '@aws-sdk/client-sts'
  )
  await new STSClient().send(new GetCallerIdentityCommand({}))
}

/**
 * Clear AWS credential provider cache by forcing a refresh
 * This ensures that any changes to ~/.aws/credentials are picked up immediately
 */
export async function clearAwsIniCache(): Promise<void> {
  try {
    logForDebugging('Clearing AWS credential provider cache')
    const { fromIni } = await import('@aws-sdk/credential-providers')
    const iniProvider = fromIni({ ignoreCache: true })
    await iniProvider() // This updates the global file cache
    logForDebugging('AWS credential provider cache refreshed')
  } catch (_error) {
    // Ignore errors - we're just clearing the cache
    logForDebugging(
      'Failed to clear AWS credential cache (this is expected if no credentials are configured)',
    )
  }
}

/**
 * Official Qv — desktop/host injects provider credentials; settings helpers
 * (awsAuthRefresh / awsCredentialExport / apiKeyHelper) must not run.
 */
export function isHostManagedProviderAuth(): boolean {
  // Official PROVIDER_MANAGED_BY_HOST densable.
  try {
    const { isProviderManagedByHostEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    return isProviderManagedByHostEnvEnabled()
  } catch {
    return isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
  }
}

/**
 * Official Z_c — used when host-managed path has no ambient keys/files.
 * Host-only credential kinds cannot fall back to interactive SSO helpers.
 */
export const HOST_MANAGED_NO_CREDS_HINT =
  'Background agents and teammates are not supported for this credential kind. Run this from the main session, or switch the desktop app to a profile-based or API-key credential. If this is the main session, restart the desktop app.'

const HOST_MANAGED_NO_CREDS_DEFAULT_HINT =
  'The app may have quit or its credential file is stale — restart the desktop app.'

/**
 * Official SPr / hostManagedNoCredsError.
 */
export function hostManagedNoCredsError(
  providerLabel: string,
  hint: string = HOST_MANAGED_NO_CREDS_DEFAULT_HINT,
): TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    `${providerLabel} credentials are managed by the desktop app, but none are available. ${hint}`,
    'host-managed provider credentials unavailable — restart desktop app',
  )
}

/** Official ebc — env snapshot for host-managed AWS chain. */
export function readHostManagedAwsEnv(): {
  accessKeyId: string | undefined
  secretAccessKey: string | undefined
  profile: string | undefined
  configFile: string | undefined
  credsFile: string | undefined
  sessionToken: string | undefined
} {
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    profile: process.env.AWS_PROFILE,
    configFile: process.env.AWS_CONFIG_FILE,
    credsFile: process.env.AWS_SHARED_CREDENTIALS_FILE,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  }
}

/** Official PTh — host has env keys or shared-config paths to resolve from. */
export function hasHostManagedAwsMaterial(): boolean {
  const { accessKeyId, secretAccessKey, configFile, credsFile } =
    readHostManagedAwsEnv()
  return Boolean((accessKeyId && secretAccessKey) || configFile || credsFile)
}

export type AwsSdkIdentity = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export type AwsProviderChain = (init?: unknown) => Promise<AwsSdkIdentity>

/**
 * densable 2.1.221 `ic_` — SSO region token (portal.sso.<region>.amazonaws.com).
 */
const HOST_PINNED_SSO_REGION_RE = /^[a-z0-9-]{1,32}$/

/** densable `Twu` pure-SSO profile resolution result. */
export type HostPinnedSsoProfile = {
  cacheId: string
  accountId: string
  roleName: string
  region: string
}

/**
 * Minimal AWS shared-config INI parse (densable loadSharedConfigFiles shape).
 * Config sections: `[default]`, `[profile name]`, `[sso-session name]`.
 * Credentials sections: `[name]` (no `profile ` prefix).
 */
export function parseAwsIniSections(
  content: string,
  kind: 'config' | 'credentials',
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  let current: string | null = null
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const section = line.match(/^\[([^\]]+)\]$/)
    if (section) {
      let name = section[1]!.trim()
      if (kind === 'config') {
        if (name === 'default') {
          current = 'default'
        } else if (name.startsWith('profile ')) {
          current = name.slice('profile '.length).trim()
        } else if (name.startsWith('sso-session ')) {
          current = `sso-session.${name.slice('sso-session '.length).trim()}`
        } else {
          // bare [name] in config is treated as profile name by AWS tools
          current = name
        }
      } else {
        current = name
      }
      if (current && !out[current]) out[current] = {}
      continue
    }
    if (!current) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    out[current]![key] = value
  }
  return out
}

/**
 * densable `Twu` / `fAu` — pure SSO named profile only.
 * Rejects static keys / credential_process / role_arn / source_profile /
 * credential_source / web_identity_token_file. Resolves sso_session →
 * sso_start_url / sso_region. Returns null when not pure SSO.
 */
export async function parseHostPinnedSsoProfile(
  configFile: string,
  credsFile?: string | null,
  profile?: string | null,
): Promise<HostPinnedSsoProfile | null> {
  const { readFile } = await import('fs/promises')
  let configRaw: string
  try {
    configRaw = await readFile(configFile, 'utf-8')
  } catch {
    return null
  }
  const config = parseAwsIniSections(configRaw, 'config')
  let creds: Record<string, Record<string, string>> = {}
  if (credsFile) {
    try {
      creds = parseAwsIniSections(
        await readFile(credsFile, 'utf-8'),
        'credentials',
      )
    } catch {
      creds = {}
    }
  }
  const profileName = profile ?? 'default'
  const section = config[profileName]
  const credSection = creds[profileName]
  if (!section) return null
  const merged: Record<string, string> = { ...section, ...credSection }
  const accountId = merged.sso_account_id
  const roleName = merged.sso_role_name
  if (!accountId || !roleName) return null
  if (
    (merged.aws_access_key_id && merged.aws_secret_access_key) ||
    merged.credential_process ||
    merged.role_arn ||
    merged.source_profile ||
    merged.credential_source ||
    merged.web_identity_token_file
  ) {
    return null
  }
  const sessionBlock = merged.sso_session
    ? config[`sso-session.${merged.sso_session}`]
    : merged
  const startUrl = sessionBlock?.sso_start_url
  const region = sessionBlock?.sso_region
  if (!startUrl || !region || !HOST_PINNED_SSO_REGION_RE.test(region)) {
    return null
  }
  if (
    merged.sso_session &&
    ((merged.sso_start_url && merged.sso_start_url !== startUrl) ||
      (merged.sso_region && merged.sso_region !== region))
  ) {
    return null
  }
  return {
    cacheId: merged.sso_session ?? startUrl,
    accountId,
    roleName,
    region,
  }
}

/** densable `oc_` — SSO cache JSON shape. */
type HostPinnedSsoCacheToken = {
  accessToken: string
  expiresAt: string
}

function parseHostPinnedSsoCacheToken(
  raw: unknown,
): HostPinnedSsoCacheToken | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.accessToken !== 'string' || o.accessToken.length < 1) return null
  if (typeof o.expiresAt !== 'string') return null
  return { accessToken: o.accessToken, expiresAt: o.expiresAt }
}

/**
 * densable `Ewu` / `hAu` — read token from host-pinned cache path and exchange
 * via portal.sso GetRoleCredentials. Cache path is NOT getHomeDir()/.aws/sso/cache.
 */
export async function exchangeHostPinnedSsoRoleCredentials(
  cachePath: string,
  accountId: string,
  roleName: string,
  region: string,
  fetchImpl: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = globalThis.fetch,
): Promise<AwsSdkIdentity | null> {
  const { readFile } = await import('fs/promises')
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(cachePath, 'utf-8')) as unknown
  } catch {
    return null
  }
  const token = parseHostPinnedSsoCacheToken(raw)
  if (!token) return null
  const expiresAt = Date.parse(token.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null

  const url = new URL(
    `https://portal.sso.${region}.amazonaws.com/federation/credentials`,
  )
  url.searchParams.set('account_id', accountId)
  url.searchParams.set('role_name', roleName)
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-amz-sso_bearer_token': token.accessToken,
      },
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }
  const roleCredentials = (
    body as { roleCredentials?: Record<string, unknown> }
  )?.roleCredentials
  if (!roleCredentials) return null
  const accessKeyId = roleCredentials.accessKeyId
  const secretAccessKey = roleCredentials.secretAccessKey
  const sessionToken = roleCredentials.sessionToken
  if (
    typeof accessKeyId !== 'string' ||
    typeof secretAccessKey !== 'string' ||
    typeof sessionToken !== 'string' ||
    !accessKeyId ||
    !secretAccessKey ||
    !sessionToken
  ) {
    return null
  }
  return { accessKeyId, secretAccessKey, sessionToken }
}

/**
 * densable `sc_` / `ncy` — host-pinned SSO leg: parse pure SSO profile, resolve
 * cache under dirname(AWS_CONFIG_FILE)/sso/cache/<sha1(cacheId)>.json, exchange.
 * On any failure: log and return null (caller falls back to fromIni).
 */
export async function resolveHostPinnedSsoCredentials(
  configFile: string,
  credsFile?: string | null,
  profile?: string | null,
  opts?: {
    fetchImpl?: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>
  },
): Promise<AwsSdkIdentity | null> {
  try {
    const parsed = await parseHostPinnedSsoProfile(
      configFile,
      credsFile,
      profile,
    )
    if (!parsed) return null
    const { createHash } = await import('crypto')
    const { dirname, join } = await import('path')
    const cachePath = join(
      dirname(configFile),
      'sso',
      'cache',
      `${createHash('sha1').update(parsed.cacheId).digest('hex')}.json`,
    )
    return await exchangeHostPinnedSsoRoleCredentials(
      cachePath,
      parsed.accountId,
      parsed.roleName,
      parsed.region,
      opts?.fetchImpl ?? fetch,
    )
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown'
    logForDebugging(
      `[API:auth] host-pinned SSO leg failed (${name}) — falling back to fromIni`,
    )
    return null
  }
}

/**
 * Official Q_c / hostManagedAwsProviderChain — build a provider chain from
 * host-injected env (static keys or fromIni with ignoreCache). densable 2.1.221:
 * when AWS_CONFIG_FILE is set, try host-pinned SSO (dirname(config)/sso/cache)
 * before fromIni so Windows stray HOME cannot poison SSO token lookup.
 * Does not run settings awsAuthRefresh / awsCredentialExport.
 */
export function hostManagedAwsProviderChain(
  providerLabel: string,
): () => Promise<AwsProviderChain> {
  return async () => {
    const {
      accessKeyId,
      secretAccessKey,
      profile,
      configFile,
      credsFile,
      sessionToken,
    } = readHostManagedAwsEnv()

    if (accessKeyId && secretAccessKey) {
      return async () => ({
        accessKeyId,
        secretAccessKey,
        ...(sessionToken ? { sessionToken } : {}),
      })
    }

    if (configFile || credsFile) {
      // densable ywu: if configFile present, await host-pinned SSO leg first.
      if (configFile) {
        const ssoCreds = await resolveHostPinnedSsoCredentials(
          configFile,
          credsFile,
          profile,
        )
        if (ssoCreds) {
          return async () => ssoCreds
        }
      }
      const { fromIni } = await import('@aws-sdk/credential-providers')
      const pathA = configFile ?? credsFile
      const pathB = credsFile ?? configFile
      return fromIni({
        ...(profile ? { profile } : {}),
        configFilepath: pathA,
        filepath: pathB,
        ignoreCache: true,
      }) as unknown as AwsProviderChain
    }

    throw hostManagedNoCredsError(providerLabel, HOST_MANAGED_NO_CREDS_HINT)
  }
}

/**
 * Official vpe / hostManagedAwsSdkCredentials — throws immediately when the
 * host set PROVIDER_MANAGED_BY_HOST but supplied no keys/files.
 */
export function hostManagedAwsSdkCredentials(providerLabel: string): {
  providerChainResolver: () => Promise<AwsProviderChain>
  credentials: (init?: unknown) => Promise<AwsSdkIdentity>
} {
  if (!hasHostManagedAwsMaterial()) {
    throw hostManagedNoCredsError(providerLabel, HOST_MANAGED_NO_CREDS_HINT)
  }
  const providerChainResolver = hostManagedAwsProviderChain(providerLabel)
  return {
    providerChainResolver,
    credentials: async init => (await providerChainResolver())(init),
  }
}
