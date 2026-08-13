/**
 * densable 2.1.229 #6 — long stream double-print / disappear.
 * Gold: mfT incremental itemKeys with `#N` suffix on sibling collisions.
 */
import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

import type { RenderableMessage } from '../../types/message.js'
import {
  buildVirtualItemKeys,
  createVirtualItemKeyCache,
} from '../VirtualMessageList.js'

function msg(
  uuid: string,
  type: 'user' | 'assistant' = 'assistant',
): RenderableMessage {
  return {
    type,
    uuid,
    // minimal shape used by shortMsgType / itemKey
    message: { content: [{ type: 'text', text: 'x' }] },
  } as unknown as RenderableMessage
}

const itemKey = (m: RenderableMessage) => `${m.uuid}-conv`

describe('densable 2.1.229 #6 buildVirtualItemKeys (mfT)', () => {
  test('first occurrence keeps bare key; later siblings get #1, #2', () => {
    const cache = createVirtualItemKeyCache()
    // Same uuid → same base key (upstream uuid-dup)
    const messages = [msg('u1'), msg('u1'), msg('u1')]
    const keys = buildVirtualItemKeys(messages, itemKey, cache)
    expect(keys).toEqual(['u1-conv', 'u1-conv#1', 'u1-conv#2'])
  })

  test('distinct uuids keep distinct bare keys', () => {
    const cache = createVirtualItemKeyCache()
    const messages = [msg('a'), msg('b'), msg('c')]
    expect(buildVirtualItemKeys(messages, itemKey, cache)).toEqual([
      'a-conv',
      'b-conv',
      'c-conv',
    ])
  })

  test('append-only when uuid prefix matches (streaming growth)', () => {
    const cache = createVirtualItemKeyCache()
    const m1 = [msg('a'), msg('b')]
    const k1 = buildVirtualItemKeys(m1, itemKey, cache)
    expect(k1).toEqual(['a-conv', 'b-conv'])
    // mutate same cache — densable appends without rebuild
    const m2 = [msg('a'), msg('b'), msg('c')]
    const k2 = buildVirtualItemKeys(m2, itemKey, cache)
    expect(k2).toEqual(['a-conv', 'b-conv', 'c-conv'])
    // same array identity for keys buffer after append of third
    expect(k2).toBe(cache.keys)
  })

  test('rebuild when uuid prefix chain breaks (compaction-style)', () => {
    const cache = createVirtualItemKeyCache()
    buildVirtualItemKeys([msg('a'), msg('b'), msg('c')], itemKey, cache)
    // replace middle/end — prefix a matches then breaks at index 1
    const keys = buildVirtualItemKeys(
      [msg('a'), msg('x'), msg('y')],
      itemKey,
      cache,
    )
    expect(keys).toEqual(['a-conv', 'x-conv', 'y-conv'])
  })

  test('rebuild when messages shrink', () => {
    const cache = createVirtualItemKeyCache()
    buildVirtualItemKeys([msg('a'), msg('b'), msg('c')], itemKey, cache)
    const keys = buildVirtualItemKeys([msg('a')], itemKey, cache)
    expect(keys).toEqual(['a-conv'])
  })

  test('rebuild when itemKey function identity changes', () => {
    const cache = createVirtualItemKeyCache()
    const k1 = (m: RenderableMessage) => m.uuid
    const k2 = (m: RenderableMessage) => `id:${m.uuid}`
    buildVirtualItemKeys([msg('a')], k1, cache)
    const keys = buildVirtualItemKeys([msg('a'), msg('b')], k2, cache)
    expect(keys).toEqual(['id:a', 'id:b'])
  })

  test('dup suffixes survive across append of more dups', () => {
    const cache = createVirtualItemKeyCache()
    buildVirtualItemKeys([msg('u'), msg('u')], itemKey, cache)
    const keys = buildVirtualItemKeys(
      [msg('u'), msg('u'), msg('u')],
      itemKey,
      cache,
    )
    expect(keys).toEqual(['u-conv', 'u-conv#1', 'u-conv#2'])
  })
})
