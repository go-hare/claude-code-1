import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import type { Message } from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { normalizeMessage } from '../utils/queryHelpers.js'

/**
 * densable `u9e` — bridge subagent SDK frames.
 * `tengu_bridge_subagent_frames` defaults on; text defaults off.
 */
export type BridgeSubagentFrameFlags = {
  enabled: boolean
  forwardText: boolean
}

export function bridgeSubagentFrameFlags(): BridgeSubagentFrameFlags {
  return {
    enabled:
      getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
        'tengu_bridge_subagent_frames',
        true,
      ) === true,
    forwardText:
      getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
        'tengu_bridge_subagent_text',
        false,
      ) === true,
  }
}

type FrameLike = {
  type?: string
  subtype?: unknown
  message?: { content?: unknown }
  parent_tool_use_id?: string | null
}

/** densable `bEn` — first content block is tool_use or tool_result. */
export function isSubagentToolFrame(message: FrameLike): boolean {
  if (message.type !== 'assistant' && message.type !== 'user') return false
  const content = message.message?.content
  if (!Array.isArray(content)) return false
  const first = content[0] as { type?: string } | undefined
  return first?.type === 'tool_use' || first?.type === 'tool_result'
}

/** densable `idt` — enabled && (forwardText || tool frame). */
export function shouldForwardSubagentSdkFrame(
  flags: BridgeSubagentFrameFlags,
  message: FrameLike,
): boolean {
  return flags.enabled && (flags.forwardText || isSubagentToolFrame(message))
}

/** densable `ian`. */
export function isAgentOrSkillProgress(message: {
  type?: string
  data?: { type?: string }
}): boolean {
  return (
    message.type === 'progress' &&
    (message.data?.type === 'agent_progress' ||
      message.data?.type === 'skill_progress')
  )
}

/**
 * densable `Ce` — assistant/user frames with parent_tool_use_id go to the
 * bridge SDK channel when idt passes. task_progress stays a status payload.
 */
export function forwardParentToolUseSdkFrame(
  handle: { writeSdkMessages: (messages: SDKMessage[]) => void } | null,
  message: FrameLike,
): void {
  if (!handle) return
  try {
    if (
      (message.type === 'assistant' || message.type === 'user') &&
      message.parent_tool_use_id != null
    ) {
      const flags = bridgeSubagentFrameFlags()
      if (shouldForwardSubagentSdkFrame(flags, message)) {
        handle.writeSdkMessages([message as SDKMessage])
      }
      return
    }
    // densable Ce also forwards some system frames via j8t/jUe. Those
    // bodies are not in the gold excerpt, so they are not invented here.
    // task_progress stays a status payload and is not written on this path.
  } catch (error) {
    // Se's body is not in the gold excerpt. errorMessage is the local
    // equivalent of Se(error).message.
    const label = 'subtype' in message ? message.subtype : message.type
    logForDebugging(
      `[bridge:sdk] ${String(label)} forward failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

/**
 * densable REPL `san` — expand agent/skill progress and write the frames
 * idt keeps. Detached bindings and already-seen uuids are skipped.
 */
export function forwardAgentProgressSdkFrames(
  handle: { writeSdkMessages: (messages: SDKMessage[]) => void },
  message: Message,
  seen: Set<string>,
  detached: boolean,
): void {
  if (detached) return
  if (!isAgentOrSkillProgress(message)) return
  if (seen.has(message.uuid)) return
  const flags = bridgeSubagentFrameFlags()
  if (!flags.enabled) return
  const frames: SDKMessage[] = []
  for (const frame of normalizeMessage(message)) {
    if (shouldForwardSubagentSdkFrame(flags, frame)) frames.push(frame)
  }
  if (frames.length > 0) handle.writeSdkMessages(frames)
  seen.add(message.uuid)
}
