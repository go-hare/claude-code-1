/**
 * Perfetto Tracing for Claude Code (Ant-only)
 *
 * This module generates traces in the Chrome Trace Event format that can be
 * viewed in ui.perfetto.dev or Chrome's chrome://tracing.
 *
 * NOTE: This feature is ant-only and eliminated from external builds.
 *
 * The trace file includes:
 * - Agent hierarchy (parent-child relationships in a swarm)
 * - API requests with TTFT, TTLT, prompt length, cache stats, msg ID, speculative flag
 * - Tool executions with name, duration, and token usage
 * - User input waiting time
 *
 * Usage:
 * 1. Enable via CLAUDE_CODE_PERFETTO_TRACE=1 or CLAUDE_CODE_PERFETTO_TRACE=<path>
 * 2. Optionally set CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S=<positive integer> to write the
 *    trace file periodically (default: write only on exit).
 * 3. Run Claude Code normally
 * 4. Trace file is written to ~/.claude/traces/trace-<session-id>.json
 *    or to the specified path
 * 5. Open in ui.perfetto.dev to visualize
 */

import { feature } from 'bun:bundle'
import { mkdirSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import { type CleanupUnregister, registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import {
  getClaudeConfigHomeDir,
  isEnvDefinedFalsy,
  isEnvTruthy,
} from '../envUtils.js'
import { errorMessage } from '../errors.js'
import { djb2Hash } from '../hash.js'
import { HostSlot } from '../hostSlot.js'
import {
  exitSessionContext,
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  ofDefaultHost,
  runWithSession,
  type Session,
} from '../sessionRoot.js'
import { jsonStringify } from '../slowOperations.js'
import { getAgentId, getAgentName, getParentSessionId } from '../teammate.js'

/**
 * Chrome Trace Event format types
 * See: https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU
 */

export type TraceEventPhase =
  | 'B' // Begin duration event
  | 'E' // End duration event
  | 'X' // Complete event (with duration)
  | 'i' // Instant event
  | 'C' // Counter event
  | 'b' // Async begin
  | 'n' // Async instant
  | 'e' // Async end
  | 'M' // Metadata event

export type TraceEvent = {
  name: string
  cat: string
  ph: TraceEventPhase
  ts: number // Timestamp in microseconds
  pid: number // Process ID (we use 1 for main, agent IDs for subagents)
  tid: number // Thread ID (we use numeric hash of agent name or 1 for main)
  dur?: number // Duration in microseconds (for 'X' events)
  args?: Record<string, unknown>
  id?: string // For async events
  scope?: string
}

/**
 * Agent info for tracking hierarchy
 */
type AgentInfo = {
  agentId: string
  agentName: string
  parentAgentId?: string
  processId: number
  threadId: number
}

/**
 * Pending span for tracking begin/end pairs
 */
type PendingSpan = {
  name: string
  category: string
  startTime: number
  agentInfo: AgentInfo
  args: Record<string, unknown>
}

// events[] cap. Cron-driven sessions run for days; 22 push sites × many
// turns would otherwise grow unboundedly (periodicWrite flushes to disk but
// does not truncate — it writes the full snapshot). At ~300B/event this is
// ~30MB, enough trace history for any debugging session. Eviction drops the
// oldest half when hit, amortized O(1).
const MAX_EVENTS = 100_000
const STALE_SPAN_TTL_MS = 30 * 60 * 1000 // 30 minutes
const STALE_SPAN_CLEANUP_INTERVAL_MS = 60 * 1000 // 1 minute

type PerfettoHostState = {
  isEnabled: boolean | undefined
  tracePath: string | null
  // Metadata events (ph: 'M' — process/thread names, parent links) are kept
  // separate so they survive eviction — Perfetto UI needs them to label
  // tracks. Bounded by agent count (~3 events per agent).
  metadataEvents: TraceEvent[]
  events: TraceEvent[]
  pendingSpans: Map<string, PendingSpan>
  agentRegistry: Map<string, AgentInfo>
  totalAgentCount: number
  startTimeMs: number
  spanIdCounter: number
  traceWritten: boolean // Flag to avoid double writes
  // Map agent IDs to numeric process IDs (Perfetto requires numeric IDs)
  processIdCounter: number
  agentIdToProcessId: Map<string, number>
  // Periodic write interval handle
  writeIntervalId: ReturnType<typeof setInterval> | null
  staleSpanCleanupId: ReturnType<typeof setInterval> | null
  unregisterCleanup: CleanupUnregister | null
  trackedInLiveStates: boolean
  sessionIdSnapshot: string | null
  sessionRef: WeakRef<Session> | undefined
}

const perfettoHostSlot = new HostSlot<PerfettoHostState>(() => ({
  isEnabled: undefined,
  tracePath: null,
  metadataEvents: [],
  events: [],
  pendingSpans: new Map<string, PendingSpan>(),
  agentRegistry: new Map<string, AgentInfo>(),
  totalAgentCount: 0,
  startTimeMs: 0,
  spanIdCounter: 0,
  traceWritten: false,
  processIdCounter: 1,
  agentIdToProcessId: new Map<string, number>(),
  writeIntervalId: null,
  staleSpanCleanupId: null,
  unregisterCleanup: null,
  trackedInLiveStates: false,
  sessionIdSnapshot: null,
  sessionRef: undefined,
}))

function getOwnPerfettoHostState(): PerfettoHostState {
  return perfettoHostSlot.of(getBootstrapSessionHost())
}

function getActivePerfettoHostState(): PerfettoHostState {
  const own = getOwnPerfettoHostState()
  if (own.isEnabled !== undefined) {
    return own
  }
  const defaultState = ofDefaultHost(perfettoHostSlot)
  if (defaultState.isEnabled === true) {
    return defaultState
  }
  return own
}

// Shared single process-level exit/beforeExit listeners iterating WeakRefs so
// ephemeral hosts never accumulate process listeners.
const livePerfettoHostStates = new Set<WeakRef<PerfettoHostState>>()
let sharedPerfettoProcessHooksInstalled = false

function pruneDeadPerfettoHostStates(): void {
  for (const ref of livePerfettoHostStates) {
    if (ref.deref() === undefined) {
      livePerfettoHostStates.delete(ref)
    }
  }
}

function onSharedPerfettoBeforeExit(): void {
  for (const ref of livePerfettoHostStates) {
    const state = ref.deref()
    if (!state) {
      livePerfettoHostStates.delete(ref)
      continue
    }
    if (state.isEnabled === true && !state.traceWritten) {
      logForDebugging('[Perfetto] beforeExit handler invoked')
      void writePerfettoTrace(state)
    }
  }
}

function onSharedPerfettoExit(): void {
  for (const ref of livePerfettoHostStates) {
    const state = ref.deref()
    if (!state) {
      livePerfettoHostStates.delete(ref)
      continue
    }
    if (state.isEnabled === true && !state.traceWritten) {
      logForDebugging(
        '[Perfetto] exit handler invoked, writing trace synchronously',
      )
      writePerfettoTraceSync(state)
    }
  }
}

function ensureSharedPerfettoProcessHooksInstalled(): void {
  if (sharedPerfettoProcessHooksInstalled) return
  sharedPerfettoProcessHooksInstalled = true
  process.on('beforeExit', onSharedPerfettoBeforeExit)
  process.on('exit', onSharedPerfettoExit)
}

/**
 * Convert a string to a numeric hash for use as thread ID
 */
function stringToNumericHash(str: string): number {
  return Math.abs(djb2Hash(str)) || 1 // Ensure non-zero
}

/**
 * Get or create a numeric process ID for an agent
 */
function getProcessIdForAgent(
  state: PerfettoHostState,
  agentId: string,
): number {
  const existing = state.agentIdToProcessId.get(agentId)
  if (existing !== undefined) return existing

  state.processIdCounter++
  state.agentIdToProcessId.set(agentId, state.processIdCounter)
  return state.processIdCounter
}

/**
 * Get current agent info
 */
function getCurrentAgentInfo(state: PerfettoHostState): AgentInfo {
  const sessionId = getSessionId()
  if (state.sessionIdSnapshot === null) {
    state.sessionIdSnapshot = sessionId
  }
  const agentId = getAgentId() ?? sessionId
  const agentName = getAgentName() ?? 'main'
  const parentSessionId = getParentSessionId()

  // Check if we've already registered this agent
  const existing = state.agentRegistry.get(agentId)
  if (existing) return existing

  const info: AgentInfo = {
    agentId,
    agentName,
    parentAgentId: parentSessionId,
    processId:
      agentId === state.sessionIdSnapshot
        ? 1
        : getProcessIdForAgent(state, agentId),
    threadId: stringToNumericHash(agentName),
  }

  state.agentRegistry.set(agentId, info)
  state.totalAgentCount++
  return info
}

/**
 * Get timestamp in microseconds relative to trace start
 */
function getTimestamp(state: PerfettoHostState): number {
  return (Date.now() - state.startTimeMs) * 1000
}

/**
 * Generate a unique span ID
 */
function generateSpanId(state: PerfettoHostState): string {
  return `span_${++state.spanIdCounter}`
}

/**
 * Evict pending spans older than STALE_SPAN_TTL_MS.
 * Mirrors the TTL cleanup pattern in sessionTracing.ts.
 */
function evictStaleSpans(state: PerfettoHostState): void {
  const now = getTimestamp(state)
  const ttlUs = STALE_SPAN_TTL_MS * 1000 // Convert ms to microseconds
  for (const [spanId, span] of state.pendingSpans) {
    if (now - span.startTime > ttlUs) {
      // Emit an end event so the span shows up in the trace as incomplete
      state.events.push({
        name: span.name,
        cat: span.category,
        ph: 'E',
        ts: now,
        pid: span.agentInfo.processId,
        tid: span.agentInfo.threadId,
        args: {
          ...span.args,
          evicted: true,
          duration_ms: (now - span.startTime) / 1000,
        },
      })
      state.pendingSpans.delete(spanId)
    }
  }
}

/**
 * Build the full trace document (Chrome Trace JSON format).
 */
function buildTraceDocument(state: PerfettoHostState): string {
  return jsonStringify({
    traceEvents: [...state.metadataEvents, ...state.events],
    metadata: {
      session_id: state.sessionIdSnapshot ?? getSessionId(),
      trace_start_time: new Date(state.startTimeMs).toISOString(),
      agent_count: state.totalAgentCount,
      total_event_count: state.metadataEvents.length + state.events.length,
    },
  })
}

/**
 * Drop the oldest half of events[] when over MAX_EVENTS. Called from the
 * stale-span cleanup interval (60s). The half-batch splice keeps this
 * amortized O(1) — we don't pay splice cost per-push. A synthetic marker
 * is inserted so the gap is visible in ui.perfetto.dev.
 */
function evictOldestEvents(state: PerfettoHostState): void {
  if (state.events.length < MAX_EVENTS) return
  const dropped = state.events.splice(0, MAX_EVENTS / 2)
  state.events.unshift({
    name: 'trace_truncated',
    cat: '__metadata',
    ph: 'i',
    ts: dropped[dropped.length - 1]?.ts ?? 0,
    pid: 1,
    tid: 0,
    args: { dropped_events: dropped.length },
  })
  logForDebugging(
    `[Perfetto] Evicted ${dropped.length} oldest events (cap ${MAX_EVENTS})`,
  )
}

/**
 * Initialize Perfetto tracing
 * Call this early in the application lifecycle
 */
export function initializePerfettoTracing(): void {
  const envValue = process.env.CLAUDE_CODE_PERFETTO_TRACE
  logForDebugging(
    `[Perfetto] initializePerfettoTracing called, env value: ${envValue}`,
  )

  // Wrap in feature() for dead code elimination - entire block removed from external builds
  if (feature('PERFETTO_TRACING')) {
    if (!envValue || isEnvDefinedFalsy(envValue)) {
      logForDebugging(
        '[Perfetto] Tracing disabled (env var not set or disabled)',
      )
      return
    }

    const state = getOwnPerfettoHostState()
    stopWriteInterval(state)
    state.isEnabled = true
    state.traceWritten = false
    state.startTimeMs = Date.now()
    state.sessionIdSnapshot = getSessionId()

    // Determine trace file path
    if (isEnvTruthy(envValue)) {
      const tracesDir = join(getClaudeConfigHomeDir(), 'traces')
      state.tracePath = join(tracesDir, `trace-${state.sessionIdSnapshot}.json`)
    } else {
      // Use the provided path
      state.tracePath = envValue
    }

    logForDebugging(
      `[Perfetto] Tracing enabled, will write to: ${state.tracePath}, isEnabled=${state.isEnabled}`,
    )

    const captured = getActiveSessionFromAls()
    const capturedRootRef =
      captured !== undefined ? new WeakRef(captured.root) : undefined
    state.sessionRef = capturedRootRef
    const stateRef = new WeakRef(state)

    // Start periodic full-trace write if CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S is a positive integer
    const intervalSec = parseInt(
      process.env.CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S ?? '',
      10,
    )
    if (intervalSec > 0) {
      // Create intervals outside ALS so AsyncLocalStorage does not strongly pin
      // `{ session }` for the lifetime of the timer; re-enter via WeakRef when alive.
      const writeId = exitSessionContext(() =>
        setInterval(() => {
          const currentState = stateRef.deref()
          if (currentState === undefined) {
            clearInterval(writeId)
            return
          }
          const run = () => {
            void periodicWrite(currentState)
          }
          if (capturedRootRef !== undefined) {
            const ownerSession = capturedRootRef.deref()
            if (ownerSession === undefined) {
              stopWriteInterval(currentState)
              return
            }
            if (getActiveSessionFromAls() !== ownerSession) {
              runWithSession(ownerSession, run)
              return
            }
          }
          run()
        }, intervalSec * 1000),
      )
      state.writeIntervalId = writeId
      // Don't let the interval keep the process alive on its own
      if (writeId.unref) writeId.unref()
      logForDebugging(
        `[Perfetto] Periodic write enabled, interval: ${intervalSec}s`,
      )
    }

    // Start stale span cleanup interval (outside ALS so timer does not pin Session)
    const cleanupId = exitSessionContext(() =>
      setInterval(() => {
        const currentState = stateRef.deref()
        if (currentState === undefined) {
          clearInterval(cleanupId)
          return
        }
        const run = () => {
          evictStaleSpans(currentState)
          evictOldestEvents(currentState)
        }
        if (capturedRootRef !== undefined) {
          const ownerSession = capturedRootRef.deref()
          if (ownerSession === undefined) {
            stopWriteInterval(currentState)
            return
          }
          if (getActiveSessionFromAls() !== ownerSession) {
            runWithSession(ownerSession, run)
            return
          }
        }
        run()
      }, STALE_SPAN_CLEANUP_INTERVAL_MS),
    )
    state.staleSpanCleanupId = cleanupId
    if (cleanupId.unref) cleanupId.unref()

    // Register cleanup to write final trace on exit (once per host)
    if (!state.unregisterCleanup) {
      state.unregisterCleanup = registerCleanup(async () => {
        logForDebugging('[Perfetto] Cleanup callback invoked')
        await writePerfettoTrace(state)
      })
    }

    if (!state.trackedInLiveStates) {
      state.trackedInLiveStates = true
      if (livePerfettoHostStates.size > 64) {
        pruneDeadPerfettoHostStates()
      }
      livePerfettoHostStates.add(new WeakRef(state))
    }
    ensureSharedPerfettoProcessHooksInstalled()

    // Emit process metadata events for main process
    const mainAgent = getCurrentAgentInfo(state)
    emitProcessMetadata(state, mainAgent)
  }
}

/**
 * Emit metadata events for a process/agent
 */
function emitProcessMetadata(
  state: PerfettoHostState,
  agentInfo: AgentInfo,
): void {
  if (!state.isEnabled) return

  // Process name
  state.metadataEvents.push({
    name: 'process_name',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid: agentInfo.processId,
    tid: 0,
    args: { name: agentInfo.agentName },
  })

  // Thread name (same as process for now)
  state.metadataEvents.push({
    name: 'thread_name',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: { name: agentInfo.agentName },
  })

  // Add parent info if available
  if (agentInfo.parentAgentId) {
    state.metadataEvents.push({
      name: 'parent_agent',
      cat: '__metadata',
      ph: 'M',
      ts: 0,
      pid: agentInfo.processId,
      tid: 0,
      args: {
        parent_agent_id: agentInfo.parentAgentId,
      },
    })
  }
}

/**
 * Check if Perfetto tracing is enabled
 */
export function isPerfettoTracingEnabled(): boolean {
  return getActivePerfettoHostState().isEnabled === true
}

/**
 * Register a new agent in the trace
 * Call this when a subagent/teammate is spawned
 */
export function registerAgent(
  agentId: string,
  agentName: string,
  parentAgentId?: string,
): void {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled) return

  const info: AgentInfo = {
    agentId,
    agentName,
    parentAgentId,
    processId: getProcessIdForAgent(state, agentId),
    threadId: stringToNumericHash(agentName),
  }

  state.agentRegistry.set(agentId, info)
  state.totalAgentCount++
  emitProcessMetadata(state, info)
}

/**
 * Unregister an agent from the trace.
 * Call this when an agent completes, fails, or is aborted to free memory.
 */
export function unregisterAgent(agentId: string): void {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled) return
  state.agentRegistry.delete(agentId)
  state.agentIdToProcessId.delete(agentId)
}

