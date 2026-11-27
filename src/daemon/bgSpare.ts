/**
 * Official densable HmO / X3q — `--bg-spare` claim host + BG4 spare pool.
 *
 * Entry: `claude --bg-spare <claimSock>` listens once for a claim frame, then
 * hands off into main() with the claimed argv/env/cwd.
 *
 * Supervisor side (official M3q/D3q/f3q): single held spare pre-warmed via
 * nested `--bg-pty-host … -- --bg-spare <claimSock>`, claimed on dispatch,
 * refilled after claim/cold spawn. Windows: spare disabled (null spawn).
 *
 * Pair with `--bg-pty-host … -- … --bg-spare <claimSock>` (ptyHost isSpare).
 * Control op `ensure-spare` remains empty ack (official too).
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'crypto'
import { mkdir, readdir, unlink, writeFile } from 'fs/promises'
import { createConnection, createServer, type Server } from 'net'
import { join } from 'path'
import { freemem } from 'os'
import { realpath } from 'fs/promises'
import { unlinkSync } from 'fs'
import {
  BgWorker,
  type DispatchRequest,
  type SpawnPtyFn,
  getAuthDir,
  getPtyErrPath,
  getSpareDir,
} from './bgWorker.js'
import { encodeCtrlFrame, mintPtyAuthToken } from './ptyHost.js'
import {
  applyHostManagedSpareEnv,
  applySpareProviderStrips,
  applySpareSessionStrips,
} from './bgHostManagedEnv.js'
import { logEvent } from '../services/analytics/index.js'
import {
  resetFdCredentialState,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
  switchSession,
} from '../bootstrap/state.js'
import { asSessionId } from '../types/ids.js'
import { logForDebugging } from '../utils/debug.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { errorMessage } from '../utils/errors.js'
import { isInBundledMode } from '../utils/bundledMode.js'
import { restrictedSpawnEnv } from '../utils/restricted.js'
import { stripOAuthScopesIfTokenRemoved } from '../utils/subprocessEnv.js'
import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  resetGrowthBook,
} from '../services/analytics/growthbook.js'

// ---------------------------------------------------------------------------
// Claim frame (host side) — official b64
// ---------------------------------------------------------------------------

export type BgSpareClaimFrame = {
  cwd: string
  env: Record<string, string>
  argv: string[]
  sessionId?: string
  /** Official 2.1.328 (`Ivr`) claim auth token. */
  auth?: string
  /**
   * Local product alias for `auth`: must match CLAUDE_BG_SPARE_CLAIM_NONCE on
   * spare host. Both `auth` and `nonce` are compared with timingSafeEqual.
   */
  nonce?: string
}

/** Official 2.1.328 (`Ivr` @302123668): 8 MiB line cap on claim socket. */
export const SPARE_CLAIM_MAX_LINE_BYTES = 8_388_608

/** Official 2.1.328 (`hpl` @283546038): invalid environment variable name check (`/^$|[=\x00-\x1f\x7f-\x9f]/`). */
function isInvalidEnvName(name: string): boolean {
  if (name.length === 0) return true
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code === 0x3d || code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true
    }
  }
  return false
}

export type ClaimEnvDropProblem =
  | 'invalid-name'
  | 'non-string-value'
  | 'nul-in-value'
  | 'denied-key'

const CLAIM_ENV_DROP_REASONS: Record<ClaimEnvDropProblem, string> = {
  'invalid-name': "it isn't a valid environment variable name",
  'non-string-value': "its value isn't a string",
  'nul-in-value': 'its value contains a NUL character',
  'denied-key': 'it is a restricted loader/shell environment variable',
}

/** Official 2.1.328 (`vde` @289457561): profile/config env stripped on session-credential claim. */
const SPARE_FEDERATION_STRIP_KEYS = [
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_CONFIG_DIR',
] as const

/** Host-managed network/cert/header keys cleared from spare env before applying claim env. */
const HOST_MANAGED_EXTRA_STRIP_KEYS = [
  'ANTHROPIC_CUSTOM_HEADERS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
] as const

/** Env injected into spare host so claim frames can prove supervisor origin. */
export const SPARE_CLAIM_NONCE_ENV = 'CLAUDE_BG_SPARE_CLAIM_NONCE'

/**
 * Keys never accepted from claim.env (product fortify vs densable full assign).
 * Blocks classic local-process hijacks if a claim sock is reachable.
 */
