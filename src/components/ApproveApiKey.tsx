import React from 'react';
import { Dialog, Text } from '@anthropic/ink';
import { saveGlobalConfig } from '../utils/config.js';
import { ConfirmSelect } from './ConfirmSelect.js';

type Props = {
  customApiKeyTruncated: string;
  onDone(approved: boolean): void;
};

export function ApproveApiKey({ customApiKeyTruncated, onDone }: Props): React.ReactNode {
  function onChange(value: 'yes' | 'no') {
    switch (value) {
      case 'yes': {
        saveGlobalConfig(current => ({
          ...current,
          customApiKeyResponses: {
            ...current.customApiKeyResponses,
            approved: [...(current.customApiKeyResponses?.approved ?? []), customApiKeyTruncated],
          },
        }));
        onDone(true);
        break;
      }
      case 'no': {
        saveGlobalConfig(current => ({
          ...current,
          customApiKeyResponses: {
            ...current.customApiKeyResponses,
            rejected: [...(current.customApiKeyResponses?.rejected ?? []), customApiKeyTruncated],
          },
        }));
        onDone(false);
        break;
      }
    }
  }

  return (
    <Dialog
      title="Detected a custom API key in your environment"
      color="warning"
      onCancel={() => onChange('no')}
      exitOnCtrlCD
    >
      <Text>
        <Text bold>ANTHROPIC_API_KEY</Text>
        <Text>: sk-ant-...{customApiKeyTruncated}</Text>
      </Text>
      <Text>Do you want to use this API key?</Text>
      <ConfirmSelect
        hideIndexes
        focus="cancel"
        cancelLabel={
          (
            <Text>
              No (<Text bold>recommended</Text>)
            </Text>
          ) as unknown as string
        }
        onConfirm={() => onChange('yes')}
        onCancel={() => onChange('no')}
      />
    </Dialog>
  );
}
