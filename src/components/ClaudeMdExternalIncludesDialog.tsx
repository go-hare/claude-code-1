import React, { useCallback } from 'react';
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js';
import { Box, Dialog, Link, Text } from '@anthropic/ink';
import type { ExternalClaudeMdInclude } from '../utils/claudemd.js';
import { saveCurrentProjectConfig } from '../utils/config.js';
import { Select } from './CustomSelect/index.js';

/** densable phn source — dialog vs /config Jr toggle. */
export type ExternalIncludesDecisionSource = 'dialog' | 'config_toggle';

/**
 * densable phn / recordExternalIncludesDecision.
 * Official: KE(flags, storageV5) then N(..., {source: me(t)}).
 * Local save has no storageV5; me is the analytics identity wrap.
 */
export function recordExternalIncludesDecision(
  approved: boolean,
  source: ExternalIncludesDecisionSource,
  // Official phn third arg is context / storageV5. Local save has no storageV5.
  _context?: unknown,
): void {
  saveCurrentProjectConfig(current => ({
    ...current,
    hasClaudeMdExternalIncludesApproved: approved,
    hasClaudeMdExternalIncludesWarningShown: true,
  }));
  logEvent(
    approved
      ? 'tengu_claude_md_external_includes_dialog_accepted'
      : 'tengu_claude_md_external_includes_dialog_declined',
    {
      source: source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    },
  );
}

type Props = {
  onDone(): void;
  isStandaloneDialog?: boolean;
  externalIncludes?: ExternalClaudeMdInclude[];
};

export function ClaudeMdExternalIncludesDialog({
  onDone,
  isStandaloneDialog,
  externalIncludes,
}: Props): React.ReactNode {
  React.useEffect(() => {
    // Log when dialog is shown
    logEvent('tengu_claude_md_includes_dialog_shown', {});
  }, []);

  const handleSelection = useCallback(
    (value: 'yes' | 'no') => {
      // densable A0o → phn(kDO==="yes", "dialog", storageV5)
      recordExternalIncludesDecision(value === 'yes', 'dialog');
      onDone();
    },
    [onDone],
  );

  const handleEscape = useCallback(() => {
    handleSelection('no');
  }, [handleSelection]);

  return (
    <Dialog
      title="Allow external CLAUDE.md file imports?"
      color="warning"
      onCancel={handleEscape}
      hideBorder={!isStandaloneDialog}
      hideInputGuide={!isStandaloneDialog}
    >
      <Text>
        This project&apos;s CLAUDE.md imports files outside the current working directory. Never allow this for
        third-party repositories.
      </Text>

      {externalIncludes && externalIncludes.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>External imports:</Text>
          {externalIncludes.map((include, i) => (
            <Text key={i} dimColor>
              {'  '}
              {include.path}
            </Text>
          ))}
        </Box>
      )}

      <Text dimColor>
        Important: Only use Claude Code with files you trust. Accessing untrusted files may pose security risks{' '}
        <Link url="https://code.claude.com/docs/en/security" />{' '}
      </Text>

      <Select
        options={[
          { label: 'Yes, allow external imports', value: 'yes' },
          { label: 'No, disable external imports', value: 'no' },
        ]}
        onChange={value => handleSelection(value as 'yes' | 'no')}
      />
    </Dialog>
  );
}
