import { describe, expect, test } from 'bun:test'
import type { Message } from 'src/types/message.js'
import {
  hydrateMessagesFromResumeSourceSession,
  isResumeFromSessionHydrateFeatureEnabled,
  shouldAttemptResumeFromSessionHydrate,
} from '../resumeFromSessionHydrate.js'

describe('isResumeFromSessionHydrateFeatureEnabled', () => {
  test('returns false with empty env (no opt-in)', () => {
    expect(isResumeFromSessionHydrateFeatureEnabled({ env: {} })).toBe(false)
  })

  test('returns true when forceEnabled', () => {
    expect(
      isResumeFromSessionHydrateFeatureEnabled({ forceEnabled: true }),
    ).toBe(true)
  })

  test('returns true when CLAUDE_CODE_RESUME_FROM_SESSION set', () => {
    expect(
      isResumeFromSessionHydrateFeatureEnabled({
        env: { CLAUDE_CODE_RESUME_FROM_SESSION: 'src-sid' },
      }),
    ).toBe(true)
  })

  test('returns true when ENABLE flag set', () => {
    expect(
      isResumeFromSessionHydrateFeatureEnabled({
        env: { CLAUDE_CODE_ENABLE_RESUME_FROM_SESSION: '1' },
      }),
    ).toBe(true)
  })
})

describe('shouldAttemptResumeFromSessionHydrate', () => {
  test('attempts when env session id present (portable xit densable)', () => {
    expect(
      shouldAttemptResumeFromSessionHydrate({
        isUrl: true,
        env: { CLAUDE_CODE_RESUME_FROM_SESSION: 'src-sid' },
      }),
    ).toEqual({ attempt: true, sourceSessionId: 'src-sid' })
  })

  test('does not attempt without url or sdkUrl', () => {
    expect(
      shouldAttemptResumeFromSessionHydrate({
        forceFeature: true,
        env: { CLAUDE_CODE_RESUME_FROM_SESSION: 'src-sid' },
      }),
    ).toEqual({ attempt: false })
  })

  test('does not attempt without env session id', () => {
    expect(
      shouldAttemptResumeFromSessionHydrate({
        forceFeature: true,
        isUrl: true,
        env: {},
      }),
    ).toEqual({ attempt: false })
  })

  test('attempts with forceFeature + isUrl + env', () => {
    expect(
      shouldAttemptResumeFromSessionHydrate({
        forceFeature: true,
        isUrl: true,
        env: { CLAUDE_CODE_RESUME_FROM_SESSION: 'src-sid' },
      }),
    ).toEqual({ attempt: true, sourceSessionId: 'src-sid' })
  })

  test('attempts with forceFeature + sdkUrl + env', () => {
    expect(
      shouldAttemptResumeFromSessionHydrate({
        forceFeature: true,
        sdkUrl: 'wss://example/session',
        env: { CLAUDE_CODE_RESUME_FROM_SESSION: '  other-sid  ' },
      }),
    ).toEqual({ attempt: true, sourceSessionId: 'other-sid' })
  })
})

describe('hydrateMessagesFromResumeSourceSession', () => {
  const sampleMessages = [
    { type: 'user', uuid: 'u1' },
    { type: 'assistant', uuid: 'a1' },
  ] as unknown as Message[]

  test('returns deserialized messages on success', async () => {
    const logs: string[] = []
    const result = await hydrateMessagesFromResumeSourceSession('src-sid', {
      prepareApiRequest: async () => ({
        accessToken: 'tok',
        orgUUID: 'org',
      }),
      teleportFromSessionsAPI: async (sid, org, token) => {
        expect(sid).toBe('src-sid')
        expect(org).toBe('org')
        expect(token).toBe('tok')
        return { log: sampleMessages }
      },
      deserializeMessages: log => {
        expect(log).toEqual(sampleMessages)
        return log
      },
      log: msg => logs.push(msg),
    })
    expect(result).toEqual(sampleMessages)
    expect(logs.some(l => l.includes('Hydrating from source session'))).toBe(
      true,
    )
    expect(logs.some(l => l.includes('Loaded 2 messages'))).toBe(true)
  })

  test('returns empty array and logs on failure', async () => {
    const logs: string[] = []
    const result = await hydrateMessagesFromResumeSourceSession('bad-sid', {
      prepareApiRequest: async () => {
        throw new Error('auth failed')
      },
      teleportFromSessionsAPI: async () => ({ log: [] }),
      deserializeMessages: log => log,
      log: msg => logs.push(msg),
    })
    expect(result).toEqual([])
    expect(logs.some(l => l.includes('Failed to hydrate'))).toBe(true)
    expect(logs.some(l => l.includes('auth failed'))).toBe(true)
  })
})
