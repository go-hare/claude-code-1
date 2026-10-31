import { describe, expect, test } from 'bun:test'

import {
  formatQueuedIdeSelection,
  QUEUED_IDE_SELECTION_PREFIX,
  shouldHideQueuedIdeSelectionPreview,
} from '../PromptInputQueuedCommands.js'
import { joinHandedBackPrompt } from '../../../utils/handlePromptSubmit.js'
import type { QueuedCommand } from '../../../types/textInputTypes.js'

describe('densable 2.1.289 Uye CA / $5 / jN', () => {
  test('CA connected line selection', () => {
    expect(
      formatQueuedIdeSelection('connected', {
        text: 'foo',
        lineCount: 1,
      }),
    ).toBe(`${QUEUED_IDE_SELECTION_PREFIX}1 line selected`)
    expect(
      formatQueuedIdeSelection('connected', {
        text: 'foo\nbar',
        lineCount: 2,
        filePath: '/tmp/a.ts',
      }),
    ).toBe(`${QUEUED_IDE_SELECTION_PREFIX}2 lines selected`)
  })

  test('CA diff paints without connected status', () => {
    expect(
      formatQueuedIdeSelection(null, {
        text: 'x',
        lineCount: 3,
        source: 'diff',
      }),
    ).toBe(`${QUEUED_IDE_SELECTION_PREFIX}3 lines from diff`)
    expect(
      formatQueuedIdeSelection('disconnected', {
        text: 'x',
        lineCount: 1,
        source: 'diff',
        filePath: '/tmp/foo.ts',
      }),
    ).toBe(`${QUEUED_IDE_SELECTION_PREFIX}1 line from foo.ts`)
  })

  test('CA filePath-only when connected and not diff', () => {
    expect(
      formatQueuedIdeSelection('connected', {
        lineCount: 0,
        filePath: '/a/b/c.ts',
      }),
    ).toBe(`${QUEUED_IDE_SELECTION_PREFIX}In c.ts`)
    expect(
      formatQueuedIdeSelection(null, {
        lineCount: 0,
        filePath: '/a/b/c.ts',
      }),
    ).toBeNull()
  })

  test('$5 hides non-human origins and verified Slack turns', () => {
    expect(
      shouldHideQueuedIdeSelectionPreview({
        value: 'x',
        mode: 'prompt',
      } as QueuedCommand),
    ).toBe(false)
    expect(
      shouldHideQueuedIdeSelectionPreview({
        value: 'x',
        mode: 'prompt',
        origin: { kind: 'human' },
      } as QueuedCommand),
    ).toBe(false)
    expect(
      shouldHideQueuedIdeSelectionPreview({
        value: 'x',
        mode: 'prompt',
        origin: { kind: 'slack-ping' },
      } as QueuedCommand),
    ).toBe(false)
    expect(
      shouldHideQueuedIdeSelectionPreview({
        value: 'x',
        mode: 'prompt',
        origin: { kind: 'plugin', name: 'demo' },
      } as QueuedCommand),
    ).toBe(true)
    expect(
      shouldHideQueuedIdeSelectionPreview({
        value: 'x',
        mode: 'prompt',
        verifiedSlackHumanTurn: true,
      } as QueuedCommand),
    ).toBe(true)
  })

  test('jN joins nonempty composer with a newline', () => {
    expect(joinHandedBackPrompt('', 'next')).toBe('next')
    expect(joinHandedBackPrompt('   ', 'next')).toBe('next')
    expect(joinHandedBackPrompt('draft', 'next')).toBe('draft\nnext')
  })
})
