/**
 * densable 2.1.289 Zh declined summary.
 * Gold @207573135: `· question (a / b)`.
 */
import { describe, expect, test } from 'bun:test'
import { leftoverAskDeclinedLine } from '../AskUserQuestionTool.js'

describe('densable 2.1.289 Zh declined line', () => {
  test('joins option labels with " / "', () => {
    expect(
      leftoverAskDeclinedLine({
        question: '请选择一个选项?',
        options: [{ label: '1' }, { label: '2' }, { label: '3' }],
      }),
    ).toBe('· 请选择一个选项? (1 / 2 / 3)')
  })

  test('AskUserQuestionTool rejected message maps Zh lines', async () => {
    const src = await Bun.file(
      new URL('../AskUserQuestionTool.tsx', import.meta.url),
    ).text()
    expect(src).toContain('leftoverAskDeclinedLine')
    expect(src).toContain('User declined to answer questions')
    expect(src).toContain('MessageResponse')
    expect(src).toContain('flexDirection="column"')
    expect(src).toContain('questions.map')
  })
})
