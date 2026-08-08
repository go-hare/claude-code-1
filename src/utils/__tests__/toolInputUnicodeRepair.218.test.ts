/**
 * densable 2.1.218 #3 — jYd/L6s/Cky Windows `\u` path skip + unicode repair.
 */
import { describe, expect, test } from 'bun:test'
import {
  repairDoubleEscapedUnicode,
  repairDoubleEscapedUnicodeDeep,
  WINDOWS_PATH_UNICODE_SKIP,
  type UnicodeRepairStats,
} from '../toolInputUnicodeRepair.js'

function stats(): UnicodeRepairStats {
  return { repairedStrings: 0, windowsPathSkips: 0 }
}

describe('densable 2.1.218 #3 jYd/L6s/Cky', () => {
  test('Cky matches drive path with \\u segment', () => {
    expect(WINDOWS_PATH_UNICODE_SKIP.test('C:\\Users\\u4e2d\\file')).toBe(true)
    expect(WINDOWS_PATH_UNICODE_SKIP.test('D:/Users/unicorn/x')).toBe(true)
    expect(WINDOWS_PATH_UNICODE_SKIP.test('plain \\u4e2d text')).toBe(false)
  })

  test('Windows path with \\u + 4 hex stays literal (no CJK corruption)', () => {
    const path = 'C:\\Users\\u4e2d\\file.txt'
    const s = stats()
    const out = repairDoubleEscapedUnicodeDeep(path, s)
    expect(out).toBe(path)
    expect(s.windowsPathSkips).toBe(1)
    expect(s.repairedStrings).toBe(0)
  })

  test('non-path double-escaped \\uXXXX is repaired to codepoint', () => {
    // After JSON.parse, string content is backslash + u + hex
    const raw = 'hello \\u4e2d world'
    const s = stats()
    const out = repairDoubleEscapedUnicodeDeep(raw, s)
    expect(out).toBe('hello 中 world')
    expect(s.repairedStrings).toBe(1)
    expect(s.windowsPathSkips).toBe(0)
  })

  test('recursive object/array walk', () => {
    const input = {
      path: 'C:\\Users\\u4e2d\\x',
      note: 'see \\u0041',
      nested: ['C:\\Temp\\u0042', 'plain \\u0043'],
    }
    const s = stats()
    const out = repairDoubleEscapedUnicodeDeep(input, s) as typeof input
    expect(out.path).toBe('C:\\Users\\u4e2d\\x')
    expect(out.note).toBe('see A')
    expect(out.nested[0]).toBe('C:\\Temp\\u0042')
    expect(out.nested[1]).toBe('plain C')
    expect(s.windowsPathSkips).toBeGreaterThanOrEqual(2)
    expect(s.repairedStrings).toBeGreaterThanOrEqual(2)
  })

  test('lone surrogate escape kept literal', () => {
    const raw = 'x\\uD800y'
    const s = stats()
    const out = repairDoubleEscapedUnicodeDeep(raw, s)
    expect(out).toBe(raw)
  })

  test('jYd entry returns repaired value (telemetry is fire-and-forget)', () => {
    const out = repairDoubleEscapedUnicode({
      file_path: 'C:\\Users\\unicorn\\a.ts',
    }) as { file_path: string }
    expect(out.file_path).toBe('C:\\Users\\unicorn\\a.ts')
  })
})
