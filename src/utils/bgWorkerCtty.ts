/**
 * densable z() / L() — background daemon workers whose stdio is a pty but
 * not the controlling terminal. Editors that open /dev/tty (Emacs) need
 * login_tty(0) once at startup.
 *
 * Outcome switch callees rNt / _ / g / J live in
 * `src/cli/bg/bgWorkerCttyOutcome.ts` (gold-251-k #33).
 */
import { constants } from 'fs'
import { open } from 'fs/promises'
import { logForDebugging } from './debug.js'
import { getPlatform } from './platform.js'

export type BgWorkerCttyOutcome =
  | 'acquired'
  | 'already'
  | 'failed'
  | 'ffi_unavailable'
  | 'not_a_tty'
  | 'unsupported'
  | 'switched_off'

/** densable L — /dev/tty already openable. */
export async function devTtyAlreadyOpen(): Promise<boolean> {
  try {
    const handle = await open('/dev/tty', constants.O_RDWR | constants.O_NOCTTY)
    await handle.close()
    return true
  } catch {
    return false
  }
}

function loginTtyBinding(): ((fd: number) => number) | null {
  let ffi: typeof import('bun:ffi')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffi = require('bun:ffi') as typeof import('bun:ffi')
  } catch (error) {
    logForDebugging(
      `[bg-ctty] bun:ffi unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
  const libs =
    getPlatform() === 'macos'
      ? ['/usr/lib/libSystem.B.dylib', 'libSystem.B.dylib']
      : ['libc.so.6', 'libutil.so.1', 'libc.so']
  for (const lib of libs) {
    try {
      const opened = ffi.dlopen(lib, {
        login_tty: { args: ['i32'], returns: 'i32' },
      })
      return (fd: number) => Number(opened.symbols.login_tty(fd))
    } catch {
      // try the next libc candidate
    }
  }
  logForDebugging('[bg-ctty] no libc candidate exports login_tty')
  return null
}

/** densable z */
export async function acquireBgWorkerControllingTty(): Promise<
  Exclude<BgWorkerCttyOutcome, 'switched_off'>
> {
  if (getPlatform() === 'windows') return 'unsupported'
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) {
    return 'not_a_tty'
  }
  if (await devTtyAlreadyOpen()) return 'already'
  const login = loginTtyBinding()
  if (!login) return 'ffi_unavailable'
  if (login(0) !== 0) {
    logForDebugging('[bg-ctty] login_tty(0) failed', { level: 'warn' })
    return 'failed'
  }
  return 'acquired'
}

/**
 * densable startup: tengu_bg_worker_ctty (default on) awaits z();
 * otherwise L() ? already : switched_off.
 */
export async function ensureBgWorkerControllingTty(
  cttyEnabled: boolean,
): Promise<BgWorkerCttyOutcome> {
  if (cttyEnabled) return acquireBgWorkerControllingTty()
  return (await devTtyAlreadyOpen()) ? 'already' : 'switched_off'
}
