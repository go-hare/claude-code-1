import { getSessionId } from '../bootstrap/state.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import type { Message } from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { isNotEmptyMessage, normalizeMessages } from '../utils/messages.js'

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
  status?: unknown
  compact_error?: unknown
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
 * densable `tX` — gold-251-j. Local body is `isNotEmptyMessage`.
 */
export const isBridgeSdkMessageNonEmpty = isNotEmptyMessage

/**
 * densable `K` — gold-251-j session_id getter.
 * Local session id is `getSessionId()` (bootstrap g()/n().id).
 */
export function bridgeSdkSessionId(): string {
  return getSessionId()
}

/**
 * densable `rbe` — gold-251-j. isSynthetic for SDK user frames.
 */
export function isBridgeSdkSynthetic(message: {
  isMeta?: boolean
  isVisibleInTranscriptOnly?: boolean
  isCompactSummary?: boolean
}): boolean | undefined {
  return (
    message.isMeta ||
    message.isVisibleInTranscriptOnly ||
    message.isCompactSummary ||
    undefined
  )
}

/**
 * densable `j8t` — gold-251-j. Skip `requesting`. `v6` body is not in
 * gold; that conjunct is not invented.
 */
export function shouldForwardBridgeStatus(status: unknown): boolean {
  return status !== 'requesting'
}

/**
 * densable `jUe` — gold-251-j. Status frames drop `compact_error`.
 * `St` body is not in gold; that gate is not invented.
 */
export function scrubBridgeStatusSdkFrame<T extends FrameLike>(message: T): T {
  if (
    message.type === 'system' &&
    'subtype' in message &&
    message.subtype === 'status' &&
    'compact_error' in message &&
    message.compact_error !== undefined
  ) {
    return { ...message, compact_error: undefined }
  }
  return message
}

/**
 * densable `Ce` — gold-251-a / gold-251-j. Assistant/user frames with
 * parent_tool_use_id go to the bridge SDK channel when idt passes.
 * System thinking_tokens and non-requesting status go through jUe.
 * task_progress stays a status payload on this path.
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
    if (message.type !== 'system') return
    if (
      !(
        message.subtype === 'thinking_tokens' ||
        (message.subtype === 'status' &&
          shouldForwardBridgeStatus(message.status))
      )
    ) {
      return
    }
    handle.writeSdkMessages([scrubBridgeStatusSdkFrame(message) as SDKMessage])
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

type AgentProgressData = {
  type?: string
  message?: Message
  agentType?: string
  description?: string
}

/**
 * densable `eG` @185846374 — MCP tool name → Title Case display.
 * `return (e.split("__").pop()||e).replace(/_/g," ").replace(/\b\w/g,r=>r.toUpperCase())`
 */
export function eG(name: string): string {
  return (name.split('__').pop() || name)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, r => r.toUpperCase())
}

/**
 * densable `jd` @181893988 — strip `<cc-memory>` tags from text/thinking.
 * Gold: `if(!n.includes(u))return n;return n.replace(a,"")` with u=`cc-memory`.
 */
const CC_MEMORY_MARKER = 'cc-memory'
const CC_MEMORY_TAG_RE = /<\/?cc-memory\b[^>]*>/g

export function jd(text: string): string {
  if (!text.includes(CC_MEMORY_MARKER)) return text
  return text.replace(CC_MEMORY_TAG_RE, '')
}

type ToolLike = {
  name?: string
  mcpInfo?: {
    serverName?: string
    toolName?: string
    /** Optional gold display fields (not all tools populate these). */
    title?: string
    displayName?: string
    serverInfoName?: string
    iconUrl?: string
  } & Record<string, unknown>
  userFacingName?: (input?: unknown) => string
}

/**
 * densable `no` — resolve a tool by name from a list (exact then alias).
 * Local stand-in for gold tool-map lookup used by IN.
 */
export function no(
  tools: readonly ToolLike[] | undefined,
  name: string,
): ToolLike | undefined {
  if (!tools) return undefined
  return (
    tools.find(t => t.name === name) ??
    tools.find(t => t.mcpInfo?.toolName === name)
  )
}

export type ToolUseMetaEntry = {
  id: string
  display_name: string
  server_display_name?: string
  icon_url?: string
}

/**
 * densable `IN` @185847023 — tool_use_meta for assistant content.
 * Only emits when display_name differs from the raw tool name.
 */
export function IN(
  content: unknown,
  tools?: readonly ToolLike[],
): ToolUseMetaEntry[] {
  if (!Array.isArray(content)) return []
  const out: ToolUseMetaEntry[] = []
  for (const block of content) {
    if (
      block == null ||
      typeof block !== 'object' ||
      (block as { type?: string }).type !== 'tool_use'
    ) {
      continue
    }
    const { id, name } = block as { id?: unknown; name?: unknown }
    if (typeof id !== 'string' || typeof name !== 'string') continue
    const tool = no(tools, name)
    const mcp = tool?.mcpInfo
    const facing =
      typeof tool?.userFacingName === 'function'
        ? tool.userFacingName(undefined)
        : undefined
    const title =
      (typeof mcp?.title === 'string' && mcp.title) ||
      (typeof facing === 'string' && facing) ||
      eG(name)
    if (title === name) continue
    const entry: ToolUseMetaEntry = { id, display_name: title }
    if (mcp) {
      const serverDisplay =
        (typeof mcp.displayName === 'string' && mcp.displayName) ||
        (typeof mcp.serverInfoName === 'string' && mcp.serverInfoName) ||
        (typeof mcp.serverName === 'string' && mcp.serverName) ||
        undefined
      if (serverDisplay) entry.server_display_name = serverDisplay
      if (typeof mcp.iconUrl === 'string' && mcp.iconUrl) {
        entry.icon_url = mcp.iconUrl
      }
    }
    out.push(entry)
  }
  return out
}

