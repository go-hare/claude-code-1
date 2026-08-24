import { afterEach, describe, expect, test } from 'bun:test'
import {
  parseAutoCompactWindowArg,
  resolveAutoCompactWindow,
} from '../autoCompactWindow.js'

describe('parseAutoCompactWindowArg (densable bDn)', () => {
  test('auto aliases', () => {
    expect(parseAutoCompactWindowArg('auto')).toBe('auto')
    expect(parseAutoCompactWindowArg('RESET')).toBe('auto')
    expect(parseAutoCompactWindowArg('unset')).toBe('auto')
    expect(parseAutoCompactWindowArg('default')).toBe('auto')
  })

  test('k / m / shorthand', () => {
    expect(parseAutoCompactWindowArg('500k')).toBe(500_000)
    expect(parseAutoCompactWindowArg('1m')).toBe(1_000_000)
    expect(parseAutoCompactWindowArg('200')).toBe(200_000)
    expect(parseAutoCompactWindowArg('200000')).toBe(200_000)
  })

  test('rejects out of range', () => {
    expect(parseAutoCompactWindowArg('50k')).toBeUndefined()
    expect(parseAutoCompactWindowArg('2m')).toBeUndefined()
    expect(parseAutoCompactWindowArg('nope')).toBeUndefined()
  })
})

describe('resolveAutoCompactWindow (densable Nq env/settings)', () => {
  const prev = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    } else {
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = prev
    }
  })

  test('env wins', () => {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '300000'
    const r = resolveAutoCompactWindow('claude-sonnet-4-6', 500_000)
    expect(r.source).toBe('env')
    expect(r.configured).toBe(300_000)
  })

  test('settings when no env', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    const r = resolveAutoCompactWindow('claude-sonnet-4-6', 400_000)
    expect(r.source).toBe('settings')
    expect(r.configured).toBe(400_000)
  })

  test('auto when neither', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    const r = resolveAutoCompactWindow('claude-sonnet-4-6', undefined)
    expect(r.source).toBe('auto')
  })
})
