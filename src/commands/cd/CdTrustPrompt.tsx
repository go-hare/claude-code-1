/**
 * densable 2.1.218 #28 — CdTrustPrompt (Pya).
 * "Moving to a new directory:" trust dialog with repository-root sentence.
 */
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/index.js';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import {
  ACCESSING_CAPABILITY,
  CD_TRUST_REPO_PREFIX,
  CD_TRUST_REPO_SUFFIX,
} from '../../components/TrustDialog/trustDialogCopy.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';

type Props = {
  directory: string;
  /** densable wya — shown when directory is under a distinct git root */
  trustRoot?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CdTrustPrompt({ directory, trustRoot, onConfirm, onCancel }: Props): React.ReactNode {
  const doneRef = React.useRef(false);
  const once = (fn: () => void) => {
    if (doneRef.current) return;
    doneRef.current = true;
    fn();
  };

  useExitOnCtrlCDWithKeybindings(() => once(onCancel));
  useKeybinding('confirm:no', () => once(onCancel), {
    context: 'Confirmation',
  });

  return (
    <PermissionDialog color="warning" titleColor="warning" title="Moving to a new directory:">
      <Box flexDirection="column" gap={1} paddingTop={1}>
        <Text bold>{directory}</Text>
        {trustRoot != null && trustRoot.length > 0 ? (
          <Text>
            {CD_TRUST_REPO_PREFIX} <Text bold>{trustRoot}</Text>
            {CD_TRUST_REPO_SUFFIX}
          </Text>
        ) : null}
        <Text>{"This session hasn't worked here before. Is this a directory you created or one you trust?"}</Text>
        <Text>{ACCESSING_CAPABILITY}</Text>
        <Text dimColor>Security guide: https://code.claude.com/docs/en/security</Text>
        <Select
          options={[
            // densable cancelFirst / focus cancel
            { label: 'No, stay put', value: 'cancel' },
            { label: 'Yes, move here', value: 'confirm' },
          ]}
          defaultFocusValue="cancel"
          onChange={value => {
            if (value === 'confirm') once(onConfirm);
            else once(onCancel);
          }}
          onCancel={() => once(onCancel)}
        />
        <Text dimColor>Enter confirm · Esc cancel</Text>
      </Box>
    </PermissionDialog>
  );
}
