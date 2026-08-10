/**
 * densable 2.1.222 $$n — confirm before createAdminRequest(limit_increase).
 * Team/Enterprise members without billing access land here after BTr.
 */
import { Box, Text } from '@anthropic/ink';
import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import type { ExtraUsage } from '../services/api/usage.js';
import { submitAdminUsageCreditRequest } from '../commands/extra-usage/extra-usage-core.js';
import { Dialog } from './design-system/Dialog.js';
import { Select } from './CustomSelect/index.js';

type Props = {
  extraUsage?: ExtraUsage | null;
  onDone: (message: string) => void;
};

export function ConfirmAdminUsageRequest({ extraUsage, onDone }: Props): React.ReactNode {
  const [sending, setSending] = useState(false);
  const settled = useRef(false);

  const purpose =
    extraUsage == null
      ? 'turn on or increase your usage credits'
      : extraUsage.is_enabled
        ? 'increase your usage credit limit'
        : 'turn on usage credits';

  const onConfirm = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    setSending(true);
    void submitAdminUsageCreditRequest(extraUsage).then(result => {
      onDone(result.type === 'message' ? result.value : 'Request sent.');
    });
  }, [extraUsage, onDone]);

  const onCancel = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    onDone('No request sent to your admin.');
  }, [onDone]);

  if (sending) {
    return (
      <Box paddingTop={1}>
        <Text dimColor>Sending request to your admin…</Text>
      </Box>
    );
  }

  return (
    <Dialog title="Request usage credits from your admin" onCancel={onCancel} color="suggestion">
      <Box flexDirection="column" gap={1}>
        <Text>This will send a request to your organization&apos;s admins to {purpose}.</Text>
        <Text dimColor>
          Only send this if you&apos;re running into usage limits — your admins are notified and review each request.
        </Text>
        <Select
          defaultValue="cancel"
          defaultFocusValue="cancel"
          options={[
            { label: 'Send request', value: 'send' },
            { label: 'Cancel', value: 'cancel' },
          ]}
          onChange={value => {
            if (value === 'send') onConfirm();
            else onCancel();
          }}
          onCancel={onCancel}
        />
      </Box>
    </Dialog>
  );
}
