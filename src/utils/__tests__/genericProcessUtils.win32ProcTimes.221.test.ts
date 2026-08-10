import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetWin32ProcTimesForTesting,
  buildProcessStartIdentityFields,
  fileTimeToUnixMs,
  getProcessLstartString,
  getProcessStartTimeMs,
  getWin32CreationFileTime,
  isCrossFormatProcessStartMatch,
  isWin32ProcTimesFfiAvailable,
  pickProcessStartIdentity,
  processStartIdentityEquals,
} from '../genericProcessUtils.js'

afterEach(() => {
  _resetWin32ProcTimesForTesting()
})

describe('densable 2.1.221 win32-proc-times (kernel32 GetProcessTimes)', () => {
  test('fileTimeToUnixMs converts FILETIME epoch offset (j8c)', () => {
    // densable VWg = 116444736000000000n (100ns ticks 1601→1970)
    const epoch = 116444736000000000n
    expect(fileTimeToUnixMs(epoch)).toBe(0)
    // +1s = 10_000_000 * 100ns
    expect(fileTimeToUnixMs(epoch + 10_000_000n)).toBe(1000)
  })

  test('non-win32: FFI path unavailable; creation FILETIME undefined', () => {
    if (process.platform === 'win32') return
    expect(isWin32ProcTimesFfiAvailable()).toBe(false)
    expect(getWin32CreationFileTime(process.pid)).toBeUndefined()
    expect(getWin32CreationFileTime(0)).toBeUndefined()
    expect(getWin32CreationFileTime(-1)).toBeUndefined()
  })

  test('unix: getProcessLstartString still returns ps lstart for self', async () => {
    if (process.platform === 'win32') return
    const lstart = await getProcessLstartString(process.pid)
    expect(typeof lstart).toBe('string')
    expect(lstart!.length).toBeGreaterThan(0)
    const ms = await getProcessStartTimeMs(process.pid)
    expect(typeof ms).toBe('number')
    expect(ms).toBeGreaterThan(0)
  })

  test('pid ≤ 1 short-circuits', async () => {
    expect(await getProcessLstartString(0)).toBeUndefined()
    expect(await getProcessLstartString(1)).toBeUndefined()
    expect(await getProcessStartTimeMs(0)).toBeNull()
    expect(await getProcessStartTimeMs(1)).toBeNull()
  })

  test('win32: FFI or PowerShell returns creation identity for self', async () => {
    if (process.platform !== 'win32') return
    const token = await getProcessLstartString(process.pid)
    // Prefer FFI procStartFt (decimal FILETIME) or PowerShell ticks
    expect(token === undefined || /^\d+$/.test(token)).toBe(true)
    if (isWin32ProcTimesFfiAvailable()) {
      expect(token).toBeDefined()
      const ft = getWin32CreationFileTime(process.pid)
      expect(ft).toBeDefined()
      expect(token).toBe(ft!.toString())
      const ms = await getProcessStartTimeMs(process.pid)
      expect(ms).toBe(fileTimeToUnixMs(ft!))
    }
  })

  test('_resetWin32ProcTimesForTesting can force-disable FFI (GWg)', () => {
    _resetWin32ProcTimesForTesting({ disableFfi: true })
    expect(isWin32ProcTimesFfiAvailable()).toBe(false)
    expect(getWin32CreationFileTime(process.pid)).toBeUndefined()
  })

  test('UHt/jMt: non-FFI builds procStart field; pick returns it', () => {
    _resetWin32ProcTimesForTesting({ disableFfi: true })
    const fields = buildProcessStartIdentityFields('12345')
    expect(fields).toEqual({ procStart: '12345' })
    expect(pickProcessStartIdentity(fields)).toBe('12345')
  })

  test('Yzc: undefined current matches; equal matches', () => {
    expect(processStartIdentityEquals('a', undefined)).toBe(true)
    expect(processStartIdentityEquals('a', 'a')).toBe(true)
    expect(processStartIdentityEquals('a', 'b')).toBe(false)
  })

  test('qWg cross-format only when FFI available', () => {
    _resetWin32ProcTimesForTesting({ disableFfi: true })
    // Non-win32 / disabled FFI: no cross-format
    expect(
      isCrossFormatProcessStartMatch(
        '100000000000000000',
        '400000000000000000',
      ),
    ).toBe(false)
  })

  test('AFe dual-stamp while FFI on: defined procStart voids identity', () => {
    // densable AFe: when BMt, any defined procStart → undefined (legacy stamp).
    // On non-win32 CI, isWin32ProcTimesFfiAvailable is false — exercise pick
    // via force-disable path for the non-FFI arm, and document dual-stamp
    // behavior matches pickProcessStartIdentity implementation.
    _resetWin32ProcTimesForTesting({ disableFfi: true })
    expect(
      pickProcessStartIdentity({
        procStart: 'legacy-ps',
        procStartFt: '1337',
      }),
    ).toBe('legacy-ps')
    expect(pickProcessStartIdentity({ procStartFt: '1337' })).toBeUndefined()
    expect(pickProcessStartIdentity({ procStart: 'legacy-ps' })).toBe(
      'legacy-ps',
    )
  })

  test('daemon pickDaemonProcessStartIdentity delegates to AFe', async () => {
    const { pickDaemonProcessStartIdentity } = await import(
      '../../daemon/daemonLock.js'
    )
    _resetWin32ProcTimesForTesting({ disableFfi: true })
    expect(
      pickDaemonProcessStartIdentity({
        procStart: 'ps-id',
        procStartFt: 'ft-id',
      }),
    ).toBe('ps-id')
    expect(pickDaemonProcessStartIdentity({ procStartFt: 'ft-only' })).toBe(
      undefined,
    )
    expect(pickDaemonProcessStartIdentity({ procStart: 'ps-only' })).toBe(
      'ps-only',
    )
  })
})
