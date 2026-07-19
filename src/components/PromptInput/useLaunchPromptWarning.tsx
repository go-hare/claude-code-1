/**
 * densable Pqo / QIa — pin launch-prompt-warning while launchWarning is set.
 */
import * as React from 'react'
import { useEffect } from 'react'
import { Text } from '@anthropic/ink'
import { useNotifications } from 'src/context/notifications.js'
import {
  type LaunchWarning,
  useLaunchWarning,
} from 'src/utils/launchWarning.js'

/** densable Dqo */
export const LAUNCH_PROMPT_WARNING_KEY = 'launch-prompt-warning'

/** densable xqo — long-prefill threshold for scroll hint. */
const LONG_PREFILL_CHARS = 1000

function LaunchPromptWarningText({
  warning,
}: {
  warning: LaunchWarning
}): React.ReactNode {
  const title =
    warning.type === 'deep-link'
      ? 'Prompt from an external link'
      : 'Pre-filled prompt'
  const isLong = warning.prefillLength > LONG_PREFILL_CHARS
  const lengthSuffix = isLong
    ? ` (${warning.prefillLength.toLocaleString('en-US')} chars)`
    : ''
  const reviewHint = isLong
    ? ' · scroll to review it all before pressing Enter'
    : ' · review before pressing Enter'
  return (
    <>
      {title}
      {lengthSuffix}
      <Text dimColor>{reviewHint}</Text>
    </>
  )
}

/** densable Pqo — sync launchWarning → pinned notification. */
export function useLaunchPromptWarning(): void {
  const launchWarning = useLaunchWarning()
  const { addNotification, removeNotification } = useNotifications()

  useEffect(() => {
    if (launchWarning === null) {
      removeNotification(LAUNCH_PROMPT_WARNING_KEY)
      return
    }
    addNotification({
      key: LAUNCH_PROMPT_WARNING_KEY,
      kind: 'warning',
      priority: 'immediate',
      pinned: true,
      jsx: <LaunchPromptWarningText warning={launchWarning} />,
    })
  }, [launchWarning, addNotification, removeNotification])
}
