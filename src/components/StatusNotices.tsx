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
  /** Official 2.1.326 #6: when Ctrl+O transcript/verbose view is open, expand all hidden startup notices. */
  showAllNotices?: boolean;
};

const SLOT_ACCENT_INDENT = 1;
const SLOT_PLAIN_INDENT = 2;

/**
 * StatusNotices contains the information displayed to users at startup. We have
 * moved neutral or positive status to src/components/Status.tsx instead, which
 * users can access through /status.
 */
export function StatusNotices({ agentDefinitions, showAllNotices = false }: Props = {}): React.ReactNode {
  useSettings();
  const context: StatusNoticeContext = {
    config: getGlobalConfig(),
    agentDefinitions,
    memoryFiles: use(getMemoryFiles()),
  };
  const activeNotices = getActiveNotices(context);
  const suppressPromos = Boolean(process.env.IS_DEMO) || isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE);
  const { warnings, slot, slotOverflowCount } = selectNoticesForDisplay(activeNotices, { suppressPromos });
  const hiddenSlotNotices =
    showAllNotices && slot !== null && slotOverflowCount > 0
      ? activeNotices.filter(n => !warnings.includes(n) && n !== slot && (!suppressPromos || n.type === 'warning'))
      : [];

  const hasWarnings = warnings.length > 0;
  const hasSlot = slot !== null;
  if (!hasWarnings && !hasSlot) {
    return null;
  }

  const showAccentBar = slot?.showAccentBar?.() ?? true;
  const slotIndent = showAccentBar ? SLOT_ACCENT_INDENT : SLOT_PLAIN_INDENT;
  const slotTier = slot?.tier ?? (slot?.type === 'warning' ? 'warning' : 'info');

  // densable 2.1.248 #34 / 2.1.289 ka + 2.1.326 #6 — warnings column is flexDirection:"column"
  // with no outer paddingLeft; single announcement/info slot uses quote border;
  // Ctrl+O (`showAllNotices`) expands hidden startup notices.
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
            {showAllNotices && hiddenSlotNotices.length > 0 ? (
              hiddenSlotNotices.map(notice => (
                <Box key={notice.id} flexDirection="column" marginTop={1} paddingLeft={SLOT_PLAIN_INDENT}>
                  {notice.render(context)}
                </Box>
              ))
            ) : slotOverflowCount > 0 ? (
              <Box paddingLeft={SLOT_PLAIN_INDENT}>
                <Box>
                  <Text dimColor>
                    {slotOverflowCount} more {plural(slotOverflowCount, 'notice')} hidden · ctrl+o to show
                  </Text>
                </Box>
              </Box>
            ) : null}
          </Box>
        )}
      </Box>
    </OffscreenFreeze>
  );
}
