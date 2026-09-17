/**
 * densable 2.1.246 `ee` / CdTrustPrompt.
 * Move prompt, or `backstop` after a gated-grants relocate.
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
import {
  type CdDisclosures,
  formatCdDisclosureCount,
  formatCdDisclosureList,
  shouldShowCdDisclosures,
} from './cdDisclosures.js';

type Props = {
  directory: string;
  trustRoot?: string | null;
  disclosures?: CdDisclosures;
  backstop?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CdTrustPrompt({
  directory,
  trustRoot,
  disclosures,
  backstop = false,
  onConfirm,
  onCancel,
}: Props): React.ReactNode {
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

  const showDisclosures = shouldShowCdDisclosures(disclosures, backstop);
  const title = backstop ? 'Now in a new directory:' : 'Moving to a new directory:';
  const confirmLabel = backstop ? 'Yes, trust it and apply them' : 'Yes, move here';
  const cancelLabel = backstop ? 'No, keep them off' : 'No, stay put';

  return (
    <PermissionDialog color="warning" titleColor="warning" title={title}>
      <Box flexDirection="column" gap={1} paddingTop={1}>
        <Text bold>{directory}</Text>
        {trustRoot != null && trustRoot.length > 0 ? (
          <Text>
            {CD_TRUST_REPO_PREFIX} <Text bold>{trustRoot}</Text>
            {CD_TRUST_REPO_SUFFIX}
          </Text>
        ) : null}
        {backstop ? (
          <Text>
            Its settings declare project permission rules and/or additional directories. They apply only if you trust
            this directory explicitly.
          </Text>
        ) : (
          <Text>{"This session hasn't worked here before. Is this a directory you created or one you trust?"}</Text>
        )}
        {showDisclosures && disclosures ? <CdDisclosureLines disclosures={disclosures} backstop={backstop} /> : null}
        {!backstop ? <Text>{ACCESSING_CAPABILITY}</Text> : null}
        <Text dimColor>Security guide: https://code.claude.com/docs/en/security</Text>
        <Select
          options={[
            { label: cancelLabel, value: 'cancel' },
            { label: confirmLabel, value: 'confirm' },
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

function CdDisclosureLines({
  disclosures,
  backstop,
}: {
  disclosures: CdDisclosures;
  backstop: boolean;
}): React.ReactNode {
  const allow = disclosures.allowRules;
  const extra = disclosures.additionalDirectories;
  return (
    <Box flexDirection="column" gap={1}>
      {allow.sources.length > 0 ? (
        <Text bold color="warning">
          This directory pre-approves {allow.rawCount}{' '}
          {formatCdDisclosureCount(allow.rawCount, 'tool permission', 'tool permissions')} in{' '}
          {formatCdDisclosureList(allow.sources)}: {formatCdDisclosureList(allow.rules, 8)}
        </Text>
      ) : null}
      {extra.sources.length > 0 ? (
        <Text bold color="warning">
          This directory grants access to {extra.rawCount} additional{' '}
          {formatCdDisclosureCount(extra.rawCount, 'directory', 'directories')} in{' '}
          {formatCdDisclosureList(extra.sources)}: {formatCdDisclosureList(extra.dirs, 6)}
        </Text>
      ) : null}
      {!backstop && disclosures.hookSources.length > 0 ? (
        <Text bold color="warning">
          Hooks declared in {formatCdDisclosureList(disclosures.hookSources)}
        </Text>
      ) : null}
      {!backstop && disclosures.commandHelperSources.length > 0 ? (
        <Text bold color="warning">
          Command helpers declared in {formatCdDisclosureList(disclosures.commandHelperSources)}
        </Text>
      ) : null}
    </Box>
  );
}
