/**
 * densable `jCe` / `We` — DualInk transcript-v2 compact line.
 * Gold `MMn()` is hardcoded false in 2.1.289, so this paints only if that gate
 * is flipped. Monitor `vp` still calls it when `transcriptV2Rows`.
 */
import * as React from 'react';
import { Box, Text } from '@anthropic/ink';

export type TranscriptV2RowModel = {
  tone: 'dim' | 'red' | 'gold';
  text: string;
  detail?: string;
  subLines?: string[];
};

/** densable `MMn` — 2.1.289 gold `return !1`. */
export function isTranscriptV2RowsEnabled(): boolean {
  return false;
}

export function TranscriptV2Row({
  row,
  addMargin,
}: {
  row: TranscriptV2RowModel;
  addMargin: boolean;
}): React.ReactNode {
  const color = row.tone === 'red' ? 'error' : row.tone === 'gold' ? 'warning' : undefined;
  const dim = row.tone === 'dim';
  const aria = row.tone === 'red' ? 'error:' : row.tone === 'gold' ? 'warning:' : undefined;
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0}>
      <Text aria-hidden={dim} aria-label={aria} italic color={color} dimColor={dim}>
        {'· '}
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        <Text italic color={color} dimColor={dim}>
          {row.text}
          {row.detail !== undefined ? (
            <Text dimColor>
              {' · '}
              {row.detail}
            </Text>
          ) : null}
        </Text>
        {row.subLines?.map((line, index) => (
          <Text key={index} dimColor>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
