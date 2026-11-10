import { feature } from 'bun:bundle';
import figures from 'figures';
import * as React from 'react';
import { memo, type ReactNode, useContext, useMemo, useRef, useState } from 'react';
import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js';
import { getBridgeStatus } from '../../bridge/bridgeStatusUtil.js';
import { useSetPromptOverlay } from '../../context/promptOverlayContext.js';
import type { VerificationStatus } from '../../hooks/useApiKeyVerification.js';
import type { IDESelection } from '../../hooks/useIdeSelection.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { AccessibilityContext, Box, Byline, KeyboardShortcutHint, Link, Text, useInput } from '@anthropic/ink';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { type AppState, useAppState, useSetAppState } from '../../state/AppState.js';
import type { ToolPermissionContext } from '../../Tool.js';
import type { Message } from '../../types/message.js';
import type { PromptInputMode, VimMode } from '../../types/textInputTypes.js';
import type { AutoUpdaterResult } from '../../utils/autoUpdater.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { getPipeDisplayRole, isPipeControlled } from '../../utils/pipeTransport.js';
import { isUndercover } from '../../utils/undercover.js';
import { CoordinatorTaskPanel, useCoordinatorTaskCount } from '../CoordinatorAgentStatus.js';
import { getLastAssistantMessageId, StatusLine, statusLineShouldDisplay } from '../StatusLine.js';
import { Notifications } from './Notifications.js';
import { PromptInputFooterLeftSide } from './PromptInputFooterLeftSide.js';

// Inline pipe status is shown only after /pipes sets pipeIpc.statusVisible.
import { PromptInputFooterSuggestions, type SuggestionItem } from './PromptInputFooterSuggestions.js';
import { PromptInputHelpMenu } from './PromptInputHelpMenu.js';

type StatusLineWithHideVim = {
  hideVimModeIndicator?: boolean;
};

type BridgeStatusValue = ReturnType<typeof getBridgeStatus>;

type Props = {
  apiKeyStatus: VerificationStatus;
  debug: boolean;
  exitMessage: {
    show: boolean;
    key?: string;
  };
  vimMode: VimMode | undefined;
  mode: PromptInputMode;
  autoUpdaterResult: AutoUpdaterResult | null;
  isAutoUpdating: boolean;
  verbose: boolean;
  onAutoUpdaterResult: (result: AutoUpdaterResult) => void;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  maxColumnWidth?: number;
  suggestionsEmptyMessage?: string;
  hoveredSuggestionId?: string | null;
  onHoverSuggestion?: (id: string | null) => void;
  onSelectSuggestion?: (index: number, id: string) => void;
  toolPermissionContext: ToolPermissionContext;
  helpOpen: boolean;
  suppressHint: boolean;
  isLoading: boolean;
  tasksSelected: boolean;
  teamsSelected: boolean;
  bridgeSelected: boolean;
  tmuxSelected: boolean;
  teammateFooterIndex?: number;
  ideSelection: IDESelection | undefined;
  mcpClients?: MCPServerConnection[];
  isPasting?: boolean;
  isInputWrapped?: boolean;
  hasStash?: boolean;
  messages: Message[];
  isSearching: boolean;
  historyQuery: string;
  setHistoryQuery: (query: string) => void;
  historyFailedMatch: boolean;
  onOpenTasksDialog?: (taskId?: string) => void;
  leftArrowAgain?: boolean;
};