const CLAIM_ENV_DENY = new Set([
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'BASH_ENV',
  'ENV',
  'SHELLOPTS',
  'IFS',
  'CDPATH',
  'PROMPT_COMMAND',
  'PERL5OPT',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'JAVA_TOOL_OPTIONS',
  'SSLKEYLOGFILE',
])

function isClaimFrame(v: unknown): v is BgSpareClaimFrame {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.cwd === 'string' &&
    o.env !== null &&
    typeof o.env === 'object' &&
    Array.isArray(o.argv)
  )
}

/** Official 2.1.328 (`QB` @285083897): constant-time auth/nonce comparison. */
function timingSafeTokenEqual(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string' || !expected || presented.length === 0) {
    return false
  }
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Official 2.1.328 (`sio` @288535088) + product deny-list: filter claim.env
 * dropping invalid names, non-string values, NUL-containing values, and
 * loader/shell injection keys.
 */
export function filterClaimEnv(env: Record<string, unknown>): {
  kept: Record<string, string>
  dropped: Array<{ name: string; problem: ClaimEnvDropProblem }>
} {
  const kept: Record<string, string> = {}
  const dropped: Array<{ name: string; problem: ClaimEnvDropProblem }> = []
  for (const [k, v] of Object.entries(env)) {
    if (isInvalidEnvName(k)) {
      dropped.push({ name: k, problem: 'invalid-name' })
      continue
    }
    if (typeof v !== 'string') {
      dropped.push({ name: k, problem: 'non-string-value' })
      continue
    }
    if (v.includes('\0')) {
      dropped.push({ name: k, problem: 'nul-in-value' })
      continue
    }
    if (CLAIM_ENV_DENY.has(k) || k.startsWith('LD_') || k.startsWith('DYLD_')) {
      dropped.push({ name: k, problem: 'denied-key' })
      continue
    }
    kept[k] = v
  }
  return { kept, dropped }
}

/**
 * Filter claim.env before Object.assign — drop invalid names, NUL values,
 * non-string values, and loader/shell injection keys.
 */
export function sanitizeClaimEnv(
  env: Record<string, string>,
): Record<string, string> {
  return filterClaimEnv(env).kept
}

/**
 * Listen on claimSock; resolve with first valid newline-delimited JSON claim.
 * Official 2.1.328 (`Ivr` @302123668):
 * - Caps per-connection buffer at 8 MiB (8_388_608 bytes).
 * - Compares auth/nonce with `crypto.timingSafeEqual`.
 * - On oversized/invalid/mismatched frames, destroys ONLY the client socket
 *   and keeps the server listening for the legitimate claim.
 */
export function recvSpareClaim(
  claimSockPath: string,
  onListening?: () => void,
  expectedNonce?: string,
): Promise<BgSpareClaimFrame> {
  return new Promise((resolve, reject) => {
    let server: Server
    const fail = (err: unknown): void => {
      try {
        server.close()
      } catch {
        // ignore
      }
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    server = createServer(socket => {
      let buf = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        buf += chunk
        if (buf.length > SPARE_CLAIM_MAX_LINE_BYTES) {
          socket.destroy()
          return
        }
        const nl = buf.indexOf('\n')
        if (nl < 0) return
        if (expectedNonce) {
          let parsed: unknown
          try {
            parsed = JSON.parse(buf.slice(0, nl))
          } catch {
            parsed = undefined
          }
          if (
            !isClaimFrame(parsed) ||
            !timingSafeTokenEqual(parsed.auth ?? parsed.nonce, expectedNonce)
          ) {
            socket.destroy()
            return
          }
          server.close()
          resolve(parsed)
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(buf.slice(0, nl))
        } catch (err) {
          socket.destroy()
          fail(err)
          return
        }
        if (!isClaimFrame(parsed)) {
          socket.destroy()
          return
        }
        server.close()
        resolve(parsed)
      })
      socket.on('error', expectedNonce ? () => socket.destroy() : fail)
    })
    server.on('error', fail)
    if (onListening) {
      server.once('listening', () => {
        try {
          onListening()
        } catch (err) {
          fail(err)
        }
      })
    }
    server.listen(claimSockPath)
  })
}

