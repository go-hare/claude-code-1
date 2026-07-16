import { afterEach, describe, expect, mock, test } from 'bun:test'

// Isolate residual/env gates via process.env — pure enough for unit tests.

describe('canOfferBackgroundAndExit (official nOo)', () => {
  const prev = {
    handoff: process.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF,
    adopt: process.env.CLAUDE_DISABLE_ADOPT,
    skipHistory: process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY,
  }

  afterEach(() => {
    if (prev.handoff === undefined)
      delete process.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF
    else process.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF = prev.handoff
    if (prev.adopt === undefined) delete process.env.CLAUDE_DISABLE_ADOPT
    else process.env.CLAUDE_DISABLE_ADOPT = prev.adopt
    if (prev.skipHistory === undefined)
      delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    else process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = prev.skipHistory
    mock.restore()
  })

  test('rejects when handoff is disabled', async () => {
    process.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF = '1'
    const { canOfferBackgroundAndExit } = await import(
      '../BackgroundAndExit.js'
    )
    expect(
      canOfferBackgroundAndExit([
        {
          type: 'user',
          message: { content: 'hello' },
        } as never,
      ]),
    ).toBe(false)
  })

  test('rejects when adopt is disabled (official Kfo)', async () => {
    delete process.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF
    process.env.CLAUDE_DISABLE_ADOPT = '1'
    // Re-import is process-global for modules; call after env set is enough
    // because canOfferBackgroundAndExit reads env at call time.
    const { canOfferBackgroundAndExit } = await import(
      '../BackgroundAndExit.js'
    )
    expect(
      canOfferBackgroundAndExit([
        {
          type: 'user',
          message: { content: 'hello' },
        } as never,
      ]),
    ).toBe(false)
  })

  test('rejects empty conversation without seed', async () => {
    delete process.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF
    delete process.env.CLAUDE_DISABLE_ADOPT
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    const { canOfferBackgroundAndExit } = await import(
      '../BackgroundAndExit.js'
    )
    expect(canOfferBackgroundAndExit([])).toBe(false)
  })
})
