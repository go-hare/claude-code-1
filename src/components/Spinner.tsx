// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { Ansi, Box, Text, stringWidth } from '@anthropic/ink';
import { leftoverBhrConnLabel, leftoverBhrIdleBudget } from './Spinner/leftoverZxt.js';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { computeGlimmerIndex, computeShimmerSegments, SHIMMER_INTERVAL_MS } from '../bridge/bridgeStatusUtil.js';
import { feature } from 'bun:bundle';
import { getKairosActive, getMainThreadAgentId, getUserMsgOptIn } from '../bootstrap/state.js';
import { leftoverIhrGet, leftoverIhrHas, leftoverIhrSubscribe } from '../utils/collapseReadSearch.js';
import { leftoverIhrSlice, useLeftoverIhrStore } from '../state/leftoverIhrStore.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { count } from '../utils/array.js';
import sample from 'lodash-es/sample.js';
import { formatDuration, formatNumber } from '../utils/format.js';
import type { Theme } from 'src/utils/theme.js';
import { activityManager } from '../utils/activityManager.js';
import { getSpinnerVerbs } from '../constants/spinnerVerbs.js';
import { MessageResponse } from './MessageResponse.js';
import { TaskListV2 } from './TaskListV2.js';
import { useTasksV2 } from '../hooks/useTasksV2.js';
import type { Task } from '../utils/tasks.js';
import { useAppState } from '../state/AppState.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { getSpinnerPingPongFrames, type SpinnerMode } from './Spinner/index.js';
import { useUiRenderHost } from './hooks/useUiRenderHost.js';
import { PluginRenderedTree } from './PluginRasterPanes.js';
import { SpinnerAnimationRow } from './Spinner/SpinnerAnimationRow.js';
import { useSettings } from '../hooks/useSettings.js';
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js';
import { isLocalAgentTask } from '../tasks/LocalAgentTask/LocalAgentTask.js';
import { isBackgroundTask } from '../tasks/types.js';
import { getAllInProcessTeammateTasks } from '../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import { getEffortSuffix, pdSessionEffort, resolveSpinnerEffortSource } from '../utils/effort.js';
import { getMainLoopModel } from '../utils/model/model.js';
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from '../utils/model/providers.js';
import { getViewedTeammateTask } from '../state/selectors.js';
import { TEARDROP_ASTERISK } from '../constants/figures.js';
import figures from 'figures';
import { getCurrentTurnTokenBudget, getTurnOutputTokens } from '../bootstrap/state.js';

import { useAnimationFrame } from '@anthropic/ink';
import { getGlobalConfig } from '../utils/config.js';
import { FOCUS_TIP_ACTIVE, FOCUS_TIP_INVITE } from '../utils/focusView.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import { getBootstrapSession, RootSessionSlot } from '../utils/sessionRoot.js';
import { truncateToWidth } from '../utils/truncate.js';
export type { SpinnerMode } from './Spinner/index.js';

const EXPLANATORY_TIP_PREFIX = 'Want Claude to teach as it works?';
const EXPLANATORY_TIP_COMMAND = 'config';
const EXPLANATORY_TIP_ARGS = 'outputStyle=explanatory';
export const EXPLANATORY_TIP_FULL = `${EXPLANATORY_TIP_PREFIX} · /${EXPLANATORY_TIP_COMMAND} ${EXPLANATORY_TIP_ARGS}`;
export const BTW_SPINNER_TIP = 'Use /btw to ask a side question without interrupting Claude';

type SlashCommandLinkHandler = (fullCommand: string, origin: { kind: 'human' }) => void;

const slashLinkHandlerBySession = new RootSessionSlot<{
  handler: SlashCommandLinkHandler | null;
}>(() => ({ handler: null }));

function getSlashLinkHandlerState(): { handler: SlashCommandLinkHandler | null } {
  return slashLinkHandlerBySession.of(getBootstrapSession());
}

/** Official 2.1.328 `OJt`/`tkn` (`chunk@294254613.js:297820`): register slash-link runner. */
export function registerSlashCommandLinkHandler(handler: SlashCommandLinkHandler | null): void {
  getSlashLinkHandlerState().handler = handler;
}

/**
 * Official 2.1.328 `rcn` (`chunk@307641741.js:2097`): clickable slash command
 * link with hover highlight and `tengu_slash_link_clicked` telemetry.
 */
