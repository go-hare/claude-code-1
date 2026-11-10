import { z } from 'zod/v4'
import { buildTool, type ToolCallProgress, type ToolDef } from 'src/Tool.js'
import {
  executeTaskCreatedHooks,
  getTaskCreatedHookMessage,
} from 'src/utils/hooks.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { firstLineOf } from 'src/utils/stringUtils.js'
import {
  createTask,
  deleteTask,
  getTaskListId,
  isTodoV2ToolsEnabled,
} from 'src/utils/tasks.js'
import { getAgentName, getTeamName } from 'src/utils/teammate.js'
import { TASK_CREATE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'

const TASK_CREATE_ALLOWED_KEYS = new Set([
  'subject',
  'description',
  'activeForm',
  'metadata',
])
const TASK_CREATE_SUBJECT_ALIASES = ['title', 'name'] as const
const TASK_CREATE_DESCRIPTION_ALIASES = ['content'] as const
const TASK_CREATE_ACTIVE_FORM_ALIASES = ['active_form'] as const
const TASK_CREATE_KNOWN_STRIP_KEYS = new Set([
  'status',
  'state',
  'priority',
  'prompt',
  'subagent_type',
  'id',
  'type',
  'owner',
  'blocks',
  'blockedBy',
  'addBlocks',
  'addBlockedBy',
])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function hasTasksOrTodosKey(obj: Record<string, unknown>): boolean {
  return 'tasks' in obj || 'todos' in obj
}

function hasAgentToolKeys(obj: Record<string, unknown>): boolean {
  return 'prompt' in obj || 'subagent_type' in obj
}

function deriveSubjectFromDescription(description: string): string {
  const firstLine = firstLineOf(description).trim()
  const chars = Array.from(firstLine)
  if (chars.length <= 80) return firstLine
  const sliced = chars.slice(0, 80).join('')
  const lastSpace = sliced.lastIndexOf(' ')
  return (lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trim()
}

export function coerceTaskCreateInput(input: unknown): {
  input: z.infer<InputSchema>
  shapeClass: string
} | null {
  if (!isPlainRecord(input)) return null
  if (hasTasksOrTodosKey(input)) return null
  const shapeParts: string[] = []
  const reshaped: Record<string, unknown> = { ...input }
  if (
    hasAgentToolKeys(reshaped) &&
    !(
      isNonEmptyString(reshaped.subject) &&
      isNonEmptyString(reshaped.description)
    )
  ) {
    return null
  }
  if (
    !('subject' in reshaped) &&
    !('description' in reshaped) &&
    'task' in reshaped
  ) {
    const taskVal = reshaped.task
    if (isNonEmptyString(taskVal)) {
      delete reshaped.task
      reshaped.description = taskVal
      shapeParts.push('task_wrapper_string')
    } else if (isPlainRecord(taskVal)) {
      if (hasTasksOrTodosKey(taskVal)) return null
      if (
        hasAgentToolKeys(taskVal) &&
        !(
          isNonEmptyString(taskVal.subject) &&
          isNonEmptyString(taskVal.description)
        )
      ) {
        return null
      }
      delete reshaped.task
      Object.assign(reshaped, taskVal)
      shapeParts.push('task_wrapper_object')
    } else {
      return null
    }
  }
  const aliasPairs: ReadonlyArray<[readonly string[], string]> = [
    [TASK_CREATE_SUBJECT_ALIASES, 'subject'],
    [TASK_CREATE_DESCRIPTION_ALIASES, 'description'],
    [TASK_CREATE_ACTIVE_FORM_ALIASES, 'activeForm'],
  ]
  for (const [aliases, target] of aliasPairs) {
    for (const alias of aliases) {
      if (
        alias in reshaped &&
        !(target in reshaped) &&
        isNonEmptyString(reshaped[alias])
      ) {
        reshaped[target] = reshaped[alias]
        delete reshaped[alias]
        shapeParts.push(`alias_${alias}`)
      }
    }
  }
  if (isNonEmptyString(reshaped.subject) && !('description' in reshaped)) {
    reshaped.description = reshaped.subject
    shapeParts.push('backfill_description')
  } else if (
    isNonEmptyString(reshaped.description) &&
    !('subject' in reshaped)
  ) {
    reshaped.subject = deriveSubjectFromDescription(reshaped.description)
    shapeParts.push('backfill_subject')
  }
  if (
    isNonEmptyString(reshaped.subject) &&
    isNonEmptyString(reshaped.description)
  ) {
    for (const key of Object.keys(reshaped)) {
      if (!TASK_CREATE_ALLOWED_KEYS.has(key)) {
        delete reshaped[key]
        shapeParts.push(
          `strip_${TASK_CREATE_KNOWN_STRIP_KEYS.has(key) ? key : 'other'}`,
        )
      }
    }
    if ('activeForm' in reshaped && typeof reshaped.activeForm !== 'string') {
      delete reshaped.activeForm
      shapeParts.push('drop_invalid_activeForm')
    }
    if ('metadata' in reshaped && !isPlainRecord(reshaped.metadata)) {
      delete reshaped.metadata
      shapeParts.push('drop_invalid_metadata')
    }
  }
  if (shapeParts.length === 0) return null
  return {
    input: reshaped as z.infer<InputSchema>,
    shapeClass: shapeParts.join('+'),
  }
}

export function steerTaskCreateValidationError(input: unknown): string | null {
  if (!isPlainRecord(input)) return null
  const taskObj = isPlainRecord(input.task) ? input.task : null
  if (
    hasTasksOrTodosKey(input) ||
    (taskObj !== null && hasTasksOrTodosKey(taskObj))
  ) {
    return 'TaskCreate creates ONE task per call and has no `tasks` or `todos` parameter. Call TaskCreate once per task, passing `subject` (a brief title) and `description` (what needs to be done) as top-level string parameters.'
  }
  if (
    (hasAgentToolKeys(input) ||
      (taskObj !== null && hasAgentToolKeys(taskObj))) &&
    !(isNonEmptyString(input.subject) && isNonEmptyString(input.description))
  ) {
    return 'This call used Agent-tool parameters (`prompt`/`subagent_type`). TaskCreate adds an item to the task list and takes `subject` and `description` string parameters. To delegate work to a subagent, use the Agent tool instead.'
  }
  return null
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    subject: z.string().describe('A brief title for the task'),
    description: z.string().describe('What needs to be done'),
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
      ),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arbitrary metadata to attach to the task'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    task: z.object({
      id: z.string(),
      subject: z.string(),
    }),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TaskCreateTool = buildTool({
  name: TASK_CREATE_TOOL_NAME,
  searchHint: 'create a task in the task list',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskCreate'
  },
  shouldDefer: true,
  coerceInput: coerceTaskCreateInput,
  validationErrorSteer: steerTaskCreateValidationError,
  // densable 2.1.233 Eee: h5() && uX()
  isEnabled() {
    return isTodoV2ToolsEnabled()
  },
  // densable pr: isConcurrencySafe(){return!1}
  isConcurrencySafe() {
    return false
  },
  toAutoClassifierInput(input) {
    return input.subject
  },
  renderToolUseMessage() {
    return null
  },
  async call(
    { subject, description, activeForm, metadata },
    context,
    _canUseTool,
    _parentMessage,
    onProgress?: ToolCallProgress,
  ) {
    const taskId = await createTask(getTaskListId(), {
      subject,
      description,
      activeForm,
      status: 'pending',
      owner: undefined,
      blocks: [],
      blockedBy: [],
      metadata,
    })

    const blockingErrors: string[] = []
    const generator = executeTaskCreatedHooks(
      taskId,
      subject,
      description,
      getAgentName(),
      getTeamName(),
      undefined,
      context?.abortController?.signal,
      undefined,
      context,
    )
    for await (const result of generator) {
      if (result.blockingError) {
        blockingErrors.push(getTaskCreatedHookMessage(result.blockingError))
      }
    }

    if (blockingErrors.length > 0) {
      await deleteTask(getTaskListId(), taskId)
      throw new Error(blockingErrors.join('\n'))
    }

    // densable: 5th-arg onProgress({type:"set_expanded_view"}). Host drops it.
    onProgress?.({
      type: 'set_expanded_view',
      expandedView: 'tasks',
    })

    return {
      data: {
        task: {
          id: taskId,
          subject,
        },
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { task } = content as Output
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task #${task.id} created successfully: ${task.subject}`,
    }
  },
} satisfies ToolDef<InputSchema, Output> & {
  validationErrorSteer?: (input: unknown) => string | null
})
