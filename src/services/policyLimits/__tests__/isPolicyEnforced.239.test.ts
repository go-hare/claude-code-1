/**
 * densable eya — fork product-cut: org policy never enforces.
 */
import { describe, expect, test } from 'bun:test'
import { isPolicyEnforced } from '../index.js'

describe('densable eya isPolicyEnforced', () => {
  test('product-cut never enforces org policy', () => {
    expect(isPolicyEnforced('require_trusted_devices')).toBe(false)
    expect(isPolicyEnforced('allow_remote_control')).toBe(false)
  })
})
