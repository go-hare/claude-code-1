import { describe, expect, test } from 'bun:test'

import {
  classifyGhAuthStatusFallback,
  classifyGhAuthTokenProbe,
  formatWebSetupGhCheckFailedMessage,
  formatWebSetupGhTooOldMessage,
} from '../ghAuthStatus.js'

describe('gh auth token fallback 243', () => {
  test('unknown command is old CLI', () => {
    expect(
      classifyGhAuthTokenProbe({
        exitCode: 1,
        stderr: 'unknown command "token" for "gh auth"',
      }),
    ).toEqual({ kind: 'old_cli' })
  })

  test('integer exit + empty stderr is old CLI', () => {
    expect(classifyGhAuthTokenProbe({ exitCode: 1, stderr: '' })).toEqual({
      kind: 'old_cli',
    })
  })

  test('not logged in / no oauth token stay not_authenticated', () => {
    expect(
      classifyGhAuthTokenProbe({
        exitCode: 1,
        stderr: 'not logged in to any GitHub hosts',
      }),
    ).toEqual({ kind: 'not_authenticated' })
    expect(
      classifyGhAuthTokenProbe({
        exitCode: 1,
        stderr: 'no oauth token',
      }),
    ).toEqual({ kind: 'not_authenticated' })
  })

  test('auth status fallback: logged in to → authenticated without token command', () => {
    expect(
      classifyGhAuthStatusFallback({
        exitCode: 1,
        stderr: 'Logged in to github.com as octocat',
      }),
    ).toEqual({
      status: 'authenticated',
      supportsAuthTokenCommand: false,
    })
  })

  test('web-setup too-old copy names 2.17.0 and does not ask login again', () => {
    const msg = formatWebSetupGhTooOldMessage(
      'https://claude.ai/code/onboarding?step=alt-auth',
    )
    expect(msg).toContain('too old to share its login')
    expect(msg).toContain('`gh auth token` needs GitHub CLI 2.17.0 or newer')
    expect(msg).not.toContain('Run `gh auth login`')
  })

  test('web-setup check-failed copy points at gh auth status', () => {
    const msg = formatWebSetupGhCheckFailedMessage(
      '`gh auth token` timed out.',
      'https://example/onboarding?step=alt-auth',
    )
    expect(msg).toContain("Couldn't check GitHub CLI login status")
    expect(msg).toContain('`gh auth token` timed out')
    expect(msg).toContain('Run `gh auth status` to check')
  })
})
