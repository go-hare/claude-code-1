/**
 * densable iXg(Gm, Gxt) / rXg — open resume_return via NMs when CBp gates pass.
 */
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { logEvent } from '../services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import {
  evaluateResumeReturnOffer,
  type ResumeReturnMessage,
} from '../utils/resumeReturn.js'
import type { DialogStore } from './dialogStore.js'
import type { RequestDialog } from './requestDialog.js'
import { RESUME_RETURN_KIND, resumeReturnSpec } from './specs/jsuKinds.js'

export type OpenResumeReturnResult =
  | 'opened'
  | 'skipped'
  | 'compact'
  | 'continue'
  | 'dismiss'
  | 'never'
  | 'cancelled'

/**
 * densable iXg: requestDialog(Gxt) then latch never / runCompact on compact.
 * Caller supplies messages + token estimate (rXg gates).
 */
export async function openResumeReturnIfNeeded(opts: {
  requestDialog: RequestDialog
  dialogStore: DialogStore
  messages: readonly ResumeReturnMessage[]
  estimateTokens: (msgs: readonly ResumeReturnMessage[]) => number
  runCompact: () => void
}): Promise<OpenResumeReturnResult> {
  const { requestDialog, dialogStore, messages, estimateTokens, runCompact } =
    opts

  const offer = evaluateResumeReturnOffer(messages, estimateTokens)
  if (!offer) return 'skipped'

  if (dialogStore.getState().open.some(d => d.kind === RESUME_RETURN_KIND)) {
    return 'skipped'
  }

  const result = await requestDialog(resumeReturnSpec, {
    sessionAgeMinutes: offer.sessionAgeMinutes,
    estimatedTokens: offer.estimatedTokens,
  })

  // densable iXg: cancelled returns before tengu_resume_return_action.
  if (result === 'cancelled') return 'cancelled'

  logEvent('tengu_resume_return_action', {
    action:
      result as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    sessionAgeMinutes: Math.round(offer.sessionAgeMinutes),
    messageCount: messages.length,
    estimatedTokens: offer.estimatedTokens,
  })

  if (result === 'never') {
    saveGlobalConfig(current =>
      current.resumeReturnDismissed
        ? current
        : { ...current, resumeReturnDismissed: true },
    )
  } else if (result === 'compact') {
    runCompact()
  }

  return result
}
