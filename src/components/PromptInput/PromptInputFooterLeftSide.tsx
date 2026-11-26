// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import {
  AccessibilityContext,
  Box,
  Byline,
  formatShortcutString,
  getTerminalFocusState,
  isXtermJs,
  KeyboardShortcutHint,
  stringWidth,
  subscribeTerminalFocus,
  Text,
  useHasSelection,
  useSelection,
} from '@anthropic/ink';
import * as React from 'react';
import figures from 'figures';
import { memo, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { VimMode, PromptInputMode } from '../../types/textInputTypes.js';
import type { ToolPermissionContext } from '../../Tool.js';
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
import { getPanelVisibleAgentTasks, getVisibleAgentTasks } from '../CoordinatorAgentStatus.js';
import { hasParkedSubagentsForFooter } from '../../utils/panelIdleSummary.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { count } from '../../utils/array.js';
import { shouldHideTasksFooter } from '../tasks/taskStatusUtils.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { TeamStatus } from '../teams/TeamStatus.js';
import { isInProcessEnabled } from '../../utils/swarm/backends/registry.js';
import { AppStoreContext, useAppState } from 'src/state/AppState.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import HistorySearchInput from './HistorySearchInput.js';
import { usePrStatus } from '../../hooks/usePrStatus.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useTasksV2 } from '../../hooks/useTasksV2.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { formatDuration, formatFileSize } from '../../utils/format.js';
import { VoiceWarmupHint } from './VoiceIndicator.js';
import { useVoiceEnabled } from '../../hooks/useVoiceEnabled.js';
import { useVoiceState } from '../../context/voice.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
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
import { isBgSession } from '../../utils/concurrentSessions.js';
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  RootSessionSlot,
  runWithSession,
  type Session,
} from '../../utils/sessionRoot.js';

// Dead code elimination: conditional import for proactive mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../../proactive/index.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */
const NO_OP_SUBSCRIBE = (_cb: () => void) => () => {};
const NULL = () => null;
const MAX_VOICE_HINT_SHOWS = 3;

/**
 * Session-level guard so remounting PromptInputFooterLeftSide (e.g. toggling
 * transcript or opening an overlay) does not re-increment the 3-showings cap
 * within the same session (#1499). Stored in a per-root-session
 * `RootSessionSlot` for 2.1.331 multi-host isolation.
 */
type PromptFooterLeftSessionState = {
  voiceFooterHintCounted: boolean;
  agentsHintExpiredState: boolean;
  agentsHintTimerStarted: boolean;
  agentsHintTimer: ReturnType<typeof setTimeout> | null;
  agentsHintListeners: Map<() => void, Session | undefined>;
};

const promptFooterLeftStateBySession = new RootSessionSlot<PromptFooterLeftSessionState>(() => ({
  voiceFooterHintCounted: false,
  agentsHintExpiredState: false,
  agentsHintTimerStarted: false,
  agentsHintTimer: null,
  agentsHintListeners: new Map(),
}));

function getPromptFooterLeftState(): PromptFooterLeftSessionState {
  return promptFooterLeftStateBySession.of(getBootstrapSession());
}

function notifyAgentsHintListeners(state: PromptFooterLeftSessionState): void {
  for (const [listener, captured] of state.agentsHintListeners) {
    if (captured !== undefined && getActiveSessionFromAls() !== captured) {
      runWithSession(captured, listener);
    } else {
      listener();
    }
  }
}

export function resetVoiceFooterHintCountedForTests(): void {
  getPromptFooterLeftState().voiceFooterHintCounted = false;
}

/** Official Hzp — flash duration after needsInput increase / succeeded increase. */
const FLEET_NUDGE_FLASH_MS = 2_500;
/** Official 2.1.302 (#926): hide `← for agents` 10s after session opens. */
const AGENTS_HINT_TIMEOUT_MS = 10_000;

function ensureAgentsHintTimer(): void {
  const state = getPromptFooterLeftState();
  if (state.agentsHintTimerStarted || state.agentsHintExpiredState) return;
  state.agentsHintTimerStarted = true;
  const captured = getActiveSessionFromAls();
  const timer = setTimeout(() => {
    state.agentsHintTimer = null;
    const expire = (): void => {
      state.agentsHintExpiredState = true;
      notifyAgentsHintListeners(state);
    };
    if (captured !== undefined && getActiveSessionFromAls() !== captured) {
      runWithSession(captured, expire);
    } else {
      expire();
    }
  }, AGENTS_HINT_TIMEOUT_MS);
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
  state.agentsHintTimer = timer;
}

function subscribeAgentsHintExpired(listener: () => void): () => void {
  const state = getPromptFooterLeftState();
  state.agentsHintListeners.set(listener, getActiveSessionFromAls());
  return () => {
    state.agentsHintListeners.delete(listener);
  };
}

function getAgentsHintExpiredSnapshot(): boolean {
  return getPromptFooterLeftState().agentsHintExpiredState;
}

