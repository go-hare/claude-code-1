import { describe, expect, test } from 'bun:test'
import {
  buildWorkflowSizeGuidelineChangeMessage,
  parseWorkflowSizeGuideline,
  workflowSizeGuidelineToAgentCap,
} from '../workflowSizeGuideline.js'

describe('workflowSizeGuidelineToAgentCap', () => {
  test('unrestricted', () => {
    expect(workflowSizeGuidelineToAgentCap('unrestricted')).toBeUndefined()
  })
  test('small', () => {
    expect(workflowSizeGuidelineToAgentCap('small')).toBe(5)
  })
  test('numeric', () => {
    expect(workflowSizeGuidelineToAgentCap(12)).toBe(12)
  })
})

describe('parseWorkflowSizeGuideline', () => {
  test('names', () => {
    expect(parseWorkflowSizeGuideline('medium')).toBe('medium')
  })
  test('string number', () => {
    expect(parseWorkflowSizeGuideline('7')).toBe(7)
  })
})

describe('buildWorkflowSizeGuidelineChangeMessage', () => {
  test('copy', () => {
    expect(buildWorkflowSizeGuidelineChangeMessage('small')).toContain(
      'workflow size guideline',
    )
  })
})
