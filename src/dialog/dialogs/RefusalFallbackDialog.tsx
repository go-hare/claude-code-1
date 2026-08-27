/**
 * densable Giu — refusal_fallback_prompt DialogHost renderer.
 */
import React, { useMemo } from 'react';
import { Box, Dialog, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/index.js';
import { buildRefusalFallbackChoiceLabels } from '../../utils/refusalFallback.js';
import type { RefusalFallbackResult } from '../../utils/printRequestDialog.js';

export type RefusalFallbackDialogPayload = {
  originalModel: string;
  fallbackModel: string;
  apiRefusalCategory?: string | null;
  guidanceText?: string;
  retractedMessageUuids?: string[];
};

type Props = {
  payload: RefusalFallbackDialogPayload;
  onAnswer: (result: RefusalFallbackResult) => void;
};

export function RefusalFallbackDialog({ payload, onAnswer }: Props): React.ReactNode {
  const labels = useMemo(
    () => buildRefusalFallbackChoiceLabels(payload.originalModel, payload.fallbackModel),
    [payload.originalModel, payload.fallbackModel],
  );

  const guidance = typeof payload.guidanceText === 'string' ? payload.guidanceText.slice(0, 512) : '';

  return (
    <Dialog title="Session paused" color="warning" onCancel={() => onAnswer('cancelled')}>
      <Box flexDirection="column" gap={1}>
        <Text>
          {payload.originalModel} refused
          {payload.apiRefusalCategory ? ` (${payload.apiRefusalCategory})` : ''}. Choose how to continue.
        </Text>
        {guidance !== '' && <Text color="inactive">{guidance}</Text>}
        <Select
          options={[
            { value: 'retry_fallback', label: labels.retry_fallback },
            { value: 'edit_prompt', label: labels.edit_prompt },
          ]}
          onChange={value => onAnswer(value as 'retry_fallback' | 'edit_prompt')}
          onCancel={() => onAnswer('cancelled')}
        />
      </Box>
    </Dialog>
  );
}
