import React, { useCallback, useEffect, useRef } from 'react';
import { isBridgeEnabled } from '../bridge/bridgeEnabled.js';
import { Box, Text } from '@anthropic/ink';
import { getClaudeAIOAuthTokens } from '../utils/auth.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import type { OptionWithDescription } from './CustomSelect/select.js';
import { Select } from './CustomSelect/select.js';
import { PermissionDialog } from './permissions/PermissionDialog.js';

type RemoteCalloutSelection = 'enable' | 'dismiss';

type Props = {
  onDone: (selection: RemoteCalloutSelection) => void;
  defaultFocusValue?: RemoteCalloutSelection;
};

export function RemoteCallout({ onDone, defaultFocusValue }: Props): React.ReactNode {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const handleCancel = useCallback((): void => {
    onDoneRef.current('dismiss');
  }, []);

  // Permanently mark as seen on mount so it only shows once
  useEffect(() => {
    saveGlobalConfig(current => {
      if (current.remoteDialogSeen) return current;
      return { ...current, remoteDialogSeen: true };
    });
  }, []);

  const handleSelect = useCallback((value: RemoteCalloutSelection): void => {
    onDoneRef.current(value);
  }, []);

  const options: OptionWithDescription<RemoteCalloutSelection>[] = [
    {
      label: 'Enable Remote Control',
      description: 'Opens a secure connection to claude.ai.',
      value: 'enable',
    },
    {
      label: 'Never mind',
      description: 'You can always enable it later with /remote-control.',
      value: 'dismiss',
    },
  ];

  return (
    <PermissionDialog title="Remote Control">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1} flexDirection="column">
          <Text>
            Take this session with you and pick up right where you left off on any device. Open the Code tab in the
            Claude mobile app, or visit claude.ai/code in a browser.
          </Text>
          <Text> </Text>
          <Text>
            The session keeps running on this machine. Use your other devices as a remote control. Disconnect anytime
            with /remote-control.
          </Text>
        </Box>
        <Box>
          <Select
            defaultFocusValue={defaultFocusValue}
            options={options}
            onChange={handleSelect}
            onCancel={handleCancel}
          />
        </Box>
      </Box>
    </PermissionDialog>
  );
}

/**
 * Check whether to show the remote callout (first-time dialog).
 */
export function shouldShowRemoteCallout(): boolean {
  const config = getGlobalConfig();
  if (config.remoteDialogSeen) return false;
  if (!isBridgeEnabled()) return false;
  const tokens = getClaudeAIOAuthTokens();
  if (!tokens?.accessToken) return false;
  return true;
}
