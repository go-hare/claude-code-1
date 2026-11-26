import { z } from 'zod/v4'
import type { TaskStateBase } from 'src/Task.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { isObserverAgentTask } from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { isUnsettledTerminalKillLoop, stopTask } from 'src/tasks/stopTask.js'
import { isParkedKeepaliveAgent } from 'src/utils/task/framework.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import {
  namesRemoteHost,
  REMOTE_TOOL_HOST_FIELD,
  remoteHostNotForwardedMessage,
  remoteHostSchemaProperty,
} from 'src/services/tools/remoteToolHost.js'
import { DESCRIPTION, TASK_STOP_TOOL_NAME } from './prompt.js'
import { renderToolResultMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z
      .string()
      .optional()
      .describe(
        'The ID of the background task to stop. Agent-team teammates and named background agents are also accepted by agent ID or name.',
      ),
    // shell_id is accepted for backward compatibility with the deprecated KillShell tool
    shell_id: z.string().optional().describe('Deprecated: use task_id instead'),
  }),
)
const inputSchemaWithRemoteHost = lazySchema(() =>
  inputSchema().extend({
    [REMOTE_TOOL_HOST_FIELD]: z
      .string()
      .optional()
      .describe(
        remoteHostSchemaProperty()?._host.description ??
          'Target machine name when remote tool forwarding is enabled',
      ),
  }),
)
type InputSchema =
  | ReturnType<typeof inputSchema>
  | ReturnType<typeof inputSchemaWithRemoteHost>

function isTaskStopRemoteExecutionSupported(): boolean {
  try {
    return (
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_violin_varnish', false) ===
      true
    )
  } catch {
    return false
  }
}

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('Status message about the operation'),
    task_id: z.string().describe('The ID of the task that was stopped'),
    task_type: z.string().describe('The type of the task that was stopped'),
    // Optional: tool outputs are persisted to transcripts and replayed on --resume
    // without re-validation, so sessions from before this field was added lack it.
    command: z
      .string()
      .optional()
      .describe('The command or description of the stopped task'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

/**
 * Official 2.1.321 #1956:
 * Truncate commands over 1,000 characters in TaskStop results / notifications
 * to head (500 chars) + tail (300 chars) to save model context.
 */
export const TASK_STOP_COMMAND_MAX_CHARS = 1000
export const TASK_STOP_COMMAND_HEAD_CHARS = 500
export const TASK_STOP_COMMAND_TAIL_CHARS = 300

export function truncateTaskCommandForDisplay(
  command: string | undefined,
): string | undefined {
  if (command === undefined || command.length <= TASK_STOP_COMMAND_MAX_CHARS) {
    return command
  }
  let head = command.slice(0, TASK_STOP_COMMAND_HEAD_CHARS)
  const lastCode = head.charCodeAt(head.length - 1)
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    head = head.slice(0, -1)
  }
  let tail = command.slice(-TASK_STOP_COMMAND_TAIL_CHARS)
  const firstCode = tail.charCodeAt(0)
  if (firstCode >= 0xdc00 && firstCode <= 0xdfff) {
    tail = tail.slice(1)
  }
  const omitted = command.length - head.length - tail.length
  return `${head}…[${omitted} chars omitted]…${tail}`
}

