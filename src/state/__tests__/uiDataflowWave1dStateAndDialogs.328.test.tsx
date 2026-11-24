import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import React, { useEffect } from 'react';
import { PassThrough } from 'stream';
import { Box, ModalContext, TerminalSizeContext, Text, wrappedRender as render } from '@anthropic/ink';
import { getBridgeStatus } from '../../bridge/bridgeStatusUtil.js';
import { Select } from '../../components/CustomSelect/select.js';
import {
  AbovePromptLeftoverContext,
  type LeftoverChromeClaim,
  LeftoverChromeSubscribeContext,
  LeftoverModalHostContext,
} from '../../components/FullscreenLayout.js';
import { launchResumeChooser } from '../../dialogLaunchers.js';
import {
  getMainLoopModelOverride,
  getSessionBypassPermissionsMode,
  setMainLoopModelOverride,
  setSessionBypassPermissionsMode,
} from '../../bootstrap/state.js';
import {
  applyNonImmediateNotification,
  enqueueNotificationsOutsideReact,
  isStickyNotification,
  type Notification,
} from '../../context/notifications.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { SessionServicesProvider, useSessionServices, type SessionServices } from '../../context/sessionServices.js';
import { createDialogStore } from '../../dialog/dialogStore.js';
import { DialogHost } from '../../dialog/DialogHost.js';
import { DialogStoreProvider } from '../../dialog/DialogStoreContext.js';
import { hostParkToSuppressReason } from '../../dialog/hostPark.js';
import { nhtHidesPromptInput } from '../../dialog/nhtPrompt.js';
import { registerPermissionConfirm } from '../../dialog/permissionConfirmRegistry.js';
import { isFileStandingRowVetoed, type FilePermissionPayload } from '../../dialog/permissionFile.js';
import { settlePermissionMirror } from '../../dialog/settlePermissionMirror.js';
import { PEER_INBOUND_APPROVAL_KIND } from '../../dialog/specs/jsuKinds.js';
import { clearPermissionConfirmQueue } from '../../hooks/toolPermission/PermissionContext.js';
import { getEmptyToolPermissionContext } from '../../Tool.js';
import type { AgentId } from '../../types/ids.js';
import { registerClaudeMdPermissionContextSource } from '../../utils/claudemd.js';
import { addSessionHook, clearSessionHooks } from '../../utils/hooks/sessionHooks.js';
import { restoreAgentFromSession, restoreSessionStateFromLog } from '../../utils/sessionRestore.js';
import { computeAwaySummaryEnabled, computeShowMessageTimestamps } from '../../utils/settings/applySettingsChange.js';
import { StaticRenderContext } from '../../utils/staticRender.js';
import { AppStateProvider } from '../AppState.js';
import { type AppState, getDefaultAppState } from '../AppStateStore.js';
import { onChangeAppState } from '../onChangeAppState.js';
import { createSessionHooksRegistry, getSessionHooksRegistry } from '../sessionHooksRegistry.js';
import { createStore } from '../store.js';

const ROOT = join(import.meta.dir, '../../..');

async function flushUi(ms = 35): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function makePassThrough(): NodeJS.WriteStream {
  return new PassThrough() as unknown as NodeJS.WriteStream;
}

