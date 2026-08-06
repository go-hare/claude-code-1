import { describe, expect, test } from 'bun:test'
import {
  interpretCommandResult,
  lastCommandSegment,
  parseNativeCommandToken,
} from '../commandSemantics'

describe('interpretCommandResult', () => {
  describe('grep / rg', () => {
    test('grep exit 0 is not error', () => {
      const result = interpretCommandResult('grep pattern file', 0, 'match', '')
      expect(result.isError).toBe(false)
    })

    test('grep exit 1 (no match) is not error', () => {
      const result = interpretCommandResult('grep pattern file', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No matches found')
    })

    test('grep exit 2 is error', () => {
      const result = interpretCommandResult('grep pattern file', 2, '', 'error')
      expect(result.isError).toBe(true)
    })

    test('rg exit 1 (no match) is not error', () => {
      const result = interpretCommandResult('rg pattern', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('grep.exe is recognized', () => {
      const result = interpretCommandResult('grep.exe pattern file', 1, '', '')
      expect(result.isError).toBe(false)
    })
  })

  describe('findstr', () => {
    test('findstr exit 1 (no match) is not error', () => {
      const result = interpretCommandResult('findstr pattern file', 1, '', '')
      expect(result.isError).toBe(false)
    })
  })

  describe('robocopy', () => {
    test('robocopy exit 0 (no files copied) is not error', () => {
      const result = interpretCommandResult('robocopy src dest', 0, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No files copied (already in sync)')
    })

    test('robocopy exit 1 (files copied) is not error', () => {
      const result = interpretCommandResult('robocopy src dest', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files copied successfully')
    })

    test('robocopy exit 8 (copy errors) is error', () => {
      const result = interpretCommandResult('robocopy src dest', 8, '', 'error')
      expect(result.isError).toBe(true)
    })
  })

  describe('densable 214 #24 where.exe / fc.exe / diff.exe', () => {
    test('where.exe exit 1 with output is not error', () => {
      const result = interpretCommandResult(
        'where.exe foo',
        1,
        '',
        'INFO: Could not find files',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No matching files found')
    })

    test('where.exe exit 1 with empty streams still uses default (densable hasOutput gate)', () => {
      // densable: Lny only when nativeExt===exe AND (stdout||stderr) non-empty
      const result = interpretCommandResult('where.exe foo', 1, '', '')
      expect(result.isError).toBe(true)
    })

    test('bare where (alias) exit 1 is error — not Lny', () => {
      const result = interpretCommandResult('where foo', 1, '', 'not found')
      expect(result.isError).toBe(true)
    })

    test('fc.exe exit 1 with output is not error', () => {
      const result = interpretCommandResult(
        'fc.exe a.txt b.txt',
        1,
        '***** a.txt',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })

    test('diff.exe exit 1 with output is not error', () => {
      const result = interpretCommandResult('diff.exe a b', 1, '1c1', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })

    test('git diff exit 1 is not error', () => {
      const result = interpretCommandResult('git diff', 1, 'diff --git', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })

    test('git grep exit 1 is not error', () => {
      const result = interpretCommandResult('git grep foo', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No matches found')
    })
  })

  describe('default behavior', () => {
    test('unknown command exit 0 is not error', () => {
      const result = interpretCommandResult('somecmd arg', 0, 'ok', '')
      expect(result.isError).toBe(false)
    })

    test('unknown command exit 1 is error', () => {
      const result = interpretCommandResult('somecmd arg', 1, '', 'fail')
      expect(result.isError).toBe(true)
      expect(result.message).toBe('Command failed with exit code 1')
    })
  })

  describe('pipeline — last segment determines result', () => {
    test('pipe with grep as last segment', () => {
      const result = interpretCommandResult(
        'cat file | grep pattern',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
    })

    test('semicolon — last segment determines result', () => {
      const result = interpretCommandResult(
        'echo hello; somecmd',
        1,
        '',
        'fail',
      )
      expect(result.isError).toBe(true)
    })
  })

  describe('path-stripped command names', () => {
    test('C:\\tools\\rg.exe is recognized as rg', () => {
      const result = interpretCommandResult(
        'C:\\tools\\rg.exe pattern',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
    })
  })

  describe('call operator stripping', () => {
    test('& grep pattern works', () => {
      const result = interpretCommandResult('& grep pattern', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('. "grep.exe" pattern works', () => {
      const result = interpretCommandResult('. "grep.exe" pattern', 1, '', '')
      expect(result.isError).toBe(false)
    })
  })
})

describe('parseNativeCommandToken / lastCommandSegment', () => {
  test('detects .exe nativeExt', () => {
    const t = parseNativeCommandToken('where.exe foo')
    expect(t.base).toBe('where')
    expect(t.nativeExt).toBe('exe')
  })

  test('last segment after |', () => {
    expect(lastCommandSegment('a | b | where.exe x')).toContain('where.exe')
  })
})
