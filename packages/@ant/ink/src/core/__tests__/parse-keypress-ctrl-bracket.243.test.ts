/**
 * densable 2.1.243 #33 — zb: kitty / modifyOtherKeys Ctrl+[ → escape.
 */
import { describe, expect, test } from 'bun:test'
import { InputEvent } from '../events/input-event.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  traditionalCtrlAliasName,
  type ParsedKey,
} from '../parse-keypress.js'

function asKey(item: unknown): ParsedKey {
  expect((item as ParsedKey).kind).toBe('key')
  return item as ParsedKey
}

describe('densable 2.1.243 #33 traditionalCtrlAliasName (zb)', () => {
  test('bare ctrl+[ / m / i / h remap; shift/meta/super skip', () => {
    const ctrl = { ctrl: true, shift: false, meta: false, super: false }
    expect(traditionalCtrlAliasName(ctrl, 91)).toBe('escape')
    expect(traditionalCtrlAliasName(ctrl, 109)).toBe('return')
    expect(traditionalCtrlAliasName(ctrl, 77)).toBe('return')
    expect(traditionalCtrlAliasName(ctrl, 105)).toBe('tab')
    expect(traditionalCtrlAliasName(ctrl, 73)).toBe('tab')
    expect(traditionalCtrlAliasName(ctrl, 104)).toBe('backspace')
    expect(traditionalCtrlAliasName(ctrl, 72)).toBe('backspace')
    expect(traditionalCtrlAliasName(ctrl, 97)).toBeUndefined()
    expect(
      traditionalCtrlAliasName(
        { ctrl: true, shift: true, meta: false, super: false },
        91,
      ),
    ).toBeUndefined()
  })

  test('kitty CSI u Ctrl+[ is escape with ctrl cleared', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[91;5u')
    const key = asKey(items[0])
    expect(key.name).toBe('escape')
    expect(key.ctrl).toBe(false)
    const ev = new InputEvent(key)
    expect(ev.key.escape).toBe(true)
    expect(ev.key.ctrl).toBe(false)
  })

  test('modifyOtherKeys Ctrl+[ is escape with ctrl cleared', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[27;5;91~')
    const key = asKey(items[0])
    expect(key.name).toBe('escape')
    expect(key.ctrl).toBe(false)
  })

  test('ctrl+shift+[ stays printable ctrl, not escape', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[91;6u')
    const key = asKey(items[0])
    expect(key.name).toBe('[')
    expect(key.ctrl).toBe(true)
    expect(key.shift).toBe(true)
  })
})
