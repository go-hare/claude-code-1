import * as fs from 'fs'
import { unlink } from 'fs/promises'
import {
  getApiKeyFromFd,
  getGatewayTokenFromDescriptor,
  getOauthTokenFromFd,
  markDescriptorAnnouncementConsumed,
  setApiKeyFromFd,
  setGatewayTokenFromDescriptor,
  setOauthScopesFromFd,
  setOauthTokenFromBgSnapshot,
  setOauthTokenFromFd,
} from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { isBareMode, isEnvTruthy } from './envUtils.js'
import { errorMessage, getErrnoCode, isENOENT } from './errors.js'
import { getFsImplementation } from './fsOperations.js'

/**
 * Well-known token file locations in CCR. The Go environment-manager creates
 * /home/claude/.claude/remote/ and will (eventually) write these files too.
 * Until then, this module writes them on successful FD read so subprocesses
 * spawned inside the CCR container can find the token without inheriting
 * the FD — which they can't: pipe FDs don't cross tmux/shell boundaries.
 */
const CCR_TOKEN_DIR = '/home/claude/.claude/remote'
export const CCR_OAUTH_TOKEN_PATH = `${CCR_TOKEN_DIR}/.oauth_token`
export const CCR_API_KEY_PATH = `${CCR_TOKEN_DIR}/.api_key`
export const CCR_SESSION_INGRESS_TOKEN_PATH = `${CCR_TOKEN_DIR}/.session_ingress_token`

/** densable `hqt` / `Tv`. Content past 64 KiB is refused. */
const MAX_CREDENTIAL_BYTES = 65536

type CredentialFdOptions = {
  envVar: string
  wellKnownPath: string
  label: string
  fileLabel?: string
  getCached: () => string | null | undefined
  setCached: (value: string | null) => void
  skipInReviewOrigin?: boolean
}

type CredentialOutcome = {
  token: string | null
  persist: boolean
}

/** densable `sV`. */
function isReviewOriginSession(): boolean {
  return process.env.CLAUDE_CODE_REMOTE_SESSION_ORIGIN === 'review'
}

/**
 * Same remote gate as the pre-2.1.289 persist helper: raw
 * `CLAUDE_CODE_REMOTE`, replaced by `isRemoteEnvEnabled` when that module
 * loads.
 */
