/**
 * densable 2.1.289 — /code-review --max-findings <n>|all|default
 */
import { describe, expect, test } from 'bun:test'
import {
  formatCodeReviewMaxFindingsNotice,
  parseCodeReviewArgs,
  parseCodeReviewMaxFindingsFlag,
  resolveCodeReviewMaxFindings,
} from '../codeReview.js'

describe('densable 2.1.289 code-review --max-findings', () => {
  test('parseCodeReviewMaxFindingsFlag reads n / all / default', () => {
    expect(parseCodeReviewMaxFindingsFlag('--max-findings 12')).toEqual({
      rest: '',
      maxFindings: 12,
      maxFindingsIgnored: false,
    })
    expect(parseCodeReviewMaxFindingsFlag('high --max-findings=all')).toEqual({
      rest: 'high',
      maxFindings: 'all',
      maxFindingsIgnored: false,
    })
    expect(
      parseCodeReviewMaxFindingsFlag('--max-findings default src/a.ts'),
    ).toEqual({
      rest: 'src/a.ts',
      maxFindings: 'default',
      maxFindingsIgnored: false,
    })
  })

  test('invalid --max-findings is ignored', () => {
    expect(parseCodeReviewMaxFindingsFlag('--max-findings 0')).toEqual({
      rest: '',
      maxFindingsIgnored: true,
    })
    expect(parseCodeReviewMaxFindingsFlag('--max-findings')).toEqual({
      rest: '',
      maxFindingsIgnored: true,
    })
    expect(parseCodeReviewMaxFindingsFlag('--max-findings nope')).toEqual({
      rest: '',
      maxFindingsIgnored: true,
    })
  })

  test('parseCodeReviewArgs keeps effort parse with max-findings mixed in', () => {
    const r = parseCodeReviewArgs('high --max-findings 7 src/foo.ts', 'low')
    expect(r.level).toBe('high')
    expect(r.explicit).toBe('high')
    expect(r.target).toBe('src/foo.ts')
    expect(r.maxFindings).toBe(7)
    expect(r.maxFindingsIgnored).toBe(false)
  })

  test('resolveCodeReviewMaxFindings reuses last when flag omitted', () => {
    expect(
      resolveCodeReviewMaxFindings({
        maxFindingsIgnored: false,
        lastMaxFindings: 9,
      }),
    ).toEqual({ asked: 9, stated: 9, reused: true, ignored: false })
    expect(
      resolveCodeReviewMaxFindings({
        maxFindings: 'default',
        maxFindingsIgnored: false,
        lastMaxFindings: 9,
      }),
    ).toEqual({
      asked: undefined,
      stated: undefined,
      reused: false,
      ignored: false,
    })
  })

  test('formatCodeReviewMaxFindingsNotice covers reuse / ignored', () => {
    expect(
      formatCodeReviewMaxFindingsNotice({
        asked: 3,
        reused: true,
        ignored: false,
      }),
    ).toContain('--max-findings 3')
    expect(
      formatCodeReviewMaxFindingsNotice({
        asked: undefined,
        reused: false,
        ignored: true,
      }),
    ).toContain('was ignored')
  })
})
