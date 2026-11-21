import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import stripAnsi from 'strip-ansi';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import {
  EVENT_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js';
import { MONITOR_EVENT_LABEL, MONITOR_EVENT_SUMMARY_PREFIX } from '../../utils/monitorStreamNotify.js';
import { useQueuedMessage } from '../../context/QueuedMessageContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, stringWidth, Text, useTheme, type TextProps } from '@anthropic/ink';
import { formatDuration, formatNumber, truncateToWidth } from '../../utils/format.js';
import { clipHookField } from '../../utils/hooks/stopHookPayload.js';
import { extractTag, uiRenderUserMessageOrigin } from '../../utils/messages.js';
import { jsonParse } from '../../utils/slowOperations.js';
import { sanitizeIdleResultText, sliceIdleResultUtf16 } from '../../utils/teammateMailbox.js';
import { unescapeXmlEntities } from '../../utils/xml.js';
import { PluginUserMessageSite } from '../PluginRasterPanes.js';
import { isTranscriptV2RowsEnabled, TranscriptV2Row } from './TranscriptV2Row.js';
import { getDetachedToolCall, subscribeDetachedToolCalls } from '../../utils/detachedToolCallStore.js';
import { StaticRenderContext } from '../../utils/staticRender.js';
import { GET_TASK_TOOL_NAME, isBashTaskDeliveryHosted } from '../../utils/bashTaskDeliveryOutcomes.js';
import { FallbackToolUseErrorMessage } from '../FallbackToolUseErrorMessage.js';
import { ToolUseLoader } from '../ToolUseLoader.js';
import { UserToolCanceledMessage } from './UserToolResultMessage/UserToolCanceledMessage.js';
import { logError } from '../../utils/log.js';
import type { ThemeName } from '../../utils/theme.js';
import type { Tool } from '../../Tool.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  taskDelivery?: unknown;
  messageId?: string;
  origin?: unknown;
  verbose?: boolean;
  isExpanded?: boolean;
  /** densable TDe `u(c.props.text)` — PluginUserMessageSite rewrite of summary. */
  rewrittenText?: string;
  /**
   * gold Sp inner `_p` — skip PluginUserMessageSite. Inner must keep
   * `messageId` for the As delivery gate without wrapping again.
   */
  skipSite?: boolean;
};

type MonitorEvent = {
  description: string;
  headline: string;
  body: string;
};

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

const DETACHED_TOOL_CALL_OPEN = `<${TASK_NOTIFICATION_TAG}>\n<${TOOL_USE_ID_TAG}>`;
const TOOL_USE_ID_CLOSE = `</${TOOL_USE_ID_TAG}>\n`;
const DETACHED_TOOL_CALL_TYPE = `<${TASK_TYPE_TAG}>tool_call</${TASK_TYPE_TAG}>\n`;

/**
 * densable `o9e` / `gVn` — detached tool_call result envelope.
 * Returns the tool-use-id when the text starts with
 * `<task-notification>\n<tool-use-id>…</tool-use-id>\n<task-type>tool_call</task-type>\n`.
 */
export function parseDetachedToolCallNotification(text: string): string | null {
  if (!text.startsWith(DETACHED_TOOL_CALL_OPEN)) return null;
  const closeAt = text.indexOf(TOOL_USE_ID_CLOSE, DETACHED_TOOL_CALL_OPEN.length);
  if (closeAt === -1) return null;
  if (!text.startsWith(DETACHED_TOOL_CALL_TYPE, closeAt + TOOL_USE_ID_CLOSE.length)) {
    return null;
  }
  return text.slice(DETACHED_TOOL_CALL_OPEN.length, closeAt);
}

export function isDetachedToolCallNotification(text: string): boolean {
  return parseDetachedToolCallNotification(text) !== null;
}

/** densable `Ai` — `renderToolUseMessage` with parse-fail → "". */
function renderDetachedToolUseMessage(
  tool: Tool,
  input: unknown,
  { theme, verbose }: { theme: ThemeName; verbose: boolean },
): React.ReactNode {
  try {
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) return '';
    return tool.renderToolUseMessage(parsed.data, { theme, verbose });
  } catch (error) {
    logError(new Error(`Error rendering tool use message for ${tool.name}: ${error}`));
    return '';
  }
}

function wrapDetachedResult(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') {
    return <Text>{node}</Text>;
  }
  return node;
}

/**
 * densable `Li` — in-place tool row: No spinner + userFacingName + (Ai) +
 * completed `renderToolResultMessage` / stopped `bm` / else `Mf`.
 */
