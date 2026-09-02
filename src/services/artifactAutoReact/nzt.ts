/**
 * densable Ttn / nzt portable — Artifact tool_use action:"reply" turn (2.1.239).
 *
 * densable `nzt` ≡ tip `runToolUse` (permission / MCP / isolation ring). When a
 * NztHost (or per-call canUseTool) is available, tip drains runToolUse; else
 * falls back to ArtifactTool.call (same tool surface, no interactive UI).
 */
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import { un } from './store.js'

export type NztToolUse = {
  type: 'tool_use'
  id: string
  name: string
  input: {
    action: 'reply'
    url: string
    thread_id: string
    text: string
    answers_summon?: boolean
    continues_reply_id?: string
  }
}

export type NztYield = {
  message: {
    type: 'user'
    message?: { content: unknown[] }
    toolUseResult?: Record<string, unknown> | string
    toolDenialKind?: string
  }
}

export type TtnResult =
  | { kind: 'posted'; commentId?: string; epoch: number }
  | { kind: 'refused'; denial?: string }
  | { kind: 'answered_elsewhere' }
  | { kind: 'summon_foreign' }
  | { kind: 'answered_post_time' }
  | { kind: 'not_activated' }
  | { kind: 'no_result' }
  | { kind: 'unexpected_result_shape' }

export type NztRunner = (
  toolUse: NztToolUse,
  signal: AbortSignal,
) => AsyncGenerator<NztYield>

/** densable nzt host — wires tip runToolUse (permissions / MCP / isolation). */
export type NztHost = {
  getToolUseContext: () => ToolUseContext | null
  canUseTool: CanUseToolFn
  getParentAssistantMessage?: () => AssistantMessage | null
}

let nztRunner: NztRunner | null = null
let nztHost: NztHost | null = null

export function setNztRunner(runner: NztRunner | null): void {
  nztRunner = runner
}

export function setNztHost(host: NztHost | null): void {
  nztHost = host
}

export function getNztHost(): NztHost | null {
  return nztHost
}

export function resetNztRunnerForTests(): void {
  nztRunner = null
  nztHost = null
}

function abortControllerFromSignal(signal: AbortSignal): AbortController {
  const c = new AbortController()
  if (signal.aborted) c.abort()
  else signal.addEventListener('abort', () => c.abort(), { once: true })
  return c
}

/** densable EP — allow after actGates probe already said allow. */
export const allowAllCanUseTool: CanUseToolFn = async (
  _tool,
  input,
  _ctx,
  _assistant,
  _id,
) => ({
  behavior: 'allow',
  updatedInput: input,
})

async function* nztViaRunToolUse(
  toolUse: NztToolUse,
  signal: AbortSignal,
  host: NztHost,
  canUseTool: CanUseToolFn,
): AsyncGenerator<NztYield> {
  const ctx = host.getToolUseContext()
  if (!ctx?.options?.tools) {
    yield* nztViaArtifactToolCall(toolUse, signal)
    return
  }
  const linked = abortControllerFromSignal(signal)
  const toolUseContext: ToolUseContext = {
    ...ctx,
    abortController: linked,
  }
  const { runToolUse } = await import('../tools/toolExecution.js')
  const { createAssistantMessage } = await import('../../utils/messages.js')
  const parent =
    host.getParentAssistantMessage?.() ??
    createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
          caller: { type: 'direct' },
        },
      ],
    })
  for await (const update of runToolUse(
    {
      type: 'tool_use',
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
      caller: { type: 'direct' },
    },
    parent,
    canUseTool,
    toolUseContext,
  )) {
    if (!update.message) continue
    yield { message: update.message as NztYield['message'] }
  }
}

async function* nztViaArtifactToolCall(
  toolUse: NztToolUse,
  signal: AbortSignal,
): AsyncGenerator<NztYield> {
  const input = toolUse.input
  try {
    const { ArtifactTool } = await import(
      '@claude-code/builtin-tools/tools/ArtifactTool/ArtifactTool.js'
    )
    const result = await ArtifactTool.call(
      {
        action: 'reply',
        url: input.url,
        thread_id: input.thread_id,
        text: input.text,
        ...(input.answers_summon === true ? { answers_summon: true } : {}),
        ...(input.continues_reply_id !== undefined
          ? { continues_reply_id: input.continues_reply_id }
          : {}),
      },
      { abortController: abortControllerFromSignal(signal) },
    )
    const data = (result?.data ?? {}) as Record<string, unknown>
    if (data.error && data.replied !== true) {
      yield {
        message: {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                is_error: true,
                content: String(data.error),
              },
            ],
          },
          toolUseResult: `Error: ${String(data.error)}`,
          toolDenialKind: 'error',
        },
      }
      return
    }
    yield {
      message: {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: 'ok',
            },
          ],
        },
        toolUseResult: data,
      },
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    yield {
      message: {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              is_error: true,
              content: message,
            },
          ],
        },
        toolUseResult: `Error: ${message}`,
        toolDenialKind: 'error',
      },
    }
  }
}

