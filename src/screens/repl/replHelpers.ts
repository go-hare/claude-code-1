import type { ScrollBoxHandle } from '@anthropic/ink'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { FORK_SUBAGENT_TYPE } from '@claude-code/builtin-tools/tools/AgentTool/forkSubagent.js'
import { FORK_BOILERPLATE_TAG } from '../../constants/xml.js'
import type { RenderPacing } from '../../context/renderPacingContext.js'
import { SANDBOX_NETWORK_ACCESS_KIND } from '../../dialog/index.js'
import {
  PERMISSION_ASK_USER_QUESTION_KIND,
  PERMISSION_BASH_KIND,
  PERMISSION_ENTER_PLAN_MODE_KIND,
  PERMISSION_EXIT_PLAN_MODE_V2_KIND,
  PERMISSION_FILE_KIND,
  PERMISSION_MONITOR_KIND,
  PERMISSION_POWERSHELL_KIND,
  PERMISSION_PROMPT_KIND,
  PERMISSION_SKILL_KIND,
  PERMISSION_WEBFETCH_KIND,
} from '../../dialog/specs/permissionKinds.js'
import { expandPastedTextRefs, parseReferences } from '../../history.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js'
import {
  isLocalAgentTask,
  type LocalAgentTaskState,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { HookProgress } from '../../types/hooks.js'
import type {
  Message as MessageType,
  ProgressMessage,
} from '../../types/message.js'
import { count } from '../../utils/array.js'
import type { PastedContent } from '../../utils/config.js'
import { truncateToWidth } from '../../utils/format.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { formatImageNotShown } from '../../utils/imageResizer.js'
import {
  createUserMessage,
  type StreamingToolUse,
} from '../../utils/messages.js'
import { stripUnresumedInterruptedMessages } from '../../utils/sessionStorage.js'

// Stable empty references — avoid creating new literals on every render.
export const EMPTY_MCP_CLIENTS: MCPServerConnection[] = []
export const HISTORY_STUB = { maybeLoadOlder: (_: ScrollBoxHandle) => {} }
export const EMPTY_STRING_SET = new Set<string>()
export const EMPTY_STREAMING_TOOL_USES: StreamingToolUse[] = []
export const EMPTY_MESSAGES: MessageType[] = []

export const PROACTIVE_NO_OP_SUBSCRIBE = (_cb: () => void) => () => {}
export const PROACTIVE_FALSE = () => false
export const PROACTIVE_NULL = (): number | null => null
export const SUGGEST_BG_PR_NOOP = (_p: string, _n: string): boolean => false

/** Official 2.1.328 `Efn()` — initial render pacing context value (null). */
export function createInitialRenderPacing(): RenderPacing | null {
  return null
}

/**
 * Official 2.1.328 `Ize` (@319736883 @401578) + `VBe` (@319736883 @1787003):
 * blocking dialog kinds that hide the prompt input and carry the session/swarm
 * banner (`JBn`) either inside `modal.footer` (`inPane`) or at the top of
 * `abovePrompt`.
 */
const IN_PANE_BLOCKING_DIALOG_KINDS: readonly string[] = [
  PERMISSION_ASK_USER_QUESTION_KIND,
  PERMISSION_PROMPT_KIND,
  PERMISSION_BASH_KIND,
  PERMISSION_FILE_KIND,
  PERMISSION_POWERSHELL_KIND,
  PERMISSION_WEBFETCH_KIND,
  PERMISSION_SKILL_KIND,
  PERMISSION_MONITOR_KIND,
  SANDBOX_NETWORK_ACCESS_KIND,
  PERMISSION_ENTER_PLAN_MODE_KIND,
  PERMISSION_EXIT_PLAN_MODE_V2_KIND,
]

export function computeDialogPanelVisibility(opts: {
  onScreenBlockingKind: string | null
  modalSlotActive: boolean
  panelHidesPrompt: boolean
  pinnedConsentShowing: boolean
  dialogOverPanel: boolean
  fullscreen: boolean
}): { inPane: boolean; abovePrompt: boolean; drawn: boolean } {
  const isBlockingKind =
    opts.onScreenBlockingKind !== null &&
    IN_PANE_BLOCKING_DIALOG_KINDS.includes(opts.onScreenBlockingKind)
  const inPane = isBlockingKind && opts.modalSlotActive
  const abovePrompt =
    !inPane &&
    (opts.panelHidesPrompt ||
      opts.pinnedConsentShowing ||
      isBlockingKind ||
      opts.dialogOverPanel)
  const drawn =
    inPane || (abovePrompt && !(opts.fullscreen && opts.modalSlotActive))
  return { inPane, abovePrompt, drawn }
}

/**
 * Official 2.1.328 #606: format a cached image path for a background-agent
 * message as `[Image not shown, read it from <cache>]` so the UI display
 * redactor can show `[Image]` instead of a long filesystem path.
 */
export function formatBackgroundAgentImageNote(cachePath: string): string {
  return formatImageNotShown(cachePath)
}

/**
 * #117 (2.1.326): convert pasted image references inside a prompt submitted to
 * a viewed background agent into Anthropic image content blocks instead of raw
 * `[Image #N]` text.
 */
export function buildAgentMessageContentWithImages(
  input: string,
  pastedContents?: Record<number, PastedContent>,
  opts?: {
    inlineImages?: boolean
    cachedImagePaths?: ReadonlyMap<number, string>
  },
): string | ContentBlockParam[] {
  if (!pastedContents || Object.keys(pastedContents).length === 0) {
    return input
  }
  const allowInline = opts?.inlineImages !== false
  const refs = parseReferences(input)
  const imageBlocks: ContentBlockParam[] = []
  const fallbackImageNotes = new Map<number, string>()
  const seenImageIds = new Set<number>()
  for (const ref of refs) {
    const item = pastedContents[ref.id]
    if (item?.type === 'image' && !seenImageIds.has(ref.id)) {
      seenImageIds.add(ref.id)
      if (
        allowInline &&
        !item.unavailable &&
        typeof item.content === 'string' &&
        item.content.length > 0
      ) {
        imageBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: (item.mediaType || 'image/png') as
              | 'image/png'
              | 'image/jpeg'
              | 'image/gif'
              | 'image/webp',
            data: item.content,
          },
        })
      } else {
        const cachePath = opts?.cachedImagePaths?.get(ref.id) ?? item.filename
        if (cachePath) {
          fallbackImageNotes.set(
            ref.id,
            formatBackgroundAgentImageNote(cachePath),
          )
        }
      }
    }
  }
  const expanded = expandPastedTextRefs(input, pastedContents)
  const withNotes =
    fallbackImageNotes.size > 0
      ? expanded.replace(/\[Image #(\d+)\]/g, (match, idStr: string) => {
          const note = fallbackImageNotes.get(Number(idStr))
          return note ?? match
        })
      : expanded
  if (imageBlocks.length === 0) {
    return withNotes
  }
  // Strip `[Image #N]` placeholders for inline images while preserving any fallback notes.
  const cleanedText = withNotes
    .replace(/\[Image #(\d+)\]/g, (match, idStr: string) =>
      fallbackImageNotes.has(Number(idStr)) ? match : '',
    )
    .trim()
  return [
    ...imageBlocks,
    ...(cleanedText ? [{ type: 'text' as const, text: cleanedText }] : []),
  ]
}

