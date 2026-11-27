import { APIError } from '@anthropic-ai/sdk/error'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  formatDeferredToolLine,
  isDeferredTool,
  SEARCH_EXTRA_TOOLS_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import type { QuerySource } from 'src/constants/querySource.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import type { EffortLevel } from 'src/utils/effort.js'
import { isFastModeRefusalError } from 'src/utils/fastMode.js'
import { extractFoundryUnsupportedFromError } from 'src/utils/foundryCapabilities.js'
import type { PromptCacheTtl } from 'src/utils/promptCacheTtl.js'
import {
  getMainLoopModelOverride,
  getRefusalFallbackModelLatch,
  getStickyBetas,
  takeCarriedEffortEnd,
} from '../../../bootstrap/state.js'
import { type Tool, type Tools, toolMatchesName } from '../../../Tool.js'
import type { AssistantMessage, UserMessage } from '../../../types/message.js'
import { splitSysPromptPrefix } from '../../../utils/api.js'
import { logError } from '../../../utils/log.js'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import type { ApiSystemMessage } from '../../../utils/midConversationSystem.js'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../../utils/sessionRoot.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import { logEvent } from '../../analytics/index.js'
import {
  API_ERROR_MESSAGE_PREFIX,
  isPromptTooLongErrorMessage,
} from '../errors.js'
import {
  getModelRedirectTrackingState,
  type ModelRedirectTrackingState,
  runWithModelRedirectTracking,
} from '../modelRedirectGuard.js'
import {
  isFastModeNotEnabledError,
  isSpeedParameterUnsupportedError,
  parseApiMaxTokensCeilingError,
  parseMaxTokensContextOverflowError,
} from '../withRetry.js'
import { getCacheControl } from './promptCaching.js'
import { MAX_NON_STREAMING_TOKENS } from './requestParams.js'
import type { MediaItemCapEntry } from './types.js'

const declaredToolsByStickyBetas = new WeakMap<object, ReadonlySet<string>>()

export function getHeldInlineTools(
  stickyBetas: object = getStickyBetas(),
): ReadonlySet<string> | undefined {
  return declaredToolsByStickyBetas.get(stickyBetas)
}

export function latchDeclaredTools(
  stickyBetas: object,
  inlineToolNames: Iterable<string>,
): ReadonlySet<string> {
  const set = new Set(inlineToolNames)
  declaredToolsByStickyBetas.set(stickyBetas, set)
  return set
}

export function computeDeferredToolNamesForRequest(
  tools: Tools,
  useSearchExtraTools: boolean,
  heldInlineTools: ReadonlySet<string> | undefined,
  isDeferredFn: (tool: Tool) => boolean = isDeferredTool,
): Set<string> {
  const deferredToolNames = new Set<string>()
  if (!useSearchExtraTools) return deferredToolNames
  if (heldInlineTools === undefined) {
    for (const t of tools) {
      if (isDeferredFn(t)) deferredToolNames.add(t.name)
    }
  } else {
    for (const t of tools) {
      if (
        !heldInlineTools.has(t.name) &&
        !toolMatchesName(t, SEARCH_EXTRA_TOOLS_TOOL_NAME)
      ) {
        deferredToolNames.add(t.name)
      }
    }
  }
  return deferredToolNames
}

export function runWithActiveModelRedirectTracking<T>(
  fn: () => T,
  trackingState?: ModelRedirectTrackingState,
): T {
  const active = getModelRedirectTrackingState()
  if (trackingState !== undefined) {
    return active === trackingState
      ? fn()
      : runWithModelRedirectTracking(fn, trackingState)
  }
  return active !== undefined ? fn() : runWithModelRedirectTracking(fn)
}

/**
 * Official 2.1.328 `_Os` (`chunk@294254613.js:3482796`) — build system prompt
 * blocks with prompt-caching breakpoints, supporting `scopeRefused` fallback
 * (omits `scope` from `cache_control` when `prompt-caching-scope-2026-01-05`
 * was rejected by the endpoint/proxy).
 */
export function buildSystemPromptBlocks(
  systemPrompt: SystemPrompt,
  enablePromptCaching: boolean,
  options?: {
    skipGlobalCacheForSystemPrompt?: boolean
    querySource?: QuerySource
    agentCacheTtlOverride?: PromptCacheTtl
    scopeRefused?: boolean
  },
): TextBlockParam[] {
  return splitSysPromptPrefix(systemPrompt, {
    skipGlobalCacheForSystemPrompt: options?.skipGlobalCacheForSystemPrompt,
  }).map(block => ({
    type: 'text' as const,
    text: block.text,
    ...(enablePromptCaching &&
      block.cacheScope !== null && {
        cache_control: getCacheControl({
          scope: options?.scopeRefused ? undefined : block.cacheScope,
          querySource: options?.querySource,
          agentCacheTtlOverride: options?.agentCacheTtlOverride,
        }),
      }),
  }))
}

