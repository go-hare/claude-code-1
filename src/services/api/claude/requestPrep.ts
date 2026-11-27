import { feature } from 'bun:bundle'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { SEARCH_EXTRA_TOOLS_TOOL_NAME } from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import { randomUUID } from 'crypto'
import { existsSync, unlinkSync } from 'node:fs'
import {
  getAfkModeHeaderLatched,
  getFastModeHeaderLatched,
  getSessionId,
  getThinkingResumptionRefused,
  setAfkModeHeaderLatched,
  setFastModeHeaderLatched,
} from 'src/bootstrap/state.js'
import {
  ADVISOR_BETA_HEADER,
  CACHE_DIAGNOSIS_BETA_HEADER,
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
import {
  ADVISOR_TOOL_INSTRUCTIONS,
  getExperimentAdvisorModels,
  isAdvisorEnabled,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from 'src/utils/advisor.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import {
  shouldIncludeFirstPartyOnlyBetas,
  shouldUseGlobalCacheScope,
} from 'src/utils/betas.js'
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME } from 'src/utils/claudeInChrome/common.js'
import { CHROME_SEARCH_EXTRA_TOOLS_INSTRUCTIONS } from 'src/utils/claudeInChrome/prompt.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from 'src/utils/fastMode.js'
import { stripFoundryUnsupportedToolFields } from 'src/utils/foundryCapabilities.js'
import { isMcpInstructionsDeltaEnabled } from 'src/utils/mcpInstructionsDelta.js'
import {
  getModelFacts,
  querySourceSkipsModelFactsReuse,
} from 'src/utils/model/modelFacts.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { queryCheckpoint } from 'src/utils/queryProfiler.js'
import {
  extractDiscoveredToolNames,
  getDeferredToolPlaceholderSchema,
  isDeferredToolsDeltaEnabled,
  isSearchExtraToolsEnabled,
} from 'src/utils/searchExtraTools.js'
import {
  getStickyBetas,
  isStickyBetaRejected,
  isStickyBetaSentActive,
  stickySendBeta,
} from '../../../bootstrap/state.js'
import {
  getBreakCacheAlwaysPath,
  getBreakCacheMarkerPath,
} from '../../../commands/break-cache/index.js'
import {
  getAttributionHeader,
  getCLISyspromptPrefix,
} from '../../../constants/system.js'
import { type Tool, type Tools, toolMatchesName } from '../../../Tool.js'
import type { Message } from '../../../types/message.js'
import { logAPIPrefix, toolToAPISchema } from '../../../utils/api.js'
import { isContext1mBetaRefusedForModel } from '../../../utils/betaRefusals.js'
import {
  getMergedBetas,
  getSearchExtraToolsBetaHeader,
} from '../../../utils/betas.js'
import { resolveAppliedEffort } from '../../../utils/effort.js'
import {
  buildAdvisorStripPlanFromMessages,
  ensureToolResultPairing,
  hideUnderlyingV1Tools,
  mergeAdvisorStripPlans,
  normalizeMessagesForAPI,
  stripAdvisorBlocks,
  stripAdvisorBlocksFromMessageIds,
  stripCallerFieldFromAssistantMessage,
  stripToolReferenceBlocksFromUserMessage,
} from '../../../utils/messages.js'
import { isApiSystemMessage } from '../../../utils/midConversationSystem.js'
import { getInferenceProfileBackingModel } from '../../../utils/model/bedrock.js'
import {
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
} from '../../../utils/model/model.js'
import {
  announcePrefixLedger,
  prefixLedgerNotice,
} from '../../../utils/processUserInput/prefixLedger.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import {
  countStrippedImageBlocks,
  getRequestLimitMediaByteCap,
  getRequestLimitMediaKeepCount,
  HWT_BYTE_PADDING,
  HWT_KEEP_PADDING,
  noteImageMediaStripped,
  shouldTrackImageMediaStripped,
  stripStoredMediaForRequestLimit,
} from '../../../utils/subagentCacheEvict.js'
import {
  asSystemPrompt,
  type SystemPrompt,
} from '../../../utils/systemPromptType.js'
import {
  isBetaTracingEnabled,
  type LLMRequestNewContext,
  startLLMRequestSpan,
} from '../../../utils/telemetry/sessionTracing.js'
import {
  applyThinkingStripPlanToMessages,
  buildThinkingStripPlanFromMessages,
  mergeThinkingStripPlans,
  stripForeignThinkingBlocks,
} from '../../../utils/thinking.js'
import { logEvent } from '../../analytics/index.js'
import {
  currentLimits,
  type QuotaRejectedQuerySourceBucket,
} from '../../claudeAiLimits.js'
import { shouldDeferLspTool } from '../../lsp/manager.js'
import { isToolFromMcpServer } from '../../mcp/utils.js'
import type { GlobalCacheStrategy } from '../logging.js'
import { recordPromptState } from '../promptCacheBreakDetection.js'
import { getPreviousRequestIdFromMessages } from './messageParams.js'
import {
  getPromptCachingEnabled,
  isPromptCacheDiagnosticsEnabled,
  should1hCacheTTL,
} from './promptCaching.js'
import { getExtraBodyParams } from './requestParams.js'
import {
  buildSystemPromptBlocks,
  computeDeferredToolNamesForRequest,
  getHeldInlineTools,
  getSessionMediaItemCap,
  latchDeclaredTools,
  maybeAppendDeferredToolsAnnouncement,
  resolveCarriedEffortForModel,
} from './toolAndMediaHelpers.js'
import type {
  NormalizedApiMessage,
  Options,
  PreparedAnthropicContext,
  PreparedMessagesAndTools,
} from './types.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../../utils/permissions/autoModeState.js') as typeof import('../../../utils/permissions/autoModeState.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Shared preprocessing phase executed before provider delegation
 * (OpenAI/Gemini/Grok short-circuit after this step, before Anthropic-specific
 * system prompt caching and beta latches).
 */
export async function prepareNormalizedMessagesAndTools(
  messages: Message[],
  tools: Tools,
  options: Options,
): Promise<PreparedMessagesAndTools> {
  // Derive previous request ID from the last assistant message in this query chain.
  // This is scoped per message array (main thread, subagent, teammate each have their own),
  // so concurrent agents don't clobber each other's request chain tracking.
  // Also naturally handles rollback/undo since removed messages won't be in the array.
  const previousRequestId = getPreviousRequestIdFromMessages(messages)

  const resolvedModel =
    getAPIProvider() === 'bedrock' &&
    options.model.includes('application-inference-profile')
      ? ((await getInferenceProfileBackingModel(options.model)) ??
        options.model)
      : options.model

  // densable jqt yt: reuse h when h.model===qe && !$z(querySource), else zu(qe).
  const modelFacts =
    options.modelFacts?.model === resolvedModel &&
    !querySourceSkipsModelFactsReuse(options.querySource)
      ? options.modelFacts
      : getModelFacts(resolvedModel)
  void modelFacts

  // densable 2.1.233 #16 FRi — print stderr [claude-code:unrecognized_model]
  // once per stripped model id (before tool schema build).
  try {
    const { signalUnrecognizedModel } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/utils/model/unrecognizedModelSignal.js') as typeof import('src/utils/model/unrecognizedModelSignal.js')
    signalUnrecognizedModel(options.model, options.querySource)
  } catch {
    // optional diagnostic
  }

  queryCheckpoint('query_tool_schema_build_start')
  const isAgenticQuery =
    options.querySource.startsWith('repl_main_thread') ||
    options.querySource.startsWith('agent:') ||
    options.querySource === 'sdk' ||
    options.querySource === 'hook_agent' ||
    options.querySource === 'verification_agent'

  /**
   * densable hAm: Hz(agentContext)=agentType==="main" (no ALS store ⇒ main) AND
   * B1(querySource)==="main" (repl_main_thread* | sdk) → main_thread; else other.
   * Passed to extractQuotaStatusFromError → quotaRejected → s0v rearm gate.
   */
  const quotaRejectQuerySourceBucket: QuotaRejectedQuerySourceBucket = (() => {
    // Local ALS has no agentType:"main" object — undefined store ⇒ main (SEA Hz).
    const isMainAgent =
      (options.agentContext ?? getAgentContext()) === undefined
    const qs = options.querySource
    const isMainSource = qs.startsWith('repl_main_thread') || qs === 'sdk'
    return isMainAgent && isMainSource ? 'main_thread' : 'other'
  })()

  // densable mzt → sticky-filter o3: if midConvLatchedOff (Iz sticky reject),
  // drop o3 from the request beta list for the rest of the session.
  const betas = getMergedBetas(options.model, { isAgenticQuery }).filter(
    b =>
      !(
        (b === MID_CONVERSATION_SYSTEM_BETA_HEADER &&
          isStickyBetaRejected(MID_CONVERSATION_SYSTEM_BETA_HEADER)) ||
        (b === THINKING_DISPLAY_UPDATES_BETA_HEADER &&
          isStickyBetaRejected(THINKING_DISPLAY_UPDATES_BETA_HEADER)) ||
        (b === THINKING_BINDING_CONTROLS_BETA_HEADER &&
          isStickyBetaRejected(THINKING_BINDING_CONTROLS_BETA_HEADER)) ||
        (b === THINKING_TOKEN_COUNT_BETA_HEADER &&
          isStickyBetaRejected(THINKING_TOKEN_COUNT_BETA_HEADER)) ||
        (b === THINKING_RESUMPTION_BETA_HEADER &&
          (isStickyBetaRejected(THINKING_RESUMPTION_BETA_HEADER) ||
            getThinkingResumptionRefused())) ||
        (b === DANGEROUS_TOOL_USE_BETA_HEADER &&
          isStickyBetaRejected(DANGEROUS_TOOL_USE_BETA_HEADER)) ||
        (b === CONTEXT_1M_BETA_HEADER &&
          isContext1mBetaRefusedForModel(options.model))
      ),
  )

  // Always send the advisor beta header when advisor is enabled, so
  // non-agentic queries (compact, side_question, extract_memories, etc.)
  // can parse advisor server_tool_use blocks already in the conversation history.
  if (isAdvisorEnabled()) {
    betas.push(ADVISOR_BETA_HEADER)
  }

  let advisorModel: string | undefined
  if (isAgenticQuery && isAdvisorEnabled()) {
    let advisorOption = options.advisorModel

    const advisorExperiment = getExperimentAdvisorModels()
    if (advisorExperiment !== undefined) {
      if (
        normalizeModelStringForAPI(advisorExperiment.baseModel) ===
        normalizeModelStringForAPI(options.model)
      ) {
        // Override the advisor model if the base model matches. We
        // should only have experiment models if the user cannot
        // configure it themselves.
        advisorOption = advisorExperiment.advisorModel
      }
    }

    if (advisorOption) {
      const normalizedAdvisorModel = normalizeModelStringForAPI(
        parseUserSpecifiedModel(advisorOption),
      )
      if (!modelSupportsAdvisor(options.model)) {
        logForDebugging(
          `[AdvisorTool] Skipping advisor - base model ${options.model} does not support advisor`,
        )
      } else if (!isValidAdvisorModel(normalizedAdvisorModel)) {
        logForDebugging(
          `[AdvisorTool] Skipping advisor - ${normalizedAdvisorModel} is not a valid advisor model`,
        )
      } else {
        advisorModel = normalizedAdvisorModel
        logForDebugging(
          `[AdvisorTool] Server-side tool enabled with ${advisorModel} as the advisor model`,
        )
      }
    }
  }

  // Check if tool search is enabled (checks mode, model support, and threshold for auto mode)
  // This is async because it may need to calculate MCP tool description sizes for TstAuto mode
  let useSearchExtraTools = options._toolSearchRefusalRetried
    ? false
    : await isSearchExtraToolsEnabled(
        options.model,
        tools,
        options.getToolPermissionContext,
        options.agents,
        'query',
      )

  // Precompute once — isDeferredTool does 2 GrowthBook lookups per call
  const stickyBetas = getStickyBetas()
  const heldInlineTools = getHeldInlineTools(stickyBetas)
  const deferredToolNames = computeDeferredToolNamesForRequest(
    tools,
    useSearchExtraTools,
    heldInlineTools,
  )

  // Even if tool search mode is enabled, skip if there are no deferred tools
  // AND no MCP servers are still connecting. When servers are pending, keep
  // SearchExtraTools available so the model can discover tools after they connect.
  if (
    useSearchExtraTools &&
    deferredToolNames.size === 0 &&
    !options.hasPendingMcpServers
  ) {
    logForDebugging(
      'Tool search disabled: no deferred tools available to search',
    )
    useSearchExtraTools = false
  }

  // densable query path: when S (tool search on), keep non-deferred + ToolSearch
  // + tools discovered via Lwe(messages) tool_reference; drop other deferred.
  // When off, exclude ToolSearch from the tools array entirely.
  let filteredTools: Tools
  const discoveredToolNames = useSearchExtraTools
    ? extractDiscoveredToolNames(messages)
    : new Set<string>()

  if (useSearchExtraTools) {
    filteredTools = tools.filter(tool => {
      if (!deferredToolNames.has(tool.name)) return true
      if (toolMatchesName(tool, SEARCH_EXTRA_TOOLS_TOOL_NAME)) return true
      return discoveredToolNames.has(tool.name)
    })
  } else {
    filteredTools = tools.filter(
      t => !toolMatchesName(t, SEARCH_EXTRA_TOOLS_TOOL_NAME),
    )
  }
  // densable v=Qzr(T) — hide v1 tools when a Batch* wrapper is in T
  filteredTools = hideUnderlyingV1Tools(filteredTools)

  // densable: A = S ? Jvu() : null; if A && provider !== bedrock → betas.push(A)
  // Bedrock carries the tool-search beta via extra body params instead.
  if (useSearchExtraTools) {
    const toolSearchBeta = getSearchExtraToolsBetaHeader()
    if (getAPIProvider() !== 'bedrock' && !betas.includes(toolSearchBeta)) {
      betas.push(toolSearchBeta)
    }
  }

  const useGlobalCacheFeature = shouldUseGlobalCacheScope()
  // MCP tools are per-user → dynamic tool section → can't globally cache.
  const needsToolBasedCacheMarker =
    useGlobalCacheFeature && filteredTools.some(t => t.isMcp === true)

  // Ensure prompt_caching_scope beta header is present when global cache is enabled.
  if (
    useGlobalCacheFeature &&
    !betas.includes(PROMPT_CACHING_SCOPE_BETA_HEADER)
  ) {
    betas.push(PROMPT_CACHING_SCOPE_BETA_HEADER)
  }

  // Determine global cache strategy for logging
  const globalCacheStrategy: GlobalCacheStrategy = useGlobalCacheFeature
    ? needsToolBasedCacheMarker
      ? 'none'
      : 'system_prompt'
    : 'none'

  // densable mqo: deferLoading = S && (deferred || WIb LSP-pending)
  // Pass full `tools` into toolToAPISchema so ToolSearch prompt sees all MCP tools.
  const shouldDeferForToolSearch = (tool: Tool): boolean =>
    useSearchExtraTools &&
    (deferredToolNames.has(tool.name) || shouldDeferLspTool(tool))

  if (useSearchExtraTools && heldInlineTools === undefined) {
    latchDeclaredTools(
      stickyBetas,
      filteredTools.filter(t => !shouldDeferForToolSearch(t)).map(t => t.name),
    )
  }

  const toolSchemas = await Promise.all(
    filteredTools.map(tool =>
      toolToAPISchema(tool, {
        getToolPermissionContext: options.getToolPermissionContext,
        tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
        model: options.model,
        deferLoading: shouldDeferForToolSearch(tool),
      }),
    ),
  )

  // densable dBp: inject DeferredToolPlaceholder when tool search is on
  if (useSearchExtraTools) {
    const placeholder = getDeferredToolPlaceholderSchema()
    if (
      placeholder &&
      !toolSchemas.some(t => 'name' in t && t.name === placeholder.name)
    ) {
      // Insert before last tool (densable: splice(max(len-1,0), 0, To))
      toolSchemas.splice(Math.max(toolSchemas.length - 1, 0), 0, placeholder)
    }
    const deferredIncluded = filteredTools.filter(t =>
      deferredToolNames.has(t.name),
    ).length
    logForDebugging(
      `Dynamic tool loading: ${deferredIncluded}/${deferredToolNames.size} deferred tools included` +
        (discoveredToolNames.size > 0
          ? ` (${discoveredToolNames.size} discovered)`
          : ''),
    )
  }

  // densable cnu — strip defer_loading / strict when Foundry deployment learned
  // those features are unsupported (from prior 400s via uns/dns).
  const toolSchemasForApi = stripFoundryUnsupportedToolFields(
    toolSchemas,
    options.model,
  )

  queryCheckpoint('query_tool_schema_build_end')

  // Normalize messages before building system prompt (needed for fingerprinting)
  // Instrumentation: Track message count before normalization
  logEvent('tengu_api_before_normalize', {
    preNormalizedMessageCount: messages.length,
  })

  queryCheckpoint('query_message_normalization_start')
  // densable Uwt / ks — empty body; apply overlay if a ledger ever returns one.
  const prefixOverlay = announcePrefixLedger(
    messages,
    { messages, tools: filteredTools },
    {
      querySource: options.querySource,
      promptEpoch: options.promptRenderEpoch,
    },
  )
  if (prefixOverlay?.tools !== undefined) {
    // gold replaces eke / Wn.tools; gZn()==='off' never reaches
    void prefixOverlay.tools
  }
  // densable Ydy / eN: pass model so J8t can inject api_system after user turns.
  // When o3 is sticky-rejected, omit model so mid-conv path stays off.
  const midConvLatchedOff = isStickyBetaRejected(
    MID_CONVERSATION_SYSTEM_BETA_HEADER,
  )
  const normalizeModel = midConvLatchedOff ? undefined : options.model

  // densable post-normalize pipeline shared by primary + midConvFallback.
  const postNormalizeForAPI = (
    normalized: NormalizedApiMessage[],
  ): NormalizedApiMessage[] => {
    let next = normalized
    // Model-specific post-processing: strip tool-search-specific fields if the
    // selected model doesn't support tool search.
    if (!useSearchExtraTools) {
      next = next.map(msg => {
        switch (msg.type) {
          case 'user':
            // Strip tool_reference blocks from tool_result content
            return stripToolReferenceBlocksFromUserMessage(msg)
          case 'assistant':
            // Strip 'caller' field from tool_use blocks
            return stripCallerFieldFromAssistantMessage(msg)
          default:
            return msg
        }
      })
    }

    // Repair tool_use/tool_result pairing mismatches that can occur when resuming
    // remote/teleport sessions. Inserts synthetic error tool_results for orphaned
    // tool_uses and strips orphaned tool_results referencing non-existent tool_uses.
    next = ensureToolResultPairing(next)

    // densable Lv: $Fe(s?.thinkingStripPlan, MY(g)) then BCr.
    const thinkingPlan = mergeThinkingStripPlans(
      options.thinkingStripPlan,
      buildThinkingStripPlanFromMessages(messages),
    )
    if (thinkingPlan.size > 0) {
      next = applyThinkingStripPlanToMessages(
        next as Message[],
        thinkingPlan,
      ) as typeof next
    }

    // densable Lv: FFe(s?.advisorStripPlan, UD(g)) then C_.
    const advisorPlan = mergeAdvisorStripPlans(
      options.advisorStripPlan,
      buildAdvisorStripPlanFromMessages(messages),
    )
    if (advisorPlan.size > 0) {
      next = stripAdvisorBlocksFromMessageIds(
        next as never,
        advisorPlan,
      ) as typeof next
    }

    // Strip advisor blocks — the API rejects them without the beta header.
    if (!betas.includes(ADVISOR_BETA_HEADER)) {
      next = stripAdvisorBlocks(next)
    }

    // Gold `xGt` / `UY` (#1422): substitute `tool_results_cut` stand-ins
    // when `tengu_adaptive_pinwheel` is enabled.
    const { resolveToolResultCutStandIns, applyToolResultCutStandIns } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../utils/attachments.js') as typeof import('../../../utils/attachments.js')
    const resolvedToolResultCuts = resolveToolResultCutStandIns(
      messages,
      undefined,
      options.toolResultCuts,
    )
    if (resolvedToolResultCuts && resolvedToolResultCuts.size > 0) {
      next = applyToolResultCutStandIns(
        next,
        resolvedToolResultCuts,
      ) as typeof next
    }

    return next
  }

  // Official 2.1.328 `Yso` / `fio` (`chunk@294254613.js:3319260, 6069470`):
  // strip signed `thinking` and `redacted_thinking` blocks ONLY from assistant
  // messages whose `message.model` is foreign/incompatible with the target model,
  // preserving same-model thinking blocks for prompt cache & multi-turn continuity.
  const messagesWithForeignThinkingStripped = stripForeignThinkingBlocks(
    messages,
    normalizeModelStringForAPI(options.model),
    { keepForeignThinking: options.keepForeignThinking },
  )

  let messagesForAPI = postNormalizeForAPI(
    normalizeMessagesForAPI(
      messagesWithForeignThinkingStripped,
      filteredTools,
      normalizeModel,
    ),
  )
  queryCheckpoint('query_message_normalization_end')

  // densable qWT → HWT after query_message_normalization_end (keep 100/600 +
  // pad 20 + NWT byte cap). Not gated on LWT / tengu_subagent_cache_evict.
  // Does not invent display-window GC of tool results.
  const sessionIdForMediaCap = getSessionId()
  const activeMediaCap = getSessionMediaItemCap(
    sessionIdForMediaCap,
    resolvedModel,
  )
  const hwtKeep = Math.min(
    getRequestLimitMediaKeepCount(options.model, betas),
    activeMediaCap?.limit ?? Infinity,
  )
  const hwtByteCap = getRequestLimitMediaByteCap()
  // Official 2.1.325 #1929 (`La` / `zbn`): track stripped media blocks for main
  // conversation and named subagents so FileReadTool's unchanged-image re-read
  // limiter (`Wit=3`) engages when images are evicted from the request.
  const trackImageMediaStripped = shouldTrackImageMediaStripped(
    options.querySource,
    options.agentId,
  )
  const mediaTakenOut: Array<{ type: string }> | undefined =
    trackImageMediaStripped ? [] : undefined
  const applyHwt = (
    msgs: NormalizedApiMessage[],
    recordStripped = false,
  ): NormalizedApiMessage[] => {
    const collector = recordStripped ? mediaTakenOut : undefined
    if (collector) {
      collector.splice(0)
    }
    const next = stripStoredMediaForRequestLimit(
      msgs,
      hwtKeep,
      HWT_KEEP_PADDING,
      hwtByteCap,
      HWT_BYTE_PADDING,
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
  messagesForAPI = applyHwt(messagesForAPI, true)

  // densable qWT midConvFallback: `!midConvLatchedOff && (e8 || fZ)` where
  // e8 = mid-conversation-system beta and fZ = effort beta. Do not invent
  // c8m perTurnEffort (no tip helper).
  let midConvFallback: (() => NormalizedApiMessage[]) | null = null
  if (
    !midConvLatchedOff &&
    (betas.includes(MID_CONVERSATION_SYSTEM_BETA_HEADER) ||
      betas.includes(EFFORT_BETA_HEADER))
  ) {
    const primary = messagesForAPI
    midConvFallback = primary.some(m => isApiSystemMessage(m))
      ? () =>
          applyHwt(
            postNormalizeForAPI(
              normalizeMessagesForAPI(
                messagesWithForeignThinkingStripped,
                filteredTools,
                undefined,
              ),
            ),
          )
      : () => primary
  }

  return {
    previousRequestId,
    resolvedModel,
    isAgenticQuery,
    quotaRejectQuerySourceBucket,
    betas,
    advisorModel,
    useSearchExtraTools,
    deferredToolNames,
    filteredTools,
    needsToolBasedCacheMarker,
    globalCacheStrategy,
    toolSchemas,
    toolSchemasForApi,
    messagesForAPI,
    midConvFallback,
    sessionIdForMediaCap,
    mediaTakenOut,
  }
}

/**
 * Anthropic-specific request preparation (runs after OpenAI/Gemini/Grok
 * short-circuit checks): deferred tool announcements, system prompt assembly,
 * cache latches, effort resolution, prompt cache break detection, and OTel span.
 */
export function prepareAnthropicRequestContext(params: {
  messages: Message[]
  systemPrompt: SystemPrompt
  tools: Tools
  options: Options
  prepared: PreparedMessagesAndTools
}): PreparedAnthropicContext {
  const { messages, tools, options, prepared } = params

  // Instrumentation: Track message count after normalization
  logEvent('tengu_api_after_normalize', {
    postNormalizedMessageCount: prepared.messagesForAPI.length,
  })

  // When the delta attachment is enabled, deferred tools are announced
  // via persisted deferred_tools_delta attachments instead of this
  // ephemeral prepend (which busts cache whenever the pool changes).
  if (prepared.useSearchExtraTools && !isDeferredToolsDeltaEnabled()) {
    prepared.messagesForAPI = maybeAppendDeferredToolsAnnouncement(
      prepared.messagesForAPI,
      tools,
      prepared.deferredToolNames,
    )
  }

  // Chrome tool-search instructions: when the delta attachment is enabled,
  // these are carried as a client-side block in mcp_instructions_delta
  // (attachments.ts) instead of here. This per-request sys-prompt append
  // busts the prompt cache when chrome connects late.
  const hasChromeTools = prepared.filteredTools.some(t =>
    isToolFromMcpServer(t.name, CLAUDE_IN_CHROME_MCP_SERVER_NAME),
  )
  const injectChromeHere =
    prepared.useSearchExtraTools &&
    hasChromeTools &&
    !isMcpInstructionsDeltaEnabled()

  // filter(Boolean) works by converting each element to a boolean - empty strings become false and are filtered out.
  let systemPrompt = asSystemPrompt(
    [
      getAttributionHeader(),
      getCLISyspromptPrefix({
        isNonInteractive: options.isNonInteractiveSession,
        hasAppendSystemPrompt: options.hasAppendSystemPrompt,
      }),
      ...params.systemPrompt,
      ...(prepared.advisorModel ? [ADVISOR_TOOL_INSTRUCTIONS] : []),
      ...(injectChromeHere ? [CHROME_SEARCH_EXTRA_TOOLS_INSTRUCTIONS] : []),
    ].filter(Boolean),
  )

  // ── Break-cache integration ──
  // If a one-time break-cache marker exists, or always-mode is on, append a
  // unique ephemeral nonce comment to the system prompt so the prefix-cache
  // hash changes for this request, forcing a cache miss.
  {
    const onceMarker = getBreakCacheMarkerPath()
    const alwaysFlag = getBreakCacheAlwaysPath()
    const shouldBreak = existsSync(onceMarker) || existsSync(alwaysFlag)
    if (shouldBreak) {
      const nonce = randomUUID()
      systemPrompt = asSystemPrompt([
        ...systemPrompt,
        `<!-- cache-break nonce: ${nonce} -->`,
      ])
      // Only delete the once marker; the always flag persists until /break-cache off
      if (existsSync(onceMarker)) {
        try {
          unlinkSync(onceMarker)
        } catch {
          /* best-effort */
        }
      }
    }
  }

  // Prepend system prompt block for easy API identification
  logAPIPrefix(systemPrompt)

  const enablePromptCaching =
    options.enablePromptCaching ?? getPromptCachingEnabled(options.model)
  const buildSystem = (): TextBlockParam[] =>
    buildSystemPromptBlocks(systemPrompt, enablePromptCaching, {
      skipGlobalCacheForSystemPrompt: prepared.needsToolBasedCacheMarker,
      querySource: options.querySource,
      agentCacheTtlOverride: options.agentCacheTtlOverride,
      scopeRefused: isStickyBetaRejected(PROMPT_CACHING_SCOPE_BETA_HEADER),
    })
  const system = buildSystem()
  const useBetas = prepared.betas.length > 0

  // densable 2.1.251 D6e — Sr intended TTL + main-thread querySource for xhe
  const intendedPromptCacheTtl = should1hCacheTTL(options.querySource, {
    agentCacheTtlOverride: options.agentCacheTtlOverride,
  })
    ? ('1h' as const)
    : ('5m' as const)
  const sessionCostAttribution = {
    activeMcpServer: options.activeMcpServer,
    activeMcpTool: options.activeMcpTool,
    querySource: options.querySource,
    intendedPromptCacheTtl,
    agentContext: options.agentContext ?? getAgentContext(),
  }

  // Build minimal context for detailed tracing (when beta tracing is enabled)
  // Note: The actual new_context message extraction is done in sessionTracing.ts using
  // hash-based tracking per querySource (agent) from the messagesForAPI array
  const extraToolSchemas = [...(options.extraToolSchemas ?? [])]
  if (prepared.advisorModel) {
    // Server tools must be in the tools array by API contract. Appended after
    // toolSchemas (which carries the cache_control marker) so toggling /advisor
    // only churns the small suffix, not the cached prefix.
    extraToolSchemas.push({
      type: 'advisor_20260301',
      name: 'advisor',
      model: prepared.advisorModel,
    } as unknown as BetaToolUnion)
  }
  const allTools = [...prepared.toolSchemasForApi, ...extraToolSchemas]

  // densable Bwt after assemble. gZn()==='off' returns void — no prefix_delta.
  const prefixNotice = prefixLedgerNotice(
    messages,
    {
      model: options.model,
      tools: allTools,
      system,
      messages: prepared.messagesForAPI,
    },
    {
      querySource: options.querySource,
      retryCause: undefined,
      promptEpoch: options.promptRenderEpoch,
    },
  )
  if (prefixNotice !== undefined) {
    // gold yields prefix_delta then re-assembles; off-mode never reaches
    void prefixNotice
  }

  const isFastMode =
    isFastModeEnabled() &&
    isFastModeAvailable() &&
    !isFastModeCooldown() &&
    isFastModeSupportedByModel(options.model) &&
    !!options.fastMode

  // Sticky-on latches for dynamic beta headers. Each header, once first
  // sent, keeps being sent for the rest of the session so mid-session
  // toggles don't change the server-side cache key and bust ~50-70K tokens.
  // Latches are cleared on /clear and /compact via clearBetaHeaderLatches().
  // Per-call gates (isAgenticQuery, querySource===repl_main_thread) stay
  // per-call so non-agentic queries keep their own stable header set.

  let afkHeaderLatched = getAfkModeHeaderLatched() === true
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (
      !afkHeaderLatched &&
      prepared.isAgenticQuery &&
      shouldIncludeFirstPartyOnlyBetas() &&
      (autoModeStateModule?.isAutoModeActive() ?? false)
    ) {
      afkHeaderLatched = true
      setAfkModeHeaderLatched(true)
    }
  }

  let fastModeHeaderLatched = getFastModeHeaderLatched() === true
  if (!fastModeHeaderLatched && isFastMode) {
    fastModeHeaderLatched = true
    setFastModeHeaderLatched(true)
  }

  const carriedEffort = resolveCarriedEffortForModel(
    {
      loopEffort: options.refusalFallbackEffort,
      continuesMainConversation: !(options.agentContext ?? getAgentContext()),
    },
    prepared.resolvedModel,
  )
  const requestedEffort = resolveAppliedEffort(
    options.model,
    options.effortValue,
    {
      carriedEffort,
      querySource: options.querySource,
    },
  )
  const effort = requestedEffort

  // densable MWT/pje/a7e — latch cache-diagnosis beta independently of YNe /
  // PROMPT_CACHE_BREAK_DETECTION. SEA still injects Opt when t1f is skipped.
  if (isPromptCacheDiagnosticsEnabled()) {
    stickySendBeta(CACHE_DIAGNOSIS_BETA_HEADER)
  }
  const cacheDiagnosisLatched = isStickyBetaSentActive(
    CACHE_DIAGNOSIS_BETA_HEADER,
  )

  if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
    // Exclude defer_loading tools from the hash -- the API strips them from the
    // prompt, so they never affect the actual cache key. Including them creates
    // false-positive "tool schemas changed" breaks when tools are discovered or
    // MCP servers reconnect.
    const toolsForCacheDetection = allTools.filter(
      t => !('defer_loading' in t && t.defer_loading),
    )
    // Capture everything that could affect the server-side cache key.
    // Pass latched header values (not live state) so break detection
    // reflects what we actually send, not what the user toggled.
    recordPromptState({
      system,
      toolSchemas: toolsForCacheDetection,
      querySource: options.querySource,
      model: options.model,
      agentId: options.agentId,
      fastMode: fastModeHeaderLatched,
      globalCacheStrategy: prepared.globalCacheStrategy,
      betas: prepared.betas,
      autoModeActive: afkHeaderLatched,
      isUsingOverage: currentLimits.isUsingOverage ?? false,
      anyDeferLoading: toolsForCacheDetection.length !== allTools.length,
      is1hCacheTTL: should1hCacheTTL(options.querySource, {
        agentCacheTtlOverride: options.agentCacheTtlOverride,
      }),
      queryDepth: options.queryTracking?.depth,
      cacheDiagnosis: cacheDiagnosisLatched,
      effortValue: effort,
      extraBodyParams: getExtraBodyParams(),
      messagesForAPI: prepared.messagesForAPI,
    })
  }

  const newContext: LLMRequestNewContext | undefined = isBetaTracingEnabled()
    ? {
        systemPrompt: systemPrompt.join('\n\n'),
        querySource: options.querySource,
        tools: jsonStringify(allTools),
      }
    : undefined

  // Capture the span so we can pass it to endLLMRequestSpan later
  // This ensures responses are matched to the correct request when multiple requests run in parallel
  const llmSpan = startLLMRequestSpan(
    options.model,
    newContext,
    prepared.messagesForAPI,
    isFastMode,
  )

  return {
    systemPrompt,
    buildSystem,
    system,
    useBetas,
    sessionCostAttribution,
    allTools,
    isFastMode,
    afkHeaderLatched,
    fastModeHeaderLatched,
    requestedEffort,
    effort,
    llmSpan,
  }
}
