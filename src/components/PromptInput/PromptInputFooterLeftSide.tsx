// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import { Box, Text, Link } from '@anthropic/ink';
import * as React from 'react';
import figures from 'figures';
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { VimMode, PromptInputMode } from '../../types/textInputTypes.js';
import type { ToolPermissionContext } from '../../Tool.js';
import { isVimModeEnabled } from './utils.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import {
  permissionModeIndicator,
  permissionModeSymbol,
  getModeColor,
  type PermissionMode,
} from '../../utils/permissions/PermissionMode.js';
import { BackgroundTaskStatus } from '../tasks/BackgroundTaskStatus.js';
import { isBackgroundTask } from '../../tasks/types.js';
import { isPanelAgentTask } from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import { getVisibleAgentTasks } from '../CoordinatorAgentStatus.js';
import { hasParkedSubagentsForFooter } from '../../utils/panelIdleSummary.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { count } from '../../utils/array.js';
import { shouldHideTasksFooter } from '../tasks/taskStatusUtils.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { TeamStatus } from '../teams/TeamStatus.js';
import { isInProcessEnabled } from '../../utils/swarm/backends/registry.js';
import { useAppState, useAppStateStore } from 'src/state/AppState.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import HistorySearchInput from './HistorySearchInput.js';
import { usePrStatus } from '../../hooks/usePrStatus.js';
import { Byline, KeyboardShortcutHint } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useTasksV2 } from '../../hooks/useTasksV2.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { formatDuration, formatFileSize } from '../../utils/format.js';
import { VoiceWarmupHint } from './VoiceIndicator.js';
import { useVoiceEnabled } from '../../hooks/useVoiceEnabled.js';
import { useVoiceState } from '../../context/voice.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { isXtermJs, useHasSelection, useSelection } from '@anthropic/ink';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { getPlatform } from '../../utils/platform.js';
import { PrBadge } from '../PrBadge.js';
import {
  getFleetNudgeExternalStore,
  isFleetNeedsInputNudgeEnabled,
  setFleetNeedsInputNudgeFocused,
} from '../../utils/fleetNeedsInputNudge.js';
import { FeedbackDraftFooter } from '../FeedbackDraftFooter.js';
import { useSessionDraftCount } from '../../utils/feedbackDrafts/useSessionDraftCount.js';
import { plural } from '../../utils/stringUtils.js';
import { getTerminalFocusState, subscribeTerminalFocus } from '@anthropic/ink';

// Dead code elimination: conditional import for proactive mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../../proactive/index.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */
const NO_OP_SUBSCRIBE = (_cb: () => void) => () => {};
const NULL = () => null;
const MAX_VOICE_HINT_SHOWS = 3;

/** Official Hzp — flash duration after needsInput increase / succeeded increase. */
const FLEET_NUDGE_FLASH_MS = 2_500;

/**
 * densable K2e / FFe — fleet/agents entry hint.
 * - Default / GB off / zero needs: "← for agents" (or "← again for agents")
 * - needs===0 + succeeded delta (fpf>0): pulse "← N done" (success on N) for Ozo=2500ms
 * - needsInput > 0: "← N agent(s)" with warning/success flash on change
 */
