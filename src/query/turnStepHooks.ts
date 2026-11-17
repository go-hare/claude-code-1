import { randomUUID } from 'crypto'
import type {
  AssistantMessage,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage, isAbortError } from '../utils/errors.js'
import { getMainThreadTurn } from '../utils/mainThreadTurn.js'
import { createAssistantMessage } from '../utils/messages.js'
import type { QueryDeps } from './deps.js'

type TurnStepStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'compaction'
  | 'refusal'
  | 'model_context_window_exceeded'
  | null

type TurnStepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model: string
}

type TurnStepChunk =
  | { kind: 'engine'; ref: number }
  | { kind: 'text'; index: number; text: string; ref?: number }
  | { kind: 'thinking'; index: number; text: string; ref?: number }
  | { kind: 'tool'; index: number; id: string; name: string; ref?: number }
  | { kind: 'input'; index: number; json: string; ref?: number }
  | {
      kind: 'stop'
      stopReason: TurnStepStopReason
      usage: TurnStepUsage | null
      ref?: number
    }

type TurnStepResult = {
  turnId: string
  index: number
  answer: string
  toolUses: Array<{ name: string; input: unknown }>
  stopReason: TurnStepStopReason
  usage: TurnStepUsage | null
}

type ModelStreamItem = StreamEvent | AssistantMessage | SystemAPIErrorMessage
export type CallModelParams = Parameters<QueryDeps['callModel']>[0]

const TURN_STOP_REASONS: readonly Exclude<TurnStepStopReason, null>[] = [
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
  'pause_turn',
  'compaction',
  'refusal',
  'model_context_window_exceeded',
]

function normalizeTurnStopReason(raw: unknown): TurnStepStopReason {
  if (typeof raw !== 'string') return null
  return TURN_STOP_REASONS.find(reason => reason === raw) ?? null
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function isRecordAssistantItem(
  item: ModelStreamItem,
): item is AssistantMessage {
  if (item.type !== 'assistant' || item.isApiErrorMessage === true) return false
  const msgObj: unknown = item.message
  return isPlainRecord(msgObj) && Array.isArray(msgObj.content)
}

function extractTurnUsageFromAssistant(
  msg: AssistantMessage | undefined,
  fallbackModel: string,
): TurnStepUsage | null {
  if (!msg) return null
  const msgObj: unknown = msg.message
  if (!isPlainRecord(msgObj) || !isPlainRecord(msgObj.usage)) return null
  const u = msgObj.usage
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
    model: typeof msgObj.model === 'string' ? msgObj.model : fallbackModel,
  }
}

export function getQueryFunctionHooks():
  | typeof import('../utils/plugins/functionHooksModules.js')
  | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../utils/plugins/functionHooksModules.js') as typeof import('../utils/plugins/functionHooksModules.js')
  } catch {
    return null
  }
}

function resolveTurnStepEffort(
  model: string,
  effortValue: CallModelParams['options']['effortValue'],
): CallModelParams['options']['effortValue'] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveAppliedEffort } =
      require('../utils/effort.js') as typeof import('../utils/effort.js')
    return resolveAppliedEffort(model, effortValue)
  } catch {
    return effortValue
  }
}

function parseHookToolInputJson(raw: string): Record<string, unknown> {
  if (raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // malformed JSON from hook leaves empty input
  }
  return {}
}

