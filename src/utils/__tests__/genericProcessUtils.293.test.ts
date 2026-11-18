import { describe, expect, test } from 'bun:test'
import {
  getProcessCreationTimeMsAsync,
  getProcessStartTime,
  getProcessStartTimeMs,
  isSameProcess,
  provenSameProcessAsync,
  sigtermThenKill,
} from '../genericProcessUtils.js'

describe('2.1.293 #321 genericProcessUtils PID reuse guards', () => {
  test('getProcessCreationTimeMsAsync aliases getProcessStartTimeMs', () => {
    expect(getProcessCreationTimeMsAsync).toBe(getProcessStartTimeMs)
  })

  test('isSameProcess returns true when expectedStartTime is undefined and matches own pid', () => {
    expect(isSameProcess(process.pid, undefined)).toBe(true)
    const ownStart = getProcessStartTime(process.pid)
    if (ownStart !== undefined) {
      expect(isSameProcess(process.pid, ownStart)).toBe(true)
      expect(isSameProcess(process.pid, 'Thu Jan  1 00:00:00 1970')).toBe(false)
    }
  })

  test('provenSameProcessAsync verifies live process identity strictly', async () => {
    const ownStart = getProcessStartTime(process.pid)
    if (ownStart !== undefined) {
      expect(await provenSameProcessAsync(process.pid, ownStart)).toBe(true)
      expect(
        await provenSameProcessAsync(process.pid, 'Thu Jan  1 00:00:00 1970'),
      ).toBe(false)
    }
    expect(await provenSameProcessAsync(-1, 'anything')).toBeUndefined()
  })

  test('sigtermThenKill ignores invalid pids (<= 1)', () => {
    expect(sigtermThenKill([0, 1, -1])).toBe(false)
  })
})