function AgentsFooterHint({ leftArrowAgain }: { leftArrowAgain?: boolean }): React.ReactNode {
  const nudgeEnabled = isFleetNeedsInputNudgeEnabled();
  const store = useMemo(() => getFleetNudgeExternalStore(nudgeEnabled), [nudgeEnabled]);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // Official eAa(ftt() !== "blurred") — pause sweep when terminal blurred.
  useEffect(() => {
    if (!nudgeEnabled) return;
    const apply = () => {
      const state = getTerminalFocusState();
      setFleetNeedsInputNudgeFocused(state !== 'blurred');
    };
    apply();
    return subscribeTerminalFocus(apply);
  }, [nudgeEnabled]);

  const needsInput = snap?.needsInput;
  const succeeded = snap?.succeeded;
  const reducedMotion = useAppState(s => s.settings.prefersReducedMotion) ?? false;

  const [flash, setFlash] = useState<'none' | 'awaiting' | 'done'>('none');
  /** densable fpf — temporary succeeded-delta while needsInput is empty. */
  const [donePulse, setDonePulse] = useState(0);
  const prevNeedsRef = useRef<number | undefined>(undefined);
  const prevSucceededRef = useRef<number | undefined>(undefined);
  const flashClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const donePulseClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** densable AYe — active flash kind so done-pulse does not clobber awaiting. */
  const flashKindRef = useRef<'none' | 'awaiting' | 'done'>('none');

  useEffect(() => {
    return () => {
      if (flashClearRef.current) clearTimeout(flashClearRef.current);
      if (donePulseClearRef.current) clearTimeout(donePulseClearRef.current);
    };
  }, []);

  useEffect(() => {
    const prevNeeds = prevNeedsRef.current;
    const prevSucceeded = prevSucceededRef.current;
    prevNeedsRef.current = needsInput;
    prevSucceededRef.current = succeeded;

    // densable: needsChanged = any change (not only increase); succeededUp = strict increase.
    const needsChanged = prevNeeds !== undefined && needsInput !== undefined && needsInput !== prevNeeds;
    const succeededUp = prevSucceeded !== undefined && succeeded !== undefined && succeeded > prevSucceeded;
    const hasNeeds = needsInput !== undefined && needsInput > 0;

    // densable: !hasNeeds && succeededUp && !reducedMotion → fpf pulse ("N done")
    if (!hasNeeds && succeededUp && !reducedMotion) {
      if (flashClearRef.current) {
        clearTimeout(flashClearRef.current);
        flashClearRef.current = null;
      }
      if (donePulseClearRef.current) {
        clearTimeout(donePulseClearRef.current);
        donePulseClearRef.current = null;
      }
      setFlash('none');
      flashKindRef.current = 'none';
      const delta = (succeeded as number) - (prevSucceeded as number);
      setDonePulse(delta);
      donePulseClearRef.current = setTimeout(() => {
        donePulseClearRef.current = null;
        setDonePulse(0);
      }, FLEET_NUDGE_FLASH_MS);
      return;
    }

    if (!hasNeeds || (!needsChanged && !succeededUp) || reducedMotion) {
      return;
    }
    // densable: while awaiting flash active, ignore pure succeeded-up on needs>0 path.
    if (!needsChanged && flashKindRef.current === 'awaiting') {
      return;
    }

    if (flashClearRef.current) clearTimeout(flashClearRef.current);
    if (donePulseClearRef.current) {
      clearTimeout(donePulseClearRef.current);
      donePulseClearRef.current = null;
      setDonePulse(0);
    }
    const kind: 'awaiting' | 'done' = needsChanged ? 'awaiting' : 'done';
    flashKindRef.current = kind;
    setFlash(kind);
    flashClearRef.current = setTimeout(() => {
      flashClearRef.current = null;
      flashKindRef.current = 'none';
      setFlash('none');
    }, FLEET_NUDGE_FLASH_MS);
  }, [needsInput, succeeded, reducedMotion]);

  // densable: zAr && (needs===0|void) && fpf>0 → "← N done"
  if (nudgeEnabled && (needsInput === 0 || needsInput === undefined) && donePulse > 0) {
    const countLabel = donePulse > 99 ? '99+' : String(donePulse);
    return (
      <Text>
        <Text dimColor>{figures.arrowLeft} </Text>
        <Text color={'success' as never}>{countLabel}</Text>
        <Text dimColor> done</Text>
      </Text>
    );
  }

  // densable: !zAr || needs void/0 → plain "← for agents"
  if (!nudgeEnabled || needsInput === undefined || needsInput === 0) {
    return (
      <Text dimColor>
        {leftArrowAgain ? `${figures.arrowLeft} again for agents` : `${figures.arrowLeft} for agents`}
      </Text>
    );
  }

  const countLabel = needsInput > 99 ? '99+' : String(needsInput);
  const color = flash === 'awaiting' ? 'warning' : flash === 'done' ? 'success' : undefined;
  const dimCount = flash === 'none';

  return (
    <Text>
      <Text dimColor>{figures.arrowLeft} </Text>
      <Text color={color as never} dimColor={dimCount}>
        {countLabel}
      </Text>
      <Text dimColor> {plural(needsInput, 'agent')}</Text>
    </Text>
  );
}

type Props = {
  exitMessage: {
    show: boolean;
    key?: string;
  };
  vimMode: VimMode | undefined;
  mode: PromptInputMode;
  toolPermissionContext: ToolPermissionContext;
  suppressHint: boolean;
  isLoading: boolean;
  showMemoryTypeSelector?: boolean;
  tasksSelected: boolean;
  teamsSelected: boolean;
  tmuxSelected: boolean;
  teammateFooterIndex?: number;
  isPasting?: boolean;
  isSearching: boolean;
  historyQuery: string;
  setHistoryQuery: (query: string) => void;
  historyFailedMatch: boolean;
  onOpenTasksDialog?: (taskId?: string) => void;
  leftArrowAgain?: boolean;
};

