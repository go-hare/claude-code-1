/**
 * densable 2.1.289 jAr @194348914 — comment thread opening preview.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  commentPreviewExcerpt,
  commentThreadCacheKey,
  commentThreadOpeningTarget,
  formatCommentTargetAsk,
  formatCommentThreadAsk,
  jAr,
  resetArtifactAutoReactStoreForTests,
  un,
} from '../index.js'
import type { ArtifactThread } from '../commentRead.js'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
})

const THREAD: ArtifactThread = {
  id: 'thr_open',
  comments: [
    {
      id: 'c1',
      account: 'me-uuid',
      role: 'member',
      text: 'Please fix the title',
    },
    { id: 'c2', account: 'other', role: 'member', text: 'follow-up' },
  ],
  resolved: false,
}

describe('densable 2.1.289 jAr thread preview', () => {
  test('cache key and excerpt match gold _ / A', () => {
    expect(commentThreadCacheKey('slug', 'thr_1')).toBe('slug/thr_1')
    expect(commentPreviewExcerpt('  Hello\n"world"\t  ')).toBe("Hello 'world'")
    const long = 'x'.repeat(200)
    const cut = commentPreviewExcerpt(long)
    expect(cut.endsWith('\u2026')).toBe(true)
    expect([...cut].length).toBe(121)
  })

  test('E() opening target + WAr / eAo ask copy', () => {
    const own = commentThreadOpeningTarget([THREAD], 'thr_open', {
      account: 'me-uuid',
    })
    expect(own?.display.by).toBe('user')
    expect(own?.display.excerpt).toBe('Please fix the title')
    expect(own?.display.replies).toBe(1)
    expect(formatCommentTargetAsk(own!)).toBe(
      'your comment "Please fix the title"',
    )
    expect(formatCommentThreadAsk(own!)).toBe('your comment thread')

    const viewer = commentThreadOpeningTarget([THREAD], 'thr_open', {
      account: 'someone-else',
      access: 'editor',
    })
    expect(viewer?.display.by).toBe('viewer')
    expect(formatCommentTargetAsk(viewer!)).toBe(
      'an editor\'s comment "Please fix the title"',
    )
    expect(commentThreadOpeningTarget([THREAD], 'missing')).toBeUndefined()
  })

  test('hosts commentTargets on the store and exports jAr', () => {
    expect(un().commentTargets.size).toBe(0)
    un().commentTargets.set('slug/thr', {
      target: {
        display: {
          thread_id: 'thr',
          by: 'unknown',
          excerpt: 'hi',
          replies: 0,
          resolved: false,
        },
      },
      toolUseId: 'tu-1',
    })
    expect(un().commentTargets.get('slug/thr')?.toolUseId).toBe('tu-1')
    expect(typeof jAr).toBe('function')
  })
})
