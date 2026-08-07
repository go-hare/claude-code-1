/**
 * densable 2.1.216 — AskUserQuestion free-text neutral wording
 */
import { describe, expect, test } from 'bun:test'
import {
  NOTES_ONLY_ANSWER,
  areAskUserAnswersPureStructured,
  buildAskUserToolResultContent,
  formatAfkTimeoutMessage,
  type Question,
} from '../AskUserQuestionTool.js'

const q = (overrides?: Partial<Question>): Question => ({
  question: 'Which library should we use?',
  header: 'Library',
  options: [
    { label: 'date-fns', description: 'Modern' },
    { label: 'moment', description: 'Legacy' },
  ],
  multiSelect: false,
  ...overrides,
})

describe('buildAskUserToolResultContent (densable 2.1.216)', () => {
  test('pure structured labels → continue wording', () => {
    const questions = [q()]
    const content = buildAskUserToolResultContent({
      questions,
      answers: { [questions[0]!.question]: 'date-fns' },
    })
    expect(content).toContain('Your questions have been answered:')
    expect(content).toContain(
      'You can now continue with these answers in mind.',
    )
    expect(content).not.toContain('Read the answers carefully')
  })

  test('custom free-text → careful-read / not-proceed', () => {
    const questions = [q()]
    const content = buildAskUserToolResultContent({
      questions,
      answers: {
        [questions[0]!.question]: 'wait, explain the tradeoffs first',
      },
    })
    expect(content).toContain('The user answered:')
    expect(content).toContain(
      'Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    )
    expect(content).not.toContain(
      'You can now continue with these answers in mind.',
    )
  })

  test('annotations notes force neutral even when label is valid', () => {
    const questions = [q()]
    const qt = questions[0]!.question
    const content = buildAskUserToolResultContent({
      questions,
      answers: { [qt]: 'date-fns' },
      annotations: { [qt]: { notes: 'please wait' } },
    })
    expect(content).toContain('notes: please wait')
    expect(content).not.toContain('user notes:')
    expect(content).toContain('Read the answers carefully')
  })

  test('response freeform → The user responded', () => {
    const questions = [q()]
    const content = buildAskUserToolResultContent({
      questions,
      answers: {},
      response: 'hold on',
    })
    expect(content).toBe('The user responded: hold on')
  })

  test('empty → did not answer', () => {
    const content = buildAskUserToolResultContent({
      questions: [q()],
      answers: {},
    })
    expect(content).toBe('The user did not answer the questions.')
  })

  test('NOTES_ONLY + notes summary shape', () => {
    const questions = [q()]
    const qt = questions[0]!.question
    const content = buildAskUserToolResultContent({
      questions,
      answers: { [qt]: NOTES_ONLY_ANSWER },
      annotations: { [qt]: { notes: 'see comment' } },
    })
    expect(content).toContain(`"${qt}"="(no option selected)"`)
    expect(content).toContain('notes: see comment')
    expect(content).toContain('Read the answers carefully')
  })

  test('multiSelect pure comma-joined labels → continue', () => {
    const questions = [
      q({
        multiSelect: true,
        options: [
          { label: 'a', description: 'A' },
          { label: 'b', description: 'B' },
          { label: 'c', description: 'C' },
        ],
      }),
    ]
    const qt = questions[0]!.question
    const content = buildAskUserToolResultContent({
      questions,
      answers: { [qt]: 'a, b' },
    })
    expect(content).toContain(
      'You can now continue with these answers in mind.',
    )
  })

  test('multiSelect custom token → neutral', () => {
    const questions = [
      q({
        multiSelect: true,
        options: [
          { label: 'a', description: 'A' },
          { label: 'b', description: 'B' },
        ],
      }),
    ]
    const qt = questions[0]!.question
    const content = buildAskUserToolResultContent({
      questions,
      answers: { [qt]: 'a, custom' },
    })
    expect(content).toContain('Read the answers carefully')
  })

  test('afkTimeoutMs alone uses densable c7u body', () => {
    const content = buildAskUserToolResultContent({
      questions: [q()],
      answers: {},
      afkTimeoutMs: 30_000,
    })
    expect(content).toBe(formatAfkTimeoutMessage(30_000))
    expect(content).toContain('No response after 30s')
    expect(content).not.toContain('auto-continued after')
  })

  test('afkTimeoutMs with partial selection includes Before going idle', () => {
    const questions = [q()]
    const qt = questions[0]!.question
    const content = buildAskUserToolResultContent({
      questions,
      answers: { [qt]: 'date-fns' },
      afkTimeoutMs: 15_000,
    })
    expect(content).toContain(formatAfkTimeoutMessage(15_000))
    expect(content).toContain('Before going idle the user had selected:')
    expect(content).toContain('date-fns')
  })
})

describe('areAskUserAnswersPureStructured', () => {
  test('array multiSelect purity', () => {
    const questions = [
      q({
        multiSelect: true,
        options: [
          { label: 'a', description: 'A' },
          { label: 'b', description: 'B' },
        ],
      }),
    ]
    const qt = questions[0]!.question
    expect(
      areAskUserAnswersPureStructured(questions, { [qt]: ['a', 'b'] }),
    ).toBe(true)
    expect(
      areAskUserAnswersPureStructured(questions, { [qt]: ['a', 'x'] }),
    ).toBe(false)
  })
})
