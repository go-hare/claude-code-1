import type { ChildProcess, ExecFileException } from 'child_process'
import { execFile, spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import * as path from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { isInBundledMode } from './bundledMode.js'
import { logForDebugging } from './debug.js'
import { distRoot } from './distRoot.js'
import { isEnvDefinedFalsy } from './envUtils.js'
import {
  getErrnoCode,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from './errors.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { findExecutable } from './findExecutable.js'
import { logError } from './log.js'
import { getPlatform } from './platform.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'
import { countCharInString, truncateCodeUnitsSafe } from './stringUtils.js'
import { internalToolSubprocessEnv } from './subprocessEnv.js'

type HostMemoized<Args extends unknown[], Result> = ((
  ...args: Args
) => Result) & {
  cache: Map<unknown, Result>
}

function memoizePerHost<Args extends unknown[], Result, Key = Args[0]>(
  fn: (...args: Args) => Result,
  resolver?: (...args: Args) => Key,
): HostMemoized<Args, Result> {
  const slot = new HostSlot<{ cache: Map<unknown, Result> }>(() => ({
    cache: new Map<unknown, Result>(),
  }))
  const memoized = (...args: Args): Result => {
    const key = resolver ? resolver(...args) : args[0]
    const cache = slot.of(getBootstrapSessionHost()).cache
    if (cache.has(key)) {
      return cache.get(key) as Result
    }
    const result = fn(...args)
    cache.set(key, result)
    return result
  }
  Object.defineProperty(memoized, 'cache', {
    get: () => slot.of(getBootstrapSessionHost()).cache,
    set: (next: Map<unknown, Result>) => {
      slot.of(getBootstrapSessionHost()).cache = next
    },
    configurable: true,
    enumerable: true,
  })
  return memoized as unknown as HostMemoized<Args, Result>
}

const __dirname = (() => {
  if (process.env.NODE_ENV === 'test') return path.resolve(distRoot)
  return distRoot
})()

type RipgrepConfig = {
  mode: 'system' | 'builtin' | 'embedded'
  command: string
  args: string[]
  argv0?: string
  note?: string
}

function getRipgrepPlatformDir(): string {
  return process.platform === 'win32'
    ? `${process.arch}-win32`
    : `${process.arch}-${process.platform}`
}

function getRipgrepBinaryName(): string {
  return process.platform === 'win32' ? 'rg.exe' : 'rg'
}

function getPlatformPackageSuffix(): string | undefined {
  if (process.platform === 'darwin') return `darwin-${process.arch}`
  if (process.platform === 'win32') return `win32-${process.arch}`
  if (process.platform === 'linux') return `linux-${process.arch}`
  return undefined
}

function getBuiltinRipgrepCandidates(): string[] {
  const platformDir = getRipgrepPlatformDir()
  const binaryName = getRipgrepBinaryName()
  const execDir = path.dirname(process.execPath)
  const packageRoot = path.dirname(execDir)
  const packageParent = path.dirname(packageRoot)
  const candidates = [
    path.resolve(distRoot, 'vendor', 'ripgrep', platformDir, binaryName),
    path.resolve(
      distRoot,
      'src',
      'utils',
      'vendor',
      'ripgrep',
      platformDir,
      binaryName,
    ),
    path.resolve(__dirname, 'vendor', 'ripgrep', platformDir, binaryName),
    path.resolve(execDir, 'vendor', 'ripgrep', platformDir, binaryName),
    path.resolve(packageRoot, 'vendor', 'ripgrep', platformDir, binaryName),
  ]
  const suffix = getPlatformPackageSuffix()

  if (suffix) {
    const platformPkg = `claude-code-${suffix}`
    candidates.push(
      path.resolve(
        packageRoot,
        'node_modules',
        '@go-hare',
        platformPkg,
        'vendor',
        'ripgrep',
        platformDir,
        binaryName,
      ),
      path.resolve(
        packageParent,
        platformPkg,
        'vendor',
        'ripgrep',
        platformDir,
        binaryName,
      ),
      path.resolve(
        packageParent,
        '@go-hare',
        platformPkg,
        'vendor',
        'ripgrep',
        platformDir,
        binaryName,
      ),
    )
  }

  return [...new Set(candidates)]
}

export function resolveBundledRipgrep(
  builtinPaths: string[],
  platform: NodeJS.Platform = process.platform,
  executablePath: string = process.execPath,
  systemRgPath?: string | null,
): RipgrepConfig {
  if (platform === 'win32') {
    return resolveBuiltinWithFallback(builtinPaths, systemRgPath, platform)
  }

  return {
    mode: 'embedded',
    command: executablePath,
    args: ['--no-config'],
    argv0: 'rg',
  }
}

function readRipgrepVersion(command: string): string | null {
  try {
    const r = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      env: internalToolSubprocessEnv(),
    })
    if (r.status !== 0) return null
    const match = (r.stdout ?? '').match(/^ripgrep (\d+\.\d+\.\d+)/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function isRipgrep14_1(version: string | null): boolean {
  return version !== null && version.startsWith('14.1.')
}

export const getRipgrepConfig = memoizePerHost((): RipgrepConfig => {
  const userWantsSystemRipgrep = isEnvDefinedFalsy(
    process.env.USE_BUILTIN_RIPGREP,
  )

  // Local gold pin: prefer already-installed ripgrep 14.1.x (SEA embed).
  // Do not download 14.1.1 — vendor 15 stays when 14.1 is absent.
  if (!userWantsSystemRipgrep) {
    const { cmd: goldSystem } = findExecutable('rg', [])
    if (goldSystem !== 'rg') {
      const ver = readRipgrepVersion('rg')
      if (isRipgrep14_1(ver)) {
        return {
          mode: 'system',
          command: 'rg',
          args: [],
          note: `local gold pin: system ripgrep ${ver}`,
        }
      }
    }
  }

  // Try system ripgrep if user wants it
  if (userWantsSystemRipgrep) {
    const { cmd: systemPath } = findExecutable('rg', [])
    if (systemPath !== 'rg') {
      // SECURITY: Use command name 'rg' instead of systemPath to prevent PATH hijacking
      // If we used systemPath, a malicious ./rg.exe in current directory could be executed
      // Using just 'rg' lets the OS resolve it safely with NoDefaultCurrentDirectoryInExePath protection
      return { mode: 'system', command: 'rg', args: [] }
    }
  }

  // Git Bash cannot reliably set argv[0] for a Windows Bun executable. Prefer
  // the packaged rg.exe there so an `rg` command cannot start a full Claude
  // process. Other bundled platforms retain Bun's embedded dispatch.
  if (isInBundledMode()) {
    return resolveBundledRipgrep(getBuiltinRipgrepCandidates())
  }

  return resolveBuiltinWithFallback(getBuiltinRipgrepCandidates())
})

/**
 * Pure function: decide what to do when the builtin rg binary may be missing.
 * Extracted so it can be tested without any module mocking.
 *
 * @param builtinPath  Path to the vendored rg binary.
 * @param systemRgPath  When omitted, calls `findExecutable('rg')` (production path).
 *                     Pass a string to force a specific system path, or `null` to
 *                     simulate "system rg not found".
 * @param platform     Override for `process.platform` (tests only).
 */
export function resolveBuiltinWithFallback(
  builtinPath: string | string[],
  systemRgPath?: string | null,
  platform?: string,
): {
  mode: 'system' | 'builtin'
  command: string
  args: string[]
  note?: string
} {
  const p = platform ?? process.platform
  const builtinPaths = Array.isArray(builtinPath) ? builtinPath : [builtinPath]

  // Builtin exists — use it, no note.
  const existingBuiltinPath = builtinPaths.find(path => existsSync(path))
  if (existingBuiltinPath) {
    return { mode: 'builtin', command: existingBuiltinPath, args: [] }
  }

  // Builtin missing — check system rg.
  // When systemRgPath is explicitly passed (including null), use it directly.
  // When undefined, call findExecutable (production path).
  const resolvedSystem =
    systemRgPath === undefined
      ? findExecutable('rg', []).cmd
      : (systemRgPath ?? 'rg')
  if (resolvedSystem !== 'rg') {
    return {
      mode: 'system',
      command: 'rg',
      args: [],
      note: `fallback: builtin rg unavailable on ${p}, using system rg`,
    }
  }

  // Neither available.
  return {
    mode: 'builtin',
    command: builtinPaths[0],
    args: [],
    note: `no ripgrep available on ${p}; install ripgrep via apt/pkg/brew`,
  }
}

export function ripgrepCommand(): {
  rgPath: string
  rgArgs: string[]
  argv0?: string
} {
  const config = getRipgrepConfig()
  return {
    rgPath: config.command,
    rgArgs: config.args,
    argv0: config.argv0,
  }
}

const MAX_BUFFER_SIZE = 20_000_000 // 20MB; large monorepos can have 200k+ files

/**
 * Check if an error is EAGAIN (resource temporarily unavailable).
 * This happens in resource-constrained environments (Docker, CI) when
 * ripgrep tries to spawn too many threads.
 */
function isEagainError(stderr: string): boolean {
  return (
    stderr.includes('os error 11') ||
    stderr.includes('Resource temporarily unavailable')
  )
}

/**
 * Custom error class for ripgrep timeouts.
 * This allows callers to distinguish between "no matches" and "timed out".
 */
export class RipgrepTimeoutError extends Error {
  constructor(
    message: string,
    public readonly partialResults: string[],
  ) {
    super(message)
    this.name = 'RipgrepTimeoutError'
  }
}

/**
 * densable iaT — stderr prefixes that mean ripgrep rejected the input
 * (bad regex / glob / type / flag / compiled size) without searching.
 */
export const RIPGREP_INPUT_ERROR_RE =
  /^rg: (?:regex parse error|error parsing glob|unrecognized file type|error parsing flag|compiled regex exceeds size limit)/m

export type RipGrepOptions = {
  /** densable rejectOnInputError — throw RipgrepUsageError on exit 2 + iaT stderr. */
  rejectOnInputError?: boolean
  /** Official rejectOnPartial (#1570) — reject with RipgrepTimeoutError on partial/truncated/timed-out output. */
  rejectOnPartial?: boolean
  /** Optional spawn/exec cwd (densable f1e/qTm `cwd`). */
  cwd?: string
}

/**
 * densable YTm / RipgrepUsageError — fail fast when rg rejects the pattern/glob/type.
 * Extends TelemetrySafeError so toolExecution uses the vetted telemetryMessage.
 */
export class RipgrepUsageError extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor(stderr: string) {
    super(
      `Search failed — ripgrep rejected the pattern, glob, or file type without searching:\n${truncateCodeUnitsSafe(stderr.trim(), 2000)}`,
      'ripgrep usage error (input rejected, stderr redacted)',
    )
    this.name = 'RipgrepUsageError'
  }
}

const DO_NOT_FALLBACK_SHELL =
  'Do not run a recursive search in the shell instead (for example grep -r, find or rg)'

const POSIX_EPERM = 1
const POSIX_ENOENT = 2
const POSIX_EIO = 5
const POSIX_EACCES = 13
const POSIX_ENOTDIR = 20
const WIN_ERROR_FILE_NOT_FOUND = 2
const WIN_ERROR_PATH_NOT_FOUND = 3
const WIN_ERROR_ACCESS_DENIED = 5
const PROC_SELF_FD_3 = '/proc/self/fd/3'
const DEFAULT_MAX_BUFFER_BYTES = 20 * 1024 * 1024

/**
 * SEA `RW` — ripgrep exited 2 because it could not read the target path
 * (permission denied, I/O error, etc.).
 */
export class RipgrepTargetUnreadableError extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor(osError: number) {
    const isWindows = getPlatform() === 'windows'
    const isPermission = isWindows
      ? osError === WIN_ERROR_ACCESS_DENIED
      : osError === POSIX_EACCES || osError === POSIX_EPERM
    const reason = isPermission
      ? 'permission denied'
      : !isWindows && osError === POSIX_EIO
        ? 'input/output error'
        : !isWindows && osError === POSIX_ENOENT
          ? 'the file Claude Code opened was not passed to ripgrep'
          : 'an operating system error'
    const advice = isPermission
      ? `Tell the user that the path could not be read. ${DO_NOT_FALLBACK_SHELL}.`
      : `Run the search once more. If it fails again, tell the user that the search is failing. ${DO_NOT_FALLBACK_SHELL}: it can also reach other files, which this tool is set to leave out.`
    super(
      `Search failed: ripgrep could not read the path it was given (${reason}, os error ${osError}), so nothing was searched. This is not a "no matches" result. ${advice}`,
      'ripgrep could not read its target',
    )
    this.name = 'RipgrepTargetUnreadableError'
  }
}

/**
 * SEA `AW` — ripgrep exited abnormally with no results under rejectOnInputError.
 */
export class RipgrepAbnormalExitError extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor() {
    super(
      'The search failed, so this is not a "no matches" result: matches may exist. What happened to the search program (ripgrep) is not known, and no results were read. Run the search once more. If it fails again, tell the user that searches are failing. Do not run a recursive search in the shell instead (for example grep -r, find or rg): it can reach what this tool is set to leave out.',
      'ripgrep unexpected exit with no results',
    )
    this.name = 'RipgrepAbnormalExitError'
  }
}

