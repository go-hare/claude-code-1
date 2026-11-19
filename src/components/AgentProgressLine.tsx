import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { formatNumber } from '../utils/format.js';
import type { Theme } from '../utils/theme.js';

type Props = {
  agentType: string;
  description?: string;
  name?: string;
  descriptionColor?: keyof Theme;
  taskDescription?: string;
  toolUseCount: number;
  tokens: number | null;
  color?: keyof Theme;
  isLast: boolean;
  isResolved: boolean;
  isError: boolean;
  /** #111 (2.1.326): distinguish stopped ('killed') from failed vs completed. */
  status?: 'completed' | 'failed' | 'killed';
  isAsync?: boolean;
  shouldAnimate: boolean;
  lastToolInfo?: string | null;
  hideType?: boolean;
};

export function AgentProgressLine({
  agentType,
  description,
  name,
  descriptionColor,
  taskDescription,
  toolUseCount,
  tokens,
  color,
  isLast,
  isResolved,
  isError,
  status,
  isAsync = false,
  shouldAnimate: _shouldAnimate,
  lastToolInfo,
  hideType = false,
}: Props): React.ReactNode {
  const treeChar = isLast ? '└─' : '├─';
  const isBackgrounded = isAsync && isResolved;
  const isStoppedOrFailed = isResolved && !isBackgrounded && (isError || status === 'failed' || status === 'killed');

  // Determine the status text (#111: stopped/failed parallel agents never show "Done")
  const getStatusText = (): string => {
    if (!isResolved) {
      return lastToolInfo || 'Initializing…';
    }
    if (isBackgrounded) {
      return taskDescription ?? 'Running in the background';
    }
    if (status === 'killed') {
      return 'Stopped';
    }
    if (isError || status === 'failed') {
      return 'Failed';
    }
    return 'Done';
  };

  return (
    <Box flexDirection="column">
      <Box paddingLeft={3}>
        <Text dimColor>{treeChar} </Text>
        <Text dimColor={!isResolved}>
          {hideType ? (
            <>
              <Text bold>{name ?? description ?? agentType}</Text>
              {name && description && <Text dimColor>: {description}</Text>}
            </>
          ) : (
            <>
              <Text bold backgroundColor={color} color={color ? 'inverseText' : undefined}>
                {agentType}
              </Text>
              {description && (
                <>
                  {' ('}
                  <Text backgroundColor={descriptionColor} color={descriptionColor ? 'inverseText' : undefined}>
                    {description}
                  </Text>
                  {')'}
                </>
              )}
            </>
          )}
          {!isBackgrounded && (
            <>
              {' · '}
              {toolUseCount} tool {toolUseCount === 1 ? 'use' : 'uses'}
              {tokens !== null && <> · {formatNumber(tokens)} tokens</>}
            </>
          )}
        </Text>
      </Box>
      {!isBackgrounded && (
        <Box paddingLeft={3} flexDirection="row">
          <Text dimColor>{isLast ? '   ⎿  ' : '│  ⎿  '}</Text>
          <Text color={isStoppedOrFailed ? 'error' : undefined} dimColor={!isStoppedOrFailed}>
            {getStatusText()}
          </Text>
        </Box>
      )}
    </Box>
  );
}
