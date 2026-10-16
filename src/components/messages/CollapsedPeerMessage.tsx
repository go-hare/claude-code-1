/**
 * densable 2.1.289 zX — collapsed inbound row:
 * `> Message from @name (ctrl+o to expand)`
 *
 * Agent Fg collapsed path omits body (no preview). UDS/teammate may pass body.
 * Never `export function zX`.
 */
import figures from 'figures';
import * as React from 'react';
import { Box, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import {
  formatPeerCollapseLabel,
  previewPeerMessageBody,
  sanitizeCrossSessionDisplayName,
} from '../../utils/crossSessionMessage.js';

type Props = {
  displayName?: string;
  /** densable zX qualifier — teammate unverified suffix. */
  qualifier?: string;
  count?: number;
  addMargin?: boolean;
  fallbackLabel?: string;
  /** densable zX body — first-line italic preview when set. */
  body?: string;
};

export function CollapsedPeerMessage({
  displayName,
  qualifier,
  count = 1,
  addMargin = true,
  fallbackLabel = 'peer',
  body,
}: Props): React.ReactNode {
  const expandShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const name = sanitizeCrossSessionDisplayName(displayName || '') || fallbackLabel;
  const label = formatPeerCollapseLabel(count);
  const suffix = qualifier ? ` (${qualifier})` : '';
  const preview = body ? previewPeerMessageBody(body) : '';

  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text dimColor>
        <Text aria-hidden>{figures.pointerSmall} </Text>
        {label}
        {' from @'}
        {name}
        {suffix}
        {preview ? <Text italic>{`: ${preview}`}</Text> : null}{' '}
        <KeyboardShortcutHint shortcut={expandShortcut} action="expand" parens />
      </Text>
    </Box>
  );
}
