/**
 * Windows WMI-based process spawning for daemon detachment.
 *
 * Upstream equivalent: WMI spawn path in daemon ensure-running logic.
 *
 * On Windows, using WMI (Win32_Process.Create) to spawn the daemon provides
 * better detachment from the parent process session compared to standard spawn.
 * This is especially important for SSH/terminal sessions — the daemon survives
 * when the SSH connection closes.
 *
 * Fallback chain:
 * 1. Try WMI spawn (best detachment)
 * 2. On failure (timeout/ENOENT/EACCES), fall back to direct spawn
 * 3. On execpath stale, try fallback execpath
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, statSync } from 'fs'
import { logEvent } from '../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'

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
}

/**
 * Check if execPath appears stale (binary is old or missing).
 * Official uses mtime comparison; we use a simple existence + age check.
 */
function isExecPathStale(execPath: string): boolean {
  try {
    if (!existsSync(execPath)) return true
    const stats = statSync(execPath)
    const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60)
    // If binary is older than 30 days, consider it potentially stale
    return ageHours > 30 * 24
  } catch {
    return true
  }
}

/**
 * Attempt to spawn a process using Windows WMI (Win32_Process.Create).
 * Returns the PID on success, or throws on failure.
 */
async function tryWmiSpawn(
  execPath: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<number> {
  // Escape arguments for PowerShell
  const escapeArg = (arg: string): string => {
    // Quote and escape single quotes
    return `'${arg.replace(/'/g, "''")}'`
  }

  const commandLine = [execPath, ...args].map(escapeArg).join(' ')

  // PowerShell script to invoke WMI process creation
  const psScript = `
    $startInfo = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
      CommandLine = ${escapeArg(commandLine)}
      CurrentDirectory = ${escapeArg(cwd)}
    }
    if ($startInfo.ReturnValue -eq 0) {
      Write-Output $startInfo.ProcessId
    } else {
      Write-Error "WMI spawn failed with code $($startInfo.ReturnValue)"
      exit 1
    }
  `.trim()

  return new Promise<number>((resolve, reject) => {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )

    let stdout = ''
    let stderr = ''
    let resolved = false

    const cleanup = () => {
      if (!resolved) {
        resolved = true
        proc.kill()
      }
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('WMI spawn timeout'))
    }, timeout)

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('exit', code => {
      clearTimeout(timer)
      if (resolved) return
      resolved = true

      if (code === 0) {
        const pidStr = stdout.trim()
        const pid = parseInt(pidStr, 10)
        if (isNaN(pid)) {
          reject(new Error(`Invalid PID from WMI: ${pidStr}`))
        } else {
          resolve(pid)
        }
      } else {
        reject(new Error(`WMI spawn failed: ${stderr || 'unknown error'}`))
      }
    })

    proc.on('error', err => {
      clearTimeout(timer)
      cleanup()
      if (!resolved) {
        resolved = true
        reject(err)
      }
    })
  })
}

/**
 * Spawn a daemon process with WMI fallback (Windows only).
 *
 * Official: tengu_bg_daemon_wmi_fallback + tengu_bg_daemon_spawn_execpath_fallback
 */
export async function spawnDaemonWithWmiFallback(
  opts: WmiSpawnOptions,
): Promise<WmiSpawnResult> {
  const { execPath, args, env = {}, cwd = process.cwd(), timeout = 5000 } = opts

  // Windows only — on other platforms, use direct spawn
  if (process.platform !== 'win32') {
    const proc = spawn(execPath, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      cwd,
    })
    proc.unref()
    return { success: true, pid: proc.pid }
  }

  // Try WMI spawn first
  try {
    const pid = await tryWmiSpawn(execPath, args, cwd, timeout)
    return { success: true, pid }
  } catch (err) {
    const errStr = String(err)
    console.warn(
      `daemon: WMI spawn failed (${errStr}); falling back to direct spawn`,
    )

    // Official: tengu_bg_daemon_wmi_fallback
    logEvent('tengu_bg_daemon_wmi_fallback', {
      reason: (errStr.includes('timeout')
        ? 'timeout'
        : errStr.includes('ENOENT')
          ? 'enoent'
          : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    // Check if execPath is stale — if so, try fallback execpath
    let finalExecPath = execPath
    if (isExecPathStale(execPath)) {
      // Official: tengu_bg_daemon_spawn_execpath_fallback
      // Try alternate paths (e.g., global install vs local)
      const fallbackPaths = [
        process.execPath, // Current Node/Bun binary
        // Could add other candidates like /usr/local/bin/claude, etc.
      ].filter(p => p !== execPath && existsSync(p))

      if (fallbackPaths.length > 0) {
        finalExecPath = fallbackPaths[0]!
        console.warn(
          `daemon: execPath ${execPath} appears stale; trying fallback ${finalExecPath}`,
        )
        logEvent('tengu_bg_daemon_spawn_execpath_fallback', {})
      }
    }

    // Fall back to direct spawn
    try {
      const proc = spawn(finalExecPath, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...env } as NodeJS.ProcessEnv,
        cwd,
        windowsHide: true,
      })
      proc.unref()
      return {
        success: true,
        pid: proc.pid,
        usedFallback: finalExecPath !== execPath ? 'execpath' : 'direct',
      }
    } catch (spawnErr) {
      return {
        success: false,
        error: String(spawnErr),
        usedFallback: 'direct',
      }
    }
  }
}