/**
 * densable `MLe` @181896185 — RH-strip text + thinking blocks (jd).
 * Returns the same array reference when nothing changes.
 */
export function MLe<
  T extends { type: string; text?: string; thinking?: string },
>(content: T[]): T[] {
  const next = content.map(block => {
    if (block.type === 'text' && typeof block.text === 'string') {
      const s = jd(block.text)
      return s === block.text ? block : { ...block, text: s }
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      const s = jd(block.thinking)
      return s === block.thinking ? block : { ...block, thinking: s }
    }
    return block
  })
  return next.every((b, i) => b === content[i]) ? content : next
}

/**
 * densable `san` — gold-251-a / gold-251-j. Expand agent/skill progress
 * into SDK assistant/user frames carrying parent_tool_use_id.
 *
 * Locked: vp / tX / IN / MLe / K / rbe / j8t / jUe / Ce.
 * Local vp core is `normalizeMessages`. Product frames use parent_tool_use_id
 * (changelog index phrase is not a write-function body).
 */
export function* expandAgentProgressSdkFrames(
  message: Message,
  tools?: readonly ToolLike[],
): Generator<SDKMessage> {
  if (!isAgentOrSkillProgress(message)) return
  const data = message.data as AgentProgressData
  const inner = data.message
  if (!inner) return
  // gold: parent_tool_use_id:e.parentToolUseID (schema nullable).
  const parentToolUseId =
    (message as { parentToolUseID?: string | null }).parentToolUseID ?? null
  const subagentType = data.agentType
  const taskDescription = data.description
  const sessionId = bridgeSdkSessionId()
  for (const unit of normalizeMessages([inner])) {
    switch (unit.type) {
      case 'assistant': {
        // densable tX
        if (!isBridgeSdkMessageNonEmpty(unit)) break
        const unitMessage = unit.message
        if (!unitMessage) break
        const rawContent = unitMessage.content
        const contentArr = Array.isArray(rawContent)
          ? (rawContent as {
              type: string
              text?: string
              thinking?: string
            }[])
          : []
        // densable IN + MLe
        const toolUseMeta = IN(contentArr, tools)
        const stripped = MLe(contentArr)
        const messageBody =
          stripped === contentArr
            ? unitMessage
            : { ...unitMessage, content: stripped }
        const requestId = (unit as { requestId?: string }).requestId
        const unitError = (unit as { error?: unknown }).error
        const apiError =
          inner.type === 'assistant'
            ? (inner as { apiError?: unknown }).apiError
            : undefined
        yield {
          type: 'assistant',
          message: messageBody,
          parent_tool_use_id: parentToolUseId,
          session_id: sessionId,
          uuid: unit.uuid,
          timestamp: unit.timestamp,
          // gold always sets error:u.error (may be undefined).
          error: unitError,
          ...(requestId !== undefined && { request_id: requestId }),
          ...(subagentType !== undefined && { subagent_type: subagentType }),
          ...(taskDescription !== undefined && {
            task_description: taskDescription,
          }),
          ...(unit.isApiErrorMessage === true && {
            is_api_error_message: true,
          }),
          ...(apiError !== undefined && { api_error: apiError }),
          ...(toolUseMeta.length > 0 && { tool_use_meta: toolUseMeta }),
        } as SDKMessage
        break
      }
      case 'user': {
        const u = unit as Message & {
          mcpMeta?: Record<string, unknown>
          toolUseResult?: unknown
          origin?: unknown
        }
        yield {
          type: 'user',
          message: u.message,
          parent_tool_use_id: parentToolUseId,
          session_id: sessionId,
          uuid: u.uuid,
          timestamp: u.timestamp,
          // densable rbe
          isSynthetic: isBridgeSdkSynthetic(u),
          tool_use_result: u.mcpMeta
            ? { content: u.toolUseResult, ...u.mcpMeta }
            : u.toolUseResult,
          // gold: ...u.origin&&{origin:u.origin}
          ...(u.origin ? { origin: u.origin } : {}),
          ...(subagentType !== undefined && { subagent_type: subagentType }),
          ...(taskDescription !== undefined && {
            task_description: taskDescription,
          }),
        } as SDKMessage
        break
      }
      default:
        break
    }
  }
}

/**
 * densable REPL `san` write path — expand agent/skill progress and write
 * the frames idt keeps. Detached bindings and already-seen uuids are skipped.
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
  for (const frame of expandAgentProgressSdkFrames(message)) {
    if (shouldForwardSubagentSdkFrame(flags, frame)) frames.push(frame)
  }
  if (frames.length > 0) handle.writeSdkMessages(frames)
  seen.add(message.uuid)
}
