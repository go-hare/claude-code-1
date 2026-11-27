import { getSessionId } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import {
  isAsyncHookJSONOutput,
  isSyncHookJSONOutput,
} from '../../types/hooks.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { logForDebugging } from '../debug.js'
import { logForDiagnosticsNoPII } from '../diagLogs.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  ControlStreamClosedError,
  errorMessage,
  isAbortError,
} from '../errors.js'
import { logError } from '../log.js'
import {
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from '../plugins/functionHooksModules.js'
import { incrementPluginUsage } from '../plugins/pluginUsagePending.js'
import {
  startSessionActivity,
  stopSessionActivity,
} from '../sessionActivity.js'
import { jsonStringify } from '../slowOperations.js'
import { execHttpHook } from './execHttpHook.js'
import { execMcpToolHook } from './execMcpToolHook.js'
import {
  getHookTypeCounts,
  getMatchingHooks,
  getPluginHookCounts,
  hookTelemetryFeatureName,
  isInternalHook,
} from './hookConfigRegistry.js'
import {
  applyOnFailureBlockToAggregatedHookResult,
  formatHookCompletionDebugLog,
  type HookWithOnFailure,
  type MatchedHook,
  parseHookOutput,
  shouldBlockOnFailureForEvent,
  TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  type TypedSyncHookOutput,
} from './hookCore.js'
import { trackHookExecution } from './hookExecutionState.js'
import { startHookHeartbeat } from './hookHeartbeat.js'
import {
  shouldFailClosedHookInput,
  shouldSkipHookDueToTrust,
  validateHookInputSize,
} from './hookInputHelpers.js'
import { resolveModelHookTimeoutMs } from './hookModelSlotPool.js'
import {
  CLASSIC_HOOK_HOP_SITE,
  mergeManagedAndDownstreamClassicEvent,
} from './hookOutputProcessor.js'
import { parseHttpHookOutput, Uct } from './hookOutputValidation.js'
import { shouldDisableAllHooksIncludingManaged } from './hooksConfigSnapshot.js'
import { execCommandHook } from './hookShellRunner.js'
import { formatHookProgressText, getHookDisplayText } from './hooksSettings.js'
import {
  getHookStdioError,
  selectCompleteHookOutput,
  stdioFailClosedEvents,
} from './hookStdIO.js'
import type { HookCommandResult, HookOutsideReplResult } from './hookTypes.js'
import {
  emitTerminalSequence,
  parseAllowedTerminalSequence,
} from './terminalSequence.js'
import { randomUUID } from 'crypto'
import type {
  HookEvent,
  HookInput,
  HookJSONOutput,
} from 'src/entrypoints/agentSdkTypes.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import stripAnsi from 'strip-ansi'

function holdOutsideHookActivity(
  event: HookEvent,
  hooks: MatchedHook[],
  timeoutMs: number,
): () => void {
  let bound: number
  try {
    if (
      [
        'MessageDisplay',
        'SessionEnd',
        'PermissionRequest',
        'Notification',
      ].includes(event) ||
      !process.env.CLAUDE_CODE_REMOTE_SEND_KEEPALIVES ||
      !getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_ccr_hook_keepalive_enabled',
        false,
      )
    )
      return () => {}
    const maxTimeout = Math.max(
      ...hooks.map(({ hook }) =>
        hook.type === 'function'
          ? (hook.timeout ?? timeoutMs)
          : hook.type === 'prompt' || hook.type === 'agent'
            ? resolveModelHookTimeoutMs(hook, timeoutMs)
            : hook.timeout
              ? hook.timeout * 1000
              : timeoutMs,
      ),
    )
    bound = Math.min(maxTimeout + 60000, 1200000)
  } catch (error) {
    logError(error)
    return () => {}
  }
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const release = () => {
    if (!active) return
    active = false
    try {
      clearTimeout(timer)
      stopSessionActivity('hook_exec', 'hook-dispatch-hold')
    } catch (error) {
      logError(error)
    }
  }
  try {
    startSessionActivity('hook_exec', 'hook-dispatch-hold')
    active = true
    const maxMs = Number.isFinite(bound) ? bound : 1200000
    timer = setTimeout(() => {
      logForDiagnosticsNoPII('warn', 'session_activity_hook_hold_expired', {
        max_ms: maxMs,
      })
      release()
    }, maxMs)
    timer.unref()
    return release
  } catch (error) {
    logError(error)
    release()
    return () => {}
  }
}

