import { afterEach, describe, expect, test } from 'bun:test'
import { buildSessionChildEnv } from '../sessionChild.js'

const prevShowsCutOff = process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS

afterEach(() => {
  if (prevShowsCutOff === undefined) {
    delete process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS
  } else {
    process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS = prevShowsCutOff
  }
})

const baseOpts = {
  sessionId: 'sess-309',
  sessionToken: 'tok',
  configDir: '/cfg',
  stageFileRoot: '/stage',
  apiBaseUrl: 'https://api.anthropic.com',
  inferenceAccessToken: 'oauth',
}

describe('sessionChild #1166 CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS & prompt', () => {
  test('sets CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS=1 and [Tool call interrupted prompt when workerEpoch > 1', () => {
    delete process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS
    const env = buildSessionChildEnv({ ...baseOpts, workerEpoch: 2 })
    expect(env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBe('1')
    expect(env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS).toBe('1')
    expect(env.CLAUDE_CODE_RESUME_PROMPT).toContain(
      'If the result of a tool call above starts with "[Tool call interrupted"',
    )
  })

  test('respects CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS=0 opt-out', () => {
    process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS = '0'
    const env = buildSessionChildEnv({ ...baseOpts, workerEpoch: 2 })
    expect(env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS).toBeUndefined()
    expect(env.CLAUDE_CODE_RESUME_PROMPT).toBe(
      'Continue from where you left off. This session moved to a new runner; files you created earlier may no longer exist, so verify the working directory state before relying on prior edits.',
    )
  })

  test('does not set cut-off env vars on workerEpoch === 1', () => {
    delete process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS
    const env = buildSessionChildEnv({ ...baseOpts, workerEpoch: 1 })
    expect(env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBeUndefined()
    expect(env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS).toBeUndefined()
    expect(env.CLAUDE_CODE_RESUME_PROMPT).toBeUndefined()
  })
})
