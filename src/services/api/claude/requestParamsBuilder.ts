import { feature } from 'bun:bundle'
import type {
  BetaJSONOutputFormat,
  BetaMessageStreamParams,
  BetaOutputConfig,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import {
  getThinkingDisplayExplicit,
  getThinkingHighlightsRefused,
  getThinkingTypeOverride,
  isEffortUnsupported,
} from 'src/bootstrap/state.js'
import {
  AFK_MODE_BETA_HEADER,
  CACHE_DIAGNOSIS_BETA_HEADER,
  CONTEXT_1M_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
  copyBetaHeaderToExtraBody,
  DANGEROUS_TOOL_USE_BETA_HEADER,
  FAST_MODE_BETA_HEADER,
  REDACT_THINKING_BETA_HEADER,
  STRUCTURED_OUTPUTS_BETA_HEADER,
  THINKING_BINDING_CONTROLS_BETA_HEADER,
  THINKING_DISPLAY_UPDATES_BETA_HEADER,
  THINKING_RESUMPTION_BETA_HEADER,
  THINKING_TOKEN_COUNT_BETA_HEADER,
} from 'src/constants/betas.js'
import { OAUTH_BETA_HEADER } from 'src/constants/oauth.js'
import { getAnthropicApiKey, isClaudeAISubscriber } from 'src/utils/auth.js'
import {
  modelSupportsStructuredOutputs,
  shouldIncludeFirstPartyOnlyBetas,
} from 'src/utils/betas.js'
import { getMaxThinkingTokensForModel } from 'src/utils/context.js'
import { logForDebugging } from 'src/utils/debug.js'
import { transcriptEffortFromOutputConfig } from 'src/utils/effort.js'
import {
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from 'src/utils/fastMode.js'
import { getModelFacts } from 'src/utils/model/modelFacts.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import {
  filterBetasForSimulateProxyUsage,
  shouldSimulateProxyUsage,
} from 'src/utils/residualFinalEnvGates.js'
import {
  densableExperimentalCapabilityBetas,
  isThinkingActiveForToolChoice,
  modelRejectsDisabledThinking,
  modelSupportsThinking,
  type PrefixMismatchBehavior,
  providerSupportsThinkingBindingOn3P,
  resolveAdaptiveThinkingType,
  resolveOutgoingThinkingDisplay,
  resolvePrefixMismatchBehavior,
  resolveThinkingDisplayMode,
  shouldSendThinkingBindingControls,
  shouldSendThinkingDisplayUpdates,
  shouldSendThinkingResumptionBeta,
  type ThinkingApiDisplay,
  type ThinkingConfig,
} from 'src/utils/thinking.js'
import {
  isStickyBetaRejected,
  isStickyBetaSentActive,
  isThirdPartyServerClassifierRefused,
  stickySendBeta,
} from '../../../bootstrap/state.js'
import type { Message } from '../../../types/message.js'
import { isContext1mBetaRefusedForModel } from '../../../utils/betaRefusals.js'
import { getBedrockExtraBodyParamsBetas } from '../../../utils/betas.js'
import {
  getSonnet1mExpTreatmentEnabled,
  resolveOutputTokenLimitForContinuation,
} from '../../../utils/context.js'
import {
  analyticsQuerySource,
  decideEffortWhenThinkingDisabled,
  formatEffortClampDebugMessage,
  oncePerSession,
  querySourceBucket,
  transcriptEffortWhenMechanicalDisabled,
} from '../../../utils/effortThinkingGuard.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { logError } from '../../../utils/log.js'
import {
  firstPartyNameToCanonical,
  normalizeModelStringForAPI,
} from '../../../utils/model/model.js'
import { sanitizeLoneSurrogatesInPlace } from '../../../utils/sanitization.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../analytics/index.js'
import { getAPIContextManagement } from '../../compact/apiMicrocompact.js'
import {
  getRefusedToolSchemas,
  replaceRefusedToolSchemas,
} from '../../mcp/mcpToolSchema.js'
import {
  filterBetasForClassifierProvider,
  modelAllowsDangerousToolUseBeta,
  serverClassifierBetasEligible,
} from '../autoModeClassifierTransport.js'
import { composeAutoModeClassifierContext } from '../autoModeServerContext.js'
import { getBillingGroupRequestTags } from '../client.js'
import { logAPIQuery } from '../logging.js'
import {
  createServerClassifierRequest,
  settleServerClassifierStreamEnded,
} from '../serverClassifier.js'
import {
  getCachedModelMaxTokensCeiling,
  type RetryContext,
} from '../withRetry.js'
import { addCacheBreakpoints } from './messageParams.js'
import { getPromptCachingEnabled } from './promptCaching.js'
import {
  configureEffortParams,
  configureTaskBudgetParams,
  getAPIMetadata,
  getExtraBodyParams,
  getMaxOutputTokensForModel,
  type TaskBudgetParam,
} from './requestParams.js'
import type { ApiRequestAdaptationState, Options } from './types.js'

export function createParamsFromContext(deps: {
  messages: Message[]
  thinkingConfig: ThinkingConfig
  options: Options
  resolvedModel: string
  isAgenticQuery: boolean
  useBetas: boolean
  allTools: BetaToolUnion[]
  afkHeaderLatched: boolean
  fastModeHeaderLatched: boolean
  state: ApiRequestAdaptationState
}): (retryContext: RetryContext) => BetaMessageStreamParams {
  const {
    messages,
    thinkingConfig,
    options,
    resolvedModel,
    isAgenticQuery,
    useBetas,
    allTools,
    afkHeaderLatched,
    fastModeHeaderLatched,
    state,
  } = deps

  return (retryContext: RetryContext): BetaMessageStreamParams => {
    const omitContext1mBeta =
      (state.context1mBetaRetryPhase !== 'idle' &&
        state.context1mBetaRetryPhase !== 'spent') ||
      isContext1mBetaRefusedForModel(retryContext.model)
    let betasParams = state.betas.filter(
      b => b !== CONTEXT_1M_BETA_HEADER || !omitContext1mBeta,
    )

    // Append 1M beta dynamically for the Sonnet 1M experiment.
    if (
      !omitContext1mBeta &&
      state.context1mBetaRetryPhase === 'idle' &&
      !betasParams.includes(CONTEXT_1M_BETA_HEADER) &&
      getSonnet1mExpTreatmentEnabled(retryContext.model)
    ) {
      betasParams.push(CONTEXT_1M_BETA_HEADER)
    }

    // For Bedrock, include model-based betas (no tool search header — self-built search)
    const bedrockBetas =
      getAPIProvider() === 'bedrock'
        ? getBedrockExtraBodyParamsBetas(retryContext.model).filter(
            b =>
              !state.strippedBedrockBetas.has(b) &&
              (b !== CONTEXT_1M_BETA_HEADER || !omitContext1mBeta),
          )
        : []
    state.lastRequestBedrockBetas = bedrockBetas
    const extraBodyParams = getExtraBodyParams(bedrockBetas)
    const provider = getAPIProvider()
    const isBedrock = provider === 'bedrock'
    // densable Joe @184955815 / @184955861 / @184956555 / @184957363
    copyBetaHeaderToExtraBody(
      extraBodyParams,
      THINKING_TOKEN_COUNT_BETA_HEADER,
      isBedrock && betasParams.includes(THINKING_TOKEN_COUNT_BETA_HEADER),
    )
    // densable `$h` — sticky-send Gv when the classifier compositor is on.
    const allowsDangerousToolUseBeta = modelAllowsDangerousToolUseBeta(
      provider,
      resolvedModel,
    )
    const classifierContext =
      options.serverClassifier === true &&
      options.autoModeServerContext !== undefined
        ? composeAutoModeClassifierContext({
            autoModeServerContext: options.autoModeServerContext,
            priorTurnContext: [],
            systemReminders: [],
          })
        : undefined
    const stickySendDangerousToolUse =
      options.serverClassifier === true &&
      classifierContext !== undefined &&
      allowsDangerousToolUseBeta &&
      serverClassifierBetasEligible() &&
      !isStickyBetaRejected(DANGEROUS_TOOL_USE_BETA_HEADER) &&
      !isThirdPartyServerClassifierRefused()
    if (stickySendDangerousToolUse) {
      stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    }
    if (
      allowsDangerousToolUseBeta &&
      isStickyBetaSentActive(DANGEROUS_TOOL_USE_BETA_HEADER) &&
      !betasParams.includes(DANGEROUS_TOOL_USE_BETA_HEADER)
    ) {
      betasParams.push(DANGEROUS_TOOL_USE_BETA_HEADER)
    }
    copyBetaHeaderToExtraBody(
      extraBodyParams,
      DANGEROUS_TOOL_USE_BETA_HEADER,
      isBedrock && betasParams.includes(DANGEROUS_TOOL_USE_BETA_HEADER),
    )
    copyBetaHeaderToExtraBody(
      extraBodyParams,
      THINKING_BINDING_CONTROLS_BETA_HEADER,
      isBedrock,
    )

    const outputConfig: BetaOutputConfig = {
      ...((extraBodyParams.output_config as BetaOutputConfig) ?? {}),
    }

    configureEffortParams(
      state.effort,
      outputConfig,
      extraBodyParams,
      betasParams,
      options.model,
    )
    if (isEffortUnsupported(options.model)) {
      delete (outputConfig as { effort?: unknown }).effort
    }

    configureTaskBudgetParams(
      options.taskBudget,
      outputConfig as BetaOutputConfig & { task_budget?: TaskBudgetParam },
      betasParams,
    )

    // densable wGo — attach format only when mCn supports structured outputs
    // (CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS / JK / provider / model gates).
    if (
      options.outputFormat &&
      !('format' in outputConfig) &&
      modelSupportsStructuredOutputs(options.model)
    ) {
      outputConfig.format = options.outputFormat as BetaJSONOutputFormat
      if (!betasParams.includes(STRUCTURED_OUTPUTS_BETA_HEADER)) {
        betasParams.push(STRUCTURED_OUTPUTS_BETA_HEADER)
      }
    }

    // Retry context gets preference because it tries to course correct if we exceed the context window limit.
    // Official 2.1.326 (#51) + 2.1.328 (`Math.min($n?.maxTokensOverride || ie.maxOutputTokensOverride || Infinity, nR.ceiling(dn.maxOutputTokens))`):
    // apply any session-cached model output ceiling AND any retry-lowered
    // max_tokens override as strict upper caps so unknown-model continuation
    // never bumps a server-lowered cap (e.g. 16384) back up to 128000.
    const cachedModelCeiling = getCachedModelMaxTokensCeiling(
      retryContext.model,
    )
    const rawMaxOutputTokens =
      options.maxOutputTokensOverride ||
      getMaxOutputTokensForModel(options.model)
    const maxOutputTokens = resolveOutputTokenLimitForContinuation({
      model: options.model,
      requestedMaxTokens: rawMaxOutputTokens,
      continuesCutReply:
        options.continuesCutReply === true &&
        options.querySource !== 'hook_agent' &&
        !options.maxOutputTokensOverride,
      cachedModelCeiling,
      retryMaxTokensOverride: retryContext?.maxTokensOverride,
      isSecurityControl:
        options.querySource === 'auto_mode' ||
        options.querySource === 'auto_mode_investigator',
    })

    // Official DISABLE_THINKING / DISABLE_ADAPTIVE_THINKING densables.
    let thinkingDisabled = isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_THINKING)
    let adaptiveThinkingDisabled = isEnvTruthy(
      process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING,
    )
    try {
      const { isThinkingDisabled, isAdaptiveThinkingDisabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../utils/residualFinalEnvGates.js') as typeof import('../../../utils/residualFinalEnvGates.js')
      thinkingDisabled = isThinkingDisabled()
      adaptiveThinkingDisabled = isAdaptiveThinkingDisabled()
    } catch {
      // residual helpers optional
    }
    // densable Kn = r.type !== "disabled" && !bn
    // Local residual env DISABLE_THINKING still wins (even on HQt models).
    const hasThinking = thinkingConfig.type !== 'disabled' && !thinkingDisabled
    const effortName =
      typeof state.effort === 'string' ? state.effort : undefined
    let thinking:
      | (BetaMessageStreamParams['thinking'] & {
          display?: ThinkingApiDisplay | null
        })
      | undefined
    const extraBodyHasThinking = 'thinking' in extraBodyParams
    const wireDisplay = resolveOutgoingThinkingDisplay(
      thinkingConfig.display,
      options.model,
      getThinkingHighlightsRefused(),
    )

    // IMPORTANT: Do not change the adaptive-vs-budget thinking selection below
    // without notifying the model launch DRI and research. This is a sensitive
    // setting that can greatly affect model quality and bashing.
    if (hasThinking && modelSupportsThinking(options.model)) {
      // densable `p3n({runtimeOverride:Lyn(h.model), resolvedModel:ye, canonicalModel:Pe})`
      const thinkingType = resolveAdaptiveThinkingType({
        runtimeOverride: getThinkingTypeOverride(options.model),
        resolvedModel,
        canonicalModel: firstPartyNameToCanonical(resolvedModel),
        disableAdaptiveEnv: adaptiveThinkingDisabled,
      })
      if (thinkingType === 'adaptive') {
        thinking = {
          type: 'adaptive',
          display: wireDisplay,
        } as BetaMessageStreamParams['thinking']
      } else {
        let thinkingBudget = getMaxThinkingTokensForModel(options.model)
        if (
          thinkingConfig.type === 'enabled' &&
          thinkingConfig.budgetTokens !== undefined
        ) {
          thinkingBudget = thinkingConfig.budgetTokens
        }
        // Official 2.1.328 (`chunk@294254613.js:3372275`): enforce the 1024-token
        // API floor on thinking.budget_tokens (`Math.max(1024, Math.min(maxOutputTokens - 1, thinkingBudget))`).
        thinkingBudget = Math.max(
          1024,
          Math.min(maxOutputTokens - 1, thinkingBudget),
        )
        thinking = {
          budget_tokens: thinkingBudget,
          type: 'enabled',
          display: wireDisplay,
        } as BetaMessageStreamParams['thinking']
      }
    } else if (
      thinkingConfig.type === 'disabled' &&
      getAPIProvider() === 'firstParty' &&
      !thinkingDisabled &&
      modelSupportsThinking(options.model) &&
      !modelRejectsDisabledThinking(options.model)
    ) {
      thinking = { type: 'disabled' }
    }

    const displayForMode =
      thinkingConfig.type === 'disabled' ? undefined : thinkingConfig.display
    let displayMode: ReturnType<typeof resolveThinkingDisplayMode> = 'none'
    try {
      displayMode = resolveThinkingDisplayMode(
        displayForMode,
        thinkingConfig.displayExplicit ?? getThinkingDisplayExplicit(),
      )
    } catch (err) {
      logError(err)
    }
    const dropRedactThinkingBeta = (): void => {
      const idx = betasParams.indexOf(REDACT_THINKING_BETA_HEADER)
      if (idx !== -1) betasParams.splice(idx, 1)
    }
    // densable `if(Td&&Zg)DT()` — any display on the thinking param drops redact.
    if (thinking && wireDisplay) dropRedactThinkingBeta()
    switch (displayMode) {
      case 'thinking_and_connector_text':
      case 'none':
        break
      case 'connector_text': {
        if (
          shouldSendThinkingDisplayUpdates({
            thinkingType: thinking?.type,
            model: options.model,
            extraBodyHasThinking,
            simulateProxy: shouldSimulateProxyUsage(),
            displayUpdatesRejected: isStickyBetaRejected(
              THINKING_DISPLAY_UPDATES_BETA_HEADER,
            ),
          })
        ) {
          thinking = {
            ...thinking,
            display: 'updates',
          } as typeof thinking
          if (!betasParams.includes(THINKING_DISPLAY_UPDATES_BETA_HEADER)) {
            betasParams.push(THINKING_DISPLAY_UPDATES_BETA_HEADER)
          }
          dropRedactThinkingBeta()
        }
        break
      }
    }

    // densable `sT`/`JR` @184946314 + `Td.block_binding` @184957400.
    state.lastSentBindingControls = false
    state.lastBindingControlsOnThirdParty = false
    let prefixMismatchBehavior: PrefixMismatchBehavior | undefined
    try {
      const mechanicalDisabled =
        thinkingConfig.type === 'disabled' && thinkingConfig.mechanical === true
      const bindingEligible =
        !mechanicalDisabled &&
        !shouldSimulateProxyUsage() &&
        (getAnthropicApiKey() !== null ||
          !isClaudeAISubscriber() ||
          process.env.ANTHROPIC_BASE_URL !== undefined)
      const currentProvider = getAPIProvider()
      if (bindingEligible && densableExperimentalCapabilityBetas()) {
        if (thinkingConfig.type !== 'disabled') {
          prefixMismatchBehavior = resolvePrefixMismatchBehavior()
          if (shouldSendThinkingBindingControls(prefixMismatchBehavior)) {
            stickySendBeta(THINKING_BINDING_CONTROLS_BETA_HEADER)
          }
        }
        state.lastSentBindingControls = isStickyBetaSentActive(
          THINKING_BINDING_CONTROLS_BETA_HEADER,
        )
      } else if (
        bindingEligible &&
        !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)
      ) {
        if (
          (currentProvider === 'bedrock' ||
            currentProvider === 'mantle' ||
            currentProvider === 'vertex') &&
          (currentProvider === 'vertex'
            ? process.env.ANTHROPIC_VERTEX_BASE_URL === undefined
            : currentProvider === 'bedrock'
              ? process.env.ANTHROPIC_BEDROCK_BASE_URL === undefined
              : process.env.ANTHROPIC_BEDROCK_MANTLE_BASE_URL === undefined) &&
          providerSupportsThinkingBindingOn3P(currentProvider, options.model)
        ) {
          if (thinkingConfig.type !== 'disabled') {
            stickySendBeta(THINKING_BINDING_CONTROLS_BETA_HEADER)
          }
          state.lastSentBindingControls = isStickyBetaSentActive(
            THINKING_BINDING_CONTROLS_BETA_HEADER,
          )
        }
      }
    } catch (err) {
      logError(err)
      prefixMismatchBehavior = undefined
      state.lastSentBindingControls = false
    }
    if (!state.lastSentBindingControls && getAPIProvider() !== 'firstParty') {
      betasParams = betasParams.filter(
        b => b !== THINKING_BINDING_CONTROLS_BETA_HEADER,
      )
    }
    if (
      state.lastSentBindingControls &&
      !isStickyBetaRejected(THINKING_BINDING_CONTROLS_BETA_HEADER)
    ) {
      if (!betasParams.includes(THINKING_BINDING_CONTROLS_BETA_HEADER)) {
        betasParams.push(THINKING_BINDING_CONTROLS_BETA_HEADER)
      }
      if (
        prefixMismatchBehavior !== undefined &&
        (thinking?.type === 'adaptive' || thinking?.type === 'enabled') &&
        !extraBodyHasThinking
      ) {
        thinking = {
          ...thinking,
          block_binding: {
            prefix_mismatch_behavior: prefixMismatchBehavior,
          },
        } as unknown as typeof thinking
      }
    }
    state.lastBindingControlsOnThirdParty =
      state.lastSentBindingControls &&
      getAPIProvider() !== 'firstParty' &&
      betasParams.includes(THINKING_BINDING_CONTROLS_BETA_HEADER)

    state.lastSentTokenCount =
      !isStickyBetaRejected(THINKING_TOKEN_COUNT_BETA_HEADER) &&
      betasParams.includes(THINKING_TOKEN_COUNT_BETA_HEADER)

    // densable `JPe(ye)` @184958046 — thinking-resumption header.
    if (
      shouldSendThinkingResumptionBeta(options.model) &&
      !betasParams.includes(THINKING_RESUMPTION_BETA_HEADER)
    ) {
      betasParams.push(THINKING_RESUMPTION_BETA_HEADER)
    }

    // densable 2.1.251 #13 — `ga.effort=Wht` when outgoing thinking is
    // `{type:"disabled"}` and `bJn` (above high) and (`Vm` mechanical or
    // `SJn`). Gold does not throw.
    const mechanical =
      thinkingConfig.type === 'disabled' && thinkingConfig.mechanical === true
    const effortDecision = decideEffortWhenThinkingDisabled({
      effort: effortName,
      thinkingOff: thinking?.type === 'disabled',
      model: options.model,
      mechanical,
    })
    if (effortDecision.action === 'clamp') {
      if (!state.loggedEffortClamp) {
        state.loggedEffortClamp = true
        logForDebugging(
          formatEffortClampDebugMessage(
            effortDecision.from,
            effortDecision.to,
            mechanical,
          ),
        )
      }
      if (
        !mechanical &&
        querySourceBucket(options.querySource) === 'main' &&
        oncePerSession('effort_thinking_disabled_clamp')
      ) {
        logEvent('tengu_effort_clamped_thinking_disabled', {
          from: effortDecision.from as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          to: effortDecision.to as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          query_source: analyticsQuerySource(
            options.querySource,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
      if ('effort' in outputConfig) {
        ;(outputConfig as { effort?: string }).effort = effortDecision.to
      }
    }

    // densable: tool_choice {type:'tool'} demoted to auto when thinking is
    // active — including HQt models with omitted thinking (server-side on).
    let toolChoice = options.toolChoice
    if (
      toolChoice?.type === 'tool' &&
      isThinkingActiveForToolChoice(thinking, options.model)
    ) {
      logForDebugging(
        `tool_choice {type:'tool', name:'${toolChoice.name}'} demoted to auto: extended thinking is active`,
      )
      toolChoice = { type: 'auto' }
    }

    // Get API context management strategies if enabled (official SUn + idle-gated zjn)
    const contextManagement = getAPIContextManagement({
      hasThinking,
      isRedactThinkingActive: betasParams.includes(REDACT_THINKING_BETA_HEADER),
      clearAllThinking: false,
      model: options.model,
      messages,
      disableClearToolUses: state.clearToolUsesDisabledForRequest,
    })
    state.lastSentClearToolUses =
      contextManagement?.edits.some(
        edit => edit.type === 'clear_tool_uses_20250919',
      ) === true

    const enablePromptCaching =
      options.enablePromptCaching ?? getPromptCachingEnabled(retryContext.model)

    // Fast mode: header is latched session-stable (cache-safe), but
    // `speed='fast'` stays dynamic so cooldown still suppresses the actual
    // fast-mode request without changing the cache key.
    let speed: BetaMessageStreamParams['speed']
    const isFastModeForRetry =
      isFastModeEnabled() &&
      isFastModeAvailable() &&
      !isFastModeCooldown() &&
      isFastModeSupportedByModel(options.model) &&
      !!retryContext.fastMode
    if (isFastModeForRetry) {
      speed = 'fast'
    }
    if (fastModeHeaderLatched && !betasParams.includes(FAST_MODE_BETA_HEADER)) {
      betasParams.push(FAST_MODE_BETA_HEADER)
    }

    // AFK mode beta: latched once auto mode is first activated. Still gated
    // by isAgenticQuery per-call so classifiers/compaction don't get it.
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (
        afkHeaderLatched &&
        shouldIncludeFirstPartyOnlyBetas() &&
        isAgenticQuery &&
        !betasParams.includes(AFK_MODE_BETA_HEADER)
      ) {
        betasParams.push(AFK_MODE_BETA_HEADER)
      }
    }

    // densable `_e&&!yt.includes(Opt))yt.push(Opt)` — send cache-diagnosis when
    // sticky sent&&!rejected (latched above via MWT/pje).
    if (
      isStickyBetaSentActive(CACHE_DIAGNOSIS_BETA_HEADER) &&
      !betasParams.includes(CACHE_DIAGNOSIS_BETA_HEADER)
    ) {
      betasParams.push(CACHE_DIAGNOSIS_BETA_HEADER)
    }

    // Official 2.1.328 (`chunk@294254613.js:3377210`): only send temperature
    // when thinking is disabled AND the model accepts `temperature` (`dn.acceptsTemperature`).
    const modelFacts = getModelFacts(resolvedModel)
    const temperature =
      !hasThinking && modelFacts.acceptsTemperature
        ? (options.temperatureOverride ?? 1)
        : undefined

    // Filter out any empty-string beta headers before sending.
    const simulateProxy = shouldSimulateProxyUsage()
    let filteredBetas = betasParams.filter(Boolean)
    if (simulateProxy) {
      const before = filteredBetas
      filteredBetas = filterBetasForSimulateProxyUsage(
        filteredBetas,
        OAUTH_BETA_HEADER,
      )
      logForDebugging(
        `[API:client] SIMULATE_PROXY_USAGE: stripping ${before.length - filteredBetas.length} beta headers from request (keeping ${filteredBetas.join(', ') || 'none'}): ${before.join(', ')}`,
      )
    }
    state.lastRequestBetas = filteredBetas
    // densable rke — classifier request bag; JOe previous on params rebuild.
    const simulateProxyUsageEnv = process.env.CLAUDE_CODE_SIMULATE_PROXY_USAGE
    const toolsPresent = allTools.length > 0
    const sendServerClassifier =
      stickySendDangerousToolUse &&
      toolsPresent &&
      !simulateProxyUsageEnv &&
      filterBetasForClassifierProvider(filteredBetas).includes(
        DANGEROUS_TOOL_USE_BETA_HEADER,
      )
    if (state.serverClassifierRequest !== undefined) {
      settleServerClassifierStreamEnded(state.serverClassifierRequest)
    }
    state.serverClassifierRequest = sendServerClassifier
      ? createServerClassifierRequest(randomUUID(), {
          artifacts: classifierContext?.artifacts,
          thread: false,
          agentId: options.agentId,
        })
      : undefined
    // Official 2.1.304 (#1005): do not store slimmed safety classifier
    // context with every request in serverClassifierHistory.
    state.lastSentThinkingDisplay =
      thinking !== undefined &&
      thinking !== null &&
      typeof thinking === 'object' &&
      'display' in thinking
        ? ((thinking as { display?: string | null }).display ?? undefined)
        : undefined

    // densable: Ie = typeof ra === "string" && MPe(ra) ? ra : void 0
    // densable Ye: skip transcript effort when thinking is mechanically off.
    state.effortLevelForTranscript = transcriptEffortWhenMechanicalDisabled(
      thinkingConfig.type === 'disabled' && thinkingConfig.mechanical === true,
      transcriptEffortFromOutputConfig(outputConfig),
    )

    // densable ekd/rkd — server-lane fallbacks body + credit beta/token stamp
    let serverFallbackBody: Record<string, unknown> = {}
    let creditStamp: { fallback_credit_token?: string } = {}
    let requestBetas = filteredBetas
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        planServerRefusalFallbackBetas,
        planFallbackCreditBeta,
        planFallbackCreditStamp,
      } =
        require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
      const ekd = planServerRefusalFallbackBetas({
        serverRefusalFallback: options.serverRefusalFallback,
        requestModel: options.model,
        silentArmActive: options.refusalFallbackSilentArmActive === true,
      })
      serverFallbackBody = ekd.body as Record<string, unknown>
      const betasWithEk = [...requestBetas]
      for (const h of ekd.betas) {
        if (!betasWithEk.includes(h)) betasWithEk.push(h)
      }
      const rkd = planFallbackCreditBeta({
        creditLaneArmed: options.fallbackCreditLaneArmed === true,
        creditCode: options.fallbackCreditCode,
        silentArmActive: options.refusalFallbackSilentArmActive === true,
        betas: betasWithEk,
      })
      requestBetas = rkd.betas
      creditStamp = planFallbackCreditStamp({
        creditCode: options.fallbackCreditCode,
      })
      // refresh lastRequestBetas / sendBetas with ekd+rkd headers
      state.lastRequestBetas = requestBetas
    } catch {
      // densable optional when helpers unavailable
    }
    const sendBetasWithFallback =
      useBetas && (!simulateProxy || requestBetas.length > 0)

    const resolvedTools = replaceRefusedToolSchemas(
      allTools,
      getRefusedToolSchemas(),
    )
    state.lastSentToolSchemas = resolvedTools

    const messagesWithBreakpoints = addCacheBreakpoints(
      state.messagesForAPI,
      enablePromptCaching,
      options.querySource,
      options.skipCacheWrite,
      options.agentCacheTtlOverride,
    )
    // Official 2.1.323 (#2062): sanitize lone UTF-16 surrogates in both string
    // values AND object keys (e.g. broken emoji characters in tool_use input
    // parameter names) before serialization so strict JSON parsers accept them.
    sanitizeLoneSurrogatesInPlace(messagesWithBreakpoints, true)

    return {
      model: normalizeModelStringForAPI(options.model),
      messages: messagesWithBreakpoints,
      system: state.system,
      tools: resolvedTools,
      tool_choice: toolChoice,
      ...(sendBetasWithFallback && { betas: requestBetas }),
      metadata: getAPIMetadata(),
      max_tokens: maxOutputTokens,
      thinking,
      ...(temperature !== undefined && { temperature }),
      ...(contextManagement &&
        sendBetasWithFallback &&
        requestBetas.includes(CONTEXT_MANAGEMENT_BETA_HEADER) && {
          context_management: contextManagement,
        }),
      // Official: skip extra body overlays that depend on stripped betas when simulating proxy.
      ...(!simulateProxy ? extraBodyParams : {}),
      ...(Object.keys(outputConfig).length > 0 && {
        output_config: outputConfig,
      }),
      ...(speed !== undefined && { speed }),
      // densable Ht.fallbacks + fallback_credit_token stamp
      ...serverFallbackBody,
      ...creditStamp,
      // Official 2.1.327 (#374) `RQ()`: billing group tag for Claude apps gateways
      ...getBillingGroupRequestTags(),
      ...(sendServerClassifier &&
        classifierContext !== undefined && {
          safeguards: [
            {
              type: 'dangerous_tool_use',
              classifier_context: classifierContext,
            },
          ],
        }),
    }
  }
}

/**
 * Compute initial query log scalars synchronously so the fire-and-forget
 * .then() closure doesn't pin paramsFromContext's full closure scope, and
 * return langfuseThinking for observability.
 */
export function logInitialAPIQuery(params: {
  paramsFromContext: (retryContext: RetryContext) => BetaMessageStreamParams
  options: Options
  thinkingConfig: ThinkingConfig
  useBetas: boolean
  isFastMode: boolean
  previousRequestId: string | undefined
}): BetaMessageStreamParams['thinking'] | undefined {
  const {
    paramsFromContext,
    options,
    thinkingConfig,
    useBetas,
    isFastMode,
    previousRequestId,
  } = params
  let langfuseThinking: BetaMessageStreamParams['thinking'] | undefined
  const queryParams = paramsFromContext({
    model: options.model,
    thinkingConfig,
  })
  const logMessagesLength = queryParams.messages.length
  const logBetas = useBetas ? (queryParams.betas ?? []) : []
  const logEffortValue = queryParams.output_config?.effort
  if (queryParams.thinking && queryParams.thinking.type !== 'disabled') {
    langfuseThinking = queryParams.thinking
  }
  void options.getToolPermissionContext().then(permissionContext => {
    logAPIQuery({
      model: options.model,
      messagesLength: logMessagesLength,
      temperature: options.temperatureOverride ?? 1,
      betas: logBetas,
      permissionMode: permissionContext.mode,
      querySource: options.querySource,
      queryTracking: options.queryTracking,
      thinkingConfig,
      effortValue: logEffortValue,
      fastMode: isFastMode,
      previousRequestId,
    })
  })
  return langfuseThinking
}
