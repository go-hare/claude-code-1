import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { extractTag } from 'src/utils/messages.js';
import { CtrlOToExpand } from 'src/components/CtrlOToExpand.js';
import { FallbackToolUseErrorMessage } from 'src/components/FallbackToolUseErrorMessage.js';
import { FileEditToolUpdatedMessage } from 'src/components/FileEditToolUpdatedMessage.js';
import { FileEditToolUseRejectedMessage } from 'src/components/FileEditToolUseRejectedMessage.js';

import { HighlightedCode } from 'src/components/HighlightedCode.js';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { Box, Text, stringWidth, wrapText } from '@anthropic/ink';
import { FilePathLink } from 'src/components/FilePathLink.js';
import type { ToolProgressData } from 'src/Tool.js';
import type { ProgressMessage } from 'src/types/message.js';
import { getDisplayPath } from 'src/utils/file.js';
import { isAutoMemPath } from 'src/memdir/paths.js';
import { isScratchpadFile } from 'src/utils/permissions/filesystem.js';
import { getPlansDirectory } from 'src/utils/plans.js';
import { firstLineOf, plural } from 'src/utils/stringUtils.js';
import type { Output } from './FileWriteTool.js';

const MAX_LINES_TO_RENDER = 10;
// Model output uses \n regardless of platform, so always split on \n.
// os.EOL is \r\n on Windows, which would give numLines=1 for all files.
const EOL = '\n';

/**
 * Count visible lines in file content. A trailing newline is treated as a
 * line terminator (not a new empty line), matching editor line numbering.
 */
export function countLines(content: string): number {
  const parts = content.split(EOL);
  return content.endsWith(EOL) ? parts.length - 1 : parts.length;
}

/** densable Uo0 — wrap units including a trailing empty from a final NL. */
export function wrapCount(content: string, width: number): number {
  const w = Math.max(1, width);
  let n = 0;
  for (const line of content.split(EOL)) {
    const vis = stringWidth(line);
    n += vis === 0 ? 1 : Math.ceil(vis / w);
  }
  return n;
}

/** densable MYh — visible wrap rows (trailing NL is a terminator). */
export function wrapVisibleLines(content: string, width: number): number {
  const height = wrapCount(content, width);
  return content.endsWith(EOL) ? height - 1 : height;
}

/** densable f3r || m3r — collapse scratchpad and auto-memory writes. */
function isCollapsedWritePath(filePath: string): boolean {
  return isScratchpadFile(filePath) || isAutoMemPath(filePath);
}

function ReplacedUndiffedNotice(): React.ReactNode {
  return <Text dimColor> (previous content replaced, no diff shown)</Text>;
}

/** densable ae — large file overwrite that omitted structuredPatch and originalFile. */
function isUndiffedLargeOverwrite({ type, content, structuredPatch, originalFile }: Output): boolean {
  return (
    type === 'update' &&
    Array.isArray(structuredPatch) &&
    structuredPatch.length === 0 &&
    originalFile === null &&
    typeof content === 'string' &&
    content !== ''
  );
}

/**
 * SEA `glr` (@335793705) + `nto` (@314047816): compute visual row height per
 * source line in `preview` at `codeWidth`, then accumulate how many source
 * lines and characters fit within `MAX_LINES_TO_RENDER` visual rows.
 */
export function computePreviewHiddenMetrics(
  content: string,
  preview: string,
  codeWidth: number,
  verbose: boolean,
): { hiddenLines: number; hiddenChars: number | undefined } {
  const numLines = countLines(content);
  if (verbose) {
    return { hiddenLines: 0, hiddenChars: undefined };
  }
  const contentWithFallback = content || '(No content)';
  const rawLines = contentWithFallback.split(EOL, MAX_LINES_TO_RENDER);
  const previewLines = preview.split(EOL);
  const infiniteWidth = codeWidth <= 0 || !Number.isFinite(codeWidth);
  const lineHeights = previewLines.map(line => {
    if (infiniteWidth) return 1;
    const stripped = line.replace(/\r$/, '');
    if (stringWidth(stripped) <= codeWidth) return 1;
    const wrapped = wrapText(stripped, codeWidth, 'wrap');
    return Math.max(1, wrapped.split(EOL).length);
  });

  let remainingRows = MAX_LINES_TO_RENDER;
  let renderedSourceLines = 0;
  let renderedChars = 0;
  let truncatedMidLine = false;
  for (const [idx, lineHeight] of lineHeights.entries()) {
    const lineText = previewLines[idx] ?? '';
    if (remainingRows === 0) {
      break;
    }
    if (lineHeight > remainingRows || lineText !== rawLines[idx]) {
      renderedChars += Math.floor((lineText.length * Math.min(lineHeight, remainingRows)) / lineHeight);
      truncatedMidLine = true;
      break;
    }
    remainingRows -= lineHeight;
    renderedSourceLines++;
    renderedChars += lineText.length + EOL.length;
  }

  const trailingEmpty = renderedSourceLines === numLines - 1 && rawLines[renderedSourceLines] === '';
  const hiddenLines = numLines - renderedSourceLines - (trailingEmpty ? 1 : 0);
  const hiddenChars = truncatedMidLine ? Math.max(0, content.length - renderedChars) : undefined;
  return { hiddenLines, hiddenChars };
}

