import { afterEach, describe, expect, test } from 'bun:test'
import {
  beginOAuthRefreshLockHold,
  getHeldOAuthRefreshPromise,
  getOAuthRefreshExitWaitMs,
  rollbackRefusedSignIn,
  waitForHeldOAuthRefresh,
} from '../auth.js'

describe('auth #860 OAuth refresh lock hold & #773 rollbackRefusedSignIn', () => {
  const prevOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN

  afterEach(() => {
    if (prevOAuthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevOAuthToken
  })

  test('#860: waitForHeldOAuthRefresh resolves true immediately when no lock is held', async () => {
    expect(getHeldOAuthRefreshPromise()).toBeNull()
    await expect(waitForHeldOAuthRefresh(50)).resolves.toBe(true)
  })

  test('#860: waitForHeldOAuthRefresh waits for held lock release and times out when still held', async () => {
    const release = beginOAuthRefreshLockHold()
    expect(getHeldOAuthRefreshPromise()).not.toBeNull()

    // Times out with false while still held
    await expect(waitForHeldOAuthRefresh(10)).resolves.toBe(false)

    // Resolves true once released
    setTimeout(release, 10)
    await expect(waitForHeldOAuthRefresh(500)).resolves.toBe(true)
    expect(getHeldOAuthRefreshPromise()).toBeNull()
  })

  test('#860: getOAuthRefreshExitWaitMs respects base 2000ms and deadline', () => {
    expect(getOAuthRefreshExitWaitMs(false)).toBe(2000)
    expect(getOAuthRefreshExitWaitMs(true)).toBeGreaterThanOrEqual(2000)
  })

  test('#773: rollbackRefusedSignIn clears CLAUDE_CODE_OAUTH_TOKEN', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-refused-org-token'
    const res = await rollbackRefusedSignIn()
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(typeof res.cleared).toBe('boolean')
  })
})
