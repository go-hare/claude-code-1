import { describe, expect, test } from 'bun:test'
import { SEND_FEEDBACK_TOOL_NAME } from '../constants.js'
import { SendFeedbackTool } from '../SendFeedbackTool.js'

describe('densable leftover SendFeedback tool object', () => {
  test('name / searchHint / schemas / gates match leftover', () => {
    expect(SendFeedbackTool.name).toBe(SEND_FEEDBACK_TOOL_NAME)
    expect(SendFeedbackTool.name).toBe('SendFeedback')
    expect(SendFeedbackTool.searchHint).toBe(
      'draft product or model-behavior feedback report queue',
    )
    expect(SendFeedbackTool.maxResultSizeChars).toBe(1000)
    expect(
      SendFeedbackTool.isReadOnly({
        type: 'bug',
        title: 't',
        details: 'd',
      }),
    ).toBe(false)
    expect(SendFeedbackTool.isConcurrencySafe()).toBe(true)
    const parsed = SendFeedbackTool.inputSchema.safeParse({
      type: 'bug',
      title: 'Edit failed',
      details: '**What happened:** boom',
      failure_mode: 'overconfidence_and_hallucination',
      task_category: 'code_edit',
    })
    expect(parsed.success).toBe(true)
    expect(
      SendFeedbackTool.inputSchema.safeParse({
        type: 'nope',
        title: 'x',
        details: 'y',
      }).success,
    ).toBe(false)
  })
})
