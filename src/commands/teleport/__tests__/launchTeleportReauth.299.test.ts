import { describe, expect, test } from 'bun:test'
import { CLOUD_LOGIN_REAUTH_HINT } from '../launchTeleport.js'

describe('2.1.299 #702 cloud session refused claude auth login hint', () => {
  test('CLOUD_LOGIN_REAUTH_HINT matches official OYn', () => {
    expect(CLOUD_LOGIN_REAUTH_HINT).toBe(
      'Run `claude auth login` (or /login in a local session), then try again.',
    )
  })
})
