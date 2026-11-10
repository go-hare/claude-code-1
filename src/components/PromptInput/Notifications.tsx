import { feature } from 'bun:bundle';
import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  compareNotificationPriority,
  isNotificationVisible,
  type Notification,
  type NotificationSegment,
  useNotifications,
} from 'src/context/notifications.js';
import { logEvent } from 'src/services/analytics/index.js';
import { useAppState } from 'src/state/AppState.js';
import { useVoiceState } from '../../context/voice.js';
import type { VerificationStatus } from '../../hooks/useApiKeyVerification.js';
import type { IDESelection } from '../../hooks/useIdeSelection.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useVoiceEnabled } from '../../hooks/useVoiceEnabled.js';
import {
  AccessibilityContext,
  Box,
  ClockContext,
  type DOMElement,
  isGhosttyXtversion,
  Link,
  type RGBColor,
  stringWidth,
  Text,
  useAnimationTimer,
  useApp,
  useTerminalSize,
  useTheme,
  wrapText,
} from '@anthropic/ink';
import { TranscriptOverlayOffsetContext } from '../transcriptOverlayOffset.js';
import {
  dismissToastItem,
  expireToasts,
  getToasts,
  holdToastItem,
  pauseToasts,
  subscribeToasts,
  TOAST_HOLD_MAX_MS,
  type ToastItem,
} from '../toastStore.js';
import { notificationsHoldToasts } from '../../utils/replDiffMouseHost.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { useClaudeAiLimits } from '../../services/claudeAiLimitsHook.js';
import { calculateTokenWarningState } from '../../services/compact/autoCompact.js';
import { useCompactWarningSuppression } from '../../services/compact/compactWarningHook.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import type { Message } from '../../types/message.js';
import { getIsRemoteMode, getLastApiCompletionTimestamp } from '../../bootstrap/state.js';
import { summarizePromptCache } from '../../commands/cost/promptCacheTracker.js';
import { useMemoryUsage } from '../../hooks/useMemoryUsage.js';
import { getApiKeyHelperElapsedMs, getConfiguredApiKeyHelper, getSubscriptionType } from '../../utils/auth.js';
import type { AutoUpdaterResult } from '../../utils/autoUpdater.js';
import { getExternalEditor } from '../../utils/editor.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { formatDuration, formatFileSize } from '../../utils/format.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { setEnvHookNotifier } from '../../utils/hooks/fileChangedWatcher.js';
import { toIDEDisplayName } from '../../utils/ide.js';
import { logError } from '../../utils/log.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import { getTheme } from '../../utils/theme.js';
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js';
import { AutoUpdaterWrapper } from '../AutoUpdaterWrapper.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { SentryErrorBoundary } from '../SentryErrorBoundary.js';
import { interpolateColor, parseRGB, toRGBColor } from '../Spinner/utils.js';
import { TokenWarning } from '../TokenWarning.js';
import { SandboxPromptFooterHint } from './SandboxPromptFooterHint.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const VoiceIndicator: typeof import('./VoiceIndicator.js').VoiceIndicator = feature('VOICE_MODE')
  ? require('./VoiceIndicator.js').VoiceIndicator
  : () => null;
/* eslint-enable @typescript-eslint/no-require-imports */

export const FOOTER_TEMPORARY_STATUS_TIMEOUT = 5000;

/** densable `UX` — most toast boxes kept on the scroll column. */
const TOAST_STACK_MOST = 3;
/** densable `BX` — rows kept clear of the bottom chrome when unmeasured. */
const TOAST_STACK_BOTTOM = 8;
/** densable `RN` — slide-in duration. */
const TOAST_FADE_MS = 240;
/** densable `FX` — columns kept off the right edge of the scroll column. */
const TOAST_EDGE_COLUMNS = 2;
/** densable `ike` — widest toast box. */
const TOAST_BOX_COLUMNS = 44;
/** densable `dke` — columns the frame takes off the text. */
const TOAST_FRAME_COLUMNS = 4;
/** densable `HX` — text rows before the rest joins the last line. */
const TOAST_TEXT_ROWS = 3;
/** densable `rke` — slide clock. */
const TOAST_FRAME_MS = 48;