function DetachedToolCallInPlaceRow({
  addMargin,
  call,
  verbose,
}: {
  addMargin: boolean;
  call: NonNullable<ReturnType<typeof getDetachedToolCall>>;
  verbose: boolean;
}): React.ReactNode {
  const [theme] = useTheme();
  const { tool } = call;
  const parsed = tool.inputSchema.safeParse(call.input);
  const data = parsed.success ? parsed.data : undefined;
  const useMessage = data === undefined ? null : renderDetachedToolUseMessage(tool, call.input, { theme, verbose });
  const name = tool.userFacingName(data as never);
  const isError = call.status !== 'completed';
  const result =
    call.status === 'completed' ? (
      wrapDetachedResult(
        tool.renderToolResultMessage?.(call.data as never, [], {
          theme,
          tools: [],
          verbose,
          input: call.input,
        }) ?? null,
      )
    ) : call.status === 'stopped' ? (
      <UserToolCanceledMessage />
    ) : (
      <FallbackToolUseErrorMessage result={call.text ?? ''} verbose={verbose} />
    );
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
      <Box flexDirection="row" flexWrap="nowrap">
        <ToolUseLoader shouldAnimate={false} isUnresolved={false} isError={isError} />
        <Text bold>{name}</Text>
        {useMessage !== null && useMessage !== '' ? <Text>({useMessage})</Text> : null}
      </Box>
      {result}
    </Box>
  );
}

