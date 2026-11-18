import { afterEach, describe, expect, test } from 'bun:test'
import {
  beginManagedReread,
  giveUpManagedReread,
  managedRereadGivenUp,
  managedRereadInFlight,
  releaseManagedReread,
  rereadManagedSettingsIfNeeded,
  resetManagedRereadStateForTesting,
} from '../settings.js'

describe('settings #371 managedReread', () => {
  afterEach(() => {
    resetManagedRereadStateForTesting()
  })

  test('coalesces concurrent rereads via managedRereadInFlight', async () => {
    let resolveFn!: (v: boolean) => void
    const inflight = new Promise<boolean>(resolve => {
      resolveFn = resolve
    })
    beginManagedReread(inflight)
    expect(managedRereadInFlight()).toBe(inflight)

    const p = rereadManagedSettingsIfNeeded()
    resolveFn(true)
    expect(await p).toBe(true)
  })

  test('releaseManagedReread only clears matching promise', () => {
    const p1 = Promise.resolve(false)
    const p2 = Promise.resolve(false)
    beginManagedReread(p1)
    releaseManagedReread(p2)
    expect(managedRereadInFlight()).toBe(p1)
    releaseManagedReread(p1)
    expect(managedRereadInFlight()).toBeUndefined()
  })

  test('giveUpManagedReread short-circuits subsequent rereads', async () => {
    expect(managedRereadGivenUp()).toBe(false)
    giveUpManagedReread()
    expect(managedRereadGivenUp()).toBe(true)
    expect(await rereadManagedSettingsIfNeeded()).toBe(false)
  })
})
