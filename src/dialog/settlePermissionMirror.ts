/**
 * Tip sink: Host store.answer on permission_prompt:* (enqueue/mirror)
 * must hit ToolUseConfirm callbacks. Mailbox bridge ignores non-owned
 * ids; doo uses dialog-N + mailbox.reply — this only settles mirrors.
 *
 * densable Host renderers do not dequeue — doo W() / opener callbacks
 * removeFromQueue. Tip enqueue openers (pipe/remote/leader/inbox) must
 * dequeue in onAllow/onReject/onAbort the same way.
 */
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { PermissionUpdate } from '../types/permissions.js'
import {
  getPermissionConfirm,
  unregisterPermissionConfirm,
} from './permissionConfirmRegistry.js'
import type { DialogClosedEvent } from './dialogStore.js'
import {
  permissionPromptDialogId,
  type PermissionPromptResult,
} from './specs/permissionKinds.js'

const MIRROR_PREFIX = 'permission_prompt:'

export function toolUseIdFromMirrorDialogId(id: string): string | undefined {
  if (!id.startsWith(MIRROR_PREFIX)) return undefined
  const toolUseID = id.slice(MIRROR_PREFIX.length)
  return toolUseID === '' ? undefined : toolUseID
}

function parseMirrorResult(result: unknown): PermissionPromptResult {
  if (typeof result !== 'object' || result === null) {
    return { behavior: 'cancelled' }
  }
  const behavior = (result as { behavior?: unknown }).behavior
  if (behavior === 'allow' || behavior === 'deny' || behavior === 'cancelled') {
    return result as PermissionPromptResult
  }
  return { behavior: 'cancelled' }
}

/**
 * Dispatch a Host close onto the enqueue confirm. Returns true when a
 * confirm was settled. Dismiss with no confirm is a dequeue/clear no-op.
 */
export function settlePermissionMirror(event: DialogClosedEvent): boolean {
  const toolUseID = toolUseIdFromMirrorDialogId(event.id)
  if (toolUseID === undefined) return false
  const confirm = getPermissionConfirm(toolUseID)
  if (!confirm) return false
  // Prevent a second onClosed (dequeue dismiss) from re-entering.
  unregisterPermissionConfirm(toolUseID)

  if (event.type === 'dismissed') {
    confirm.onAbort()
    return true
  }

  const result = parseMirrorResult(event.result)
  if (result.behavior === 'allow') {
    confirm.onAllow(
      (result.updatedInput ?? confirm.input) as never,
      (result.permissionUpdates ?? []) as PermissionUpdate[],
      result.feedback,
      result.contentBlocks as ContentBlockParam[] | undefined,
    )
    return true
  }

  // Do not pop the REPL prompt queue here — pipe/remote mirrors share this
  // path. Local interactive deny pops in interactiveHandler / doo W().
  if (result.behavior === 'deny') {
    confirm.onReject(
      result.feedback,
      result.contentBlocks as ContentBlockParam[] | undefined,
    )
    return true
  }
  confirm.onAbort()
  return true
}

/** @internal test — stable id helper stays 1:1 with dequeue. */
export function mirrorDialogIdForTest(toolUseID: string): string {
  return permissionPromptDialogId(toolUseID)
}
