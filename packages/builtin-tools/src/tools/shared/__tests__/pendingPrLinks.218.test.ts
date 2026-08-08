/**
 * densable 2.1.218 #16 — pending PR-link track + flush (But / DZr).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { getPendingPrLinks } from 'src/bootstrap/state.js'
import {
  flushPendingPrLinks,
  PENDING_PR_LINKS_FLUSH_MS,
  raceWithTimeout,
  trackPendingPrLink,
} from '../gitOperationTracking.js'

describe('densable 2.1.218 #16 pending PR links', () => {
  afterEach(() => {
    getPendingPrLinks().clear()
  })

  test('trackPendingPrLink adds and removes on settle', async () => {
    let resolve!: () => void
    const p = new Promise<void>(r => {
      resolve = r
    })
    trackPendingPrLink(p)
    expect(getPendingPrLinks().size).toBe(1)
    resolve()
    await p
    // finally microtask
    await Promise.resolve()
    await Promise.resolve()
    expect(getPendingPrLinks().size).toBe(0)
  })

  test('trackPendingPrLink swallows rejection', async () => {
    const p = Promise.reject(new Error('link fail'))
    trackPendingPrLink(p)
    await flushPendingPrLinks()
    expect(getPendingPrLinks().size).toBe(0)
  })

  test('flushPendingPrLinks no-ops on empty set', async () => {
    await flushPendingPrLinks()
    expect(getPendingPrLinks().size).toBe(0)
  })

  test('raceWithTimeout resolves on timeout without rejecting', async () => {
    const never = new Promise(() => {})
    const start = Date.now()
    await raceWithTimeout(never, 30)
    expect(Date.now() - start).toBeGreaterThanOrEqual(20)
  })

  test('PENDING_PR_LINKS_FLUSH_MS is densable xv_=2000', () => {
    expect(PENDING_PR_LINKS_FLUSH_MS).toBe(2000)
  })
})
