import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  bindNonBlockingStdoutRemoteFlag,
  flushNonBlockingStdout,
  resetNonBlockingStdoutRemoteFlagForTests,
  shouldEnableNonBlockingStdout,
  shouldInstallNonBlockingStdout,
} from '../nonBlockingStdout.js'

const ENV = 'CLAUDE_CODE_NONBLOCKING_STDOUT'

describe('densable 2.1.289 gbo / gZt nonBlockingStdout', () => {
  const prev = process.env[ENV]

  afterEach(() => {
    if (prev === undefined) delete process.env[ENV]
    else process.env[ENV] = prev
    resetNonBlockingStdoutRemoteFlagForTests()
  })

  test('gbo env override wins', () => {
    expect(
      shouldEnableNonBlockingStdout({
        envOverride: '0',
        isAnt: false,
        remoteFlag: () => false,
      }),
    ).toBe('0')
    expect(
      shouldEnableNonBlockingStdout({
        envOverride: '1',
        isAnt: false,
        remoteFlag: () => false,
      }),
    ).toBe('1')
  })

  test('gbo unset env + isAnt false + remoteFlag false → false', () => {
    expect(
      shouldEnableNonBlockingStdout({
        envOverride: undefined,
        isAnt: false,
        remoteFlag: () => false,
      }),
    ).toBe(false)
  })

  test('gbo remoteFlag true → true', () => {
    expect(
      shouldEnableNonBlockingStdout({
        envOverride: undefined,
        isAnt: false,
        remoteFlag: () => true,
      }),
    ).toBe(true)
  })

  test('gbo isAnt true → true', () => {
    expect(
      shouldEnableNonBlockingStdout({
        envOverride: undefined,
        isAnt: true,
        remoteFlag: () => false,
      }),
    ).toBe(true)
  })

  test('gbo empty env string is falsy (?? keeps it)', () => {
    expect(
      shouldEnableNonBlockingStdout({
        envOverride: '',
        isAnt: true,
        remoteFlag: () => true,
      }),
    ).toBe('')
  })

  test('shouldInstallNonBlockingStdout is default-off for public', () => {
    delete process.env[ENV]
    expect(shouldInstallNonBlockingStdout()).toBe(false)
    process.env[ENV] = '1'
    expect(shouldInstallNonBlockingStdout()).toBe(true)
  })

  test('shouldInstallNonBlockingStdout remoteFlag is gold tengu_event_loop_stall', () => {
    delete process.env[ENV]
    bindNonBlockingStdoutRemoteFlag(() => true)
    expect(shouldInstallNonBlockingStdout()).toBe(true)
    resetNonBlockingStdoutRemoteFlagForTests()
    expect(shouldInstallNonBlockingStdout()).toBe(false)
  })

  test('init.ts does not bind GB stall flag or session host (public default-off)', async () => {
    const init = await Bun.file(
      join(import.meta.dir, '../../../../../../src/entrypoints/init.ts'),
    ).text()
    expect(init).not.toContain('bindNonBlockingStdoutRemoteFlag')
    expect(init).not.toContain('bindInkSessionHost')
    expect(init).not.toContain('getFeatureValue_CACHED_MAY_BE_STALE')
  })

  test('LOCAL_GATE_DEFAULTS pins tengu_event_loop_stall false (gold k default)', async () => {
    const gb = await Bun.file(
      join(
        import.meta.dir,
        '../../../../../../src/services/analytics/growthbook.ts',
      ),
    ).text()
    expect(gb).toContain('tengu_event_loop_stall: false')
  })

  test('flushNonBlockingStdout (gZt) no-ops when not installed', () => {
    expect(() => flushNonBlockingStdout()).not.toThrow()
  })

  test('restoreSlot gold k(e): closeSync then flushSlot (not flush first)', async () => {
    const src = await Bun.file(
      join(import.meta.dir, '../nonBlockingStdout.ts'),
    ).text()
    const restore = src.indexOf('function restoreSlot')
    const close = src.indexOf('closeSync(slot.fd)', restore)
    const flush = src.indexOf('flushSlot(slot)', close)
    expect(restore).toBeGreaterThan(0)
    expect(close).toBeGreaterThan(restore)
    expect(flush).toBeGreaterThan(close)
  })
})
