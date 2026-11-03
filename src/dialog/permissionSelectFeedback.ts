/**
 * densable Mge — Tab amend / focus / submit+escape analytics for Host
 * Cmy/tyy `$e` Select (not o5 PermissionPrompt).
 *
 * Gold Cmy: Mge({feedbackTypeOf:MAt, toolName, isMcp, initialFocusedType:"accept"})
 * then e($e,{inlineDescriptions, onFocus, onInputModeToggle}). NEVER export
 * function Mge.
 */
import { useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { useSetAppState } from '../state/AppState.js'

export type PermissionSelectFeedbackType = 'accept' | 'reject'

export function hostShellFeedbackTypeOf(
  value: string,
): PermissionSelectFeedbackType | undefined {
  if (value === 'yes') return 'accept'
  if (value === 'no') return 'reject'
  return undefined
}

export function usePermissionSelectFeedback({
  toolName,
  isMcp,
  initialFocusedValue = 'yes',
}: {
  toolName: string
  isMcp: boolean
  initialFocusedValue?: string
}): {
  acceptFeedback: string
  rejectFeedback: string
  setAcceptFeedback: (value: string) => void
  setRejectFeedback: (value: string) => void
  yesInputMode: boolean
  noInputMode: boolean
  focusedValue: string
  showAmendHint: boolean
  handleInputModeToggle: (value: string) => void
  handleFocus: (value: string) => void
  logSubmitted: (type: PermissionSelectFeedbackType, feedback: string) => void
  logEscape: () => void
} {
  const setAppState = useSetAppState()
  const [acceptFeedback, setAcceptFeedback] = useState('')
  const [rejectFeedback, setRejectFeedback] = useState('')
  const [yesInputMode, setYesInputMode] = useState(false)
  const [noInputMode, setNoInputMode] = useState(false)
  const [yesFeedbackModeEntered, setYesFeedbackModeEntered] = useState(false)
  const [noFeedbackModeEntered, setNoFeedbackModeEntered] = useState(false)
  const [focusedValue, setFocusedValue] = useState(initialFocusedValue)

  const analyticsProps = {
    toolName:
      toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    isMcp,
  }

  function handleInputModeToggle(value: string) {
    const type = hostShellFeedbackTypeOf(value)
    if (type === 'accept') {
      if (yesInputMode) {
        setYesInputMode(false)
        logEvent('tengu_accept_feedback_mode_collapsed', analyticsProps)
      } else {
        setYesInputMode(true)
        setYesFeedbackModeEntered(true)
        logEvent('tengu_accept_feedback_mode_entered', analyticsProps)
      }
      return
    }
    if (type === 'reject') {
      if (noInputMode) {
        setNoInputMode(false)
        logEvent('tengu_reject_feedback_mode_collapsed', analyticsProps)
      } else {
        setNoInputMode(true)
        setNoFeedbackModeEntered(true)
        logEvent('tengu_reject_feedback_mode_entered', analyticsProps)
      }
    }
  }

  function handleFocus(value: string) {
    const type = hostShellFeedbackTypeOf(value)
    if (type !== 'accept' && yesInputMode && !acceptFeedback.trim()) {
      setYesInputMode(false)
    }
    if (type !== 'reject' && noInputMode && !rejectFeedback.trim()) {
      setNoInputMode(false)
    }
    setFocusedValue(value)
  }

  function logSubmitted(type: PermissionSelectFeedbackType, feedback: string) {
    logEvent(
      type === 'accept' ? 'tengu_accept_submitted' : 'tengu_reject_submitted',
      {
        ...analyticsProps,
        has_instructions: !!feedback,
        instructions_length: feedback.length,
        entered_feedback_mode:
          type === 'accept' ? yesFeedbackModeEntered : noFeedbackModeEntered,
      },
    )
  }

  function logEscape() {
    logEvent('tengu_permission_request_escape', {})
    setAppState(prev => ({
      ...prev,
      attribution: {
        ...prev.attribution,
        escapeCount: prev.attribution.escapeCount + 1,
      },
    }))
  }

  const focusedType = hostShellFeedbackTypeOf(focusedValue)
  const showAmendHint =
    (focusedType === 'accept' && !yesInputMode) ||
    (focusedType === 'reject' && !noInputMode)

  return {
    acceptFeedback,
    rejectFeedback,
    setAcceptFeedback,
    setRejectFeedback,
    yesInputMode,
    noInputMode,
    focusedValue,
    showAmendHint,
    handleInputModeToggle,
    handleFocus,
    logSubmitted,
    logEscape,
  }
}
