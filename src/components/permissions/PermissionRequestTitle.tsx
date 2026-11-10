import * as React from 'react';
import { Box, stringWidth, Text } from '@anthropic/ink';
import { formatRequestSourceLabel, type PermissionRequestSource } from '../../dialog/permissionRequestSource.js';
import type { Theme } from '../../utils/theme.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';

export type PermissionTitleAside = {
  text: string;
  rowColumns: number;
};

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  workerBadge?: WorkerBadgeProps;
  requestSource?: PermissionRequestSource;
  srPrefix?: string;
  aside?: PermissionTitleAside;
};

export function PermissionRequestTitle({
  title,
  subtitle,
  color = 'permission',
  workerBadge,
  requestSource,
  srPrefix,
  aside,
}: Props): React.ReactNode {
  const sourceLabel = formatRequestSourceLabel(requestSource);
  const titleRow = (
    <Box flexDirection="row" gap={1}>
      <Text bold color={color} accessibility={srPrefix !== undefined ? { label: `${srPrefix} ${title}` } : undefined}>
        {title}
      </Text>
      {sourceLabel != null && (
        <Text>
          <Text dimColor>{'· '}</Text>
          {sourceLabel}
        </Text>
      )}
      {workerBadge && (
        <Text dimColor>
          {'· '}@{workerBadge.name}
        </Text>
      )}
    </Box>
  );
  const fitsAside =
    aside !== undefined &&
    stringWidth(title) +
      (sourceLabel == null ? 0 : 1 + stringWidth(`· ${sourceLabel}`)) +
      1 +
      stringWidth(aside.text) <=
      aside.rowColumns;
  const headerRow = fitsAside ? (
    <Box flexDirection="row" justifyContent="space-between" gap={1}>
      {titleRow}
      <Text dimColor>{aside.text}</Text>
    </Box>
  ) : (
    titleRow
  );
  return (
    <Box flexDirection="column" flexGrow={fitsAside ? 1 : undefined}>
      {headerRow}
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
