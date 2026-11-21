/**
 * Download functionality for native installer
 *
 * Handles downloading Claude binaries from various sources:
 * - Artifactory NPM packages
 * - GCS bucket
 */

import { feature } from 'bun:bundle'
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { createHash, createPublicKey, verify } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { chmod, rm } from 'fs/promises'
import { join } from 'path'
import semver from 'semver'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import type { ReleaseChannel } from '../config.js'
import { logForDebugging } from '../debug.js'
import { ClaudeError, getErrnoCode, toError } from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { getFsImplementation } from '../fsOperations.js'
import {
  createBoundedZstdDecompressStreams,
  isZstdDecompressError,
} from '../http.js'
import { logError } from '../log.js'
import {
  resolveDownloadDeadlineMsForTesting,
  resolveStallTimeoutMsForTesting,
} from '../residualFinalEnvGates.js'
import { lt } from '../semver.js'
import { sleep } from '../sleep.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../slowOperations.js'
import { getBinaryName, getPlatform } from './installer.js'

const GCS_BUCKET_URL = 'https://downloads.claude.ai/claude-code-releases'
export const ARTIFACTORY_REGISTRY_URL =
  'https://artifactory.infra.ant.dev/artifactory/api/npm/npm-all/'

/** Official 2.1.328 `Ze()`: pinned RSA-4096 public key for release manifest signatures. */
export const MANIFEST_SIGNING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAp28rSV5I8HmK8CK9GixB
UZR/gtJxeOCsRXO4EJiej40jzBmQA3cWXGosVO82ZfFsRKVTtMC5iB/HH9sxjncr
mYNWGroJNbx29m/FgYQBgkCXT4AfFl6rnnXqRGLZOerj/4AqE4yQ1GZbhBgR55Z7
ro0ieKK8RHYUspBKAFHyWRhCCz6THW6YRbf0p/hG/08TOY6Sj3cJ7/AEoTRf9ZmV
NX1k0KvbUSiVGpGY9OIHWgxRJUF2pArU4o/hk+sqGAgEUh8Bjvjwvz6+quLXPg+y
0Y8Ugb1Fg6BUppam/zydYY/Q/+yNjnuF154gD1jEeeir8R5czs6zUHSbo2yXUpAs
IdWYo5End8vGsluVmFExnUWm/fTVMGoM5Wm3v1VRepMydEnJ+atz4oQdmPQcKNAi
p5GJO2uyk++xFr9CpKvlR5jral92toYV/m+mur3va8ydamWBo/qG7/wt0sdS81Iw
H6lcu0SQ39rgKD+bdoPLv05EqVMYTFRI2QZEsWGYTMs0DOrfCIJFH50qyD0x4sWw
1gEWeG3jDgY8cj2StZz+zjqzUd05CibcCzEAGm1EQg5y9D40tIsAU1OI7bpgQ9V0
lC8lrqE7zJY66UK9Z1daA8jrdDi6migNjHFrXfT3V4QvMthCIO05q05SS3x2G3Zp
IgmI+CePUPB1pDf+lhPkU1MCAwEAAQ==
-----END PUBLIC KEY-----
`

/** Official 2.1.328 `Et` / `Je` / `bt` / `Nn` / `In` manifest signature constants. */
export const MANIFEST_SIGNATURE_DOMAIN_PREFIX = Buffer.from(
  'claude-code-manifest-v1\x00',
)
export const FIRST_SIGNED_VERSION = '2.1.207'
export const MANIFEST_SIGNATURE_CLIENT_ENFORCEMENT = 'flag'
const MANIFEST_SIGNATURE_SCHEMA = 1
const MANIFEST_SIGNATURE_ALGORITHM = 'RSASSA-PKCS1-v1_5-SHA512'
const SIDECAR_FETCH_MAX_ATTEMPTS = 5
const SIDECAR_FETCH_DEADLINE_MS = 33_000
const SIDECAR_FETCH_INTERRUPTED_THRESHOLD_MS = 2 * SIDECAR_FETCH_DEADLINE_MS

export type ManifestSignatureErrorReason =
  | 'sidecar_missing'
  | 'sidecar_malformed'
  | 'sidecar_fetch_http_error'
  | 'sidecar_fetch_interrupted'
  | 'sidecar_fetch_timeout'
  | 'sidecar_fetch_connection_error'
  | 'key_mismatch'
  | 'signature_invalid'
  | 'version_mismatch'
  | 'binary_name_mismatch'
  | 'release_predates_enforcement'

/** Official 2.1.328 `ZM`: error raised on release manifest signature verification failure. */
export class ManifestSignatureError extends ClaudeError {
  readonly reason: ManifestSignatureErrorReason
  readonly verifyThrew?: boolean

  constructor(
    version: string,
    reason: ManifestSignatureErrorReason,
    context: 'update' | 'app_bundle' = 'update',
    opts?: { verifyThrew?: boolean },
  ) {
    super(
      context === 'update'
        ? `Release verification failed for Claude Code ${version} (${reason}). The update was not installed.`
        : `Release verification failed for the macOS app bundle of Claude Code ${version} (${reason}).`,
    )
    this.name = 'ManifestSignatureError'
    this.reason = reason
    this.verifyThrew = opts?.verifyThrew
  }
}

export type ReleaseManifestPlatformEntry = {
  checksum: string
  size?: number
  binary?: string
  [key: string]: unknown
}

export type ReleaseManifest = {
  version: string
  manifestSignatureEnforcement?: string
  platforms: Record<string, ReleaseManifestPlatformEntry>
  [key: string]: unknown
}

export type ManifestSignatureSidecar = {
  schema: 1
  algorithm: 'RSASSA-PKCS1-v1_5-SHA512'
  signature: string
  publicKeySha256: string
}

export type ManifestSignaturePolicy =
  | 'skip'
  | 'require'
  | 'allow-unsigned-legacy'
  | 'require-enforcing-release'

function getManifestSignatureFlag(): boolean | null {
  return getFeatureValue_CACHED_MAY_BE_STALE<boolean | null>(
    'tengu_elegant_pancake',
    null,
  )
}

/** Official 2.1.328 `lt()`: whether manifest signature enforcement is active on this client. */
export function isManifestSignatureEnforced(
  enforcement: string = MANIFEST_SIGNATURE_CLIENT_ENFORCEMENT,
  flag: boolean | null = getManifestSignatureFlag(),
): boolean {
  return enforcement === 'always' ? flag !== false : flag === true
}

/** Official 2.1.328 `gr()`: whether a release's manifest declares signature enforcement. */
export function isReleaseEnforcingManifestSignature(
  releaseEnforcement: string | undefined,
  flag: boolean | null = getManifestSignatureFlag(),
): boolean {
  return (
    releaseEnforcement === 'always' ||
    (releaseEnforcement === 'flag' && isManifestSignatureEnforced('flag', flag))
  )
}

/** Official 2.1.328 `zt()`: selects the manifest signature verification policy. */
export function getManifestSignaturePolicy(
  version: string,
  opts: {
    explicitVersionRequested: boolean
    requireEnforcingRelease: boolean
  },
): ManifestSignaturePolicy {
  return opts.requireEnforcingRelease
    ? 'require-enforcing-release'
    : opts.explicitVersionRequested && lt(version, FIRST_SIGNED_VERSION)
      ? 'allow-unsigned-legacy'
      : 'require'
}

function parseReleaseManifest(raw: unknown): ReleaseManifest | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.version !== 'string') {
    return null
  }
  if (
    obj.manifestSignatureEnforcement !== undefined &&
    typeof obj.manifestSignatureEnforcement !== 'string'
  ) {
    return null
  }
  if (
    obj.platforms === null ||
    typeof obj.platforms !== 'object' ||
    Array.isArray(obj.platforms)
  ) {
    return null
  }
  const platforms = obj.platforms as Record<string, unknown>
  for (const entry of Object.values(platforms)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return null
    }
    const plat = entry as Record<string, unknown>
    if (typeof plat.checksum !== 'string') {
      return null
    }
    if (plat.size !== undefined && typeof plat.size !== 'number') {
      return null
    }
    if (plat.binary !== undefined && typeof plat.binary !== 'string') {
      return null
    }
  }
  return obj as ReleaseManifest
}

function parseSignatureSidecar(raw: unknown): ManifestSignatureSidecar | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const obj = raw as Record<string, unknown>
  if (
    obj.schema !== MANIFEST_SIGNATURE_SCHEMA ||
    obj.algorithm !== MANIFEST_SIGNATURE_ALGORITHM ||
    typeof obj.signature !== 'string' ||
    obj.signature.length === 0 ||
    typeof obj.publicKeySha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(obj.publicKeySha256)
  ) {
    return null
  }
  return {
    schema: 1,
    algorithm: 'RSASSA-PKCS1-v1_5-SHA512',
    signature: obj.signature,
    publicKeySha256: obj.publicKeySha256,
  }
}

/**
 * Official 2.1.328 `tt()`: verifies a release manifest's detached RSA-SHA512
 * signature sidecar against the pinned SPKI public key and expected version.
 */
export function verifyReleaseManifestSignature({
  manifestBytes,
  sidecar,
  expectedVersion,
  publicKeyPem = MANIFEST_SIGNING_PUBLIC_KEY_PEM,
}: {
  manifestBytes: Buffer
  sidecar: unknown
  expectedVersion: string
  publicKeyPem?: string
}): ReleaseManifest {
  const parsedSidecar = parseSignatureSidecar(sidecar)
  if (!parsedSidecar) {
    throw new ManifestSignatureError(expectedVersion, 'sidecar_malformed')
  }
  const { signature, publicKeySha256 } = parsedSidecar
  if (Buffer.from(signature, 'base64').toString('base64') !== signature) {
    throw new ManifestSignatureError(expectedVersion, 'sidecar_malformed')
  }

  let publicKey: ReturnType<typeof createPublicKey>
  try {
    publicKey = createPublicKey(publicKeyPem)
  } catch {
    throw new ManifestSignatureError(expectedVersion, 'key_mismatch')
  }

  const expectedKeySha256 = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
  if (publicKeySha256 !== expectedKeySha256) {
    throw new ManifestSignatureError(expectedVersion, 'key_mismatch')
  }

  let valid = false
  let verifyThrew = false
  try {
    valid = verify(
      'sha512',
      Buffer.concat([MANIFEST_SIGNATURE_DOMAIN_PREFIX, manifestBytes]),
      publicKey,
      Buffer.from(signature, 'base64'),
    )
  } catch {
    valid = false
    verifyThrew = true
  }
  if (!valid) {
    throw new ManifestSignatureError(
      expectedVersion,
      'signature_invalid',
      'update',
      { verifyThrew },
    )
  }

  let parsedManifest: ReleaseManifest | null = null
  try {
    parsedManifest = parseReleaseManifest(
      jsonParse(manifestBytes.toString('utf8')),
    )
  } catch {
    parsedManifest = null
  }
  if (!parsedManifest || parsedManifest.version !== expectedVersion) {
    throw new ManifestSignatureError(expectedVersion, 'version_mismatch')
  }
  return parsedManifest
}

/** Official 2.1.328 `ze()`: streams a file and returns its SHA-256 hex digest. */
export async function hashFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

/** Official 2.1.328 `We()`: returns true iff `filePath` matches `expectedChecksum`. */
export async function verifyFileSha256(
  filePath: string,
  expectedChecksum: string,
): Promise<boolean> {
  try {
    return (await hashFileSha256(filePath)) === expectedChecksum
  } catch (error) {
    logForDebugging(
      `Could not hash ${filePath} (${getErrnoCode(error) ?? toError(error).name}); treating as mismatched`,
    )
    return false
  }
}

/** Official 2.1.328 `Gt()`: detects offline/transient network errors during re-verification. */
export function isOfflineNetworkError(error: unknown): boolean {
  if (getHttpStatus(error) !== undefined) {
    return false
  }
  return isNetworkOrTimeoutError(error)
}

/** Official 2.1.328 `S6s`: raised when the release server refuses the session. */
export class RegistrySessionRefusedError extends ClaudeError {
  constructor(message: string) {
    super(message)
    this.name = 'RegistrySessionRefusedError'
  }
}

export function isRegistrySessionRefusedError(err: unknown): boolean {
  return (
    err instanceof RegistrySessionRefusedError ||
    (err instanceof Error && err.name === 'RegistrySessionRefusedError')
  )
}

export async function getLatestVersionFromArtifactory(
  tag: string = 'latest',
): Promise<string> {
  const startTime = Date.now()
  const { stdout, code, stderr } = await execFileNoThrowWithCwd(
    'npm',
    [
      'view',
      `${MACRO.NATIVE_PACKAGE_URL}@${tag}`,
      'version',
      '--prefer-online',
      '--registry',
      ARTIFACTORY_REGISTRY_URL,
    ],
    {
      timeout: 30000,
      preserveOutputOnError: true,
    },
  )

  const latencyMs = Date.now() - startTime

  if (code !== 0) {
    logEvent('tengu_version_check_failure', {
      latency_ms: latencyMs,
      source_npm: true,
      exit_code: code,
    })
    const error = new Error(`npm view failed with code ${code}: ${stderr}`)
    logError(error)
    throw error
  }

  logEvent('tengu_version_check_success', {
    latency_ms: latencyMs,
    source_npm: true,
  })
  logForDebugging(
    `npm view ${MACRO.NATIVE_PACKAGE_URL}@${tag} version: ${stdout}`,
  )
  const latestVersion = stdout.trim()
  return latestVersion
}

const RELEASE_FETCH_MAX_ATTEMPTS = 3
const RELEASE_FETCH_BASE_DELAY_MS = 250

function getHttpStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error) && error.response) {
    return error.response.status
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'response' in error &&
    typeof (error as { response?: { status?: unknown } }).response?.status ===
      'number'
  ) {
    return (error as { response: { status: number } }).response.status
  }
  return undefined
}

function isNetworkOrTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ERR_NETWORK'
  ) {
    return true
  }
  return error.message.toLowerCase().includes('timeout')
}

/**
 * Official `alsoRetry` predicate for release manifest / signature / version fetches:
 * retry immediately on network/timeout errors (no HTTP status), 429, or >= 500.
 */
export function isRetryableReleaseFetchError(error: unknown): boolean {
  const status = getHttpStatus(error)
  return status === undefined
    ? isNetworkOrTimeoutError(error)
    : status === 429 || status >= 500
}

export async function fetchReleaseWithRetry<T = unknown>(
  url: string,
  config: AxiosRequestConfig,
  opts: {
    maxAttempts?: number
    alsoRetry?: (error: unknown) => boolean
    deadline?: AbortSignal
    sleepFn?: (ms: number) => Promise<void>
  } = {},
): Promise<{ data: T; attempt: number }> {
  const maxAttempts = opts.maxAttempts ?? RELEASE_FETCH_MAX_ATTEMPTS
  const alsoRetry = opts.alsoRetry ?? isRetryableReleaseFetchError
  const sleepFn = opts.sleepFn ?? sleep

  for (let attempt = 1; ; attempt++) {
    try {
      const response: AxiosResponse<T> = await axios.get<T>(url, {
        ...config,
        signal: opts.deadline ?? config.signal,
      })
      return { data: response.data, attempt }
    } catch (error) {
      const tagged = Object.assign(
        error instanceof Error ? error : new Error(String(error)),
        { attempt },
      )
      if (
        attempt >= maxAttempts ||
        opts.deadline?.aborted ||
        !alsoRetry(tagged)
      ) {
        throw tagged
      }
      const jitter = 0.75 + Math.random() * 0.5
      const delayMs = Math.round(
        RELEASE_FETCH_BASE_DELAY_MS * 2 ** (attempt - 1) * jitter,
      )
      logForDebugging(
        `Fetch of ${url} failed on attempt ${attempt}/${maxAttempts} (${getHttpStatus(tagged) ?? 'no response'}), retrying...`,
      )
      await sleepFn(delayMs)
      if (opts.deadline?.aborted) {
        throw tagged
      }
    }
  }
}

/** Official 2.1.328 `NU` / `DIe` (`chunk@286370035.js @134034`): strict semver validator. */
const VALID_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

export function isValidVersion(version: string): boolean {
  return (
    typeof version === 'string' &&
    VALID_VERSION_RE.test(version) &&
    semver.parse(version) !== null
  )
}

export async function getLatestVersionFromBinaryRepo(
  channel: ReleaseChannel = 'latest',
  baseUrl: string,
  authConfig?: { auth: { username: string; password: string } },
): Promise<string> {
  const startTime = Date.now()
  let responseData: string
  try {
    const { data } = await fetchReleaseWithRetry<string>(
      `${baseUrl}/${channel}`,
      {
        timeout: 30000,
        responseType: 'text',
        ...authConfig,
      },
    )
    responseData = data
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    let httpStatus: number | undefined
    if (axios.isAxiosError(error) && error.response) {
      httpStatus = error.response.status
    }

    logEvent('tengu_version_check_failure', {
      latency_ms: latencyMs,
      http_status: httpStatus,
      is_timeout: errorMessage.includes('timeout'),
    })
    const fetchError = new Error(
      `Failed to fetch version from ${baseUrl}/${channel}: ${errorMessage}`,
    )
    logError(fetchError)
    throw fetchError
  }

  const latencyMs = Date.now() - startTime
  const trimmed = String(responseData).trim()
  if (!isValidVersion(trimmed)) {
    throw new ClaudeError(
      `Version pointer for ${channel} did not return a version (got ${trimmed.length} bytes)`,
    )
  }
  logEvent('tengu_version_check_success', {
    latency_ms: latencyMs,
  })
  return trimmed
}

export async function getLatestVersion(
  channelOrVersion: string,
): Promise<string> {
  // Direct version - match internal format too (e.g. 1.0.30-dev.shaf4937ce)
  if (/^v?\d+\.\d+\.\d+(-\S+)?$/.test(channelOrVersion)) {
    const normalized = channelOrVersion.startsWith('v')
      ? channelOrVersion.slice(1)
      : channelOrVersion
    // 99.99.x is reserved for CI smoke-test fixtures on real GCS.
    // feature() is false in all shipped builds — DCE collapses this to an
    // unconditional throw. Only `bun --feature=ALLOW_TEST_VERSIONS` (the
    // smoke test's source-level invocation) bypasses.
    if (/^99\.99\./.test(normalized) && !feature('ALLOW_TEST_VERSIONS')) {
      throw new Error(
        `Version ${normalized} is not available for installation. Use 'stable' or 'latest'.`,
      )
    }
    return normalized
  }

  // Official 2.1.328 `Wjr`: reject unknown channels and reject 'rc' on external builds.
  const channel = channelOrVersion as ReleaseChannel
  if (channel !== 'stable' && channel !== 'latest' && channel !== 'rc') {
    throw new ClaudeError(
      `Invalid channel: ${channelOrVersion}. Use 'latest' or 'stable'`,
    )
  }
  if (channel === 'rc' && process.env.USER_TYPE !== 'ant') {
    throw new ClaudeError(
      `Invalid channel: ${channelOrVersion}. Use 'stable' or 'latest'`,
    )
  }

  // Route to appropriate source
  if (process.env.USER_TYPE === 'ant') {
    // Use Artifactory for ant users
    const npmTag = channel === 'stable' ? 'stable' : 'latest'
    return getLatestVersionFromArtifactory(npmTag)
  }

  // Use GCS for external users
  return getLatestVersionFromBinaryRepo(channel, GCS_BUCKET_URL)
}

export async function downloadVersionFromArtifactory(
  version: string,
  stagingPath: string,
) {
  const fs = getFsImplementation()

  // If we get here, we own the lock and can delete a partial download
  await fs.rm(stagingPath, { recursive: true, force: true })

  // Get the platform-specific package name
  const platform = getPlatform()
  const platformPackageName = `${MACRO.NATIVE_PACKAGE_URL}-${platform}`

  // Fetch integrity hash for the platform-specific package
  logForDebugging(
    `Fetching integrity hash for ${platformPackageName}@${version}`,
  )
  const {
    stdout: integrityOutput,
    code,
    stderr,
  } = await execFileNoThrowWithCwd(
    'npm',
    [
      'view',
      `${platformPackageName}@${version}`,
      'dist.integrity',
      '--registry',
      ARTIFACTORY_REGISTRY_URL,
    ],
    {
      timeout: 30000,
      preserveOutputOnError: true,
    },
  )

  if (code !== 0) {
    throw new Error(`npm view integrity failed with code ${code}: ${stderr}`)
  }

  const integrity = integrityOutput.trim()
  if (!integrity) {
    throw new Error(
      `Failed to fetch integrity hash for ${platformPackageName}@${version}`,
    )
  }

  logForDebugging(`Got integrity hash for ${platform}: ${integrity}`)

  // Create isolated npm project in staging
  await fs.mkdir(stagingPath)

  const packageJson = {
    name: 'claude-native-installer',
    version: '0.0.1',
    dependencies: {
      [MACRO.NATIVE_PACKAGE_URL!]: version,
    },
  }

  // Create package-lock.json with integrity verification for platform-specific package
  const packageLock = {
    name: 'claude-native-installer',
    version: '0.0.1',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'claude-native-installer',
        version: '0.0.1',
        dependencies: {
          [MACRO.NATIVE_PACKAGE_URL!]: version,
        },
      },
      [`node_modules/${MACRO.NATIVE_PACKAGE_URL}`]: {
        version: version,
        optionalDependencies: {
          [platformPackageName]: version,
        },
      },
      [`node_modules/${platformPackageName}`]: {
        version: version,
        integrity: integrity,
      },
    },
  }

  writeFileSync_DEPRECATED(
    join(stagingPath, 'package.json'),
    jsonStringify(packageJson, null, 2),
    { encoding: 'utf8', flush: true },
  )

  writeFileSync_DEPRECATED(
    join(stagingPath, 'package-lock.json'),
    jsonStringify(packageLock, null, 2),
    { encoding: 'utf8', flush: true },
  )

  // Install with npm - it will verify integrity from package-lock.json
  // Use --prefer-online to force fresh metadata checks, helping with Artifactory replication delays
  const result = await execFileNoThrowWithCwd(
    'npm',
    ['ci', '--prefer-online', '--registry', ARTIFACTORY_REGISTRY_URL],
    {
      timeout: 60000,
      preserveOutputOnError: true,
      cwd: stagingPath,
    },
  )

  if (result.code !== 0) {
    throw new Error(`npm ci failed with code ${result.code}: ${result.stderr}`)
  }

  logForDebugging(
    `Successfully downloaded and verified ${MACRO.NATIVE_PACKAGE_URL}@${version}`,
  )
}

// Stall timeout: abort if no bytes received for this duration
// Official 2.1.328 `cr` = 120_000ms (2 minutes)
const DEFAULT_STALL_TIMEOUT_MS = 120_000
// Official 2.1.328 `Lt` = 600_000ms (10 minutes)
const DEFAULT_DOWNLOAD_DEADLINE_MS = 600_000
const MAX_DOWNLOAD_RETRIES = 3

function getStallTimeoutMs(): number {
  return resolveStallTimeoutMsForTesting() ?? DEFAULT_STALL_TIMEOUT_MS
}

function getDownloadDeadlineMs(): number {
  return resolveDownloadDeadlineMsForTesting() ?? DEFAULT_DOWNLOAD_DEADLINE_MS
}

class StallTimeoutError extends Error {
  constructor() {
    super('Download stalled: no data received for 120 seconds')
    this.name = 'StallTimeoutError'
  }
}

/**
 * Detect stall-triggered aborts for both axios arraybuffer downloads
 * (`axios.isCancel`) and zstd streaming `stream/promises` `pipeline()`
 * downloads (`AbortError` / `ABORT_ERR` when `controller.signal.aborted`).
 */
export function isDownloadStallAbortError(
  error: unknown,
  signalAborted: boolean,
): boolean {
  if (axios.isCancel(error)) {
    return true
  }
  if (!signalAborted || error === null || typeof error !== 'object') {
    return false
  }
  const err = error as { name?: unknown; code?: unknown }
  return err.name === 'AbortError' || err.code === 'ABORT_ERR'
}

export type CompressedBinaryOptions = {
  /** Expected SHA-256 checksum of the compressed `.zst` payload */
  checksum: string
  /** Exact expected decompressed byte size from the signed manifest */
  decompressedSize: number
}

const TRANSIENT_CONNECTION_DROP_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ERR_NETWORK',
  'ERR_SOCKET_CLOSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
])

/** Official 2.1.328 `Ot()`: detects mid-stream / transient TCP connection drops. */
function isTransientConnectionDropError(error: unknown): boolean {
  if (getHttpStatus(error) !== undefined) {
    return false
  }
  const code = getErrnoCode(error)
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return false
  }
  if (code !== undefined && TRANSIENT_CONNECTION_DROP_CODES.has(code)) {
    return true
  }
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('aborted')
  ) {
    return true
  }
  return false
}

function isDeterministicChecksumError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'deterministic' in error &&
    (error as { deterministic?: unknown }).deterministic === true
  )
}

function isIntegrityFallbackError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes('Checksum mismatch') ||
    msg.includes('exceeds the manifest size')
  )
}

/**
 * Common logic for downloading and verifying a binary (official 2.1.328 `ot`).
 * Streams BOTH compressed and uncompressed payloads directly to disk (never
 * buffering 250MB in RAM), enforces separate `stall` and `deadline` timers,
 * checks `signedWireSize` and decompressed size bounds, and retries on stall
 * timeouts, transient mid-stream TCP drops, and non-deterministic checksum
 * mismatches.
 */
async function downloadAndVerifyBinary(
  binaryUrl: string,
  expectedChecksum: string,
  binaryPath: string,
  requestConfig: Record<string, unknown> = {},
  compressed?: CompressedBinaryOptions,
  signedWireSize?: number,
  retryDelayMs = 1000,
): Promise<{ checksumRetried: boolean; dropRetried: boolean }> {
  let lastError: Error | undefined
  let checksumRetried = false
  let dropRetried = false

  for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    const controller = new AbortController()
    let streamCompleted = false
    let writeSucceeded = false
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    let writeStream: ReturnType<typeof createWriteStream> | undefined

    const clearTimers = () => {
      if (stallTimer) {
        clearTimeout(stallTimer)
        stallTimer = undefined
      }
      if (deadlineTimer) {
        clearTimeout(deadlineTimer)
        deadlineTimer = undefined
      }
    }

    const resetStallTimer = () => {
      if (stallTimer) {
        stallTimer.refresh()
      } else {
        stallTimer = setTimeout(
          c => c.abort('stall'),
          getStallTimeoutMs(),
          controller,
        )
      }
    }

    try {
      resetStallTimer()
      deadlineTimer = setTimeout(
        c => c.abort('deadline'),
        getDownloadDeadlineMs(),
        controller,
      )

      const response = await axios.get(binaryUrl, {
        timeout: getDownloadDeadlineMs(),
        responseType: 'stream',
        signal: controller.signal,
        ...requestConfig,
      })

      const decompressedHash = createHash('sha256')
      const compressedHash = compressed ? createHash('sha256') : undefined
      const wireHash = compressedHash ?? decompressedHash
      let wireBytes = 0

      const wireTransform = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          resetStallTimer()
          wireBytes += chunk.length
          if (signedWireSize !== undefined && wireBytes > signedWireSize) {
            callback(
              new ClaudeError(
                `Download exceeds the signed size of ${signedWireSize} bytes`,
              ),
            )
            return
          }
          wireHash.update(chunk)
          callback(null, chunk)
        },
      })

      writeStream = createWriteStream(binaryPath, {
        highWaterMark: 4 * 1024 * 1024,
      })
      writeStream.on('drain', resetStallTimer)

      const sourceStream =
        response.data instanceof Readable
          ? response.data
          : Readable.from([toBuffer(response.data)])

      if (compressed) {
        const { decompress, guard } = createBoundedZstdDecompressStreams(
          compressed.decompressedSize,
          chunk => decompressedHash.update(chunk),
        )
        await pipeline(
          sourceStream,
          wireTransform,
          decompress,
          guard,
          writeStream,
          { signal: controller.signal },
        )
      } else {
        await pipeline(sourceStream, wireTransform, writeStream, {
          signal: controller.signal,
        })
      }

      streamCompleted = true
      clearTimers()

      if (compressed) {
        const actualCompressedChecksum = compressedHash?.digest('hex')
        if (actualCompressedChecksum !== compressed.checksum) {
          throw new ClaudeError(
            `Checksum mismatch: expected ${compressed.checksum}, got ${actualCompressedChecksum} (compressed)`,
          )
        }
      }

      const actualChecksum = decompressedHash.digest('hex')
      if (actualChecksum !== expectedChecksum) {
        throw Object.assign(
          new ClaudeError(
            `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
          ),
          { deterministic: compressed !== undefined },
        )
      }

      writeSucceeded = true
      await chmod(binaryPath, 0o755)
      return { checksumRetried, dropRetried }
    } catch (error) {
      clearTimers()

      const normalizedError = isZstdDecompressError(error)
        ? Object.assign(
            new ClaudeError(
              `Checksum mismatch: zstd decoder rejected the frame (${getErrnoCode(error)})`,
            ),
            { cause: error },
          )
        : error

      if (
        axios.isAxiosError(normalizedError) &&
        normalizedError.response?.data instanceof Readable
      ) {
        normalizedError.response.data.destroy()
      }

      if (writeStream && !writeSucceeded) {
        const ws = writeStream
        await new Promise<void>(resolve => ws.close(() => resolve()))
        await rm(binaryPath, { force: true }).catch(err =>
          logForDebugging(
            `Failed to remove partial download: ${err instanceof Error ? err.message : String(err)}`,
            { level: 'error' },
          ),
        )
      }

      const abortReason = controller.signal.aborted
        ? controller.signal.reason
        : undefined
      const isDeadlineTimeout = abortReason === 'deadline'
      const isStallTimeout =
        !isDeadlineTimeout &&
        (abortReason === 'stall' ||
          isDownloadStallAbortError(normalizedError, controller.signal.aborted))

      if (isDeadlineTimeout) {
        throw Object.assign(
          new ClaudeError('Download timed out: exceeded the total deadline'),
          { attempt },
        )
      }

      const isChecksumMismatch =
        normalizedError instanceof Error &&
        normalizedError.message.includes('Checksum mismatch')
      const isConnectionDrop =
        !streamCompleted &&
        !isStallTimeout &&
        (isTransientConnectionDropError(normalizedError) ||
          getErrnoCode(normalizedError) === 'ERR_STREAM_PREMATURE_CLOSE')

      const wrappedError = isStallTimeout
        ? new StallTimeoutError()
        : toError(normalizedError)
      lastError = wrappedError

      if (
        (isStallTimeout || isChecksumMismatch || isConnectionDrop) &&
        !isDeterministicChecksumError(normalizedError) &&
        attempt < MAX_DOWNLOAD_RETRIES
      ) {
        if (isChecksumMismatch) {
          checksumRetried = true
        } else if (isConnectionDrop) {
          dropRetried = true
        }
        logForDebugging(
          `Download ${isChecksumMismatch ? 'checksum mismatch' : isStallTimeout ? 'stalled' : 'connection dropped'} on attempt ${attempt}/${MAX_DOWNLOAD_RETRIES}, retrying...`,
        )
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs)
        }
        continue
      }

      if (isConnectionDrop) {
        const code = getErrnoCode(wrappedError)
        throw Object.assign(
          new ClaudeError(
            `The connection dropped while downloading the update (attempt ${attempt}/${MAX_DOWNLOAD_RETRIES}: ${wrappedError.message}). Check your network — proxies sometimes cut off large downloads.`,
          ),
          {
            attempt,
            connectionDrop: true,
            cause: wrappedError,
            ...(code ? { code } : {}),
          },
        )
      }

      throw Object.assign(wrappedError, { attempt })
    }
  }

  throw lastError ?? new Error('Download failed after all retries')
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data)
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8')
  }
  return Buffer.from(jsonStringify(data), 'utf8')
}