function logDroppedClaimEnv(
  dropped: Array<{ name: string; problem: ClaimEnvDropProblem }>,
): void {
  const maxLogged = 8
  for (const { name, problem } of dropped.slice(0, maxLogged)) {
    logForDebugging(
      `[bg-spare] environment variable ${JSON.stringify(name)} was not applied to this background session: ${CLAIM_ENV_DROP_REASONS[problem]}. Programs it starts will not see it.`,
      { level: 'warn' },
    )
  }
  if (dropped.length > maxLogged) {
    const extra = dropped.length - maxLogged
    logForDebugging(
      `[bg-spare] \u2026and ${extra} more environment ${extra === 1 ? 'variable was' : 'variables were'} not applied.`,
      { level: 'warn' },
    )
  }
  logEvent('tengu_bg_claim_env_dropped', {
    dropped: dropped.length,
    nul_in_value: dropped.filter(d => d.problem === 'nul-in-value').length,
    invalid_name: dropped.filter(d => d.problem === 'invalid-name').length,
    non_string_value: dropped.filter(d => d.problem === 'non-string-value')
      .length,
  })
}

/**
 * Official 2.1.328 (`Mvr` @302123668) — apply claim frame, clear pre-claim
 * caches (settings, config, auth, GrowthBook, CA certs, mTLS, MDM), apply
 * host-managed provider env & federation strips + NUL/invalid env filtering,
 * then enter main().
 */
export async function applySpareClaimAndRunMain(
  claim: BgSpareClaimFrame,
  mainImport: Promise<{ main: () => Promise<void> }>,
): Promise<void> {
  const cwd = await realpath(claim.cwd)
  process.chdir(cwd)
  setOriginalCwd(cwd)
  setProjectRoot(cwd)
  setCwdState(cwd)
  if (claim.sessionId) {
    switchSession(asSessionId(claim.sessionId), null, 'spare_claim')
  }

  const [
    { resetSettingsCache },
    { clearMdmSettingsCache },
    { getProjectPathForConfig, resetTrustDialogAcceptedCacheForTesting },
    {
      clearApiKeyHelperCache,
      clearAwsCredentialExportCache,
      clearAwsCredentialsCache,
      clearGcpCredentialsCache,
      clearOAuthTokenCache,
      clearOtelHeadersCache,
    },
    { clearCACertsCache },
    { clearMTLSCache },
  ] = await Promise.all([
    import('../utils/settings/settingsCache.js'),
    import('../utils/settings/mdm/settings.js'),
    import('../utils/config.js'),
    import('../utils/auth.js'),
    import('../utils/caCerts.js'),
    import('../utils/mtls.js'),
  ])

  // Clear pre-claim settings/config caches before mutating process.env (Sr, cSt, Jhr).
  resetSettingsCache()
  getProjectPathForConfig.cache?.clear?.()
  resetTrustDialogAcceptedCacheForTesting()

  // Host-managed provider env strips when claim marks CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST.
  const isHostManaged = isEnvTruthy(
    claim.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST,
  )
  if (isHostManaged) {
    applyHostManagedSpareEnv(process.env)
    applySpareProviderStrips(process.env)
    for (const key of HOST_MANAGED_EXTRA_STRIP_KEYS) {
      delete process.env[key]
    }
  }

  // Always strip host auth tokens and drop stale OAuth scopes (#389).
  const prevEnv = { ...process.env }
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  stripOAuthScopesIfTokenRemoved(prevEnv, process.env)

  // Federation/profile strips when session carries CLAUDE_BG_SESSION_CREDENTIAL.
  if (claim.env.CLAUDE_BG_SESSION_CREDENTIAL) {
    for (const key of SPARE_FEDERATION_STRIP_KEYS) {
      delete process.env[key]
    }
  }

  // Unset spare-only/host-only watch/event flags.
  delete process.env.CLAUDE_CODE_CONFIG_WATCH_EVENTS
  delete process.env.CLAUDE_CODE_WITHHOLD_PRODUCT_EVENTS
  delete process.env.CLAUDE_BG_SOCK_ADMIT_SILENT_PEERS

  // Filter NUL-in-value, invalid names, non-string values, and loader/shell injection keys.
  const { kept, dropped } = filterClaimEnv(claim.env)
  Object.assign(process.env, kept)
  if (dropped.length > 0) {
    logDroppedClaimEnv(dropped)
  }

  // Clear MDM, settings, auth, CA/mTLS, and GrowthBook caches after applying claimed env.
  clearMdmSettingsCache()
  resetSettingsCache()
  resetFdCredentialState()
  clearOAuthTokenCache()
  clearApiKeyHelperCache()
  clearAwsCredentialsCache()
  clearAwsCredentialExportCache()
  clearGcpCredentialsCache()
  clearOtelHeadersCache()
  clearMTLSCache({ clearFileCache: true })
  clearCACertsCache()
  resetGrowthBook({
    preservePendingExposures: true,
    preserveLoggedExposures: true,
  })

  process.argv = [process.argv[0]!, process.argv[1]!, ...claim.argv]
  const { main } = await mainImport
  await main()
}

