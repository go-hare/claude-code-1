import { describe, expect, test } from 'bun:test'
import { resolveSpinnerTipText } from '../Spinner.js'
import { FOCUS_TIP_ACTIVE, FOCUS_TIP_INVITE } from '../../utils/focusView.js'

describe('Spinner mid-turn /focus tip rendering (#262, SEA rt)', () => {
  test('renders FOCUS_TIP_ACTIVE without Tip prefix when spinnerTip is FOCUS_TIP_INVITE and briefTranscript is true', () => {
    expect(
      resolveSpinnerTipText({
        spinnerTip: FOCUS_TIP_INVITE,
        effectiveTip: FOCUS_TIP_INVITE,
        briefTranscript: true,
      }),
    ).toBe(FOCUS_TIP_ACTIVE)
  })

  test('renders FOCUS_TIP_ACTIVE even when effectiveTip was overridden (matches SEA F===hhr&&gt before Ct)', () => {
    expect(
      resolveSpinnerTipText({
        spinnerTip: FOCUS_TIP_INVITE,
        effectiveTip:
          "Use /btw to ask a quick side question without interrupting Claude's current work",
        briefTranscript: true,
      }),
    ).toBe(FOCUS_TIP_ACTIVE)
  })

  test('renders Tip-prefixed effectiveTip when briefTranscript is false', () => {
    expect(
      resolveSpinnerTipText({
        spinnerTip: FOCUS_TIP_INVITE,
        effectiveTip: FOCUS_TIP_INVITE,
        briefTranscript: false,
      }),
    ).toBe(`Tip: ${FOCUS_TIP_INVITE}`)
  })

  test('nextTaskSubject takes precedence over /focus tip', () => {
    expect(
      resolveSpinnerTipText({
        nextTaskSubject: '  Run   tests  ',
        spinnerTip: FOCUS_TIP_INVITE,
        effectiveTip: FOCUS_TIP_INVITE,
        briefTranscript: true,
      }),
    ).toBe('Next: Run tests')
  })

  test('preserves custom spinnerTipLabel when showing selected tip', () => {
    expect(
      resolveSpinnerTipText({
        spinnerTip: 'Custom tip',
        spinnerTipLabel: 'Hint',
        effectiveTip: 'Custom tip',
        briefTranscript: true,
      }),
    ).toBe('Hint: Custom tip')
  })

  test('returns undefined when no tip is active', () => {
    expect(
      resolveSpinnerTipText({
        briefTranscript: true,
      }),
    ).toBeUndefined()
  })
})
