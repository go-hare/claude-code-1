/**
 * Focus / brief transcript re-collapse (official parity path).
 *
 * After the normal collapse pipeline, focus mode runs this pass per turn:
 * - re-aggregate residual tool_use / grouped_tool_use / collapsed_read_search
 * - honor briefStandalone (last of each name + tool_result)
 * - fold agent toolStats into the brief summary
 * - hang streaming tail text as pendingText on the last collapse group
 * - stamp briefHiddenCount on system/turn_duration (hidden chrome excludes noise)
 *
 * Edit line counts use newline-span counts (not LCS); FileEdit multi-hunk
 * `edits[]` is summed per hunk.
 */
import type { UUID } from 'crypto'
import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import { ARTIFACT_TOOL_NAME } from '@claude-code/builtin-tools/tools/ArtifactTool/prompt.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/NotebookEditTool/constants.js'
import { findToolByName, type Tools } from '../Tool.js'
import { NO_CONTENT_MESSAGE } from '../constants/messages.js'
import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_NOTIFICATION_TAG,
} from '../constants/xml.js'
import type { CollapsedReadSearchGroup } from '../types/message.js'
import {
  extractTag,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  isHumanLikeOrigin,
  isMetaVisibleOrigin,
} from './messages.js'

/** Bash completion summary prefix (keep free of task module import) */
const BACKGROUND_BASH_SUMMARY_PREFIX = 'Background command '
/** Agent completion summary prefix */
const AGENT_SUMMARY_PREFIX = 'Agent "'

/**
 * Multi-bash collapse count from collapseBackgroundBashNotifications.
 * When N bash notifications merge, count is stored on the synthetic message.
 * Local collapse also emits `"N background commands completed"`; we parse that form as fallback.
 */
const multiBashCountByMessage = new WeakMap<object, number>()

/**
 * Register multi-count for a synthetic bash notification so classification returns count N.
 */
export function registerBriefBashNotificationCount(
  msg: object,
  count: number,
): void {
  if (count > 1) multiBashCountByMessage.set(msg, count)
}

export type BriefToolStats = {
  readCount: number
  searchCount: number
  bashCount: number
  editFileCount: number
  linesAdded: number
  linesRemoved: number
  otherToolCount: number
  frameCount?: number
}

export type FocusTranscriptOptions = {
  tools?: Tools
  /** Open streaming tail: skip hidden-count stamp; may hang pendingText */
  isLoading?: boolean
  /** Keep all text (remote reply channel path) */
  keepAllText?: boolean
  /**
   * Resolve async agent toolStats from the task registry.
   */
  getAgentToolStats?: (agentId: string) => BriefToolStats | undefined
}

type ContentBlock = {
  type: string
  name?: string
  id?: string
  tool_use_id?: string
  text?: string
  input?: unknown
  is_error?: boolean
}

/** Message shape this pass walks — loose enough for collapse output + tests. */
export type FocusTranscriptMessage = {
  type: string
  subtype?: string
  level?: string
  uuid?: string | UUID
  timestamp?: unknown
  isMeta?: boolean
  isApiErrorMessage?: boolean
  briefHiddenCount?: number
  pendingText?: string
  hookLabel?: string
  /** Origin: task-notification users only when kind matches or unset */
  origin?: { kind?: string; [key: string]: unknown }
  message?: {
    content: ContentBlock[] | string
    stop_reason?: string | null
  }
  toolUseResult?: {
    toolStats?: BriefToolStats
    status?: string
    agentId?: string
    [key: string]: unknown
  }
  attachment?: {
    type: string
    isMeta?: boolean
    origin?: { kind?: string; senderTaskId?: string; [key: string]: unknown }
    commandMode?: string
  }
  toolName?: string
  messages?: FocusTranscriptMessage[]
  searchCount?: number
  readCount?: number
  listCount?: number
  replCount?: number
  memorySearchCount?: number
  memoryReadCount?: number
  memoryWriteCount?: number
  [key: string]: unknown
}

const EDIT_TOOL_NAMES = new Set([
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
])

function firstBlock(msg: FocusTranscriptMessage): ContentBlock | undefined {
  const content = msg.message?.content
  if (!content || typeof content === 'string') return undefined
  return content[0]
}

