import { expect, test } from 'bun:test'
import {
  CONFIRM_SELECT_ARM_MS,
  confirmSelectArmed,
  confirmSelectOrder,
  confirmSelectRefused,
} from '../ConfirmSelect.js'

test('cancelFirst puts cancel before confirm', () => {
  expect(confirmSelectOrder(true)).toEqual(['cancel', 'confirm'])
  expect(confirmSelectOrder(false)).toEqual(['confirm', 'cancel'])
})

test('arm is immediate when armAfterMs is omitted', () => {
  expect(confirmSelectArmed(undefined, 0)).toBe(true)
  expect(confirmSelectArmed(500, 499)).toBe(false)
  expect(confirmSelectArmed(500, 500)).toBe(true)
})

test('refuse window defaults to 500ms from openedAt', () => {
  expect(CONFIRM_SELECT_ARM_MS).toBe(500)
  expect(confirmSelectRefused(undefined, undefined, 1000)).toBe(false)
  expect(confirmSelectRefused(1000, undefined, 1499)).toBe(true)
  expect(confirmSelectRefused(1000, undefined, 1500)).toBe(false)
  expect(confirmSelectRefused(1000, 150, 1100)).toBe(true)
  expect(confirmSelectRefused(1000, 150, 1150)).toBe(false)
})