const FORK_BOILERPLATE_OPEN_TAG = `<${FORK_BOILERPLATE_TAG}>`

export function isForkBoilerplateTextBlock(block: {
  type: string
  text?: string
}): boolean {
  return (
    block.type === 'text' &&
    typeof block.text === 'string' &&
    block.text.includes(FORK_BOILERPLATE_OPEN_TAG)
  )
}

/** Official 2.1.328 `toolUseIdsIn` (chunk@339792394.js @6827). */
export function extractResumedToolUseIds(
  messages: readonly MessageType[],
): Set<string> {
  const ids = new Set<string>()
  for (const msg of messages) {
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content))
      continue
    for (const block of msg.message.content) {
      if (
        block &&
        typeof block === 'object' &&
        block.type === 'tool_use' &&
        typeof block.id === 'string'
      ) {
        ids.add(block.id)
      }
    }
  }
  return ids
}

function extractEvalIdsFromText(text: string): number[] {
  const ids: number[] = []
  const attrRe = /\beval="(\d+)"/g
  for (const m of text.matchAll(attrRe)) {
    const id = Number(m[1])
    if (Number.isFinite(id)) ids.push(id)
  }
  if (ids.length === 0) {
    const hashRe = /\beval #(\d+)\b/g
    for (const m of text.matchAll(hashRe)) {
      const id = Number(m[1])
      if (Number.isFinite(id)) ids.push(id)
    }
  }
  return ids
}

