import * as React from 'react';
import { use } from 'react';
import { Box, Text } from '@anthropic/ink';
import type { AgentDefinitionsResult } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { useSettings } from '../hooks/useSettings.js';
import { getMemoryFiles } from '../utils/claudemd.js';
import { getGlobalConfig } from '../utils/config.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import {
  getActiveNotices,
  selectNoticesForDisplay,
  type StatusNoticeContext,
} from '../utils/statusNoticeDefinitions.js';
import { plural } from '../utils/stringUtils.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';

type Props = {
  agentDefinitions?: AgentDefinitionsResult;
};

const SLOT_ACCENT_INDENT = 1;
const SLOT_PLAIN_INDENT = 2;

/**
 * StatusNotices contains the information displayed to users at startup. We have
 * moved neutral or positive status to src/components/Status.tsx instead, which
 * users can access through /status.
 */
export function StatusNotices({ agentDefinitions }: Props = {}): React.ReactNode {
  useSettings();
  const context: StatusNoticeContext = {
    config: getGlobalConfig(),
    agentDefinitions,
    memoryFiles: use(getMemoryFiles()),
  };
  const activeNotices = getActiveNotices(context);
  const suppressPromos = Boolean(process.env.IS_DEMO) || isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE);
  const { warnings, slot, slotOverflowCount } = selectNoticesForDisplay(activeNotices, { suppressPromos });

  const hasWarnings = warnings.length > 0;
  const hasSlot = slot !== null;
  if (!hasWarnings && !hasSlot) {
    return null;
  }

  const showAccentBar = slot?.showAccentBar?.() ?? true;
  const slotIndent = showAccentBar ? SLOT_ACCENT_INDENT : SLOT_PLAIN_INDENT;
  const slotTier = slot?.tier ?? (slot?.type === 'warning' ? 'warning' : 'info');

  // densable 2.1.248 #34 / 2.1.289 ka — warnings column is flexDirection:"column"
  // with no outer paddingLeft; single announcement/info slot uses quote border.
  return (
    <OffscreenFreeze>
      <Box flexDirection="column">
        {warnings.map(notice => (
          <React.Fragment key={notice.id}>{notice.render(context)}</React.Fragment>
        ))}
        {slot !== null && (
          <Box flexDirection="column" marginTop={hasWarnings ? 1 : 0}>
            <Box
              flexDirection="column"
              paddingLeft={slotIndent}
              borderStyle={showAccentBar ? 'quote' : undefined}
              borderTop={false}
              borderBottom={false}
              borderRight={false}
              borderColor={slotTier === 'announcement' ? 'claude' : undefined}
              borderDimColor={slotTier !== 'announcement'}
            >
              {slot.render(context)}
            </Box>
            {slotOverflowCount > 0 && (
              <Box paddingLeft={SLOT_PLAIN_INDENT}>
                <Box>
                  <Text dimColor>
                    {slotOverflowCount} more {plural(slotOverflowCount, 'notice')} hidden
                  </Text>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </OffscreenFreeze>
  );
}
