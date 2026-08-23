import {
  execFileNoThrowWithCwd,
  execSyncWithDefaults_DEPRECATED,
} from './execFileNoThrow.js'
import { logForDebugging } from './debug.js'

// This file contains platform-agnostic implementations of common `ps` type commands.
// When adding new code to this file, make sure to handle:
// - Win32, as `ps` within cygwin and WSL may not behave as expected, particularly when attempting to access processes on the host.
// - Unix vs BSD-style `ps` have different options.

// ---------------------------------------------------------------------------
// densable 2.1.221 win32-proc-times (B8c / Aao / j8c / BMt / JWg / ies)
// kernel32 GetProcessTimes via bun:ffi; PowerShell only as fallback.
// ---------------------------------------------------------------------------

/** densable `zWg` — PROCESS_QUERY_INFORMATION */
const PROCESS_QUERY_INFORMATION = 4096
/** densable `VWg` — FILETIME (100ns since 1601) → Unix epoch offset */
const FILETIME_UNIX_EPOCH_DIFF = 116444736000000000n

type Kernel32ProcTimes = {
  OpenProcess: (
    desiredAccess: number,
    inheritHandle: number,
    processId: number,
  ) => unknown
  GetProcessTimes: (
    handle: unknown,
    creationTime: Uint8Array,
    exitTime: Uint8Array,
    kernelTime: Uint8Array,
    userTime: Uint8Array,
  ) => number
  CloseHandle: (handle: unknown) => number
}

/** densable `p7r` — undefined not tried, null failed, else symbols */
let kernel32Symbols: Kernel32ProcTimes | null | undefined
/** densable `GWg` — force-disable FFI path (tests) */
let win32ProcTimesFfiDisabled = false

/**
 * densable `B8c` — lazy-load kernel32 OpenProcess/GetProcessTimes/CloseHandle.
 * Returns null when not win32 or bun:ffi unavailable.
 */
function loadKernel32ProcTimes(): Kernel32ProcTimes | null {
  if (kernel32Symbols !== undefined) return kernel32Symbols
  if (process.platform !== 'win32' || win32ProcTimesFfiDisabled) {
    kernel32Symbols = null
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffi = require('bun:ffi') as typeof import('bun:ffi')
    kernel32Symbols = ffi.dlopen('kernel32.dll', {
      OpenProcess: { args: ['u32', 'i32', 'u32'], returns: 'ptr' },
      GetProcessTimes: {
        args: ['ptr', 'ptr', 'ptr', 'ptr', 'ptr'],
        returns: 'i32',
      },
      CloseHandle: { args: ['ptr'], returns: 'i32' },
    }).symbols as Kernel32ProcTimes
    logForDebugging('[win32-proc-times] bun:ffi loaded, using procStartFt')
  } catch (e) {
    logForDebugging(
      `[win32-proc-times] bun:ffi unavailable, falling back to spawn: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
    kernel32Symbols = null
  }
  return kernel32Symbols
}

/** densable `BMt` — FFI path usable? */
export function isWin32ProcTimesFfiAvailable(): boolean {
  return !win32ProcTimesFfiDisabled && loadKernel32ProcTimes() !== null
}

/**
 * densable `Aao` — raw creation FILETIME as BigUint64 (100ns ticks since 1601).
 * Undefined on non-win32 / bad pid / OpenProcess/GetProcessTimes fail.
 */
export function getWin32CreationFileTime(pid: number): bigint | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  const t = loadKernel32ProcTimes()
  if (t == null) return undefined
  const handle = t.OpenProcess(PROCESS_QUERY_INFORMATION, 0, pid)
  if (!handle) return undefined
  try {
    const creation = new Uint8Array(8)
    const exit = new Uint8Array(8)
    const kernel = new Uint8Array(8)
    const user = new Uint8Array(8)
    // densable: GetProcessTimes returns 0 on failure
    if (t.GetProcessTimes(handle, creation, exit, kernel, user) === 0) {
      return undefined
    }
    return new DataView(creation.buffer).getBigUint64(0, true)
  } catch {
    return undefined
  } finally {
    t.CloseHandle(handle)
  }
}

/** densable `j8c` — FILETIME → Unix epoch ms */
export function fileTimeToUnixMs(fileTime: bigint): number {
  return Number((fileTime - FILETIME_UNIX_EPOCH_DIFF) / 10000n)
}

/**
 * densable `X6g`/`qWg` threshold — separates FILETIME (~1e17) from
 * .NET DateTime.Ticks (~6e17) so cross-format identity can match.
 */
const PROC_START_FORMAT_THRESHOLD = 300000000000000000

export type ProcessStartIdentityFields = {
  procStart?: string
  procStartFt?: string
}

/**
 * densable `UHt`/`jMt` — place identity into procStart vs procStartFt
 * based on whether kernel32 FFI is active (BMt).
 */
export function buildProcessStartIdentityFields(
  identity: string | undefined,
): ProcessStartIdentityFields {
  if (identity === undefined) return {}
  if (isWin32ProcTimesFfiAvailable()) {
    return { procStartFt: identity }
  }
  return { procStart: identity }
}

/**
 * densable `AFe`/`kUe` — pick the live identity field from a lock/record.
 * When FFI is on: only `procStartFt` is valid; a defined `procStart` yields void
 * (legacy PowerShell stamp while BMt is true → no identity).
 */
export function pickProcessStartIdentity(fields: {
  procStart?: unknown
  procStartFt?: unknown
}): unknown {
  if (isWin32ProcTimesFfiAvailable()) {
    return fields.procStart !== undefined ? undefined : fields.procStartFt
  }
  return fields.procStart
}

/**
 * densable `X6g`/`qWg` — cross-format numeric identity (FILETIME ↔ Ticks).
 */
export function isCrossFormatProcessStartMatch(
  a: unknown,
  b: unknown,
): boolean {
  if (!isWin32ProcTimesFfiAvailable()) return false
  const r = Number(a)
  const n = Number(b)
  return (
    Number.isFinite(r) &&
    Number.isFinite(n) &&
    r > PROC_START_FORMAT_THRESHOLD !== n > PROC_START_FORMAT_THRESHOLD
  )
}

/**
 * densable `Yzc`/`z8c` — identity still matches when current is undefined
 * (ps race), equal, or cross-format FILETIME/Ticks pair on win32 FFI.
 */
export function processStartIdentityEquals(
  expected: unknown,
  current: unknown,
): boolean {
  return (
    current === undefined ||
    current === expected ||
    isCrossFormatProcessStartMatch(expected, current)
  )
}

/** densable `YId` / `OMn` — memoized own process start identity. */
let ownProcStartToken: string | undefined

/** Test seam: reset lazy FFI + optional force-disable (densable GWg). */
export function _resetWin32ProcTimesForTesting(opts?: {
  disableFfi?: boolean
}): void {
  kernel32Symbols = undefined
  win32ProcTimesFfiDisabled = opts?.disableFfi === true
}

/** Test seam: reset densable `OMn` own-procStart memo. */
export function _resetOwnProcStartForTesting(): void {
  ownProcStartToken = undefined
}

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
 * densable `JWg` / Ex — process start identity token.
 * - win32 + kernel32 FFI: FILETIME creation ticks as decimal string (`procStartFt`)
 * - win32 fallback: PowerShell `Win32_Process.CreationDate.Ticks`
 * - unix: raw `ps -o lstart=` (LC_ALL=C TZ=UTC)
 */
export async function getProcessLstartString(
  pid: number,
): Promise<string | undefined> {
  if (pid <= 1) return undefined
  if (process.platform === 'win32') {
    try {
      if (isWin32ProcTimesFfiAvailable()) {
        const ft = getWin32CreationFileTime(pid)
        return ft === undefined ? undefined : ft.toString()
      }
      const result = await execFileNoThrowWithCwd(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CreationDate.Ticks`,
        ],
        { timeout: 1000 },
      )
      if (result.code === 0 && result.stdout?.trim()) {
        return result.stdout.trim()
      }
      return undefined
    } catch {
      return undefined
    }
  }
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
 * densable `ies` / Dmi — process creation time as Unix epoch ms.
 * win32: kernel32 FILETIME (preferred) or PowerShell DateTimeOffset ms.
 * unix: parse `ps -o lstart=` as UTC.
 */
