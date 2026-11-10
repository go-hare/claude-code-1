import React, { useCallback } from 'react';
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js';
import { Box, Dialog, Link, Text } from '@anthropic/ink';
import type { ExternalClaudeMdInclude } from '../utils/claudemd.js';
import { saveCurrentProjectConfig } from '../utils/config.js';
import { plural } from '../utils/stringUtils.js';
import { ConfirmSelect } from './ConfirmSelect.js';

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
  const [openedAt] = React.useState(() => Date.now());
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

  const shownIncludes =
    externalIncludes && externalIncludes.length > 5 ? externalIncludes.slice(0, 3) : externalIncludes;
  const hiddenCount =
    externalIncludes && shownIncludes ? Math.max(0, externalIncludes.length - shownIncludes.length) : 0;

  return (
    <Dialog
      title="Allow external CLAUDE.md file imports?"
      color="warning"
      onCancel={handleEscape}
      exitOnCtrlCD={isStandaloneDialog}
      hideBorder={!isStandaloneDialog}
      hideInputGuide={!isStandaloneDialog}
    >
      <Text>
        This project&apos;s CLAUDE.md or .claude/rules imports files outside the current working directory. Never allow
        this for third-party repositories.
      </Text>

      {shownIncludes && shownIncludes.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>External imports:</Text>
          {shownIncludes.map((include, i) => (
            <Text key={i} dimColor wrap="truncate-middle">
              {'  '}
              {include.path}
            </Text>
          ))}
          {hiddenCount > 0 && (
            <>
              <Text dimColor wrap="truncate">
                {`  … +${hiddenCount} ${plural(hiddenCount, 'import')} not shown.`}
              </Text>
              <Text dimColor wrap="truncate">
                {'  '}Yes covers those too, plus any this project adds later.
              </Text>
            </>
          )}
        </Box>
      )}

      <Text dimColor>
        Important: Only use Claude Code with files you trust. Accessing untrusted files may pose security risks{' '}
        <Link url="https://code.claude.com/docs/en/security" />{' '}
      </Text>

      <ConfirmSelect
        hideIndexes
        cancelFirst
        focus="cancel"
        openedAt={openedAt}
        confirmLabel="Yes, allow external imports"
        cancelLabel="No, disable external imports"
        onConfirm={() => handleSelection('yes')}
        onCancel={() => handleSelection('no')}
      />
    </Dialog>
  );
}
