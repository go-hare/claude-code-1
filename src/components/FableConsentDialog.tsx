/**
 * Official model_fable_consent densable UI — Fable 5 overage consent.
 * Accept marks fableOverageConsentV2; decline cancels selection.
 * Full credit purchase / 3DS remains denser via ExtraUsageDialog.
 */
import { Box, Dialog, Text } from '@anthropic/ink';
import React, { useMemo, useState } from 'react';
import {
  getFableConsentCopy,
  markFableOverageConsent,
  resolveFableConsentKey,
  type FableConsentCopy,
} from '../utils/fableConsent.js';
import { Select } from './CustomSelect/index.js';

export type FableConsentDialogProps = {
  organizationUuid?: string | null;
  accountUuid?: string | null;
  /** When no org/account key, accept sets session fallback via callback. */
  onAccept: (result: { consentKey: string | null; sessionFallback: boolean }) => void;
  onDecline: () => void;
  copy?: Partial<FableConsentCopy>;
  creditsOff?: boolean;
  noCreditsYet?: boolean;
  canBuy?: boolean;
};

type Choice = 'accept' | 'decline';

export function FableConsentDialog({
  organizationUuid,
  accountUuid,
  onAccept,
  onDecline,
  copy: copyOverride,
  creditsOff,
  noCreditsYet,
  canBuy,
}: FableConsentDialogProps): React.ReactNode {
  const [busy, setBusy] = useState(false);
  const copy = useMemo(() => {
    const base = getFableConsentCopy({ creditsOff, noCreditsYet, canBuy });
    return { ...base, ...copyOverride };
  }, [canBuy, copyOverride, creditsOff, noCreditsYet]);

  function handleSelect(value: Choice): void {
    if (busy) return;
    if (value === 'decline') {
      onDecline();
      return;
    }
    setBusy(true);
    const key = resolveFableConsentKey({ organizationUuid, accountUuid });
    if (key) {
      markFableOverageConsent(key);
      onAccept({ consentKey: key, sessionFallback: false });
      return;
    }
    // Official session fallback when no org/account identity.
    onAccept({ consentKey: null, sessionFallback: true });
  }

  return (
    <Dialog title={copy.title} color="warning" onCancel={() => handleSelect('decline')}>
      <Box flexDirection="column">
        <Text>{copy.body}</Text>
        <Text dimColor>Fable 5 is billed with usage credits, purchased separately from your plan.</Text>
      </Box>
      <Select
        options={[
          { label: copy.acceptLabel, value: 'accept' as const },
          { label: copy.declineLabel, value: 'decline' as const },
        ]}
        onChange={handleSelect}
      />
    </Dialog>
  );
}
