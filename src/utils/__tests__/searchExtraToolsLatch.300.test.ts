import { afterEach, describe, expect, test } from 'bun:test'
import {
  getAutoToolSearchHeldDecision,
  resetAutoToolSearchLatch,
  shouldKeepToolSearchOnRefresh,
} from '../searchExtraTools.js'

describe('#772 auto tool search latch during MCP reconnect', () => {
  const prevEnv = process.env.ENABLE_TOOL_SEARCH

  afterEach(() => {
    resetAutoToolSearchLatch()
    if (prevEnv === undefined) delete process.env.ENABLE_TOOL_SEARCH
    else process.env.ENABLE_TOOL_SEARCH = prevEnv
  })

  test('getAutoToolSearchHeldDecision returns true when ToolSearch was declared, false when omitted in auto mode', () => {
    process.env.ENABLE_TOOL_SEARCH = 'auto'
    expect(getAutoToolSearchHeldDecision(undefined)).toBeUndefined()
    expect(getAutoToolSearchHeldDecision(new Set(['ToolSearch', 'Read']))).toBe(
      true,
    )
    expect(getAutoToolSearchHeldDecision(new Set(['Read']))).toBe(false)
  })

  test('shouldKeepToolSearchOnRefresh preserves auto tool search when toolPoolRefreshes or declared tools exist', () => {
    process.env.ENABLE_TOOL_SEARCH = 'auto'
    expect(
      shouldKeepToolSearchOnRefresh('claude-sonnet-4-6', {
        toolSearchToolFilteredOut: true,
        toolPoolRefreshes: true,
        aheadOfRequest: false,
      }),
    ).toBe(true)
    expect(
      shouldKeepToolSearchOnRefresh('claude-sonnet-4-6', {
        toolSearchToolFilteredOut: true,
        toolPoolRefreshes: false,
        aheadOfRequest: true,
        hasDeclaredTools: true,
      }),
    ).toBe(true)
    expect(
      shouldKeepToolSearchOnRefresh('claude-sonnet-4-6', {
        toolSearchToolFilteredOut: false,
        toolPoolRefreshes: true,
        aheadOfRequest: false,
      }),
    ).toBe(false)
  })
})
