/**
 * densable 2.1.235 #12 — shouldShowPersistentAllowOption gate.
 */
import { describe, expect, test } from 'bun:test'
import { shouldShowPersistentAllowOption } from '../showAlwaysAllow.js'

describe('shouldShowPersistentAllowOption (2.1.235 #12)', () => {
  test('suppressAlwaysAllowRule true → false', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: {
          behavior: 'ask',
          suppressAlwaysAllowRule: true,
        },
      }),
    ).toBe(false)
  })

  test('tool.suppressesAlwaysAllowRule true → false', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: { behavior: 'ask' },
        tool: { suppressesAlwaysAllowRule: () => true },
        input: {},
      }),
    ).toBe(false)
  })

  test('both false → respects baseAllowed', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: {
          behavior: 'ask',
          suppressAlwaysAllowRule: false,
        },
        tool: { suppressesAlwaysAllowRule: () => false },
        input: {},
      }),
    ).toBe(true)
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: false,
        permissionResult: { behavior: 'ask' },
      }),
    ).toBe(false)
  })

  test('isAskCappedByOrg still hides', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: { behavior: 'ask' },
        isAskCappedByOrg: true,
      }),
    ).toBe(false)
  })
})
