import { describe, expect, test } from 'bun:test'
import { buildBackgroundExitArgs } from '../BackgroundAndExit.js'

describe('buildBackgroundExitArgs (official dOo/fOo portable subset)', () => {
  test('prefers --resume + --fork-session with empty -p when sessionId present', () => {
    expect(
      buildBackgroundExitArgs(
        { intent: 'fix flaky tests', name: 'my-job' },
        'abcdef12-3456-7890-abcd-ef1234567890',
      ),
    ).toEqual([
      '-p',
      '',
      '--resume',
      'abcdef12-3456-7890-abcd-ef1234567890',
      '--fork-session',
      '--name',
      'my-job',
    ])
  })

  test('adds --reply-on-resume when mid-turn', () => {
    expect(
      buildBackgroundExitArgs({ intent: 'x' }, 'sid-1', {
        replyOnResume: true,
      }),
    ).toEqual([
      '-p',
      '',
      '--resume',
      'sid-1',
      '--fork-session',
      '--reply-on-resume',
    ])
  })

  test('falls back to -p intent without session', () => {
    expect(buildBackgroundExitArgs({ intent: 'keep going' }, null)).toEqual([
      '-p',
      'keep going',
    ])
  })

  test('omits --name when not set', () => {
    expect(buildBackgroundExitArgs({ intent: 'x' }, 'sid-1')).toEqual([
      '-p',
      '',
      '--resume',
      'sid-1',
      '--fork-session',
    ])
  })
})
