import { randomUUID } from 'crypto'
import type { HookOriginEntry } from 'src/utils/plugins/functionHooksModules.js'
import {
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from 'src/utils/plugins/functionHooksModules.js'
import { logForDebugging } from 'src/utils/debug.js'

export type SubagentTurnUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model: string
}

export type SubagentTurnRefusal = {
  category: string | null
  explanation: string | null
}

export type SubagentTurnTracker = {
  saw: (message: unknown) => void
  ended: (opts: {
    isAborted: boolean
    hasFailed: boolean
    report?: string
  }) => void
  [Symbol.dispose]: () => void
}

const NOOP_TRACKER: SubagentTurnTracker = Object.freeze({
  saw: () => {},
  ended: () => {},
  [Symbol.dispose]: () => {},
})

function hasAnyTurnHook(): boolean {
  try {
    return (
      hasMatchingFunctionHook('turn.start') ||
      hasMatchingFunctionHook('turn.step') ||
      hasMatchingFunctionHook('turn.complete')
    )
  } catch {
    return false
  }
}

function extractRefusal(message: unknown): SubagentTurnRefusal | undefined {
  if (typeof message !== 'object' || message === null) return undefined
  const m = message as {
    type?: unknown
    subtype?: unknown
    apiRefusalCategory?: unknown
    apiRefusalExplanation?: unknown
    isApiErrorMessage?: unknown
    message?: {
      stop_reason?: unknown
      stop_details?: { category?: unknown; explanation?: unknown }
    }
  }
  if (m.type === 'system' && m.subtype === 'model_refusal_no_fallback') {
    return {
      category:
        typeof m.apiRefusalCategory === 'string' ? m.apiRefusalCategory : null,
      explanation:
        typeof m.apiRefusalExplanation === 'string'
          ? m.apiRefusalExplanation
          : null,
    }
  }
  if (
    m.type === 'assistant' &&
    m.isApiErrorMessage === true &&
    m.message?.stop_reason === 'refusal'
  ) {
    return {
      category:
        typeof m.message.stop_details?.category === 'string'
          ? m.message.stop_details.category
          : null,
      explanation:
        typeof m.message.stop_details?.explanation === 'string'
          ? m.message.stop_details.explanation
          : null,
    }
  }
  return undefined
}

function extractAssistantText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('\n').trim()
}

function extractUsage(message: unknown): SubagentTurnUsage | undefined {
  if (typeof message !== 'object' || message === null) return undefined
  const m = message as {
    type?: unknown
    isUnmetered?: unknown
    message?: {
      model?: unknown
      usage?: {
        input_tokens?: unknown
        output_tokens?: unknown
        cache_read_input_tokens?: unknown
        cache_creation_input_tokens?: unknown
      }
    }
  }
  if (m.type !== 'assistant' || m.isUnmetered === true) return undefined
  const u = m.message?.usage
  if (!u || typeof m.message?.model !== 'string') return undefined
  return {
    input_tokens: typeof u.input_tokens === 'number' ? u.input_tokens : 0,
    output_tokens: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
    cache_read_input_tokens:
      typeof u.cache_read_input_tokens === 'number'
        ? u.cache_read_input_tokens
        : 0,
    cache_creation_input_tokens:
      typeof u.cache_creation_input_tokens === 'number'
        ? u.cache_creation_input_tokens
        : 0,
    model: m.message.model,
  }
}

function sumUsage(
  usages: Iterable<SubagentTurnUsage>,
): SubagentTurnUsage | undefined {
  let acc: SubagentTurnUsage | undefined
  for (const u of usages) {
    acc = {
      input_tokens: (acc?.input_tokens ?? 0) + u.input_tokens,
      output_tokens: (acc?.output_tokens ?? 0) + u.output_tokens,
      cache_read_input_tokens:
        (acc?.cache_read_input_tokens ?? 0) + u.cache_read_input_tokens,
      cache_creation_input_tokens:
        (acc?.cache_creation_input_tokens ?? 0) + u.cache_creation_input_tokens,
      model: u.model,
    }
  }
  return acc
}

export type SubagentTurnHooksDeps = {
  hasAnyTurnHook?: () => boolean
  runHookChain?: typeof runFunctionHookChain
}

