import figures from 'figures';
import React from 'react';
import { stringWidth } from '../core/stringWidth.js';
import { Text } from '../index.js';

export type StatusIconStatus =
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'pending'
  | 'loading'
  | 'running'
  | 'on'
  | 'off';

type Status = StatusIconStatus;

type Props = {
  /**
   * The status to display. Determines both the icon and color.
   */
  status: Status;
  /**
   * Include a trailing space after the icon. Useful when followed by text.
   * @default false
   */
  withSpace?: boolean;
  /**
   * densable `Ze` `aria-label`. Overrides the status default (`current:`,
   * `on:`, …). Lives on the glyph, not the colored wrapper.
   */
  'aria-label'?: string;
};

const RUNNING_ICON = process.platform === 'darwin' ? '⏺' : '●';

const STATUS_CONFIG: Record<
  Status,
  {
    icon: string;
    color: 'success' | 'error' | 'warning' | 'suggestion' | undefined;
    ariaLabel: string;
  }
> = {
  success: { icon: figures.tick, color: 'success', ariaLabel: 'done:' },
  error: { icon: figures.cross, color: 'error', ariaLabel: 'failed:' },
  warning: { icon: figures.warning, color: 'warning', ariaLabel: 'warning:' },
  info: { icon: figures.info, color: 'suggestion', ariaLabel: 'note:' },
  pending: { icon: figures.circle, color: undefined, ariaLabel: 'pending:' },
  loading: { icon: '…', color: undefined, ariaLabel: 'loading:' },
  running: { icon: RUNNING_ICON, color: undefined, ariaLabel: 'running:' },
  on: { icon: figures.tick, color: 'success', ariaLabel: 'on:' },
  off: { icon: figures.circle, color: undefined, ariaLabel: 'off:' },
};

export function getStatusIconMaxWidth(): number {
  return Math.max(...Object.values(STATUS_CONFIG).map(c => stringWidth(c.icon)));
}

export function StatusIcon({ status, withSpace = false, 'aria-label': ariaLabel }: Props): React.ReactNode {
  const config = STATUS_CONFIG[status];
  const label = ariaLabel ?? config.ariaLabel;

  return (
    <Text color={config.color} dimColor={!config.color}>
      <Text aria-label={label}>{config.icon}</Text>
      {withSpace && ' '}
    </Text>
  );
}
