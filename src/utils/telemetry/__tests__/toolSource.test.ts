import { describe, expect, test } from 'bun:test'
import {
  isSdkHostBuiltinMcp,
  isSdkHostEntrypoint,
  toolSourceAttributes,
} from '../toolSource.js'

describe('toolSourceAttributes (densable u8n)', () => {
  test('builtin when no mcpInfo', () => {
    expect(toolSourceAttributes(undefined, {})).toEqual({
      tool_source: 'builtin',
    })
  })

  test('mcp for ordinary MCP tools', () => {
    expect(
      toolSourceAttributes({ serverType: 'stdio' }, {
        CLAUDE_CODE_ENTRYPOINT: 'cli',
      } as NodeJS.ProcessEnv),
    ).toEqual({ tool_source: 'mcp' })
  })

  test('sdk_host_builtin_mcp when serverType=sdk and host entrypoint', () => {
    const env = {
      CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
    } as NodeJS.ProcessEnv
    expect(isSdkHostEntrypoint(env)).toBe(true)
    expect(isSdkHostBuiltinMcp({ serverType: 'sdk' }, env)).toBe(true)
    expect(toolSourceAttributes({ serverType: 'sdk' }, env)).toEqual({
      tool_source: 'sdk_host_builtin_mcp',
    })
  })

  test('local-agent is host entrypoint; child session is not', () => {
    expect(
      isSdkHostEntrypoint({
        CLAUDE_CODE_ENTRYPOINT: 'local-agent',
      } as NodeJS.ProcessEnv),
    ).toBe(true)
    expect(
      isSdkHostEntrypoint({
        CLAUDE_CODE_ENTRYPOINT: 'local-agent',
        CLAUDE_CODE_CHILD_SESSION: '1',
      } as NodeJS.ProcessEnv),
    ).toBe(false)
    expect(
      toolSourceAttributes({ serverType: 'sdk' }, {
        CLAUDE_CODE_ENTRYPOINT: 'local-agent',
        CLAUDE_CODE_CHILD_SESSION: '1',
      } as NodeJS.ProcessEnv),
    ).toEqual({ tool_source: 'mcp' })
  })
})
