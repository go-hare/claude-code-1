import {
  execFileNoThrowWithCwd,
  execSyncWithDefaults_DEPRECATED,
} from './execFileNoThrow.js'

// This file contains platform-agnostic implementations of common `ps` type commands.
// When adding new code to this file, make sure to handle:
// - Win32, as `ps` within cygwin and WSL may not behave as expected, particularly when attempting to access processes on the host.
// - Unix vs BSD-style `ps` have different options.

/**
 * Check if a process with the given PID is running (signal 0 probe).
 *
 * PID ≤ 1 returns false (0 is current process group, 1 is init).
 *
 * Note: `process.kill(pid, 0)` throws EPERM when the process exists but is
 * owned by another user. This reports such processes as NOT running, which
 * is conservative for lock recovery (we won't steal a live lock).
 */
export function isProcessRunning(pid: number): boolean {
  if (pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Official Ex/phh — raw `ps -o lstart=` string (LC_ALL=C TZ=UTC).
 * Used as adopt.json `procStart` identity token. Undefined on Windows / fail.
 */
export async function getProcessLstartString(
  pid: number,
): Promise<string | undefined> {
  if (pid <= 1 || process.platform === 'win32') return undefined
  try {
    const result = await execFileNoThrowWithCwd(
      'ps',
      ['-o', 'lstart=', '-p', String(pid)],
      {
        timeout: 1000,
        env: {
          ...process.env,
          LC_ALL: 'C',
          TZ: 'UTC',
        },
      },
    )
    if (result.code !== 0 || !result.stdout?.trim()) return undefined
    return result.stdout.trim()
  } catch {
    return undefined
  }
}

/**
 * Official Dmi / WEi — process start time as epoch ms via `ps -o lstart=` (UTC).
 * Returns null on Windows or when ps fails. Used by host-creds procStart drift.
 */
export async function getProcessStartTimeMs(
  pid: number,
): Promise<number | null> {
  const lstart = await getProcessLstartString(pid)
  if (lstart === undefined) return null
  const ms = Date.parse(`${lstart} UTC`)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Official zU — identity still matches when expectedLstart is undefined, or
 * when current lstart is undefined (ps race), or when equal.
 */
export async function processLstartMatches(
  pid: number,
  expectedLstart: string | undefined,
): Promise<boolean> {
  if (expectedLstart === undefined) return true
  const current = await getProcessLstartString(pid)
  return current === undefined || current === expectedLstart
}

/**
 * Official Klr portable — SIGTERM only when identity still matches.
 * - If procStart set: require current lstart === procStart (skip when recycled).
 * - Else if startTimeTicks set: official xen is a null stub; `null !== ticks`
 *   is always true → official returns without kill for ticks-only. Portable:
 *   same (no kill on ticks-only until xen is real).
 * - Else (no identity): official returns without kill (`else return`).
 * Returns true if SIGTERM was attempted.
 */
export async function killPidIfIdentityMatches(
  pid: number,
  opts?: {
    procStart?: string
    startTimeTicks?: number
    signal?: NodeJS.Signals | number
  },
): Promise<boolean> {
  if (pid <= 1) return false
  const procStart = opts?.procStart
  const startTimeTicks = opts?.startTimeTicks
  if (procStart !== undefined) {
    const current = await getProcessLstartString(pid)
    // Official: if await Ex(e,{skipCache:!0}) !== r return
    // If current is undefined (ps fail), Ex returns undefined ≠ procStart → no kill.
    if (current !== procStart) return false
  } else if (startTimeTicks !== undefined) {
    // Official xen returns null; null !== ticks → no kill.
    return false
  } else {
    // Official: else return (no identity → no SIGTERM).
    return false
  }
  try {
    process.kill(pid, opts?.signal ?? 'SIGTERM')
    return true
  } catch {
    return false
  }
}

/**
 * Gets the ancestor process chain for a given process (up to maxDepth levels)
 * @param pid - The starting process ID
 * @param maxDepth - Maximum number of ancestors to fetch (default: 10)
 * @returns Array of ancestor PIDs from immediate parent to furthest ancestor
 */
export async function getAncestorPidsAsync(
  pid: string | number,
  maxDepth = 10,
): Promise<number[]> {
  if (process.platform === 'win32') {
    // For Windows, use a PowerShell script that walks the process tree
    const script = `
      $pid = ${String(pid)}
      $ancestors = @()
      for ($i = 0; $i -lt ${maxDepth}; $i++) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        if (-not $proc -or -not $proc.ParentProcessId -or $proc.ParentProcessId -eq 0) { break }
        $pid = $proc.ParentProcessId
        $ancestors += $pid
      }
      $ancestors -join ','
    `.trim()

    const result = await execFileNoThrowWithCwd(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeout: 3000 },
    )
    if (result.code !== 0 || !result.stdout?.trim()) {
      return []
    }
    return result.stdout
      .trim()
      .split(',')
      .filter(Boolean)
      .map(p => parseInt(p, 10))
      .filter(p => !isNaN(p))
  }

  // For Unix, use a shell command that walks up the process tree
  // This uses a single process invocation instead of multiple sequential calls
  const script = `pid=${String(pid)}; for i in $(seq 1 ${maxDepth}); do ppid=$(ps -o ppid= -p $pid 2>/dev/null | tr -d ' '); if [ -z "$ppid" ] || [ "$ppid" = "0" ] || [ "$ppid" = "1" ]; then break; fi; echo $ppid; pid=$ppid; done`

  const result = await execFileNoThrowWithCwd('sh', ['-c', script], {
    timeout: 3000,
  })
  if (result.code !== 0 || !result.stdout?.trim()) {
    return []
  }
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(p => parseInt(p, 10))
    .filter(p => !isNaN(p))
}

/**
 * Gets the command line for a given process
 * @param pid - The process ID to get the command for
 * @returns The command line string, or null if not found
 * @deprecated Use getAncestorCommandsAsync instead
 */
export function getProcessCommand(pid: string | number): string | null {
  try {
    const pidStr = String(pid)
    const command =
      process.platform === 'win32'
        ? `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pidStr}\\").CommandLine"`
        : `ps -o command= -p ${pidStr}`

    const result = execSyncWithDefaults_DEPRECATED(command, { timeout: 1000 })
    return result ? result.trim() : null
  } catch {
    return null
  }
}

/**
 * Gets the command lines for a process and its ancestors in a single call
 * @param pid - The starting process ID
 * @param maxDepth - Maximum depth to traverse (default: 10)
 * @returns Array of command strings for the process chain
 */
export async function getAncestorCommandsAsync(
  pid: string | number,
  maxDepth = 10,
): Promise<string[]> {
  if (process.platform === 'win32') {
    // For Windows, use a PowerShell script that walks the process tree and collects commands
    const script = `
      $currentPid = ${String(pid)}
      $commands = @()
      for ($i = 0; $i -lt ${maxDepth}; $i++) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$currentPid" -ErrorAction SilentlyContinue
        if (-not $proc) { break }
        if ($proc.CommandLine) { $commands += $proc.CommandLine }
        if (-not $proc.ParentProcessId -or $proc.ParentProcessId -eq 0) { break }
        $currentPid = $proc.ParentProcessId
      }
      $commands -join [char]0
    `.trim()

    const result = await execFileNoThrowWithCwd(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeout: 3000 },
    )
    if (result.code !== 0 || !result.stdout?.trim()) {
      return []
    }
    return result.stdout.split('\0').filter(Boolean)
  }

  // For Unix, use a shell command that walks up the process tree and collects commands
  // Using null byte as separator to handle commands with newlines
  const script = `currentpid=${String(pid)}; for i in $(seq 1 ${maxDepth}); do cmd=$(ps -o command= -p $currentpid 2>/dev/null); if [ -n "$cmd" ]; then printf '%s\\0' "$cmd"; fi; ppid=$(ps -o ppid= -p $currentpid 2>/dev/null | tr -d ' '); if [ -z "$ppid" ] || [ "$ppid" = "0" ] || [ "$ppid" = "1" ]; then break; fi; currentpid=$ppid; done`

  const result = await execFileNoThrowWithCwd('sh', ['-c', script], {
    timeout: 3000,
  })
  if (result.code !== 0 || !result.stdout?.trim()) {
    return []
  }
  return result.stdout.split('\0').filter(Boolean)
}

/**
 * Gets the child process IDs for a given process
 * @param pid - The parent process ID
 * @returns Array of child process IDs as numbers
 */
export function getChildPids(pid: string | number): number[] {
  try {
    const pidStr = String(pid)
    const command =
      process.platform === 'win32'
        ? `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ParentProcessId=${pidStr}\\").ProcessId"`
        : `pgrep -P ${pidStr}`

    const result = execSyncWithDefaults_DEPRECATED(command, { timeout: 1000 })
    if (!result) {
      return []
    }
    return result
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(p => parseInt(p, 10))
      .filter(p => !isNaN(p))
  } catch {
    return []
  }
}