function ProactiveCountdown(): React.ReactNode {
  const nextTickAt = useSyncExternalStore(
    proactiveModule?.subscribeToProactiveChanges ?? NO_OP_SUBSCRIBE,
    proactiveModule?.getNextTickAt ?? NULL,
    NULL,
  );

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (nextTickAt === null) {
      setRemainingSeconds(null);
      return;
    }

    function update(): void {
      const remaining = Math.max(0, Math.ceil((nextTickAt! - Date.now()) / 1000));
      setRemainingSeconds(remaining);
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [nextTickAt]);

  if (remainingSeconds === null) return null;

  return <Text dimColor>waiting {formatDuration(remainingSeconds * 1000, { mostSignificantOnly: true })}</Text>;
}

export function PromptInputFooterLeftSide({
  exitMessage,
  vimMode,
  mode,
  toolPermissionContext,
  suppressHint,
  isLoading,
  tasksSelected,
  teamsSelected,
  tmuxSelected,
  teammateFooterIndex,
  isPasting,
  isSearching,
  historyQuery,
  setHistoryQuery,
  historyFailedMatch,
  onOpenTasksDialog,
  leftArrowAgain,
}: Props): React.ReactNode {
  if (exitMessage.show) {
    return (
      <Text dimColor key="exit-message">
        Press {exitMessage.key} again to exit
      </Text>
    );
  }
  if (isPasting) {
    return (
      <Text dimColor key="pasting-message">
        Pasting text…
      </Text>
    );
  }

  const showVim = isVimModeEnabled() && vimMode === 'INSERT' && !isSearching;

  return (
    <Box justifyContent="flex-start" gap={1}>
      {isSearching && (
        <HistorySearchInput value={historyQuery} onChange={setHistoryQuery} historyFailedMatch={historyFailedMatch} />
      )}
      {showVim ? (
        <Text dimColor key="vim-insert">
          -- INSERT --
        </Text>
      ) : null}
      <ModeIndicator
        mode={mode}
        toolPermissionContext={toolPermissionContext}
        showHint={!suppressHint && !showVim}
        isLoading={isLoading}
        tasksSelected={tasksSelected}
        teamsSelected={teamsSelected}
        teammateFooterIndex={teammateFooterIndex}
        tmuxSelected={tmuxSelected}
        onOpenTasksDialog={onOpenTasksDialog}
        leftArrowAgain={leftArrowAgain}
      />
    </Box>
  );
}

/**
 * densable kx @208947532 / `w(14)`. `pR(mode)` colors `bie`+`DL`+` on`;
 * gold `children` is `ml` (`r(n,{dimColor:!0,children:[" ",B(cycle,parens)]})`).
 * Gold ThemedText `P&&!W?inactive:G(c)` — dimColor paints `inactive`, not
 * ANSI-dim of warning. densable 289 `JFe()` is `return !1` so TK always
 * mounts dHe/kx, not Jse/xA.
 */
const ModePill = memo(function ModePill({
  mode,
  cycleShortcut,
}: {
  mode: PermissionMode;
  cycleShortcut?: string;
}): React.ReactNode {
  return (
    <Text color={getModeColor(mode)}>
      <Text aria-hidden>{permissionModeSymbol(mode)} </Text>
      {permissionModeIndicator(mode)}
      {' on'}
      {cycleShortcut ? (
        <Text dimColor>
          {' '}
          <KeyboardShortcutHint shortcut={cycleShortcut} action="cycle" parens />
        </Text>
      ) : null}
    </Text>
  );
});

type ModeIndicatorProps = {
  mode: PromptInputMode;
  toolPermissionContext: ToolPermissionContext;
  showHint: boolean;
  isLoading: boolean;
  tasksSelected: boolean;
  teamsSelected: boolean;
  tmuxSelected: boolean;
  teammateFooterIndex?: number;
  onOpenTasksDialog?: (taskId?: string) => void;
  leftArrowAgain?: boolean;
};

