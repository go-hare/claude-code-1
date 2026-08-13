/**
 * densable 2.1.229 #27 — /login CLAUDE_CODE_OAUTH_TOKEN override warnings (o9m/i9m/s9m/n9m).
 */
import { describe, expect, test } from 'bun:test'
import {
  OAUTH_TOKEN_ENV_PROFILE_NOTE,
  REMOTE_CONTROL_DISCONNECTED_NOTE,
  formatLoginDoneMessage,
  getOauthTokenEnvStartingMessage,
  getOauthTokenEnvSuccessNote,
  isOauthTokenEnvSetAtStart,
} from '../oauthTokenEnvWarning.js'

describe('densable 2.1.229 #27 o9m getOauthTokenEnvStartingMessage', () => {
  test('undefined when env token unset', () => {
    expect(getOauthTokenEnvStartingMessage(undefined)).toBeUndefined()
    expect(getOauthTokenEnvStartingMessage('')).toBeUndefined()
  })

  test('warning banner when env token set (densable o9m + n9m)', () => {
    const msg = getOauthTokenEnvStartingMessage('sk-ant-oat-test')
    expect(msg).toContain(
      'Warning: CLAUDE_CODE_OAUTH_TOKEN is set in your environment',
    )
    expect(msg).toContain(
      'This session will switch to your new credentials after logging in',
    )
    expect(msg).toContain(OAUTH_TOKEN_ENV_PROFILE_NOTE)
  })
})

describe('densable 2.1.229 #27 i9m getOauthTokenEnvSuccessNote', () => {
  test('post-success note mentions /login start snapshot + n9m', () => {
    const note = getOauthTokenEnvSuccessNote()
    expect(note).toContain(
      'Note: CLAUDE_CODE_OAUTH_TOKEN was set in your environment when /login started',
    )
    expect(note).toContain('This session will use your new credentials')
    expect(note).toContain(OAUTH_TOKEN_ENV_PROFILE_NOTE)
  })
})

describe('densable 2.1.229 #27 s9m formatLoginDoneMessage', () => {
  test('failure → Login interrupted', () => {
    expect(formatLoginDoneMessage(false)).toBe('Login interrupted')
    expect(formatLoginDoneMessage(false, { envTokenWasSet: true })).toBe(
      'Login interrupted',
    )
  })

  test('success without env token → Login successful', () => {
    expect(formatLoginDoneMessage(true)).toBe('Login successful')
    expect(formatLoginDoneMessage(true, { envTokenWasSet: false })).toBe(
      'Login successful',
    )
  })

  test('success + bridgeDisconnected → densable Remote Control note', () => {
    expect(formatLoginDoneMessage(true, { bridgeDisconnected: true })).toBe(
      `Login successful. ${REMOTE_CONTROL_DISCONNECTED_NOTE}`,
    )
  })

  test('success + envTokenWasSet repeats override note (i9m)', () => {
    const msg = formatLoginDoneMessage(true, { envTokenWasSet: true })
    expect(msg.startsWith('Login successful')).toBe(true)
    expect(msg).toContain(getOauthTokenEnvSuccessNote())
    expect(msg).toContain('\n\n')
  })

  test('success + envTokenWasSet + bridgeDisconnected composes both', () => {
    const msg = formatLoginDoneMessage(true, {
      envTokenWasSet: true,
      bridgeDisconnected: true,
    })
    expect(msg).toContain(REMOTE_CONTROL_DISCONNECTED_NOTE)
    expect(msg).toContain(getOauthTokenEnvSuccessNote())
  })

  test('gatewayActive suppresses post-success env note (densable Jn gateway)', () => {
    expect(
      formatLoginDoneMessage(true, {
        envTokenWasSet: true,
        gatewayActive: true,
      }),
    ).toBe('Login successful')
  })
})

describe('densable 2.1.229 #27 isOauthTokenEnvSetAtStart snapshot', () => {
  test('Boolean env presence (do not re-read after login)', () => {
    expect(isOauthTokenEnvSetAtStart(undefined)).toBe(false)
    expect(isOauthTokenEnvSetAtStart('')).toBe(false)
    expect(isOauthTokenEnvSetAtStart('token')).toBe(true)
  })
})
