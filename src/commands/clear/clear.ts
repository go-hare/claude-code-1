import { getSessionId } from '../../bootstrap/state.js'
import type { LocalCommandCall } from '../../types/command.js'
import { logError } from '../../utils/log.js'
import {
  closeSessionTabGroup,
  shouldForceCloseChromeTabGroupOnClear,
} from '../../utils/claudeInChrome/tabGroupCleanup.js'
import { clearConversation } from './conversation.js'

export const call: LocalCommandCall = async (_, context) => {
  // densable WGw — capture session id before Flo/clear regenerates it.
  const sessionId = getSessionId()
  await clearConversation(context)
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
  return { type: 'text', value: '' }
}
