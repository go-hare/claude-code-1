import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_MCP_AUTO_BACKGROUND_MS,
  formatMcpAutoBackgroundMovedMessage,
  isMcpAutoBackgroundEnabled,
  resolveMcpAutoBackgroundMs,
} from '../mcpAutoBackground.js'

describe('resolveMcpAutoBackgroundMs (densable Ncy)', () => {
  test('default 120s when env unset and gb default true', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        { gbEnabled: true, isNonInteractiveSession: false },
      ),
    ).toBe(DEFAULT_MCP_AUTO_BACKGROUND_MS)
  })

  test('gb false → 0 when env unset', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        { gbEnabled: false, isNonInteractiveSession: false },
      ),
    ).toBe(0)
  })

  test('env positive', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '5000' },
        { gbEnabled: true, isNonInteractiveSession: false },
      ),
    ).toBe(5000)
  })

  test('env 0 disables', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '0' },
        { gbEnabled: true, isNonInteractiveSession: false },
      ),
    ).toBe(0)
  })

  test('invalid env → 0', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: 'x' },
        { gbEnabled: true, isNonInteractiveSession: false },
      ),
    ).toBe(0)
  })

  test('sse-ide / ws-ide always off', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        {
          transportType: 'sse-ide',
          gbEnabled: true,
          isNonInteractiveSession: false,
        },
      ),
    ).toBe(0)
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        {
          transportType: 'ws-ide',
          gbEnabled: true,
          isNonInteractiveSession: false,
        },
      ),
    ).toBe(0)
  })

  test('non-interactive requires CLAUDE_AUTO_BACKGROUND_TASKS', () => {
    expect(
      resolveMcpAutoBackgroundMs(
        {},
        { gbEnabled: true, isNonInteractiveSession: true },
      ),
    ).toBe(0)
    expect(
      resolveMcpAutoBackgroundMs(
        { CLAUDE_AUTO_BACKGROUND_TASKS: '1' },
        { gbEnabled: true, isNonInteractiveSession: true },
      ),
    ).toBe(DEFAULT_MCP_AUTO_BACKGROUND_MS)
  })
})

describe('isMcpAutoBackgroundEnabled', () => {
  test('on when positive', () => {
    expect(
      isMcpAutoBackgroundEnabled(
        { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '1' },
        { isNonInteractiveSession: false },
      ),
    ).toBe(true)
  })
})

describe('formatMcpAutoBackgroundMovedMessage', () => {
  test('densable copy', () => {
    const msg = formatMcpAutoBackgroundMovedMessage({
      toolLabel: 'mcp__srv__tool',
      elapsedSeconds: 120,
      taskId: 'm1',
    })
    expect(msg).toContain(
      'MCP tool "mcp__srv__tool" is still running after 120s',
    )
    expect(msg).toContain('moved to the background as task m1')
    expect(msg).toContain('TaskStop with task_id "m1"')
    expect(msg).toContain('does not survive exiting this session')
  })
})
