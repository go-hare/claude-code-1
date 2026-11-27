import { APIError } from '@anthropic-ai/sdk/error'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { markEffortUnsupported } from 'src/bootstrap/state.js'
import {
  CONTEXT_1M_BETA_HEADER,
  DANGEROUS_TOOL_USE_BETA_HEADER,
  EFFORT_BETA_HEADER,
  MID_CONVERSATION_SYSTEM_BETA_HEADER,
  PROMPT_CACHING_SCOPE_BETA_HEADER,
  THINKING_BINDING_CONTROLS_BETA_HEADER,
  THINKING_DISPLAY_UPDATES_BETA_HEADER,
  THINKING_RESUMPTION_BETA_HEADER,
  THINKING_TOKEN_COUNT_BETA_HEADER,
} from 'src/constants/betas.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import {
  classifyThinkingDisplayRetry,
  setPendingThinkingStripped,
} from 'src/utils/thinking.js'
import {
  markRelayThinkingStripRecorded,
  stickyRejectBeta,
} from '../../../bootstrap/state.js'
import type { Tools } from '../../../Tool.js'
import type { Message } from '../../../types/message.js'
import { clearBetasCaches } from '../../../utils/betas.js'
import {
  clampEffortToCap,
  isEffortLevel,
  isInvalidEffortLevelError,
  stepDownOrgEffortCap,
} from '../../../utils/effort.js'
import {
  isApiSystemCacheControlRejected,
  isMidConvSystemRoleRejected,
  latchMidConvCachePromotionRejected,
  latchMidConvSystemRejected,
  shouldCacheControlOnApiSystem,
} from '../../../utils/midConversationSystem.js'
import {
  countStrippedImageBlocks,
  HWT_KEEP_PADDING,
  noteImageMediaStripped,
  stripStoredMediaForRequestLimit,
} from '../../../utils/subagentCacheEvict.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../analytics/index.js'
import { handleClearToolUsesRefusalError } from '../../compact/apiMicrocompact.js'
import {
  decideContext1mBetaRetry,
  findRejectedBetaHeaders,
  isUnprocessableMediaError,
  parseMediaErrorLocation,
  stripTargetedMediaBlock,
} from '../errors.js'
import { MidConvSystemRetryError } from '../withRetry.js'
import {
  clearSessionMediaItemCap,
  countStoredMediaItems,
  getSessionMediaItemCap,
  MEDIA_ITEM_LIMIT_STEPS,
  setSessionMediaItemCap,
  shouldTriggerToolSearchRefusal,
} from './toolAndMediaHelpers.js'
import {
  type ApiRequestAdaptationState,
  type NormalizedApiMessage,
  type Options,
  ToolSearchRefusalError,
} from './types.js'

export function recordMediaItemCapSuccess(params: {
  options: Options
  resolvedModel: string
  sessionIdForMediaCap: string
  mediaTakenOut: Array<{ type: string }> | undefined
  state: ApiRequestAdaptationState
}): void {
  const { options, resolvedModel, sessionIdForMediaCap, mediaTakenOut, state } =
    params
  try {
    // Official 2.1.325 #1929 (`zbn(agentId, count(La, image))`): report final
    // stripped image count after a successful API response (0 clears state).
    if (mediaTakenOut !== undefined) {
      noteImageMediaStripped(
        options.agentId,
        countStrippedImageBlocks(mediaTakenOut),
      )
    }
    const existing = getSessionMediaItemCap(sessionIdForMediaCap, resolvedModel)
    if (state.pendingMediaCap === undefined) {
      if (existing?.gaveUp && existing.limit === undefined) {
        clearSessionMediaItemCap(sessionIdForMediaCap)
      } else if (existing?.gaveUp) {
        setSessionMediaItemCap(sessionIdForMediaCap, {
          ...existing,
          gaveUp: false,
        })
      }
      return
    }
    const { limit, steps, refusedAt } = state.pendingMediaCap
    state.pendingMediaCap = undefined
    setSessionMediaItemCap(sessionIdForMediaCap, {
      model: resolvedModel,
      limit: Math.min(limit, existing?.limit ?? Infinity),
      gaveUp: false,
    })
    logEvent('tengu_api_request_media_limit_lowered', {
      query_source:
        options.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      media_items_refused: refusedAt,
      media_item_limit: limit,
      steps,
    })
  } catch {
    // ignore media cap telemetry errors
  }
}

/**
 * densable aggregator @184994549: zue → Kue → Vue → dY → dGe on unique
 * `r.onError` tokens. Yue `surface:resume-prefill` is not a retry token.
 */