function turnStepChunkMatchesSent(
  chunk: TurnStepChunk,
  sent: TurnStepChunk | undefined,
): boolean {
  if (!sent || chunk.kind !== sent.kind) return false
  switch (chunk.kind) {
    case 'engine':
      return sent.kind === 'engine' && chunk.ref === sent.ref
    case 'text':
    case 'thinking':
      return (
        sent.kind === chunk.kind &&
        chunk.index === sent.index &&
        chunk.text === sent.text
      )
    case 'input':
      return (
        sent.kind === 'input' &&
        chunk.index === sent.index &&
        chunk.json === sent.json
      )
    case 'tool':
      return (
        sent.kind === 'tool' &&
        chunk.index === sent.index &&
        chunk.id === sent.id &&
        chunk.name === sent.name
      )
    case 'stop': {
      if (sent.kind !== 'stop' || chunk.stopReason !== sent.stopReason) {
        return false
      }
      if (chunk.usage === null || sent.usage === null) {
        return chunk.usage === sent.usage
      }
      return (
        chunk.usage.input_tokens === sent.usage.input_tokens &&
        chunk.usage.output_tokens === sent.usage.output_tokens &&
        chunk.usage.cache_read_input_tokens ===
          sent.usage.cache_read_input_tokens &&
        chunk.usage.cache_creation_input_tokens ===
          sent.usage.cache_creation_input_tokens &&
        chunk.usage.model === sent.usage.model
      )
    }
  }
}

const TURN_STEP_STARTED_WAIT_MS = 3000

