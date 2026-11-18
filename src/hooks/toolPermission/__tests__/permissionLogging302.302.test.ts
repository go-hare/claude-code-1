import { afterEach, describe, expect, test } from 'bun:test'
import { extractToolParametersForOTel } from '../permissionLogging.js'

describe('2.1.302 permissionLogging (#907)', () => {
  const origLogDetails = process.env.OTEL_LOG_TOOL_DETAILS

  afterEach(() => {
    if (origLogDetails === undefined) delete process.env.OTEL_LOG_TOOL_DETAILS
    else process.env.OTEL_LOG_TOOL_DETAILS = origLogDetails
  })

  test('#907: extractToolParametersForOTel omits Bash params unless OTEL_LOG_TOOL_DETAILS=1', () => {
    delete process.env.OTEL_LOG_TOOL_DETAILS
    expect(
      extractToolParametersForOTel('Bash', {
        command: 'ls -la',
        timeout: 5000,
      }),
    ).toEqual({})

    process.env.OTEL_LOG_TOOL_DETAILS = '1'
    expect(
      extractToolParametersForOTel('Bash', {
        command: 'ls -la',
        timeout: 5000,
        description: 'list files',
      }),
    ).toEqual({
      bash_command: 'ls',
      full_command: 'ls -la',
      timeout: 5000,
      description: 'list files',
    })
  })

  test('#907: extractToolParametersForOTel includes MCP server/tool when OTEL_LOG_TOOL_DETAILS=1', () => {
    process.env.OTEL_LOG_TOOL_DETAILS = '1'
    expect(
      extractToolParametersForOTel(
        'mcp__srv__tool',
        {},
        { serverName: 'srv', toolName: 'tool', serverType: 'stdio' },
      ),
    ).toEqual({
      mcp_server_name: 'srv',
      mcp_tool_name: 'tool',
    })
  })
})