/**
 * densable `$l(o)` — subscribe to the yoga pass, then bump if the read moved
 * between the store snapshot and commit.
 */
function useMeasured(read: () => number): number {
  const { subscribeLayout } = useApp();
  const snapshot = useSyncExternalStore(subscribeLayout, read, read);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    if (!Object.is(read(), snapshot)) bump();
  });
  return snapshot;
}

function useYogaHeight(ref: React.RefObject<DOMElement | null>): number {
  const read = useCallback(() => {
    return ref.current?.yogaNode?.getComputedHeight() ?? 0;
  }, [ref]);
  return useMeasured(read);
}

/** densable `aD` — running tops from measured row heights. */
function stackedTops(heights: readonly number[], start: number): number[] {
  return heights.map((_, index) => start + heights.slice(0, index).reduce((sum, height) => sum + height, 0));
}

/**
 * densable `IX` — newest boxes that still fit, reserving a row for `+N more`
 * whenever anything older is left above them. At least one box is kept.
 * Unmeasured rows (0) are not yet a reason to drop a box.
 */
function fittingToastCount(heights: readonly number[], mostBoxes: number, roomRows: number, total: number): number {
  const newest = heights.toReversed().slice(0, mostBoxes);
  const tops = stackedTops(newest, 0);
  let fitted = 0;
  for (let index = 0; index < newest.length; index++) {
    const height = newest[index] ?? 0;
    if (height <= 0) {
      fitted += 1;
      continue;
    }
    const top = tops[index] ?? 0;
    const overflowRow = total > index + 1 ? 1 : 0;
    if (top + height + overflowRow > roomRows) break;
    fitted += 1;
  }
  return Math.min(heights.length, Math.max(1, fitted));
}

/** densable `nke` — columns still off the right edge while the box slides in. */
function slideColumns(shownAt: number, columns: number, now: number, still: boolean): number {
  if (still) return 0;
  const elapsed = Math.max(0, now - shownAt);
  if (elapsed >= TOAST_FADE_MS) return 0;
  return -Math.ceil(columns * (1 - elapsed / TOAST_FADE_MS));
}

/** densable `lD` — wrap to the room, keep three text rows, size the box to the text. */
function toastShape(
  toast: ToastItem,
  roomColumns: number,
  framed: boolean,
): { columns: number; lines: string[]; rows: number } {
  const frame = framed ? TOAST_FRAME_COLUMNS : 0;
  const width = Math.max(1, Math.min(roomColumns, TOAST_BOX_COLUMNS));
  const wrapped = wrapText(toast.text, Math.max(1, width - frame), 'wrap').split('\n');
  const lines = [...wrapped.slice(0, TOAST_TEXT_ROWS - 1), wrapped.slice(TOAST_TEXT_ROWS - 1).join(' ')].filter(
    (line, index) => index === 0 || line !== '',
  );
  const widest = Math.max(stringWidth(toast.plugin ?? ''), ...lines.map(line => stringWidth(line)));
  return { columns: Math.min(width, widest + frame), lines, rows: lines.length + 1 + (framed ? 2 : 0) };
}

/** densable `ju` — reduced motion from user setting or Ghostty gate. */
function useReducedMotion(): boolean {
  const prefersReducedMotion = useAppState(s => Boolean(s.settings.prefersReducedMotion));
  if (prefersReducedMotion) return true;
  return isGhosttyXtversion() && getFeatureValue_CACHED_MAY_BE_STALE('tengu_cedar_marsh', false);
}

/**
 * densable `VX` — pause stacked plugin toasts ONLY on `paneHoldsToasts`
 * (never `diffPanelVisible`), and restore `pauseToasts(false)` on unmount.
 */
