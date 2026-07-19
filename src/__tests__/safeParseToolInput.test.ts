/**
 * densable Qae residual — safeParseToolInput(tool, input).
 * Official: function Qae(e,t){let r=e.coerceInput?.(t)??null;return e.inputSchema.safeParse(r===null?t:r.input)}
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { safeParseToolInput } from '../Tool.js'

type ParseResult =
  | { success: true; data: unknown }
  | { success: false; error: { message: string } }

function makeSchema(requiredKey: string) {
  return {
    safeParse(input: unknown): ParseResult {
      if (
        typeof input === 'object' &&
        input !== null &&
        requiredKey in (input as object)
      ) {
        return { success: true, data: input }
      }
      return {
        success: false,
        error: { message: `missing ${requiredKey}` },
      }
    },
  }
}

describe('safeParseToolInput densable Qae', () => {
  test('no coerceInput: parses raw input', () => {
    const tool = {
      inputSchema: makeSchema('path') as any,
    }
    const ok = safeParseToolInput(tool, { path: '/tmp/a' })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data).toEqual({ path: '/tmp/a' })

    const bad = safeParseToolInput(tool, { file: '/tmp/a' })
    expect(bad.success).toBe(false)
  })

  test('coerceInput returns null → falls back to raw (densable ?? null)', () => {
    const tool = {
      inputSchema: makeSchema('path') as any,
      coerceInput: () => null,
    }
    const ok = safeParseToolInput(tool, { path: 'x' })
    expect(ok.success).toBe(true)
  })

  test('coerceInput returns undefined → falls back to raw', () => {
    const tool = {
      inputSchema: makeSchema('path') as any,
      coerceInput: () => undefined as any,
    }
    const ok = safeParseToolInput(tool, { path: 'x' })
    expect(ok.success).toBe(true)
  })

  test('coerceInput remaps alias key then parses remapped input', () => {
    const tool = {
      inputSchema: makeSchema('subject') as any,
      coerceInput: (raw: { [key: string]: unknown }) => {
        if ('title' in raw && !('subject' in raw)) {
          return {
            input: { subject: raw.title, description: raw.description },
            shapeClass: 'title_alias',
          }
        }
        return null
      },
    }
    // Raw would fail schema (no subject)
    const without = safeParseToolInput(
      { inputSchema: makeSchema('subject') as any },
      { title: 'hi', description: 'body' },
    )
    expect(without.success).toBe(false)

    const withCoerce = safeParseToolInput(tool, {
      title: 'hi',
      description: 'body',
    })
    expect(withCoerce.success).toBe(true)
    if (withCoerce.success) {
      expect(withCoerce.data).toEqual({
        subject: 'hi',
        description: 'body',
      })
    }
  })

  test('coerceInput remapped still fails when required keys missing', () => {
    const tool = {
      inputSchema: makeSchema('subject') as any,
      coerceInput: () => ({
        input: { description: 'only desc' },
        shapeClass: 'partial',
      }),
    }
    const r = safeParseToolInput(tool, { foo: 1 })
    expect(r.success).toBe(false)
  })

  test('source anchor matches densable Qae coerce → safeParse shape', () => {
    const src = readFileSync(join(import.meta.dir, '../Tool.ts'), 'utf8')
    expect(src).toContain('export function safeParseToolInput')
    expect(src).toContain('tool.coerceInput?.(')
    expect(src).toContain('tool.inputSchema.safeParse(target)')
    // densable: r===null ? t : r.input  (local also treats undefined)
    expect(src).toContain('coerced === null || coerced === undefined')
    expect(src).toContain('coerced.input')
  })
})
