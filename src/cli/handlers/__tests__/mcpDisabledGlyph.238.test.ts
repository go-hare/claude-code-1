import { describe, expect, test } from 'bun:test'
import {
  MCP_DISABLED_STATUS,
  mcpDisabledHealthResult,
} from '../mcpDisabledStatus.js'

describe('mcp disabled glyph densable 2.1.238 wah', () => {
  test('glyph is SEA wah exact copy (U+2298)', () => {
    expect(MCP_DISABLED_STATUS).toBe(
      '⊘ Disabled for this project (re-enable via /mcp)',
    )
    expect(MCP_DISABLED_STATUS.charCodeAt(0)).toBe(0x2298)
  })

  test('disabled → status glyph, skip connect', () => {
    expect(mcpDisabledHealthResult(true)).toEqual({
      status: MCP_DISABLED_STATUS,
    })
  })

  test('enabled → null so caller proceeds to health/connect', () => {
    expect(mcpDisabledHealthResult(false)).toBeNull()
  })
})