export function getHookWorktreePath(
  results: HookOutsideReplResult[],
): string | undefined {
  return results
    .filter(result => result.succeeded)
    .map(
      result =>
        stripAnsi(result.output)
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .at(-1) ?? '',
    )
    .find(path => path.length > 0)
}

function getOutsideHookFields(
  results: HookOutsideReplResult[],
  event: HookEvent,
): Record<string, unknown> {
  const block = results.find(result => result.blocked)?.output
  const worktreePath =
    event === 'WorktreeCreate' ? getHookWorktreePath(results) : undefined
  return {
    ...(block !== undefined && { block }),
    ...(worktreePath !== undefined && { worktreePath }),
  }
}

function consumeOutsideHookOutput(
  json: HookJSONOutput | undefined,
  hookName: string,
): void {
  if (!json || !isSyncHookJSONOutput(json) || !json.terminalSequence) return
  const allowed = parseAllowedTerminalSequence(json.terminalSequence)
  if (allowed !== null) emitTerminalSequence(allowed)
  else
    logForDebugging(
      `Hook ${hookName} returned a terminalSequence that was rejected by the allowlist (only OSC 0/1/2/9/99/777 and BEL are permitted, and OSC 9 bodies may not begin with a digit unless in the 9;4 progress form)`,
    )
}

export function hasBlockingResult(results: HookOutsideReplResult[]): boolean {
  return results.some(r => r.blocked)
}

/**
 * Execute hooks outside of the REPL (e.g. notifications, session end)
 *
 * Unlike executeHooks() which yields messages that are exposed to the model as
 * system messages, this function only logs errors via logForDebugging (visible
 * with --debug). Callers that need to surface errors to users should handle
 * the returned results appropriately (e.g. executeSessionEndHooks writes to
 * stderr during shutdown).
 *
 * @param getAppState Optional function to get the current app state (for session hooks)
 * @param hookInput The structured hook input that will be validated and converted to JSON
 * @param matchQuery The query to match against hook matchers
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Array of HookOutsideReplResult objects containing command, succeeded, and output
 */