/**
 * Start an API call span
 */
export function startLLMRequestPerfettoSpan(args: {
  model: string
  promptTokens?: number
  messageId?: string
  isSpeculative?: boolean
  querySource?: string
}): string {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled) return ''

  const spanId = generateSpanId(state)
  const agentInfo = getCurrentAgentInfo(state)

  state.pendingSpans.set(spanId, {
    name: 'API Call',
    category: 'api',
    startTime: getTimestamp(state),
    agentInfo,
    args: {
      model: args.model,
      prompt_tokens: args.promptTokens,
      message_id: args.messageId,
      is_speculative: args.isSpeculative ?? false,
      query_source: args.querySource,
    },
  })

  // Emit begin event
  state.events.push({
    name: 'API Call',
    cat: 'api',
    ph: 'B',
    ts: state.pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: state.pendingSpans.get(spanId)!.args,
  })

  return spanId
}

/**
 * End an API call span with response metadata
 */
export function endLLMRequestPerfettoSpan(
  spanId: string,
  metadata: {
    ttftMs?: number
    ttltMs?: number
    promptTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    messageId?: string
    success?: boolean
    error?: string
    /** Time spent in pre-request setup (client creation, retries) before the successful attempt */
    requestSetupMs?: number
    /** Timestamps (Date.now()) of each attempt start — used to emit retry sub-spans */
    attemptStartTimes?: number[]
  },
): void {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled || !spanId) return

  const pending = state.pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp(state)
  const duration = endTime - pending.startTime

  const promptTokens =
    metadata.promptTokens ?? (pending.args.prompt_tokens as number | undefined)
  const ttftMs = metadata.ttftMs
  const ttltMs = metadata.ttltMs
  const outputTokens = metadata.outputTokens
  const cacheReadTokens = metadata.cacheReadTokens

  // Compute derived metrics
  // ITPS: input tokens per second (prompt processing speed)
  const itps =
    ttftMs !== undefined && promptTokens !== undefined && ttftMs > 0
      ? Math.round((promptTokens / (ttftMs / 1000)) * 100) / 100
      : undefined

  // OTPS: output tokens per second (sampling speed)
  const samplingMs =
    ttltMs !== undefined && ttftMs !== undefined ? ttltMs - ttftMs : undefined
  const otps =
    samplingMs !== undefined && outputTokens !== undefined && samplingMs > 0
      ? Math.round((outputTokens / (samplingMs / 1000)) * 100) / 100
      : undefined

  // Cache hit rate: percentage of prompt tokens from cache
  const cacheHitRate =
    cacheReadTokens !== undefined &&
    promptTokens !== undefined &&
    promptTokens > 0
      ? Math.round((cacheReadTokens / promptTokens) * 10000) / 100
      : undefined

  const requestSetupMs = metadata.requestSetupMs
  const attemptStartTimes = metadata.attemptStartTimes

  // Merge metadata with original args
  const args = {
    ...pending.args,
    ttft_ms: ttftMs,
    ttlt_ms: ttltMs,
    prompt_tokens: promptTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: metadata.cacheCreationTokens,
    message_id: metadata.messageId ?? pending.args.message_id,
    success: metadata.success ?? true,
    error: metadata.error,
    duration_ms: duration / 1000,
    request_setup_ms: requestSetupMs,
    // Derived metrics
    itps,
    otps,
    cache_hit_rate_pct: cacheHitRate,
  }

  // Emit Request Setup sub-span when there was measurable setup time
  // (client creation, param building, retries before the successful attempt)
  const setupUs =
    requestSetupMs !== undefined && requestSetupMs > 0
      ? requestSetupMs * 1000
      : 0
  if (setupUs > 0) {
    const setupEndTs = pending.startTime + setupUs

    state.events.push({
      name: 'Request Setup',
      cat: 'api,setup',
      ph: 'B',
      ts: pending.startTime,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
      args: {
        request_setup_ms: requestSetupMs,
        attempt_count: attemptStartTimes?.length ?? 1,
      },
    })

    // Emit retry attempt sub-spans within Request Setup.
    // Each failed attempt runs from its start to the next attempt's start.
    if (attemptStartTimes && attemptStartTimes.length > 1) {
      // attemptStartTimes[0] is the reference point (first attempt).
      // Convert wall-clock deltas into Perfetto-relative microseconds.
      const baseWallMs = attemptStartTimes[0]!
      for (let i = 0; i < attemptStartTimes.length - 1; i++) {
        const attemptStartUs =
          pending.startTime + (attemptStartTimes[i]! - baseWallMs) * 1000
        const attemptEndUs =
          pending.startTime + (attemptStartTimes[i + 1]! - baseWallMs) * 1000

        state.events.push({
          name: `Attempt ${i + 1} (retry)`,
          cat: 'api,retry',
          ph: 'B',
          ts: attemptStartUs,
          pid: pending.agentInfo.processId,
          tid: pending.agentInfo.threadId,
          args: { attempt: i + 1 },
        })
        state.events.push({
          name: `Attempt ${i + 1} (retry)`,
          cat: 'api,retry',
          ph: 'E',
          ts: attemptEndUs,
          pid: pending.agentInfo.processId,
          tid: pending.agentInfo.threadId,
        })
      }
    }

    state.events.push({
      name: 'Request Setup',
      cat: 'api,setup',
      ph: 'E',
      ts: setupEndTs,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
    })
  }

  // Emit sub-spans for First Token and Sampling phases (before API Call end)
  // Using B/E pairs in proper nesting order for correct Perfetto visualization
  if (ttftMs !== undefined) {
    // First Token starts after request setup (if any)
    const firstTokenStartTs = pending.startTime + setupUs
    const firstTokenEndTs = firstTokenStartTs + ttftMs * 1000

    // First Token phase: from successful attempt start to first token
    state.events.push({
      name: 'First Token',
      cat: 'api,ttft',
      ph: 'B',
      ts: firstTokenStartTs,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
      args: {
        ttft_ms: ttftMs,
        prompt_tokens: promptTokens,
        itps,
        cache_hit_rate_pct: cacheHitRate,
      },
    })
    state.events.push({
      name: 'First Token',
      cat: 'api,ttft',
      ph: 'E',
      ts: firstTokenEndTs,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
    })

    // Sampling phase: from first token to last token
    // Note: samplingMs = ttltMs - ttftMs still includes setup time in ttltMs,
    // so we compute the actual sampling duration for the span as the time from
    // first token to API call end (endTime), not samplingMs directly.
    const actualSamplingMs =
      ttltMs !== undefined ? ttltMs - ttftMs - setupUs / 1000 : undefined
    if (actualSamplingMs !== undefined && actualSamplingMs > 0) {
      state.events.push({
        name: 'Sampling',
        cat: 'api,sampling',
        ph: 'B',
        ts: firstTokenEndTs,
        pid: pending.agentInfo.processId,
        tid: pending.agentInfo.threadId,
        args: {
          sampling_ms: actualSamplingMs,
          output_tokens: outputTokens,
          otps,
        },
      })
      state.events.push({
        name: 'Sampling',
        cat: 'api,sampling',
        ph: 'E',
        ts: firstTokenEndTs + actualSamplingMs * 1000,
        pid: pending.agentInfo.processId,
        tid: pending.agentInfo.threadId,
      })
    }
  }

  // Emit API Call end event (after sub-spans)
  state.events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args,
  })

  state.pendingSpans.delete(spanId)
}

