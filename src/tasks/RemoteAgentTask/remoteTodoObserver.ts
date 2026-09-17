/**
 * densable 2.1.246 pGn @213791282 — incremental Task* observer plus
 * last-TodoWrite fallback for the remote-session poll todoList.
 *
 * Official kGn @213807560: W = pGn() once per poll lifetime; observe()
 * each SDK event; todoList: W.todos(). Skip only when
 * (running|starting) && ge===et.todoList && reviewProgress===undefined.
 *
 * Invent-ban: second progress counter, state:"running".
 */

import { TASK_CREATE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskCreateTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskUpdateTool/constants.js'
import { TODO_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TodoWriteTool/constants.js'
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  type TodoItem,
  type TodoList,
  TodoListSchema,
} from '../../utils/todo/types.js'

/** Official t2o — TaskCreateTool mapToolResult prefix. */
const TASK_CREATED_SUCCESS_RE = /^Task #(\S+) created successfully/

/** Official n2o — subject + optional activeForm only (not full tool schema). */
const createInputSchema = lazySchema(() =>
  z.object({
    subject: z.string(),
    activeForm: z.string().optional(),
  }),
)

/** Official r2o. */
const updateInputSchema = lazySchema(() =>
  z.object({
    taskId: z.string(),
    status: z
      .enum(['pending', 'in_progress', 'completed', 'deleted'])
      .optional(),
    subject: z.string().optional(),
    activeForm: z.string().optional(),
  }),
)

const todoWriteInputSchema = lazySchema(() =>
  z.object({ todos: TodoListSchema() }),
)

type ObserverState = {
  pendingCreates: Map<string, TodoItem>
  tasks: Map<string, TodoItem>
}

export type ObservedRemoteEvent = {
  type?: string
  parent_tool_use_id?: string | null
  message?: {
    content?: unknown
  }
}

type ToolUseLike = {
  type?: string
  name?: string
  id?: string
  input?: unknown
}

type ToolResultLike = {
  type?: string
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}

/**
 * Official Xme(t.input) then n?.input ?? t.input. No local Xme twin;
 * unwrap one nested `{input}` or use the raw args.
 */
function unwrapObservedToolInput(input: unknown): unknown {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const nested = (input as { input?: unknown }).input
    if (nested !== undefined) {
      return nested
    }
  }
  return input
}

function contentBlocks(content: unknown): unknown[] | undefined {
  return Array.isArray(content) ? content : undefined
}

/** Official Qo — string or text-block join. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        !!b &&
        typeof b === 'object' &&
        (b as { type?: unknown }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string',
    )
    .map(b => b.text)
    .join('')
}

/** Official o2o. */
function applyObservedToolUse(
  state: ObserverState,
  block: ToolUseLike,
): boolean {
  if (block.name === TASK_CREATE_TOOL_NAME) {
    const parsed = createInputSchema().safeParse(
      unwrapObservedToolInput(block.input),
    )
    if (!parsed.success || typeof block.id !== 'string') {
      return false
    }
    const { subject, activeForm } = parsed.data
    state.pendingCreates.set(block.id, {
      content: subject,
      activeForm: activeForm ?? subject,
      status: 'pending',
    })
    return true
  }
  if (block.name === TASK_UPDATE_TOOL_NAME) {
    const parsed = updateInputSchema().safeParse(
      unwrapObservedToolInput(block.input),
    )
    if (!parsed.success) {
      return false
    }
    const { taskId, status, subject, activeForm } = parsed.data
    if (status === 'deleted') {
      state.tasks.delete(taskId)
      return true
    }
    const prev = state.tasks.get(taskId)
    state.tasks.set(taskId, {
      content: subject ?? prev?.content ?? taskId,
      activeForm: activeForm ?? prev?.activeForm ?? subject ?? taskId,
      status: status ?? prev?.status ?? 'pending',
    })
    return true
  }
  return false
}