/**
 * Official HmO / runBgSpare.
 */
export async function runBgSpare(args: string[]): Promise<void> {
  const claimSock = args[0]
  if (!claimSock) {
    process.stderr.write('[bg-spare] missing claim sock path\n')
    process.exit(2)
  }

  // Prefetch main while waiting for claim (official: q=Promise.resolve().then(main))
  // Use main.jsx like cli.tsx full path (same module).
  const mainImport = import('../main.jsx') as Promise<{
    main: () => Promise<void>
  }>

  const cleanupSock = (): void => {
    try {
      unlinkSync(claimSock)
    } catch {
      // missing is fine
    }
  }
  const exitClean = (): void => {
    cleanupSock()
    process.exit(0)
  }
  const onUncaught = (err: unknown): void => {
    cleanupSock()
    process.stderr.write(`[bg-spare] uncaughtException: ${errorMessage(err)}\n`)
    process.exit(1)
  }

  // Parent-death poll (official: ppid check every 2s) — win32 has no ppid stability.
  const parentPid = process.ppid
  const parentWatch = setInterval(() => {
    if (process.ppid !== parentPid) {
      cleanupSock()
      process.exit(0)
    }
  }, 2000)
  parentWatch.unref()

  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) {
    process.on(sig, exitClean)
  }
  process.on('uncaughtException', onUncaught)

  const detachSignals = (): void => {
    clearInterval(parentWatch)
    for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) {
      process.off(sig, exitClean)
    }
    process.off('uncaughtException', onUncaught)
  }

  let claim: BgSpareClaimFrame
  try {
    // Local product: spare host carries SPARE_CLAIM_NONCE_ENV from supervisor.
    const expectedNonce = process.env[SPARE_CLAIM_NONCE_ENV]
    claim = await recvSpareClaim(
      claimSock,
      undefined,
      expectedNonce || undefined,
    )
  } catch (err) {
    cleanupSock()
    process.stderr.write(`[bg-spare] claim recv failed: ${errorMessage(err)}\n`)
    process.exit(1)
  }

  detachSignals()

  try {
    await mainImport
    await applySpareClaimAndRunMain(claim, mainImport)
  } catch (err) {
    process.stderr.write(
      `[bg-spare] post-claim init failed: ${errorMessage(err)}\n`,
    )
    throw err
  }
}

// ---------------------------------------------------------------------------
// Supervisor spare pool — official M3q / D3q / f3q / _mO / TmO
// ---------------------------------------------------------------------------

/** Official GG4 — send-claim connect backoff (ms). */
const SEND_CLAIM_BACKOFFS = [50, 100, 150, 200, 250, 300, 400, 500, 500, 500]

/** Official held spare handle (Y). */
export type HeldSpare = {
  hostPid: number
  ptySock: string
  claimSock: string
  startedAt: number
  cliVersion: string
  /** Local product: nonce embedded in spare host env + claim frame. */
  claimNonce: string
  /** Per-spare PTY auth token passed via CLAUDE_BG_PTY_AUTH to ptyHost. */
  ptyAuthToken?: string
  dispose(): void
}

/** Official gvK / QvK. */
export function getSparePtySockPath(id: string): string {
  return join(getSpareDir(), `${id}.pty.sock`)
}

export function getSpareClaimSockPath(id: string): string {
  return join(getSpareDir(), `${id}.claim.sock`)
}

/**
 * Official jy6 — low-mem threshold in bytes.
 * macOS: always 0 (disabled). Else GB `tengu_bg_low_mem_mb` default 1024 MB.
 */
export function getBgLowMemThresholdBytes(): number {
  if (process.platform === 'darwin') return 0
  const mb =
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_bg_low_mem_mb', 1024) ?? 1024
  const n = typeof mb === 'number' ? mb : Number(mb)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n * 1024 * 1024
}

