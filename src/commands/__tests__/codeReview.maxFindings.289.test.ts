/**
 * densable 2.1.289 — /code-review --max-findings <n>|all|default
 */
import { describe, expect, test } from 'bun:test'
import {
  codeReview,
  formatCodeReviewMaxFindingsNotice,
  isGitLabCodeReviewTarget,
  parseCodeReviewArgs,
  parseCodeReviewMaxFindingsFlag,
  resolveCodeReviewMaxFindings,
  wrapCodeReviewPostIgnored,
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

  test('o5-bmin and ReportFindings clamp all and values above 32', () => {
    expect(
      resolveCodeReviewMaxFindings({
        maxFindings: 'all',
        maxFindingsIgnored: false,
        cell: 'o5-bmin',
      }),
    ).toEqual({ asked: 'all', stated: 32, reused: false, ignored: false })
    expect(
      resolveCodeReviewMaxFindings({
        maxFindings: 40,
        maxFindingsIgnored: false,
        cell: 'low',
        usesReportFindings: true,
      }),
    ).toEqual({ asked: 40, stated: 32, reused: false, ignored: false })
  })

  test('low-sonnet5 states no maximum and does not reuse', () => {
    expect(
      resolveCodeReviewMaxFindings({
        maxFindings: 9,
        maxFindingsIgnored: false,
        cell: 'low-sonnet5',
        lastMaxFindings: 4,
      }),
    ).toEqual({ asked: 9, stated: undefined, reused: false, ignored: false })
    expect(
      resolveCodeReviewMaxFindings({
        maxFindingsIgnored: false,
        cell: 'low-sonnet5',
        lastMaxFindings: 4,
      }),
    ).toEqual({
      asked: undefined,
      stated: undefined,
      reused: false,
      ignored: false,
    })
  })

  test('--post and --no-post are not review targets', () => {
    expect(parseCodeReviewArgs('--post src/a.ts').target).toBe('src/a.ts')
    expect(parseCodeReviewArgs('--post src/a.ts').post).toBe(true)
    expect(parseCodeReviewArgs('high --no-post').target).toBe('')
    expect(parseCodeReviewArgs('high --no-post').noPost).toBe(true)
    expect(parseCodeReviewArgs('high --no-post').level).toBe('high')
  })

  test('wrapCodeReviewPostIgnored only when --post (not --no-post)', () => {
    const ignored = wrapCodeReviewPostIgnored('', {
      post: true,
      comment: false,
    })
    expect(ignored).toContain(
      'The typed `--post` applies only to the `/code-review ultra` cloud review and was ignored',
    )
    expect(ignored).toContain(
      'this local review will not post to GitHub; `--comment` is the flag that posts local findings as inline PR comments',
    )
    expect(ignored).toContain('Tell the user this in one short line.')
    expect(
      wrapCodeReviewPostIgnored('', { post: true, comment: true }),
    ).toContain(
      'when the target is a GitHub PR, your `--comment` is what posts the findings as inline PR comments',
    )
    expect(
      wrapCodeReviewPostIgnored('(No effort level given — reusing high.)\n', {
        post: false,
        comment: false,
      }),
    ).toBe('(No effort level given — reusing high.)\n')
    expect(wrapCodeReviewPostIgnored('', { post: false, comment: false })).toBe(
      '',
    )
    expect(
      wrapCodeReviewPostIgnored('', {
        post: true,
        comment: false,
        gitlabTarget: true,
      }),
    ).toContain(
      'this local review will not post to GitLab; `--comment` is the flag that posts local findings as a general MR note',
    )
  })

  test('isGitLabCodeReviewTarget matches gold oto / Tee', () => {
    expect(isGitLabCodeReviewTarget('!12')).toBe(true)
    expect(
      isGitLabCodeReviewTarget(
        'https://gitlab.com/group/proj/-/merge_requests/4',
      ),
    ).toBe(true)
    expect(isGitLabCodeReviewTarget('https://github.com/a/b/pull/1')).toBe(
      false,
    )
    expect(
      isGitLabCodeReviewTarget(
        'https://gitlab.corp.example/a/b/-/merge_requests/1',
      ),
    ).toBe(true)
  })

  test('getPromptForCommand wraps --post and not --no-post', async () => {
    const ctx = {
      options: {
        tools: [],
        commands: [],
        isSkillPreload: false,
        mainLoopModel: 'claude-opus-4-8',
      },
    } as never
    const withPost = await codeReview.getPromptForCommand(
      '--post src/a.ts',
      ctx,
    )
    expect(withPost[0]?.type).toBe('text')
    expect(
      withPost[0] && 'text' in withPost[0] ? withPost[0].text : '',
    ).toContain(
      'The typed `--post` applies only to the `/code-review ultra` cloud review and was ignored',
    )
    const noPost = await codeReview.getPromptForCommand(
      '--no-post src/a.ts',
      ctx,
    )
    expect(
      noPost[0] && 'text' in noPost[0] ? noPost[0].text : '',
    ).not.toContain('The typed `--post`')
  })

  test('formatCodeReviewMaxFindingsNotice covers reuse / ignored / first flag', () => {
    const reused = formatCodeReviewMaxFindingsNotice({
      asked: 3,
      stated: 3,
      reused: true,
      ignored: false,
    })
    expect(reused).toContain('the limit the user set last time')
    expect(reused).toContain('Open your report with one short line')
    expect(reused).not.toContain('--max-findings 3')
    expect(
      formatCodeReviewMaxFindingsNotice({
        asked: 3,
        stated: 3,
        reused: false,
        ignored: false,
      }),
    ).toBe('')
    expect(
      formatCodeReviewMaxFindingsNotice({
        asked: undefined,
        stated: undefined,
        reused: false,
        ignored: true,
      }),
    ).toContain('was ignored')
    expect(
      formatCodeReviewMaxFindingsNotice({
        asked: 9,
        stated: undefined,
        reused: false,
        ignored: false,
      }),
    ).toContain('low effort here has no maximum')
  })
})
