import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('console keyless 243', () => {
  test('ConsoleOAuthFlow has wif vs legacy API key menu', () => {
    const src = readFileSync(
      join(import.meta.dir, '../ConsoleOAuthFlow.tsx'),
      'utf8',
    )
    expect(src).toContain("state: 'console_method'")
    expect(src).toContain('Sign in with your Console account')
    expect(src).toContain("value: 'wif'")
    expect(src).toContain('Create an API key')
    expect(src).toContain('tengu_oauth_console_token_selected')
    expect(src).toContain(
      'skipApiKey: !loginWithClaudeAi && preferConsoleToken',
    )
  })

  test('installOAuthTokens can skip API key creation', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../cli/handlers/auth.ts'),
      'utf8',
    )
    expect(src).toContain('skipApiKey?: boolean')
    expect(src).toContain('options?.skipApiKey')
  })
})
