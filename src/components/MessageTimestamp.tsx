import React from 'react';
import { Box, Text, stringWidth } from '@anthropic/ink';
import { isHumanLikeOrigin, isMetaVisibleOrigin } from '../utils/messages.js';

export type TimestampMessage = {
  type?: string;
  timestamp?: unknown;
  isCompactSummary?: boolean;
  message?: {
    content?: unknown;
  };
  attachment?: {
    type?: string;
    timestamp?: unknown;
    origin?: { kind?: string; senderTaskId?: string };
    commandMode?: string;
    isMeta?: boolean;
    prompt?: unknown;
    imagePasteIds?: unknown[];
  };
};

type Props = {
  message: TimestampMessage;
  isTranscriptMode: boolean;
  /** densable uko — AppState.showMessageTimestamps && tengu_silk_hinge */
  showMessageTimestamps?: boolean;
  /** densable d9t — split user continuation hides user stamps */
  isSplitUserContinuation?: boolean;
};

const SETTING_STAMP: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
};

/** densable Kkc — queued_command prefers attachment.timestamp */
export function messageTimestampValue(message: TimestampMessage): unknown {
  if (message.type === 'attachment' && message.attachment?.type === 'queued_command') {
    return message.attachment.timestamp ?? message.timestamp;
  }
  return message.timestamp;
}

/** densable jkc — silk_hinge setting uses full datetime + tz */
export function formatSettingMessageTimestamp(raw: string, timeZone?: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const opts = timeZone ? { ...SETTING_STAMP, timeZone } : SETTING_STAMP;
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
  const byType: Record<string, string> = {};
  for (const part of parts) byType[part.type] = part.value;
  const tz = byType.timeZoneName ? ` ${byType.timeZoneName}` : '';
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}${tz}`;
}

function queuedPromptText(prompt: unknown): string {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .map(block => (typeof block === 'string' ? block : ((block as { text?: string })?.text ?? '')))
      .join('');
  }
  return '';
}

/**
 * densable cko(message, isTranscriptMode, showMessageTimestamps, isSplitUserContinuation).
 */
export function shouldShowMessageTimestamp(
  message: TimestampMessage,
  isTranscriptMode: boolean,
  showMessageTimestamps = false,
  isSplitUserContinuation = false,
): boolean {
  if (!messageTimestampValue(message)) return false;

  if (message.type === 'attachment') {
    const att = message.attachment;
    if (!showMessageTimestamps || att?.type !== 'queued_command') return false;
    if (isMetaVisibleOrigin(att.origin)) return true;
    if (att.commandMode === undefined && att.isMeta) return false;
    if (
      att.commandMode === 'prompt' &&
      !(isMetaVisibleOrigin(att.origin) || (!att.isMeta && isHumanLikeOrigin(att.origin)))
    ) {
      return false;
    }
    const prompt = queuedPromptText(att.prompt).trim();
    return (att.imagePasteIds?.length ?? 0) > 0 || prompt.length > 0;
  }

  if (message.type === 'assistant') {
    const content = message.message?.content;
    const hasText = Array.isArray(content) && content.some(block => (block as { type?: string })?.type === 'text');
    return showMessageTimestamps || (isTranscriptMode && hasText);
  }

  if (message.type === 'user') {
    if (!showMessageTimestamps || message.isCompactSummary || isSplitUserContinuation) {
      return false;
    }
    const content = message.message?.content;
    if (typeof content === 'string') return content.trim().length > 0;
    if (!Array.isArray(content)) return false;
    const first = content[0] as { type?: string; text?: string } | undefined;
    if (first?.type === 'image') return true;
    if (first?.type !== 'text' || typeof first.text !== 'string') return false;
    return first.text.trim().length > 0;
  }

  return false;
}

export function MessageTimestamp({
  message,
  isTranscriptMode,
  showMessageTimestamps = false,
  isSplitUserContinuation = false,
}: Props): React.ReactNode {
  if (!shouldShowMessageTimestamp(message, isTranscriptMode, showMessageTimestamps, isSplitUserContinuation)) {
    return null;
  }

  const raw = String(messageTimestampValue(message) ?? '');
  const formattedTimestamp = showMessageTimestamps
    ? formatSettingMessageTimestamp(raw)
    : new Date(raw).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

  if (!formattedTimestamp) {
    return null;
  }

  return (
    <Box minWidth={stringWidth(formattedTimestamp)}>
      <Text dimColor>{formattedTimestamp}</Text>
    </Box>
  );
}
