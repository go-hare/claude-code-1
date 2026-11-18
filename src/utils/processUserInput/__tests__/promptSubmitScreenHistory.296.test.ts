import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createArrivedLatch,
  PROMPT_CHECK_INTERRUPTED,
  raceArrived,
} from '../promptSubmit.js'

describe('2.1.295 #426 & 2.1.296 #504 prompt.submit screening & interrupt', () => {
  test('#504 raceArrived returns undefined when signal aborts before hook answers', async () => {
    const latch = createArrivedLatch('not-submitted')
    const ac = new AbortController()
    const neverAnswered = new Promise<void>(() => {})
    const racePromise = raceArrived(latch, neverAnswered, ac.signal)
    ac.abort()
    const raced = await racePromise
    expect(raced).toBeUndefined()
    expect(PROMPT_CHECK_INTERRUPTED).toBe(
      'the turn was interrupted while the prompt was checked',
    )
  })

  test('#504 raceArrived returns undefined immediately if signal already aborted', async () => {
    const latch = createArrivedLatch('not-submitted')
    const ac = new AbortController()
    ac.abort()
    const raced = await raceArrived(latch, Promise.resolve({}), ac.signal)
    expect(raced).toBeUndefined()
  })

  test('#426 handlePromptSubmit defers history flush until after prompt.submit hooks and skips dropped prompts', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../handlePromptSubmit.ts'),
      'utf8',
    )
    expect(src).toContain('const historyToFlush:')
    expect(src).toContain('flushQueuedHistoryEntries(historyToFlush)')
    expect(src).toContain('result.shouldQuery !== false')
  })
})
