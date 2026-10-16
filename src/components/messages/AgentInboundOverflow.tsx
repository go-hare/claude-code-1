/**
 * densable 2.1.289 Wg — speaker-follow overflow chrome when ua !== null.
 * Never `export function Wg|ua|gh`.
 */
import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { agentMessageOverflow } from '../../utils/crossSessionMessage.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';

type HiddenLineCountProps = {
  count: number;
  hiddenChars?: number;
  expandable?: boolean;
};

function HiddenLineCount({ count, hiddenChars, expandable = false }: HiddenLineCountProps): React.ReactNode {
  if (count <= 0) return null;
  const unit = count === 1 ? 'line' : 'lines';
  const kb = hiddenChars !== undefined && hiddenChars >= 1000 ? ` (~${Math.round(hiddenChars / 1024)} KB)` : '';
  return (
    <Text dimColor>
      {count} {unit}
      {kb}
      {expandable ? (
        <>
          {' '}
          <CtrlOToExpand />
        </>
      ) : null}
    </Text>
  );
}

type Props = {
  body: string;
};

export function AgentInboundOverflow({ body }: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  const overflow = agentMessageOverflow(body, Math.max(1, columns));
  if (overflow === null) {
    return <Text wrap="wrap">{body}</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">{overflow.shown}</Text>
      <HiddenLineCount count={overflow.hiddenLines} hiddenChars={overflow.hiddenChars} expandable />
    </Box>
  );
}
