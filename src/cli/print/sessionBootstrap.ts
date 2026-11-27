/**
 * Headless session resume/bootstrap loading, plan-mode resume, SEP-2663 task restoration,
 * and StructuredIO / RemoteIO stream construction.
 */
import {
  getSessionId,
  isSessionPersistenceDisabled,
  switchSession,
  setMainLoopModelOverride,
  setSdkSupportedDialogKinds,
} from 'src/bootstrap/state.js'
import { EMPTY_USAGE } from '@ant/model-provider'
import { randomUUID } from 'crypto'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { Message } from 'src/types/message.js'
import {
  type TurnInterruptionState,
  type OverdueSessionStartHooks,
  loadConversationForResume,
  rerunWouldLeavePlanMode,
} from 'src/utils/conversationRecovery.js'
import {
  type PlanModeOnResume,
  hydratePlanModeFromRestoredWorker,
  hydratePlanModeFromTranscript,
} from 'src/utils/permissions/planModeResume.js'
import type { HookDeferredToolAttachment } from 'src/utils/attachments.js'
import type {
  HeadlessAppState,
  HeadlessSetAppState,
} from 'src/cli/headless/HeadlessControlPlane.js'
import type { AppState } from 'src/state/AppStateStore.js'
import type {
  RestoredWorkerState,
  SessionExternalMetadata,
} from 'src/utils/sessionState.js'
import { processSessionStartHooks } from 'src/utils/sessionStart.js'
import { logEvent } from 'src/services/analytics/index.js'
import { feature } from 'bun:bundle'
import { syncCoordinatorModeEnvFromSession } from 'src/utils/residualFinalEnvGates.js'
import { getCwd } from 'src/utils/cwd.js'
import { asSessionId } from 'src/types/ids.js'
import { dirname } from 'path'
import {
  resetSessionFilePointer,
  restoreSessionMetadata,
  adoptResumedSessionFile,
  saveMode,
  hydrateFromCCRv2InternalEvents,
  hydrateRemoteSession,
} from 'src/utils/sessionStorage.js'
import {
  restoreSessionStateFromLog,
  restoreWorktreeForResume,
} from 'src/utils/sessionRestore.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import { logError } from 'src/utils/log.js'
import {
  planCodeModeFromSession,
  applyCodeModePlan,
} from 'src/services/codeMode/executor.js'
import {
  gracefulShutdownSync,
  gracefulShutdown,
} from 'src/utils/gracefulShutdown.js'
import { errorMessage } from '../../utils/errors.js'
import { parseSessionIdentifier } from 'src/utils/sessionUrl.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { externalMetadataToAppState } from 'src/state/onChangeAppState.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  type Sep2663TaskSidecarMeta,
  type RestoredMcpTaskBinding,
  readPersistedSep2663TaskMetas,
  restoreSep2663Tasks,
} from 'src/tasks/McpTask/McpTask.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import { enqueuePendingNotification } from 'src/utils/messageQueueManager.js'
import { StructuredIO } from 'src/cli/structuredIO.js'
import { fromArray } from 'src/utils/generators.js'
import type { SDKUserMessage } from 'src/entrypoints/agentSdkTypes.js'
import { RemoteIO } from 'src/cli/remoteIO.js'
import { getCoordinatorModeModule } from './featureLoaders.js'
import { reportPrintStartupFatalToJobDir } from './startupAndAccount.js'

/**
 * Emits an error message in the correct format based on outputFormat.
 * When using stream-json, writes JSON to stdout; otherwise writes plain text to stderr.
 */
export function emitLoadError(
  message: string,
  outputFormat: string | undefined,
): void {
  // #1927: Record fatal startup/resume error in CLAUDE_JOB_DIR/exit-detail so
  // `claude --bg` agent view shows the error from its beginning.
  reportPrintStartupFatalToJobDir('startup_error', message)
  if (outputFormat === 'stream-json') {
    const errorResult = {
      type: 'result',
      subtype: 'error_during_execution',
      duration_ms: 0,
      duration_api_ms: 0,
      is_error: true,
      num_turns: 0,
      stop_reason: null,
      session_id: getSessionId(),
      total_cost_usd: 0,
      usage: EMPTY_USAGE,
      modelUsage: {},
      permission_denials: [],
      uuid: randomUUID(),
      errors: [message],
    }
    process.stdout.write(jsonStringify(errorResult) + '\n')
  } else {
    process.stderr.write(message + '\n')
  }
}