function ModeIndicator({
  mode,
  toolPermissionContext,
  showHint,
  isLoading,
  tasksSelected,
  teamsSelected,
  tmuxSelected,
  teammateFooterIndex,
  onOpenTasksDialog,
  leftArrowAgain,
}: ModeIndicatorProps): React.ReactNode {
  const { columns } = useTerminalSize();
  const feedbackDraftCount = useSessionDraftCount();
  const modeCycleShortcut = useShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab');
  const tasks = useAppState(s => s.tasks);
  const teamContext = useAppState(s => s.teamContext);
  // Set once in initialState (main.tsx --remote mode) and never mutated — lazy
  // init captures the immutable value without a subscription.
  const store = useAppStateStore();
  const [remoteSessionUrl] = useState(() => store.getState().remoteSessionUrl);
  const viewSelectionMode = useAppState(s => s.viewSelectionMode);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const replTabIsDiff = useAppState(s => s.replTab === 'diff');
  const expandedView = useAppState(s => s.expandedView);
  const showSpinnerTree = expandedView === 'teammates';
  const prStatus = usePrStatus(isLoading, isPrStatusEnabled());
  const hasTmuxSession = useAppState(s => process.env.USER_TYPE === 'ant' && s.tungstenActiveSession !== undefined);

  const nextTickAt = useSyncExternalStore(
    proactiveModule?.subscribeToProactiveChanges ?? NO_OP_SUBSCRIBE,
    proactiveModule?.getNextTickAt ?? NULL,
    NULL,
  );
  const voiceEnabledRaw = useVoiceEnabled();
  const voiceEnabled = feature('VOICE_MODE') ? voiceEnabledRaw : false;
  const voiceStateRaw = useVoiceState(s => s.voiceState);
  const voiceState = feature('VOICE_MODE') ? voiceStateRaw : ('idle' as const);
  const voiceWarmingUpRaw = useVoiceState(s => s.voiceWarmingUp);
  const voiceWarmingUp = feature('VOICE_MODE') ? voiceWarmingUpRaw : false;
  const hasSelection = useHasSelection();
  const selGetState = useSelection().getState;
  const hasNextTick = nextTickAt !== null;
  // densable COORDINATOR_MODE env gate — avoid top-level require of
  // coordinatorMode.js (incomplete ESM namespace → not-a-function in REPL).
  const isCoordinator = feature('COORDINATOR_MODE') ? isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE) : false;
  const runningTaskCount = useMemo(
    () =>
      count(
        Object.values(tasks),
        t => isBackgroundTask(t) && !(process.env.USER_TYPE === 'ant' && isPanelAgentTask(t)),
      ),
    [tasks],
  );
  const tasksV2 = useTasksV2();
  const hasTaskItems = tasksV2 !== undefined && tasksV2.length > 0;
  const escShortcut = useShortcutDisplay('chat:cancel', 'Chat', 'esc').toLowerCase();
  const todosShortcut = useShortcutDisplay('app:toggleTodos', 'Global', 'ctrl+t');
  const killAgentsShortcut = useShortcutDisplay('chat:killAgents', 'Chat', 'ctrl+x ctrl+k');
  const voiceKeyShortcutRaw = useShortcutDisplay('voice:pushToTalk', 'Chat', 'Space');
  const voiceKeyShortcut = feature('VOICE_MODE') ? voiceKeyShortcutRaw : '';
  // Captured at mount so the hint doesn't flicker mid-session if another
  // CC instance increments the counter. Incremented once via useEffect the
  // first time voice is enabled in this session — approximates "hint was
  // shown" without tracking the exact render-time condition (which depends
  // on parts/hintParts computed after the early-return hooks boundary).
  const [voiceHintUnderCapRaw] = useState(
    () => (getGlobalConfig().voiceFooterHintSeenCount ?? 0) < MAX_VOICE_HINT_SHOWS,
  );
  const voiceHintUnderCap = feature('VOICE_MODE') ? voiceHintUnderCapRaw : false;
  const voiceHintIncrementedRefRaw = useRef(false);
  const voiceHintIncrementedRef = feature('VOICE_MODE') ? voiceHintIncrementedRefRaw : null;
  useEffect(() => {
    if (feature('VOICE_MODE')) {
      if (!voiceEnabled || !voiceHintUnderCap) return;
      if (voiceHintIncrementedRef?.current) return;
      if (voiceHintIncrementedRef) voiceHintIncrementedRef.current = true;
      const newCount = (getGlobalConfig().voiceFooterHintSeenCount ?? 0) + 1;
      saveGlobalConfig(prev => {
        if ((prev.voiceFooterHintSeenCount ?? 0) >= newCount) return prev;
        return { ...prev, voiceFooterHintSeenCount: newCount };
      });
    }
  }, [voiceEnabled, voiceHintUnderCap]);
  const isKillAgentsConfirmShowing = useAppState(s => s.notifications.current?.key === 'kill-agents-confirm');

  // Derive team info from teamContext (no filesystem I/O needed)
  // Match the same logic as TeamStatus to avoid trailing separator
  // In-process mode uses Shift+Down/Up navigation, not footer teams menu
  const hasTeams =
    isAgentSwarmsEnabled() &&
    !isInProcessEnabled() &&
    teamContext !== undefined &&
    count(Object.values(teamContext.teammates), t => t.name !== 'team-lead') > 0;

  if (mode === 'bash') {
    return <Text color="bashBorder">! for shell mode</Text>;
  }

  const currentMode = toolPermissionContext?.mode;
  // Gold footer paints default as `manual mode` (`DL`). Do not hide default.
  const hasActiveMode = currentMode !== undefined;
  const viewedTask = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
  const isViewingTeammate = viewSelectionMode === 'viewing-agent' && viewedTask?.type === 'in_process_teammate';
  const isViewingCompletedTeammate = isViewingTeammate && viewedTask != null && viewedTask.status !== 'running';
  const hasBackgroundTasks = runningTaskCount > 0 || isViewingTeammate;
  // Official mt = !fl() && ary(T, I). fl = InternalAccessibilityContext (SR).
  const hasParkedSubagentsHint = !isScreenReaderModeEnabled() && hasParkedSubagentsForFooter(tasks, viewingAgentTaskId);
  // Official at = M && !mt && !re && I===void 0 && Vs() && !wa()
  // M = replTab==="diff", re = fl() (screen reader), I = viewingAgentTaskId
  const hideDiffHint =
    replTabIsDiff &&
    !hasParkedSubagentsHint &&
    !isScreenReaderModeEnabled() &&
    viewingAgentTaskId === undefined &&
    isFullscreenEnvEnabled() &&
    !getIsRemoteMode();

  // Count primary items (permission mode or coordinator mode, background tasks, and teams)
  const primaryItemCount = (isCoordinator || hasActiveMode ? 1 : 0) + (hasBackgroundTasks ? 1 : 0) + (hasTeams ? 1 : 0);

  // PR indicator is short (~10 chars) — unlike the old diff indicator the
  // >=100 threshold was tuned for. Now that auto mode is effectively the
  // baseline, primaryItemCount is ≥1 for most sessions; keep the threshold
  // low enough to show PR status on standard 80-col terminals.
  const shouldShowPrStatus =
    isPrStatusEnabled() &&
    prStatus.number !== null &&
    prStatus.reviewState !== null &&
    prStatus.url !== null &&
    primaryItemCount < 2 &&
    (primaryItemCount === 0 || columns >= 80);

  // Hide the shift+tab hint when there are 2 primary items. densable dHe
  // `bs&&(Gn||as)&&Nt!==""` — manual (default) mode never gets the cycle hint
  // and falls through to "? for shortcuts".
  const shouldShowModeHint = primaryItemCount < 2;
  const showModeCycleHint = shouldShowModeHint && currentMode !== 'default' && modeCycleShortcut !== '';

  // Check if we have in-process teammates (showing pills)
  // In spinner-tree mode, pills are disabled - teammates appear in the spinner tree instead
  const hasInProcessTeammates =
    !showSpinnerTree && hasBackgroundTasks && Object.values(tasks).some(t => t.type === 'in_process_teammate');
  const hasTeammatePills = hasInProcessTeammates || (!showSpinnerTree && isViewingTeammate);

  // In remote mode (`claude assistant`, --teleport) the agent runs elsewhere;
  // the local permission mode shown here doesn't reflect the agent's state.
  // Rendered before the tasks pill so a long pill label doesn't push the
  // mode indicator off-screen.
  // densable dHe `es`: `e(s,{flexShrink:0,children:e(kx,{mode:wn,children:ml})},"mode")`.
  // `ml` is nested in kx so Yoga measures one Text; parent `height:1 overflow:hidden`
  // clips instead of wrapping `(shift+tab to cycle)` onto a second row.
  const modePart =
    currentMode && !getIsRemoteMode() ? (
      <ModePill key="mode" mode={currentMode} cycleShortcut={showModeCycleHint ? modeCycleShortcut : undefined} />
    ) : null;

  // Build parts array - exclude BackgroundTaskStatus when we have teammate pills
  // (teammate pills get their own row)
  const parts = [
    // Remote session indicator
    ...(remoteSessionUrl
      ? [
          <Link url={remoteSessionUrl} key="remote">
            <Text color="ide">{figures.circleDouble} remote</Text>
          </Link>,
        ]
      : []),
    // BackgroundTaskStatus is NOT in parts — it renders as a Box sibling so
    // its click-target Box isn't nested inside the <Text wrap="truncate">
    // wrapper (reconciler throws on Box-in-Text).
    // Tmux pill (ant-only) — appears right after tasks in nav order
    ...(process.env.USER_TYPE === 'ant' && hasTmuxSession ? [<TungstenPill key="tmux" selected={tmuxSelected} />] : []),
    ...(isAgentSwarmsEnabled() && hasTeams
      ? [<TeamStatus key="teams" teamsSelected={teamsSelected} showHint={showHint && !hasBackgroundTasks} />]
      : []),
    ...(shouldShowPrStatus
      ? [<PrBadge key="pr-status" number={prStatus.number!} url={prStatus.url!} reviewState={prStatus.reviewState!} />]
      : []),
  ];
  // Check if any in-process teammates exist (for hint text cycling)
  const hasAnyInProcessTeammates = Object.values(tasks).some(
    t => t.type === 'in_process_teammate' && t.status === 'running',
  );
  const hasRunningAgentTasks = Object.values(tasks).some(t => t.type === 'local_agent' && t.status === 'running');

  // Get hint parts separately for potential second-line rendering
  const hintParts = showHint
    ? getSpinnerHintParts(
        isLoading,
        escShortcut,
        todosShortcut,
        killAgentsShortcut,
        hasTaskItems,
        expandedView,
        hasAnyInProcessTeammates,
        hasRunningAgentTasks,
        isKillAgentsConfirmShowing,
      )
    : [];

  // Official lfb: BG_SESSIONS fleet entry (not remote, not viewing teammate).
  // feature() must be a direct if/ternary condition (bun:bundle restriction).
  const agentsEntryEnabled = feature('BG_SESSIONS')
    ? !getIsRemoteMode() && !isViewingTeammate && !isViewingCompletedTeammate
    : false;

  if (isViewingCompletedTeammate) {
    parts.push(
      <Text dimColor key="esc-return">
        <KeyboardShortcutHint shortcut={escShortcut} action="return to team lead" />
      </Text>,
    );
  } else if ((feature('PROACTIVE') || feature('KAIROS')) && hasNextTick) {
    parts.push(<ProactiveCountdown key="proactive" />);
  } else if (!hasTeammatePills && showHint) {
    parts.push(...hintParts);
    // Official interrupt_agents: loading + fleet → esc · FFe
    if (isLoading && agentsEntryEnabled) {
      parts.push(<AgentsFooterHint key="agents-hint" leftArrowAgain={leftArrowAgain} />);
    }
  }

  // When we have teammate pills, always render them on their own line above other parts
  if (hasTeammatePills) {
    // Don't append spinner hints when viewing a completed teammate —
    // the "esc to return to team lead" hint already replaces "esc to interrupt"
    const teammateHintParts = isViewingCompletedTeammate
      ? []
      : [
          ...hintParts,
          ...(isLoading && agentsEntryEnabled
            ? [<AgentsFooterHint key="agents-hint-teammate" leftArrowAgain={leftArrowAgain} />]
            : []),
        ];
    const otherParts = [
      ...(modePart ? [modePart] : []),
      ...parts,
      ...teammateHintParts,
      ...(hasParkedSubagentsHint
        ? [
            <Text dimColor key="tasks-subagents">
              /tasks to see subagents
            </Text>,
          ]
        : []),
      ...(hideDiffHint
        ? [
            <Text dimColor key="diff-panel">
              /diff to hide diff
            </Text>,
          ]
        : []),
    ];
    return (
      <Box flexDirection="column">
        <Box>
          <BackgroundTaskStatus
            tasksSelected={tasksSelected}
            isViewingTeammate={isViewingTeammate}
            teammateFooterIndex={teammateFooterIndex}
            isLeaderIdle={!isLoading}
            onOpenDialog={onOpenTasksDialog}
          />
        </Box>
        {otherParts.length > 0 && (
          <Box>
            <Byline>{otherParts}</Byline>
          </Box>
        )}
      </Box>
    );
  }

  // Add "↓ to manage tasks" hint when panel has visible rows
  const hasCoordinatorTasks = process.env.USER_TYPE === 'ant' && getVisibleAgentTasks(tasks).length > 0;

  // Tasks pill renders as a Box sibling (not a parts entry) so its
  // click-target Box isn't nested inside <Text wrap="truncate"> — the
  // reconciler throws on Box-in-Text. Computed here so the empty-checks
  // below still treat "pill present" as non-empty.
  const tasksPart =
    hasBackgroundTasks && !hasTeammatePills && !shouldHideTasksFooter(tasks, showSpinnerTree) ? (
      <BackgroundTaskStatus
        tasksSelected={tasksSelected}
        isViewingTeammate={isViewingTeammate}
        teammateFooterIndex={teammateFooterIndex}
        isLeaderIdle={!isLoading}
        onOpenDialog={onOpenTasksDialog}
      />
    ) : null;

  // Official Yx priority (after interrupt/manage): agents (FFe) before shortcuts.
  // Idle + no bg tasks → FFe alone; without BG_SESSIONS → "? for shortcuts".
  // Loading already appended FFe above with interrupt.
  // Note: when idle + tasks, manage wins (official) — no FFe on that row.
  if (!isLoading && showHint && agentsEntryEnabled && !tasksPart && !hasCoordinatorTasks) {
    if (modePart && !showModeCycleHint && parts.length === 0 && !hasParkedSubagentsHint) {
      parts.push(
        <Text dimColor key="shortcuts-hint">
          ? for shortcuts
        </Text>,
      );
    }
    if (!parts.some(p => React.isValidElement(p) && p.key === 'agents-hint')) {
      parts.push(<AgentsFooterHint key="agents-hint" leftArrowAgain={leftArrowAgain} />);
    }
  } else if (
    parts.length === 0 &&
    !tasksPart &&
    (!modePart || !showModeCycleHint) &&
    showHint &&
    !hasParkedSubagentsHint
  ) {
    parts.push(
      <Text dimColor key="shortcuts-hint">
        ? for shortcuts
      </Text>,
    );
  }

  // Only replace the idle voice hint when there's something to say — otherwise
  // fall through instead of showing an empty Byline. "esc to clear" was removed
  // (looked like "esc to interrupt" when idle; esc-clears-selection is standard
  // UX) leaving only ctrl+c (copyOnSelect off) and the xterm.js native-select hint.
  const copyOnSelect = getGlobalConfig().copyOnSelect ?? true;
  const selectionHintHasContent = hasSelection && (!copyOnSelect || isXtermJs());

  // Warmup hint takes priority — when the user is actively holding
  // the activation key, show feedback regardless of other hints.
  if (feature('VOICE_MODE') && voiceEnabled && voiceWarmingUp) {
    parts.push(<VoiceWarmupHint key="voice-warmup" />);
  } else if (isFullscreenEnvEnabled() && selectionHintHasContent) {
    // xterm.js (VS Code/Cursor/Windsurf) force-selection modifier is
    // platform-specific and gated on macOS (SelectionService.shouldForceSelection):
    //   macOS:     altKey && macOptionClickForcesSelection (VS Code default: false)
    //   non-macOS: shiftKey
    // On macOS, if we RECEIVED an alt+click (lastPressHadAlt), the VS Code
    // setting is off — xterm.js would have consumed the event otherwise.
    // Tell the user the exact setting to flip instead of repeating the
    // option+click hint they just tried.
    // Non-reactive getState() read is safe: lastPressHadAlt is immutable
    // while hasSelection is true (set pre-drag, cleared with selection).
    const isMac = getPlatform() === 'macos';
    const altClickFailed = isMac && (selGetState()?.lastPressHadAlt ?? false);
    parts.push(
      <Text dimColor key="selection-copy">
        <Byline>
          {!copyOnSelect && <KeyboardShortcutHint shortcut="ctrl+c" action="copy" />}
          {isXtermJs() &&
            (altClickFailed ? (
              <Text>set macOptionClickForcesSelection in VS Code settings</Text>
            ) : (
              <KeyboardShortcutHint shortcut={isMac ? 'option+click' : 'shift+click'} action="native select" />
            ))}
        </Byline>
      </Text>,
    );
  } else if (
    feature('VOICE_MODE') &&
    parts.length > 0 &&
    showHint &&
    voiceEnabled &&
    voiceState === 'idle' &&
    hintParts.length === 0 &&
    voiceHintUnderCap &&
    !hasParkedSubagentsHint
  ) {
    parts.push(
      <Text dimColor key="voice-hint">
        hold {voiceKeyShortcut} to speak
      </Text>,
    );
  }

  // Official MJc sits beside the pill (wn()+MJc) before Qe. nt=mt → none
  // suppresses later voice/shortcuts; manage/ctrl_t/agents still win.
  if (hasParkedSubagentsHint) {
    parts.push(
      <Text dimColor key="tasks-subagents">
        /tasks to see subagents
      </Text>,
    );
  }

  // Official OJc — after MJc, before manage/feedback-drafts
  if (hideDiffHint) {
    parts.push(
      <Text dimColor key="diff-panel">
        /diff to hide diff
      </Text>,
    );
  }

  if (feedbackDraftCount > 0) {
    parts.push(<FeedbackDraftFooter key="feedback-drafts" count={feedbackDraftCount} />);
  }

  if ((tasksPart || hasCoordinatorTasks) && showHint && !hasTeams) {
    parts.push(
      <Text dimColor key="manage-tasks">
        {tasksSelected ? (
          <KeyboardShortcutHint shortcut="Enter" action="view tasks" />
        ) : (
          <KeyboardShortcutHint shortcut="↓" action="manage" />
        )}
      </Text>,
    );
  }

  // In fullscreen the bottom section is flexShrink:0 — every row here
  // is a row stolen from the ScrollBox. This component must have a STABLE
  // height so the footer never grows/shrinks and shifts scroll content.
  // Returning null when parts is empty (e.g. StatusLine on → suppressHint
  // → showHint=false → no "? for shortcuts") would let a later-added
  // part (e.g. the selection copy/native-select hints) grow the column
  // from 0→1 row. Always render 1 row in fullscreen; return a space when
  // empty so Yoga reserves the row without painting anything visible.
  if (parts.length === 0 && !tasksPart && !modePart) {
    return isFullscreenEnvEnabled() ? <Text> </Text> : null;
  }

  // Gold dHe: `r(s,{height:1,overflow:"hidden",children:[es, ·, …]})`.
  return (
    <Box height={1} overflow="hidden">
      {modePart && <Box flexShrink={0}>{modePart}</Box>}
      {modePart && (tasksPart || parts.length > 0) && (
        <Box flexShrink={0}>
          <Text dimColor> · </Text>
        </Box>
      )}
      {tasksPart && (
        <Box flexShrink={0}>
          {tasksPart}
          {parts.length > 0 && <Text dimColor> · </Text>}
        </Box>
      )}
      {parts.length > 0 && (
        <Text wrap="truncate">
          <Byline>{parts}</Byline>
        </Text>
      )}
    </Box>
  );
}

