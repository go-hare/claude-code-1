import type { LocalCommandCall } from '../../types/command.js'
import {
  getFastModeUnavailableReason,
  isFastModeEnabled,
  prefetchFastModeStatus,
} from '../../utils/fastMode.js'
import { applyFastModeToggle } from './applyFast.js'

/**
 * densable VPy / wSs — non-interactive `/fast [on|off]`.
 * Empty arg toggles current session fastMode; does not open the picker.
 * densable persists only for interactive sessions; noninteractive is session-only.
 */
export const call: LocalCommandCall = async (args, context) => {
  if (!isFastModeEnabled()) {
    return {
      type: 'text',
      value: getFastModeUnavailableReason() ?? 'Fast mode is not available',
    }
  }

  await prefetchFastModeStatus()

  const r = args?.trim().toLowerCase() || ''
  let enable: boolean
  if (r === 'on') {
    enable = true
  } else if (r === 'off') {
    enable = false
  } else if (r === '') {
    enable = !context.getAppState().fastMode
  } else {
    return {
      type: 'text',
      value: `Unknown argument "${r}". Use: /fast [on|off]`,
    }
  }

  const value = applyFastModeToggle(
    enable,
    context.getAppState,
    context.setAppState,
    { persistDefault: false, source: 'bridge' },
  )
  return { type: 'text', value }
}
