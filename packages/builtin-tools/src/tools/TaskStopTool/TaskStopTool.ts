import { z } from 'zod/v4'
import type { TaskStateBase } from 'src/Task.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { stopTask } from 'src/tasks/stopTask.js'
import { isParkedKeepaliveAgent } from 'src/utils/task/framework.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { DESCRIPTION, TASK_STOP_TOOL_NAME } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z
      .string()
      .optional()
      .describe('The ID of the background task to stop'),
    // shell_id is accepted for backward compatibility with the deprecated KillShell tool
    shell_id: z.string().optional().describe('Deprecated: use task_id instead'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

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

export const TaskStopTool = buildTool({
  name: TASK_STOP_TOOL_NAME,
  searchHint: 'kill a running background task',
  // KillShell is the deprecated name - kept as alias for backward compatibility
  // with existing transcripts and SDK users
  aliases: ['KillShell'],
  maxResultSizeChars: 100_000,
  userFacingName: () => (process.env.USER_TYPE === 'ant' ? '' : 'Stop Task'),
  get inputSchema(): InputSchema {
    return inputSchema()
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
  async validateInput({ task_id, shell_id }, { getAppState }) {
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

    // densable H1e: running OR zle(YC park: completed + keepalive)
    const parked = isParkedKeepaliveAgent(task)
    if (task.status !== 'running' && !parked) {
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
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(output),
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(
    { task_id, shell_id },
    { getAppState, setAppState, abortController, agentId },
  ) {
    // Support both task_id and shell_id (deprecated KillShell compat)
    const id = task_id ?? shell_id
    if (!id) {
      throw new Error('Missing required parameter: task_id')
    }

    // densable H1e / TaskStop call (~0xe201e9a):
    // pNe({ callerAgentId, killedBy:"parent" }) — NO source:"user".
    // parent kill → BRt "was stopped by Claude"; jCe only when source==="user".
    const result = await stopTask(id, {
      getAppState,
      setAppState,
      callerAgentId: agentId,
      killedBy: 'parent',
    })

    return {
      data: {
        message: `Successfully stopped task: ${result.taskId} (${result.command})`,
        task_id: result.taskId,
        task_type: result.taskType,
        command: result.command,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
