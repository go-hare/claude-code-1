import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getAuthTokenSource } from '../../../utils/auth.js'

describe('#1072 CCR_OAUTH_TOKEN_FILE fallback in getAuthStatus / auth', () => {
  test('getAuthStatus shadows console profile via getOAuthTokenFromFileDescriptor', () => {
    const src = readFileSync(
      join(import.meta.dir, '../getAuthStatus.ts'),
      'utf-8',
    )
    expect(src).toContain('getOAuthTokenFromFileDescriptor()')
  })

  test('getAuthTokenSource is exported and returns a valid source shape', () => {
    const res = getAuthTokenSource()
    expect(typeof res.hasToken).toBe('boolean')
    expect(typeof res.source).toBe('string')
  })
})
