import { feature } from 'bun:bundle';
import { dirname } from 'path';
import React from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { getOriginalCwd, getSessionId, switchSession } from '../bootstrap/state.js';
import type { Command } from '../commands.js';
import { LogSelector } from '../components/LogSelector.js';
import { restoreCostStateForSession } from '../cost-tracker.js';
import { useCopyOnSelect, useSelectionBgColor } from '../hooks/useCopyOnSelect.js';
import { AlternateScreen, Box, LoadingState, setClipboard, Text, useSelection, useTerminalTitle } from '@anthropic/ink';
import { useSelectionClearKeybinding } from '../components/ScrollKeybindingHandler.js';
import { isFullscreenEnvEnabled, mouseTrackingProp } from '../utils/fullscreen.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js';
import type { MCPServerConnection, ScopedMcpServerConfig } from '../services/mcp/types.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import type { Tool } from '../Tool.js';
import type { AgentColorName } from '@claude-code/builtin-tools/tools/AgentTool/agentColorManager.js';
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { asSessionId } from '../types/ids.js';
import type { LogOption } from '../types/logs.js';
import type { Message } from '../types/message.js';
import { renameRecordingForSession } from '../utils/asciicast.js';
import { updateSessionName } from '../utils/concurrentSessions.js';
import { loadConversationForResume } from '../utils/conversationRecovery.js';
import { checkCrossProjectResume } from '../utils/crossProjectResume.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import type { FileHistorySnapshot } from '../utils/fileHistory.js';
import { toError } from '../utils/errors.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { logError } from '../utils/log.js';
import { createSystemMessage } from '../utils/messages.js';
import {
  computeStandaloneAgentContext,
  isCrossHostSessionHomeShape,
  isUnsafeSessionRestorePath,
  restoreAgentFromSession,
  restoreSessionStateFromLog,
  restoreWorktreeForResume,
} from '../utils/sessionRestore.js';
import {
  preparePlanModeRestoreOnInteractiveResume,
  takeRestoredWorkerForPlanResume,
  type TranscriptPlanScanMessage,
} from '../utils/permissions/planModeResume.js';
import { restoreSessionTaskListId } from '../utils/tasks.js';
import {
  adoptResumedSessionFile,
  enrichLogs,
  isCustomTitleEnabled,
  loadAllProjectsMessageLogsProgressive,
  loadSameRepoMessageLogsProgressive,
  recordContentReplacement,
  resetSessionFilePointer,
  restoreSessionMetadata,
  type SessionLogResult,
} from '../utils/sessionStorage.js';
import type { ThinkingConfig } from '../utils/thinking.js';
import type { ContentReplacementRecord } from '../utils/toolResultStorage.js';
import { validateUuid } from '../utils/uuid.js';
import { REPL } from './REPL.js';

function parsePrIdentifier(value: string): number | null {
  const directNumber = parseInt(value, 10);
  if (!isNaN(directNumber) && directNumber > 0) {
    return directNumber;
  }
  const urlMatch = value.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (urlMatch?.[1]) {
    return parseInt(urlMatch[1], 10);
  }
  return null;
}

type Props = {
  commands: Command[];
  worktreePaths: string[];
  initialTools: Tool[];
  mcpClients?: MCPServerConnection[];
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>;
  debug: boolean;
  mainThreadAgentDefinition?: AgentDefinition;
  autoConnectIdeFlag?: boolean;
  strictMcpConfig?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  initialSearchQuery?: string;
  disableSlashCommands?: boolean;
  forkSession?: boolean;
  taskListId?: string;
  filterByPr?: boolean | number | string;
  thinkingConfig: ThinkingConfig;
  onTurnComplete?: (messages: Message[]) => void | Promise<void>;
  onOpenAgents?: React.ComponentProps<typeof REPL>['onOpenAgents'];
};