export function resetAgentsHintExpiredForTest(): void {
  const state = getPromptFooterLeftState();
  if (state.agentsHintTimer !== null) {
    clearTimeout(state.agentsHintTimer);
    state.agentsHintTimer = null;
  }
  state.agentsHintExpiredState = false;
  state.agentsHintTimerStarted = false;
}

export function setAgentsHintExpiredForTest(expired: boolean): void {
  const state = getPromptFooterLeftState();
  state.agentsHintExpiredState = expired;
  notifyAgentsHintListeners(state);
}

/**
 * Official 2.1.328 `yV` (chunk@319736883.js:907484) — fleet/agents entry hint
 * hook returning `React.ReactNode | null` so callers know when the hint is
 * absent (unavailable or 10s resting timer expired) and never emit dangling
 * ` · ` separators.
 */
function useAgentsFooterHint({
  available,
  leftArrowAgain,
  restingHintExpired: restingHintExpiredProp,
}: {
  available: boolean;
  leftArrowAgain?: boolean;
  restingHintExpired?: boolean;
}): React.ReactNode | null {
  useEffect(() => {
    if (available && restingHintExpiredProp === undefined) {
      ensureAgentsHintTimer();
    }
  }, [available, restingHintExpiredProp]);
  const storeExpired = useSyncExternalStore(
    subscribeAgentsHintExpired,
    getAgentsHintExpiredSnapshot,
    getAgentsHintExpiredSnapshot,
  );
  const restingHintExpired = restingHintExpiredProp ?? storeExpired;
  const nudgeEnabled = isFleetNeedsInputNudgeEnabled();
  const activeNudge = available && nudgeEnabled;
  const store = useMemo(() => getFleetNudgeExternalStore(activeNudge), [activeNudge]);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // Official eAa(ftt() !== "blurred") — pause sweep when terminal blurred.
  useEffect(() => {
    if (!activeNudge) return;
    const apply = () => {
      const state = getTerminalFocusState();
      setFleetNeedsInputNudgeFocused(state !== 'blurred');
    };
    apply();
    return subscribeTerminalFocus(apply);
  }, [activeNudge]);

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

  if (!available) return null;

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

  // densable: !zAr || needs void/0 → plain "← for agents" (hidden once 10s hint timer expires)
  if (!nudgeEnabled || needsInput === undefined || needsInput === 0) {
    if (restingHintExpired) return null;
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

/**
 * densable K2e / FFe — fleet/agents entry hint component wrapper around `useAgentsFooterHint`.
 */
export function AgentsFooterHint({
  leftArrowAgain,
  restingHintExpired,
}: {
  leftArrowAgain?: boolean;
  restingHintExpired?: boolean;
}): React.ReactNode {
  return useAgentsFooterHint({
    available: true,
    leftArrowAgain,
    restingHintExpired,
  });
}

type Props = {
  exitMessage: {
    show: boolean;
    key?: string;
  };
  vimMode: VimMode | string | undefined;
  hideVimModeIndicator?: boolean;
  mode: PromptInputMode;
  toolPermissionContext: ToolPermissionContext;
  suppressHint: boolean;
  /** #201 (2.1.326): allow `esc to interrupt` beside a custom status line when Esc interrupts. */
  allowInterruptHint?: boolean;
  isLoading: boolean;
  showMemoryTypeSelector?: boolean;
  tasksSelected: boolean;
  teamsSelected: boolean;
  tmuxSelected: boolean;
  teammateFooterIndex?: number;
  isPasting?: boolean;
  showExpandPasteHint?: boolean;
  isSearching: boolean;
  historyQuery: string;
  setHistoryQuery: (query: string) => void;
  historyFailedMatch: boolean;
  onOpenTasksDialog?: (taskId?: string) => void;
  leftArrowAgain?: boolean;
  /** Official 2.1.328 Prt `wrappedRowWidth`: classic row budget for `sc` cycle hint fit. */
  wrappedRowWidth?: number;
  /** Official 2.1.328 Prt `leftArrowDetachAvailable`: optional override (defaults to BG_SESSIONS gate). */
  leftArrowDetachAvailable?: boolean;
};

type StatusLineWithHideVim = {
  hideVimModeIndicator?: boolean;
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
  hideVimModeIndicator,
  mode,
  toolPermissionContext,
  suppressHint,
  allowInterruptHint = false,
  isLoading,
  tasksSelected,
  teamsSelected,
  tmuxSelected,
  teammateFooterIndex,
  isPasting,
  showExpandPasteHint,
  isSearching,
  historyQuery,
  setHistoryQuery,
  historyFailedMatch,
  onOpenTasksDialog,
  leftArrowAgain,
  wrappedRowWidth,
  leftArrowDetachAvailable,
}: Props): React.ReactNode {
  const store = useContext(AppStoreContext);
  const settingsHideVim = useSyncExternalStore(
    store ? store.subscribe : NO_OP_SUBSCRIBE,
    () => (store?.getState().settings?.statusLine as StatusLineWithHideVim | undefined)?.hideVimModeIndicator ?? false,
    () => (store?.getState().settings?.statusLine as StatusLineWithHideVim | undefined)?.hideVimModeIndicator ?? false,
  );

  if (exitMessage.show) {
    const exitAction = isBgSession() ? 'detach (session keeps running)' : 'exit';
    return (
      <Text dimColor key="exit-message">
        Press {exitMessage.key} again to {exitAction}
      </Text>
    );
  }
  if (isPasting) {
    return (
      <Text dimColor key="pasting-message">
        Pasting…
      </Text>
    );
  }
  if (showExpandPasteHint && !isSearching && !isLoading) {
    return (
      <Text dimColor key="expand-paste-hint">
        paste again to expand
      </Text>
    );
  }

  const effectiveHideVim = hideVimModeIndicator ?? settingsHideVim;
  const showVim = vimMode !== undefined && !effectiveHideVim && vimMode !== 'NORMAL' && !isSearching;

  return (
    <Box justifyContent="flex-start" gap={1}>
      {isSearching && (
        <HistorySearchInput value={historyQuery} onChange={setHistoryQuery} historyFailedMatch={historyFailedMatch} />
      )}
      {showVim ? (
        <Box flexShrink={0} key="vim-indicator">
          <Text dimColor>-- {vimMode} --</Text>
        </Box>
      ) : null}
      <ModeIndicator
        mode={mode}
        toolPermissionContext={toolPermissionContext}
        showHint={!suppressHint && !showVim}
        allowInterruptHint={allowInterruptHint && !showVim}
        isLoading={isLoading}
        tasksSelected={tasksSelected}
        teamsSelected={teamsSelected}
        teammateFooterIndex={teammateFooterIndex}
        tmuxSelected={tmuxSelected}
        onOpenTasksDialog={onOpenTasksDialog}
        leftArrowAgain={leftArrowAgain}
        wrappedRowWidth={isSearching ? undefined : wrappedRowWidth}
        leftArrowDetachAvailable={leftArrowDetachAvailable}
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
          <KeyboardShortcutHint shortcut={cycleShortcut} action="cycle" parens format={{ keyCase: 'lower' }} />
        </Text>
      ) : null}
    </Text>
  );
});

