import { describe, expect, test } from 'bun:test'
import {
  deriveGitlabMrReviewState,
  isValidGitlabMrWebUrl,
} from '../ghPrStatus.js'

describe('ghPrStatus densable 2.1.234 (#3)', () => {
  test('lWb deriveGitlabMrReviewState: opened/draft/mergeable/closed', () => {
    expect(deriveGitlabMrReviewState('opened', false, 'mergeable')).toBe(
      'approved',
    )
    expect(deriveGitlabMrReviewState('opened', false, 'checking')).toBe(
      'pending',
    )
    expect(deriveGitlabMrReviewState('opened', false, undefined)).toBe(
      'pending',
    )
    expect(deriveGitlabMrReviewState('opened', true, 'mergeable')).toBe('draft')
    expect(deriveGitlabMrReviewState('merged', false, 'mergeable')).toBe(null)
    expect(deriveGitlabMrReviewState('closed', false, undefined)).toBe(null)
  })

  test('aWb isValidGitlabMrWebUrl: path + iid match + length', () => {
    expect(
      isValidGitlabMrWebUrl(
        'https://gitlab.com/group/project/-/merge_requests/42',
        42,
      ),
    ).toBe(true)
    expect(
      isValidGitlabMrWebUrl(
        'https://gitlab.example.com:8443/a/b/-/merge_requests/7',
        7,
      ),
    ).toBe(true)
    // iid mismatch
    expect(
      isValidGitlabMrWebUrl(
        'https://gitlab.com/group/project/-/merge_requests/42',
        41,
      ),
    ).toBe(false)
    // not MR path
    expect(
      isValidGitlabMrWebUrl('https://gitlab.com/group/project/-/issues/42', 42),
    ).toBe(false)
    // github PR URL
    expect(isValidGitlabMrWebUrl('https://github.com/o/r/pull/42', 42)).toBe(
      false,
    )
    // oversize
    expect(
      isValidGitlabMrWebUrl(
        `https://gitlab.com/g/p/-/merge_requests/1${'x'.repeat(2100)}`,
        1,
      ),
    ).toBe(false)
  })
})