function getAttemptNumber(error: unknown): number | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'attempt' in error &&
    typeof (error as { attempt?: unknown }).attempt === 'number'
  ) {
    return (error as { attempt: number }).attempt
  }
  return undefined
}

function isTimeoutFailure(error: unknown): boolean {
  if (error instanceof StallTimeoutError || axios.isCancel(error)) {
    return true
  }
  const code = getErrnoCode(error)
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return true
  }
  const msg = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase()
  return msg.includes('timeout') || msg.includes('timed out')
}

/**
 * Official 2.1.328 `Ut()`: fetches `manifest.json` and verifies its detached
 * `.raw-sig.json` signature sidecar according to `signaturePolicy` and client
 * enforcement flag (`tengu_elegant_pancake`).
 */
export async function fetchAndVerifyReleaseManifest(
  baseUrl: string,
  version: string,
  opts: {
    authConfig?: {
      auth?: { username: string; password: string }
      headers?: Record<string, string>
    }
    signaturePolicy: ManifestSignaturePolicy
    platform: string
    startTime: number
    purpose?: 'download' | 'reverify'
    publicKeyPem?: string
  },
): Promise<{
  manifest: ReleaseManifest
  manifestAuthenticated: boolean
  signatureVerified: boolean
}> {
  const {
    authConfig,
    signaturePolicy,
    platform,
    startTime,
    purpose = 'download',
    publicKeyPem = MANIFEST_SIGNING_PUBLIC_KEY_PEM,
  } = opts
  const expectedBinaryName = getBinaryName(platform)

  let manifestBytes: Buffer
  let manifest: ReleaseManifest
  try {
    const { data } = await fetchReleaseWithRetry(
      `${baseUrl}/${version}/manifest.json`,
      {
        timeout: 10_000,
        maxContentLength: 1024 * 1024,
        ...authConfig,
        responseType: 'arraybuffer',
      },
    )
    manifestBytes = toBuffer(data)
    const parsed = parseReleaseManifest(
      jsonParse(manifestBytes.toString('utf8')),
    )
    if (!parsed) {
      throw new ClaudeError(
        `Manifest for ${version} is not a valid release manifest`,
      )
    }
    manifest = parsed
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errMsg = error instanceof Error ? error.message : String(error)
    const httpStatus = getHttpStatus(error)

    logEvent('tengu_binary_manifest_fetch_failure', {
      latency_ms: latencyMs,
      http_status: httpStatus,
      is_timeout: errMsg.includes('timeout'),
    })
    logError(
      new Error(
        `Failed to fetch manifest from ${baseUrl}/${version}/manifest.json: ${errMsg}`,
      ),
    )
    throw error
  }

  let manifestAuthenticated = false
  let signatureVerified = false

  if (signaturePolicy !== 'skip') {
    const sidecarUrl = `${baseUrl}/${version}/manifest.json.raw-sig.json`
    const sigStartTime = Date.now()
    let sidecarHttpStatus: number | undefined
    let sidecarAttempts = 1
    let capturedFlag: { flag: boolean | null } | undefined
    let sidecarData: unknown

    try {
      let unsignedLegacy = false
      try {
        const res = await fetchReleaseWithRetry(
          sidecarUrl,
          {
            timeout: 10_000,
            responseType: 'json',
            maxContentLength: 65_536,
            ...authConfig,
          },
          {
            maxAttempts: SIDECAR_FETCH_MAX_ATTEMPTS,
            alsoRetry: isRetryableReleaseFetchError,
            deadline: AbortSignal.timeout(SIDECAR_FETCH_DEADLINE_MS),
          },
        )
        sidecarAttempts = res.attempt
        sidecarData = res.data
      } catch (err) {
        sidecarHttpStatus = getHttpStatus(err)
        sidecarAttempts = getAttemptNumber(err) ?? 1
        if (sidecarHttpStatus !== 404) {
          const reason: ManifestSignatureErrorReason =
            sidecarHttpStatus !== undefined
              ? 'sidecar_fetch_http_error'
              : Date.now() - sigStartTime >
                  SIDECAR_FETCH_INTERRUPTED_THRESHOLD_MS
                ? 'sidecar_fetch_interrupted'
                : isTimeoutFailure(err)
                  ? 'sidecar_fetch_timeout'
                  : 'sidecar_fetch_connection_error'
          throw new ManifestSignatureError(version, reason)
        }
        if (signaturePolicy !== 'allow-unsigned-legacy') {
          throw new ManifestSignatureError(version, 'sidecar_missing')
        }
        unsignedLegacy = true
      }

      if (unsignedLegacy) {
        logForDebugging(
          `No manifest signature published for ${version} (predates ${FIRST_SIGNED_VERSION}); continuing with checksum-only verification`,
          { level: 'warn' },
        )
      } else {
        const verified = verifyReleaseManifestSignature({
          manifestBytes,
          sidecar: sidecarData,
          expectedVersion: version,
          publicKeyPem,
        })
        logForDebugging(`Verified manifest signature for ${version}`)

        const platformEntry = verified.platforms[platform]
        if (platformEntry && platformEntry.binary !== expectedBinaryName) {
          throw new ManifestSignatureError(version, 'binary_name_mismatch')
        }

        manifest = verified
        manifestAuthenticated = true

        if (signaturePolicy === 'require-enforcing-release') {
          capturedFlag = { flag: getManifestSignatureFlag() }
          if (
            !isReleaseEnforcingManifestSignature(
              verified.manifestSignatureEnforcement,
              capturedFlag.flag,
            )
          ) {
            throw new ManifestSignatureError(
              version,
              'release_predates_enforcement',
            )
          }
        }
        signatureVerified = true
      }
    } catch (err) {
      if (!(err instanceof ManifestSignatureError)) {
        throw err
      }
      const sigLatencyMs = Date.now() - sigStartTime
      const enforced = capturedFlag
        ? isManifestSignatureEnforced(
            MANIFEST_SIGNATURE_CLIENT_ENFORCEMENT,
            capturedFlag.flag,
          )
        : isManifestSignatureEnforced()

      logEvent('tengu_binary_manifest_signature_failed', {
        reason:
          err.reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        http_status: sidecarHttpStatus,
        attempt: sidecarAttempts,
        enforced,
        latency_ms: sigLatencyMs,
        purpose:
          purpose as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        target_version:
          version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        verify_threw: err.verifyThrew,
      })

      if (enforced) {
        if (err.reason === 'release_predates_enforcement') {
          logForDebugging(
            `${version} is signed but predates manifest-signature enforcement; not eligible as a channel target for this client`,
            { level: 'warn' },
          )
        } else if (err.reason === 'sidecar_fetch_interrupted') {
          logForDebugging(
            `Signature sidecar fetch for ${version} was interrupted (process suspended mid-request); will retry on the next update check`,
            { level: 'warn' },
          )
        } else {
          logForDebugging(
            `Manifest signature check failed for ${sidecarUrl}: ${err.reason}`,
            { level: 'error' },
          )
        }
        throw err
      }

      logForDebugging(
        `Manifest signature check failed for ${sidecarUrl}: ${err.reason} (enforcement disabled; continuing)`,
        { level: 'warn' },
      )
    }
  }

  return { manifest, manifestAuthenticated, signatureVerified }
}