/**
 * Extract completed task-notification summary text, or null.
 * origin may be unset or kind==="task-notification" (other origins reject).
 */
function extractCompletedTaskNotificationSummary(
  msg: FocusTranscriptMessage,
): string | null {
  if (msg.type !== 'user') return null
  const b = firstBlock(msg)
  if (b?.type !== 'text' || typeof b.text !== 'string') return null
  if (msg.origin && msg.origin.kind !== 'task-notification') return null
  const r = b.text.trimStart()
  if (!r.startsWith(`<${TASK_NOTIFICATION_TAG}`)) return null
  const close = `</${TASK_NOTIFICATION_TAG}>`
  const o = r.indexOf(close)
  if (o === -1) return null
  const i = r.slice(0, o + close.length)
  if (extractTag(i, STATUS_TAG) !== 'completed') return null
  return extractTag(i, SUMMARY_TAG)
}

/**
 * Classify leading task-notification user as bash/agent count.
 * Returns null when not a completed bash/agent notification (real prompt boundary).
 */
function classifyLeadingNotification(
  msg: FocusTranscriptMessage,
): { kind: 'bash' | 'agent'; count: number } | null {
  const multi = multiBashCountByMessage.get(msg as object)
  if (multi !== undefined) return { kind: 'bash', count: multi }
  const summary = extractCompletedTaskNotificationSummary(msg)
  if (summary === null) return null
  // Local collapse emits "N background commands completed". Parse that form too.
  const multiForm = /^(\d+) background commands completed$/.exec(summary)
  if (multiForm) return { kind: 'bash', count: Number(multiForm[1]) }
  if (summary.startsWith(BACKGROUND_BASH_SUMMARY_PREFIX)) {
    return { kind: 'bash', count: 1 }
  }
  if (summary.startsWith(AGENT_SUMMARY_PREFIX)) {
    return { kind: 'agent', count: 1 }
  }
  return null
}

function countNewlines(s: string | undefined): number {
  if (!s) return 0
  if (s.length === 0) return 0
  let n = 1
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) n++
  }
  return n
}

/**
 * Non-empty string → newline_count + 1; empty/non-string → 0.
 * (same as split-on-\n length for non-empty content)
 */
function countNewlineSpanLines(s: unknown): number {
  if (typeof s !== 'string' || s.length === 0) return 0
  return countNewlines(s)
}

/**
 * Line added/removed for edit tools (newline-span counts, not LCS).
 *
 * FileEdit:
 *   - `edits[]` multi-hunk → sum newline spans of new_string/old_string per hunk
 *   - else top-level new_string / old_string
 * FileWrite: content lines, removed 0
 * NotebookEdit: new_source lines, removed 0
 */
export function countEditLines(
  toolName: string,
  input: unknown,
): { added: number; removed: number } {
  if (typeof input !== 'object' || input === null) {
    return { added: 0, removed: 0 }
  }
  const inp = input as {
    new_string?: unknown
    old_string?: unknown
    content?: unknown
    new_source?: unknown
    edits?: unknown
  }
  if (toolName === FILE_EDIT_TOOL_NAME) {
    // multi-hunk edits[] first; else top-level new/old string
    if (Array.isArray(inp.edits)) {
      let added = 0
      let removed = 0
      for (const hunk of inp.edits) {
        if (typeof hunk !== 'object' || hunk === null) continue
        const h = hunk as { new_string?: unknown; old_string?: unknown }
        added += countNewlineSpanLines(h.new_string)
        removed += countNewlineSpanLines(h.old_string)
      }
      return { added, removed }
    }
    return {
      added: countNewlineSpanLines(inp.new_string),
      removed: countNewlineSpanLines(inp.old_string),
    }
  }
  if (toolName === FILE_WRITE_TOOL_NAME) {
    return { added: countNewlineSpanLines(inp.content), removed: 0 }
  }
  if (toolName === NOTEBOOK_EDIT_TOOL_NAME) {
    return { added: countNewlineSpanLines(inp.new_source), removed: 0 }
  }
  return { added: 0, removed: 0 }
}

/**
 * Walk agent messages into BriefToolStats. Returns undefined when all counts are zero.
 */
