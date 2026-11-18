import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearPendingHistoryEntries,
  countHistoryForProject,
  getHistory,
  keepClearedDraftToHistory,
} from '../../history.js'
import {
  clearHeldClearedDraft,
  holdCleared,
  resetHeldClearedDraftForTests,
  restoreCleared,
} from '../clearedDraftHold.js'

describe('Official 2.1.292 #254 cleared draft history retention', () => {
  afterEach(() => {
    resetHeldClearedDraftForTests()
    clearPendingHistoryEntries()
  })

  test('clearHeldClearedDraft flushes Ctrl+C cleared draft into in-memory clearedDrafts history', async () => {
    holdCleared({
      text: 'draft before slash command',
      mode: 'prompt',
      pastedContents: {},
    })

    // Simulate outside clear (e.g. slash command or sent message)
    clearHeldClearedDraft()
    expect(restoreCleared('')).toBeNull()

    const entries: string[] = []
    for await (const entry of getHistory({ withClearedDrafts: true })) {
      entries.push(entry.display)
      if (entries.length >= 5) break
    }
    expect(entries).toContain('draft before slash command')
  })

  test('bash mode cleared draft is prefixed with ! in clearedDrafts history', async () => {
    holdCleared({
      text: 'ls -la',
      mode: 'bash',
      pastedContents: {},
    })
    clearHeldClearedDraft()

    const entries: string[] = []
    for await (const entry of getHistory({ withClearedDrafts: true })) {
      entries.push(entry.display)
      if (entries.length >= 5) break
    }
    expect(entries).toContain('!ls -la')
  })

  test('keepClearedDraftToHistory deduplicates identical drafts and updates countHistoryForProject', async () => {
    const baseCount = (await countHistoryForProject()) ?? 0
    keepClearedDraftToHistory({
      display: 'unique-draft-292',
      pastedContents: {},
    })
    keepClearedDraftToHistory({
      display: 'unique-draft-292',
      pastedContents: {},
    })
    const afterCount = (await countHistoryForProject()) ?? 0
    expect(afterCount).toBe(baseCount + 1)
  })
})
