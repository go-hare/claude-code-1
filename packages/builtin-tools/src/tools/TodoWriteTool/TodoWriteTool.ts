import { z } from 'zod/v4'
import { getSessionId } from 'src/bootstrap/state.js'
import { buildTool, type ToolDef, type ToolDeps } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { isTodoWriteToolEnabled } from 'src/utils/tasks.js'
import { TodoListSchema } from 'src/utils/todo/types.js'
import { TODO_WRITE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    todos: TodoListSchema().describe('The updated todo list'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    oldTodos: TodoListSchema().describe('The todo list before the update'),
    newTodos: TodoListSchema().describe('The todo list after the update'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TodoWriteTool = buildTool({
  name: TODO_WRITE_TOOL_NAME,
  searchHint: 'manage the session task checklist',
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return ''
  },
  shouldDefer: true,
  // densable 2.1.233: !h5() && uX()
  isEnabled() {
    return isTodoWriteToolEnabled()
  },
  toAutoClassifierInput(input) {
    return `${input.todos.length} items`
  },
  renderToolUseMessage() {
    return null
  },
  create(deps: ToolDeps) {
    return {
      async checkPermissions(input) {
        // No permission checks required for todo operations
        return { behavior: 'allow', updatedInput: input }
      },
      async call({ todos }) {
        const todoKey = deps.agentId ?? getSessionId()
        const oldTodos = deps.todos.get(todoKey) ?? []
        const allDone = todos.every(_ => _.status === 'completed')
        const newTodos = allDone ? [] : todos

        deps.todos.set(todoKey, newTodos)

        return {
          data: {
            oldTodos,
            newTodos: todos,
          },
        }
      },
    }
  },
  mapToolResultToToolResultBlockParam(_output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