export async function* defaultNztReply(
  toolUse: NztToolUse,
  signal: AbortSignal,
  opts?: { canUseTool?: CanUseToolFn },
): AsyncGenerator<NztYield> {
  if (toolUse.input.action !== 'reply') {
    yield {
      message: {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              is_error: true,
              content: 'unsupported action',
            },
          ],
        },
        toolUseResult: 'Error: unsupported action',
        toolDenialKind: 'error',
      },
    }
    return
  }
  const host = nztHost
  const can = opts?.canUseTool ?? host?.canUseTool
  if (host && can && host.getToolUseContext()?.options?.tools) {
    yield* nztViaRunToolUse(toolUse, signal, host, can)
    return
  }
  yield* nztViaArtifactToolCall(toolUse, signal)
}

/**
 * densable Ttn — synthesize tool_use action:reply and drain nzt for result.
 */
export async function Ttn(input: {
  toolName?: string
  url: string
  slug: string
  threadId: string
  text: string
  signal: AbortSignal
  answersSummon?: boolean
  continuesReplyId?: string
  postSlug?: string
  /** densable e.canUseTool — defaults to EP when host is wired after probe allow. */
  canUseTool?: CanUseToolFn
}): Promise<TtnResult> {
  const epoch = un().accountEpoch
  const id = `autoreact-${input.threadId}-${un().autoReact.postSeq++}`
  const toolUse: NztToolUse = {
    type: 'tool_use',
    id,
    name: input.toolName ?? 'Artifact',
    input: {
      action: 'reply',
      url: input.url,
      thread_id: input.threadId,
      text: input.text,
      ...(input.answersSummon === true ? { answers_summon: true } : {}),
      ...(input.continuesReplyId !== undefined
        ? { continues_reply_id: input.continuesReplyId }
        : {}),
    },
  }

  const canUseTool =
    input.canUseTool ?? (nztHost ? allowAllCanUseTool : undefined)

  const runner =
    nztRunner ??
    ((tu: NztToolUse, sig: AbortSignal) =>
      defaultNztReply(tu, sig, canUseTool ? { canUseTool } : undefined))

  let result: TtnResult = { kind: 'no_result' }
  try {
    for await (const m of runner(toolUse, input.signal)) {
      const msg = m.message
      if (msg?.type !== 'user' || !Array.isArray(msg.message?.content)) continue
      const block = msg.message.content.find(
        (b): b is { type: string; tool_use_id?: string; is_error?: boolean } =>
          typeof b === 'object' &&
          b !== null &&
          (b as { type?: string }).type === 'tool_result' &&
          (b as { tool_use_id?: string }).tool_use_id === id,
      )
      if (!block) continue
      if (block.is_error === true) {
        result = { kind: 'refused', denial: msg.toolDenialKind }
        continue
      }
      const y = msg.toolUseResult
      if (y && typeof y === 'object' && y.replied === true) {
        result = {
          kind: 'posted',
          commentId:
            typeof y.comment_id === 'string' ? y.comment_id : undefined,
          epoch,
        }
      } else if (
        y &&
        typeof y === 'object' &&
        y.replied === false &&
        y.summon_answered === true
      ) {
        result = { kind: 'answered_elsewhere' }
      } else if (
        y &&
        typeof y === 'object' &&
        y.replied === false &&
        y.summon_foreign === true
      ) {
        result = { kind: 'summon_foreign' }
      } else if (
        y &&
        typeof y === 'object' &&
        y.replied === false &&
        y.already_answered === true
      ) {
        result = { kind: 'answered_post_time' }
      } else if (y && typeof y === 'object' && y.replied === false) {
        result = { kind: 'not_activated' }
      } else {
        result = { kind: 'unexpected_result_shape' }
      }
    }
  } catch {
    result = { kind: 'refused', denial: 'error' }
  }
  return result
}
