import { describe, expect, test } from 'bun:test'
import {
  SET_MODEL_CONFIRM_TIMEOUT_MS,
  confirmModelWithTimeout,
} from '../HeadlessControlPlane.js'

describe('#1090 15s model confirmation timeout', () => {
  test('SET_MODEL_CONFIRM_TIMEOUT_MS is 15000ms', () => {
    expect(SET_MODEL_CONFIRM_TIMEOUT_MS).toBe(15_000)
  })

  test('confirmModelWithTimeout resolves when probe completes before deadline', async () => {
    const res = await confirmModelWithTimeout(
      'claude-sonnet-4-6',
      100,
      async () => ({
        valid: true,
      }),
    )
    expect(res).toEqual({ valid: true, timedOut: false })
  })

  test('confirmModelWithTimeout returns official timeout error when probe exceeds deadline', async () => {
    const res = await confirmModelWithTimeout(
      'claude-opus-4-7',
      15,
      () => new Promise(() => {}),
    )
    expect(res.valid).toBe(false)
    expect(res.timedOut).toBe(true)
    expect(res.error).toBe(
      'Couldn\'t confirm model "claude-opus-4-7" with the API. Try again.',
    )
  })
})
