import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// getCacheControl → isClaudeAISubscriber → auth key check
process.env.ANTHROPIC_API_KEY ??= 'test-key-for-unit'

import {
  resetStickyBetas,
  setMidConvCachePromotionRejected,
} from '../../../bootstrap/state.js'
import { clearGatewayAuth } from '../../../utils/gatewayEnv.js'
import { createApiSystemMessage } from '../../../utils/midConversationSystem.js'
import { createUserMessage } from '../../../utils/messages.js'
import { addCacheBreakpoints } from '../claude.js'

describe('addCacheBreakpoints Jdy api_system', () => {
  const prevEnv = { ...process.env }

  beforeEach(() => {
    resetStickyBetas()
    setMidConvCachePromotionRejected(false)
    // Sticky gatewayAuth short-circuits getAPIProvider() → 'gateway' even after
    // USE_* env scrub; clear so shouldCacheControlOnApiSystem() sees firstParty.
    clearGatewayAuth()
    // densable eDT eligibility: pin firstParty + official base so host
    // gateway/custom BASE_URL cannot starve api_system cache_control.
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.CLAUDE_CODE_USE_GATEWAY
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    delete process.env.CLAUDE_CODE_HIPAA
    delete process.env.CLAUDE_CODE_HIPAA_COMPLIANCE
    delete process.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL
  })

  afterEach(() => {
    resetStickyBetas()
    setMidConvCachePromotionRejected(false)
    clearGatewayAuth()
    for (const k of Object.keys(process.env)) {
      if (!(k in prevEnv)) delete process.env[k]
    }
    Object.assign(process.env, prevEnv)
  })

  test('maps api_system to role:system and prefers cache_control on trailing system', () => {
    const user = createUserMessage({ content: 'hi' })
    const sys = createApiSystemMessage('mid-conv note')
    const out = addCacheBreakpoints([user, sys], true, 'repl_main_thread')
    expect(out).toHaveLength(2)
    expect(out[0]?.role).toBe('user')
    // MessageParam is user|assistant; api_system is cast through as role:system
    expect((out[1] as { role: string }).role).toBe('system')
    const content = out[1]?.content
    expect(Array.isArray(content)).toBe(true)
    if (Array.isArray(content)) {
      const block = content[0] as {
        type: string
        text: string
        cache_control?: { type: string }
      }
      expect(block.type).toBe('text')
      expect(block.text).toBe('mid-conv note')
      expect(block.cache_control?.type).toBe('ephemeral')
    }
  })

  test('demote latch strips cache_control from api_system but keeps role:system', () => {
    setMidConvCachePromotionRejected(true)
    const user = createUserMessage({ content: 'hi' })
    const sys = createApiSystemMessage('mid-conv note')
    const out = addCacheBreakpoints([user, sys], true, 'repl_main_thread')
    expect((out[1] as { role: string }).role).toBe('system')
    // demoted: content is plain string (no cache_control text block)
    expect((out[1] as { content: unknown }).content).toBe('mid-conv note')
  })
})
