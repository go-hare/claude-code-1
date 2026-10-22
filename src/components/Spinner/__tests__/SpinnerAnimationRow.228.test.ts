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
  test('retryStatus early-return replaces the row; compact has no ProgressBar', () => {
    const retryIf = src.indexOf('if (retryStatus)')
    const retryingIn = src.indexOf('Retrying in')

    expect(retryIf).toBeGreaterThan(-1)
    expect(retryingIn).toBeGreaterThan(-1)
    expect(src).not.toContain('<ProgressBar')
    expect(src).toContain('compactingStartTime')
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

  test('compact elapsed uses compactingStartTime and does not draw a bar', () => {
    expect(src).toContain('compactProgressActiveRef')
    expect(src).toContain('isCompacting')
    expect(src).toContain('compactingStartTime')
    expect(src).not.toContain('ProgressBar')
  })
})
