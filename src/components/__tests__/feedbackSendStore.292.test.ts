import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createFeedbackSendStore } from '../Feedback.js'

describe('2.1.292 #221 Feedback send store & done cancel skip', () => {
  test('createFeedbackSendStore transitions sending -> delivered and survives unmount/remount', () => {
    const store = createFeedbackSendStore('post')
    expect(store.getSnapshot()).toEqual({ status: 'none' })

    let notifications = 0
    const unsub = store.subscribe(() => {
      notifications++
    })

    store.start()
    expect(store.getSnapshot()).toEqual({ status: 'sending' })
    expect(notifications).toBe(1)

    store.deliver('fb-123')
    expect(store.getSnapshot()).toEqual({
      status: 'delivered',
      referenceId: 'fb-123',
    })
    // abandon() after delivered does not revert
    store.abandon()
    expect(store.getSnapshot()).toEqual({
      status: 'delivered',
      referenceId: 'fb-123',
    })
    unsub()
  })

  test('createFeedbackSendStore fail transitions unless already delivered/saved, and abandon reverts sending', () => {
    const store = createFeedbackSendStore('bundle')
    store.start()
    store.abandon()
    expect(store.getSnapshot()).toEqual({ status: 'none' })

    store.start()
    store.fail('network error', true)
    expect(store.getSnapshot()).toEqual({
      status: 'failed',
      reason: 'network error',
      final: true,
    })

    store.save('b-1', '/tmp/b.zip')
    store.fail('late error')
    expect(store.getSnapshot()).toEqual({
      status: 'saved',
      referenceId: 'b-1',
      bundlePath: '/tmp/b.zip',
    })
  })

  test('share mode store is a no-op and Feedback.tsx skips cancel message when done', () => {
    const shareStore = createFeedbackSendStore('share')
    shareStore.start()
    expect(shareStore.getSnapshot()).toEqual({ status: 'none' })

    const feedbackSrc = readFileSync(
      join(import.meta.dir, '../Feedback.tsx'),
      'utf8',
    )
    expect(feedbackSrc).toContain("onDone(undefined, { display: 'skip' })")

    const cmdSrc = readFileSync(
      join(import.meta.dir, '../../commands/feedback/feedback.tsx'),
      'utf8',
    )
    expect(cmdSrc).toContain('createFeedbackSendStore(K.kind)')
  })
})
