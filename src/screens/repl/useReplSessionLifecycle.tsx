import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { feature } from 'bun:bundle';
import type { UUID } from 'crypto';
import { dirname } from 'path';
import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import {
  getOriginalCwd,
  getSessionId,
  setCostStateForRestore,
  setOriginalCwd,
  switchSession,
} from '../../bootstrap/state.js';
import type { ResumeEntrypoint } from '../../commands.js';
import { openColdResumeQuotaIfNeeded } from '../../components/ColdResumeQuotaDialog.js';
import { ExitFlow } from '../../components/ExitFlow.js';
import type { Notification } from '../../context/notifications.js';
import { getStoredSessionCosts, resetCostState, saveCurrentSessionCosts } from '../../cost-tracker.js';
import type { DialogStore, RequestDialog } from '../../dialog/index.js';
import { openResumeReturnIfNeeded } from '../../dialog/index.js';
import {
  applyCodeModePlan,
  type didSessionEndDuringCodeModeScript,
  endMainThreadConversation,
  mergeCodeModeReplySideEffects,
  planCodeModeFromSession,
  shouldAutoStartCodeModeTurnAfterCommand,
} from '../../services/codeMode/executor.js';
import { REPL_MAIN_THREAD_KEY } from '../../services/codeMode/constants.js';
import { getReplSessions } from '../../services/codeMode/replSessions.js';
import type { AppState } from '../../state/AppStateStore.js';
import type { Store } from '../../state/store.js';
import { restoreRemoteAgentTasks } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js';
import type { TaskState } from '../../tasks/types.js';
import { asSessionId } from '../../types/ids.js';
import type { LogOption } from '../../types/logs.js';
import type { Message as MessageType } from '../../types/message.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { countUserPromptsInMessages } from '../../utils/attribution.js';
import { clearHeldClearedDraft } from '../../utils/clearedDraftHold.js';
import { isBgSession, updateSessionName } from '../../utils/concurrentSessions.js';
import type { PastedContent } from '../../utils/config.js';
import { deserializeMessagesWithInterruptDetection } from '../../utils/conversationRecovery.js';
import { getCwd } from '../../utils/cwd.js';
import { logForDebugging } from '../../utils/debug.js';
import { listExitBackgroundItems } from '../../utils/exitBackgroundItems.js';
import { exitPromptShutdown } from '../../utils/exitPromptShutdown.js';
import { copyFileHistoryForResume } from '../../utils/fileHistory.js';
import type { FileStateCache } from '../../utils/fileStateCache.js';
import { executeSessionEndHooks, getSessionEndHooksBoundMs, getSessionEndHookTimeoutMs } from '../../utils/hooks.js';
import { formatOutsideReplHookFailures } from '../../utils/hooks/hookErrorDisplay.js';
import type { MessageQueueInstance, SetAppState } from '../../utils/messageQueueManager.js';
import { createSystemMessage, createUserMessage } from '../../utils/messages.js';
import { copyPlanForFork, copyPlanForResume } from '../../utils/plans.js';
import { ensurePluginAgentLoadedForResume, mergeCliAgentsIntoDefinitions } from '../../utils/plugins/refresh.js';
import type { QueryGuard } from '../../utils/QueryGuard.js';
import { setCwd } from '../../utils/Shell.js';
import {
  computeStandaloneAgentContext,
  exitRestoredWorktree,
  restoreAgentFromSession,
  restoreSessionStateFromLog,
  restoreWorktreeForResume,
} from '../../utils/sessionRestore.js';
import { processSessionStartHooks, takeInitialUserMessage } from '../../utils/sessionStart.js';
import {
  adoptResumedSessionFile,
  clearSessionMetadata,
  createMissingEarlierMessagesWarning,
  hasMissingEarlierMessages,
  resetSessionFilePointer,
  restoreSessionMetadata,
  saveWorktreeState,
  stripUnresumedInterruptedMessages,
} from '../../utils/sessionStorage.js';
import { resetTeamLeadVerificationOnSessionBoundary } from '../../utils/teammateMailbox.js';
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js';
import { type ContentReplacementState, reconstructContentReplacementState } from '../../utils/toolResultStorage.js';
import { getCurrentWorktreeSession, resolveWorktreeExitTargetDir } from '../../utils/worktree.js';
import { extractResumedDanglingReplToolUseIds, extractResumedToolUseIds } from './replHelpers.js';
import type { InFlightTitleRequest, TitleFallback } from './runReplTurn.js';
import type { DeferredAdoptResumeRefs, PkeState, SetToolJSXArgs } from './types.js';

