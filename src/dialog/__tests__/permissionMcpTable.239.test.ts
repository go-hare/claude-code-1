/**
 * densable fiu / CFn / K_w / yCe (2.1.239 Iiu MCP table).
 */
import { describe, expect, test } from 'bun:test'
import {
  buildMcpParamTable,
  clipWrappedLines,
  isUnrenderableEntry,
  paramFormatHintsFromSchema,
  parseFailureSentinel,
  PROMPT_DESCRIPTION_LINE_CAP,
} from '../permissionMcpTable.js'

describe('CFn clipWrappedLines', () => {
  test('Kgy is 2; short text is unchanged', () => {
    expect(PROMPT_DESCRIPTION_LINE_CAP).toBe(2)
    expect(clipWrappedLines('short', 40, PROMPT_DESCRIPTION_LINE_CAP)).toBe(
      'short',
    )
  })

  test('clips wrapped lines and ellipsizes the last kept line', () => {
    const text = 'one two three four five six seven eight nine ten'
    const clipped = clipWrappedLines(text, 12, 2)
    const lines = clipped.split('\n')
    expect(lines.length).toBe(2)
    expect(clipped.includes('…')).toBe(true)
  })

  test('non-positive width or lines is empty', () => {
    expect(clipWrappedLines('abc', 0, 2)).toBe('')
    expect(clipWrappedLines('abc', 10, 0)).toBe('')
  })
})

describe('K_w paramFormatHintsFromSchema', () => {
  test('keeps only date-time formats from properties', () => {
    expect(
      paramFormatHintsFromSchema({
        properties: {
          when: { format: 'date-time' },
          other: { format: 'email' },
          bare: { type: 'string' },
        },
      }),
    ).toEqual({ when: 'date-time' })
    expect(paramFormatHintsFromSchema(undefined)).toBe(undefined)
    expect(paramFormatHintsFromSchema({ properties: [] })).toBe(undefined)
  })
})

describe('fiu buildMcpParamTable', () => {
  test('non-object input is unrenderable', () => {
    const rows = buildMcpParamTable(['x'])
    expect(rows).toEqual([
      {
        kind: 'inline',
        key: 'input',
        text: '(parameters are not an object — deny unless expected)',
        unrenderable: true,
      },
    ])
    expect(rows.some(isUnrenderableEntry)).toBe(true)
  })

  test('yCe parse-failure sentinel', () => {
    expect(
      parseFailureSentinel({
        __unparsedToolInput: { raw: '{', len: 1 },
      }),
    ).toBe('input JSON failed to parse — 1 bytes')
    const rows = buildMcpParamTable({
      __unparsedToolInput: { raw: '{', len: 1 },
    })
    expect(rows[0]?.parseFailureSentinel).toBe(true)
    expect(rows[0]?.unrenderable).toBe(true)
  })

  test('plain object becomes inline key/value rows', () => {
    const rows = buildMcpParamTable({ path: '/tmp', n: 2, ok: true })
    expect(rows.some(isUnrenderableEntry)).toBe(false)
    expect(rows).toEqual([
      { kind: 'inline', key: 'path', text: '"/tmp"' },
      { kind: 'inline', key: 'n', text: '2' },
      { kind: 'inline', key: 'ok', text: 'true' },
    ])
  })

  test('http(s) string values stamp linkUrl for miu sz', () => {
    const rows = buildMcpParamTable({ url: 'https://example.com' })
    expect(rows[0]).toMatchObject({
      kind: 'inline',
      key: 'url',
      text: '"https://example.com"',
      linkUrl: 'https://example.com',
    })
  })
})
