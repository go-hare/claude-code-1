/**
 * densable 2.1.246 #11 — qPy / V5s nested-string coerce for empty `{}` schemas.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import type { Tool } from '../../Tool.js'
import { normalizeContentFromAPI } from '../messages.js'
import {
  coerceNestedStringifiedToolInput,
  isMetaOnlyJsonSchema,
  resolveJsonSchemaType,
} from '../toolInputNestedStringCoerce.js'

function mcpTool(jsonSchema: {
  type: 'object'
  properties: Record<string, unknown>
}): Tool {
  return {
    name: 'mcp__srv__empty',
    inputSchema: z.object({}).passthrough(),
    inputJSONSchema: jsonSchema,
  } as unknown as Tool
}

describe('densable 2.1.246 #11 qPy/V5s empty-schema coerce', () => {
  test('Y5s: {} and meta-only keys are empty schemas', () => {
    expect(isMetaOnlyJsonSchema({})).toBe(true)
    expect(isMetaOnlyJsonSchema({ description: 'x', title: 'y' })).toBe(true)
    expect(isMetaOnlyJsonSchema({ type: 'string' })).toBe(false)
    expect(isMetaOnlyJsonSchema({ $schema: 'https://json-schema.org' })).toBe(
      false,
    )
  })

  test('SKt prefers object/array over string in anyOf', () => {
    expect(
      resolveJsonSchemaType(
        { anyOf: [{ type: 'string' }, { type: 'object' }] },
        undefined,
      ),
    ).toBe('object')
  })

  test('empty {} property un-stringifies object/array/bool/number', () => {
    const out = coerceNestedStringifiedToolInput(
      {
        payload: '{"a":1}',
        items: '[1,2]',
        flag: 'true',
        count: '3',
        label: 'hello',
      },
      z.object({}).passthrough(),
      {
        properties: {
          payload: {},
          items: {},
          flag: {},
          count: {},
          label: {},
        },
      },
    )
    expect(out.payload).toEqual({ a: 1 })
    expect(out.items).toEqual([1, 2])
    expect(out.flag).toBe(true)
    expect(out.count).toBe(3)
    // parsed string does not match "any" — stay raw
    expect(out.label).toBe('hello')
  })

  test('typed JSON Schema still coerces matching nested strings', () => {
    const out = coerceNestedStringifiedToolInput(
      { items: '["a"]', extra: '{"x":1}' },
      z.object({}).passthrough(),
      {
        properties: {
          items: { type: 'array' },
          extra: { type: 'string' },
        },
      },
    )
    expect(out.items).toEqual(['a'])
    expect(out.extra).toBe('{"x":1}')
  })

  test('Zod object shape coerces optional boolean / array', () => {
    const schema = z.object({
      flag: z.boolean().optional(),
      items: z.array(z.string()),
    })
    const out = coerceNestedStringifiedToolInput(
      { flag: 'false', items: '["a"]', other: '{"k":1}' },
      schema,
    )
    expect(out.flag).toBe(false)
    expect(out.items).toEqual(['a'])
    expect(out.other).toBe('{"k":1}')
  })

  test('mismatched parse stays a string (object schema, array value)', () => {
    const out = coerceNestedStringifiedToolInput(
      { payload: '[1]' },
      z.object({}).passthrough(),
      { properties: { payload: { type: 'object' } } },
    )
    expect(out.payload).toBe('[1]')
  })

  test('normalizeContentFromAPI applies qPy before returning MCP input', () => {
    const tool = mcpTool({
      type: 'object',
      properties: { payload: {}, count: { type: 'integer' } },
    })
    const out = normalizeContentFromAPI(
      [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: tool.name,
          input: JSON.stringify({ payload: '{"ok":true}', count: '2' }),
        },
      ] as never,
      [tool],
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: 'tool_use',
      input: { payload: { ok: true }, count: 2 },
    })
  })
})
