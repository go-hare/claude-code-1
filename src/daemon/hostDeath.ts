/**
 * densable 2.1.247 #15 — terminal host process died (EHOSTDEAD).
 *
 * Official constants @ 208925404:
 *   ct="EHOSTDEAD"
 *   dt="terminal host process died — press Enter to restart"
 *   ut="This session's terminal host process died (the conversation is saved)"
 *   gt="terminal host process died — its output is gone; the command was not run again"
 *   mt="This command's terminal host process died — its output is gone and the command was not run again"
 *   ht=/ESTALLED|EUNVERIFIED|EHOSTDEAD/
 *
 * Official `ze` (wi): `e==="Z"||e==="X"`.
 * Official `Ge` (stat state): after last `)`, first token.
 *
 * win32 `Di` is GetExitCodeProcess via bun:ffi. `dist/cli.js` also runs
 * under Node, where bun:ffi is absent (same class as #25 Bun.stripANSI).
 * Node adapter: Win32_Process listed → alive; missing → X. Do not invent
 * PTY `kill(0)` — gold checkPid only probes when `!this.pty`.
 */

/** Official ct / kn */
export const EHOSTDEAD = 'EHOSTDEAD'

/** Official lowercase wire/enum token next to enojob/etimeout. */
export const EHOSTDEAD_LOWER = 'ehostdead'

/** Official dt / $i — session kill detail (row / press Enter). */
export const HOST_DEAD_SESSION_DETAIL =
  'terminal host process died \u2014 press Enter to restart'

/** Official ut / fn — session attach error. */
export const HOST_DEAD_SESSION_ATTACH_ERROR =
  "This session's terminal host process died (the conversation is saved)"

/** Official gt / Gi — exec kill detail. */
export const HOST_DEAD_EXEC_DETAIL =
  'terminal host process died \u2014 its output is gone; the command was not run again'

/** Official mt / pn — exec attach error. */
export const HOST_DEAD_EXEC_ATTACH_ERROR =
  "This command's terminal host process died \u2014 its output is gone and the command was not run again"

/** Official ht — attach-fail class (247 adds EHOSTDEAD to 246 ESTALLED|EUNVERIFIED). */
export const ATTACH_FAIL_CLASS_RE = /ESTALLED|EUNVERIFIED|EHOSTDEAD/

/** Official STILL_ACTIVE for GetExitCodeProcess (win32 Di). */
export const WIN32_STILL_ACTIVE = 259

/** Official PROCESS_QUERY_LIMITED_INFORMATION (same 4096 as B8c). */
const PROCESS_QUERY_LIMITED_INFORMATION = 4096

type Kernel32ExitCode = {
  OpenProcess: (
    desiredAccess: number,
    inheritHandle: number,
    processId: number,
  ) => unknown
  GetExitCodeProcess: (handle: unknown, exitCode: Uint32Array) => number
  CloseHandle: (handle: unknown) => number
}

let kernel32Exit: Kernel32ExitCode | null | undefined
/** Test seam — force the Node spawn adapter (densable GWg analogue). */
let win32HostDeathFfiDisabled = false
let win32HostLivenessProbe:
  | ((pid: number) => Promise<'alive' | 'gone' | undefined>)
  | undefined

export type Win32HostProcessProbe =
  | { kind: 'exit-code'; code: number }
  | { kind: 'alive' }
  | { kind: 'gone' }
  | { kind: 'unknown' }

/**
 * win32 Di letter. FFI exit-code !== 259 → `X`.
 * Node adapter (no bun:ffi): a missing Win32_Process row is `X`.
 */
export function classifyWin32HostProcessState(
  probe: Win32HostProcessProbe,
): 'X' | undefined {
  switch (probe.kind) {
    case 'exit-code':
      return probe.code === WIN32_STILL_ACTIVE ? undefined : 'X'
    case 'gone':
      return 'X'
    case 'alive':
    case 'unknown':
      return undefined
  }
}

/** Test seam: reset lazy FFI + optional force-disable / injected probe. */
export function _resetWin32HostDeathForTesting(opts?: {
  disableFfi?: boolean
  probe?: (pid: number) => Promise<'alive' | 'gone' | undefined>
}): void {
  kernel32Exit = undefined
  win32HostDeathFfiDisabled = opts?.disableFfi === true
  win32HostLivenessProbe = opts?.probe
}

