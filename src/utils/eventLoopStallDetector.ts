/**
 * densable 2.1.217 event-loop stall detector (r1S / startEventLoopStallDetector).
 *
 * densable:
 *   ckn=200, etm=500, e1S=5000
 *   setInterval every 200ms; if actual gap - expected > 500ms → stall
 *   if stall > 5000ms → likely_sleep → bd.get(stdout)?.reassertTerminalModes()
 *   (includeAltScreen default false — densable does NOT pass true)
 *
 * Official only starts for USER_TYPE==="ant" in main; we keep that gate at
 * the call site. This module is the real implementation (was a stub).
 */

import { instances } from '@anthropic/ink'

const INTERVAL_MS = 200
const STALL_THRESHOLD_MS = 500
/** densable e1S — stalls longer than this are treated as sleep/wake. */
const SLEEP_THRESHOLD_MS = 5000

let timer: ReturnType<typeof setInterval> | null = null
let lastTickAt = 0
let totalStalls = 0
let cumulativeStallMs = 0
let tickCount = 0
let lastCpuSample: CpuSample | null = null

type CpuSample = {
  cpuTimeMs: number
  majorPageFaults: number
}

/**
 * densable Enl — sample CPU + major page faults via process.resourceUsage().
 */
export function sampleCpuAndPageFaults(): CpuSample | null {
  try {
    const u = process.resourceUsage()
    return {
      cpuTimeMs: (u.userCPUTime + u.systemCPUTime) / 1000,
      majorPageFaults: u.majorPageFault,
    }
  } catch (e) {
    // densable logs via T(); keep quiet in production path
    if (process.env.CLAUDE_CODE_DEBUG) {
      console.error(
        `[event-loop-stall] process.resourceUsage() failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    return null
  }
}

/**
 * densable ttm / sampleRss — memory sample for stall telemetry.
 */
export function sampleRss(): {
  rss_mb: number
  heap_used_mb: number
  ext_mb: number
} | null {
  try {
    const m = process.memoryUsage()
    return {
      rss_mb: Math.round(m.rss / 1024 / 1024),
      heap_used_mb: Math.round(m.heapUsed / 1024 / 1024),
      ext_mb: Math.round(m.external / 1024 / 1024),
    }
  } catch (e) {
    if (process.env.CLAUDE_CODE_DEBUG) {
      console.error(
        `[event-loop-stall] process.memoryUsage() failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    return null
  }
}

/**
 * densable r1S / startEventLoopStallDetector.
 * Idempotent. Interval is unref'd so it does not keep the process alive.
 */
export function startEventLoopStallDetector(): void {
  if (timer !== null) return
  lastTickAt = Date.now()
  lastCpuSample = sampleCpuAndPageFaults()
  if (process.env.CLAUDE_CODE_DEBUG) {
    console.error(
      `[event-loop-stall] detector started (interval=${INTERVAL_MS}ms, threshold=${STALL_THRESHOLD_MS}ms)`,
    )
  }
  timer = setInterval(() => {
    const now = Date.now()
    const actual = now - lastTickAt
    const over = actual - INTERVAL_MS
    tickCount++
    const cpu = sampleCpuAndPageFaults()
    if (over > STALL_THRESHOLD_MS) {
      totalStalls++
      cumulativeStallMs += over
      const likelySleep = over > SLEEP_THRESHOLD_MS
      const mem = sampleRss()
      const cpuDelta =
        cpu && lastCpuSample
          ? {
              cpu_delta_ms: Math.round(cpu.cpuTimeMs - lastCpuSample.cpuTimeMs),
              major_fault_delta:
                cpu.majorPageFaults - lastCpuSample.majorPageFaults,
            }
          : null
      if (process.env.CLAUDE_CODE_DEBUG) {
        console.error(
          `[event-loop-stall] blocked for ${over}ms (expected ${INTERVAL_MS}ms, actual ${actual}ms). Total stalls: ${totalStalls}, cumulative: ${cumulativeStallMs}ms${likelySleep ? ' [likely sleep/wake]' : ''}` +
            (cpuDelta
              ? ` cpu=${cpuDelta.cpu_delta_ms}ms majflt=${cpuDelta.major_fault_delta}`
              : '') +
            (mem
              ? ` rss=${mem.rss_mb}MB heap=${mem.heap_used_mb}MB ext=${mem.ext_mb}MB`
              : ''),
        )
      }
      // densable: O("tengu_event_loop_stall", {...}) — analytics may be no-op
      // in this fork; skip hard dependency on analytics package here.
      // densable: if (likely_sleep) reassertTerminalModes() — default false
      // includeAltScreen (stdin-gap style; does NOT erase alt buffer).
      if (likelySleep) {
        instances.get(process.stdout)?.reassertTerminalModes()
      }
    }
    lastTickAt = now
    lastCpuSample = cpu
  }, INTERVAL_MS)
  timer.unref?.()
}

/** Test-only stop. densable has no public stop; process exit clears. */
export function _stopEventLoopStallDetectorForTesting(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
  lastTickAt = 0
  totalStalls = 0
  cumulativeStallMs = 0
  tickCount = 0
  lastCpuSample = null
}

export function _getEventLoopStallStatsForTesting(): {
  totalStalls: number
  cumulativeStallMs: number
  tickCount: number
  running: boolean
} {
  return {
    totalStalls,
    cumulativeStallMs,
    tickCount,
    running: timer !== null,
  }
}
