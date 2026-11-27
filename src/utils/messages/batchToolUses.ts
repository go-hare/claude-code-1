/**
 * Batched tool-use decomposition, reassembly, result merging, and underlying v1 tool hiding.
 */

import type {
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js'
import {
  type BatchTool,
  findToolByName,
  isBatchTool,
  type Tools,
} from '../../Tool.js'
import type { AssistantMessage, UserMessage } from '../../types/message.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import type { NormalizedApiMessage } from './messageMerging.js'

/** densable `Jzr` — batched synthetic tool_use / tool_result id suffix */
const BATCH_ENTRY_ID_RE = /_(\d+)$/

/** densable `lWt` */
function batchEntryId(parentId: string, index: number): string {
  return `${parentId}_${index}`
}

/** densable `Pwe` — parent id if `id` is `${parent}_${n}` */
function batchEntryParentId(id: string): string | undefined {
  const m = BATCH_ENTRY_ID_RE.exec(id)
  return m ? id.slice(0, -m[0].length) : undefined
}

type BatchEntrySlot = {
  input?: unknown
  result?: ToolResultBlockParam
  error?: string
}

/** densable `eDs` */
function expandBatchEntrySlots(
  tool: BatchTool | undefined,
  input: unknown,
  parentId: string,
  results: Map<string, ToolResultBlockParam>,
): BatchEntrySlot[] {
  let entries: unknown[] | undefined
  if (tool !== undefined) {
    try {
      const parsed = tool.inputSchema.safeParse(input)
      if (parsed.success) {
        entries = tool.perEntryHookInputs(parsed.data).entries
      }
    } catch {
      // official eDs swallows parse / perEntryHookInputs throws
    }
  }
  let size = entries?.length ?? 0
  for (const key of results.keys()) {
    const m = BATCH_ENTRY_ID_RE.exec(key)
    if (m) size = Math.max(size, Number(m[1]) + 1)
  }
  return Array.from({ length: size }, (_, i) => {
    const result = results.get(batchEntryId(parentId, i))
    return result !== undefined
      ? { input: entries?.[i], result }
      : { input: entries?.[i], error: 'no result' }
  })
}

type ToolResultPart = Exclude<
  NonNullable<ToolResultBlockParam['content']>,
  string
>[number]

/** densable `tDs` */
function assembleBatchedToolResult(
  tool: BatchTool | undefined,
  parentId: string,
  slots: BatchEntrySlot[],
): ToolResultBlockParam {
  const blocks: ToolResultPart[] = []
  let textBuf = ''
  let anyError = false
  const appendText = (chunk: string): void => {
    if (chunk.length > 0) {
      textBuf = textBuf === '' ? chunk : `${textBuf}\n${chunk}`
    }
  }
  const flushText = (): void => {
    if (textBuf !== '') {
      blocks.push({ type: 'text', text: textBuf })
      textBuf = ''
    }
  }
  for (const [i, slot] of slots.entries()) {
    const failed = slot.result === undefined || slot.result.is_error === true
    if (failed) anyError = true
    appendText(`--- entry ${i + 1}${failed ? ' (error)' : ''} ---`)
    if (slot.result !== undefined) {
      const content = slot.result.content
      if (typeof content === 'string') {
        appendText(content)
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text') appendText(part.text)
          else {
            flushText()
            blocks.push(part)
          }
        }
      }
    } else {
      appendText(`[entry ${i + 1} error: ${slot.error ?? 'no result'}]`)
    }
  }
  if (slots.length === 1 && tool !== undefined) {
    appendText(
      `<system-reminder>Tip: ${tool.name} accepts multiple entries in one call (\`${tool.entryFieldName}: [{...}, {...}]\`). Batching related operations into a single call is faster than issuing them as separate or parallel calls. No action needed for this result.</system-reminder>`,
    )
  }
  flushText()
  return {
    type: 'tool_result',
    tool_use_id: parentId,
    content:
      blocks.length === 1 && blocks[0]?.type === 'text'
        ? blocks[0].text
        : blocks,
    ...(anyError ? { is_error: true } : {}),
  }
}

/**
 * densable `tHr` — merge per-entry `tool_result` (`${parent}_n`) back onto
 * the parent `tool_use` id. Fast-path no-op unless a batch tool is present
 * or a result id has the `_n` suffix.
 */