/**
 * Official 2.1.328 `Wt()`: re-verifies a retained on-disk version binary
 * against its signed release manifest before re-activating it.
 */
export async function reverifyRetainedVersion(
  version: string,
  installPath: string,
  opts: {
    explicitVersionRequested: boolean
    requireEnforcingRelease: boolean
    publicKeyPem?: string
  },
): Promise<{
  signatureVerified: boolean
  binaryMatches: boolean
  expectedChecksum?: string
}> {
  const platform = getPlatform()
  const { manifest, manifestAuthenticated, signatureVerified } =
    await fetchAndVerifyReleaseManifest(GCS_BUCKET_URL, version, {
      signaturePolicy: getManifestSignaturePolicy(version, opts),
      platform,
      startTime: Date.now(),
      purpose: 'reverify',
      publicKeyPem: opts.publicKeyPem,
    })

  if (!manifestAuthenticated) {
    logForDebugging(
      `Manifest for retained ${version} is unauthenticated; activating the retained copy without a checksum comparison`,
      { level: 'warn' },
    )
    return {
      signatureVerified: false,
      binaryMatches: true,
      expectedChecksum: undefined,
    }
  }

  const expectedChecksum = manifest.platforms[platform]?.checksum
  const binaryMatches =
    expectedChecksum !== undefined &&
    (await verifyFileSha256(installPath, expectedChecksum))
  if (!binaryMatches) {
    logForDebugging(
      `Retained ${version} does not match its signed manifest checksum; re-downloading`,
    )
  }
  return { signatureVerified, binaryMatches, expectedChecksum }
}

