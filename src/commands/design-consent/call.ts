import type { LocalCommandResult } from '../../types/command.js'
import { errorMessage } from '../../utils/errors.js'
import {
  deleteDesignConsent,
  postDesignConsent,
} from '../../services/designConsent.js'
import { DesignSessionState } from '../../services/designProjectGrant.js'
import type { ToolUseContext } from '../../Tool.js'

/** densable `FZt` — `/design-consent` and `/design-revoke` local call. */
export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<LocalCommandResult> {
  return callDesignConsent('consent', context)
}

export async function callDesignConsent(
  action: 'consent' | 'revoke',
  context?: ToolUseContext,
): Promise<LocalCommandResult> {
  // Gold FZt: `e.toolState.get(oH)` is outside the try. A missing bag throws.
  const slots = context?.toolState
  if (slots === undefined) {
    throw new TypeError("Cannot read properties of undefined (reading 'get')")
  }
  const state = slots.get(DesignSessionState)
  const credentials = context?.credentials
  if (action === 'consent') {
    try {
      await postDesignConsent(state, credentials)
      return {
        type: 'text',
        value:
          'Design agent access granted for your Claude Design projects. Use /design revoke to undo.',
      }
    } catch (err) {
      return {
        type: 'text',
        value: `Couldn't record Design agent access for your Claude Design projects — ${errorMessage(err)}. Try again, or run /design-login to authorize Claude Design for this account.`,
      }
    }
  }
  try {
    await deleteDesignConsent(state, credentials)
    return {
      type: 'text',
      value: 'Design agent access revoked for your Claude Design projects.',
    }
  } catch (err) {
    return {
      type: 'text',
      value: `Couldn't revoke Design agent access for your Claude Design projects — ${errorMessage(err)}. Try again, or run /design-login to authorize Claude Design for this account.`,
    }
  }
}