export function createApiErrorAdapter(deps: {
  options: Options
  resolvedModel: string
  sessionIdForMediaCap: string
  mediaTakenOut: Array<{ type: string }> | undefined
  useSearchExtraTools: boolean
  filteredTools: Tools
  buildSystem: () => ApiRequestAdaptationState['system']
  state: ApiRequestAdaptationState
}): (error: unknown) => string | undefined {
  const {
    options,
    resolvedModel,
    sessionIdForMediaCap,
    mediaTakenOut,
    useSearchExtraTools,
    filteredTools,
    buildSystem,
    state,
  } = deps

  return (error: unknown): string | undefined => {
    const lastBetas = state.lastRequestBetas ?? []
    const token = classifyThinkingDisplayRetry(
      error,
      state.lastSentThinkingDisplay,
      lastBetas,
      options.model,
      {
        carriedBindingControls: state.lastSentBindingControls,
        carriedTokenCount: state.lastSentTokenCount,
        bindingControlsOnThirdParty: state.lastBindingControlsOnThirdParty,
        messages: state.messagesForAPI as Message[],
        onMessagesHealed: (next, kind) => {
          // densable od(stripped, "error_recovery", true)
          void kind
          state.messagesForAPI = next as NormalizedApiMessage[]
        },
        onThinkingStripped: att => {
          // densable Xue(Ps.from) then Zue() yield after message_stop
          setPendingThinkingStripped(att)
          markRelayThinkingStripRecorded('marker')
        },
        prefixLockAttempt: state.prefixLockStripAttempt + 1,
        resumeIncompleteThinking: options.resumeIncompleteThinking,
        leavesEffortSupportAlone: options.leavesEffortSupportAlone,
        querySource: options.querySource,
      },
    )
    if (token === 'retry:thinking-display-updates') {
      state.betas = state.betas.filter(
        b => b !== THINKING_DISPLAY_UPDATES_BETA_HEADER,
      )
    }
    if (token === 'retry:thinking-binding-controls') {
      state.lastSentBindingControls = false
      state.betas = state.betas.filter(
        b => b !== THINKING_BINDING_CONTROLS_BETA_HEADER,
      )
    }
    if (token === 'retry:thinking-token-count-beta') {
      state.lastSentTokenCount = false
      state.betas = state.betas.filter(
        b => b !== THINKING_TOKEN_COUNT_BETA_HEADER,
      )
    }
    if (token === 'retry:thinking-resumption-beta') {
      state.betas = state.betas.filter(
        b => b !== THINKING_RESUMPTION_BETA_HEADER,
      )
    }
    // densable aQ @184994206 — d3r latch is in classifyThinkingTypeRetry;
    // paramsFromContext reads Lyn(h.model) on the retry.
    if (token === 'retry:thinking-type') {
      void token
    }
    if (token?.startsWith('retry:prefix-lock-strip')) {
      state.prefixLockStripAttempt += 1
    }
    if (
      token === 'retry:safeguards' ||
      token === 'retry:safeguards-unclaimed'
    ) {
      state.betas = state.betas.filter(
        b => b !== DANGEROUS_TOOL_USE_BETA_HEADER,
      )
    }
    if (token === 'retry:effort-unsupported') {
      state.betas = state.betas.filter(b => b !== EFFORT_BETA_HEADER)
      if (options.leavesEffortSupportAlone) {
        state.effort = undefined
      }
    }
    if (token != null) {
      return token
    }

    // Official 2.1.328 `JXo` / `Gjn` (`chunk@294254613.js:2034842, 3401046`):
    // HTTP 400 refusing `clear_tool_uses_20250919` latches the model for the
    // process, strips the edit for this request, and retries cleanly.
    if (
      state.lastSentClearToolUses &&
      handleClearToolUsesRefusalError(error, options.model)
    ) {
      state.clearToolUsesDisabledForRequest = true
      state.lastSentClearToolUses = false
      return 'retry:tool-result-clearing-edit'
    }

    // Official 2.1.314 k0o — API 400 "Invalid effort level" from org cap:
    // step down one effort level, latch for this session, and retry.
    if (
      isInvalidEffortLevelError(error) &&
      options.querySource !== 'auto_mode' &&
      options.querySource !== 'auto_mode_investigator'
    ) {
      const sentEffort =
        state.effortLevelForTranscript ??
        (typeof state.effort === 'string' && isEffortLevel(state.effort)
          ? state.effort
          : undefined)
      if (sentEffort !== undefined) {
        const nextCap = stepDownOrgEffortCap(options.model, sentEffort)
        if (nextCap !== undefined) {
          state.effort = clampEffortToCap(state.effort, nextCap)
          logForDebugging(
            `[effort] the API refused effort '${sentEffort}' as above the organization's cap for model ${options.model}. Sending the request again at no more than '${nextCap}', as later requests to this model will be.`,
            { level: 'warn' },
          )
          return `retry:org-effort-cap:${nextCap}`
        }
      }
    }

    // Official s9o / nwt (#12 / 2.1.328) — runs BEFORE d9o (decideContext1mBetaRetry)
    // in N9o = [..., s9o, OTe, d9o, ...]. Strip all rejected non-1m beta headers at
    // once (including non-400 statuses such as 422) and log tengu_beta_400_healed.
    // Exclude CONTEXT_1M_BETA_HEADER (official Jcs) so it is exclusively handled
    // by decideContext1mBetaRetry and never silently stripped on direct 1P.
    const nonContext1mSentBetas = [
      ...lastBetas,
      ...state.lastRequestBedrockBetas,
    ].filter(b => b !== CONTEXT_1M_BETA_HEADER)
    const rejectedBetas = findRejectedBetaHeaders(error, nonContext1mSentBetas)
    if (rejectedBetas.length > 0) {
      const rejectedSet = new Set(rejectedBetas.map(r => r.header))
      state.betas = state.betas.filter(b => !rejectedSet.has(b))
      for (const h of rejectedSet) {
        state.strippedBedrockBetas.add(h)
      }
      if (rejectedSet.has(PROMPT_CACHING_SCOPE_BETA_HEADER)) {
        stickyRejectBeta(PROMPT_CACHING_SCOPE_BETA_HEADER)
        state.system = buildSystem()
      }
      if (
        rejectedSet.has(EFFORT_BETA_HEADER) &&
        error instanceof APIError &&
        error.status === 400
      ) {
        if (options.leavesEffortSupportAlone) {
          state.effort = undefined
        } else {
          markEffortUnsupported(options.model)
        }
      }
      for (const match of rejectedBetas) {
        logEvent('tengu_beta_400_healed', {
          beta: match.header as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          provider:
            getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...(error instanceof APIError && { status: error.status }),
          only_mentioned: match.onlyMentioned,
        })
      }
      return `retry:beta-rejected:${rejectedBetas.map(r => r.header).join(',')}`
    }

    // Official d9o / Rve (2.1.295 #358 / 2.1.328) — runs AFTER s9o so dual-beta
    // 400s (e.g. rejecting both effort and context-1m) strip the non-1m beta first,
    // then retry without context-1m on the next attempt and latch
    // markContext1mBetaRefusedForModel on retry success, while direct Anthropic
    // providers (1P or anthropicAws with default base URL) never silently strip
    // context-1m. Check both header betas and Bedrock extra body betas.
    const provider = getAPIProvider()
    const isDirectAnthropicProvider =
      (provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()) ||
      (provider === 'anthropicAws' && !process.env.ANTHROPIC_AWS_BASE_URL)
    const hasContext1mBeta =
      lastBetas.includes(CONTEXT_1M_BETA_HEADER) ||
      state.lastRequestBedrockBetas.includes(CONTEXT_1M_BETA_HEADER)
    const context1mRetry = decideContext1mBetaRetry({
      error,
      phase: state.context1mBetaRetryPhase,
      context1mBetaSent: hasContext1mBeta,
      isDirectAnthropicProvider,
      isFirstParty: isDirectAnthropicProvider,
    })
    state.context1mBetaRetryPhase = context1mRetry.nextPhase
    if (context1mRetry.action === 'retry:context-1m-beta') {
      logForDebugging(
        `[betas] an HTTP 400 ${context1mRetry.nextPhase === 'retrying' ? 'reads as the backend rejecting' : 'says "invalid beta flag", which may be about'} ${CONTEXT_1M_BETA_HEADER}; resending once without it`,
        { level: 'warn' },
      )
      return 'retry:context-1m-beta'
    }

    // Official OLt (#13) — strip oldest images/documents on unprocessable
    // media limit rejection and step down through [510, 255, 127].
    const existingCap = getSessionMediaItemCap(
      sessionIdForMediaCap,
      resolvedModel,
    )
    if (isUnprocessableMediaError(error) && !existingCap?.gaveUp) {
      const currentCount = countStoredMediaItems(state.messagesForAPI)
      const capBound = Math.min(
        currentCount,
        state.pendingMediaCap?.limit ?? Infinity,
      )
      const nextLimit = MEDIA_ITEM_LIMIT_STEPS.find(step => step < capBound)
      if (nextLimit === undefined) {
        if (state.pendingMediaCap !== undefined) {
          const { steps, refusedAt } = state.pendingMediaCap
          state.pendingMediaCap = undefined
          setSessionMediaItemCap(sessionIdForMediaCap, {
            model: resolvedModel,
            limit: existingCap?.limit,
            gaveUp: true,
          })
          logForDebugging(
            `[media-item-limit] The model still refuses this request as unprocessable with ${currentCount} images and documents left. Not removing any more.`,
            { level: 'warn' },
          )
          logEvent('tengu_api_request_media_limit_gave_up', {
            query_source:
              options.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            media_items_refused: refusedAt,
            steps,
          })
        }
        return undefined
      }
      const stripToLimit = (
        msgs: NormalizedApiMessage[],
        recordStripped = false,
      ) => {
        const collector = recordStripped ? mediaTakenOut : undefined
        const next = stripStoredMediaForRequestLimit(
          msgs,
          nextLimit,
          HWT_KEEP_PADDING,
          Number.POSITIVE_INFINITY,
          0,
          collector,
        )
        if (collector && collector.length > 0) {
          const strippedImages = countStrippedImageBlocks(collector)
          if (strippedImages > 0) {
            noteImageMediaStripped(options.agentId, strippedImages)
          }
        }
        return next
      }
      state.messagesForAPI = stripToLimit(state.messagesForAPI, true)
      if (state.midConvFallback) {
        const prevFallback = state.midConvFallback
        state.midConvFallback = () => stripToLimit(prevFallback())
      }
      state.pendingMediaCap = {
        limit: nextLimit,
        steps: (state.pendingMediaCap?.steps ?? 0) + 1,
        refusedAt: state.pendingMediaCap?.refusedAt ?? currentCount,
      }
      logForDebugging(
        `[media-item-limit] The model refused this request as unprocessable. It held ${currentCount} images and documents; the oldest were removed to fit a limit of ${nextLimit}, and it is being sent again. If it is answered, this conversation keeps that limit.`,
        { level: 'warn' },
      )
      return `retry:media-item-limit:${nextLimit}`
    }

    // Official 2.1.326 (#47) `F7s` / `qir` / `c9t`: when a 400 error points at
    // a specific message/content(/tool_result.content) image or PDF block,
    // remove ONLY that failing block and retry instead of dropping sibling PDFs
    // or triggering the ToolSearchRefusalError catch-all (which drops deferred
    // tools and busts the prompt cache).
    if (error instanceof APIError && error.status === 400) {
      const mediaLoc = parseMediaErrorLocation(error.message)
      if (
        mediaLoc &&
        mediaLoc.messageIdx !== undefined &&
        mediaLoc.contentIdx !== undefined
      ) {
        const pairKey = `${mediaLoc.messageIdx}.${mediaLoc.contentIdx}`
        const priorNestedCount =
          state.targetedMediaStripCounts.get(pairKey) ?? 0
        const effectiveNestedIdx =
          mediaLoc.nestedContentIdx !== undefined && priorNestedCount < 3
            ? mediaLoc.nestedContentIdx
            : undefined
        const stripped = stripTargetedMediaBlock(
          state.messagesForAPI as Message[],
          {
            messageIdx: mediaLoc.messageIdx,
            contentIdx: mediaLoc.contentIdx,
            nestedContentIdx: effectiveNestedIdx,
            kind: mediaLoc.kind,
          },
          error.message,
        )
        if (stripped.removed) {
          state.messagesForAPI = stripped.messages as NormalizedApiMessage[]
          if (effectiveNestedIdx !== undefined) {
            state.targetedMediaStripCounts.set(pairKey, priorNestedCount + 1)
          }
          const locDesc =
            effectiveNestedIdx !== undefined
              ? `${pairKey}.tool_result.content.${effectiveNestedIdx}`
              : pairKey
          logForDebugging(
            `[media-strip] Removed rejected ${mediaLoc.kind} at messages.${locDesc} and retrying`,
            { level: 'warn' },
          )
          return `retry:targeted-media:${locDesc}`
        }
      }
    }

    // Official jit.resolve (2.1.300 #790) — degrade refused MCP tool schema
    // to { type: 'object' } and retry.
    const toolSchemaRetry = state.toolSchemaResolver.resolve(
      error,
      state.lastSentToolSchemas,
      filteredTools,
      options.querySource,
    )
    if (toolSchemaRetry !== undefined) {
      return toolSchemaRetry
    }

    // Official 2.1.323 (#1987): recover from mid-conversation role:"system" and
    // api_system cache_control rejections on non-streaming requests as well as
    // streaming requests via the shared `onError` handler.
    if (error instanceof APIError && error.status === 400) {
      if (state.midConvFallback && isMidConvSystemRoleRejected(error)) {
        state.messagesForAPI = state.midConvFallback()
        state.midConvFallback = null
        latchMidConvSystemRejected()
        clearBetasCaches()
        state.betas = state.betas.filter(
          b => b !== MID_CONVERSATION_SYSTEM_BETA_HEADER,
        )
        logForDebugging(
          '[mid-conv-system] server rejected role:"system" — falling back to a body with no {role:"system"} turn, sticky-rejecting the beta until /clear or /compact',
          { level: 'warn' },
        )
        return 'retry:mid-conv-system'
      }
      if (
        shouldCacheControlOnApiSystem() &&
        isApiSystemCacheControlRejected(error)
      ) {
        latchMidConvCachePromotionRejected()
        logForDebugging(
          '[mid-conv-system] proxy rejected cache_control on the api_system tail — demoting the breakpoint to the trailing message for this conversation',
          { level: 'warn' },
        )
        return 'retry:api-system-cache-demote'
      }
    }

    // Official 2.1.328 `DTe` / `N9e` (LAST in `N9o`, AFTER mid-conv-system and
    // all targeted error recoveries): retry without deferred tools on 400/422
    // refusal, gated on direct-1P `defer_loading` and excluding withRetry/Foundry
    // errors.
    if (
      shouldTriggerToolSearchRefusal({
        error,
        useSearchExtraTools,
        alreadyRetried: options._toolSearchRefusalRetried === true,
        isDirectAnthropicProvider,
        provider,
        model: options.model,
      })
    ) {
      const apiErr = error as APIError
      logForDebugging(
        `[ToolSearch] HTTP ${apiErr.status}; sending the request again without deferred tools`,
        { level: 'warn' },
      )
      throw new ToolSearchRefusalError(error)
    }

    return undefined
  }
}