export type LoadInitialMessagesResult = {
  messages: Message[]
  turnInterruptionState?: TurnInterruptionState
  agentSetting?: string
  planModeOnResume?: PlanModeOnResume
  deferredToolUse?: HookDeferredToolAttachment
  overdueSessionStartHooks?: OverdueSessionStartHooks
  codeModeWaitForNextPrompt?: boolean
  codeModeSwitched?: boolean
}

function applyPrintPlanModeResume<TState extends HeadlessAppState = AppState>(
  setAppStateParam: HeadlessSetAppState<TState>,
  restored: RestoredWorkerState,
  options: {
    forkSession?: boolean
    sdkUrl?: string
    permissionModeSuppliedOnInvocation?: boolean
  },
  messages?: Message[],
): PlanModeOnResume {
  const setAppState = setAppStateParam as unknown as (
    f: (prev: AppState) => AppState,
  ) => void
  return hydratePlanModeFromRestoredWorker(setAppState, restored, {
    forkSession: !!options.forkSession,
    lane: options.sdkUrl ? 'sdk_url' : 'print',
    transcript: messages,
    applyTranscriptHydrate: messages !== undefined,
    sdkUrl: options.sdkUrl,
    permissionModeSuppliedOnInvocation:
      options.permissionModeSuppliedOnInvocation,
  })
}

export async function loadInitialMessages<
  TState extends HeadlessAppState = AppState,