export function isBgLowMem(): boolean {
  const threshold = getBgLowMemThresholdBytes()
  return threshold > 0 && freemem() < threshold
}

/** Official _mO — env for spare host process. */
export function buildSpareHostEnv(opts?: {
  claimNonce?: string
  ptyAuthToken?: string
}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  // densable os() We/pe/Ge, then RO (BASE_URL still visible), then wt.
  applySpareSessionStrips(env)
  applyHostManagedSpareEnv(env)
  applySpareProviderStrips(env)
  // Official: strip OAuth on macOS (auth snapshot path used on claim).
  if (process.platform === 'darwin') {
    delete env.CLAUDE_CODE_OAUTH_TOKEN
  }
  // Official 2.1.327 (#389): strip CLAUDE_CODE_OAUTH_SCOPES whenever OAuth token was removed.
  stripOAuthScopesIfTokenRemoved(process.env, env)
  Object.assign(env, restrictedSpawnEnv(), {
    CLAUDE_CODE_SESSION_KIND: 'bg',
    CLAUDE_BG_SOURCE: 'spare',
    CLAUDE_BG_BACKEND: 'daemon',
    CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
    FORCE_COLOR: '3',
    COLORTERM: 'truecolor',
    BROWSER: 'true',
  })
  // Local product: bind claim sock to supervisor-issued nonce.
  if (opts?.claimNonce) {
    env[SPARE_CLAIM_NONCE_ENV] = opts.claimNonce
  }
  // Authenticate the spare PTY host socket with a per-spare token.
  if (opts?.ptyAuthToken) {
    env.CLAUDE_BG_PTY_AUTH = opts.ptyAuthToken
  }
  return env
}

/**
 * Official TmO — binary argv prefix for spare spawn (no runtime -d flags).
 * Prefer getBinaryPath pin semantics via isInBundledMode.
 */
export function getSpareBinaryArgv(): string[] {
  if (isInBundledMode()) {
    return [process.execPath]
  }
  const argv1 = process.argv[1]
  if (!argv1) return [process.execPath]
  return [process.execPath, argv1]
}

/**
 * Official M3q — spawn one pre-warmed spare (pty-host + nested --bg-spare).
 * Returns null on Windows (official: spare disabled).
 */
export async function spawnSpare(opts: {
  log: (msg: string) => void
  onExit: () => void
}): Promise<HeldSpare | null> {
  if (process.platform === 'win32') return null

  const id = randomBytes(4).toString('hex')
  const claimNonce = randomBytes(16).toString('hex')
  const ptyAuthToken = mintPtyAuthToken()
  const ptySock = getSparePtySockPath(id)
  const claimSock = getSpareClaimSockPath(id)
  const spareDir = getSpareDir()

  await mkdir(spareDir, { recursive: true, mode: 0o700 }).catch(() => {})
  await unlink(ptySock).catch(() => {})
  await unlink(claimSock).catch(() => {})

  const bin = getSpareBinaryArgv()
  // Official argv shape: [cmd,...,--bg-pty-host,pty,200,50,--,cmd,...,--bg-spare,claim] (spawned via node:child_process)
  const spawnArgv = [
    ...bin,
    '--bg-pty-host',
    ptySock,
    '200',
    '50',
    '--',
    ...bin,
    '--bg-spare',
    claimSock,
  ]

  const child = nodeSpawn(spawnArgv[0]!, spawnArgv.slice(1), {
    cwd: spareDir,
    env: buildSpareHostEnv({ claimNonce, ptyAuthToken }) as NodeJS.ProcessEnv,
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
    windowsHide: true,
  })
  const exited = new Promise<void>(resolve => {
    child.once('error', () => resolve())
    child.once('exit', () => resolve())
  })
  child.unref()

  if (child.pid == null) {
    throw new Error('bg spare spawned host has no pid')
  }

  const hostPid = child.pid

  const held: HeldSpare = {
    hostPid,
    ptySock,
    claimSock,
    startedAt: Date.now(),
    cliVersion: MACRO.VERSION,
    claimNonce,
    ptyAuthToken,
    dispose() {
      try {
        child.kill('SIGTERM')
      } catch {
        // already gone
      }
    },
  }

  void exited.then(() => {
    void unlink(ptySock).catch(() => {})
    void unlink(claimSock).catch(() => {})
    void unlink(getPtyErrPath(ptySock)).catch(() => {})
    opts.onExit()
  })

  opts.log(`bg spare spawned host pid=${hostPid}`)
  return held
}

