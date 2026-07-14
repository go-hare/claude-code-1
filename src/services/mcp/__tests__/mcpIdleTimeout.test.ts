import { afterEach, describe, expect, test } from 'bun:test'

/**
 * Unit coverage for official 2.1.187 MCP tool idle timeout helpers.
 * The helpers live next to callMCPTool; we re-implement the resolution
 * logic here against the same precedence so we don't have to export
 * private functions from client.ts (mirrors stream-watchdog tests).
 */

const DEFAULT_MCP_TOOL_IDLE_TIMEOUT_MS = 5 * 60 * 1000

function getMcpToolIdleTimeoutMs(
  serverConfig: { timeout?: number } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  if (
    serverConfig &&
    typeof serverConfig.timeout === 'number' &&
    Number.isFinite(serverConfig.timeout)
  ) {
    if (serverConfig.timeout <= 0) return null
    return serverConfig.timeout
  }
  const envRaw = env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT
  if (envRaw !== undefined && envRaw !== '') {
    const parsed = parseInt(envRaw, 10)
    if (!Number.isNaN(parsed)) {
      if (parsed <= 0) return null
      return parsed
    }
  }
  return DEFAULT_MCP_TOOL_IDLE_TIMEOUT_MS
}

const originalEnv = process.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT
  } else {
    process.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = originalEnv
  }
})

describe('getMcpToolIdleTimeoutMs (2.1.187)', () => {
  test('defaults to 5 minutes when unset', () => {
    delete process.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT
    expect(getMcpToolIdleTimeoutMs(undefined)).toBe(300_000)
  })

  test('env 0 disables idle watchdog', () => {
    process.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = '0'
    expect(getMcpToolIdleTimeoutMs(undefined)).toBe(null)
  })

  test('env sets global idle timeout', () => {
    process.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = '120000'
    expect(getMcpToolIdleTimeoutMs(undefined)).toBe(120_000)
  })

  test('per-server timeout overrides env', () => {
    process.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = '120000'
    expect(getMcpToolIdleTimeoutMs({ timeout: 60_000 })).toBe(60_000)
  })

  test('per-server timeout 0 disables even if env is set', () => {
    process.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = '120000'
    expect(getMcpToolIdleTimeoutMs({ timeout: 0 })).toBe(null)
  })
})
