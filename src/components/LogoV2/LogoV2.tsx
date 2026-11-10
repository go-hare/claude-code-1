import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, Link, Text } from '@anthropic/ink';
import { getIsNonInteractiveSession } from '../../bootstrap/state.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import {
  CHANGELOG_DOCS_LABEL,
  CHANGELOG_DOCS_URL,
  getStartupUpdateSummary,
  hasUnseenReleaseVersion,
} from '../../utils/logoV2Utils.js';
import { getAgentId } from '../../utils/teammate.js';
import { CondensedLogo } from './CondensedLogo.js';

export function LogoV2(): React.ReactNode {
  const [suppressed] = useState(() => getIsNonInteractiveSession() || getAgentId() !== undefined);
  const [updateSummary] = useState(() => (suppressed || process.env.DEMO_VERSION ? null : getStartupUpdateSummary()));

  useEffect(() => {
    if (suppressed || !hasUnseenReleaseVersion(getGlobalConfig().lastReleaseNotesSeen)) {
      return;
    }
    saveGlobalConfig(current => {
      if (!hasUnseenReleaseVersion(current.lastReleaseNotesSeen)) return current;
      return { ...current, lastReleaseNotesSeen: MACRO.VERSION };
    });
  }, [suppressed]);

  return (
    <>
      <CondensedLogo oneShotsAllowed={!suppressed} />
      {updateSummary && (
        <Box paddingLeft={2} flexDirection="column">
          <Text bold>{updateSummary}</Text>
          <Text dimColor>
            <Link url={CHANGELOG_DOCS_URL}>{CHANGELOG_DOCS_LABEL}</Link> for details
          </Text>
        </Box>
      )}
    </>
  );
}
