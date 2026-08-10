/**
 * densable 2.1.212 MCP auto-background — getMcpAutoBackgroundMs (Ncy) +
 * callMcpToolWithAutoBackground ($cy).
 *
 * Defaults: 120_000 ms when GB tengu_mcp_auto_background defaults true;
 * CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS overrides (0 disables, positive = threshold).
 * Non-interactive: only when CLAUDE_AUTO_BACKGROUND_TASKS is set.
 * Transport types sse-ide / ws-ide: always off.
 */

import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import {
  completeMonitorMcpTask,
  failMonitorMcpTask,
  registerMonitorMcpTask,
} from '../tasks/MonitorMcpTask/MonitorMcpTask.js'
import type { AppState } from '../state/AppState.js'
import { logForDebugging } from './debug.js'
import { enqueuePendingNotification } from './messageQueueManager.js'
import { isBackgroundTasksDisabled } from './residualFinalEnvGates.js'
import { sleep } from './sleep.js'

/** densable Lcy */
export const DEFAULT_MCP_AUTO_BACKGROUND_MS = 120_000
/** densable Mcy */
export const MCP_AUTO_BACKGROUND_MS_CEILING = 2_147_483_647
/** densable Ocy */
const MCP_AUTO_BG_DISABLED_TRANSPORTS = new Set(['sse-ide', 'ws-ide'])

export function resolveMcpAutoBackgroundMs(
  env: NodeJS.ProcessEnv = process.env,
  opts?: {
    transportType?: string
    isNonInteractiveSession?: boolean
    gbEnabled?: boolean
  },
): number {
  const transport = opts?.transportType ?? ''
  // densable Ncy: Ocy transport gate first
  if (MCP_AUTO_BG_DISABLED_TRANSPORTS.has(transport)) return 0
  // densable Ncy: pv() — CLAUDE_CODE_DISABLE_BACKGROUND_TASKS kills auto-bg
  if (isBackgroundTasksDisabled(env)) return 0

  const nonInteractive =
    opts?.isNonInteractiveSession ?? getIsNonInteractiveSession()
  if (nonInteractive && !isTruthyEnv(env.CLAUDE_AUTO_BACKGROUND_TASKS)) {
    return 0
  }

  const raw = env.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS
  if (raw !== undefined) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return 0
    return Math.min(Math.max(0, Math.floor(n)), MCP_AUTO_BACKGROUND_MS_CEILING)
  }

  const gb =
    opts?.gbEnabled ??
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_mcp_auto_background', true)
  return gb ? DEFAULT_MCP_AUTO_BACKGROUND_MS : 0
}

/** densable Ncy alias */
export const getMcpAutoBackgroundMs = resolveMcpAutoBackgroundMs

export function isMcpAutoBackgroundEnabled(
  env: NodeJS.ProcessEnv = process.env,
  opts?: Parameters<typeof resolveMcpAutoBackgroundMs>[1],
): boolean {
  return resolveMcpAutoBackgroundMs(env, opts) > 0
}

function isTruthyEnv(v: string | undefined): boolean {
  if (!v) return false
  const n = v.toLowerCase().trim()
  return n === '1' || n === 'true' || n === 'yes' || n === 'on'
}

export function formatMcpAutoBackgroundMovedMessage(input: {
  toolLabel: string
  elapsedSeconds: number
  taskId: string
}): string {
  return (
    `MCP tool "${input.toolLabel}" is still running after ${input.elapsedSeconds}s. ` +
    `It was moved to the background as task ${input.taskId} and keeps running; ` +
    `you'll receive a notification with the result when it completes. ` +
    `You can keep working in the meantime. To stop it, use TaskStop with task_id "${input.taskId}". ` +
    `Note: it does not survive exiting this session.`
  )
}

export type McpAutoBackgroundCallResult = {
  content: unknown
  _meta?: Record<string, unknown>
  structuredContent?: Record<string, unknown>
  /** densable: auto-bg path returns text content only */
  autoBackgrounded?: boolean
}

/**
 * densable $cy — race MCP call against autoBackgroundMs; on timeout register
 * monitor_mcp task + return moved-to-background tool result; notify later.
 */
export async function callMcpToolWithAutoBackground<
  T extends McpAutoBackgroundCallResult,
