import { describe, expect, test } from 'bun:test'

import { determineMainLaunchMode } from '../modeDispatch.js'

describe('determineMainLaunchMode', () => {
  test('headless takes precedence over interactive flows', () => {
    expect(
      determineMainLaunchMode({
        isNonInteractiveSession: true,
        continueRequested: true,
        hasPendingSsh: true,
        hasPendingAssistantChat: true,
        hasResumeLikeRequest: true,
      }),
    ).toBe('headless')
  })

  test('continue takes precedence over other interactive branches', () => {
    expect(
      determineMainLaunchMode({
        isNonInteractiveSession: false,
        continueRequested: true,
        hasPendingSsh: true,
        hasPendingAssistantChat: true,
        hasResumeLikeRequest: true,
      }),
    ).toBe('continue')
  })

  test('ssh-remote wins when it is the highest-priority interactive branch', () => {
    expect(
      determineMainLaunchMode({
        isNonInteractiveSession: false,
        continueRequested: false,
        hasPendingSsh: true,
        hasPendingAssistantChat: true,
        hasResumeLikeRequest: true,
      }),
    ).toBe('ssh-remote')
  })

  test('falls back to interactive when no specialized mode matches', () => {
    expect(
      determineMainLaunchMode({
        isNonInteractiveSession: false,
        continueRequested: false,
        hasPendingSsh: false,
        hasPendingAssistantChat: false,
        hasResumeLikeRequest: false,
      }),
    ).toBe('interactive')
  })
})
