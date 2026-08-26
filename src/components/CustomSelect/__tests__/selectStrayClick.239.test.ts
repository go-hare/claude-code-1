/**
 * densable 2.1.239 #33 — Select `XLE` / `yln` stray-click guard.
 * Gold: isWindowActivation || now-mountedAt < _Yn=300 → dropAsStray.
 */
import { describe, expect, test } from 'bun:test'

import { ClickEvent, MOUNT_SETTLE_MS } from '@anthropic/ink'

import { isWindowActivationOrMountSettle } from '../use-stray-click.js'

function click(isWindowActivation = false): ClickEvent {
  return new ClickEvent(1, 2, false, undefined, isWindowActivation)
}

describe('isWindowActivationOrMountSettle', () => {
  test('XLE is true for window-activation clicks', () => {
    expect(isWindowActivationOrMountSettle(click(true), 0, 10_000)).toBe(true)
  })

  test('XLE is true inside the 300ms mount settle', () => {
    expect(isWindowActivationOrMountSettle(click(false), 1000, 1299)).toBe(true)
  })

  test('XLE is false after mount settle without activation', () => {
    expect(isWindowActivationOrMountSettle(click(false), 1000, 1300)).toBe(
      false,
    )
  })

  test('_Yn is 300', () => {
    expect(MOUNT_SETTLE_MS).toBe(300)
  })
})

describe('yln dropAsStray', () => {
  test('activation click is dropped as stray', () => {
    const event = click(true)
    if (isWindowActivationOrMountSettle(event, 0, 10_000)) {
      event.dropAsStray()
    }
    expect(event.droppedAsStray).toBe(true)
  })

  test('real click after settle is not dropped', () => {
    const event = click(false)
    if (isWindowActivationOrMountSettle(event, 0, 10_000)) {
      event.dropAsStray()
    }
    expect(event.droppedAsStray).toBe(false)
  })
})
