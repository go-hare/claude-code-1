/**
 * densable 2.1.247 #9 — Ea CSI u Ctrl + non-ASCII uses kitty base-layout-key.
 */
import { describe, expect, test } from 'bun:test'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedKey,
} from '../parse-keypress.js'

const CYRILLIC_EF = 0x0444 // ф
const LATIN_C = 99

function asKey(item: unknown): ParsedKey {
  expect((item as ParsedKey).kind).toBe('key')
  return item as ParsedKey
}

describe('densable 2.1.247 #9 kitty-protocol Cyrillic Ctrl', () => {
  test('Ctrl + ф with base-layout c names c', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${CYRILLIC_EF}::${LATIN_C};5u`,
    )
    expect(items).toHaveLength(1)
    const key = asKey(items[0])
    expect(key.name).toBe('c')
    expect(key.ctrl).toBe(true)
  })

  test('Ctrl + ф with shifted+base still names c', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${CYRILLIC_EF}:1060:${LATIN_C};5u`,
    )
    const key = asKey(items[0])
    expect(key.name).toBe('c')
    expect(key.ctrl).toBe(true)
  })

  test('Ctrl + ф without base-layout keeps primary name', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${CYRILLIC_EF};5u`,
    )
    const key = asKey(items[0])
    expect(key.name).toBe('ф')
    expect(key.ctrl).toBe(true)
  })

  test('unmodified ф with unused base-layout does not remap', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${CYRILLIC_EF}::${LATIN_C};1u`,
    )
    const key = asKey(items[0])
    expect(key.name).toBe('ф')
    expect(key.ctrl).toBe(false)
  })
})
