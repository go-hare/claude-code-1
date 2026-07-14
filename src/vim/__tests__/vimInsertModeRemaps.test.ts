import { describe, expect, test } from 'bun:test'
import {
  getVimInsertModeRemaps,
  isVimInsertRemapPrefix,
  matchPendingVimInsertRemap,
  parseVimInsertModeRemaps,
  VIM_INSERT_REMAP_TIMEOUT_MS,
} from '../vimInsertModeRemaps.js'

describe('parseVimInsertModeRemaps (official GGy)', () => {
  test('keeps jj → Esc', () => {
    const m = parseVimInsertModeRemaps({ jj: '<Esc>' })
    expect(m.get('jj')).toBe('<Esc>')
    expect(m.size).toBe(1)
  })

  test('accepts case-insensitive <esc> target', () => {
    expect(parseVimInsertModeRemaps({ jk: '<esc>' }).get('jk')).toBe('<Esc>')
    expect(parseVimInsertModeRemaps({ jk: '<ESC>' }).get('jk')).toBe('<Esc>')
  })

  test('drops non-Esc targets and non-string values', () => {
    const m = parseVimInsertModeRemaps({
      jj: '<Esc>',
      aa: '<C-c>',
      bb: 1,
      cc: null,
    } as Record<string, unknown>)
    expect([...m.keys()]).toEqual(['jj'])
  })

  test('drops keys that are not exactly two printable graphemes', () => {
    const m = parseVimInsertModeRemaps({
      j: '<Esc>',
      jjj: '<Esc>',
      'j ': '<Esc>',
      ' j': '<Esc>',
      '': '<Esc>',
      'a\nb': '<Esc>',
    })
    expect(m.size).toBe(0)
  })

  test('NFC-normalizes keys', () => {
    // e + combining acute vs precomposed — both should normalize to same NFC
    const composed = '\u00e9' // é
    // two-char key using composed + another letter
    const m = parseVimInsertModeRemaps({ [`${composed}a`]: '<Esc>' })
    expect(m.has(`${composed}a`.normalize('NFC'))).toBe(true)
  })
})

describe('getVimInsertModeRemaps source order (official R9t)', () => {
  test('policy > flag > user; first defined wins', () => {
    const sources: Record<string, Record<string, unknown> | undefined> = {
      policySettings: { vimInsertModeRemaps: { aa: '<Esc>' } },
      flagSettings: { vimInsertModeRemaps: { bb: '<Esc>' } },
      userSettings: { vimInsertModeRemaps: { cc: '<Esc>' } },
    }
    const m = getVimInsertModeRemaps(src => sources[src] as never)
    expect([...m.keys()]).toEqual(['aa'])
  })

  test('falls through to user when policy/flag unset', () => {
    const sources: Record<string, Record<string, unknown> | undefined> = {
      policySettings: {},
      flagSettings: {},
      userSettings: { vimInsertModeRemaps: { jj: '<Esc>' } },
    }
    const m = getVimInsertModeRemaps(src => sources[src] as never)
    expect(m.get('jj')).toBe('<Esc>')
  })
})

describe('pending sequential match', () => {
  test('matches second key within timeout at same offset', () => {
    const remaps = parseVimInsertModeRemaps({ jj: '<Esc>' })
    const now = 10_000
    // text "helloj" — first j landed at index 5; offsetAfter/current offset = 6
    const hit = matchPendingVimInsertRemap(
      remaps,
      { char: 'j', at: now - 100, offsetAfter: 6, recorded: true },
      'j',
      6,
      'helloj',
      now,
    )
    expect(hit).toEqual({ matchedKey: 'jj', removeLen: 1 })
  })

  test('misses after timeout', () => {
    const remaps = parseVimInsertModeRemaps({ jj: '<Esc>' })
    const now = 10_000
    const hit = matchPendingVimInsertRemap(
      remaps,
      {
        char: 'j',
        at: now - VIM_INSERT_REMAP_TIMEOUT_MS - 1,
        offsetAfter: 1,
        recorded: true,
      },
      'j',
      1,
      'j',
      now,
    )
    expect(hit).toBeNull()
  })

  test('isVimInsertRemapPrefix', () => {
    const remaps = parseVimInsertModeRemaps({ jj: '<Esc>', kk: '<Esc>' })
    expect(isVimInsertRemapPrefix(remaps, 'j')).toBe(true)
    expect(isVimInsertRemapPrefix(remaps, 'x')).toBe(false)
  })
})
