/**
 * Startup profiling utility for measuring and reporting time spent in various
 * initialization phases.
 *
 * Two modes:
 * 1. Sampled logging: 100% of ant users, 0.1% of external users - logs phases to Statsig
 * 2. Detailed profiling: CLAUDE_CODE_PROFILE_STARTUP=1 - full report with memory snapshots
 *
 * Uses Node.js built-in performance hooks API for standard timing measurement.
 */

import { dirname, join } from 'path'
import { getSessionId } from 'src/bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { HostSlot } from './hostSlot.js'
import { formatMs, formatTimelineLine, getPerformance } from './profilerBase.js'
import {
  isProfileStartupEnabled,
  resolveSpawnToFirstCheckpointMs,
} from './residualFinalEnvGates.js'
import { getBootstrapSessionHost } from './sessionRoot.js'
import { writeFileSync_DEPRECATED } from './slowOperations.js'

// Module-level state - decided once at module load.
// Official PROFILE_STARTUP densable (top-level requires eager eval).
// eslint-disable-next-line custom-rules/no-process-env-top-level
const DETAILED_PROFILING = (() => {
  try {
    return isProfileStartupEnabled()
  } catch {
    return isEnvTruthy(process.env.CLAUDE_CODE_PROFILE_STARTUP)
  }
})()

// Sampling for Statsig logging: 100% ant, 0.5% external
// Decision made once at startup - non-sampled users pay no profiling cost
const STATSIG_SAMPLE_RATE = 0.005
// eslint-disable-next-line custom-rules/no-process-env-top-level
const STATSIG_LOGGING_SAMPLED =
  process.env.USER_TYPE === 'ant' || Math.random() < STATSIG_SAMPLE_RATE

function isDetailedProfilingActive(): boolean {
  return (
    DETAILED_PROFILING || isEnvTruthy(process.env.CLAUDE_CODE_PROFILE_STARTUP)
  )
}

function isStatsigLoggingSampled(): boolean {
  return STATSIG_LOGGING_SAMPLED || process.env.USER_TYPE === 'ant'
}

function shouldProfile(): boolean {
  return isDetailedProfilingActive() || isStatsigLoggingSampled()
}

type StartupMark = {
  name: string
  startTime: number
}

type StartupProfilerHostState = {
  marks: StartupMark[]
  // Track memory snapshots separately (perf_hooks doesn't track memory).
  // Only used when DETAILED_PROFILING is enabled.
  // Stored as an array that appends in the same order as marks, so
  // memorySnapshots[i] corresponds to marks[i].
  memorySnapshots: NodeJS.MemoryUsage[]
  recordedPhases: Record<string, number>
  recordedPhaseStarts: Record<string, number>
  recordedPhasesConsumed: boolean
  onceMarkedCheckpoints: Set<string>
  startupContext: Record<string, unknown>
  reported: boolean
}

const startupProfilerHostSlot = new HostSlot<StartupProfilerHostState>(() => ({
  marks: [],
  memorySnapshots: [],
  recordedPhases: {},
  recordedPhaseStarts: {},
  recordedPhasesConsumed: false,
  onceMarkedCheckpoints: new Set<string>(),
  startupContext: {},
  reported: false,
}))

function getStartupProfilerState(): StartupProfilerHostState {
  return startupProfilerHostSlot.of(getBootstrapSessionHost())
}

// Phase definitions for Statsig logging: [startCheckpoint, endCheckpoint]
const PHASE_DEFINITIONS = {
  import_time: ['cli_entry', 'main_tsx_imports_loaded'],
  init_time: ['init_function_start', 'init_function_end'],
  settings_time: ['eagerLoadSettings_start', 'eagerLoadSettings_end'],
  total_time: ['cli_entry', 'main_after_run'],
} as const

// Record initial checkpoint if profiling is enabled
if (DETAILED_PROFILING || STATSIG_LOGGING_SAMPLED) {
  // eslint-disable-next-line custom-rules/no-top-level-side-effects
  profileCheckpoint('profiler_initialized')
}

/**
 * densable `Zo` / `recordPhase` @179674022.
 * `await_initialize_ms` is recorded from main preAction after zqr.
 */
export function recordStartupPhase(
  name: string,
  durationMs: number,
  startMs?: number,
): void {
  const state = getStartupProfilerState()
  if (state.recordedPhasesConsumed) return
  if (name === 'skills_load_ms' && state.recordedPhases[name] !== undefined) {
    return
  }
  state.recordedPhases[name] = Math.round(durationMs)
  if (startMs !== undefined) {
    state.recordedPhaseStarts[name] = Math.round(startMs)
  }
}

export function getRecordedStartupPhase(name: string): number | undefined {
  return getStartupProfilerState().recordedPhases[name]
}

export function getRecordedStartupPhaseStart(name: string): number | undefined {
  return getStartupProfilerState().recordedPhaseStarts[name]
}

export function resetRecordedStartupPhasesForTesting(): void {
  const state = getStartupProfilerState()
  state.recordedPhasesConsumed = false
  for (const key of Object.keys(state.recordedPhases)) {
    delete state.recordedPhases[key]
  }
  for (const key of Object.keys(state.recordedPhaseStarts)) {
    delete state.recordedPhaseStarts[key]
  }
}

/**
 * Record a checkpoint with the given name
 */
