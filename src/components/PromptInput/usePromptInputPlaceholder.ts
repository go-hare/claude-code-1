import { feature } from 'bun:bundle'
import { useMemo } from 'react'
import { useCommandQueue } from 'src/hooks/useCommandQueue.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { useAppState } from 'src/state/AppState.js'
import { getGlobalConfig } from 'src/utils/config.js'
import { getExampleCommandFromCache } from 'src/utils/exampleCommands.js'
import { isQueuedCommandEditable } from 'src/utils/messageQueueManager.js'
import { isKbCohesionFixesEnabled } from 'src/utils/systemPromptArms.js'
import { truncate } from 'src/utils/truncate.js'

// Dead code elimination: conditional import for proactive mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../proactive/index.js')
    : null

type Props = {
  input: string
  submitCount: number
  /** densable qle `hasMessages`. Gold `v<1&&!M&&he` — skip Try after resume. */
  hasMessages?: boolean
  viewingAgentName?: string
  /** #7 (2.1.326, official yTe/Kge): actionable hint after a failed request. */
  nextStepHint?: string
}

export type FailedRequestAction =
  | 'try_again'
  | 'fix_setup'
  | 'switch_model'
  | 'make_room'
  | 'edit_message'
  | 'wait'
  | 'blocked'

const ONCE_FIXED_HINT = 'Once fixed, resend your message'

const FAILED_REQUEST_HINTS: Record<FailedRequestAction, string | undefined> = {
  try_again: 'Resend your message to try again',
  fix_setup: ONCE_FIXED_HINT,
  switch_model: ONCE_FIXED_HINT,
  make_room: ONCE_FIXED_HINT,
  edit_message: 'Run /rewind to go back',
  wait: undefined,
  blocked: undefined,
}

/**
 * #7 (2.1.326, official Kge/sZt): map a classified failed-request recovery
 * action to the placeholder shown in the empty prompt.
 */
export function getFailedRequestPlaceholder(
  action: FailedRequestAction | null | undefined,
  isRemoteMode = false,
): string | undefined {
  if (!action || (action === 'edit_message' && isRemoteMode)) {
    return undefined
  }
  return FAILED_REQUEST_HINTS[action]
}

/**
 * #7 (2.1.326, official uJe/sZt): classify the most recent failed assistant turn
 * into an actionable recovery hint for the empty prompt placeholder.
 */
export function classifyFailedTurnAction(
  messages: ReadonlyArray<{
    type: string
    isApiErrorMessage?: boolean
    error?: string
    apiError?: string
    apiErrorStatus?: number
    quotaLimits?: unknown
    resendCannotCure?: boolean
    apiErrorIsTransient?: boolean
    message?: { content?: unknown }
  }>,
): FailedRequestAction | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (
      msg.type === 'system' ||
      msg.type === 'attachment' ||
      msg.type === 'progress'
    ) {
      continue
    }
    if (msg.type !== 'assistant') return null
    if (msg.isApiErrorMessage !== true) return null
    const err = msg.error
    const apiError = msg.apiError
    const status = msg.apiErrorStatus
    const content = msg.message?.content
    const text = Array.isArray(content)
      ? content
          .map(b =>
            typeof b === 'object' &&
            b !== null &&
            'text' in b &&
            typeof (b as { text?: unknown }).text === 'string'
              ? (b as { text: string }).text
              : '',
          )
          .join(' ')
          .toLowerCase()
      : ''
    // Official 2.1.327 #463: never show "Resend your message" hints after spend
    // caps, usage limits, or quota limits (account_limit -> 'wait' -> undefined).
    const isSpendCapOrUsageLimit =
      apiError === 'usage_limit_reached' ||
      msg.quotaLimits !== undefined ||
      text.includes('spending cap') ||
      text.includes('spend cap') ||
      text.includes('spending limit') ||
      text.includes('extra usage') ||
      text.includes('usage limit') ||
      text.includes('credit balance') ||
      text.includes('monthly limit')
    if (err === 'rate_limit' || status === 429 || isSpendCapOrUsageLimit) {
      return 'wait'
    }
    if (msg.resendCannotCure === true || msg.apiErrorIsTransient === false) {
      return 'blocked'
    }
    if (
      err === 'authentication_failed' ||
      err === 'billing_error' ||
      status === 401 ||
      status === 403
    ) {
      return 'fix_setup'
    }
    if (
      err === 'max_output_tokens' ||
      text.includes('prompt is too long') ||
      text.includes('context limit')
    ) {
      return 'make_room'
    }
    if (status === 413 || text.includes('too large')) return 'edit_message'
    if (
      text.includes('model') &&
      (text.includes('not found') || text.includes('unavailable'))
    ) {
      return 'switch_model'
    }
    if (status === 400 || err === 'invalid_request') return 'blocked'
    return 'try_again'
  }
  return null
}

