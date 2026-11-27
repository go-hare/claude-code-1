import { z } from 'zod/v4'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import {
  buildTool,
  type ToolCallExecutionOptions,
  type ToolCallProgress,
  type ToolDef,
  type ToolProgressData,
  type ToolResult,
  type ToolUseContext,
} from 'src/Tool.js'
import type { AssistantMessage } from 'src/types/message.js'
import { cronToHuman } from 'src/utils/cron.js'
import { listAllCronTasks } from 'src/utils/cronTasks.js'
import { truncate } from 'src/utils/format.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getTeammateContext } from 'src/utils/teammateContext.js'
import {
  buildCronListPrompt,
  CRON_LIST_DESCRIPTION,
  CRON_LIST_TOOL_NAME,
  isCronManagementEnabled,
  isDurableCronEnabled,
} from './prompt.js'
import { renderListResultMessage, renderListToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    jobs: z.array(
      z.object({
        id: z.string(),
        cron: z.string(),
        humanSchedule: z.string(),
        prompt: z.string(),
        recurring: z.boolean().optional(),
        durable: z.boolean().optional(),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ListOutput = z.infer<OutputSchema>

const builtCronListTool = buildTool({
  name: CRON_LIST_TOOL_NAME,
  searchHint: 'list active cron jobs',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isCronManagementEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async description() {
    return CRON_LIST_DESCRIPTION
  },
  async prompt() {
    return buildCronListPrompt(isDurableCronEnabled())
  },
  create(_deps) {
    return {
      async call() {
        const allTasks = await listAllCronTasks()
        // Teammates only see their own crons; team lead (no ctx) sees all.
        const ctx = getTeammateContext()
        const tasks = ctx
          ? allTasks.filter(t => t.agentId === ctx.agentId)
          : allTasks
        const jobs = tasks.map(t => ({
          id: t.id,
          cron: t.cron,
          humanSchedule: cronToHuman(t.cron),
          prompt: t.prompt,
          ...(t.recurring ? { recurring: true } : {}),
          ...(t.durable === false ? { durable: false } : {}),
        }))
        return { data: { jobs } }
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content:
        output.jobs.length > 0
          ? output.jobs
              .map(
                j =>
                  `${j.id} — ${j.humanSchedule}${j.recurring ? ' (recurring)' : ' (one-shot)'}${j.durable === false ? ' [session-only]' : ''}: ${truncate(j.prompt, 80, true)}`,
              )
              .join('\n')
          : 'No scheduled jobs.',
    }
  },
  renderToolUseMessage: renderListToolUseMessage,
  renderToolResultMessage: renderListResultMessage,
} satisfies ToolDef<InputSchema, ListOutput>)

export const CronListTool: Omit<typeof builtCronListTool, 'call'> & {
  call(
    args?: z.infer<InputSchema>,
    context?: ToolUseContext,
    canUseTool?: CanUseToolFn,
    parentMessage?: AssistantMessage,
    onProgress?: ToolCallProgress<ToolProgressData>,
    opts?: ToolCallExecutionOptions,
  ): Promise<ToolResult<ListOutput>>
} = builtCronListTool as unknown as Omit<typeof builtCronListTool, 'call'> & {
  call(
    args?: z.infer<InputSchema>,
    context?: ToolUseContext,
    canUseTool?: CanUseToolFn,
    parentMessage?: AssistantMessage,
    onProgress?: ToolCallProgress<ToolProgressData>,
    opts?: ToolCallExecutionOptions,
  ): Promise<ToolResult<ListOutput>>
}