/**
 * Official zF.buildClaimFrame — thin re-export of BgWorker.buildClaimFrame.
 */
export function buildClaimFrame(
  dispatch: DispatchRequest,
  authPath?: string,
): { env: Record<string, string | undefined>; argv: string[] } {
  return BgWorker.buildClaimFrame(dispatch, authPath)
}

/**
 * Official iqq — auth snapshot for claim is macos-only.
 * Non-darwin: return undefined (OAuth stays in process env of claimed worker).
 */
async function writeClaimAuthSnapshot(
  short: string,
  getAuth?: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (!getAuth || process.platform !== 'darwin') return undefined
  try {
    const token = await getAuth()
    if (!token) return undefined
    const dir = getAuthDir()
    await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {})
    const path = join(dir, `${short}.json`)
    // Local getAuthSnapshot returns a string; write raw (cold path parity).
    await writeFile(path, token, { mode: 0o600 })
    return path
  } catch {
    return undefined
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms)
    t.unref?.()
  })
}

function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    return typeof c === 'string' ? c : undefined
  }
  return undefined
}

/** Official OmO — single connect + write JSON line. */
function sendClaimOnce(
  claimSock: string,
  frame: BgSpareClaimFrame,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(claimSock)
    sock.once('error', reject)
    sock.once('connect', () => {
      sock.end(`${JSON.stringify(frame)}\n`, () => resolve())
    })
  })
}

/**
 * Official KmO — retry send-claim up to 5s on ENOENT/ECONNREFUSED.
 */
export async function sendClaim(
  claimSock: string,
  frame: BgSpareClaimFrame,
): Promise<void> {
  const started = Date.now()
  for (let i = 0; ; i++) {
    if (Date.now() - started > 5000) {
      throw new Error('send-claim timeout')
    }
    try {
      await sendClaimOnce(claimSock, frame)
      return
    } catch (err) {
      const code = errnoCode(err)
      if (
        !(code === 'ENOENT' || code === 'ECONNREFUSED') ||
        i >= SEND_CLAIM_BACKOFFS.length
      ) {
        throw err
      }
      await sleep(SEND_CLAIM_BACKOFFS[i] ?? 500)
    }
  }
}

function killSparePty(ptySock: string, ptyAuthToken?: string): void {
  const sock = createConnection(ptySock)
  sock.on('error', () => {})
  sock.once('connect', () => {
    if (ptyAuthToken) {
      sock.write(encodeCtrlFrame({ t: 'auth', token: ptyAuthToken }))
    }
    sock.write(encodeCtrlFrame({ t: 'kill', sig: 'SIGTERM' }))
    sock.end()
  })
}

/**
 * Claim held spare into a BgWorker **after** send-claim succeeds.
 *
 * densable sWa (gold 2.1.211):
 *   t.claimed=!0
 *   o = eue.claim(...)          // BgWorker.claim first
 *   return lxs(...).then(qlT)   // fire-and-forget sendClaim
 *     .catch(kill pty); return o
 * Dispatch registers o.set(short, ie) **synchronously** before sendClaim
 * finishes — oAp always sees a handle+pid. On sendClaim fail gold only
 * kills spare PTY; handle may already be acked (ghost left-arrow job).
 *
 * Local product (intentional ≠ densable):
 *   1. await sendClaim (qlT up to ~5s retries)
 *   2. only then BgWorker.claim; bgManager handles.set after resolve
 *   3. on failure: kill spare PTY, throw → cold spawn
 *   4. claimingShorts occupies short while awaiting so oAp/dup dispatch
 *      do not race empty handles (product stand-in for gold early set)
 */