export function mergeBatchedToolResults(
  messages: NormalizedApiMessage[],
  tools: Tools,
): NormalizedApiMessage[] {
  let needed = false
  for (const msg of messages) {
    if (msg.type === 'assistant' && Array.isArray(msg.message.content)) {
      for (const block of msg.message.content) {
        if (typeof block !== 'string' && block.type === 'tool_use') {
          const tool = findToolByName(tools, block.name)
          if (tool !== undefined && isBatchTool(tool)) needed = true
        }
      }
    }
    if (msg.type === 'user' && !needed) {
      if (
        Array.isArray(msg.message.content) &&
        msg.message.content.some(
          b =>
            b.type === 'tool_result' &&
            batchEntryParentId(b.tool_use_id) !== undefined,
        )
      ) {
        needed = true
      }
    }
  }
  if (!needed) return messages

  const toolUses = new Map<string, ToolUseBlockParam>()
  for (const msg of messages) {
    if (msg.type !== 'assistant' || !Array.isArray(msg.message.content)) {
      continue
    }
    for (const block of msg.message.content) {
      if (typeof block !== 'string' && block.type === 'tool_use') {
        toolUses.set(block.id, block)
      }
    }
  }

  const resultsByParent = new Map<string, Map<string, ToolResultBlockParam>>()
  for (const msg of messages) {
    if (msg.type !== 'user' || !Array.isArray(msg.message.content)) continue
    for (const block of msg.message.content) {
      if (block.type !== 'tool_result') continue
      const parentId = batchEntryParentId(block.tool_use_id)
      if (parentId === undefined || !toolUses.has(parentId)) continue
      let byEntry = resultsByParent.get(parentId)
      if (byEntry === undefined) {
        byEntry = new Map()
        resultsByParent.set(parentId, byEntry)
      }
      if (!byEntry.has(block.tool_use_id)) {
        byEntry.set(block.tool_use_id, block)
      }
    }
  }
  if (resultsByParent.size === 0) return messages

  const mergedParents = new Set<string>()
  return messages.flatMap(msg => {
    if (msg.type !== 'user' || !Array.isArray(msg.message.content)) {
      return [msg]
    }
    let touched = false
    const next: unknown[] = []
    for (const block of msg.message.content) {
      if (block.type !== 'tool_result') {
        next.push(block)
        continue
      }
      const parentId = batchEntryParentId(block.tool_use_id)
      const entryMap =
        parentId !== undefined ? resultsByParent.get(parentId) : undefined
      if (parentId === undefined || entryMap === undefined) {
        next.push(block)
        continue
      }
      touched = true
      if (mergedParents.has(parentId)) continue
      mergedParents.add(parentId)
      const toolUse = toolUses.get(parentId)
      const found =
        toolUse !== undefined ? findToolByName(tools, toolUse.name) : undefined
      const batch =
        found !== undefined && isBatchTool(found) ? found : undefined
      next.push(
        assembleBatchedToolResult(
          batch,
          parentId,
          expandBatchEntrySlots(batch, toolUse?.input, parentId, entryMap),
        ),
      )
    }
    if (!touched) return [msg]
    if (next.length === 0) return []
    return [
      {
        ...msg,
        message: {
          ...msg.message,
          content: next as unknown as UserMessage['message']['content'],
        },
      },
    ]
  })
}

type BatchToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
  caller?: unknown
}

function isBatchToolUseBlock(block: unknown): block is BatchToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_use' &&
    typeof (block as { id?: unknown }).id === 'string' &&
    typeof (block as { name?: unknown }).name === 'string'
  )
}