export function computeAgentToolStats(
  messages: ReadonlyArray<FocusTranscriptMessage>,
): BriefToolStats | undefined {
  const t: BriefToolStats = {
    readCount: 0,
    searchCount: 0,
    bashCount: 0,
    editFileCount: 0,
    linesAdded: 0,
    linesRemoved: 0,
    otherToolCount: 0,
  }
  for (const n of messages) {
    if (n.type === 'assistant') {
      const content = n.message?.content
      if (!content || typeof content === 'string') continue
      for (const o of content) {
        if (o.type !== 'tool_use' || !o.name) continue
        switch (o.name) {
          case 'Read':
            t.readCount++
            break
          case 'Grep':
          case 'Glob':
            t.searchCount++
            break
          case 'Bash':
          case 'PowerShell':
            t.bashCount++
            break
          case AGENT_TOOL_NAME:
          case LEGACY_AGENT_TOOL_NAME:
            break
          default:
            if (EDIT_TOOL_NAMES.has(o.name)) {
              const { added, removed } = countEditLines(o.name, o.input)
              t.editFileCount++
              t.linesAdded += added
              t.linesRemoved += removed
            } else if (
              o.name === ARTIFACT_TOOL_NAME &&
              (o.input as { action?: string } | undefined)?.action !== 'list'
            ) {
              t.frameCount = (t.frameCount ?? 0) + 1
            } else {
              t.otherToolCount++
            }
        }
      }
    } else if (n.type === 'user') {
      const o = n.toolUseResult?.toolStats
      if (o) {
        t.readCount += o.readCount
        t.searchCount += o.searchCount
        t.bashCount += o.bashCount
        t.editFileCount += o.editFileCount
        t.linesAdded += o.linesAdded
        t.linesRemoved += o.linesRemoved
        t.otherToolCount += o.otherToolCount
        if (o.frameCount) t.frameCount = (t.frameCount ?? 0) + o.frameCount
      }
    }
  }
  const total =
    t.readCount +
    t.searchCount +
    t.bashCount +
    t.editFileCount +
    t.otherToolCount +
    (t.frameCount ?? 0)
  return total > 0 ? t : undefined
}

function isEmptyAssistantText(text: string | undefined): boolean {
  if (text === undefined) return true
  const t = text.trim()
  return (
    t.length === 0 ||
    t === NO_CONTENT_MESSAGE ||
    t === INTERRUPT_MESSAGE ||
    t === INTERRUPT_MESSAGE_FOR_TOOL_USE
  )
}

/** Assistant has non-empty real text */
function isRealAssistantText(msg: FocusTranscriptMessage): boolean {
  if (msg.type !== 'assistant') return false
  const b = firstBlock(msg)
  return b?.type === 'text' && !isEmptyAssistantText(b.text)
}

/** Empty / sentinel assistant text */
function isEmptyAssistantMsg(msg: FocusTranscriptMessage): boolean {
  if (msg.type !== 'assistant') return false
  const b = firstBlock(msg)
  return b?.type === 'text' && isEmptyAssistantText(b.text)
}

/** Thinking / attachment / system (strip for open-tail scan) */
function isStreamingSkippable(msg: FocusTranscriptMessage): boolean {
  if (msg.type === 'assistant') {
    const b = firstBlock(msg)
    return b?.type === 'thinking' || b?.type === 'redacted_thinking'
  }
  if (msg.type === 'attachment') return true
  if (msg.type === 'system') return true
  return false
}

/** Turn boundary user / Ace-visible prompt attachment (densable brief turn count). */
function isTurnBoundary(msg: FocusTranscriptMessage): boolean {
  if (msg.type === 'user') {
    if (firstBlock(msg)?.type === 'tool_result') return false
    // densable Ace: meta peer/channel/observer still starts a turn
    if (msg.isMeta && !isMetaVisibleOrigin(msg.origin)) return false
    return true
  }
  if (msg.type === 'attachment') {
    const att = msg.attachment
    if (att?.type !== 'queued_command' || att.commandMode !== 'prompt') {
      return false
    }
    return (
      isMetaVisibleOrigin(att.origin) ||
      (!att.isMeta && isHumanLikeOrigin(att.origin))
    )
  }
  return false
}

