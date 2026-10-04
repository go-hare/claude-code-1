/**
 * densable 2.1.283 smo / GSt — StructuredOutput endsTurn + MCP claude/endTurn.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSyntheticOutputTool } from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import {
  endTurnSourceFromToolResult,
  MCP_END_TURN_META_KEY,
} from '../endTurnFromToolResult.js'

const ROOT = join(import.meta.dir, '../../..')

const SUM_SCHEMA = {
  type: 'object',
  properties: { sum: { type: 'number' } },
  required: ['sum'],
} as const

describe('densable 2.1.283 smo / toolRequestedEndTurn', () => {
  test('smo: toolEndsTurn successful tool_result → tool', () => {
    expect(
      endTurnSourceFromToolResult({
        type: 'user',
        toolEndsTurn: true,
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }],
        },
      }),
    ).toBe('tool')
  })

  test('smo: error tool_result never ends the turn', () => {
    expect(
      endTurnSourceFromToolResult({
        type: 'user',
        toolEndsTurn: true,
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'x',
              content: 'fail',
              is_error: true,
            },
          ],
        },
      }),
    ).toBe(false)
  })

  test('smo: MCP _meta claude/endTurn → mcp_meta', () => {
    expect(
      endTurnSourceFromToolResult({
        type: 'user',
        mcpMeta: { _meta: { [MCP_END_TURN_META_KEY]: true } },
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }],
        },
      }),
    ).toBe('mcp_meta')
  })

  test('smo: assistant / missing flags → false', () => {
    expect(endTurnSourceFromToolResult({ type: 'assistant' })).toBe(false)
    expect(
      endTurnSourceFromToolResult({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }],
        },
      }),
    ).toBe(false)
  })

  test('createSyntheticOutputTool call returns endsTurn:true', async () => {
    const created = createSyntheticOutputTool({ ...SUM_SCHEMA })
    expect('tool' in created).toBe(true)
    if (!('tool' in created)) return
    const out = await created.tool.call(
      { sum: 5 },
      {} as never,
      {} as never,
      {} as never,
    )
    expect(out).toMatchObject({
      data: 'Structured output provided successfully',
      structured_output: { sum: 5 },
      endsTurn: true,
    })
  })

  test('query.ts wraps gold Ud before recurse (tengu_mcp_tool_result_ended_turn)', () => {
    const src = readFileSync(join(ROOT, 'src/query.ts'), 'utf8')
    expect(src).toContain("logEvent('tengu_mcp_tool_result_ended_turn'")
    expect(src).toContain('if (toolRequestedEndTurn)')
    expect(src).toContain('endTurnSourceFromToolResult')
    expect(src).toContain("return { reason: 'completed' }")
  })

  test('Gsn write skip does not invent cleanupPeriodDays===0', () => {
    const src = readFileSync(join(ROOT, 'src/utils/sessionStorage.ts'), 'utf8')
    expect(src).not.toContain('cleanupPeriodDays === 0')
    expect(src).toContain('getPersistenceSuppressCause() !== null')
  })
})
