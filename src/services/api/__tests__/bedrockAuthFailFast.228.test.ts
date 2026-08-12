/**
 * densable GKd / VKd — Bedrock / AWS auth fail copy wiring (cousin of #14 KKd/YKd).
 *
 * Constants were exported for Cre() but getAssistantMessageFromError fell through
 * to firstParty /login under USE_BEDROCK. Wire formatBedrockAuthErrorMessage.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  AWS_AUTHENTICATION_FAILED_MESSAGE,
  AWS_CREDENTIALS_EXPIRED_MESSAGE,
  getAssistantMessageFromError,
  startsWithApiErrorPrefix,
} from '../errors.js'

const providerEnvKeys = [
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH',
  'CLAUDE_CODE_SKIP_MANTLE_AUTH',
] as const

const savedEnv = new Map<string, string | undefined>()
const AUTH_KEY = 'ANTHROPIC_API_KEY'
let savedApiKey: string | undefined

function pinBedrockEnv(): void {
  for (const k of providerEnvKeys) {
    savedEnv.set(k, process.env[k])
    delete process.env[k]
  }
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  savedApiKey = process.env[AUTH_KEY]
  process.env[AUTH_KEY] =
    process.env[AUTH_KEY] || 'test-key-for-bedrock-failfast'
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

describe('densable GKd/VKd constants + Cre', () => {
  test('GKd / VKd string constants match densable gold', () => {
    expect(AWS_CREDENTIALS_EXPIRED_MESSAGE).toBe(
      'AWS credentials expired or invalid',
    )
    expect(AWS_AUTHENTICATION_FAILED_MESSAGE).toBe('AWS authentication failed')
  })

  test('startsWithApiErrorPrefix (Cre) treats GKd/VKd as permanent auth', () => {
    expect(
      startsWithApiErrorPrefix(
        'AWS credentials expired or invalid · credentials are managed by this environment — retry, or contact your administrator · API Error: 403',
      ),
    ).toBe(true)
    expect(
      startsWithApiErrorPrefix(
        'AWS authentication failed · if credentials are current, check AWS IAM permissions and Bedrock model access · API Error: 403',
      ),
    ).toBe(true)
  })
})

describe('getAssistantMessageFromError Bedrock GKd/VKd wiring', () => {
  test('provider=bedrock + security-token 403 → GKd (not /login)', () => {
    pinBedrockEnv()
    const err = new APIError(
      403,
      { message: 'The security token included in the request is invalid' },
      'The security token included in the request is invalid',
      new Headers(),
    )
    const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    expect(assistant.error).toBe('authentication_failed')
    const text = textOf(assistant)
    expect(text.startsWith(AWS_CREDENTIALS_EXPIRED_MESSAGE)).toBe(true)
    expect(text.startsWith('Please run /login')).toBe(false)
    expect(startsWithApiErrorPrefix(text)).toBe(true)
  })

  test('provider=bedrock + generic 403 → VKd + IAM hint', () => {
    pinBedrockEnv()
    const err = new APIError(
      403,
      { message: 'AccessDeniedException' },
      'AccessDeniedException',
      new Headers(),
    )
    const text = textOf(getAssistantMessageFromError(err, 'claude-sonnet-4-6'))
    expect(text.startsWith(AWS_AUTHENTICATION_FAILED_MESSAGE)).toBe(true)
    expect(text.startsWith(AWS_CREDENTIALS_EXPIRED_MESSAGE)).toBe(false)
    expect(text).toContain('AWS IAM permissions')
    expect(text).toContain('Bedrock model access')
  })

  test('provider=bedrock + 401 → GKd', () => {
    pinBedrockEnv()
    const err = new APIError(
      401,
      { message: 'expired' },
      'expired',
      new Headers(),
    )
    const text = textOf(getAssistantMessageFromError(err, 'claude-sonnet-4-6'))
    expect(text.startsWith(AWS_CREDENTIALS_EXPIRED_MESSAGE)).toBe(true)
  })

  test('SKIP_BEDROCK_AUTH hint advertises gateway token, not awsAuthRefresh', () => {
    pinBedrockEnv()
    process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'
    const err = new APIError(
      403,
      { message: 'The security token included in the request is invalid' },
      'The security token included in the request is invalid',
      new Headers(),
    )
    const text = textOf(getAssistantMessageFromError(err, 'claude-sonnet-4-6'))
    expect(text).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(text.startsWith(AWS_CREDENTIALS_EXPIRED_MESSAGE)).toBe(true)
  })

  test('CredentialsProviderError under USE_BEDROCK → GKd', () => {
    pinBedrockEnv()
    const err = Object.assign(
      new Error('Could not load credentials from any providers'),
      {
        name: 'CredentialsProviderError',
      },
    )
    const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    expect(assistant.error).toBe('authentication_failed')
    const text = textOf(assistant)
    expect(text.startsWith(AWS_CREDENTIALS_EXPIRED_MESSAGE)).toBe(true)
    expect(startsWithApiErrorPrefix(text)).toBe(true)
  })

  test('firstParty provider still uses /login (not GKd)', () => {
    for (const k of providerEnvKeys) {
      savedEnv.set(k, process.env[k])
      delete process.env[k]
    }
    savedApiKey = process.env[AUTH_KEY]
    process.env[AUTH_KEY] = process.env[AUTH_KEY] || 'test-key-firstparty'
    try {
      const err = new APIError(
        401,
        { message: 'unauthorized' },
        'unauthorized',
        new Headers(),
      )
      const text = textOf(
        getAssistantMessageFromError(err, 'claude-sonnet-4-6'),
      )
      expect(text.startsWith(AWS_CREDENTIALS_EXPIRED_MESSAGE)).toBe(false)
      expect(text.startsWith(AWS_AUTHENTICATION_FAILED_MESSAGE)).toBe(false)
      // non-interactive may use Failed to authenticate; interactive /login
      expect(
        text.startsWith('Please run /login') ||
          text.startsWith('Failed to authenticate'),
      ).toBe(true)
    } finally {
      restoreEnv()
    }
  })
})
