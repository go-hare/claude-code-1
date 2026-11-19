/**
 * densable 2.1.222 $$n — confirm before createAdminRequest(limit_increase).
 * Team/Enterprise members without billing access land here after BTr.
 */
import { Box, Text } from '@anthropic/ink';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtraUsage } from '../services/api/usage.js';
import { submitAdminUsageCreditRequest } from '../commands/extra-usage/extra-usage-core.js';

type Props = {
  extraUsage?: ExtraUsage | null;
  onDone: (message: string) => void;
};

/**
 * Sends the admin usage credit request in one step on mount (#1665).
 */
export function ConfirmAdminUsageRequest({ extraUsage, onDone }: Props): React.ReactNode {
  const [sending, setSending] = useState(true);
  const settled = useRef(false);

  const onConfirm = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    setSending(true);
    void submitAdminUsageCreditRequest(extraUsage).then(result => {
      onDone(result.type === 'message' ? result.value : 'Request sent.');
    });
  }, [extraUsage, onDone]);

  useEffect(() => {
    onConfirm();
  }, [onConfirm]);

  if (sending) {
    return (
      <Box paddingTop={1}>
        <Text dimColor>Sending request to your admin…</Text>
      </Box>
    );
  }

  return null;
}
