/**
 * densable 2.1.239 jWe — named-pipe leaf (LOCAL prefix, trailing junk).
 */
import { describe, expect, test } from 'bun:test'
import { parseWindowsNamedPipeName } from '../udsMessaging.js'

describe('densable 2.1.239 jWe parseWindowsNamedPipeName', () => {
  test('plain pipe leaf', () => {
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\claude-code-1')).toBe(
      'claude-code-1',
    )
    expect(parseWindowsNamedPipeName('//./pipe/claude-code-1')).toBe(
      'claude-code-1',
    )
  })

  test('optional LOCAL prefix returns LOCAL\\leaf', () => {
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\LOCAL\\claude-code-1')).toBe(
      'LOCAL\\claude-code-1',
    )
  })

  test('rejects . / .. and trailing dot or space', () => {
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\.')).toBeUndefined()
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\..')).toBeUndefined()
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\foo.')).toBeUndefined()
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\foo ')).toBeUndefined()
  })
})
