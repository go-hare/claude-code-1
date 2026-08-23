import { afterEach, describe, expect, test } from 'bun:test'
import { CONTEXT_1M_BETA_HEADER } from '../../constants/betas.js'
import {
  _resetForTesting,
  attachAnalyticsSink,
} from '../../services/analytics/index.js'
import {
  getRequestLimitMediaKeepCount,
  HWT_KEEP_COUNT,
  HWT_KEEP_COUNT_1M,
  isEvictableMediaBlock,
  isSubagentCacheEvictEnabled,
  stripStoredMediaForRequestLimit,
} from '../subagentCacheEvict.js'

describe('isSubagentCacheEvictEnabled', () => {
  test('prereq false', () => {
    expect(
      isSubagentCacheEvictEnabled({
        prerequisitesMet: false,
        env: { CLAUDE_CODE_SUBAGENT_CACHE_EVICT: '1' },
      }),
    ).toBe(false)
  })
  test('env forces on', () => {
    expect(
      isSubagentCacheEvictEnabled({
        prerequisitesMet: true,
        env: { CLAUDE_CODE_SUBAGENT_CACHE_EVICT: '1' },
        gbValue: false,
      }),
    ).toBe(true)
  })
  test('gb when env unset', () => {
    expect(
      isSubagentCacheEvictEnabled({
        prerequisitesMet: true,
        env: {},
        gbValue: true,
      }),
    ).toBe(true)
  })
})

describe('isEvictableMediaBlock', () => {
  test('image/document only', () => {
    expect(isEvictableMediaBlock({ type: 'image' })).toBe(true)
    expect(isEvictableMediaBlock({ type: 'document' })).toBe(true)
    expect(isEvictableMediaBlock({ type: 'text' })).toBe(false)
  })
})

function img(data: string) {
  return { type: 'image', source: { type: 'base64', data } }
}

function msg(content: unknown[]) {
  return { message: { content } }
}

describe('getRequestLimitMediaKeepCount', () => {
  test('1m beta / sonnet-4 family → 600; haiku stays 100', () => {
    expect(getRequestLimitMediaKeepCount('claude-haiku-4-5', [])).toBe(
      HWT_KEEP_COUNT,
    )
    expect(
      getRequestLimitMediaKeepCount('claude-haiku-4-5', [
        CONTEXT_1M_BETA_HEADER,
      ]),
    ).toBe(HWT_KEEP_COUNT_1M)
    expect(getRequestLimitMediaKeepCount('claude-sonnet-4-6', [])).toBe(
      HWT_KEEP_COUNT_1M,
    )
  })
})

describe('stripStoredMediaForRequestLimit (HWT)', () => {
  afterEach(() => {
    _resetForTesting()
  })

  test('keep-count leaves recent media; nested tool_result first; immutable', () => {
    const nested = img('NESTED')
    const older = img('OLDER')
    const recent = img('RECENT')
    const messages = [
      msg([
        { type: 'text', text: 'a' },
        older,
        {
          type: 'tool_result',
          content: [nested, { type: 'text', text: 'inner' }],
        },
        recent,
      ]),
    ]
    const before = JSON.stringify(messages)
    const next = stripStoredMediaForRequestLimit(messages, 1)
    expect(JSON.stringify(messages)).toBe(before)
    const content = next[0]!.message.content as Array<{
      type: string
      source?: { data?: string }
      content?: unknown
      text?: string
    }>
    // keepCount=1, 3 media → remainingKeep=2; nested-first then top-level.
    const images = content.filter(b => b.type === 'image')
    expect(images).toHaveLength(1)
    expect(images[0]?.source?.data).toBe('RECENT')
    const tr = content.find(b => b.type === 'tool_result')
    expect(tr?.content).toEqual([{ type: 'text', text: 'inner' }])
  })

  test('empty message content after strip → placeholder', () => {
    const messages = [msg([img('ONLY')])]
    const next = stripStoredMediaForRequestLimit(messages, 0)
    expect(next[0]!.message.content).toEqual([
      { type: 'text', text: '[media removed: request limit]' },
    ])
  })

  test('empty nested tool_result stays empty array (no nested placeholder)', () => {
    const messages = [msg([{ type: 'tool_result', content: [img('NEST')] }])]
    const next = stripStoredMediaForRequestLimit(messages, 0)
    const tr = (next[0]!.message.content as Array<{ content?: unknown }>)[0]
    expect(tr?.content).toEqual([])
  })

  test('oOl throws when image source is missing (SEA e.source.type)', () => {
    expect(() =>
      stripStoredMediaForRequestLimit([msg([{ type: 'image' }])], 0),
    ).toThrow()
  })

  test('byte cap strips when keep-count already satisfied', () => {
    const small = img('x')
    const big = img('yyyyyyyyyy')
    const messages = [msg([small, big])]
    // keepCount=2 so remainingKeep<=0; byteLimit=1 → overflow, strip m>0
    const next = stripStoredMediaForRequestLimit(messages, 2, 0, 1, 0)
    const content = next[0]!.message.content as Array<{ type: string }>
    expect(content.some(b => b.type === 'image')).toBe(false)
  })

  test('no-op when under keep-count and no byte overflow (same array)', () => {
    const messages = [msg([img('A'), { type: 'text', text: 'keep' }])]
    const next = stripStoredMediaForRequestLimit(messages, 5)
    expect(next).toBe(messages)
  })

  test('tengu_media_byte_cap_stripped only on byte overflow, not keep-count-only', () => {
    const events: Array<{ name: string; meta: Record<string, unknown> }> = []
    _resetForTesting()
    attachAnalyticsSink({
      logEvent(name, metadata) {
        events.push({ name, meta: metadata as Record<string, unknown> })
      },
      async logEventAsync() {},
    })
    stripStoredMediaForRequestLimit([msg([img('ONLY')])], 0)
    expect(events.some(e => e.name === 'tengu_media_byte_cap_stripped')).toBe(
      false,
    )

    stripStoredMediaForRequestLimit([msg([img('yyyyyyyyyy')])], 2, 0, 1, 0)
    expect(events.some(e => e.name === 'tengu_media_byte_cap_stripped')).toBe(
      true,
    )
  })
})
