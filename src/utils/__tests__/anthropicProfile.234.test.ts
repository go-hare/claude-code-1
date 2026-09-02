import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'

mock.module('../../services/analytics/index.js', () => ({
  logEvent: () => {},
  stripProtoFields: <T>(v: T) => v,
}))
mock.module('../log.ts', logMock)
mock.module('../debug.ts', debugMock)

const {
  AnthropicProfileOauthError,
  PROFILE_OAUTH_REFRESH_GRANT,
  PROFILE_OAUTH_REFRESH_SKEW_SEC,
  PROFILE_OAUTH_TOKEN_PATH,
  clearAnthropicProfileCaches,
  describeAnthropicProfile,
  getAnthropicProfileSource,
  getAnthropicProfileWireOptions,
  isAnthropicProfileOauthExpiredError,
  isProfileAuthActive,
  readProfileUserOauthAccessToken,
  resolveProfileUserOauthAccessToken,
} = await import('../anthropicProfile.js')

function writeProfile(
  dir: string,
  profile: string,
  creds: object,
  config: object = { authentication: { type: 'user_oauth' } },
): void {
  mkdirSync(join(dir, 'configs'), { recursive: true })
  mkdirSync(join(dir, 'credentials'), { recursive: true })
  writeFileSync(join(dir, 'configs', `${profile}.json`), JSON.stringify(config))
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

describe('leftover 239 profile A5 / uD / oRr / DJo', () => {
  test('A5 implicit user_oauth + Ewn line', () => {
    const dir = join(tmpdir(), `cc-profile-${process.pid}-${Date.now()}`)
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
    })
    expect(getAnthropicProfileSource()).toBe('profile-implicit')
    expect(describeAnthropicProfile()).toContain('credentials-file')
    expect(describeAnthropicProfile()).toContain('profile default')
  })

  test('uD: API key / oauth env win', () => {
    const dir = join(tmpdir(), `cc-profile-ud-${process.pid}-${Date.now()}`)
    writeProfile(dir, 'default', {
      access_token: 'tok_live',
      expires_at: Date.now() / 1000 + 3600,
    })
    pinEnv({
      ANTHROPIC_CONFIG_DIR: dir,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
      CLAUDE_CODE_USE_BEDROCK: undefined,
      CLAUDE_CODE_USE_VERTEX: undefined,
      CLAUDE_CODE_USE_FOUNDRY: undefined,
      CLAUDE_CODE_USE_MANTLE: undefined,
    })
    expect(isProfileAuthActive()).toBe(true)
    pinEnv({ ANTHROPIC_API_KEY: 'sk-test' })
    expect(isProfileAuthActive()).toBe(false)
  })

  test('uD: implicit + stored claude.ai login skips (Vmd)', () => {
    const dir = join(tmpdir(), `cc-profile-vmd-${process.pid}-${Date.now()}`)
    writeProfile(dir, 'default', {
      access_token: 'tok_live',
      expires_at: Date.now() / 1000 + 3600,
    })
    pinEnv({
      ANTHROPIC_CONFIG_DIR: dir,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
      CLAUDE_CODE_USE_BEDROCK: undefined,
      CLAUDE_CODE_USE_VERTEX: undefined,
    })
    expect(isProfileAuthActive({ storedClaudeAiLogin: true })).toBe(false)
    expect(isProfileAuthActive({ storedClaudeAiLogin: false })).toBe(true)
  })

  test('oRr: expired with no refresh throws DUr shape', () => {
    const dir = join(tmpdir(), `cc-profile-orr-${process.pid}-${Date.now()}`)
    writeProfile(dir, 'default', {
      access_token: 'tok_old',
      expires_at: 1,
    })
    pinEnv({
      ANTHROPIC_CONFIG_DIR: dir,
      ANTHROPIC_API_KEY: undefined,
    })
    try {
      readProfileUserOauthAccessToken()
      throw new Error('expected throw')
    } catch (err) {
      expect(isAnthropicProfileOauthExpiredError(err)).toBe(true)
      expect(err).toBeInstanceOf(AnthropicProfileOauthError)
      expect(
        err instanceof AnthropicProfileOauthError ? err.statusCode : undefined,
      ).toBeNull()
      expect((err as Error).message).toContain(
        'has expired and no refresh is available',
      )
    }
  })

  test('DJo clears A5 memoize', () => {
    const dir = join(tmpdir(), `cc-profile-djo-${process.pid}-${Date.now()}`)
    const empty = join(
      tmpdir(),
      `cc-profile-empty-${process.pid}-${Date.now()}`,
    )
    writeProfile(dir, 'default', {
      access_token: 'tok_live',
      expires_at: Date.now() / 1000 + 3600,
    })
    mkdirSync(empty, { recursive: true })
    pinEnv({ ANTHROPIC_CONFIG_DIR: dir })
    expect(getAnthropicProfileSource()).toBe('profile-implicit')
    process.env.ANTHROPIC_CONFIG_DIR = empty
    expect(getAnthropicProfileSource()).toBe('profile-implicit')
    clearAnthropicProfileCaches()
    expect(getAnthropicProfileSource()).toBe(null)
  })

  test('GHt: within 30s of expiry marks needsRefresh', () => {
    const dir = join(tmpdir(), `cc-profile-ght-${process.pid}-${Date.now()}`)
    writeProfile(
      dir,
      'default',
      {
        access_token: 'tok_old',
        expires_at: Date.now() / 1000 + 20,
        refresh_token: 'rt',
      },
      {
        authentication: { type: 'user_oauth', client_id: 'cid' },
      },
    )
    pinEnv({ ANTHROPIC_CONFIG_DIR: dir })
    expect(PROFILE_OAUTH_REFRESH_SKEW_SEC).toBe(30)
    expect(readProfileUserOauthAccessToken()?.needsRefresh).toBe(true)
  })

  test('zqt: workspace header + stripped base_url', () => {
    const dir = join(tmpdir(), `cc-profile-zqt-${process.pid}-${Date.now()}`)
    writeProfile(
      dir,
      'default',
      { access_token: 'tok_live', expires_at: Date.now() / 1000 + 3600 },
      {
        authentication: { type: 'user_oauth' },
        workspace_id: 'ws-9',
        base_url: 'https://api.example.com/',
      },
    )
    pinEnv({ ANTHROPIC_CONFIG_DIR: dir })
    expect(getAnthropicProfileWireOptions()).toEqual({
      extraHeaders: { 'anthropic-workspace-id': 'ws-9' },
      baseURL: 'https://api.example.com',
    })
  })

  test('refresh POSTs /v1/oauth/token and writes credentials', async () => {
    const dir = join(tmpdir(), `cc-profile-ref-${process.pid}-${Date.now()}`)
    writeProfile(
      dir,
      'default',
      {
        access_token: 'tok_old',
        expires_at: 1,
        refresh_token: 'rt-old',
      },
      {
        authentication: { type: 'user_oauth', client_id: 'cid-1' },
        base_url: 'https://api.example.com/',
      },
    )
    pinEnv({ ANTHROPIC_CONFIG_DIR: dir })
    const fetchFn = mock(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe(
          `https://api.example.com${PROFILE_OAUTH_TOKEN_PATH}`,
        )
        expect(init?.method).toBe('POST')
        const body = JSON.parse(String(init?.body))
        expect(body).toEqual({
          grant_type: PROFILE_OAUTH_REFRESH_GRANT,
          refresh_token: 'rt-old',
          client_id: 'cid-1',
        })
        return new Response(
          JSON.stringify({
            access_token: 'tok_new',
            expires_in: 3600,
            refresh_token: 'rt-new',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
    )
    const tok = await resolveProfileUserOauthAccessToken(
      process.env,
      fetchFn as unknown as typeof fetch,
    )
    expect(tok?.token).toBe('tok_new')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const written = JSON.parse(
      await Bun.file(join(dir, 'credentials', 'default.json')).text(),
    )
    expect(written.access_token).toBe('tok_new')
    expect(written.refresh_token).toBe('rt-new')
    expect(written.type).toBe('oauth_token')
  })

  test('getAuthTokenSource does not throw oRr', async () => {
    const dir = join(tmpdir(), `cc-profile-src-${process.pid}-${Date.now()}`)
    writeProfile(dir, 'default', {
      access_token: 'tok_old',
      expires_at: 1,
    })
    pinEnv({
      ANTHROPIC_CONFIG_DIR: dir,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
    })
    const { getAuthTokenSource } = await import('../auth.js')
    expect(() => getAuthTokenSource()).not.toThrow()
    expect(getAuthTokenSource().hasToken).toBe(false)
  })
})