type ModeIndicatorProps = {
  mode: PromptInputMode;
  toolPermissionContext: ToolPermissionContext;
  showHint: boolean;
  allowInterruptHint?: boolean;
  isLoading: boolean;
  tasksSelected: boolean;
  teamsSelected: boolean;
  tmuxSelected: boolean;
  teammateFooterIndex?: number;
  onOpenTasksDialog?: (taskId?: string) => void;
  leftArrowAgain?: boolean;
  /** Official 2.1.328 Prt `wrappedRowWidth`: classic row budget for `sc` cycle hint fit. */
  wrappedRowWidth?: number;
  /** Official 2.1.328 Prt `leftArrowDetachAvailable`: optional override (defaults to BG_SESSIONS gate). */
  leftArrowDetachAvailable?: boolean;
};

/**
 * #283 (2.1.326, official pwo/ort/nrt): a stopped subagent row visible under the
 * prompt that can be resumed via ↓.
 */
export function hasResumableStoppedSubagentInFooter(
  tasks: Record<string, import('../../tasks/types.js').TaskState>,
  taskDecorations: Record<string, { content: string }> | undefined,
  viewingAgentTaskId: string | undefined,
): boolean {
  const isResumable = (t: import('../../tasks/types.js').TaskState | undefined): boolean =>
    t !== undefined &&
    t.id !== viewingAgentTaskId &&
    t.type === 'local_agent' &&
    t.stoppedByUser === true &&
    t.status === 'killed' &&
    t.endTime !== undefined;
  if (!Object.values(tasks).some(isResumable)) return false;
  return getPanelVisibleAgentTasks(tasks, taskDecorations, viewingAgentTaskId).some(isResumable);
}

/**
 * #8 (2.1.326, official rrt): true when viewing a running local subagent where
 * pressing Esc stops that subagent.
 */
export function isViewingStoppableSubagent(
  viewSelectionMode: string,
  viewingAgentTaskId: string | undefined,
  tasks: Record<string, import('../../tasks/types.js').TaskState>,
): boolean {
  if (viewSelectionMode !== 'viewing-agent' || viewingAgentTaskId === undefined) {
    return false;
  }
  const viewed = tasks[viewingAgentTaskId];
  return viewed?.type === 'local_agent' && viewed.status === 'running';
}

/**
 * Official 2.1.328 `Frt` (chunk@319736883.js:941792) — fullscreen background
 * tasks summary pill for `>= 2` running background tasks (`↳ N background`).
 */
export const BackgroundCountPill = memo(function BackgroundCountPill({
  count: taskCount,
  selected,
  onClick,
}: {
  count: number;
  selected: boolean;
  onClick?: () => void;
}): React.ReactNode {
  const [hover, setHover] = useState(false);
  const highlighted = selected || hover;
  const label = (
    <Text color="background" inverse={highlighted}>
      <Text aria-hidden>{'\u21B3'} </Text>
      {taskCount} background
    </Text>
  );
  if (!onClick) return label;
  return (
    <Box onClick={() => onClick()} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {label}
    </Box>
  );
});

