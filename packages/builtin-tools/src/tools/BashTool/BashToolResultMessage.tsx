import React from 'react';
import { CtrlOToExpand } from 'src/components/CtrlOToExpand.js';
import { removeSandboxViolationTags } from 'src/utils/sandbox/sandbox-ui-utils.js';
import { KeyboardShortcutHint } from '@anthropic/ink';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { OutputLine } from 'src/components/shell/OutputLine.js';
import { ShellTimeDisplay } from 'src/components/shell/ShellTimeDisplay.js';
import { StructuredDiffList } from 'src/components/StructuredDiff.js';
import { Box, Text } from '@anthropic/ink';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { count } from 'src/utils/array.js';
import { getDisplayPath } from 'src/utils/file.js';
import type { BashEditDiff, BashEditDiffHunk } from './bashEditDiff.js';
import type { Out as BashOut } from './BashTool.js';

type Props = {
  content: Omit<BashOut, 'interrupted'> & { bashEditDiff?: BashEditDiff };
  verbose: boolean;
  timeoutMs?: number;
  style?: 'condensed';
};

const MAX_BASH_DIFF_LINES = 40;
const CONCURRENT_COMMAND_NOTE =
  '(another command ran in this repository at the same time; a change made by either may show under either result)';
let firstExplainedDiff: BashEditDiff | null = null;

function formatFileCount(n: number): string {
  return `${n} ${n === 1 ? 'file' : 'files'}`;
}

function capBashDiffHunks(
  hunks: BashEditDiffHunk[],
  maxLines: number,
): { hunks: BashEditDiffHunk[]; hiddenLines: number } {
  const capped: BashEditDiffHunk[] = [];
  let used = 0;
  let hiddenLines = 0;
  for (const hunk of hunks) {
    const remaining = maxLines - used;
    if (remaining <= 0) {
      hiddenLines += hunk.lines.length;
    } else if (hunk.lines.length <= remaining) {
      capped.push(hunk);
      used += hunk.lines.length;
    } else {
      capped.push({ ...hunk, lines: hunk.lines.slice(0, remaining) });
      hiddenLines += hunk.lines.length - remaining;
      used = maxLines;
    }
  }
  return { hunks: capped, hiddenLines };
}

function BashEditDiffView({
  diff,
  verbose,
  style,
}: {
  diff: BashEditDiff;
  verbose: boolean;
  style?: 'condensed';
}): React.ReactNode {
  const { columns } = useTerminalSize();
  if (diff.skipped || ((diff.unavailable || diff.shared) && diff.files.length === 0)) {
    const message = diff.skipped
      ? '(file diff skipped for this git command)'
      : diff.unavailable
        ? diff.moreFiles > 0
          ? `(file diff unavailable for this command; ${formatFileCount(diff.moreFiles)} changed)`
          : '(file diff unavailable for this command)'
        : CONCURRENT_COMMAND_NOTE;
    return (
      <MessageResponse>
        <Text dimColor>{message}</Text>
      </MessageResponse>
    );
  }
  firstExplainedDiff ??= diff;
  const convenienceNote =
    firstExplainedDiff === diff
      ? '(what this command changed; a convenience view, not a review or audit of the command)'
      : null;
  const sharedNote = diff.shared ? CONCURRENT_COMMAND_NOTE : null;
  return (
    <Box flexDirection="column">
      {diff.files.map(file => {
        const allLines = file.hunks.flatMap(h => h.lines);
        const action = file.created ? 'Created' : file.deleted ? 'Deleted' : 'Updated';
        const { hunks, hiddenLines } = verbose
          ? { hunks: file.hunks, hiddenLines: 0 }
          : capBashDiffHunks(file.hunks, MAX_BASH_DIFF_LINES);
        const hideBody = style === 'condensed' && !verbose;
        return (
          <MessageResponse key={file.filePath}>
            <Box flexDirection="column">
              <Text>
                {action} <Text bold>{verbose ? file.filePath : getDisplayPath(file.filePath)}</Text>{' '}
                <Text dimColor>
                  (+{count(allLines, l => l.startsWith('+'))} -{count(allLines, l => l.startsWith('-'))})
                </Text>
              </Text>
              {hideBody ? null : (
                <StructuredDiffList
                  hunks={hunks}
                  dim={false}
                  width={columns - 12}
                  filePath={file.filePath}
                  firstLine={null}
                />
              )}
              {hiddenLines > 0 && !hideBody ? (
                <Text dimColor>
                  … {hiddenLines} more lines <CtrlOToExpand />
                </Text>
              ) : null}
            </Box>
          </MessageResponse>
        );
      })}
      {diff.moreFiles > 0 ? (
        <MessageResponse>
          <Text dimColor>
            {diff.files.length > 0
              ? `… ${diff.moreFiles} more ${diff.moreFiles === 1 ? 'file' : 'files'} changed`
              : `${formatFileCount(diff.moreFiles)} changed (binary, mode only or too large to show)`}
            {diff.unavailable ? ' (part of the diff is unavailable)' : ''}
          </Text>
        </MessageResponse>
      ) : null}
      {sharedNote ? (
        <MessageResponse>
          <Text dimColor>{sharedNote}</Text>
        </MessageResponse>
      ) : null}
      {convenienceNote ? (
        <MessageResponse>
          <Text dimColor>{convenienceNote}</Text>
        </MessageResponse>
      ) : null}
    </Box>
  );
}

