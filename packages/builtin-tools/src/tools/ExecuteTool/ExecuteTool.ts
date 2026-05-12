import { z } from 'zod/v4'
import {
  buildTool,
  findToolByName,
  type ValidationResult,
  type Tool,
  type ToolDef,
  type ToolUseContext,
  type ToolResult,
  type Tools,
} from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { createUserMessage } from 'src/utils/messages.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
import { EXECUTE_TOOL_NAME } from './constants.js'

export const inputSchema = lazySchema(() =>
  z.object({
    tool_name: z
      .string()
      .describe(
        'The exact name of the target tool to execute (e.g., "CronCreate", "mcp__server__action")',
      ),
    params: z
      .record(z.string(), z.unknown())
      .describe('The parameters to pass to the target tool'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    result: z.unknown(),
    tool_name: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function createErrorResult(toolName: string, content: string) {
  return {
    data: {
      result: null,
      tool_name: toolName,
    },
    newMessages: [
      createUserMessage({
        content,
      }),
    ],
  }
}

function formatValidationResultError(result: ValidationResult): string | null {
  if (result.result) return null
  return result.message
}

export const ExecuteTool = buildTool({
  name: EXECUTE_TOOL_NAME,
  searchHint: 'execute run invoke call a deferred tool by name with parameters',
  maxResultSizeChars: 100_000,
  isConcurrencySafe() {
    return false
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
  },
  async call(input, context, canUseTool, parentMessage, onProgress) {
    const tools: Tools = context.options.tools ?? []

    const targetTool = findToolByName(tools, input.tool_name)
    if (!targetTool) {
      return createErrorResult(
        input.tool_name,
        `Tool "${input.tool_name}" not found. Use SearchExtraTools to discover available tools.`,
      )
    }

    // Check if the target tool is currently enabled
    if (!targetTool.isEnabled()) {
      return createErrorResult(
        input.tool_name,
        `工具 "${input.tool_name}" 当前不可用：Remote Control 未连接。`,
      )
    }

    const parsedInput = targetTool.inputSchema.safeParse(input.params)
    if (!parsedInput.success) {
      return createErrorResult(
        input.tool_name,
        `Input validation failed for tool "${input.tool_name}": ${parsedInput.error.message}`,
      )
    }

    const validationResult = await targetTool.validateInput?.(
      parsedInput.data,
      context,
    )
    const validationError = validationResult
      ? formatValidationResultError(validationResult)
      : null
    if (validationError) {
      return createErrorResult(
        input.tool_name,
        `Input validation failed for tool "${input.tool_name}": ${validationError}`,
      )
    }

    // Check permissions on the target tool
    const permResult = await targetTool.checkPermissions?.(
      parsedInput.data,
      context,
    )
    if (permResult && permResult.behavior === 'deny') {
      return createErrorResult(
        input.tool_name,
        `Permission denied for tool "${input.tool_name}": ${permResult.message ?? 'Permission denied'}`,
      )
    }

    // Delegate execution to the target tool
    const targetResult: ToolResult<unknown> = await targetTool.call(
      parsedInput.data,
      context,
      canUseTool,
      parentMessage,
      onProgress,
    )

    return {
      ...targetResult,
      data: {
        result: targetResult.data,
        tool_name: input.tool_name,
      },
    }
  },
  async checkPermissions() {
    return {
      behavior: 'passthrough',
      message: 'ExecuteExtraTool delegates permission to the target tool.',
    }
  },
  renderToolUseMessage(input) {
    return `Executing ${input.tool_name}...`
  },
  userFacingName() {
    return 'ExecuteExtraTool'
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
