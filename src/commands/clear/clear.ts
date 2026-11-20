import { getSessionId } from '../../bootstrap/state.js'
import { clearCachedModelMaxTokensCeilings } from '../../services/api/withRetry.js'
import {
  codeModeSandboxHoldoffNotice,
  isCodeModeHeldOffBySandbox,
} from '../../services/codeMode/optIn.js'
import type { LocalCommandCall } from '../../types/command.js'
import { logError } from '../../utils/log.js'
import {
  closeSessionTabGroup,
  shouldForceCloseChromeTabGroupOnClear,
} from '../../utils/claudeInChrome/tabGroupCleanup.js'
import { resetTeamLeadVerificationOnSessionBoundary } from '../../utils/teammateMailbox.js'
import { clearConversation } from './conversation.js'

export const call: LocalCommandCall = async (_, context) => {
  // densable WGw — capture session id before Flo/clear regenerates it.
  const sessionId = getSessionId()
  await clearConversation(context)
  // Official 2.1.326 #51: drop cached per-model max_tokens ceilings on /clear.
  clearCachedModelMaxTokensCeilings()
  // Official 2.1.323 (#2195): invalidate prior team-lead mailbox approvals across /clear.
  resetTeamLeadVerificationOnSessionBoundary()
  const origin = (context as { submissionOrigin?: { kind?: string } })
    .submissionOrigin
  const forceClose = shouldForceCloseChromeTabGroupOnClear(
    origin,
    context.getAppState().tasks,
  )
  void closeSessionTabGroup({
    sessionId,
    onlyIfEmpty: !forceClose,
  }).catch(logError)
  return {
    type: 'text',
    value: isCodeModeHeldOffBySandbox() ? codeModeSandboxHoldoffNotice() : '',
  }
}
