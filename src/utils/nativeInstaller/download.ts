/**
 * Download functionality for native installer
 *
 * Handles downloading Claude binaries from various sources:
 * - Artifactory NPM packages
 * - GCS bucket
 */

import { feature } from 'bun:bundle'
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { chmod, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { logEvent } from 'src/services/analytics/index.js'
import type { ReleaseChannel } from '../config.js'
import { logForDebugging } from '../debug.js'
import { toError } from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { getFsImplementation } from '../fsOperations.js'
import {
  createBoundedZstdDecompressStreams,
  isZstdDecompressError,
} from '../http.js'
import { logError } from '../log.js'
import { sleep } from '../sleep.js'
import { jsonStringify, writeFileSync_DEPRECATED } from '../slowOperations.js'
import {
  resolveDownloadDeadlineMsForTestingOrDefault,
  resolveStallTimeoutMsForTestingOrDefault,
} from '../residualFinalEnvGates.js'
import { getBinaryName, getPlatform } from './installer.js'

const GCS_BUCKET_URL =
  'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases'
export const ARTIFACTORY_REGISTRY_URL =
  'https://artifactory.infra.ant.dev/artifactory/api/npm/npm-all/'

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

export async function getLatestVersionFromBinaryRepo(
  channel: ReleaseChannel = 'latest',
  baseUrl: string,
  authConfig?: { auth: { username: string; password: string } },
): Promise<string> {
  const startTime = Date.now()
  try {
    const { data } = await fetchReleaseWithRetry<string>(
      `${baseUrl}/${channel}`,
      {
        timeout: 30000,
        responseType: 'text',
        ...authConfig,
      },
    )
    const latencyMs = Date.now() - startTime
    logEvent('tengu_version_check_success', {
      latency_ms: latencyMs,
    })
    return data.trim()
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

  // ReleaseChannel validation
  const channel = channelOrVersion as ReleaseChannel
  if (channel !== 'stable' && channel !== 'latest') {
    throw new Error(
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
// Official YJg / KJg — STALL_TIMEOUT_MS_FOR_TESTING || 60_000
const DEFAULT_STALL_TIMEOUT_MS = 60000 // 60 seconds
// Official JJg / fzu default download deadline (5 min) when testing override unset.
const DEFAULT_DOWNLOAD_DEADLINE_MS = 5 * 60000
const MAX_DOWNLOAD_RETRIES = 3

function getStallTimeoutMs(): number {
  // Official YJg — STALL_TIMEOUT_MS_FOR_TESTING || 60_000
  return resolveStallTimeoutMsForTestingOrDefault()
}

function getDownloadDeadlineMs(): number {
  // Official JJg — DOWNLOAD_DEADLINE_MS_FOR_TESTING || 5 min
  return resolveDownloadDeadlineMsForTestingOrDefault()
}

class StallTimeoutError extends Error {
  constructor() {
    super('Download stalled: no data received for 60 seconds')
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

/**
 * Common logic for downloading and verifying a binary.
 * Includes stall detection (aborts if no bytes for 60s), retry logic, and
 * official 2.1.325 #2258 bounded zstd streaming decompression (checking wire
 * size, decompressed size against manifest, and ZSTD_error_* frames).
 */
async function downloadAndVerifyBinary(
  binaryUrl: string,
  expectedChecksum: string,
  binaryPath: string,
  requestConfig: Record<string, unknown> = {},
  compressed?: CompressedBinaryOptions,
  signedWireSize?: number,
) {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    const controller = new AbortController()
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    let writeStream: ReturnType<typeof createWriteStream> | undefined
    let writeSucceeded = false

    const clearStallTimer = () => {
      if (stallTimer) {
        clearTimeout(stallTimer)
        stallTimer = undefined
      }
    }

    const resetStallTimer = () => {
      clearStallTimer()
      stallTimer = setTimeout(c => c.abort(), getStallTimeoutMs(), controller)
    }

    try {
      // Start the stall timer before the request
      resetStallTimer()

      if (compressed) {
        const response = await axios.get(binaryUrl, {
          timeout: getDownloadDeadlineMs(),
          responseType: 'stream',
          signal: controller.signal,
          ...requestConfig,
        })

        const decompressedHash = createHash('sha256')
        const compressedHash = createHash('sha256')
        let wireBytes = 0
        const wireTransform = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            resetStallTimer()
            wireBytes += chunk.length
            if (signedWireSize !== undefined && wireBytes > signedWireSize) {
              callback(
                new Error(
                  `Download exceeds the signed size of ${signedWireSize} bytes`,
                ),
              )
              return
            }
            compressedHash.update(chunk)
            callback(null, chunk)
          },
        })

        writeStream = createWriteStream(binaryPath, {
          highWaterMark: 4 * 1024 * 1024,
        })
        writeStream.on('drain', resetStallTimer)

        const { decompress, guard } = createBoundedZstdDecompressStreams(
          compressed.decompressedSize,
          chunk => decompressedHash.update(chunk),
        )

        const sourceStream =
          response.data instanceof Readable
            ? response.data
            : Readable.from([Buffer.from(response.data)])
        await pipeline(
          sourceStream,
          wireTransform,
          decompress,
          guard,
          writeStream,
          {
            signal: controller.signal,
          },
        )

        clearStallTimer()

        const actualCompressedChecksum = compressedHash.digest('hex')
        if (actualCompressedChecksum !== compressed.checksum) {
          throw new Error(
            `Checksum mismatch: expected ${compressed.checksum}, got ${actualCompressedChecksum} (compressed)`,
          )
        }

        const actualChecksum = decompressedHash.digest('hex')
        if (actualChecksum !== expectedChecksum) {
          throw new Error(
            `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
          )
        }

        writeSucceeded = true
        await chmod(binaryPath, 0o755)
        return
      }

      const response = await axios.get(binaryUrl, {
        // Official JJg densable: DOWNLOAD_DEADLINE_MS_FOR_TESTING || 5 min
        timeout: getDownloadDeadlineMs(),
        responseType: 'arraybuffer',
        signal: controller.signal,
        onDownloadProgress: () => {
          // Reset stall timer on each chunk of data received
          resetStallTimer()
        },
        ...requestConfig,
      })

      clearStallTimer()

      const payload = Buffer.from(response.data)
      if (signedWireSize !== undefined && payload.length > signedWireSize) {
        throw new Error(
          `Download exceeds the signed size of ${signedWireSize} bytes`,
        )
      }

      // Verify checksum
      const hash = createHash('sha256')
      hash.update(payload)
      const actualChecksum = hash.digest('hex')

      if (actualChecksum !== expectedChecksum) {
        throw new Error(
          `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
        )
      }

      // Write binary to disk
      await writeFile(binaryPath, payload)
      writeSucceeded = true
      await chmod(binaryPath, 0o755)

      // Success - return early
      return
    } catch (error) {
      clearStallTimer()

      const normalizedError = isZstdDecompressError(error)
        ? Object.assign(
            new Error(
              `Checksum mismatch: zstd decoder rejected the frame (${(error as NodeJS.ErrnoException).code})`,
            ),
            { cause: error },
          )
        : error

      if (writeStream && !writeSucceeded) {
        const ws = writeStream
        await new Promise<void>(resolve => ws.close(() => resolve()))
        await rm(binaryPath, { force: true }).catch(() => {})
      }

      // Check if this was a stall timeout:
      // - axios wraps abort signals in CanceledError
      // - stream/promises pipeline() rejects with AbortError / ABORT_ERR on controller.abort()
      const isStallTimeout = isDownloadStallAbortError(
        normalizedError,
        controller.signal.aborted,
      )

      if (isStallTimeout) {
        lastError = new StallTimeoutError()
      } else {
        lastError = toError(normalizedError)
      }

      // Only retry on stall timeouts
      if (isStallTimeout && attempt < MAX_DOWNLOAD_RETRIES) {
        logForDebugging(
          `Download stalled on attempt ${attempt}/${MAX_DOWNLOAD_RETRIES}, retrying...`,
        )
        // Brief pause before retry to let network recover
        await sleep(1000)
        continue
      }

      // Don't retry other errors (HTTP errors, checksum mismatches, etc.)
      throw lastError
    }
  }

  // Should not reach here, but just in case
  throw lastError ?? new Error('Download failed after all retries')
}

export async function downloadVersionFromBinaryRepo(
  version: string,
  stagingPath: string,
  baseUrl: string,
  authConfig?: {
    auth?: { username: string; password: string }
    headers?: Record<string, string>
  },
) {
  const fs = getFsImplementation()

  // If we get here, we own the lock and can delete a partial download
  await fs.rm(stagingPath, { recursive: true, force: true })

  // Get platform
  const platform = getPlatform()
  const startTime = Date.now()

  // Log download attempt start
  logEvent('tengu_binary_download_attempt', {})

  // Fetch manifest to get checksum
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let manifest: any
  try {
    const { data } = await fetchReleaseWithRetry(
      `${baseUrl}/${version}/manifest.json`,
      {
        timeout: 10000,
        responseType: 'json',
        ...authConfig,
      },
    )
    manifest = data
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    let httpStatus: number | undefined
    if (axios.isAxiosError(error) && error.response) {
      httpStatus = error.response.status
    }

    logEvent('tengu_binary_manifest_fetch_failure', {
      latency_ms: latencyMs,
      http_status: httpStatus,
      is_timeout: errorMessage.includes('timeout'),
    })
    logError(
      new Error(
        `Failed to fetch manifest from ${baseUrl}/${version}/manifest.json: ${errorMessage}`,
      ),
    )
    throw error
  }

  const platformInfo = manifest.platforms[platform]

  if (!platformInfo) {
    logEvent('tengu_binary_platform_not_found', {})
    throw new Error(
      `Platform ${platform} not found in manifest for version ${version}`,
    )
  }

  const expectedChecksum = platformInfo.checksum

  // Both GCS and generic bucket use identical layout: ${baseUrl}/${version}/${platform}/${binaryName}
  const binaryName = getBinaryName(platform)
  const binaryUrl = `${baseUrl}/${version}/${platform}/${binaryName}`

  // Write to staging
  await fs.mkdir(stagingPath)
  const binaryPath = join(stagingPath, binaryName)

  try {
    await downloadAndVerifyBinary(
      binaryUrl,
      expectedChecksum,
      binaryPath,
      authConfig || {},
    )
    const latencyMs = Date.now() - startTime
    logEvent('tengu_binary_download_success', {
      latency_ms: latencyMs,
    })
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
      is_timeout: errorMessage.includes('timeout'),
      is_checksum_mismatch: errorMessage.includes('Checksum mismatch'),
    })
    logError(
      new Error(`Failed to download binary from ${binaryUrl}: ${errorMessage}`),
    )
    throw error
  }
}

export async function downloadVersion(
  version: string,
  stagingPath: string,
): Promise<'npm' | 'binary'> {
  // Test-fixture versions route to the private sentinel bucket. DCE'd in all
  // shipped builds — the string 'claude-code-ci-sentinel' and the gcloud call
  // never exist in compiled binaries. Same gcloud-token pattern as
  // remoteSkillLoader.ts:175-195.
  if (feature('ALLOW_TEST_VERSIONS') && /^99\.99\./.test(version)) {
    const { stdout } = await execFileNoThrowWithCwd('gcloud', [
      'auth',
      'print-access-token',
    ])
    await downloadVersionFromBinaryRepo(
      version,
      stagingPath,
      'https://storage.googleapis.com/claude-code-ci-sentinel',
      { headers: { Authorization: `Bearer ${stdout.trim()}` } },
    )
    return 'binary'
  }

  if (process.env.USER_TYPE === 'ant') {
    // Use Artifactory for ant users
    await downloadVersionFromArtifactory(version, stagingPath)
    return 'npm'
  }

  // Use GCS for external users
  await downloadVersionFromBinaryRepo(version, stagingPath, GCS_BUCKET_URL)
  return 'binary'
}

// Exported for testing
export { StallTimeoutError, MAX_DOWNLOAD_RETRIES }
export const STALL_TIMEOUT_MS = DEFAULT_STALL_TIMEOUT_MS
export const _downloadAndVerifyBinaryForTesting = downloadAndVerifyBinary
