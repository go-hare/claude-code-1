/**
 * densable 2.1.223 #18/#19 — /review alias of /code-review + last effort reuse
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  formatCodeReviewEffortNotice,
  parseCodeReviewArgs,
} from '../codeReview.js'

const ROOT = join(import.meta.dir, '../../..')

describe('densable 2.1.223 code-review last effort + /review alias', () => {
  test('parseCodeReviewArgs reuses lastEffort when no level given', () => {
    const r = parseCodeReviewArgs('42', 'high')
    expect(r.level).toBe('high')
    expect(r.reusedLastEffort).toBe('high')
    expect(r.explicit).toBeUndefined()
    expect(r.target).toBe('42')
  })

  test('parseCodeReviewArgs defaults to medium with no lastEffort', () => {
    const r = parseCodeReviewArgs('')
    expect(r.level).toBe('medium')
    expect(r.reusedLastEffort).toBeUndefined()
  })

  test('parseCodeReviewArgs explicit level wins and sets explicit', () => {
    const r = parseCodeReviewArgs('xhigh src/foo.ts', 'low')
    expect(r.level).toBe('xhigh')
    expect(r.explicit).toBe('xhigh')
    expect(r.reusedLastEffort).toBeUndefined()
    expect(r.target).toBe('src/foo.ts')
  })

  test('parseCodeReviewArgs unrecognized effort-like reuses last when present', () => {
    const r = parseCodeReviewArgs('medim', 'high')
    expect(r.unrecognizedLevel).toBe('medim')
    expect(r.level).toBe('high')
    expect(r.reusedLastEffort).toBe('high')
  })

  test('formatCodeReviewEffortNotice for reuse / unrecognized', () => {
    expect(
      formatCodeReviewEffortNotice({
        level: 'high',
        reusedLastEffort: 'high',
      }),
    ).toContain('reusing high')
    expect(
      formatCodeReviewEffortNotice({
        level: 'high',
        reusedLastEffort: 'high',
        unrecognizedLevel: 'medim',
      }),
    ).toContain('Ignoring unrecognized effort "medim"')
    expect(formatCodeReviewEffortNotice({ level: 'medium' })).toBe('')
  })

  test('code-review command declares aliases:["review"]', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/codeReview.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(src).toContain("aliases: ['review']")
    expect(src).toContain('codeReviewLastEffort')
    expect(src).toContain('rememberCodeReviewEffort')
  })

  test('legacy review command is hidden (alias owns /review)', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/review.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(src).toContain('isHidden: true')
  })
})
