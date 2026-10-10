/**
 * Analytics sink implementation
 *
 * This module contains the actual analytics routing logic and should be
 * initialized during app startup. It routes events to Datadog and 1P event
 * logging.
 *
 * Usage: Call initializeAnalyticsSink() during app startup to attach the sink.
 */

import { logForDebugging } from '../../utils/debug.js'
import { trackDatadogEvent } from './datadog.js'
import {
  logEventTo1P,
  logEventTo1PPromise,
  shouldSampleEvent,
} from './firstPartyEventLogger.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  initializeGrowthBook,
  isGrowthBookEnabled,
} from './growthbook.js'
import { attachAnalyticsSink, stripProtoFields } from './index.js'
import { isSinkKilled } from './sinkKillswitch.js'

// Local type matching the logEvent metadata signature
type LogEventMetadata = { [key: string]: boolean | number | undefined }

const DATADOG_GATE_NAME = 'tengu_log_datadog_events'

// Module-level gate state - starts undefined, initialized during startup
let isDatadogGateEnabled: boolean | undefined

/** densable `i` — drop reentrant logEvent while collecting metadata. */
let logEventCollectingMetadata = false

/**
 * Check if Datadog tracking is enabled.
 * Falls back to cached value from previous session if not yet initialized.
 */
function shouldTrackDatadog(): boolean {
  if (isSinkKilled('datadog')) {
    return false
  }
  if (isDatadogGateEnabled !== undefined) {
    return isDatadogGateEnabled
  }

  // Fallback to cached value from previous session
  try {
    return checkStatsigFeatureGate_CACHED_MAY_BE_STALE(DATADOG_GATE_NAME)
  } catch {
    return false
  }
}

function dispatchEvent(
  eventName: string,
  metadata: LogEventMetadata,
  sampleResult: number | null,
): void {
  const metadataWithSampleRate =
    sampleResult !== null
      ? { ...metadata, sample_rate: sampleResult }
      : metadata

  if (shouldTrackDatadog()) {
    void trackDatadogEvent(eventName, stripProtoFields(metadataWithSampleRate))
  }
  logEventTo1P(eventName, metadataWithSampleRate)
}

/**
 * densable `m` — sample, then wait for GrowthBook init unless GB is already off.
 * Reentry while collecting metadata is dropped (gold unique English).
 */
function logEventImpl(eventName: string, metadata: LogEventMetadata): void {
  if (logEventCollectingMetadata) {
    logForDebugging(
      `logEvent reentered while collecting metadata — dropped ${eventName}. A getEventMetadata dependency (model/betas/auth) called logEvent synchronously; defer it (queueMicrotask) or move it out of the metadata path.`,
      { level: 'error' },
    )
    return
  }
  logEventCollectingMetadata = true
  try {
    const sampleResult = shouldSampleEvent(eventName)
    if (sampleResult === 0) {
      return
    }
    if (!isGrowthBookEnabled()) {
      dispatchEvent(eventName, metadata, sampleResult)
      return
    }
    const run = () => {
      logEventCollectingMetadata = true
      try {
        dispatchEvent(eventName, metadata, sampleResult)
      } finally {
        logEventCollectingMetadata = false
      }
    }
    void initializeGrowthBook().then(run, run)
  } finally {
    logEventCollectingMetadata = false
  }
}

/**
 * densable `c` — await GrowthBook init, then Datadog + 1P in parallel.
 */
async function logEventAsyncImpl(
  eventName: string,
  metadata: LogEventMetadata,
): Promise<void> {
  const sampleResult = shouldSampleEvent(eventName)
  if (sampleResult === 0) {
    return
  }
  if (isGrowthBookEnabled()) {
    await initializeGrowthBook()
  }
  const metadataWithSampleRate =
    sampleResult !== null
      ? { ...metadata, sample_rate: sampleResult }
      : metadata
  const pending: Promise<void>[] = []
  if (shouldTrackDatadog()) {
    pending.push(
      trackDatadogEvent(eventName, stripProtoFields(metadataWithSampleRate)),
    )
  }
  pending.push(logEventTo1PPromise(eventName, metadataWithSampleRate))
  await Promise.all(pending)
}

/**
 * Initialize analytics gates during startup.
 *
 * Updates gate values from server. Early events use cached values from previous
 * session to avoid data loss during initialization.
 *
 * Called from main.tsx during setupBackend().
 */
export function initializeAnalyticsGates(): void {
  isDatadogGateEnabled =
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE(DATADOG_GATE_NAME)
}

/**
 * Initialize the analytics sink.
 *
 * Call this during app startup to attach the analytics backend.
 * Any events logged before this is called will be queued and drained.
 *
 * Idempotent: safe to call multiple times (subsequent calls are no-ops).
 */
export function initializeAnalyticsSink(): void {
  attachAnalyticsSink({
    logEvent: logEventImpl,
    logEventAsync: logEventAsyncImpl,
  })
}
