/**
 * Analytics service - public API for event logging
 *
 * This module serves as the main entry point for analytics events in Claude CLI.
 *
 * DESIGN: This module has NO dependencies to avoid import cycles.
 * Events are queued until attachAnalyticsSink() is called during app initialization.
 * The sink handles routing to Datadog and 1P event logging.
 */

/**
 * Marker type for verifying analytics metadata doesn't contain sensitive data
 *
 * This type forces explicit verification that string values being logged
 * don't contain code snippets, file paths, or other sensitive information.
 *
 * Usage: `myString as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
 */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

/**
 * Marker type for values routed to PII-tagged proto columns via `_PROTO_*`
 * payload keys. The destination BQ column has privileged access controls,
 * so unredacted values are acceptable — unlike general-access backends.
 *
 * sink.ts strips `_PROTO_*` keys before Datadog fanout; only the 1P
 * exporter (firstPartyEventLoggingExporter) sees them and hoists them to the
 * top-level proto field. A single stripProtoFields call guards all non-1P
 * sinks — no per-sink filtering to forget.
 *
 * Usage: `rawName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED`
 */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

/**
 * Strip `_PROTO_*` keys from a payload destined for general-access storage.
 * Used by:
 *   - sink.ts: before Datadog fanout (never sees PII-tagged values)
 *   - firstPartyEventLoggingExporter: defensive strip of additional_metadata
 *     after hoisting known _PROTO_* keys to proto fields — prevents a future
 *     unrecognized _PROTO_foo from silently landing in the BQ JSON blob.
 *
 * Returns the input unchanged (same reference) when no _PROTO_ keys present.
 */
export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  let result: Record<string, V> | undefined
  for (const key in metadata) {
    if (key.startsWith('_PROTO_')) {
      if (result === undefined) {
        result = { ...metadata }
      }
      delete result[key]
    }
  }
  return result ?? metadata
}

// Internal type for logEvent metadata - different from the enriched EventMetadata in metadata.ts
export type LogEventMetadata = {
  [key: string]: boolean | number | string | undefined
}

type QueuedEvent = {
  eventName: string
  metadata: LogEventMetadata
  async: boolean
}

/**
 * Sink interface for the analytics backend
 */
export type AnalyticsSink = {
  logEvent: (eventName: string, metadata: LogEventMetadata) => void
  logEventAsync: (
    eventName: string,
    metadata: LogEventMetadata,
  ) => Promise<void>
}

import { HostSlot } from '../../utils/hostSlot.js'
import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  ofDefaultHost,
  runWithSession,
} from '../../utils/sessionRoot.js'

// Event queue for events logged before sink is attached (densable u = 1000)
const MAX_EVENT_QUEUE_SIZE = 1000

type AnalyticsHostState = {
  eventQueue: QueuedEvent[]
  droppedEventCount: number
  sink: AnalyticsSink | null
}

// Official 2.1.331 `[W-10]` — host-keyed analytics sink & pre-attach event queue.
const analyticsHostSlot = new HostSlot<AnalyticsHostState>(() => ({
  eventQueue: [],
  droppedEventCount: 0,
  sink: null,
}))

function getAnalyticsHostState(): AnalyticsHostState {
  return analyticsHostSlot.of(getBootstrapSessionHost())
}

function getEffectiveAnalyticsSink(
  state: AnalyticsHostState,
): AnalyticsSink | null {
  return state.sink ?? ofDefaultHost(analyticsHostSlot).sink
}

function enqueueEvent(state: AnalyticsHostState, entry: QueuedEvent): void {
  if (state.eventQueue.length >= MAX_EVENT_QUEUE_SIZE) {
    state.eventQueue.shift()
    state.droppedEventCount++
  }
  state.eventQueue.push(entry)
}

/**
 * Attach the analytics sink that will receive all events.
 * Queued events are drained asynchronously via queueMicrotask to avoid
 * adding latency to the startup path.
 *
 * Idempotent: if a sink is already attached, this is a no-op. This allows
 * calling from both the preAction hook (for subcommands) and setup() (for
 * the default command) without coordination.
 */
export function attachAnalyticsSink(newSink: AnalyticsSink): void {
  const state = getAnalyticsHostState()
  if (state.sink !== null) {
    return
  }
  state.sink = newSink

  // Drain the queue asynchronously to avoid blocking startup
  if (state.eventQueue.length > 0) {
    const queuedEvents = [...state.eventQueue]
    state.eventQueue.length = 0
    const captured = getActiveSessionFromAls()

    queueMicrotask(() => {
      const drain = () => {
        const activeSink = state.sink
        if (activeSink === null) {
          return
        }
        for (const event of queuedEvents) {
          if (event.async) {
            void activeSink.logEventAsync(event.eventName, event.metadata)
          } else {
            activeSink.logEvent(event.eventName, event.metadata)
          }
        }
      }
      if (captured !== undefined && getActiveSessionFromAls() !== captured) {
        runWithSession(captured, drain)
      } else {
        drain()
      }
    })
  }
}

/**
 * Log an event to analytics backends (synchronous)
 *
 * Events may be sampled based on the 'tengu_event_sampling_config' dynamic config.
 * When sampled, the sample_rate is added to the event metadata.
 *
 * If no sink is attached, events are queued and drained when the sink attaches.
 */
export function logEvent(
  eventName: string,
  // intentionally no strings unless AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  // to avoid accidentally logging code/filepaths
  metadata: LogEventMetadata,
): void {
  const state = getAnalyticsHostState()
  const effectiveSink = getEffectiveAnalyticsSink(state)
  if (effectiveSink === null) {
    enqueueEvent(state, { eventName, metadata, async: false })
    return
  }
  effectiveSink.logEvent(eventName, metadata)
}

/**
 * Log an event to analytics backends (asynchronous)
 *
 * Events may be sampled based on the 'tengu_event_sampling_config' dynamic config.
 * When sampled, the sample_rate is added to the event metadata.
 *
 * If no sink is attached, events are queued and drained when the sink attaches.
 */
export async function logEventAsync(
  eventName: string,
  // intentionally no strings, to avoid accidentally logging code/filepaths
  metadata: LogEventMetadata,
): Promise<void> {
  const state = getAnalyticsHostState()
  const effectiveSink = getEffectiveAnalyticsSink(state)
  if (effectiveSink === null) {
    enqueueEvent(state, { eventName, metadata, async: true })
    return
  }
  await effectiveSink.logEventAsync(eventName, metadata)
}

/**
 * Reset analytics state for testing purposes only.
 * @internal
 */
export function _resetForTesting(): void {
  const state = getAnalyticsHostState()
  state.sink = null
  state.eventQueue.length = 0
  state.droppedEventCount = 0
  void state.droppedEventCount
}
