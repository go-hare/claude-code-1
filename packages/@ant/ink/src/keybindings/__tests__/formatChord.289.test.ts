/**
 * densable DualInk `R` / `B` format — gold send-now is keyCase lower.
 */
import { describe, expect, test } from 'bun:test'
import { formatShortcutString } from '../formatChord.js'

describe('densable DualInk R / B formatChord (289)', () => {
  test('send-now keyCase lower paints ctrl+enter not ctrl+Enter', () => {
    expect(formatShortcutString('ctrl+Enter', { keyCase: 'lower' })).toBe(
      'ctrl+enter',
    )
    expect(formatShortcutString('ctrl+enter', { keyCase: 'lower' })).toBe(
      'ctrl+enter',
    )
  })

  test('default title keeps Enter; compact caretCtrl is ^enter', () => {
    expect(formatShortcutString('ctrl+enter')).toBe('ctrl+Enter')
    expect(formatShortcutString('ctrl+enter', { style: 'compact' })).toBe(
      '^enter',
    )
  })

  test('source never exports DualInk B/c1/R names', async () => {
    const src = await Bun.file(
      new URL('../formatChord.ts', import.meta.url),
    ).text()
    expect(src).not.toContain('export function B(')
    expect(src).not.toContain('export function c1(')
    expect(src).not.toContain('export function R(')
  })
})
