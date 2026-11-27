/**
 * Official 2.1.331 McpTaskResumePollingTool (`b` / `bHn`).
 *
 * Checks status of a stopped/parked background MCP task, surfaces pending
 * `input_required` questions/elicitations, and hands working SEP-2663 tasks
 * back to the polling service.
 */

import { ProtocolErrorCode } from '@modelcontextprotocol/client'
import { z } from 'zod/v4'
import { isPolicyLimitsAllowed } from 'src/cli/leftoverTulip.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { isMcpTasksEnabled } from 'src/services/mcp/mcpV2Client.js'
import { normalizeNameForMCP } from 'src/services/mcp/normalization.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import { isMcpTask, type McpTaskState } from 'src/tasks/McpTask/McpTask.js'
import { buildTool, type ToolDef, type ToolResultBlockParam } from 'src/Tool.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { isDisklessLaunch } from 'src/utils/sessionHost.js'
import type { TaskRegistry } from 'src/utils/taskRegistry.js'
import {
  MCP_POLLER_META_KEY,
  MCP_TASK_RESUME_POLLING_TOOL_NAME,
} from './constants.js'
import {
  DESCRIPTION,
  formatMcpTaskResumeOutcome,
  type McpTaskResumeOutcome,
  PROMPT,
  WHEN_TO_USE,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z
      .string()
      .describe(
        'The id of the background MCP task, as its notification gave it.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type McpTaskResumePollingInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('What came of the call'),
    isError: z.boolean(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type McpTaskResumePollingOutput = z.infer<OutputSchema>

type ExtendedMcpTaskState = McpTaskState & {
  polledBy?: 'service' | 'client'
}

type TasksGetResponse = {
  status?: unknown
  statusMessage?: unknown
  _meta?: Record<string, unknown>
}

type RawTaskClient = {
  request: (
    payload: { method: string; params?: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ) => Promise<TasksGetResponse>
}

export type OfferMcpTaskResult = {
  outcome: McpTaskResumeOutcome
  status?: string
}

/**
 * Official `RGn()` gate:
 * `isMcpTasksEnabled()` && remote anthropic_cloud (non-diskless) &&
 * GB `tengu_zippy_piglet` && GB `tengu_mossy_ferry` &&
 * `isPolicyLimitsAllowed('allow_mcp_task_worker_wake')`.
 */
export function isMcpTaskResumePollingEnabled(opts?: {
  env?: NodeJS.ProcessEnv
  isDiskless?: boolean
  readFeature?: (key: string, fallback: boolean) => boolean
  isPolicyAllowed?: (key: string) => boolean
}): boolean {
  const env = opts?.env ?? process.env
  const readFeature =
    opts?.readFeature ??
    ((key: string, fallback: boolean) =>
      getFeatureValue_CACHED_MAY_BE_STALE(key, fallback))
  const diskless = opts?.isDiskless ?? isDisklessLaunch()
  if (diskless) return false
  if (!isMcpTasksEnabled(env, readFeature)) return false

  const isRemote = isEnvTruthy(env.CLAUDE_CODE_REMOTE)
  const envKind = env.CLAUDE_CODE_ENVIRONMENT_KIND
  const isAnthropicCloud =
    isRemote && (envKind === undefined || envKind === 'anthropic_cloud')
  if (!isAnthropicCloud) return false

  if (readFeature('tengu_zippy_piglet', false) !== true) return false
  if (readFeature('tengu_mossy_ferry', false) !== true) return false

  const checkPolicy =
    opts?.isPolicyAllowed ?? ((key: string) => isPolicyLimitsAllowed(key))
  return checkPolicy('allow_mcp_task_worker_wake')
}

function getPollerVerdict(
  meta: Record<string, unknown> | undefined,
): 'service' | 'client' | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const poller = meta[MCP_POLLER_META_KEY]
  if (typeof poller === 'string') {
    if (poller === 'service' || poller === 'client') return poller
    return undefined
  }
  if (poller && typeof poller === 'object') {
    const rec = poller as Record<string, unknown>
    const owner = rec.polledBy ?? rec.owner ?? rec.verdict ?? rec.polls
    if (owner === 'service' || owner === 'client') return owner
  }
  return undefined
}

function getErrorCode(err: unknown): number | undefined {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'number'
  ) {
    return (err as { code: number }).code
  }
  return undefined
}

/**
 * Official `offerMcpTaskToPoller` (`Jfd`):
 * inspects task state, polls `tasks/get` on the connected MCP server, surfaces
 * `input_required` questions, reports terminal status, or hands working tasks
 * back to the polling service.
 */
export async function offerMcpTaskToPoller(
  taskId: string,
  deps: {
    getTask: (id: string) => unknown
    updateTask?: (
      id: string,
      updater: (task: ExtendedMcpTaskState) => ExtendedMcpTaskState,
    ) => void
    getMcpClients: () => readonly MCPServerConnection[]
    isEnabled?: () => boolean
  },
  signal?: AbortSignal,
): Promise<OfferMcpTaskResult> {
  const rawTask = deps.getTask(taskId)
  if (!isMcpTask(rawTask)) {
    return { outcome: 'unknown_id' }
  }
  const task = rawTask as ExtendedMcpTaskState

  if (task.status !== 'running' || task.notified) {
    return { outcome: 'ended' }
  }
  if (task.newsToConfirm && task.newsToConfirm.length > 0) {
    return { outcome: 'busy' }
  }
  if (task.parked !== true && task.polledBy === 'service') {
    return { outcome: 'already_tracked' }
  }
  const enabled = deps.isEnabled
    ? deps.isEnabled()
    : isMcpTaskResumePollingEnabled()
  if (task.protocol !== 'sep2663' || !enabled) {
    return { outcome: 'cannot' }
  }

  const clients = deps.getMcpClients()
  const targetNorm = normalizeNameForMCP(task.serverName)
  const conn = clients.find(
    c =>
      c.type === 'connected' &&
      (c.name === task.serverName ||
        normalizeNameForMCP(c.name) === targetNorm),
  )
  if (!conn || conn.type !== 'connected') {
    return { outcome: 'poll_failed' }
  }

  const rawClient = conn.client as unknown as RawTaskClient
  let response: TasksGetResponse | 'unknown_to_server' | undefined
  try {
    response = await rawClient.request(
      {
        method: 'tasks/get',
        params: { taskId: task.mcpTaskId },
      },
      { signal },
    )
  } catch (err) {
    if (getErrorCode(err) === ProtocolErrorCode.InvalidParams) {
      response = 'unknown_to_server'
    } else {
      response = undefined
    }
  }

  // Re-check task state after async round-trip in case it finished concurrently.
  const latest = deps.getTask(taskId)
  if (!isMcpTask(latest) || latest.status !== 'running' || latest.notified) {
    return { outcome: 'ended' }
  }

  if (response === undefined) {
    return { outcome: 'poll_failed' }
  }
  if (response === 'unknown_to_server') {
    return { outcome: 'unknown_to_server' }
  }

  const status =
    typeof response.status === 'string' ? response.status : undefined
  if (!status) {
    return { outcome: 'poll_failed' }
  }

  if (status === 'input_required') {
    latest.openQuestion?.()
    return { outcome: 'question', status }
  }

  if (status !== 'working') {
    return { outcome: 'found_end', status }
  }

  const verdict = getPollerVerdict(response._meta)
  switch (verdict) {
    case 'service':
      if (latest.newsToConfirm && latest.newsToConfirm.length > 0) {
        return { outcome: 'busy' }
      }
      deps.updateTask?.(taskId, prev => ({
        ...prev,
        parked: false,
        polledBy: 'service',
      }))
      return { outcome: 'resumed' }
    case 'client':
      deps.updateTask?.(taskId, prev => ({
        ...prev,
        polledBy: 'client',
      }))
      return { outcome: 'try_later' }
    default:
      return { outcome: 'refused' }
  }
}

function logResumeOutcome(outcome: McpTaskResumeOutcome): void {
  if (outcome === 'resumed') {
    logEvent('tengu_feature_ok', {
      feature_name:
        'mcp_task_resume' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else {
    logEvent('tengu_feature_sad', {
      feature_name:
        'mcp_task_resume' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
}

export const McpTaskResumePollingTool = buildTool({
  name: MCP_TASK_RESUME_POLLING_TOOL_NAME,
  searchHint: 'resume tracking of a stopped background MCP task',
  backgrounding: 'never',
  shouldDefer: true,
  maxResultSizeChars: 1000,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isEnabled() {
    return isMcpTaskResumePollingEnabled()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },

  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },

  toAutoClassifierInput(input: McpTaskResumePollingInput) {
    return input.task_id
  },

  renderToolUseMessage(input: Partial<McpTaskResumePollingInput>) {
    return input.task_id ?? ''
  },

  extractSearchText() {
    return ''
  },

  create(deps) {
    return {
      async call({ task_id }: McpTaskResumePollingInput, callCtx) {
        const registry: TaskRegistry | undefined = deps.taskRegistry
        const result: OfferMcpTaskResult = isMcpTaskResumePollingEnabled()
          ? await offerMcpTaskToPoller(
              task_id,
              {
                getTask: id =>
                  registry ? registry.get(id) : deps.tasks()?.[id],
                updateTask: (id, updater) => {
                  if (registry) {
                    registry.update<ExtendedMcpTaskState>(id, updater)
                  } else {
                    deps.setAppState(prev => {
                      const cur = prev.tasks?.[id]
                      if (!isMcpTask(cur)) return prev
                      return {
                        ...prev,
                        tasks: {
                          ...prev.tasks,
                          [id]: updater(cur as ExtendedMcpTaskState),
                        },
                      }
                    })
                  }
                },
                getMcpClients: () => deps.mcpClients(),
              },
              callCtx.signal,
            )
          : { outcome: 'cannot', status: undefined }

        logResumeOutcome(result.outcome)

        return {
          data: formatMcpTaskResumeOutcome(
            result.outcome,
            task_id,
            result.status,
          ),
        }
      },
    }
  },

  mapToolResultToToolResultBlockParam(
    output: McpTaskResumePollingOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
      ...(output.isError ? { is_error: true } : {}),
    }
  },
} satisfies ToolDef<InputSchema, McpTaskResumePollingOutput>)

export { WHEN_TO_USE as MCP_TASK_RESUME_POLLING_WHEN_TO_USE }