function isRemoteSession(): boolean {
  let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  try {
    const { isRemoteEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    isRemote = isRemoteEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  return isRemote
}

/** densable `U`. EACCES counts only on Windows. */
function isBusyErrno(error: unknown): boolean {
  const code = getErrnoCode(error)
  if (code === 'EBUSY' || code === 'EPERM') return true
  return code === 'EACCES' && process.platform === 'win32'
}

function isInheritedDescriptorOk(): boolean {
  return !isRemoteSession() && typeof process.send !== 'function'
}

function providerManagedFollowsSymlinks(): boolean {
  return Boolean(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
}

function errnoError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

function fileLabelOf(opts: CredentialFdOptions): string {
  return opts.fileLabel ?? opts.label
}

/**
 * Best-effort write of the token to a well-known location for subprocess
 * access. CCR-gated: outside CCR there's no /home/claude/ and no reason to
 * put a token on disk that the FD was meant to keep off disk.
 *
 * densable `h` / `wv`. `skipInReviewOrigin` is gold's fourth option.
 */
export function maybePersistTokenForSubprocesses(
  path: string,
  token: string,
  tokenName: string,
  skipInReviewOrigin = false,
): void {
  if (!isRemoteSession()) return
  if (skipInReviewOrigin && isReviewOriginSession()) {
    logForDebugging(
      `Skipping ${tokenName} disk persistence in review-origin session`,
    )
    return
  }
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- one-shot startup write in CCR, caller is sync
    fs.mkdirSync(CCR_TOKEN_DIR, { recursive: true, mode: 0o700 })
    // eslint-disable-next-line custom-rules/no-sync-fs -- one-shot startup write in CCR, caller is sync
    fs.writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 })
    logForDebugging(`Persisted ${tokenName} to ${path} for subprocess access`)
  } catch (error) {
    logForDebugging(
      `Failed to persist ${tokenName} to disk (non-fatal): ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

/**
 * Fallback read from a well-known file. The path only exists in CCR (env-manager
 * creates the directory), so file-not-found is the expected outcome everywhere
 * else — treated as "no fallback", not an error.
 */
export function readTokenFromWellKnownFile(
  path: string,
  tokenName: string,
): string | null {
  try {
    const fsOps = getFsImplementation()
    // eslint-disable-next-line custom-rules/no-sync-fs -- fallback read for CCR subprocess path, one-shot at startup, caller is sync
    const token = fsOps.readFileSync(path, { encoding: 'utf8' }).trim()
    if (!token) return null
    logForDebugging(`Read ${tokenName} from well-known file ${path}`)
    return token
  } catch (error) {
    // ENOENT is the expected outcome outside CCR — stay silent. Anything
    // else (EACCES from perm misconfig, etc.) is worth surfacing in the
    // debug log so subprocess auth failures aren't mysterious.
    if (!isENOENT(error)) {
      logForDebugging(
        `Failed to read ${tokenName} from ${path}: ${errorMessage(error)}`,
        { level: 'debug' },
      )
    }
    return null
  }
}

/* eslint-disable custom-rules/no-sync-fs -- densable sync credential reads (b/k/T) */

/**
 * densable `V9`. Throws once the byte count passes `maxBytes` (a 64 KiB
 * file is kept; one more byte is refused). Newline reads include the
 * newline byte; callers trim.
 */
function readFdBounded(
  fd: number,
  label: string,
  maxBytes: number,
  untilNewline: boolean,
): string {
  const chunks: Buffer[] = []
  let total = 0
  const buf = Buffer.alloc(8192)
  while (true) {
    const n = fs.readSync(fd, buf, 0, buf.length, null)
    if (n === 0) return Buffer.concat(chunks).toString('utf8')
    total += n
    if (total > maxBytes) {
      throw new Error(
        `refusing to read ${label}: content exceeds ${maxBytes} byte limit`,
      )
    }
    const newlineAt = untilNewline ? buf.subarray(0, n).indexOf(10) : -1
    const end = newlineAt === -1 ? n : newlineAt + 1
    chunks.push(Buffer.from(buf.subarray(0, end)))
    if (newlineAt !== -1) return Buffer.concat(chunks).toString('utf8')
  }
}

/**
 * densable `vv`. `followSymlinks` false opens `O_NOFOLLOW` (Windows lstats,
 * because `O_NOFOLLOW` is absent there). Does not trim.
 */
function readBoundedSync(
  filePath: string,
  options: { followSymlinks: boolean; regularFileOnly: boolean },
): string {
  let flags: number | string = 'r'
  if (!options.followSymlinks) {
    if (process.platform === 'win32') {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        throw errnoError('ELOOP', 'ELOOP: refusing a symbolic link')
      }
    } else {
      flags =
        fs.constants.O_RDONLY |
        (fs.constants.O_NOFOLLOW ?? 0) |
        (fs.constants.O_NONBLOCK ?? 0)
    }
  } else if (options.regularFileOnly && process.platform !== 'win32') {
    flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0)
  }

  const fd = fs.openSync(filePath, flags)
  try {
    if (options.regularFileOnly && !fs.fstatSync(fd).isFile()) {
      throw errnoError('EINVAL', 'EINVAL: not a regular file')
    }
    if (!options.followSymlinks && process.platform === 'win32') {
      const opened = fs.fstatSync(fd, { bigint: true })
      const linked = fs.lstatSync(filePath, { bigint: true })
      if (
        linked.isSymbolicLink() ||
        linked.ino !== opened.ino ||
        linked.dev !== opened.dev
      ) {
        throw errnoError('ELOOP', 'ELOOP: refusing a symbolic link')
      }
    }
    return readFdBounded(fd, filePath, MAX_CREDENTIAL_BYTES, false)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * densable `b`. Snapshot text, untrimmed. One retry when `U` says the
 * first attempt is busy; a second failure propagates.
 */
function readSnapshotFile(filePath: string): string {
  const followSymlinks = providerManagedFollowsSymlinks()
  const options = { followSymlinks, regularFileOnly: true }
  try {
    return readBoundedSync(filePath, options)
  } catch (error) {
    if (!isBusyErrno(error)) throw error
  }
  return readBoundedSync(filePath, options)
}

/** densable `Y9` / `Zir`. fstat failure is not a socket. */
function isSocketFd(fd: number): boolean {
  try {
    return fs.fstatSync(fd).isSocket()
  } catch {
    return false
  }
}

/** densable `j9` + `w4e`. Closes `fd` only after the type check passes. */
function readInheritedFdSync(fd: number): string {
  const stat = fs.fstatSync(fd)
  if (!stat.isSocket() && !stat.isFIFO()) {
    throw new Error(`refusing to read fd ${fd}: not a pipe or socket`)
  }
  try {
    return readFdBounded(fd, `fd ${fd}`, MAX_CREDENTIAL_BYTES, true)
  } finally {
    fs.closeSync(fd)
  }
}

/** densable `z9` / `T`. Never throws. */
function readInheritedDescriptor(fd: number, label: string): string | null {
  try {
    logForDebugging(
      `Reading ${label} from inherited descriptor ${fd} (until newline or end-of-stream)`,
    )
    const text = readInheritedFdSync(fd).trim()
    if (!text) {
      logForDebugging(`File descriptor ${fd} contained empty ${label}`, {
        level: 'error',
      })
      return null
    }
    logForDebugging(
      `Successfully read ${label} directly from inherited descriptor ${fd}`,
    )
    return text
  } catch (error) {
    logForDebugging(
      `Failed to read ${label} directly from descriptor ${fd}: ${errorMessage(error)}`,
      { level: 'error' },
    )
    return null
  }
}

/* eslint-enable custom-rules/no-sync-fs */

/**
 * densable `P`. Sync snapshot consume. Callers: `getOAuthTokenFromFileDescriptor`
 * and `readGatewayTokenFromDescriptor` only — not the async oauth reader.
 */
function consumeBgAuthSnapshot(): void {
  const snapshotPath = process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH
  if (!snapshotPath) return
  let contents: string | undefined
  try {
    contents = readSnapshotFile(snapshotPath)
  } catch (error) {
    if (isBusyErrno(error)) {
      logForDebugging(
        `bg auth snapshot busy, will retry on the next read: ${errorMessage(error)}`,
        { level: 'warn' },
      )
      return
    }
    if (!isENOENT(error)) {
      logForDebugging(
        `Failed to consume bg auth snapshot: ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }
  delete process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH
  if (contents === undefined) return
  try {
    void unlink(snapshotPath).catch(() => {})
    const parsed = JSON.parse(contents) as {
      gatewayToken?: unknown
      accessToken?: unknown
      scopes?: unknown
      subscriptionType?: unknown
      rateLimitTier?: unknown
    }
    if (typeof parsed.gatewayToken === 'string' && parsed.gatewayToken) {
      setGatewayTokenFromDescriptor(parsed.gatewayToken)
      logForDebugging('Consumed gateway token from bg auth snapshot')
      return
    }
    if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) {
      logForDebugging('bg auth snapshot missing accessToken', {
        level: 'warn',
      })
      return
    }
    setOauthTokenFromFd(parsed.accessToken)
    setOauthTokenFromBgSnapshot(true)
    if (Array.isArray(parsed.scopes) && parsed.scopes.length > 0) {
      setOauthScopesFromFd(parsed.scopes)
    }
    if (parsed.subscriptionType) {
      process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE = String(
        parsed.subscriptionType,
      )
    }
    if (parsed.rateLimitTier) {
      process.env.CLAUDE_CODE_RATE_LIMIT_TIER = String(parsed.rateLimitTier)
    }
    logForDebugging('Consumed bg auth snapshot from sockDir')
  } catch (error) {
    if (!isENOENT(error)) {
      logForDebugging(
        `Failed to consume bg auth snapshot: ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }
}

/**
 * densable `k` / `K9`. Cache, FD, then well-known file. Persist is applied
 * by the caller so the async oauth path can await `v`.
 * `/dev/fd/${fd}` is always the non-socket path (not `/proc/self/fd`).
 */
function readCredentialOutcome(opts: CredentialFdOptions): CredentialOutcome {
  const cached = opts.getCached()
  if (cached !== undefined) return { token: cached, persist: false }

  const fdEnv = process.env[opts.envVar]
  const fileLabel = fileLabelOf(opts)
  if (!fdEnv) {
    const fromFile = readTokenFromWellKnownFile(opts.wellKnownPath, fileLabel)
    opts.setCached(fromFile)
    return { token: fromFile, persist: false }
  }

  const fd = parseInt(fdEnv, 10)
  if (Number.isNaN(fd)) {
    logForDebugging(
      `${opts.envVar} must be a valid file descriptor number, got: ${fdEnv}`,
      { level: 'error' },
    )
    opts.setCached(null)
    return { token: null, persist: false }
  }

  if (isSocketFd(fd)) {
    const inheritedOk = isInheritedDescriptorOk()
    const token = inheritedOk
      ? readInheritedDescriptor(fd, opts.label)
      : readTokenFromWellKnownFile(opts.wellKnownPath, fileLabel)
    if (inheritedOk) {
      delete process.env[opts.envVar]
      markDescriptorAnnouncementConsumed(opts.envVar)
    }
    opts.setCached(token)
    return { token, persist: Boolean(token) && inheritedOk }
  }

  try {
    const token = readBoundedSync(`/dev/fd/${fd}`, {
      followSymlinks: true,
      regularFileOnly: false,
    }).trim()
    if (!token) {
      logForDebugging(`File descriptor contained empty ${opts.label}`, {
        level: 'error',
      })
      opts.setCached(null)
      return { token: null, persist: false }
    }
    logForDebugging(
      `Successfully read ${opts.label} from file descriptor ${fd}`,
    )
    opts.setCached(token)
    return { token, persist: true }
  } catch (error) {
    logForDebugging(
      `Failed to read ${opts.label} from file descriptor ${fd}: ${errorMessage(error)}`,
      { level: 'error' },
    )
    const fromFile = readTokenFromWellKnownFile(opts.wellKnownPath, fileLabel)
    if (fromFile) {
      opts.setCached(fromFile)
      return { token: fromFile, persist: false }
    }
    const code = getErrnoCode(error)
    if ((code === 'EACCES' || code === 'EPERM') && isInheritedDescriptorOk()) {
      const inherited = readInheritedDescriptor(fd, opts.label)
      delete process.env[opts.envVar]
      markDescriptorAnnouncementConsumed(opts.envVar)
      if (inherited) {
        opts.setCached(inherited)
        return { token: inherited, persist: true }
      }
    }
    opts.setCached(null)
    return { token: null, persist: false }
  }
}

function getCredentialFromFd(opts: CredentialFdOptions): string | null {
  const outcome = readCredentialOutcome(opts)
  if (outcome.persist && outcome.token) {
    maybePersistTokenForSubprocesses(
      opts.wellKnownPath,
      outcome.token,
      fileLabelOf(opts),
      opts.skipInReviewOrigin ?? false,
    )
  }
  return outcome.token
}

function oauthFdOptions(): CredentialFdOptions {
  return {
    envVar: 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
    wellKnownPath: CCR_OAUTH_TOKEN_PATH,
    label: 'OAuth token',
    getCached: getOauthTokenFromFd,
    setCached: setOauthTokenFromFd,
    skipInReviewOrigin: true,
  }
}

type OauthHandoffRead = {
  readHandoffCredential?: (
    path: string,
    opts: { symlinkAtPath: 'follow' | 'refuse' },
  ) => Promise<unknown>
  writeHandoffCredential?: (path: string, token: string) => Promise<unknown>
}

/**
 * densable `I()` — well-known OAuth file via the credentials handle.
 * `undefined` means this handle has no handoff reader; the sync FD path
 * (`k`) still applies. A string or null is the handoff result
 * (`present` contents, or `absent` / empty / `read-failed`).
 */
async function readOauthHandoff(
  credentials: unknown,
): Promise<string | null | undefined> {
  if (credentials === null || typeof credentials !== 'object') return undefined
  const read = (credentials as OauthHandoffRead).readHandoffCredential
  if (typeof read !== 'function') return undefined
  const result = await read.call(credentials, CCR_OAUTH_TOKEN_PATH, {
    symlinkAtPath: 'follow',
  })
  if (result === null || typeof result !== 'object') return null
  const state = (result as { state?: unknown }).state
  if (state === 'present') {
    const contents = (result as { contents?: unknown }).contents
    const token = typeof contents === 'string' ? contents.trim() : ''
    if (!token) return null
    logForDebugging(
      `Read OAuth token from well-known file ${CCR_OAUTH_TOKEN_PATH}`,
    )
    return token
  }
  if (state === 'read-failed') {
    const code = (result as { code?: unknown }).code
    logForDebugging(
      `Failed to read OAuth token from ${CCR_OAUTH_TOKEN_PATH}: ${
        typeof code === 'string' ? code : 'unknown error'
      }`,
      { level: 'debug' },
    )
    return null
  }
  if (state === 'absent') return null
  return undefined
}

/** densable `v`. Falls back to sync `h` when the handle cannot write. */
async function persistOauthForSubprocesses(
  path: string,
  token: string,
  fileLabel: string,
  skipInReviewOrigin: boolean,
  credentials: unknown,
): Promise<void> {
  const write =
    credentials !== null && typeof credentials === 'object'
      ? (credentials as OauthHandoffRead).writeHandoffCredential
      : undefined
  if (typeof write !== 'function') {
    maybePersistTokenForSubprocesses(path, token, fileLabel, skipInReviewOrigin)
    return
  }
  if (!isRemoteSession()) return
  if (skipInReviewOrigin && isReviewOriginSession()) {
    logForDebugging(
      `Skipping ${fileLabel} disk persistence in review-origin session`,
    )
    return
  }
  const result = await write.call(credentials, path, token)
  if (
    result !== null &&
    typeof result === 'object' &&
    (result as { state?: unknown }).state === 'written'
  ) {
    logForDebugging(`Persisted ${fileLabel} to ${path} for subprocess access`)
    return
  }
  const code =
    result !== null && typeof result === 'object'
      ? (result as { code?: unknown }).code
      : undefined
  const detail =
    code === undefined || code === null ? 'unknown error' : String(code)
  logForDebugging(
    `Failed to persist ${fileLabel} to disk (non-fatal): ${detail}`,
    { level: 'error' },
  )
}

/**
 * densable async `F` / `Z7r`. Does not consume the bg auth snapshot (`P`).
 * No FD env: handoff `I`, else sync `k`. FD set: same branches as `k`,
 * persisting with async `v` when the handle can write.
 */
export async function readOAuthTokenFromFileDescriptor(
  credentials?: unknown,
): Promise<string | null> {
  const cached = getOauthTokenFromFd()
  if (cached !== undefined) return cached
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR) {
    const handed = await readOauthHandoff(credentials)
    if (handed !== undefined) {
      const again = getOauthTokenFromFd()
      if (again !== undefined) return again
      setOauthTokenFromFd(handed)
      return handed
    }
    return getCredentialFromFd(oauthFdOptions())
  }
  const opts = oauthFdOptions()
  const outcome = readCredentialOutcome(opts)
  if (outcome.persist && outcome.token) {
    await persistOauthForSubprocesses(
      opts.wellKnownPath,
      outcome.token,
      fileLabelOf(opts),
      opts.skipInReviewOrigin ?? false,
      credentials,
    )
  }
  return outcome.token
}

/**
 * Get the CCR-injected OAuth token. densable `mO`: sync `P` then `k`.
 * Env var: CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR.
 * Well-known file: /home/claude/.claude/remote/.oauth_token.
 * `credentials` is accepted so older `Z7r` call sites still typecheck.
 * Handoff reads go through `readOAuthTokenFromFileDescriptor`.
 */
export function getOAuthTokenFromFileDescriptor(
  _credentials?: unknown,
): string | null {
  consumeBgAuthSnapshot()
  return getCredentialFromFd(oauthFdOptions())
}

/**
 * Get the CCR-injected API key. densable `k` without `P`.
 * Env var: CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR.
 * Well-known file: /home/claude/.claude/remote/.api_key.
 */
export function getApiKeyFromFileDescriptor(): string | null {
  return getCredentialFromFd({
    envVar: 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
    wellKnownPath: CCR_API_KEY_PATH,
    label: 'API key',
    getCached: getApiKeyFromFd,
    setCached: setApiKeyFromFd,
    skipInReviewOrigin: false,
  })
}

/**
 * densable `$n` credential block, immediately before client-type.
 * Remote sessions skip the whole block. A snapshot is read only when an
 * OAuth descriptor is already present, or when bare mode is off and
 * `CLAUDE_CODE_OAUTH_TOKEN` is unset.
 */
export function consumeStartupCredentialDescriptors(): void {
  if (isRemoteSession()) return
  const oauthFd = process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
  const snapshot = process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH
  if (
    oauthFd ||
    (snapshot && !isBareMode() && !process.env.CLAUDE_CODE_OAUTH_TOKEN)
  ) {
    getOAuthTokenFromFileDescriptor()
  }
  if (process.env.CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR) {
    readGatewayTokenFromDescriptor()
  }
  if (process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR) {
    getApiKeyFromFileDescriptor()
  }
  if (process.env.CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR) {
    const { getSessionIngressAuthToken } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./sessionIngressAuth.js') as typeof import('./sessionIngressAuth.js')
    getSessionIngressAuthToken()
  }
}

/**
 * densable `Het`. Snapshot `P` first, then an inherited gateway socket.
 * `null` is cached (read and empty). A still-busy snapshot returns null
 * without caching so the next call can retry.
 */
export function readGatewayTokenFromDescriptor(): string | null {
  const cached = getGatewayTokenFromDescriptor()
  if (cached !== undefined) return cached
  consumeBgAuthSnapshot()
  const afterSnapshot = getGatewayTokenFromDescriptor()
  if (afterSnapshot !== undefined) return afterSnapshot
  if (process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH) return null
  const fdEnv = process.env.CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR
  const fd = fdEnv ? parseInt(fdEnv, 10) : Number.NaN
  const token =
    Number.isNaN(fd) ||
    isRemoteSession() ||
    typeof process.send === 'function' ||
    !isSocketFd(fd)
      ? null
      : readInheritedDescriptor(fd, 'gateway token')
  setGatewayTokenFromDescriptor(token)
  delete process.env.CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR
  return token
}
