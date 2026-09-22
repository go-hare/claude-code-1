/**
 * densable 2.1.248 #11 Zye / OAuthRefreshLockTimeoutError
 * SEA class @180967566 · fk throw @180981487 · Ho map @184140906
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  setIsInteractive,
  getIsNonInteractiveSession,
} from '../../bootstrap/state.js'
import {
  classifyAPIError,
  getAssistantMessageFromError,
  OAUTH_REFRESH_LOCK_TIMEOUT_API_MESSAGE,
  OAUTH_REFRESH_LOCK_TIMEOUT_MESSAGE,
} from '../../services/api/errors.js'
import {
  OAuthRefreshDeadError,
  OAuthRefreshLockTimeoutError,
} from '../accountOnHold.js'

const GOLD_ZYE_MESSAGE =
  'OAuth access token could not be refreshed: another Claude Code process is holding the refresh lock'
const GOLD_USER =
  'Could not refresh your login because another Claude Code process is refreshing it (or exited mid-refresh) · Try again in a minute; if it keeps happening, close other Claude Code windows or sign in again with /login'
const GOLD_API =
  'Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. This is usually transient; retry in a minute, and if it persists close other Claude Code processes or sign in again'
const GOLD_DEAD =
  'OAuth refresh token is no longer valid; run /login to re-authenticate'

const srcRoot = join(import.meta.dir, '../..')
const prevInteractive = !getIsNonInteractiveSession()

afterEach(() => {
  setIsInteractive(prevInteractive)
})

function textOf(
  assistant: ReturnType<typeof getAssistantMessageFromError>,
): string {
  const content = assistant.message.content
  if (!Array.isArray(content)) return String(content)
  const block = content.find(b => b.type === 'text')
  return block && 'text' in block ? block.text : ''
}

describe('densable 2.1.248 #11 OAuthRefreshLockTimeoutError Zye', () => {
  test('Zye name and message match gold 1:1', () => {
    const err = new OAuthRefreshLockTimeoutError()
    expect(err.name).toBe('OAuthRefreshLockTimeoutError')
    expect(err.message).toBe(GOLD_ZYE_MESSAGE)
    expect(err).toBeInstanceOf(Error)
  })

  test('DeadError /login leftover is unchanged', () => {
    const err = new OAuthRefreshDeadError()
    expect(err.name).toBe('OAuthRefreshDeadError')
    expect(err.message).toBe(GOLD_DEAD)
    expect(err.message).toContain('/login')
    expect(err.message).not.toBe(GOLD_ZYE_MESSAGE)
  })

  test('source-locks Zye class, ELOCKED throw, fk throw, Ho copies', () => {
    const hold = readFileSync(join(srcRoot, 'utils/accountOnHold.ts'), 'utf8')
    expect(hold).toContain(GOLD_ZYE_MESSAGE)
    expect(hold).toContain("this.name = 'OAuthRefreshLockTimeoutError'")
    expect(hold).toContain(GOLD_DEAD)
    expect(hold).toContain("this.name = 'OAuthRefreshDeadError'")

    const auth = readFileSync(join(srcRoot, 'utils/auth.ts'), 'utf8')
    expect(auth).toContain('tengu_oauth_token_refresh_lock_retry_limit_reached')
    expect(auth).toContain('throw new OAuthRefreshLockTimeoutError()')
    expect(auth).toContain("err as { code?: string }).code === 'ELOCKED'")

    const client = readFileSync(join(srcRoot, 'services/api/client.ts'), 'utf8')
    expect(client).toContain('OAuthRefreshLockTimeoutError')
    expect(client).toContain('throw new OAuthRefreshLockTimeoutError()')
    expect(client).toContain('throw new OAuthRefreshDeadError()')
    expect(client).toContain('oauthRefreshLockTimeout')
    expect(client).toContain('expiresAt != null')

    const errors = readFileSync(join(srcRoot, 'services/api/errors.ts'), 'utf8')
    expect(errors).toContain(GOLD_USER)
    expect(errors).toContain(GOLD_API)
    expect(errors).toContain("error: 'server_error'")
    expect(errors).toContain("'oauth_refresh_lock_timeout'")
    expect(errors).not.toContain(
      'Failed to authenticate: OAuth session expired and could not be refreshed',
    )

    const mcpAuth = readFileSync(join(srcRoot, 'services/mcp/auth.ts'), 'utf8')
    expect(mcpAuth).not.toContain('OAuthRefreshLockTimeoutError')
    expect(mcpAuth).not.toContain(GOLD_ZYE_MESSAGE)
  })

  test('interactive Ho maps Zye to h5t, not /login', () => {
    setIsInteractive(true)
    const assistant = getAssistantMessageFromError(
      new OAuthRefreshLockTimeoutError(),
      'claude-sonnet-4-6',
    )
    expect(assistant.error).toBe('server_error')
    expect(textOf(assistant)).toBe(GOLD_USER)
    expect(textOf(assistant)).toBe(OAUTH_REFRESH_LOCK_TIMEOUT_MESSAGE)
    expect(textOf(assistant)).not.toContain('Please run /login')
    expect(textOf(assistant)).not.toBe('Login expired · Please run /login')
  })

  test('non-interactive Ho maps Zye to API retry copy', () => {
    setIsInteractive(false)
    const assistant = getAssistantMessageFromError(
      new OAuthRefreshLockTimeoutError(),
      'claude-sonnet-4-6',
    )
    expect(assistant.error).toBe('server_error')
    expect(textOf(assistant)).toBe(GOLD_API)
    expect(textOf(assistant)).toBe(OAUTH_REFRESH_LOCK_TIMEOUT_API_MESSAGE)
    expect(textOf(assistant)).not.toContain('/login')
  })

  test('classifyAPIError is oauth_refresh_lock_timeout, not auth_error', () => {
    expect(classifyAPIError(new OAuthRefreshLockTimeoutError())).toBe(
      'oauth_refresh_lock_timeout',
    )
    expect(classifyAPIError(new OAuthRefreshDeadError())).not.toBe(
      'oauth_refresh_lock_timeout',
    )
  })
})
