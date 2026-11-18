import { describe, expect, test } from 'bun:test'
import { formatPreconditionError } from '../RemoteAgentTask.js'

describe('RemoteAgentTask v2.1.290 (#132)', () => {
  test('not_logged_in formats default Claude.ai login text', () => {
    expect(formatPreconditionError({ type: 'not_logged_in' })).toBe(
      'Please run /login and sign in with your Claude.ai account (not Console).',
    )
  })

  test('not_logged_in prefers explicit message when provided', () => {
    expect(
      formatPreconditionError({
        type: 'not_logged_in',
        message: 'Custom cloud login hint',
      } as Parameters<typeof formatPreconditionError>[0]),
    ).toBe('Custom cloud login hint')
  })
})
