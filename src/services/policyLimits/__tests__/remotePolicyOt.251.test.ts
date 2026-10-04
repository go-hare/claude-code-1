/**
 * densable 2.1.251 leftover — fork product-cut: org remote policy never denies.
 */
import { describe, expect, test } from 'bun:test'
import { getPolicyDenyKind, isRemotePolicyAllowed } from '../index.js'

describe('densable QD/Ot remote policy fail-closed', () => {
  test('product-cut always allows remote control/sessions', () => {
    expect(isRemotePolicyAllowed('allow_remote_control')).toBe(true)
    expect(isRemotePolicyAllowed('allow_remote_sessions')).toBe(true)
    expect(getPolicyDenyKind('allow_remote_control')).toBe(null)
    expect(getPolicyDenyKind('allow_remote_sessions')).toBe(null)
  })
})
