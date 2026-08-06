/**
 * densable 2.1.214 `_Lu` / `Pss` — long-running tool progress heartbeat.
 *
 * Every 30s emits a progress event:
 *   { type: "progress", toolUseID: `${id}-heartbeat-${n}`,
 *     data: { type: "tool_heartbeat", toolName, elapsedTimeSeconds } }
 *
 * Agent tool is skipped (densable `e===No` → noop). Timer is `unref()`'d.
 * Cleanup clears the interval; abortSignal.aborted stops further ticks.
 */

import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import { logError } from './log.js'

/** densable Pss */
export const TOOL_HEARTBEAT_INTERVAL_MS = 30_000

export type ToolHeartbeatProgressData = {
  type: 'tool_heartbeat'
  toolName: string
  elapsedTimeSeconds: number
}

export type ToolHeartbeatProgress = {
  type: 'progress'
  toolUseID: string
  data: ToolHeartbeatProgressData
}

export type ToolHeartbeatOnProgress = (progress: ToolHeartbeatProgress) => void

/** densable A3g — no-op cleanup when heartbeat is disabled (Agent tool). */
function noopCleanup(): void {}

/**
 * densable `_Lu({toolName, toolUseID, abortSignal, onProgress})`.
 * Returns a cleanup function that clears the interval.
 */
export function startToolHeartbeat({
  toolName,
  toolUseID,
  abortSignal,
  onProgress,
  intervalMs = TOOL_HEARTBEAT_INTERVAL_MS,
  now = () => Date.now(),
}: {
  toolName: string
  toolUseID: string
  abortSignal: AbortSignal
  onProgress: ToolHeartbeatOnProgress
  intervalMs?: number
  now?: () => number
}): () => void {
  // densable: if(e===No)return A3g
  if (toolName === AGENT_TOOL_NAME) {
    return noopCleanup
  }

  const startedAt = now()
  let stopped = false
  let seq = 0

  const interval = setInterval(() => {
    try {
      if (stopped) return
      if (abortSignal.aborted) {
        cleanup()
        return
      }
      onProgress({
        type: 'progress',
        toolUseID: `${toolUseID}-heartbeat-${seq++}`,
        data: {
          type: 'tool_heartbeat',
          toolName,
          elapsedTimeSeconds: Math.floor((now() - startedAt) / 1000),
        },
      })
    } catch (err) {
      // densable: catch(c){ke(c),l()}
      logError(err)
      cleanup()
    }
  }, intervalMs)

  // densable: a.unref()
  if (typeof interval.unref === 'function') {
    interval.unref()
  }

  function cleanup(): void {
    if (stopped) return
    stopped = true
    clearInterval(interval)
  }

  return cleanup
}
