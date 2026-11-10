import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import stripAnsi from 'strip-ansi';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, stringWidth, Text, type TextProps } from '@anthropic/ink';
import { formatDuration, formatNumber, truncateToWidth } from '../../utils/format.js';
import { extractTag } from '../../utils/messages.js';
import { jsonParse } from '../../utils/slowOperations.js';
import { unescapeXmlEntities } from '../../utils/xml.js';
import { PluginUserMessageSite, type PluginUserMessageOrigin } from '../PluginRasterPanes.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  taskDelivery?: unknown;
  messageId?: string;
  origin?: PluginUserMessageOrigin;
  verbose?: boolean;
  isExpanded?: boolean;
};

type MonitorEvent = {
  description: string;
  headline: string;
  body: string;
};

const MONITOR_EVENT_LABEL = 'Monitor event:';
const MONITOR_SUMMARY_PREFIX = `${MONITOR_EVENT_LABEL} "`;
const EVENT_TAG = 'event';
const MAX_HEADLINE_CHARS = 500;
const MAX_BODY_CHARS = 4000;
const MIN_DESC_COLS = 12;
const DOT_SEP = ' · ';
const GUTTER_COLS = 2;

function getStatusColor(status: string | null): TextProps['color'] {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'killed':
      return 'warning';
    default:
      return 'text';
  }
}

function extractSingleTaskNotification(text: string, origin?: PluginUserMessageOrigin): string | null {
  if (origin && origin.kind !== 'task-notification') return null;
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(`<${TASK_NOTIFICATION_TAG}`)) return null;
  const closeTag = `</${TASK_NOTIFICATION_TAG}>`;
  const idx = trimmed.indexOf(closeTag);
  if (idx === -1) return null;
  const block = trimmed.slice(0, idx + closeTag.length);
  return trimmed.slice(block.length).trim() === '' ? block : null;
}

function collapseOneLine(text: string, maxChars: number): string {
  return text.slice(0, maxChars).replace(/\s+/g, ' ').trim();
}

function parseMonitorEvent(text: string, origin?: PluginUserMessageOrigin): MonitorEvent | null {
  const block = extractSingleTaskNotification(text, origin);
  const rawSummary = block === null ? null : extractTag(block, SUMMARY_TAG);
  if (block === null || rawSummary === null || rawSummary.includes('<')) return null;
  const summary = unescapeXmlEntities(rawSummary);
  if (
    !summary.startsWith(MONITOR_SUMMARY_PREFIX) ||
    !summary.endsWith('"') ||
    summary.length <= MONITOR_SUMMARY_PREFIX.length
  ) {
    return null;
  }
  const rawEvent = extractTag(block, EVENT_TAG);
  if (rawEvent === null || rawEvent.includes('<')) return null;
  const cleaned = stripAnsi(unescapeXmlEntities(rawEvent)).trim();
  let headline = '';
  for (const line of cleaned.split('\n')) {
    headline = collapseOneLine(line, MAX_HEADLINE_CHARS);
    if (headline !== '') break;
  }
  if (headline === '') return null;
  return {
    description: collapseOneLine(summary.slice(MONITOR_SUMMARY_PREFIX.length, -1), MAX_HEADLINE_CHARS),
    headline,
    body: cleaned.slice(0, MAX_BODY_CHARS),
  };
}

function fitMonitorEventRow(
  { headline, description }: MonitorEvent,
  availCols: number,
): { headline: string; description: string | null } {
  const budget = Math.max(1, availCols - stringWidth(MONITOR_EVENT_LABEL) - 1);
  const fittedHeadline = truncateToWidth(headline, budget);
  const rem = budget - stringWidth(fittedHeadline) - stringWidth(DOT_SEP);
  return {
    headline: fittedHeadline,
    description: description !== '' && rem >= MIN_DESC_COLS ? truncateToWidth(description, rem) : null,
  };
}

