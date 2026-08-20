import { describe, expect, test } from 'bun:test'
import { isBroadRule } from '../broadRuleFilter.js'

describe('isBroadRule Monitor set-aside (densable lpv)', () => {
  test('any Monitor allow rule is broad (tool-level or content)', () => {
    expect(isBroadRule('Monitor', undefined)).toBe(true)
    expect(isBroadRule('Monitor', '')).toBe(true)
    expect(isBroadRule('Monitor', 'cpu')).toBe(true)
  })

  test('non-Monitor tools still use their own matchers', () => {
    expect(isBroadRule('FileRead', 'src/main.ts')).toBe(false)
  })
})
