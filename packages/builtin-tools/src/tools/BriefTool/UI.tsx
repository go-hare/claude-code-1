import figures from 'figures';
import { isAbsolute } from 'path';
import React from 'react';
import { FilePathLink } from 'src/components/FilePathLink.js';
import { Markdown } from 'src/components/Markdown.js';
import { BLACK_CIRCLE } from 'src/constants/figures.js';
import { Box, NoSelect, Text } from '@anthropic/ink';
import type { ProgressMessage } from 'src/types/message.js';
import { getDisplayPath } from 'src/utils/file.js';
import { formatFileSize } from 'src/utils/format.js';
import { formatBriefTimestamp } from 'src/utils/formatBriefTimestamp.js';
import { isUncPath } from 'src/utils/hooks/fileChangedWatcher.js';
import type { Output } from './BriefTool.js';

export function renderToolUseMessage(): React.ReactNode {
  return '';
}

export function renderToolResultMessage(
  output: Output,
  _progressMessages: ProgressMessage[],
  options?: {
    isTranscriptMode?: boolean;
    isBriefOnly?: boolean;
  },
): React.ReactNode {
  const hasAttachments = (output.attachments?.length ?? 0) > 0;
  if (!output.message && !hasAttachments) {
    return null;
  }

  // In transcript mode (ctrl+o), model text is NOT filtered — keep the ⏺ so
  // SendUserMessage is visually distinct from the surrounding text blocks.
  if (options?.isTranscriptMode) {
    return (
      <Box flexDirection="row" marginTop={1}>
        <Box minWidth={2}>
          <Text color="text">{BLACK_CIRCLE}</Text>
        </Box>
        <Box flexDirection="column">
          {output.message ? <Markdown>{output.message}</Markdown> : null}
          <AttachmentList attachments={output.attachments} />
        </Box>
      </Box>
    );
  }

  // Brief-only (chat) view: "Claude" label + 2-col indent, matching the "You"
  // label UserPromptMessage applies to user input (#20889). The "N in background"
  // spinner status lives in BriefSpinner (Spinner.tsx) — stateless label here.
  if (options?.isBriefOnly) {
    const ts = output.sentAt ? formatBriefTimestamp(output.sentAt) : '';
    return (
      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        <Box flexDirection="row">
          <Text color="briefLabelClaude">Claude</Text>
          {ts ? <Text dimColor> {ts}</Text> : null}
        </Box>
        <Box flexDirection="column">
          {output.message ? <Markdown>{output.message}</Markdown> : null}
          <AttachmentList attachments={output.attachments} />
        </Box>
      </Box>
    );
  }

  // densable oT default view: non-selectable ⏺ gutter + column.
  return (
    <Box flexDirection="row" marginTop={1}>
      <NoSelect fromLeftEdge minWidth={2}>
        <Text color="text">{BLACK_CIRCLE}</Text>
      </NoSelect>
      <Box flexDirection="column">
        {output.message ? <Markdown>{output.message}</Markdown> : null}
        <AttachmentList attachments={output.attachments} />
      </Box>
    </Box>
  );
}

type AttachmentListProps = {
  attachments: Output['attachments'];
};

export function AttachmentList({ attachments }: AttachmentListProps): React.ReactNode {
  if (!attachments || attachments.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      {attachments.map(att => {
        const extra = att as { pathValidated?: boolean; file_uuid?: string };
        const canLink = isAbsolute(att.path) && Boolean(extra.pathValidated) && !isUncPath(att.path);
        const display = getDisplayPath(att.path);
        return (
          <Box key={extra.file_uuid ?? att.path} flexDirection="row">
            <Text dimColor>
              {figures.pointerSmall} {att.isImage ? '[image]' : '[file]'}{' '}
            </Text>
            {canLink ? <FilePathLink filePath={att.path}>{display}</FilePathLink> : <Text>{display}</Text>}
            <Text dimColor> ({formatFileSize(att.size)})</Text>
          </Box>
        );
      })}
    </Box>
  );
}