/**
 * Start a tool execution span
 */
export function startToolPerfettoSpan(
  toolName: string,
  args?: Record<string, unknown>,
): string {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled) return ''

  const spanId = generateSpanId(state)
  const agentInfo = getCurrentAgentInfo(state)

  state.pendingSpans.set(spanId, {
    name: `Tool: ${toolName}`,
    category: 'tool',
    startTime: getTimestamp(state),
    agentInfo,
    args: {
      tool_name: toolName,
      ...args,
    },
  })

  // Emit begin event
  state.events.push({
    name: `Tool: ${toolName}`,
    cat: 'tool',
    ph: 'B',
    ts: state.pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: state.pendingSpans.get(spanId)!.args,
  })

  return spanId
}

/**
 * End a tool execution span
 */
export function endToolPerfettoSpan(
  spanId: string,
  metadata?: {
    success?: boolean
    error?: string
    resultTokens?: number
  },
): void {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled || !spanId) return

  const pending = state.pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp(state)
  const duration = endTime - pending.startTime

  const args = {
    ...pending.args,
    success: metadata?.success ?? true,
    error: metadata?.error,
    result_tokens: metadata?.resultTokens,
    duration_ms: duration / 1000,
  }

  // Emit end event
  state.events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args,
  })

  state.pendingSpans.delete(spanId)
}

