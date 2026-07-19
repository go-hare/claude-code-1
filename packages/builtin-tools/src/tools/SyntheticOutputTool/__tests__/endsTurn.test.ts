/**
 * densable StructuredOutput endsTurn residual.
 */
import { describe, expect, test } from 'bun:test'
import { SyntheticOutputTool } from '../SyntheticOutputTool.js'

describe('SyntheticOutputTool densable endsTurn', () => {
  test('call returns endsTurn true', async () => {
    // SyntheticOutput's call only consumes input (1-arg ToolDef); endsTurn:!0 densable
    const result = await SyntheticOutputTool.call({ answer: 42 } as never)
    expect(result.data).toBe('Structured output provided successfully')
    expect(result.endsTurn).toBe(true)
    expect(
      (result as { structured_output?: unknown }).structured_output,
    ).toEqual({ answer: 42 })
  })
})
