/**
 * densable 2.1.235 #5 — confirm:cycleMode while permission comment open.
 * SEA ERg: open yes/no input collapses; only then accept-session.
 */
import { describe, expect, test } from 'bun:test'
import { resolveConfirmCycleModeAction } from '../confirmCycleMode.js'

describe('resolveConfirmCycleModeAction (densable ERg / #5)', () => {
  test('yes comment open → collapse-yes (does NOT accept-session)', () => {
    expect(
      resolveConfirmCycleModeAction({
        yesInputMode: true,
        noInputMode: false,
      }),
    ).toBe('collapse-yes')
  })

  test('no comment open → collapse-no', () => {
    expect(
      resolveConfirmCycleModeAction({
        yesInputMode: false,
        noInputMode: true,
      }),
    ).toBe('collapse-no')
  })

  test('neither comment open → accept-session', () => {
    expect(
      resolveConfirmCycleModeAction({
        yesInputMode: false,
        noInputMode: false,
      }),
    ).toBe('accept-session')
  })

  test('yes wins if both somehow open', () => {
    expect(
      resolveConfirmCycleModeAction({
        yesInputMode: true,
        noInputMode: true,
      }),
    ).toBe('collapse-yes')
  })
})
