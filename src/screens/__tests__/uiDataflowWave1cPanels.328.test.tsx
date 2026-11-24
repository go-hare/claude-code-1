import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { launchCommand } from '../../commands/_shared/launchCommand.js';
import type { SessionEntry } from '../../cli/bg/engine.js';
import { getMainLoopModelOverride, setMainLoopModelOverride } from '../../bootstrap/state.js';
import { type AppState, getDefaultAppState } from '../../state/AppStateStore.js';
import { restoreAgentFromSession, restoreSessionStateFromLog } from '../../utils/sessionRestore.js';
import {
  AGENT_VIEW_ESC_CLEAR_HINT,
  AGENT_VIEW_RESTORE_HINT,
  buildFleetSessionExtraArgs,
  findPinnedSessionToAutoRelaunch,
  restoreAgentViewKilledDraft,
  stepAgentViewEscapeDraft,
} from '../AgentView.js';
import {
  clearFleetLauncherDraftSync,
  loadFleetLauncherDraft,
  persistFleetLauncherDraftSync,
} from '../fleetView/launcherDraft.js';

const SRC = join(import.meta.dir, '../..');
const readSrc = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

function makeSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    pid: 4242,
    sessionId: '11111111-2222-3333-4444-555555555555',
    short: '11111111',
    cwd: '/tmp/project',
    startedAt: Date.now() - 5000,
    kind: 'bg',
    name: 'worker-a',
    pinned: true,
    archived: false,
    ...overrides,
  };
}