/**
 * Start a user input waiting span
 */
export function startUserInputPerfettoSpan(context?: string): string {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled) return ''

  const spanId = generateSpanId(state)
  const agentInfo = getCurrentAgentInfo(state)

  state.pendingSpans.set(spanId, {
    name: 'Waiting for User Input',
    category: 'user_input',
    startTime: getTimestamp(state),
    agentInfo,
    args: {
      context,
    },
  })

  // Emit begin event
  state.events.push({
    name: 'Waiting for User Input',
    cat: 'user_input',
    ph: 'B',
    ts: state.pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: state.pendingSpans.get(spanId)!.args,
  })

  return spanId
}

/**
 * End a user input waiting span
 */
export function endUserInputPerfettoSpan(
  spanId: string,
  metadata?: {
    decision?: string
    source?: string
  },
): void {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled || !spanId) return

  const pending = state.pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp(state)
  const duration = endTime - pending.startTime

  const args = {
    ...pending.args,
    decision: metadata?.decision,
    source: metadata?.source,
    duration_ms: duration / 1000,
  }

  // Emit end event
  state.events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args,
  })

  state.pendingSpans.delete(spanId)
}

/**
 * Emit an instant event (marker)
 */
export function emitPerfettoInstant(
  name: string,
  category: string,
  args?: Record<string, unknown>,
): void {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled) return

  const agentInfo = getCurrentAgentInfo(state)

  state.events.push({
    name,
    cat: category,
    ph: 'i',
    ts: getTimestamp(state),
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args,
  })
}