function FileWriteToolCreatedMessage({
  filePath,
  content,
  verbose,
  replacedUndiffedContent = false,
}: {
  filePath: string;
  content: string;
  verbose: boolean;
  replacedUndiffedContent?: boolean;
}): React.ReactNode {
  const { columns } = useTerminalSize();
  const contentWithFallback = content || '(No content)';
  const codeWidth = Math.max(1, columns - 12);
  const numLines = countLines(content);
  const preview = verbose
    ? contentWithFallback
    : contentWithFallback
        .split(EOL)
        .slice(0, MAX_LINES_TO_RENDER)
        .join(EOL)
        .slice(0, MAX_LINES_TO_RENDER * (codeWidth + 1));
  const { hiddenLines, hiddenChars } = computePreviewHiddenMetrics(content, preview, codeWidth, verbose);
  const kbHint =
    hiddenChars !== undefined && hiddenChars >= 1000 ? ` (~${Math.max(1, Math.round(hiddenChars / 1000))} KB)` : '';

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text>
          Wrote <Text bold>{numLines}</Text> {plural(numLines, 'line')} to{' '}
          <Text bold>
            <FilePathLink filePath={filePath}>{verbose ? filePath : getDisplayPath(filePath)}</FilePathLink>
          </Text>
          {replacedUndiffedContent && <ReplacedUndiffedNotice />}
        </Text>
        <Box
          flexDirection="column"
          overflowY={verbose ? undefined : 'hidden'}
          maxHeight={verbose ? undefined : MAX_LINES_TO_RENDER}
        >
          <Box flexDirection="column" flexShrink={0} width={verbose ? undefined : codeWidth}>
            <HighlightedCode code={preview} filePath={filePath} width={codeWidth} />
          </Box>
        </Box>
        {!verbose && hiddenLines > 0 && (
          <Text dimColor>
            … +{hiddenLines} {plural(hiddenLines, 'line')}
            {kbHint} <CtrlOToExpand />
          </Text>
        )}
      </Box>
    </MessageResponse>
  );
}

export function userFacingName(input: Partial<{ file_path: string; content: string }> | undefined): string {
  if (input?.file_path?.startsWith(getPlansDirectory())) {
    return 'Updated plan';
  }
  return 'Write';
}

/** densable rt — wrap-aware truncation for create or undiffed large overwrite. */
export function isResultTruncated(output: Output, options?: { columns?: number }): boolean {
  const { type, content } = output;
  if (type !== 'create' && !isUndiffedLargeOverwrite(output)) return false;
  if (typeof content !== 'string') return false;
  const columns = options?.columns;
  if (columns === undefined) {
    let pos = 0;
    for (let i = 0; i < MAX_LINES_TO_RENDER; i++) {
      pos = content.indexOf(EOL, pos);
      if (pos === -1) return false;
      pos++;
    }
    return pos < content.length;
  }
  const width = Math.max(1, columns - 12);
  const budget = content.endsWith(EOL) ? MAX_LINES_TO_RENDER + 1 : MAX_LINES_TO_RENDER;
  return wrapCount(content, width) > budget;
}

export function getToolUseSummary(input: Partial<{ file_path: string; content: string }> | undefined): string | null {
  if (!input?.file_path) {
    return null;
  }
  return getDisplayPath(input.file_path);
}

export function renderToolUseMessage(
  input: Partial<{ file_path: string; content: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!input.file_path) {
    return null;
  }
  // For plan files, path is already in userFacingName
  if (input.file_path.startsWith(getPlansDirectory())) {
    return '';
  }
  return (
    <FilePathLink filePath={input.file_path}>
      {verbose ? input.file_path : getDisplayPath(input.file_path)}
    </FilePathLink>
  );
}

