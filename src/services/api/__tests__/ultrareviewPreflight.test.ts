import { describe, expect, test } from 'bun:test'
import { fetchUltrareviewPreflight } from '../ultrareviewQuota.js'

describe('fetchUltrareviewPreflight zko densable', () => {
  test('null when not subscriber', async () => {
    expect(
      await fetchUltrareviewPreflight({
        isSubscriber: () => false,
      }),
    ).toBeNull()
  })

  test('parses live preflight body via injectable get', async () => {
    const fixture = await fetchUltrareviewPreflight({
      isSubscriber: () => true,
      prepare: async () => ({ accessToken: 't', orgUUID: 'o' }),
      baseUrl: 'https://example.test',
      get: async (url, headers) => {
        expect(url).toBe('https://example.test/v1/ultrareview/preflight')
        expect(headers['x-organization-uuid']).toBe('o')
        return {
          action: 'blocked',
          blocked: {
            message: 'org disabled',
            reason: 'policy',
            action_url: 'https://help',
          },
        }
      },
    })
    expect(fixture).toEqual({
      action: 'blocked',
      blocked: {
        message: 'org disabled',
        reason: 'policy',
        action_url: 'https://help',
      },
    })
  })

  test('null on transport error', async () => {
    expect(
      await fetchUltrareviewPreflight({
        isSubscriber: () => true,
        prepare: async () => ({ accessToken: 't', orgUUID: 'o' }),
        get: async () => {
          throw new Error('network')
        },
      }),
    ).toBeNull()
  })

  test('null on invalid body shape', async () => {
    expect(
      await fetchUltrareviewPreflight({
        isSubscriber: () => true,
        prepare: async () => ({ accessToken: 't', orgUUID: 'o' }),
        get: async () => ({ action: 'nope' }),
      }),
    ).toBeNull()
  })
})
