/**
 * densable `s4` on getAuthTokenSource.
 *
 * resetFdCredentialState does not clear the announcement Set. afterEach
 * clears it so a later file does not see a consumed FD with the env unset.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearDescriptorAnnouncements,
  markDescriptorAnnouncementConsumed,
  resetFdCredentialState,
  setOauthTokenFromFd,
} from '../../bootstrap/state.js'
import { getAuthTokenSource } from '../auth.js'

const ENV_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
] as const

const savedEnv = new Map<string, string | undefined>(
  ENV_KEYS.map(key => [key, process.env[key]]),
)

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function pinFdToken(): void {
  for (const key of ENV_KEYS) delete process.env[key]
  setOauthTokenFromFd('fd-tok')
}

afterEach(() => {
  restoreEnv()
  resetFdCredentialState()
  clearDescriptorAnnouncements()
})

describe('getAuthTokenSource s4', () => {
  test('unmarked FD slot without the env is the CCR file source', () => {
    pinFdToken()
    expect(getAuthTokenSource().source).toBe('CCR_OAUTH_TOKEN_FILE')

    process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = '3'
    expect(getAuthTokenSource().source).toBe(
      'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
    )

    process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = '   '
    expect(getAuthTokenSource().source).toBe('CCR_OAUTH_TOKEN_FILE')
  })

  test('consumed announcement keeps the FD source with env unset', () => {
    pinFdToken()
    markDescriptorAnnouncementConsumed(
      'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
    )
    expect(getAuthTokenSource().source).toBe(
      'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
    )
  })
})