function useToastPause(): boolean {
  const paused = useAppState(s => Boolean(s.paneHoldsToasts));
  useEffect(() => {
    pauseToasts(paused);
    return () => {
      pauseToasts(false);
    };
  }, [paused]);
  return paused;
}

/** densable `OX` — per-toast slide-in column offset (0 when still or done). */
function useSlideColumns(shownAt: number, columns: number, still: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const offset = slideColumns(shownAt, columns, now, still);
  useEffect(() => {
    if (offset === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), TOAST_FRAME_MS);
    return () => clearTimeout(timer);
  }, [now, offset]);
  return offset;
}

/** densable `vU` — single toast box; releases hover hold on unmount. */
function ToastBox({
  toast,
  shape,
  top,
  framed,
}: {
  toast: ToastItem;
  shape: { columns: number; lines: string[]; rows: number };
  top: number;
  framed: boolean;
}): ReactNode {
  const [hovered, setHovered] = useState(false);
  const reducedMotion = useReducedMotion();
  const still = reducedMotion || !framed;
  const rightOffset = useSlideColumns(toast.shownAt, shape.columns, still);
  const leaving = toast.phase === 'leaving';

  useEffect(() => {
    return () => {
      holdToastItem(toast.id, false);
    };
  }, [toast.id]);

  return (
    <Box
      position="absolute"
      top={top}
      right={rightOffset}
      width={shape.columns}
      height={shape.rows}
      flexDirection="column"
      borderStyle={framed ? 'round' : undefined}
      borderDimColor={!hovered}
      paddingX={framed ? 1 : 0}
      opaque
      noSelect
      onMouseEnter={() => {
        setHovered(true);
        holdToastItem(toast.id, true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        holdToastItem(toast.id, false);
      }}
      onClick={event => {
        event.stopImmediatePropagation();
        if (event.isWindowActivation) return;
        dismissToastItem(toast.id);
      }}
    >
      <Text dimColor wrap="truncate-end">
        {toast.plugin ?? ''}
      </Text>
      {shape.lines.map((line, lineIndex) => (
        <Text key={lineIndex} dimColor={leaving} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** densable `wU` — stacked toast boxes on the scroll column. */
function ToastBoxes({ toasts, paused }: { toasts: readonly ToastItem[]; paused: boolean }): ReactNode {
  const offset = useContext(TranscriptOverlayOffsetContext);
  const screenReader = useContext(AccessibilityContext);
  const { columns, rows } = useTerminalSize();
  const columnRef = useRef<DOMElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const measuredHeight = useYogaHeight(columnRef);
  const framed = !screenReader;

  useEffect(() => {
    if (paused || toasts.length === 0) return;
    expireToasts(Date.now());
  }, [now, toasts, paused]);

  useEffect(() => {
    if (paused || toasts.length === 0) return;
    const tick = Date.now();
    let nextWake = Infinity;
    for (const toast of toasts) {
      const wakeAt = toast.heldAt !== undefined ? toast.heldAt + TOAST_HOLD_MAX_MS : toast.leavesAt;
      if (wakeAt < nextWake) nextWake = wakeAt;
    }
    if (!Number.isFinite(nextWake)) return;
    const delay = Math.max(TOAST_FRAME_MS, nextWake - tick);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [now, toasts, paused]);

  if (paused || toasts.length === 0) return null;
  const roomColumns = Math.max(1, columns - TOAST_EDGE_COLUMNS);
  const roomRows = (measuredHeight > 0 ? measuredHeight : rows - TOAST_STACK_BOTTOM) - offset;
  const shapes = toasts.map(toast => toastShape(toast, roomColumns, framed));
  const heights = shapes.map(shape => shape.rows);
  const shownCount = fittingToastCount(heights, TOAST_STACK_MOST, roomRows, toasts.length);
  const shown = toasts.slice(-shownCount);
  const shownShapes = shapes.slice(-shownCount);
  const hidden = toasts.length - shown.length;
  const tops = stackedTops(
    shownShapes.map(shape => shape.rows),
    offset + (hidden > 0 ? 1 : 0),
  );
  return (
    <>
      <Box ref={columnRef} position="absolute" top={0} bottom={0} right={0} width={0} />
      {hidden > 0 ? (
        <Box position="absolute" top={offset} right={0} opaque noSelect>
          <Text dimColor>{` +${hidden} more `}</Text>
        </Box>
      ) : null}
      {shown.map((toast, index) => (
        <ToastBox
          key={toast.id}
          toast={toast}
          shape={shownShapes[index] ?? { columns: 1, lines: [], rows: 1 }}
          top={tops[index] ?? 0}
          framed={framed}
        />
      ))}
    </>
  );
}

function onToastStackError(error: Error): void {
  // densable AX/EX toast-stack BO unique English. Distinct from FEe pane hold.
  logError(new Error('ui.toast: the toast stack threw while drawn'));
  logError(new Error(`ui.toast threw while drawn: ${error.message}; no toast is drawn until the stack changes`));
}

/**
 * densable `hke` — absolute toasts on the scroll column wrapped in a dedicated
 * `SentryErrorBoundary` that resets when `toasts.length` changes.
 */
export function ToastStackView(): React.ReactNode {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const paused = useToastPause();
  return (
    <SentryErrorBoundary key={toasts.length} name="ui.toast" onError={onToastStackError}>
      <ToastBoxes toasts={toasts} paused={paused} />
    </SentryErrorBoundary>
  );
}

type Props = {
  apiKeyStatus: VerificationStatus;
  autoUpdaterResult: AutoUpdaterResult | null;
  isAutoUpdating: boolean;
  debug?: boolean;
  verbose: boolean;
  messages: Message[];
  onAutoUpdaterResult: (result: AutoUpdaterResult) => void;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  ideSelection?: IDESelection | undefined;
  mcpClients?: MCPServerConnection[];
  isInputWrapped?: boolean;
  hasStash?: boolean;
  isNarrow?: boolean;
};

/** densable `Jge` — segment renderer supporting `dim`, `bold`, `color`, and `url` (`Link`). */
function NotificationSegments({ segments }: { segments: NotificationSegment[] }): ReactNode {
  return segments.map((segment, i) => {
    const textNode = (
      <Text key={i} color={segment.color} dimColor={segment.dim} bold={segment.bold}>
        {segment.text}
      </Text>
    );
    return segment.url === undefined ? (
      textNode
    ) : (
      <Link key={i} url={segment.url}>
        {textNode}
      </Link>
    );
  });
}

/** densable `Ire` — single pinned notice with default `warning` color and `"⚠ "` prefix. */
function PinnedNotificationRow({ notice }: { notice: Notification }): ReactNode {
  const wrap = notice.wrap ? 'wrap' : 'truncate';
  const color = notice.color ?? 'warning';
  if ('jsx' in notice) {
    return (
      <Text color={color} wrap={wrap}>
        {'⚠ '}
        {notice.jsx}
      </Text>
    );
  }
  if ('segments' in notice && notice.segments) {
    return (
      <Text color={color} wrap={wrap}>
        {'⚠ '}
        <NotificationSegments segments={notice.segments} />
      </Text>
    );
  }
  if ('text' in notice) {
    return (
      <Text color={color} wrap={wrap}>
        {'⚠ '}
        {notice.text}
      </Text>
    );
  }
  return null;
}

/** densable `E1` — pinned notifications block rendered above the prompt border. */
export function PinnedNotifications(): ReactNode {
  const pinned = useAppState(s => s.notifications.pinned);
  if (!pinned || pinned.length === 0) return null;
  const sorted = pinned.slice().sort(compareNotificationPriority);
  return (
    <Box flexDirection="column" paddingX={2}>
      {sorted.map(notice => (
        <PinnedNotificationRow key={notice.key} notice={notice} />
      ))}
    </Box>
  );
}

const GOAL_PULSE_STEPS = 20;
const GOAL_PULSE_PERIOD_MS = 4000;
const GOAL_PULSE_FRAME_MS = GOAL_PULSE_PERIOD_MS / GOAL_PULSE_STEPS;
const GOAL_PULSE_DEPTH = 0.18;
const GOAL_PULSE_BLACK = { r: 0, g: 0, b: 0 };

/** densable `BDt` — 20-step 4s cosine pulse palette toward black. */
function buildGoalPulsePalette(base: { r: number; g: number; b: number }, quantize: boolean): RGBColor[] {
  return Array.from({ length: GOAL_PULSE_STEPS }, (_, index) => {
    const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / GOAL_PULSE_STEPS);
    const amount = GOAL_PULSE_DEPTH * (quantize ? Math.round(wave * 8) / 8 : wave);
    return toRGBColor(interpolateColor(base, GOAL_PULSE_BLACK, amount));
  });
}

/** densable `zre` — `/goal active` indicator trailing the prompt notification row. */
function ActiveGoalIndicator({ withSeparator }: { withSeparator: boolean }): ReactNode {
  const setAt = useAppState(s => s.activeGoal?.setAt);
  const clock = useContext(ClockContext);
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const anchorRef = useRef<{ setAt: number; clockStart: number } | null>(null);
  const clockNow = clock ? () => clock.now() : Date.now;
  if (setAt !== undefined && anchorRef.current?.setAt !== setAt) {
    anchorRef.current = { setAt, clockStart: clockNow() - (Date.now() - setAt) };
  }
  useEffect(() => {
    if (setAt === undefined || anchorRef.current === null) return;
    const elapsed = Math.max(0, (clock ? clock.now() : Date.now()) - anchorRef.current.clockStart);
    const step = elapsed < 60_000 ? 1000 : 60_000;
    const delay = step - (elapsed % step);
    if (clock) {
      return clock.setTimeout(bump, delay);
    }
    const timer = setTimeout(bump, delay);
    return () => clearTimeout(timer);
  }, [setAt, tick, clock]);

  const [currentTheme] = useTheme();
  const permissionColor = getTheme(currentTheme).permission;
  const pulsePalette = useMemo(() => {
    if (chalk.level < 3) return null;
    const rgb = parseRGB(permissionColor);
    return rgb ? buildGoalPulsePalette(rgb, isGhosttyXtversion()) : null;
  }, [permissionColor]);
  const animMs = useAnimationTimer(setAt !== undefined && pulsePalette ? GOAL_PULSE_FRAME_MS : null);
  const frameIndex = Math.floor(animMs / GOAL_PULSE_FRAME_MS) % GOAL_PULSE_STEPS;

  if (setAt === undefined || anchorRef.current === null) return null;
  const elapsed = Math.max(0, clockNow() - anchorRef.current.clockStart);
  const suffix = elapsed < 1000 ? '' : ` (${formatDuration(elapsed, { mostSignificantOnly: true })})`;
  return (
    <Box flexShrink={0}>
      {withSeparator ? <Text dimColor>{' · '}</Text> : null}
      <Text color={pulsePalette?.[frameIndex] ?? 'permission'}>
        <Text aria-hidden>{'◎ '}</Text>
        {`/goal active${suffix}`}
      </Text>
    </Box>
  );
}

export function NotificationBody({ notification }: { notification: Notification }): ReactNode {
  if ('segments' in notification && notification.segments) {
    return (
      <Text wrap="truncate" key={notification.key}>
        <NotificationSegments segments={notification.segments} />
      </Text>
    );
  }
  if ('jsx' in notification) {
    return (
      <Text wrap="truncate" key={notification.key}>
        {notification.jsx}
      </Text>
    );
  }
  if ('text' in notification) {
    return (
      <Text color={notification.color} dimColor={!notification.color} wrap="truncate">
        {notification.text}
      </Text>
    );
  }
  return null;
}

export function Notifications({
  apiKeyStatus,
  autoUpdaterResult,
  isAutoUpdating,
  verbose,
  messages,
  onAutoUpdaterResult,
  onChangeIsUpdating,
  isInputWrapped = false,
  hasStash = false,
}: Props): ReactNode {
  const tokenUsage = useMemo(() => {
    const messagesForTokenCount = getMessagesAfterCompactBoundary(messages);
    return tokenCountFromLastAPIResponse(messagesForTokenCount);
  }, [messages]);

  // AppState-sourced model — same source as API requests. getMainLoopModel()
  // re-reads settings.json on every call, so another session's /model write
  // would leak into this session's display (anthropics/claude-code#37596).
  const mainLoopModel = useMainLoopModel();
  const isShowingCompactMessage = calculateTokenWarningState(tokenUsage, mainLoopModel).isAboveWarningThreshold;
  const suppressCompactWarning = useCompactWarningSuppression();
  const isBriefOnlyState = useAppState(s => s.isBriefOnly);
  const isBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF') ? isBriefOnlyState : false;
  const hold = useAppState(notificationsHoldToasts);
  const notifications = useAppState(s => s.notifications);
  const { addNotification, removeNotification } = useNotifications();
  const claudeAiLimits = useClaudeAiLimits();

  // Register env hook notifier for CwdChanged/FileChanged feedback
  useEffect(() => {
    setEnvHookNotifier((text, isError) => {
      addNotification({
        key: 'env-hook',
        text,
        color: isError ? 'error' : undefined,
        priority: isError ? 'medium' : 'low',
        timeoutMs: isError ? 8000 : 5000,
      });
    });
    return () => setEnvHookNotifier(null);
  }, [addNotification]);

  // Check if we're in overage mode for UI indicators
  const isInOverageMode = claudeAiLimits.isUsingOverage;
  const subscriptionType = getSubscriptionType();
  const isTeamOrEnterprise = subscriptionType === 'team' || subscriptionType === 'enterprise';

  // Check if the external editor hint should be shown
  const editor = getExternalEditor();
  const shouldShowExternalEditorHint =
    isInputWrapped &&
    !isShowingCompactMessage &&
    apiKeyStatus !== 'invalid' &&
    apiKeyStatus !== 'missing' &&
    editor !== undefined;

  // Show external editor hint as notification when input is wrapped
  useEffect(() => {
    if (shouldShowExternalEditorHint && editor) {
      logEvent('tengu_external_editor_hint_shown', {});
      addNotification({
        key: 'external-editor-hint',
        jsx: (
          <Text dimColor>
            <ConfigurableShortcutHint
              action="chat:externalEditor"
              context="Chat"
              fallback="ctrl+g"
              description={`edit in ${toIDEDisplayName(editor)}`}
            />
          </Text>
        ),
        priority: 'immediate',
        timeoutMs: 5000,
      });
    } else {
      removeNotification('external-editor-hint');
    }
  }, [shouldShowExternalEditorHint, editor, addNotification, removeNotification]);

  // densable `Fo` — queue token-warning as an exempt medium notification so it
  // rotates with current notifications instead of permanently occupying the 1-row slot.
  useEffect(() => {
    if (isShowingCompactMessage && !suppressCompactWarning && !isBriefOnly) {
      addNotification({
        key: 'token-warning',
        jsx: <TokenWarning tokenUsage={tokenUsage} model={mainLoopModel} />,
        priority: 'medium',
        timeoutMs: 18_000_000,
        fold: (_acc, incoming) => incoming,
        exemptFromDiffPanelHold: true,
      });
    } else {
      removeNotification('token-warning');
    }
  }, [
    isShowingCompactMessage,
    suppressCompactWarning,
    isBriefOnly,
    tokenUsage,
    mainLoopModel,
    addNotification,
    removeNotification,
  ]);

  const showLoginNotice = apiKeyStatus === 'invalid' || apiKeyStatus === 'missing';
  const showVerboseTokens = verbose && !showLoginNotice;
  const currentVisible = isNotificationVisible(notifications.current, hold);
  // densable nse `co=!Me` — success copy yields the row to the compact warning.
  const showUpdaterSuccess = !isShowingCompactMessage;
  const hasVisibleAutoUpdaterResult =
    autoUpdaterResult !== null &&
    (autoUpdaterResult.status === 'available' ||
      autoUpdaterResult.status === 'install_failed' ||
      autoUpdaterResult.status === 'no_permissions' ||
      (autoUpdaterResult.status === 'success' && showUpdaterSuccess && Boolean(autoUpdaterResult.version)));
  // densable Ex `Xo` — left side is occupied when a notice is up OR an update is running/rendered.
  const hasLeftContent = Boolean(
    currentVisible ||
      (isInOverageMode && !isTeamOrEnterprise) ||
      showLoginNotice ||
      showVerboseTokens ||
      isAutoUpdating ||
      hasVisibleAutoUpdaterResult,
  );

  return (
    <SentryErrorBoundary>
      {/* densable Ex: row of [Nn, stashed, ActiveGoalIndicator]. */}
      <Box flexDirection="row" justifyContent="flex-end" alignItems="flex-end" flexShrink={0} overflowX="hidden">
        <Box flexDirection="column" alignItems="flex-end" flexShrink={1} overflowX="hidden">
          <NotificationContent
            notifications={notifications}
            hold={hold}
            isInOverageMode={isInOverageMode ?? false}
            isTeamOrEnterprise={isTeamOrEnterprise}
            apiKeyStatus={apiKeyStatus}
            verbose={verbose}
            tokenUsage={tokenUsage}
            autoUpdaterElement={
              /* Keep mounted: unmount re-fires AutoUpdater initial check (PR#22413). */
              <AutoUpdaterWrapper
                verbose={verbose}
                onAutoUpdaterResult={onAutoUpdaterResult}
                autoUpdaterResult={autoUpdaterResult}
                isUpdating={isAutoUpdating}
                onChangeIsUpdating={onChangeIsUpdating}
                showSuccessMessage={showUpdaterSuccess}
              />
            }
          />
        </Box>
        {hasStash && (
          <Box flexShrink={0}>
            <Text dimColor>{hasLeftContent ? ' · ' : ' '}</Text>
            <Text dimColor>{figures.pointerSmall} stashed</Text>
          </Box>
        )}
        <ActiveGoalIndicator withSeparator={hasLeftContent || hasStash} />
      </Box>
    </SentryErrorBoundary>
  );
}

function MemoryUsageIndicator(): ReactNode {
  const memoryUsage = useMemoryUsage();
  if (getIsRemoteMode() || !memoryUsage || memoryUsage.status !== 'critical') {
    return null;
  }
  const size = formatFileSize(memoryUsage.heapUsed);
  const isFullscreen = isFullscreenEnvEnabled();
  return (
    <Box>
      <Text color="error" wrap="truncate">
        {`Critical memory usage (${size}) — restart and resume with claude --continue${!isFullscreen ? ', or run /compact' : ''}`}
      </Text>
    </Box>
  );
}

function NotificationContent({
  notifications,
  hold,
  isInOverageMode,
  isTeamOrEnterprise,
  apiKeyStatus,
  verbose,
  tokenUsage,
  autoUpdaterElement,
}: {
  notifications: {
    current: Notification | null;
    queue: Notification[];
    pinned?: Notification[];
  };
  hold: boolean;
  isInOverageMode: boolean;
  isTeamOrEnterprise: boolean;
  apiKeyStatus: VerificationStatus;
  verbose: boolean;
  tokenUsage: number;
  autoUpdaterElement: ReactNode;
}): ReactNode {
  const isRemoteMode = getIsRemoteMode();
  const subscriptionType = getSubscriptionType();
  const isProPlan = !isRemoteMode && subscriptionType === 'pro';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isProPlan) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [isProPlan]);
  const lastCacheActivityAt = isProPlan
    ? (getLastApiCompletionTimestamp() ?? summarizePromptCache().lastActivityAt)
    : null;
  const expiredCacheHint =
    !isRemoteMode &&
    subscriptionType === 'pro' &&
    lastCacheActivityAt !== null &&
    tokenUsage >= 50_000 &&
    now - lastCacheActivityAt > 300_000
      ? `~${Math.round(tokenUsage / 1000)}k uncached · /clear to start fresh`
      : null;

  // Poll apiKeyHelper inflight state to show slow-helper notice.
  // Gated on configuration — most users never set apiKeyHelper, so the
  // effect is a no-op for them (no interval allocated).
  const [apiKeyHelperSlow, setApiKeyHelperSlow] = useState<string | null>(null);
  useEffect(() => {
    if (!getConfiguredApiKeyHelper()) return;
    const interval = setInterval(
      (setSlow: React.Dispatch<React.SetStateAction<string | null>>) => {
        const ms = getApiKeyHelperElapsedMs();
        const next = ms >= 10_000 ? formatDuration(ms) : null;
        setSlow(prev => (next === prev ? prev : next));
      },
      1000,
      setApiKeyHelperSlow,
    );
    return () => clearInterval(interval);
  }, []);

  // Voice state (VOICE_MODE builds only, runtime-gated by GrowthBook)
  const voiceStateRaw = useVoiceState(s => s.voiceState);
  const voiceState = feature('VOICE_MODE') ? voiceStateRaw : ('idle' as const);
  const voiceEnabledRaw = useVoiceEnabled();
  const voiceEnabled = feature('VOICE_MODE') ? voiceEnabledRaw : false;
  const voiceErrorRaw = useVoiceState(s => s.voiceError);
  const voiceError = feature('VOICE_MODE') ? voiceErrorRaw : null;

  // When voice is actively recording or processing, replace all
  // notifications with just the voice indicator.
  if (feature('VOICE_MODE') && voiceEnabled && (voiceState === 'recording' || voiceState === 'processing')) {
    return <VoiceIndicator voiceState={voiceState} />;
  }

  return (
    <>
      {isInOverageMode && !isTeamOrEnterprise && (
        <Box>
          <Text dimColor wrap="truncate">
            Now using usage credits
          </Text>
        </Box>
      )}
      {apiKeyHelperSlow && (
        <Box>
          <Text color="warning" wrap="truncate">
            apiKeyHelper is taking a while{' '}
          </Text>
          <Text dimColor wrap="truncate">
            ({apiKeyHelperSlow})
          </Text>
        </Box>
      )}
      {(apiKeyStatus === 'invalid' || apiKeyStatus === 'missing') && (
        <Box>
          <Text color="error" wrap="truncate">
            {(() => {
              // Official REMOTE densable.
              let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE);
              try {
                const { isRemoteEnvEnabled } =
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js');
                isRemote = isRemoteEnvEnabled();
              } catch {
                // keep raw env fallback
              }
              return isRemote ? 'Authentication error · Try again' : 'Not logged in · Run /login';
            })()}
          </Text>
        </Box>
      )}
      {apiKeyStatus !== 'invalid' && apiKeyStatus !== 'missing' && verbose && (
        <Box>
          <Text dimColor wrap="truncate">
            {tokenUsage} tokens
          </Text>
        </Box>
      )}
      {expiredCacheHint && (
        <Box>
          <Text dimColor wrap="truncate">
            {expiredCacheHint}
          </Text>
        </Box>
      )}
      {autoUpdaterElement}
      {feature('VOICE_MODE')
        ? voiceEnabled &&
          voiceError && (
            <Box>
              <Text color="error" wrap="truncate">
                {voiceError}
              </Text>
            </Box>
          )
        : null}
      <SandboxPromptFooterHint />
      {isNotificationVisible(notifications.current, hold) && <NotificationBody notification={notifications.current} />}
      <MemoryUsageIndicator />
    </>
  );
}
