import type {
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { logForDebugging } from 'src/utils/debug.js'
import { logError } from '../../../utils/log.js'
import { extractConnectionErrorDetails } from '../errorUtils.js'
import type { NonNullableUsage } from '../logging.js'
import {
  type PausedResponseLimit,
  type PausedResponseRecord,
  StreamTruncatedError,
} from './types.js'

export type { PausedResponseLimit, PausedResponseRecord }

/** Official 2.1.328 `drn.header` (`chunk@285257860.js:170477`). */
export const RESUMPTION_BETA_HEADER = 'resumption-2026-10-08'
/** Official 2.1.328 `Exs = 3` (`chunk@294254613.js:3201800`). */
export const MAX_STREAM_RESUMPTIONS = 3
export const STREAM_RESUMPTION_FLAG = 'tengu_peaceful_wigderson'

export type ResumedMessageDeltaEvent = BetaRawMessageStreamEvent & {
  type: 'message_delta'
  resumed_usage: BetaRawMessageStreamEvent extends { type: 'message_start' }
    ? unknown
    : unknown
  paused_limit: PausedResponseLimit
}

export function isResumedUsageMessageDelta(
  event: unknown,
): event is BetaRawMessageStreamEvent & {
  type: 'message_delta'
  resumed_usage: Partial<NonNullableUsage>
  paused_limit: PausedResponseLimit
} {
  return (
    typeof event === 'object' &&
    event !== null &&
    (event as { type?: unknown }).type === 'message_delta' &&
    'resumed_usage' in event
  )
}

export type ParsedResumptionPause = {
  token: string | undefined
  limit: PausedResponseLimit
  frame: BetaRawMessageStreamEvent & { type: 'message_delta' }
}

/**
 * Official 2.1.328 `Pxs` (`chunk@294254613.js:3205504`) — detect a pausable
 * `message_delta` carrying `stop_details.resumption` (`max_tokens`,
 * `server_timeout`, or `pause_turn` with a `resumption.token`), returning a
 * cleaned frame with `resumption` stripped from `stop_details`.
 */
export function parseResumptionPauseDelta(
  event: BetaRawMessageStreamEvent,
): ParsedResumptionPause | undefined {
  if (event.type !== 'message_delta') return undefined
  const delta = event.delta as {
    stop_reason?: string | null
    stop_details?: Record<string, unknown> | null
  }
  const stopReason = delta.stop_reason
  const stopDetails = delta.stop_details
  if (
    stopDetails === null ||
    stopDetails === undefined ||
    typeof stopDetails !== 'object'
  ) {
    return undefined
  }
  const resumption = stopDetails.resumption
  if (
    resumption === null ||
    resumption === undefined ||
    typeof resumption !== 'object'
  ) {
    return undefined
  }
  const rawToken = (resumption as { token?: unknown }).token
  const token = typeof rawToken === 'string' ? rawToken : undefined
  const isResumableLimit =
    stopReason === 'max_tokens' ||
    stopReason === 'server_timeout' ||
    (stopReason === 'pause_turn' && token !== undefined)
  if (!isResumableLimit) return undefined

  const { resumption: _omittedResumption, ...cleanedStopDetails } = stopDetails
  return {
    token,
    limit: stopReason,
    frame: {
      ...event,
      delta: {
        ...event.delta,
        stop_details: cleanedStopDetails,
      } as typeof event.delta,
    },
  }
}

type ResumptionBlockRecord = {
  index: number
  block: Record<string, unknown>
  inputJson: string
  incomplete: boolean
}

export type ResumptionStreamState = {
  complete: ResumptionBlockRecord[]
  open: ResumptionBlockRecord | undefined
  offset: number
  nextIndex: number
  messages: BetaMessageStreamParams['messages']
  replayed?: Omit<BetaMessageStreamParams, 'messages'>
}

/**
 * Official 2.1.328 `Oxs` (`chunk@294254613.js:3206200`) — build the follow-up
 * resumption request payload appending completed assistant blocks and
 * `resumption: { type: 'enabled', token }`.
 */
export function buildResumptionRequestParams(
  state: ResumptionStreamState,
  token: string,
): Record<string, unknown> {
  const completedBlocks = state.complete.map(({ block, inputJson }) => {
    if (inputJson === '') return block
    try {
      return { ...block, input: JSON.parse(inputJson) }
    } catch {
      return block
    }
  })
  return {
    ...(state.replayed ?? {}),
    messages:
      completedBlocks.length === 0
        ? state.messages
        : [
            ...state.messages,
            {
              role: 'assistant' as const,
              content: completedBlocks,
            },
          ],
    resumption: { type: 'enabled', token },
  }
}

/** Official 2.1.328 `Ixs` (`chunk@294254613.js:3206600`) — offset block indices across resumptions. */
function transformResumedStreamEvent(
  state: ResumptionStreamState,
  event: BetaRawMessageStreamEvent,
): BetaRawMessageStreamEvent | undefined {
  switch (event.type) {
    case 'content_block_start': {
      if (state.open?.incomplete) {
        state.open.incomplete = false
        return undefined
      }
      const index = event.index + state.offset
      state.open = {
        index,
        block: {
          ...(event.content_block as unknown as Record<string, unknown>),
        },
        inputJson: '',
        incomplete: false,
      }
      return { ...event, index }
    }
    case 'content_block_delta': {
      if (
        'replayed' in event &&
        (event as { replayed?: unknown }).replayed === true
      ) {
        return undefined
      }
      const open = state.open
      const delta = event.delta as unknown as Record<string, unknown>
      if (open) {
        if (open.block.type === 'text' && delta.type === 'text_delta') {
          open.block.text = `${String(open.block.text ?? '')}${String(delta.text ?? '')}`
        } else if (
          open.block.type === 'text' &&
          delta.type === 'citations_delta'
        ) {
          const existing = Array.isArray(open.block.citations)
            ? open.block.citations
            : []
          open.block.citations = [...existing, delta.citation]
        } else if (
          open.block.type === 'thinking' &&
          delta.type === 'thinking_delta'
        ) {
          open.block.thinking = `${String(open.block.thinking ?? '')}${String(delta.thinking ?? '')}`
        } else if (
          open.block.type === 'thinking' &&
          delta.type === 'signature_delta'
        ) {
          open.block.signature = delta.signature
        } else if (delta.type === 'input_json_delta') {
          open.inputJson += String(delta.partial_json ?? '')
        }
      }
      return { ...event, index: event.index + state.offset }
    }
    case 'content_block_stop': {
      if (
        'incomplete' in event &&
        (event as { incomplete?: unknown }).incomplete === true
      ) {
        if (state.open !== undefined) {
          state.open.incomplete = true
        }
        return undefined
      }
      const index = event.index + state.offset
      if (state.open !== undefined) {
        state.complete.push(state.open)
        state.open = undefined
      }
      state.nextIndex = index + 1
      return { ...event, index }
    }
    default:
      return event
  }
}

function* closeIncompleteOpenTextBlock(
  state: ResumptionStreamState,
): Generator<BetaRawMessageStreamEvent> {
  if (state.open?.incomplete && state.open.block.type === 'text') {
    yield {
      type: 'content_block_stop',
      index: state.open.index,
    } as BetaRawMessageStreamEvent
  }
}

export type WrapStreamWithResumptionOptions = {
  messages: BetaMessageStreamParams['messages']
  replayed?: Omit<BetaMessageStreamParams, 'messages'>
  send: (
    params: Record<string, unknown>,
  ) => Promise<AsyncIterable<BetaRawMessageStreamEvent> | undefined>
  isCancelled: () => boolean
  fits?: (usage: unknown) => boolean
  canResume?: () => boolean
  maxResumptions?: number
  onPaused?: () => void
  onAnswered?: () => void
  onCancelledAtPause?: (usage: unknown) => void
}

/**
 * Official 2.1.328 `Wno` (`chunk@294254613.js:3202790-3206600`) — transparent
 * server-side stream resumption for `pause_turn` / `max_tokens` /
 * `server_timeout` responses carrying `stop_details.resumption.token`.
 */
export async function* wrapStreamWithResumption(
  initialStream: AsyncIterable<BetaRawMessageStreamEvent>,
  opts: WrapStreamWithResumptionOptions,
): AsyncGenerator<BetaRawMessageStreamEvent> {
  const state: ResumptionStreamState = {
    complete: [],
    open: undefined,
    offset: 0,
    nextIndex: 0,
    messages: opts.messages,
    replayed: opts.replayed,
  }
  const maxResumptions = opts.maxResumptions ?? MAX_STREAM_RESUMPTIONS
  let activeStream: AsyncIterable<BetaRawMessageStreamEvent> = initialStream
  let paused: ParsedResumptionPause | undefined
  let resumptionCount = 0

  for (;;) {
    let answeredCurrent = paused === undefined
    try {
      for await (const event of activeStream) {
        if (event.type === 'message_start') {
          if (paused !== undefined) {
            answeredCurrent = true
            opts.onAnswered?.()
            const resumedUsage = event.message?.usage
            yield {
              ...paused.frame,
              delta: {
                stop_reason: null,
                stop_sequence: null,
                stop_details: null,
                container: null,
              },
              resumed_usage: resumedUsage,
              paused_limit: paused.limit,
            } as unknown as BetaRawMessageStreamEvent
            paused = undefined
            continue
          }
        }
        if (event.type === 'message_delta') {
          const parsedPause = parseResumptionPauseDelta(event)
          if (parsedPause !== undefined) {
            paused = parsedPause
            continue
          }
          if (typeof event.delta.stop_reason === 'string') {
            yield* closeIncompleteOpenTextBlock(state)
            yield event
            continue
          }
        }
        if (event.type === 'message_stop' && paused !== undefined) {
          break
        }
        const transformed = transformResumedStreamEvent(state, event)
        if (transformed !== undefined) {
          yield transformed
        }
      }
    } catch (err) {
      if (paused === undefined) throw err
      if (opts.isCancelled()) {
        opts.onCancelledAtPause?.(paused.frame.usage)
        throw err
      }
    }

    if (paused === undefined) {
      return
    }
    if (opts.isCancelled()) {
      opts.onCancelledAtPause?.(paused.frame.usage)
      return
    }
    if (answeredCurrent) {
      opts.onPaused?.()
      state.offset = state.nextIndex
      resumptionCount++
    }
    const { token } = paused
    const shouldResume =
      answeredCurrent &&
      token !== undefined &&
      resumptionCount <= maxResumptions &&
      (opts.fits?.(paused.frame.usage) ?? true) &&
      (opts.canResume?.() ?? true)

    let nextStream: AsyncIterable<BetaRawMessageStreamEvent> | undefined
    if (shouldResume && token !== undefined) {
      try {
        nextStream = await opts.send(buildResumptionRequestParams(state, token))
      } catch (err) {
        if (opts.isCancelled()) {
          opts.onCancelledAtPause?.(paused.frame.usage)
          throw err
        }
        nextStream = undefined
      }
    }
    if (nextStream === undefined) {
      yield* closeIncompleteOpenTextBlock(state)
      yield {
        ...paused.frame,
        delta: {
          ...paused.frame.delta,
          stop_reason:
            paused.limit === 'pause_turn' && state.open?.incomplete !== true
              ? 'pause_turn'
              : 'max_tokens',
        },
      } as BetaRawMessageStreamEvent
      yield { type: 'message_stop' } as BetaRawMessageStreamEvent
      return
    }
    activeStream = nextStream
  }
}

/**
 * Official 2.1.321 `Mjn(error, receivedAnyEvent)` (#1878).
 */
export function wrapMidStreamTlsErrorAsTruncated(
  error: unknown,
  receivedAnyEvent: boolean,
): unknown {
  if (!receivedAnyEvent) return error
  try {
    const code = extractConnectionErrorDetails(error)?.code
    if (code === 'EPROTO' || code?.startsWith('ERR_SSL_')) {
      logForDebugging(
        `Stream failed with a TLS error after an event had arrived (${code}) — reading it as a truncated stream`,
        { level: 'error' },
      )
      return new StreamTruncatedError(error)
    }
  } catch (err) {
    logError(err)
  }
  return error
}
