import { mock, describe, expect, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug'

// Mock debug.ts to cut the bootstrap/state dependency chain
mock.module('src/utils/debug.ts', debugMock)

const {
  resolveMaxOutputLength,
  BASH_MAX_OUTPUT_UPPER_LIMIT,
  BASH_MAX_OUTPUT_DEFAULT,
} = await import('../outputLimits')

describe('outputLimits constants', () => {
  test('BASH_MAX_OUTPUT_UPPER_LIMIT is 150000', () => {
    expect(BASH_MAX_OUTPUT_UPPER_LIMIT).toBe(150_000)
  })

  test('BASH_MAX_OUTPUT_DEFAULT is 30000', () => {
    expect(BASH_MAX_OUTPUT_DEFAULT).toBe(30_000)
  })
})

describe('resolveMaxOutputLength', () => {
  test('returns default when env not set', () => {
    expect(resolveMaxOutputLength(undefined, undefined)).toBe(30_000)
  })

  test('returns parsed value when valid', () => {
    expect(resolveMaxOutputLength(undefined, '50000')).toBe(50_000)
  })

  test('caps at upper limit', () => {
    expect(resolveMaxOutputLength(undefined, '999999')).toBe(150_000)
  })

  test('returns default for invalid value', () => {
    expect(resolveMaxOutputLength(undefined, 'not-a-number')).toBe(30_000)
  })

  test('returns default for negative value', () => {
    expect(resolveMaxOutputLength(undefined, '-1')).toBe(30_000)
  })
})