const NUM_TIMES_QUEUE_HINT_SHOWN = 3
/** densable qle `JWt=20`. */
const MAX_TEAMMATE_NAME_WIDTH = 20

/**
 * densable qle `UGn` — GB `tengu_jiggly_mochi` default false.
 * Do not export minify `UGn`. Not fullscreen.
 */
function leftoverQleJigglyMochi(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_jiggly_mochi', false) === true
  )
}

export function usePromptInputPlaceholder({
  input,
  submitCount,
  hasMessages = false,
  viewingAgentName,
  nextStepHint,
}: Props): string | undefined {
  const queuedCommands = useCommandQueue()
  const promptSuggestionEnabled = useAppState(s => s.promptSuggestionEnabled)
  const queueEditIndex = useAppState(s => s.queueEditIndex)
  const placeholder = useMemo(() => {
    if (input !== '') {
      return
    }

    // densable qle: `Message @${ko(N,JWt)}…` — ko/rt already appends … when
    // truncated; gold still concatenates another … after ko. KEEP that BODY.
    if (viewingAgentName) {
      return `Message @${truncate(viewingAgentName, MAX_TEAMMATE_NAME_WIDTH)}…`
    }

    // densable qle: X.some(uf) then queueEditIndex / EE / UGn / hintCount.
    if (queuedCommands.some(isQueuedCommandEditable)) {
      const editLane =
        queueEditIndex === null
          ? 'none'
          : queueEditIndex === 0
            ? 'oldest'
            : 'newer'
      if (editLane !== 'none') {
        return editLane === 'oldest'
          ? 'Press Enter to edit the selected message, or up again for history'
          : 'Press Enter to edit the selected message, or up again for an older one'
      }
      const kbCohesion = isKbCohesionFixesEnabled()
      if (leftoverQleJigglyMochi()) {
        return kbCohesion
          ? 'Press up to select a queued message to edit, or Enter to send them now'
          : 'Press up to edit queued messages, Enter to send them immediately'
      }
      if (
        (getGlobalConfig().queuedCommandUpHintCount || 0) <
        NUM_TIMES_QUEUE_HINT_SHOWN
      ) {
        return kbCohesion
          ? 'Press up to select a queued message, then Enter to edit it'
          : 'Press up to edit queued messages'
      }
    }

    // #7 (2.1.326, official yTe): actionable next-step hint after a failed request
    if (nextStepHint) {
      return nextStepHint
    }

    // densable qle: `if(v<1&&!M&&he)return Slo(q())`. Proactive skip is analog extra KEEP.
    if (
      submitCount < 1 &&
      !hasMessages &&
      promptSuggestionEnabled &&
      !proactiveModule?.isProactiveActive()
    ) {
      return getExampleCommandFromCache()
    }
  }, [
    input,
    queuedCommands,
    queueEditIndex,
    nextStepHint,
    submitCount,
    hasMessages,
    promptSuggestionEnabled,
    viewingAgentName,
  ])

  return placeholder
}
