/**
 * densable 2.1.251 #20 — Wd / Aqt / hqt (ko/Cc/dr) + implicit vJe skip.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug'
import { logMock } from '../../../tests/mocks/log'

mock.module('../../services/analytics/index.js', analyticsMock)
mock.module('../log.ts', logMock)
mock.module('../debug.ts', debugMock)

const {
  clearAnthropicProfileCaches,
  isProfileAuthActive,
  isUsableStoredClaudeAiLogin,
} = await import('../anthropicProfile.js')

function writeProfile(dir: string, profile: string, creds: object): void {
  mkdirSync(join(dir, 'configs'), { recursive: true })
  mkdirSync(join(dir, 'credentials'), { recursive: true })
  writeFileSync(
    join(dir, 'configs', `${profile}.json`),
    JSON.stringify({ authentication: { type: 'user_oauth' } }),
  )
  writeFileSync(
    join(dir, 'credentials', `${profile}.json`),
    JSON.stringify(creds),
  )
  writeFileSync(join(dir, 'active_config'), profile)
}

const saved: Record<string, string | undefined> = {}

function pinEnv(patch: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in saved)) saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  clearAnthropicProfileCaches()
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete saved[k]
  }
  clearAnthropicProfileCaches()
})

function pinImplicitProfile(): string {
  const dir = join(tmpdir(), `cc-wd-251-${process.pid}-${Date.now()}`)
  writeProfile(dir, 'default', {
    access_token: 'tok_live',
    expires_at: Date.now() / 1000 + 3600,
  })
  pinEnv({
    ANTHROPIC_CONFIG_DIR: dir,
    ANTHROPIC_PROFILE: undefined,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    CLAUDE_CODE_OAUTH_TOKEN: undefined,
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: undefined,
    CLAUDE_CODE_USE_BEDROCK: undefined,
    CLAUDE_CODE_USE_VERTEX: undefined,
    CLAUDE_CODE_USE_FOUNDRY: undefined,
    CLAUDE_CODE_USE_MANTLE: undefined,
    CLAUDE_CODE_SIMPLE: undefined,
  })
  return dir
}

describe('densable 2.1.251 #20 Aqt / Wd', () => {
  test('Aqt needs inference scope and accessToken', () => {
    expect(isUsableStoredClaudeAiLogin(null)).toBe(false)
    expect(isUsableStoredClaudeAiLogin({ accessToken: 'tok' })).toBe(false)
    expect(
      isUsableStoredClaudeAiLogin({
        accessToken: 'tok',
        scopes: ['user:profile'],
      }),
    ).toBe(false)
    expect(
      isUsableStoredClaudeAiLogin({
        accessToken: '',
        scopes: ['user:inference'],
      }),
    ).toBe(false)
    expect(
      isUsableStoredClaudeAiLogin({
        accessToken: 'tok',
        scopes: ['user:inference'],
      }),
    ).toBe(true)
  })

  test('Wd skips implicit user_oauth only when Aqt is true', () => {
    pinImplicitProfile()
    expect(
      isProfileAuthActive({
        storedClaudeAiLogin: isUsableStoredClaudeAiLogin({
          accessToken: 'tok',
        }),
      }),
    ).toBe(true)
    expect(
      isProfileAuthActive({
        storedClaudeAiLogin: isUsableStoredClaudeAiLogin({
          accessToken: 'tok',
          scopes: ['user:inference'],
        }),
      }),
    ).toBe(false)
  })

  test('hqt Cc host-managed is not Wd', () => {
    pinImplicitProfile()
    expect(isProfileAuthActive()).toBe(true)
    pinEnv({ CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' })
    expect(isProfileAuthActive()).toBe(false)
  })
})
