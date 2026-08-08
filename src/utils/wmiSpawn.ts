/**
 * Daemon self-spawn densable (official 2.1.210 client-attach Ay6).
 *
 *   Ay6(cliArgs):
 *     argv = WE() + cliArgs
 *     env  = rAO()
 *     if windows: dAO(WMI) → ok return
 *                 else short warn + tengu_bg_daemon_wmi_fallback
 *     err = rsK(argv, env)   // all platforms
 *     if ENOENT|EACCES: WE({pinToCurrentBinary:true}) + rsK again
 *
 * WMI details: dAO/cAO/lAO/nAO/iAO (Windows only).
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { logEvent } from '../services/analytics/index.js'
import { buildCliLaunch } from './cliLaunch.js'

export interface WmiSpawnOptions {
  execPath: string
  args: string[]
  env?: Record<string, string | undefined>
  cwd?: string
  timeout?: number
}

export interface WmiSpawnResult {
  success: boolean
  pid?: number
  error?: string
  usedFallback?: 'direct' | 'execpath'
  /** Official dAO reason tag when WMI failed (timeout / enoent / rc=N / …). */
  wmiReason?: string
  rc?: number
}

/**
 * Official nAO — Windows CreateProcess argv quoting.
 * Bare token when no space/quote; otherwise double-quote with backslash rules.
 */
