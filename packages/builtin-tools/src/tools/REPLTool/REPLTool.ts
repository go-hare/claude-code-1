import { z } from 'zod/v4'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { REPL_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    code: z
      .string()
      .describe(
        'The code to execute in the REPL. Can call any available tool (Read, Write, Edit, Glob, Grep, Bash, PowerShell, NotebookEdit, Agent, MCP tools) via their APIs.',
      ),
    description: z
      .string()
      .optional()
      .describe('Optional short one-line summary of what this script does.'),
    timeout: z
      .number()
      .optional()
      .describe('Optional timeout in milliseconds for script execution.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type REPLInput = z.infer<InputSchema>

export type REPLMediaBlock =
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }
  | {
      type: 'document'
      source: { type: 'base64'; media_type: string; data: string }
    }

type REPLOutput = {
  result: string
  tool_calls: number
  media?: REPLMediaBlock[]
}

export const REPLTool = buildTool({
  name: REPL_TOOL_NAME,
  aliases: ['Eval'],
  searchHint: 'repl eval execute batch code read write edit glob grep bash',
  // densable 2.1.248 #1 Unt — official enablesCodeExecution:!0 @185592858
  enablesCodeExecution: true,
  maxResultSizeChars: 100_000,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  async description() {
    return 'Execute code in the REPL environment with access to all primitive tools'
  },
  async prompt() {
    return `Execute code in the REPL — a sandboxed environment with direct access to primitive tools (Read, Write, Edit, Glob, Grep, Bash, PowerShell, NotebookEdit, Agent).

When REPL mode is active, primitive tools are only accessible through this tool. Use REPL for:
- Batch operations across many files
- Complex multi-step file transformations
- Operations that benefit from programmatic control flow
- Combining search results with edits in a single turn

The REPL runs in a VM context with tool APIs available as functions. Results from each tool call are collected and returned together.`
  },

  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isTransparentWrapper() {
    return true
  },

  toAutoClassifierInput(input: REPLInput) {
    return input.code
  },

  getToolUseSummary(input: Partial<REPLInput> | undefined): string | null {
    if (!input) return null
    const desc =
      typeof input.description === 'string' ? input.description.trim() : ''
    if (desc.length > 0) return desc
    const firstLine = (input.code ?? '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(l => l.length > 0)
    if (!firstLine) return null
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine
  },

  userFacingName() {
    return REPL_TOOL_NAME
  },

  renderToolUseMessage(input: Partial<REPLInput>) {
    const desc =
      typeof input.description === 'string' ? input.description.trim() : ''
    if (desc.length > 0) return desc
    const code = input.code ?? ''
    const preview = code.length > 80 ? code.slice(0, 77) + '...' : code
    return `REPL: ${preview}`
  },

  mapToolResultToToolResultBlockParam(
    content: REPLOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    if (Array.isArray(content.media) && content.media.length > 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [
          { type: 'text', text: content.result },
          ...(content.media as unknown as Array<{
            type: 'image'
            source: {
              type: 'base64'
              media_type:
                | 'image/jpeg'
                | 'image/png'
                | 'image/gif'
                | 'image/webp'
              data: string
            }
          }>),
        ],
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.result,
    }
  },

  async call(_input: REPLInput) {
    // REPL execution engine is provided by the ant-native runtime.
    // This stub satisfies the tool interface; the actual VM dispatch
    // is wired in the ant build. Without the ant runtime, REPL is
    // not available and callers should be informed.
    return {
      data: {
        result:
          'Error: REPL tool is not available in this build. The REPL execution engine requires the ant-native runtime.',
        tool_calls: 0,
      },
    }
  },
})