/**
 * SEA `kW` — ripgrep exceeded maxBuffer before a single complete line was read.
 */
export class RipgrepOutputTooLargeError extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor(stream: 'stdout' | 'stderr') {
    const capMb = DEFAULT_MAX_BUFFER_BYTES / 1e6
    super(
      stream === 'stdout'
        ? `Ripgrep output passed the ${capMb}MB limit before a single complete line was read, so there are no usable results: at least one matching line is extremely long. Try a more specific pattern or path, or exclude very large files.`
        : `Ripgrep produced more than ${capMb}MB of error output (for example per-file permission warnings) before any result line, so the search is incomplete. Try a more specific path.`,
      'ripgrep output over cap before first complete line',
    )
    this.name = 'RipgrepOutputTooLargeError'
  }
}

const SPAWN_RESOURCE_CODES = new Set(['EAGAIN', 'ENOMEM', 'EMFILE', 'ENFILE'])
const SPAWN_RESOURCE_MESSAGES = new Map<
  string,
  { reason: string; advice: string }
>([
  [
    'EAGAIN',
    {
      reason: 'a limit on processes or threads was reached',
      advice:
        'this machine has reached a limit on processes; closing other programs can help',
    },
  ],
  [
    'ENOMEM',
    {
      reason: 'there is not enough memory',
      advice:
        'this machine is short of memory; closing other programs can help',
    },
  ],
  [
    'EMFILE',
    {
      reason: 'this Claude Code process has too many files open',
      advice: 'Claude Code needs a restart',
    },
  ],
  [
    'ENFILE',
    {
      reason: 'the system has too many files open',
      advice:
        'this machine has too many files open; closing other programs can help',
    },
  ],
])
const DEFAULT_SPAWN_RESOURCE_MSG = {
  reason: 'the system ran out of a resource',
  advice: 'this machine is short of a resource needed to start programs',
}