/** Official s2o. */
function applyObservedToolResult(
  state: ObserverState,
  block: ToolResultLike,
): boolean {
  if (typeof block.tool_use_id !== 'string') {
    return false
  }
  const pending = state.pendingCreates.get(block.tool_use_id)
  if (!pending) {
    return false
  }
  if (block.is_error) {
    state.pendingCreates.delete(block.tool_use_id)
    return true
  }
  const taskId = toolResultText(block.content).match(
    TASK_CREATED_SUCCESS_RE,
  )?.[1]
  if (!taskId) {
    return false
  }
  state.pendingCreates.delete(block.tool_use_id)
  if (!state.tasks.has(taskId)) {
    state.tasks.set(taskId, pending)
  }
  return true
}

/** Official i2o. */
function snapshotTaskItems(state: ObserverState): TodoList {
  return [...state.tasks.values(), ...state.pendingCreates.values()]
}

/** Official e2o — parse last TodoWrite input.todos. */
export function extractTodoListFromLog(
  log: readonly ObservedRemoteEvent[],
): TodoList {
  const todoListMessage = log.findLast(msg => {
    if (msg.type !== 'assistant') {
      return false
    }
    const blocks = contentBlocks(msg.message?.content)
    return (
      blocks?.some(
        b =>
          !!b &&
          typeof b === 'object' &&
          (b as ToolUseLike).type === 'tool_use' &&
          (b as ToolUseLike).name === TODO_WRITE_TOOL_NAME,
      ) ?? false
    )
  })
  if (!todoListMessage) {
    return []
  }

  const blocks = contentBlocks(todoListMessage.message?.content)
  const input = blocks?.find(
    (b): b is ToolUseLike =>
      !!b &&
      typeof b === 'object' &&
      (b as ToolUseLike).type === 'tool_use' &&
      (b as ToolUseLike).name === TODO_WRITE_TOOL_NAME,
  )?.input
  if (!input) {
    return []
  }

  const parsed = todoWriteInputSchema().safeParse(
    unwrapObservedToolInput(input),
  )
  if (!parsed.success) {
    return []
  }
  return parsed.data.todos
}

/** Official pGn. */
export function createRemoteTodoObserver(): {
  observe: (event: ObservedRemoteEvent) => void
  todos: () => TodoList
} {
  const state: ObserverState = {
    pendingCreates: new Map(),
    tasks: new Map(),
  }
  let lastTodoWrite: ObservedRemoteEvent | undefined
  let cached: TodoList | undefined

  return {
    observe(event) {
      if (event.type === 'assistant' && !event.parent_tool_use_id) {
        const blocks = contentBlocks(event.message?.content)
        if (!blocks) {
          return
        }
        for (const block of blocks) {
          if (
            !!block &&
            typeof block === 'object' &&
            (block as ToolUseLike).type === 'tool_use' &&
            applyObservedToolUse(state, block as ToolUseLike)
          ) {
            cached = undefined
          }
        }
        const todoWrite = blocks.find(
          (b): b is ToolUseLike =>
            !!b &&
            typeof b === 'object' &&
            (b as ToolUseLike).type === 'tool_use' &&
            (b as ToolUseLike).name === TODO_WRITE_TOOL_NAME,
        )
        if (todoWrite) {
          lastTodoWrite = {
            ...event,
            message: { ...event.message, content: [todoWrite] },
          }
          cached = undefined
        }
      } else if (event.type === 'user') {
        const blocks = contentBlocks(event.message?.content)
        if (!blocks) {
          return
        }
        for (const block of blocks) {
          if (
            !!block &&
            typeof block === 'object' &&
            (block as ToolResultLike).type === 'tool_result' &&
            applyObservedToolResult(state, block as ToolResultLike)
          ) {
            cached = undefined
          }
        }
      }
    },
    todos() {
      if (cached === undefined) {
        const items = snapshotTaskItems(state)
        cached =
          items.length > 0
            ? items
            : lastTodoWrite
              ? extractTodoListFromLog([lastTodoWrite])
              : []
      }
      return cached
    },
  }
}