/**
 * Official 2.1.328 `N9e` / `DTe` (`chunk@294254613.js @3354840`, `d4e` in
 * `chunk@288788466.js @1084`): decide whether an HTTP 400/422 error on a
 * request declaring deferred tools should fall back to sending the request
 * again without deferred tools (`ToolSearchRefusalError`).
 *
 * - On direct 1P Anthropic (`isDirectAnthropicProvider`), ONLY fire when
 *   `error.message` explicitly mentions `\bdefer_loading\b` (avoiding cache-
 *   busting retries on unrelated 400s).
 * - Exclude billing errors, prompt-too-long, and errors handled by `withRetry`
 *   (`parseApiMaxTokensCeilingError`, `parseMaxTokensContextOverflowError`,
 *   fast-mode refusal / speed-unsupported errors, Foundry capability errors).
 */
export function shouldTriggerToolSearchRefusal(params: {
  error: unknown
  useSearchExtraTools: boolean
  alreadyRetried: boolean
  isDirectAnthropicProvider: boolean
  provider: string
  model: string
}): boolean {
  const {
    error,
    useSearchExtraTools,
    alreadyRetried,
    isDirectAnthropicProvider,
    provider,
    model,
  } = params
  if (!useSearchExtraTools || alreadyRetried) return false
  if (!(error instanceof APIError)) return false
  if (error.status !== 400 && error.status !== 422) return false
  if (isDirectAnthropicProvider && !/\bdefer_loading\b/.test(error.message)) {
    return false
  }
  if (
    (error.error as { type?: string } | undefined)?.type === 'billing_error'
  ) {
    return false
  }
  if (isPromptTooLongErrorMessage(error.message)) return false

  // Official `wBe($n)`: normalize HTTP 422 to 400 for error-classifier checks.
  const normalizedErr =
    error.status === 422
      ? new APIError(
          400,
          error.error,
          error.message.replace(/^422 /, ''),
          error.headers,
        )
      : error

  if (parseApiMaxTokensCeilingError(normalizedErr) !== null) return false
  if (parseMaxTokensContextOverflowError(normalizedErr) !== undefined) {
    return false
  }
  if (
    isFastModeRefusalError(normalizedErr) ||
    isFastModeNotEnabledError(normalizedErr) ||
    isSpeedParameterUnsupportedError(normalizedErr, model)
  ) {
    return false
  }
  if (
    provider !== 'firstParty' &&
    /fast mode|speed: extra inputs|`speed` parameter/i.test(
      normalizedErr.message ?? '',
    )
  ) {
    return false
  }
  if (
    provider === 'foundry' &&
    (extractFoundryUnsupportedFromError(normalizedErr)?.length ?? 0) > 0
  ) {
    return false
  }
  return true
}