/**
 * densable 2.1.290 #40 `$d` + `_i`:
 * Track a subagent turn's assistant messages, refusal, usage, and emit
 * `turn.start` + `turn.complete` (`answer: report ?? lastAnswerText`).
 */
export function createSubagentTurnHookTracker(
  params: {
    text: string
    agentId: string
    signal: AbortSignal
    hookOrigin?: readonly HookOriginEntry[]
  },
  deps?: SubagentTurnHooksDeps,
): SubagentTurnTracker {
  const checkHooks = deps?.hasAnyTurnHook ?? hasAnyTurnHook
  if (!checkHooks()) return NOOP_TRACKER

  const runChain = deps?.runHookChain ?? runFunctionHookChain
  const { text, agentId, signal, hookOrigin } = params
  const turnId = randomUUID()
  const startedAt = Date.now()
  const usageByMsgId = new Map<string, SubagentTurnUsage>()

  let lastAssistant: { message?: { id?: string } } | undefined
  let lastAnswerText = ''
  let endedInApiError = false
  let refusal: SubagentTurnRefusal | undefined
  let endedOnce = false

  const startAbort = new AbortController()
  const startSignal = AbortSignal.any([signal, startAbort.signal])

  const startedPromise = (async () => {
    try {
      await runChain(
        'turn.start',
        { text, turnId, agentId },
        async event => event,
        undefined,
        undefined,
        { signal: startSignal, hookOrigin },
      )
    } catch (err) {
      logForDebugging(`turn.start (agent ${agentId}): ${err}`, {
        level: 'warn',
      })
    }
  })()

  function flushUsage(msg: { message?: { id?: string } } | undefined): void {
    const id = msg?.message?.id
    const usage = msg ? extractUsage(msg) : undefined
    if (id && usage) {
      usageByMsgId.set(id, usage)
    }
  }

  function ended(opts: {
    isAborted: boolean
    hasFailed: boolean
    report?: string
  }): void {
    const { isAborted, hasFailed, report } = opts
    if (endedOnce) return
    endedOnce = true
    flushUsage(lastAssistant)

    const answer = report ?? lastAnswerText
    const usage = sumUsage(usageByMsgId.values())
    const durationMs = Date.now() - startedAt
    const outcome = isAborted
      ? { reason: 'aborted' as const }
      : refusal
        ? { reason: 'refusal' as const, refusal }
        : {
            reason:
              hasFailed || endedInApiError
                ? ('error' as const)
                : ('answer' as const),
          }

    const awaitStartThenCancel = async () => {
      await startedPromise
      startAbort.abort()
    }

    try {
      void awaitStartThenCancel()
        .then(() =>
          runChain(
            'turn.complete',
            {
              answer,
              durationMs,
              isAborted,
              turnId,
              agentId,
              ...outcome,
              ...(usage ? { usage } : {}),
            },
            async event => ({
              text: typeof event.answer === 'string' ? event.answer : answer,
            }),
            undefined,
            undefined,
            { hookOrigin },
          ),
        )
        .catch(err => {
          logForDebugging(`turn.complete (agent ${agentId}): ${err}`, {
            level: 'warn',
          })
        })
    } catch (err) {
      logForDebugging(`turn.complete (agent ${agentId}): not raised: ${err}`, {
        level: 'error',
      })
    }
  }

  return {
    saw(message: unknown) {
      refusal = extractRefusal(message) ?? refusal
      if (typeof message !== 'object' || message === null) return
      const m = message as {
        type?: unknown
        isVirtual?: unknown
        isApiErrorMessage?: unknown
        message?: { id?: string; content?: unknown }
      }
      if (!(m.type === 'assistant' && !m.isVirtual)) return
      if (lastAssistant?.message?.id !== m.message?.id) {
        flushUsage(lastAssistant)
      }
      lastAssistant = m
      endedInApiError = m.isApiErrorMessage === true
      if (!endedInApiError) {
        lastAnswerText = extractAssistantText(m.message?.content)
      }
    },
    ended,
    [Symbol.dispose]() {
      ended({ isAborted: signal.aborted, hasFailed: !signal.aborted })
    },
  }
}