export function ResumeConversation({
  commands,
  worktreePaths,
  initialTools,
  mcpClients,
  dynamicMcpConfig,
  debug,
  mainThreadAgentDefinition,
  autoConnectIdeFlag,
  strictMcpConfig = false,
  systemPrompt,
  appendSystemPrompt,
  initialSearchQuery,
  disableSlashCommands = false,
  forkSession,
  taskListId,
  filterByPr,
  thinkingConfig,
  onTurnComplete,
  onOpenAgents,
}: Props): React.ReactNode {
  const { rows } = useTerminalSize();
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  const setAppState = useSetAppState();
  const [logs, setLogs] = React.useState<LogOption[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [resuming, setResuming] = React.useState(false);
  /** densable IQf: sticky fail state so picker does not hang on load/onSelect errors */
  const [resumeFailed, setResumeFailed] = React.useState<{
    sessionId?: string;
  } | null>(null);
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  /** densable q.current — ignore double-select while resuming */
  const selectingRef = React.useRef(false);
  const selectedRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const loadGenerationRef = React.useRef(0);
  const loadingMoreRef = React.useRef(false);
  const [resumeData, setResumeData] = React.useState<{
    messages: Message[];
    fileHistorySnapshots?: FileHistorySnapshot[];
    contentReplacements?: ContentReplacementRecord[];
    agentName?: string;
    agentColor?: AgentColorName;
    mainThreadAgentDefinition?: AgentDefinition;
    taskListId?: string;
  } | null>(null);
  const [crossProjectCommand, setCrossProjectCommand] = React.useState<string | null>(null);
  const sessionLogResultRef = React.useRef<SessionLogResult | null>(null);
  // Mirror of logs.length so loadMoreLogs can compute value indices outside
  // the setLogs updater (keeping it pure per React's contract).
  const logCountRef = React.useRef(0);
  const hasListRef = React.useRef(false);
  const currentSessionId = getSessionId();

  const filteredLogs = React.useMemo(() => {
    let result = logs.filter(l => !l.isSidechain);
    if (filterByPr !== undefined) {
      if (filterByPr === true) {
        result = result.filter(l => l.prNumber !== undefined);
      } else if (typeof filterByPr === 'number') {
        result = result.filter(l => l.prNumber === filterByPr);
      } else if (typeof filterByPr === 'string') {
        const prNumber = parsePrIdentifier(filterByPr);
        if (prNumber !== null) {
          result = result.filter(l => l.prNumber === prNumber);
        }
      }
    }
    return result;
  }, [logs, filterByPr]);
  const isResumeWithRenameEnabled = isCustomTitleEnabled();
  const terminalTitleDisabled = React.useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE), []);
  useTerminalTitle(resumeData || terminalTitleDisabled ? null : 'claude · resume');

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const gen = ++loadGenerationRef.current;
    loadingMoreRef.current = false;
    loadSameRepoMessageLogsProgressive(worktreePaths)
      .then(result => {
        if (cancelled || !mountedRef.current || selectedRef.current || gen !== loadGenerationRef.current) {
          return;
        }
        sessionLogResultRef.current = result;
        logCountRef.current = result.logs.length;
        hasListRef.current = true;
        setLogs(result.logs);
        setHasMore(result.nextIndex < result.allStatLogs.length);
        setLoading(false);
      })
      .catch(error => {
        if (cancelled || !mountedRef.current || selectedRef.current || gen !== loadGenerationRef.current) {
          return;
        }
        logError(error);
        hasListRef.current = true;
        setHasMore(false);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePaths]);

  const loadMoreLogs = React.useCallback((count: number) => {
    if (loadingMoreRef.current || selectedRef.current) return;
    const ref = sessionLogResultRef.current;
    if (!ref || ref.nextIndex >= ref.allStatLogs.length) {
      setHasMore(false);
      return;
    }

    const gen = loadGenerationRef.current;
    loadingMoreRef.current = true;
    void enrichLogs(ref.allStatLogs, ref.nextIndex, count)
      .then(result => {
        if (!mountedRef.current || selectedRef.current || gen !== loadGenerationRef.current) {
          loadingMoreRef.current = false;
          return;
        }
        if (sessionLogResultRef.current !== ref) {
          loadingMoreRef.current = false;
          return;
        }
        ref.nextIndex = result.nextIndex;
        const more = ref.nextIndex < ref.allStatLogs.length;
        loadingMoreRef.current = false;
        setHasMore(more);
        if (result.logs.length > 0) {
          // enrichLogs returns fresh unshared objects — safe to mutate in place.
          // Offset comes from logCountRef so the setLogs updater stays pure.
          const offset = logCountRef.current;
          result.logs.forEach((log, i) => {
            log.value = offset + i;
          });
          setLogs(prev => prev.concat(result.logs));
          logCountRef.current += result.logs.length;
        } else if (more) {
          loadMoreLogs(count);
        }
      })
      .catch(error => {
        loadingMoreRef.current = false;
        if (!mountedRef.current || selectedRef.current || gen !== loadGenerationRef.current) {
          return;
        }
        logError(error);
      });
  }, []);

  React.useEffect(() => {
    if (selectedRef.current || filterByPr === undefined || loading || filteredLogs.length > 0) return;
    const ref = sessionLogResultRef.current;
    if (!ref || ref.nextIndex >= ref.allStatLogs.length) return;
    loadMoreLogs(50);
  }, [filterByPr, loading, filteredLogs.length, logs.length, loadMoreLogs]);

  const loadLogs = React.useCallback(
    (allProjects: boolean) => {
      if (selectedRef.current) return;
      const gen = ++loadGenerationRef.current;
      loadingMoreRef.current = false;
      setLoading(true);
      const promise = allProjects
        ? loadAllProjectsMessageLogsProgressive()
        : loadSameRepoMessageLogsProgressive(worktreePaths);
      promise
        .then(result => {
          if (!mountedRef.current || selectedRef.current || gen !== loadGenerationRef.current) {
            return;
          }
          sessionLogResultRef.current = result;
          logCountRef.current = result.logs.length;
          setLogs(result.logs);
          setHasMore(result.nextIndex < result.allStatLogs.length);
        })
        .catch(error => {
          if (!mountedRef.current || selectedRef.current || gen !== loadGenerationRef.current) {
            return;
          }
          logError(error);
          setHasMore(false);
        })
        .finally(() => {
          if (mountedRef.current && !selectedRef.current && gen === loadGenerationRef.current) {
            setLoading(false);
          }
        });
    },
    [worktreePaths],
  );

  const handleToggleAllProjects = React.useCallback(() => {
    const newValue = !showAllProjects;
    setShowAllProjects(newValue);
    loadLogs(newValue);
  }, [showAllProjects, loadLogs]);

  function onCancel() {
    void gracefulShutdown(1);
  }

  async function onSelect(log: LogOption) {
    // densable pe: q.current guard against double-select hang
    if (selectingRef.current) return;
    selectingRef.current = true;
    setResuming(true);
    setResumeFailed(null);
    const resumeStart = performance.now();

    try {
      const command = await checkCrossProjectResume(log, showAllProjects, worktreePaths);
      if (command) {
        const raw = await setClipboard(command);
        if (raw) process.stdout.write(raw);
        setCrossProjectCommand(command);
        selectingRef.current = false;
        setResuming(false);
        return;
      }
    } catch (e) {
      // densable pre-load failed → sticky error (not hang)
      logError(new Error(`resume picker: pre-load failed: ${e instanceof Error ? e.message : String(e)}`));
      setResumeFailed({ sessionId: log.sessionId });
      selectingRef.current = false;
      setResuming(false);
      return;
    }

    let failureReason: 'load_error' | 'processing_error' = 'load_error';
    let alreadyLoggedNotFound = false;
    try {
      if (log.fullPath && (isUnsafeSessionRestorePath(log.fullPath) || isCrossHostSessionHomeShape(log.fullPath))) {
        throw new Error('Refusing to resume session from an unsafe or cross-host transcript path');
      }

      const result = await loadConversationForResume(log, undefined, { forkSession });
      if (!result) {
        logEvent('tengu_session_resumed', {
          entrypoint: 'picker' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: false,
          failure_reason: 'not_found_picker' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        alreadyLoggedNotFound = true;
        throw new Error('Failed to load conversation');
      }
      failureReason = 'processing_error';

      let effectiveAgentDefinitions = agentDefinitions;
      if (feature('COORDINATOR_MODE')) {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const coordinatorModule =
          require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js');
        const { syncCoordinatorModeEnvFromSession } =
          require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js');
        /* eslint-enable @typescript-eslint/no-require-imports */
        const warning =
          typeof coordinatorModule?.matchSessionMode === 'function'
            ? coordinatorModule.matchSessionMode(result.mode)
            : syncCoordinatorModeEnvFromSession(result.mode);
        if (warning) {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const { getAgentDefinitionsWithOverrides, getActiveAgentsFromList } =
            require('@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js') as typeof import('@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js');
          /* eslint-enable @typescript-eslint/no-require-imports */
          getAgentDefinitionsWithOverrides.cache.clear?.();
          const freshAgentDefs = await getAgentDefinitionsWithOverrides(getOriginalCwd());
          effectiveAgentDefinitions = {
            ...freshAgentDefs,
            allAgents: freshAgentDefs.allAgents,
            activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
          };
          setAppState(prev => ({
            ...prev,
            agentDefinitions: effectiveAgentDefinitions,
          }));
          result.messages.push(createSystemMessage(warning, 'warning'));
        }
      }

      if (result.sessionId && !forkSession) {
        switchSession(asSessionId(result.sessionId), log.fullPath ? dirname(log.fullPath) : null, 'resume');
        await renameRecordingForSession();
        await resetSessionFilePointer();
        restoreCostStateForSession(result.sessionId);
      } else if (forkSession && result.contentReplacements?.length) {
        await recordContentReplacement(result.contentReplacements);
      }

      // Restore agent setting BEFORE restoreSessionStateFromLog (aligned with official
      // chunk@335616421.js @52874 and REPL.tsx): hydrates AppState.agent and agent model
      // immediately without leaking module-global pendingRestoredAgentModel, while still
      // allowing transcript sessionModel in restoreSessionStateFromLog to take precedence.
      const { agentDefinition: resolvedAgentDef } = restoreAgentFromSession(
        result.agentSetting,
        mainThreadAgentDefinition,
        effectiveAgentDefinitions,
        setAppState,
      );
      setAppState(prev => ({ ...prev, agent: resolvedAgentDef?.agentType }));

      // Hydrate transcript-derived session state (model, endedByModel, fileHistory,
      // attribution, contextCollapse, goals, agentNameRegistry, worker plan mode).
      restoreSessionStateFromLog(result, setAppState, {
        applyPlanModeResume: true,
        restoredWorker: takeRestoredWorkerForPlanResume(),
        forkSession: Boolean(forkSession),
        planModeResumeLane: 'interactive',
      });

      const applyInteractivePlanModeRestore = await preparePlanModeRestoreOnInteractiveResume({
        storedPermissionMode: result.permissionMode,
        messages: result.messages as TranscriptPlanScanMessage[],
        forkSession: Boolean(forkSession),
        permissionModeSuppliedOnInvocation: false,
        lane: 'interactive_picker',
      });
      setAppState(prev => {
        const nextCtx = applyInteractivePlanModeRestore(prev.toolPermissionContext);
        return nextCtx ? { ...prev, toolPermissionContext: nextCtx } : prev;
      });

      let resolvedTaskListId = taskListId;
      if (!forkSession && !resolvedTaskListId) {
        resolvedTaskListId = await restoreSessionTaskListId(result.sessionId ?? getSessionId());
      }

      if (feature('COORDINATOR_MODE')) {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { saveMode } = require('../utils/sessionStorage.js');
        const { isCoordinatorModeEnvEnabled } =
          require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js');
        /* eslint-enable @typescript-eslint/no-require-imports */
        saveMode(result.mode ?? (isCoordinatorModeEnvEnabled() ? 'coordinator' : 'normal'));
      }

      setAppState(prev => {
        const standaloneAgentContext = computeStandaloneAgentContext(
          result.agentName,
          result.agentColor,
          prev.standaloneAgentContext?.prideGradient,
        );
        return { ...prev, standaloneAgentContext };
      });
      void updateSessionName(result.agentName);

      restoreSessionMetadata(forkSession ? { ...result, worktreeSession: undefined } : result);

      if (!forkSession) {
        restoreWorktreeForResume(result.worktreeSession);
        if (result.sessionId) {
          adoptResumedSessionFile();
        }
      }

      // densable 2.1.224 #30 — force RC on when transcript has non-empty
      // bridgeSessionId and not already full RC; tombstone → no force-on.
      // feature() must stay in if condition position (not &&-chained).
      if (feature('BRIDGE_MODE')) {
        if (!forkSession && result.bridgeSessionId) {
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

      logEvent('tengu_session_resumed', {
        entrypoint: 'picker' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: true,
        resume_duration_ms: Math.round(performance.now() - resumeStart),
      });

      selectedRef.current = true;
      loadGenerationRef.current += 1;
      loadingMoreRef.current = false;
      sessionLogResultRef.current = null;
      logCountRef.current = 0;
      setLogs([]);
      setHasMore(false);
      // densable iXg(Gxt) is REPL-after-load, not picker intercept.
      setResumeData({
        messages: result.messages,
        fileHistorySnapshots: result.fileHistorySnapshots,
        contentReplacements: result.contentReplacements,
        agentName: result.agentName,
        agentColor: (result.agentColor === 'default' ? undefined : result.agentColor) as AgentColorName | undefined,
        mainThreadAgentDefinition: resolvedAgentDef,
        taskListId: resolvedTaskListId,
      });
      selectingRef.current = false;
      setResuming(false);
    } catch (e) {
      // densable onSelect failed → sticky IQf error UI (not rethrow hang)
      if (!alreadyLoggedNotFound) {
        logEvent('tengu_session_resumed', {
          entrypoint: 'picker' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: false,
          failure_reason: failureReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_name: toError(e).name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      }
      logError(toError(e));
      setResumeFailed({ sessionId: log.sessionId });
      selectingRef.current = false;
      setResuming(false);
    }
  }

  if (crossProjectCommand) {
    return <CrossProjectMessage command={crossProjectCommand} />;
  }

  if (resumeData) {
    return (
      <REPL
        debug={debug}
        commands={commands}
        initialTools={initialTools}
        initialMessages={resumeData.messages}
        initialFileHistorySnapshots={resumeData.fileHistorySnapshots}
        initialContentReplacements={resumeData.contentReplacements}
        initialAgentName={resumeData.agentName}
        initialAgentColor={resumeData.agentColor}
        mcpClients={mcpClients}
        dynamicMcpConfig={dynamicMcpConfig}
        strictMcpConfig={strictMcpConfig}
        systemPrompt={systemPrompt}
        appendSystemPrompt={appendSystemPrompt}
        mainThreadAgentDefinition={resumeData.mainThreadAgentDefinition}
        autoConnectIdeFlag={autoConnectIdeFlag}
        disableSlashCommands={disableSlashCommands}
        taskListId={resumeData.taskListId ?? taskListId}
        thinkingConfig={thinkingConfig}
        onTurnComplete={onTurnComplete}
        onOpenAgents={onOpenAgents}
      />
    );
  }

  if (loading && !hasListRef.current && (logs.length === 0 || filteredLogs.length === 0)) {
    return (
      <PickerScreenWrapper>
        <LoadingState message="Loading conversations…" />
      </PickerScreenWrapper>
    );
  }

  if (resumeFailed) {
    return <ResumeFailedMessage sessionId={resumeFailed.sessionId} />;
  }

  if (resuming) {
    return (
      <PickerScreenWrapper>
        <LoadingState message="Resuming conversation…" />
      </PickerScreenWrapper>
    );
  }

  return (
    <PickerScreenWrapper>
      <LogSelector
        logs={filteredLogs}
        currentSessionId={currentSessionId}
        maxHeight={rows}
        onCancel={onCancel}
        onSelect={onSelect}
        onLogsChanged={isResumeWithRenameEnabled ? () => loadLogs(showAllProjects) : undefined}
        onLoadMore={loadMoreLogs}
        hasMore={hasMore}
        initialSearchQuery={initialSearchQuery}
        isLoading={loading}
        showAllProjects={showAllProjects}
        onToggleAllProjects={handleToggleAllProjects}
      />
    </PickerScreenWrapper>
  );
}

function PickerScreenWrapper({ children }: { children: React.ReactNode }): React.ReactNode {
  const isFullscreen = isFullscreenEnvEnabled();
  const selection = useSelection();
  useSelectionBgColor(selection);
  useCopyOnSelect(selection, isFullscreen);
  useSelectionClearKeybinding(selection, isFullscreen);
  if (!isFullscreen) {
    return children;
  }
  return <AlternateScreen mouseTracking={mouseTrackingProp()}>{children}</AlternateScreen>;
}

function ResumeFailedMessage({ sessionId }: { sessionId?: string }): React.ReactNode {
  // densable IQf / Je: delay exit so Ink flushes the error output first
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      void gracefulShutdown(1);
    }, 100);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Failed to resume the conversation.</Text>
      <Text dimColor>
        {validateUuid(sessionId)
          ? `Run claude --resume ${sessionId} to retry, or claude to start a new session.`
          : 'Run claude to start a new session.'}
      </Text>
    </Box>
  );
}

function CrossProjectMessage({ command }: { command: string }): React.ReactNode {
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      void gracefulShutdown(0);
    }, 100);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <Box flexDirection="column" gap={1}>
      <Text>This conversation is from a different directory.</Text>
      <Box flexDirection="column">
        <Text>To resume, run:</Text>
        <Text> {command}</Text>
      </Box>
      <Text dimColor>(Command copied to clipboard)</Text>
    </Box>
  );
}
