import { describe, expect, test } from 'bun:test'

/**
 * densable XT4/ZT4 Ask body has no minHeight on the options+footer /
 * review column. Local minContentHeight minHeight under tot.bottom
 * overflowY:hidden mid-clipped Ask when Explore Message-from returned
 * (options jammed into `N. Chat about this`).
 */
describe('AskUserQuestion densable no minHeight on content column', () => {
  test('QuestionView does not pin minHeight={minContentHeight}', async () => {
    const src = await Bun.file(
      new URL('../QuestionView.tsx', import.meta.url),
    ).text()
    expect(src).not.toContain('minHeight={minContentHeight}')
    expect(src).toContain('densable XT4: no minHeight')
  })

  test('PreviewQuestionView does not pin minHeight={minContentHeight}', async () => {
    const src = await Bun.file(
      new URL('../PreviewQuestionView.tsx', import.meta.url),
    ).text()
    expect(src).not.toContain('minHeight={minContentHeight}')
    expect(src).toContain('do not\n  // pin minHeight on this column')
  })

  test('SubmitQuestionsView does not pin minHeight={minContentHeight}', async () => {
    const src = await Bun.file(
      new URL('../SubmitQuestionsView.tsx', import.meta.url),
    ).text()
    expect(src).not.toContain('minHeight={minContentHeight}')
    expect(src).toContain('densable ZT4/GT4: no minHeight')
  })
})
