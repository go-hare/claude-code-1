/**
 * densable 2.1.228 #14 — Vertex GCP creds fail-fast (KKd/YKd + Cre + auth cap).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getAssistantMessageFromError,
  GOOGLE_CLOUD_AUTHENTICATION_FAILED_MESSAGE,
  GOOGLE_CLOUD_CREDENTIALS_EXPIRED_MESSAGE,
  startsWithApiErrorPrefix,
} from '../errors.js'
import { MAX_CLOUD_AUTH_RETRIES } from '../withRetry.js'

const providerEnvKeys = [
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH',
] as const

const savedEnv = new Map<string, string | undefined>()

const AUTH_KEY = 'ANTHROPIC_API_KEY'
let savedApiKey: string | undefined

function pinVertexEnv(): void {
  for (const k of providerEnvKeys) {
    savedEnv.set(k, process.env[k])
    delete process.env[k]
  }
  process.env.CLAUDE_CODE_USE_VERTEX = '1'
  // getAssistantMessageFromError → isClaudeAISubscriber → requires some key
  savedApiKey = process.env[AUTH_KEY]
  process.env[AUTH_KEY] =
    process.env[AUTH_KEY] || 'test-key-for-vertex-failfast'
}

function restoreEnv(): void {
  for (const k of providerEnvKeys) {
    const v = savedEnv.get(k)
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  savedEnv.clear()
  if (savedApiKey === undefined) delete process.env[AUTH_KEY]
  else process.env[AUTH_KEY] = savedApiKey
  savedApiKey = undefined
}

afterEach(() => {
  restoreEnv()
})

function textOf(
  assistant: ReturnType<typeof getAssistantMessageFromError>,
): string {
  const c = assistant.message.content?.[0]
  if (c && typeof c === 'object' && 'type' in c && c.type === 'text') {
    return c.text
  }
  return ''
}

describe('densable 2.1.228 #14 Vertex auth fail-fast constants', () => {
  test('MAX_CLOUD_AUTH_RETRIES matches densable x6S/k6S (=2)', () => {
    expect(MAX_CLOUD_AUTH_RETRIES).toBe(2)
  })

  test('KKd / YKd string constants match densable gold', () => {
    expect(GOOGLE_CLOUD_CREDENTIALS_EXPIRED_MESSAGE).toBe(
      'Google Cloud credentials expired or invalid',
    )
    expect(GOOGLE_CLOUD_AUTHENTICATION_FAILED_MESSAGE).toBe(
      'Google Cloud authentication failed',
    )
  })

  test('startsWithApiErrorPrefix (Cre) treats KKd/YKd as permanent auth', () => {
    expect(
      startsWithApiErrorPrefix(
        'Google Cloud credentials expired or invalid · run `gcloud auth application-default login` and retry · API Error: 401',
      ),
    ).toBe(true)
    expect(
      startsWithApiErrorPrefix(
        'Google Cloud authentication failed · credentials are managed by this environment — retry, or contact your administrator · API Error: 403',
      ),
    ).toBe(true)
    expect(startsWithApiErrorPrefix('API Error: something else')).toBe(true)
    expect(startsWithApiErrorPrefix('unrelated error')).toBe(false)
  })
})

describe('densable 2.1.228 #14 getAssistantMessageFromError Vertex wiring', () => {
  test('provider=vertex + 401 → KKd prefix + authentication_failed', () => {
    pinVertexEnv()
    const err = new APIError(
      401,
      { message: 'token expired' },
      'token expired',
      new Headers(),
    )
    const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    expect(assistant.error).toBe('authentication_failed')
    const text = textOf(assistant)
    expect(text.startsWith(GOOGLE_CLOUD_CREDENTIALS_EXPIRED_MESSAGE)).toBe(true)
    expect(startsWithApiErrorPrefix(text)).toBe(true)
  })

  test('provider=vertex + 403 → YKd prefix (not KKd)', () => {
    pinVertexEnv()
    const err = new APIError(
      403,
      { message: 'permission denied' },
      'permission denied',
      new Headers(),
    )
    const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    expect(assistant.error).toBe('authentication_failed')
    const text = textOf(assistant)
    expect(text.startsWith(GOOGLE_CLOUD_AUTHENTICATION_FAILED_MESSAGE)).toBe(
      true,
    )
    expect(text.startsWith(GOOGLE_CLOUD_CREDENTIALS_EXPIRED_MESSAGE)).toBe(
      false,
    )
  })

  test('skip-vertex-auth hint advertises gateway token refresh, not gcloud ADC', () => {
    pinVertexEnv()
    process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH = '1'
    const err = new APIError(401, { message: 'nope' }, 'nope', new Headers())
    const text = textOf(getAssistantMessageFromError(err, 'claude-sonnet-4-6'))
    // densable: skipAuth → no refreshCmd branch → gateway token hint
    expect(text).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(text).not.toContain('gcloud auth application-default login')
    expect(text.startsWith(GOOGLE_CLOUD_CREDENTIALS_EXPIRED_MESSAGE)).toBe(true)
  })

  test('USE_ANTHROPIC_GOOGLE_CLOUD alone still stamps KKd (densable anthropicGoogleCloud)', () => {
    // densable Vn(): AGC → anthropicGoogleCloud → KKd; ugi also treats AGC as GCP.
    // Local has no anthropicGoogleCloud provider id — gate on env like densable s===AGC.
    for (const k of providerEnvKeys) {
      savedEnv.set(k, process.env[k])
      delete process.env[k]
    }
    process.env.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD = '1'
    savedApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY =
      process.env.ANTHROPIC_API_KEY || 'test-key-for-vertex-failfast'
    try {
      const err = new APIError(
        401,
        { message: 'token expired' },
        'token expired',
        new Headers(),
      )
      const text = textOf(
        getAssistantMessageFromError(err, 'claude-sonnet-4-6'),
      )
      expect(text.startsWith(GOOGLE_CLOUD_CREDENTIALS_EXPIRED_MESSAGE)).toBe(
        true,
      )
      expect(startsWithApiErrorPrefix(text)).toBe(true)
      // must NOT fall through to firstParty /login copy
      expect(text.startsWith('Please run /login')).toBe(false)
    } finally {
      restoreEnv()
    }
  })
})
describe('densable 2.1.228 #14 withRetry Vertex auth cap wiring', () => {
  test('withRetry source: gcpAuthRetryCount cap + hostManagedAuth skip + event', () => {
    const src = readFileSync(join(import.meta.dir, '../withRetry.ts'), 'utf8')
    expect(src).toContain('MAX_CLOUD_AUTH_RETRIES')
    expect(src).toContain('isVertexAuthError')
    expect(src).toContain('gcpAuthRetryCount')
    expect(src).toContain('api_request_gcp_auth_exhausted')
    expect(src).toContain('isHostAuthTokenRefreshAvailable')
    // host-managed auth skips the hard cap
    expect(src).toMatch(
      /hostManagedAuth[\s\S]{0,120}isVertexAuthError[\s\S]{0,200}MAX_CLOUD_AUTH_RETRIES/,
    )
    // throw CannotRetryError after cap
    expect(src).toMatch(
      /gcpAuthRetryCount >= MAX_CLOUD_AUTH_RETRIES[\s\S]{0,120}CannotRetryError/,
    )
  })

  test('isVertexAuthError treats 401 under USE_VERTEX (source shape)', () => {
    const src = readFileSync(join(import.meta.dir, '../withRetry.ts'), 'utf8')
    expect(src).toContain('function isVertexAuthError')
    expect(src).toContain('CLAUDE_CODE_USE_VERTEX')
    expect(src).toMatch(/error\.status === 401/)
    expect(src).toContain('isGoogleAuthLibraryCredentialError')
  })
})
