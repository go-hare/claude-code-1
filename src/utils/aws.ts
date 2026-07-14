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
 * Official Q_c / hostManagedAwsProviderChain — build a provider chain from
 * host-injected env (static keys or fromIni with ignoreCache). Does not run
 * settings awsAuthRefresh / awsCredentialExport.
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
