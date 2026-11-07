import { feature } from 'bun:bundle';
import figures from 'figures';
import * as React from 'react';
import {
  type ReactNode,
  useCallback,
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
  useNotifications,
} from 'src/context/notifications.js';
import { logEvent } from 'src/services/analytics/index.js';
import { useAppState } from 'src/state/AppState.js';
import { useVoiceState } from '../../context/voice.js';
import type { VerificationStatus } from '../../hooks/useApiKeyVerification.js';
import { useIdeConnectionStatus } from '../../hooks/useIdeConnectionStatus.js';
import type { IDESelection } from '../../hooks/useIdeSelection.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useVoiceEnabled } from '../../hooks/useVoiceEnabled.js';
import {
  AccessibilityContext,
  Box,
  type DOMElement,
  Text,
  stringWidth,
  useApp,
  useTerminalSize,
  wrapText,
} from '@anthropic/ink';
import { TranscriptOverlayOffsetContext } from '../transcriptOverlayOffset.js';
import {
  expireToasts,
  getToasts,
  holdToastItem,
  pauseToasts,
  subscribeToasts,
  dismissToastItem,
  type ToastItem,
} from '../toastStore.js';
import { notificationsHoldToasts } from '../../utils/replDiffMouseHost.js';
import { useClaudeAiLimits } from '../../services/claudeAiLimitsHook.js';
import { calculateTokenWarningState } from '../../services/compact/autoCompact.js';
import { useCompactWarningSuppression } from '../../services/compact/compactWarningHook.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import type { Message } from '../../types/message.js';
import { getApiKeyHelperElapsedMs, getConfiguredApiKeyHelper, getSubscriptionType } from '../../utils/auth.js';
import type { AutoUpdaterResult } from '../../utils/autoUpdater.js';
import { getExternalEditor } from '../../utils/editor.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { formatDuration } from '../../utils/format.js';
import { setEnvHookNotifier } from '../../utils/hooks/fileChangedWatcher.js';
import { toIDEDisplayName } from '../../utils/ide.js';
import { logError } from '../../utils/log.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js';
import { AutoUpdaterWrapper } from '../AutoUpdaterWrapper.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { IdeStatusIndicator } from '../IdeStatusIndicator.js';
import { MemoryUsageIndicator } from '../MemoryUsageIndicator.js';
import { SentryErrorBoundary } from '../SentryErrorBoundary.js';
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

/**
 * densable `hke` / `wU` — absolute toasts on the scroll column.
 * `vkt` (TranscriptOverlayOffsetContext) shifts tops when the sticky header
 * occupies row 0. Empty or paused (`WJ`) paints nothing.
 * Click starts the leave. The box is sized from the wrapped text.
 */
