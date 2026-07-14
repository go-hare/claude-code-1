/**
 * Official denser Ink Dialog for daemon cold-start install prompt.
 * Used when ask_install surfaces inside an already-mounted Ink session
 * (REPL /daemon). CLI `claude agents` uses readline via installPrompt.ts.
 */

import React from 'react';
import { Box, Dialog, Text } from '@anthropic/ink';
import { Select } from './CustomSelect/index.js';

export type DaemonInstallDialogChoice = 'yes' | 'once' | 'never' | 'no';

type Props = {
  onChoice(choice: DaemonInstallDialogChoice): void;
};

export function DaemonInstallDialog({ onChoice }: Props): React.ReactNode {
  return (
    <Dialog title="Install background daemon?" color="permission" onCancel={() => onChoice('no')}>
      <Box flexDirection="column" gap={1}>
        <Text>
          No background daemon is running. Installing it as a service keeps the daemon available across reboot so
          background sessions and <Text bold>claude agents</Text> stay available.
        </Text>
        <Text dimColor>
          Run <Text bold>claude daemon uninstall</Text> later to undo a service install.
        </Text>
      </Box>
      <Select
        options={[
          { label: 'Yes, install as a service', value: 'yes' },
          { label: 'Once — start a transient daemon for now', value: 'once' },
          { label: "Never — don't ask again", value: 'never' },
          { label: 'No', value: 'no' },
        ]}
        onChange={value => onChoice(value as DaemonInstallDialogChoice)}
        onCancel={() => onChoice('no')}
      />
    </Dialog>
  );
}