function loadKernel32ExitCode(): Kernel32ExitCode | null {
  if (kernel32Exit !== undefined) return kernel32Exit
  if (process.platform !== 'win32' || win32HostDeathFfiDisabled) {
    kernel32Exit = null
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffi = require('bun:ffi') as typeof import('bun:ffi')
    kernel32Exit = ffi.dlopen('kernel32.dll', {
      OpenProcess: { args: ['u32', 'i32', 'u32'], returns: 'ptr' },
      GetExitCodeProcess: { args: ['ptr', 'ptr'], returns: 'i32' },
      CloseHandle: { args: ['ptr'], returns: 'i32' },
    }).symbols as Kernel32ExitCode
  } catch (e) {
    try {
      const { logForDebugging } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/debug.js') as typeof import('../utils/debug.js')
      logForDebugging(
        `[win32-host-death] bun:ffi unavailable, falling back to spawn: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    } catch {
      // debug.ts pulls bootstrap state; ignore if that graph is not ready
    }
    kernel32Exit = null
  }
  return kernel32Exit
}

/** Official Ge — /proc/<pid>/stat state token after comm. */
export function parseProcStatState(stat: string): string | undefined {
  const r = stat.lastIndexOf(')')
  if (r < 0) return undefined
  const n = stat.slice(r + 2)
  const t = n.indexOf(' ')
  const o = t < 0 ? n : n.slice(0, t)
  return o.length === 0 ? undefined : o
}

/** Official ze / wi — unreaped dead host. */
export function isUnreapedHostDeadState(state: string | undefined): boolean {
  return state === 'Z' || state === 'X'
}

function getWin32ExitCode(pid: number): number | undefined {
  const k32 = loadKernel32ExitCode()
  if (k32 == null) return undefined
  const handle = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
  if (!handle) return undefined
  try {
    const exitCode = new Uint32Array(1)
    if (k32.GetExitCodeProcess(handle, exitCode) === 0) return undefined
    return exitCode[0]
  } catch {
    return undefined
  } finally {
    k32.CloseHandle(handle)
  }
}

/**
 * Node adapter when bun:ffi is absent. Win32_Process lists live
 * processes only — missing row ≡ not live. Same spawn family as
 * genericProcessUtils JWg fallback; not official Di.
 */
async function probeWin32HostLivenessViaSpawn(
  pid: number,
): Promise<'alive' | 'gone' | undefined> {
  try {
    const { execFileNoThrowWithCwd } = await import(
      '../utils/execFileNoThrow.js'
    )
    const result = await execFileNoThrowWithCwd(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `if (Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`,
      ],
      { timeout: 1000 },
    )
    const token = result.stdout?.trim().toLowerCase()
    if (result.code === 0 && (token === 'alive' || token === 'gone')) {
      return token
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Official Di — host process state letter.
 * linux: Ge(/proc/pid/stat). win32: GetExitCodeProcess → "X" when not live.
 * Node without bun:ffi: Win32_Process listing → "X" when missing.
 */
export async function getHostProcessState(
  pid: number,
): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  if (process.platform === 'linux') {
    try {
      const { readFile } = await import('fs/promises')
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
      return parseProcStatState(stat)
    } catch {
      return undefined
    }
  }
  if (process.platform === 'win32') {
    const code = getWin32ExitCode(pid)
    if (code !== undefined) {
      return classifyWin32HostProcessState({ kind: 'exit-code', code })
    }
    // FFI loaded: OpenProcess/GetExitCode fail-open matches official Di.
    if (loadKernel32ExitCode() != null) return undefined
    const probe = win32HostLivenessProbe ?? probeWin32HostLivenessViaSpawn
    const listing = await probe(pid)
    return classifyWin32HostProcessState(
      listing === 'gone'
        ? { kind: 'gone' }
        : listing === 'alive'
          ? { kind: 'alive' }
          : { kind: 'unknown' },
    )
  }
  return undefined
}

/** Official attach error body: exec ? pn : fn */
export function hostDeadAttachError(mode: string | undefined): string {
  return mode === 'exec'
    ? HOST_DEAD_EXEC_ATTACH_ERROR
    : HOST_DEAD_SESSION_ATTACH_ERROR
}

/** Official kill detail: exec ? Gi : $i */
export function hostDeadKillDetail(mode: string | undefined): string {
  return mode === 'exec' ? HOST_DEAD_EXEC_DETAIL : HOST_DEAD_SESSION_DETAIL
}

/**
 * Official ah: `a.msg.startsWith(`${kn}:`)` then `slice(kn.length+1).trim()`.
 * Does not invent Xe (conversation-saved) or the "restart it" suffix.
 */
export function formatHostDeadAttachError(msg: string): string | undefined {
  if (msg.startsWith(`${EHOSTDEAD}:`)) {
    const body = msg.slice(EHOSTDEAD.length + 1).trim()
    return body || HOST_DEAD_SESSION_ATTACH_ERROR
  }
  if (msg === EHOSTDEAD || msg === EHOSTDEAD_LOWER) {
    return HOST_DEAD_SESSION_ATTACH_ERROR
  }
  if (
    msg === HOST_DEAD_SESSION_ATTACH_ERROR ||
    msg === HOST_DEAD_SESSION_DETAIL ||
    msg === HOST_DEAD_EXEC_ATTACH_ERROR ||
    msg === HOST_DEAD_EXEC_DETAIL
  ) {
    return msg
  }
  return undefined
}
