import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('prSubscriptions store', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
    delete process.env.CLAUDE_CONFIG_DIR
  })

  test('upsert, find, remove round-trip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-subs-'))
    dirs.push(dir)
    process.env.CLAUDE_CONFIG_DIR = dir

    const {
      upsertPRSubscription,
      findPRSubscription,
      removePRSubscription,
      readPRSubscriptions,
      prSubscriptionId,
    } = await import(`../prSubscriptions.js?t=${Date.now()}`)

    const { subscription, created } = upsertPRSubscription({
      repo: 'acme/widget',
      prNumber: 42,
      events: ['comment', 'ci'],
    })
    expect(created).toBe(true)
    expect(subscription.repo).toBe('acme/widget')
    expect(prSubscriptionId(subscription)).toBe('local:acme/widget#42')

    expect(findPRSubscription('acme/widget', 42)?.prNumber).toBe(42)
    expect(readPRSubscriptions()).toHaveLength(1)

    const again = upsertPRSubscription({
      repo: 'acme/widget',
      prNumber: 42,
    })
    expect(again.created).toBe(false)
    expect(readPRSubscriptions()).toHaveLength(1)

    expect(removePRSubscription('acme/widget', 42)).toBe(true)
    expect(readPRSubscriptions()).toHaveLength(0)
    expect(removePRSubscription('acme/widget', 42)).toBe(false)
  })
})
