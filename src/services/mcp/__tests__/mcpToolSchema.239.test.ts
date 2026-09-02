/**
 * densable 2.1.239 vxi / wxi / eHi / tools/list ingest.
 */
import { describe, expect, test } from 'bun:test'
import {
  filterListedMcpToolsBySchema,
  matchMcpHostnameAllowlist,
  normalizeMcpRootCombinators,
  validateMcpToolInputSchema,
} from '../mcpToolSchema.js'

const stdioConfig = { type: 'stdio' as const, command: 'x' }

describe('eHi hostname allowlist (239)', () => {
  test('empty / missing url / bad url are false; * is true', () => {
    expect(
      matchMcpHostnameAllowlist([], { url: 'https://a.example.com' }),
    ).toBe(false)
    expect(matchMcpHostnameAllowlist(['example.com'], {})).toBe(false)
    expect(
      matchMcpHostnameAllowlist(['example.com'], { url: 'not a url' }),
    ).toBe(false)
    expect(matchMcpHostnameAllowlist(['*'], { url: 'https://x.test' })).toBe(
      true,
    )
    expect(matchMcpHostnameAllowlist(['*'], { command: 'npx' })).toBe(true)
  })

  test('exact hostname or subdomain suffix', () => {
    expect(
      matchMcpHostnameAllowlist(['Example.COM'], {
        url: 'https://example.com/mcp',
      }),
    ).toBe(true)
    expect(
      matchMcpHostnameAllowlist(['example.com'], {
        url: 'https://mcp.example.com',
      }),
    ).toBe(true)
    expect(
      matchMcpHostnameAllowlist(['example.com'], {
        url: 'https://notexample.com',
      }),
    ).toBe(false)
  })
})

describe('vxi root combinator flatten (239)', () => {
  test('no combinators stays unchanged', () => {
    expect(
      normalizeMcpRootCombinators({
        type: 'object',
        properties: { a: { type: 'string' } },
      }),
    ).toEqual({ outcome: 'unchanged' })
    expect(normalizeMcpRootCombinators('nope')).toEqual({
      outcome: 'unchanged',
    })
  })

  test('allOf flattens properties + required and writes the allOf note', () => {
    const out = normalizeMcpRootCombinators({
      type: 'object',
      allOf: [
        {
          properties: { a: { type: 'string' } },
          required: ['a'],
        },
        {
          properties: { b: { type: 'number' } },
          required: ['b'],
        },
      ],
    })
    expect(out.outcome).toBe('normalized')
    if (out.outcome !== 'normalized') return
    expect(out.combinators).toEqual(['allOf'])
    expect(out.schema).toMatchObject({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
    })
    expect(out.note).toBe(
      'Input constraint: all listed parameters apply together (flattened from a JSON Schema allOf).',
    )
  })

  test('anyOf / oneOf notes list groups; $ref resolves #/$defs/name', () => {
    const anyOf = normalizeMcpRootCombinators({
      anyOf: [{ required: ['path'] }, { $ref: '#/$defs/urlBranch' }],
      $defs: {
        urlBranch: { required: ['url'] },
      },
    })
    expect(anyOf.outcome).toBe('normalized')
    if (anyOf.outcome !== 'normalized') return
    expect(anyOf.note).toBe(
      'Input constraint: Provide parameters for at least one of: (path) or (url).',
    )

    const oneOf = normalizeMcpRootCombinators({
      oneOf: [{ properties: { a: { type: 'string' } } }],
    })
    expect(oneOf.outcome).toBe('normalized')
    if (oneOf.outcome !== 'normalized') return
    expect(oneOf.note).toBe(
      'Input constraint: Provide parameters for exactly one of: (a).',
    )
  })

  test('non-array combinator drops', () => {
    expect(normalizeMcpRootCombinators({ anyOf: { not: 'an array' } })).toEqual(
      {
        outcome: 'drop',
        reason: 'input schema has top-level anyOf that is not an array',
      },
    )
  })
})

describe('wxi schema validation (239)', () => {
  test('invalid property key fails before meta', () => {
    const result = validateMcpToolInputSchema({
      type: 'object',
      properties: { 'bad key': { type: 'string' } },
    })
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.check).toBe('propertyKey')
    expect(result.detail).toContain('bad key')
  })

  test('plain object schema is valid', () => {
    expect(
      validateMcpToolInputSchema({
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      }).valid,
    ).toBe(true)
  })
})

describe('tools/list ingest (239)', () => {
  const httpConfig = {
    type: 'http',
    url: 'https://mcp.example.com',
  }

  test('default gates skip root combinators; keep raw object tools', () => {
    const kept = filterListedMcpToolsBySchema(
      [
        {
          name: 'plain',
          description: 'ok',
          inputSchema: {
            type: 'object',
            properties: { a: { type: 'string' } },
          },
        },
        {
          name: 'combo',
          description: 'raw',
          inputSchema: {
            allOf: [{ properties: { a: { type: 'string' } } }],
          },
        },
      ],
      { serverName: 'srv', config: stdioConfig },
    )
    expect(kept.map(t => t.name)).toEqual(['plain'])
  })

  test('normalize gate flattens and prefixes description with note..', () => {
    const kept = filterListedMcpToolsBySchema(
      [
        {
          name: 'combo',
          description: 'raw desc',
          inputSchema: {
            allOf: [
              {
                properties: { a: { type: 'string' } },
                required: ['a'],
              },
            ],
          },
        },
      ],
      {
        serverName: 'srv',
        config: httpConfig,
        normalizeRootCombinators: true,
      },
    )
    expect(kept).toHaveLength(1)
    expect(kept[0]?.description).toBe(
      'Input constraint: all listed parameters apply together (flattened from a JSON Schema allOf)...raw desc',
    )
    expect(kept[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    })
  })

  test('drop-invalid skips bad property keys; gated keeps them', () => {
    const bad = {
      name: 'bad',
      inputSchema: {
        type: 'object',
        properties: { 'no spaces': { type: 'string' } },
      },
    }
    const dropped = filterListedMcpToolsBySchema([bad], {
      serverName: 'srv',
      config: httpConfig,
      dropInvalidSchemas: true,
    })
    expect(dropped).toEqual([])
    const kept = filterListedMcpToolsBySchema([bad], {
      serverName: 'srv',
      config: httpConfig,
      dropInvalidSchemas: false,
    })
    expect(kept).toHaveLength(1)
  })
})
