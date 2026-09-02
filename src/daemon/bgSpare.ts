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

import { randomBytes } from 'crypto'
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
import { encodeCtrlFrame } from './ptyHost.js'
import { logEvent } from '../services/analytics/index.js'
import {
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
  switchSession,
} from '../bootstrap/state.js'
import { asSessionId } from '../types/ids.js'
import { errorMessage } from '../utils/errors.js'
import { isInBundledMode } from '../utils/bundledMode.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

// ---------------------------------------------------------------------------
// Claim frame (host side) — official b64
// ---------------------------------------------------------------------------

export type BgSpareClaimFrame = {
  cwd: string
  env: Record<string, string>
  argv: string[]
  sessionId?: string
  /**
   * Local product: must match CLAUDE_BG_SPARE_CLAIM_NONCE on spare host.
   * densable has no claim auth; this blocks casual cross-process claim.
   */
  nonce?: string
}

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

/**
 * Filter claim.env before Object.assign — drop deny-list + non-string values.
 * densable assigns whole e.env after stripping host-managed auth; we keep that
 * shape for CLAUDE_* worker keys but refuse loader/shell injection keys.
 */
export function sanitizeClaimEnv(
  env: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue
    if (CLAIM_ENV_DENY.has(k)) continue
    if (k.startsWith('LD_') || k.startsWith('DYLD_')) continue
    out[k] = v
  }
  return out
}

/**
 * Listen once on claimSock; resolve with first newline-delimited JSON object.
 * Official b64 + local nonce check when expectedNonce is set.
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
        const nl = buf.indexOf('\n')
        if (nl < 0) return
        server.close()
        try {
          const parsed: unknown = JSON.parse(buf.slice(0, nl))
          if (!isClaimFrame(parsed)) {
            fail(new Error('invalid claim frame'))
            return
          }
          if (expectedNonce) {
            if (parsed.nonce !== expectedNonce) {
              fail(new Error('claim nonce mismatch'))
              return
            }
          }
          resolve(parsed)
        } catch (err) {
          fail(err)
        }
      })
      socket.on('error', fail)
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

/**
 * Official x64 — apply claim frame then enter main().
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
  // densable: strip host auth tokens then Object.assign(process.env, e.env).
  // Product: also deny loader/shell injection keys from claim.env.
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  Object.assign(process.env, sanitizeClaimEnv(claim.env))
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

/** Official rqq — env keys stripped from spare host env. */
const SPARE_STRIP_ENV_KEYS = [
  'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT',
  'GITHUB_ACTIONS',
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_COORDINATOR_MODE',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  '__CFBundleIdentifier',
  'KITTY_WINDOW_ID',
  'WT_SESSION',
  'KONSOLE_VERSION',
  'VTE_VERSION',
  'ZED_TERM',
  'ZELLIJ',
  'TMUX',
  'TMUX_PANE',
  'STY',
  'LC_TERMINAL',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'SSH_TTY',
  'COLORFGBG',
  'CURSOR_TRACE_ID',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  'VSCODE_GIT_ASKPASS_MAIN',
  'VSCODE_GIT_ASKPASS_NODE',
  'VSCODE_GIT_ASKPASS_EXTRA_ARGS',
  'VSCODE_GIT_IPC_HANDLE',
  'TERMINAL_EMULATOR',
  'ITERM_SESSION_ID',
  'GNOME_TERMINAL_SERVICE',
  'XTERM_VERSION',
  'ALACRITTY_LOG',
  'TILIX_ID',
  'TERMINATOR_UUID',
  'ConEmuANSI',
  'ConEmuPID',
  'ConEmuTask',
  'MSYSTEM',
  'CLAUDE_CODE_SSE_PORT',
  'FORCE_CODE_TERMINAL',
] as const

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
}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of SPARE_STRIP_ENV_KEYS) {
    delete env[key]
  }
  // Official: strip OAuth on macOS (auth snapshot path used on claim).
  if (process.platform === 'darwin') {
    delete env.CLAUDE_CODE_OAUTH_TOKEN
  }
  Object.assign(env, {
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
  const ptySock = getSparePtySockPath(id)
  const claimSock = getSpareClaimSockPath(id)
  const spareDir = getSpareDir()

  await mkdir(spareDir, { recursive: true, mode: 0o700 }).catch(() => {})
  await unlink(ptySock).catch(() => {})
  await unlink(claimSock).catch(() => {})

  const bin = getSpareBinaryArgv()
  // Official: Bun.spawn([cmd,...,--bg-pty-host,pty,200,50,--,cmd,...,--bg-spare,claim])
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

  const child = Bun.spawn(spawnArgv, {
    cwd: spareDir,
    env: buildSpareHostEnv({ claimNonce }),
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
    windowsHide: true,
  })
  child.unref()

  const held: HeldSpare = {
    hostPid: child.pid,
    ptySock,
    claimSock,
    startedAt: Date.now(),
    cliVersion: MACRO.VERSION,
    claimNonce,
    dispose() {
      try {
        child.kill('SIGTERM')
      } catch {
        // already gone
      }
    },
  }

  void child.exited.then(() => {
    void unlink(ptySock).catch(() => {})
    void unlink(claimSock).catch(() => {})
    void unlink(getPtyErrPath(ptySock)).catch(() => {})
    opts.onExit()
  })

  opts.log(`bg spare spawned host pid=${child.pid}`)
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

function killSparePty(ptySock: string): void {
  const sock = createConnection(ptySock)
  sock.on('error', () => {})
  sock.once('connect', () => {
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
    killSparePty(spare.ptySock)
    throw err
  }

  return BgWorker.claim(dispatch, {
    pid: spare.hostPid,
    ptySockPath: spare.ptySock,
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
    const sock = createConnection(sockPath)
    sock.on('error', () => {
      void unlink(sockPath).catch(() => {})
    })
    sock.once('connect', () => {
      sock.resume()
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
