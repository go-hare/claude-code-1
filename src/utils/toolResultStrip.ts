/**
 * densable residual: tool.stripForStorage + evo() memory strip helper.
 *
 * Official keeps only the most recent `keepRecent` messages' toolUseResult
 * payloads full; older results are rewritten via per-tool stripForStorage to
 * drop large fields (file contents, stdout, etc.) while preserving structure
 * for UI/resume. After full compact, densable calls with keepRecent=0 and
 * compactMode=true so Bash also empties stdout/stderr.
 */

import type { Message } from 'src/types/message.js'
import type { Tool, Tools } from 'src/Tool.js'
import { findToolByName } from 'src/Tool.js'
import { logError } from './log.js'

/** densable FileEdit strip — clear originalFile when non-empty. */
export function stripFileEditResultForStorage(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result
  const r = result as Record<string, unknown>
  if ((r.originalFile ?? '') === '') return result
  return { ...r, originalFile: '' }
}

/**
 * densable FileWrite strip — only type==="update" drops content + originalFile.
 * create results keep content (needed for UI); update already has structuredPatch.
 */
export function stripFileWriteResultForStorage(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result
  const r = result as Record<string, unknown>
  if (r.type !== 'update') return result
  if (r.content === '' && (r.originalFile ?? '') === '') return result
  return { ...r, content: '', originalFile: null }
}

/**
 * densable nHd/WBy — when persisting toolUseResult to transcript, drop
 * originalFile payloads larger than 10k chars (FileEdit/FileWrite often embed
 * full prior file contents). In-memory messages keep the full field until evo.
 */
export const MAX_PERSISTED_ORIGINAL_FILE_CHARS = 10_000

export function stripOversizedOriginalFileForPersistence(
  result: unknown,
): unknown {
  if (typeof result !== 'object' || result === null) return result
  const r = result as Record<string, unknown>
  if (
    typeof r.originalFile === 'string' &&
    r.originalFile.length > MAX_PERSISTED_ORIGINAL_FILE_CHARS
  ) {
    return { ...r, originalFile: null }
  }
  return result
}

/**
 * densable NotebookEdit strip — densable clears content+originalFile on update.
 * Local schema uses new_source / original_file / updated_file.
 */
export function stripNotebookEditResultForStorage(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result
  const r = result as Record<string, unknown>
  // densable shape
  if (r.type === 'update') {
    if (r.content === '' && (r.originalFile ?? '') === '') return result
    return { ...r, content: '', originalFile: null }
  }
  // local shape
  const original = r.original_file ?? r.originalFile
  const updated = r.updated_file ?? r.updatedFile
  const source = r.new_source ?? r.content
  if (
    (original ?? '') === '' &&
    (updated ?? '') === '' &&
    (source ?? '') === ''
  ) {
    return result
  }
  return {
    ...r,
    ...('new_source' in r ? { new_source: '' } : {}),
    ...('content' in r ? { content: '' } : {}),
    ...('original_file' in r ? { original_file: '' } : {}),
    ...('originalFile' in r ? { originalFile: null } : {}),
    ...('updated_file' in r ? { updated_file: '' } : {}),
    ...('updatedFile' in r ? { updatedFile: '' } : {}),
  }
}

/** densable Bash strip — only when compactMode (full strip after compact). */
export function stripBashResultForStorage(
  result: unknown,
  compactMode?: boolean,
): unknown {
  if (!compactMode) return result
  if (typeof result !== 'object' || result === null) return result
  const r = result as Record<string, unknown>
  if (typeof r.stdout !== 'string' || typeof r.stderr !== 'string') return result
  if (r.stdout === '' && r.stderr === '') return result
  return { ...r, stdout: '', stderr: '' }
}