function PromptInputFooter({
  apiKeyStatus,
  debug,
  exitMessage,
  vimMode,
  mode,
  autoUpdaterResult,
  isAutoUpdating,
  verbose,
  onAutoUpdaterResult,
  onChangeIsUpdating,
  suggestions,
  selectedSuggestion,
  maxColumnWidth,
  suggestionsEmptyMessage,
  hoveredSuggestionId,
  onHoverSuggestion,
  onSelectSuggestion,
  toolPermissionContext,
  helpOpen,
  suppressHint: suppressHintFromProps,
  isLoading,
  tasksSelected,
  teamsSelected,
  bridgeSelected,
  tmuxSelected,
  teammateFooterIndex,
  ideSelection,
  mcpClients,
  isPasting = false,
  isInputWrapped = false,
  hasStash = false,
  messages,
  isSearching,
  historyQuery,
  setHistoryQuery,
  historyFailedMatch,
  onOpenTasksDialog,
  leftArrowAgain,
}: Props): ReactNode {
  const settings = useSettings();
  const { columns } = useTerminalSize();
  const isScreenReader = useContext(AccessibilityContext);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const lastAssistantMessageId = useMemo(() => getLastAssistantMessageId(messages), [messages]);
  const isNarrow = columns < 80;
  const isFullscreen = isFullscreenEnvEnabled();

  const coordinatorTaskCount = useCoordinatorTaskCount();
  const coordinatorTaskIndex = useAppState(s => s.coordinatorTaskIndex);
  const pillSelected = tasksSelected && (coordinatorTaskCount === 0 || coordinatorTaskIndex < 0);

  const hasStatusLine = statusLineShouldDisplay(settings);
  const suppressHint = suppressHintFromProps || hasStatusLine || isSearching;
  const hideVimModeIndicator =
    (settings?.statusLine as StatusLineWithHideVim | undefined)?.hideVimModeIndicator ?? false;
  const hasSuggestionContent = suggestions.length > 0 || Boolean(suggestionsEmptyMessage);
  const overlayData = useMemo(
    () =>
      isFullscreen && hasSuggestionContent
        ? {
            suggestions,
            selectedSuggestion,
            maxColumnWidth,
            emptyMessage: suggestionsEmptyMessage,
            hoveredId: hoveredSuggestionId,
            onSelect: onSelectSuggestion,
            onHoverChange: onHoverSuggestion,
          }
        : null,
    [
      isFullscreen,
      hasSuggestionContent,
      suggestions,
      selectedSuggestion,
      maxColumnWidth,
      suggestionsEmptyMessage,
      hoveredSuggestionId,
      onSelectSuggestion,
      onHoverSuggestion,
    ],
  );
  useSetPromptOverlay(overlayData);

  if (hasSuggestionContent && !isFullscreen) {
    return (
      <Box paddingX={2} paddingY={0}>
        <PromptInputFooterSuggestions
          suggestions={suggestions}
          selectedSuggestion={selectedSuggestion}
          maxColumnWidth={maxColumnWidth}
          emptyMessage={suggestionsEmptyMessage}
          hoveredId={hoveredSuggestionId}
          onHoverChange={onHoverSuggestion}
          onSelect={onSelectSuggestion}
        />
      </Box>
    );
  }

  if (helpOpen) {
    return <PromptInputHelpMenu dimColor={true} fixedWidth={true} paddingX={2} />;
  }

  return (
    <>
      <Box
        flexDirection={isScreenReader ? 'column' : 'row'}
        flexWrap="wrap"
        alignItems="flex-start"
        paddingX={2}
        columnGap={1}
      >
        <Box flexDirection="column" flexShrink={1}>
          {mode === 'prompt' && !exitMessage.show && !isPasting && hasStatusLine && (
            <StatusLine messagesRef={messagesRef} lastAssistantMessageId={lastAssistantMessageId} vimMode={vimMode} />
          )}
          <PipeStatusInline />
          <PromptInputFooterLeftSide
            exitMessage={exitMessage}
            vimMode={vimMode}
            hideVimModeIndicator={hideVimModeIndicator}
            mode={mode}
            toolPermissionContext={toolPermissionContext}
            suppressHint={suppressHint}
            isLoading={isLoading}
            tasksSelected={pillSelected}
            teamsSelected={teamsSelected}
            teammateFooterIndex={teammateFooterIndex}
            tmuxSelected={tmuxSelected}
            isPasting={isPasting}
            isSearching={isSearching}
            historyQuery={historyQuery}
            setHistoryQuery={setHistoryQuery}
            historyFailedMatch={historyFailedMatch}
            onOpenTasksDialog={onOpenTasksDialog}
            leftArrowAgain={leftArrowAgain}
          />
        </Box>
        <Box flexShrink={0} marginLeft="auto" flexDirection="column" alignItems="flex-end">
          {isFullscreen ? null : (
            <Notifications
              apiKeyStatus={apiKeyStatus}
              autoUpdaterResult={autoUpdaterResult}
              debug={debug}
              isAutoUpdating={isAutoUpdating}
              verbose={verbose}
              messages={messages}
              onAutoUpdaterResult={onAutoUpdaterResult}
              onChangeIsUpdating={onChangeIsUpdating}
              ideSelection={ideSelection}
              mcpClients={mcpClients}
              isInputWrapped={isInputWrapped}
              hasStash={hasStash}
              isNarrow={isNarrow}
            />
          )}
          <FooterRightIndicators debug={debug} bridgeSelected={bridgeSelected} />
        </Box>
      </Box>
      {/* densable MIe: panel count has no USER_TYPE ant gate. */}
      <CoordinatorTaskPanel />
    </>
  );
}

