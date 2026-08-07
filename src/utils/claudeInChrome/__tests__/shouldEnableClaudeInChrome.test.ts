import { afterEach, describe, expect, mock, test } from 'bun:test'

import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const authSnap = snapshotModuleExports(await import('src/utils/auth.js'))

let acceptScope = true

mock.module('src/utils/auth.js', () => ({
  ...authSnap,
  hasOauthValidateAcceptedScope: () => acceptScope,
  oauthScopesAcceptedByValidate: authSnap.oauthScopesAcceptedByValidate,
}))

// Import after mock so setup sees mocked JKn.
const { shouldEnableClaudeInChrome, CHROME_DISABLED_NO_VALIDATE_SCOPE } =
  await import('../setup.js')

describe('shouldEnableClaudeInChrome (densable yhn / Dtn order)', () => {
  const prevCfc = process.env.CLAUDE_CODE_ENABLE_CFC

  afterEach(() => {
    acceptScope = true
    if (prevCfc === undefined) {
      delete process.env.CLAUDE_CODE_ENABLE_CFC
    } else {
      process.env.CLAUDE_CODE_ENABLE_CFC = prevCfc
    }
  })

  test('JKn false: refuses even with explicit --chrome (densable yhn)', () => {
    acceptScope = false
    delete process.env.CLAUDE_CODE_ENABLE_CFC
    expect(shouldEnableClaudeInChrome(true)).toBe(false)
  })

  test('JKn false: refuses CFC force-enable', () => {
    acceptScope = false
    process.env.CLAUDE_CODE_ENABLE_CFC = '1'
    expect(shouldEnableClaudeInChrome(undefined)).toBe(false)
  })

  test('disable copy matches densable string', () => {
    expect(CHROME_DISABLED_NO_VALIDATE_SCOPE).toBe(
      '[Claude in Chrome] Disabled: OAuth token has no scope accepted by /api/oauth/validate (needs user:profile, user:office, or user:ccr_inference; env-var and setup-token sessions default to user:inference only)',
    )
  })

  test('explicit --chrome wins when scopes ok', () => {
    delete process.env.CLAUDE_CODE_ENABLE_CFC
    expect(shouldEnableClaudeInChrome(true)).toBe(true)
  })

  test('explicit --no-chrome wins', () => {
    process.env.CLAUDE_CODE_ENABLE_CFC = '1'
    expect(shouldEnableClaudeInChrome(false)).toBe(false)
  })

  test('CLAUDE_CODE_ENABLE_CFC enables without flag (even when default would be off)', () => {
    process.env.CLAUDE_CODE_ENABLE_CFC = '1'
    expect(shouldEnableClaudeInChrome(undefined)).toBe(true)
  })

  test('CLAUDE_CODE_ENABLE_CFC=0 disables without flag', () => {
    process.env.CLAUDE_CODE_ENABLE_CFC = '0'
    expect(shouldEnableClaudeInChrome(undefined)).toBe(false)
  })
})