/** densable FileRead strip — empty large payload fields by type. */
export function stripFileReadResultForStorage(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result
  const r = result as Record<string, unknown>
  if (typeof r.file !== 'object' || r.file === null) return result
  const file = r.file as Record<string, unknown>
  switch (r.type) {
    case 'text':
      if (file.content === '') return result
      return { ...r, file: { ...file, content: '' } }
    case 'image':
      if (file.base64 === '') return result
      return { ...r, file: { ...file, base64: '' } }
    case 'pdf':
      if (file.base64 === '') return result
      return { ...r, file: { ...file, base64: '' } }
    case 'notebook': {
      const cells = file.cells
      if (!Array.isArray(cells) || cells.length === 0 || cells[0] == null) {
        return result
      }
      return { ...r, file: { ...file, cells: Array(cells.length) } }
    }
    default:
      return result
  }
}

function isToolResultBlock(
  b: unknown,
): b is { type: 'tool_result'; tool_use_id: string; content?: unknown } {
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as { type?: string }).type === 'tool_result' &&
    typeof (b as { tool_use_id?: unknown }).tool_use_id === 'string'
  )
}

/**
 * densable evo — strip toolUseResult (and optionally nested progress tool
 * results) for messages older than the last `keepRecent` entries.
 *
 * @param messages conversation messages
 * @param tools tool list for findToolByName
 * @param keepRecent number of trailing messages to leave untouched (default 200)
 * @param compactMode when true, also strip progress nests + Bash stdout/stderr
 */
export function stripOldToolUseResultsForStorage(
  messages: Message[],
  tools: Tools,
  keepRecent = 200,
  compactMode = false,
): Message[] {
  const cut = messages.length - keepRecent
  if (cut <= 0) return messages

  const stripTools = new Map<string, Tool>()
  let out: Message[] | undefined

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!

    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message!.content as unknown[]) {
        if (
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: string }).type === 'tool_use' &&
          typeof (block as { name?: unknown }).name === 'string' &&
          typeof (block as { id?: unknown }).id === 'string'
        ) {
          const tool = findToolByName(tools, (block as { name: string }).name)
          if (tool?.stripForStorage) {
            stripTools.set((block as { id: string }).id, tool)
          }
        }
      }
      continue
    }

    // densable progress nest strip under compactMode for agent/skill progress.
    if (compactMode && i < cut && msg.type === 'progress') {
      const data = msg.data as Record<string, unknown> | undefined
      if (
        data &&
        (data.type === 'agent_progress' || data.type === 'skill_progress')
      ) {
        const inner = data.message as Record<string, unknown> | undefined
        if (inner?.type === 'user') {
          const content = (inner.message as { content?: unknown } | undefined)
            ?.content
          const content0 = Array.isArray(content) ? content[0] : undefined
          if (
            isToolResultBlock(content0) &&
            content0.content !== '' &&
            content0.content !== undefined
          ) {
            if (!out) out = messages.slice()
            out[i] = {
              ...msg,
              data: {
                ...data,
                message: {
                  ...inner,
                  message: {
                    role: 'user',
                    content: [{ ...content0, content: '' }],
                  },
                  toolUseResult: undefined,
                },
              },
            } as Message
          }
        }
      }
      continue
    }

    if (
      i >= cut ||
      msg.type !== 'user' ||
      (msg as { isVirtual?: boolean }).isVirtual ||
      msg.toolUseResult == null ||
      !Array.isArray(msg.message?.content)
    ) {
      continue
    }

    const toolResult = (msg.message!.content as unknown[]).find(isToolResultBlock)
    const tool = toolResult && stripTools.get(toolResult.tool_use_id)
    if (!tool?.stripForStorage) continue

    let stripped: unknown
    try {
      stripped = tool.stripForStorage(msg.toolUseResult, compactMode)
    } catch (err) {
      logError(err)
      stripped = msg.toolUseResult
    }
    if (stripped === msg.toolUseResult) continue
    if (!out) out = messages.slice()
    out[i] = { ...msg, toolUseResult: stripped } as Message
  }

  return out ?? messages
}

export function getOriginalMessageBeforeStrip(
  stripped: object,
): object | undefined {
  return strippedToOriginalMessage.get(stripped)?.deref()
}
