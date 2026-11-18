import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, Link, Text } from '@anthropic/ink';
import { getIsNonInteractiveSession } from '../../bootstrap/state.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { formatTokens } from '../../utils/format.js';
import {
  CHANGELOG_DOCS_LABEL,
  CHANGELOG_DOCS_URL,
  getStartupUpdateSummary,
  hasUnseenReleaseVersion,
} from '../../utils/logoV2Utils.js';
import {
  buildUnrecognizedModelNotice,
  MODEL_CONFIG_DOCS_URL,
  MODEL_CONFIG_WINDOW_DOCS_URL,
  sanitizeModelForNotice,
  type UnrecognizedModelNotice,
} from '../../utils/model/unrecognizedModelSignal.js';
import { getAgentId } from '../../utils/teammate.js';
import { CondensedLogo } from './CondensedLogo.js';

export function LogoUnrecognizedModelWarning({ notice }: { notice: UnrecognizedModelNotice }): React.ReactNode {
  return (
    <Text color="warning">
      {`Model "${sanitizeModelForNotice(notice.model)}" isn't recognized`}
      {notice.suggestion === undefined ? (
        <Text dimColor>
          {' · context assumed to be '}
          {formatTokens(notice.window)}
          {' tokens · update Claude Code, or see '}
          <Link url={MODEL_CONFIG_WINDOW_DOCS_URL} fallback={MODEL_CONFIG_DOCS_URL}>
            the docs
          </Link>
        </Text>
      ) : (
        <Text dimColor>{` · did you mean "${notice.suggestion}"?`}</Text>
      )}
    </Text>
  );
}

export function LogoV2(): React.ReactNode {
  const [suppressed] = useState(() => getIsNonInteractiveSession() || getAgentId() !== undefined);
  const [updateSummary] = useState(() => (suppressed || process.env.DEMO_VERSION ? null : getStartupUpdateSummary()));
  const model = useMainLoopModel();
  const unknownModelNotice = suppressed || process.env.DEMO_VERSION ? null : buildUnrecognizedModelNotice(model);

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
      {unknownModelNotice && (
        <Box paddingLeft={2} flexDirection="column">
          <LogoUnrecognizedModelWarning notice={unknownModelNotice} />
        </Box>
      )}
    </>
  );
}
