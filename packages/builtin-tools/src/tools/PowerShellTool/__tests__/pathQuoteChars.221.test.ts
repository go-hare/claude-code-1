/**
 * densable 2.1.221 #6 — PowerShell paths containing quote characters.
 *
 * SEA gold (`pWo` / B3 / SQ / jce):
 * - B3 strips ALL quote chars (ASCII + smart quotes U+2018–U+201F)
 * - When original had quotes: deny still wins via multi-variant guess
 * - If stripped form would auto-allow → force ask with exact reason string
 * - Surrounding-only strip is NOT enough (inner quotes must still force ask)
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../../../../tests/mocks/log'
import { debugMock } from '../../../../../../tests/mocks/debug'
import {
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from 'src/bootstrap/state.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('bun:bundle', () => ({
  feature: (_name: string) => false,
}))

;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}

const {
  PATHS_CONTAINING_QUOTE_REASON,
  stripAllPathQuotes,
  stripSurroundingPathQuotes,
  unquotePowerShellPathStyle,
  validatePath,
} = await import('../pathValidation.js')
const { getEmptyToolPermissionContext } = await import('src/Tool.js')

// validatePath → isSessionMemoryPath → getProjectDir(sanitizePath(projectRoot)).
// Full-suite pollution can leave projectRoot undefined → sanitizePathRaw TypeError.
const suiteCwd = process.cwd()
beforeEach(() => {
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  setProjectRoot(suiteCwd)
})
afterEach(() => {
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  setProjectRoot(suiteCwd)
})

function makeContext(
  overrides: Partial<ReturnType<typeof getEmptyToolPermissionContext>> = {},
): ReturnType<typeof getEmptyToolPermissionContext> {
  return {
    ...getEmptyToolPermissionContext(),
    mode: 'acceptEdits',
    ...overrides,
  }
}

describe('densable 2.1.221 B3/SQ/jce quote helpers', () => {
  test('B3 stripAllPathQuotes removes surrounding and inner quotes', () => {
    expect(stripAllPathQuotes('"C:\\foo\\bar.txt"')).toBe('C:\\foo\\bar.txt')
    expect(stripAllPathQuotes(`C:\\weird"name\\file.txt`)).toBe(
      'C:\\weirdname\\file.txt',
    )
    expect(stripAllPathQuotes(`\u201Csmart\u201D`)).toBe('smart')
  })

  test('SQ stripSurroundingPathQuotes leaves inner quotes', () => {
    expect(stripSurroundingPathQuotes('"C:\\foo\\bar.txt"')).toBe(
      'C:\\foo\\bar.txt',
    )
    expect(stripSurroundingPathQuotes(`C:\\weird"name\\file.txt`)).toBe(
      `C:\\weird"name\\file.txt`,
    )
  })

  test('jce unquotePowerShellPathStyle strips matching pairs and doubles', () => {
    expect(unquotePowerShellPathStyle(`'C:\\foo\\bar.txt'`)).toBe(
      'C:\\foo\\bar.txt',
    )
    // doubled single-quote → one literal '
    expect(unquotePowerShellPathStyle(`'it''s.txt'`)).toBe(`it's.txt`)
  })
})

describe('densable 2.1.221 validatePath quote characters → ask', () => {
  test('inner quote characters force ask even when stripped form is in cwd', () => {
    const cwd = process.cwd()
    // Path with an embedded double-quote character. After B3 strip it becomes
    // a cwd-relative file that acceptEdits would otherwise auto-allow.
    const quoted = `${cwd}\\report"draft".md`.replace(/\\/g, '/')
    const result = validatePath(quoted, cwd, makeContext(), 'read')
    expect(result.allowed).toBe(false)
    expect(result.decisionReason).toEqual({
      type: 'other',
      reason: PATHS_CONTAINING_QUOTE_REASON,
    })
  })

  test('surrounding quotes alone force ask (not silent allow after strip)', () => {
    const cwd = process.cwd()
    const quoted = `"${cwd}/safe.txt"`.replace(/\\/g, '/')
    const result = validatePath(quoted, cwd, makeContext(), 'read')
    expect(result.allowed).toBe(false)
    expect(result.decisionReason?.type).toBe('other')
    expect(
      (result.decisionReason as { type: 'other'; reason: string }).reason,
    ).toBe(PATHS_CONTAINING_QUOTE_REASON)
  })

  test('smart quotes (U+201C/U+201D) force ask', () => {
    const cwd = process.cwd()
    const quoted = `\u201C${cwd}/smart.txt\u201D`
    const result = validatePath(quoted, cwd, makeContext(), 'read')
    expect(result.allowed).toBe(false)
    expect(
      (result.decisionReason as { type: 'other'; reason: string } | undefined)
        ?.reason,
    ).toBe(PATHS_CONTAINING_QUOTE_REASON)
  })

  test('path without quotes can still auto-allow under acceptEdits', () => {
    const cwd = process.cwd()
    const plain = `${cwd}/plain.txt`.replace(/\\/g, '/')
    const result = validatePath(plain, cwd, makeContext(), 'read')
    expect(result.allowed).toBe(true)
  })
})
