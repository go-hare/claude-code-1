import { describe, expect, test } from 'bun:test'
import {
  createPromptSubmitEntries,
  getPromptSubmitLatch,
  registerPromptSubmitEntry,
} from '../promptSubmitEntries.js'

describe('densable 2.1.289 Cpr prompt.submit entries', () => {
  test('getPromptSubmitLatch is unset when no session-start is in flight', () => {
    const latch = getPromptSubmitLatch()
    if (latch !== undefined) return
    expect(latch).toBeUndefined()
  })

  test('handedOff dispose resolves the registered waiter', async () => {
    const entries = createPromptSubmitEntries()
    const waiter = registerPromptSubmitEntry(entries, [
      { type: 'user', uuid: 'u1', promptSource: 'typed' },
    ])
    entries.handedOff()
    entries[Symbol.dispose]()
    await expect(waiter).resolves.toBeUndefined()
  })

  test('dispose without handedOff rejects', async () => {
    const entries = createPromptSubmitEntries()
    const waiter = registerPromptSubmitEntry(entries, [
      { type: 'user', uuid: 'u2' },
    ])
    entries[Symbol.dispose]()
    await expect(waiter).rejects.toThrow(
      'prompt.submit: the prompt did not enter the session',
    )
  })

  test('registerPromptSubmitEntry with no user uuid is a resolved no-op', async () => {
    const entries = createPromptSubmitEntries()
    await expect(
      registerPromptSubmitEntry(entries, [{ type: 'assistant' }]),
    ).resolves.toBeUndefined()
    entries[Symbol.dispose]()
  })
})