export function quoteWindowsArg(arg: string): string {
  if (arg.length > 0 && !/[\s"]/.test(arg)) return arg
  let out = '"'
  let i = 0
  while (i < arg.length) {
    let backslashes = 0
    while (arg[i] === '\\') {
      backslashes++
      i++
    }
    if (i === arg.length) {
      out += '\\'.repeat(backslashes * 2)
    } else if (arg[i] === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"'
      i++
    } else {
      out += '\\'.repeat(backslashes) + arg[i]
      i++
    }
  }
  return out + '"'
}

/** Official lAO — join argv into a CreateProcess CommandLine. */
export function buildWindowsCommandLine(argv: readonly string[]): string {
  return argv.map(quoteWindowsArg).join(' ')
}

/**
 * Official iAO — embed a CommandLine string as a PowerShell single-quoted
 * literal. Rejects curly/smart single quotes (unsupported in this densable).
 */
export function quotePowerShellSingle(value: string): string {
  if (/[\u2018\u2019\u201A\u201B]/.test(value)) {
    throw new Error('unsupported Unicode single-quote in command line')
  }
  return `'${value.replaceAll("'", "''")}'`
}

export type BuildWmiPowerShellScriptOptions = {
  /**
   * Official cAO default: $env:USERPROFILE.
   * Worker/pty-host needs the job cwd instead of the user profile.
   */
  currentDirectory?: string
  /**
   * When true, Write-Output ProcessId on success so callers can track the
   * child without a CreateProcess handle (needed for sync spawn sites).
   * Official daemon dAO only checks ReturnValue; worker nqq needs the pid.
   */
  emitProcessId?: boolean
}

/**
 * Official cAO — PowerShell body for Win32_Process.Create with hidden
 * DETACHED_PROCESS startup info and parent env passthrough.
 *
 * CreateFlags = 8 → DETACHED_PROCESS
 * ShowWindow = 0 → SW_HIDE
 * CurrentDirectory = $env:USERPROFILE (official; not the caller's cwd)
 * unless {@link BuildWmiPowerShellScriptOptions.currentDirectory} is set.
 */
export function buildWmiPowerShellScript(
  commandLine: string,
  opts?: BuildWmiPowerShellScriptOptions,
): string {
  const cwdExpr =
    opts?.currentDirectory !== undefined
      ? quotePowerShellSingle(opts.currentDirectory)
      : '$env:USERPROFILE'
  const emitPid =
    opts?.emitProcessId === true
      ? 'if ($r.ReturnValue -eq 0 -and $r.ProcessId) { Write-Output $r.ProcessId }'
      : ''
  return [
    '$ErrorActionPreference = "Stop"',
    '$e = [string[]](Get-ChildItem Env: | ForEach-Object { "$($_.Name)=$($_.Value)" })',
    '$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ EnvironmentVariables = $e; ShowWindow = [uint16]0; CreateFlags = [uint32]8 }',
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${quotePowerShellSingle(commandLine)}; CurrentDirectory = ${cwdExpr}; ProcessStartupInformation = $s }`,
    ...(emitPid ? [emitPid] : []),
    'exit $r.ReturnValue',
  ].join('\n')
}

function windowsPowerShellPath(): string {
  const systemRoot = process.env.SYSTEMROOT || 'C:\\Windows'
  return `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

/**
 * Sync WMI hidden spawn for sites that cannot await (createDefaultSpawnPty).
 * Uses densable dAO/cAO flags (SW_HIDE + DETACHED_PROCESS) and returns pid.
 *
 * Bun's child_process.spawn ignores windowsHide when detached:true — that is
 * the multi-console flash on exit BackgroundAndExit / cold worker spawn.
 * WMI Create bypasses CreateProcess console inheritance entirely.
 */
export function spawnViaWmiSync(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  opts?: { cwd?: string; timeoutMs?: number },
): { ok: true; pid: number } | { ok: false; reason: string; rc?: number } {
  if (argv.length === 0) {
    return { ok: false, reason: 'empty argv' }
  }
  let script: string
  try {
    script = buildWmiPowerShellScript(buildWindowsCommandLine(argv), {
      currentDirectory: opts?.cwd,
      emitProcessId: true,
    })
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const powershell = windowsPowerShellPath()
  const timeoutMs = opts?.timeoutMs ?? 5000

  try {
    // spawnSync (not spawn): need pid before createDefaultSpawnPty returns.
    // windowsHide without detached — powershell helper must not flash either.
    const result = spawnSync(
      powershell,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        env,
        encoding: 'utf8',
        timeout: timeoutMs,
      },
    )
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code
      return {
        ok: false,
        reason: code === 'ENOENT' ? 'enoent' : result.error.message,
      }
    }
    if (result.status !== 0) {
      return {
        ok: false,
        reason: `Win32_Process.Create rc=${result.status}`,
        rc: result.status ?? undefined,
      }
    }
    const out = String(result.stdout ?? '')
      .trim()
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
    const pidLine = out[out.length - 1]
    const pid = pidLine ? Number.parseInt(pidLine, 10) : Number.NaN
    if (!Number.isFinite(pid) || pid <= 0) {
      return { ok: false, reason: 'missing ProcessId' }
    }
    return { ok: true, pid }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Poll until pid is gone (WMI-spawned children have no ChildProcess handle).
 * densable Bun.spawn exposes .exited; we approximate for connectToPtyHost.
 */
export function waitForPidExit(pid: number): Promise<number> {
  return new Promise(resolve => {
    const tick = (): void => {
      try {
        process.kill(pid, 0)
        const t = setTimeout(tick, 500)
        t.unref?.()
      } catch {
        resolve(0)
      }
    }
    tick()
  })
}

/** Official rAO subset — scrub invocation id; drop short-lived OAuth token when refreshable. */
export function buildDaemonSpawnEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, INVOCATION_ID: '' }
  // Official: n_() !== "macos" && CLAUDE_CODE_OAUTH_TOKEN && refresh present.
  if (process.platform !== 'darwin' && env.CLAUDE_CODE_OAUTH_TOKEN) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getClaudeAIOAuthTokens } = require('./auth.js') as {
        getClaudeAIOAuthTokens?: () => { refreshToken?: string | null } | null
      }
      if (getClaudeAIOAuthTokens?.()?.refreshToken) {
        delete env.CLAUDE_CODE_OAUTH_TOKEN
        delete env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
      }
    } catch {
      // auth helper optional in tests / minimal builds
    }
  }
  return env
}