export function ToastStackView(): React.ReactNode {
  const offset = React.useContext(TranscriptOverlayOffsetContext);
  const screenReader = React.useContext(AccessibilityContext);
  const { columns, rows } = useTerminalSize();
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const paused = useAppState(notificationsHoldToasts);
  const columnRef = useRef<DOMElement | null>(null);
  const [heldKey, setHeldKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const measuredHeight = useYogaHeight(columnRef);
  const framed = !screenReader;
  const still = Boolean(screenReader) || !framed;
  const sliding = !still && toasts.some(toast => now - toast.shownAt < TOAST_FADE_MS);
  useEffect(() => {
    pauseToasts(paused);
  }, [paused]);
  useEffect(() => {
    if (paused) return;
    expireToasts(Date.now());
  }, [now, toasts, paused]);
  useEffect(() => {
    if (paused) return;
    const tick = Date.now();
    let nextLeave = Infinity;
    for (const toast of toasts) {
      if (toast.heldAt !== undefined) continue;
      if (toast.leavesAt < nextLeave) nextLeave = toast.leavesAt;
    }
    if (!sliding && nextLeave === Infinity) return;
    const delay = sliding ? TOAST_FRAME_MS : Math.max(TOAST_FRAME_MS, nextLeave - tick);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [sliding, now, toasts, paused]);
  const roomColumns = Math.max(1, columns - TOAST_EDGE_COLUMNS);
  const roomRows = (measuredHeight > 0 ? measuredHeight : rows - TOAST_STACK_BOTTOM) - offset;
  const shapes = toasts.map(toast => toastShape(toast, roomColumns, framed));
  const heights = shapes.map(shape => shape.rows);
  const shownCount = fittingToastCount(heights, TOAST_STACK_MOST, roomRows, toasts.length);
  const shown = paused || toasts.length === 0 ? [] : toasts.slice(-shownCount);
  const shownKey = shown.map(toast => toast.id).join('\n');
  useEffect(() => {
    if (heldKey !== null && !shownKey.split('\n').includes(heldKey)) {
      holdToastItem(heldKey, false);
      setHeldKey(null);
    }
  }, [heldKey, shownKey]);
  if (paused || toasts.length === 0) return null;
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
      {shown.map((toast, index) => {
        const shape = shownShapes[index] ?? { columns: 1, lines: [] as string[], rows: 1 };
        return (
          <Box
            key={toast.id}
            position="absolute"
            top={tops[index] ?? 0}
            right={slideColumns(toast.shownAt, shape.columns, now, still)}
            width={shape.columns}
            height={shape.rows}
            flexDirection="column"
            borderStyle={framed ? 'round' : undefined}
            borderDimColor={heldKey !== toast.id}
            paddingX={framed ? 1 : 0}
            opaque
            noSelect
            onMouseEnter={() => {
              holdToastItem(toast.id, true);
              setHeldKey(toast.id);
            }}
            onMouseLeave={() => {
              holdToastItem(toast.id, false);
              setHeldKey(current => (current === toast.id ? null : current));
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
              <Text key={lineIndex} dimColor={toast.phase === 'leaving'} wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        );
      })}
    </>
  );
}

type Props = {
  apiKeyStatus: VerificationStatus;
  autoUpdaterResult: AutoUpdaterResult | null;
  isAutoUpdating: boolean;
  debug: boolean;
  verbose: boolean;
  messages: Message[];
  onAutoUpdaterResult: (result: AutoUpdaterResult) => void;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  ideSelection: IDESelection | undefined;
  mcpClients?: MCPServerConnection[];
  isInputWrapped?: boolean;
  hasStash?: boolean;
  isNarrow?: boolean;
};

/** densable `E1` — pinned notifications block rendered above the prompt border. */
export function PinnedNotifications(): ReactNode {
  const pinned = useAppState(s => s.notifications.pinned);
  if (!pinned || pinned.length === 0) return null;
  const sorted = pinned.slice().sort(compareNotificationPriority);
  return (
    <Box flexDirection="column" paddingX={2}>
      {sorted.map(notice => (
        <NotificationBody key={notice.key} notification={notice} />
      ))}
    </Box>
  );
}

/** densable `zre` — `/goal active` indicator trailing the prompt notification row. */
function ActiveGoalIndicator({ withSeparator }: { withSeparator: boolean }): ReactNode {
  const setAt = useAppState(s => s.activeGoal?.setAt);
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (setAt === undefined) return;
    const elapsed = Math.max(0, Date.now() - setAt);
    const step = elapsed < 60_000 ? 1000 : 60_000;
    const delay = step - (elapsed % step);
    const timer = setTimeout(bump, delay);
    return () => clearTimeout(timer);
  }, [setAt, tick]);
  if (setAt === undefined) return null;
  const elapsed = Math.max(0, Date.now() - setAt);
  const suffix = elapsed < 1000 ? '' : ` (${formatDuration(elapsed, { mostSignificantOnly: true })})`;
  return (
    <Box flexShrink={0}>
      {withSeparator ? <Text dimColor>{' · '}</Text> : null}
      <Text color="permission">
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
        {notification.segments.map((segment, i) => (
          <Text key={i} dimColor={segment.dim} color={segment.color}>
            {segment.text}
          </Text>
        ))}
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
  debug,
  isAutoUpdating,
  verbose,
  messages,
  onAutoUpdaterResult,
  onChangeIsUpdating,
  ideSelection,
  mcpClients,
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
  const { status: ideStatus } = useIdeConnectionStatus(mcpClients);
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

  // Check if we should show the IDE selection indicator
  const shouldShowIdeSelection =
    ideStatus === 'connected' && (ideSelection?.filePath || (ideSelection?.text && ideSelection.lineCount > 0));

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

  // Surface update status in the shared notification queue (fullscreen used to
  // clip the inline AutoUpdater row to a single height=1 slot).
  useEffect(() => {
    if (autoUpdaterResult?.status === 'available' && autoUpdaterResult.version) {
      addNotification({
        key: 'auto-updater-result',
        text: `Update available (${autoUpdaterResult.version}) · run claude update`,
        color: 'warning',
        priority: 'high',
        timeoutMs: 60_000,
      });
      return;
    }
    if (autoUpdaterResult?.status === 'success' && autoUpdaterResult.version) {
      addNotification({
        key: 'auto-updater-result',
        text: `✓ Update installed · Restart to apply (${autoUpdaterResult.version})`,
        color: 'success',
        priority: 'high',
        timeoutMs: 30_000,
      });
      return;
    }
    if (autoUpdaterResult?.status === 'no_permissions') {
      addNotification({
        key: 'auto-updater-result',
        text: 'Auto-update failed: no write permission to npm prefix · Run claude doctor',
        color: 'error',
        priority: 'high',
        timeoutMs: 20_000,
      });
      return;
    }
    if (
      autoUpdaterResult?.status === 'install_failed' &&
      autoUpdaterResult.failureHint === 'windows_running_exe_lock'
    ) {
      addNotification({
        key: 'auto-updater-result',
        text: 'Auto-update failed: claude.exe in use (close other Claude Code sessions, including VS Code) · Run claude doctor',
        color: 'error',
        priority: 'high',
        timeoutMs: 20_000,
      });
      return;
    }
    if (autoUpdaterResult?.status === 'install_failed') {
      addNotification({
        key: 'auto-updater-result',
        text: 'Auto-update failed · Try claude doctor',
        color: 'error',
        priority: 'high',
        timeoutMs: 20_000,
      });
      return;
    }
    if (isAutoUpdating) {
      addNotification({
        key: 'auto-updater-result',
        text: 'Auto-updating…',
        priority: 'low',
        timeoutMs: 15_000,
      });
    }
  }, [autoUpdaterResult, isAutoUpdating, addNotification]);

  const onToastStackError = (error: Error): void => {
    // densable AX/EX toast-stack BO unique English. Distinct from FEe pane hold.
    logError(new Error('ui.toast: the toast stack threw while drawn'));
    logError(new Error(`ui.toast threw while drawn: ${error.message}; no toast is drawn until the stack changes`));
  };

  const showLoginNotice = apiKeyStatus === 'invalid' || apiKeyStatus === 'missing';
  const showVerboseTokens = verbose && !showLoginNotice;
  const currentVisible = isNotificationVisible(notifications.current, hold);
  // densable nse `co=!Me` — success copy yields the row to the compact warning.
  const showUpdaterSuccess = !isShowingCompactMessage;
  // densable Ex `Xo` — left side is occupied when a notice is up OR an update is running.
  const hasLeftContent = Boolean(
    currentVisible ||
      (isInOverageMode && !isTeamOrEnterprise) ||
      showLoginNotice ||
      showVerboseTokens ||
      isAutoUpdating ||
      shouldShowIdeSelection ||
      debug ||
      autoUpdaterResult !== null,
  );

  return (
    <SentryErrorBoundary name="ui.toast" onError={onToastStackError}>
      {/* densable Ex: row of [Nn, stashed, ActiveGoalIndicator]. */}
      <Box flexDirection="row" justifyContent="flex-end" alignItems="flex-end" flexShrink={0} overflowX="hidden">
        <Box flexDirection="column" alignItems="flex-end" flexShrink={1} overflowX="hidden">
          <NotificationContent
            ideSelection={ideSelection}
            mcpClients={mcpClients}
            notifications={notifications}
            hold={hold}
            isInOverageMode={isInOverageMode ?? false}
            isTeamOrEnterprise={isTeamOrEnterprise}
            apiKeyStatus={apiKeyStatus}
            debug={debug}
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

function NotificationContent({
  ideSelection,
  mcpClients,
  notifications,
  hold,
  isInOverageMode,
  isTeamOrEnterprise,
  apiKeyStatus,
  debug,
  verbose,
  tokenUsage,
  autoUpdaterElement,
}: {
  ideSelection: IDESelection | undefined;
  mcpClients?: MCPServerConnection[];
  notifications: {
    current: Notification | null;
    queue: Notification[];
    pinned?: Notification[];
  };
  hold: boolean;
  isInOverageMode: boolean;
  isTeamOrEnterprise: boolean;
  apiKeyStatus: VerificationStatus;
  debug: boolean;
  verbose: boolean;
  tokenUsage: number;
  autoUpdaterElement: ReactNode;
}): ReactNode {
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
            Now using extra usage
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
      {debug && (
        <Box>
          <Text color="warning" wrap="truncate">
            Debug mode
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
      {autoUpdaterElement}
      <IdeStatusIndicator ideSelection={ideSelection} mcpClients={mcpClients} />
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
      <MemoryUsageIndicator />
      <SandboxPromptFooterHint />
      {isNotificationVisible(notifications.current, hold) && <NotificationBody notification={notifications.current} />}
    </>
  );
}
