import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { formatRequestSourceLabel, type PermissionRequestSource } from '../../dialog/permissionRequestSource.js';
import type { Theme } from '../../utils/theme.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  workerBadge?: WorkerBadgeProps;
  requestSource?: PermissionRequestSource;
  srPrefix?: string;
};

export function PermissionRequestTitle({
  title,
  subtitle,
  color = 'permission',
  workerBadge,
  requestSource,
  srPrefix,
}: Props): React.ReactNode {
  const sourceLabel = formatRequestSourceLabel(requestSource);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold color={color} accessibility={srPrefix !== undefined ? { label: `${srPrefix} ${title}` } : undefined}>
          {title}
        </Text>
        {sourceLabel != null && (
          <Text dimColor>
            {'· '}
            {sourceLabel}
          </Text>
        )}
        {workerBadge && (
          <Text dimColor>
            {'· '}@{workerBadge.name}
          </Text>
        )}
      </Box>
      {subtitle != null &&
        (typeof subtitle === 'string' ? (
          <Text dimColor wrap="truncate-start">
            {subtitle}
          </Text>
        ) : (
          subtitle
        ))}
    </Box>
  );
}
