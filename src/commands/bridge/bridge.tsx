import { feature } from 'bun:bundle';
import { toString as qrToString } from 'qrcode';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { getBridgeAccessToken } from '../../bridge/bridgeConfig.js';
import { checkBridgeMinVersion, getBridgeDisabledReason, isEnvLessBridgeEnabled } from '../../bridge/bridgeEnabled.js';
import { checkEnvLessBridgeMinVersion } from '../../bridge/envLessBridgeConfig.js';
import { BRIDGE_LOGIN_INSTRUCTION, REMOTE_CONTROL_DISCONNECTED_MSG } from '../../bridge/types.js';
import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { ItemList } from '../../components/ItemList.js';
import { shouldShowRemoteCallout } from '../../components/RemoteCallout.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { logForDebugging } from '../../utils/debug.js';

type Props = {
  onDone: LocalJSXCommandOnDone;
  name?: string;
};

function BridgeToggle({ onDone, name }: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const replBridgeConnected = useAppState(s => s.replBridgeConnected);
  const replBridgeEnabled = useAppState(s => s.replBridgeEnabled);
  const replBridgeOutboundOnly = useAppState(s => s.replBridgeOutboundOnly);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  useEffect(() => {
    if ((replBridgeConnected || replBridgeEnabled) && !replBridgeOutboundOnly) {
      setShowDisconnectDialog(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      const error = await checkBridgePrerequisites();
      if (cancelled) return;
      if (error) {
        logEvent('tengu_bridge_command', {
          action: 'preflight_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        onDone(error, { display: 'system' });
        return;
      }

      if (shouldShowRemoteCallout()) {
        setAppState(prev => {
          if (prev.showRemoteCallout) return prev;
          return {
            ...prev,
            showRemoteCallout: true,
            replBridgeInitialName: name,
          };
        });
        onDone('', { display: 'system' });
        return;
      }

      logEvent('tengu_bridge_command', {
        action: 'connect' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      setAppState(prev => {
        if (prev.replBridgeEnabled && !prev.replBridgeOutboundOnly) return prev;
        return {
          ...prev,
          replBridgeEnabled: true,
          replBridgeExplicit: true,
          replBridgeOutboundOnly: false,
          replBridgeInitialName: name,
        };
      });
      onDone('Remote Control connecting…', {
        display: 'system',
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  if (showDisconnectDialog) {
    return <BridgeDisconnectDialog onDone={onDone} />;
  }

  return null;
}

function BridgeDisconnectDialog({ onDone }: Props): React.ReactNode {
  useRegisterOverlay('bridge-disconnect-dialog');
  const setAppState = useSetAppState();
  const sessionUrl = useAppState(s => s.replBridgeSessionUrl);
  const connectUrl = useAppState(s => s.replBridgeConnectUrl);
  const sessionActive = useAppState(s => s.replBridgeSessionActive);
  const [showQR, setShowQR] = useState(false);
  const [qrText, setQrText] = useState('');

  const displayUrl = sessionActive ? sessionUrl : connectUrl;

  useEffect(() => {
    if (!showQR || !displayUrl) {
      setQrText('');
      return;
    }
    qrToString(displayUrl, {
      type: 'utf8',
      errorCorrectionLevel: 'L',
      small: true,
    } as Parameters<typeof qrToString>[1])
      .then(setQrText)
      .catch(() => setQrText(''));
  }, [showQR, displayUrl]);

  function handleDisconnect(): void {
    setAppState(prev => {
      if (!prev.replBridgeEnabled) return prev;
      return {
        ...prev,
        replBridgeEnabled: false,
        replBridgeExplicit: false,
        replBridgeOutboundOnly: false,
      };
    });
    logEvent('tengu_bridge_command', {
      action: 'disconnect' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    onDone(REMOTE_CONTROL_DISCONNECTED_MSG, { display: 'system' });
  }

  function handleShowQR(): void {
    setShowQR(prev => !prev);
  }

  function handleContinue(): void {
    onDone(undefined, { display: 'skip' });
  }

  const qrLines = qrText ? qrText.split('\n').filter(l => l.length > 0) : [];

  const actions = [
    { key: 'disconnect', label: 'Disconnect this session', facts: [] as string[], run: handleDisconnect },
    {
      key: 'qr',
      label: showQR ? 'Hide QR code' : 'Show QR code',
      facts: showQR ? [] : ['Scan with your phone to open this session'],
      run: handleShowQR,
    },
    { key: 'continue', label: 'Continue', facts: [] as string[], run: handleContinue },
  ];

  return (
    <Dialog title="Remote Control" onCancel={handleContinue} hideInputGuide>
      <Box flexDirection="column" gap={1}>
        <Text>
          This session is available in the Claude mobile app
          {displayUrl ? ` and at ${displayUrl}` : ' and claude.ai/code'}.
        </Text>
        {showQR && qrLines.length > 0 && (
          <Box flexDirection="column">
            {qrLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </Box>
        )}
        <ItemList
          visibleOptionCount={actions.length}
          defaultFocusIndex={actions.length - 1}
          options={actions.map(item => ({
            label: item.label,
            value: item.key,
            facts: item.facts,
          }))}
          onSelect={index => {
            actions[index]?.run();
          }}
          onCancel={handleContinue}
        />
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="enter" action="select" />
            <KeyboardShortcutHint shortcut="esc" action="continue" />
          </Byline>
        </Text>
      </Box>
    </Dialog>
  );
}

async function checkBridgePrerequisites(): Promise<string | null> {
  const { waitForPolicyLimitsToLoad, isRemotePolicyAllowed } = await import('../../services/policyLimits/index.js');
  await waitForPolicyLimitsToLoad();
  if (!isRemotePolicyAllowed('allow_remote_control')) {
    return "Remote Control is disabled by your organization's policy.";
  }
  const disabledReason = await getBridgeDisabledReason();
  if (disabledReason) {
    return disabledReason;
  }

  let useV2 = isEnvLessBridgeEnabled();
  if (feature('KAIROS') && useV2) {
    const { isAssistantMode } = await import('../../assistant/index.js');
    if (isAssistantMode()) {
      useV2 = false;
    }
  }
  const versionError = useV2 ? await checkEnvLessBridgeMinVersion() : checkBridgeMinVersion();
  if (versionError) {
    return versionError;
  }

  if (!getBridgeAccessToken()) {
    return BRIDGE_LOGIN_INSTRUCTION;
  }

  logForDebugging('[bridge] Prerequisites passed, enabling bridge');
  return null;
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const name = args.trim() || undefined;
  return <BridgeToggle onDone={onDone} name={name} />;
}
