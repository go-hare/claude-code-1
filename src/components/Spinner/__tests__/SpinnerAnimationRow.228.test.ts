/**
 * densable 2.1.228 #15 — compact progress: retry countdown takes precedence
 * over compaction progress bar (early-return before ProgressBar branch).
 *
 * Product structure is pre-228 SpinnerMsn; this locks the ordering so a
 * refactor cannot put compact bar ahead of retryStatus again.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(
  join(import.meta.dir, '../SpinnerAnimationRow.tsx'),
  'utf8',
)

describe('densable 2.1.228 #15 SpinnerAnimationRow retry vs compact', () => {
  test('retryStatus early-return appears before compact ProgressBar branch', () => {
    const retryIf = src.indexOf('if (retryStatus)')
    const compactIf = src.indexOf('if (!isCompacting)')
    const progressBar = src.indexOf('<ProgressBar')
    const retryingIn = src.indexOf('Retrying in')

    expect(retryIf).toBeGreaterThan(-1)
    expect(compactIf).toBeGreaterThan(-1)
    expect(progressBar).toBeGreaterThan(-1)
    expect(retryingIn).toBeGreaterThan(-1)

    // densable Msn: retry replaces whole row (return) before compact bar path
    expect(retryIf).toBeLessThan(compactIf)
    expect(retryIf).toBeLessThan(progressBar)
    expect(retryingIn).toBeLessThan(progressBar)
  })

  test('stalled retry copy and error retry copy both present', () => {
    expect(src).toContain("retryStatus.kind === 'stalled'")
    expect(src).toContain('will retry in')
    expect(src).toContain('check your network')
    expect(src).toContain('Retrying in')
    expect(src).toContain(
      'attempt ${retryStatus.attempt}/${retryStatus.maxRetries}',
    )
  })

  test('compactProgressActiveRef still drives ProgressBar when no retry', () => {
    expect(src).toContain('compactProgressActiveRef')
    expect(src).toContain('isCompacting')
    // only render bar when compacting
    expect(src).toMatch(/if\s*\(\s*!isCompacting\s*\)\s*return\s+spinnerRow/)
  })
})
