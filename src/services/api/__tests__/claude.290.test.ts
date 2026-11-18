import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { APIError } from '@anthropic-ai/sdk'
import {
  findRejectedBetaHeaders,
  isOutputBlockedByContentFilterError,
  isUnprocessableMediaError,
  OUTPUT_CONTENT_FILTERED_MESSAGE,
  UNPROCESSABLE_MEDIA_ERROR_MESSAGE,
} from '../errors.js'
import {
  clearSessionMediaItemCap,
  countStoredMediaItems,
  getSessionMediaItemCap,
  MEDIA_ITEM_LIMIT_STEPS,
  resolveCarriedEffortForModel,
  setSessionMediaItemCap,
} from '../claude.js'
import {
  clearRefusalFallbackModelLatch,
  resetStateForTests,
  setMainLoopModelOverride,
  setRefusalFallbackModelLatch,
} from '../../../bootstrap/state.js'

function makeApiError(status: number | undefined, message: string): APIError {
  return new APIError(status, { error: { message } }, message, new Headers())
}

describe('v2.1.290 #12 multi-beta and non-400 beta-header healing', () => {
  test('findRejectedBetaHeaders extracts multiple rejected betas from a single error', () => {
    const err = makeApiError(
      400,
      'Unexpected value(s) `beta-one-2025-01-01`, `beta-two-2025-02-02` for the `anthropic-beta` header',
    )
    const matches = findRejectedBetaHeaders(err, [
      'beta-one-2025-01-01',
      'beta-keep-2025-03-03',
      'beta-two-2025-02-02',
    ])
    expect(matches.map(m => m.header)).toEqual([
      'beta-one-2025-01-01',
      'beta-two-2025-02-02',
    ])
    expect(matches.every(m => m.exactMatch && !m.onlyMentioned)).toBe(true)
  })

  test('findRejectedBetaHeaders heals non-400 (e.g. 422) beta rejections', () => {
    const err = makeApiError(
      422,
      'Unexpected value(s) `beta-non400-2025-05-05` for the `anthropic_beta` header',
    )
    const matches = findRejectedBetaHeaders(err, ['beta-non400-2025-05-05'])
    expect(matches).toEqual([
      {
        header: 'beta-non400-2025-05-05',
        exactMatch: true,
        onlyMentioned: false,
      },
    ])
  })

  test('claude.ts wires findRejectedBetaHeaders and tengu_beta_400_healed', () => {
    const src = readFileSync(join(import.meta.dir, '../claude.ts'), 'utf8')
    expect(src).toContain('findRejectedBetaHeaders')
    expect(src).toContain('tengu_beta_400_healed')
    expect(src).toContain('retry:beta-rejected:')
  })
})

describe('v2.1.290 #13 mediaItemCap stripping', () => {
  test('isUnprocessableMediaError matches 400 and undefined status', () => {
    const err400 = makeApiError(400, UNPROCESSABLE_MEDIA_ERROR_MESSAGE)
    const errUndef = makeApiError(undefined, UNPROCESSABLE_MEDIA_ERROR_MESSAGE)
    const err500 = makeApiError(500, UNPROCESSABLE_MEDIA_ERROR_MESSAGE)
    expect(isUnprocessableMediaError(err400)).toBe(true)
    expect(isUnprocessableMediaError(errUndef)).toBe(true)
    expect(isUnprocessableMediaError(err500)).toBe(false)
    expect(
      isUnprocessableMediaError(new Error(UNPROCESSABLE_MEDIA_ERROR_MESSAGE)),
    ).toBe(false)
  })

  test('countStoredMediaItems counts top-level and tool_result media blocks', () => {
    const count = countStoredMediaItems([
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'a' },
            },
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: 'b',
                  },
                },
                { type: 'text', text: 'ok' },
              ],
            },
          ],
        },
      } as never,
    ])
    expect(count).toBe(2)
    expect(MEDIA_ITEM_LIMIT_STEPS).toEqual([510, 255, 127])
  })

  test('session mediaItemCap store tracks per-model limit', () => {
    clearSessionMediaItemCap('s1')
    setSessionMediaItemCap('s1', {
      model: 'claude-opus-4-6',
      limit: 255,
      gaveUp: false,
    })
    expect(getSessionMediaItemCap('s1', 'claude-opus-4-6')).toEqual({
      model: 'claude-opus-4-6',
      limit: 255,
      gaveUp: false,
    })
    expect(getSessionMediaItemCap('s1', 'claude-sonnet-4-6')).toBeUndefined()
    clearSessionMediaItemCap('s1')
  })
})

describe('v2.1.290 #14 outputFiltered streaming retry', () => {
  test('isOutputBlockedByContentFilterError unwraps originalError and checks status', () => {
    const err400 = makeApiError(400, OUTPUT_CONTENT_FILTERED_MESSAGE)
    const wrapped = Object.assign(new Error(OUTPUT_CONTENT_FILTERED_MESSAGE), {
      originalError: err400,
    })
    const err500 = makeApiError(500, OUTPUT_CONTENT_FILTERED_MESSAGE)
    expect(isOutputBlockedByContentFilterError(err400)).toBe(true)
    expect(isOutputBlockedByContentFilterError(wrapped)).toBe(true)
    expect(isOutputBlockedByContentFilterError(err500)).toBe(false)
  })

  test('claude.ts wires tengu_streaming_output_filter_retry and OutputFilteredStreamRetryError', () => {
    const src = readFileSync(join(import.meta.dir, '../claude.ts'), 'utf8')
    expect(src).toContain('tengu_streaming_output_filter_retry')
    expect(src).toContain('OutputFilteredStreamRetryError')
    expect(src).toContain('output_content_filtered')
  })
})

describe('v2.1.290 #36 carriedEffort resolution in claude.ts', () => {
  test('resolveCarriedEffortForModel reads loopEffort or latched carriedEffort', () => {
    resetStateForTests()
    expect(
      resolveCarriedEffortForModel(
        { loopEffort: 'high', continuesMainConversation: false },
        'claude-sonnet-4-6',
      ),
    ).toBe('high')

    setMainLoopModelOverride('claude-sonnet-4-6')
    setRefusalFallbackModelLatch({
      fallbackModel: 'claude-sonnet-4-6',
      previousOverride: 'claude-opus-4-6',
      carriedEffort: 'max',
    })
    expect(
      resolveCarriedEffortForModel(
        { continuesMainConversation: true },
        'claude-sonnet-4-6',
      ),
    ).toBe('max')
    expect(
      resolveCarriedEffortForModel(
        { continuesMainConversation: false },
        'claude-sonnet-4-6',
      ),
    ).toBeNull()
    clearRefusalFallbackModelLatch()
    resetStateForTests()
  })
})

describe('v2.1.290 #121 partial-messages abandoned_blocks message_stop', () => {
  test('claude.ts tracks envelope, apiMessageId, and abandonedBlocks on closeAbandonedStreamEnvelope', () => {
    const src = readFileSync(join(import.meta.dir, '../claude.ts'), 'utf8')
    expect(src).toContain('closeAbandonedStreamEnvelope')
    expect(src).toContain('abandonedBlocks')
    expect(src).toContain('fromBlockIndex')
    expect(src).toContain('apiMessageId')
    expect(src).toContain('SUPPRESS_ABANDONED_BLOCK_STOP_TYPES')
  })
})
