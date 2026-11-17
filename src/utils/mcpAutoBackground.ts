/**
 * densable 2.1.212 MCP auto-background — getMcpAutoBackgroundMs (Ncy) +
 * callMcpToolWithAutoBackground ($cy).
 *
 * Defaults: 120_000 ms when GB tengu_mcp_auto_background defaults true;
 * CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS overrides (0 disables, positive = threshold).
 * Non-interactive: only when CLAUDE_AUTO_BACKGROUND_TASKS is set.
 * Transport types sse-ide / ws-ide: always off.
 */

import {
  getIsNonInteractiveSession,
  getMainThreadAgentId,
} from '../bootstrap/state.js'
import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
} from '../constants/xml.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import {
  completeMcpTask,
  failMcpTask,
  mcpTaskLabel,
  registerMcpTask,
} from '../tasks/McpTask/McpTask.js'
import type { AppState } from '../state/AppState.js'
import { logForDebugging } from './debug.js'
import {
  DETACH_RESULT_CAP,
  escapeDetachedResultBody,
} from './detachedToolCallNotify.js'
import { isAbortError } from './errors.js'
import { registerForegroundToolCall } from './foregroundToolCalls.js'
import { leftoverM, leftoverP, leftoverY } from './leftoverOt.js'
import { enqueuePendingNotification } from './messageQueueManager.js'
import { isBackgroundTasksDisabled } from './residualFinalEnvGates.js'
import { sleep } from './sleep.js'
import { escapeXml } from './xml.js'

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
  early?: boolean
}): string {
  const lead = input.early
    ? `MCP tool "${input.toolLabel}" was moved to the background as task ${input.taskId} so that a message that arrived while it was running can reach you; it was not interrupted and keeps running`
    : `MCP tool "${input.toolLabel}" is still running after ${input.elapsedSeconds}s. It was moved to the background as task ${input.taskId} and keeps running`
  return (
    `${lead}; ` +
    `you'll receive a notification with the result when it completes. ` +
    `You can keep working in the meantime. To stop it, use TaskStop with task_id "${input.taskId}". ` +
    `Note: it does not survive exiting this session.`
  )
}

const MCP_STATUS_MESSAGE_CAP = 10_000
const MCP_STATUS_CONTROL_RE =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Variation_Selector}]+/gu

/** densable `h` (`boundMcpStatusMessage`) @214325100 */
export function boundMcpStatusMessage(
  msg: string | undefined,
): string | undefined {
  if (msg === undefined) return undefined
  const cleaned = msg
    .replace(MCP_STATUS_CONTROL_RE, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  if (cleaned === '') return undefined
  if (cleaned.length <= MCP_STATUS_MESSAGE_CAP) return cleaned
  let end = MCP_STATUS_MESSAGE_CAP
  const prev = cleaned.charCodeAt(end - 1)
  if (prev >= 0xd800 && prev <= 0xdbff) end--
  return `${cleaned.slice(0, end)}\u2026 [truncated]`
}

/** densable `H` (`buildMcpTaskNotification`) @214325200 */
export function buildMcpTaskNotification(input: {
  taskId: string
  serverName: string
  toolName: string
  status: 'completed' | 'failed'
  resultText?: string
  statusMessage?: string
}): string {
  const summary = `MCP task ${input.taskId} (${mcpTaskLabel(input.serverName, input.toolName)}) ${input.status}.`
  const detail = boundMcpStatusMessage(input.statusMessage) ?? 'no detail'
  const body =
    input.status === 'completed'
      ? (input.resultText ?? '')
      : `Task failed: ${detail}`
  return `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${escapeXml(input.taskId)}</${TASK_ID_TAG}>
<${STATUS_TAG}>${input.status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
<result>
${escapeDetachedResultBody(body, DETACH_RESULT_CAP)}
</result>
</${TASK_NOTIFICATION_TAG}>`
}

export type McpAutoBackgroundCallResult = {
  content: unknown
  _meta?: Record<string, unknown>
  structuredContent?: Record<string, unknown>
  /** densable: auto-bg path returns text content only */
  autoBackgrounded?: boolean
  /** densable 2.1.246 #10 WZe — abort resolves, does not throw */
  interrupted?: boolean
  isError?: boolean
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
  foregroundSession?: object
}): Promise<
  T | { content: Array<{ type: 'text'; text: string }>; autoBackgrounded: true }
