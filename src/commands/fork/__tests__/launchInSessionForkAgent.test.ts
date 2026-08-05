import { describe, expect, test } from 'bun:test'
import {
  deriveInSessionForkDescription,
  deriveInSessionForkName,
  extractAgentIdFromToolResult,
} from '../launchInSessionForkAgent.js'

describe('deriveInSessionForkName (densable pwd)', () => {
  test('first 3 tokens lowercased joined with dash', () => {
    expect(deriveInSessionForkName('Fix the flaky test suite')).toBe(
      'fix-the-flaky',
    )
  })

  test('strips non-alnum, collapses dashes, caps 24', () => {
    expect(deriveInSessionForkName('Hello!!! World??? Foo_Bar')).toBe(
      'hello-world-foobar',
    )
    expect(deriveInSessionForkName('a'.repeat(40))).toBe('a'.repeat(24))
  })

  test('empty / punctuation-only falls back to fork', () => {
    expect(deriveInSessionForkName('')).toBe('fork')
    expect(deriveInSessionForkName('   ')).toBe('fork')
    expect(deriveInSessionForkName('!!!')).toBe('fork')
  })
})

describe('deriveInSessionForkDescription', () => {
  test('collapses whitespace and ellipsizes at 50', () => {
    expect(deriveInSessionForkDescription('  hello   world  ')).toBe(
      'hello world',
    )
    const long = 'x'.repeat(60)
    expect(deriveInSessionForkDescription(long)).toBe(`${'x'.repeat(49)}…`)
  })
})

describe('extractAgentIdFromToolResult', () => {
  test('reads densable/AgentTool async_launched data.agentId', () => {
    expect(
      extractAgentIdFromToolResult({
        data: {
          status: 'async_launched',
          agentId: 'abc-def-1234',
        },
      }),
    ).toBe('abc-def-1234')
  })

  test('reads top-level agentId', () => {
    expect(extractAgentIdFromToolResult({ agentId: 'zzzz9999' })).toBe(
      'zzzz9999',
    )
  })

  test('rejects short / missing ids', () => {
    expect(extractAgentIdFromToolResult({ data: { agentId: 'ab' } })).toBe(
      undefined,
    )
    expect(extractAgentIdFromToolResult(null)).toBe(undefined)
    expect(
      extractAgentIdFromToolResult({ data: { status: 'completed' } }),
    ).toBe(undefined)
  })

  test('does not treat generic id as agentId (avoid false toast)', () => {
    expect(extractAgentIdFromToolResult({ id: 'toolu_xxxx' })).toBe(undefined)
    expect(extractAgentIdFromToolResult({ data: { taskId: 'task-1' } })).toBe(
      undefined,
    )
  })
})
