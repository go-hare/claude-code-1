/**
 * densable 2.1.222 #6 — MCP usage attribution (sticky stamp fix).
 * SEA: Br/To capture + ARd clear; V = main|subagent; cost attrs mcp_server.name.
 */
import { describe, expect, test } from 'bun:test'
import {
  captureAndClearActiveMcpAttribution,
  clearActiveMcpStamps,
  mcpUsageCounterAttrs,
  shouldAttributeMcpUsage,
  stampActiveMcpOnCall,
  type ActiveMcpStamps,
} from '../mcpUsageAttribution.js'

describe('shouldAttributeMcpUsage (densable V)', () => {
  test('main and subagent attribute', () => {
    expect(shouldAttributeMcpUsage('main')).toBe(true)
    expect(shouldAttributeMcpUsage('subagent')).toBe(true)
  })

  test('auxiliary and undefined do not attribute', () => {
    expect(shouldAttributeMcpUsage('auxiliary')).toBe(false)
    expect(shouldAttributeMcpUsage(undefined)).toBe(false)
  })
})

describe('captureAndClearActiveMcpAttribution (densable Br/To + ARd)', () => {
  test('main/subagent captures stamps then clears options', () => {
    const options: ActiveMcpStamps = {
      activeMcpServer: 'github',
      activeMcpTool: 'search_code',
    }
    const captured = captureAndClearActiveMcpAttribution(options, true)
    expect(captured).toEqual({
      activeMcpServer: 'github',
      activeMcpTool: 'search_code',
    })
    expect(options.activeMcpServer).toBeUndefined()
    expect(options.activeMcpTool).toBeUndefined()
  })

  test('auxiliary does not capture and does not clear sticky stamps', () => {
    const options: ActiveMcpStamps = {
      activeMcpServer: 'github',
      activeMcpTool: 'search_code',
    }
    const captured = captureAndClearActiveMcpAttribution(options, false)
    expect(captured).toEqual({
      activeMcpServer: undefined,
      activeMcpTool: undefined,
    })
    // densable ARd no-op when !V — stamps remain for a later main request
    expect(options.activeMcpServer).toBe('github')
    expect(options.activeMcpTool).toBe('search_code')
  })

  test('second capture after clear is empty — no sticky over-attribution', () => {
    const options: ActiveMcpStamps = {}
    stampActiveMcpOnCall(options, 'slack', 'post_message')
    const first = captureAndClearActiveMcpAttribution(options, true)
    expect(first.activeMcpServer).toBe('slack')
    const second = captureAndClearActiveMcpAttribution(options, true)
    expect(second.activeMcpServer).toBeUndefined()
    expect(second.activeMcpTool).toBeUndefined()
  })
})

describe('clearActiveMcpStamps (densable ARd)', () => {
  test('clears only when shouldAttribute', () => {
    const options: ActiveMcpStamps = {
      activeMcpServer: 'a',
      activeMcpTool: 'b',
    }
    clearActiveMcpStamps(options, false)
    expect(options.activeMcpServer).toBe('a')
    clearActiveMcpStamps(options, true)
    expect(options.activeMcpServer).toBeUndefined()
    expect(options.activeMcpTool).toBeUndefined()
  })
})

describe('mcpUsageCounterAttrs (densable qur)', () => {
  test('emits mcp_server.name and optional mcp_tool.name', () => {
    expect(
      mcpUsageCounterAttrs({
        activeMcpServer: 'github',
        activeMcpTool: 'list_prs',
      }),
    ).toEqual({
      'mcp_server.name': 'github',
      'mcp_tool.name': 'list_prs',
    })
  })

  test('empty when no server stamp', () => {
    expect(
      mcpUsageCounterAttrs({
        activeMcpServer: undefined,
        activeMcpTool: 'x',
      }),
    ).toEqual({})
    expect(mcpUsageCounterAttrs(null)).toEqual({})
  })
})
