/**
 * Shared `src/services/analytics/index` mock.
 *
 * Bun `mock.module` is process-global (last-write-wins). Incomplete
 * `{ logEvent: () => {} }` factories wipe `stripProtoFields` /
 * `attachAnalyticsSink` / `logEventAsync` / `_resetForTesting` for every
 * later file in the same process. Register this factory everywhere;
 * per-suite event capture goes through `pushAnalyticsLogEvent`.
 */
import * as realAnalytics from '../../src/services/analytics/index.js'
import { snapshotModuleExports } from './settings.js'

const analyticsSnap = snapshotModuleExports(realAnalytics)

export type AnalyticsLogEvent = (
  name: string,
  metadata?: Record<string, unknown>,
) => void

const logEventStack: AnalyticsLogEvent[] = []

export function pushAnalyticsLogEvent(fn: AnalyticsLogEvent): () => void {
  logEventStack.push(fn)
  return () => {
    const i = logEventStack.lastIndexOf(fn)
    if (i >= 0) logEventStack.splice(i, 1)
  }
}

function dispatchLogEvent(
  name: string,
  metadata?: Record<string, unknown>,
): void {
  if (logEventStack.length === 0) return
  logEventStack[logEventStack.length - 1]!(name, metadata)
}

export function analyticsMock(): typeof realAnalytics {
  return {
    ...analyticsSnap,
    // Preserve real sink attach/reset so suites that use attachAnalyticsSink
    // (e.g. setPermissionModeWithGuards) still capture events under mock.module.
    // Suites that pushAnalyticsLogEvent take priority when the stack is non-empty.
    logEvent: (name: string, metadata?: Record<string, unknown>) => {
      if (logEventStack.length > 0) {
        dispatchLogEvent(name, metadata)
        return
      }
      analyticsSnap.logEvent(name, metadata as never)
    },
    logEventAsync: async (name: string, metadata?: Record<string, unknown>) => {
      if (logEventStack.length > 0) {
        dispatchLogEvent(name, metadata)
        return
      }
      await analyticsSnap.logEventAsync(name, metadata as never)
    },
  } as typeof realAnalytics
}
