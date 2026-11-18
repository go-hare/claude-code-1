import { afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  EMPTY_OBJECT_TOOL_SCHEMA,
  getRefusedToolSchemas,
  RefusedToolSchemaResolver,
  replaceRefusedToolSchemas,
  resetRefusedToolSchemas,
} from '../mcpToolSchema.js'

describe('#790 MCP tool schema 400 fallback', () => {
  afterEach(() => {
    resetRefusedToolSchemas()
  })

  test('resolves 400 tools.N.input_schema on MCP tool and replaces schema with { type: "object" }', () => {
    const refusedMap = getRefusedToolSchemas()
    const resolver = new RefusedToolSchemaResolver(refusedMap)
    const badSchema = {
      type: 'object',
      properties: { bad: { type: 'string', pattern: '[' } },
    }
    const toolSchemas = [
      { name: 'Read', input_schema: { type: 'object' } },
      {
        name: 'mcp__srv__broken',
        input_schema: badSchema,
        eager_input_streaming: true,
      },
    ]
    const err = new APIError(
      400,
      {
        error: {
          message: 'tools.1.custom.input_schema: JSON schema is invalid',
        },
      },
      'tools.1.custom.input_schema: JSON schema is invalid',
      new Headers(),
    )

    const token = resolver.resolve(
      err,
      toolSchemas,
      [
        { name: 'Read', isMcp: false },
        {
          name: 'mcp__srv__broken',
          isMcp: true,
          mcpInfo: { serverName: 'srv', toolName: 'broken' },
        },
      ],
      'query',
    )
    expect(token).toBe('retry:tool-schema-refused-1')

    const replaced = replaceRefusedToolSchemas(toolSchemas, refusedMap)
    expect(replaced[0]).toEqual(toolSchemas[0])
    expect(replaced[1]).toEqual({
      name: 'mcp__srv__broken',
      input_schema: EMPTY_OBJECT_TOOL_SCHEMA,
    })
    expect('eager_input_streaming' in replaced[1]!).toBe(false)
  })

  test('does not replace non-MCP tool schemas', () => {
    const resolver = new RefusedToolSchemaResolver(getRefusedToolSchemas())
    const err = new APIError(
      400,
      {},
      'tools.0.input_schema: invalid',
      new Headers(),
    )
    const token = resolver.resolve(
      err,
      [{ name: 'Bash', input_schema: { type: 'object', properties: {} } }],
      [{ name: 'Bash', isMcp: false }],
    )
    expect(token).toBeUndefined()
  })
})