export async function downloadVersionFromBinaryRepo(
  version: string,
  stagingPath: string,
  baseUrl: string,
  authConfig?: {
    auth?: { username: string; password: string }
    headers?: Record<string, string>
  },
  options?: {
    signaturePolicy?: ManifestSignaturePolicy
    publicKeyPem?: string
  },
): Promise<{
  signatureVerified: boolean
  expectedChecksum: string
}> {
  const fs = getFsImplementation()

  // If we get here, we own the lock and can delete a partial download
  await fs.rm(stagingPath, { recursive: true, force: true })

  // Get platform
  const platform = getPlatform()
  const startTime = Date.now()

  // Log download attempt start
  logEvent('tengu_binary_download_attempt', {})

  // Fetch & verify manifest + optional compressed manifest.zst.json in parallel (official 2.1.328 `hr`)
  const signaturePolicy =
    options?.signaturePolicy ??
    (baseUrl === GCS_BUCKET_URL ? 'require' : 'skip')
  const [{ manifest, signatureVerified }, zstManifestRes] = await Promise.all([
    fetchAndVerifyReleaseManifest(baseUrl, version, {
      authConfig,
      signaturePolicy,
      platform,
      startTime,
      purpose: 'download',
      publicKeyPem: options?.publicKeyPem,
    }),
    fetchReleaseWithRetry<ReleaseManifest>(
      `${baseUrl}/${version}/manifest.zst.json`,
      {
        timeout: 10_000,
        ...authConfig,
        responseType: 'json',
        maxContentLength: 1024 * 1024,
      },
    ).catch(err => {
      logForDebugging(
        `No compressed manifest for ${version}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return undefined
    }),
  ])

  const platformInfo = manifest.platforms[platform]

  if (!platformInfo) {
    logEvent('tengu_binary_platform_not_found', {})
    throw new Error(
      `Platform ${platform} not found in manifest for version ${version}`,
    )
  }

  const expectedChecksum = platformInfo.checksum
  const zstChecksum = zstManifestRes?.data?.platforms?.[platform]?.checksum
  const decompressedSize = platformInfo.size
  const compressedOpts: CompressedBinaryOptions | undefined =
    typeof zstChecksum === 'string' &&
    /^[a-f0-9]{64}$/.test(zstChecksum) &&
    typeof decompressedSize === 'number' &&
    Number.isInteger(decompressedSize) &&
    decompressedSize > 0
      ? { checksum: zstChecksum, decompressedSize }
      : undefined

  // Both GCS and generic bucket use identical layout: ${baseUrl}/${version}/${platform}/${binaryName}
  const binaryName = getBinaryName(platform)
  const binaryUrl = `${baseUrl}/${version}/${platform}/${binaryName}`

  // Write to staging
  await fs.mkdir(stagingPath)
  const binaryPath = join(stagingPath, binaryName)

  let useCompressed = compressedOpts !== undefined
  let activeDownloadUrl = useCompressed ? `${binaryUrl}.zst` : binaryUrl

  try {
    let downloadOutcome:
      | { checksumRetried: boolean; dropRetried: boolean }
      | undefined
    if (compressedOpts) {
      try {
        downloadOutcome = await downloadAndVerifyBinary(
          activeDownloadUrl,
          expectedChecksum,
          binaryPath,
          authConfig || {},
          compressedOpts,
        )
      } catch (zstErr) {
        if (
          getHttpStatus(zstErr) === undefined &&
          !isIntegrityFallbackError(zstErr)
        ) {
          throw zstErr
        }
        useCompressed = false
        activeDownloadUrl = binaryUrl
        logForDebugging(
          `Compressed binary unusable (${zstErr instanceof Error ? zstErr.message : String(zstErr)}), falling back to ${binaryUrl}`,
        )
      }
    }
    if (!downloadOutcome) {
      await downloadAndVerifyBinary(
        binaryUrl,
        expectedChecksum,
        binaryPath,
        authConfig || {},
        undefined,
        platformInfo.size,
      )
    }
    const latencyMs = Date.now() - startTime
    logEvent('tengu_binary_download_success', {
      latency_ms: latencyMs,
      compressed: useCompressed,
    })
    return { signatureVerified, expectedChecksum }
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    let httpStatus: number | undefined
    if (axios.isAxiosError(error) && error.response) {
      httpStatus = error.response.status
    }

    logEvent('tengu_binary_download_failure', {
      latency_ms: latencyMs,
      http_status: httpStatus,
      is_timeout: isTimeoutFailure(error),
      is_checksum_mismatch: errorMessage.includes('Checksum mismatch'),
      attempt: getAttemptNumber(error),
      compressed: useCompressed,
    })
    logError(
      new Error(
        `Failed to download binary from ${activeDownloadUrl}: ${errorMessage}`,
      ),
    )
    throw error
  }
}

export type DownloadVersionResult = {
  downloadType: 'npm' | 'binary'
  signatureVerified: boolean
  expectedChecksum?: string
}

export async function downloadVersion(
  version: string,
  stagingPath: string,
  opts?: {
    explicitVersionRequested?: boolean
    requireEnforcingRelease?: boolean
    publicKeyPem?: string
  },
): Promise<DownloadVersionResult> {
  // Test-fixture versions route to the private sentinel bucket. DCE'd in all
  // shipped builds — the string 'claude-code-ci-sentinel' and the gcloud call
  // never exist in compiled binaries. Same gcloud-token pattern as
  // remoteSkillLoader.ts:175-195.
  if (feature('ALLOW_TEST_VERSIONS') && /^99\.99\./.test(version)) {
    const { stdout } = await execFileNoThrowWithCwd('gcloud', [
      'auth',
      'print-access-token',
    ])
    const { signatureVerified, expectedChecksum } =
      await downloadVersionFromBinaryRepo(
        version,
        stagingPath,
        'https://storage.googleapis.com/claude-code-ci-sentinel',
        { headers: { Authorization: `Bearer ${stdout.trim()}` } },
        { signaturePolicy: 'skip' },
      )
    return { downloadType: 'binary', signatureVerified, expectedChecksum }
  }

  if (process.env.USER_TYPE === 'ant') {
    // Use Artifactory for ant users
    await downloadVersionFromArtifactory(version, stagingPath)
    return { downloadType: 'npm', signatureVerified: false }
  }

  // Use GCS for external users with official manifest signature verification
  const signaturePolicy = getManifestSignaturePolicy(version, {
    explicitVersionRequested: opts?.explicitVersionRequested ?? false,
    requireEnforcingRelease: opts?.requireEnforcingRelease ?? false,
  })
  const { signatureVerified, expectedChecksum } =
    await downloadVersionFromBinaryRepo(
      version,
      stagingPath,
      GCS_BUCKET_URL,
      undefined,
      {
        signaturePolicy,
        publicKeyPem: opts?.publicKeyPem,
      },
    )
  return { downloadType: 'binary', signatureVerified, expectedChecksum }
}

// Exported for testing
export { StallTimeoutError, MAX_DOWNLOAD_RETRIES }
export const STALL_TIMEOUT_MS = DEFAULT_STALL_TIMEOUT_MS
export const DOWNLOAD_DEADLINE_MS = DEFAULT_DOWNLOAD_DEADLINE_MS
export const _downloadAndVerifyBinaryForTesting = downloadAndVerifyBinary
