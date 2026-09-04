import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

import { API_ERROR_MESSAGE_PREFIX } from '../../services/api/errors.js'
import { formatClientApiErrorLine } from '../messages/AssistantTextMessage.js'

describe('client error line 243', () => {
  test('bare API Error prefix gets the official wait hint', () => {
    expect(formatClientApiErrorLine(API_ERROR_MESSAGE_PREFIX)).toBe(
      `${API_ERROR_MESSAGE_PREFIX}: Please wait a moment and try again.`,
    )
  })

  test('auth / model-availability copy is unchanged', () => {
    const auth = 'Failed to authenticate. API Error: 401 Unauthorized'
    expect(formatClientApiErrorLine(auth)).toBe(auth)
  })

  test('Message.tsx pipes isApiErrorMessage into AssistantTextMessage', () => {
    const src = readFileSync(join(import.meta.dir, '../Message.tsx'), 'utf8')
    expect(src).toContain('isApiError={message.isApiErrorMessage === true}')
    expect(src).toContain('isApiError={isApiError}')
  })

  test('AssistantTextMessage Gx uses Ox=J$a red then Rle||Lx||wx Kx', () => {
    const src = readFileSync(
      join(import.meta.dir, '../messages/AssistantTextMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('isInvalidExternalCredentialSuffix(text)')
    expect(src).toContain(
      'shouldRenderClientGeneratedErrorLine(isApiError, text)',
    )
    expect(src).toContain('ClientGeneratedErrorLine')
    expect(src).toContain('color="warning"')
    expect(src).toContain('aria-label="error:"')
    expect(src).toContain('width={columns - 10}')
    expect(src).toContain('useTerminalSize')
  })

  test('firstParty client throws yz from f$e immediately before FTn', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/api/client.ts'),
      'utf8',
    )
    expect(src).toContain('getOAuthAccountOnHold()')
    expect(src).toContain('new OAuthAccountOnHoldError(hold.url)')
    expect(src).toContain('assertValidOutgoingHeaders({')
    const hold = src.indexOf('getOAuthAccountOnHold()')
    const ftn = src.indexOf('assertValidOutgoingHeaders({')
    expect(hold).toBeGreaterThan(-1)
    expect(ftn).toBeGreaterThan(hold)
  })

  test('withRetry rethrows nd and wraps yz after f$e', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/api/withRetry.ts'),
      'utf8',
    )
    expect(src).toContain('if (error instanceof CannotRetryError) throw error')
    expect(src).toContain('new OAuthAccountOnHoldError(hold.url)')
    expect(src).toContain('api_request_account_on_hold')
  })
})
