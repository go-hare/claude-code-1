/**
 * densable 2.1.233 #3 — Linux Bash/PowerShell tool memory cgroup (Qfp / h4b / g4b / y4b).
 *
 * Gold (SEA):
 *   $ga = "claude-code-bash"
 *   m4b = 1<<30 (1 GiB reserve unit)
 *   Qfp():
 *     memoized kZt
 *     only linux|wsl
 *     CLAUDE_CODE_TOOL_MEMORY_LIMIT falsy/"none" → disable
 *     parse limit via y4b; if unset require GB tengu_tool_memory_cgroup
 *     default limit g4b(totalmem) = floor(total - max(2GiB, 15% total))
 *     create /sys/fs/cgroup/.../claude-code-bash + write memory.max|limit_in_bytes
 *   spawn: cgroup: useToolMemoryCgroup ? Qfp() : undefined
 *   SEA gold: yhp.spawn(U,J,{cgroup:y?Qfp():void 0,...})
 *
 * Local: Bun's child_process.spawn accepts `cgroup` (atomic, densable 1:1).
 * Pure Node has no cgroup option — fallback writes pid to cgroup.procs.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { totalmem } from 'os'
import { join, posix } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import { isEnvDefinedFalsy } from '../envUtils.js'
import { errorMessage } from '../errors.js'
import { getPlatform } from '../platform.js'

const TOOL_CGROUP_NAME = 'claude-code-bash'
/** densable m4b — 1 GiB */
const HOST_RESERVE_BYTES = 1_073_741_824

/** densable kZt — undefined=unresolved, null=disabled, string=cgroup dir */
let memoizedCgroupDir: string | null | undefined

/** densable y4b — parse "512m" / "2G" / "1048576" → bytes */
export function parseToolMemoryLimitBytes(
  raw: string | undefined,
): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*([kmgt]?)(?:i?b)?$/i.exec(raw?.trim() ?? '')
  if (!m) return undefined
  const unit = (m[2] || ' ').toLowerCase()
  const mult = 1024 ** ' kmgt'.indexOf(unit)
  const n = Number(m[1]) * mult
  return n > 0 ? Math.floor(n) : undefined
}

/** densable g4b — leave max(2GiB, 15% RAM) for the host */
export function defaultToolMemoryLimitBytes(
  totalBytes: number = totalmem(),
): number {
  return Math.floor(
    totalBytes - Math.max(2 * HOST_RESERVE_BYTES, totalBytes * 0.15),
  )
}

/**
 * densable h4b — parse /proc/self/cgroup → memory controller leaf for our slice.
 * v1: controllers include "memory" → /sys/fs/cgroup/memory/<path>/claude-code-bash
 * v2: hierarchy id 0 empty controllers → /sys/fs/cgroup/<parent>/claude-code-bash
 */
export function parseMemoryCgroupTarget(
  cgroupFileContents: string,
): { dir: string; v2: boolean } | undefined {
  let v2Path: string | undefined
  for (const line of cgroupFileContents.split('\n')) {
    const parts = line.split(':')
    const id = parts[0]
    const controllers = parts[1]
    const path = parts[2]
    if (controllers === undefined || path === undefined) continue
    if (controllers.split(',').includes('memory')) {
      return {
        dir: posix.join('/sys/fs/cgroup/memory', path, TOOL_CGROUP_NAME),
        v2: false,
      }
    }
    if (id === '0' && controllers === '') {
      v2Path = path
    }
  }
  if (v2Path === undefined) return undefined
  // densable: if basename(t)===$ga return (already in our slice)
  if (posix.basename(v2Path) === TOOL_CGROUP_NAME) return undefined
  return {
    dir: posix.join('/sys/fs/cgroup', posix.dirname(v2Path), TOOL_CGROUP_NAME),
    v2: true,
  }
}

/**
 * densable Qfp — ensure tool memory cgroup exists; return dir or undefined.
 * Side-effectful (mkdir + write memory.max). Memoized for process lifetime
 * when resolved or disabled; leaves unresolved when GB gate not met.
 */
export function ensureToolMemoryCgroupDir(): string | undefined {
  if (memoizedCgroupDir !== undefined) {
    return memoizedCgroupDir ?? undefined
  }

  const platform = getPlatform()
  if (platform !== 'linux' && platform !== 'wsl') {
    memoizedCgroupDir = null
    return undefined
  }

  const raw = process.env.CLAUDE_CODE_TOOL_MEMORY_LIMIT?.trim().toLowerCase()
  if (raw && (isEnvDefinedFalsy(raw) || raw === 'none')) {
    memoizedCgroupDir = null
    return undefined
  }

  const parsedLimit = parseToolMemoryLimitBytes(raw)
  if (
    parsedLimit === undefined &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_tool_memory_cgroup', false) !==
      true
  ) {
    // densable: r===void 0 && !GB → return without setting kZt
    return undefined
  }

  try {
    const cgroupText = readFileSync('/proc/self/cgroup', 'utf8')
    const target = parseMemoryCgroupTarget(cgroupText)
    if (!target) {
      throw new Error('no memory cgroup hierarchy')
    }
    const limitBytes = parsedLimit ?? defaultToolMemoryLimitBytes()
    try {
      mkdirSync(target.dir, { recursive: true })
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : undefined
      if (code !== 'EEXIST') throw err
    }
    const limitFile = join(
      target.dir,
      target.v2 ? 'memory.max' : 'memory.limit_in_bytes',
    )
    writeFileSync(limitFile, String(limitBytes))
    memoizedCgroupDir = target.dir
    logForDebugging(`tool cgroup: ${target.dir} limit=${limitBytes}`)
    logEvent('tengu_tool_cgroup', {
      status:
        'enabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      limit_bytes: limitBytes,
    })
    return target.dir
  } catch (err) {
    memoizedCgroupDir = null
    logForDebugging(
      `tool cgroup: disabled (${errorMessage(err) ?? String(err)})`,
    )
    logEvent('tengu_tool_cgroup', {
      status:
        'disabled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return undefined
  }
}

/**
 * densable product path uses atomic spawn `cgroup: Qfp()` (Bun).
 * Pure Node `child_process.spawn` has no cgroup option — Shell.ts falls back
 * to writing the child pid into `<dir>/cgroup.procs` after spawn.
 */
export function attachPidToToolMemoryCgroup(pid: number | undefined): void {
  if (pid === undefined || !Number.isFinite(pid) || pid <= 0) return
  const dir = ensureToolMemoryCgroupDir()
  if (!dir) return
  try {
    writeFileSync(join(dir, 'cgroup.procs'), String(pid))
  } catch (err) {
    logForDebugging(
      `tool cgroup: failed to attach pid ${pid}: ${errorMessage(err)}`,
    )
  }
}

/**
 * densable spawn option resolver: `y ? Qfp() : void 0`.
 * Bun path passes this as `cgroup:`; Node path ignores and uses attach.
 */
export function resolveToolMemoryCgroupForSpawn(
  useToolMemoryCgroup: boolean | undefined,
): string | undefined {
  if (!useToolMemoryCgroup) return undefined
  return ensureToolMemoryCgroupDir()
}

/** Test helper — clear densable kZt memo. */
export function resetToolMemoryCgroupMemoForTests(): void {
  memoizedCgroupDir = undefined
}
