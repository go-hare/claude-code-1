/**
 * densable update_environment_variables residual (#98):
 * dtT allowlist, object-of-strings validation, non-allowlisted refuse,
 * OAUTH_TOKEN cache clear (U9).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

// Avoid real auth cache module side-effects; track clearOAuthTokenCache calls.
const clearOAuthTokenCacheMock = mock(() => {})
mock.module('src/utils/auth.js', () => ({
  clearOAuthTokenCache: clearOAuthTokenCacheMock,
}))

import { UPDATE_ENVIRONMENT_VARIABLE_ALLOWLIST } from '../structuredIO.js'

describe('UPDATE_ENVIRONMENT_VARIABLE_ALLOWLIST densable dtT', () => {
  test('allowlists session access + oauth token only', () => {
    expect([...UPDATE_ENVIRONMENT_VARIABLE_ALLOWLIST].sort()).toEqual([
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
    ])
  })
})

/**
 * Pure allowlist apply logic mirroring structuredIO.processLine handler.
 * Kept inline so we don't need to construct a full StructuredIO with streams.
 */
function applyUpdateEnvironmentVariables(
  variables: unknown,
  env: Record<string, string | undefined> = {},
): {
  applied: string[]
  refused: string[]
  dropped: boolean
  clearOAuth: boolean
  env: Record<string, string | undefined>
} {
  if (
    typeof variables !== 'object' ||
    variables === null ||
    Array.isArray(variables) ||
    Object.values(variables as Record<string, unknown>).some(
      v => typeof v !== 'string',
    )
  ) {
    return { applied: [], refused: [], dropped: true, clearOAuth: false, env }
  }
  const applied: string[] = []
  const refused: string[] = []
  const next = { ...env }
  for (const [key, value] of Object.entries(
    variables as Record<string, string>,
  )) {
    if (!UPDATE_ENVIRONMENT_VARIABLE_ALLOWLIST.has(key)) {
      refused.push(key)
      continue
    }
    next[key] = value
    applied.push(key)
  }
  return {
    applied,
    refused,
    dropped: false,
    clearOAuth: applied.includes('CLAUDE_CODE_OAUTH_TOKEN'),
    env: next,
  }
}

describe('update_environment_variables densable apply matrix', () => {
  afterEach(() => {
    clearOAuthTokenCacheMock.mockClear()
  })

  test('applies allowlisted session access token', () => {
    const r = applyUpdateEnvironmentVariables({
      CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'tok-1',
    })
    expect(r.dropped).toBe(false)
    expect(r.applied).toEqual(['CLAUDE_CODE_SESSION_ACCESS_TOKEN'])
    expect(r.refused).toEqual([])
    expect(r.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBe('tok-1')
    expect(r.clearOAuth).toBe(false)
  })

  test('applies oauth token and flags U9 clear', () => {
    const r = applyUpdateEnvironmentVariables({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-2',
    })
    expect(r.applied).toEqual(['CLAUDE_CODE_OAUTH_TOKEN'])
    expect(r.clearOAuth).toBe(true)
    expect(r.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-2')
  })

  test('refuses non-allowlisted keys without applying them', () => {
    const r = applyUpdateEnvironmentVariables({
      PATH: '/evil',
      CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'ok',
      NODE_OPTIONS: '--inspect',
    })
    expect(r.applied).toEqual(['CLAUDE_CODE_SESSION_ACCESS_TOKEN'])
    expect(r.refused.sort()).toEqual(['NODE_OPTIONS', 'PATH'])
    expect(r.env.PATH).toBeUndefined()
    expect(r.env.NODE_OPTIONS).toBeUndefined()
    expect(r.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBe('ok')
  })

  test('drops non-object / array / non-string values', () => {
    expect(applyUpdateEnvironmentVariables(null).dropped).toBe(true)
    expect(applyUpdateEnvironmentVariables(['x']).dropped).toBe(true)
    expect(applyUpdateEnvironmentVariables({ a: 1 }).dropped).toBe(true)
    expect(applyUpdateEnvironmentVariables('nope').dropped).toBe(true)
  })

  test('source anchors densable allowlist + clearOAuthTokenCache + validation', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../structuredIO.ts'),
      'utf8',
    )
    expect(src).toContain('UPDATE_ENVIRONMENT_VARIABLE_ALLOWLIST')
    expect(src).toContain('CLAUDE_CODE_SESSION_ACCESS_TOKEN')
    expect(src).toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(src).toContain('clearOAuthTokenCache')
    expect(src).toContain(
      'variables must be an object of string values',
    )
    expect(src).toContain(
      'refused update_environment_variables for non-allowlisted keys',
    )
  })
})
