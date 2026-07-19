import {
  autoCompactCircuitBreakerEventPayload,
  isAutoCompactCircuitTripped,
  recordAutoCompactFailure,
} from '../../utils/autoCompactCircuitBreaker.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
} from '../api/errors.js'
import { type CompactionResult, compactConversation } from './compact.js'

export const isReactiveOnlyMode: () => boolean = () => false

export const reactiveCompactOnPromptTooLong: (
  messages: Message[],
  cacheSafeParams: Record<string, unknown>,
  options: { customInstructions?: string; trigger?: string },
) => Promise<{ ok: boolean; reason?: string; result?: CompactionResult }> =
  async (messages, cacheSafeParams, options) => {
    const params = cacheSafeParams as unknown as CacheSafeParams
    try {
      const result = await compactConversation(
        messages,
        params.toolUseContext,
        params,
        true,
        options.customInstructions,
        true,
        {
          isRecompactionInChain: false,
          turnsSincePreviousCompact: 0,
          autoCompactThreshold: 0,
          querySource: 'compact',
        },
      )
      return { ok: true, result }
    } catch (error) {
      logError(error)
      return { ok: false, reason: String(error) }
    }
  }

export const isReactiveCompactEnabled: () => boolean = () => {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) return false
  return true
}

export const isWithheldPromptTooLong: (message: Message) => boolean =
  message => {
    if (message.type !== 'assistant' || !message.isApiErrorMessage) return false
    return isPromptTooLongMessage(message as AssistantMessage)
  }

export const isWithheldMediaSizeError: (message: Message) => boolean =
  message => {
    if (message.type !== 'assistant' || !message.isApiErrorMessage) return false
    return isMediaSizeErrorMessage(message as AssistantMessage)
  }

/**
 * densable Evu reactive branch — record failure with routedThroughReactive:true
 * and emit tengu_auto_compact_circuit_breaker when tripped.
 */
export function recordReactiveAutoCompactFailure(input: {
  previous?: { consecutiveFailures?: number } | null
  thresholdSource?: string
}): {
  consecutiveFailures: number
  routedThroughReactive: true
  thresholdSource?: string
  tripped: boolean
} {
  const next = recordAutoCompactFailure({
    previous: input.previous,
    routedThroughReactive: true,
    thresholdSource: input.thresholdSource,
  })
  const tripped = isAutoCompactCircuitTripped(next.consecutiveFailures)
  if (tripped) {
    logForDebugging(
      `autocompact: circuit breaker tripped after ${next.consecutiveFailures} consecutive failures (reactive path) — skipping future attempts this session`,
      { level: 'warn' },
    )
    const payload = autoCompactCircuitBreakerEventPayload(next)
    logEvent('tengu_auto_compact_circuit_breaker', {
      consecutiveFailures: payload.consecutiveFailures,
      routedThroughReactive: true,
      ...(payload.thresholdSource
        ? {
            thresholdSource:
              payload.thresholdSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
    })
  }
  return {
    consecutiveFailures: next.consecutiveFailures,
    routedThroughReactive: true,
    ...(next.thresholdSource
      ? { thresholdSource: next.thresholdSource }
      : {}),
    tripped,
  }
}

export const tryReactiveCompact: (params: {
  hasAttempted: boolean
  querySource: string
  aborted: boolean
  messages: Message[]
  cacheSafeParams: Record<string, unknown>
  /** densable Evu previous tracking for reactive failure path. */
  tracking?: { consecutiveFailures?: number } | null
  thresholdSource?: string
}) => Promise<
  | CompactionResult
  | null
  | {
      kind: 'failed'
      consecutiveFailures: number
      routedThroughReactive: true
      thresholdSource?: string
    }
> = async ({
  hasAttempted,
  aborted,
  messages,
  cacheSafeParams,
  tracking,
  thresholdSource,
}) => {
  if (hasAttempted || aborted) return null
  const params = cacheSafeParams as unknown as CacheSafeParams
  try {
    const result = await compactConversation(
      messages,
      params.toolUseContext,
      params,
      true,
      undefined,
      true,
      {
        isRecompactionInChain: false,
        turnsSincePreviousCompact: 0,
        autoCompactThreshold: 0,
      },
    )
    return result
  } catch (error) {
    logForDebugging(
      `reactiveCompact: emergency compaction failed — ${String(error)}`,
      { level: 'warn' },
    )
    logError(error)
    // densable Evu(o, true, f) — reactive failure circuit breaker path.
    const failed = recordReactiveAutoCompactFailure({
      previous: tracking,
      thresholdSource,
    })
    return {
      kind: 'failed',
      consecutiveFailures: failed.consecutiveFailures,
      routedThroughReactive: true,
      ...(failed.thresholdSource
        ? { thresholdSource: failed.thresholdSource }
        : {}),
    }
  }
}