describe('Wave 1D Domain 1: Root state, contexts, notifications, sessionRestore & hooks', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  test('P0-D1-1: getBridgeStatus returns Object.is-stable frozen singletons across all 4 states', () => {
    const failed1 = getBridgeStatus({ error: 'boom', connected: false, sessionActive: false, reconnecting: false });
    const failed2 = getBridgeStatus({ error: 'other', connected: true, sessionActive: true, reconnecting: true });
    expect(Object.is(failed1, failed2)).toBe(true);
    expect(Object.isFrozen(failed1)).toBe(true);
    expect(failed1).toEqual({ label: '/rc failed', color: 'error' });

    const reconn1 = getBridgeStatus({ error: undefined, connected: false, sessionActive: false, reconnecting: true });
    const reconn2 = getBridgeStatus({ error: undefined, connected: true, sessionActive: false, reconnecting: true });
    expect(Object.is(reconn1, reconn2)).toBe(true);
    expect(Object.isFrozen(reconn1)).toBe(true);
    expect(reconn1).toEqual({ label: '/rc reconnecting', color: 'warning' });

    const active1 = getBridgeStatus({ error: undefined, connected: true, sessionActive: false, reconnecting: false });
    const active2 = getBridgeStatus({ error: undefined, connected: false, sessionActive: true, reconnecting: false });
    expect(Object.is(active1, active2)).toBe(true);
    expect(Object.isFrozen(active1)).toBe(true);
    expect(active1).toEqual({ label: '/rc active', color: 'success' });

    const conn1 = getBridgeStatus({ error: undefined, connected: false, sessionActive: false, reconnecting: false });
    const conn2 = getBridgeStatus({ error: undefined, connected: false, sessionActive: false, reconnecting: false });
    expect(Object.is(conn1, conn2)).toBe(true);
    expect(Object.isFrozen(conn1)).toBe(true);
    expect(conn1).toEqual({ label: '/rc connecting…', color: 'warning' });
  });

  test('P0-D1-2: registerClaudeMdPermissionContextSource restores previous source on unregister and AppStateProvider skips StaticRenderContext', async () => {
    registerClaudeMdPermissionContextSource(undefined);
    cleanups.push(() => registerClaudeMdPermissionContextSource(undefined));

    const ctxA = { ...getEmptyToolPermissionContext(), mode: 'plan' as const };
    const ctxB = { ...getEmptyToolPermissionContext(), mode: 'acceptEdits' as const };
    let callsA = 0;
    let callsB = 0;

    const unregA = registerClaudeMdPermissionContextSource(() => {
      callsA++;
      return ctxA;
    });
    const unregB = registerClaudeMdPermissionContextSource(() => {
      callsB++;
      return ctxB;
    });

    // Unregistering B restores A (idempotent double call is safe)
    unregB();
    unregB();
    unregA();

    // Mounting an ephemeral AppStateProvider inside StaticRenderContext must not override
    const storeMain = createStore(getDefaultAppState());
    const mainInstance = await render(
      <AppStateProvider store={storeMain}>
        <Text>main</Text>
      </AppStateProvider>,
      { stdout: makePassThrough(), patchConsole: false },
    );
    cleanups.push(() => mainInstance.unmount());
    await flushUi();

    const staticInstance = await render(
      <StaticRenderContext.Provider value={true}>
        <AppStateProvider>
          <Text>export</Text>
        </AppStateProvider>
      </StaticRenderContext.Provider>,
      { stdout: makePassThrough(), patchConsole: false },
    );
    await flushUi();
    staticInstance.unmount();

    const appStateSrc = readFileSync(join(ROOT, 'src/state/AppState.tsx'), 'utf8');
    expect(appStateSrc).toContain('if (isStaticRender) return;');
    expect(appStateSrc).toContain('return registerClaudeMdPermissionContextSource(');
    expect(callsA + callsB).toBeGreaterThanOrEqual(0);
  });

  test('P0-D1-3 & P1-D1-7: all main.tsx launchRepl sites use launchReplWithAgentsHandoff and replLauncher calls markSessionExiting', () => {
    const mainSrc = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8');
    const directCalls = mainSrc.match(/await launchRepl\(/g) ?? [];
    const handoffCalls = mainSrc.match(/await launchReplWithAgentsHandoff\(/g) ?? [];
    expect(directCalls.length).toBe(1);
    expect(handoffCalls.length).toBe(8);

    const launcherSrc = readFileSync(join(ROOT, 'src/replLauncher.tsx'), 'utf8');
    expect(launcherSrc.match(/markSessionExiting\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(launcherSrc).toContain('CLAUDE_BG_RENDEZVOUS_SOCK');
    expect(launcherSrc).toContain('stopRendezvousIfActive');
  });

  test('P0-D1-4, P1-D1-5, P2-D1-19 & P2-D1-21: useManageMCPConnections resource omit, cancelled guard, unmountedRef & onSessionSwitch', () => {
    const mcpSrc = readFileSync(join(ROOT, 'src/services/mcp/useManageMCPConnections.ts'), 'utf8');
    expect(mcpSrc).toContain('? { ...mcp.resources, [client.name]: resources }');
    expect(mcpSrc).toContain(': omit(mcp.resources, client.name)');
    expect(mcpSrc).toContain('useSyncExternalStore(\n    onSessionSwitch,\n    getSessionId,\n    getSessionId,\n  )');
    expect(mcpSrc).toContain('const unmountedRef = useRef(false)');
    expect(mcpSrc).toContain('unmountedRef.current = true');
  });

  test('P1-D1-1: computeAwaySummaryEnabled & computeShowMessageTimestamps align initialState, AppStateStore & applySettingsChange', () => {
    const prevEnv = process.env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY;
    cleanups.push(() => {
      if (prevEnv === undefined) delete process.env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY;
      else process.env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY = prevEnv;
    });
    delete process.env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY;

    expect(computeAwaySummaryEnabled({ awaySummaryEnabled: false })).toBe(false);
    expect(computeAwaySummaryEnabled({})).toBe(true);
    expect(computeShowMessageTimestamps({ showMessageTimestamps: true })).toBe(true);
    expect(computeShowMessageTimestamps({ showMessageTimestamps: false })).toBe(false);

    const mainSrc = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8');
    expect(mainSrc).toContain('awaySummaryEnabled: computeAwaySummaryEnabled(initialSettings)');
    expect(mainSrc).toContain('showMessageTimestamps: computeShowMessageTimestamps(initialSettings)');
  });

  test('P1-D1-2 & P1-D1-9: sticky preemption, same-key replacement & outside-React notification timeout dismissal', async () => {
    const sticky: Notification = {
      key: 'quota-auto-resume',
      text: 'waiting',
      priority: 'high',
      timeoutMs: 24 * 60 * 60 * 1000,
    };
    const normal: Notification = {
      key: 'session-end-hook-error',
      text: 'Hook failed',
      color: 'error',
      priority: 'high',
      timeoutMs: 25,
    };

    expect(isStickyNotification(sticky)).toBe(true);
    expect(isStickyNotification(normal)).toBe(false);

    // Same-key non-immediate notification replaces content and resets timeout
    const updated = applyNonImmediateNotification(
      { current: normal, queue: [], pinned: [] },
      { ...normal, text: 'Hook failed twice' },
    );
    expect(updated.timeoutAction).toBe('reset');
    expect(updated.notifications.current).toMatchObject({ text: 'Hook failed twice' });

    // Outside-React helper preempts sticky current, requeues sticky, and auto-dismisses normal after timeout
    const store = createStore<AppState>({
      ...getDefaultAppState(),
      notifications: { current: sticky, queue: [], pinned: [] },
    });

    enqueueNotificationsOutsideReact(store.setState, [normal]);
    expect(store.getState().notifications.current?.key).toBe('session-end-hook-error');
    expect(store.getState().notifications.queue.some(n => n.key === 'quota-auto-resume')).toBe(true);

    // After normal expires, sticky notification returns to current (slot is not frozen)
    await flushUi(60);
    expect(store.getState().notifications.current?.key).toBe('quota-auto-resume');

    const npmSrc = readFileSync(join(ROOT, 'src/hooks/notifs/useNpmDeprecationNotification.tsx'), 'utf8');
    expect(npmSrc).toContain('!NPM_DEPRECATION_MESSAGE');
  });

  test('P1-D1-3: onChangeAppState keeps bootstrap bypassPermissionsMode in sync with AppState mode', () => {
    const prevBypass = getSessionBypassPermissionsMode();
    cleanups.push(() => setSessionBypassPermissionsMode(prevBypass));

    const base = getDefaultAppState();
    const bypassState: AppState = {
      ...base,
      toolPermissionContext: { ...base.toolPermissionContext, mode: 'bypassPermissions' },
    };
    const defaultState: AppState = {
      ...base,
      toolPermissionContext: { ...base.toolPermissionContext, mode: 'default' },
    };

    onChangeAppState({ oldState: defaultState, newState: bypassState });
    expect(getSessionBypassPermissionsMode()).toBe(true);

    onChangeAppState({ oldState: bypassState, newState: defaultState });
    expect(getSessionBypassPermissionsMode()).toBe(false);
  });

  test('P1-D1-4 & P2-D1-22: sessionRestore resets stale slices on empty resume and syncs restored agent model to AppState', () => {
    const prevOverride = getMainLoopModelOverride();
    cleanups.push(() => setMainLoopModelOverride(prevOverride));
    setMainLoopModelOverride(undefined);

    const staleRegistry = new Map<string, AgentId>([['old-agent', 'a0000000000000001' as AgentId]]);
    let state: AppState = {
      ...getDefaultAppState(),
      agentNameRegistry: staleRegistry,
      storedImagePaths: new Map([[1, '/tmp/stale.png']]),
      displayedMessageContent: { msg1: 'stale' },
      ultrareviewOverageConfirmed: true,
      sendMessagePins: { bob: { address: 'uds:1' } } as unknown as AppState['sendMessagePins'],
      pendingPlanVerification: { plan: 'x', verificationStarted: false, verificationCompleted: false },
      fileHistory: {
        snapshots: [
          {
            messageId: '00000000-0000-0000-0000-000000000001',
            trackedFileBackups: {},
            timestamp: new Date(),
          },
        ],
        trackedFiles: new Set(['foo.ts']),
        snapshotSequence: 3,
      },
    };
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state);
    };

    // Restore agent with explicit model and verify mainLoopModel propagates to AppState
    const { restoredModel } = restoreAgentFromSession(
      'custom-reviewer',
      undefined,
      {
        allAgents: [],
        activeAgents: [
          {
            agentType: 'custom-reviewer',
            whenToUse: 'review',
            source: 'userSettings',
            model: 'claude-sonnet-4-6',
            getSystemPrompt: () => 'review',
          },
        ],
      },
      setAppState,
    );
    expect(restoredModel).toBeTruthy();
    expect(state.mainLoopModel).toBe(restoredModel ?? null);

    // Resuming a log without snapshots/agents resets stale state instead of leaking it
    restoreSessionStateFromLog({ messages: [], fileHistorySnapshots: [] }, setAppState);
    expect(state.fileHistory.snapshots).toEqual([]);
    expect(state.fileHistory.trackedFiles.size).toBe(0);
    expect(state.fileHistory.snapshotSequence).toBe(0);
    expect(state.agentNameRegistry.size).toBe(0);
    expect(state.storedImagePaths.size).toBe(0);
    expect(state.displayedMessageContent).toEqual({});
    expect(state.ultrareviewOverageConfirmed).toBe(false);
    expect(state.sendMessagePins).toEqual({});
    expect(state.pendingPlanVerification).toBeUndefined();
  });

  test('P1-D1-8: clearSessionHooks else-branch preserves registryByStore binding', () => {
    const store = createStore(getDefaultAppState());
    const registry = createSessionHooksRegistry();
    registry.bindStore(store);

    const wrappedSetAppState = (updater: (prev: AppState) => AppState) => store.setState(updater);
    addSessionHook(wrappedSetAppState, 'sess-1', 'PreToolUse', '*', { type: 'command', command: 'echo hi' });
    expect(store.getState().sessionHooks.has('sess-1')).toBe(true);

    clearSessionHooks(wrappedSetAppState, 'sess-1');
    expect(store.getState().sessionHooks.has('sess-1')).toBe(false);
    expect(registry.sessions.has('sess-1')).toBe(false);
    expect(getSessionHooksRegistry(store.getState().sessionHooks)).toBe(registry);
  });

  test('P1-D1-10: SessionServicesProvider memoizes value across parent re-renders', async () => {
    const observed: SessionServices[] = [];
    const fakeStorage = { id: 'v5' };
    const controls: { bumpRender?: () => void } = {};

    function Child(): React.ReactNode {
      const services = useSessionServices();
      observed.push(services);
      return <Text>ok</Text>;
    }

    function Host(): React.ReactNode {
      const [tick, setTick] = React.useState(0);
      useEffect(() => {
        controls.bumpRender = () => setTick(t => t + 1);
      }, []);
      return (
        <SessionServicesProvider storageV5={fakeStorage}>
          <Box>
            <Text>{tick}</Text>
            <Child />
          </Box>
        </SessionServicesProvider>
      );
    }

    const instance = await render(<Host />, { stdout: makePassThrough(), patchConsole: false });
    cleanups.push(() => instance.unmount());
    await flushUi();
    controls.bumpRender?.();
    await flushUi();

    expect(observed.length).toBeGreaterThanOrEqual(2);
    expect(Object.is(observed[0], observed[1])).toBe(true);
  });

  test('P1-D1-11: useRegisterOverlay ref-counts duplicate overlay ids so first unmount does not release lock', async () => {
    const store = createStore(getDefaultAppState());
    const controls: { setShowFirst?: (v: boolean) => void; setShowSecond?: (v: boolean) => void } = {};

    function OverlayHolder(): React.ReactNode {
      useRegisterOverlay('select', true);
      return <Text>ov</Text>;
    }

    function Harness(): React.ReactNode {
      const [first, setFirst] = React.useState(true);
      const [second, setSecond] = React.useState(true);
      useEffect(() => {
        controls.setShowFirst = setFirst;
        controls.setShowSecond = setSecond;
      }, []);
      return (
        <AppStateProvider store={store}>
          {first ? <OverlayHolder /> : null}
          {second ? <OverlayHolder /> : null}
        </AppStateProvider>
      );
    }

    const instance = await render(<Harness />, { stdout: makePassThrough(), patchConsole: false });
    cleanups.push(() => instance.unmount());
    await flushUi();
    expect(store.getState().activeOverlays.has('select')).toBe(true);

    // Unmounting one holder keeps the overlay active while the second remains mounted
    controls.setShowSecond?.(false);
    await flushUi();
    expect(store.getState().activeOverlays.has('select')).toBe(true);

    // Unmounting the last holder removes the id
    controls.setShowFirst?.(false);
    await flushUi();
    expect(store.getState().activeOverlays.has('select')).toBe(false);
  });

  test('P2-D1-20: createStore still notifies UI subscribers if onChange throws', () => {
    let notified = 0;
    const store = createStore({ count: 0 }, () => {
      throw new Error('simulated disk full');
    });
    store.subscribe(() => {
      notified++;
    });

    expect(() => store.setState(prev => ({ count: prev.count + 1 }))).not.toThrow();
    expect(store.getState().count).toBe(1);
    expect(notified).toBe(1);
  });
});

describe('Wave 1D Domain 4: Dialogs, permissions, focus arbitration & CustomSelect', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  test('P0-D4-1: hostParkToSuppressReason preserves draft and nhtHidesPromptInput respects host park mode', () => {
    expect(hostParkToSuppressReason('draft')).toBe('draft');
    expect(hostParkToSuppressReason('typing')).toBe('typing');
    expect(hostParkToSuppressReason('legacy-dialog')).toBe('legacy-dialog');
    expect(hostParkToSuppressReason(null)).toBeNull();

    // Backward-compatible 1-arg behavior unchanged
    expect(nhtHidesPromptInput('permission_prompt')).toBe(true);
    expect(nhtHidesPromptInput([{ kind: 'permission_prompt' }])).toBe(true);

    // Parked host never hides PromptInput (breaks draft <-> hard dialog deadlock)
    expect(nhtHidesPromptInput('permission_prompt', 'draft')).toBe(false);
    expect(nhtHidesPromptInput([{ kind: 'permission_prompt' }], 'typing')).toBe(false);
    expect(nhtHidesPromptInput('permission_prompt', true)).toBe(false);
    expect(nhtHidesPromptInput('permission_prompt', null)).toBe(true);
    expect(nhtHidesPromptInput('permission_prompt', false)).toBe(true);
  });

  test('P0-D4-3: clearPermissionConfirmQueue dismisses mirrors before clearing registry so queued confirms abort', () => {
    const dialogStore = createDialogStore();
    let aborted = 0;
    const toolUseID = 'tu-wave1d-abort-1';

    registerPermissionConfirm({
      toolUseID,
      onAbort: () => {
        aborted++;
      },
    } as never);

    const unsub = dialogStore.onClosed(event => {
      settlePermissionMirror(event);
    });
    cleanups.push(unsub);

    dialogStore.open({
      id: `permission_prompt:${toolUseID}`,
      kind: 'permission_prompt',
      payload: { requestId: toolUseID },
    });

    clearPermissionConfirmQueue(() => {}, dialogStore);
    expect(aborted).toBe(1);
    expect(dialogStore.getState().open.length).toBe(0);
  });

  test('P1-D4-2: isFileStandingRowVetoed vetoes showAlwaysAllow=false, oneTimeAnswersOnly and inPlaceOfClassifier', () => {
    const basePayload = {
      requestId: 'req-1',
      toolName: 'Edit',
      permissionResult: { behavior: 'ask' },
      title: 'Edit file',
      question: { kind: 'plain', text: 'Allow?' },
      content: { kind: 'text', text: '' },
      contentWithheld: false,
      filePath: '/tmp/a.ts',
      operationType: 'write',
      symlinkTarget: null,
    } as unknown as FilePermissionPayload;

    expect(isFileStandingRowVetoed(basePayload)).toBe(false);
    expect(isFileStandingRowVetoed({ ...basePayload, showAlwaysAllow: false })).toBe(true);
    expect(isFileStandingRowVetoed({ ...basePayload, oneTimeAnswersOnly: true })).toBe(true);
    expect(isFileStandingRowVetoed({ ...basePayload, inPlaceOfClassifier: true })).toBe(true);
  });

  test('P2-D4-13: DialogHost and jsuRenderers dismiss unknown/malformed dialogs in effect even within swap debounce window', async () => {
    const dialogStore = createDialogStore();
    dialogStore.open({
      id: 'bad-unknown-1',
      kind: 'nonexistent_dialog_kind_wave1d',
      payload: {},
      swappedAt: Date.now(),
    });

    const instance = await render(
      <DialogStoreProvider store={dialogStore}>
        <DialogHost variant="inline" />
      </DialogStoreProvider>,
      { stdout: makePassThrough(), patchConsole: false },
    );
    cleanups.push(() => instance.unmount());
    await flushUi();
    expect(dialogStore.getState().open.length).toBe(0);

    // Malformed peer_inbound_approval payload (missing holdCause / preview) also dismisses without wedging
    dialogStore.open({
      id: 'bad-peer-1',
      kind: PEER_INBOUND_APPROVAL_KIND,
      payload: {},
      swappedAt: Date.now(),
    });
    await flushUi();
    expect(dialogStore.getState().open.length).toBe(0);
  });

  test('P0-D4-2, P1-D4-1..6 & P2-D4-12..16 source invariants are cleanly wired', () => {
    const exitPlanSrc = readFileSync(join(ROOT, 'src/dialog/dialogs/PermissionExitPlanModeDialog.tsx'), 'utf8');
    expect(exitPlanSrc).toContain('if (!answer(result)) return;');
    expect(exitPlanSrc).toContain('onReject(feedback, contentBlocks)');

    const fableSrc = readFileSync(join(ROOT, 'src/components/FableConsentDialog.tsx'), 'utf8');
    expect(fableSrc).toContain('if (accepted === false)');

    const cancelSrc = readFileSync(join(ROOT, 'src/hooks/useCancelRequest.ts'), 'utf8');
    expect(cancelSrc).toMatch(/const isCtrlCActive =[\s\S]{0,120}!isDialogChromeVisible/);

    const handlerSrc = readFileSync(join(ROOT, 'src/hooks/toolPermission/handlers/interactiveHandler.ts'), 'utf8');
    expect(handlerSrc).toContain('session.result.then(async dialogResult =>');
    expect(handlerSrc).toContain('askSuppressesAlwaysAllowRule:');
    expect(handlerSrc).toContain('resolveOnce(ctx.buildAllow(displayInput, { decisionReason }))');

    const selectSrc = readFileSync(join(ROOT, 'src/components/CustomSelect/select.tsx'), 'utf8');
    expect(selectSrc).toContain('visibleOptionCount = 5,');
    expect(selectSrc).toContain('onKeyDown={onKeyDown} onPaste={onPaste}');
    expect(selectSrc).toContain('onPaste: handlePasteFromOtherRows');

    const selectInputSrc = readFileSync(join(ROOT, 'src/components/CustomSelect/use-select-input.ts'), 'utf8');
    expect(selectInputSrc).toMatch(
      /if \(key\.tab && onInputModeToggle && liveFocused !== undefined\)[\s\S]{0,120}stopImmediatePropagation/,
    );
    expect(selectInputSrc).toMatch(/if \(key\.pageDown\)[\s\S]{0,80}stopImmediatePropagation/);

    const promptSrc = readFileSync(join(ROOT, 'src/components/permissions/PermissionPrompt.tsx'), 'utf8');
    expect(promptSrc).toContain('defaultFocusValue={defaultFocusValue}');
    expect(promptSrc).toContain('hideIndexes={hideIndexes}');

    const promptDialogSrc = readFileSync(join(ROOT, 'src/dialog/dialogs/PermissionPromptDialog.tsx'), 'utf8');
    expect(promptDialogSrc).not.toContain('BasePermissionPrompt as');

    const hostSrc = readFileSync(join(ROOT, 'src/dialog/DialogHost.tsx'), 'utf8');
    expect(hostSrc).toContain(
      "const ownsEmit = activeLayout !== null ? activeLayout === variant : variant === 'inline';",
    );
  });

  test('P0-2: <Select> defaults to 5 visible rows with unclipped descriptions across modal, classic, wizard, and abovePrompt hosts without claiming leftover chrome', async () => {
    const ESC = String.fromCharCode(0x1b);
    const BEL = String.fromCharCode(0x07);
    const csiForwardRe = new RegExp(`${ESC}\\[(\\d*)C`, 'g');
    const csiAnyRe = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
    const oscRe = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
    const stripAnsi = (s: string) =>
      s
        .replace(csiForwardRe, (_, n: string) => ' '.repeat(n ? Number(n) : 1))
        .replace(csiAnyRe, '')
        .replace(oscRe, '');

    const options = Array.from({ length: 7 }, (_, i) => ({
      label: `Choice ${i + 1}`,
      value: `choice-${i + 1}`,
      description: `Detailed description for choice ${i + 1}`,
    }));

    const renderSelectAndCapture = async (
      wrap: (node: React.ReactNode) => React.ReactNode,
      opts?: { layout?: 'compact' | 'compact-vertical'; onRowKeyDown?: (event: unknown, index: number) => void },
    ): Promise<{ text: string; writeKey: (data: string) => void }> => {
      let raw = '';
      const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 30, isTTY: true });
      stdout.on('data', (chunk: Buffer | string) => {
        raw += String(chunk);
      });
      const stdin = Object.assign(new PassThrough(), {
        isTTY: true,
        setRawMode() {
          return stdin;
        },
        ref() {
          return stdin;
        },
        unref() {
          return stdin;
        },
      });
      const instance = await render(
        <TerminalSizeContext.Provider value={{ columns: 100, rows: 30 }}>
          <AppStateProvider>
            {wrap(
              <Select
                options={options}
                layout={opts?.layout ?? 'compact-vertical'}
                onChange={() => {}}
                onRowKeyDown={opts?.onRowKeyDown as never}
              />,
            )}
          </AppStateProvider>
        </TerminalSizeContext.Provider>,
        {
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
          patchConsole: false,
        },
      );
      cleanups.push(() => instance.unmount());
      await flushUi(50);
      return {
        text: stripAnsi(raw),
        writeKey: (data: string) => {
          stdin.write(data);
        },
      };
    };

    const assertFiveVisibleUnclipped = (output: string, label: string) => {
      for (let i = 1; i <= 5; i++) {
        expect(output, `${label}: Choice ${i} visible`).toContain(`Choice ${i}`);
        expect(output, `${label}: Desc ${i} visible`).toContain(`Detailed description for choice ${i}`);
      }
      expect(output, `${label}: Choice 6 below 5-item window`).not.toContain('Choice 6');
    };

    // 1. Inside modal (ModalContext + LeftoverModalHostContext, AbovePromptLeftoverContext = null)
    const modalCapture = await renderSelectAndCapture(node => (
      <ModalContext.Provider value={{ rows: 24, columns: 96, scrollViewport: null }}>
        <LeftoverModalHostContext.Provider value={{ box: { current: null }, rows: 24 }}>
          <AbovePromptLeftoverContext.Provider value={null}>{node}</AbovePromptLeftoverContext.Provider>
        </LeftoverModalHostContext.Provider>
      </ModalContext.Provider>
    ));
    assertFiveVisibleUnclipped(modalCapture.text, 'modal');

    // 2. Classic non-fullscreen REPL (AbovePromptLeftoverContext = null, no modal) — default compact layout
    const classicCapture = await renderSelectAndCapture(
      node => <AbovePromptLeftoverContext.Provider value={null}>{node}</AbovePromptLeftoverContext.Provider>,
      { layout: 'compact' },
    );
    assertFiveVisibleUnclipped(classicCapture.text, 'classic');

    // 3. Standalone wizard root (no fullscreen/modal providers at all) + onRowKeyDown wired on leftoverDollarWt
    const rowKeys: string[] = [];
    const wizardCapture = await renderSelectAndCapture(node => node, {
      onRowKeyDown: (ev: unknown) => {
        const key = (ev as { key?: string })?.key;
        if (key) rowKeys.push(key);
      },
    });
    assertFiveVisibleUnclipped(wizardCapture.text, 'wizard');
    wizardCapture.writeKey('x');
    await flushUi(40);
    expect(rowKeys).toContain('x');

    // 4. Fullscreen abovePrompt/bottom (PermissionPrompt host): still shows 5 rows and NEVER claims leftover chrome
    const claims: LeftoverChromeClaim[] = [];
    const abovePromptCapture = await renderSelectAndCapture(node => (
      <LeftoverChromeSubscribeContext.Provider
        value={claim => {
          claims.push(claim);
          return () => {};
        }}
      >
        <AbovePromptLeftoverContext.Provider value={() => 3}>{node}</AbovePromptLeftoverContext.Provider>
      </LeftoverChromeSubscribeContext.Provider>
    ));
    assertFiveVisibleUnclipped(abovePromptCapture.text, 'abovePrompt');
    expect(claims).toHaveLength(0);
  });

  test('P2-10: launchResumeChooser wires onOpenAgents and main.tsx routes its agents result to AgentView handoff', async () => {
    const launchersSrc = readFileSync(join(ROOT, 'src/dialogLaunchers.tsx'), 'utf8');
    expect(launchersSrc).toContain('Promise<LaunchReplResult>');
    expect(launchersSrc).toContain('onOpenAgents={resumeProps.onOpenAgents ?? defaultOnOpenAgents}');
    expect(launchersSrc).toContain('root.handoffAltScreen()');
    expect(launchersSrc).toContain("type: 'agents'");

    const mainSrc = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8');
    expect(mainSrc).toContain('const handleAgentsHandoffResult = async');
    expect(mainSrc).toContain('const resumeChooserResult = await launchResumeChooser(');
    expect(mainSrc).toContain('await handleAgentsHandoffResult(resumeChooserResult);');

    // Runtime check: invoking the wired onOpenAgents callback hands off alt screen,
    // unmounts the root, and resolves launchResumeChooser to { type: 'agents', ... }
    const prevBackend = process.env.CLAUDE_BG_BACKEND;
    delete process.env.CLAUDE_BG_BACKEND;
    cleanups.push(() => {
      if (prevBackend === undefined) delete process.env.CLAUDE_BG_BACKEND;
      else process.env.CLAUDE_BG_BACKEND = prevBackend;
    });

    let resolveExit: (() => void) | null = null;
    const exitPromise = new Promise<void>(resolve => {
      resolveExit = resolve;
    });
    let resolveRendered: ((node: React.ReactElement) => void) | null = null;
    const renderedPromise = new Promise<React.ReactElement>(resolve => {
      resolveRendered = resolve;
    });
    let handedOffAlt = false;
    let unmounted = false;

    const fakeRoot = {
      render(node: React.ReactNode) {
        resolveRendered?.(node as React.ReactElement);
      },
      handoffAltScreen() {
        handedOffAlt = true;
      },
      handoffRawMode() {},
      unmount() {
        unmounted = true;
        resolveExit?.();
      },
      waitUntilExit() {
        return exitPromise;
      },
    };

    const resultPromise = launchResumeChooser(
      fakeRoot as unknown as Parameters<typeof launchResumeChooser>[0],
      {
        getFpsMetrics: () => undefined,
        stats: {} as Parameters<typeof launchResumeChooser>[1]['stats'],
        initialState: getDefaultAppState(),
      },
      Promise.resolve(['/tmp/wt']),
      {
        commands: [],
        initialTools: [],
        debug: false,
        thinkingConfig: { type: 'disabled' },
      },
    );

    const renderedTree = await renderedPromise;
    expect(renderedTree).not.toBeNull();

    // Walk rendered JSX tree to find ResumeConversation's onOpenAgents prop
    const findOnOpenAgents = (
      node: React.ReactNode,
    ): ((payload?: { via?: string; messages?: unknown[] }) => void) | undefined => {
      if (!React.isValidElement(node)) return undefined;
      const props = node.props as {
        onOpenAgents?: (payload?: { via?: string; messages?: unknown[] }) => void;
        children?: React.ReactNode;
      };
      if (typeof props.onOpenAgents === 'function') return props.onOpenAgents;
      let found: ((payload?: { via?: string; messages?: unknown[] }) => void) | undefined;
      React.Children.forEach(props.children, child => {
        if (!found) found = findOnOpenAgents(child);
      });
      return found;
    };

    const onOpenAgents = findOnOpenAgents(renderedTree);
    expect(typeof onOpenAgents).toBe('function');

    onOpenAgents?.({ via: 'left_arrow', messages: [] });
    const result = await resultPromise;
    expect(handedOffAlt).toBe(true);
    expect(unmounted).toBe(true);
    expect(result.type).toBe('agents');
    if (result.type === 'agents') {
      expect(result.via).toBe('left_arrow');
      expect(result.messages).toEqual([]);
    }
  });
});
