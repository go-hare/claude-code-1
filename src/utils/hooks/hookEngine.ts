import {
  addToTurnHookDuration,
  getSessionId,
  getStatsStore,
} from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  isAsyncHookJSONOutput,
  type PermissionRequestResult,
  type PromptRequest,
  type PromptResponse,
} from '../../types/hooks.js'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import { noteHookFailure } from '../bgNeedsInputBridge.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { logError } from '../log.js'
import { stripEvalConfinedHookAllow } from '../permissions/evalConfined.js'
import type { PermissionResult } from '../permissions/PermissionResult.js'
import {
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from '../plugins/functionHooksModules.js'
import { jsonStringify } from '../slowOperations.js'
import { logOTelEvent } from '../telemetry/events.js'
import {
  endHookSpan,
  isBetaTracingEnabled,
  startHookSpan,
} from '../telemetry/sessionTracing.js'
import {
  enforceThroughFamilyOnlyHookResult,
  getHookDefinitionsForTelemetry,
  getHookTypeCounts,
  getMatchingHooks,
  getPluginHookCounts,
  isInternalHook,
  isSdkHostOwnAskCallback,
  remapHookInputForMatchedHook,
  remapHookInputForOwnTool,
} from './hookConfigRegistry.js'
import {
  applyOnFailureBlockToHookResult,
  type MatchedHook,
  type SessionStartHookExecutionOptions,
  TOOL_HOOK_EXECUTION_TIMEOUT_MS,
} from './hookCore.js'
import { runSingleMatchedHook } from './hookEntryExecutor.js'
import { trackHookExecution } from './hookExecutionState.js'
import { startHookHeartbeat } from './hookHeartbeat.js'
import {
  buildFailClosedHookMatchResult,
  formatHookMatchBlockedMessage,
  shouldSkipHookDueToTrust,
  validateHookInputSize,
} from './hookInputHelpers.js'
import {
  getSessionModelHookSlots,
  MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
  mergeHookGeneratorsWithModelCap,
  resolveModelHookTimeoutMs,
} from './hookModelSlotPool.js'
import {
  CLASSIC_HOOK_HOP_SITE,
  classicResultFields,
  mergeManagedAndDownstreamClassicEvent,
  processHookJSONOutput,
  projectClassicHookResults,
} from './hookOutputProcessor.js'
import { wwt } from './hookOutputValidation.js'
import {
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from './hooksConfigSnapshot.js'
import { formatHookProgressText, getHookDisplayText } from './hooksSettings.js'
import type { AggregatedHookResult } from './hookTypes.js'
import { persistHookOutput } from './persistHookOutput.js'
import { getSessionHookCallback } from './sessionHooks.js'
import { emitTerminalSequence } from './terminalSequence.js'
import { randomUUID } from 'crypto'
import type { HookInput } from 'src/entrypoints/agentSdkTypes.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'

export async function* executeHooks({
  hookInput,
  toolUseID,
  matchQuery,
  signal,
  timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  toolUseContext,
  messages,
  forceSyncExecution,
  suppressPerInvocationTelemetry,
  /** densable classicChainMember — set while next() runs the settings hooks. */
  classicChainMember,
  requestPrompt,
  toolInputSummary,
  storageV5,
  credentials,
  skipSessionFunctionHooks,
  sessionFunctionHooksOnly,
  managedHooksOnly,
  managedHooksExcluded,
  sessionStartOptions,
}: {
  managedHooksOnly?: boolean
  managedHooksExcluded?: boolean
  sessionStartOptions?: SessionStartHookExecutionOptions
  hookInput: HookInput
  toolUseID: string
  matchQuery?: string
  signal?: AbortSignal
  timeoutMs?: number
  toolUseContext?: ToolUseContext
  messages?: Message[]
  forceSyncExecution?: boolean
  /** densable classicChainMember — set while next() runs the settings hooks. */
  classicChainMember?: boolean
  /**
   * densable suppressPerInvocationTelemetry — when true, skip tengu_run_hook
   * per-invocation telemetry (MessageDisplay streaming hot path).
   */
  suppressPerInvocationTelemetry?: boolean
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>
  toolInputSummary?: string | null
  /** densable PBr persist — `a?.storageV5 ?? m` / `a?.credentials ?? g`. */
  storageV5?: unknown
  credentials?: unknown
  /**
   * densable skipSessionFunctionHooks — turn_end and blockable_turn_end drop
   * session function hooks (Ot / turn_end_reactions is function-only).
   */
  skipSessionFunctionHooks?: boolean
  /**
   * densable sessionFunctionHooksOnly — turn_end_reactions keeps function
   * hooks only (gold Ot).
   */
  sessionFunctionHooksOnly?: boolean
}): AsyncGenerator<AggregatedHookResult> {
  const persistStorageV5 = toolUseContext?.storageV5 ?? storageV5
  const persistCredentials = toolUseContext?.credentials ?? credentials

  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return
  }

  const hookEvent = hookInput.hook_event_name
  const hookName = matchQuery ? `${hookEvent}:${matchQuery}` : hookEvent

  // Bind the prompt callback to this hook's name and tool input summary so the UI can display context
  const boundRequestPrompt = requestPrompt?.(hookName, toolInputSummary)

  // densable VA @189509974: skip xKo (function-hook chain) when
  // classicChainMember | managedHooksOnly | sessionFunctionHooksOnly.
  // Gold AC/Zv still skips PreToolUse; gold Rze @185182837 is the PreToolUse
  // host and runs uwn then QLn. Local Rze is executePreToolHooks → executeHooks,
  // so PreToolUse must enter this chain unless this dispatch is managed-only
  // (AVt/kce). A chain member must not enter again.
  if (
    !classicChainMember &&
    !managedHooksOnly &&
    !shouldDisableAllHooksIncludingManaged() &&
    !sessionFunctionHooksOnly &&
    hasMatchingFunctionHook(hookEvent)
  ) {
    const eventRecord: Record<string, unknown> = {
      ...(hookInput as unknown as Record<string, unknown>),
    }
    if (hookInput.hook_event_name === 'PreToolUse') {
      eventRecord.tool = hookInput.tool_name
    }
    const classicYields: AggregatedHookResult[] = []
    if (!managedHooksExcluded) {
      for await (const result of executeHooks({
        hookInput,
        toolUseID,
        matchQuery,
        signal,
        timeoutMs,
        toolUseContext,
        messages,
        forceSyncExecution,
        suppressPerInvocationTelemetry,
        classicChainMember: true,
        managedHooksOnly: true,
        requestPrompt,
        toolInputSummary,
        storageV5,
        credentials,
        skipSessionFunctionHooks,
        sessionFunctionHooksOnly,
      }))
        classicYields.push(result)
    }
    const managedResult = projectClassicHookResults(classicYields)
    if (
      managedResult.block !== undefined ||
      managedResult.preventContinuation === true ||
      managedResult.permissionDecision === 'deny' ||
      (managedResult.decision as PermissionRequestResult | undefined)
        ?.behavior === 'deny'
    ) {
      yield* classicYields
      return
    }
    let classicResult: Record<string, unknown> = managedResult
    const chained = await runFunctionHookChain(
      hookEvent,
      eventRecord,
      async event => {
        const results: AggregatedHookResult[] = []
        for await (const result of executeHooks({
          hookInput: event as typeof hookInput,
          toolUseID,
          matchQuery,
          signal,
          timeoutMs,
          toolUseContext,
          messages,
          forceSyncExecution,
          suppressPerInvocationTelemetry,
          classicChainMember: true,
          managedHooksExcluded: true,
          requestPrompt,
          toolInputSummary,
          storageV5,
          credentials,
          skipSessionFunctionHooks,
          sessionFunctionHooksOnly,
        })) {
          results.push(result)
        }
        classicYields.push(...results)
        classicResult = projectClassicHookResults(classicYields)
        return { ...event, ...projectClassicHookResults(results) }
      },
      undefined,
      undefined,
      { signal, site: CLASSIC_HOOK_HOP_SITE },
    )
    const rawFinalEvent =
      chained && typeof chained === 'object'
        ? (chained as Record<string, unknown>)
        : eventRecord
    const finalEvent = mergeManagedAndDownstreamClassicEvent(
      managedResult,
      rawFinalEvent,
    )
    const baseline = { ...eventRecord, ...classicResult }
    const changed = new Set(
      [
        ...new Set([...Object.keys(finalEvent), ...Object.keys(baseline)]),
      ].filter(
        key =>
          JSON.stringify(finalEvent[key]) !== JSON.stringify(baseline[key]),
      ),
    )
    const replaced = new Set(
      [...changed].flatMap(key => classicResultFields(key, hookEvent)),
    )
    for (const prior of classicYields) {
      const retained = Object.fromEntries(
        Object.entries(prior).filter(([key]) => !replaced.has(key)),
      ) as AggregatedHookResult
      if (Object.keys(retained).length > 0) yield retained
    }
    const returned: Record<string, unknown> = Object.fromEntries(
      [...changed].map(key => [key, finalEvent[key]]),
    )
    if (changed.has('permissionDecision')) {
      returned.permissionBehavior = finalEvent.permissionDecision
      returned.hookPermissionDecisionReason =
        finalEvent.permissionDecisionReason
    } else if (changed.has('permissionDecisionReason')) {
      returned.permissionBehavior = finalEvent.permissionDecision
      returned.hookPermissionDecisionReason =
        finalEvent.permissionDecisionReason
    }
    if (changed.has('decision')) {
      returned.permissionRequestResult = finalEvent.decision
      const decision = finalEvent.decision as
        | PermissionRequestResult
        | undefined
      if (decision) {
        returned.permissionBehavior = decision.behavior
        if (decision.behavior === 'allow')
          returned.updatedInput = decision.updatedInput
      }
    }
    const originalDelta =
      typeof eventRecord.delta === 'string' ? eventRecord.delta : undefined
    // densable mXe / wSn: yield only keys the function-hook result changed.
    if (
      typeof returned.delta === 'string' &&
      returned.delta !== originalDelta
    ) {
      yield { displayContent: returned.delta }
    }
    if (typeof returned.displayContent === 'string') {
      yield { displayContent: returned.displayContent }
    }
    if (typeof returned.additionalContext === 'string') {
      yield { additionalContexts: [returned.additionalContext] }
    } else if (Array.isArray(returned.additionalContext)) {
      yield {
        additionalContexts: returned.additionalContext.filter(
          (item): item is string => typeof item === 'string',
        ),
      }
    }
    if (Array.isArray(returned.additionalContexts)) {
      yield {
        additionalContexts: returned.additionalContexts.filter(
          (item): item is string => typeof item === 'string',
        ),
      }
    }
    if (returned.preventContinuation === true) {
      yield {
        preventContinuation: true,
        stopReason:
          typeof returned.stopReason === 'string'
            ? returned.stopReason
            : undefined,
      }
    }
    if (typeof returned.stopReason === 'string') {
      yield { stopReason: returned.stopReason }
    }
    if (typeof returned.sessionTitle === 'string') {
      yield { sessionTitle: returned.sessionTitle }
    }
    if (returned.suppressOriginalPrompt === true) {
      yield { suppressOriginalPrompt: true }
    }
    if (typeof returned.initialUserMessage === 'string') {
      yield { initialUserMessage: returned.initialUserMessage }
    }
    if (Array.isArray(returned.watchPaths)) {
      yield {
        watchPaths: returned.watchPaths.filter(
          (item): item is string => typeof item === 'string',
        ),
      }
    }
    if (returned.reloadSkills === true) {
      yield { reloadSkills: true }
    }
    if (returned.updatedToolOutput !== undefined) {
      yield { updatedToolOutput: returned.updatedToolOutput }
    }
    if (returned.updatedMCPToolOutput !== undefined) {
      yield { updatedMCPToolOutput: returned.updatedMCPToolOutput }
    }
    if (returned.retry === true) {
      yield { retry: true }
    }
    if (returned.updatedInput && typeof returned.updatedInput === 'object') {
      yield {
        updatedInput: returned.updatedInput as Record<string, unknown>,
      }
    }
    const returnedBlock =
      returned.block ??
      (returned.permissionBehavior === 'deny'
        ? (returned.hookPermissionDecisionReason ?? 'Blocked by hook')
        : undefined)
    if (returnedBlock !== undefined) {
      yield {
        blockingError: classicYields.find(
          result =>
            result.blockingError?.blockingError === String(returnedBlock),
        )?.blockingError ?? {
          blockingError: String(returnedBlock),
          command: `classic.${hookEvent} hook`,
        },
        ...(hookEvent === 'PreModelSwitch'
          ? {}
          : {
              permissionBehavior: 'deny' as const,
            }),
      }
    }
    const confinedFn = stripEvalConfinedHookAllow(
      {
        permissionBehavior: returned.permissionBehavior,
        permissionRequestResult: returned.permissionRequestResult as
          | { behavior?: unknown }
          | undefined,
      },
      hookEvent === 'PreToolUse'
        ? 'PreToolUse function-hook chain'
        : `Hook ${hookEvent} (function-hook chain)`,
    )
    if (
      confinedFn.permissionBehavior === 'ask' ||
      confinedFn.permissionBehavior === 'deny' ||
      confinedFn.permissionBehavior === 'allow' ||
      confinedFn.permissionBehavior === 'passthrough' ||
      confinedFn.permissionBehavior === 'defer'
    ) {
      yield {
        permissionBehavior: confinedFn.permissionBehavior,
        ...(typeof returned.hookPermissionDecisionReason === 'string'
          ? {
              hookPermissionDecisionReason:
                returned.hookPermissionDecisionReason,
            }
          : {}),
      }
    }
    if (confinedFn.permissionRequestResult !== undefined) {
      yield {
        permissionRequestResult:
          confinedFn.permissionRequestResult as AggregatedHookResult['permissionRequestResult'],
      }
    }
    return
  }

  // SECURITY: ALL hooks require workspace trust in interactive mode
  // This centralized check prevents RCE vulnerabilities for all current and future hooks
  if (shouldSkipHookDueToTrust()) {
    logForDebugging(
      `Skipping ${hookName} hook execution - workspace trust not accepted`,
    )
    return
  }

  const appState = toolUseContext ? toolUseContext.getAppState() : undefined
  // Use the agent's session ID if available, otherwise fall back to main session
  const sessionId = toolUseContext?.agentId ?? getSessionId()
  let matchingHooks: MatchedHook[]
  try {
    matchingHooks = await getMatchingHooks(
      appState,
      sessionId,
      hookEvent,
      hookInput,
      toolUseContext?.options?.tools,
      {
        managedHooksOnly,
        managedHooksExcluded,
        suppressTelemetry: suppressPerInvocationTelemetry,
      },
    )
  } catch (err) {
    logError(err)
    const failClosed = buildFailClosedHookMatchResult(
      hookEvent,
      hookName,
      formatHookMatchBlockedMessage(hookEvent, err),
    )
    if (failClosed !== undefined) {
      yield failClosed
      return
    }
    matchingHooks = []
  }
  // densable AKo Gn: ke → function only; ye → drop function.
  if (sessionFunctionHooksOnly) {
    matchingHooks = matchingHooks.filter(h => h.hook.type === 'function')
  } else if (skipSessionFunctionHooks) {
    matchingHooks = matchingHooks.filter(h => h.hook.type !== 'function')
  }
  if (sessionStartOptions !== undefined) {
    if (sessionStartOptions.newPluginsOnly) {
      const pluginEntries = matchingHooks
        .filter(
          (m): m is typeof m & { pluginId: string } => m.pluginId !== undefined,
        )
        .map(m => ({
          pluginId: m.pluginId,
          pluginName: m.pluginId.split('@')[0] ?? m.pluginId,
        }))
      const owedIds = new Set(
        sessionStartOptions.newPluginsOnly
          .owed(pluginEntries)
          .map(p => p.pluginId),
      )
      matchingHooks = matchingHooks.filter(
        m => m.pluginId !== undefined && owedIds.has(m.pluginId),
      )
    }
    if (sessionStartOptions.onMatched) {
      const matchedPlugins = matchingHooks
        .filter(
          (m): m is typeof m & { pluginId: string } => m.pluginId !== undefined,
        )
        .map(m => ({
          pluginId: m.pluginId,
          pluginName: m.pluginId.split('@')[0] ?? m.pluginId,
        }))
      sessionStartOptions.onMatched(matchedPlugins, matchingHooks.length)
    }
  }
  if (matchingHooks.length === 0) {
    return
  }

  if (signal?.aborted) {
    return
  }

  const userHooks = matchingHooks.filter(h => !isInternalHook(h))
  if (userHooks.length > 0) {
    // densable: if (!suppressPerInvocationTelemetry) N("tengu_run_hook", ...)
    if (!suppressPerInvocationTelemetry) {
      const pluginHookCounts = getPluginHookCounts(userHooks)
      const hookTypeCounts = getHookTypeCounts(userHooks)
      const numMatchAllMatchers = userHooks.filter(
        hook => hook.matcherIsMatchAll,
      ).length
      logEvent(`tengu_run_hook`, {
        hookName:
          hookName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        numCommands: userHooks.length,
        numMatchAllMatchers,
        numSpecificMatchers: userHooks.length - numMatchAllMatchers,
        hookTypeCounts: jsonStringify(
          hookTypeCounts,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(pluginHookCounts && {
          pluginHookCounts: jsonStringify(
            pluginHookCounts,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      })
    }
  } else {
    // Fast-path: all hooks are internal callbacks (sessionFileAccessHooks).
    // These return {} and don't use the abort signal, so we
    // can skip span/progress/abortSignal/processHookJSONOutput/resultLoop.
    // Measured: 6.01µs → ~1.8µs per PostToolUse hit (-70%).
    const batchStartTime = Date.now()
    let blockingCount = 0
    const context = toolUseContext
      ? {
          getAppState: toolUseContext.getAppState,
        }
      : undefined
    for (const [i, matchedEntry] of matchingHooks.entries()) {
      const { hook } = matchedEntry
      if (hook.type !== 'callback') continue
      const cbOut = await hook.callback(
        hookInput,
        toolUseID,
        signal,
        i,
        context,
      )
      if (
        !cbOut ||
        typeof cbOut !== 'object' ||
        Object.keys(cbOut).length === 0 ||
        isAsyncHookJSONOutput(cbOut)
      ) {
        continue
      }
      const parsed = processHookJSONOutput({
        json: cbOut,
        command: 'callback',
        hookName: `${hookEvent}:Callback`,
        toolUseID,
        hookEvent,
        expectedHookEvent: hookEvent,
        stdout: undefined,
        stderr: undefined,
        exitCode: undefined,
      })
      if (parsed.permissionBehavior === 'deny') {
        blockingCount++
        yield {
          permissionBehavior: 'deny',
          hookPermissionDecisionReason: parsed.hookPermissionDecisionReason,
          hookSource: matchedEntry.hookSource,
        }
      }
      if (parsed.additionalContext) {
        yield {
          additionalContexts: [
            await persistHookOutput(
              parsed.additionalContext,
              `${toolUseID}-${i}`,
              'additionalContext',
            ),
          ],
        }
      }
      if (parsed.systemMessage) {
        yield {
          message: createAttachmentMessage({
            type: 'hook_system_message',
            content: await persistHookOutput(
              parsed.systemMessage,
              `${toolUseID}-${i}`,
              'systemMessage',
            ),
            hookName,
            toolUseID,
            hookEvent,
          }),
        }
      }
    }
    const totalDurationMs = Date.now() - batchStartTime
    getStatsStore()?.observe('hook_duration_ms', totalDurationMs)
    addToTurnHookDuration(totalDurationMs)
    logEvent(`tengu_repl_hook_finished`, {
      hookName:
        hookName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      numCommands: matchingHooks.length,
      numSuccess: matchingHooks.length - blockingCount,
      numBlocking: blockingCount,
      numNonBlockingError: 0,
      numCancelled: 0,
      totalDurationMs,
    })
    return
  }

  // Official #1945: in non-interactive sessions, exclude internal built-in
  // callback hooks from OpenTelemetry `num_hooks` and `num_success`.
  const excludeInternalFromOtel =
    toolUseContext?.options?.isNonInteractiveSession === true
  const otelTrackedHooks = excludeInternalFromOtel ? userHooks : matchingHooks

  // Collect hook definitions for beta tracing telemetry
  const hookDefinitionsJson = isBetaTracingEnabled()
    ? jsonStringify(getHookDefinitionsForTelemetry(otelTrackedHooks))
    : '[]'

  // Log hook execution start to OTEL (only for beta tracing)
  if (isBetaTracingEnabled()) {
    void logOTelEvent('hook_execution_start', {
      hook_event: hookEvent,
      hook_name: hookName,
      num_hooks: String(otelTrackedHooks.length),
      managed_only: String(shouldAllowManagedHooksOnly()),
      hook_definitions: hookDefinitionsJson,
      hook_source: shouldAllowManagedHooksOnly() ? 'policySettings' : 'merged',
    })
  }

  // Start hook span for beta tracing
  const hookSpan = startHookSpan(
    hookEvent,
    hookName,
    otelTrackedHooks.length,
    hookDefinitionsJson,
  )

  // Yield progress messages for each hook before execution
  for (const { hook } of matchingHooks) {
    yield {
      message: {
        type: 'progress',
        data: {
          type: 'hook_progress',
          hookEvent,
          hookName,
          command: formatHookProgressText(getHookDisplayText(hook)),
          ...(hook.type === 'prompt' && { promptText: hook.prompt }),
          ...('statusMessage' in hook &&
            hook.statusMessage != null && {
              statusMessage: formatHookProgressText(hook.statusMessage),
            }),
        },
        parentToolUseID: toolUseID,
        toolUseID,
        timestamp: new Date().toISOString(),
        uuid: randomUUID(),
      },
    }
  }

  // Track wall-clock time for the entire hook batch
  const batchStartTime = Date.now()

  // Lazy-once stringify of hookInput. Shared across all command/prompt/agent/http
  // hooks in this batch (hookInput is never mutated). Callback/function hooks
  // return before reaching this, so batches with only those pay no stringify cost.
  let jsonInputResult:
    | { ok: true; value: string }
    | { ok: false; error: unknown }
    | undefined
  let jsonInputOwnToolResult:
    | { ok: true; value: string }
    | { ok: false; error: unknown }
    | undefined
  let jsonInputFamilyResult:
    | { ok: true; value: string }
    | { ok: false; error: unknown }
    | undefined
  function getJsonInput(forOwnTool = false, familyMatched?: MatchedHook) {
    const familyPayload = familyMatched?.throughFamilyOnly
      ? remapHookInputForMatchedHook(familyMatched, hookInput)
      : undefined
    const cached = familyPayload
      ? jsonInputFamilyResult
      : forOwnTool
        ? jsonInputOwnToolResult
        : jsonInputResult
    if (cached !== undefined) {
      return cached
    }
    try {
      const payload =
        familyPayload ??
        (forOwnTool
          ? (remapHookInputForOwnTool(hookInput)?.hookInput ?? hookInput)
          : hookInput)
      const next = { ok: true as const, value: jsonStringify(payload) }
      validateHookInputSize(hookEvent, next.value)
      if (familyPayload) jsonInputFamilyResult = next
      else if (forOwnTool) jsonInputOwnToolResult = next
      else jsonInputResult = next
      return next
    } catch (error) {
      logError(
        Error(`Failed to stringify hook ${hookName} input`, { cause: error }),
      )
      const next = { ok: false as const, error }
      if (familyPayload) jsonInputFamilyResult = next
      else if (forOwnTool) jsonInputOwnToolResult = next
      else jsonInputResult = next
      return next
    }
  }

  // Run all hooks in parallel with individual timeouts
  const hookPromises = matchingHooks.map((matchedHook, hookIndex) =>
    runSingleMatchedHook({
      matchedHook,
      hookIndex,
      hookInput,
      hookEvent,
      hookName,
      toolUseID,
      signal,
      timeoutMs,
      toolUseContext,
      messages,
      forceSyncExecution,
      boundRequestPrompt,
      persistStorageV5,
      persistCredentials,
      getJsonInput,
    }),
  )

  // Track outcomes for logging
  const outcomes = {
    success: 0,
    blocking: 0,
    non_blocking_error: 0,
    cancelled: 0,
  }
  const otelOutcomes = {
    success: 0,
    blocking: 0,
    non_blocking_error: 0,
    cancelled: 0,
  }
  const internalHookSet = new Set(
    matchingHooks.filter(m => isInternalHook(m)).map(m => m.hook),
  )

  let permissionBehavior: PermissionResult['behavior'] | 'defer' | undefined
  let resultIndex = 0

  const progress =
    userHooks.length > 0
      ? trackHookExecution({
          hookEvent,
          agentId: toolUseContext?.agentId,
          toolName: 'tool_name' in hookInput ? hookInput.tool_name : undefined,
          hooks: userHooks.map(({ hook }) => ({
            command: formatHookProgressText(getHookDisplayText(hook)),
            statusMessage:
              'statusMessage' in hook && hook.statusMessage
                ? formatHookProgressText(hook.statusMessage)
                : undefined,
          })),
        })
      : undefined
  const progressIndices = new Map(
    userHooks.map(({ hook }, index) => [hook, index]),
  )

  // 2.1.323 #1970: emit 30s progress heartbeat while hooks run long in -p / SDK sessions
  const hookHeartbeat = startHookHeartbeat({
    hookEvent,
    toolUseID,
    agentId: toolUseContext?.agentId,
    matchedHookCount: matchingHooks.length,
    maxTimeoutMs: Math.max(
      timeoutMs,
      ...matchingHooks.map(({ hook }) =>
        'timeout' in hook && typeof hook.timeout === 'number'
          ? hook.timeout * 1000
          : timeoutMs,
      ),
    ),
    signal,
  })

  try {
    // Run non-model hooks in parallel and cap prompt/agent hooks at 12 per event
    // and 24 per session (+12 overdue) (#928, #1336)
    const slotSignalController = new AbortController()
    const slotSignal = signal
      ? AbortSignal.any([signal, slotSignalController.signal])
      : slotSignalController.signal
    const mergedHooks = mergeHookGeneratorsWithModelCap(
      matchingHooks.map((entry, idx) => {
        const isModelHook =
          entry.hook.type === 'prompt' || entry.hook.type === 'agent'
        return {
          isModelHook,
          generator: hookPromises[idx]!,
          timeoutMs: isModelHook
            ? resolveModelHookTimeoutMs(entry.hook, timeoutMs)
            : undefined,
        }
      }),
      MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
      {
        slots: getSessionModelHookSlots(),
        signal: slotSignal,
        limitMs: timeoutMs,
      },
    )
    for await (const rawResult of mergedHooks) {
      const result = applyOnFailureBlockToHookResult(
        rawResult,
        hookEvent,
        signal,
      )
      const progressIndex = progressIndices.get(result.hook)
      if (progressIndex !== undefined) {
        progress?.settle(progressIndex)
      }
      outcomes[result.outcome]++
      if (!excludeInternalFromOtel || !internalHookSet.has(result.hook)) {
        otelOutcomes[result.outcome]++
      }

      // Check for preventContinuation early
      if (result.preventContinuation) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) requested preventContinuation`,
        )
        yield {
          preventContinuation: true,
          stopReason: result.stopReason,
          hook: result.hook,
        }
      }

      // Handle different result types
      if (result.blockingError) {
        yield {
          blockingError: result.blockingError,
          suppressOriginalPrompt: result.suppressOriginalPrompt,
          stopReason: result.stopReason,
          hook: result.hook,
          ...(result.hook.type === 'prompt'
            ? { impossible: result.impossible }
            : {}),
        }
        permissionBehavior = 'deny'
      }

      if (result.message) {
        yield {
          message: result.message,
          hook: result.hook,
          ...(result.hook.type === 'prompt'
            ? { stopReason: result.stopReason, impossible: result.impossible }
            : {}),
        }
      }

      // densable: Mo.timedOut && prompt && Stop → yield {hook, timedOut:true}
      if (
        result.timedOut &&
        result.hook.type === 'prompt' &&
        hookEvent === 'Stop'
      ) {
        yield { hook: result.hook, timedOut: true }
      }

      // densable 2.1.248 rA.noteHookFailure(o, wwt(ue, stderr))
      if (
        (hookEvent === 'PreToolUse' || hookEvent === 'PermissionRequest') &&
        result.outcome === 'non_blocking_error' &&
        toolUseID
      ) {
        const msg = result.message
        const att =
          msg &&
          typeof msg === 'object' &&
          'type' in msg &&
          msg.type === 'attachment' &&
          'attachment' in msg
            ? (msg.attachment as { type?: string; stderr?: string })
            : undefined
        const stderr =
          att?.type === 'hook_non_blocking_error' &&
          typeof att.stderr === 'string'
            ? att.stderr
            : ''
        noteHookFailure(toolUseID, wwt(hookEvent, stderr))
      }

      // Counts every result, not just the ones that carry output, so the
      // persist basename stays unique across hooks running in parallel.
      resultIndex++

      // Yield system message separately if present
      if (result.systemMessage) {
        yield {
          message: createAttachmentMessage({
            type: 'hook_system_message',
            content: await persistHookOutput(
              result.systemMessage,
              `${toolUseID}-${resultIndex}`,
              'systemMessage',
            ),
            hookName,
            toolUseID,
            hookEvent,
          }),
        }
      }

      if (result.terminalSequence) {
        emitTerminalSequence(result.terminalSequence)
      }

      // Collect additional context from hooks
      if (result.additionalContext) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) provided additionalContext (${result.additionalContext.length} chars)`,
        )
        yield {
          additionalContexts: [
            await persistHookOutput(
              result.additionalContext,
              `${toolUseID}-${resultIndex}`,
              'additionalContext',
            ),
          ],
        }
      }

      // densable 2.1.222 MessageDisplay — yield displayContent for wth transform
      if (result.displayContent !== undefined) {
        yield {
          displayContent: result.displayContent,
        }
      }

      if (result.initialUserMessage) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) provided initialUserMessage (${result.initialUserMessage.length} chars)`,
        )
        yield {
          initialUserMessage: await persistHookOutput(
            result.initialUserMessage,
            `${toolUseID}-${resultIndex}`,
            'initialUserMessage',
          ),
        }
      }

      if (result.sessionTitle) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) provided sessionTitle (${[...result.sessionTitle].length} chars)`,
        )
        yield {
          sessionTitle: result.sessionTitle,
        }
      }

      if (result.reloadSkills) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) requested reloadSkills`,
        )
        yield {
          reloadSkills: true,
        }
      }

      if (result.suppressOriginalPrompt) {
        yield {
          suppressOriginalPrompt: true,
        }
      }

      if (result.watchPaths && result.watchPaths.length > 0) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) provided ${result.watchPaths.length} watchPaths`,
        )
        yield {
          watchPaths: result.watchPaths,
        }
      }

      if (result.updatedToolOutput !== undefined) {
        yield { updatedToolOutput: result.updatedToolOutput }
      } else if (result.updatedMCPToolOutput !== undefined) {
        yield { updatedMCPToolOutput: result.updatedMCPToolOutput }
      }
      const matchedEntry = matchingHooks.find(
        entry => entry.hook === result.hook,
      )
      enforceThroughFamilyOnlyHookResult(
        result,
        matchedEntry,
        hookEvent,
        getHookDisplayText(result.hook),
      )

      if (result.classifierContext) {
        let value = result.classifierContext.slice(0, 2000)
        const last = value.charCodeAt(value.length - 1)
        if (
          value.length < result.classifierContext.length &&
          last >= 0xd800 &&
          last <= 0xdbff
        ) {
          value = value.slice(0, -1)
        }
        const matched = matchingHooks.find(entry => entry.hook === result.hook)
        yield {
          pairedRewrite:
            result.updatedToolOutput !== undefined
              ? 'direct'
              : result.updatedMCPToolOutput !== undefined
                ? 'legacy_mcp'
                : result.legacyMcpRewriteSuppressed
                  ? 'suppressed'
                  : 'none',
          classifierContexts: [
            {
              value,
              hostPrincipal:
                result.hook.type === 'callback' &&
                matched !== undefined &&
                matched.pluginId === undefined &&
                matched.pluginRoot === undefined &&
                matched.skillRoot === undefined,
            },
          ],
        }
      }

      // densable QLn @185141233 — void allow before Y aggregation.
      stripEvalConfinedHookAllow(
        result,
        `Hook ${hookEvent} (${getHookDisplayText(result.hook)})`,
      )

      // Official Y: deny > defer > ask > allow
      if (result.permissionBehavior) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) returned permissionDecision: ${result.permissionBehavior}${result.hookPermissionDecisionReason ? ` (reason: ${result.hookPermissionDecisionReason})` : ''}`,
        )
        switch (result.permissionBehavior) {
          case 'deny':
            permissionBehavior = 'deny'
            break
          case 'defer':
            if (permissionBehavior !== 'deny') {
              permissionBehavior = 'defer'
            }
            break
          case 'ask':
            if (
              permissionBehavior !== 'deny' &&
              permissionBehavior !== 'defer'
            ) {
              permissionBehavior = 'ask'
            }
            break
          case 'allow':
            if (!permissionBehavior) {
              permissionBehavior = 'allow'
            }
            break
          case 'passthrough':
            break
        }
      }

      // Official #1868 & #1869: yield when this hook holds Y, OR when Y is
      // 'defer' and this hook returned 'ask' (so an unhonored defer never
      // swallows an ask). Also attach hostsOwnAsk / serversOwnAsk metadata.
      const isHostOwnAsk =
        result.permissionBehavior === 'ask' &&
        isSdkHostOwnAskCallback(result.hook, matchedEntry)
      let yieldedUpdatedInput = false
      if (
        result.permissionBehavior &&
        (permissionBehavior === result.permissionBehavior ||
          (permissionBehavior === 'defer' &&
            result.permissionBehavior === 'ask'))
      ) {
        const updatedInput =
          result.updatedInput &&
          (result.permissionBehavior === 'allow' ||
            result.permissionBehavior === 'ask')
            ? result.updatedInput
            : undefined
        if (updatedInput) {
          yieldedUpdatedInput = true
          logForDebugging(
            `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) modified tool input keys: [${Object.keys(updatedInput).join(', ')}]`,
          )
        }
        yield {
          permissionBehavior: result.permissionBehavior,
          hookPermissionDecisionReason: result.hookPermissionDecisionReason,
          hookSource: matchedEntry?.hookSource,
          updatedInput,
          ...(isHostOwnAsk && { hostsOwnAsk: true }),
          ...(result.permissionBehavior === 'ask' &&
            matchedEntry?.sessionServer && { serversOwnAsk: true }),
        } as AggregatedHookResult
      }

      // Official 2.1.326 #248: Preserve a hook's `updatedInput` when multiple
      // hooks answer a tool call — including when one hook returns `allow` (or
      // passthrough) with `updatedInput` and another hook returns `ask`/`defer`
      // so the winning `permissionBehavior` differs from this hook's own behavior
      // (only skip when the winning decision is `deny`).
      if (
        result.updatedInput &&
        !yieldedUpdatedInput &&
        permissionBehavior !== 'deny' &&
        result.permissionBehavior !== 'deny'
      ) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) modified tool input keys: [${Object.keys(result.updatedInput).join(', ')}]`,
        )
        yield {
          updatedInput: result.updatedInput,
          hookSource: matchedEntry?.hookSource,
        }
      }
      // Yield permission request result if provided (from PermissionRequest hooks)
      if (result.permissionRequestResult) {
        yield {
          permissionRequestResult: result.permissionRequestResult,
        }
      }
      // Yield retry flag if provided (from PermissionDenied hooks)
      if (result.retry) {
        yield {
          retry: result.retry,
        }
      }
      // Yield elicitation response if provided (from Elicitation hooks)
      if (result.elicitationResponse) {
        yield {
          elicitationResponse: result.elicitationResponse,
        }
      }
      // Yield elicitation result response if provided (from ElicitationResult hooks)
      if (result.elicitationResultResponse) {
        yield {
          elicitationResultResponse: result.elicitationResultResponse,
        }
      }

      // Invoke session hook callback if this is a command/prompt/function hook (not a callback hook)
      if (appState && result.hook.type !== 'callback') {
        const sessionId = getSessionId()
        // Use empty string as matcher when matchQuery is undefined (e.g., for Stop hooks)
        const matcher = matchQuery ?? ''
        const hookEntry = getSessionHookCallback(
          appState,
          sessionId,
          hookEvent,
          matcher,
          result.hook,
        )
        // Invoke onHookSuccess only on success outcome
        if (hookEntry?.onHookSuccess && result.outcome === 'success') {
          try {
            hookEntry.onHookSuccess(result.hook, result as AggregatedHookResult)
          } catch (error) {
            logError(
              Error('Session hook success callback failed', { cause: error }),
            )
          }
        }
      }
    }
  } finally {
    hookHeartbeat?.stop()
    progress?.[Symbol.dispose]()
  }

  const totalDurationMs = Date.now() - batchStartTime
  getStatsStore()?.observe('hook_duration_ms', totalDurationMs)
  addToTurnHookDuration(totalDurationMs)

  logEvent(`tengu_repl_hook_finished`, {
    hookName:
      hookName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    numCommands: matchingHooks.length,
    numSuccess: outcomes.success,
    numBlocking: outcomes.blocking,
    numNonBlockingError: outcomes.non_blocking_error,
    numCancelled: outcomes.cancelled,
    totalDurationMs,
  })

  // Log hook execution completion to OTEL (only for beta tracing)
  if (isBetaTracingEnabled()) {
    const hookDefinitionsComplete =
      getHookDefinitionsForTelemetry(otelTrackedHooks)

    void logOTelEvent('hook_execution_complete', {
      hook_event: hookEvent,
      hook_name: hookName,
      num_hooks: String(otelTrackedHooks.length),
      num_success: String(otelOutcomes.success),
      num_blocking: String(otelOutcomes.blocking),
      num_non_blocking_error: String(otelOutcomes.non_blocking_error),
      num_cancelled: String(otelOutcomes.cancelled),
      managed_only: String(shouldAllowManagedHooksOnly()),
      hook_definitions: jsonStringify(hookDefinitionsComplete),
      hook_source: shouldAllowManagedHooksOnly() ? 'policySettings' : 'merged',
    })
  }

  // End hook span for beta tracing
  endHookSpan(hookSpan, {
    numSuccess: otelOutcomes.success,
    numBlocking: otelOutcomes.blocking,
    numNonBlockingError: otelOutcomes.non_blocking_error,
    numCancelled: otelOutcomes.cancelled,
  })
}