function extractEvalIdFromToolUseResult(
  toolUseResult: unknown,
): number | undefined {
  if (toolUseResult === null || toolUseResult === undefined) return undefined
  if (typeof toolUseResult === 'string') {
    return extractEvalIdsFromText(toolUseResult)[0]
  }
  if (typeof toolUseResult === 'object') {
    const rec = toolUseResult as Record<string, unknown>
    if (typeof rec.evalId === 'number' && Number.isFinite(rec.evalId)) {
      return rec.evalId
    }
    if (typeof rec.content === 'string') {
      return extractEvalIdsFromText(rec.content)[0]
    }
  }
  return undefined
}

/**
 * Official 2.1.328 `danglingReceipts(Gt).map(r => r.toolUseId)`
 * (chunk@328404352.js @2183, chunk@319736883.js @475488):
 * returns unresolved Code Mode REPL tool_use IDs carried by the resumed transcript.
 */
export function extractResumedDanglingReplToolUseIds(
  messages: readonly MessageType[],
): string[] {
  const replToolUseIds = new Set<string>()
  const pollToolUseIds = new Set<string>()
  const pending: Array<{ toolUseId: string; evalId: number }> = []
  const settleEvalId = (evalId: number): void => {
    const idx = pending.findLastIndex(entry => entry.evalId === evalId)
    if (idx !== -1) pending.splice(idx, 1)
  }
  for (const msg of messages) {
    if (msg.type === 'attachment') {
      const att = (
        msg as { attachment?: { type?: unknown; envelopes?: unknown } }
      ).attachment
      if (att?.type === 'poll_events' && Array.isArray(att.envelopes)) {
        for (const env of att.envelopes) {
          if (typeof env === 'string') {
            for (const id of extractEvalIdsFromText(env)) settleEvalId(id)
          }
        }
      }
      continue
    }
    if (msg.type === 'assistant' && !('isVirtual' in msg && msg.isVirtual)) {
      if (!Array.isArray(msg.message?.content)) continue
      for (const block of msg.message.content) {
        if (
          !block ||
          typeof block !== 'object' ||
          block.type !== 'tool_use' ||
          typeof block.id !== 'string'
        ) {
          continue
        }
        if (block.name === 'REPL') replToolUseIds.add(block.id)
        else if (block.name === 'Poll') pollToolUseIds.add(block.id)
      }
      continue
    }
    if (msg.type !== 'user' || ('isVirtual' in msg && msg.isVirtual)) continue
    const content = msg.message?.content
    if (!Array.isArray(content)) continue
    const toolUseResult = (msg as { toolUseResult?: unknown }).toolUseResult
    for (const block of content) {
      if (!block || typeof block !== 'object' || block.type !== 'tool_result')
        continue
      const toolUseId = (block as { tool_use_id?: unknown }).tool_use_id
      if (typeof toolUseId !== 'string') continue
      if (pollToolUseIds.has(toolUseId)) {
        const resultText =
          typeof toolUseResult === 'object' &&
          toolUseResult !== null &&
          'content' in toolUseResult
            ? typeof (toolUseResult as { content?: unknown }).content ===
              'string'
              ? (toolUseResult as { content: string }).content
              : ''
            : typeof (block as { content?: unknown }).content === 'string'
              ? (block as { content: string }).content
              : ''
        for (const id of extractEvalIdsFromText(resultText)) settleEvalId(id)
      } else if (replToolUseIds.has(toolUseId)) {
        const evalId =
          extractEvalIdFromToolUseResult(toolUseResult) ??
          (typeof (block as { content?: unknown }).content === 'string'
            ? extractEvalIdsFromText((block as { content: string }).content)[0]
            : undefined)
        if (evalId !== undefined) {
          pending.push({ toolUseId, evalId })
        }
      }
    }
  }
  return pending.map(entry => entry.toolUseId)
}

