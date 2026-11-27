import { Text } from '@anthropic/ink';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import {
  classifySandboxNetworkAccess,
  resolveSandboxNetworkAskDecision,
  SandboxNetworkVerdictCache,
  sandboxNetworkTranscriptWatermark,
} from 'src/utils/sandbox/sandboxNetworkDecision.js';
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js';
import type { Notification } from '../../context/notifications.js';
import type { DialogStore, RequestDialog } from '../../dialog/index.js';
import { SandboxNetworkAccessAsker } from '../../dialog/sandboxNetworkAccess.js';
import useCanUseTool, { type CanUseToolFn } from '../../hooks/useCanUseTool.js';
import { registerSandboxPermissionCallback } from '../../hooks/useSwarmPermissionPoller.js';
import type { AppState } from '../../state/AppStateStore.js';
import type { Store } from '../../state/store.js';
import type { ToolPermissionContext, Tools } from '../../Tool.js';
import type { PromptRequest, PromptResponse } from '../../types/hooks.js';
import type { Message as MessageType } from '../../types/message.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage } from '../../utils/errors.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import type { SetAppState } from '../../utils/messageQueueManager.js';
import { applyPermissionUpdate, persistPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js';
import { createAppStatePermissionContextSetters } from '../../utils/permissions/permissionContextSetters.js';
import { onPermissionRecheck } from '../../utils/permissions/permissionRecheck.js';
import type { NetworkHostPattern, SandboxAskCallback } from '../../utils/sandbox/sandbox-adapter.js';
import {
  registerLeaderSetToolPermissionContext,
  registerLeaderToolUseConfirmQueue,
  unregisterLeaderSetToolPermissionContext,
  unregisterLeaderToolUseConfirmQueue,
} from '../../utils/swarm/leaderPermissionBridge.js';
import {
  generateSandboxRequestId,
  isSwarmWorker,
  sendSandboxPermissionRequestViaMailbox,
} from '../../utils/swarm/permissionSync.js';
import type { PromptQueueItem } from './types.js';

/**
 * Manages sandbox network-access asking + initialization (with Stage-1
 * `useEffect` wrapper around `SandboxManager.initialize`), permission context
 * setters, leader permission bridge registration, `canUseTool`, and hook prompts.
 */
export function useReplSandboxAndPermissions(params: {
  store: Store<AppState>;
  setAppState: SetAppState;
  requestDialog: RequestDialog;
  dialogStore: DialogStore;
  toolPermissionContext: ToolPermissionContext;
  mergedTools: Tools;
  messagesRef: React.RefObject<MessageType[]>;
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>;
  setPromptQueue: React.Dispatch<React.SetStateAction<PromptQueueItem[]>>;
  addNotification: (notif: Notification) => void;
}): {
  sandboxAsker: SandboxNetworkAccessAsker;
  sandboxNetworkVerdictCacheRef: React.RefObject<SandboxNetworkVerdictCache>;
  setSessionToolPermissionContext: ReturnType<
    typeof createAppStatePermissionContextSetters
  >['setSessionToolPermissionContext'];
  setToolPermissionContext: (context: ToolPermissionContext, options?: { preserveMode?: boolean }) => void;
  canUseTool: CanUseToolFn;
  requestPrompt: (
    title: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>;
} {
  const {
    store,
    setAppState,
    requestDialog,
    dialogStore,
    toolPermissionContext,
    mergedTools,
    messagesRef,
    setToolUseConfirmQueue,
    setPromptQueue,
    addNotification,
  } = params;

  const mergedToolsRef = useRef(mergedTools);
  mergedToolsRef.current = mergedTools;

  const sandboxNetworkVerdictCacheRef = useRef(new SandboxNetworkVerdictCache());
  useEffect(() => {
    sandboxNetworkVerdictCacheRef.current.clear();
  }, [toolPermissionContext.mode, toolPermissionContext.isBypassPermissionsModeAvailable]);

  const [sandboxAsker] = useState(
    () =>
      new SandboxNetworkAccessAsker({
        requestDialog,
        getBridge: () => store.getState().replBridgePermissionCallbacks,
        applyPermissionUpdate: update => {
          setAppState(prev => ({
            ...prev,
            toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, update),
          }));
          persistPermissionUpdate(update);
          SandboxManager.refreshConfig();
        },
      }),
  );

  // Register the leader's setToolUseConfirmQueue for in-process teammates
  useEffect(() => {
    registerLeaderToolUseConfirmQueue(setToolUseConfirmQueue, dialogStore);
    return () => unregisterLeaderToolUseConfirmQueue();
  }, [setToolUseConfirmQueue, dialogStore]);

  const sandboxAskCallback: SandboxAskCallback = useCallback(
    async (hostPattern: NetworkHostPattern) => {
      const appStateNow = store.getState();
      const { mode, isBypassPermissionsModeAvailable, prePlanMode } = appStateNow.toolPermissionContext;
      switch (resolveSandboxNetworkAskDecision(mode, isBypassPermissionsModeAvailable, prePlanMode)) {
        case 'allow':
          return true;
        case 'deny':
          return false;
        case 'classify': {
          const messagesNow = messagesRef.current;
          return sandboxNetworkVerdictCacheRef.current.getOrClassify(
            hostPattern.host,
            hostPattern.port,
            sandboxNetworkTranscriptWatermark(messagesNow),
            () =>
              classifySandboxNetworkAccess(
                hostPattern.host,
                hostPattern.port,
                messagesNow,
                mergedToolsRef.current,
                store.getState().toolPermissionContext,
                new AbortController().signal,
              ),
          );
        }
        case 'ask':
          break;
      }

      // If running as a swarm worker, forward the request to the leader via mailbox
      if (isAgentSwarmsEnabled() && isSwarmWorker()) {
        const requestId = generateSandboxRequestId();
        const sent = await sendSandboxPermissionRequestViaMailbox(hostPattern.host, requestId);

        if (!sent) {
          return sandboxAsker.ask(hostPattern);
        }

        return new Promise(resolveShouldAllowHost => {
          registerSandboxPermissionCallback({
            requestId,
            host: hostPattern.host,
            resolve: resolveShouldAllowHost,
          });

          setAppState(prev => ({
            ...prev,
            pendingSandboxRequest: {
              requestId,
              host: hostPattern.host,
            },
          }));
        });
      }

      return sandboxAsker.ask(hostPattern);
    },
    [setAppState, store, sandboxAsker, messagesRef],
  );

  // #34044: surface sandbox unavailability or hosted-container waiver once at mount
  useEffect(() => {
    const reason = SandboxManager.getSandboxUnavailableReason();
    if (!SandboxManager.isSandboxRequired() && SandboxManager.isSandboxRequirementSetAsideInHostedWorker()) {
      logForDebugging(
        `sandbox.failIfUnavailable set aside in hosted container (no command sandbox)${reason ? `: ${reason}` : ''}`,
        { level: 'warn' },
      );
      addNotification({
        key: 'sandbox-unavailable-hosted',
        text: 'Hosted container has no command sandbox (sandbox.failIfUnavailable set aside)',
        color: 'warning',
        priority: 'high',
      });
      return;
    }
    if (reason) {
      if (SandboxManager.isSandboxRequired()) {
        process.stderr.write(
          `\nError: sandbox required but unavailable: ${reason}\n` +
            `  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n\n`,
        );
        gracefulShutdownSync(1, 'other');
        return;
      }
      logForDebugging(`sandbox disabled: ${reason}`, { level: 'warn' });
      addNotification({
        key: 'sandbox-unavailable',
        jsx: (
          <>
            <Text color="warning">sandbox disabled</Text>
            <Text dimColor> · /sandbox</Text>
          </>
        ),
        priority: 'medium',
      });
    }
    const maskWarning = reason ? undefined : SandboxManager.getMaskCredentialWarning();
    if (maskWarning) {
      logForDebugging(`sandbox: ${maskWarning}`, { level: 'warn' });
    }
  }, [addNotification]);

  // Stage-1 fix preserved: initialize SandboxManager inside useEffect, not render.
  useEffect(() => {
    if (SandboxManager.isSandboxingEnabled()) {
      SandboxManager.initialize(sandboxAskCallback).catch(err => {
        process.stderr.write(`\n❌ Sandbox Error: ${errorMessage(err)}\n`);
        gracefulShutdownSync(1, 'other');
      });
    }
  }, [sandboxAskCallback]);

  // densable y8r(setAppState) — both ToolUseContext setters share this writer.
  const { setSessionToolPermissionContext } = useMemo(
    () => createAppStatePermissionContextSetters(setAppState),
    [setAppState],
  );

  const setToolPermissionContext = useCallback(
    (context: ToolPermissionContext, options?: { preserveMode?: boolean }) => {
      setAppState(prev => ({
        ...prev,
        toolPermissionContext: {
          ...context,
          mode: options?.preserveMode ? prev.toolPermissionContext.mode : context.mode,
        },
      }));

      setImmediate(setQueue => {
        setQueue(currentQueue => {
          currentQueue.forEach(item => {
            void item.recheckPermission();
          });
          return currentQueue;
        });
      }, setToolUseConfirmQueue);
    },
    [setAppState, setToolUseConfirmQueue],
  );

  // densable n3e → permissionRecheck: session persist path emits; recheck queue.
  useEffect(() => {
    return onPermissionRecheck(() => {
      setToolUseConfirmQueue(currentQueue => {
        currentQueue.forEach(item => {
          void item.recheckPermission();
        });
        return currentQueue;
      });
    });
  }, [setToolUseConfirmQueue]);

  // Register the leader's setToolPermissionContext for in-process teammates
  useEffect(() => {
    registerLeaderSetToolPermissionContext(setToolPermissionContext);
    return () => unregisterLeaderSetToolPermissionContext();
  }, [setToolPermissionContext]);

  const canUseTool = useCanUseTool(setToolUseConfirmQueue, dialogStore);

  const requestPrompt = useCallback(
    (title: string, toolInputSummary?: string | null) =>
      (request: PromptRequest): Promise<PromptResponse> =>
        new Promise<PromptResponse>((resolve, reject) => {
          setPromptQueue(prev => [...prev, { request, title, toolInputSummary, resolve, reject }]);
        }),
    [setPromptQueue],
  );

  return {
    sandboxAsker,
    sandboxNetworkVerdictCacheRef,
    setSessionToolPermissionContext,
    setToolPermissionContext,
    canUseTool,
    requestPrompt,
  };
}