export function SlashCommandLink({
  command,
  args,
  color,
}: {
  command: string;
  args?: string;
  color?: keyof Theme;
}): React.ReactNode {
  const full = args === undefined ? command : `${command} ${args}`;
  const [hovered, setHovered] = useState(false);
  const runner = getSlashLinkHandlerState().handler;
  if (!runner) {
    return (
      <Text underline color={color}>
        /{full}
      </Text>
    );
  }
  return (
    <Box
      onClick={() => {
        logEvent('tengu_slash_link_clicked', {
          command: command as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        runner(full, { kind: 'human' });
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Text underline bold={hovered} color={color}>
        /{full}
      </Text>
    </Box>
  );
}

const STATUS_CLAUDE = 'https://status.claude.com';

/** densable jGn — shown once a 529/overload retry has reached min(3, maxRetries). */
function persistServiceHint(): string {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD)) {
    return `If it persists, check ${STATUS_CLAUDE} and Google Cloud's status page.`;
  }
  const provider = getAPIProvider();
  if (provider === 'firstParty') {
    if (isFirstPartyAnthropicBaseUrl()) {
      return `If it persists, check ${STATUS_CLAUDE}.`;
    }
    const raw = process.env.ANTHROPIC_BASE_URL ?? '';
    let host = raw;
    try {
      host = new URL(raw).host || raw;
    } catch {
      host = raw;
    }
    return `If it persists, check your inference gateway (${host}).`;
  }
  if (provider === 'anthropicAws') {
    return `If it persists, check ${STATUS_CLAUDE}.`;
  }
  const labels: Record<string, string> = {
    bedrock: 'Amazon Bedrock',
    vertex: 'Vertex AI',
    foundry: 'Microsoft Foundry',
    mantle: 'Amazon Bedrock (Mantle)',
    gateway: 'an API gateway',
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    grok: 'xAI Grok',
  };
  return `If it persists, check your ${labels[provider] ?? provider} service status.`;
}

function overloadPersistLine(status: import('../utils/advisorNetworkStall.js').RetryStatus): string | null {
  // densable Cn: only a retrying 529/overload at attempt >= min(3, maxRetries).
  if (status.kind !== 'retrying') return null;
  const err =
    status.error !== null && typeof status.error === 'object'
      ? (status.error as { status?: unknown; formatted?: unknown })
      : undefined;
  const formatted = typeof err?.formatted === 'string' ? err.formatted : '';
  const overloaded = err?.status === 529 || formatted.toLowerCase().includes('overload');
  if (!overloaded) return null;
  if (status.attempt < Math.min(3, status.maxRetries)) return null;
  return persistServiceHint();
}

/**
 * densable 2.1.247 `sr` Et — custom label only while showing the selected tip.
 * `Et=V===F&&C?C:"Tip"`
 */
export function resolveSpinnerTipLabel(
  displayedTip: string | undefined,
  selectedTip: string | undefined,
  label: string | undefined,
): string {
  return displayedTip === selectedTip && label ? label : 'Tip';
}

/**
 * Official 2.1.292 (#262) `rt` — mid-turn `/focus` tip rendering:
 * `nt ? Next: ... : F === hhr && gt ? TMi : Ct ? `${Et}: ${Ct}` : undefined`
 */
export function resolveSpinnerTipText(opts: {
  nextTaskSubject?: string;
  spinnerTip?: string;
  spinnerTipLabel?: string;
  effectiveTip?: string;
  briefTranscript?: boolean;
}): string | undefined {
  if (opts.nextTaskSubject) {
    return `Next: ${opts.nextTaskSubject.replace(/\s+/g, ' ').trim()}`;
  }
  if (opts.spinnerTip === FOCUS_TIP_INVITE && opts.briefTranscript) {
    return FOCUS_TIP_ACTIVE;
  }
  if (opts.effectiveTip) {
    return `${resolveSpinnerTipLabel(opts.effectiveTip, opts.spinnerTip, opts.spinnerTipLabel)}: ${opts.effectiveTip}`;
  }
  return undefined;
}

const SPINNER_VERB_HAS_ELLIPSIS = /(?:…|\.\.\.)$/;

/** densable H$ — grapheme clip. rt appends … only when the verb was cut. */
function clipSpinnerVerb(verb: string, width: number): string {
  if (width <= 0) return '';
  let out = '';
  let used = 0;
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  }).segment(verb)) {
    const w = stringWidth(segment);
    if (used + w > width) break;
    out += segment;
    used += w;
  }
  return out;
}

/** densable Ytt → rt(verb, max(40, columns-8)). Fits as-is; otherwise clip to budget-1 and add …. */
function truncateSpinnerVerb(verb: string, columns: number): string {
  const budget = Math.max(40, columns - 8);
  if (stringWidth(verb) <= budget) return verb;
  if (budget <= 1) return '…';
  return `${clipSpinnerVerb(verb, budget - 1)}…`;
}

/** densable Cn `vt = N === Gt && Te.test(ft) ? ft : ft + N` @203396380. */
function withSpinnerEllipsis(verb: string, suffix = '…'): string {
  return suffix === '…' && SPINNER_VERB_HAS_ELLIPSIS.test(verb) ? verb : `${verb}${suffix}`;
}