// Official 2.1.327 (#409): show a short content preview directly without reading
// the existing file from disk or computing a full diff, avoiding UI freezes when
// rejecting a write to a very large file.
export function renderToolUseRejectedMessage(
  { file_path, content }: { file_path: string; content: string },
  { style, verbose }: { style?: 'condensed'; verbose: boolean },
): React.ReactNode {
  return (
    <FileEditToolUseRejectedMessage
      file_path={file_path}
      operation="write"
      content={content}
      firstLine={null}
      style={style}
      verbose={verbose}
    />
  );
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  { verbose, toolDenialKind }: { verbose: boolean; toolDenialKind?: string },
): React.ReactNode {
  if (
    !verbose &&
    toolDenialKind !== 'permission-rule' &&
    typeof result === 'string' &&
    extractTag(result, 'tool_use_error')
  ) {
    return (
      <MessageResponse>
        <Text color="error">Couldn&apos;t write file</Text>
      </MessageResponse>
    );
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}

const STAGED_SETTINGS_REVIEW_TEXT = 'Staged for your review · not applied until you accept it in /settings-review';

export function renderToolResultMessage(
  output: Output,
  progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { style, verbose }: { style?: 'condensed'; verbose: boolean },
): React.ReactNode {
  if ((output as { staged?: boolean }).staged && output.filePath) {
    return (
      <MessageResponse>
        <Text dimColor>{STAGED_SETTINGS_REVIEW_TEXT}</Text>
      </MessageResponse>
    );
  }
  return renderFileWriteResult(output, progressMessagesForMessage, { style, verbose });
}

function renderFileWriteResult(
  output: Output,
  progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  {
    style,
    verbose,
    replacedUndiffedContent = false,
  }: {
    style?: 'condensed';
    verbose: boolean;
    replacedUndiffedContent?: boolean;
  },
): React.ReactNode {
  const { filePath, content, structuredPatch, type, originalFile } = output;
  // Official densable: empty path → null before create/update branching.
  if (!filePath) {
    return null;
  }
  switch (type) {
    case 'create': {
      const isPlanFile = filePath.startsWith(getPlansDirectory());

      // Plan files: invert condensed behavior
      // - Regular mode: just show hint (user can type /plan to see full content)
      // - Condensed mode (subagent view): show full content
      if (isPlanFile && !verbose) {
        if (style !== 'condensed') {
          return (
            <MessageResponse>
              <Text dimColor>/plan to preview</Text>
            </MessageResponse>
          );
        }
      } else if (style === 'condensed' && !verbose) {
        // Official densable: "Wrote N line(s) to <FilePathLink>"
        const numLines = countLines(content);
        return (
          <Text>
            Wrote <Text bold>{numLines}</Text> {numLines === 1 ? 'line' : 'lines'} to{' '}
            <Text bold>
              <FilePathLink filePath={filePath}>{getDisplayPath(filePath)}</FilePathLink>
            </Text>
            {replacedUndiffedContent && <ReplacedUndiffedNotice />}
          </Text>
        );
      } else if (!verbose && isCollapsedWritePath(filePath)) {
        // Official densable: scratchpad / auto-mem creates keep line count + expand (no path).
        const numLines = countLines(content);
        return (
          <MessageResponse>
            <Text>
              Wrote <Text bold>{numLines}</Text> {plural(numLines, 'line')}
              {replacedUndiffedContent && <ReplacedUndiffedNotice />} <CtrlOToExpand />
            </Text>
          </MessageResponse>
        );
      }

      return (
        <FileWriteToolCreatedMessage
          filePath={filePath}
          content={content}
          verbose={verbose}
          replacedUndiffedContent={replacedUndiffedContent}
        />
      );
    }
    case 'update': {
      if (isUndiffedLargeOverwrite(output)) {
        return renderFileWriteResult({ ...output, type: 'create' }, progressMessagesForMessage, {
          style,
          verbose,
          replacedUndiffedContent: true,
        });
      }
      const isPlanFile = filePath.startsWith(getPlansDirectory());
      return (
        <FileEditToolUpdatedMessage
          filePath={filePath}
          structuredPatch={structuredPatch}
          // Official densable: firstLine from written content (Zd), not original.
          firstLine={firstLineOf(content)}
          fileContent={originalFile ?? undefined}
          style={style}
          verbose={verbose}
          previewHint={isPlanFile ? '/plan to preview' : undefined}
          // Official densable: collapse scratchpad / auto-mem (f3r || m3r).
          collapsed={!isPlanFile && isCollapsedWritePath(filePath)}
        />
      );
    }
  }
}
