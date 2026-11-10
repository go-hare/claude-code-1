import React, { useMemo } from 'react';
import stripAnsi from 'strip-ansi';
import { Box, Text, wrapAnsi } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { formatFileSize } from '../../utils/format.js';
import { countCharInString } from '../../utils/stringUtils.js';
import { MessageResponse } from '../MessageResponse.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { ShellTimeDisplay } from './ShellTimeDisplay.js';

const MAX_PROGRESS_LINES = 5;
const GUTTER_WIDTH = 5;

function clipShellProgressOutput(output: string, columns: number): { text: string; clipped: boolean; dropped: number } {
  const width = Math.max(1, columns - GUTTER_WIDTH);
  const lines = stripAnsi(output.trim())
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line);
  const kept: string[] = [];
  let usedRows = 0;
  let idx = lines.length;
  while (idx > 0 && usedRows < MAX_PROGRESS_LINES) {
    const line = lines[--idx]!;
    const wrapped = wrapAnsi(line, width, { hard: true, trim: false }).split('\n');
    const remainingRows = MAX_PROGRESS_LINES - usedRows;
    if (wrapped.length > remainingRows) {
      kept.unshift(wrapped.slice(-remainingRows).join('').replace(/^ /, ''));
      return { text: kept.join('\n'), clipped: true, dropped: idx };
    }
    kept.unshift(line);
    usedRows += wrapped.length;
  }
  return { text: kept.join('\n'), clipped: idx > 0, dropped: idx };
}

type Props = {
  output: string;
  fullOutput: string;
  elapsedTimeSeconds?: number;
  totalLines?: number;
  totalBytes?: number;
  timeoutMs?: number;
  taskId?: string;
  verbose: boolean;
};

export function ShellProgressMessage({
  output,
  fullOutput,
  elapsedTimeSeconds,
  totalLines,
  totalBytes,
  timeoutMs,
  verbose,
}: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  // Callers read these off a progress tick typed `any` (ShellProgress), so the
  // string contract above is unenforced at the call site.
  const safeOutput = output ?? '';
  const safeFullOutput = fullOutput ?? '';
  const clipped = useMemo(
    () => (verbose ? null : clipShellProgressOutput(safeOutput, columns)),
    [verbose, safeOutput, columns],
  );
  const displayLines = clipped ? clipped.text : stripAnsi(safeFullOutput.trim());

  // OffscreenFreeze: BashTool yields progress (elapsedTimeSeconds) every second.
  // If this line scrolls into scrollback, each tick forces a full terminal reset.
  // A foreground `sleep 600` on a 29-row terminal with 4000 rows of history
  // produced 507 resets over 10 minutes (go/ccshare/maxk-20260226-190348).
  if (!displayLines) {
    return (
      <MessageResponse>
        <OffscreenFreeze>
          <Text dimColor>Running… </Text>
          <ShellTimeDisplay elapsedTimeSeconds={elapsedTimeSeconds} timeoutMs={timeoutMs} />
        </OffscreenFreeze>
      </MessageResponse>
    );
  }

  // Not truncated: "+2 lines" (total exceeds displayed 5)
  // Truncated:     "~2000 lines" (extrapolated estimate from tail sample)
  const shownLines = clipped ? MAX_PROGRESS_LINES : countCharInString(safeFullOutput, '\n') + 1;
  const extraLines = (totalLines ? Math.max(0, totalLines - shownLines) : 0) + (clipped?.dropped ?? 0);
  let lineStatus = '';
  if (totalBytes && totalLines) {
    lineStatus = `~${totalLines} lines`;
  } else if (extraLines > 0) {
    lineStatus = `+${extraLines} lines`;
  }

  return (
    <MessageResponse>
      <OffscreenFreeze>
        <Box flexDirection="column">
          <Text dimColor>{displayLines}</Text>
          <Box flexDirection="row" gap={1}>
            {lineStatus ? <Text dimColor>{lineStatus}</Text> : null}
            <ShellTimeDisplay elapsedTimeSeconds={elapsedTimeSeconds} timeoutMs={timeoutMs} />
            {totalBytes ? <Text dimColor>{formatFileSize(totalBytes)}</Text> : null}
          </Box>
        </Box>
      </OffscreenFreeze>
    </MessageResponse>
  );
}
