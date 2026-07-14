import { describe, expect, test } from 'bun:test'
import {
  isMcpAutoBackgroundEnabled,
  resolveMcpAutoBackgroundMs,
} from '../mcpAutoBackground.js'

describe('resolveMcpAutoBackgroundMs', () => {
  test('default 0', () => {
    expect(resolveMcpAutoBackgroundMs({})).toBe(0)
  })
  test('positive', () => {
    expect(
      resolveMcpAutoBackgroundMs({
        CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '5000',
      }),
    ).toBe(5000)
  })
  test('invalid', () => {
    expect(
      resolveMcpAutoBackgroundMs({ CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: 'x' }),
    ).toBe(0)
  })
})

describe('isMcpAutoBackgroundEnabled', () => {
  test('on when positive', () => {
    expect(
      isMcpAutoBackgroundEnabled({ CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '1' }),
    ).toBe(true)
  })
})