/** densable `el` — UPt in-place Li when the registry has a settled call. */
export function DetachedToolCallResultMessage({
  addMargin,
  text,
  verbose = false,
}: {
  addMargin: boolean;
  text: string;
  verbose?: boolean;
}): React.ReactNode {
  const isStaticRender = React.useContext(StaticRenderContext);
  const toolUseId = extractTag(text, TOOL_USE_ID_TAG);
  const call = React.useSyncExternalStore(subscribeDetachedToolCalls, () =>
    toolUseId === null ? undefined : getDetachedToolCall(toolUseId),
  );
  if (call === undefined) {
    const rawResult = verbose ? extractTag(text, 'result') : null;
    const result = rawResult === null ? null : stripAnsi(unescapeXmlEntities(rawResult)).trim();
    return (
      <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
        <Text dimColor>An earlier tool call's result arrived here</Text>
        {result !== null && result !== '' ? (
          <Box paddingLeft={2}>
            <Text dimColor>{result}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }
  if (isStaticRender || call.status === 'running' || call.paintedInPlace) {
    return null;
  }
  return <DetachedToolCallInPlaceRow addMargin={addMargin} call={call} verbose={verbose} />;
}

function extractSingleTaskNotification(text: string, origin?: unknown): string | null {
  if (
    origin !== undefined &&
    typeof origin === 'object' &&
    origin !== null &&
    'kind' in origin &&
    (origin as { kind?: unknown }).kind !== 'task-notification'
  ) {
    return null;
  }
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(`<${TASK_NOTIFICATION_TAG}`)) return null;
  const closeTag = `</${TASK_NOTIFICATION_TAG}>`;
  const idx = trimmed.indexOf(closeTag);
  if (idx === -1) return null;
  const block = trimmed.slice(0, idx + closeTag.length);
  return trimmed.slice(block.length).trim() === '' ? block : null;
}

/** densable `fm` — strip frame control/BiDi chars, surrogate-safe slice, collapse whitespace. */
function capSanitizedOneLine(text: string, maxChars: number): string {
  const stripped = sanitizeIdleResultText(text);
  const sliced = sliceIdleResultUtf16(stripped, maxChars);
  const cleaned = sliced.length >= stripped.length ? sliced : sanitizeIdleResultText(sliced);
  return cleaned.replace(/\s+/g, ' ').trim();
}

function parseMonitorEvent(text: string, origin?: unknown): MonitorEvent | null {
  const block = extractSingleTaskNotification(text, origin);
  const rawSummary = block === null ? null : extractTag(block, SUMMARY_TAG);
  if (block === null || rawSummary === null || rawSummary.includes('<')) return null;
  const summary = unescapeXmlEntities(rawSummary);
  if (
    !summary.startsWith(MONITOR_EVENT_SUMMARY_PREFIX) ||
    !summary.endsWith('"') ||
    summary.length <= MONITOR_EVENT_SUMMARY_PREFIX.length
  ) {
    return null;
  }
  const rawEvent = extractTag(block, EVENT_TAG);
  if (rawEvent === null || rawEvent.includes('<')) return null;
  const cleaned = sanitizeIdleResultText(stripAnsi(unescapeXmlEntities(rawEvent))).trim();
  let headline = '';
  for (const line of cleaned.split('\n')) {
    headline = capSanitizedOneLine(line, MAX_HEADLINE_CHARS);
    if (headline !== '') break;
  }
  if (headline === '') return null;
  return {
    description: capSanitizedOneLine(summary.slice(MONITOR_EVENT_SUMMARY_PREFIX.length, -1), MAX_HEADLINE_CHARS),
    headline,
    body: sanitizeIdleResultText(clipHookField(cleaned, MAX_BODY_CHARS)),
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
  const cleaned = raw === null ? '' : capSanitizedOneLine(raw, 200);
  return cleaned === '' ? undefined : cleaned;
}

function MonitorEventRow({
  addMargin,
  monitorEvent,
  color,
  status,
  useV2Row,
}: {
  addMargin: boolean;
  monitorEvent: MonitorEvent;
  color: TextProps['color'];
  status: string | null;
  useV2Row: boolean;
}): React.ReactNode {
  const { columns } = useTerminalSize();
  const { headline, description } = fitMonitorEventRow(monitorEvent, columns - GUTTER_COLS);
  if (useV2Row) {
    const tone = status === 'failed' ? 'red' : status === 'killed' ? 'gold' : 'dim';
    return (
      <TranscriptV2Row
        addMargin={addMargin}
        row={{
          tone,
          text: `${MONITOR_EVENT_LABEL} ${headline}`,
          detail: description ?? undefined,
        }}
      />
    );
  }
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
  param,
  taskDelivery,
  messageId,
  origin,
  verbose = false,
  isExpanded,
  rewrittenText,
  skipSite = false,
}: Props): React.ReactNode {
  const { text } = param;
  const expanded = isExpanded ?? verbose;
  // Official 2.1.328 `KTs(verbose)` (`chunk@307641741.js`): queued notices inherit
  // `noticeSystemLines` from `QueuedMessageProvider` (`CTo`); live rows use `qx(verbose)`.
  const queued = useQueuedMessage();
  const useV2Row =
    queued?.isQueued === true
      ? queued.noticeSystemLines === true
      : !verbose && !expanded && isTranscriptV2RowsEnabled();
  // gold As: zr(_, Dk) then KS — display-side amp/lt/gt only (not rie/quot).
  const summaryRaw = extractTag(text, 'summary');
  if (!summaryRaw) return null;
  const summary = unescapeXmlEntities(summaryRaw);
  const shownSummary = rewrittenText ?? summary;

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
  // gold `_p`: taskDelivery!==undefined && Qn().bashTaskDeliveryOutcomes.get(id)!=="no_host"
  const hasDelivery = taskDelivery !== undefined && isBashTaskDeliveryHosted(messageId);
  const deliveryOutput = hasDelivery ? extractTaskDeliveryOutput(taskDelivery) : '';
  const deliveryNote = hasDelivery
    ? `delivered to Claude as a ${GET_TASK_TOOL_NAME} result${deliveryOutput ? ` (${formatNumber(deliveryOutput.length)} chars)` : ''}`
    : null;
  const deliverySuffix = deliveryNote === null ? null : ` · ${deliveryNote}`;

  // gold Sp: draw(se) swaps summary; monitor row only when summary is unre-written.
  const v2Tone = status === 'failed' ? 'red' : status === 'killed' ? 'gold' : 'dim';
  const v2Detail = [durationMs > 0 && Number.isFinite(durationMs) ? formatDuration(durationMs) : null, deliveryNote]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const painted =
    monitorEvent !== null && !expanded && shownSummary === summary ? (
      <MonitorEventRow
        addMargin={addMargin}
        monitorEvent={monitorEvent}
        color={color}
        status={status}
        useV2Row={useV2Row}
      />
    ) : useV2Row ? (
      <TranscriptV2Row
        addMargin={addMargin}
        row={{
          tone: v2Tone,
          text: shownSummary,
          ...(v2Detail !== '' ? { detail: v2Detail } : {}),
        }}
      />
    ) : (
      <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
        {/* Official 2.1.326 #118 (`nh` -> `ui`): 2-column bullet row so wrapped
            background agent / command results align with their text, not under the bullet. */}
        <Box flexDirection="row">
          <Box minWidth={2}>
            <Text aria-hidden color={color}>
              {BLACK_CIRCLE}
            </Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <Text>
              {shownSummary}
              {durationSuffix ? <Text dimColor>{durationSuffix}</Text> : null}
              {deliverySuffix ? <Text dimColor>{deliverySuffix}</Text> : null}
            </Text>
          </Box>
        </Box>
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

  if (messageId === undefined || skipSite) return painted;
  return (
    <PluginUserMessageSite
      requestId={messageId}
      text={summary}
      origin={uiRenderUserMessageOrigin(origin)}
      isExpanded={expanded}
      task={taskMeta}
    >
      <UserAgentNotificationMessage
        addMargin={addMargin}
        param={param}
        taskDelivery={taskDelivery}
        messageId={messageId}
        origin={origin}
        verbose={verbose}
        isExpanded={isExpanded}
        skipSite
      />
    </PluginUserMessageSite>
  );
}