// Pattern to match "Shell cwd was reset to <path>" message
// Use (?:^|\n) to match either start of string or after a newline
const SHELL_CWD_RESET_PATTERN = /(?:^|\n)(Shell cwd was reset to .+)$/;

/**
 * Extracts sandbox violations from stderr if present
 * Returns both the cleaned stderr and the violations content
 */
function extractSandboxViolations(stderr: string): {
  cleanedStderr: string;
} {
  const violationsMatch = stderr.match(/<sandbox_violations>([\s\S]*?)<\/sandbox_violations>/);

  if (!violationsMatch) {
    return { cleanedStderr: stderr };
  }

  // Remove the sandbox violations section from stderr
  const cleanedStderr = removeSandboxViolationTags(stderr).trim();

  return {
    cleanedStderr,
  };
}

/**
 * Extracts the "Shell cwd was reset" warning message from stderr
 * Returns the cleaned stderr and the warning message separately
 */
function extractCwdResetWarning(stderr: string): {
  cleanedStderr: string;
  cwdResetWarning: string | null;
} {
  const match = stderr.match(SHELL_CWD_RESET_PATTERN);
  if (!match) {
    return { cleanedStderr: stderr, cwdResetWarning: null };
  }

  // Extract the warning message from capture group 1
  const cwdResetWarning = match[1] ?? null;
  // Remove the warning from stderr (replace the full match)
  const cleanedStderr = stderr.replace(SHELL_CWD_RESET_PATTERN, '').trim();

  return { cleanedStderr, cwdResetWarning };
}

export default function BashToolResultMessage({
  content: {
    stdout = '',
    stderr: stdErrWithViolations = '',
    isImage,
    returnCodeInterpretation,
    noOutputExpected,
    backgroundTaskId,
    bashEditDiff,
  },
  verbose,
  timeoutMs,
  style,
}: Props): React.ReactNode {
  // Extract sandbox violations from stderr as it feels cleaner on the UI
  // We want the model to see the violations, so it can explain what went wrong, and the
  // user can access them in the violation logs
  const { cleanedStderr: stderrWithoutViolations } = extractSandboxViolations(stdErrWithViolations);

  // Extract "Shell cwd was reset" warning to render it with warning color instead of error
  const { cleanedStderr: stderr, cwdResetWarning } = extractCwdResetWarning(stderrWithoutViolations);

  // If this is an image, we don't want to truncate it in the UI
  if (isImage) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>[Image data detected and sent to Claude]</Text>
      </MessageResponse>
    );
  }

  return (
    <Box flexDirection="column">
      {stdout !== '' ? <OutputLine content={stdout} verbose={verbose} /> : null}
      {stderr.trim() !== '' ? <OutputLine content={stderr} verbose={verbose} isError /> : null}
      {cwdResetWarning ? (
        <MessageResponse>
          <Text dimColor>{cwdResetWarning}</Text>
        </MessageResponse>
      ) : null}
      {bashEditDiff ? <BashEditDiffView diff={bashEditDiff} verbose={verbose} style={style} /> : null}
      {stdout === '' && stderr.trim() === '' && !cwdResetWarning && !bashEditDiff ? (
        <MessageResponse height={1}>
          <Text dimColor>
            {backgroundTaskId ? (
              <>
                Running in the background <KeyboardShortcutHint shortcut="↓" action="manage" parens />
              </>
            ) : (
              returnCodeInterpretation || (noOutputExpected ? 'Done' : '(No output)')
            )}
          </Text>
        </MessageResponse>
      ) : null}
      {timeoutMs && (
        <MessageResponse>
          <ShellTimeDisplay timeoutMs={timeoutMs} />
        </MessageResponse>
      )}
    </Box>
  );
}
