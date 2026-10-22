/**
 * densable 2.1.289 AnthropicGoogleCloud — He() arm + L invoke URL.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { AnthropicError } from '@anthropic-ai/sdk'
import { AnthropicGoogleCloudClient } from '../anthropicGoogleCloudClient.js'
import { readFileSync } from 'fs'
import { join } from 'path'

const ENV_KEYS = [
  'ANTHROPIC_GOOGLE_CLOUD_BASE_URL',
  'ANTHROPIC_GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT',
  'ANTHROPIC_GOOGLE_CLOUD_LOCATION',
  'ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID',
] as const

const saved: Record<string, string | undefined> = {}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] !== undefined) process.env[key] = saved[key]
    else delete process.env[key]
  }
})

describe('AnthropicGoogleCloudClient (densable L / He AGC)', () => {
  test('gold L invoke URL from project/location/workspace', () => {
    const client = new AnthropicGoogleCloudClient({
      skipAuth: true,
      project: 'p1',
      location: 'us-east5',
      workspaceId: 'ws-1',
    })
    expect(client.baseURL).toBe(
      'https://claude.googleapis.com/v1alpha/projects/p1/locations/us-east5/workspaces/ws-1/invoke',
    )
  })

  test('default location is global', () => {
    const client = new AnthropicGoogleCloudClient({
      skipAuth: true,
      project: 'p1',
      workspaceId: 'ws-1',
    })
    expect(client.location).toBe('global')
    expect(client.baseURL).toContain('/locations/global/')
  })

  test('ANTHROPIC_GOOGLE_CLOUD_BASE_URL overrides L', () => {
    process.env.ANTHROPIC_GOOGLE_CLOUD_BASE_URL = 'https://example.test/agc'
    const client = new AnthropicGoogleCloudClient({
      skipAuth: true,
      workspaceId: 'ws-1',
    })
    expect(client.baseURL).toBe('https://example.test/agc')
  })

  test('missing workspace throws gold copy', () => {
    expect(
      () =>
        new AnthropicGoogleCloudClient({
          skipAuth: true,
          project: 'p1',
        }),
    ).toThrow(AnthropicError)
    try {
      new AnthropicGoogleCloudClient({ skipAuth: true, project: 'p1' })
    } catch (err) {
      expect(String(err)).toContain('ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID')
    }
  })

  test('getAnthropicClient branches on requestProvider anthropicGoogleCloud', () => {
    const src = readFileSync(join(import.meta.dir, '../client.ts'), 'utf8')
    expect(src).toContain(
      "requestProvider === 'anthropicGoogleCloud' && useAnthropicGoogleCloud",
    )
    expect(src).toContain('AnthropicGoogleCloudClient')
  })

  test('He ladder inserts AGC after anthropicAws', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../utils/model/providers.ts'),
      'utf8',
    )
    const aws = src.indexOf("return 'anthropicAws'")
    const agc = src.indexOf("return 'anthropicGoogleCloud'")
    const mantle = src.indexOf("return 'mantle'")
    expect(aws).toBeGreaterThan(0)
    expect(agc).toBeGreaterThan(aws)
    expect(mantle).toBeGreaterThan(agc)
    expect(src).toContain("provider === 'anthropicGoogleCloud'")
  })
})
