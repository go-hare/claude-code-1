import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearPendingHistoryEntries,
  getHistory,
  removeLastFromHistory,
} from '../../history.js'
import {
  enqueue,
  popAllEditable,
  resetCommandQueue,
} from '../messageQueueManager.js'

describe('Official 2.1.295 #424 queued message pulled back into prompt stays in history', () => {
  afterEach(() => {
    resetCommandQueue()
    clearPendingHistoryEntries()
  })

  test('popAllEditable records pulled-back queued messages in history with armUndo: false', async () => {
    enqueue({
      value: 'queued message 424',
      mode: 'prompt',
    })

    const popped = popAllEditable('', 0)
    expect(popped?.text).toBe('queued message 424')

    // removeLastFromHistory must NOT undo it because armUndo was false
    removeLastFromHistory()

    const entries: string[] = []
    for await (const entry of getHistory()) {
      entries.push(entry.display)
      if (entries.length >= 5) break
    }
    expect(entries).toContain('queued message 424')
  })
})
