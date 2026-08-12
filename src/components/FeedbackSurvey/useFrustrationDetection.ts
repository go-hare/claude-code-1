import { useCallback, useState } from 'react'
import type { Message } from '../../types/message.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import { submitTranscriptShare } from './submitTranscriptShare.js'

/**
 * densable 2.1.224 #16 — frustration share uses same terminal states as
 * FeedbackSurvey (submitting / submitted / share_failed), not fire-and-forget success.
 */
type FrustrationState =
  | 'closed'
  | 'transcript_prompt'
  | 'submitting'
  | 'submitted'
  | 'share_failed'

/** Match DEFAULT_FEEDBACK_SURVEY_CONFIG.hideThanksAfterMs */
const HIDE_AFTER_MS = 3000

export type FrustrationDetectionResult = {
  state: FrustrationState
  handleTranscriptSelect: (choice: string) => void
}

function detectFrustration(messages: Message[]): boolean {
  const apiErrors = messages.filter(
    m => 'isApiErrorMessage' in m && m.isApiErrorMessage === true,
  )
  return apiErrors.length >= 2
}

export function useFrustrationDetection(
  messages: Message[],
  isLoading: boolean,
  hasActivePrompt: boolean,
  otherSurveyOpen: boolean,
): FrustrationDetectionResult {
  const [state, setState] = useState<FrustrationState>('closed')

  const config = getGlobalConfig() as { transcriptShareDismissed?: boolean }
  // densable / sibling surveys: allow_product_feedback (not product_feedback)
  const policyAllowed = isPolicyAllowed('allow_product_feedback')
  // Gate only *opening* the prompt (densable sibling surveys). Terminal share
  // states must stay visible — shouldSkip must not mask submitting / submitted /
  // share_failed (densable #16 fail surface).
  const shouldSkip =
    config.transcriptShareDismissed ||
    !policyAllowed ||
    isLoading ||
    hasActivePrompt ||
    otherSurveyOpen

  const frustrated = detectFrustration(messages)

  const isTerminalShareState =
    state === 'submitting' || state === 'submitted' || state === 'share_failed'

  const effectiveState = isTerminalShareState
    ? state
    : shouldSkip
      ? 'closed'
      : frustrated && state === 'closed'
        ? 'transcript_prompt'
        : state

  const showSubmittedThenClose = useCallback(() => {
    setState('submitted')
    setTimeout(setState, HIDE_AFTER_MS, 'closed')
  }, [])

  const showShareFailedThenClose = useCallback(() => {
    setState('share_failed')
    setTimeout(setState, HIDE_AFTER_MS, 'closed')
  }, [])

  const handleTranscriptSelect = useCallback(
    (choice: string) => {
      if (shouldSkip) return
      if (choice === 'yes') {
        setState('submitting')
        void (async () => {
          try {
            const result = await submitTranscriptShare(
              messages,
              'frustration',
              crypto.randomUUID(),
            )
            if (result.success) {
              showSubmittedThenClose()
            } else {
              // densable 2.1.224 #16 — fail shows error, not success
              showShareFailedThenClose()
            }
          } catch {
            showShareFailedThenClose()
          }
        })()
      } else {
        saveGlobalConfig(current => ({
          ...current,
          transcriptShareDismissed: true,
        }))
        setState('closed')
      }
    },
    [shouldSkip, messages, showSubmittedThenClose, showShareFailedThenClose],
  )

  return { state: effectiveState, handleTranscriptSelect }
}