function getSpinnerHintParts(
  isLoading: boolean,
  escShortcut: string,
  todosShortcut: string,
  killAgentsShortcut: string,
  hasTaskItems: boolean,
  expandedView: 'none' | 'tasks' | 'teammates',
  hasTeammates: boolean,
  hasRunningAgentTasks: boolean,
  isKillAgentsConfirmShowing: boolean,
): React.ReactElement[] {
  let toggleAction: string;
  if (hasTeammates) {
    // Cycling: none → tasks → teammates → none
    switch (expandedView) {
      case 'none':
        toggleAction = 'show tasks';
        break;
      case 'tasks':
        toggleAction = 'show teammates';
        break;
      case 'teammates':
        toggleAction = 'hide';
        break;
    }
  } else {
    toggleAction = expandedView === 'tasks' ? 'hide tasks' : 'show tasks';
  }

  // Show the toggle hint only when there are task items to display or
  // teammates to cycle to
  const showToggleHint = hasTaskItems || hasTeammates;

  return [
    ...(isLoading
      ? [
          <Text dimColor key="esc">
            <KeyboardShortcutHint shortcut={escShortcut} action="interrupt" />
          </Text>,
        ]
      : []),
    ...(!isLoading && hasRunningAgentTasks && !isKillAgentsConfirmShowing
      ? [
          <Text dimColor key="kill-agents">
            <KeyboardShortcutHint shortcut={killAgentsShortcut} action="stop agents" />
          </Text>,
        ]
      : []),
    ...(showToggleHint
      ? [
          <Text dimColor key="toggle-tasks">
            <KeyboardShortcutHint shortcut={todosShortcut} action={toggleAction} />
          </Text>,
        ]
      : []),
  ];
}

function isPrStatusEnabled(): boolean {
  return getGlobalConfig().prStatusFooterEnabled ?? true;
}
