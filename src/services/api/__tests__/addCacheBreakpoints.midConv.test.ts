import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// getCacheControl → isClaudeAISubscriber → auth key check
process.env.ANTHROPIC_API_KEY ??= 'test-key-for-unit'

import {
  resetStickyBetas,
  setMidConvCachePromotionRejected,
} from '../../../bootstrap/state.js'
import { createApiSystemMessage } from '../../../utils/midConversationSystem.js'
import { createUserMessage } from '../../../utils/messages.js'
import { addCacheBreakpoints } from '../claude.js'

describe('addCacheBreakpoints Jdy api_system', () => {
  beforeEach(() => {
    resetStickyBetas()
    setMidConvCachePromotionRejected(false)
  })

  afterEach(() => {
    resetStickyBetas()
    setMidConvCachePromotionRejected(false)
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
