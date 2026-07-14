import { afterEach, describe, expect, test } from 'bun:test'
import { AnthropicAwsClient } from '../anthropicAwsClient.js'

const ENV_KEYS = [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_AWS_WORKSPACE_ID',
] as const

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

function stashEnv(): void {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    const v = saved[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

afterEach(() => {
  restoreEnv()
})

describe('AnthropicAwsClient densable', () => {
  test('builds default base URL and workspace header', () => {
    stashEnv()
    process.env.AWS_REGION = 'us-west-2'
    process.env.ANTHROPIC_AWS_WORKSPACE_ID = 'ws-1'
    process.env.ANTHROPIC_AWS_API_KEY = 'key-1'

    const client = new AnthropicAwsClient({
      dangerouslyAllowBrowser: true,
    })
    expect(client.baseURL).toBe(
      'https://aws-external-anthropic.us-west-2.api.aws',
    )
    expect(client.workspaceId).toBe('ws-1')
    expect(client.skipAuth).toBe(false)
  })

  test('allows skipAuth without region/workspace', () => {
    stashEnv()
    const client = new AnthropicAwsClient({
      skipAuth: true,
      baseURL: 'https://proxy.example',
      dangerouslyAllowBrowser: true,
    })
    expect(client.skipAuth).toBe(true)
    expect(client.baseURL).toBe('https://proxy.example')
  })

  test('throws when workspace missing and not skipAuth', () => {
    stashEnv()
    process.env.AWS_REGION = 'us-east-1'
    expect(
      () =>
        new AnthropicAwsClient({
          dangerouslyAllowBrowser: true,
        }),
    ).toThrow(/workspace ID/)
  })

  test('throws when region/baseURL missing and not skipAuth', () => {
    stashEnv()
    process.env.ANTHROPIC_AWS_WORKSPACE_ID = 'ws-1'
    expect(
      () =>
        new AnthropicAwsClient({
          dangerouslyAllowBrowser: true,
        }),
    ).toThrow(/region or base URL/)
  })

  test('requires awsAccessKey + awsSecretAccessKey together', () => {
    stashEnv()
    process.env.AWS_REGION = 'us-east-1'
    process.env.ANTHROPIC_AWS_WORKSPACE_ID = 'ws-1'
    expect(
      () =>
        new AnthropicAwsClient({
          awsAccessKey: 'AKIA',
          dangerouslyAllowBrowser: true,
        }),
    ).toThrow(/must be provided together/)
  })
})