describe('Wave 1C Domain 5 — Secondary TUI Screens & Interactive Panels', () => {
  const tmpDirs: string[] = [];
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    if (savedConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
    }
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // P0 Fixes (3)
  // -------------------------------------------------------------------------

  test('P0-D5-1: WorkflowHistoryDialog auto-opens single item only once and attaches clockRef', () => {
    const src = readSrc('workflow/panel/WorkflowHistoryDialog.tsx');
    expect(src).toContain('const didAutoOpenRef = useRef(false)');
    expect(src).toContain("if (!loading && items.length === 1 && mode.mode === 'list' && !didAutoOpenRef.current)");
    expect(src).toContain('didAutoOpenRef.current = true');
    expect(src).toContain('onOpenLiveDetail(only.taskId)');
    expect(src).toContain('ref={clockRef}');
  });

  test('P0-D5-2: AgentView memoizes collapsedGroups and draft hook compares collapsed by value', () => {
    const agentSrc = readSrc('screens/AgentView.tsx');
    const hookSrc = readSrc('screens/fleetView/useFleetComposerDraftPersistence.ts');
    expect(agentSrc).toContain('const collapsedGroups = useMemo(() => [...foldedGroups], [foldedGroups]);');
    expect(agentSrc).toContain('collapsed: collapsedGroups');
    expect(hookSrc).toContain('function stringArraysEqual');
    expect(hookSrc).toContain('!stringArraysEqual(collapsed, prev.collapsed)');
  });

  test('P0-D5-3: Config.tsx permissionMode writes userSettings.permissions only (no merged settings leak)', () => {
    const src = readSrc('components/Settings/Config.tsx');
    expect(src).toContain("const userPerms = getSettingsForSource('userSettings')?.permissions;");
    expect(src).toMatch(/permissions:\s*\{\s*\.\.\.userPerms,\s*defaultMode:\s*validatedMode/);
    expect(src).not.toMatch(/permissions:\s*\{\s*\.\.\.settingsData\?\.permissions,\s*defaultMode:\s*validatedMode/);
  });

  // -------------------------------------------------------------------------
  // P1 Fixes — Cloud Commands & AgentView
  // -------------------------------------------------------------------------

  test('P1-D5-1: launchCommand supports formatSummary without double-calling onDone and cloud commands format structured records', async () => {
    const DummyView: React.FC<{ items: string[] }> = () => React.createElement('text', null, 'ok');
    const onDoneCalls: Array<{ text: string | undefined; display?: string }> = [];

    const callCmd = launchCommand<{ action: 'list' }, { items: string[] }>({
      commandName: 'test-cloud',
      parseArgs: () => ({ action: 'list' }),
      dispatch: async () => ({ items: ['id-1', 'id-2'] }),
      formatSummary: props => `Items:\n${props.items.map(i => `- ${i}`).join('\n')}`,
      View: DummyView,
      errorView: msg => React.createElement('text', null, msg),
    });

    const node = await callCmd(
      (text, opts) => {
        onDoneCalls.push({ text, display: opts?.display });
      },
      {} as Parameters<typeof callCmd>[1],
      'list',
    );
    expect(node).not.toBeNull();
    expect(onDoneCalls).toHaveLength(1);
    expect(onDoneCalls[0]?.text).toContain('- id-1');
    expect(onDoneCalls[0]?.text).toContain('- id-2');
    expect(onDoneCalls[0]?.display).toBe('system');

    // Verify all 5 cloud command launchers include structured summaries in onDone
    expect(readSrc('commands/schedule/launchSchedule.tsx')).toContain('formatTriggerRow');
    expect(readSrc('commands/schedule/launchSchedule.tsx')).toContain('formatTriggerDetail');
    expect(readSrc('commands/vault/launchVault.tsx')).toContain('formatVaultRow');
    expect(readSrc('commands/vault/launchVault.tsx')).toContain('Value: ***mask***');
    expect(readSrc('commands/skill-store/launchSkillStore.tsx')).toContain('formatSkillRow');
    expect(readSrc('commands/skill-store/launchSkillStore.tsx')).toContain('formatSkillDetail');
    expect(readSrc('commands/skill-store/launchSkillStore.tsx')).toContain('formatSkillVersionRow');
    expect(readSrc('commands/agents-platform/launchAgentsPlatform.tsx')).toContain('formatAgentRow');
    expect(readSrc('commands/memory-stores/launchMemoryStores.tsx')).toContain('formatStoreRow');
    expect(readSrc('commands/memory-stores/launchMemoryStores.tsx')).toContain('formatMemoryDetail');
  });

  test('P1-D5-2: persistFleetLauncherDraftSync & clearFleetLauncherDraftSync persist synchronously and AgentView wraps SessionServices', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cc-wave1c-draft-'));
    tmpDirs.push(tmp);
    process.env.CLAUDE_CONFIG_DIR = tmp;

    const cwd = '/tmp/wave1c-sync-project';
    const saved = persistFleetLauncherDraftSync(cwd, {
      q: 'run integration tests',
      collapsed: ['done'],
    });
    expect(saved).toBe(true);

    const loaded = await loadFleetLauncherDraft(cwd);
    expect(loaded).toEqual({
      q: 'run integration tests',
      collapsed: ['done'],
    });

    expect(clearFleetLauncherDraftSync(cwd)).toBe(true);
    const afterClear = await loadFleetLauncherDraft(cwd);
    expect(afterClear).toBeUndefined();

    expect(readSrc('screens/fleetView/useFleetComposerDraftPersistence.ts')).toContain(
      'persistFleetLauncherDraftSync(',
    );
    expect(readSrc('screens/AgentView.tsx')).toContain('wrapWithSessionServices(');
  });

  test('P1-D5-3: buildFleetSessionExtraArgs wires /model, /effort, and /fast into spawn and relaunch args', () => {
    const res = buildFleetSessionExtraArgs({
      dispatchDefaults: { model: 'sonnet', effort: 'medium', permissionMode: 'plan' },
      dispatchExtraArgs: ['--add-dir', '/tmp/extra'],
      sessionModel: 'opus',
      sessionEffort: 'max',
      sessionFastMode: true,
    });
    expect(res.effectiveDefaults).toEqual({
      model: 'opus',
      effort: 'max',
      permissionMode: 'plan',
    });
    expect(res.spawnExtraArgs).toContain('--model');
    expect(res.spawnExtraArgs[res.spawnExtraArgs.indexOf('--model') + 1]).toBe('opus');
    expect(res.spawnExtraArgs).toContain('--effort');
    expect(res.spawnExtraArgs[res.spawnExtraArgs.indexOf('--effort') + 1]).toBe('max');
    expect(res.spawnExtraArgs).toContain('--settings');
    expect(res.spawnExtraArgs[res.spawnExtraArgs.indexOf('--settings') + 1]).toBe('{"fastMode":true}');
    expect(res.relaunchExtraArgs).toContain('--settings');

    // Merges fastMode into existing inline --settings JSON instead of duplicating flag
    const merged = buildFleetSessionExtraArgs({
      dispatchExtraArgs: ['--settings', '{"theme":"dark"}'],
      sessionFastMode: false,
    });
    const settingsIdx = merged.relaunchExtraArgs.indexOf('--settings');
    expect(settingsIdx).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(merged.relaunchExtraArgs[settingsIdx + 1]!)).toEqual({
      theme: 'dark',
      fastMode: false,
    });
    expect(merged.relaunchExtraArgs.filter(a => a === '--settings')).toHaveLength(1);
  });

  test('P1-D5-4: AgentView Ctrl+R rename patches daemon job state.json in addition to live PID registry', () => {
    const src = readSrc('screens/AgentView.tsx');
    expect(src).toContain("patchBgJobState(short, { name: newName, nameSource: 'user' })");
    expect(src).toContain('if (session.pid > 0) {');
  });

  test('P1-D5-5: findPinnedSessionToAutoRelaunch skips pid===0 placeholders, user-deleted, user-archived, and still-present sessions', () => {
    const livePinned = makeSession({ pid: 5001, short: 'aaa11111', sessionId: 'aaa11111-0000' });
    const startupPlaceholder = makeSession({ pid: 0, short: 'bbb22222', sessionId: 'bbb22222-0000' });

    // 1. pid === 0 startup placeholder never triggers relaunch
    expect(
      findPinnedSessionToAutoRelaunch({
        previousPinned: new Map([['bbb22222', startupPlaceholder]]),
        currentSessions: [],
        userRemovedIds: new Set(),
        deletedJobIds: new Set(),
        deletedSessionIds: new Set(),
      }),
    ).toBeNull();

    // 2. User-deleted or user-archived pinned session never triggers relaunch
    expect(
      findPinnedSessionToAutoRelaunch({
        previousPinned: new Map([['aaa11111', livePinned]]),
        currentSessions: [],
        userRemovedIds: new Set(['aaa11111']),
        deletedJobIds: new Set(),
        deletedSessionIds: new Set(),
      }),
    ).toBeNull();

    // 3. Session still present with a new PID or archived=true never triggers relaunch
    expect(
      findPinnedSessionToAutoRelaunch({
        previousPinned: new Map([['aaa11111', livePinned]]),
        currentSessions: [makeSession({ pid: 9999, short: 'aaa11111', archived: true, pinned: false })],
        userRemovedIds: new Set(),
        deletedJobIds: new Set(),
        deletedSessionIds: new Set(),
      }),
    ).toBeNull();

    // 4. Genuinely vanished live pinned session triggers relaunch
    expect(
      findPinnedSessionToAutoRelaunch({
        previousPinned: new Map([['aaa11111', livePinned]]),
        currentSessions: [makeSession({ pid: 6002, short: 'ccc33333', sessionId: 'ccc33333-0000' })],
        userRemovedIds: new Set(),
        deletedJobIds: new Set(),
        deletedSessionIds: new Set(),
      }),
    ).toEqual(livePinned);
  });

  test('P1-D5-6: AgentView dispatch mode uses double-Esc kill-buffer, Ctrl+Y yank, and confirmed Ctrl+X', () => {
    const first = stepAgentViewEscapeDraft({
      simpleView: false,
      queryIsFilter: false,
      dispatchInput: 'important prompt',
      currentHint: null,
    });
    expect(first.action).toBe('arm');
    expect(first.nextHint).toBe(AGENT_VIEW_ESC_CLEAR_HINT);

    const second = stepAgentViewEscapeDraft({
      simpleView: false,
      queryIsFilter: false,
      dispatchInput: 'important prompt',
      currentHint: AGENT_VIEW_ESC_CLEAR_HINT,
    });
    expect(second.action).toBe('clear');
    expect(second.killedText).toBe('important prompt');
    expect(second.nextHint).toBe(AGENT_VIEW_RESTORE_HINT);
    expect(restoreAgentViewKilledDraft('', second.killedText!)).toBe('important prompt');

    const src = readSrc('screens/AgentView.tsx');
    expect(src).not.toContain('handleDeleteAll');
    expect(src).toContain('runCtrlXConfirmed();');
    expect(src).toContain('runEscClearDraft();');
    expect(src).toContain('ctrl+y restores the last Esc-cleared prompt in dispatch mode too');
  });

  test('P1-D5-7: renderAgentView and attachToPtySession forward forceUnresponsive, replyOnResume, and afterNoResponse', () => {
    const src = readSrc('screens/AgentView.tsx');
    expect(src).toContain('forceUnresponsive: action.forceUnresponsive,');
    expect(src).toContain('replyOnResume: action.replyOnResume,');
    expect(src).toContain('afterNoResponse: action.afterNoResponse,');
    expect(src).toContain('...(forceUnresponsive ? { forceUnresponsive: true } : {}),');
    expect(src).toContain('...(replyOnResume ? { replyOnResume: true } : {}),');
    expect(src).toContain("if (code === 'kill_unconfirmed')");
    expect(src).toContain('return { error: FLEET_RESTART_OFFER_MSG };');
  });

  // -------------------------------------------------------------------------
  // P1 & P2 Fixes — ResumeConversation, Settings/Config/Usage, MCP, DaemonHub, Plugins, Doctor, Local Panels, Tasks, History
  // -------------------------------------------------------------------------

  test('P1-D5-8, P1-D5-9 & P1-10: ResumeConversation restores agent (with setAppState) BEFORE restoreSessionStateFromLog and never leaks pendingRestoredAgentModel', () => {
    const src = readSrc('screens/ResumeConversation.tsx');
    expect(src).toContain('loadConversationForResume(log, undefined, { forkSession })');
    expect(src).toContain('isUnsafeSessionRestorePath(log.fullPath)');
    expect(src).toContain('isCrossHostSessionHomeShape(log.fullPath)');
    expect(src).toContain('restoreSessionStateFromLog');
    expect(src).toContain('preparePlanModeRestoreOnInteractiveResume');
    expect(src).toContain('restoreSessionTaskListId');
    expect(src).toContain('loadGenerationRef');
    expect(src).toContain('loadingMoreRef');
    expect(src).toContain('selectedRef');
    expect(src).toContain('gracefulShutdown(');
    expect(src).not.toContain('process.exit(');

    // P1-10: restoreAgentFromSession must run BEFORE restoreSessionStateFromLog
    // and pass setAppState + effectiveAgentDefinitions
    const onSelectBody = src.slice(src.indexOf('async function onSelect('));
    const restoreAgentIdx = onSelectBody.indexOf('restoreAgentFromSession(');
    const restoreStateIdx = onSelectBody.indexOf('restoreSessionStateFromLog(');
    expect(restoreAgentIdx).toBeGreaterThan(0);
    expect(restoreStateIdx).toBeGreaterThan(restoreAgentIdx);
    const restoreAgentCall = onSelectBody.slice(restoreAgentIdx, onSelectBody.indexOf(');', restoreAgentIdx) + 2);
    expect(restoreAgentCall).toContain('effectiveAgentDefinitions');
    expect(restoreAgentCall).toContain('setAppState');

    // Runtime order verification: agent model hydrates AppState.mainLoopModel,
    // transcript sessionModel still overrides it when present, and pendingRestoredAgentModel
    // never leaks into a subsequent resume with no agent.
    const prevOverride = getMainLoopModelOverride();
    try {
      setMainLoopModelOverride(undefined);
      let state: AppState = getDefaultAppState();
      const setAppState = (updater: (prev: AppState) => AppState) => {
        state = updater(state);
      };
      const defs = {
        allAgents: [],
        activeAgents: [
          {
            agentType: 'reviewer',
            whenToUse: 'code review',
            source: 'userSettings' as const,
            model: 'claude-sonnet-4-6',
            getSystemPrompt: () => 'review',
          },
        ],
      };

      // Session 1: agent with explicit model, no transcript sessionModel
      const { agentDefinition: def1, restoredModel: model1 } = restoreAgentFromSession(
        'reviewer',
        undefined,
        defs,
        setAppState,
      );
      setAppState(prev => ({ ...prev, agent: def1?.agentType }));
      restoreSessionStateFromLog({ messages: [], fileHistorySnapshots: [] }, setAppState);
      expect(state.agent).toBe('reviewer');
      expect(model1).toBeTruthy();
      expect(state.mainLoopModel).toBe(model1 ?? null);

      // Session 2: subsequent resume with no agent and no sessionModel does not inherit leaked pending model
      state = { ...getDefaultAppState(), mainLoopModel: 'claude-haiku-4-5-20251001' };
      setMainLoopModelOverride(undefined);
      const { agentDefinition: def2 } = restoreAgentFromSession(undefined, undefined, defs, setAppState);
      setAppState(prev => ({ ...prev, agent: def2?.agentType }));
      restoreSessionStateFromLog({ messages: [], fileHistorySnapshots: [] }, setAppState);
      expect(state.agent).toBeUndefined();
      expect(state.mainLoopModel).toBe('claude-haiku-4-5-20251001');

      // Session 3: agent model + explicit transcript sessionModel -> transcript sessionModel wins
      state = getDefaultAppState();
      setMainLoopModelOverride(undefined);
      restoreAgentFromSession('reviewer', undefined, defs, setAppState);
      restoreSessionStateFromLog(
        { messages: [], fileHistorySnapshots: [], sessionModel: 'claude-opus-4-6' },
        setAppState,
      );
      expect(state.mainLoopModel).toBe('claude-opus-4-6');
    } finally {
      setMainLoopModelOverride(prevOverride);
    }
  });

  test('P1-D5-10, P1-D5-11 & P2-D5-24: Config, Settings, and Usage persistence, onClose forwarding, deps, and cancellation', () => {
    const configSrc = readSrc('components/Settings/Config.tsx');
    const settingsSrc = readSrc('components/Settings/Settings.tsx');
    const usageSrc = readSrc('components/Settings/Usage.tsx');

    expect(configSrc).toMatch(/onSetDefault=\{\(\) => \{\s*saveModelAsDefaultRef\.current = true;/);
    expect(configSrc).toContain('saveSessionModel(');
    expect(configSrc).toContain("clearRefusalFallbackModelLatch('model_pick')");
    expect(configSrc).toContain('settingsData?.showMessageTimestamps ?? globalConfig.showMessageTimestamps ?? false');
    expect(configSrc).toContain('onSaveResult?: (result: { error?: Error | null } | undefined) => void');
    expect(configSrc).toContain('onSaveResult: reportSaveResult');
    expect(configSrc).toContain('settingsData?.idleCompaction');
    expect(configSrc).toContain('settingsData?.autoContinueAtUsageLimit');
    expect(configSrc).toContain('settingsData?.wheelScrollAccelerationEnabled');
    expect(configSrc).toContain('settingsData?.precomputeCompactionEnabled');
    expect(settingsSrc).toContain('<Usage openedForCost={openedForCost} onClose={onClose} />');
    expect(usageSrc).toContain('loadSeqRef');
    expect(usageSrc).toContain('cancelledRef');
  });

  test('P1-D5-12, P1-D5-13 & P2-D5-25: MCP enable/disable state check, name-keyed tool detail, and unmount/re-entrancy guards', () => {
    const mcpCmdSrc = readSrc('commands/mcp/mcp.tsx');
    const settingsSrc = readSrc('components/mcp/MCPSettings.tsx');
    const listSrc = readSrc('components/mcp/MCPToolListView.tsx');
    const remoteSrc = readSrc('components/mcp/MCPRemoteServerMenu.tsx');
    const detailSrc = readSrc('components/mcp/MCPToolDetailView.tsx');

    expect(mcpCmdSrc).toContain(
      "const needsToggle = isEnabling ? match.type === 'disabled' : match.type !== 'disabled'",
    );
    expect(mcpCmdSrc).toContain('is already');
    expect(listSrc).toContain('value: tool.name');
    expect(settingsSrc).toContain('servers.find(s => s.name === viewState.serverName)');
    expect(settingsSrc).toContain('toolName: tool.name');
    expect(remoteSrc).toContain('if (unmountedRef.current) return');
    expect(remoteSrc).toContain('isClearingClaudeAIAuthRef');
    expect(remoteSrc).toContain('isClearingAuthRef');
    expect(detailSrc).toContain('let cancelled = false');
  });

  test('P1-D5-14, P1-D5-15 & P2-D5-29: DaemonHubDialog, ScheduledTaskFormDialog, and HistorySearchDialog fixes', () => {
    const hubSrc = readSrc('components/DaemonHub/DaemonHubDialog.tsx');
    const formSrc = readSrc('components/DaemonHub/ScheduledTaskFormDialog.tsx');
    const histSrc = readSrc('components/HistorySearchDialog.tsx');

    expect(hubSrc).toContain("useKeybinding('confirm:no', () => onDone(undefined, { display: 'skip' })");
    expect(hubSrc).toContain('AsyncLocalStorage');
    expect(hubSrc).toContain('captureAsyncScopedConsole');
    expect(formSrc).toContain('upsertCronTask(');
    expect(formSrc).toContain('removeCronTasks([prefill.id]');
    expect(formSrc).toContain('await onSaved()');
    expect(formSrc).not.toContain('onDone(');
    expect(histSrc).toContain('`${item.entry.timestamp}-${item.index}`');
    expect(histSrc).toContain('.catch(');
  });

  test('P1-D5-16..18 & P2-D5-26: Plugin manager batch removal, refresh/rollback, Esc scoping, and unmount guards', () => {
    const mktSrc = readSrc('commands/plugin/ManageMarketplaces.tsx');
    const pluginsSrc = readSrc('commands/plugin/ManagePlugins.tsx');
    const browseSrc = readSrc('commands/plugin/BrowseMarketplace.tsx');
    const discoverSrc = readSrc('commands/plugin/DiscoverPlugins.tsx');
    const settingsSrc = readSrc('commands/plugin/PluginSettings.tsx');
    const addSrc = readSrc('commands/plugin/AddMarketplace.tsx');

    expect(mktSrc).toContain('accumulatedEnabledPlugins');
    expect(mktSrc).toContain('scheduleTimeout');
    expect(mktSrc).toContain("isActive: !isProcessing && internalView === 'details'");
    expect(pluginsSrc).toContain('toggleChainsRef');
    expect(pluginsSrc).toContain('const wrappedChain = nextChain.finally(() => {');
    expect(pluginsSrc).toContain('if (toggleChainsRef.current.get(pluginId) === wrappedChain)');
    expect(pluginsSrc).toContain('toggleChainsRef.current.set(pluginId, wrappedChain);');
    expect(pluginsSrc).not.toContain('if (toggleChainsRef.current.get(pluginId) === nextChain)');
    expect(pluginsSrc).toContain('onManageComplete?.()');
    expect(pluginsSrc).toContain('!opResult.success');
    expect(browseSrc).toContain("typeof viewState === 'object' && viewState.type === 'plugin-options'");
    expect(browseSrc).toContain('!isInstalling');
    expect(discoverSrc).toContain('let cancelled = false');
    expect(settingsSrc).toContain('let cancelled = false');
    expect(addSrc).toContain('isLoadingRef');
  });

  test('P2-D5-22, P2-D5-23, P2-D5-27 & P2-D5-28: AgentView rollback/guards, Doctor, Local panels, and Task detail dialogs', () => {
    const dispatchDefaultsSrc = readSrc('screens/fleetView/fleetDispatchDefaults.ts');
    const agentSrc = readSrc('screens/AgentView.tsx');
    const doctorSrc = readSrc('screens/Doctor.tsx');
    const localMemSrc = readSrc('commands/local-memory/launchLocalMemory.tsx');
    const localVaultSrc = readSrc('commands/local-vault/launchLocalVault.tsx');
    const shellSrc = readSrc('components/tasks/ShellDetailDialog.tsx');
    const monitorSrc = readSrc('components/tasks/MonitorMcpDetailDialog.tsx');

    expect(dispatchDefaultsSrc).toContain('handOverDraft?.rollback?.()');
    expect(agentSrc).toContain('resumePickerGenRef');
    expect(agentSrc).toContain('probeSocketsRef');
    expect(agentSrc).toContain('cancelPeekTap()');
    expect(agentSrc).toContain("sock.on('close'");
    expect(doctorSrc).toContain('diagnosticPromise');
    expect(doctorSrc).toContain('diagnosticError');
    expect(localMemSrc).toContain("isCancelActive={step.kind === 'menu'}");
    expect(localVaultSrc).toContain("isCancelActive={step.kind === 'menu' && !inFlight}");
    expect(shellSrc).toContain('wasRunningRef');
    expect(monitorSrc).toContain('autoFocus');
  });
});