/**
 * SEA `Uh` — ripgrep could not start due to OS resource exhaustion.
 */
export class RipgrepSpawnResourceError extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor(code: string) {
    const { reason, advice } =
      SPAWN_RESOURCE_MESSAGES.get(code) ?? DEFAULT_SPAWN_RESOURCE_MSG
    super(
      `ripgrep could not start, so nothing was searched and matches may still exist: the operating system could not start it because ${reason} (${code}). Retry in a moment. If it keeps failing, tell the user that ${advice}.`,
      'ripgrep not started: the OS could not create another process',
    )
    this.name = 'RipgrepSpawnResourceError'
  }

  static from(
    err: unknown,
    rejectOnInputError?: boolean,
  ): RipgrepSpawnResourceError | undefined {
    if (!rejectOnInputError) return undefined
    const code = getErrnoCode(err)
    const isSpawn =
      err instanceof Error &&
      'syscall' in err &&
      typeof err.syscall === 'string' &&
      err.syscall.startsWith('spawn')
    if (code !== undefined && SPAWN_RESOURCE_CODES.has(code) && isSpawn) {
      return new RipgrepSpawnResourceError(code)
    }
    return undefined
  }
}

function ripGrepRaw(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  callback: (
    error: ExecFileException | null,
    stdout: string,
    stderr: string,
  ) => void,
  singleThread = false,
  cwd?: string,
): ChildProcess {
  // NB: When running interactively, ripgrep does not require a path as its last
  // argument, but when run non-interactively, it will hang unless a path or file
  // pattern is provided

  const { rgPath, rgArgs, argv0 } = ripgrepCommand()

  // Use single-threaded mode only if explicitly requested for this call's retry
  const threadArgs = singleThread ? ['-j', '1'] : []
  const fullArgs = [...rgArgs, ...threadArgs, ...args, target]
  // Allow timeout to be configured via env var (in seconds), otherwise use platform defaults
  // WSL has severe performance penalty for file reads (3-5x slower on WSL2)
  const defaultTimeout = getPlatform() === 'wsl' ? 60_000 : 20_000
  let timeout = defaultTimeout
  try {
    const { resolveGlobTimeoutSeconds } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    const parsedSeconds = resolveGlobTimeoutSeconds()
    if (parsedSeconds !== null) timeout = parsedSeconds * 1000
  } catch {
    const parsedSeconds =
      parseInt(process.env.CLAUDE_CODE_GLOB_TIMEOUT_SECONDS || '', 10) || 0
    if (parsedSeconds > 0) timeout = parsedSeconds * 1000
  }

  // Prefer spawn when we need argv0 (embedded rg) or windowsHide.
  //
  // Official densable (2.1.88 e44 / 2.1.153 WM_): native is always
  // embedded+argv0 → spawn(..., { argv0, windowsHide:true }); only the
  // non-argv0 branch uses execFile (no windowsHide). Official never
  // special-cases win32 to a separate rg.exe.
  //
  // LOCAL (not official densable): 69de73ae forces Windows bundled mode
  // onto packaged rg.exe so Git Bash cannot spawn full claude.exe via
  // argv0. That path has no argv0, so without this win32 spawn gate
  // execFile flashes a conhost per Grep/Glob. windowsHide intent matches
  // official; the platform branch is local.
  //
  // Timeout: SIGTERM alone may not kill ripgrep if it's blocked in
  // uninterruptible I/O. Escalate to SIGKILL after 5s. On Windows,
  // child.kill('SIGTERM') / SIGKILL throw — use default signal.
  if (argv0 || process.platform === 'win32') {
    const child = spawn(rgPath, fullArgs, {
      ...(argv0 ? { argv0 } : {}),
      ...(cwd ? { cwd } : {}),
      env: internalToolSubprocessEnv(),
      signal: abortSignal,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false

    child.stdout?.on('data', (data: Buffer) => {
      if (!stdoutTruncated) {
        stdout += data.toString()
        if (stdout.length > MAX_BUFFER_SIZE) {
          stdout = stdout.slice(0, MAX_BUFFER_SIZE)
          stdoutTruncated = true
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      if (!stderrTruncated) {
        stderr += data.toString()
        if (stderr.length > MAX_BUFFER_SIZE) {
          stderr = stderr.slice(0, MAX_BUFFER_SIZE)
          stderrTruncated = true
        }
      }
    })

    let killTimeoutId: ReturnType<typeof setTimeout> | undefined
    let forceEndTimer: ReturnType<typeof setTimeout> | undefined
    const timeoutId = setTimeout(() => {
      if (process.platform === 'win32') {
        child.kill()
      } else {
        child.kill('SIGTERM')
        killTimeoutId = setTimeout(c => c.kill('SIGKILL'), 5_000, child)
        killTimeoutId.unref?.()
      }
      // #1500: fallback timer if process doesn't exit after kill — destroy streams and settle
      forceEndTimer = setTimeout(() => {
        if (settled) return
        settled = true
        clearTimeout(killTimeoutId)
        child.stdout?.destroy()
        child.stderr?.destroy()
        const error: ExecFileException = new Error(
          `ripgrep timed out after ${timeout}ms`,
        )
        error.signal = 'SIGKILL'
        callback(error, stdout, stderr)
      }, 6_000)
      forceEndTimer.unref?.()
    }, timeout)

    // On Windows, both 'close' and 'error' can fire for the same process
    // (e.g. when AbortSignal kills the child). Guard against double-callback.
    let settled = false
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      clearTimeout(killTimeoutId)
      clearTimeout(forceEndTimer)
      if (code === 0 || code === 1) {
        // 0 = matches found, 1 = no matches (both are success)
        callback(null, stdout, stderr)
      } else {
        const error: ExecFileException = new Error(
          `ripgrep exited with code ${code}`,
        )
        error.code = code ?? undefined
        error.signal = signal ?? undefined
        callback(error, stdout, stderr)
      }
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      clearTimeout(killTimeoutId)
      clearTimeout(forceEndTimer)
      const error: ExecFileException = err
      callback(error, stdout, stderr)
    })

    return child
  }

  // Non-Windows, non-embedded: execFile is fine (no conhost flash).
  return execFile(
    rgPath,
    fullArgs,
    {
      maxBuffer: MAX_BUFFER_SIZE,
      env: internalToolSubprocessEnv(),
      signal: abortSignal,
      timeout,
      killSignal: 'SIGKILL',
      ...(cwd ? { cwd } : {}),
    },
    callback,
  )
}

/**
 * Stream-count lines from `rg --files` without buffering stdout.
 *
 * On large repos (e.g. 247k files, 16MB of paths), calling `ripGrep()` just
 * to read `.length` materializes the full stdout string plus a 247k-element
 * array. This counts newline bytes per chunk instead; peak memory is one
 * stream chunk (~64KB).
 *
 * Intentionally minimal: the only caller is telemetry (countFilesRoundedRg),
 * which swallows all errors. No EAGAIN retry, no stderr capture, no internal
 * timeout (callers pass AbortSignal.timeout; spawn's signal option kills rg).
 */
async function ripGrepFileCount(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<number> {
  await codesignRipgrepIfNecessary()
  const { rgPath, rgArgs, argv0 } = ripgrepCommand()

  return new Promise<number>((resolve, reject) => {
    const child = spawn(rgPath, [...rgArgs, ...args, target], {
      argv0,
      env: internalToolSubprocessEnv(),
      signal: abortSignal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    let lines = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      lines += countCharInString(chunk, '\n')
    })

    // On Windows, both 'close' and 'error' can fire for the same process.
    let settled = false
    child.on('close', code => {
      if (settled) return
      settled = true
      if (code === 0 || code === 1) resolve(lines)
      else reject(new Error(`rg --files exited ${code}`))
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

/**
 * Stream lines from ripgrep as they arrive, calling `onLines` per stdout chunk.
 *
 * Unlike `ripGrep()` which buffers the entire stdout, this flushes complete
 * lines as soon as each chunk arrives — first results paint while rg is still
 * walking the tree (the fzf `change:reload` pattern). Partial trailing lines
 * are carried across chunk boundaries.
 *
 * Callers that want to stop early (e.g. after N matches) should abort the
 * signal — spawn's signal option kills rg. No EAGAIN retry, no internal
 * timeout, stderr is ignored; interactive callers own recovery.
 */
export async function ripGrepStream(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  onLines: (lines: string[]) => void,
): Promise<void> {
  await codesignRipgrepIfNecessary()
  const { rgPath, rgArgs, argv0 } = ripgrepCommand()

  return new Promise<void>((resolve, reject) => {
    const child = spawn(rgPath, [...rgArgs, ...args, target], {
      argv0,
      env: internalToolSubprocessEnv(),
      signal: abortSignal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const stripCR = (l: string) => (l.endsWith('\r') ? l.slice(0, -1) : l)
    let remainder = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      const data = remainder + chunk.toString()
      const lines = data.split('\n')
      remainder = lines.pop() ?? ''
      if (lines.length) onLines(lines.map(stripCR))
    })

    // On Windows, both 'close' and 'error' can fire for the same process.
    let settled = false
    child.on('close', code => {
      if (settled) return
      // Abort races close — don't flush a torn tail from a killed process.
      // Promise still settles: spawn's signal option fires 'error' with
      // AbortError → reject below.
      if (abortSignal.aborted) return
      settled = true
      if (code === 0 || code === 1) {
        if (remainder) onLines([stripCR(remainder)])
        resolve()
      } else {
        reject(new Error(`ripgrep exited with code ${code}`))
      }
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

export async function ripGrep(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  options?: RipGrepOptions,
): Promise<string[]> {
  await codesignRipgrepIfNecessary()

  // Test ripgrep on first use and cache the result (fire and forget)
  void testRipgrepOnFirstUse().catch(error => {
    logError(error)
  })

  return new Promise((resolve, reject) => {
    const handleResult = (
      error: ExecFileException | null,
      stdout: string,
      stderr: string,
      isRetry: boolean,
    ): void => {
      // Success case
      if (!error) {
        if (options?.rejectOnPartial && stdout.length >= MAX_BUFFER_SIZE) {
          reject(
            new RipgrepTimeoutError(
              'Ripgrep output exceeded the output buffer and was truncated.',
              [],
            ),
          )
          return
        }
        resolve(
          stdout
            .trim()
            .split('\n')
            .map(line => line.replace(/\r$/, ''))
            .filter(Boolean),
        )
        return
      }

      // Exit code 1 is normal "no matches"
      if (error.code === 1) {
        resolve([])
        return
      }

      // Critical errors that indicate ripgrep is broken, not "no matches"
      // These should be surfaced to the user rather than silently returning empty results
      const CRITICAL_ERROR_CODES = ['ENOENT', 'EACCES', 'EPERM']
      if (CRITICAL_ERROR_CODES.includes(error.code as string)) {
        reject(error)
        return
      }

      // If we hit EAGAIN and haven't retried yet, retry with single-threaded mode
      // Note: We only use -j 1 for this specific retry, not for future calls.
      // Persisting single-threaded mode globally caused timeouts on large repos
      // where EAGAIN was just a transient startup error.
      if (!isRetry && isEagainError(stderr)) {
        logForDebugging(
          `rg EAGAIN error detected, retrying with single-threaded mode (-j 1)`,
        )
        logEvent('tengu_ripgrep_eagain_retry', {})
        try {
          ripGrepRaw(
            args,
            target,
            abortSignal,
            (retryError, retryStdout, retryStderr) => {
              handleResult(retryError, retryStdout, retryStderr, true)
            },
            true, // Force single-threaded mode for this retry only
            options?.cwd,
          )
        } catch (retrySpawnError) {
          reject(
            retrySpawnError instanceof Error
              ? retrySpawnError
              : new Error(String(retrySpawnError)),
          )
        }
        return
      }

      // For all other errors, try to return partial results if available
      const hasOutput = stdout && stdout.trim().length > 0
      const isTimeout =
        error.signal === 'SIGTERM' ||
        error.signal === 'SIGKILL' ||
        error.code === 'ABORT_ERR'
      const isBufferOverflow =
        error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      // densable: unexplained code=undefined exits (common signal-ish set)
      const isUnexplainedSignal =
        error.code === undefined &&
        (error.signal === undefined ||
          error.signal === 'SIGHUP' ||
          error.signal === 'SIGINT' ||
          error.signal === 'SIGPIPE')

      let lines: string[] = []
      if (hasOutput) {
        lines = stdout
          .trim()
          .split('\n')
          .map(line => line.replace(/\r$/, ''))
          .filter(Boolean)
        // Drop last line for timeouts and buffer overflow - it may be incomplete
        if (
          lines.length > 0 &&
          (isTimeout || isBufferOverflow || isUnexplainedSignal)
        ) {
          lines = lines.slice(0, -1)
        }
      }

      logForDebugging(
        `rg error (signal=${error.signal}, code=${error.code}, stderr: ${stderr}), ${lines.length} results`,
      )

      // #1570: rejectOnPartial rejects with RipgrepTimeoutError on timeout/kill/overflow
      if (
        options?.rejectOnPartial &&
        (isTimeout || isBufferOverflow || isUnexplainedSignal)
      ) {
        if (
          abortSignal.aborted &&
          (abortSignal.reason as { name?: string } | undefined)?.name !==
            'TimeoutError'
        ) {
          reject(error)
        } else {
          reject(
            new RipgrepTimeoutError(
              'Ripgrep listing is incomplete: it timed out, was killed or exceeded the output buffer.',
              lines,
            ),
          )
        }
        return
      }

      // densable f1e: rejectOnInputError + exit 2 + empty stdout + iaT stderr → YTm
      if (
        options?.rejectOnInputError &&
        error.code === 2 &&
        lines.length === 0 &&
        RIPGREP_INPUT_ERROR_RE.test(stderr)
      ) {
        reject(new RipgrepUsageError(stderr))
        return
      }

      // SEA RW: rejectOnInputError + exit 2 + rg: <target>: ... (os error N)
      if (
        options?.rejectOnInputError &&
        error.code === 2 &&
        lines.every(l => l.endsWith('"type":"summary"}')) &&
        stderr.startsWith(`rg: ${target}: `) &&
        !stderr.trimEnd().includes('\n')
      ) {
        const osErrMatch = /\(os error (\d+)\)\s*$/.exec(stderr)
        const osErr = osErrMatch ? Number(osErrMatch[1]) : NaN
        const ignoredNotFound =
          target !== PROC_SELF_FD_3 &&
          (getPlatform() === 'windows'
            ? [WIN_ERROR_FILE_NOT_FOUND, WIN_ERROR_PATH_NOT_FOUND]
            : [POSIX_ENOENT, POSIX_ENOTDIR]
          ).includes(osErr)
        if (!Number.isNaN(osErr) && !ignoredNotFound) {
          reject(new RipgrepTargetUnreadableError(osErr))
          return
        }
      }

      // code 2 = ripgrep usage error (already handled); ABORT_ERR = caller
      // explicitly aborted (not an error, just a cancellation — interactive
      // callers may abort on every keystroke-after-debounce).
      if (error.code !== 2 && error.code !== 'ABORT_ERR') {
        logError(error)
        const spawnErr = RipgrepSpawnResourceError.from(
          error,
          options?.rejectOnInputError,
        )
        if (spawnErr && lines.length === 0) {
          reject(spawnErr)
          return
        }
        if (
          lines.length === 0 &&
          options?.rejectOnInputError &&
          (error.code as unknown) !== 'ECHILD' &&
          !isTimeout &&
          !isBufferOverflow &&
          !isUnexplainedSignal &&
          !abortSignal.aborted
        ) {
          reject(new RipgrepAbnormalExitError())
          return
        }
      }

      if (
        isBufferOverflow &&
        lines.length === 0 &&
        options?.rejectOnInputError
      ) {
        reject(
          new RipgrepOutputTooLargeError(
            error.message.startsWith('stderr') ? 'stderr' : 'stdout',
          ),
        )
        return
      }

      // If we timed out with no results, throw an error so Claude knows the search
      // didn't complete rather than thinking there were no matches
      if (isTimeout && lines.length === 0) {
        reject(
          new RipgrepTimeoutError(
            `Ripgrep search timed out after ${getPlatform() === 'wsl' ? 60 : 20} seconds. The search may have matched files but did not complete in time. Try searching a more specific path or pattern.`,
            lines,
          ),
        )
        return
      }

      resolve(lines)
    }

    ripGrepRaw(
      args,
      target,
      abortSignal,
      (error, stdout, stderr) => {
        handleResult(error, stdout, stderr, false)
      },
      false,
      options?.cwd,
    )
  })
}

/**
 * Count files in a directory recursively using ripgrep and round to the nearest power of 10 for privacy
 *
 * This is much more efficient than using native Node.js methods for counting files
 * in large directories since it uses ripgrep's highly optimized file traversal.
 *
 * @param path Directory path to count files in
 * @param abortSignal AbortSignal to cancel the operation
 * @param ignorePatterns Optional additional patterns to ignore (beyond .gitignore)
 * @returns Approximate file count rounded to the nearest power of 10
 */
export const countFilesRoundedRg = memoizePerHost(
  async (
    dirPath: string,
    abortSignal: AbortSignal,
    ignorePatterns: string[] = [],
  ): Promise<number | undefined> => {
    // Skip file counting if we're in the home directory to avoid triggering
    // macOS TCC permission dialogs for Desktop, Downloads, Documents, etc.
    if (path.resolve(dirPath) === path.resolve(homedir())) {
      return undefined
    }

    try {
      // Build ripgrep arguments:
      // --files: List files that would be searched (rather than searching them)
      // --count: Only print a count of matching lines for each file
      // --no-ignore-parent: Don't respect ignore files in parent directories
      // --hidden: Search hidden files and directories
      const args = ['--files', '--hidden']

      // Add ignore patterns if provided
      ignorePatterns.forEach(pattern => {
        args.push('--glob', `!${pattern}`)
      })

      const count = await ripGrepFileCount(args, dirPath, abortSignal)

      // Round to nearest power of 10 for privacy
      if (count === 0) return 0

      const magnitude = Math.floor(Math.log10(count))
      const power = 10 ** magnitude

      // Round to nearest power of 10
      // e.g., 8 -> 10, 42 -> 100, 350 -> 100, 750 -> 1000
      return Math.round(count / power) * power
    } catch (error) {
      // AbortSignal.timeout firing is expected on large/slow repos, not an error.
      if ((error as Error)?.name !== 'AbortError') logError(error)
    }
  },
  // lodash memoize's default resolver only uses the first argument.
  // ignorePatterns affect the result, so include them in the cache key.
  // abortSignal is intentionally excluded — it doesn't affect the count.
  (dirPath, _abortSignal, ignorePatterns = []) =>
    `${dirPath}|${ignorePatterns.join(',')}`,
)

type RipgrepRuntimeHostState = {
  ripgrepStatus: {
    working: boolean
    lastTested: number
    config: RipgrepConfig
    note?: string
  } | null
  alreadyDoneSignCheck: boolean
}

const ripgrepRuntimeHostSlot = new HostSlot<RipgrepRuntimeHostState>(() => ({
  ripgrepStatus: null,
  alreadyDoneSignCheck: false,
}))

function getRipgrepRuntimeHostState(): RipgrepRuntimeHostState {
  return ripgrepRuntimeHostSlot.of(getBootstrapSessionHost())
}

/**
 * Get ripgrep status and configuration info
 * Returns current configuration immediately, with working status if available
 */
export function getRipgrepStatus(): {
  mode: 'system' | 'builtin' | 'embedded'
  path: string
  working: boolean | null // null if not yet tested
  note?: string
} {
  const config = getRipgrepConfig()
  const { ripgrepStatus } = getRipgrepRuntimeHostState()
  return {
    mode: config.mode,
    path: config.command,
    working: ripgrepStatus?.working ?? null,
    note: ripgrepStatus?.note ?? config.note,
  }
}

/**
 * Test ripgrep availability on first use and cache the result
 */
const testRipgrepOnFirstUse = memoizePerHost(async (): Promise<void> => {
  const hostState = getRipgrepRuntimeHostState()
  // Already tested
  if (hostState.ripgrepStatus !== null) {
    return
  }

  const config = getRipgrepConfig()

  try {
    let test: { code: number; stdout: string }

    // For embedded ripgrep, use node:child_process spawn with argv0
    if (config.argv0) {
      test = await new Promise<{ code: number; stdout: string }>(
        (resolve, reject) => {
          const proc = spawn(config.command, ['--version'], {
            argv0: config.argv0,
            stdio: ['ignore', 'pipe', 'ignore'],
          })
          const stdoutChunks: Buffer[] = []
          proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
          proc.once('error', reject)
          proc.once('close', code => {
            resolve({
              code: code ?? 1,
              stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            })
          })
        },
      )
    } else {
      test = await execFileNoThrow(
        config.command,
        [...config.args, '--version'],
        {
          timeout: 5000,
        },
      )
    }

    const working =
      test.code === 0 && !!test.stdout && test.stdout.startsWith('ripgrep ')

    hostState.ripgrepStatus = {
      working,
      lastTested: Date.now(),
      config,
      note: config.note,
    }

    logForDebugging(
      `Ripgrep first use test: ${working ? 'PASSED' : 'FAILED'} (mode=${config.mode}, path=${config.command})`,
    )

    // Log telemetry for actual ripgrep availability
    logEvent('tengu_ripgrep_availability', {
      working: working ? 1 : 0,
      using_system: config.mode === 'system' ? 1 : 0,
    })
  } catch (error) {
    hostState.ripgrepStatus = {
      working: false,
      lastTested: Date.now(),
      config,
      note: config.note,
    }
    logError(error)
  }
})

async function codesignRipgrepIfNecessary() {
  const hostState = getRipgrepRuntimeHostState()
  if (process.platform !== 'darwin' || hostState.alreadyDoneSignCheck) {
    return
  }

  hostState.alreadyDoneSignCheck = true

  // Only sign the standalone vendored rg binary (npm builds)
  const config = getRipgrepConfig()
  if (config.mode !== 'builtin') {
    return
  }
  const builtinPath = config.command

  // First, check to see if ripgrep is already signed
  const lines = (
    await execFileNoThrow('codesign', ['-vv', '-d', builtinPath], {
      preserveOutputOnError: false,
    })
  ).stdout.split('\n')

  const needsSigned = lines.find(line => line.includes('linker-signed'))
  if (!needsSigned) {
    return
  }

  try {
    const signResult = await execFileNoThrow('codesign', [
      '--sign',
      '-',
      '--force',
      '--preserve-metadata=entitlements,requirements,flags,runtime',
      builtinPath,
    ])

    if (signResult.code !== 0) {
      logError(
        new Error(
          `Failed to sign ripgrep: ${signResult.stdout} ${signResult.stderr}`,
        ),
      )
    }

    const quarantineResult = await execFileNoThrow('xattr', [
      '-d',
      'com.apple.quarantine',
      builtinPath,
    ])

    if (quarantineResult.code !== 0) {
      logError(
        new Error(
          `Failed to remove quarantine: ${quarantineResult.stdout} ${quarantineResult.stderr}`,
        ),
      )
    }
  } catch (e) {
    logError(e)
  }
}
