/**
 * densable Zpf path-kind probe — `rp.stat` + `/mnt/` transient retry + errno.
 *
 * Official (one Zpf for --plugin-dir and name@synced):
 *   try stat; on fail `_ = dt(err) ?? "UNKNOWN"`
 *   if `_` set, not ENOENT, and path starts with `/mnt/` → Pr(250) + restat
 *   missing: log current `_`; error.errno is `S` (non-ENOENT current, else
 *   first non-ENOENT, else omitted)
 */

import { stat } from 'fs/promises'
import type { PluginError } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { sleep } from '../sleep.js'

/** densable `Pr(250)` in Zpf. */
export const ZPF_MNT_RETRY_MS = 250

export type ZpfPathProbe =
  | { exists: true }
  | {
      exists: false
      /** Current stat errno — official `_`. */
      code: string
      /** Official `S` — omitted when both attempts are ENOENT. */
      errno?: string
    }

type ProbeIo = {
  stat?: (path: string) => Promise<unknown>
  delay?: (ms: number) => Promise<void>
}

function zpfErrno(err: unknown): string {
  return getErrnoCode(err) ?? 'UNKNOWN'
}

function missingErrno(
  current: string,
  first: string | undefined,
): string | undefined {
  if (current !== 'ENOENT') return current
  if (first !== undefined && first !== 'ENOENT') return first
  return undefined
}

export async function probeZpfPluginPath(
  resolvedPath: string,
  io: ProbeIo = {},
): Promise<ZpfPathProbe> {
  const statFn = io.stat ?? stat
  const delay = io.delay ?? sleep

  let code: string | undefined
  try {
    await statFn(resolvedPath)
  } catch (err) {
    code = zpfErrno(err)
  }
  const first = code

  if (
    code !== undefined &&
    code !== 'ENOENT' &&
    resolvedPath.startsWith('/mnt/')
  ) {
    await delay(ZPF_MNT_RETRY_MS)
    try {
      await statFn(resolvedPath)
      logForDebugging(
        `Plugin path ${resolvedPath}: first stat failed with ${code}, retry succeeded (transient mount race)`,
        { level: 'warn' },
      )
      code = undefined
    } catch (err) {
      code = zpfErrno(err)
    }
  }

  if (code === undefined) return { exists: true }

  const errno = missingErrno(code, first)
  return {
    exists: false,
    code,
    ...(errno !== undefined ? { errno } : {}),
  }
}

export function zpfPathNotFoundLog(
  resolvedPath: string,
  probe: Extract<ZpfPathProbe, { exists: false }>,
): string {
  const first =
    probe.errno && probe.errno !== probe.code ? `, first ${probe.errno}` : ''
  return `Plugin path does not exist: ${resolvedPath} (${probe.code}${first}), skipping`
}

export function zpfPathNotFoundError(
  source: string,
  resolvedPath: string,
  probe: Extract<ZpfPathProbe, { exists: false }>,
): PluginError {
  return {
    type: 'path-not-found',
    source,
    path: resolvedPath,
    component: 'commands',
    ...(probe.errno !== undefined ? { errno: probe.errno } : {}),
  }
}
