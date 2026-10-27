import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../Ratchet.tsx'), 'utf8')

describe('densable 2.1.289 YV Ratchet', () => {
  test('offscreen visible growth parks in pendingRef, does not setState', () => {
    expect(src).toContain("lock?: 'always' | 'offscreen'")
    expect(src).toContain('restartKey?: unknown')
    expect(src).toContain("lock === 'always' &&")
    expect(src).toContain('snap.restartKey !== restartKey')
    expect(src).toContain("lock === 'always' || !isVisible")
    expect(src).toContain('pendingRef.current = h')
    expect(src).toContain("lock === 'offscreen' &&")
    expect(src).toContain('!engaged')
    expect(src).toContain('h >= snap.minHeight')
    expect(src).toContain('recompute()')
    expect(src).toContain('minHeight={engaged ? floor : undefined}')
  })
})

describe('densable 2.1.289 QV viewport', () => {
  test('null ref restores isVisible; Ze waits for scrollTopRendered', () => {
    const hook = readFileSync(
      join(import.meta.dir, '../../hooks/use-terminal-viewport.ts'),
      'utf8',
    )
    expect(hook).toContain('el === null && !entryRef.current.isVisible')
    expect(hook).toContain('{ isVisible: true }')
    expect(hook).toContain(
      "overflowY === 'scroll' && parent.scrollTopRendered === undefined",
    )
  })
})
