import { describe, expect, test } from 'bun:test'
import {
  DIALOG_COMPONENTS_FOR_TEST,
  DIALOG_COMPONENTS_KINDS_FOR_TEST,
  getDialogHostLayout,
} from '../DialogHost.js'

describe('DialogHost cold_resume_quota registration (#964)', () => {
  test('registers cold_resume_quota renderer in DIALOG_COMPONENTS', () => {
    expect(DIALOG_COMPONENTS_KINDS_FOR_TEST).toContain('cold_resume_quota')
    const renderer = DIALOG_COMPONENTS_FOR_TEST['cold_resume_quota']
    expect(typeof renderer).toBe('function')
  })

  test('cold_resume_quota uses default inline layout', () => {
    expect(getDialogHostLayout('cold_resume_quota')).toBe('inline')
  })

  test('cold_resume_quota renderer returns a React element with expected props', () => {
    const renderer = DIALOG_COMPONENTS_FOR_TEST['cold_resume_quota']!
    const answer = () => undefined
    const el = renderer({
      payload: {
        inactiveSince: 1_700_000_000_000,
        contextTokens: 50_000,
        percentOfFiveHourLimit: 12,
        trigger: 'idle',
        focusedAction: 'resume',
        offersLookUp: true,
        offersSummary: false,
        hasUnsentDraft: true,
      },
      answer,
    }) as { props?: Record<string, unknown> }
    expect(el).toBeTruthy()
    expect(el.props?.inactiveSince).toBe(1_700_000_000_000)
    expect(el.props?.contextTokens).toBe(50_000)
    expect(el.props?.percentOfFiveHourLimit).toBe(12)
    expect(el.props?.trigger).toBe('idle')
    expect(el.props?.focusedAction).toBe('resume')
    expect(el.props?.offersLookUp).toBe(true)
    expect(el.props?.offersSummary).toBe(false)
    expect(el.props?.hasUnsentDraft).toBe(true)
    expect(typeof el.props?.onDone).toBe('function')
  })
})
