import { afterEach, describe, expect, test } from 'bun:test'
import {
  beginOAuthRefreshLockHold,
  getHeldOAuthRefreshPromise as getAuthHeldPromise,
  resetOAuthRefreshHoldForTesting,
} from '../auth.js'
import {
  acquireOAuthRefreshHold,
  getHeldOAuthRefreshPromise as getShutdownHeldPromise,
  resetShutdownState,
  waitForHeldOAuthRefresh,
} from '../gracefulShutdown.js'

describe('#860 auth.ts and gracefulShutdown.ts share OAuth refresh hold state', () => {
  afterEach(() => {
    resetOAuthRefreshHoldForTesting()
    resetShutdownState()
  })

  test('beginOAuthRefreshLockHold in auth.ts is observed by gracefulShutdown.ts waitForHeldOAuthRefresh', async () => {
    expect(getAuthHeldPromise()).toBeNull()
    expect(getShutdownHeldPromise()).toBeNull()

    const release = beginOAuthRefreshLockHold()
    expect(getAuthHeldPromise()).not.toBeNull()
    expect(getShutdownHeldPromise()).not.toBeNull()
    expect(getShutdownHeldPromise()).toBe(getAuthHeldPromise())

    let resolved = false
    const waitPromise = waitForHeldOAuthRefresh(1).then(result => {
      resolved = true
      return result
    })

    // Still held on next microtask
    await Promise.resolve()
    expect(resolved).toBe(false)

    release()
    await expect(waitPromise).resolves.toBe(true)
    expect(getAuthHeldPromise()).toBeNull()
    expect(getShutdownHeldPromise()).toBeNull()
  })

  test('acquireOAuthRefreshHold in gracefulShutdown.ts is observed by auth.ts', () => {
    const release = acquireOAuthRefreshHold()
    expect(getAuthHeldPromise()).not.toBeNull()
    expect(getShutdownHeldPromise()).toBe(getAuthHeldPromise())
    release()
    expect(getAuthHeldPromise()).toBeNull()
  })
})
