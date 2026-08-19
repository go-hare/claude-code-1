import { describe, expect, test } from 'bun:test'
import { isCommandImmediate } from '../immediateCommand.js'

describe('isCommandImmediate (densable ARt)', () => {
  test('boolean true/false', () => {
    expect(isCommandImmediate({ immediate: true }, '')).toBe(true)
    expect(isCommandImmediate({ immediate: false }, '')).toBe(false)
    expect(isCommandImmediate({}, '')).toBe(false)
    expect(isCommandImmediate(null, '')).toBe(false)
  })

  test('function form receives args', () => {
    expect(
      isCommandImmediate(
        { immediate: (args: string) => args.trim() !== '' },
        'foo',
      ),
    ).toBe(true)
    expect(
      isCommandImmediate(
        { immediate: (args: string) => args.trim() !== '' },
        '  ',
      ),
    ).toBe(false)
  })

  test('function that returns false is not immediate', () => {
    expect(isCommandImmediate({ immediate: () => false }, 'x')).toBe(false)
  })
})