>(
  setAppStateParam: HeadlessSetAppState<TState>,
  options: {
    continue: boolean | undefined
    teleport: string | true | null | undefined
    resume: string | boolean | undefined
    resumeSessionAt: string | undefined
    forkSession: boolean | undefined
    outputFormat: string | undefined
    /** Official sdkUrl densable — enables RESUME_FROM_SESSION hydrate when empty. */
    sdkUrl?: string | undefined
    permissionModeSuppliedOnInvocation?: boolean
    sessionStartHooksPromise?: ReturnType<typeof processSessionStartHooks>
    restoredWorkerState: Promise<RestoredWorkerState>
    /** densable hydratePrefetch — [fg, sub, tip] from RemoteIO */
    hydratePrefetch?: Promise<
      | [
          unknown,
          unknown,
          { eventId?: string; fallbackReason?: string } | undefined,
        ]
      | null
    > | null
  },
): Promise<LoadInitialMessagesResult> {
  const setAppState = setAppStateParam as unknown as (
    f: (prev: AppState) => AppState,
  ) => void
  const persistSession = !isSessionPersistenceDisabled()
  // Handle continue in print mode
  if (options.continue) {
    try {
      logEvent('tengu_continue_print', {})

      // Print path keeps interrupt+NRR sentinel so removeInterruptedMessage +
      // re-enqueue works; interactive mid-turn uses {replay:true} instead.
      // densable 2.1.214 #47: forkSession → SessionStart source "fork"
      const result = await loadConversationForResume(
        undefined /* sessionId */,
        undefined /* file path */,
        {
          forkSession: !!options.forkSession,
          supportOverdueSessionStartHooks: true,
          ...(!options.sdkUrl
            ? {
                rerunWouldLeaveMode: msgs => {
                  let wouldLeave = false
                  setAppState(prev => {
                    wouldLeave = rerunWouldLeavePlanMode(
                      msgs,
                      prev.toolPermissionContext.mode,
                      false,
                    )
                    return prev
                  })
                  return wouldLeave
                },
              }
            : {}),
        },
      )
      if (result) {
        // Match coordinator mode to the resumed session's mode.
        // When lazy require yields an incomplete namespace, still flip env so
        // tool filter / footer match the transcript (saveMode already does).
        if (feature('COORDINATOR_MODE')) {
          const coordinatorMod = getCoordinatorModeModule()
          const warning = coordinatorMod
            ? coordinatorMod.matchSessionMode(result.mode)
            : syncCoordinatorModeEnvFromSession(result.mode)
          if (warning) {
            process.stderr.write(warning + '\n')
            // Refresh agent definitions to reflect the mode switch
            const {
              getAgentDefinitionsWithOverrides,
              getActiveAgentsFromList,
            } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js') as typeof import('@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js')
            getAgentDefinitionsWithOverrides.cache.clear?.()
            const freshAgentDefs = await getAgentDefinitionsWithOverrides(
              getCwd(),
            )

            setAppState(prev => ({
              ...prev,
              agentDefinitions: {
                ...freshAgentDefs,
                allAgents: freshAgentDefs.allAgents,
                activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
              },
            }))
          }
        }

        // Reuse the resumed session's ID
        if (!options.forkSession) {
          if (result.sessionId) {
            switchSession(
              asSessionId(result.sessionId),
              result.fullPath ? dirname(result.fullPath) : null,
              'resume',
            )
            if (persistSession) {
              await resetSessionFilePointer()
            }
          }
        }
        restoreSessionStateFromLog(result, setAppState)

        // Restore session metadata so it's re-appended on exit via reAppendSessionMetadata
        restoreSessionMetadata(
          options.forkSession
            ? { ...result, worktreeSession: undefined }
            : result,
        )

        // densable e_t(worktreeSession) + E$e: print/SDK --continue must rehydrate
        // currentWorktreeSession so ExitWorktree is not a no-op (#21).
        if (!options.forkSession) {
          try {
            restoreWorktreeForResume(result.worktreeSession)
            if (
              result.worktreeSession &&
              SandboxManager.isSandboxingEnabled()
            ) {
              SandboxManager.refreshConfig()
            }
          } catch (error) {
            logError(error)
          }
          if (persistSession && result.sessionId) {
            adoptResumedSessionFile()
          }
        }

        // Write mode entry for the resumed session — align sessionRestore:
        // result.mode ?? env; do not skip when coordinator module is null.
        if (feature('COORDINATOR_MODE')) {
          const { isCoordinatorModeEnvEnabled } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
          saveMode(
            result.mode ??
              (isCoordinatorModeEnvEnabled() ? 'coordinator' : 'normal'),
          )
        }

        // Official 2.1.325 #2316: reconcile Code Mode state on --continue and
        // skip auto-resuming an interrupted turn when the session ended mid-script.
        const continueCodeModePlan = planCodeModeFromSession({
          replMode: (result as { replMode?: boolean }).replMode,
          sessionId: result.sessionId ?? getSessionId(),
          headless: true,
          withinSession: false,
          source: 'store',
          messages: result.messages,
        })
        if (continueCodeModePlan.refused) {
          emitLoadError(continueCodeModePlan.refused, options.outputFormat)
          gracefulShutdownSync(1)
          return { messages: [] }
        }
        applyCodeModePlan(continueCodeModePlan)

        // Official 246 `my(messages)` — transcript plan, not y_u.
        const planModeOnResume = hydratePlanModeFromTranscript(
          setAppState,
          result.messages,
          {
            forkSession: !!options.forkSession,
            sdkUrl: options.sdkUrl,
            permissionModeSuppliedOnInvocation:
              options.permissionModeSuppliedOnInvocation,
          },
        )

        return {
          messages: result.messages,
          turnInterruptionState: result.turnInterruptionState,
          agentSetting: result.agentSetting,
          planModeOnResume,
          deferredToolUse: result.deferredToolUse,
          overdueSessionStartHooks: result.overdueSessionStartHooks,
          ...(continueCodeModePlan.waitForNextPrompt
            ? { codeModeWaitForNextPrompt: true }
            : {}),
          ...(continueCodeModePlan.switched ? { codeModeSwitched: true } : {}),
        }
      }
    } catch (error) {
      logError(error)
      gracefulShutdownSync(1)
      return { messages: [] }
    }
  }

  // Handle teleport in print mode
  if (options.teleport) {
    try {
      const { waitForPolicyLimitsToLoad, isRemotePolicyAllowed } = await import(
        'src/services/policyLimits/index.js'
      )
      await waitForPolicyLimitsToLoad()
      if (!isRemotePolicyAllowed('allow_remote_sessions')) {
        throw new Error(
          "Remote sessions are disabled by your organization's policy.",
        )
      }

      logEvent('tengu_teleport_print', {})

      if (typeof options.teleport !== 'string') {
        throw new Error('No session ID provided for teleport')
      }

      const {
        checkOutTeleportedSessionBranch,
        processMessagesForTeleportResume,
        teleportResumeCodeSession,
        validateGitState,
      } = await import('src/utils/teleport.js')
      await validateGitState()
      const teleportResult = await teleportResumeCodeSession(options.teleport)
      // Official 2.1.323 #2073: fail explicitly instead of opening an empty
      // session when the server could not find the teleported session's history.
      if (!teleportResult.log || teleportResult.log.length === 0) {
        throw new Error(
          `Could not find session history for teleport session ${options.teleport}`,
        )
      }
      const { branchError } = await checkOutTeleportedSessionBranch(
        teleportResult.branch,
      )
      return {
        messages: processMessagesForTeleportResume(
          teleportResult.log,
          branchError,
        ),
      }
    } catch (error) {
      logError(error)
      // Official 2.1.323 #2073: surface the failure and exit non-zero in
      // `claude -p --teleport` instead of silently returning empty messages.
      emitLoadError(errorMessage(error), options.outputFormat)
      await gracefulShutdown(1)
      return { messages: [] }
    }
  }

  // Handle resume in print mode (accepts session ID or URL)
  // URLs are [ANT-ONLY]
  if (options.resume) {
    try {
      logEvent('tengu_resume_print', {})

      // In print mode - we require a valid session ID, JSONL file or URL
      const parsedSessionId = parseSessionIdentifier(
        typeof options.resume === 'string' ? options.resume : '',
      )
      let restored: RestoredWorkerState = null

      if (!parsedSessionId) {
        let errorMessage =
          'Error: --resume requires a valid session ID when used with --print. Usage: claude -p --resume <session-id>'
        if (typeof options.resume === 'string') {
          errorMessage += `. Session IDs must be in UUID format (e.g., 550e8400-e29b-41d4-a716-446655440000). Provided value "${options.resume}" is not a valid UUID`
        }
        emitLoadError(errorMessage, options.outputFormat)
        gracefulShutdownSync(1)
        return { messages: [] }
      }

      // Hydrate local transcript from remote before loading
      // Official USE_CCR_V2 densable.
      let useCcrV2 = isEnvTruthy(process.env.CLAUDE_CODE_USE_CCR_V2)
      try {
        const { isCcrV2EnvEnabled } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
        useCcrV2 = isCcrV2EnvEnabled()
      } catch {
        // keep raw env fallback
      }
      if (useCcrV2) {
        // densable Q0a(sessionId, prefetch, w3i(), C3i()) — tip-validated
        // delta rehydrate when tengu_ccr_delta_rehydrate is on (#10).
        const { getFeatureValue_CACHED_MAY_BE_STALE: gb } = await import(
          '../../services/analytics/growthbook.js'
        )
        const enableDelta = gb('tengu_ccr_delta_rehydrate', false)
        const skipSubagentOnDelta = gb(
          'tengu_ccr_subagent_skip_on_delta',
          false,
        )
        const prefetch = options.hydratePrefetch
          ? await options.hydratePrefetch
          : null
        // Await restore alongside hydration so SSE catchup lands on
        // restored state, not a fresh default.
        const [, metadata] = await Promise.all([
          hydrateFromCCRv2InternalEvents(
            parsedSessionId.sessionId,
            prefetch as Parameters<typeof hydrateFromCCRv2InternalEvents>[1],
            enableDelta,
            skipSubagentOnDelta,
          ),
          options.restoredWorkerState,
        ])
        if (metadata) {
          restored = metadata
          if (metadata.external) {
            setAppState(
              externalMetadataToAppState(
                metadata.external as SessionExternalMetadata,
              ),
            )
            if (typeof metadata.external.model === 'string') {
              setMainLoopModelOverride(metadata.external.model)
            }
          }
          // Official hvf — restore declared_dialog_kinds from prior worker epoch.
          try {
            const internal = metadata.internal as {
              declared_dialog_kinds?: unknown
            } | null
            const { getSdkSupportedDialogKinds } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
            if (
              Array.isArray(internal?.declared_dialog_kinds) &&
              getSdkSupportedDialogKinds() === undefined
            ) {
              const { sanitizeDeclaredDialogKinds } =
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('../../utils/userDialog.js') as typeof import('../../utils/userDialog.js')
              const kinds = sanitizeDeclaredDialogKinds(
                internal.declared_dialog_kinds,
              )
              setSdkSupportedDialogKinds(
                kinds.length > 0 ? kinds : undefined,
                'restored',
              )
              logForDebugging(
                `[print.ts] restored ${kinds.length} declared dialog kind(s) from prior worker epoch`,
              )
            }
          } catch {
            // densable optional
          }
        }
      } else if (
        parsedSessionId.isUrl &&
        parsedSessionId.ingressUrl &&
        isEnvTruthy(process.env.ENABLE_SESSION_PERSISTENCE)
      ) {
        // v1: fetch session logs from Session Ingress
        await hydrateRemoteSession(
          parsedSessionId.sessionId,
          parsedSessionId.ingressUrl,
        )
      }

      // Load the conversation with the specified session ID
      // densable 2.1.214 #47: forkSession → SessionStart source "fork"
      const result = await loadConversationForResume(
        parsedSessionId.sessionId,
        parsedSessionId.jsonlFile || undefined,
        {
          forkSession: !!options.forkSession,
          supportOverdueSessionStartHooks: true,
          ...(!options.sdkUrl
            ? {
                rerunWouldLeaveMode: msgs => {
                  let wouldLeave = false
                  setAppState(prev => {
                    wouldLeave = rerunWouldLeavePlanMode(
                      msgs,
                      prev.toolPermissionContext.mode,
                      false,
                    )
                    return prev
                  })
                  return wouldLeave
                },
              }
            : {}),
        },
      )

      // hydrateFromCCRv2InternalEvents writes an empty transcript file for
      // fresh sessions (writeFile(sessionFile, '') with zero events), so
      // loadConversationForResume returns {messages: []} not null. Treat
      // empty the same as null so SessionStart still fires.
      if (!result || result.messages.length === 0) {
        // Official RESUME_FROM_SESSION hydrate densable (xit + env + url/sdkUrl).
        // When source session loads messages, use them instead of empty startup.
        try {
          const {
            shouldAttemptResumeFromSessionHydrate,
            hydrateMessagesFromResumeSourceSession,
          } = await import('src/utils/resumeFromSessionHydrate.js')
          const attempt = shouldAttemptResumeFromSessionHydrate({
            isUrl: parsedSessionId.isUrl,
            sdkUrl: options.sdkUrl,
          })
          if (attempt.attempt) {
            const { prepareApiRequest } = await import(
              'src/utils/teleport/api.js'
            )
            const { teleportFromSessionsAPI } = await import(
              'src/utils/teleport.js'
            )
            const { deserializeMessages } = await import(
              'src/utils/conversationRecovery.js'
            )
            const hydrated = await hydrateMessagesFromResumeSourceSession(
              attempt.sourceSessionId,
              {
                prepareApiRequest,
                teleportFromSessionsAPI: async (sid, org, token) => {
                  const res = await teleportFromSessionsAPI(sid, org, token)
                  return { log: res.log as Message[] }
                },
                deserializeMessages: msgs =>
                  deserializeMessages(msgs as Message[]),
                log: msg => logForDebugging(msg),
              },
            )
            if (hydrated.length > 0) {
              return {
                messages: hydrated,
                planModeOnResume: applyPrintPlanModeResume(
                  setAppState,
                  restored,
                  options,
                ),
              }
            }
          }
        } catch {
          // Best-effort densable — fall through to empty/error paths.
        }
        // For URL-based or CCR v2 resume, start with empty session (it was hydrated but empty)
        if (parsedSessionId.isUrl || useCcrV2) {
          // Execute SessionStart hooks for startup since we're starting a new session
          return {
            messages: await (options.sessionStartHooksPromise ??
              processSessionStartHooks('startup')),
            planModeOnResume: applyPrintPlanModeResume(
              setAppState,
              restored,
              options,
            ),
          }
        } else {
          emitLoadError(
            `No conversation found with session ID: ${parsedSessionId.sessionId}`,
            options.outputFormat,
          )
          gracefulShutdownSync(1)
          return { messages: [] }
        }
      }

      // Handle resumeSessionAt feature
      if (options.resumeSessionAt) {
        const index = result.messages.findIndex(
          m => m.uuid === options.resumeSessionAt,
        )
        if (index < 0) {
          emitLoadError(
            `No message found with message.uuid of: ${options.resumeSessionAt}`,
            options.outputFormat,
          )
          gracefulShutdownSync(1)
          return { messages: [] }
        }

        result.messages = index >= 0 ? result.messages.slice(0, index + 1) : []
      }

      // Match coordinator mode to the resumed session's mode.
      // Incomplete lazy module → sync env without matchSessionMode.
      if (feature('COORDINATOR_MODE')) {
        const coordinatorMod = getCoordinatorModeModule()
        const warning = coordinatorMod
          ? coordinatorMod.matchSessionMode(result.mode)
          : syncCoordinatorModeEnvFromSession(result.mode)
        if (warning) {
          process.stderr.write(warning + '\n')
          // Refresh agent definitions to reflect the mode switch
          const { getAgentDefinitionsWithOverrides, getActiveAgentsFromList } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js') as typeof import('@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js')
          getAgentDefinitionsWithOverrides.cache.clear?.()
          const freshAgentDefs = await getAgentDefinitionsWithOverrides(
            getCwd(),
          )

          setAppState(prev => ({
            ...prev,
            agentDefinitions: {
              ...freshAgentDefs,
              allAgents: freshAgentDefs.allAgents,
              activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
            },
          }))
        }
      }

      // Reuse the resumed session's ID
      if (!options.forkSession && result.sessionId) {
        switchSession(
          asSessionId(result.sessionId),
          result.fullPath ? dirname(result.fullPath) : null,
          'resume',
        )
        if (persistSession) {
          await resetSessionFilePointer()
        }
      }
      restoreSessionStateFromLog(result, setAppState)
      const planModeOnResume = applyPrintPlanModeResume(
        setAppState,
        restored,
        options,
        result.messages,
      )

      // Restore session metadata so it's re-appended on exit via reAppendSessionMetadata
      restoreSessionMetadata(
        options.forkSession
          ? { ...result, worktreeSession: undefined }
          : result,
      )

      // densable e_t(worktreeSession) + E$e: print/SDK --resume rehydrate
      // worktree session for ExitWorktree (#21).
      if (!options.forkSession) {
        try {
          restoreWorktreeForResume(result.worktreeSession)
          if (result.worktreeSession && SandboxManager.isSandboxingEnabled()) {
            SandboxManager.refreshConfig()
          }
        } catch (error) {
          logError(error)
        }
        if (persistSession && result.sessionId) {
          adoptResumedSessionFile()
        }
      }

      // Write mode entry for the resumed session — align sessionRestore:
      // result.mode ?? env; do not skip when coordinator module is null.
      if (feature('COORDINATOR_MODE')) {
        const { isCoordinatorModeEnvEnabled } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
        saveMode(
          result.mode ??
            (isCoordinatorModeEnvEnabled() ? 'coordinator' : 'normal'),
        )
      }

      // Official 2.1.325 #2316: reconcile Code Mode state on --resume and
      // skip auto-resuming an interrupted turn when the session ended mid-script.
      const resumeCodeModePlan = planCodeModeFromSession({
        replMode: (result as { replMode?: boolean }).replMode,
        sessionId: result.sessionId ?? getSessionId(),
        headless: true,
        withinSession: false,
        source: 'store',
        messages: result.messages,
      })
      if (resumeCodeModePlan.refused) {
        emitLoadError(resumeCodeModePlan.refused, options.outputFormat)
        gracefulShutdownSync(1)
        return { messages: [] }
      }
      applyCodeModePlan(resumeCodeModePlan)

      return {
        messages: result.messages,
        turnInterruptionState: result.turnInterruptionState,
        agentSetting: result.agentSetting,
        planModeOnResume,
        deferredToolUse: result.deferredToolUse,
        overdueSessionStartHooks: result.overdueSessionStartHooks,
        ...(resumeCodeModePlan.waitForNextPrompt
          ? { codeModeWaitForNextPrompt: true }
          : {}),
        ...(resumeCodeModePlan.switched ? { codeModeSwitched: true } : {}),
      }
    } catch (error) {
      logError(error)
      const errorMessage =
        error instanceof Error
          ? `Failed to resume session: ${error.message}`
          : 'Failed to resume session with --print mode'
      emitLoadError(errorMessage, options.outputFormat)
      gracefulShutdownSync(1)
      return { messages: [] }
    }
  }

  // Join the SessionStart hooks promise kicked in main.tsx (or run fresh if
  // it wasn't kicked — e.g. --continue with no prior session falls through
  // here with sessionStartHooksPromise undefined because main.tsx guards on continue)
  return {
    messages: await (options.sessionStartHooksPromise ??
      processSessionStartHooks('startup')),
  }
}

