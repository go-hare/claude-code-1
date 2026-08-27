/**
 * densable snu / anu — auto_mode_setup_review + auto_mode_flagged_allow.
 * Tip bridge: accept/decline (review) and multi-select remove (flagged).
 */
import React, { useState } from 'react';
import { Box, Dialog, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/index.js';

export type AutoModeSetupReviewPayload = {
  environment?: string[];
  allow?: string[];
  soft_deny?: string[];
  hard_deny?: string[];
  remove_from_permissions_allow?: string[];
  notes?: string[];
  mode?: 'append' | 'replace';
};

export type AutoModeSetupReviewResult = 'accept' | 'decline' | 'cancelled';

type ReviewProps = {
  payload: AutoModeSetupReviewPayload;
  onAnswer: (result: AutoModeSetupReviewResult) => void;
};

export function AutoModeSetupReviewDialog({ payload, onAnswer }: ReviewProps): React.ReactNode {
  const allowCount = payload.allow?.length ?? 0;
  const denyCount = (payload.soft_deny?.length ?? 0) + (payload.hard_deny?.length ?? 0);

  return (
    <Dialog
      title="Auto-mode setup proposal is ready for review"
      color="permission"
      onCancel={() => onAnswer('cancelled')}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          Mode: {payload.mode ?? 'append'} · allow {allowCount} · deny {denyCount}
        </Text>
        {(payload.notes ?? []).slice(0, 3).map(note => (
          <Text key={note} dimColor>
            {note}
          </Text>
        ))}
        <Select
          options={[
            { value: 'accept', label: 'Accept proposal' },
            { value: 'decline', label: 'Decline' },
          ]}
          onChange={value => onAnswer(value as 'accept' | 'decline')}
          onCancel={() => onAnswer('cancelled')}
        />
      </Box>
    </Dialog>
  );
}

export type AutoModeFlaggedAllowPayload = {
  flagged: string[];
  runId: string;
};

export type AutoModeFlaggedAllowResult = { toRemove: string[] } | 'cancelled';

type FlaggedProps = {
  payload: AutoModeFlaggedAllowPayload;
  onAnswer: (result: AutoModeFlaggedAllowResult) => void;
};

export function AutoModeFlaggedAllowDialog({ payload, onAnswer }: FlaggedProps): React.ReactNode {
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <Dialog
      title="Auto-mode setup flagged some permission rules for review"
      color="warning"
      onCancel={() => onAnswer('cancelled')}
    >
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Select rules to remove, or keep all flagged allows.</Text>
        {(payload.flagged ?? []).slice(0, 12).map(rule => {
          const on = selected.includes(rule);
          return (
            <Text key={rule}>
              {on ? '[x] ' : '[ ] '}
              {rule}
            </Text>
          );
        })}
        <Select
          options={[
            {
              value: 'toggle-first',
              label: payload.flagged[0] !== undefined ? `Toggle remove: ${payload.flagged[0]}` : 'No flagged rules',
            },
            {
              value: 'remove-selected',
              label: `Remove selected (${selected.length})`,
            },
            { value: 'keep-all', label: 'Keep all flagged allows' },
          ]}
          onChange={value => {
            if (value === 'toggle-first' && payload.flagged[0]) {
              const rule = payload.flagged[0];
              setSelected(prev => (prev.includes(rule) ? prev.filter(r => r !== rule) : [...prev, rule]));
              return;
            }
            if (value === 'remove-selected') {
              onAnswer({ toRemove: selected });
              return;
            }
            if (value === 'keep-all') {
              onAnswer({ toRemove: [] });
            }
          }}
          onCancel={() => onAnswer('cancelled')}
        />
      </Box>
    </Dialog>
  );
}
