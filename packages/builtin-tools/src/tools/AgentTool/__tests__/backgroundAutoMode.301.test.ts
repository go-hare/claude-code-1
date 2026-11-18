import { describe, expect, test } from 'bun:test'
import { classifyHandoffIfNeeded } from '../agentToolUtils.js'

describe('#687 background subagents in auto mode (agentToolUtils)', () => {
  test('classifyHandoffIfNeeded returns null when permission mode is not auto', async () => {
    const result = await classifyHandoffIfNeeded({
      agentMessages: [],
      tools: [],
      toolPermissionContext: {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      } as never,
      abortSignal: new AbortController().signal,
      subagentType: 'general-purpose',
      totalToolUseCount: 0,
    })
    expect(result).toBeNull()
  })

  test('classifyHandoffIfNeeded returns null in auto mode when transcript is empty', async () => {
    const result = await classifyHandoffIfNeeded({
      agentMessages: [],
      tools: [],
      toolPermissionContext: {
        mode: 'auto',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      } as never,
      abortSignal: new AbortController().signal,
      subagentType: 'general-purpose',
      totalToolUseCount: 0,
    })
    expect(result).toBeNull()
  })
})