type Props = {
  mode: SpinnerMode;
  loadingStartTimeRef: React.RefObject<number>;
  totalPausedMsRef: React.RefObject<number>;
  pauseStartTimeRef: React.RefObject<number | null>;
  spinnerTip?: string;
  /** densable 2.1.247 `spinnerTipLabel` — `sr` `C`; Et uses it only when V===F. */
  spinnerTipLabel?: string;
  responseLengthRef: React.RefObject<number>;
  apiMetricsRef?: React.RefObject<
    Array<{
      ttftMs: number;
      firstTokenTime: number;
      lastTokenTime: number;
      responseLengthBaseline: number;
      endResponseLength: number;
    }>
  >;
  overrideColor?: keyof Theme | null;
  overrideShimmerColor?: keyof Theme | null;
  overrideMessage?: string | null;
  spinnerSuffix?: string | null;
  verbose: boolean;
  /** True while a compaction summary is streaming — shows a token progress bar. */
  compactProgressActiveRef?: React.RefObject<boolean>;
  /**
   * densable compactingHintText. The Next/Tip slot shows this only when
   * compacting and the hint is non-null. A null hint leaves Next visible.
   */
  compactingHint?: string | null;
  /** densable compactingStartTime — Je elapsed is max(0, now - start). */
  compactingStartTime?: number | null;
  hasActiveTools?: boolean;
  /** Leader's turn has completed (no active query). Used to suppress stall-red spinner when only teammates are running. */
  leaderIsIdle?: boolean;
  /**
   * densable 2.1.214 #39 retryStatus — when set, SpinnerAnimationRow shows
   * Msn-style stalled / retry countdown instead of the normal verb row.
   */
  retryStatus?: import('../utils/advisorNetworkStall.js').RetryStatus | null;
  /** densable outputLimitRecovery — "picking the thought back up". */
  outputLimitRecovery?: import('./Spinner/statusKind.js').OutputLimitRecovery | null;
  /** Official 2.1.326 #205: true once assistant reply text has streamed in this turn. */
  afterReplyText?: boolean;
  /** densable Ye/Je agentId — stall reset when the viewed agent changes. */
  agentId?: string;
  /** densable xMn `word` / Cn `defaultVerb`. */
  defaultVerb?: string;
  /** densable xMn `suffix` / Cn `suffix` (`N`) — verb trailing ellipsis, NOT byline `spinnerSuffix`. */
  verbSuffix?: string;
  /** densable Ohr `isCompacting` (@203394850). */
  isCompacting?: boolean;
  /** densable Ohr `turnEffort` (@203394850 / @203396500). */
  turnEffort?: import('../utils/effort.js').EffortValue;
  /** densable Ohr `turnModel` (@203394850 / @203396500). */
  turnModel?: string;
};

