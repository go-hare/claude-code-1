/**
 * densable 2.1.289 — notify_when_idle send-failed busySuffix (gold Fhn / ope).
 *
 * ope: unusable G → busy; gone → gone; errno EBUSY|EAGAIN → busy; else other
 * Fhn: unusable → Ce (registry); else X2r (pipe busy)
 * send-failed: busySuffix = ope==="busy" ? Fhn(error) : "."
 */
import { describe, expect, test } from 'bun:test'
import {
  formatUdsIdleBusySuffix,
  idleSubscribeFailedLine,
  isUdsIdleSendBusy,
} from '../udsIdleNotify.js'

const REGISTRY_BUSY_SUFFIX =
  " — this machine's session registry could not be read just now (a transient local condition). Retry the same address shortly."

const PIPE_BUSY_SUFFIX =
  ' — the peer is alive but its pipe is momentarily busy. Retry the same address shortly.'

describe('densable 2.1.289 Fhn / ope busySuffix', () => {
  test('ope: EBUSY and EAGAIN are busy; ENOENT/ECONNREFUSED are not', () => {
    expect(
      isUdsIdleSendBusy(Object.assign(new Error('busy'), { code: 'EBUSY' })),
    ).toBe(true)
    expect(
      isUdsIdleSendBusy(Object.assign(new Error('again'), { code: 'EAGAIN' })),
    ).toBe(true)
    expect(
      isUdsIdleSendBusy(Object.assign(new Error('gone'), { code: 'ENOENT' })),
    ).toBe(false)
    expect(
      isUdsIdleSendBusy(
        Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      ),
    ).toBe(false)
    expect(isUdsIdleSendBusy(new Error('protocol glitch'))).toBe(false)
  })

  test('ope: SessionRecordsUnreadableError / kind:unusable → busy (Fhn Ce)', () => {
    const unreadable = new Error('session records directory unreadable')
    unreadable.name = 'SessionRecordsUnreadableError'
    expect(isUdsIdleSendBusy(unreadable)).toBe(true)
    expect(formatUdsIdleBusySuffix(unreadable)).toBe(REGISTRY_BUSY_SUFFIX)

    expect(isUdsIdleSendBusy({ kind: 'unusable' })).toBe(true)
    expect(formatUdsIdleBusySuffix({ kind: 'unusable' })).toBe(
      REGISTRY_BUSY_SUFFIX,
    )
  })

  test('Fhn: EBUSY/EAGAIN → X2r pipe-busy suffix', () => {
    const ebusy = Object.assign(new Error('pipe full'), { code: 'EBUSY' })
    expect(formatUdsIdleBusySuffix(ebusy)).toBe(PIPE_BUSY_SUFFIX)
    const eagain = Object.assign(new Error('would block'), { code: 'EAGAIN' })
    expect(formatUdsIdleBusySuffix(eagain)).toBe(PIPE_BUSY_SUFFIX)
  })

  test('send-failed: busySuffix is Fhn when busy, else "."', () => {
    expect(
      idleSubscribeFailedLine({
        ok: false,
        reason: 'send-failed',
        error: Object.assign(new Error('pipe full'), { code: 'EBUSY' }),
      }),
    ).toBe(
      `notify_when_idle: the subscription could not be sent — no notice will arrive${PIPE_BUSY_SUFFIX}`,
    )

    const unreadable = new Error('session records directory unreadable')
    unreadable.name = 'SessionRecordsUnreadableError'
    expect(
      idleSubscribeFailedLine({
        ok: false,
        reason: 'send-failed',
        restoredEarlier: true,
        error: unreadable,
      }),
    ).toBe(
      `notify_when_idle: the re-subscribe could not be sent; your earlier idle subscription to that session still stands${REGISTRY_BUSY_SUFFIX}`,
    )

    expect(
      idleSubscribeFailedLine({
        ok: false,
        reason: 'send-failed',
        error: Object.assign(new Error('broken'), { code: 'EPIPE' }),
      }),
    ).toBe(
      'notify_when_idle: the subscription could not be sent — no notice will arrive.',
    )

    expect(idleSubscribeFailedLine({ ok: false, reason: 'send-failed' })).toBe(
      'notify_when_idle: the subscription could not be sent — no notice will arrive.',
    )
  })
})