/**
 * Official 2.1.323 (#1981): when resuming a session without auto-replaying
 * an interrupted turn, strip any synthetic NRR loader sentinel and mark the
 * unresumed interrupted prompt as not-a-chain-parent so the next user turn
 * never chains onto it.
 */
export function normalizeInitialMessages(
  initialMessages: MessageType[] | undefined,
  initialMessage: AppState['initialMessage'],
): MessageType[] {
  const raw = initialMessages ?? []
  if (raw.length < 2) return raw
  if (initialMessage && 'replay' in initialMessage) return raw
  const lastRelevantIdx = raw.findLastIndex(
    m => m.type !== 'system' && m.type !== 'progress',
  )
  if (lastRelevantIdx < 1) return raw
  const sentinel = raw[lastRelevantIdx]
  const prevMsg = raw[lastRelevantIdx - 1]
  if (
    sentinel?.type === 'assistant' &&
    Array.isArray(sentinel.message?.content) &&
    sentinel.message.content.length === 1 &&
    sentinel.message.content[0]?.type === 'text' &&
    sentinel.message.content[0].text === 'No response requested.' &&
    prevMsg?.type === 'user'
  ) {
    const copy = [...raw]
    stripUnresumedInterruptedMessages(copy, {
      kind: 'interrupted_prompt',
      message: prevMsg,
      loaderSentinelUuid: sentinel.uuid,
    })
    return copy
  }
  return raw
}

export function computeStopHookSpinnerSuffix(
  messages: readonly MessageType[],
  isLoading: boolean,
): string | null {
  if (!isLoading) return null

  const progressMsgs = messages.filter(
    (m): m is ProgressMessage<HookProgress> => {
      if (m.type !== 'progress') return false
      const data = m.data as Record<string, unknown>
      return (
        data.type === 'hook_progress' &&
        (data.hookEvent === 'Stop' || data.hookEvent === 'SubagentStop')
      )
    },
  )
  if (progressMsgs.length === 0) return null

  const currentToolUseID = progressMsgs.at(-1)?.toolUseID
  if (!currentToolUseID) return null

  const hasSummaryForCurrentExecution = messages.some(
    m =>
      m.type === 'system' &&
      m.subtype === 'stop_hook_summary' &&
      m.toolUseID === currentToolUseID,
  )
  if (hasSummaryForCurrentExecution) return null

  const currentHooks = progressMsgs.filter(
    p => p.toolUseID === currentToolUseID,
  )
  const total = currentHooks.length

  const completedCount = count(messages, m => {
    if (m.type !== 'attachment') return false
    const attachment = m.attachment!
    return (
      'hookEvent' in attachment &&
      (attachment.hookEvent === 'Stop' ||
        attachment.hookEvent === 'SubagentStop') &&
      'toolUseID' in attachment &&
      attachment.toolUseID === currentToolUseID
    )
  })

  const customMessage = currentHooks.find(p => p.data.statusMessage)?.data
    .statusMessage

  if (customMessage) {
    return total === 1
      ? `${customMessage}…`
      : `${customMessage}… ${completedCount}/${total}`
  }

  const hookType =
    currentHooks[0]?.data.hookEvent === 'SubagentStop'
      ? 'subagent stop'
      : 'stop'

  if (process.env.USER_TYPE === 'ant') {
    const cmd = currentHooks[completedCount]?.data.command
    const label = cmd ? ` '${truncateToWidth(cmd, 40)}'` : ''
    return total === 1
      ? `running ${hookType} hook${label}`
      : `running ${hookType} hook${label}\u2026 ${completedCount}/${total}`
  }

  return total === 1
    ? `running ${hookType} hook`
    : `running stop hooks… ${completedCount}/${total}`
}

