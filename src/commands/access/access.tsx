import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from '@anthropic/ink';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { isClaudeAISubscriber } from '../../utils/auth.js';

export type MemberProgramLine = {
  text: string;
  variant: 'neutral' | 'muted' | 'warning';
  aside?: string;
};

export type MemberProgramSection = {
  name: string;
  lines: MemberProgramLine[];
};

export type ServedProgramsResult = MemberProgramSection[] | 'unavailable' | 'failed';

let programFetcherOverride: (() => Promise<ServedProgramsResult>) | null = null;

export function setMemberProgramsFetcherForTesting(fetcher: (() => Promise<ServedProgramsResult>) | null): void {
  programFetcherOverride = fetcher;
}

export async function fetchMemberPrograms(): Promise<ServedProgramsResult> {
  if (programFetcherOverride) {
    return programFetcherOverride();
  }
  if (!isClaudeAISubscriber() || getIsRemoteMode()) {
    return 'unavailable';
  }
  return [];
}

function AccessProgramsDialog({ onClose }: { onClose: () => void }): React.ReactNode {
  const [status, setStatus] = useState<'loading' | ServedProgramsResult>('loading');

  useEffect(() => {
    let cancelled = false;
    void fetchMemberPrograms()
      .catch((): ServedProgramsResult => 'failed')
      .then(result => {
        if (!cancelled) setStatus(result);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useInput((_input, key) => {
    if (key.escape || key.return) {
      onClose();
    }
  });

  const sections = Array.isArray(status) ? status : [];

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginY={1}>
      <Text bold>Your programs</Text>
      <Box flexDirection="column" marginTop={1}>
        {status === 'loading' && <Text dimColor>Checking your programs…</Text>}
        {status === 'failed' && <Text color="warning">Couldn&apos;t check your programs — try again later</Text>}
        {status === 'unavailable' && (
          <Box flexDirection="column">
            <Text>Your programs can&apos;t be shown in this session</Text>
            <Text dimColor>If you expected a program, ask your admin.</Text>
          </Box>
        )}
        {Array.isArray(status) && sections.length === 0 && (
          <Box flexDirection="column">
            <Text>No programs to show</Text>
            <Text dimColor>If you expected a program, ask your admin.</Text>
          </Box>
        )}
        {sections.map((section, idx) => (
          <Box key={`${section.name}-${idx}`} flexDirection="column" marginBottom={1}>
            <Text dimColor>{section.name}</Text>
            {section.lines.map((line, lIdx) => (
              <Text
                key={`${section.name}-${lIdx}`}
                color={line.variant === 'warning' ? 'warning' : undefined}
                dimColor={line.variant === 'muted'}
              >
                {line.text}
                {line.aside ? ` (${line.aside})` : ''}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Esc or Enter to close</Text>
      </Box>
    </Box>
  );
}

/**
 * Official 2.1.331 `chunk-bhe5b8pk.js` — `/access` modal dialog.
 */
export async function call(onDone: LocalJSXCommandOnDone, _context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <AccessProgramsDialog onClose={() => onDone(undefined, { display: 'skip' })} />;
}
