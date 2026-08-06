import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  isStickyBetaRejected,
  resetStickyBetas,
  setMidConvCachePromotionRejected,
  stickyRejectBeta,
} from '../../bootstrap/state.js'
import { MID_CONVERSATION_SYSTEM_BETA_HEADER } from '../../constants/betas.js'
import {
  createApiSystemMessage,
  demoteOrphanApiSystemMessages,
  extractPureTextFromUserMessages,
  isApiSystemCacheControlRejected,
  isApiSystemMessage,
  isMidConvSystemRoleRejected,
  latchMidConvCachePromotionRejected,
  latchMidConvSystemRejected,
  shouldCacheControlOnApiSystem,
  shouldUseMidConversationSystem,
} from '../midConversationSystem.js'
import { THIRD_PARTY_BETA_ALLOWLIST, filterBetasForProvider } from '../betas.js'
import { createUserMessage } from '../messages.js'

function api400(message: string): APIError {
  // SDK builds .message from status + body JSON; put text in body so detectors see it.
  return Object.assign(
    new APIError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message } },
      message,
      new Headers(),
    ),
    { message },
  )
}

describe('shouldUseMidConversationSystem (J8t)', () => {
  const prev = { ...process.env }

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k]
    }
    Object.assign(process.env, prev)
    resetStickyBetas()
    setMidConvCachePromotionRejected(false)
  })

  test('FORCE env turns on', () => {
    expect(
      shouldUseMidConversationSystem({
        model: 'claude-opus-4-7',
        env: { CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM: '1' },
      }),
    ).toBe(true)
  })

  test('hipaa policy forces off even with FORCE', () => {
    expect(
      shouldUseMidConversationSystem({
        model: 'claude-mythos-5',
        env: {
          CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM: '1',
          CLAUDE_CODE_HIPAA: '1',
        },
      }),
    ).toBe(false)
  })

  test('known-unsupported Claude 4.x models are off', () => {
    expect(shouldUseMidConversationSystem({ model: 'claude-sonnet-4-6' })).toBe(
      false,
    )
    expect(shouldUseMidConversationSystem({ model: 'claude-opus-4-7' })).toBe(
      false,
    )
  })

  test('mythos-5 is on', () => {
    expect(shouldUseMidConversationSystem({ model: 'claude-mythos-5' })).toBe(
      true,
    )
  })

  test('sticky reject latches off without FORCE (densable Ydy omits model)', () => {
    // densable J8t itself still returns true under FORCE; sticky is applied at
    // Ydy by passing model=undefined when midConvLatchedOff. J8t also checks
    // isStickyBetaRejected when FORCE is not set.
    latchMidConvSystemRejected()
    expect(isStickyBetaRejected(MID_CONVERSATION_SYSTEM_BETA_HEADER)).toBe(true)
    expect(shouldUseMidConversationSystem({ model: 'claude-mythos-5' })).toBe(
      false,
    )
  })
})

describe('KQn / e9i detectors', () => {
  test('KQn detects Unexpected role system', () => {
    const err = api400('Unexpected role "system" in input message role')
    expect(isMidConvSystemRoleRejected(err)).toBe(true)
  })

  test('KQn detects o3 beta header rejection', () => {
    const err = api400(
      `anthropic-beta: ${MID_CONVERSATION_SYSTEM_BETA_HEADER} is not supported`,
    )
    expect(isMidConvSystemRoleRejected(err)).toBe(true)
  })

  test('e9i detects proxy cache_control reject without system.N', () => {
    const err = api400('cache_control is not permitted on this message')
    expect(isApiSystemCacheControlRejected(err)).toBe(true)
  })

  test('e9i ignores system.N cache_control (KQn path)', () => {
    const err = api400(
      'messages.0.content.0.cache_control: system.0.cache_control invalid',
    )
    // system.N path is KQn (role system rejection via cache_control), not e9i
    expect(isApiSystemCacheControlRejected(err)).toBe(false)
    expect(isMidConvSystemRoleRejected(err)).toBe(true)
  })
})

describe('B6n / w3y / $3y', () => {
  test('createApiSystemMessage shape', () => {
    const m = createApiSystemMessage('hello')
    expect(isApiSystemMessage(m)).toBe(true)
    expect(m.message.role).toBe('system')
    expect(m.message.content).toBe('hello')
  })

  test('extractPureTextFromUserMessages rejects non-text', () => {
    const pure = extractPureTextFromUserMessages([
      createUserMessage({ content: 'a' }),
    ])
    expect(pure).toBe('a')
    const mixed = extractPureTextFromUserMessages([
      createUserMessage({
        content: [
          { type: 'text', text: 'a' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'xx',
            },
          },
        ],
      }),
    ])
    expect(mixed).toBeNull()
  })

  test('demoteOrphanApiSystemMessages keeps user→api_system→assistant', () => {
    const user = createUserMessage({ content: 'u' })
    const sys = createApiSystemMessage('sys')
    const asst = {
      type: 'assistant' as const,
      uuid: 'a',
      timestamp: new Date().toISOString(),
      message: {
        id: 'm',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'ok' }],
        model: 'x',
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      requestId: undefined,
    }
    const out = demoteOrphanApiSystemMessages([user, sys, asst], {
      createUserMeta: content =>
        createUserMessage({ content, isMeta: true }) as typeof user,
      wrapSystemReminder: t => `<system-reminder>${t}</system-reminder>`,
    })
    expect(out.map(m => m.type)).toEqual(['user', 'api_system', 'assistant'])
  })

  test('demoteOrphanApiSystemMessages demotes leading api_system', () => {
    const sys = createApiSystemMessage('orphan')
    const user = createUserMessage({ content: 'u' })
    const out = demoteOrphanApiSystemMessages([sys, user], {
      createUserMeta: content =>
        createUserMessage({ content, isMeta: true }) as typeof user,
      wrapSystemReminder: t => t,
    })
    expect(out[0]?.type).toBe('user')
    expect(isApiSystemMessage(out[0])).toBe(false)
  })
})

describe('Jdy cache gate + xNi o3 allowlist', () => {
  beforeEach(() => {
    resetStickyBetas()
    setMidConvCachePromotionRejected(false)
  })

  afterEach(() => {
    resetStickyBetas()
    setMidConvCachePromotionRejected(false)
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  })

  test('shouldCacheControlOnApiSystem respects demote latch', () => {
    expect(shouldCacheControlOnApiSystem()).toBe(true)
    latchMidConvCachePromotionRejected()
    expect(shouldCacheControlOnApiSystem()).toBe(false)
  })

  test('THIRD_PARTY_BETA_ALLOWLIST keeps o3', () => {
    expect(
      THIRD_PARTY_BETA_ALLOWLIST.has(MID_CONVERSATION_SYSTEM_BETA_HEADER),
    ).toBe(true)
  })

  test('filterBetasForProvider keeps o3 on non-1P when present', () => {
    const list = [
      'claude-code-20250219',
      MID_CONVERSATION_SYSTEM_BETA_HEADER,
      'some-unknown-beta',
    ]
    const filtered = filterBetasForProvider(list)
    expect(filtered).toContain(MID_CONVERSATION_SYSTEM_BETA_HEADER)
  })
})

describe('stickyRejectBeta', () => {
  afterEach(() => {
    resetStickyBetas()
  })

  test('isStickyBetaRejected after latch', () => {
    stickyRejectBeta(MID_CONVERSATION_SYSTEM_BETA_HEADER)
    latchMidConvSystemRejected()
    expect(shouldUseMidConversationSystem({ model: 'claude-mythos-5' })).toBe(
      false,
    )
  })
})