export function computeDisplayedAgentMessages(
  viewedAgentTask: InProcessTeammateTaskState | LocalAgentTaskState | undefined,
  rawAgentMessages: readonly MessageType[] | undefined,
): readonly MessageType[] | undefined {
  if (!viewedAgentTask) return undefined
  // Official 2.1.325 `KZi` (#2271): when fullscreen is off, hold back partial
  // live subagent messages until disk bootstrap finishes so <Static> does not
  // flush later messages and permanently drop the initial prompt.
  if (
    !isFullscreenEnvEnabled() &&
    isLocalAgentTask(viewedAgentTask) &&
    viewedAgentTask.retain &&
    !viewedAgentTask.diskLoaded
  ) {
    return []
  }
  const agentMessages = rawAgentMessages ?? []
  if (
    !isLocalAgentTask(viewedAgentTask) ||
    viewedAgentTask.agentType !== FORK_SUBAGENT_TYPE ||
    !viewedAgentTask.prompt
  ) {
    return agentMessages
  }
  const trimmedPrompt = viewedAgentTask.prompt.trim()
  let boilerplateIndex = -1
  let lastAssistantToolUseIndex = -1
  let promptAlreadyRendered = false
  for (let i = 0; i < agentMessages.length; i++) {
    const m = agentMessages[i]!
    if (m.type === 'user' && Array.isArray(m.message?.content)) {
      const hasBoilerplate = m.message.content.some(isForkBoilerplateTextBlock)
      if (hasBoilerplate) {
        boilerplateIndex = i
      } else if (!promptAlreadyRendered) {
        const firstText = m.message.content.find(
          b => b.type === 'text' && typeof b.text === 'string',
        ) as { type: 'text'; text: string } | undefined
        if (firstText && firstText.text.trim() === trimmedPrompt) {
          promptAlreadyRendered = true
        }
      }
      continue
    }
    if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
      if (m.message.content.some(b => b.type === 'tool_use')) {
        lastAssistantToolUseIndex = i
      }
    }
  }

  const stripped =
    boilerplateIndex === -1
      ? agentMessages
      : agentMessages.map((m, i) => {
          if (i !== boilerplateIndex) return m
          if (!Array.isArray(m.message?.content)) return m
          return {
            ...m,
            message: {
              ...m.message,
              content: m.message.content.filter(
                b => !isForkBoilerplateTextBlock(b),
              ),
            },
          }
        })

  if (promptAlreadyRendered) return stripped

  const insertAt =
    boilerplateIndex !== -1
      ? boilerplateIndex + 1
      : lastAssistantToolUseIndex + 1
  const synthetic = createUserMessage({
    content: viewedAgentTask.prompt,
    timestamp: new Date(viewedAgentTask.startTime).toISOString(),
  })
  return [
    ...stripped.slice(0, insertAt),
    synthetic,
    ...stripped.slice(insertAt),
  ]
}

export function computeLocalAgentInProgressToolUseIDs(
  viewedAgentTask: InProcessTeammateTaskState | LocalAgentTaskState | undefined,
  viewedTeammateTask: InProcessTeammateTaskState | undefined,
  displayedAgentMessages: readonly MessageType[] | undefined,
): Set<string> {
  if (
    !viewedAgentTask ||
    viewedTeammateTask ||
    viewedAgentTask.status !== 'running' ||
    !displayedAgentMessages ||
    displayedAgentMessages.length === 0
  ) {
    return EMPTY_STRING_SET
  }
  const resolved = new Set<string>()
  const pending: string[] = []
  for (const m of displayedAgentMessages) {
    const content = (m as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) continue
    if (m.type === 'user') {
      for (const b of content) {
        if (
          b &&
          typeof b === 'object' &&
          b.type === 'tool_result' &&
          typeof b.tool_use_id === 'string'
        ) {
          resolved.add(b.tool_use_id)
        }
      }
    } else if (m.type === 'assistant') {
      for (const b of content) {
        if (
          b &&
          typeof b === 'object' &&
          b.type === 'tool_use' &&
          typeof b.id === 'string'
        ) {
          pending.push(b.id)
        }
      }
    }
  }
  const unresolved = pending.filter(id => !resolved.has(id))
  return unresolved.length > 0 ? new Set(unresolved) : EMPTY_STRING_SET
}
