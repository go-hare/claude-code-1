import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildFailureWorkerEvents } from '../sessionFailure.js'

const GIT_PREPARE_SRC = readFileSync(
  join(import.meta.dir, '..', 'gitPrepare.ts'),
  'utf8',
)

describe('self-hosted-runner v2.1.290 (#30 error line & #102 worktree resume)', () => {
  test('buildFailureWorkerEvents strips ANSI and control chars from stderrTail', () => {
    const events = buildFailureWorkerEvents(
      1,
      '\x1b[31mError:\x1b[0m \x00boom\x1b]0;title\x07\x7f',
    ) as Array<{ message?: { content?: Array<{ text?: string }> } }>
    const text = events[0]?.message?.content?.[0]?.text ?? ''
    expect(text).toContain('Last output before exit:\nError: boom')
    expect(text).not.toContain('\x1b')
    expect(text).not.toContain('\x00')
  })

  test('gitPrepare retries worktree add on "is a missing but already registered worktree"', () => {
    expect(GIT_PREPARE_SRC).toContain(
      'is a missing but already registered worktree',
    )
    expect(GIT_PREPARE_SRC).toContain('pruning and retrying worktree add')
  })
})
