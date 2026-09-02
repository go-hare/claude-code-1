import { describe, expect, test } from 'bun:test'
import { isPlanActingAsBypass, isSessionBypassClass } from '../planBypass.js'

describe('isPlanActingAsBypass / isSessionBypassClass', () => {
  test('plain plan is not bypass even when bypass is listable', () => {
    expect(isPlanActingAsBypass({ mode: 'plan' })).toBe(false)
    expect(isSessionBypassClass({ mode: 'plan' })).toBe(false)
  })

  test('plan entered from bypassPermissions inherits bypass', () => {
    expect(
      isPlanActingAsBypass({
        mode: 'plan',
        prePlanMode: 'bypassPermissions',
      }),
    ).toBe(true)
    expect(
      isSessionBypassClass({
        mode: 'plan',
        prePlanMode: 'bypassPermissions',
      }),
    ).toBe(true)
  })

  test('live bypassPermissions is bypass class', () => {
    expect(isSessionBypassClass({ mode: 'bypassPermissions' })).toBe(true)
  })
})