function emptyCollapsed(
  seed: FocusTranscriptMessage,
): CollapsedReadSearchGroup {
  return {
    type: 'collapsed_read_search',
    searchCount: 0,
    readCount: 0,
    listCount: 0,
    replCount: 0,
    memorySearchCount: 0,
    memoryReadCount: 0,
    memoryWriteCount: 0,
    readFilePaths: [],
    searchArgs: [],
    messages: [seed as CollapsedReadSearchGroup['messages'][number]],
    displayMessage: seed as CollapsedReadSearchGroup['displayMessage'],
    uuid:
      (seed.uuid as UUID) ?? ('00000000-0000-4000-8000-000000000000' as UUID),
    timestamp: seed.timestamp,
  }
}

/** Build collapsed group from tool_use / grouped_tool_use seed */
function toolUseToCollapsed(
  seed: FocusTranscriptMessage,
  toolName: string,
  inputs: unknown[],
  tools: Tools | undefined,
): CollapsedReadSearchGroup {
  const o = inputs.length
  const g = emptyCollapsed(seed)
  if (toolName === AGENT_TOOL_NAME || toolName === LEGACY_AGENT_TOOL_NAME) {
    g.agentCount = o
    const descs = inputs.flatMap(inp => {
      const d = (inp as { description?: string } | undefined)?.description
      if (typeof d !== 'string') return []
      const u = d.replace(/\s+/g, ' ').trim().slice(0, 300)
      return u !== '' ? [u] : []
    })
    if (descs.length > 0) g.agentDescriptions = descs
    return g
  }
  const tool = tools ? findToolByName(tools, toolName) : undefined
  if (tool?.isMcp) {
    g.mcpCallCount = o
    if (tool.mcpInfo?.serverName) g.mcpServerNames = [tool.mcpInfo.serverName]
    return g
  }
  if (EDIT_TOOL_NAMES.has(toolName)) {
    g.editFileCount = o
    let added = 0
    let removed = 0
    for (const inp of inputs) {
      const u = countEditLines(toolName, inp)
      added += u.added
      removed += u.removed
    }
    if (added > 0) g.linesAdded = added
    if (removed > 0) g.linesRemoved = removed
    return g
  }
  if (toolName === ARTIFACT_TOOL_NAME) {
    const listN = inputs.filter(
      inp => (inp as { action?: string } | undefined)?.action === 'list',
    ).length
    if (o - listN > 0) g.frameCount = o - listN
    if (listN > 0) g.otherToolCount = (g.otherToolCount ?? 0) + listN
    return g
  }
  g.otherToolCount = o
  return g
}

