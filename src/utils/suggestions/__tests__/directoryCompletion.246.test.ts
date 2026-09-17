import { describe, expect, test } from 'bun:test'
import {
  getDirectoryCompletions,
  getPathCompletions,
  parsePartialPath,
  tryParsePartialPath,
} from '../directoryCompletion.js'

describe('tryParsePartialPath (official P)', () => {
  test('returns null when the token contains a null byte', () => {
    expect(tryParsePartialPath('src/\0foo')).toBeNull()
  })

  test('returns null when the working directory contains a null byte', () => {
    expect(tryParsePartialPath('src', 'C:\\\0cwd')).toBeNull()
  })

  test('parsePartialPath still throws (official V)', () => {
    expect(() => parsePartialPath('src/\0foo')).toThrow(/null byte/i)
  })

  test('keeps a normal token', () => {
    const parsed = tryParsePartialPath('src/foo', '/tmp/project')
    expect(parsed).not.toBeNull()
    expect(parsed?.prefix).toBe('foo')
  })
})

describe('path completion NUL (official ot/rt)', () => {
  test('getPathCompletions returns [] instead of throwing', async () => {
    await expect(getPathCompletions('src/\0foo')).resolves.toEqual([])
  })

  test('getDirectoryCompletions returns [] instead of throwing', async () => {
    await expect(getDirectoryCompletions('src/\0foo')).resolves.toEqual([])
  })
})