/**
 * Official dAO — WMI spawn via powershell -EncodedCommand (utf16le base64).
 * Returns ok:true on ReturnValue 0; else reason + optional rc.
 * stdio is ignored so the script body never paints the TUI.
 */
export function spawnViaWmi(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 5000,
): Promise<{ ok: true } | { ok: false; reason: string; rc?: number }> {
  let script: string
  try {
    script = buildWmiPowerShellScript(buildWindowsCommandLine(argv))
  } catch (err) {
    return Promise.resolve({
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    })
  }

  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const powershell = windowsPowerShellPath()

  return new Promise(resolve => {
    let settled = false
    const settle = (
      result:
        | {
            ok: true
          }
        | {
            ok: false
            reason: string
            rc?: number
          },
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    let proc: ChildProcess
    try {
      // densable dAO: windowsHide without detached so the PS helper itself
      // never opens a console (Bun honors hide when not detached).
      proc = spawn(
        powershell,
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        {
          stdio: 'ignore',
          windowsHide: true,
          env,
        },
      )
    } catch (err) {
      settle({
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      })
      return
    }

    proc.once('error', err => {
      const code = (err as NodeJS.ErrnoException).code
      settle({
        ok: false,
        reason: code === 'ENOENT' ? 'enoent' : err.message,
      })
    })

    proc.once('exit', code => {
      if (code === 0) settle({ ok: true })
      else
        settle({
          ok: false,
          reason: `Win32_Process.Create rc=${code}`,
          rc: code ?? undefined,
        })
    })

    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        // already exited
      }
      settle({ ok: false, reason: 'timeout' })
    }, timeoutMs)
    timer.unref?.()
  })
}

/** Official f6 — errno code extractor. */
function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

/**
 * Official rsK — detached spawn, windowsHide:true, stdio ignore.
 * Yields one tick so async 'error' can surface; returns the error or null.
 */
export async function spawnDetachedDirect(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ error: Error | null; pid?: number }> {
  if (argv.length === 0) {
    return { error: new Error('empty argv') }
  }
  let error: Error | null = null
  let pid: number | undefined
  try {
    const proc = spawn(argv[0]!, argv.slice(1), {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
      // Official rsK does not set cwd — inherit process cwd / env.
    })
    pid = proc.pid
    proc.once('error', err => {
      error = err
    })
    proc.unref()
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
  }
  await new Promise<void>(r => setImmediate(r))
  return { error, pid }
}

/**
 * Official Ay6 — full daemon self-spawn for any platform.
 *
 * @param cliArgs  Args after the launch prefix (e.g. ['daemon','run','--origin','transient'])
 */
export async function spawnDaemonCli(
  cliArgs: string[],
  opts?: { env?: NodeJS.ProcessEnv; timeout?: number },
): Promise<WmiSpawnResult> {
  const timeout = opts?.timeout ?? 5000
  const baseEnv = opts?.env ?? process.env
  const env = buildDaemonSpawnEnv(baseEnv)

  const primary = buildCliLaunch(cliArgs, { env: baseEnv })
  const primaryArgv = [primary.execPath, ...primary.args]

  // Windows-only WMI path (official dAO).
  if (process.platform === 'win32') {
    const wmi = await spawnViaWmi(primaryArgv, env, timeout)
    if (wmi.ok) {
      return { success: true }
    }
    process.stderr.write(
      `daemon: WMI spawn failed (${wmi.reason}); falling back to direct spawn — daemon will not survive SSH/terminal close\n`,
    )
    logEvent('tengu_bg_daemon_wmi_fallback', {
      timeout: wmi.reason === 'timeout',
      enoent: wmi.reason === 'enoent',
      ...(wmi.rc !== undefined ? { rc: wmi.rc } : {}),
    })
  }

  // All platforms: official rsK.
  const first = await spawnDetachedDirect(primaryArgv, env)
  if (!first.error) {
    return {
      success: true,
      pid: first.pid,
      usedFallback: process.platform === 'win32' ? 'direct' : undefined,
    }
  }

  const code = errnoCode(first.error)
  if (code === 'ENOENT' || code === 'EACCES') {
    // Official: WE({ pinToCurrentBinary: true }) when cmd differs.
    const pinned = buildCliLaunch(cliArgs, {
      env: baseEnv,
      pinToCurrentBinary: true,
    })
    if (pinned.execPath !== primary.execPath) {
      logEvent('tengu_bg_daemon_spawn_execpath_fallback', {
        errno_enoent: code === 'ENOENT',
        errno_eacces: code === 'EACCES',
      })
      const second = await spawnDetachedDirect(
        [pinned.execPath, ...pinned.args],
        env,
      )
      if (!second.error) {
        return {
          success: true,
          pid: second.pid,
          usedFallback: 'execpath',
        }
      }
      return {
        success: false,
        error: second.error.message,
        usedFallback: 'execpath',
      }
    }
  }

  return {
    success: false,
    error: first.error.message,
    usedFallback: 'direct',
  }
}