/** Merge collapsed group stats into an existing brief group */
function mergeCollapsed(
  e: CollapsedReadSearchGroup,
  t: CollapsedReadSearchGroup,
): void {
  e.searchCount += t.searchCount
  e.readCount += t.readCount
  e.listCount += t.listCount
  e.replCount += t.replCount
  e.memorySearchCount += t.memorySearchCount
  e.memoryReadCount += t.memoryReadCount
  e.memoryWriteCount += t.memoryWriteCount
  if (t.teamMemorySearchCount) {
    e.teamMemorySearchCount =
      Number(e.teamMemorySearchCount ?? 0) + Number(t.teamMemorySearchCount)
  }
  if (t.teamMemoryReadCount) {
    e.teamMemoryReadCount =
      Number(e.teamMemoryReadCount ?? 0) + Number(t.teamMemoryReadCount)
  }
  if (t.teamMemoryWriteCount) {
    e.teamMemoryWriteCount =
      Number(e.teamMemoryWriteCount ?? 0) + Number(t.teamMemoryWriteCount)
  }
  if (t.scratchpadWriteCount) {
    e.scratchpadWriteCount =
      Number(e.scratchpadWriteCount ?? 0) + Number(t.scratchpadWriteCount)
    e.scratchpadLinesAdded =
      Number(e.scratchpadLinesAdded ?? 0) + Number(t.scratchpadLinesAdded ?? 0)
    e.scratchpadLinesRemoved =
      Number(e.scratchpadLinesRemoved ?? 0) +
      Number(t.scratchpadLinesRemoved ?? 0)
  }
  if (t.relevantMemories?.length) {
    e.relevantMemories = [...(e.relevantMemories ?? []), ...t.relevantMemories]
  }
  if (t.mcpCallCount) {
    e.mcpCallCount = Number(e.mcpCallCount ?? 0) + Number(t.mcpCallCount)
    e.mcpServerNames = [
      ...new Set([...(e.mcpServerNames ?? []), ...(t.mcpServerNames ?? [])]),
    ]
  }
  if (t.bashCount) e.bashCount = Number(e.bashCount ?? 0) + Number(t.bashCount)
  if (t.gitOpBashCount) {
    e.gitOpBashCount = Number(e.gitOpBashCount ?? 0) + Number(t.gitOpBashCount)
  }
  if (t.otherToolCount) {
    e.otherToolCount = Number(e.otherToolCount ?? 0) + Number(t.otherToolCount)
  }
  if (t.agentCount) {
    e.agentCount = Number(e.agentCount ?? 0) + Number(t.agentCount)
    if (t.agentDescriptions) {
      e.agentDescriptions = [
        ...((e.agentDescriptions as string[] | undefined) ?? []),
        ...(t.agentDescriptions as string[]),
      ]
    }
  }
  if (t.frameCount)
    e.frameCount = Number(e.frameCount ?? 0) + Number(t.frameCount)
  if (t.editFileCount) {
    e.editFileCount = Number(e.editFileCount ?? 0) + Number(t.editFileCount)
  }
  if (t.linesAdded)
    e.linesAdded = Number(e.linesAdded ?? 0) + Number(t.linesAdded)
  if (t.linesRemoved) {
    e.linesRemoved = Number(e.linesRemoved ?? 0) + Number(t.linesRemoved)
  }
  if (t.commits?.length) e.commits = [...(e.commits ?? []), ...t.commits]
  if (t.pushes?.length) e.pushes = [...(e.pushes ?? []), ...t.pushes]
  if (t.branches?.length) e.branches = [...(e.branches ?? []), ...t.branches]
  if (t.prs?.length) e.prs = [...(e.prs ?? []), ...t.prs]
  if (t.readFilePaths?.length) {
    e.readFilePaths = [...(e.readFilePaths ?? []), ...t.readFilePaths]
  }
  if (t.searchArgs?.length) {
    e.searchArgs = [...(e.searchArgs ?? []), ...t.searchArgs]
  }
  if (t.hookCount) {
    e.hookCount = Number(e.hookCount ?? 0) + Number(t.hookCount)
    e.hookTotalMs = Number(e.hookTotalMs ?? 0) + Number(t.hookTotalMs ?? 0)
    e.hookInfos = [...(e.hookInfos ?? []), ...(t.hookInfos ?? [])]
  }
  e.latestDisplayHint = t.latestDisplayHint ?? e.latestDisplayHint
  if (t.thoughtForMs) {
    e.thoughtForMs = Number(e.thoughtForMs ?? 0) + Number(t.thoughtForMs)
  }
  e.latestThinkingSummary = t.latestThinkingSummary ?? e.latestThinkingSummary
  e.messages.push(...t.messages)
}

function applyToolStats(e: CollapsedReadSearchGroup, W: BriefToolStats): void {
  e.readCount += W.readCount
  e.searchCount += W.searchCount
  if (W.bashCount) e.bashCount = Number(e.bashCount ?? 0) + W.bashCount
  if (W.editFileCount) {
    e.editFileCount = Number(e.editFileCount ?? 0) + W.editFileCount
  }
  if (W.linesAdded) e.linesAdded = Number(e.linesAdded ?? 0) + W.linesAdded
  if (W.linesRemoved) {
    e.linesRemoved = Number(e.linesRemoved ?? 0) + W.linesRemoved
  }
  if (W.otherToolCount) {
    e.otherToolCount = Number(e.otherToolCount ?? 0) + W.otherToolCount
  }
  if (W.frameCount) e.frameCount = Number(e.frameCount ?? 0) + W.frameCount
}

/**
 * Collapse one focus-transcript pass over messages.
 */
