import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from '../../../types/message.js'
import { applyRemainingMessageStoreAction } from '../messageStore.js'

function msg(uuid: string, type: Message['type'] = 'user'): Message {
  return { type, uuid: uuid as UUID }
}

describe('applyRemainingMessageStoreAction (densable iCe remaining)', () => {
  test('replace-all returns the action messages', () => {
    const a = msg('a')
    const b = msg('b')
    expect(
      applyRemainingMessageStoreAction([a], {
        type: 'replace-all',
        messages: [b],
      }),
    ).toEqual([b])
  })

  test('remove-by-uuid splices the match and no-ops when missing', () => {
    const a = msg('a')
    const b = msg('b')
    const store = [a, b]
    expect(
      applyRemainingMessageStoreAction(store, {
        type: 'remove-by-uuid',
        uuid: a.uuid,
      }),
    ).toEqual([b])
    expect(store).toEqual([a, b])
    expect(
      applyRemainingMessageStoreAction(store, {
        type: 'remove-by-uuid',
        uuid: 'missing' as UUID,
      }),
    ).toBe(store)
  })

  test('replace-by-uuid uses with() or appends when missing', () => {
    const a = msg('a')
    const b = msg('b')
    const a2 = msg('a')
    expect(
      applyRemainingMessageStoreAction([a, b], {
        type: 'replace-by-uuid',
        uuid: a.uuid,
        message: a2,
      }),
    ).toEqual([a2, b])
    expect(
      applyRemainingMessageStoreAction([a], {
        type: 'replace-by-uuid',
        uuid: b.uuid,
        message: b,
      }),
    ).toEqual([a, b])
  })

  test('insert-after-uuid splices after the match; empty or missing is no-op', () => {
    const a = msg('a')
    const b = msg('b')
    const c = msg('c')
    const store = [a, c]
    expect(
      applyRemainingMessageStoreAction(store, {
        type: 'insert-after-uuid',
        uuid: a.uuid,
        messages: [b],
      }),
    ).toEqual([a, b, c])
    expect(store).toEqual([a, c])
    expect(
      applyRemainingMessageStoreAction(store, {
        type: 'insert-after-uuid',
        uuid: a.uuid,
        messages: [],
      }),
    ).toBe(store)
    expect(
      applyRemainingMessageStoreAction(store, {
        type: 'insert-after-uuid',
        uuid: 'missing' as UUID,
        messages: [b],
      }),
    ).toBe(store)
  })

  test('remove-uuids-and-append filters then appends', () => {
    const a = msg('a')
    const b = msg('b')
    const c = msg('c')
    expect(
      applyRemainingMessageStoreAction([a, b], {
        type: 'remove-uuids-and-append',
        excludeUuids: new Set([a.uuid]),
        message: c,
      }),
    ).toEqual([b, c])
  })

  test('update delegates to updater', () => {
    const a = msg('a')
    const b = msg('b')
    expect(
      applyRemainingMessageStoreAction([a], {
        type: 'update',
        updater: e => [...e, b],
      }),
    ).toEqual([a, b])
  })
})