// Thin wrapper: branches on isBriefOnly so the two variants have independent
// hook call chains. Without this split, toggling /brief mid-render would
// violate Rules of Hooks (the inner variant calls ~10 more hooks).
export function SpinnerWithVerb(props: Props): React.ReactNode {
  const leftoverIhrSession = props.agentId ?? getMainThreadAgentId();
  const { columns, rows } = useTerminalSize();
  useLeftoverIhrStore();
  const leftoverOhr = useSyncExternalStore(
    leftoverIhrSubscribe,
    () => leftoverIhrSlice(leftoverIhrSession),
    () => leftoverIhrSlice(leftoverIhrSession),
  );
  const leftoverHas = leftoverIhrHas(leftoverIhrSession);
  const leftoverProps: Props = {
    ...props,
    mode: leftoverHas && leftoverOhr.mode ? (leftoverOhr.mode as SpinnerMode) : props.mode,
    overrideMessage: leftoverOhr.overrideMessage ?? props.overrideMessage,
    overrideColor: (leftoverOhr.overrideColor as Props['overrideColor']) ?? props.overrideColor,
    overrideShimmerColor:
      (leftoverOhr.overrideShimmerColor as Props['overrideShimmerColor']) ?? props.overrideShimmerColor,
    retryStatus: (leftoverOhr.retryStatus as Props['retryStatus']) ?? props.retryStatus,
    outputLimitRecovery: (leftoverOhr.outputLimitRecovery as Props['outputLimitRecovery']) ?? props.outputLimitRecovery,
    compactingHint: leftoverOhr.compactingHintText ?? props.compactingHint,
    compactingStartTime: leftoverOhr.compactingStartTime ?? props.compactingStartTime,
    isCompacting: Boolean(leftoverOhr.isCompacting || props.isCompacting),
    turnEffort:
      (typeof leftoverOhr.turnEffort === 'string' || typeof leftoverOhr.turnEffort === 'number'
        ? (leftoverOhr.turnEffort as import('../utils/effort.js').EffortValue)
        : undefined) ?? props.turnEffort,
    turnModel: (typeof leftoverOhr.turnModel === 'string' ? leftoverOhr.turnModel : undefined) ?? props.turnModel,
  };
  // densable xMn: word is Ohr defaultVerb; message is overrideMessage; Gt is U+2026.
  const spinnerEllipsis = '…';
  const defaultVerb = leftoverOhr.defaultVerb;
  const rendered = useUiRenderHost({
    component: 'Spinner',
    requestId: leftoverProps.agentId ?? 'main',
    props: {
      word: defaultVerb,
      message: leftoverProps.overrideMessage ?? null,
      suffix: spinnerEllipsis,
      mode: leftoverProps.mode,
    },
    viewport: { columns, rows },
  });
  leftoverProps.overrideMessage =
    rendered.props.message === null || typeof rendered.props.message === 'string'
      ? (rendered.props.message as string | null)
      : leftoverProps.overrideMessage;
  leftoverProps.defaultVerb = typeof rendered.props.word === 'string' ? rendered.props.word : defaultVerb;
  // densable xMn → Cn: `suffix: W.props.suffix ?? Gt` feeds verb `vt`, NEVER `spinnerSuffix` (`O` inside `(...)`).
  leftoverProps.verbSuffix = typeof rendered.props.suffix === 'string' ? rendered.props.suffix : spinnerEllipsis;
  const wrapSpinner = (engine: React.ReactNode): React.ReactNode => {
    if (rendered.pluginTree !== undefined) {
      return (
        <PluginRenderedTree
          node={rendered.pluginTree}
          plugin={rendered.pluginName}
          requestId={leftoverProps.agentId ?? 'main'}
          component="Spinner"
          engine={engine}
        />
      );
    }
    if (rendered.drawPending) {
      return <Box flexDirection="column" drawPending minHeight={rendered.minHeight} />;
    }
    return engine;
  };
  const isBriefOnly = useAppState(s => s.isBriefOnly);
  // REPL overrides isBriefOnly→false when viewing a teammate transcript
  // (see isBriefOnly={viewedTeammateTask ? false : isBriefOnly}). That
  // prop isn't threaded here, so replicate the gate from the store —
  // teammate view needs the real spinner (which shows teammate status).
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  // Hoisted to mount-time — this component re-renders at animation framerate.
  const briefEnvEnabledRaw = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_BRIEF), []);
  const briefEnvEnabled = feature('KAIROS') || feature('KAIROS_BRIEF') ? briefEnvEnabledRaw : false;

  // Runtime gate mirrors isBriefEnabled() but inlined — importing from
  // BriefTool.ts would leak tool-name strings into external builds. Single
  // spinner instance → hooks stay unconditional (two subs, negligible).
  if (
    (feature('KAIROS') || feature('KAIROS_BRIEF')) &&
    (getKairosActive() ||
      (getUserMsgOptIn() && (briefEnvEnabled || getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_brief', false)))) &&
    isBriefOnly &&
    !viewingAgentTaskId
  ) {
    return wrapSpinner(<BriefSpinner mode={leftoverProps.mode} overrideMessage={leftoverProps.overrideMessage} />);
  }

  return wrapSpinner(<SpinnerWithVerbInner {...leftoverProps} />);
}

function SpinnerWithVerbInner({
  mode,
  loadingStartTimeRef,
  totalPausedMsRef,
  pauseStartTimeRef,
  spinnerTip,
  spinnerTipLabel,
  responseLengthRef,
  overrideColor,
  overrideShimmerColor,
  overrideMessage,
  spinnerSuffix,
  verbose,
  compactProgressActiveRef,
  compactingHint = null,
  compactingStartTime = null,
  hasActiveTools = false,
  leaderIsIdle = false,
  retryStatus = null,
  outputLimitRecovery = null,
  afterReplyText = false,
  agentId,
  defaultVerb: rewrittenDefaultVerb,
  verbSuffix = '…',
  isCompacting = false,
  turnEffort,
  turnModel,
}: Props): React.ReactNode {
  const settings = useSettings();
  const reducedMotion = (settings.prefersReducedMotion ?? false) || isScreenReaderModeEnabled();

  // NOTE: useAnimationFrame(50) lives in SpinnerAnimationRow, not here.
  // This component only re-renders when props or app state change —
  // it is no longer on the 50ms clock. All `time`-derived values
  // (frame, glimmer, stalled intensity, token counter, thinking shimmer,
  // elapsed-time timer) are computed inside the child.

  const tasks = useAppState(s => s.tasks);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const expandedView = useAppState(s => s.expandedView);
  const showExpandedTodos = expandedView === 'tasks';
  // Get foregrounded teammate (if viewing a teammate's transcript)
  const foregroundedTeammate = viewingAgentTaskId ? getViewedTeammateTask({ viewingAgentTaskId, tasks }) : undefined;
  const { columns } = useTerminalSize();
  const tasksV2 = useTasksV2();
  const briefTranscript = useAppState(s => s.briefTranscript);

  // Track thinking status: 'thinking' | number (duration in ms) | null
  // Shows each state for minimum 2s to avoid UI jank
  const [thinkingStatus, setThinkingStatus] = useState<'thinking' | number | null>(null);
  const thinkingStartRef = useRef<number | null>(null);

  useEffect(() => {
    let showDurationTimer: ReturnType<typeof setTimeout> | null = null;
    let clearStatusTimer: ReturnType<typeof setTimeout> | null = null;

    if (mode === 'thinking') {
      // Started thinking
      if (thinkingStartRef.current === null) {
        thinkingStartRef.current = Date.now();
        setThinkingStatus('thinking');
      }
    } else if (thinkingStartRef.current !== null) {
      // Stopped thinking - calculate duration and ensure 2s minimum display
      const duration = Date.now() - thinkingStartRef.current;
      const elapsed = Date.now() - thinkingStartRef.current;
      const remainingThinkingTime = Math.max(0, 2000 - elapsed);

      thinkingStartRef.current = null;

      // Show "thinking..." for remaining time if < 2s elapsed, then show duration
      const showDuration = (): void => {
        setThinkingStatus(duration);
        // Clear after 2s
        clearStatusTimer = setTimeout(setThinkingStatus, 2000, null);
      };

      if (remainingThinkingTime > 0) {
        showDurationTimer = setTimeout(showDuration, remainingThinkingTime);
      } else {
        showDuration();
      }
    }

    return () => {
      if (showDurationTimer) clearTimeout(showDurationTimer);
      if (clearStatusTimer) clearTimeout(clearStatusTimer);
    };
  }, [mode]);

  // densable 2.1.289 Cn `st=y===void 0||y===Ve()` — Next:/todo chrome is main-session only.
  const isMainSession = agentId === undefined || agentId === getMainThreadAgentId();
  // Find the current in-progress task and next pending task
  const currentTodo = isMainSession
    ? tasksV2?.find(task => task.status !== 'pending' && task.status !== 'completed')
    : undefined;
  const nextTask = isMainSession ? findNextPendingTask(tasksV2) : undefined;

  // densable Ohr — defaultVerb is leftoverIhr `hN(DTt())`, not a local sample.
  const leftoverIhrSession = agentId ?? getMainThreadAgentId();
  const leftoverDefaultVerb = useSyncExternalStore(
    leftoverIhrSubscribe,
    () => leftoverIhrGet(leftoverIhrSession).defaultVerb,
    () => leftoverIhrGet(leftoverIhrSession).defaultVerb,
  );
  // densable Cn `defaultVerb:W.props.word` — HAS rewrite of word.
  // densable Cn `[ct]=g(()=>hN(DTt())??"Working")`, verb `S||ct`.
  const [fallbackVerb] = useState(() => sample(getSpinnerVerbs()) ?? 'Working');
  const randomVerb = rewrittenDefaultVerb || leftoverDefaultVerb || fallbackVerb;

  // densable pt: current todo activeForm, else subject, whitespace collapsed.
  // Ytt truncates only that todo verb. Override and the random verb are not clipped.
  const todoVerb = [currentTodo?.activeForm, currentTodo?.subject]
    .map(text => text?.replace(/\s+/g, ' ').trim())
    .find((text): text is string => Boolean(text));
  const truncatedTodo = todoVerb !== undefined ? truncateSpinnerVerb(todoVerb, columns) : undefined;

  const effectiveVerb =
    foregroundedTeammate && !foregroundedTeammate.isIdle
      ? (foregroundedTeammate.spinnerVerb ?? randomVerb)
      : (overrideMessage ?? truncatedTodo ?? randomVerb);
  const message = withSpinnerEllipsis(effectiveVerb ?? 'Working', verbSuffix);

  // Track CLI activity when spinner is active
  useEffect(() => {
    const operationId = 'spinner-' + mode;
    activityManager.startCLIActivity(operationId);
    return () => {
      activityManager.endCLIActivity(operationId);
    };
  }, [mode]);

  const sessionModel = getMainLoopModel();
  const resolvedModel = turnModel ?? sessionModel;
  const effortValue = useAppState(s => turnEffort ?? pdSessionEffort(s, resolvedModel));
  const ultracode = useAppState(s => s.ultracode);
  // densable 2.1.289 Cn (@203396500): LWt(P ?? tt(), Ot, F ?? void 0) — turnModel/turnEffort
  // override session model/effort, while subagent transcript view uses LocalAgentTask.effort/model.
  const spinnerEffortSource = resolveSpinnerEffortSource({
    sessionEffort: effortValue,
    sessionModel: resolvedModel,
    viewingAgentTaskId,
    tasks,
  });
  const effortSuffix = getEffortSuffix(spinnerEffortSource.model, spinnerEffortSource.effortValue, ultracode);
  const effectiveIsCompacting = Boolean(isCompacting || compactProgressActiveRef?.current);
  const effectiveCompactActiveRef = useRef(effectiveIsCompacting);
  effectiveCompactActiveRef.current = effectiveIsCompacting;

  // Check if any running in-process teammates exist (needed for both modes)
  const runningTeammates = getAllInProcessTeammateTasks(tasks).filter(t => t.status === 'running');
  const hasRunningTeammates = runningTeammates.length > 0;
  const allIdle = hasRunningTeammates && runningTeammates.every(t => t.isIdle);

  // Gather aggregate token stats from all running agents only when viewing the
  // main thread; when viewing a specific subagent/teammate, responseLengthRef
  // (from sje) already reflects that agent's own token count.
  let teammateTokens = 0;
  if (isMainSession) {
    for (const task of Object.values(tasks)) {
      if (task.status !== 'running') continue;
      if (isInProcessTeammateTask(task)) {
        if (task.progress?.tokenCount) {
          teammateTokens += task.progress.tokenCount;
        }
        continue;
      }
      if (isLocalAgentTask(task)) {
        if (task.progress?.tokenCount) {
          teammateTokens += task.progress.tokenCount;
        }
      }
    }
  }

  // Stale read of the refs for showBtwTip below — we're off the 50ms clock
  // so this only updates when props/app state change, which is sufficient for
  // a coarse 30s threshold.
  // densable #18: monotonic clock must match loadingStartTimeRef (performance.now)
  const elapsedSnapshot =
    pauseStartTimeRef.current !== null
      ? pauseStartTimeRef.current - loadingStartTimeRef.current - totalPausedMsRef.current
      : performance.now() - loadingStartTimeRef.current - totalPausedMsRef.current;

  const defaultColor: keyof Theme = 'claude';
  const defaultShimmerColor = 'claudeShimmer';
  const messageColor = overrideColor ?? defaultColor;
  const shimmerColor = overrideShimmerColor ?? defaultShimmerColor;

  // TTFT display is gated to internal builds — apiMetricsRef was removed from
  // props during a refactor, so skip this until it's re-threaded.
  const _ttftText: string | null = null;

  // Official 2.1.326 #205 (`Me`/`We`/`Ot`): once reply text has streamed without active tools,
  // suppress the tip line when transitioning out so it does not flash back and bounce layout.
  // Must run unconditionally above the idle-teammate early return (Rules of Hooks).
  const suppressTipAfterReply = afterReplyText && !hasActiveTools && (mode === 'responding' || mode === 'tool-use');
  const [wasTipSuppressedAfterReply, setWasTipSuppressedAfterReply] = useState(suppressTipAfterReply);
  if (wasTipSuppressedAfterReply && !suppressTipAfterReply) {
    setWasTipSuppressedAfterReply(false);
  }
  const hideTipAfterReplyText = suppressTipAfterReply && (wasTipSuppressedAfterReply || mode === 'tool-use');

  // When viewing an idle teammate, show static idle display instead of animated spinner
  if (foregroundedTeammate?.isIdle) {
    const idleText = allIdle
      ? `${TEARDROP_ASTERISK} Worked for ${formatDuration(Date.now() - foregroundedTeammate.startTime)}`
      : `${TEARDROP_ASTERISK} Idle`;
    return (
      <Box flexDirection="column" width="100%" alignItems="flex-start">
        <Box flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
          <Text dimColor>{idleText}</Text>
        </Box>
      </Box>
    );
  }

  // densable ohe: excludeDefault plus a tips file or tips list keeps the custom tip.
  // Official 2.1.326 #350: removed the 30-minute `/clear` spinner tip.
  const tipsOverride = settings.spinnerTipsOverride;
  const customTipsActive =
    tipsOverride?.excludeDefault === true && (Boolean(tipsOverride.tipsFile) || (tipsOverride.tips?.length ?? 0) > 0);
  const tipsEnabled = settings.spinnerTipsEnabled !== false;
  const showBtwTip = isMainSession && tipsEnabled && elapsedSnapshot > 30_000 && !getGlobalConfig().btwUseCount;

  const effectiveTip = customTipsActive ? spinnerTip : showBtwTip && !nextTask ? BTW_SPINNER_TIP : spinnerTip;
  const tipLabel = resolveSpinnerTipLabel(effectiveTip, spinnerTip, spinnerTipLabel);

  // Budget text (ant-only) — shown above the tip line
  let budgetText: string | null = null;
  if (feature('TOKEN_BUDGET')) {
    const budget = getCurrentTurnTokenBudget();
    if (budget !== null && budget > 0) {
      const tokens = getTurnOutputTokens();
      if (tokens >= budget) {
        budgetText = `Target: ${formatNumber(tokens)} used (${formatNumber(budget)} min ${figures.tick})`;
      } else {
        const pct = Math.round((tokens / budget) * 100);
        const remaining = budget - tokens;
        const rate = elapsedSnapshot > 5000 && tokens >= 2000 ? tokens / elapsedSnapshot : 0;
        const eta = rate > 0 ? ` \u00B7 ~${formatDuration(remaining / rate, { mostSignificantOnly: true })}` : '';
        budgetText = `Target: ${formatNumber(tokens)} / ${formatNumber(budget)} (${pct}%)${eta}`;
      }
    }
  }

  const persistLine = retryStatus ? overloadPersistLine(retryStatus) : null;
  const tipLineText = resolveSpinnerTipText({
    nextTaskSubject: nextTask?.subject,
    spinnerTip,
    spinnerTipLabel,
    effectiveTip,
    briefTranscript,
  });

  return (
    <Box flexDirection="column" width="100%" alignItems="flex-start">
      <SpinnerAnimationRow
        mode={mode}
        reducedMotion={reducedMotion}
        hasActiveTools={hasActiveTools}
        responseLengthRef={responseLengthRef}
        message={message}
        messageColor={messageColor}
        shimmerColor={shimmerColor}
        overrideColor={overrideColor}
        loadingStartTimeRef={loadingStartTimeRef}
        totalPausedMsRef={totalPausedMsRef}
        pauseStartTimeRef={pauseStartTimeRef}
        spinnerSuffix={spinnerSuffix}
        verbose={verbose}
        columns={columns}
        compactProgressActiveRef={effectiveCompactActiveRef}
        compactingStartTime={compactingStartTime}
        hasRunningTeammates={hasRunningTeammates}
        teammateTokens={teammateTokens}
        foregroundedTeammate={foregroundedTeammate}
        leaderIsIdle={leaderIsIdle}
        thinkingStatus={thinkingStatus}
        effortSuffix={effortSuffix}
        retryStatus={retryStatus}
        showToolCallTimer={getFeatureValue_CACHED_MAY_BE_STALE('tengu_shining_fractals', false)}
        outputLimitRecovery={outputLimitRecovery}
        agentId={agentId}
      />
      {isMainSession && showExpandedTodos && tasksV2 && tasksV2.length > 0 ? (
        <Box width="100%" flexDirection="column">
          <MessageResponse>
            <TaskListV2 tasks={tasksV2} />
          </MessageResponse>
        </Box>
      ) : compactingHint && effectiveIsCompacting ? (
        <Box width="100%" flexDirection="column">
          <MessageResponse>
            <Text dimColor>{compactingHint}</Text>
          </MessageResponse>
        </Box>
      ) : retryStatus ? (
        persistLine ? (
          <Box width="100%" flexDirection="column">
            <MessageResponse>
              <Text dimColor>{persistLine}</Text>
            </MessageResponse>
          </Box>
        ) : null
      ) : (tipLineText && !hideTipAfterReplyText) || budgetText ? (
        // IMPORTANT: we need this width="100%" to avoid an Ink bug where the
        // tip gets duplicated over and over while the spinner is running if
        // the terminal is very small. TODO: fix this in Ink.
        // densable 2.1.289 Cn: todos XOR (isCompacting && hint) XOR retry XOR Et.
        // A compact with no hint still shows Next.
        <Box width="100%" flexDirection="column">
          {budgetText && (
            <MessageResponse>
              <Text dimColor>{budgetText}</Text>
            </MessageResponse>
          )}
          {tipLineText && !hideTipAfterReplyText && (
            <MessageResponse>
              {!nextTask && effectiveTip === EXPLANATORY_TIP_FULL ? (
                <Box flexDirection="row" flexWrap="wrap">
                  <Text dimColor>
                    {tipLabel}: {EXPLANATORY_TIP_PREFIX} ·{' '}
                  </Text>
                  <Box flexShrink={0}>
                    <SlashCommandLink
                      command={EXPLANATORY_TIP_COMMAND}
                      args={EXPLANATORY_TIP_ARGS}
                      color="suggestion"
                    />
                  </Box>
                </Box>
              ) : (
                <Text dimColor wrap={nextTask ? 'truncate-end' : 'wrap'}>
                  {nextTask ? tipLineText : <Ansi>{tipLineText}</Ansi>}
                </Text>
              )}
            </MessageResponse>
          )}
        </Box>
      ) : null}
    </Box>
  );
}

// Brief/assistant mode spinner: single status line. PromptInput drops its
// own marginTop when isBriefOnly is active, so this component owns the
// 2-row footprint between messages and input. Footprint is [blank, content]
// — one blank row above (breathing room under the messages list), spinner
// flush against the input bar. PromptInput's absolute-positioned
// Notifications overlay compensates with marginTop=-2 in brief mode
// (PromptInput.tsx:~2928) so it floats into the blank row above the
// spinner, not over the spinner content. Paired with BriefIdleStatus which
// keeps the same footprint when idle.
type BriefSpinnerProps = {
  mode: SpinnerMode;
  overrideMessage?: string | null;
};

function BriefSpinner({ mode, overrideMessage }: BriefSpinnerProps): React.ReactNode {
  const settings = useSettings();
  const isScreenReader = isScreenReaderModeEnabled();
  const reducedMotion = (settings.prefersReducedMotion ?? false) || isScreenReader;
  // densable _n `[h]=g(()=>hN(DTt())??"Working")`, label `t??h` — brief mode
  // does not read the Ihr store's defaultVerb.
  const [randomVerb] = useState(() => sample(getSpinnerVerbs()) ?? 'Working');
  const rawVerb = overrideMessage ?? randomVerb;
  const connStatus = useAppState(s => s.remoteConnectionStatus);

  // Track CLI activity so OS/IDE "busy" indicators fire in brief mode too
  useEffect(() => {
    const operationId = 'spinner-' + mode;
    activityManager.startCLIActivity(operationId);
    return () => {
      activityManager.endCLIActivity(operationId);
    };
  }, [mode]);

  // Drive both dot cycle and shimmer from the shared clock. The viewport
  // ref is unused — the spinner unmounts on turn end so viewport-based
  // pausing isn't needed.
  const [, time] = useAnimationFrame(reducedMotion ? null : 120);

  // Local tasks + remote tasks are mutually exclusive (viewer mode has an
  // empty local AppState.tasks; local mode has remoteBackgroundTaskCount=0).
  // Summing avoids a mode branch.
  const runningCount = useAppState(s => count(Object.values(s.tasks), isBackgroundTask) + s.remoteBackgroundTaskCount);

  // Connection trouble overrides the verb — `claude assistant` is a pure viewer,
  // nothing useful is happening while the WS is down.
  const showConnWarning = connStatus === 'reconnecting' || connStatus === 'disconnected';
  const { columns } = useTerminalSize();
  const { labelBudget, rightText } = leftoverBhrIdleBudget(columns, runningCount, showConnWarning);
  const verb = truncateToWidth(rawVerb, labelBudget);
  const connText = truncateToWidth(connStatus === 'reconnecting' ? 'Reconnecting' : 'Disconnected', labelBudget);
  const activeLabel = showConnWarning ? connText : verb;

  // Dots padded to a fixed 3 columns so the right-aligned count doesn't
  // jitter as the cycle advances.
  const dotFrame = Math.floor(time / 300) % 3;
  const dots = reducedMotion
    ? SPINNER_VERB_HAS_ELLIPSIS.test(activeLabel)
      ? '   '
      : '…  '
    : '.'.repeat(dotFrame + 1).padEnd(3);

  // Shimmer: reverse-sweep highlight across the verb. Skip for connection
  // warnings (shimmer reads as "working"; Reconnecting/Disconnected is not).
  const verbWidth = useMemo(() => stringWidth(verb), [verb]);
  const glimmerIndex =
    reducedMotion || showConnWarning ? -100 : computeGlimmerIndex(Math.floor(time / SHIMMER_INTERVAL_MS), verbWidth);
  const { before, shimmer, after } = computeShimmerSegments(verb, glimmerIndex);

  // Manual right-align via space padding — flexGrow spacers inside
  // FullscreenLayout's `main` slot don't resolve a width and caused the
  // diff engine to miss dot-frame updates.
  const leftWidth = (showConnWarning ? stringWidth(connText) : verbWidth) + 3;
  const pad = Math.max(1, columns - 2 - leftWidth - stringWidth(rightText));

  return (
    <Box flexDirection="row" width="100%" marginTop={1} paddingLeft={2}>
      {showConnWarning ? (
        <Text color="error">{connText + dots}</Text>
      ) : (
        <>
          {before ? <Text dimColor>{before}</Text> : null}
          {shimmer ? <Text>{shimmer}</Text> : null}
          {after ? <Text dimColor>{after}</Text> : null}
          <Text dimColor>{dots}</Text>
        </>
      )}
      {rightText ? (
        <>
          <Text>{' '.repeat(pad)}</Text>
          <Text dimColor>{rightText}</Text>
        </>
      ) : null}
    </Box>
  );
}

// Idle placeholder for brief mode. Same 2-row [blank, content] footprint
// as BriefSpinner so the input bar never jumps when toggling between
// working/idle/disconnected. See BriefSpinner's comment for the
// Notifications overlay coupling.
export function BriefIdleStatus(): React.ReactNode {
  const connStatus = useAppState(s => s.remoteConnectionStatus);
  const runningCount = useAppState(s => count(Object.values(s.tasks), isBackgroundTask) + s.remoteBackgroundTaskCount);
  const { columns } = useTerminalSize();
  const showConnWarning = connStatus === 'reconnecting' || connStatus === 'disconnected';
  const { labelBudget, rightText } = leftoverBhrIdleBudget(columns, runningCount, showConnWarning);
  const leftText = leftoverBhrConnLabel(connStatus, labelBudget);

  if (!leftText && !rightText) return <Box height={2} />;

  const pad = Math.max(1, columns - 2 - stringWidth(leftText) - stringWidth(rightText));
  return (
    <Box marginTop={1} paddingLeft={2}>
      <Text>
        {leftText ? <Text color="error">{leftText}</Text> : null}
        {rightText ? (
          <>
            <Text>{' '.repeat(pad)}</Text>
            <Text dimColor>{rightText}</Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
}

export function Spinner(): React.ReactNode {
  const settings = useSettings();
  const isScreenReader = isScreenReaderModeEnabled();
  const reducedMotion = (settings.prefersReducedMotion ?? false) || isScreenReader;
  const [ref, time] = useAnimationFrame(reducedMotion ? null : 120);

  // Reduced motion / screen-reader: static dot instead of animated spinner
  if (reducedMotion) {
    return (
      <Box ref={ref} aria-hidden flexWrap="wrap" height={1} width={2}>
        <Text color="text">●</Text>
      </Box>
    );
  }

  const spinnerFrames = getSpinnerPingPongFrames();
  const frame = Math.floor(time / 120) % spinnerFrames.length;

  return (
    <Box ref={ref} aria-hidden flexWrap="wrap" height={1} width={2}>
      <Text color="text">{spinnerFrames[frame]}</Text>
    </Box>
  );
}

function findNextPendingTask(tasks: Task[] | undefined): Task | undefined {
  if (!tasks) {
    return undefined;
  }
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  if (pendingTasks.length === 0) {
    return undefined;
  }
  const unresolvedIds = new Set(tasks.filter(t => t.status !== 'completed').map(t => t.id));
  return pendingTasks.find(t => !t.blockedBy.some(id => unresolvedIds.has(id))) ?? pendingTasks[0];
}
