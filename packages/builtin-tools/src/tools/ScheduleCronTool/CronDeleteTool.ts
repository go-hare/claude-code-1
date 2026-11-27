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
  type ValidationResult,
} from 'src/Tool.js'
import type { AssistantMessage } from 'src/types/message.js'
import {
  getCronFilePath,
  listAllCronTasks,
  removeCronTasks,
} from 'src/utils/cronTasks.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getTeammateContext } from 'src/utils/teammateContext.js'
import {
  buildCronDeletePrompt,
  CRON_DELETE_DESCRIPTION,
  CRON_DELETE_TOOL_NAME,
  isCronManagementEnabled,
  isDurableCronEnabled,
} from './prompt.js'
import { renderDeleteResultMessage, renderDeleteToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    id: z.string().describe('Job ID returned by CronCreate.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    id: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type DeleteOutput = z.infer<OutputSchema>

const builtCronDeleteTool = buildTool({
  name: CRON_DELETE_TOOL_NAME,
  searchHint: 'cancel a scheduled cron job',
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
  toAutoClassifierInput(input) {
    return input.id
  },
  async description() {
    return CRON_DELETE_DESCRIPTION
  },
  async prompt() {
    return buildCronDeletePrompt(isDurableCronEnabled())
  },
  getPath() {
    return getCronFilePath()
  },
  create(_deps) {
    return {
      async validateInput(input): Promise<ValidationResult> {
        const tasks = await listAllCronTasks()
        const task = tasks.find(t => t.id === input.id)
        if (!task) {
          return {
            result: false,
            message: `No scheduled job with id '${input.id}'`,
            errorCode: 1,
          }
        }
        // Teammates may only delete their own crons.
        const ctx = getTeammateContext()
        if (ctx && task.agentId !== ctx.agentId) {
          return {
            result: false,
            message: `Cannot delete cron job '${input.id}': owned by another agent`,
            errorCode: 2,
          }
        }
        return { result: true }
      },
      async call({ id }) {
        await removeCronTasks([id])
        return { data: { id } }
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Cancelled job ${output.id}.`,
    }
  },
  renderToolUseMessage: renderDeleteToolUseMessage,
  renderToolResultMessage: renderDeleteResultMessage,
} satisfies ToolDef<InputSchema, DeleteOutput>)

export const CronDeleteTool: Omit<typeof builtCronDeleteTool, 'call'> & {
  call(
    args: z.infer<InputSchema>,
    context?: ToolUseContext,
    canUseTool?: CanUseToolFn,
    parentMessage?: AssistantMessage,
    onProgress?: ToolCallProgress<ToolProgressData>,
    opts?: ToolCallExecutionOptions,
  ): Promise<ToolResult<DeleteOutput>>
} = builtCronDeleteTool as unknown as Omit<
  typeof builtCronDeleteTool,
  'call'
> & {
  call(
    args: z.infer<InputSchema>,
    context?: ToolUseContext,
    canUseTool?: CanUseToolFn,
    parentMessage?: AssistantMessage,
    onProgress?: ToolCallProgress<ToolProgressData>,
    opts?: ToolCallExecutionOptions,
  ): Promise<ToolResult<DeleteOutput>>
}
