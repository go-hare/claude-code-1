import { afterEach, describe, expect, test } from 'bun:test'
import { getAuthHeaders } from '../index.js'

const savedBaseUrl = process.env.ANTHROPIC_BASE_URL
const savedApiKey = process.env.ANTHROPIC_API_KEY

afterEach(() => {
  if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = savedBaseUrl
  if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = savedApiKey
})

describe('policyLimits getAuthHeaders (#616)', () => {
  test('withholds third-party gateway API key when custom ANTHROPIC_BASE_URL is set', () => {
    process.env.ANTHROPIC_BASE_URL =
      'https://gateway.internal.example/anthropic'
    process.env.ANTHROPIC_API_KEY = 'gw-third-party-secret-token'
    const result = getAuthHeaders()
    expect(result.headers['x-api-key']).toBeUndefined()
  })

  test('allows sk-ant- API key even with custom ANTHROPIC_BASE_URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.internal.example'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-123456'
    const result = getAuthHeaders()
    expect(result.headers['x-api-key']).toBe('sk-ant-api03-test-key-123456')
  })

  test('sends API key when ANTHROPIC_BASE_URL is unset', () => {
    delete process.env.ANTHROPIC_BASE_URL
    process.env.ANTHROPIC_API_KEY = 'any-first-party-key'
    const result = getAuthHeaders()
    expect(result.headers['x-api-key']).toBe('any-first-party-key')
  })
})