/**
 * Emit a counter event for tracking metrics over time
 */
export function emitPerfettoCounter(
  name: string,
  values: Record<string, number>,
): void {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled) return

  const agentInfo = getCurrentAgentInfo(state)

  state.events.push({
    name,
    cat: 'counter',
    ph: 'C',
    ts: getTimestamp(state),
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: values,
  })
}

/**
 * Start an interaction span (wraps a full user request cycle)
 */
export function startInteractionPerfettoSpan(userPrompt?: string): string {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled) return ''

  const spanId = generateSpanId(state)
  const agentInfo = getCurrentAgentInfo(state)

  state.pendingSpans.set(spanId, {
    name: 'Interaction',
    category: 'interaction',
    startTime: getTimestamp(state),
    agentInfo,
    args: {
      user_prompt_length: userPrompt?.length,
    },
  })

  // Emit begin event
  state.events.push({
    name: 'Interaction',
    cat: 'interaction',
    ph: 'B',
    ts: state.pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: state.pendingSpans.get(spanId)!.args,
  })

  return spanId
}

/**
 * End an interaction span
 */
export function endInteractionPerfettoSpan(spanId: string): void {
  const state = getActivePerfettoHostState()
  if (!state.isEnabled || !spanId) return

  const pending = state.pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp(state)
  const duration = endTime - pending.startTime

  // Emit end event
  state.events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args: {
      ...pending.args,
      duration_ms: duration / 1000,
    },
  })

  state.pendingSpans.delete(spanId)
}

