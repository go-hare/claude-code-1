import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import type { StructuredPatchHunk } from 'diff';
import { isAbsolute, relative, resolve } from 'path';
import * as React from 'react';
import { Suspense, use, useState } from 'react';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { extractTag } from 'src/utils/messages.js';
import { CtrlOToExpand } from 'src/components/CtrlOToExpand.js';
import { FallbackToolUseErrorMessage } from 'src/components/FallbackToolUseErrorMessage.js';
import { FileEditToolUpdatedMessage } from 'src/components/FileEditToolUpdatedMessage.js';
import { FileEditToolUseRejectedMessage } from 'src/components/FileEditToolUseRejectedMessage.js';

import { HighlightedCode } from 'src/components/HighlightedCode.js';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { Box, Text, stringWidth } from '@anthropic/ink';
import { FilePathLink } from 'src/components/FilePathLink.js';
import type { ToolProgressData } from 'src/Tool.js';
import type { ProgressMessage } from 'src/types/message.js';
import { getCwd } from 'src/utils/cwd.js';
import { getPatchForDisplay } from 'src/utils/diff.js';
import { getDisplayPath } from 'src/utils/file.js';
import { logError } from 'src/utils/log.js';
import { isAutoMemPath } from 'src/memdir/paths.js';
import { isScratchpadFile } from 'src/utils/permissions/filesystem.js';
import { getPlansDirectory } from 'src/utils/plans.js';
import { openForScan, readCapped } from 'src/utils/readEditContext.js';
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

function FileWriteToolCreatedMessage({
  filePath,
  content,
  verbose,
}: {
  filePath: string;
  content: string;
  verbose: boolean;
}): React.ReactNode {
  const { columns } = useTerminalSize();
  const contentWithFallback = content || '(No content)';
  const codeWidth = Math.max(1, columns - 12);
  const numLines = countLines(content);
  const plusLines = verbose ? 0 : wrapVisibleLines(contentWithFallback, codeWidth) - MAX_LINES_TO_RENDER;
  const preview = verbose
    ? contentWithFallback
    : contentWithFallback
        .split(EOL)
        .slice(0, MAX_LINES_TO_RENDER)
        .join(EOL)
        .slice(0, MAX_LINES_TO_RENDER * (codeWidth + 1));

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text>
          Wrote <Text bold>{numLines}</Text> {plural(numLines, 'line')} to{' '}
          <Text bold>{verbose ? filePath : relative(getCwd(), filePath)}</Text>
        </Text>
        <Box
          flexDirection="column"
          overflowY={verbose ? undefined : 'hidden'}
          maxHeight={verbose ? undefined : MAX_LINES_TO_RENDER}
        >
          <HighlightedCode code={preview} filePath={filePath} width={codeWidth} />
        </Box>
        {!verbose && plusLines > 0 && (
          <Text dimColor>
            … +{plusLines} {plural(plusLines, 'line')} {numLines > 0 && <CtrlOToExpand />}
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

/** densable Yo0 — wrap-aware create truncation. `update` is never truncated. */
export function isResultTruncated({ type, content }: Output, options?: { columns?: number }): boolean {
  if (type !== 'create') return false;
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

export function renderToolUseRejectedMessage(
  { file_path, content }: { file_path: string; content: string },
  { style, verbose }: { style?: 'condensed'; verbose: boolean },
): React.ReactNode {
  return <WriteRejectionDiff filePath={file_path} content={content} style={style} verbose={verbose} />;
}

type RejectionDiffData =
  | { type: 'create' }
  | { type: 'update'; patch: StructuredPatchHunk[]; oldContent: string }
  | { type: 'error' };

function WriteRejectionDiff({
  filePath,
  content,
  style,
  verbose,
}: {
  filePath: string;
  content: string;
  style?: 'condensed';
  verbose: boolean;
}): React.ReactNode {
  const [dataPromise] = useState(() => loadRejectionDiff(filePath, content));
  const firstLine = content.split('\n')[0] ?? null;
  const createFallback = (
    <FileEditToolUseRejectedMessage
      file_path={filePath}
      operation="write"
      content={content}
      firstLine={firstLine}
      verbose={verbose}
    />
  );
  return (
    <Suspense fallback={createFallback}>
      <WriteRejectionBody
        promise={dataPromise}
        filePath={filePath}
        firstLine={firstLine}
        createFallback={createFallback}
        style={style}
        verbose={verbose}
      />
    </Suspense>
  );
}

function WriteRejectionBody({
  promise,
  filePath,
  firstLine,
  createFallback,
  style,
  verbose,
}: {
  promise: Promise<RejectionDiffData>;
  filePath: string;
  firstLine: string | null;
  createFallback: React.ReactNode;
  style?: 'condensed';
  verbose: boolean;
}): React.ReactNode {
  const data = use(promise);
  if (data.type === 'create') return createFallback;
  if (data.type === 'error') {
    return (
      <MessageResponse>
        <Text>(No changes)</Text>
      </MessageResponse>
    );
  }
  return (
    <FileEditToolUseRejectedMessage
      file_path={filePath}
      operation="update"
      patch={data.patch}
      firstLine={firstLine}
      fileContent={data.oldContent}
      style={style}
      verbose={verbose}
    />
  );
}

async function loadRejectionDiff(filePath: string, content: string): Promise<RejectionDiffData> {
  try {
    const fullFilePath = isAbsolute(filePath) ? filePath : resolve(getCwd(), filePath);
    const handle = await openForScan(fullFilePath);
    if (handle === null) return { type: 'create' };
    let oldContent: string | null;
    try {
      oldContent = await readCapped(handle);
    } finally {
      await handle.close();
    }
    // File exceeds MAX_SCAN_BYTES — fall back to the create view rather than
    // OOMing on a diff of a multi-GB file.
    if (oldContent === null) return { type: 'create' };
    const patch = getPatchForDisplay({
      filePath,
      fileContents: oldContent,
      edits: [{ old_string: oldContent, new_string: content, replace_all: false }],
    });
    return { type: 'update', patch, oldContent };
  } catch (e) {
    // User may have manually applied the change while the diff was shown.
    logError(e as Error);
    return { type: 'error' };
  }
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    return (
      <MessageResponse>
        <Text color="error">Error writing file</Text>
      </MessageResponse>
    );
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}

export function renderToolResultMessage(
  { filePath, content, structuredPatch, type, originalFile }: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { style, verbose }: { style?: 'condensed'; verbose: boolean },
): React.ReactNode {
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
        // Official densable: "Wrote N line(s) to <relpath>"
        const numLines = countLines(content);
        return (
          <Text>
            Wrote <Text bold>{numLines}</Text> {numLines === 1 ? 'line' : 'lines'} to{' '}
            <Text bold>{relative(getCwd(), filePath)}</Text>
          </Text>
        );
      } else if (!verbose && isCollapsedWritePath(filePath)) {
        // Official densable: scratchpad / auto-mem creates keep line count + expand (no path).
        const numLines = countLines(content);
        return (
          <MessageResponse>
            <Text>
              Wrote <Text bold>{numLines}</Text> {plural(numLines, 'line')} <CtrlOToExpand />
            </Text>
          </MessageResponse>
        );
      }

      return <FileWriteToolCreatedMessage filePath={filePath} content={content} verbose={verbose} />;
    }
    case 'update': {
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
