import { describe, expect, test } from 'bun:test'
import {
  detectTurnInterruption,
  isMcpEndTurnToolResult,
} from '../conversationRecovery.js'
import { buildPrompt } from '../../commands/codeReview.js'

describe('conversationRecovery & codeReview 2.1.296 alignment', () => {
  test('#515 isMcpEndTurnToolResult & detectInterruptedTurn do not rerun turn ended by MCP tool_result', () => {
    const mcpEndTurnMsg = {
      type: 'user',
      uuid: 'u2',
      mcpMeta: { _meta: { 'claude/endTurn': true } },
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'done' },
        ],
      },
    } as never

    expect(isMcpEndTurnToolResult(mcpEndTurnMsg)).toBe(true)

    const assistantCall = {
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'mcp__srv__finish', input: {} },
        ],
      },
    } as never

    expect(detectTurnInterruption([assistantCall, mcpEndTurnMsg]).kind).toBe(
      'none',
    )

    const mcpErrorMsg = {
      type: 'user',
      uuid: 'u3',
      mcpMeta: { _meta: { 'claude/endTurn': true } },
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            is_error: true,
            content: 'boom',
          },
        ],
      },
    } as never
    expect(isMcpEndTurnToolResult(mcpErrorMsg)).toBe(false)
    expect(detectTurnInterruption([assistantCall, mcpErrorMsg]).kind).toBe(
      'interrupted_turn',
    )
  })

  test('#523 buildPrompt prints numbered list when usesReportFindings is false and ReportFindings when true', () => {
    const numbered = buildPrompt(
      'medium',
      '',
      false,
      false,
      '',
      '',
      '',
      undefined,
      undefined,
      false,
    )
    expect(numbered).toContain('numbered list (never as a raw JSON array)')
    expect(numbered).not.toContain('Call the `ReportFindings` tool once')

    const reportFindings = buildPrompt(
      'medium',
      '',
      false,
      false,
      '',
      '',
      '',
      undefined,
      undefined,
      true,
    )
    expect(reportFindings).toContain('Call the `ReportFindings` tool once')
  })
})