function logBatchToolsEvent(
  toolName: string,
  reason?:
    | 'parse_failed'
    | 'zero_entries'
    | 'per_entry_threw'
    | 'reassemble_threw',
): void {
  logEvent('batch_tools', {
    ...(reason !== undefined && {
      reason:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    tool_name: sanitizeToolNameForAnalytics(toolName),
    isMcp: false,
  })
}

/**
 * densable `QOs` — expand one Batch* tool_use into per-entry v1 synthetics.
 * Fail paths (`parse_failed` / `zero_entries` / `per_entry_threw`) emit one
 * `${id}_0` still named the batch tool and `decomposed: false`.
 */
function decomposeBatchedToolUse(
  block: BatchToolUseBlock,
  tools: Tools,
): { synthetics: BatchToolUseBlock[]; decomposed: boolean } | null {
  const tool = findToolByName(tools, block.name)
  if (tool === undefined || !isBatchTool(tool)) return null
  const fail = (
    reason: 'parse_failed' | 'zero_entries' | 'per_entry_threw',
  ): BatchToolUseBlock[] => {
    logBatchToolsEvent(tool.name, reason)
    return [
      {
        type: 'tool_use',
        id: batchEntryId(block.id, 0),
        name: tool.name,
        input: block.input,
        ...(block.caller !== undefined && { caller: block.caller }),
      },
    ]
  }
  try {
    const parsed = tool.inputSchema.safeParse(block.input)
    if (!parsed.success) {
      return { synthetics: fail('parse_failed'), decomposed: false }
    }
    const { v1Tool, entries } = tool.perEntryHookInputs(parsed.data)
    if (entries.length === 0) {
      return { synthetics: fail('zero_entries'), decomposed: false }
    }
    return {
      decomposed: true,
      synthetics: entries.map((entry, index) => ({
        type: 'tool_use' as const,
        id: batchEntryId(block.id, index),
        name: v1Tool.name,
        input: entry,
        ...(block.caller !== undefined && { caller: block.caller }),
      })),
    }
  } catch {
    return { synthetics: fail('per_entry_threw'), decomposed: false }
  }
}

/**
 * densable `qXe` — walk content; replace Batch* tool_use with QOs synthetics.
 * `batchToolUses` is only pushed when `decomposed` is true.
 */
export function decomposeBatchedToolUses<T>(
  content: T[],
  tools: Tools,
): {
  content: T[]
  batchToolUses: NonNullable<AssistantMessage['batchToolUses']>
} {
  let next: T[] | undefined
  const batchToolUses: NonNullable<AssistantMessage['batchToolUses']> = []
  for (let i = 0; i < content.length; i++) {
    const block = content[i]
    if (!isBatchToolUseBlock(block)) {
      next?.push(block as T)
      continue
    }
    const result = decomposeBatchedToolUse(block, tools)
    if (result === null) {
      next?.push(block as T)
      continue
    }
    next ??= content.slice(0, i)
    next.push(...(result.synthetics as T[]))
    if (result.decomposed) {
      batchToolUses.push({ id: block.id, name: block.name })
      logBatchToolsEvent(block.name)
    }
  }
  return { content: next ?? content, batchToolUses }
}

/** densable `JOs.of(hn().host)` — one `reassemble_threw` per parent id. */
const fallbackReassembleHost: object = {}

const reassembleThrewLoggedByHost = new HostSlot<Set<string>>(() => new Set())

function getReassembleThrewLogged(): Set<string> {
  try {
    const host = getBootstrapSessionHost()
    if (host) return reassembleThrewLoggedByHost.of(host)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return reassembleThrewLoggedByHost.of(fallbackReassembleHost)
}

/**
 * densable `eHr` — inverse of QOs. Group `${parent}_n` synthetics listed in
 * `batchToolUses` and `tool.reassemble(inputs)` back to the parent tool_use.
 */
export function reassembleBatchedToolUses<T>(
  content: T[],
  batchToolUses: AssistantMessage['batchToolUses'],
  tools: Tools,
): T[] {
  if (batchToolUses === undefined || batchToolUses.length === 0) {
    return content
  }
  const parents = new Map<
    string,
    NonNullable<AssistantMessage['batchToolUses']>[number]
  >()
  for (const ref of batchToolUses) {
    if (!parents.has(ref.id)) parents.set(ref.id, ref)
  }
  const reassembled = new Map<string, T>()
  for (const ref of parents.values()) {
    const tool = findToolByName(tools, ref.name)
    if (tool === undefined || !isBatchTool(tool)) continue
    const inputs: unknown[] = []
    let first: BatchToolUseBlock | undefined
    for (const block of content) {
      if (
        isBatchToolUseBlock(block) &&
        batchEntryParentId(block.id) === ref.id
      ) {
        first ??= block
        inputs.push(block.input)
      }
    }
    try {
      reassembled.set(ref.id, {
        type: 'tool_use',
        id: ref.id,
        name: ref.name,
        input: tool.reassemble(inputs),
        ...(first?.caller !== undefined && { caller: first.caller }),
      } as T)
    } catch {
      const loggedSet = getReassembleThrewLogged()
      if (!loggedSet.has(ref.id)) {
        loggedSet.add(ref.id)
        logBatchToolsEvent(ref.name, 'reassemble_threw')
      }
    }
  }
  const emitted = new Set<string>()
  const out: T[] = []
  for (const block of content) {
    if (isBatchToolUseBlock(block)) {
      const parentId = batchEntryParentId(block.id)
      if (parentId !== undefined && reassembled.has(parentId)) {
        if (!emitted.has(parentId)) {
          emitted.add(parentId)
          out.push(reassembled.get(parentId) as T)
        }
        continue
      }
    }
    out.push(block)
  }
  return out
}

/**
 * densable `Qzr` — when any Batch* tool is present, drop tools whose name is
 * an `underlyingV1ToolName` so the model sees the wrapper, not the v1 tool.
 */
export function hideUnderlyingV1Tools(tools: Tools): Tools {
  let hidden: Set<string> | undefined
  for (const tool of tools) {
    if (isBatchTool(tool)) {
      hidden ??= new Set()
      hidden.add(tool.underlyingV1ToolName)
    }
  }
  if (hidden === undefined) return tools
  return tools.filter(tool => !hidden.has(tool.name))
}