>(input: {
  run: (signal: AbortSignal) => Promise<T>
  serverName: string
  toolName: string
  toolUseId?: string
  parentAbortController: AbortController | { signal: AbortSignal }
  setAppState: (f: (prev: AppState) => AppState) => void
  autoBackgroundMs: number
  hasPendingElicitation?: () => boolean
  toolLabel?: string
}): Promise<
  T | { content: Array<{ type: 'text'; text: string }>; autoBackgrounded: true }
> {
  const ms = input.autoBackgroundMs
  if (ms <= 0) {
    return input.run(input.parentAbortController.signal)
  }

  const child = new AbortController()
  const parentSignal = input.parentAbortController.signal
  const onParentAbort = (): void => {
    child.abort()
  }
  if (parentSignal.aborted) {
    child.abort()
  } else {
    parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }

  const started = Date.now()
  const runPromise = input.run(child.signal)
  const settled = runPromise.then(
    () => 'settled' as const,
    () => 'settled' as const,
  )

  try {
    while (true) {
      const race = await Promise.race([
        settled,
        sleep(ms, child.signal).then(() => 'timeout' as const),
      ])
      if (race === 'settled' || parentSignal.aborted) {
        parentSignal.removeEventListener('abort', onParentAbort)
        return await runPromise
      }
      // densable: if elicitation pending, keep waiting (another full timeout window)
      if (input.hasPendingElicitation?.()) {
        continue
      }
      break
    }
  } catch {
    parentSignal.removeEventListener('abort', onParentAbort)
    return await runPromise
  }

  // Timed out — background the call (child keeps running; parent no longer waits)
  parentSignal.removeEventListener('abort', onParentAbort)
  const toolLabel = input.toolLabel ?? input.toolName
  const taskId = registerMonitorMcpTask(input.setAppState, {
    description: toolLabel,
    serverName: input.serverName,
    resourceUri: `mcp-tool://${input.serverName}/${input.toolName}`,
    toolUseId: input.toolUseId,
    abortController: child,
  })

  try {
    logEvent('tengu_mcp_tool_auto_backgrounded', {})
  } catch {
    // analytics optional
  }

  const elapsedSeconds = Math.round((Date.now() - started) / 1000)
  const movedText = formatMcpAutoBackgroundMovedMessage({
    toolLabel,
    elapsedSeconds,
    taskId,
  })

  void runPromise
    .then(async result => {
      completeMonitorMcpTask(taskId, input.setAppState)
      try {
        logEvent('mcp_auto_background', { completed: true })
      } catch {
        /* optional */
      }
      const summary = summarizeMcpResult(result)
      enqueuePendingNotification({
        value: `MCP task ${taskId} completed${summary ? `: ${summary}` : ''}`,
        mode: 'task-notification',
        priority: 'next',
      })
    })
    .catch((err: unknown) => {
      failMonitorMcpTask(taskId, input.setAppState)
      const msg = err instanceof Error ? err.message : String(err)
      try {
        logEvent('mcp_auto_background', { completed: false })
      } catch {
        /* optional */
      }
      logForDebugging(`MCP auto-background task ${taskId} failed: ${msg}`, {
        level: 'error',
      })
      enqueuePendingNotification({
        value: `MCP task ${taskId} failed: ${msg}`,
        mode: 'task-notification',
        priority: 'next',
      })
    })

  // densable $cy: tool result is "moved to background" — NOT a successful
  // completion. Callers must not emit mcp_progress status:completed here;
  // completion arrives later via task-notification / MonitorMcpTask.
  return {
    content: [{ type: 'text', text: movedText }],
    autoBackgrounded: true,
  }
}

function summarizeMcpResult(result: McpAutoBackgroundCallResult): string {
  try {
    const c = result.content
    if (typeof c === 'string') return c.slice(0, 200)
    if (Array.isArray(c)) {
      const texts = c
        .map(block => {
          if (
            block &&
            typeof block === 'object' &&
            'type' in block &&
            (block as { type: string }).type === 'text' &&
            'text' in block
          ) {
            return String((block as { text: unknown }).text)
          }
          return ''
        })
        .filter(Boolean)
      if (texts.length) return texts.join('\n').slice(0, 200)
    }
  } catch {
    /* ignore */
  }
  return ''
}
