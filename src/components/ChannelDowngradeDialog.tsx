import React from 'react';
import { Text } from '@anthropic/ink';
import { Select } from './CustomSelect/index.js';
import { Dialog } from '@anthropic/ink';

export type ChannelDowngradeChoice = 'downgrade' | 'stay' | 'cancel';

type Props = {
  currentVersion: string;
  onChoice: (choice: ChannelDowngradeChoice) => void;
};

/**
 * Dialog shown when switching from latest to stable channel.
 * Allows user to choose whether to downgrade or stay on current version.
 */
export function ChannelDowngradeDialog({ currentVersion, onChoice }: Props): React.ReactNode {
  function handleSelect(value: ChannelDowngradeChoice): void {
    onChoice(value);
  }

  function handleCancel(): void {
    onChoice('cancel');
  }

  return (
    <Dialog title="Switch to stable channel" onCancel={handleCancel} color="permission" hideBorder hideInputGuide>
      <Text>The stable channel may be older than the version you&apos;re running ({currentVersion}).</Text>
      <Text>Which version do you want?</Text>
      <Select
        declineValue="stay"
        options={[
          {
            label: 'Use the stable version, even if older',
            value: 'downgrade' as ChannelDowngradeChoice,
          },
          {
            label: `Stay on ${currentVersion} until stable catches up`,
            value: 'stay' as ChannelDowngradeChoice,
          },
        ]}
        onChange={handleSelect}
      />
    </Dialog>
  );
}
