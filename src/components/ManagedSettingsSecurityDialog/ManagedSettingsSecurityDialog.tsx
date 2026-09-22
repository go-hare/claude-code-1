import React, { useState } from 'react';
import { Box, Text, useTimeout } from '@anthropic/ink';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { LOGIN_HANDOFF_WINDOW_MS, useIsWithinWindow, useRefusedWithin } from '../../hooks/useRefuseWithin.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { SettingsJson } from '../../utils/settings/types.js';
import { Select } from '../CustomSelect/index.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
import { extractDangerousSettings, formatDangerousSettingsList } from './utils.js';

export type ManagedSettingsReveal = 'login_handoff' | 'default';

type Props = {
  settings: SettingsJson;
  reveal?: ManagedSettingsReveal;
  onAccept: () => boolean | undefined;
  onReject: () => boolean | undefined;
  accepts?: () => boolean;
};

const CONFIRM_LABEL = 'Yes, I trust these settings';
const CANCEL_LABEL = 'No, exit Claude Code';

export function ManagedSettingsSecurityDialog({
  settings,
  reveal,
  onAccept,
  onReject,
  accepts,
}: Props): React.ReactNode {
  const dangerous = extractDangerousSettings(settings);
  const settingsList = formatDangerousSettingsList(dangerous);

  const exitState = useExitOnCtrlCDWithKeybindings();
  // densable X: s = reveal === "login_handoff"
  const loginHandoff = reveal === 'login_handoff';
  const justMounted = useIsWithinWindow(LOGIN_HANDOFF_WINDOW_MS);
  const { refusedWithin, noteRefused, epoch } = useRefusedWithin();
  const [focusEpoch, setFocusEpoch] = useState(0);
  const settled = useTimeout(LOGIN_HANDOFF_WINDOW_MS, epoch + focusEpoch);
  const remountKey = loginHandoff ? `${epoch}:${settled ? 'settled' : 'held'}` : `${epoch}`;

  // densable X d/Ke
  function refuseWithin(): boolean {
    if (!loginHandoff) {
      return false;
    }
    if (justMounted() || refusedWithin(LOGIN_HANDOFF_WINDOW_MS)) {
      noteRefused();
      return true;
    }
    return false;
  }

  // densable X C() — leftover Select has no refuseInput; apply here
  function refuseInput(): boolean {
    if (refuseWithin()) {
      return true;
    }
    return accepts?.() === false;
  }

  // densable X i()
  function runChoice(action: () => boolean | undefined): void {
    if (refuseInput()) {
      return;
    }
    if (action() === false) {
      setFocusEpoch(n => n + 1);
    }
  }

  useKeybinding('confirm:no', () => runChoice(onReject), { context: 'Confirmation' });

  function onChange(value: 'accept' | 'exit'): void {
    if (value === 'exit') {
      runChoice(onReject);
      return;
    }
    runChoice(onAccept);
  }

  const options = loginHandoff
    ? [
        { label: CANCEL_LABEL, value: 'exit' as const },
        { label: CONFIRM_LABEL, value: 'accept' as const },
      ]
    : [
        { label: CONFIRM_LABEL, value: 'accept' as const },
        { label: CANCEL_LABEL, value: 'exit' as const },
      ];

  return (
    <PermissionDialog color="warning" titleColor="warning" title="Managed settings require approval">
      <Box flexDirection="column" gap={1} paddingTop={1}>
        <Text>
          Your organization has configured managed settings that could allow execution of arbitrary code or interception
          of your prompts and responses.
        </Text>

        <Box flexDirection="column">
          <Text dimColor>Settings requiring approval:</Text>
          {settingsList.map((item, index) => (
            <Box key={index} paddingLeft={2}>
              <Text>
                <Text dimColor>· </Text>
                <Text>{item}</Text>
              </Text>
            </Box>
          ))}
        </Box>

        <Text>
          Only accept if you trust your organization&apos;s IT administration and expect these settings to be
          configured.
        </Text>

        <Select
          key={remountKey}
          options={options}
          hideIndexes={loginHandoff}
          defaultFocusValue={loginHandoff ? 'exit' : 'accept'}
          onChange={value => onChange(value as 'accept' | 'exit')}
          onCancel={() => onChange('exit')}
        />

        <Text dimColor>
          {exitState.pending ? <>Press {exitState.keyName} again to exit</> : <>Enter to confirm · Esc to exit</>}
        </Text>
      </Box>
    </PermissionDialog>
  );
}