export function buildCutShortErrorForMessage(
  stopReason: string | null | undefined,
  maxTokens: number,
  outputTokens: number,
  isNonStreamingCapped = false,
): AssistantMessage | undefined {
  if (stopReason === 'max_tokens') {
    logEvent('tengu_max_tokens_reached', {
      max_tokens: maxTokens,
    })
    return createAssistantAPIErrorMessage({
      content: isNonStreamingCapped
        ? `${API_ERROR_MESSAGE_PREFIX}: Claude's response exceeded the ${
            maxTokens
          } output token maximum for a request sent without streaming. The CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable cannot raise this limit.`
        : `${API_ERROR_MESSAGE_PREFIX}: Claude's response exceeded the ${
            maxTokens
          } output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.`,
      apiError: 'max_output_tokens',
      error: 'max_output_tokens',
    })
  }

  if (stopReason === 'model_context_window_exceeded') {
    logEvent('tengu_context_window_exceeded', {
      max_tokens: maxTokens,
      output_tokens: outputTokens,
    })
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: The model has reached its context window limit.`,
      apiError: 'max_output_tokens',
      error: 'max_output_tokens',
    })
  }

  return undefined
}

export function buildCutShortErrorForNonStreamingResponse(
  result: {
    stop_reason?: string | null
    usage?: { output_tokens?: number }
  },
  maxOutputTokens: number,
): AssistantMessage | undefined {
  try {
    if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_vast_sunset', true)) {
      return undefined
    }
    return buildCutShortErrorForMessage(
      result.stop_reason,
      Math.min(maxOutputTokens, MAX_NON_STREAMING_TOKENS),
      result.usage?.output_tokens ?? 0,
      maxOutputTokens >= MAX_NON_STREAMING_TOKENS,
    )
  } catch (err) {
    logError(err)
    return undefined
  }
}

/**
 * Per-root-session cache of deferred-tool lines that have already been announced
 * via <available-deferred-tools>. Because the injection is ephemeral (appended
 * to a local `messagesForAPI` that is never persisted back into the caller's
 * message history), we cannot scan history to detect prior injections — the
 * injected message is gone after each API call. Scoped via `RootSessionSlot`
 * so concurrent host sessions announce independently on Turn 1.
 */
const lastAnnouncedDeferredToolsSlot = new RootSessionSlot(
  () => new Set<string>(),
)

export function getLastAnnouncedDeferredTools(): Set<string> {
  return lastAnnouncedDeferredToolsSlot.of(getBootstrapSession())
}

export function resetLastAnnouncedDeferredTools(): void {
  getLastAnnouncedDeferredTools().clear()
}

export function maybeAppendDeferredToolsAnnouncement<T>(
  messagesForAPI: T[],
  tools: Tools,
  deferredToolNames: ReadonlySet<string>,
): (T | UserMessage)[] {
  // Diff current deferred tools against what's already been announced in
  // prior <available-deferred-tools> injections. Only re-inject when new
  // tools appear (e.g. MCP server connects mid-session).
  const deferredToolList = tools
    .filter(t => deferredToolNames.has(t.name))
    .map(formatDeferredToolLine)
    .sort()
    .join('\n')

  if (!deferredToolList) {
    return messagesForAPI
  }

  const lastAnnouncedDeferredTools = getLastAnnouncedDeferredTools()
  const currentTools = new Set(deferredToolList.split('\n'))
  const hasNewTools = [...currentTools].some(
    t => !lastAnnouncedDeferredTools.has(t),
  )

  if (!hasNewTools) {
    return messagesForAPI
  }

  lastAnnouncedDeferredTools.clear()
  for (const t of currentTools) lastAnnouncedDeferredTools.add(t)

  return [
    ...messagesForAPI,
    createUserMessage({
      content: `<system-reminder>\n<available-deferred-tools>\n${deferredToolList}\n</available-deferred-tools>\nDeferred tools appear by name above. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ${SEARCH_EXTRA_TOOLS_TOOL_NAME} with query "select:<name>[,<name>...]" to load tool schemas, then call each tool directly (do not wrap through ExecuteExtraTool).\n</system-reminder>`,
      isMeta: true,
    }),
  ]
}

/** Official Rya — media item limit step-down ladder (#13). */
export const MEDIA_ITEM_LIMIT_STEPS = [510, 255, 127] as const

const mediaItemCapBySessionSlot = new RootSessionSlot<
  Map<string, MediaItemCapEntry>
>(() => new Map<string, MediaItemCapEntry>())

export function getSessionMediaItemCap(
  sessionId: string,
  model: string,
): MediaItemCapEntry | undefined {
  const entry = mediaItemCapBySessionSlot
    .peek(getBootstrapSession())
    ?.get(sessionId)
  return entry?.model === model ? entry : undefined
}

export function setSessionMediaItemCap(
  sessionId: string,
  entry: MediaItemCapEntry,
): void {
  mediaItemCapBySessionSlot.of(getBootstrapSession()).set(sessionId, entry)
}

export function clearSessionMediaItemCap(sessionId: string): void {
  mediaItemCapBySessionSlot.peek(getBootstrapSession())?.delete(sessionId)
}

function isMediaBlock(block: unknown): boolean {
  if (typeof block !== 'object' || block === null) return false
  const b = block as { type?: unknown }
  return b.type === 'image' || b.type === 'document'
}

/** Official ros(messages) — count stored image/document blocks (#13). */
export function countStoredMediaItems(
  messages: readonly (UserMessage | AssistantMessage | ApiSystemMessage)[],
): number {
  let total = 0
  for (const msg of messages) {
    const content = (msg as { message?: { content?: unknown } }).message
      ?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (isMediaBlock(block)) {
        total++
      } else if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'tool_result' &&
        Array.isArray((block as { content?: unknown }).content)
      ) {
        for (const inner of (block as { content: unknown[] }).content) {
          if (isMediaBlock(inner)) total++
        }
      }
    }
  }
  return total
}

/** Official Mjr — resolve carriedEffort from loop override or session latch (#36). */
export function resolveCarriedEffortForModel(
  opts: {
    loopEffort?: EffortLevel
    continuesMainConversation: boolean
  },
  resolvedModel: string,
): EffortLevel | null {
  const killed = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_loggia_passage',
    false,
  )
  if (opts.loopEffort !== undefined) {
    return killed ? null : opts.loopEffort
  }
  if (!opts.continuesMainConversation || killed) {
    return null
  }
  const latch = getRefusalFallbackModelLatch()
  const override = getMainLoopModelOverride()
  if (latch?.carriedEffort === undefined || override == null) {
    return null
  }
  const matches =
    override.toLowerCase() === latch.fallbackModel.toLowerCase() &&
    resolvedModel.toLowerCase() === latch.fallbackModel.toLowerCase()
  return matches ? latch.carriedEffort : null
}

/**
 * Official 2.1.328 `H9o = Ia ? Eji() : void 0` (chunk@294254613.js @3340188,
 * @3474902): consume the one-shot `carriedEffortEnded` reason from the refusal
 * fallback latch only on main-conversation API completions (`repl_main_thread*`
 * or `sdk` outside subagent/background contexts).
 */
export function takeCarriedEffortEndForMainQuery(opts: {
  agentContext?: unknown
  querySource: string
}): string | undefined {
  const isMainConversation =
    !(opts.agentContext ?? getAgentContext()) &&
    (opts.querySource.startsWith('repl_main_thread') ||
      opts.querySource === 'sdk')
  return isMainConversation ? takeCarriedEffortEnd() : undefined
}