> {
  const ms = input.autoBackgroundMs
  if (ms <= 0) {
    return input.run(input.parentAbortController.signal)
  }

  const child = new AbortController()
  const sleepAbort = new AbortController()
  const parentSignal = input.parentAbortController.signal
  const onParentAbort = (): void => {
    child.abort()
    sleepAbort.abort()
  }
  if (parentSignal.aborted) {
    child.abort()
    sleepAbort.abort()
  } else {
    parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }

  const started = Date.now()
  const runPromise = input.run(child.signal)
  const settled = runPromise.then(
    () => 'settled' as const,
    () => 'settled' as const,
  )
  let armable = true
  let triggerEarly = (): void => {}
  const earlyPromise = new Promise<'early'>(resolve => {
    triggerEarly = () => resolve('early')
  })
  const unregisterForeground = input.foregroundSession
    ? registerForegroundToolCall(input.foregroundSession, {
        toolUseId: input.toolUseId,
        backgroundNow: () => {
          if (
            !armable ||
            parentSignal.aborted ||
            input.hasPendingElicitation?.() === true
          ) {
            return false
          }
          armable = false
          triggerEarly()
          return true
        },
      })
    : undefined
  let early = false

  try {
    while (true) {
      const race = await Promise.race([
        settled,
        earlyPromise,
        sleep(ms, sleepAbort.signal).then(() => 'timeout' as const),
      ])
      if (race === 'settled' || parentSignal.aborted) {
        parentSignal.removeEventListener('abort', onParentAbort)
        return await runPromise
      }
      if (race === 'early') {
        early = true
        break
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
  } finally {
    armable = false
    unregisterForeground?.()
    sleepAbort.abort()
  }

  // Timed out or detached early — background the call (child keeps running)
  parentSignal.removeEventListener('abort', onParentAbort)
  const toolLabel = input.toolLabel ?? input.toolName
  const taskId = registerMcpTask(input.setAppState, {
    serverName: input.serverName,
    toolName: input.toolName,
    toolUseId: input.toolUseId,
    abortController: child,
  })

  try {
    logEvent('tengu_mcp_tool_auto_backgrounded', {
      trigger: (early
        ? 'deliver_message'
        : 'timeout') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } catch {
    // analytics optional
  }

  const elapsedSeconds = Math.round((Date.now() - started) / 1000)
  const movedText = formatMcpAutoBackgroundMovedMessage({
    toolLabel,
    elapsedSeconds,
    taskId,
    early,
  })

  const enqueueMcpOutcome = (
    status: 'completed' | 'failed',
    opts: { resultText?: string; statusMessage?: string },
  ): void => {
    const agentId = getMainThreadAgentId()
    try {
      enqueuePendingNotification(
        {
          value: buildMcpTaskNotification({
            taskId,
            serverName: input.serverName,
            toolName: input.toolName,
            status,
            resultText: opts.resultText,
            statusMessage: opts.statusMessage,
          }),
          mode: 'task-notification',
          skipAttachments: true,
          priority: 'next',
          agentId,
          taskId,
        },
        { turnAttribution: 'inherit' },
      )
    } catch {
      try {
        enqueuePendingNotification(
          {
            value: `MCP task ${taskId} ${status}; the result could not be rendered.`,
            mode: 'task-notification',
            skipAttachments: true,
            priority: 'next',
            agentId,
            taskId,
          },
          { turnAttribution: 'inherit' },
        )
      } catch (err) {
        logForDebugging(
          `degraded MCP task notification enqueue failed: ${String(err)}`,
          { level: 'error' },
        )
      }
    }
  }

  const finishBackgroundFailure = (
    interrupted: boolean,
    msg: string,
    kind: 'aborted' | 'tool_error' | 'call_failed' = interrupted
      ? 'aborted'
      : 'call_failed',
  ): void => {
    const bounded = boundMcpStatusMessage(msg)
    if (!failMcpTask(taskId, input.setAppState, bounded)) return
    try {
      if (kind === 'tool_error') leftoverP('mcp_auto_background', 'tool_error')
      else if (kind === 'aborted') leftoverP('mcp_auto_background', 'aborted')
      else leftoverM('mcp_auto_background', 'call_failed')
    } catch {
      /* optional */
    }
    logForDebugging(
      `MCP auto-background task ${taskId} ${interrupted ? 'interrupted' : 'failed'}: ${msg}`,
      { level: interrupted ? 'info' : 'error' },
    )
    enqueueMcpOutcome('failed', {
      statusMessage: interrupted ? `MCP task ${taskId} was interrupted` : msg,
    })
  }

  void runPromise
    .then(async result => {
      // densable 2.1.246 #10: callMCPTool resolves abort as
      // `{interrupted,isError}` instead of throwing. The waiter must not
      // treat that payload as a successful completion.
      const interrupted =
        result.interrupted === true ||
        input.parentAbortController.signal.aborted
      if (interrupted || result.isError === true) {
        const errText = mcpContentToNotificationText(result.content)
        finishBackgroundFailure(
          interrupted,
          errText || (interrupted ? 'interrupted' : 'error'),
          interrupted ? 'aborted' : 'tool_error',
        )
        return
      }
      const resultText = mcpContentToNotificationText(result.content)
      const resourceLinks = collectMcpResourceLinks(result.content)
      if (
        !completeMcpTask(taskId, input.setAppState, undefined, resourceLinks)
      ) {
        return
      }
      try {
        leftoverY('mcp_auto_background')
      } catch {
        /* optional */
      }
      enqueueMcpOutcome('completed', { resultText })
    })
    .catch((err: unknown) => {
      const interrupted =
        isAbortError(err) ||
        input.parentAbortController.signal.aborted ||
        child.signal.aborted
      const msg = err instanceof Error ? err.message : String(err)
      finishBackgroundFailure(
        interrupted,
        msg,
        interrupted ? 'aborted' : 'call_failed',
      )
    })

  // densable $cy: tool result is "moved to background" — NOT a successful
  // completion. Callers must not emit mcp_progress status:completed here;
  // completion arrives later via task-notification / MonitorMcpTask.
  return {
    content: [{ type: 'text', text: movedText }],
    autoBackgrounded: true,
  }
}

export type McpCollectedResourceLink = {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  annotations?: Record<string, unknown>
}

/** densable 2.1.289 Aq — collect MCP resource_link blocks (max 50, 64 KiB serialized). */
export function collectMcpResourceLinks(
  content: unknown,
  cap = 50,
): McpCollectedResourceLink[] {
  if (!Array.isArray(content) || cap <= 0) return []
  const out: McpCollectedResourceLink[] = []
  let serializedBytes = 2
  for (const block of content) {
    if (out.length >= cap) break
    if (typeof block !== 'object' || block === null) continue
    const raw = block as Record<string, unknown>
    if (
      raw.type !== 'resource_link' ||
      typeof raw.uri !== 'string' ||
      typeof raw.name !== 'string'
    ) {
      continue
    }
    const entry: McpCollectedResourceLink = {
      uri: raw.uri,
      name: raw.name,
    }
    if (typeof raw.title === 'string') entry.title = raw.title
    if (typeof raw.description === 'string') entry.description = raw.description
    if (typeof raw.mimeType === 'string') entry.mimeType = raw.mimeType
    if (typeof raw.size === 'number' && Number.isFinite(raw.size)) {
      entry.size = raw.size
    }
    if (
      typeof raw.annotations === 'object' &&
      raw.annotations !== null &&
      !Array.isArray(raw.annotations)
    ) {
      entry.annotations = raw.annotations as Record<string, unknown>
    }
    serializedBytes +=
      Buffer.byteLength(JSON.stringify(entry), 'utf8') +
      (out.length > 0 ? 1 : 0)
    if (serializedBytes > 65_536) break
    out.push(entry)
  }
  return out
}

/**
 * densable `mcpContentToNotificationText` / `Q` @214322600 — serialize full MCP
 * content blocks (`text`, embedded `resource`, `resource_link`, or `[type]`)
 * without truncating at 200 chars (`buildMcpTaskNotification` caps at 30k).
 */
export function mcpContentToNotificationText(content: unknown): string {
  try {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    const parts: string[] = []
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      const raw = block as Record<string, unknown>
      if (raw.type === 'text' && typeof raw.text === 'string') {
        parts.push(raw.text)
        continue
      }
      if (
        typeof raw.resource === 'object' &&
        raw.resource !== null &&
        typeof (raw.resource as Record<string, unknown>).text === 'string'
      ) {
        const res = raw.resource as Record<string, unknown>
        const uri = typeof res.uri === 'string' ? res.uri : undefined
        const text = res.text as string
        parts.push(uri ? `[Resource at ${uri}] ${text}` : text)
        continue
      }
      if (
        raw.type === 'resource_link' &&
        typeof raw.name === 'string' &&
        typeof raw.uri === 'string'
      ) {
        const desc =
          typeof raw.description === 'string' && raw.description
            ? ` (${raw.description})`
            : ''
        parts.push(`[Resource link: ${raw.name}] ${raw.uri}${desc}`)
        continue
      }
      if (typeof raw.type === 'string' && raw.type) {
        parts.push(`[${raw.type}]`)
      }
    }
    return parts.join('\n')
  } catch {
    return ''
  }
}