export async function claimSpare(
  dispatch: DispatchRequest,
  spare: HeldSpare,
  spawnPty: SpawnPtyFn,
  getAuthSnapshot?: () => Promise<string | undefined>,
): Promise<BgWorker> {
  try {
    const authPath = await writeClaimAuthSnapshot(
      dispatch.short,
      getAuthSnapshot,
    )
    const { env, argv } = BgWorker.buildClaimFrame(dispatch, authPath)
    const stringEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined) stringEnv[k] = v
    }
    const frame: BgSpareClaimFrame = {
      cwd: dispatch.cwd,
      env: stringEnv,
      argv,
      sessionId: dispatch.sessionId,
      // Local product: prove claim came from the supervisor that spawned spare.
      nonce: spare.claimNonce,
    }
    await sendClaim(spare.claimSock, frame)
  } catch (err: unknown) {
    // densable: tengu_bg_sendclaim_failed + kill spare pty
    const msg = errorMessage(err)
    logEvent('tengu_bg_sendclaim_failed', {})
    console.warn(
      `[bg-spare] send-claim failed: short=${dispatch.short} errno=${errnoCode(err) ?? ''} ${msg.slice(0, 100)}`,
    )
    killSparePty(spare.ptySock, spare.ptyAuthToken)
    throw err
  }

  return BgWorker.claim(dispatch, {
    pid: spare.hostPid,
    ptySockPath: spare.ptySock,
    ptyAuthToken: spare.ptyAuthToken,
    spawnPty,
    getAuthSnapshot,
  })
}

/**
 * Official f3q — reap roster-less spare pty socks + claim socks.
 * Windows: no-op.
 *
 * densable claim.sock rule: only unlink when the paired `{id}.pty.sock` is
 * **not** in the known roster set. Local previously unlinked every
 * `*.claim.sock`, which could yank a live held spare's listening claim sock
 * during adopt/startup reap.
 */
export async function reapOrphanSpares(
  handles: Map<string, BgWorker>,
  log: (msg: string) => void,
  /**
   * Optional live held-spare socks (not yet in roster). When provided, those
   * pty/claim paths are treated as known and never reaped.
   */
  extraKnownPtySocks?: Iterable<string>,
  /**
   * Optional per-socket PTY auth token map (persisted across supervisor restarts)
   * used to authenticate `{ t: 'kill' }` frames sent to orphan spare PTY hosts.
   */
  ptyAuthBySock?: Map<string, string>,
): Promise<void> {
  if (process.platform === 'win32') return

  const knownSocks = new Set<string>()
  for (const w of handles.values()) {
    const entry = w.rosterEntry()
    if (entry.ptySock) knownSocks.add(entry.ptySock)
  }
  if (extraKnownPtySocks) {
    for (const s of extraKnownPtySocks) knownSocks.add(s)
  }

  const spareDir = getSpareDir()
  let files: string[]
  try {
    files = await readdir(spareDir)
  } catch {
    return
  }

  let reaped = 0
  for (const file of files) {
    if (!file.endsWith('.pty.sock')) continue
    const sockPath = join(spareDir, file)
    if (knownSocks.has(sockPath)) continue
    reaped++
    // Capture auth token synchronously before async connect so post-reap pruning
    // cannot race with the connect callback.
    const authToken = ptyAuthBySock?.get(sockPath)
    const sock = createConnection(sockPath)
    sock.on('error', () => {
      ptyAuthBySock?.delete(sockPath)
      void unlink(sockPath).catch(() => {})
    })
    sock.once('connect', () => {
      sock.resume()
      if (authToken) {
        sock.write(encodeCtrlFrame({ t: 'auth', token: authToken }))
      }
      sock.write(encodeCtrlFrame({ t: 'kill', sig: 'SIGTERM' }))
      sock.end()
      setTimeout((s: typeof sock) => s.destroy(), 2000, sock).unref()
    })
  }

  const sideJobs: Promise<unknown>[] = []
  for (const file of files) {
    // densable: side-car .err/.late/.err.read without base .pty.sock
    const side = ['.err', '.late', '.err.read'].find(s =>
      file.endsWith(`.pty.sock${s}`),
    )
    if (side) {
      const base = file.slice(0, -side.length)
      if (!files.includes(base)) {
        sideJobs.push(unlink(join(spareDir, file)).catch(() => {}))
      }
    }
    // densable: only unlink claim.sock when paired pty.sock is not known live
    if (file.endsWith('.claim.sock')) {
      // `${id}.claim.sock` → `${id}.pty.sock` (strip `.claim.sock` = 11 chars)
      const pairedPty = join(spareDir, `${file.slice(0, -11)}.pty.sock`)
      if (!knownSocks.has(pairedPty)) {
        sideJobs.push(unlink(join(spareDir, file)).catch(() => {}))
      }
    }
  }
  if (sideJobs.length) await Promise.all(sideJobs)

  if (reaped) log(`bg orphan-spare reap: ${reaped}`)
}
