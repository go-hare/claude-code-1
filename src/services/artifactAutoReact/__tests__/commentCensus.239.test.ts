import { afterEach, describe, expect, test } from 'bun:test'
import type { ArtifactThread } from '../commentRead.js'
import {
  commentCensusStatusFields,
  formatCommentCensusStatusClause,
  markCommentsReadForCensus,
  recountCommentCensus,
} from '../commentCensus.js'
import { formatArtifactWatchStatus } from '../watchActions.js'
import {
  clearCommentCensus,
  getCommentCensus,
  getCommentCensusGeneration,
  markCommentCensusDirty,
  M3i,
} from '../supervisors.js'
import { resetArtifactAutoReactStoreForTests } from '../store.js'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
})

const SLUG = '11111111-1111-1111-1111-111111111111'

function thread(comments: ArtifactThread['comments']): ArtifactThread {
  return { id: 't1', comments }
}

describe('densable 2.1.239 M3i comment census', () => {
  test('M3i writes sinceMs / generation and dirties on refresh', () => {
    M3i(SLUG, 1000)
    const first = getCommentCensus(SLUG)
    expect(first).toMatchObject({
      readIds: null,
      sinceMs: 1000,
      dirty: false,
      generation: 1,
      plain: 0,
      awaiting: 0,
      partial: false,
    })
    M3i(SLUG, 2000)
    const second = getCommentCensus(SLUG)
    expect(second?.sinceMs).toBe(1000)
    expect(second?.dirty).toBe(true)
    expect(second?.generation).toBe(2)
  })

  test('aTm / Bso / cTm', () => {
    M3i('slug-b', 1)
    expect(getCommentCensusGeneration('slug-b')).toBe(1)
    markCommentCensusDirty('slug-b')
    expect(getCommentCensus('slug-b')?.dirty).toBe(true)
    expect(getCommentCensusGeneration('slug-b')).toBe(2)
    clearCommentCensus('slug-b')
    expect(getCommentCensus('slug-b')).toBeUndefined()
  })
})

describe('densable 2.1.239 jso / n1w / r1w', () => {
  test('jso counts unread plain human comments after sinceMs', () => {
    M3i(SLUG, Date.parse('2026-09-01T12:00:00.000Z'))
    const gen = getCommentCensus(SLUG)?.generation
    recountCommentCensus(
      SLUG,
      [
        thread([
          {
            id: 'c1',
            account: 'ada',
            role: 'human',
            text: 'hi',
            createdAt: '2026-09-01T12:10:00.000Z',
          },
        ]),
      ],
      gen,
    )
    expect(getCommentCensus(SLUG)?.plain).toBe(1)
    expect(getCommentCensus(SLUG)?.dirty).toBe(false)
    expect(commentCensusStatusFields(SLUG)).toEqual({
      unread_plain_comments: 1,
    })
  })

  test('lTm readIds suppress a second jso count', () => {
    M3i(SLUG, Date.parse('2026-09-01T12:00:00.000Z'))
    const threads = [
      thread([
        {
          id: 'c1',
          account: 'ada',
          role: 'human',
          text: 'hi',
          createdAt: '2026-09-01T12:10:00.000Z',
        },
      ]),
    ]
    markCommentsReadForCensus(SLUG, threads, threads)
    expect(getCommentCensus(SLUG)?.plain).toBe(0)
    expect(getCommentCensus(SLUG)?.readIds?.has('c1')).toBe(true)
  })

  test('n1w dirty is comments_uncounted', () => {
    M3i(SLUG, 1)
    M3i(SLUG, 2)
    expect(commentCensusStatusFields(SLUG)).toEqual({
      comments_uncounted: true,
    })
  })

  test('r1w official clauses', () => {
    expect(formatCommentCensusStatusClause({ comments_uncounted: true })).toBe(
      '; its comment count is not refreshed yet \u2014 action "comments" shows them',
    )
    expect(
      formatCommentCensusStatusClause({ unread_plain_comments: 2 }),
    ).toContain('2 plain comments (not sent to Claude) you have not read')
    expect(
      formatCommentCensusStatusClause({ summons_awaiting_reply: 1 }),
    ).toContain('1 sent to Claude still awaiting a reply')
    expect(formatCommentCensusStatusClause({})).toBe('')
  })

  test('status prose appends r1w and empty-filter sentence', () => {
    expect(
      formatArtifactWatchStatus({
        watches: [],
        filter_url: 'https://claude.ai/code/artifact/x',
      }),
    ).toBe(
      'No artifact watch on https://claude.ai/code/artifact/x in this session.',
    )
    const text = formatArtifactWatchStatus({
      watches: [
        {
          url: 'https://claude.ai/code/artifact/x',
          connected: true,
          since: '2026-09-01T12:00:00.000Z',
          unread_plain_comments: 1,
        },
      ],
    })
    expect(text).toContain('1 artifact watch in this session:')
    expect(text).toContain('connected, since 2026-09-01T12:00:00.000Z')
    expect(text).toContain(
      '1 plain comment (not sent to Claude) you have not read',
    )
  })
})
