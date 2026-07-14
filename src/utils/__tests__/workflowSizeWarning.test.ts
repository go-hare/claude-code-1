import { describe, expect, test } from 'bun:test'
import {
  evaluateWorkflowSizeWarning,
  formatWorkflowSizeWarningMessage,
  parsePositiveEnvNumber,
  WORKFLOW_SIZE_WARNING_AGENTS_DEFAULT,
  WORKFLOW_SIZE_WARNING_TOKENS_DEFAULT,
} from '../workflowSizeWarning.js'

describe('parsePositiveEnvNumber', () => {
  test('positive only', () => {
    expect(parsePositiveEnvNumber('10')).toBe(10)
    expect(parsePositiveEnvNumber('0')).toBeUndefined()
    expect(parsePositiveEnvNumber('x')).toBeUndefined()
  })
})

describe('evaluateWorkflowSizeWarning', () => {
  test('null under caps', () => {
    expect(
      evaluateWorkflowSizeWarning({
        scheduledAgents: 2,
        startedAgents: 1,
        totalTokens: 100,
        env: {},
      }),
    ).toBeNull()
  })
  test('agents over', () => {
    const w = evaluateWorkflowSizeWarning({
      scheduledAgents: 30,
      startedAgents: 1,
      totalTokens: 100,
      env: {},
    })
    expect(w?.axis).toBe('agents')
    expect(w?.agentCap).toBe(WORKFLOW_SIZE_WARNING_AGENTS_DEFAULT)
  })
  test('tokens over via projection', () => {
    const w = evaluateWorkflowSizeWarning({
      scheduledAgents: 10,
      startedAgents: 1,
      totalTokens: 200_000,
      env: {
        CLAUDE_CODE_WORKFLOW_SIZE_WARNING_TOKENS: '500000',
      },
    })
    // projected = max(200k, 200k*10) = 2M > 500k
    expect(w?.axis).toBe('tokens')
    expect(w?.tokenCap).toBe(500_000)
  })
  test('gb disabled', () => {
    expect(
      evaluateWorkflowSizeWarning({
        scheduledAgents: 100,
        startedAgents: 1,
        totalTokens: 9_000_000,
        gbConfig: { enabled: false },
      }),
    ).toBeNull()
  })
  test('format', () => {
    const msg = formatWorkflowSizeWarningMessage({
      axis: 'both',
      scheduledAgents: 30,
      totalTokens: 2_000_000,
      projectedTokens: 2_000_000,
      agentCap: WORKFLOW_SIZE_WARNING_AGENTS_DEFAULT,
      tokenCap: WORKFLOW_SIZE_WARNING_TOKENS_DEFAULT,
      capFromGuideline: false,
    })
    expect(msg).toContain('Workflow size warning')
    expect(msg).toContain('30')
  })
})