export const TaskStopTool = buildTool({
  name: TASK_STOP_TOOL_NAME,
  searchHint: 'kill a running background task',
  // KillShell / KillBash are deprecated names - kept as aliases for backward compatibility
  // with existing transcripts and SDK users
  aliases: ['KillShell', 'KillBash'],
  // Official 2.1.331 `Ut` (@325140400): `Lde()` (`tengu_violin_varnish`, default off)
  // gates both `remoteExecution.supported` and extending `inputSchema` with `_host`.
  get remoteExecution() {
    return { supported: isTaskStopRemoteExecutionSupported() }
  },
  backgrounding: 'never' as const,
  maxResultSizeChars: 100_000,
  userFacingName: () => 'Stop Task',
  get inputSchema(): InputSchema {
    return isTaskStopRemoteExecutionSupported() &&
      remoteHostSchemaProperty() !== undefined
      ? inputSchemaWithRemoteHost()
      : inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  shouldDefer: true,
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.task_id ?? input.shell_id ?? ''
  },
  async validateInput(input, { getAppState }) {
    // densable xd(r) — a named host is refused before the local lookup (errorCode 3)
    if (namesRemoteHost(input)) {
      return {
        result: false,
        message: remoteHostNotForwardedMessage(),
        errorCode: 3,
      }
    }
    const { task_id, shell_id } = input
    // Support both task_id and shell_id (deprecated KillShell compat)
    const id = task_id ?? shell_id
    if (!id) {
      return {
        result: false,
        message: 'Missing required parameter: task_id',
        errorCode: 1,
      }
    }

    const appState = getAppState()
    let task = appState.tasks?.[id] as TaskStateBase | undefined
    let resolvedId = id

    // densable Elo: allow name/registry resolve in validate
    if (!task) {
      const { resolveTaskForStop, formatTaskNotFoundMessage } = await import(
        'src/tasks/resolveTaskForStop.js'
      )
      const resolved = resolveTaskForStop(id, getAppState)
      if (resolved.status === 'ambiguous') {
        return { result: false, message: resolved.message, errorCode: 1 }
      }
      if (resolved.status === 'found') {
        task = resolved.task
        resolvedId = resolved.taskId
      } else {
        return {
          result: false,
          message: formatTaskNotFoundMessage(
            id,
            getAppState,
            resolved.suggestion,
            undefined,
          ),
          errorCode: 1,
        }
      }
    }

    // Official 2.1.331 `Ut.validateInput` (@325140900): allow running, YC-parked,
    // non-running observer agents (`Sp`), paused `local_workflow`, and unsettled
    // terminal agent/workflow kill-loops (`ho`).
    const parked = isParkedKeepaliveAgent(task)
    const isObserver = isObserverAgentTask(task)
    const pausedWorkflow =
      task.type === 'local_workflow' && task.status === 'paused'
    const unsettledKillLoop = isUnsettledTerminalKillLoop(task, resolvedId)
    if (
      task.status !== 'running' &&
      !parked &&
      !isObserver &&
      !pausedWorkflow &&
      !unsettledKillLoop
    ) {
      return {
        result: false,
        message: `Task ${resolvedId} is not running (status: ${task.status})`,
        errorCode: 3,
      }
    }

    return { result: true }
  },
  async description() {
    return `Stop a running background task by ID`
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    // Official 2.1.331 `Ut.mapToolResultToToolResultBlockParam`: apply `Wre`
    // truncation to `message` and `command` at tool_result serialization time.
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify({
        ...output,
        message:
          truncateTaskCommandForDisplay(output.message) ?? output.message,
        ...(output.command !== undefined
          ? { command: truncateTaskCommandForDisplay(output.command) }
          : {}),
      }),
    }
  },
  renderToolUseMessage() {
    return ''
  },
  renderToolResultMessage,
  async call({ task_id, shell_id }, { getAppState, setAppState, agentId }) {
    // Support both task_id and shell_id (deprecated KillShell compat)
    const id = task_id ?? shell_id
    if (!id) {
      throw new Error('Missing required parameter: task_id')
    }

    // densable H1e / TaskStop call (~0xe201e9a):
    // pNe({ callerAgentId, killedBy:"parent" }) — NO source:"user".
    // parent kill → BRt "was stopped by Claude"; jCe only when source==="user".
    const result = (await stopTask(id, {
      getAppState,
      setAppState,
      callerAgentId: agentId,
      killedBy: 'parent',
    })) as {
      taskId: string
      taskType: string
      command: string | undefined
      note?: string
    }

    return {
      data: {
        message: result.note
          ? `Task ${result.taskId} ${result.note}`
          : `Successfully stopped task: ${result.taskId} (${result.command})`,
        task_id: result.taskId,
        task_type: result.taskType,
        command: result.command,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