export default memo(PromptInputFooter);

function getCloudConnectionDisplay(status: AppState['remoteConnectionStatus']): {
  suffix: string;
  color: 'warning' | 'error' | 'ide';
} {
  switch (status) {
    case 'reconnecting':
      return { suffix: ' · reconnecting…', color: 'warning' };
    case 'disconnected':
      return { suffix: ' · disconnected', color: 'error' };
    case 'connecting':
    case 'connected':
    default:
      return { suffix: '', color: 'ide' };
  }
}

const RC_FOOTER_MIN_COLUMNS = 60;

function appendBridgeFromCliParam(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('from', 'cli');
    return parsed.toString();
  } catch {
    return url;
  }
}

function useVisibleBridgeStatus(): BridgeStatusValue | null {
  const isFullscreen = isFullscreenEnvEnabled();
  const { columns } = useTerminalSize();
  const eligible = !isFullscreen && columns >= RC_FOOTER_MIN_COLUMNS;
  const raw = useAppState(s => {
    if (!feature('BRIDGE_MODE')) return null;
    if (!eligible || s.replBridgeOutboundOnly) return null;
    if (!s.replBridgeEnabled && s.replBridgeError === undefined) return null;
    return getBridgeStatus({
      error: s.replBridgeError,
      connected: s.replBridgeConnected,
      sessionActive: s.replBridgeSessionActive,
      reconnecting: s.replBridgeReconnecting,
    });
  });
  if (!feature('BRIDGE_MODE')) return null;
  return raw !== null && isBridgeEnabled() ? raw : null;
}

function FooterRightIndicators({
  debug,
  bridgeSelected,
}: {
  debug: boolean;
  bridgeSelected: boolean;
}): React.ReactNode {
  const remoteSessionUrl = useAppState(s => s.remoteSessionUrl);
  const remoteConnectionStatus = useAppState(s => s.remoteConnectionStatus);
  const bridgeStatus = useVisibleBridgeStatus();

  const items: React.ReactNode[] = [];

  if (remoteSessionUrl) {
    const { suffix, color } = getCloudConnectionDisplay(remoteConnectionStatus);
    items.push(
      <Text key="cloud" color={color} wrap="truncate">
        <Link url={remoteSessionUrl}>
          {figures.circleDouble} cloud{suffix}
        </Link>
      </Text>,
    );
  }

  if (debug) {
    items.push(
      <Text key="debug" color="warning" wrap="truncate">
        Debug
      </Text>,
    );
  }

  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    items.push(
      <Text key="undercover" dimColor>
        undercover
      </Text>,
    );
  }

  if (bridgeStatus !== null) {
    items.push(<BridgeStatusIndicator key="bridge" status={bridgeStatus} bridgeSelected={bridgeSelected} />);
  }

  if (items.length === 0) return null;

  return (
    <Box flexShrink={0}>
      <Byline>{items}</Byline>
    </Box>
  );
}

type BridgeStatusProps = {
  status: BridgeStatusValue;
  bridgeSelected: boolean;
};