export type FullscreenFooterHint =
  | 'none'
  | 'warmup'
  | 'interrupt'
  | 'interrupt_agents'
  | 'artifacts'
  | 'manage'
  | 'ctrl_t'
  | 'agents'
  | 'voice'
  | 'cycle'
  | 'shortcuts';

export type ResolveFullscreenFooterHintParams = {
  voiceWarmingUp: boolean;
  forceInterrupt: boolean;
  showHint: boolean;
  allowInterruptHint: boolean;
  canShowEscInterrupt: boolean;
  isArtifactsSelected: boolean;
  hasManageableTasks: boolean;
  isPanelRowSelected: boolean;
  hasTaskItems: boolean;
  agentsAvailable: boolean;
  hasAgentsHintContent: boolean;
  isScreenReader: boolean;
  hasParkedSubagentsHint: boolean;
  canShowVoiceHint: boolean;
  canShowCycleHint: boolean;
};

/**
 * Official 2.1.328 `jl` single-winner footer priority slot
 * (chunk@319736883.js:934480):
 * warmup -> interrupt/interrupt_agents -> artifacts -> manage -> ctrl_t ->
 * agents -> parked-subagents -> voice -> cycle -> shortcuts.
 */
export function resolveFullscreenFooterHint(p: ResolveFullscreenFooterHintParams): FullscreenFooterHint {
  if (p.voiceWarmingUp) return 'warmup';
  if (p.forceInterrupt) return 'interrupt';
  if (!p.showHint) {
    if (p.allowInterruptHint && p.canShowEscInterrupt) {
      return 'interrupt';
    }
    return 'none';
  }
  if (p.canShowEscInterrupt) {
    return p.agentsAvailable && p.hasAgentsHintContent && !p.isScreenReader ? 'interrupt_agents' : 'interrupt';
  }
  if (p.isArtifactsSelected) return 'artifacts';
  if (p.hasManageableTasks && !p.isPanelRowSelected) return 'manage';
  if (p.hasTaskItems) return 'ctrl_t';
  if (p.agentsAvailable && !p.isScreenReader) {
    return p.hasAgentsHintContent ? 'agents' : 'none';
  }
  if (p.hasParkedSubagentsHint) return 'none';
  if (p.canShowVoiceHint) return 'voice';
  if (p.canShowCycleHint) return 'cycle';
  return !p.isScreenReader ? 'shortcuts' : 'none';
}

/**
 * Official 2.1.328 `sc` (chunk@319736883.js:938430): in classic mode only
 * attach `(shift+tab to cycle)` to the mode pill when the composed row fits
 * within the row width budget.
 */
export function doesClassicCycleHintFitRow(
  rowPreview: string,
  rowBudget: number | undefined,
  isScreenReader: boolean,
): boolean {
  return isScreenReader || rowBudget === undefined || stringWidth(rowPreview) <= rowBudget;
}

