/**
 * UserCrossSessionMessage — render a message received from another Claude session
 * via UDS_INBOX (SendMessage tool).
 *
 * densable 2.1.247 xt: collapsed one-line `Message from @: ` preview;
 * Ctrl+O / transcript expands to the full body.
 */
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import * as React from 'react';
import { Box, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { extractTag } from '../../utils/messages.js';
import {
  formatPeerCollapseLabel,
  parseCrossSessionOpenAttrs,
  previewPeerMessageBody,
  resolveCrossSessionSenderLabel,
} from '../../utils/crossSessionMessage.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  isTranscriptMode?: boolean;
};

export function UserCrossSessionMessage({ param, addMargin, isTranscriptMode = false }: Props): React.ReactNode {
  const expandShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const text = param.text;
  const extracted = extractTag(text, 'cross-session-message');
  if (!extracted) {
    return null;
  }

  const attrs = parseCrossSessionOpenAttrs(text);
  const from = resolveCrossSessionSenderLabel({
    from: attrs.from,
    fromName: attrs.fromName,
  });
  const fallbackLabel = 'peer';
  const displayName = from || fallbackLabel;

  if (isTranscriptMode) {
    return (
      <Box flexDirection="row" marginTop={addMargin ? 1 : 0}>
        <Text dimColor>[{displayName}] </Text>
        <Text>{extracted}</Text>
      </Box>
    );
  }

  const preview = extracted ? previewPeerMessageBody(extracted) : '';
  const label = formatPeerCollapseLabel(1);

  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text dimColor>
        <Text aria-hidden>{figures.pointerSmall} </Text>
        {label}
        {' from @'}
        {displayName}
        {preview ? <Text italic>{`: ${preview}`}</Text> : null}{' '}
        <KeyboardShortcutHint shortcut={expandShortcut} action="expand" parens />
      </Text>
    </Box>
  );
}
