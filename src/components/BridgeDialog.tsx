import { basename } from 'path';
import { toString as qrToString } from 'qrcode';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { getOriginalCwd } from '../bootstrap/state.js';
import { BRIDGE_FAILED_INDICATOR, BRIDGE_READY_INDICATOR } from '../constants/figures.js';
import { useRegisterOverlay } from '../context/overlayContext.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw 'd'/'r' keys for disconnect/reconnect
import { Box, Byline, Dialog, KeyboardShortcutHint, Text, useInput } from '@anthropic/ink';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import {
  buildActiveFooterText,
  buildIdleFooterText,
  FAILED_FOOTER_TEXT,
  getBridgeStatus,
} from '../bridge/bridgeStatusUtil.js';
import { saveGlobalConfig } from '../utils/config.js';
import { getBranch } from '../utils/git.js';

type Props = {
  onDone: () => void;
};

/**
 * Official 2.1.326 #92 — determine whether the terminal is short (e.g. 80x24)
 * and compute compact layout parameters so the QR code in `/remote-control`
 * is never clipped vertically.
 */
export function computeBridgeQrLayout(
  qrLineCount: number,
  terminalRows: number = process.stdout.rows || 24,
): { compact: boolean; qrMargin: number; showSecondaryMeta: boolean } {
  const chromeRows = 9;
  const compact = terminalRows <= 24 || qrLineCount + chromeRows > terminalRows;
  return {
    compact,
    qrMargin: compact ? 1 : 2,
    showSecondaryMeta: !compact,
  };
}

export function BridgeDialog({ onDone }: Props): React.ReactNode {
  useRegisterOverlay('bridge-dialog');

  const connected = useAppState(s => s.replBridgeConnected);
  const sessionActive = useAppState(s => s.replBridgeSessionActive);
  const reconnecting = useAppState(s => s.replBridgeReconnecting);
  const connectUrl = useAppState(s => s.replBridgeConnectUrl);
  const sessionUrl = useAppState(s => s.replBridgeSessionUrl);
  const error = useAppState(s => s.replBridgeError);
  const errorKind = useAppState(s => s.replBridgeErrorKind);
  const explicit = useAppState(s => s.replBridgeExplicit);
  const enabled = useAppState(s => s.replBridgeEnabled);
  const environmentId = useAppState(s => s.replBridgeEnvironmentId);
  const sessionId = useAppState(s => s.replBridgeSessionId);
  const verbose = useAppState(s => s.verbose);
  const setAppState = useSetAppState();

  const [showQR, setShowQR] = useState(false);
  const [qrText, setQrText] = useState('');
  const [branchName, setBranchName] = useState('');

  const repoName = basename(getOriginalCwd());

  useEffect(() => {
    getBranch()
      .then(setBranchName)
      .catch(() => {});
  }, []);

  const displayUrl = sessionActive ? sessionUrl : connectUrl;

  const terminalRows = process.stdout.rows || 24;
  const initialQrCompact = terminalRows <= 24;

  useEffect(() => {
    if (!showQR || !displayUrl) {
      setQrText('');
      return;
    }
    qrToString(displayUrl, {
      type: 'utf8',
      errorCorrectionLevel: 'L',
      small: true,
      margin: initialQrCompact ? 1 : 2,
    } as Parameters<typeof qrToString>[1])
      .then(setQrText)
      .catch(() => setQrText(''));
  }, [showQR, displayUrl, initialQrCompact]);

  useKeybindings(
    {
      'confirm:yes': onDone,
      'confirm:toggle': () => {
        setShowQR(prev => !prev);
      },
    },
    { context: 'Confirmation' },
  );

  useInput((input, key) => {
    if (input === 'd' && !key.ctrl && !key.meta) {
      if (explicit && enabled && error === undefined) {
        saveGlobalConfig(current => {
          if (current.remoteControlAtStartup === false) return current;
          return { ...current, remoteControlAtStartup: false };
        });
      }
      setAppState(prev => {
        if (!prev.replBridgeEnabled && prev.replBridgeError === undefined) return prev;
        return {
          ...prev,
          replBridgeEnabled: false,
          replBridgeError: undefined,
          replBridgeErrorKind: undefined,
        };
      });
      onDone();
    }
    if (input === 'r' && !key.ctrl && !key.meta && !enabled && error !== undefined && errorKind === 'auth') {
      setAppState(prev => {
        if (prev.replBridgeEnabled || prev.replBridgeError === undefined) return prev;
        return {
          ...prev,
          replBridgeEnabled: true,
          replBridgeError: undefined,
          replBridgeErrorKind: undefined,
          replBridgeExplicit: true,
        };
      });
      onDone();
    }
  });

  const { label: statusLabel, color: statusColor } = getBridgeStatus({
    error,
    connected,
    sessionActive,
    reconnecting,
  });
  const indicator = error ? BRIDGE_FAILED_INDICATOR : BRIDGE_READY_INDICATOR;
  const qrLines = qrText ? qrText.split('\n').filter(l => l.length > 0) : [];
  const qrLayout = computeBridgeQrLayout(qrLines.length, terminalRows);
  const compactForQr = showQR && qrLayout.compact;

  const contextParts: string[] = [];
  if (repoName) contextParts.push(repoName);
  if (branchName) contextParts.push(branchName);
  const contextSuffix = contextParts.length > 0 ? ' · ' + contextParts.join(' · ') : '';

  const footerText =
    error !== undefined && errorKind === 'ended_elsewhere'
      ? undefined
      : error
        ? FAILED_FOOTER_TEXT
        : displayUrl
          ? sessionActive
            ? buildActiveFooterText(displayUrl)
            : buildIdleFooterText(displayUrl)
          : undefined;

  return (
    <Dialog title="Remote Control" onCancel={onDone} hideInputGuide>
      <Box flexDirection="column" gap={compactForQr ? 0 : 1}>
        <Box flexDirection="column">
          <Text>
            <Text color={statusColor}>
              {indicator} {statusLabel}
            </Text>
            <Text dimColor>{contextSuffix}</Text>
          </Text>
          {error && <Text color="error">{error}</Text>}
          {!compactForQr && verbose && environmentId && <Text dimColor>Environment: {environmentId}</Text>}
          {!compactForQr && verbose && sessionId && <Text dimColor>Session: {sessionId}</Text>}
        </Box>
        {showQR && qrLines.length > 0 && (
          <Box flexDirection="column">
            {qrLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </Box>
        )}
        {!compactForQr && footerText && <Text dimColor>{footerText}</Text>}
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="d" action={error !== undefined ? 'dismiss' : 'disconnect'} />
            {error !== undefined && !enabled && errorKind === 'auth' && (
              <KeyboardShortcutHint shortcut="r" action="reconnect" />
            )}
            {Boolean(displayUrl) && <Text>space for QR code</Text>}
            <KeyboardShortcutHint shortcut="enter/esc" action="close" />
          </Byline>
        </Text>
      </Box>
    </Dialog>
  );
}