export function collapseFocusTranscript<T extends FocusTranscriptMessage>(
  messages: T[],
  tools: Tools | undefined,
  getAgentToolStats:
    | ((agentId: string) => BriefToolStats | undefined)
    | undefined,
  isLoading = false,
  options: { keepAllText?: boolean } = {},
): T[] {
  const keepAllText = options.keepAllText === true
  const out: T[] = []
  let a = 0
  while (a < messages.length) {
    const l = messages[a]!
    if (!isTurnBoundary(l)) {
      out.push(l)
      a++
      continue
    }

    // At turn boundary, walk consecutive bash/agent notifications into a
    // seeded collapse group. Real prompt ends the absorb; if none, emit boundary.
    // Absorb only when not keepAllText.
    const c = a
    let agentAbsorb = 0
    let bashAbsorb = 0
    const p: T[] = []
    if (!keepAllText) {
      // Start absorb at the current boundary user.
      while (a < messages.length) {
        const O = messages[a]!
        if (O.type !== 'user') break
        const N = classifyLeadingNotification(O)
        if (N === null) break
        if (N.kind === 'agent') agentAbsorb += N.count
        else bashAbsorb += N.count
        p.push(O)
        a++
      }
    }
    if (p.length === 0) {
      out.push(l)
      a++
    }
    const bodyStart = a
    let f = a
    while (f < messages.length && !isTurnBoundary(messages[f]!)) f++

    // Open streaming tail
    let m = isLoading && f === messages.length
    if (m) {
      let O = f - 1
      while (O >= bodyStart && isStreamingSkippable(messages[O]!)) O--
      const N = O >= bodyStart ? messages[O] : undefined
      if (
        N?.type === 'assistant' &&
        N.message?.stop_reason !== null &&
        N.message?.stop_reason !== undefined &&
        (isRealAssistantText(N) || isEmptyAssistantMsg(N))
      ) {
        m = false
      }
    }

    let g = -1
    if (!m) {
      for (let O = f - 1; O >= bodyStart; O--) {
        if (isRealAssistantText(messages[O]!)) {
          g = O
          break
        }
      }
    }

    const y = new Set<number>()
    if (keepAllText) {
      const errIds = new Set<string>()
      for (let N = bodyStart; N < f; N++) {
        const $ = messages[N]!
        if ($.type !== 'user') continue
        const content = $.message?.content
        if (!content || typeof content === 'string') continue
        for (const D of content) {
          if (
            typeof D === 'object' &&
            D !== null &&
            D.type === 'tool_result' &&
            D.is_error === true &&
            D.tool_use_id
          ) {
            errIds.add(D.tool_use_id)
          }
        }
      }
      for (let N = bodyStart; N < f; N++) {
        const $ = messages[N]!
        if (isRealAssistantText($)) {
          y.add(N)
          continue
        }
        if ($.type === 'assistant') {
          const D = firstBlock($)
          if (D?.type === 'tool_use' && D.id && errIds.has(D.id)) y.add(N)
          continue
        }
        if ($.type !== 'user') continue
        const content = $.message?.content
        if (!content || typeof content === 'string') continue
        for (const D of content) {
          if (
            typeof D === 'object' &&
            D !== null &&
            D.type === 'tool_result' &&
            D.is_error === true &&
            D.tool_use_id &&
            errIds.has(D.tool_use_id)
          ) {
            y.add(N)
            break
          }
        }
      }
    }

    const keepIdx = new Set<number>()
    const seenNames = new Set<string>()
    if (!m) {
      for (let O = f - 1; O >= bodyStart; O--) {
        const N = messages[O]!
        if (N.type !== 'assistant') continue
        const $ = firstBlock(N)
        if ($?.type !== 'tool_use' || !$?.name || seenNames.has($.name))
          continue
        seenNames.add($.name)
        const tool = tools ? findToolByName(tools, $.name) : undefined
        if (!tool?.briefStandalone) continue
        keepIdx.add(O)
        for (let D = O + 1; D < f; D++) {
          const W = messages[D]!
          if (W.type === 'assistant') break
          if (W.type !== 'user') continue
          const q = firstBlock(W)
          if (q?.type === 'tool_result' && q.tool_use_id === $.id) {
            keepIdx.add(D)
            break
          }
        }
      }
    }

    let E: CollapsedReadSearchGroup | null = null
    let b = f
    let pendingText: string | undefined
    const x: Array<[number, CollapsedReadSearchGroup]> = []
    const flush = () => {
      if (E) {
        x.push([b, E])
        E = null
        b = f
      }
    }
    // If notifications were absorbed, seed the collapse group from them
    if (p.length > 0) {
      E = emptyCollapsed(p[0]!)
      E.messages = [...(p as CollapsedReadSearchGroup['messages'])]
      if (agentAbsorb > 0) E.agentCount = agentAbsorb
      if (bashAbsorb > 0) E.bashCount = bashAbsorb
      b = c
    }
    let H = 0

    for (let O = bodyStart; O < f; O++) {
      if (O === g || y.has(O) || keepIdx.has(O)) {
        if (
          keepAllText &&
          (y.has(O) || O === g) &&
          isRealAssistantText(messages[O]!)
        ) {
          flush()
        }
        continue
      }
      const N = messages[O]!
      if (N.type === 'system') {
        // informational info → noise; stop_hook_summary+hookLabel → drop;
        // else keep
        if (N.subtype === 'informational' && N.level === 'info') {
          H++
        } else if (
          N.subtype === 'stop_hook_summary' &&
          N.hookLabel !== undefined
        ) {
          // drop silently
        } else {
          keepIdx.add(O)
        }
        continue
      }
      let $: CollapsedReadSearchGroup | null = null
      if (N.type === 'collapsed_read_search') {
        $ = structuredClone
          ? (structuredClone(N) as unknown as CollapsedReadSearchGroup)
          : ({
              ...(N as unknown as CollapsedReadSearchGroup),
              messages: [
                ...((N as unknown as CollapsedReadSearchGroup).messages ?? []),
              ],
            } as CollapsedReadSearchGroup)
      } else if (N.type === 'grouped_tool_use') {
        const inputs = (N.messages ?? []).map(D => firstBlock(D)?.input)
        $ = toolUseToCollapsed(N, N.toolName ?? '', inputs, tools)
      } else if (N.type === 'assistant') {
        const D = firstBlock(N)
        if (D?.type === 'tool_use' && D.name) {
          $ = toolUseToCollapsed(N, D.name, [D.input], tools)
        } else if (isEmptyAssistantMsg(N)) {
          H++
        } else if (
          m &&
          D?.type === 'text' &&
          D.text &&
          D.text.trim().length > 0
        ) {
          pendingText = D.text
        } else if (D?.type === 'thinking' || D?.type === 'redacted_thinking') {
          H++
        }
      } else if (N.type === 'user') {
        if (E) {
          E.messages.push(N as CollapsedReadSearchGroup['messages'][number])
          const D = N.toolUseResult
          const W =
            D?.toolStats ??
            (D?.status === 'async_launched' && D.agentId
              ? getAgentToolStats?.(D.agentId)
              : undefined)
          if (W) applyToolStats(E, W)
        }
      }
      if (N.type === 'attachment') H++
      if ($) {
        if (E) mergeCollapsed(E, $)
        else {
          E = {
            ...$,
            messages: [...$.messages],
            readFilePaths: [...($.readFilePaths ?? [])],
            searchArgs: [...($.searchArgs ?? [])],
          }
          b = O
        }
      }
    }

    if (g !== -1) keepIdx.add(g)
    for (const O of y) keepIdx.add(O)

    const k: Array<[number, FocusTranscriptMessage]> = [...keepIdx].map(O => [
      O,
      messages[O]!,
    ])
    flush()
    for (const [O, N] of x) {
      const brief = {
        ...N,
        uuid: `brief-${String(N.uuid)}` as UUID,
        hookCount: undefined,
        hookTotalMs: undefined,
        hookInfos: undefined,
      } as CollapsedReadSearchGroup
      if (pendingText && N === x.at(-1)?.[1]) {
        ;(brief as { pendingText?: string }).pendingText = pendingText
      }
      k.push([O, brief as unknown as FocusTranscriptMessage])
    }
    k.sort((left, right) => left[0] - right[0])

    // hiddenCount = bodyLen + absorbedNotifs - kept - noise
    const bodyLen = f - bodyStart
    const P =
      m || keepAllText ? 0 : Math.max(0, bodyLen + p.length - k.length - H)
    for (const [, O] of k) {
      if (P > 0 && O.type === 'system' && O.subtype === 'turn_duration') {
        out.push({ ...O, briefHiddenCount: P } as T)
      } else {
        out.push(O as T)
      }
    }
    a = f
  }
  return out
}
