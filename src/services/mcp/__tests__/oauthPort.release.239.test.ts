import { afterEach, describe, expect, test } from 'bun:test'
import {
  claimOAuthRedirectPort,
  resetOAuthRedirectPortAborts,
  setOAuthRedirectPortRelease,
  waitForOAuthRedirectPortRelease,
} from '../oauthPort.js'

afterEach(() => {
  resetOAuthRedirectPortAborts()
})

describe('oauth redirect port release', () => {
  test('wait resolves immediately when no previous listener', async () => {
    await waitForOAuthRedirectPortRelease(39199)
  })

  test('claim abort then wait for registered close', async () => {
    const port = 39201
    let released = false
    const first = claimOAuthRedirectPort(port)
    setOAuthRedirectPortRelease(
      port,
      new Promise<void>(resolve => {
        first.signal.addEventListener('abort', () => {
          released = true
          resolve()
        })
      }),
    )
    claimOAuthRedirectPort(port)
    await waitForOAuthRedirectPortRelease(port)
    expect(released).toBe(true)
  })
})