async function waitTurnStartedForStep(
  started: Promise<void> | undefined,
  signal: AbortSignal,
): Promise<void> {
  if (!started) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<void>(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, TURN_STEP_STARTED_WAIT_MS)
    timer.unref?.()
  })
  try {
    await Promise.race([started, timeoutPromise])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function* streamTurnStepWithHooks(params: {
  hooks: typeof import('../utils/plugins/functionHooksModules.js')
  callModel: QueryDeps['callModel']
  callArgs: CallModelParams
  turnId: string
  stepIndex: number
}): AsyncGenerator<ModelStreamItem, void> {
  const { hooks, callModel, callArgs, turnId, stepIndex } = params
  if (callArgs.options.agentId === undefined) {
    await waitTurnStartedForStep(getMainThreadTurn()?.started, callArgs.signal)
  }

  const resolvedEffort = resolveTurnStepEffort(
    callArgs.options.model,
    callArgs.options.effortValue,
  )
  const stepInput: Record<string, unknown> = {
    turnId,
    index: stepIndex,
    model: callArgs.options.model,
    ...(resolvedEffort !== undefined && { effort: resolvedEffort }),
    messageCount: callArgs.messages.length,
    ...(callArgs.options.agentId !== undefined && {
      agentId: callArgs.options.agentId,
    }),
  }

  const state = {
    requests: 0,
    thrown: undefined as { error: unknown } | undefined,
  }
  const heldItems = new Map<number, ModelStreamItem>()
  const sentChunks = new Map<number, TurnStepChunk>()
  const assistantBlockIndices = new Map<number, number[]>()
  const wireBlockKinds = new Map<
    number,
    'text' | 'thinking' | 'tool' | 'other'
  >()
  const wireStreamedIndices: number[] = []
  const wireToolIdToIndex = new Map<string, number>()
  const seenEngineRecordBlocks = new Set<number>()
  let nextFallbackBlockIndex = 0
  let currentWireBlockIndex: number | undefined
  let latestEnvelopeUsageMessage: AssistantMessage | undefined

  const tailGen = async function* (
    event: Record<string, unknown>,
  ): AsyncGenerator<TurnStepChunk, TurnStepResult, unknown> {
    state.requests += 1
    state.thrown = undefined
    const nextModel =
      typeof event.model === 'string' && event.model.trim() !== ''
        ? event.model
        : callArgs.options.model
    const rawEffort = event.effort
    const hasRewrittenEffort =
      rawEffort !== resolvedEffort &&
      (rawEffort === 'low' ||
        rawEffort === 'medium' ||
        rawEffort === 'high' ||
        rawEffort === 'xhigh' ||
        rawEffort === 'max' ||
        typeof rawEffort === 'number')
    const effectiveArgs: CallModelParams =
      nextModel !== callArgs.options.model || hasRewrittenEffort
        ? {
            ...callArgs,
            options: {
              ...callArgs.options,
              model: nextModel,
              ...(hasRewrittenEffort && { effortValue: rawEffort }),
            },
          }
        : callArgs

    const answerParts: string[] = []
    const recordedToolUses: Array<{ name: string; input: unknown }> = []
    let lastAssistant: AssistantMessage | undefined

    try {
      for await (const rawItem of callModel(effectiveArgs)) {
        const ref = heldItems.size + 1
        heldItems.set(ref, rawItem)

        if (isRecordAssistantItem(rawItem)) {
          lastAssistant = rawItem
          latestEnvelopeUsageMessage = rawItem
          const msgObj: unknown = rawItem.message
          const contentArr =
            isPlainRecord(msgObj) && Array.isArray(msgObj.content)
              ? (msgObj.content as unknown[])
              : []
          const mappedIndices: number[] = []
          if (contentArr.length === 1) {
            const single = contentArr[0]
            const matchedToolIdx =
              isPlainRecord(single) &&
              single.type === 'tool_use' &&
              typeof single.id === 'string'
                ? wireToolIdToIndex.get(single.id)
                : undefined
            const resolvedIdx =
              matchedToolIdx ??
              currentWireBlockIndex ??
              nextFallbackBlockIndex++
            mappedIndices.push(resolvedIdx)
            nextFallbackBlockIndex = Math.max(
              nextFallbackBlockIndex,
              resolvedIdx + 1,
            )
          } else if (contentArr.length > 1) {
            let fallbackCursor = 0
            for (let i = 0; i < contentArr.length; i++) {
              const block = contentArr[i]
              const matchedToolIdx =
                isPlainRecord(block) &&
                block.type === 'tool_use' &&
                typeof block.id === 'string'
                  ? wireToolIdToIndex.get(block.id)
                  : undefined
              const resolvedIdx =
                matchedToolIdx ??
                (i < wireStreamedIndices.length
                  ? wireStreamedIndices[i]!
                  : Math.max(fallbackCursor, i))
              mappedIndices.push(resolvedIdx)
              fallbackCursor = Math.max(fallbackCursor, resolvedIdx + 1)
            }
            nextFallbackBlockIndex = Math.max(
              nextFallbackBlockIndex,
              fallbackCursor,
            )
          } else if (currentWireBlockIndex !== undefined) {
            mappedIndices.push(currentWireBlockIndex)
          }
          assistantBlockIndices.set(ref, mappedIndices)
          for (const idx of mappedIndices) {
            seenEngineRecordBlocks.add(idx)
          }
          for (const block of contentArr) {
            if (!isPlainRecord(block)) continue
            if (block.type === 'text' && typeof block.text === 'string') {
              answerParts.push(block.text)
            } else if (
              block.type === 'tool_use' &&
              typeof block.name === 'string'
            ) {
              recordedToolUses.push({ name: block.name, input: block.input })
            }
          }
          const engineChunk: TurnStepChunk = { kind: 'engine', ref }
          sentChunks.set(ref, engineChunk)
          yield engineChunk
          continue
        }

        if (rawItem.type === 'stream_event' && isPlainRecord(rawItem.event)) {
          const ev = rawItem.event
          if (ev.type === 'message_start') {
            wireBlockKinds.clear()
            wireStreamedIndices.length = 0
            wireToolIdToIndex.clear()
            nextFallbackBlockIndex = 0
            currentWireBlockIndex = undefined
            latestEnvelopeUsageMessage = undefined
          } else if (
            ev.type === 'content_block_start' &&
            typeof ev.index === 'number' &&
            isPlainRecord(ev.content_block)
          ) {
            currentWireBlockIndex = ev.index
            if (!wireStreamedIndices.includes(ev.index)) {
              wireStreamedIndices.push(ev.index)
            }
            nextFallbackBlockIndex = Math.max(
              nextFallbackBlockIndex,
              ev.index + 1,
            )
            const cb = ev.content_block
            const cbType = cb.type
            wireBlockKinds.set(
              ev.index,
              cbType === 'text' || cbType === 'thinking'
                ? cbType
                : cbType === 'tool_use'
                  ? 'tool'
                  : 'other',
            )
            if (
              cb.type === 'tool_use' &&
              typeof cb.id === 'string' &&
              typeof cb.name === 'string'
            ) {
              wireToolIdToIndex.set(cb.id, ev.index)
              const toolChunk: TurnStepChunk = {
                kind: 'tool',
                index: ev.index,
                id: cb.id,
                name: cb.name,
                ref,
              }
              sentChunks.set(ref, toolChunk)
              yield toolChunk
              continue
            }
          } else if (
            ev.type === 'content_block_delta' &&
            typeof ev.index === 'number' &&
            isPlainRecord(ev.delta)
          ) {
            const delta = ev.delta
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              const textChunk: TurnStepChunk = {
                kind: 'text',
                index: ev.index,
                text: delta.text,
                ref,
              }
              sentChunks.set(ref, textChunk)
              yield textChunk
              continue
            }
            if (
              delta.type === 'thinking_delta' &&
              typeof delta.thinking === 'string'
            ) {
              const thinkingChunk: TurnStepChunk = {
                kind: 'thinking',
                index: ev.index,
                text: delta.thinking,
                ref,
              }
              sentChunks.set(ref, thinkingChunk)
              yield thinkingChunk
              continue
            }
            if (
              delta.type === 'input_json_delta' &&
              typeof delta.partial_json === 'string' &&
              wireBlockKinds.get(ev.index) === 'tool'
            ) {
              const inputChunk: TurnStepChunk = {
                kind: 'input',
                index: ev.index,
                json: delta.partial_json,
                ref,
              }
              sentChunks.set(ref, inputChunk)
              yield inputChunk
              continue
            }
          } else if (
            ev.type === 'message_delta' &&
            isPlainRecord(ev.delta) &&
            typeof ev.delta.stop_reason === 'string'
          ) {
            const stopChunk: TurnStepChunk = {
              kind: 'stop',
              stopReason: normalizeTurnStopReason(ev.delta.stop_reason),
              usage: extractTurnUsageFromAssistant(
                latestEnvelopeUsageMessage,
                nextModel,
              ),
              ref,
            }
            sentChunks.set(ref, stopChunk)
            yield stopChunk
            continue
          }
        }

        const engineChunk: TurnStepChunk = { kind: 'engine', ref }
        sentChunks.set(ref, engineChunk)
        yield engineChunk
      }
    } catch (err) {
      state.thrown = { error: err }
      throw err
    }

    return {
      turnId,
      index: stepIndex,
      answer: answerParts.join('\n').trim(),
      toolUses: recordedToolUses,
      stopReason: normalizeTurnStopReason(lastAssistant?.message.stop_reason),
      usage: extractTurnUsageFromAssistant(lastAssistant, nextModel),
    }
  }

  type HookBlockState = {
    kind: 'text' | 'thinking' | 'tool' | 'other'
    text: string
    tool?: { id: string; name: string }
    isWireBlock: boolean
    hasEngineRecord: boolean
    recordEmitted: boolean
  }

  const hookBlocks = new Map<number, HookBlockState>()
  const rewrittenBlocks = new Set<number>()
  const startedStreamBlocks = new Set<number>()
  const rewrittenAssistantPairs: Array<{
    clone: AssistantMessage
    original: AssistantMessage
  }> = []
  let envelopeStarted = false
  let envelopeStopped = false
  let stopEmitted = false
  let yieldedSynthesizedRecovery = false
  let lastStopChunk: Extract<TurnStepChunk, { kind: 'stop' }> | undefined

  const getOrCreateHookBlock = (
    index: number,
    kind: HookBlockState['kind'],
    hasSentChunk: boolean,
  ): HookBlockState => {
    const isWire = wireBlockKinds.has(index) || hasSentChunk
    const hasRecord = isWire || seenEngineRecordBlocks.has(index)
    const existing = hookBlocks.get(index)
    if (existing) {
      if (isWire) existing.isWireBlock = true
      if (hasRecord) existing.hasEngineRecord = true
      return existing
    }
    const created: HookBlockState = {
      kind,
      text: '',
      isWireBlock: isWire,
      hasEngineRecord: hasRecord,
      recordEmitted: false,
    }
    hookBlocks.set(index, created)
    return created
  }

  const makeStreamEvent = (eventObj: Record<string, unknown>): StreamEvent =>
    ({
      type: 'stream_event',
      event: eventObj,
    }) as unknown as StreamEvent

  const ensureEnvelopeStarted = function* (): Generator<StreamEvent> {
    if (envelopeStarted) return
    envelopeStarted = true
    const template = createAssistantMessage({ content: [] })
    yield makeStreamEvent({
      type: 'message_start',
      message: {
        ...template.message,
        id: `msg_hook_${randomUUID()}`,
        model: callArgs.options.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
      },
    })
  }

  const ensureBlockStarted = function* (
    index: number,
    block: HookBlockState,
  ): Generator<StreamEvent> {
    yield* ensureEnvelopeStarted()
    if (startedStreamBlocks.has(index)) return
    startedStreamBlocks.add(index)
    const contentBlock =
      block.kind === 'tool' && block.tool !== undefined
        ? {
            type: 'tool_use',
            id: block.tool.id,
            name: block.tool.name,
            input: {},
          }
        : block.kind === 'thinking'
          ? { type: 'thinking', thinking: '', signature: '' }
          : { type: 'text', text: '', citations: null }
    yield makeStreamEvent({
      type: 'content_block_start',
      index,
      content_block: contentBlock,
    })
  }

  const buildSynthesizedAssistantForBlock = (
    block: HookBlockState,
  ): AssistantMessage | undefined => {
    if (block.kind === 'text' && block.text !== '') {
      const msg = createAssistantMessage({ content: block.text })
      msg.message.model = callArgs.options.model
      if (state.requests === 0) {
        Object.assign(msg, {
          isUnmetered: true,
          answeredWithoutRequest: true,
        })
      }
      return msg
    }
    if (block.kind === 'tool' && block.tool !== undefined) {
      const msg = createAssistantMessage({
        content: [
          {
            type: 'tool_use',
            id: block.tool.id,
            name: block.tool.name,
            input: parseHookToolInputJson(block.text),
          },
        ] as unknown as Parameters<typeof createAssistantMessage>[0]['content'],
      })
      msg.message.model = callArgs.options.model
      if (state.requests === 0) {
        Object.assign(msg, {
          isUnmetered: true,
          answeredWithoutRequest: true,
        })
      }
      return msg
    }
    return undefined
  }

  const syncRewrittenAssistants = (): void => {
    for (const { clone, original } of rewrittenAssistantPairs) {
      clone.message.usage = original.message.usage
      clone.message.stop_reason = original.message.stop_reason
      clone.message.stop_sequence = original.message.stop_sequence
    }
  }

  try {
    const chain = hooks.runFunctionHookStreamChain<
      TurnStepChunk,
      TurnStepResult
    >('turn.step', stepInput, tailGen)

    for await (const rawChunk of chain) {
      if (!rawChunk || typeof rawChunk !== 'object' || !('kind' in rawChunk)) {
        continue
      }
      const chunk = rawChunk as TurnStepChunk
      const sent =
        chunk.ref !== undefined ? sentChunks.get(chunk.ref) : undefined
      const matchesSent = turnStepChunkMatchesSent(chunk, sent)

      if (chunk.kind === 'engine') {
        const item = heldItems.get(chunk.ref)
        if (item === undefined) {
          logForDebugging(
            `turn.step: an engine chunk names no item of this step (ref ${String(chunk.ref)}); dropped`,
          )
          continue
        }
        if (isRecordAssistantItem(item)) {
          const blockIndices = assistantBlockIndices.get(chunk.ref) ?? []
          for (const bIdx of blockIndices) {
            const tracked = hookBlocks.get(bIdx)
            if (tracked) {
              tracked.hasEngineRecord = true
              tracked.recordEmitted = true
            }
          }
          const hasAnyRewrite = blockIndices.some(bIdx =>
            rewrittenBlocks.has(bIdx),
          )
          if (!hasAnyRewrite) {
            yield item
            continue
          }
          const rawContent: unknown = item.message.content
          const origContent: unknown[] = Array.isArray(rawContent)
            ? rawContent
            : typeof rawContent === 'string'
              ? [{ type: 'text', text: rawContent, citations: null }]
              : []
          const nextContent: unknown[] = []
          for (let i = 0; i < origContent.length; i++) {
            const origBlock = origContent[i]
            const bIdx = blockIndices[i]
            if (bIdx === undefined || !rewrittenBlocks.has(bIdx)) {
              nextContent.push(origBlock)
              continue
            }
            const tracked = hookBlocks.get(bIdx)
            if (!tracked) {
              nextContent.push(origBlock)
              continue
            }
            if (tracked.kind === 'text') {
              if (tracked.text === '') continue
              nextContent.push({
                type: 'text',
                text: tracked.text,
                citations: null,
              })
              continue
            }
            if (tracked.kind === 'tool' && tracked.tool !== undefined) {
              nextContent.push({
                type: 'tool_use',
                id: tracked.tool.id,
                name: tracked.tool.name,
                input: parseHookToolInputJson(tracked.text),
              })
              continue
            }
            // Sibling thinking (with signature) and other block types stay intact.
            nextContent.push(origBlock)
          }
          if (nextContent.length === 0) continue
          const clone: AssistantMessage = {
            ...item,
            message: {
              ...item.message,
              content:
                nextContent as unknown as AssistantMessage['message']['content'],
            },
          }
          rewrittenAssistantPairs.push({ clone, original: item })
          yield clone
          continue
        }
        if (item.type === 'stream_event' && isPlainRecord(item.event)) {
          const ev = item.event
          if (ev.type === 'message_start') {
            envelopeStarted = true
            envelopeStopped = false
          } else if (
            ev.type === 'content_block_start' &&
            typeof ev.index === 'number'
          ) {
            envelopeStarted = true
            startedStreamBlocks.add(ev.index)
          } else if (
            ev.type === 'content_block_stop' &&
            typeof ev.index === 'number'
          ) {
            const tracked = hookBlocks.get(ev.index)
            if (tracked && !tracked.recordEmitted && !tracked.hasEngineRecord) {
              tracked.recordEmitted = true
              const synthesized = buildSynthesizedAssistantForBlock(tracked)
              if (synthesized) yield synthesized
            }
          } else if (ev.type === 'message_stop') {
            syncRewrittenAssistants()
            envelopeStopped = true
          }
        }
        yield item
        continue
      }

      if (chunk.kind === 'tool') {
        const block = getOrCreateHookBlock(
          chunk.index,
          'tool',
          sent !== undefined,
        )
        block.tool = { id: chunk.id, name: chunk.name }
        if (matchesSent && chunk.ref !== undefined) {
          const orig = heldItems.get(chunk.ref)
          if (orig) {
            envelopeStarted = true
            startedStreamBlocks.add(chunk.index)
            yield orig
            continue
          }
        }
        rewrittenBlocks.add(chunk.index)
        yield* ensureEnvelopeStarted()
        startedStreamBlocks.add(chunk.index)
        yield makeStreamEvent({
          type: 'content_block_start',
          index: chunk.index,
          content_block: {
            type: 'tool_use',
            id: chunk.id,
            name: chunk.name,
            input: {},
          },
        })
        continue
      }

      if (
        chunk.kind === 'text' ||
        chunk.kind === 'thinking' ||
        chunk.kind === 'input'
      ) {
        const blockKind = chunk.kind === 'input' ? 'tool' : chunk.kind
        const block = getOrCreateHookBlock(
          chunk.index,
          blockKind,
          sent !== undefined,
        )
        block.text += chunk.kind === 'input' ? chunk.json : chunk.text
        if (matchesSent && chunk.ref !== undefined) {
          const orig = heldItems.get(chunk.ref)
          if (orig) {
            yield orig
            continue
          }
        }
        rewrittenBlocks.add(chunk.index)
        yield* ensureBlockStarted(chunk.index, block)
        const delta =
          chunk.kind === 'text'
            ? { type: 'text_delta', text: chunk.text }
            : chunk.kind === 'thinking'
              ? {
                  type: 'thinking_delta',
                  thinking: chunk.text,
                  estimated_tokens: null,
                }
              : { type: 'input_json_delta', partial_json: chunk.json }
        yield makeStreamEvent({
          type: 'content_block_delta',
          index: chunk.index,
          delta,
        })
        continue
      }

      if (chunk.kind === 'stop') {
        lastStopChunk = chunk
        stopEmitted = true
        for (const [idx, block] of hookBlocks) {
          if (!block.recordEmitted && !block.isWireBlock) {
            block.recordEmitted = true
            const synthesized = buildSynthesizedAssistantForBlock(block)
            if (synthesized) {
              synthesized.message.stop_reason = chunk.stopReason
              if (state.thrown !== undefined) {
                yieldedSynthesizedRecovery = true
              }
              yield synthesized
            }
            if (startedStreamBlocks.has(idx)) {
              yield makeStreamEvent({ type: 'content_block_stop', index: idx })
            }
          }
        }
        if (matchesSent && chunk.ref !== undefined) {
          const orig = heldItems.get(chunk.ref)
          if (orig) {
            yield orig
            continue
          }
        }
        yield* ensureEnvelopeStarted()
        yield makeStreamEvent({
          type: 'message_delta',
          delta: {
            stop_reason: chunk.stopReason,
            stop_sequence: null,
            stop_details: null,
            container: null,
          },
          usage: {
            output_tokens: chunk.usage?.output_tokens ?? 0,
            input_tokens: chunk.usage?.input_tokens ?? null,
            cache_creation_input_tokens:
              chunk.usage?.cache_creation_input_tokens ?? null,
            cache_read_input_tokens:
              chunk.usage?.cache_read_input_tokens ?? null,
            server_tool_use: null,
            iterations: null,
            output_tokens_details: null,
            fallback_credit: null,
          },
          context_management: null,
        })
      }
    }

    syncRewrittenAssistants()

    let synthesizedAtEnd = false
    for (const [idx, block] of hookBlocks) {
      if (
        !block.recordEmitted &&
        (!block.isWireBlock ||
          (!seenEngineRecordBlocks.has(idx) && rewrittenBlocks.has(idx)))
      ) {
        block.recordEmitted = true
        const synthesized = buildSynthesizedAssistantForBlock(block)
        if (synthesized) {
          synthesized.message.stop_reason =
            lastStopChunk?.stopReason ?? 'end_turn'
          synthesizedAtEnd = true
          if (state.thrown !== undefined) {
            yieldedSynthesizedRecovery = true
          }
          yield synthesized
        }
        if (startedStreamBlocks.has(idx)) {
          yield makeStreamEvent({ type: 'content_block_stop', index: idx })
        }
      }
    }
    if ((envelopeStarted && !envelopeStopped) || synthesizedAtEnd) {
      if (!stopEmitted) {
        yield makeStreamEvent({
          type: 'message_delta',
          delta: {
            stop_reason: 'end_turn',
            stop_sequence: null,
            stop_details: null,
            container: null,
          },
          usage: {
            output_tokens: 0,
            input_tokens: null,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            server_tool_use: null,
            iterations: null,
            output_tokens_details: null,
            fallback_credit: null,
          },
          context_management: null,
        })
      }
      if (!envelopeStopped) {
        yield makeStreamEvent({ type: 'message_stop' })
      }
    }

    if (state.thrown !== undefined && !yieldedSynthesizedRecovery) {
      throw state.thrown.error
    }

    if (state.requests === 0) {
      logForDebugging(
        'turn.step: a hook answered without the request; the loop read what it streamed',
      )
    }
  } catch (err) {
    if (state.thrown !== undefined) {
      throw state.thrown.error
    }
    if (callArgs.signal.aborted && !isAbortError(err)) {
      throw isAbortError(callArgs.signal.reason) ? callArgs.signal.reason : err
    }
    if (state.requests === 0 && !isAbortError(err)) {
      logForDebugging(
        `turn.step: the chain failed before the request; it goes without the hooks: ${errorMessage(err)}`,
        { level: 'error' },
      )
      yield* callModel(callArgs)
      return
    }
    throw err
  }
}
