import type { ProgressMessage } from 'src/types/message.js'

/**
 * buildMessageLookups buckets progress messages by parentToolUseID, and hooks
 * emit `hook_progress` under the tool_use id they fire for. A shell call's
 * bucket therefore also holds the ticks of its Pre/PostToolUse hooks, which
 * carry no shell fields — rendering one as a shell tick throws on
 * `fullOutput.trim()`. Pick the last tick this renderer actually owns.
 */
export function findLastShellProgress<T>(
  progressMessages: ProgressMessage<T>[],
  dataType: 'bash_progress' | 'powershell_progress',
): ProgressMessage<T> | undefined {
  for (let i = progressMessages.length - 1; i >= 0; i--) {
    const msg = progressMessages[i]
    if ((msg?.data as { type?: string } | undefined)?.type === dataType) {
      return msg
    }
  }
  return undefined
}
