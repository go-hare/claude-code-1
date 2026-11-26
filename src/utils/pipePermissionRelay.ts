import { randomUUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import type {
  PipeMessage,
  PipePermissionRequestPayload,
  PipePermissionResponsePayload,
} from './pipeTransport.js'
import type { PermissionUpdate } from './permissions/PermissionUpdateSchema.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'

type PendingPipePermission = {
  onResponse: (payload: PipePermissionResponsePayload) => void
}

// Host-scoped singleton for the relay function to master.
// Replaces the old globalThis.__pipeSendToMaster pattern.
type PipeRelayFn = (message: PipeMessage) => void

class PipePermissionRelayHostState {
  pendingPipePermissions = new Map<string, PendingPipePermission>()
  pipeRelay: PipeRelayFn | null = null
  // Slave-side mute flag: when true, relayPipeMessage() and permission
  // relay functions will short-circuit. Set by relay_mute / relay_unmute
  // control messages from master.
  relayMuted = false
}

const fallbackPipePermissionRelayHost: object = {}
const pipePermissionRelayByHost = new HostSlot<PipePermissionRelayHostState>(
  () => new PipePermissionRelayHostState(),
)

function getPipePermissionRelayHostState(): PipePermissionRelayHostState {
  try {
    const host = getBootstrapSessionHost()
    if (host) return pipePermissionRelayByHost.of(host)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return pipePermissionRelayByHost.of(fallbackPipePermissionRelayHost)
}

export function setRelayMuted(muted: boolean): void {
  getPipePermissionRelayHostState().relayMuted = muted
}

export function isRelayMuted(): boolean {
  return getPipePermissionRelayHostState().relayMuted
}

export function setPipeRelay(fn: PipeRelayFn | null): void {
  const state = getPipePermissionRelayHostState()
  state.pipeRelay = fn
  if (!fn) state.relayMuted = false // reset on disconnect
}

export function getPipeRelay(): PipeRelayFn | null {
  return getPipePermissionRelayHostState().pipeRelay
}

function getPipeSender(): ((message: PipeMessage) => void) | null {
  return getPipePermissionRelayHostState().pipeRelay ?? null
}

export function tryRelayPipePermissionRequest(
  toolUseConfirm: ToolUseConfirm,
  onResponse: (payload: PipePermissionResponsePayload) => void,
): string | null {
  const state = getPipePermissionRelayHostState()
  if (state.relayMuted) return null
  const send = getPipeSender()
  if (!send) return null

  const requestId = randomUUID()
  const payload: PipePermissionRequestPayload = {
    requestId,
    toolName: toolUseConfirm.tool.name,
    toolUseID: toolUseConfirm.toolUseID,
    description: toolUseConfirm.description,
    input: toolUseConfirm.input as Record<string, unknown>,
    permissionResult: toolUseConfirm.permissionResult,
    permissionPromptStartTimeMs: toolUseConfirm.permissionPromptStartTimeMs,
  }

  state.pendingPipePermissions.set(requestId, { onResponse })
  send({ type: 'permission_request', data: JSON.stringify(payload) })
  return requestId
}

export function resolvePipePermissionResponse(
  payload: PipePermissionResponsePayload,
): boolean {
  const pendingPipePermissions =
    getPipePermissionRelayHostState().pendingPipePermissions
  const pending = pendingPipePermissions.get(payload.requestId)
  if (!pending) return false
  pendingPipePermissions.delete(payload.requestId)
  pending.onResponse(payload)
  return true
}

export function cancelPipePermissionRequest(
  requestId: string,
  reason?: string,
): boolean {
  const pendingPipePermissions =
    getPipePermissionRelayHostState().pendingPipePermissions
  const pending = pendingPipePermissions.get(requestId)
  if (!pending) return false
  pendingPipePermissions.delete(requestId)
  pending.onResponse({
    requestId,
    behavior: 'deny',
    feedback: reason ?? 'Permission request was cancelled by main.',
  })
  return true
}

export function forgetPipePermissionRequest(
  requestId: string | null | undefined,
): void {
  if (!requestId) return
  getPipePermissionRelayHostState().pendingPipePermissions.delete(requestId)
}

export function notifyPipePermissionCancel(
  requestId: string | null | undefined,
  reason?: string,
): void {
  if (!requestId) return
  if (getPipePermissionRelayHostState().relayMuted) return
  const send = getPipeSender()
  if (!send) return
  send({
    type: 'permission_cancel',
    data: JSON.stringify({ requestId, reason }),
  })
}

export function clearPendingPipePermissions(
  reason = 'Pipe permission relay was disconnected.',
): void {
  const pendingPipePermissions =
    getPipePermissionRelayHostState().pendingPipePermissions
  for (const requestId of [...pendingPipePermissions.keys()]) {
    cancelPipePermissionRequest(requestId, reason)
  }
}

export function makePipePermissionResponsePayload(
  requestId: string,
  behavior: 'allow',
  updatedInput: Record<string, unknown>,
  permissionUpdates: PermissionUpdate[],
  feedback?: string,
  contentBlocks?: ContentBlockParam[],
): PipePermissionResponsePayload
export function makePipePermissionResponsePayload(
  requestId: string,
  behavior: 'deny',
  feedback?: string,
  contentBlocks?: ContentBlockParam[],
): PipePermissionResponsePayload
export function makePipePermissionResponsePayload(
  requestId: string,
  behavior: 'allow' | 'deny',
  updatedInputOrFeedback?: Record<string, unknown> | string,
  permissionUpdatesOrContentBlocks?: PermissionUpdate[] | ContentBlockParam[],
  feedback?: string,
  contentBlocks?: ContentBlockParam[],
): PipePermissionResponsePayload {
  if (behavior === 'allow') {
    return {
      requestId,
      behavior,
      updatedInput:
        (updatedInputOrFeedback as Record<string, unknown> | undefined) ?? {},
      permissionUpdates:
        (permissionUpdatesOrContentBlocks as PermissionUpdate[] | undefined) ??
        [],
      feedback,
      contentBlocks,
    }
  }

  return {
    requestId,
    behavior,
    feedback: updatedInputOrFeedback as string | undefined,
    contentBlocks: permissionUpdatesOrContentBlocks as
      | ContentBlockParam[]
      | undefined,
  }
}
