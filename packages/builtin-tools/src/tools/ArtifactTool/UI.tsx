import * as React from 'react';
import { Box, Link, Text } from '@anthropic/ink';
import type { ToolProgressData } from 'src/Tool.js';
import type { ProgressMessage } from 'src/types/message.js';
import { formatArtifactWatchStatus } from 'src/services/artifactAutoReact/watchActions.js';
import type { ArtifactOutput } from './ArtifactTool.js';

export function renderToolResultMessage(
  content: ArtifactOutput,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  _options: { verbose: boolean; theme?: string },
): React.ReactNode {
  if (content.error) {
    return (
      <Box>
        <Text color="error">⚠ Artifact upload failed: {content.error}</Text>
      </Box>
    );
  }
  if (content.replied === true) {
    return (
      <Box>
        <Text color="success">✓</Text>
        <Text>
          {' '}
          Reply posted
          {content.thread_id ? ` on thread ${content.thread_id}` : ''}
          {content.comment_id ? ` (${content.comment_id})` : ''}
        </Text>
      </Box>
    );
  }
  if (content.published === true) {
    return (
      <Box>
        <Text color="success">✓</Text>
        <Text>
          {' '}
          Live-edit published
          {content.ver ? ` (ver ${content.ver})` : ''}
        </Text>
      </Box>
    );
  }
  if (content.artifacts) {
    return (
      <Box>
        <Text>Listed {content.artifacts.length} artifact(s)</Text>
      </Box>
    );
  }
  if (content.threads) {
    return (
      <Box>
        <Text>Read {content.threads.length} comment thread(s)</Text>
      </Box>
    );
  }
  if (content.thread_resolved === true) {
    return (
      <Box>
        <Text color="success">✓</Text>
        <Text> Resolved thread {content.thread_id ?? ''}</Text>
      </Box>
    );
  }
  if (content.thread_resolved === false) {
    return (
      <Box>
        <Text>{JSON.stringify(content)}</Text>
      </Box>
    );
  }
  if (content.read) {
    return (
      <Box>
        <Text>{content.read.result.slice(0, 4000)}</Text>
      </Box>
    );
  }
  if (content.watch || content.unwatch || content.watches) {
    return (
      <Box>
        <Text>
          {content.watches
            ? formatArtifactWatchStatus({
                watches: content.watches as Parameters<typeof formatArtifactWatchStatus>[0]['watches'],
                ...(content.filter_url !== undefined ? { filter_url: content.filter_url } : {}),
              })
            : JSON.stringify(content.watch ?? content.unwatch)}
        </Text>
      </Box>
    );
  }
  if (
    content.asset_list ||
    content.asset_upload ||
    content.asset_delete ||
    content.file_list ||
    content.file_read ||
    content.asset_read ||
    content.verify ||
    content.page_data ||
    content.artifact_delete ||
    content.room_send
  ) {
    return (
      <Box>
        <Text>{JSON.stringify(content)}</Text>
      </Box>
    );
  }
  if (!content.url) return null;
  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          <Text color="success">↑</Text> Artifact uploaded:{' '}
          <Link url={content.url}>
            <Text color="warning">{content.url}</Text>
          </Link>
        </Text>
      </Box>
      {content.expiresAt ? (
        <Box>
          <Text dimColor>expires: {content.expiresAt}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