function createHeadlessSep2663Binding(
  meta: Sep2663TaskSidecarMeta,
  getMcpClients: () => readonly MCPServerConnection[],
): RestoredMcpTaskBinding | undefined {
  const server = getMcpClients().find(
    c => c.type === 'connected' && c.name === meta.serverName,
  )
  if (!server || server.type !== 'connected') {
    return undefined
  }
  const rawClient = server.client as unknown as {
    request: (
      req: { method: string; params?: Record<string, unknown> },
      opts?: { signal?: AbortSignal },
    ) => Promise<Record<string, unknown>>
  }
  const intervalMs = Math.max(50, meta.pollIntervalMs ?? 2000)
  return {
    async pollToCompletion(signal: AbortSignal) {
      while (!signal.aborted) {
        if (
          meta.ttlExpiresAt !== undefined &&
          Date.now() >= meta.ttlExpiresAt
        ) {
          return {
            status: 'failed' as const,
            statusMessage: `MCP task ${meta.mcpTaskId} expired before completion`,
          }
        }
        const statusRes = await rawClient.request(
          {
            method: 'tasks/get',
            params: { taskId: meta.mcpTaskId },
          },
          { signal },
        )
        const st = String(statusRes?.status ?? '')
        if (st === 'completed') {
          const resultRes = await rawClient.request(
            {
              method: 'tasks/result',
              params: { taskId: meta.mcpTaskId },
            },
            { signal },
          )
          const content = Array.isArray(resultRes?.content)
            ? (resultRes.content as Array<{ type?: string; text?: string }>)
            : []
          const textParts = content
            .filter(
              (b): b is { type: 'text'; text: string } =>
                b?.type === 'text' && typeof b.text === 'string',
            )
            .map(b => b.text)
          return {
            status: 'completed' as const,
            resultText: textParts.length > 0 ? textParts.join('\n') : undefined,
            statusMessage:
              typeof statusRes?.statusMessage === 'string'
                ? statusRes.statusMessage
                : undefined,
          }
        }
        if (st === 'failed' || st === 'cancelled') {
          return {
            status: 'failed' as const,
            statusMessage:
              typeof statusRes?.statusMessage === 'string'
                ? statusRes.statusMessage
                : `MCP task ${meta.mcpTaskId} ${st}`,
          }
        }
        await new Promise<void>(resolve => {
          if (signal.aborted) {
            resolve()
            return
          }
          const onAbort = () => {
            clearTimeout(timer)
            resolve()
          }
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          }, intervalMs)
          timer.unref?.()
          signal.addEventListener('abort', onAbort, { once: true })
        })
      }
      return {
        status: 'failed' as const,
        statusMessage: 'MCP task polling aborted',
      }
    },
  }
}

