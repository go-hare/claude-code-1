import { describe, expect, test } from 'bun:test'
import { unwrapCallable } from '../imageProcessor'

describe('unwrapCallable', () => {
  const fn = () => 'ok'

  test('returns bare function (CJS)', () => {
    expect(unwrapCallable(fn)).toBe(fn)
  })

  test('unwraps ESM default export', () => {
    expect(unwrapCallable({ default: fn })).toBe(fn)
  })

  test('unwraps image-processor-napi { sharp: fn }', () => {
    expect(unwrapCallable({ sharp: fn })).toBe(fn)
  })

  test('unwraps nested { sharp: { default: fn } }', () => {
    expect(unwrapCallable({ sharp: { default: fn } })).toBe(fn)
  })

  test('unwraps nested { default: { sharp: fn } }', () => {
    expect(unwrapCallable({ default: { sharp: fn } })).toBe(fn)
  })

  test('throws when export is not callable', () => {
    expect(() => unwrapCallable({ sharp: { nested: true } })).toThrow(
      /not a function/,
    )
    expect(() => unwrapCallable(null)).toThrow(/not a function/)
    expect(() => unwrapCallable({ default: 1 })).toThrow(/not a function/)
  })
})
