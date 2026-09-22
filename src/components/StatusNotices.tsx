import * as React from 'react';
import { use } from 'react';
import { Box } from '@anthropic/ink';
import type { AgentDefinitionsResult } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { getMemoryFiles } from '../utils/claudemd.js';
import { getGlobalConfig } from '../utils/config.js';
import { getActiveNotices, type StatusNoticeContext } from '../utils/statusNoticeDefinitions.js';

type Props = {
  agentDefinitions?: AgentDefinitionsResult;
};

/**
 * StatusNotices contains the information displayed to users at startup. We have
 * moved neutral or positive status to src/components/Status.tsx instead, which
 * users can access through /status.
 */
export function StatusNotices({ agentDefinitions }: Props = {}): React.ReactNode {
  const context: StatusNoticeContext = {
    config: getGlobalConfig(),
    agentDefinitions,
    memoryFiles: use(getMemoryFiles()),
  };
  const activeNotices = getActiveNotices(context);
  if (activeNotices.length === 0) {
    return null;
  }

  // densable 2.1.248 #34 Fr @201575834 sha=0fa3ee49235f4963 —
  // warnings column is flexDirection:"column" with no paddingLeft (247 Ds
  // @231859373 had paddingLeft:1, which sat one column right of transcript).
  return (
    <Box flexDirection="column">
      {activeNotices.map(notice => (
        <React.Fragment key={notice.id}>{notice.render(context)}</React.Fragment>
      ))}
    </Box>
  );
}
