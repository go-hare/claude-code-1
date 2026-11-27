import { Box } from '@anthropic/ink';
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js';
import * as React from 'react';
import { PluginHintMenu } from 'src/components/ClaudeCodeHint/PluginHintMenu.js';
import { DesktopUpsellStartup } from 'src/components/DesktopUpsell/DesktopUpsellStartup.js';
import { FeedbackDraftNotice } from 'src/components/FeedbackDraftNotice.js';
import { FeedbackSurvey } from 'src/components/FeedbackSurvey/FeedbackSurvey.js';
import type { useFeedbackSurvey } from 'src/components/FeedbackSurvey/useFeedbackSurvey.js';
import type { useFrustrationDetection } from 'src/components/FeedbackSurvey/useFrustrationDetection.js';
import type { useMemorySurvey } from 'src/components/FeedbackSurvey/useMemorySurvey.js';
import type { usePostCompactSurvey } from 'src/components/FeedbackSurvey/usePostCompactSurvey.js';
import { LspRecommendationMenu } from 'src/components/LspRecommendation/LspRecommendationMenu.js';
import { SandboxPermissionRequest } from 'src/components/permissions/SandboxPermissionRequest.js';
import { SearchExtraToolsHint } from 'src/components/SearchExtraToolsHint.js';
import type { useClaudeCodeHintRecommendation } from 'src/hooks/useClaudeCodeHintRecommendation.js';
import type { useLspPluginRecommendation } from 'src/hooks/useLspPluginRecommendation.js';
import type { useSearchExtraToolsHint } from 'src/hooks/useSearchExtraToolsHint.js';
import { logEvent } from 'src/services/analytics/index.js';
import { normalizeSandboxSessionHost, SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { launchUltraplan } from '../../commands/ultraplan.js';
import { DevBar } from '../../components/DevBar.js';
import { EffortCallout } from '../../components/EffortCallout.js';
import { FullscreenUpsellDialog } from '../../components/FullscreenUpsellDialog.js';
import { PromptDialog } from '../../components/hooks/PromptDialog.js';
import { LeftArrowConfirmDialog } from '../../components/LeftArrowConfirmDialog.js';
import { MessageSelector } from '../../components/MessageSelector.js';
import { ElicitationDialog } from '../../components/mcp/ElicitationDialog.js';
import type { MessageActionsState } from '../../components/messageActions.js';
import { MessageActionsBar } from '../../components/messageActions.js';
import {
  BORDER_MARK_INSET,
  chooseInlineRoom,
  keepPluginPaneRoom,
  PluginAbovePromptSite,
  PluginPaneSite,
  PluginRowGrip,
  pluginPaneInlineRows,
} from '../../components/PluginRasterPanes.js';
import { WorkerPendingPermission } from '../../components/permissions/WorkerPendingPermission.js';
import { LivePromptDraft } from '../../components/PromptInput/LivePromptDraft.js';
import { RemoteCallout } from '../../components/RemoteCallout.js';
import { SkillImprovementSurvey } from '../../components/SkillImprovementSurvey.js';
import { UltraplanChoiceDialog } from '../../components/ultraplan/UltraplanChoiceDialog.js';
import { UltraplanLaunchDialog } from '../../components/ultraplan/UltraplanLaunchDialog.js';
import { LOCAL_COMMAND_STDOUT_TAG } from '../../constants/xml.js';
import type { Notification } from '../../context/notifications.js';
import type { useSkillImprovementSurvey } from '../../hooks/useSkillImprovementSurvey.js';
import { cloudMoveRefusal } from '../../services/codeMode/executor.js';
import { codeModeRemoteControlNotice, isCodeModeEnabled } from '../../services/codeMode/optIn.js';
import type { ElicitationRequestEvent } from '../../services/mcp/elicitationHandler.js';
import type { AppState } from '../../state/AppStateStore.js';
import type { Store } from '../../state/store.js';
import type { McpTaskQuestionController, McpTaskQuestionNoticeTracker } from '../../tasks/McpTask/McpTask.js';
import { setMcpTaskQuestionState } from '../../tasks/McpTask/McpTask.js';
import type { Message as MessageType, PartialCompactDirection, UserMessage } from '../../types/message.js';
import { createAbortController } from '../../utils/abortController.js';
import { explicitSessionEffort } from '../../utils/effort.js';
import type { FileStateCache } from '../../utils/fileStateCache.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import type { LeftArrowConfirmState } from '../../utils/leftArrowConfirm.js';
import { logError } from '../../utils/log.js';
import type { SetAppState } from '../../utils/messageQueueManager.js';
import { createCommandInputMessage, formatCommandInputTags } from '../../utils/messages.js';
import { applyPermissionUpdate, persistPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js';
import type { QueryGuard } from '../../utils/QueryGuard.js';
import type { NetworkHostPattern } from '../../utils/sandbox/sandbox-adapter.js';
import { sendSandboxPermissionResponseViaMailbox } from '../../utils/swarm/permissionSync.js';
import type { TaskRegistry } from '../../utils/taskRegistry.js';
import { escapeXml } from '../../utils/xml.js';
import type { FocusedInputDialog, PkeState, PromptQueueItem, TipNonGoldOverlay } from './types.js';

/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const AntModelSwitchCallout =
  process.env.USER_TYPE === 'ant' ? require('../../components/AntModelSwitchCallout.js').AntModelSwitchCallout : null;
const UndercoverAutoCallout =
  process.env.USER_TYPE === 'ant' ? require('../../components/UndercoverAutoCallout.js').UndercoverAutoCallout : null;
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */

export function ReplInlinePluginPane({
  panesDocked,
  hasShownPluginPane,
  transcriptCols,
  transcriptRows,
  pluginInlineRows,
  isLoading,
  promptEmpty,
  queueEditIndex,
  promptOwnsEscape,
  inlineGripLit,
  setInlineGripLit,
  inlineGripLeftCols,
  inlineGripRightReserve,
}: {
  panesDocked: boolean;
  hasShownPluginPane: boolean;
  transcriptCols: number;
  transcriptRows: number;
  pluginInlineRows: number;
  isLoading: boolean;
  promptEmpty: boolean;
  queueEditIndex: number | null;
  promptOwnsEscape: boolean;
  inlineGripLit: boolean;
  setInlineGripLit: React.Dispatch<React.SetStateAction<boolean>>;
  inlineGripLeftCols: number;
  inlineGripRightReserve: number;
}): React.ReactNode {
  if (panesDocked || !hasShownPluginPane) return null;
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      width={transcriptCols}
      maxHeight={pluginInlineRows}
      overflow="hidden"
      position="relative"
    >
      <PluginPaneSite
        fill={false}
        columns={transcriptCols}
        rows={pluginInlineRows}
        isWorking={isLoading}
        promptEmpty={promptEmpty}
        queueEditing={queueEditIndex !== null}
        promptOwnsEscape={promptOwnsEscape}
        lit={inlineGripLit}
      />
      {pluginInlineRows > 0 && transcriptCols > 0 ? (
        <>
          {inlineGripLeftCols > 0 ? (
            <PluginRowGrip
              columns={inlineGripLeftCols}
              rows={pluginInlineRows}
              onLit={setInlineGripLit}
              onResize={next => {
                const resized = pluginPaneInlineRows(
                  transcriptRows,
                  isFullscreenEnvEnabled() ? 'fullscreen' : 'inline',
                  next,
                );
                chooseInlineRoom(resized);
                return resized;
              }}
              onSettle={keepPluginPaneRoom}
            />
          ) : null}
          {BORDER_MARK_INSET > 0 && transcriptCols > inlineGripRightReserve ? (
            <Box
              position="absolute"
              top={0}
              left={transcriptCols - BORDER_MARK_INSET}
              width={BORDER_MARK_INSET}
              height={1}
            >
              <PluginRowGrip
                columns={BORDER_MARK_INSET}
                rows={pluginInlineRows}
                onLit={setInlineGripLit}
                onResize={next => {
                  const resized = pluginPaneInlineRows(
                    transcriptRows,
                    isFullscreenEnvEnabled() ? 'fullscreen' : 'inline',
                    next,
                  );
                  chooseInlineRoom(resized);
                  return resized;
                }}
                onSettle={keepPluginPaneRoom}
              />
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

export function ReplAbovePromptSurveys({
  promptInputMounted,
  setInputValue,
  postCompactSurvey,
  memorySurvey,
  feedbackSurvey,
  frustrationDetection,
  skillImprovementSurvey,
  didAutoRunIssueRef,
  handleSurveyRequestFeedback,
  isLoading,
  promptEmpty,
}: {
  promptInputMounted: boolean;
  setInputValue: (value: string) => void;
  postCompactSurvey: ReturnType<typeof usePostCompactSurvey>;
  memorySurvey: ReturnType<typeof useMemorySurvey>;
  feedbackSurvey: Omit<ReturnType<typeof useFeedbackSurvey>, 'handleSelect'> & {
    handleSelect: (selected: 'dismissed' | 'bad' | 'fine' | 'good') => void;
  };
  frustrationDetection: ReturnType<typeof useFrustrationDetection>;
  skillImprovementSurvey: ReturnType<typeof useSkillImprovementSurvey>;
  didAutoRunIssueRef: React.RefObject<boolean>;
  handleSurveyRequestFeedback: () => void;
  isLoading: boolean;
  promptEmpty: boolean;
}): React.ReactNode {
  const surveyActive =
    postCompactSurvey.state !== 'closed' ||
    memorySurvey.state !== 'closed' ||
    feedbackSurvey.state !== 'closed' ||
    frustrationDetection.state !== 'closed';
  return (
    <>
      {promptInputMounted && (
        <LivePromptDraft setInputValue={setInputValue}>
          {(liveDraft, setLiveDraft) => (
            <>
              {postCompactSurvey.state !== 'closed' ? (
                <FeedbackSurvey
                  state={postCompactSurvey.state}
                  lastResponse={postCompactSurvey.lastResponse}
                  handleSelect={postCompactSurvey.handleSelect}
                  inputValue={liveDraft}
                  setInputValue={setLiveDraft}
                  onRequestFeedback={handleSurveyRequestFeedback}
                />
              ) : memorySurvey.state !== 'closed' ? (
                <FeedbackSurvey
                  state={memorySurvey.state}
                  lastResponse={memorySurvey.lastResponse}
                  handleSelect={memorySurvey.handleSelect}
                  handleTranscriptSelect={memorySurvey.handleTranscriptSelect}
                  inputValue={liveDraft}
                  setInputValue={setLiveDraft}
                  onRequestFeedback={handleSurveyRequestFeedback}
                  message="How well did Claude use its memory? (optional)"
                />
              ) : (
                <FeedbackSurvey
                  state={feedbackSurvey.state}
                  lastResponse={feedbackSurvey.lastResponse}
                  handleSelect={feedbackSurvey.handleSelect}
                  handleTranscriptSelect={feedbackSurvey.handleTranscriptSelect}
                  inputValue={liveDraft}
                  setInputValue={setLiveDraft}
                  onRequestFeedback={didAutoRunIssueRef.current ? undefined : handleSurveyRequestFeedback}
                />
              )}
              {frustrationDetection.state !== 'closed' && (
                <FeedbackSurvey
                  state={frustrationDetection.state}
                  lastResponse={null}
                  handleSelect={() => {}}
                  handleTranscriptSelect={frustrationDetection.handleTranscriptSelect}
                  inputValue={liveDraft}
                  setInputValue={setLiveDraft}
                />
              )}
              {skillImprovementSurvey.suggestion && (
                <SkillImprovementSurvey
                  isOpen={skillImprovementSurvey.isOpen}
                  skillName={skillImprovementSurvey.suggestion.skillName}
                  updates={skillImprovementSurvey.suggestion.updates}
                  handleSelect={skillImprovementSurvey.handleSelect}
                  inputValue={liveDraft}
                  setInputValue={setLiveDraft}
                />
              )}
              <FeedbackDraftNotice
                isLoading={isLoading}
                surveyActive={surveyActive}
                inputValue={liveDraft}
                setInputValue={setLiveDraft}
                onOpenFeedback={handleSurveyRequestFeedback}
              />
            </>
          )}
        </LivePromptDraft>
      )}
      <PluginAbovePromptSite isWorking={isLoading} promptEmpty={promptEmpty} hasSurvey={surveyActive} />
    </>
  );
}

export type ReplBottomPrePromptOverlaysProps = {
  tipOverlay: TipNonGoldOverlay;
  focusedInputDialog: FocusedInputDialog;
  promptQueue: PromptQueueItem[];
  setPromptQueue: React.Dispatch<React.SetStateAction<PromptQueueItem[]>>;
  pendingWorkerRequest: AppState['pendingWorkerRequest'];
  pendingSandboxRequest: AppState['pendingSandboxRequest'];
  workerSandboxPermissions: AppState['workerSandboxPermissions'];
  teamContext: AppState['teamContext'];
  elicitation: AppState['elicitation'];
  resolveMcpElicitationTaskId: (event: ElicitationRequestEvent | undefined) => string | undefined;
  setReopenedElicitationKey: React.Dispatch<React.SetStateAction<string | null>>;
  getOrCreateMcpTaskQuestionHarness: (taskId: string) => {
    controller: McpTaskQuestionController;
    tracker: McpTaskQuestionNoticeTracker;
  };
  clearDeferredMcpElicitation: (taskId: string) => void;
  deferredMcpElicitationsRef: React.RefObject<Map<string, ElicitationRequestEvent>>;
  deferredMcpAbortCleanupsRef: React.RefObject<Map<string, () => void>>;
  mcpTaskQuestionHarnessesRef: React.RefObject<
    Map<string, { controller: McpTaskQuestionController; tracker: McpTaskQuestionNoticeTracker }>
  >;
  setShowModelSwitchCallout: React.Dispatch<React.SetStateAction<boolean>>;
  setShowUndercoverCallout: React.Dispatch<React.SetStateAction<boolean>>;
  setShowEffortCallout: React.Dispatch<React.SetStateAction<boolean>>;
  mainLoopModel: string;
  addNotification: (notif: Notification) => void;
  setAppState: SetAppState;
  pke: PkeState;
  leftArrowConfirm: LeftArrowConfirmState | null;
  setLeftArrowConfirm: React.Dispatch<React.SetStateAction<LeftArrowConfirmState | null>>;
  hintRecommendation: ReturnType<typeof useClaudeCodeHintRecommendation>['recommendation'];
  handleHintResponse: ReturnType<typeof useClaudeCodeHintRecommendation>['handleResponse'];
  searchExtraToolsHint: ReturnType<typeof useSearchExtraToolsHint>;
  lspRecommendation: ReturnType<typeof useLspPluginRecommendation>['recommendation'];
  handleLspResponse: ReturnType<typeof useLspPluginRecommendation>['handleResponse'];
  setShowDesktopUpsellStartup: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFullscreenUpsell: React.Dispatch<React.SetStateAction<boolean>>;
  ultraplanPendingChoice: AppState['ultraplanPendingChoice'];
  ultraplanLaunchPending: AppState['ultraplanLaunchPending'];
  setMessages: (action: React.SetStateAction<MessageType[]>) => void;
  readFileState: React.RefObject<FileStateCache>;
  store: Store<AppState>;
  setConversationId: React.Dispatch<React.SetStateAction<string>>;
  taskRegistry: TaskRegistry;
  queryGuard: QueryGuard;
};

export function ReplBottomPrePromptOverlays({
  tipOverlay,
  focusedInputDialog,
  promptQueue,
  setPromptQueue,
  pendingWorkerRequest,
  pendingSandboxRequest,
  workerSandboxPermissions,
  teamContext,
  elicitation,
  resolveMcpElicitationTaskId,
  setReopenedElicitationKey,
  getOrCreateMcpTaskQuestionHarness,
  clearDeferredMcpElicitation,
  deferredMcpElicitationsRef,
  deferredMcpAbortCleanupsRef,
  mcpTaskQuestionHarnessesRef,
  setShowModelSwitchCallout,
  setShowUndercoverCallout,
  setShowEffortCallout,
  mainLoopModel,
  addNotification,
  setAppState,
  pke,
  leftArrowConfirm,
  setLeftArrowConfirm,
  hintRecommendation,
  handleHintResponse,
  searchExtraToolsHint,
  lspRecommendation,
  handleLspResponse,
  setShowDesktopUpsellStartup,
  setShowFullscreenUpsell,
  ultraplanPendingChoice,
  ultraplanLaunchPending,
  setMessages,
  readFileState,
  store,
  setConversationId,
  taskRegistry,
  queryGuard,
}: ReplBottomPrePromptOverlaysProps): React.ReactNode {
  return (
    <>
      {tipOverlay === 'prompt' && (
        <PromptDialog
          key={promptQueue[0]!.request.prompt}
          title={promptQueue[0]!.title}
          toolInputSummary={promptQueue[0]!.toolInputSummary}
          request={promptQueue[0]!.request}
          onRespond={selectedKey => {
            const item = promptQueue[0];
            if (!item) return;
            item.resolve({
              prompt_response: item.request.prompt,
              selected: selectedKey,
            });
            setPromptQueue(([, ...tail]) => tail);
          }}
          onAbort={() => {
            const item = promptQueue[0];
            if (!item) return;
            item.reject(new Error('Prompt cancelled by user'));
            setPromptQueue(([, ...tail]) => tail);
          }}
        />
      )}
      {pendingWorkerRequest && (
        <WorkerPendingPermission
          toolName={pendingWorkerRequest.toolName}
          description={pendingWorkerRequest.description}
        />
      )}
      {pendingSandboxRequest && (
        <WorkerPendingPermission
          toolName="Network Access"
          description={`Waiting for leader to approve network access to ${pendingSandboxRequest.host}`}
        />
      )}
      {focusedInputDialog === 'worker-sandbox-permission' && (
        <SandboxPermissionRequest
          key={workerSandboxPermissions.queue[0]!.requestId}
          hostPattern={
            {
              host: workerSandboxPermissions.queue[0]!.host,
              port: undefined,
            } as NetworkHostPattern
          }
          onUserResponse={response => {
            const { allow, persistToSettings } =
              response === 'cancelled' ? { allow: false, persistToSettings: false } : response;
            const currentRequest = workerSandboxPermissions.queue[0];
            if (!currentRequest) return;

            const approvedHost = currentRequest.host;

            void sendSandboxPermissionResponseViaMailbox(
              currentRequest.workerName,
              currentRequest.requestId,
              approvedHost,
              allow,
              teamContext?.teamName,
            );

            if (persistToSettings && allow) {
              const update = {
                type: 'addRules' as const,
                rules: [
                  {
                    toolName: WEB_FETCH_TOOL_NAME,
                    ruleContent: `domain:${normalizeSandboxSessionHost(approvedHost)}`,
                  },
                ],
                behavior: 'allow' as const,
                destination: 'localSettings' as const,
              };

              setAppState(prev => ({
                ...prev,
                toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, update),
              }));

              SandboxManager.addSessionAllowedHost(approvedHost);
              persistPermissionUpdate(update);
              SandboxManager.refreshConfig();
            } else if (allow) {
              SandboxManager.addSessionAllowedHost(approvedHost);
            }

            setAppState(prev => ({
              ...prev,
              workerSandboxPermissions: {
                ...prev.workerSandboxPermissions,
                queue: prev.workerSandboxPermissions.queue.slice(1),
              },
            }));
          }}
        />
      )}
      {focusedInputDialog === 'elicitation' && (
        <ElicitationDialog
          key={elicitation.queue[0]!.serverName + ':' + String(elicitation.queue[0]!.requestId)}
          event={elicitation.queue[0]!}
          onResponse={(action, content) => {
            const currentRequest = elicitation.queue[0];
            if (!currentRequest) return;
            const relatedTaskId = resolveMcpElicitationTaskId(currentRequest);
            if (relatedTaskId && action === 'cancel' && !currentRequest.signal?.aborted) {
              setReopenedElicitationKey(null);
              const { controller } = getOrCreateMcpTaskQuestionHarness(relatedTaskId);
              clearDeferredMcpElicitation(relatedTaskId);
              deferredMcpElicitationsRef.current.set(relatedTaskId, currentRequest);
              if (currentRequest.signal) {
                const onAbort = () => {
                  if (deferredMcpElicitationsRef.current.get(relatedTaskId) === currentRequest) {
                    clearDeferredMcpElicitation(relatedTaskId);
                    controller.set(undefined);
                  }
                };
                currentRequest.signal.addEventListener('abort', onAbort, { once: true });
                deferredMcpAbortCleanupsRef.current.set(relatedTaskId, () => {
                  currentRequest.signal.removeEventListener('abort', onAbort);
                });
              }
              setAppState(prev => ({
                ...prev,
                elicitation: {
                  queue: prev.elicitation.queue.slice(1),
                },
              }));
              controller.putAside(`${currentRequest.serverName}:${String(currentRequest.requestId)}`);
              return;
            }
            setReopenedElicitationKey(null);
            if (relatedTaskId) {
              clearDeferredMcpElicitation(relatedTaskId);
              const harness = mcpTaskQuestionHarnessesRef.current.get(relatedTaskId);
              if (harness) {
                harness.controller.answered();
                harness.controller.set(undefined);
              } else {
                setMcpTaskQuestionState(relatedTaskId, setAppState, undefined, undefined);
              }
            }
            currentRequest.respond({ action, content });
            const isUrlAccept = currentRequest.params.mode === 'url' && action === 'accept';
            if (!isUrlAccept) {
              setAppState(prev => ({
                ...prev,
                elicitation: {
                  queue: prev.elicitation.queue.slice(1),
                },
              }));
            }
          }}
          onWaitingDismiss={action => {
            const currentRequest = elicitation.queue[0];
            const relatedTaskId = resolveMcpElicitationTaskId(currentRequest);
            setReopenedElicitationKey(null);
            if (relatedTaskId) {
              clearDeferredMcpElicitation(relatedTaskId);
              const harness = mcpTaskQuestionHarnessesRef.current.get(relatedTaskId);
              if (harness) {
                harness.controller.set(undefined);
              } else {
                setMcpTaskQuestionState(relatedTaskId, setAppState, undefined, undefined);
              }
            }
            setAppState(prev => ({
              ...prev,
              elicitation: {
                queue: prev.elicitation.queue.slice(1),
              },
            }));
            currentRequest?.onWaitingDismiss?.(action);
          }}
        />
      )}
      {process.env.USER_TYPE === 'ant' && tipOverlay === 'model-switch' && AntModelSwitchCallout && (
        <AntModelSwitchCallout
          onDone={(selection: string, modelAlias?: string) => {
            setShowModelSwitchCallout(false);
            if (selection === 'switch' && modelAlias) {
              setAppState(prev => ({
                ...prev,
                mainLoopModel: modelAlias,
                mainLoopModelForSession: null,
              }));
            }
          }}
        />
      )}
      {process.env.USER_TYPE === 'ant' && tipOverlay === 'undercover-callout' && UndercoverAutoCallout && (
        <UndercoverAutoCallout onDone={() => setShowUndercoverCallout(false)} />
      )}
      {tipOverlay === 'effort-callout' && (
        <EffortCallout
          model={mainLoopModel}
          onDone={selection => {
            setShowEffortCallout(false);
            if (selection !== 'dismiss') {
              setAppState(prev => ({
                ...prev,
                sessionEffort: explicitSessionEffort(selection),
              }));
              try {
                const { leftoverIhr } =
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  require('../../utils/collapseReadSearch.js') as typeof import('../../utils/collapseReadSearch.js');
                leftoverIhr.main.setTurnEffort(selection);
              } catch {
                // isolation — optional
              }
            }
          }}
        />
      )}
      {focusedInputDialog === 'remote-callout' && (
        <RemoteCallout
          onDone={selection => {
            if (selection === 'enable' && isCodeModeEnabled()) {
              addNotification({
                key: 'code-mode-rc-refusal',
                kind: 'warning',
                priority: 'immediate',
                wrap: true,
                color: 'warning',
                text: codeModeRemoteControlNotice(),
              });
              setAppState(prev => (prev.showRemoteCallout ? { ...prev, showRemoteCallout: false } : prev));
              return;
            }
            setAppState(prev => {
              if (!prev.showRemoteCallout) return prev;
              return {
                ...prev,
                showRemoteCallout: false,
                ...(selection === 'enable' && {
                  replBridgeEnabled: true,
                  replBridgeExplicit: true,
                  replBridgeOutboundOnly: false,
                }),
              };
            });
          }}
        />
      )}

      {pke.kind === 'dialog' ? pke.node : null}

      {focusedInputDialog === 'left-arrow-confirm' && leftArrowConfirm && (
        <LeftArrowConfirmDialog
          summary={leftArrowConfirm.summary}
          carryOverCount={leftArrowConfirm.carryOverCount}
          monitorParkCount={leftArrowConfirm.monitorParkCount}
          workflowAgents={leftArrowConfirm.workflowAgents}
          onConfirm={() => {
            const cur = leftArrowConfirm;
            logEvent('tengu_left_arrow_confirm', {
              accepted: true,
              count: cur.inFlight.count,
              kinds: [...cur.inFlight.kinds].sort().join(',') as never,
              carryover_count: cur.carryOverCount,
              workflow_agent_count: cur.workflowAgents.running,
            });
            setLeftArrowConfirm(null);
            cur.proceed();
          }}
          onCancel={() => {
            logEvent('tengu_left_arrow_confirm', {
              accepted: false,
              count: leftArrowConfirm.inFlight.count,
              kinds: [...leftArrowConfirm.inFlight.kinds].sort().join(',') as never,
              carryover_count: leftArrowConfirm.carryOverCount,
              workflow_agent_count: leftArrowConfirm.workflowAgents.running,
            });
            setLeftArrowConfirm(null);
          }}
        />
      )}

      {focusedInputDialog === 'plugin-hint' && hintRecommendation && (
        <PluginHintMenu
          pluginName={hintRecommendation.pluginName}
          pluginDescription={hintRecommendation.pluginDescription}
          marketplaceName={hintRecommendation.marketplaceName}
          sourceCommand={hintRecommendation.sourceCommand}
          onResponse={handleHintResponse}
        />
      )}

      {tipOverlay === 'search-extra-tools-hint' && searchExtraToolsHint.visible && (
        <SearchExtraToolsHint
          tools={searchExtraToolsHint.tools}
          onSelect={searchExtraToolsHint.handleSelect}
          onDismiss={searchExtraToolsHint.handleDismiss}
        />
      )}

      {focusedInputDialog === 'lsp-recommendation' && lspRecommendation && (
        <LspRecommendationMenu
          pluginName={lspRecommendation.pluginName}
          pluginDescription={lspRecommendation.pluginDescription}
          fileExtension={lspRecommendation.fileExtension}
          onResponse={handleLspResponse}
        />
      )}

      {tipOverlay === 'desktop-upsell' && <DesktopUpsellStartup onDone={() => setShowDesktopUpsellStartup(false)} />}

      {focusedInputDialog === 'fullscreen-upsell' && (
        <FullscreenUpsellDialog onDone={() => setShowFullscreenUpsell(false)} />
      )}

      {focusedInputDialog === 'ultraplan-choice' && ultraplanPendingChoice && (
        <UltraplanChoiceDialog
          plan={ultraplanPendingChoice.plan}
          sessionId={ultraplanPendingChoice.sessionId}
          taskId={ultraplanPendingChoice.taskId}
          setMessages={setMessages}
          readFileState={readFileState.current}
          getAppState={() => store.getState()}
          setConversationId={setConversationId}
          taskRegistry={taskRegistry}
        />
      )}

      {focusedInputDialog === 'ultraplan-launch' && ultraplanLaunchPending && (
        <UltraplanLaunchDialog
          onChoice={(choice, opts) => {
            const blurb = ultraplanLaunchPending.blurb;
            setAppState(prev => (prev.ultraplanLaunchPending ? { ...prev, ultraplanLaunchPending: undefined } : prev));
            if (choice === 'cancel') return;
            const codeModeCloudRefusal = cloudMoveRefusal();
            if (codeModeCloudRefusal) {
              addNotification({
                key: 'code-mode-cloud-refusal',
                kind: 'warning',
                priority: 'immediate',
                wrap: true,
                color: 'warning',
                text: codeModeCloudRefusal,
              });
              return;
            }
            setMessages(prev => [...prev, createCommandInputMessage(formatCommandInputTags('ultraplan', blurb))]);
            const appendStdout = (msg: string) =>
              setMessages(prev => [
                ...prev,
                createCommandInputMessage(
                  `<${LOCAL_COMMAND_STDOUT_TAG}>${escapeXml(msg)}</${LOCAL_COMMAND_STDOUT_TAG}>`,
                ),
              ]);
            const appendWhenIdle = (msg: string) => {
              if (!queryGuard.isActive) {
                appendStdout(msg);
                return;
              }
              const unsub = queryGuard.subscribe(() => {
                if (queryGuard.isActive) return;
                unsub();
                if (!store.getState().ultraplanSessionUrl) return;
                appendStdout(msg);
              });
            };
            void launchUltraplan({
              blurb,
              promptIdentifier: opts?.promptIdentifier,
              getAppState: () => store.getState(),
              setAppState,
              signal: createAbortController().signal,
              disconnectedBridge: opts?.disconnectedBridge,
              onSessionReady: appendWhenIdle,
            })
              .then(appendStdout)
              .catch(logError);
          }}
        />
      )}
    </>
  );
}

export function ReplBottomPostPromptOverlays({
  cursor,
  focusedInputDialog,
  messages,
  messageSelectorPreselect,
  onCancel,
  onRestoreCode,
  onSummarize,
  handleRestoreMessage,
  setIsMessageSelectorVisible,
  setMessageSelectorPreselect,
}: {
  cursor: MessageActionsState | null;
  focusedInputDialog: FocusedInputDialog;
  messages: MessageType[];
  messageSelectorPreselect: UserMessage | undefined;
  onCancel: () => void;
  onRestoreCode: (message: UserMessage) => Promise<{ skippedLinks?: number }>;
  onSummarize:
    | ((
        message: UserMessage,
        feedback?: string,
        direction?: PartialCompactDirection,
        signal?: AbortSignal,
      ) => Promise<void>)
    | undefined;
  handleRestoreMessage: (message: UserMessage) => Promise<void>;
  setIsMessageSelectorVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setMessageSelectorPreselect: React.Dispatch<React.SetStateAction<UserMessage | undefined>>;
}): React.ReactNode {
  return (
    <>
      {cursor && <MessageActionsBar cursor={cursor} />}
      {focusedInputDialog === 'message-selector' && (
        <MessageSelector
          messages={messages}
          preselectedMessage={messageSelectorPreselect}
          onPreRestore={onCancel}
          onRestoreCode={onRestoreCode}
          onSummarize={onSummarize}
          onRestoreMessage={handleRestoreMessage}
          onClose={() => {
            setIsMessageSelectorVisible(false);
            setMessageSelectorPreselect(undefined);
          }}
        />
      )}
      {process.env.USER_TYPE === 'ant' && <DevBar />}
    </>
  );
}
