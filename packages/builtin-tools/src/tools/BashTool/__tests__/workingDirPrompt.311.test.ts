import { afterEach, describe, expect, test } from 'bun:test'
import { getSimplePrompt } from '../prompt.js'

describe('BashTool prompt working directory persistence (#1236)', () => {
  const prev = process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR
    } else {
      process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR = prev
    }
  })

  test('states cd does not carry over when CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1', async () => {
    process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR = '1'
    const prompt = await getSimplePrompt()
    expect(prompt).toContain(
      'Every call starts in the start folder: a `cd` does not carry over.',
    )
    expect(prompt).not.toContain('Working directory persists between calls')
  })

  test('states conditional cd carry-over when CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR is unset', async () => {
    delete process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR
    const prompt = await getSimplePrompt()
    expect(prompt).toContain(
      '`cd` carries to the next call only in the main session, if the command succeeds and ends inside the working directories.',
    )
    expect(prompt).not.toContain('Working directory persists between calls')
  })
})