export async function executeHooksOutsideREPL({
  getAppState,
  hookInput,
  matchQuery,
  signal,
  timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  storageV5,
  credentials,
  classicChainMember,
  managedHooksOnly,
  managedHooksExcluded,
  agentId,
}: {
  agentId?: string
  managedHooksOnly?: boolean
  managedHooksExcluded?: boolean
  getAppState?: () => AppState
  hookInput: HookInput
  matchQuery?: string
  signal?: AbortSignal
  timeoutMs: number
  classicChainMember?: boolean
  /** densable Fd persist — last two kwe args (jIs / Nw). */
  storageV5?: unknown
  credentials?: unknown
}): Promise<HookOutsideReplResult[]> {
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return []
  }

  const hookEvent = hookInput.hook_event_name
  const hookName = matchQuery ? `${hookEvent}:${matchQuery}` : hookEvent
  if (
    !classicChainMember &&
    !managedHooksOnly &&
    !shouldDisableAllHooksIncludingManaged() &&
    hasMatchingFunctionHook(hookEvent)
  ) {
    const collected: HookOutsideReplResult[] = []
    const returned = await runFunctionHookChain(
      hookEvent,
      hookInput as unknown as Record<string, unknown>,
      async event => {
        const downstream = await executeHooksOutsideREPL({
          getAppState,
          hookInput: event as HookInput,
          matchQuery,
          signal,
          timeoutMs,
          storageV5,
          credentials,
          agentId,
          classicChainMember: true,
          managedHooksExcluded: true,
        })
        collected.push(...downstream)
        return getOutsideHookFields(downstream, hookEvent)
      },
      undefined,
      undefined,
      {
        signal,
        site: CLASSIC_HOOK_HOP_SITE,
        handlersBefore: [
          {
            name: 'managed',
            isManaged: true,
            async run(event, next) {
              const managed = managedHooksExcluded
                ? []
                : await executeHooksOutsideREPL({
                    getAppState,
                    hookInput: event as HookInput,
                    matchQuery,
                    signal,
                    timeoutMs,
                    storageV5,
                    credentials,
                    agentId,
                    classicChainMember: true,
                    managedHooksOnly: true,
                  })
              collected.push(...managed)
              const fields = getOutsideHookFields(managed, hookEvent)
              if (fields.block !== undefined) return fields
              const downstream = await next(event)
              return mergeManagedAndDownstreamClassicEvent(
                fields,
                downstream && typeof downstream === 'object'
                  ? (downstream as Record<string, unknown>)
                  : {},
              )
            },
          },
        ],
      },
    )
    if (!returned || typeof returned !== 'object') return collected
    const event = returned as Record<string, unknown>
    const baseline = getOutsideHookFields(collected, hookEvent)
    const originalBlock = baseline.block
    const originalPath = baseline.worktreePath
    let results = collected
    if (event.block !== originalBlock) {
      results = results.filter(result => !result.blocked)
      if (event.block !== undefined)
        results.push({
          command: `classic.${hookEvent} hook`,
          succeeded: false,
          blocked: true,
          output: String(event.block),
        })
    }
    if (hookEvent === 'WorktreeCreate' && event.worktreePath !== originalPath) {
      results = results.filter(
        result => getHookWorktreePath([result]) === undefined,
      )
      if (typeof event.worktreePath === 'string')
        results.push({
          command: `classic.${hookEvent} hook`,
          succeeded: true,
          blocked: false,
          output: event.worktreePath,
        })
    }
    return results
  }

  // SECURITY: ALL hooks require workspace trust in interactive mode
  // This centralized check prevents RCE vulnerabilities for all current and future hooks
  if (shouldSkipHookDueToTrust()) {
    logForDebugging(
      `Skipping ${hookName} hook execution - workspace trust not accepted`,
    )
    return []
  }

  const appState = getAppState ? getAppState() : undefined
  // Use main session ID for outside-REPL hooks
  const sessionId = getSessionId()
  const matchingHooks = await getMatchingHooks(
    appState,
    sessionId,
    hookEvent,
    hookInput,
    undefined,
    { managedHooksOnly, managedHooksExcluded },
  ).catch(error => {
    logError(new Error('Failed to match hooks', { cause: error }))
    logEvent('tengu_feature_bad', {
      feature_name: hookTelemetryFeatureName(
        hookEvent,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'hook_matching_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (shouldFailClosedHookInput(hookEvent)) throw error
    return []
  })
  if (matchingHooks.length === 0) {
    return []
  }

  if (signal?.aborted) {
    return []
  }

  const userHooks = matchingHooks.filter(h => !isInternalHook(h))
  if (userHooks.length > 0) {
    const pluginHookCounts = getPluginHookCounts(userHooks)
    const hookTypeCounts = getHookTypeCounts(userHooks)
    logEvent(`tengu_run_hook`, {
      hookName:
        hookName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      numCommands: userHooks.length,
      numMatchAllMatchers: userHooks.filter(hook => hook.matcherIsMatchAll)
        .length,
      numSpecificMatchers: userHooks.filter(hook => !hook.matcherIsMatchAll)
        .length,
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

  // Validate and stringify the hook input
  let jsonInput: string
  try {
    jsonInput = jsonStringify(hookInput)
    validateHookInputSize(hookEvent, jsonInput)
  } catch (error) {
    logError(error)
    logEvent('tengu_feature_bad', {
      feature_name: hookTelemetryFeatureName(
        hookEvent,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code: (error instanceof RangeError &&
      error.message === 'Hook input is over the size limit'
        ? 'hook_input_too_large'
        : 'hook_input_stringify_failed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (shouldFailClosedHookInput(hookEvent)) throw error
    return []
  }

  let failureReason: string | undefined
  let callbackCancelled = false
  let schemaInvalidBlocked = false
  const releaseHold =
    userHooks.length > 0
      ? holdOutsideHookActivity(hookEvent, matchingHooks, timeoutMs)
      : () => {}
  const progress =
    userHooks.length > 0
      ? trackHookExecution({
          hookEvent,
          agentId,
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
  // 2.1.323 #1970: 30s progress heartbeat for outside-REPL hooks (PreCompact/PostCompact)
  const outsideHeartbeat = startHookHeartbeat({
    hookEvent,
    toolUseID: randomUUID(),
    agentId,
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
  // Run all hooks in parallel with individual timeouts
  const hookPromises = matchingHooks.map(
    async (
      {
        hook,
        pluginRoot,
        pluginId,
        skillRoot,
        projectRoot,
        hookSource,
        isManagedHook,
      },
      hookIndex,
    ) => {
      // Gold289 SKo/_Ko are fixed false/null in this build: no usable
      // working-copy host exists for a matcher that pins a project root.
      if (projectRoot !== undefined) {
        failureReason ??= 'hook_did_not_run'
        const output = `not run: it came from ${projectRoot}, which is no longer a working copy this session can use, and the session's directory is not in one either`
        logForDebugging(
          `Hooks: ${getHookDisplayText(hook)} for ${hookEvent} ${output}`,
          { level: 'warn' },
        )
        return {
          command: getHookDisplayText(hook),
          succeeded: false,
          output,
          blocked: false,
        }
      }
      // Handle callback hooks
      if (hook.type === 'callback') {
        const callbackTimeoutMs = hook.timeout ? hook.timeout * 1000 : timeoutMs
        const { signal: abortSignal, cleanup } = createCombinedAbortSignal(
          signal,
          { timeoutMs: callbackTimeoutMs },
        )

        try {
          const toolUseID = randomUUID()
          const json = await hook.callback(
            hookInput,
            toolUseID,
            abortSignal,
            hookIndex,
          )

          cleanup?.()

          if (isAsyncHookJSONOutput(json)) {
            logForDebugging(
              `${hookName} [callback] returned async response, returning empty output`,
            )
            return {
              command: 'callback',
              succeeded: true,
              output: '',
              blocked: false,
            }
          }

          const typedJson = json as TypedSyncHookOutput
          const output =
            hookEvent === 'WorktreeCreate' &&
            isSyncHookJSONOutput(json) &&
            typedJson.hookSpecificOutput?.hookEventName === 'WorktreeCreate'
              ? typedJson.hookSpecificOutput.worktreePath
              : typedJson.systemMessage || ''
          const blocked =
            isSyncHookJSONOutput(json) && typedJson.decision === 'block'

          consumeOutsideHookOutput(json, hookName)
          logForDebugging(`${hookName} [callback] completed successfully`)

          return {
            command: 'callback',
            succeeded: true,
            output,
            blocked,
          }
        } catch (error) {
          cleanup?.()
          if (isAbortError(error)) {
            const cancelled =
              error instanceof ControlStreamClosedError || !!signal?.aborted
            if (cancelled) callbackCancelled = true
            else failureReason ??= 'hook_callback_timeout'
            logForDebugging(
              cancelled
                ? error instanceof ControlStreamClosedError
                  ? `${hookName} [callback] cancelled (control stream closed)`
                  : `${hookName} [callback] cancelled`
                : `${hookName} [callback] timed out`,
              cancelled ? undefined : { level: 'error' },
            )
            return {
              command: 'callback',
              succeeded: false,
              output: '',
              blocked: false,
              ...(cancelled && { cancelled: true }),
            }
          }

          const errorMessage =
            error instanceof Error ? error.message : String(error)
          failureReason ??= 'hook_callback_failed'
          logForDebugging(
            `${hookName} [callback] failed to run: ${errorMessage}`,
            { level: 'error' },
          )
          return {
            command: 'callback',
            succeeded: false,
            output: errorMessage,
            blocked: false,
          }
        }
      }

      // Gold289 deliberately does not run prompt hooks outside REPL.
      if (hook.type === 'prompt') {
        failureReason ??= 'hook_type_unsupported'
        return {
          command: hook.prompt,
          succeeded: false,
          output: 'Prompt stop hooks are not yet supported outside REPL',
          blocked: false,
        }
      }

      // Gold289 deliberately does not run agent hooks outside REPL.
      if (hook.type === 'agent') {
        failureReason ??= 'hook_type_unsupported'
        return {
          command: hook.prompt,
          succeeded: false,
          output: 'Agent stop hooks are not yet supported outside REPL',
          blocked: false,
        }
      }

      // Function hooks require messages array (only available in REPL context)
      // For -p mode Stop hooks, use executeStopHooks which supports function hooks
      if (hook.type === 'function') {
        failureReason ??= 'hook_type_unsupported'
        logError(
          new Error(
            `Function hook reached executeHooksOutsideREPL for ${hookEvent}. Function hooks should only be used in REPL context (Stop hooks).`,
          ),
        )
        return {
          command: 'function',
          succeeded: false,
          output: 'Internal error: function hook executed outside REPL context',
          blocked: false,
        }
      }

      // Handle HTTP hooks (no toolUseContext needed - just HTTP POST).
      // execHttpHook handles its own timeout internally via hook.timeout or
      // DEFAULT_HTTP_HOOK_TIMEOUT_MS, so we pass signal directly.
      if (hook.type === 'http' || hook.type === 'mcp_tool') {
        try {
          const httpResult: {
            ok: boolean
            body: string
            error?: string
            aborted?: boolean
            withheld?: boolean
            statusCode?: number
          } =
            hook.type === 'http'
              ? await execHttpHook(
                  hook,
                  hookEvent,
                  jsonInput,
                  signal,
                  timeoutMs,
                  { hookSource, isManagedHook },
                )
              : await execMcpToolHook(
                  hook,
                  hookEvent,
                  jsonInput,
                  getAppState?.().mcp.clients,
                  signal,
                  timeoutMs,
                )

          if (httpResult.aborted) {
            failureReason ??= 'hook_cancelled'
            logForDebugging(
              `${hookName} [${getHookDisplayText(hook)}] cancelled`,
            )
            return {
              command: getHookDisplayText(hook),
              succeeded: false,
              output: 'Hook cancelled',
              blocked: false,
              ...(signal?.aborted && { cancelled: true }),
            }
          }

          if (httpResult.error || !httpResult.ok) {
            failureReason ??=
              hook.type === 'http'
                ? 'hook_http_request_failed'
                : 'hook_mcp_tool_failed'
            const errMsg =
              httpResult.error ||
              (hook.type === 'mcp_tool'
                ? 'MCP tool returned an error'
                : `HTTP ${httpResult.statusCode} from ${getHookDisplayText(hook)}`)
            logForDebugging(
              `${hookName} [${getHookDisplayText(hook)}] failed: ${errMsg}`,
              {
                level: 'error',
              },
            )
            return {
              command: getHookDisplayText(hook),
              succeeded: false,
              output: errMsg,
              blocked: false,
            }
          }

          // HTTP hooks must return JSON — parse and validate through Zod
          const { json: httpJson, validationError: httpValidationError } =
            hook.type === 'http'
              ? parseHttpHookOutput(httpResult.body)
              : parseHookOutput(httpResult.body)
          if (httpValidationError) {
            throw new Error(httpValidationError)
          }
          if (httpJson && !isAsyncHookJSONOutput(httpJson)) {
            logForDebugging(
              `Parsed JSON output from HTTP hook: ${jsonStringify(httpJson)}`,
              { level: 'verbose' },
            )
          }
          const typedHttpJson = httpJson as TypedSyncHookOutput | undefined
          const jsonBlocked =
            httpJson &&
            !isAsyncHookJSONOutput(httpJson) &&
            isSyncHookJSONOutput(httpJson) &&
            typedHttpJson?.decision === 'block'

          // WorktreeCreate's consumer reads `output` as the bare filesystem
          // path. Command hooks provide it via stdout; http hooks provide it
          // via hookSpecificOutput.worktreePath. Without worktreePath, emit ''
          // so the consumer's length filter skips it instead of treating the
          // raw '{}' body as a path.
          const output = jsonBlocked
            ? typedHttpJson?.reason || ''
            : hook.type === 'http' && hookEvent === 'WorktreeCreate'
              ? httpJson &&
                isSyncHookJSONOutput(httpJson) &&
                typedHttpJson?.hookSpecificOutput?.hookEventName ===
                  'WorktreeCreate'
                ? typedHttpJson.hookSpecificOutput.worktreePath
                : ''
              : httpResult.body

          consumeOutsideHookOutput(httpJson, hookName)
          const syncJson =
            httpJson && isSyncHookJSONOutput(httpJson)
              ? typedHttpJson
              : undefined
          return {
            command: getHookDisplayText(hook),
            succeeded: true,
            output,
            blocked: !!jsonBlocked,
            ...(hook.type === 'mcp_tool' && {
              watchPaths:
                syncJson?.hookSpecificOutput &&
                'watchPaths' in syncJson.hookSpecificOutput
                  ? syncJson.hookSpecificOutput.watchPaths
                  : undefined,
            }),
            systemMessage: syncJson?.systemMessage,
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error)
          failureReason ??=
            hook.type === 'http'
              ? 'hook_http_exec_failed'
              : 'hook_mcp_exec_failed'
          logForDebugging(
            `${hookName} [${getHookDisplayText(hook)}] failed to run: ${errorMessage}`,
            { level: 'error' },
          )
          return {
            command: getHookDisplayText(hook),
            succeeded: false,
            output: errorMessage,
            blocked: false,
          }
        }
      }

      // Handle command hooks
      const commandText = getHookDisplayText(hook)
      let exitedBlocking = false
      const hookStartMs = Date.now()
      const commandTimeoutMs = hook.timeout ? hook.timeout * 1000 : timeoutMs
      const { signal: abortSignal, cleanup } = createCombinedAbortSignal(
        signal,
        { timeoutMs: commandTimeoutMs },
      )
      try {
        const result = await execCommandHook(
          hook,
          hookEvent,
          hookName,
          jsonInput,
          abortSignal,
          randomUUID(),
          hookIndex,
          pluginRoot,
          pluginId,
          skillRoot,
          shouldBlockOnFailureForEvent(
            hook as HookWithOnFailure,
            hookEvent as HookEvent,
          ),
          undefined,
          storageV5,
          credentials,
        )

        exitedBlocking = result.status === 2 && !result.backgrounded
        // Clear timeout if hook completes
        cleanup?.()
        const durationMs = Date.now() - hookStartMs
        logForDebugging(
          formatHookCompletionDebugLog({
            hookName,
            command: commandText,
            pluginId,
            result,
            timeoutMs: commandTimeoutMs,
            durationMs,
            parentAborted: signal?.aborted === true,
          }),
        )

        if (result.aborted) {
          const commandResult = result as HookCommandResult & {
            stoppedAfterItsTimeout?: boolean
          }
          const abortedByParent =
            signal?.aborted === true &&
            commandResult.stoppedAfterItsTimeout !== true
          failureReason ??= 'hook_cancelled'
          return {
            command: commandText,
            succeeded: false,
            output: 'Hook cancelled',
            blocked: false,
            ...(abortedByParent && { cancelled: true }),
          }
        }

        // Parse JSON for any messages to print out.
        // densable 2.1.214 #40: `if(L&&k.status!==2)throw Error(L)` — schema
        // failure must not override exit code 2 blocking.
        const parsed = parseHookOutput(result.stdout)
        const { validationError } = parsed
        const json = selectCompleteHookOutput(result, hookEvent, parsed.json)
        const stdioError = getHookStdioError(
          result,
          hookEvent,
          json,
          text => parseHookOutput(text).json,
        )
        if (stdioError !== undefined) {
          failureReason ??= 'hook_stdio_incomplete'
          return {
            command: commandText,
            succeeded: false,
            output: Uct(stdioError, result.status, result.stderr),
            blocked: stdioFailClosedEvents.has(hookEvent),
          }
        }
        if (validationError && result.status === 2) schemaInvalidBlocked = true
        else if (validationError) {
          failureReason ??= 'hook_output_schema_invalid'
          // densable 2.1.248: throw Error(Uct(xt, status, stderr))
          throw new Error(Uct(validationError, result.status, result.stderr))
        }
        if (json && !isAsyncHookJSONOutput(json)) {
          logForDebugging(
            `Parsed JSON output from hook: ${jsonStringify(json)}`,
            { level: 'verbose' },
          )
        }

        consumeOutsideHookOutput(json, hookName)
        // Blocked if exit code 2 or JSON decision: 'block'
        const typedJson = json as TypedSyncHookOutput | undefined
        const jsonBlocked =
          json &&
          !isAsyncHookJSONOutput(json) &&
          isSyncHookJSONOutput(json) &&
          typedJson?.decision === 'block'
        const blocked = result.status === 2 || !!jsonBlocked

        // densable: block path uses decision reason or stderr; exit 2 keeps stderr
        // even when stdout JSON schema failed (json ignored / absent).
        const output = jsonBlocked
          ? typedJson?.reason || result.stderr || ''
          : result.status === 0
            ? result.stdout || ''
            : result.stderr || ''

        const watchPaths =
          json &&
          isSyncHookJSONOutput(json) &&
          typedJson?.hookSpecificOutput &&
          'watchPaths' in typedJson.hookSpecificOutput
            ? (typedJson.hookSpecificOutput as { watchPaths?: string[] })
                .watchPaths
            : undefined

        const systemMessage =
          json && isSyncHookJSONOutput(json)
            ? typedJson?.systemMessage
            : undefined

        if (result.status !== 0 && !blocked)
          failureReason ??= 'hook_nonzero_exit'
        return {
          command: commandText,
          succeeded: result.status === 0,
          output,
          blocked,
          ...(result.exitedNormally && { exitCode: result.status }),
          watchPaths,
          systemMessage,
        }
      } catch (error) {
        // Clean up on error
        cleanup?.()

        const errorMessage =
          error instanceof Error ? error.message : String(error)
        failureReason ??= 'hook_exec_failed'
        logForDebugging(
          `${hookName} [${commandText}] failed to run: ${errorMessage}`,
          { level: 'error' },
        )
        return {
          command: commandText,
          succeeded: false,
          output: errorMessage,
          blocked:
            exitedBlocking &&
            (hookEvent === 'PreToolUse' || hookEvent === 'PermissionRequest'),
        }
      }
    },
  )

  const results = await Promise.all(
    hookPromises.map((promise, index) => {
      const hook = matchingHooks[index]?.hook
      return promise
        .then(res =>
          hook
            ? applyOnFailureBlockToAggregatedHookResult(
                hook as HookWithOnFailure,
                res,
                hookEvent,
              )
            : res,
        )
        .finally(() => {
          const progressIndex = hook ? progressIndices.get(hook) : undefined
          if (progressIndex !== undefined) progress?.settle(progressIndex)
        })
    }),
  ).finally(() => {
    outsideHeartbeat?.stop()
    progress?.[Symbol.dispose]()
    releaseHold()
  })
  logEvent(
    failureReason
      ? 'tengu_feature_bad'
      : callbackCancelled || schemaInvalidBlocked
        ? 'tengu_feature_sad'
        : 'tengu_feature_ok',
    {
      feature_name: hookTelemetryFeatureName(
        hookEvent,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(failureReason || callbackCancelled || schemaInvalidBlocked
        ? {
            error_code: (failureReason ??
              (callbackCancelled
                ? 'hook_cancelled'
                : 'hook_output_schema_invalid_blocked')) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
    },
  )
  for (const pluginId of new Set(matchingHooks.map(hook => hook.pluginId))) {
    if (pluginId) incrementPluginUsage(pluginId)
  }
  return results
}
