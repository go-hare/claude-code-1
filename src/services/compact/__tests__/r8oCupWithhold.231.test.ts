/**
 * densable 2.1.231 SEA: cup/r8o optional-chain withhold + abort → Ysa off.
 *
 * SEA gold:
 *   function cup(e){return e?.type==="assistant"&&e8e(e)}
 *   function r8o(e){return e?.type==="assistant"&&l8o(e)}
 *   n8o catch: aborted keeps bare PTL (oaa only reason==="error"+detail)
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from '../../api/errors.js'
import type { AssistantMessage } from '../../../types/message.js'
import { ERROR_MESSAGE_USER_ABORT } from '../compact.js'

const realGrowthbook = await import('../../analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) => {
    if (key === 'tengu_reactive_compact_remote') return false
    return growthbookSnap.getFeatureValue_CACHED_MAY_BE_STALE?.(key, fallback)
  },
}))

const realConfig = await import('../../../utils/config.js')
const configSnap = snapshotModuleExports(realConfig)
mock.module('src/utils/config.js', () => ({
  ...configSnap,
  getGlobalConfig: () => ({
    ...((configSnap.getGlobalConfig?.() as object) ?? {}),
    autoCompactEnabled: true,
  }),
}))

// Avoid real compactConversation network — only exercise catch mapping.
const compactSnap = snapshotModuleExports(await import('../compact.js'))
let compactImpl: () => Promise<unknown> = async () => {
  throw new Error('compactImpl not set')
}
mock.module('src/services/compact/compact.js', () => ({
  ...compactSnap,
  compactConversation: (..._args: unknown[]) => compactImpl(),
}))

const {
  isWithheldPromptTooLong,
  isWithheldMediaSizeError,
  tryReactiveCompact,
  annotatePromptTooLongWithCompactFailure,
} = await import('../reactiveCompact.js')

afterAll(() => {
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module('src/services/compact/compact.js', () => ({ ...compactSnap }))
})

function ptlAssistant(): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-0000000000aa',
    timestamp: new Date().toISOString(),
    isApiErrorMessage: true,
    errorDetails: 'prompt is too long: 200000 tokens > 180000 maximum',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: PROMPT_TOO_LONG_ERROR_MESSAGE }],
    },
  } as AssistantMessage
}

function mediaAssistant(): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-0000000000bb',
    timestamp: new Date().toISOString(),
    isApiErrorMessage: true,
    errorDetails: 'request_too_large: image exceeds maximum size',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Image too large' }],
    },
  } as AssistantMessage
}

describe('densable cup/r8o optional-chain withhold (2.1.231 SEA)', () => {
  test('cup/r8o: undefined/null lastMessage → false (no throw)', () => {
    expect(isWithheldPromptTooLong(undefined)).toBe(false)
    expect(isWithheldPromptTooLong(null)).toBe(false)
    expect(isWithheldMediaSizeError(undefined)).toBe(false)
    expect(isWithheldMediaSizeError(null)).toBe(false)
  })

  test('cup: PTL assistant true; media assistant false', () => {
    expect(isWithheldPromptTooLong(ptlAssistant())).toBe(true)
    expect(isWithheldPromptTooLong(mediaAssistant())).toBe(false)
  })

  test('r8o: media assistant true; PTL assistant false', () => {
    expect(isWithheldMediaSizeError(mediaAssistant())).toBe(true)
    expect(isWithheldMediaSizeError(ptlAssistant())).toBe(false)
  })

  test('non-assistant / non-api-error → false', () => {
    expect(
      isWithheldMediaSizeError({
        type: 'user',
        message: { role: 'user', content: 'x' },
      } as never),
    ).toBe(false)
    expect(
      isWithheldPromptTooLong({
        type: 'assistant',
        isApiErrorMessage: false,
        message: { role: 'assistant', content: [] },
      } as never),
    ).toBe(false)
  })
})

describe('densable n8o abort → failure.reason aborted (Ysa off)', () => {
  test('USER_ABORT message → aborted, not error+detail', async () => {
    compactImpl = async () => {
      throw new Error(ERROR_MESSAGE_USER_ABORT)
    }
    const out = await tryReactiveCompact({
      hasAttempted: false,
      querySource: 'repl_main_thread',
      aborted: false,
      messages: [],
      cacheSafeParams: {
        toolUseContext: { options: { mainLoopModel: 'test' } },
      },
    })
    expect(out.result).toBeNull()
    expect(out.failure).toEqual({ reason: 'aborted' })
    // densable oaa: aborted must not annotate PTL
    const msg = ptlAssistant()
    expect(annotatePromptTooLongWithCompactFailure(msg, out.failure)).toBe(msg)
  })

  test('generic throw → error+detail (Ysa path)', async () => {
    compactImpl = async () => {
      throw new Error('summarize timed out')
    }
    const out = await tryReactiveCompact({
      hasAttempted: false,
      querySource: 'repl_main_thread',
      aborted: false,
      messages: [],
      cacheSafeParams: {
        toolUseContext: { options: { mainLoopModel: 'test' } },
      },
    })
    expect(out.result).toBeNull()
    expect(out.failure?.reason).toBe('error')
    expect(out.failure?.detail).toContain('summarize timed out')
    const annotated = annotatePromptTooLongWithCompactFailure(
      ptlAssistant(),
      out.failure,
    )
    const text = (annotated.message.content as { text: string }[])[0]?.text
    expect(text).toContain('automatic compaction failed')
  })
})