/**
 * Legacy entry used by installPrompt / agents — prefers official Ay6 when
 * callers pass a full launch, otherwise falls through to the same rsK path.
 *
 * Prefer {@link spawnDaemonCli} for new call sites (matches official WE+Ay6).
 */
export async function spawnDaemonWithWmiFallback(
  opts: WmiSpawnOptions,
): Promise<WmiSpawnResult> {
  const { execPath, args, env: envOverride, timeout = 5000 } = opts

  // If caller already built a full launch (execPath + full args including
  // bootstrap), run the official WMI → rsK → pinToCurrentBinary chain
  // without rebuilding via buildCliLaunch (avoids double-prefixing).
  const env = buildDaemonSpawnEnv({
    ...process.env,
    ...(envOverride as NodeJS.ProcessEnv | undefined),
  })
  const argv = [execPath, ...args]

  if (process.platform === 'win32') {
    const wmi = await spawnViaWmi(argv, env, timeout)
    if (wmi.ok) return { success: true }
    process.stderr.write(
      `daemon: WMI spawn failed (${wmi.reason}); falling back to direct spawn — daemon will not survive SSH/terminal close\n`,
    )
    logEvent('tengu_bg_daemon_wmi_fallback', {
      timeout: wmi.reason === 'timeout',
      enoent: wmi.reason === 'enoent',
      ...(wmi.rc !== undefined ? { rc: wmi.rc } : {}),
    })
  }

  const first = await spawnDetachedDirect(argv, env)
  if (!first.error) {
    return {
      success: true,
      pid: first.pid,
      usedFallback: process.platform === 'win32' ? 'direct' : undefined,
    }
  }

  const code = errnoCode(first.error)
  if (code === 'ENOENT' || code === 'EACCES') {
    // Official pinToCurrentBinary rebuild — only when WE would pick a
    // different cmd (versioned native → live execPath). For unbundled/dev
    // the cmd is already process.execPath, so this is a no-op.
    try {
      // Infer cliArgs as trailing daemon args when present; otherwise empty.
      // Callers using spawnDaemonCli avoid this heuristic.
      const pinned = buildCliLaunch([], { pinToCurrentBinary: true })
      if (pinned.execPath !== execPath) {
        logEvent('tengu_bg_daemon_spawn_execpath_fallback', {
          errno_enoent: code === 'ENOENT',
          errno_eacces: code === 'EACCES',
        })
        const second = await spawnDetachedDirect(
          [pinned.execPath, ...pinned.args, ...args],
          env,
        )
        if (!second.error) {
          return {
            success: true,
            pid: second.pid,
            usedFallback: 'execpath',
          }
        }
        return {
          success: false,
          error: second.error.message,
          usedFallback: 'execpath',
        }
      }
    } catch {
      // pin rebuild optional
    }
  }

  return {
    success: false,
    error: first.error.message,
    usedFallback: 'direct',
  }
}
