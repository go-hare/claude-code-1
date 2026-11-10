import React from 'react';
import { Box, Text, stringWidth } from '@anthropic/ink';
import { NO_CONTENT_MESSAGE } from '../constants/messages.js';
import {
  BASH_INPUT_TAG,
  BASH_STDERR_TAG,
  BASH_STDOUT_TAG,
  CHANNEL_TAG,
  COMMAND_MESSAGE_TAG,
  CROSS_SESSION_MESSAGE_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  SUMMARY_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
  TICK_TAG,
  TOOL_USE_ID_TAG,
} from '../constants/xml.js';
import {
  extractTag,
  isHumanLikeOrigin,
  isInSessionPeerOrObserverOrigin,
  isMetaVisibleOrigin,
} from '../utils/messages.js';
import { formatClockTime, formatFullTimestamp } from '../utils/timeFormat.js';

export type TimestampMessage = {
  type?: string;
  timestamp?: unknown;
  isCompactSummary?: boolean;
  planContent?: unknown;
  origin?: { kind?: string; senderTaskId?: unknown };
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

/** densable Kkc — queued_command prefers attachment.timestamp */
export function messageTimestampValue(message: TimestampMessage): unknown {
  if (message.type === 'attachment' && message.attachment?.type === 'queued_command') {
    return message.attachment.timestamp ?? message.timestamp;
  }
  return message.timestamp;
}

/** densable jkc — silk_hinge setting uses full datetime via timeFormat/timeZone. */
export function formatSettingMessageTimestamp(raw: string, timeZone?: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return formatFullTimestamp(date, timeZone);
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

const RESOURCE_UPDATE_RE =
  /<mcp-resource-update\s+server="([^"]+)"\s+uri="([^"]+)"[^>]*>(?:[\s\S]*?<reason>([^<]+)<\/reason>)?/;
const POLLING_UPDATE_RE =
  /<mcp-polling-update\s+type="([^"]+)"\s+server="([^"]+)"\s+tool="([^"]+)"[^>]*>(?:[\s\S]*?<reason>([^<]+)<\/reason>)?/;

function isDetachedToolCallNotification(text: string): boolean {
  const prefix = `<${TASK_NOTIFICATION_TAG}>\n<${TOOL_USE_ID_TAG}>`;
  if (!text.startsWith(prefix)) return false;
  const closeIdx = text.indexOf(`</${TOOL_USE_ID_TAG}>\n`, prefix.length);
  if (
    closeIdx === -1 ||
    !text.startsWith(`<${TASK_TYPE_TAG}>tool_call</${TASK_TYPE_TAG}>\n`, closeIdx + `</${TOOL_USE_ID_TAG}>\n`.length)
  ) {
    return false;
  }
  return true;
}

/** densable wDe — synthetic/empty XML user text that renders nothing. */
function isHiddenUserTextContent(text: string): boolean {
  if (!text || text.trim() === NO_CONTENT_MESSAGE) return true;
  const channelPrefix = `<${CHANNEL_TAG} source="`;
  if (
    text.startsWith(channelPrefix) ||
    (text.startsWith('A message arrived from ') && text.startsWith(channelPrefix, text.indexOf('\n') + 1))
  ) {
    return false;
  }
  if (text.startsWith('<wake reason="external-event"')) return false;
  if (text.startsWith(`<${CROSS_SESSION_MESSAGE_TAG}`)) return false;
  if (extractTag(text, TICK_TAG) !== null) return true;
  if (text.includes(`<${LOCAL_COMMAND_CAVEAT_TAG}>`)) return true;
  if (text.startsWith(`<${LOCAL_COMMAND_STDOUT_TAG}`) || text.startsWith(`<${LOCAL_COMMAND_STDERR_TAG}`)) {
    const stdout = extractTag(text, LOCAL_COMMAND_STDOUT_TAG)?.trim();
    const stderr = extractTag(text, LOCAL_COMMAND_STDERR_TAG)?.trim();
    return !((stdout && stdout !== NO_CONTENT_MESSAGE) || stderr);
  }
  if (text.startsWith(`<${BASH_STDOUT_TAG}`) || text.startsWith(`<${BASH_STDERR_TAG}`)) {
    return false;
  }
  if (text.includes(`<${BASH_INPUT_TAG}>`)) {
    return !extractTag(text, BASH_INPUT_TAG);
  }
  if (text.includes(`<${COMMAND_MESSAGE_TAG}>`)) {
    return !extractTag(text, COMMAND_MESSAGE_TAG);
  }
  if (text.includes('<user-memory-input>')) {
    return !extractTag(text, 'user-memory-input');
  }
  if (text.includes(`<${TASK_NOTIFICATION_TAG}`)) {
    return (
      !extractTag(text, SUMMARY_TAG) ||
      text.startsWith(`<${TASK_NOTIFICATION_TAG}>\n<${TASK_TYPE_TAG}>artifact-room-view</${TASK_TYPE_TAG}>\n`) ||
      isDetachedToolCallNotification(text)
    );
  }
  if (text.includes('<mcp-resource-update') || text.includes('<mcp-polling-update')) {
    return !RESOURCE_UPDATE_RE.test(text) && !POLLING_UPDATE_RE.test(text);
  }
  return false;
}

/** densable Qpo */
function isHiddenUserMessage(message: TimestampMessage, text: string): boolean {
  if (!text || text.trim() === NO_CONTENT_MESSAGE) return true;
  if (message.planContent) return false;
  if (isInSessionPeerOrObserverOrigin(message.origin)) return false;
  return isHiddenUserTextContent(text);
}

/**
 * densable _s(message, isTranscriptMode, showMessageTimestamps, isSplitUserContinuation).
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
    if (isInSessionPeerOrObserverOrigin(att.origin)) return true;
    if (att.commandMode === undefined && att.isMeta) return false;
    if (
      att.commandMode === 'prompt' &&
      !(isMetaVisibleOrigin(att.origin) || (!att.isMeta && isHumanLikeOrigin(att.origin)))
    ) {
      return false;
    }
    const prompt = queuedPromptText(att.prompt).trim();
    return (att.imagePasteIds?.length ?? 0) > 0 || !isHiddenUserTextContent(prompt);
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
    if (typeof content === 'string') return !isHiddenUserMessage(message, content);
    if (!Array.isArray(content)) return false;
    const first = content[0] as { type?: string; text?: string } | undefined;
    if (first?.type === 'image') return true;
    if (first?.type !== 'text' || typeof first.text !== 'string') return false;
    return !isHiddenUserMessage(message, first.text);
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
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const formattedTimestamp = showMessageTimestamps ? formatSettingMessageTimestamp(raw) : formatClockTime(date);

  if (!formattedTimestamp) {
    return null;
  }

  return (
    <Box minWidth={stringWidth(formattedTimestamp)}>
      <Text dimColor>{formattedTimestamp}</Text>
    </Box>
  );
}
