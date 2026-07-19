/**
 * densable sHa / iHa — sticky (pinned) notifications rendered above the
 * transient notification queue. Priority-sorted (immediate first).
 */
import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import {
  compareNotificationPriority,
  type Notification,
} from 'src/context/notifications.js'
import { useAppState } from 'src/state/AppState.js'
import { useLaunchPromptWarning } from './useLaunchPromptWarning.js'

/** densable Afe warning glyph. */
const WARNING_GLYPH = '\u26A0'

function PinnedNotice({ notice }: { notice: Notification }): React.ReactNode {
  if ('jsx' in notice) {
    return (
      <Text color="warning" wrap="truncate">
        {WARNING_GLYPH} {notice.jsx}
      </Text>
    )
  }
  return (
    <Text
      color={notice.color ?? 'warning'}
      dimColor={!notice.color}
      wrap="truncate"
    >
      {WARNING_GLYPH} {notice.text}
    </Text>
  )
}

export function PinnedNotifications(): React.ReactNode {
  // densable sHa mounts Pqo so launch-prompt-warning stays sticky.
  useLaunchPromptWarning()
  const pinned = useAppState(s => s.notifications.pinned ?? [])
  if (pinned.length === 0) return null
  const sorted = [...pinned].sort(compareNotificationPriority)
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {sorted.map(n => (
        <PinnedNotice key={n.key} notice={n} />
      ))}
    </Box>
  )
}