export async function getProcessStartTimeMs(
  pid: number,
): Promise<number | null> {
  if (pid <= 1) return null
  if (process.platform === 'win32') {
    try {
      if (isWin32ProcTimesFfiAvailable()) {
        const ft = getWin32CreationFileTime(pid)
        return ft === undefined ? null : fileTimeToUnixMs(ft)
      }
      const result = await execFileNoThrowWithCwd(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `[DateTimeOffset]::new((Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CreationDate).ToUnixTimeMilliseconds()`,
        ],
        { timeout: 1000 },
      )
      const ms = Number(result.stdout?.trim())
      return result.code === 0 && Number.isFinite(ms) ? ms : null
    } catch {
      return null
    }
  }
  const lstart = await getProcessLstartString(pid)
  if (lstart === undefined) return null
  const ms = Date.parse(`${lstart} UTC`)
  return Number.isFinite(ms) ? ms : null
}

/**
 * densable zU / nU / iB — identity still matches when expected is undefined,
 * current is undefined (ps race), equal, or win32 cross-format (Yzc).
 */
export async function processLstartMatches(
  pid: number,
  expectedLstart: string | undefined,
): Promise<boolean> {
  if (expectedLstart === undefined) return true
  const current = await getProcessLstartString(pid)
  return processStartIdentityEquals(expectedLstart, current)
}

/** densable `n$` — alias used by bridge-pointer occupancy / crash-reuse. */
export const isSameProcessAsync = processLstartMatches

/**
 * densable `ife` — own process start identity, memoized (`OMn.token??OMn.set`).
 * `undefined` is not cached (`??` retries) so a transient `ps` miss can recover.
 */
export async function ownProcStartAsync(): Promise<string | undefined> {
  return (
    ownProcStartToken ??
    (ownProcStartToken = await getProcessLstartString(process.pid))
  )
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
    // densable: if await Ex(e,{skipCache:!0}) !== r return (no kill).
    // undefined current (ps fail) !== expected → no kill.
    // Cross-format FILETIME/Ticks still counts as match (qWg/X6g).
    if (current === undefined) return false
    if (
      current !== procStart &&
      !isCrossFormatProcessStartMatch(procStart, current)
    ) {
      return false
    }
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