function extractTaskDeliveryOutput(taskDelivery: unknown): string {
  if (!taskDelivery) return '';
  let parsed: unknown = taskDelivery;
  if (typeof taskDelivery === 'string') {
    try {
      parsed = jsonParse(taskDelivery);
    } catch {
      return '';
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return '';
  const record = parsed as {
    status?: unknown;
    result?: { content?: Array<{ type?: unknown; text?: unknown }> };
  };
  if (record.status !== 'completed' || !Array.isArray(record.result?.content)) {
    return '';
  }
  return record.result.content
    .filter((item): item is { text: string } => typeof item?.text === 'string')
    .map(item => item.text)
    .join('\n');
}

function extractSanitizedTag(text: string, tag: string): string | undefined {
  const raw = extractTag(text, tag);
  const cleaned = raw === null ? '' : collapseOneLine(raw, 200);
  return cleaned === '' ? undefined : cleaned;
}

function MonitorEventRow({
  addMargin,
  monitorEvent,
  color,
}: {
  addMargin: boolean;
  monitorEvent: MonitorEvent;
  color: TextProps['color'];
}): React.ReactNode {
  const { columns } = useTerminalSize();
  const { headline, description } = fitMonitorEventRow(monitorEvent, columns - GUTTER_COLS);
  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text wrap="truncate-end">
        <Text aria-hidden color={color}>
          {BLACK_CIRCLE}
        </Text>{' '}
        {MONITOR_EVENT_LABEL} {headline}
        {description !== null ? <Text dimColor>{` · ${description}`}</Text> : null}
      </Text>
    </Box>
  );
}

export function UserAgentNotificationMessage({
  addMargin,
  param: { text },
  taskDelivery,
  messageId,
  origin,
  verbose = false,
  isExpanded,
}: Props): React.ReactNode {
  const expanded = isExpanded ?? verbose;
  // gold As: zr(_, Dk) then KS — display-side amp/lt/gt only (not rie/quot).
  const summaryRaw = extractTag(text, 'summary');
  if (!summaryRaw) return null;
  const summary = unescapeXmlEntities(summaryRaw);

  const status = extractTag(text, 'status');
  const color = getStatusColor(status);
  // densable _p: Number(zr(text,"duration_ms")); suffix ` · ${Qt(y)}` when finite >0.
  const durationMs = Number(extractTag(text, 'duration_ms'));
  const durationSuffix = Number.isFinite(durationMs) && durationMs > 0 ? ` · ${formatDuration(durationMs)}` : null;

  const taskId = extractSanitizedTag(text, TASK_ID_TAG);
  const taskStatus = extractSanitizedTag(text, STATUS_TAG);
  const taskType = extractSanitizedTag(text, TASK_TYPE_TAG);
  const toolUseId = extractSanitizedTag(text, TOOL_USE_ID_TAG);
  const taskMeta = {
    ...(taskId !== undefined && { id: taskId }),
    ...(taskStatus !== undefined && { status: taskStatus }),
    ...(taskType !== undefined && { type: taskType }),
    ...(toolUseId !== undefined && { toolUseId }),
    ...(Number.isFinite(durationMs) && durationMs > 0 && { durationMs }),
  };

  const monitorEvent = parseMonitorEvent(text, origin);
  const hasDelivery = taskDelivery !== undefined;
  const deliveryOutput = hasDelivery ? extractTaskDeliveryOutput(taskDelivery) : '';
  const deliveryNote = hasDelivery
    ? `delivered to Claude as a GetTask result${deliveryOutput ? ` (${formatNumber(deliveryOutput.length)} chars)` : ''}`
    : null;
  const deliverySuffix = deliveryNote === null ? null : ` · ${deliveryNote}`;

  // gold Sp: column + one Text children [circle, " ", summary, duration].
  const painted =
    monitorEvent !== null && !expanded ? (
      <MonitorEventRow addMargin={addMargin} monitorEvent={monitorEvent} color={color} />
    ) : (
      <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
        <Text>
          <Text aria-hidden color={color}>
            {BLACK_CIRCLE}
          </Text>{' '}
          {summary}
          {durationSuffix ? <Text dimColor>{durationSuffix}</Text> : null}
          {deliverySuffix ? <Text dimColor>{deliverySuffix}</Text> : null}
        </Text>
        {verbose && deliveryOutput ? (
          <Box paddingLeft={2}>
            <Text dimColor>{deliveryOutput}</Text>
          </Box>
        ) : null}
        {expanded && monitorEvent !== null ? (
          <Box paddingLeft={2}>
            <Text dimColor>{monitorEvent.body}</Text>
          </Box>
        ) : null}
      </Box>
    );

  if (messageId === undefined) return painted;
  return (
    <PluginUserMessageSite requestId={messageId} text={summary} origin={origin} isExpanded={expanded} task={taskMeta}>
      {painted}
    </PluginUserMessageSite>
  );
}