/**
 * densable vi() — sticky mid-conv system / api_system cache demote when
 * stream create() fails with HTTP 400. Throws MidConvSystemRetryError so
 * withRetry retries with the rewritten body/betas, or rethrows createError.
 */
export function handleMidConvCreateError(
  createError: unknown,
  params: BetaMessageStreamParams,
  state: ApiRequestAdaptationState,
): never {
  if (createError instanceof APIError && createError.status === 400) {
    const roleRejected = isMidConvSystemRoleRejected(createError)
    if (state.midConvFallback && roleRejected) {
      state.messagesForAPI = state.midConvFallback()
      state.midConvFallback = null
      latchMidConvSystemRejected()
      // densable: p = p.filter o3; getAllModelBetas is memoized — clear so
      // subsequent turns re-run J8t against sticky reject.
      clearBetasCaches()
      state.betas = state.betas.filter(
        b => b !== MID_CONVERSATION_SYSTEM_BETA_HEADER,
      )
      logForDebugging(
        '[mid-conv-system] server rejected role:"system" — falling back to a body with no {role:"system"} turn, sticky-rejecting the beta until /clear or /compact',
        { level: 'warn' },
      )
      logEvent('tengu_mid_conv_system_fallback_retry', {
        per_turn_effort:
          false as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      throw new MidConvSystemRetryError('mid-conv-system')
    }
    // densable e9i: proxy rejected cache_control on api_system tail
    // only when we actually promoted cache_control onto a system message.
    const requestHasApiSystemCache =
      shouldCacheControlOnApiSystem() &&
      (
        params.messages as Array<{
          role?: string
          content?: unknown
        }>
      ).some(m => {
        if (m.role !== 'system' || !Array.isArray(m.content)) {
          return false
        }
        return (m.content as Array<Record<string, unknown>>).some(
          block =>
            block &&
            typeof block === 'object' &&
            'cache_control' in block &&
            block.cache_control != null,
        )
      })
    if (
      requestHasApiSystemCache &&
      isApiSystemCacheControlRejected(createError)
    ) {
      latchMidConvCachePromotionRejected()
      logForDebugging(
        '[mid-conv-system] proxy rejected cache_control on the api_system tail — demoting the breakpoint to the trailing message for this conversation',
        { level: 'warn' },
      )
      logEvent('tengu_mid_conv_system_fallback_retry', {
        per_turn_effort:
          false as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      throw new MidConvSystemRetryError('api-system-cache-demote')
    }
  }
  throw createError
}