export function profileCheckpoint(name: string): void {
  if (!shouldProfile()) return

  const state = getStartupProfilerState()
  const perf = getPerformance()
  state.marks.push({ name, startTime: perf.now() })

  // Only capture memory when detailed profiling enabled (env var)
  if (isDetailedProfilingActive()) {
    state.memorySnapshots.push(process.memoryUsage())
  }
}

/**
 * densable `Ur(e,{once})` @176644790 — `ne` claim_received / claim_validated / spare_claimed.
 */
export function profileCheckpointOnce(name: string): boolean {
  if (!shouldProfile()) return false
  const state = getStartupProfilerState()
  if (state.onceMarkedCheckpoints.has(name)) return false
  state.onceMarkedCheckpoints.add(name)
  profileCheckpoint(name)
  return true
}

/**
 * densable `dN` @176644790 — merge into startupContext for tengu_spare_claimed extras.
 */
export function assignStartupContext(fields: Record<string, unknown>): void {
  if (!shouldProfile()) return
  Object.assign(getStartupProfilerState().startupContext, fields)
}

export function getStartupContext(): Record<string, unknown> {
  return getStartupProfilerState().startupContext
}

export function resetClaimProfilerForTests(): void {
  const state = getStartupProfilerState()
  state.onceMarkedCheckpoints.clear()
  for (const key of Object.keys(state.startupContext)) {
    delete state.startupContext[key]
  }
}

/**
 * Get a formatted report of all checkpoints
 * Only available when DETAILED_PROFILING is enabled
 */
function getReport(state: StartupProfilerHostState): string {
  if (!isDetailedProfilingActive()) {
    return 'Startup profiling not enabled'
  }

  const marks = state.marks
  if (marks.length === 0) {
    return 'No profiling checkpoints recorded'
  }

  const lines: string[] = []
  lines.push('='.repeat(80))
  lines.push('STARTUP PROFILING REPORT')
  lines.push('='.repeat(80))
  lines.push('')

  let prevTime = 0
  for (const [i, mark] of marks.entries()) {
    lines.push(
      formatTimelineLine(
        mark.startTime,
        mark.startTime - prevTime,
        mark.name,
        state.memorySnapshots[i],
        8,
        7,
      ),
    )
    prevTime = mark.startTime
  }

  const lastMark = marks[marks.length - 1]
  lines.push('')
  lines.push(`Total startup time: ${formatMs(lastMark?.startTime ?? 0)}ms`)
  lines.push('='.repeat(80))

  return lines.join('\n')
}

export function profileReport(): void {
  const state = getStartupProfilerState()
  if (state.reported) return
  state.reported = true

  // Log to Statsig (sampled: 100% ant, 0.1% external)
  logStartupPerf(state)

  // Output detailed report if CLAUDE_CODE_PROFILE_STARTUP=1
  if (isDetailedProfilingActive()) {
    // Write to file
    const path = getStartupPerfLogPath()
    const dir = dirname(path)
    const fs = getFsImplementation()
    fs.mkdirSync(dir)
    const report = getReport(state)
    writeFileSync_DEPRECATED(path, report, {
      encoding: 'utf8',
      flush: true,
    })

    logForDebugging('Startup profiling report:')
    logForDebugging(report)
  }

  // Clear startup marks to prevent accumulation in long-lived processes
  // (daemon, cron). After this point startup marks are no longer needed —
  // the report has been written and the Statsig event has been logged.
  state.marks.length = 0
  state.memorySnapshots.length = 0
}

export function isDetailedProfilingEnabled(): boolean {
  return isDetailedProfilingActive()
}

export function getStartupPerfLogPath(): string {
  return join(getClaudeConfigHomeDir(), 'startup-perf', `${getSessionId()}.txt`)
}

/**
 * Log startup performance phases to Statsig.
 * Only logs if this session was sampled at startup.
 */
function logStartupPerf(state: StartupProfilerHostState): void {
  // Only log if we were sampled
  if (!isStatsigLoggingSampled()) return

  const marks = state.marks
  if (marks.length === 0) return

  // Build checkpoint lookup
  const checkpointTimes = new Map<string, number>()
  for (const mark of marks) {
    checkpointTimes.set(mark.name, mark.startTime)
  }

  // Compute phase durations
  const metadata: Record<string, number | undefined> = {}

  for (const [phaseName, [startCheckpoint, endCheckpoint]] of Object.entries(
    PHASE_DEFINITIONS,
  )) {
    const startTime = checkpointTimes.get(startCheckpoint)
    const endTime = checkpointTimes.get(endCheckpoint)

    if (startTime !== undefined && endTime !== undefined) {
      metadata[`${phaseName}_ms`] = Math.round(endTime - startTime)
    }
  }

  // Add checkpoint count for debugging
  metadata.checkpoint_count = marks.length

  // Official $qa densable: spawn_to_first_checkpoint_ms when CCR/CLAUDE
  // SPAWN_TIMESTAMP_MS is set (remote runner cold-start latency).
  const firstMark = marks[0]
  const spawnToFirst = resolveSpawnToFirstCheckpointMs({
    firstCheckpointMs: firstMark?.startTime,
  })
  if (spawnToFirst !== undefined) {
    metadata.spawn_to_first_checkpoint_ms = spawnToFirst
  }

  logEvent(
    'tengu_startup_perf',
    metadata as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  )
}