/**
 * Manages REPL session lifecycle transitions: `/resume` & `/branch` (`resume`),
 * resume-return / cold-resume quota dialogs (`offerResumeReturnIfNeeded`),
 * and interactive exit / bg detach (`handleExit`).
 */
export function useReplSessionLifecycle(params: {
  store: Store<AppState>;
  setAppState: SetAppState;
  requestDialog: RequestDialog;
  dialogStore: DialogStore;
  messageQueue: MessageQueueInstance;
  queryGuard: QueryGuard;
  messagesRef: React.RefObject<MessageType[]>;
  initialMessages: MessageType[] | undefined;
  initialMessage: AppState['initialMessage'];
  initialMainThreadAgentDefinition: AgentDefinition | undefined;
  mainThreadAgentDefinition: AgentDefinition | undefined;
  setMainThreadAgentDefinition: React.Dispatch<React.SetStateAction<AgentDefinition | undefined>>;
  mainLoopModel: string;
  addNotification: (notif: Notification) => void;
  setMessages: (action: React.SetStateAction<MessageType[]>) => void;
  setSubmitCount: React.Dispatch<React.SetStateAction<number>>;
  setToolJSX: (args: SetToolJSXArgs) => void;
  setInputValue: (value: string) => void;
  setPastedContents: React.Dispatch<React.SetStateAction<Record<number, PastedContent>>>;
  setConversationId: React.Dispatch<React.SetStateAction<string>>;
  setAbortController: (ac: AbortController | null) => void;
  resetLoadingState: () => void;
  repinScroll: (force?: boolean, reason?: string) => void;
  restoreReadFileState: (messages: MessageType[], cwd: string) => void;
  readFileState: React.RefObject<FileStateCache>;
  bashTools: React.RefObject<Set<string>>;
  bashHosts: React.RefObject<Set<string>>;
  bashToolsProcessedIdx: React.RefObject<number>;
  fileHistoryCopyPromiseRef: React.RefObject<Promise<void> | null>;
  haikuTitleAttemptedRef: React.RefObject<boolean>;
  titleFallbackRef: React.RefObject<TitleFallback | undefined>;
  titleRequestRef: React.RefObject<InFlightTitleRequest | null>;
  setHaikuTitle: React.Dispatch<React.SetStateAction<string | undefined>>;
  contentReplacementStateRef: { current: ContentReplacementState | undefined };
  deferredResumeRefs: React.RefObject<DeferredAdoptResumeRefs>;
  codeModeAutoBackgroundEligibleRef: React.RefObject<boolean>;
  codeModeInterruptedByEscRef: React.RefObject<boolean>;
  resumeReturnCompactRef: React.RefObject<() => void>;
  resumeReturnClearRef: React.RefObject<() => void>;
  setPke: React.Dispatch<React.SetStateAction<PkeState>>;
}): {
  offerResumeReturnIfNeeded: (msgs: readonly MessageType[]) => void;
  resume: (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => Promise<void>;
  handleExit: () => Promise<void>;
} {
  const {
    store,
    setAppState,
    requestDialog,
    dialogStore,
    messageQueue,
    queryGuard,
    messagesRef,
    initialMessages,
    initialMessage,
    initialMainThreadAgentDefinition,
    mainThreadAgentDefinition,
    setMainThreadAgentDefinition,
    mainLoopModel,
    addNotification,
    setMessages,
    setSubmitCount,
    setToolJSX,
    setInputValue,
    setPastedContents,
    setConversationId,
    setAbortController,
    resetLoadingState,
    repinScroll,
    restoreReadFileState,
    readFileState,
    bashTools,
    bashHosts,
    bashToolsProcessedIdx,
    fileHistoryCopyPromiseRef,
    haikuTitleAttemptedRef,
    titleFallbackRef,
    titleRequestRef,
    setHaikuTitle,
    contentReplacementStateRef,
    deferredResumeRefs,
    codeModeAutoBackgroundEligibleRef,
    codeModeInterruptedByEscRef,
    resumeReturnCompactRef,
    resumeReturnClearRef,
    setPke,
  } = params;

  const offerResumeReturnIfNeeded = useCallback(
    (msgs: readonly MessageType[]) => {
      void (async () => {
        const coldResult = await openColdResumeQuotaIfNeeded({
          requestDialog,
          dialogStore,
          messages: msgs,
          model: String(store.getState().mainLoopModel ?? ''),
          trigger: 'resume',
          estimateTokens: estimateMsgs => tokenCountFromLastAPIResponse(estimateMsgs as MessageType[]),
          startNewConversation: () => resumeReturnClearRef.current(),
          resumeFromSummary: () => resumeReturnCompactRef.current(),
        });
        if (coldResult !== 'skipped') return;
        await openResumeReturnIfNeeded({
          requestDialog,
          dialogStore,
          messages: msgs,
          estimateTokens: estimateMsgs => tokenCountFromLastAPIResponse(estimateMsgs as MessageType[]),
          runCompact: () => resumeReturnCompactRef.current(),
        });
      })();
    },
    [requestDialog, dialogStore, store, resumeReturnClearRef, resumeReturnCompactRef],
  );

  // densable iXg(Gm, Gxt) — after session load, not picker intercept.
  const resumeReturnOfferedRef = useRef(false);
  useEffect(() => {
    if (resumeReturnOfferedRef.current) return;
    if ((initialMessages?.length ?? 0) === 0) return;
    if (initialMessage !== null) {
      resumeReturnOfferedRef.current = true;
      return;
    }
    resumeReturnOfferedRef.current = true;
    offerResumeReturnIfNeeded(initialMessages ?? []);
  }, [initialMessages, initialMessage, offerResumeReturnIfNeeded]);

  const resume = useCallback(
    async (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => {
      const resumeStart = performance.now();
      const prevSessionId = getSessionId();
      try {
        const codeModePlan = planCodeModeFromSession(
          {
            replMode: (log as { replMode?: boolean }).replMode,
            sessionId,
            withinSession: true,
            source: 'store',
            permissionMode: store.getState().toolPermissionContext.mode,
            messages: log.messages as unknown as Parameters<typeof didSessionEndDuringCodeModeScript>[0],
          },
          notice => {
            addNotification({
              key: 'code-mode-resume-notice',
              priority: 'medium',
              wrap: true,
              text: notice,
            });
          },
        );
        if (codeModePlan.refused) {
          addNotification({
            key: 'code-mode-resume-refused',
            kind: 'warning',
            priority: 'immediate',
            wrap: true,
            color: 'warning',
            text: codeModePlan.refused,
          });
          throw new Error(codeModePlan.refused);
        }
        applyCodeModePlan(codeModePlan);
        codeModeAutoBackgroundEligibleRef.current = codeModePlan.autoBackgroundEligible === true;
        const waitForNextPromptAfterCodeModeResume =
          codeModePlan.waitForNextPrompt === true ||
          !shouldAutoStartCodeModeTurnAfterCommand({
            interruptedByEsc: codeModeInterruptedByEscRef.current,
            commandName: 'resume',
            isLocalCommand: true,
          });
        if (codeModePlan.interruptedScriptNotice) {
          addNotification({
            key: 'code-mode-interrupted-script',
            kind: 'warning',
            priority: 'medium',
            wrap: true,
            color: 'warning',
            text: codeModePlan.interruptedScriptNotice,
          });
        }
        if (waitForNextPromptAfterCodeModeResume) {
          logForDebugging(
            '[resume] Code Mode session ended during a script — skipping auto-continue and waiting for next prompt',
          );
          setAppState(prev => (prev.initialMessage ? { ...prev, initialMessage: null } : prev));
        }

        const { messages, turnInterruptionState } = deserializeMessagesWithInterruptDetection(log.messages);
        const logTranscriptEntries = log.messages as unknown as Parameters<typeof hasMissingEarlierMessages>[0];
        const logTranscriptMap = new Map(
          logTranscriptEntries
            .filter(entry => typeof entry?.uuid === 'string')
            .map(entry => [entry.uuid, entry] as const),
        );
        if (hasMissingEarlierMessages(logTranscriptEntries, logTranscriptMap)) {
          const warningEntry = createMissingEarlierMessagesWarning();
          messages.unshift(createSystemMessage(warningEntry.content, 'warning'));
        }
        if (codeModePlan.interruptedScriptNotice) {
          const mergedSideEffects = mergeCodeModeReplySideEffects([
            {
              toolUseId: 'resume',
              hookContexts: [codeModePlan.interruptedScriptNotice],
            },
          ]);
          for (const ctxNote of mergedSideEffects.hookContexts) {
            messages.push(createSystemMessage(ctxNote, 'warning'));
          }
        }
        if (turnInterruptionState.kind === 'interrupted_prompt') {
          stripUnresumedInterruptedMessages(messages, turnInterruptionState);
        }

        if (entrypoint !== 'fork') {
          const resumedToolUseIds = extractResumedToolUseIds(messages);
          getReplSessions().bringBackRewound(REPL_MAIN_THREAD_KEY, resumedToolUseIds);
          if (sessionId !== prevSessionId) {
            const keepToolUseIds = extractResumedDanglingReplToolUseIds(messages);
            endMainThreadConversation('another conversation was resumed', keepToolUseIds, {
              removeByFilter: predicate =>
                messageQueue.removeByFilter(cmd =>
                  predicate(cmd as unknown as Parameters<typeof predicate>[0]),
                ) as unknown as ReturnType<
                  NonNullable<Parameters<typeof endMainThreadConversation>[2]>['removeByFilter']
                >,
            });
          }
        }

        if (feature('COORDINATOR_MODE')) {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const coordinatorModule =
            require('../../coordinator/coordinatorMode.js') as typeof import('../../coordinator/coordinatorMode.js');
          const { syncCoordinatorModeEnvFromSession } =
            require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js');
          /* eslint-enable @typescript-eslint/no-require-imports */
          const warning =
            typeof coordinatorModule?.matchSessionMode === 'function'
              ? coordinatorModule.matchSessionMode(log.mode)
              : syncCoordinatorModeEnvFromSession(log.mode);
          if (warning) {
            /* eslint-disable @typescript-eslint/no-require-imports */
            const { getAgentDefinitionsWithOverrides, getActiveAgentsFromList } =
              require('@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js') as typeof import('@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js');
            /* eslint-enable @typescript-eslint/no-require-imports */
            getAgentDefinitionsWithOverrides.cache.clear?.();
            const freshAgentDefs = await getAgentDefinitionsWithOverrides(getOriginalCwd());

            setAppState(prev => {
              const cliAgents = prev.agentDefinitions.allAgents.filter(a => a.source === 'flagSettings');
              const mergedDefs = mergeCliAgentsIntoDefinitions(
                {
                  ...freshAgentDefs,
                  allAgents: freshAgentDefs.allAgents,
                  activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
                },
                cliAgents,
              );
              return {
                ...prev,
                agentDefinitions: mergedDefs,
              };
            });
            messages.push(createSystemMessage(warning, 'warning'));
          }
        }

        const sessionEndTimeoutMs = getSessionEndHookTimeoutMs();
        const sessionEndBoundMs = getSessionEndHooksBoundMs();
        try {
          await executeSessionEndHooks('resume', {
            getAppState: () => store.getState(),
            setAppState,
            signal: AbortSignal.timeout(sessionEndBoundMs),
            timeoutMs: sessionEndTimeoutMs,
          });
        } catch (sessionEndError) {
          const formatted = formatOutsideReplHookFailures('SessionEnd', [
            {
              command: 'SessionEnd',
              succeeded: false,
              output: sessionEndError instanceof Error ? sessionEndError.message : String(sessionEndError),
            },
          ]);
          for (const errText of formatted) {
            addNotification({
              key: 'session-end-hook-error',
              text: errText,
              color: 'error',
              priority: 'high',
            });
          }
        }

        const hookMessages = await processSessionStartHooks(entrypoint === 'fork' ? 'fork' : 'resume', {
          sessionId,
          agentType: mainThreadAgentDefinition?.agentType,
          model: mainLoopModel,
          messages,
        });

        messages.push(...hookMessages);
        const initialUserMessage = takeInitialUserMessage();
        if (initialUserMessage && !waitForNextPromptAfterCodeModeResume) {
          messages.push(
            createUserMessage({
              content: initialUserMessage,
            }),
          );
        }
        if (entrypoint === 'fork') {
          void copyPlanForFork(log, asSessionId(sessionId));
        } else {
          void copyPlanForResume(log, asSessionId(sessionId));
        }

        const effectiveAgentDefinitions = await ensurePluginAgentLoadedForResume({
          resumedAgentName: log.agentSetting,
          mainThreadAgentDefinition: initialMainThreadAgentDefinition,
          agentDefinitions: store.getState().agentDefinitions,
          cwd: log.projectPath ?? getOriginalCwd(),
        });
        if (effectiveAgentDefinitions !== store.getState().agentDefinitions) {
          setAppState(prev => ({
            ...prev,
            agentDefinitions: effectiveAgentDefinitions,
          }));
        }

        const { agentDefinition: restoredAgent } = restoreAgentFromSession(
          log.agentSetting,
          initialMainThreadAgentDefinition,
          effectiveAgentDefinitions,
        );
        setMainThreadAgentDefinition(restoredAgent);
        setAppState(prev => ({ ...prev, agent: restoredAgent?.agentType }));

        setAppState(prev => ({
          ...prev,
          standaloneAgentContext: computeStandaloneAgentContext(
            log.agentName,
            log.agentColor,
            prev.standaloneAgentContext?.prideGradient,
          ),
        }));
        void updateSessionName(log.agentName);

        if (entrypoint !== 'fork') {
          readFileState.current.clear();
          bashTools.current.clear();
          bashHosts.current.clear();
          bashToolsProcessedIdx.current = 0;
        }

        restoreReadFileState(messages, log.projectPath ?? getOriginalCwd());

        resetLoadingState();
        setAbortController(null);

        setConversationId(sessionId);

        const targetSessionCosts = getStoredSessionCosts(sessionId);
        saveCurrentSessionCosts();
        resetCostState();

        switchSession(
          asSessionId(sessionId),
          log.fullPath ? dirname(log.fullPath) : null,
          entrypoint === 'fork' ? 'fork' : 'resume',
        );
        resetTeamLeadVerificationOnSessionBoundary();
        if (log.fileHistorySnapshots) {
          const copyPromise = copyFileHistoryForResume(log).finally(() => {
            if (fileHistoryCopyPromiseRef.current === copyPromise) {
              fileHistoryCopyPromiseRef.current = null;
            }
          });
          fileHistoryCopyPromiseRef.current = copyPromise;
          void copyPromise;
        }
        const { renameRecordingForSession } = await import('../../utils/asciicast.js');
        await renameRecordingForSession();
        await resetSessionFilePointer();
        if (isAgentSwarmsEnabled()) {
          const { rekeySessionTeamInSession } = await import('../../utils/swarm/sessionTeam.js');
          const rekeyedTeam = await rekeySessionTeamInSession();
          if (rekeyedTeam) {
            setAppState(prev => ({
              ...prev,
              teamContext: rekeyedTeam.teamContext,
            }));
          }
        }

        const { takeRestoredWorkerForPlanResume, preparePlanModeRestoreOnInteractiveResume } =
          require('../../utils/permissions/planModeResume.js') as typeof import('../../utils/permissions/planModeResume.js');
        restoreSessionStateFromLog(log, setAppState, {
          applyPlanModeResume: true,
          restoredWorker: takeRestoredWorkerForPlanResume(),
          forkSession: entrypoint === 'fork',
          planModeResumeLane: 'interactive',
        });
        const applyInteractivePlanModeRestore = await preparePlanModeRestoreOnInteractiveResume({
          storedPermissionMode: log.permissionMode,
          messages: log.messages as import('../../utils/permissions/planModeResume.js').TranscriptPlanScanMessage[],
          forkSession: entrypoint === 'fork',
          permissionModeSuppliedOnInvocation: false,
          lane: 'interactive_slash',
        });
        setAppState(prev => {
          const nextCtx = applyInteractivePlanModeRestore(prev.toolPermissionContext);
          return nextCtx ? { ...prev, toolPermissionContext: nextCtx } : prev;
        });

        clearSessionMetadata();
        restoreSessionMetadata(log);

        haikuTitleAttemptedRef.current = true;
        titleFallbackRef.current = undefined;
        if (titleRequestRef.current) {
          if (!titleRequestRef.current.abortController.signal.aborted) {
            titleRequestRef.current.abortController.abort('session_resume');
          }
          titleRequestRef.current = null;
        }
        setHaikuTitle(undefined);

        if (entrypoint !== 'fork') {
          const prevWorktree = getCurrentWorktreeSession();
          exitRestoredWorktree();
          if (prevWorktree) {
            const { targetDir, fellBackFromDeletedOriginalCwd } = resolveWorktreeExitTargetDir(prevWorktree);
            if (fellBackFromDeletedOriginalCwd) {
              try {
                process.chdir(targetDir);
                setCwd(targetDir);
                setOriginalCwd(getCwd());
              } catch {
                // Best-effort fallback when originalCwd was deleted
              }
            }
          }
          restoreWorktreeForResume(log.worktreeSession);
          adoptResumedSessionFile();
          void restoreRemoteAgentTasks({
            abortController: new AbortController(),
            getAppState: () => store.getState(),
            setAppState,
          });
        } else {
          const ws = getCurrentWorktreeSession();
          if (ws) saveWorktreeState(ws);
        }

        if (feature('COORDINATOR_MODE')) {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const { saveMode } = require('../../utils/sessionStorage.js');
          const { isCoordinatorModeEnvEnabled } =
            require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js');
          /* eslint-enable @typescript-eslint/no-require-imports */
          saveMode(log.mode ?? (isCoordinatorModeEnvEnabled() ? 'coordinator' : 'normal'));
        }

        if (targetSessionCosts) {
          setCostStateForRestore(targetSessionCosts);
        }

        if (contentReplacementStateRef.current && entrypoint !== 'fork') {
          contentReplacementStateRef.current = reconstructContentReplacementState(
            messages,
            log.contentReplacements ?? [],
          );
        }

        setMessages(() => messages);
        setSubmitCount(countUserPromptsInMessages(messages));

        setToolJSX({ jsx: null, shouldHidePromptInput: false, clearLocalJSX: true });
        repinScroll(true, 'session-resume');

        if (entrypoint !== 'fork') {
          setInputValue('');
          setPastedContents({});
          clearHeldClearedDraft();
        }
        if (feature('BRIDGE_MODE')) {
          if (entrypoint !== 'fork' && log.bridgeSessionId) {
            setAppState(prev => {
              if (prev.replBridgeEnabled && !prev.replBridgeOutboundOnly) return prev;
              return {
                ...prev,
                replBridgeEnabled: true,
                replBridgeOutboundOnly: false,
              };
            });
          }
        }
        if (entrypoint !== 'fork' && !waitForNextPromptAfterCodeModeResume) {
          try {
            const { runOrphanAgentResumePass } = await import('../../utils/orphanAgentResume.js');
            const liveIds = new Set<string>();
            const liveTaskIds = new Set<string>();
            try {
              const tasksSnap = store.getState().tasks ?? {};
              for (const t of Object.values(tasksSnap) as Array<{
                type?: string;
                agentId?: string;
                id?: string;
              }>) {
                if (typeof t?.id === 'string') liveTaskIds.add(t.id);
                if (t?.type === 'local_agent') {
                  if (typeof t.agentId === 'string') liveIds.add(t.agentId);
                  if (typeof t.id === 'string') liveIds.add(t.id);
                }
              }
            } catch {
              /* ignore */
            }
            void runOrphanAgentResumePass({
              messages: messages as never,
              liveAgentIds: liveIds,
              liveTaskIds,
              getState: () => store.getState(),
              subscribe: listener => store.subscribe(listener),
              resumeAgent: async entry => {
                const resumeFn = deferredResumeRefs.current.resumeAgentBackground;
                const ctx = deferredResumeRefs.current.getToolUseContext;
                const can = deferredResumeRefs.current.canUseTool;
                const model = deferredResumeRefs.current.mainLoopModel;
                if (!resumeFn || !ctx || !can || !model) {
                  throw new Error('resume agent context not ready');
                }
                const r = await resumeFn({
                  agentId: entry.agentId,
                  prompt: entry.description ?? '(resumed agent)',
                  toolUseContext: ctx(messages, [], new AbortController(), model) as never,
                  canUseTool: can,
                  continueInterruptedTurn: true,
                });
                const rec =
                  r && typeof r === 'object'
                    ? (r as {
                        alreadyCompleted?: boolean;
                        outputFile?: string;
                      })
                    : undefined;
                return {
                  alreadyCompleted: rec?.alreadyCompleted === true,
                  outputFile: typeof rec?.outputFile === 'string' && rec.outputFile ? rec.outputFile : entry.outputFile,
                };
              },
            }).catch(() => {
              /* best-effort */
            });
          } catch {
            /* best-effort */
          }
        }

        if (entrypoint !== 'fork' && !waitForNextPromptAfterCodeModeResume) {
          offerResumeReturnIfNeeded(messages);
        }

        logEvent('tengu_session_resumed', {
          entrypoint: entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: true,
          resume_duration_ms: Math.round(performance.now() - resumeStart),
        });
      } catch (error) {
        logEvent('tengu_session_resumed', {
          entrypoint: entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: false,
        });
        throw error;
      }
    },
    [
      resetLoadingState,
      setAppState,
      offerResumeReturnIfNeeded,
      repinScroll,
      messageQueue,
      store,
      addNotification,
      mainThreadAgentDefinition,
      mainLoopModel,
      initialMainThreadAgentDefinition,
      setMainThreadAgentDefinition,
      restoreReadFileState,
      setAbortController,
      setConversationId,
      setMessages,
      setSubmitCount,
      setToolJSX,
      setInputValue,
      setPastedContents,
      setHaikuTitle,
      readFileState,
      bashTools,
      bashHosts,
      bashToolsProcessedIdx,
      fileHistoryCopyPromiseRef,
      haikuTitleAttemptedRef,
      titleFallbackRef,
      titleRequestRef,
      contentReplacementStateRef,
      deferredResumeRefs,
      codeModeAutoBackgroundEligibleRef,
      codeModeInterruptedByEscRef,
    ],
  );

  const handleExit = useCallback(async () => {
    if (feature('BG_SESSIONS')) {
      if (isBgSession()) {
        const hasConversationTurns = messagesRef.current.some(m => m.type === 'user' || m.type === 'assistant');
        const hasQueuedMessages = messageQueue.getMainThreadLength() > 0;
        const hasWorktree = getCurrentWorktreeSession() !== null;
        const hasBgItems =
          listExitBackgroundItems((store.getState().tasks ?? {}) as Record<string, TaskState>).length > 0;
        let isEmptyBgQuit = !hasConversationTurns && !hasQueuedMessages && !hasWorktree && !hasBgItems;
        const jobDir = process.env.CLAUDE_JOB_DIR;
        if (jobDir) {
          try {
            const { readBgJobState, writeBgJobState, isTerminalState } = await import('../../daemon/jobState.js');
            const short = jobDir.split('/').pop()!;
            const state = readBgJobState(short);
            if (state) {
              isEmptyBgQuit =
                isEmptyBgQuit &&
                !state.name &&
                !state.intent &&
                !state.worktreePath &&
                state.template === 'bg' &&
                !state.bridgeSessionId &&
                (state.inFlight?.tasks ?? 0) === 0 &&
                (state.inFlight?.queued ?? 0) === 0;
            }
            if (state && !isTerminalState(state)) {
              const now = new Date().toISOString();
              if (isEmptyBgQuit) {
                writeBgJobState(short, {
                  ...state,
                  state: 'stopped',
                  detail: 'empty-quit',
                  tempo: 'idle',
                  inFlight: undefined,
                  needs: undefined,
                  updatedAt: now,
                  firstTerminalAt: state.firstTerminalAt ?? now,
                });
              } else {
                writeBgJobState(short, {
                  ...state,
                  state: 'stopped',
                  detail: 'stopped from session',
                  tempo: 'idle',
                  inFlight: undefined,
                  needs: undefined,
                  updatedAt: now,
                  firstTerminalAt: state.firstTerminalAt ?? now,
                });
              }
            }
          } catch {}
        }
        const detachMsg = isEmptyBgQuit ? 'empty-quit' : 'Session stopped.';
        process.stdout.write(`\x1B_cc-detach-msg;${detachMsg}\x1B\\\x1B_cc-daemon-detach\x1B\\`);
        setPke({ kind: 'none' });
        return;
      }
    }
    const showWorktree = getCurrentWorktreeSession() !== null;
    const backgroundItems = listExitBackgroundItems((store.getState().tasks ?? {}) as Record<string, TaskState>);
    if (showWorktree || backgroundItems.length > 0) {
      const clearPke = () => setPke({ kind: 'none' });
      setPke({
        kind: 'dialog',
        node: (
          <ExitFlow
            showWorktree={showWorktree}
            backgroundItems={backgroundItems}
            messages={messagesRef.current as never}
            getMessages={() => messagesRef.current as never}
            getIsMidTurn={() => queryGuard.isActive}
            getIsResponseStreaming={() => queryGuard.isRunning}
            isMidTurn={queryGuard.isActive}
            onDone={() => {}}
            onCancel={clearPke}
            getTasks={() => store.getState().tasks as Record<string, unknown> | undefined}
          />
        ),
      });
      return;
    }
    setPke({ kind: 'shutting-down' });
    await exitPromptShutdown({
      messages: messagesRef.current,
      responseStreaming: queryGuard.isRunning,
    });
  }, [store, queryGuard, messageQueue, messagesRef, setPke]);

  return {
    offerResumeReturnIfNeeded,
    resume,
    handleExit,
  };
}