function BridgeStatusIndicator({ status, bridgeSelected }: BridgeStatusProps): React.ReactNode {
  const sessionUrl = useAppState(s => s.replBridgeSessionUrl);
  const openShortcut = useShortcutDisplay('footer:openSelected', 'Footer', 'Enter');
  const labelNode = sessionUrl ? <Link url={appendBridgeFromCliParam(sessionUrl)}>{status.label}</Link> : status.label;
  return (
    <Box>
      <Text color={bridgeSelected ? 'background' : status.color} inverse={bridgeSelected} wrap="truncate">
        {labelNode}
      </Text>
      {bridgeSelected && openShortcut && (
        <Text dimColor wrap="truncate">
          {' · '}
          <KeyboardShortcutHint shortcut={openShortcut} action="view" />
        </Text>
      )}
    </Box>
  );
}

/**
 * Inline pipe status panel with interactive checkbox selection.
 *
 * Shows after /pipes sets statusVisible. Displays:
 * - Header: own pipe info (collapsed mode)
 * - Ctrl+P: toggle expanded mode with sub list + checkboxes
 * - Expanded: ↑↓ to move cursor, Space to toggle, Enter/Esc to collapse
 *
 * Only uses AppState + Ink — no heavy external imports.
 */
function PipeStatusInline(): React.ReactNode {
  if (!feature('UDS_INBOX')) return null;
  // All hooks must be called before any conditional return to maintain
  // consistent hook count across renders (React rules of hooks).
  const pipeIpc = useAppState(s => s.pipeIpc);
  const setAppState = useSetAppState();
  const [cursorIndex, setCursorIndex] = useState(0);

  const isVisible = !!pipeIpc?.statusVisible && !!pipeIpc?.serverName;
  const selectorOpen: boolean = !!pipeIpc?.selectorOpen;

  const slaves = pipeIpc?.slaves ?? {};
  const slaveNames = Object.keys(slaves);
  const discovered: Array<{ pipeName: string; role: string; ip: string; hostname: string }> =
    pipeIpc?.discoveredPipes ?? [];
  const allPipes = [...new Set([...slaveNames, ...discovered.map(d => d.pipeName)])].filter(
    n => n !== pipeIpc?.serverName,
  );
  const selectedPipes: string[] = pipeIpc?.selectedPipes ?? [];
  const displayRole = pipeIpc ? getPipeDisplayRole(pipeIpc) : 'main';
  const routeMode: 'selected' | 'local' = pipeIpc?.routeMode ?? 'selected';
  const selectedRouteActive = routeMode !== 'local' && selectedPipes.length > 0;
  const setRouteMode = (mode: 'selected' | 'local') => {
    setAppState((prev: any) => {
      const pIpc = prev.pipeIpc ?? {};
      return { ...prev, pipeIpc: { ...pIpc, routeMode: mode } };
    });
  };

  // Register as modal overlay when selector is open.
  // This sets isModalOverlayActive=true in PromptInput → TextInput focus=false
  // → TextInput's useInput is deactivated → ↑↓ no longer trigger history navigation.
  // Same mechanism used by BackgroundTasksDialog, FuzzyPicker, etc.
  useRegisterOverlay('pipe-selector', isVisible && selectorOpen);

  // Keyboard handler — must be called every render (hooks rules).
  // ↑↓ navigate list, Space toggles selection, ←/→ or m switches route mode, Enter/Esc close selector.
  // No conflict with history nav: useRegisterOverlay above disables TextInput when open.
  useInput((_input, key) => {
    if (!isVisible) return;

    // When collapsed: only ←/→ arrow keys toggle route mode (no overlay,
    // so printable keys like 'm' would leak into the TextInput).
    // When expanded: ←/→ and 'm' all work (overlay blocks TextInput).
    if (selectedPipes.length > 0) {
      const arrowToggle = key.leftArrow || key.rightArrow;
      const mToggle = selectorOpen && _input.toLowerCase() === 'm';
      if (arrowToggle || mToggle) {
        setRouteMode(routeMode === 'local' ? 'selected' : 'local');
        return;
      }
    }

    if (!selectorOpen) return;

    if (key.downArrow) {
      setCursorIndex(i => Math.min(i + 1, allPipes.length - 1));
    } else if (key.upArrow) {
      setCursorIndex(i => Math.max(i - 1, 0));
    } else if (_input === ' ') {
      const pipeName = allPipes[cursorIndex];
      if (pipeName) {
        setAppState((prev: any) => {
          const pIpc = prev.pipeIpc ?? {};
          const sel: string[] = pIpc.selectedPipes ?? [];
          const newSel = sel.includes(pipeName) ? sel.filter((n: string) => n !== pipeName) : [...sel, pipeName];
          return { ...prev, pipeIpc: { ...pIpc, selectedPipes: newSel } };
        });
      }
    } else if (key.return || key.escape) {
      setAppState((prev: any) => {
        const pIpc = prev.pipeIpc ?? {};
        return { ...prev, pipeIpc: { ...pIpc, selectorOpen: false } };
      });
    }
  });

  // Early return AFTER all hooks
  if (!isVisible) return null;

  if (!selectorOpen) {
    return (
      <Box height={1} gap={1}>
        <Text dimColor>pipe:</Text>
        <Text bold>{pipeIpc.serverName}</Text>
        <Text dimColor>({displayRole})</Text>
        {pipeIpc.localIp && <Text dimColor>{pipeIpc.localIp}</Text>}
        {allPipes.length > 0 && (
          <Text color={selectedRouteActive ? 'success' : undefined} dimColor={selectedPipes.length === 0}>
            {selectedPipes.length}/{allPipes.length} selected
          </Text>
        )}
        {pipeIpc && isPipeControlled(pipeIpc) && pipeIpc.attachedBy && (
          <Text color="warning">
            {'→ '}
            {pipeIpc.attachedBy}
          </Text>
        )}
        {allPipes.length > 0 && (
          <Text color={selectedRouteActive ? 'success' : undefined} dimColor={!selectedRouteActive}>
            {selectedPipes.length > 0
              ? `${routeMode === 'local' ? 'local main' : 'selected pipes only'} · ←/→ switch · Shift+↓ edit`
              : 'local main · Shift+↓ select'}
          </Text>
        )}
      </Box>
    );
  }

  // Expanded mode: header + pipe list with checkboxes
  return (
    <Box flexDirection="column">
      <Box height={1} gap={1}>
        <Text dimColor>pipe:</Text>
        <Text bold>{pipeIpc.serverName}</Text>
        <Text dimColor>({displayRole})</Text>
        {pipeIpc.localIp && <Text dimColor>{pipeIpc.localIp}</Text>}
        <Text color="warning">↑↓ move Space select ←/→ or m route Enter/Esc close Shift+↓ toggle</Text>
      </Box>
      <Box height={1} paddingLeft={2}>
        <Text dimColor>
          {selectedPipes.length > 0
            ? `当前普通 prompt 走 ${routeMode === 'local' ? '本地 main' : '已选 sub'}；切换不会清空选择`
            : '当前未选择 pipe；普通 prompt 会在本地 main 对话执行'}
        </Text>
      </Box>
      {allPipes.map((name, idx) => {
        const isSelected = selectedPipes.includes(name);
        const isCursor = idx === cursorIndex;
        const isConnected = !!slaves[name];
        const disc = discovered.find(d => d.pipeName === name);
        const label = disc ? `${disc.role} ${disc.hostname}/${disc.ip}` : '';

        return (
          <Box key={name} height={1} paddingLeft={2}>
            <Text
              inverse={isCursor}
              color={isSelected ? 'success' : isConnected ? undefined : 'error'}
              dimColor={!isConnected && !isCursor}
            >
              {isSelected ? '☑' : '☐'} {name}
              {isConnected ? '' : ' [offline]'}
              {label ? ` (${label})` : ''}
            </Text>
          </Box>
        );
      })}
      {allPipes.length === 0 && (
        <Box height={1} paddingLeft={2}>
          <Text dimColor>No other pipes found. Start another instance.</Text>
        </Box>
      )}
    </Box>
  );
}