// ---------------------------------------------------------------------------
// Periodic write helpers
// ---------------------------------------------------------------------------

/**
 * Stop the periodic write timer.
 */
function stopWriteInterval(state: PerfettoHostState): void {
  if (state.staleSpanCleanupId) {
    clearInterval(state.staleSpanCleanupId)
    state.staleSpanCleanupId = null
  }
  if (state.writeIntervalId) {
    clearInterval(state.writeIntervalId)
    state.writeIntervalId = null
  }
}

/**
 * Force-close any remaining open spans at session end.
 */
function closeOpenSpans(state: PerfettoHostState): void {
  for (const [spanId, pending] of state.pendingSpans) {
    const endTime = getTimestamp(state)
    state.events.push({
      name: pending.name,
      cat: pending.category,
      ph: 'E',
      ts: endTime,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
      args: {
        ...pending.args,
        incomplete: true,
        duration_ms: (endTime - pending.startTime) / 1000,
      },
    })
    state.pendingSpans.delete(spanId)
  }
}

/**
 * Write the full trace to disk.  Errors are logged but swallowed so that a
 * transient I/O problem does not crash the session — the next periodic tick
 * (or the final exit write) will retry with a complete snapshot.
 */
async function periodicWrite(state: PerfettoHostState): Promise<void> {
  if (!state.isEnabled || !state.tracePath || state.traceWritten) return

  try {
    await mkdir(dirname(state.tracePath), { recursive: true })
    await writeFile(state.tracePath, buildTraceDocument(state))
    logForDebugging(
      `[Perfetto] Periodic write: ${state.events.length} events to ${state.tracePath}`,
    )
  } catch (error) {
    logForDebugging(
      `[Perfetto] Periodic write failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

/**
 * Final async write: close open spans and write the complete trace.
 * Idempotent — sets `traceWritten` on success so subsequent calls are no-ops.
 */
async function writePerfettoTrace(state: PerfettoHostState): Promise<void> {
  if (!state.isEnabled || !state.tracePath || state.traceWritten) {
    logForDebugging(
      `[Perfetto] Skipping final write: isEnabled=${state.isEnabled}, tracePath=${state.tracePath}, traceWritten=${state.traceWritten}`,
    )
    return
  }

  stopWriteInterval(state)
  closeOpenSpans(state)

  logForDebugging(
    `[Perfetto] writePerfettoTrace called: events=${state.events.length}`,
  )

  try {
    await mkdir(dirname(state.tracePath), { recursive: true })
    await writeFile(state.tracePath, buildTraceDocument(state))
    state.traceWritten = true
    const unregister = state.unregisterCleanup
    state.unregisterCleanup = null
    unregister?.()
    logForDebugging(`[Perfetto] Trace finalized at: ${state.tracePath}`)
  } catch (error) {
    logForDebugging(
      `[Perfetto] Failed to write final trace: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

/**
 * Final synchronous write (fallback for process 'exit' handler where async is forbidden).
 */
function writePerfettoTraceSync(state: PerfettoHostState): void {
  if (!state.isEnabled || !state.tracePath || state.traceWritten) {
    logForDebugging(
      `[Perfetto] Skipping final sync write: isEnabled=${state.isEnabled}, tracePath=${state.tracePath}, traceWritten=${state.traceWritten}`,
    )
    return
  }

  stopWriteInterval(state)
  closeOpenSpans(state)

  logForDebugging(
    `[Perfetto] writePerfettoTraceSync called: events=${state.events.length}`,
  )

  try {
    const dir = dirname(state.tracePath)
    // eslint-disable-next-line custom-rules/no-sync-fs -- Only called from process.on('exit') handler
    mkdirSync(dir, { recursive: true })
    // eslint-disable-next-line custom-rules/no-sync-fs, eslint-plugin-n/no-sync -- Required for process 'exit' handler which doesn't support async
    writeFileSync(state.tracePath, buildTraceDocument(state))
    state.traceWritten = true
    const unregister = state.unregisterCleanup
    state.unregisterCleanup = null
    unregister?.()
    logForDebugging(
      `[Perfetto] Trace finalized synchronously at: ${state.tracePath}`,
    )
  } catch (error) {
    logForDebugging(
      `[Perfetto] Failed to write final trace synchronously: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

/**
 * Get all recorded events (for testing)
 */
export function getPerfettoEvents(): TraceEvent[] {
  const state = getActivePerfettoHostState()
  return [...state.metadataEvents, ...state.events]
}

/**
 * Reset the tracer state (for testing)
 */
export function resetPerfettoTracer(): void {
  const state = getOwnPerfettoHostState()
  stopWriteInterval(state)
  const unregister = state.unregisterCleanup
  state.unregisterCleanup = null
  unregister?.()
  state.metadataEvents.length = 0
  state.events.length = 0
  state.pendingSpans.clear()
  state.agentRegistry.clear()
  state.agentIdToProcessId.clear()
  state.totalAgentCount = 0
  state.processIdCounter = 1
  state.spanIdCounter = 0
  state.isEnabled = false
  state.tracePath = null
  state.startTimeMs = 0
  state.traceWritten = false
  state.sessionIdSnapshot = null
  state.sessionRef = undefined
}

/**
 * Trigger a periodic write immediately (for testing)
 */
export async function triggerPeriodicWriteForTesting(): Promise<void> {
  await periodicWrite(getActivePerfettoHostState())
}

/**
 * Evict stale spans immediately (for testing)
 */
export function evictStaleSpansForTesting(): void {
  evictStaleSpans(getActivePerfettoHostState())
}

export const MAX_EVENTS_FOR_TESTING = MAX_EVENTS
export function evictOldestEventsForTesting(): void {
  evictOldestEvents(getActivePerfettoHostState())
}