function ModeIndicator({
  mode,
  toolPermissionContext,
  showHint,
  allowInterruptHint = false,
  isLoading,
  tasksSelected,
  teamsSelected,
  tmuxSelected,
  teammateFooterIndex,
  onOpenTasksDialog,
  leftArrowAgain,
  wrappedRowWidth,
  leftArrowDetachAvailable,
}: ModeIndicatorProps): React.ReactNode {
  const { columns } = useTerminalSize();
  const isScreenReader = useContext(AccessibilityContext);
  const feedbackDraftCount = useSessionDraftCount();
  const modeCycleShortcut = useShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab');
  const openSelectedShortcut = useShortcutDisplay('footer:openSelected', 'Footer', 'enter');
  const tasks = useAppState(s => s.tasks);
  const taskDecorations = useAppState(s => s.taskDecorations);
  const footerSelection = useAppState(s => s.footerSelection);
  const coordinatorTaskIndex = useAppState(s => s.coordinatorTaskIndex);
  const frameUrlCount = useAppState(s => (s.frameUrls ? Object.keys(s.frameUrls).length : 0));
  const teamContext = useAppState(s => s.teamContext);
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
        t =>
          isBackgroundTask(t) &&
          !(t.type === 'monitor_ws' && t.ambient === true && t.frameLive?.explicit !== true) &&
          !(process.env.USER_TYPE === 'ant' && isPanelAgentTask(t)),
      ),
    [tasks],
  );
  const tasksV2 = useTasksV2();
  const hasTaskItems = tasksV2 !== undefined && tasksV2.length > 0;
  const escShortcut = useShortcutDisplay('chat:cancel', 'Chat', 'esc').toLowerCase();
  const todosShortcut = useShortcutDisplay('app:toggleTodos', 'Global', 'ctrl+t');
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
  const [footerState] = useState(() => getPromptFooterLeftState());
  useEffect(() => {
    if (feature('VOICE_MODE')) {
      if (!voiceEnabled || !voiceHintUnderCap || voiceKeyShortcut === '') return;
      if (footerState.voiceFooterHintCounted) return;
      footerState.voiceFooterHintCounted = true;
      const newCount = (getGlobalConfig().voiceFooterHintSeenCount ?? 0) + 1;
      saveGlobalConfig(prev => {
        if ((prev.voiceFooterHintSeenCount ?? 0) >= newCount) return prev;
        return { ...prev, voiceFooterHintSeenCount: newCount };
      });
    }
  }, [footerState, voiceEnabled, voiceHintUnderCap, voiceKeyShortcut]);

  const viewedTask = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
  const isViewingTeammate = viewSelectionMode === 'viewing-agent' && viewedTask?.type === 'in_process_teammate';
  const isViewingCompletedTeammate = isViewingTeammate && viewedTask != null && viewedTask.status !== 'running';
  const isFooterSelected = footerSelection !== null || tasksSelected || teamsSelected || tmuxSelected;

  // Official lfb: BG_SESSIONS fleet entry (not remote, not viewing teammate).
  // feature() must be a direct if/ternary condition (bun:bundle restriction).
  const defaultAgentsEntryEnabled = feature('BG_SESSIONS')
    ? !getIsRemoteMode() && !isViewingTeammate && !isViewingCompletedTeammate
    : false;
  const agentsEntryEnabled = leftArrowDetachAvailable ?? defaultAgentsEntryEnabled;
  const agentsAvailable = agentsEntryEnabled && !isViewingTeammate && !isFooterSelected;
  const agentsHintNode = useAgentsFooterHint({
    available: agentsAvailable && !isScreenReader,
    leftArrowAgain,
  });

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

  const isFullscreen = isFullscreenEnvEnabled();
  const currentMode = toolPermissionContext?.mode;
  // Gold footer paints default as `manual mode` (`DL`). Do not hide default.
  const hasActiveMode = currentMode !== undefined;
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
    isFullscreen &&
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

  // Check if we have in-process teammates (showing pills)
  // In spinner-tree mode, pills are disabled - teammates appear in the spinner tree instead
  const hasInProcessTeammates =
    !showSpinnerTree && hasBackgroundTasks && Object.values(tasks).some(t => t.type === 'in_process_teammate');
  const hasTeammatePills = hasInProcessTeammates || (!showSpinnerTree && isViewingTeammate);

  // Check if any in-process teammates exist (for hint text cycling)
  const hasAnyInProcessTeammates = Object.values(tasks).some(
    t => t.type === 'in_process_teammate' && t.status === 'running',
  );

  const showEscToStopSubagent =
    isViewingStoppableSubagent(viewSelectionMode, viewingAgentTaskId, tasks) && !isFooterSelected;
  const hasResumableStoppedSubagent = hasResumableStoppedSubagentInFooter(tasks, taskDecorations, viewingAgentTaskId);
  const hasCoordinatorTasks = process.env.USER_TYPE === 'ant' && getVisibleAgentTasks(tasks).length > 0;
  const isPanelRowSelected = footerSelection === 'tasks' && coordinatorTaskIndex >= 0;
  const isArtifactsSelected = (footerSelection as string | null) === 'frame';
  const artifactsAction = getIsRemoteMode() && frameUrlCount === 1 ? 'open in browser' : 'view artifacts';
  const hasVisibleBgPill = runningTaskCount >= 1 && !hasTeammatePills && !shouldHideTasksFooter(tasks, showSpinnerTree);
  const hasManageTarget = hasCoordinatorTasks || hasResumableStoppedSubagent;

  // #201 (2.1.326): suppress `esc to interrupt` when Esc would go to a footer
  // item or panel; allow `esc to interrupt` beside a custom status line via
  // `allowInterruptHint`. #8 (2.1.326): show `esc to stop` in a running
  // subagent view where Esc stops it.
  const canShowEscInterrupt = isLoading && !isFooterSelected && !showEscToStopSubagent;
  const hintParts = showHint
    ? getSpinnerHintParts(
        canShowEscInterrupt,
        escShortcut,
        todosShortcut,
        hasTaskItems,
        expandedView,
        hasAnyInProcessTeammates,
      )
    : allowInterruptHint && canShowEscInterrupt
      ? [
          <Text dimColor key="esc">
            <KeyboardShortcutHint shortcut={escShortcut} action="interrupt" format={{ keyCase: 'lower' }} />
          </Text>,
        ]
      : [];

  const canShowVoiceHint = feature('VOICE_MODE')
    ? voiceEnabled && voiceState === 'idle' && voiceHintUnderCap && showHint && voiceKeyShortcut !== ''
    : false;
  const canShowModeCycleInFullscreen =
    hasActiveMode && !getIsRemoteMode() && currentMode !== 'default' && modeCycleShortcut !== '';

  const fullscreenHint: FullscreenFooterHint = isFullscreen
    ? resolveFullscreenFooterHint({
        voiceWarmingUp: feature('VOICE_MODE') ? voiceEnabled && voiceWarmingUp : false,
        forceInterrupt: !isScreenReader && (isViewingCompletedTeammate || showEscToStopSubagent),
        showHint,
        allowInterruptHint,
        canShowEscInterrupt,
        isArtifactsSelected,
        hasManageableTasks: (hasVisibleBgPill || hasManageTarget) && !hasTeams,
        isPanelRowSelected,
        hasTaskItems,
        agentsAvailable,
        hasAgentsHintContent: agentsHintNode !== null,
        isScreenReader,
        hasParkedSubagentsHint,
        canShowVoiceHint,
        canShowCycleHint: canShowModeCycleInFullscreen,
      })
    : 'none';

  // Classic mode cycle-hint width check (`sc` @ chunk@319736883.js:938430):
  // hide the shift+tab hint when there are 2 primary items, in manual (default)
  // mode, or when the row with `(shift+tab to cycle)` would overflow rowWidth.
  const shouldShowModeHint = primaryItemCount < 2;
  const hasEscInterruptInClassic = hintParts.some(p => p.key === 'esc');
  const cycleHintPreview =
    modeCycleShortcut !== '' ? `(${formatShortcutString(modeCycleShortcut, { keyCase: 'lower' })} to cycle)` : '';
  const classicAgentsShown =
    !isLoading && showHint && agentsAvailable && !hasVisibleBgPill && !hasCoordinatorTasks && agentsHintNode !== null;
  const classicCycleFitRow = [
    currentMode &&
      `${permissionModeSymbol(currentMode)} ${permissionModeIndicator(currentMode)} on ${cycleHintPreview}`,
    classicAgentsShown ? `${figures.arrowLeft} for agents` : undefined,
    shouldShowPrStatus && prStatus.number !== null ? `PR #${prStatus.number}` : undefined,
    hasEscInterruptInClassic && hasParkedSubagentsHint ? '/tasks to see subagents' : undefined,
    hasEscInterruptInClassic ? `${escShortcut} to interrupt…` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const classicRowBudget = wrappedRowWidth ?? Math.max(0, columns - 4);
  const cycleHintFitsRow = doesClassicCycleHintFitRow(classicCycleFitRow, classicRowBudget, isScreenReader);
  const showModeCycleHint =
    shouldShowModeHint && currentMode !== 'default' && modeCycleShortcut !== '' && cycleHintFitsRow;

  const effectiveCycleShortcut = isFullscreen
    ? fullscreenHint === 'cycle'
      ? modeCycleShortcut
      : undefined
    : showModeCycleHint
      ? modeCycleShortcut
      : undefined;

  // In remote mode (`claude assistant`, --teleport) the agent runs elsewhere;
  // the local permission mode shown here doesn't reflect the agent's state.
  // Rendered before the tasks pill so a long pill label doesn't push the
  // mode indicator off-screen.
  // densable dHe `es`: `e(s,{flexShrink:0,children:e(kx,{mode:wn,children:ml})},"mode")`.
  // `ml` is nested in kx so Yoga measures one Text; parent `height:1 overflow:hidden`
  // clips instead of wrapping `(shift+tab to cycle)` onto a second row.
  const modePart =
    currentMode && !getIsRemoteMode() ? (
      <ModePill key="mode" mode={currentMode} cycleShortcut={effectiveCycleShortcut} />
    ) : null;

  // Build parts array - exclude BackgroundTaskStatus when we have teammate pills
  // (teammate pills get their own row)
  const parts = [
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

  // When we have teammate pills, always render them on their own line above other parts
  if (hasTeammatePills) {
    // Don't append spinner hints when viewing a completed teammate —
    // the "esc to return to team lead" hint already replaces "esc to interrupt"
    const teammateHintParts = isViewingCompletedTeammate
      ? [
          <Text dimColor key="esc-return">
            <KeyboardShortcutHint shortcut={escShortcut} action="return to team lead" format={{ keyCase: 'lower' }} />
          </Text>,
        ]
      : [
          ...(showEscToStopSubagent && (showHint || allowInterruptHint)
            ? [
                <Text dimColor key="esc-stop">
                  <KeyboardShortcutHint shortcut="esc" action="stop" format={{ keyCase: 'lower' }} />
                </Text>,
              ]
            : []),
          ...hintParts,
          ...(isLoading && agentsHintNode !== null
            ? [<React.Fragment key="agents-hint-teammate">{agentsHintNode}</React.Fragment>]
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

  // Official 2.1.328 fullscreen single-winner `jl` branch (chunk@319736883.js:934340..936400).
  if (isFullscreen) {
    const bgPill = hasVisibleBgPill ? (
      runningTaskCount >= 2 ? (
        <BackgroundCountPill count={runningTaskCount} selected={tasksSelected} onClick={onOpenTasksDialog} />
      ) : (
        <BackgroundTaskStatus
          tasksSelected={tasksSelected}
          isViewingTeammate={isViewingTeammate}
          teammateFooterIndex={teammateFooterIndex}
          isLeaderIdle={!isLoading}
          onOpenDialog={onOpenTasksDialog}
        />
      )
    ) : null;

    const inlineManage = hasVisibleBgPill && (tasksSelected || !hasResumableStoppedSubagent);
    const inlineManageSuffix =
      fullscreenHint === 'manage' && inlineManage && (!tasksSelected || openSelectedShortcut !== '') ? (
        <Box flexShrink={0}>
          <Text dimColor>
            {' '}
            {tasksSelected ? (
              <KeyboardShortcutHint
                shortcut={openSelectedShortcut}
                action="view tasks"
                parens
                format={{ keyCase: 'lower' }}
              />
            ) : (
              <KeyboardShortcutHint shortcut="↓" action="manage" parens />
            )}
          </Text>
        </Box>
      ) : null;

    let winnerHint: React.ReactNode = null;
    if (
      (feature('PROACTIVE') || feature('KAIROS')) &&
      hasNextTick &&
      fullscreenHint !== 'warmup' &&
      fullscreenHint !== 'interrupt' &&
      fullscreenHint !== 'interrupt_agents'
    ) {
      winnerHint = <ProactiveCountdown key="proactive" />;
    } else if (fullscreenHint === 'warmup') {
      winnerHint = <VoiceWarmupHint key="voice-warmup" />;
    } else if (fullscreenHint === 'manage' && !inlineManage && (!tasksSelected || openSelectedShortcut !== '')) {
      winnerHint = (
        <Text dimColor key="manage-tasks">
          {tasksSelected ? (
            <KeyboardShortcutHint shortcut={openSelectedShortcut} action="view tasks" format={{ keyCase: 'lower' }} />
          ) : (
            <KeyboardShortcutHint shortcut="↓" action={hasResumableStoppedSubagent ? 'resume subagent' : 'manage'} />
          )}
        </Text>
      );
    } else if (fullscreenHint === 'artifacts' && openSelectedShortcut !== '') {
      winnerHint = (
        <Text dimColor key="view-artifacts">
          <KeyboardShortcutHint
            shortcut={openSelectedShortcut}
            action={artifactsAction}
            format={{ keyCase: 'lower' }}
          />
        </Text>
      );
    } else if (fullscreenHint === 'interrupt' || fullscreenHint === 'interrupt_agents') {
      winnerHint = (
        <>
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint
                shortcut={showEscToStopSubagent ? 'esc' : escShortcut}
                action={
                  showEscToStopSubagent ? 'stop' : isViewingCompletedTeammate ? 'return to team lead' : 'interrupt'
                }
                format={{ keyCase: 'lower' }}
              />
              {showEscToStopSubagent && hasManageTarget && (
                <KeyboardShortcutHint
                  shortcut="↓"
                  action={hasResumableStoppedSubagent ? 'resume subagent' : 'manage'}
                />
              )}
            </Byline>
            {fullscreenHint === 'interrupt_agents' && ' · '}
          </Text>
          {fullscreenHint === 'interrupt_agents' && agentsHintNode}
        </>
      );
    } else if (fullscreenHint === 'ctrl_t') {
      winnerHint = (
        <Text dimColor key="toggle-tasks">
          <KeyboardShortcutHint
            shortcut={todosShortcut}
            action={expandedView === 'tasks' ? 'hide tasks' : 'show tasks'}
            format={{ keyCase: 'lower' }}
          />
        </Text>
      );
    } else if (fullscreenHint === 'agents') {
      winnerHint = agentsHintNode;
    } else if (fullscreenHint === 'voice') {
      winnerHint = (
        <Text dimColor key="voice-hint">
          hold {voiceKeyShortcut} to speak
        </Text>
      );
    } else if (fullscreenHint === 'shortcuts') {
      winnerHint = (
        <Text dimColor key="shortcuts-hint">
          ? for shortcuts
        </Text>
      );
    }

    const hasStaticBadges = parts.length > 0;
    const hasLeftPrimary = Boolean(modePart || hasStaticBadges || bgPill);
    const hasTailBeforeDiff = hasLeftPrimary || hasParkedSubagentsHint;
    const hasTailBeforeWinner = hasTailBeforeDiff || hideDiffHint;
    const hasTailBeforeDrafts = hasTailBeforeWinner || Boolean(winnerHint);

    if (!hasLeftPrimary && !hasParkedSubagentsHint && !hideDiffHint && !winnerHint && feedbackDraftCount === 0) {
      return <Text> </Text>;
    }

    const sep = <Text dimColor> · </Text>;
    return (
      <Box height={1} overflow="hidden">
        {modePart && <Box flexShrink={0}>{modePart}</Box>}
        {modePart && (hasStaticBadges || bgPill) && <Box flexShrink={0}>{sep}</Box>}
        {hasStaticBadges && (
          <Box flexShrink={0}>
            <Byline>{parts}</Byline>
            {bgPill && sep}
          </Box>
        )}
        {bgPill && (
          <Box flexShrink={0}>
            {bgPill}
            {inlineManageSuffix}
          </Box>
        )}
        {hasParkedSubagentsHint && (
          <Text wrap="truncate" key="tasks-subagents">
            {hasLeftPrimary && sep}
            <Text dimColor>/tasks to see subagents</Text>
          </Text>
        )}
        {hideDiffHint && (
          <Text wrap="truncate" key="diff-panel">
            {hasTailBeforeDiff && sep}
            <Text dimColor>/diff to hide diff</Text>
          </Text>
        )}
        {winnerHint && (
          <Text wrap="truncate">
            {hasTailBeforeWinner && sep}
            {winnerHint}
          </Text>
        )}
        {feedbackDraftCount > 0 && (
          <Text wrap="truncate">
            {hasTailBeforeDrafts && sep}
            <FeedbackDraftFooter key="feedback-drafts" count={feedbackDraftCount} />
          </Text>
        )}
      </Box>
    );
  }

  // Classic (non-fullscreen) branch — official chunk@319736883.js:936700..939500.
  if (isViewingCompletedTeammate) {
    parts.push(
      <Text dimColor key="esc-return">
        <KeyboardShortcutHint shortcut={escShortcut} action="return to team lead" format={{ keyCase: 'lower' }} />
      </Text>,
    );
  } else if (showEscToStopSubagent && (showHint || allowInterruptHint)) {
    parts.push(
      <Text dimColor key="esc-stop">
        <KeyboardShortcutHint shortcut="esc" action="stop" format={{ keyCase: 'lower' }} />
      </Text>,
    );
    if (showHint) {
      parts.push(...hintParts);
    }
  } else if ((feature('PROACTIVE') || feature('KAIROS')) && hasNextTick) {
    parts.push(<ProactiveCountdown key="proactive" />);
  } else if (showHint || allowInterruptHint) {
    parts.push(...hintParts);
    // Official interrupt_agents: loading + fleet → esc · FFe
    if (isLoading && showHint && agentsHintNode !== null) {
      parts.push(<React.Fragment key="agents-hint">{agentsHintNode}</React.Fragment>);
    }
  }

  // Tasks pill renders as a Box sibling (not a parts entry) so its
  // click-target Box isn't nested inside <Text wrap="truncate"> — the
  // reconciler throws on Box-in-Text. Computed here so the empty-checks
  // below still treat "pill present" as non-empty.
  const tasksPart = hasVisibleBgPill ? (
    <BackgroundTaskStatus
      tasksSelected={tasksSelected}
      isViewingTeammate={isViewingTeammate}
      teammateFooterIndex={teammateFooterIndex}
      isLeaderIdle={!isLoading}
      onOpenDialog={onOpenTasksDialog}
    />
  ) : null;

  // Official classic priority (chunk@319736883.js:937400..937600):
  // NEVER stack "? for shortcuts · ← for agents" together.
  if (!isLoading && showHint && agentsAvailable && !tasksPart && !hasCoordinatorTasks && agentsHintNode !== null) {
    if (!parts.some(p => React.isValidElement(p) && p.key === 'agents-hint')) {
      parts.push(<React.Fragment key="agents-hint">{agentsHintNode}</React.Fragment>);
    }
  } else if (
    parts.length === 0 &&
    !tasksPart &&
    (!modePart || !showModeCycleHint) &&
    showHint &&
    !hasParkedSubagentsHint &&
    !isScreenReader
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
  } else if (isFullscreen && selectionHintHasContent) {
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
    voiceKeyShortcut !== '' &&
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

  if (
    (tasksPart || hasCoordinatorTasks || hasResumableStoppedSubagent) &&
    showHint &&
    !hasTeams &&
    !isArtifactsSelected
  ) {
    parts.push(
      <Text dimColor key="manage-tasks">
        {tasksSelected ? (
          <KeyboardShortcutHint shortcut={openSelectedShortcut} action="view tasks" format={{ keyCase: 'lower' }} />
        ) : (
          <KeyboardShortcutHint shortcut="↓" action={hasResumableStoppedSubagent ? 'resume subagent' : 'manage'} />
        )}
      </Text>,
    );
  }

  if (isArtifactsSelected && showHint && openSelectedShortcut !== '') {
    parts.push(
      <Text dimColor key="view-artifacts">
        <KeyboardShortcutHint shortcut={openSelectedShortcut} action={artifactsAction} format={{ keyCase: 'lower' }} />
      </Text>,
    );
  }

  if (parts.length === 0 && !tasksPart && !modePart) {
    return null;
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

/**
 * Official 2.1.328 `abo` (chunk@319736883.js:942455) — interrupt & task toggle
 * hints only (stale `ctrl+x ctrl+k to stop agents` removed).
 */
function getSpinnerHintParts(
  isLoading: boolean,
  escShortcut: string,
  todosShortcut: string,
  hasTaskItems: boolean,
  expandedView: 'none' | 'tasks' | 'teammates',
  hasTeammates: boolean,
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
            <KeyboardShortcutHint shortcut={escShortcut} action="interrupt" format={{ keyCase: 'lower' }} />
          </Text>,
        ]
      : []),
    ...(showToggleHint
      ? [
          <Text dimColor key="toggle-tasks">
            <KeyboardShortcutHint shortcut={todosShortcut} action={toggleAction} format={{ keyCase: 'lower' }} />
          </Text>,
        ]
      : []),
  ];
}

function isPrStatusEnabled(): boolean {
  return getGlobalConfig().prStatusFooterEnabled ?? true;
}