/**
 * Official 2.1.325 #1717: headless `--resume` / `--continue` restoration for
 * persisted SEP-2663 MCP task sidecars.
 */
export async function restoreHeadlessSep2663Tasks(params: {
  sessionId: string
  projectDir?: string
  setAppState: (f: (prevState: AppState) => AppState) => void
  getMcpClients: () => readonly MCPServerConnection[]
  bindingFactory?: (
    meta: Sep2663TaskSidecarMeta,
  ) =>
    | RestoredMcpTaskBinding
    | Promise<RestoredMcpTaskBinding | undefined>
    | undefined
  onNotify?: (notification: {
    taskId: string
    serverName: string
    toolName: string
    status: 'completed' | 'failed'
    resultText?: string
    statusMessage?: string
  }) => void
}): Promise<{ restoredTaskIds: string[]; skippedTaskIds: string[] }> {
  const metas = await readPersistedSep2663TaskMetas(
    params.sessionId,
    params.projectDir,
  )
  if (metas.length === 0) {
    return { restoredTaskIds: [], skippedTaskIds: [] }
  }
  const sep2663Metas = metas.filter(m => m.protocol === 'sep2663')
  const skippedLegacy = metas
    .filter(m => m.protocol !== 'sep2663')
    .map(m => m.taskId)
  if (sep2663Metas.length === 0) {
    return { restoredTaskIds: [], skippedTaskIds: skippedLegacy }
  }
  const res = await restoreSep2663Tasks({
    metas: sep2663Metas,
    setAppState: params.setAppState,
    sidecarSessionId: params.sessionId,
    sidecarProjectDir: params.projectDir,
    bindingFactory:
      params.bindingFactory ??
      (meta => createHeadlessSep2663Binding(meta, params.getMcpClients)),
    onNotify:
      params.onNotify ??
      (n => {
        const summary =
          n.status === 'completed'
            ? `MCP task ${n.serverName}/${n.toolName} completed`
            : `MCP task ${n.serverName}/${n.toolName} failed`
        const body = n.resultText ?? n.statusMessage ?? ''
        const xml = `<task-notification>\n<task-id>${n.taskId}</task-id>\n<status>${n.status}</status>\n<summary>${summary}</summary>${body ? `\n<result>${body}</result>` : ''}\n</task-notification>`
        enqueuePendingNotification({
          value: xml,
          mode: 'task-notification',
        })
      }),
  })
  return {
    restoredTaskIds: res.restoredTaskIds,
    skippedTaskIds: [...skippedLegacy, ...res.skippedTaskIds],
  }
}

export function getStructuredIO(
  inputPrompt: string | AsyncIterable<string>,
  options: {
    sdkUrl: string | undefined
    replayUserMessages?: boolean
  },
): StructuredIO {
  let inputStream: AsyncIterable<string>
  if (typeof inputPrompt === 'string') {
    if (inputPrompt.trim() !== '') {
      // Normalize to a streaming input.
      inputStream = fromArray([
        jsonStringify({
          type: 'user',
          content: inputPrompt,
          uuid: '',
          session_id: '',
          message: {
            role: 'user',
            content: inputPrompt,
          },
          parent_tool_use_id: null,
        } satisfies SDKUserMessage),
      ])
    } else {
      // Empty string - create empty stream
      inputStream = fromArray([])
    }
  } else {
    inputStream = inputPrompt
  }

  // Use RemoteIO if sdkUrl is provided, otherwise use regular StructuredIO
  return options.sdkUrl
    ? new RemoteIO(options.sdkUrl, inputStream, options.replayUserMessages)
    : new StructuredIO(inputStream, options.replayUserMessages)
}
