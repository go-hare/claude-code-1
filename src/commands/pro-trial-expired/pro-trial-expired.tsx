import React, { useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { logEvent } from '../../services/analytics/index.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { getSubscriptionType } from '../../utils/auth.js';

type TrialChoice = 'upgrade' | 'extra-usage';

function ProTrialExpiredDialog({
  onDone,
  context,
}: {
  onDone: LocalJSXCommandOnDone;
  context: LocalJSXCommandContext;
}): React.ReactNode {
  const [delegatedNode, setDelegatedNode] = useState<React.ReactNode>(null);

  if (delegatedNode !== null) {
    return delegatedNode;
  }

  const isEnterprise = getSubscriptionType() === 'enterprise';
  const options: Array<{ label: string; value: TrialChoice }> = [
    ...(isEnterprise ? [] : [{ label: 'Upgrade to Max or Ultra', value: 'upgrade' as const }]),
    {
      label: 'Add funds to continue with usage credits',
      value: 'extra-usage' as const,
    },
  ];

  const handleSelect = (choice: TrialChoice) => {
    logEvent('tengu_pro_trial_expired_choice', {
      chose_upgrade: choice === 'upgrade',
    });
    if (choice === 'upgrade') {
      void import('../upgrade/upgrade.js')
        .then(mod => mod.call(onDone, context))
        .then(node => {
          if (node !== null) setDelegatedNode(node);
        });
    } else {
      void import('../extra-usage/extra-usage.js')
        .then(mod => mod.call(onDone, context))
        .then(node => {
          if (node !== null) setDelegatedNode(node);
        });
    }
  };

  return (
    <Box flexDirection="column">
      <Box paddingX={2}>
        <Text color="error">Your Claude Code trial has ended.</Text>
      </Box>
      <Dialog title="What do you want to do?" onCancel={() => onDone()}>
        <Select<TrialChoice> options={options} onChange={handleSelect} onCancel={() => onDone()} />
      </Dialog>
    </Box>
  );
}

/**
 * Official 2.1.331 `chunk-jpygrmj3.js` — `/pro-trial-expired` handler.
 */
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <ProTrialExpiredDialog onDone={onDone} context={context} />;
}
