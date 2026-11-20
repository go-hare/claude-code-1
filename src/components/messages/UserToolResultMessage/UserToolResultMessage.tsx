import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { Box, Text, useTerminalViewport, useTheme, type DOMElement } from '@anthropic/ink';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { filterToolProgressMessages, type Tools } from '../../../Tool.js';
import type { NormalizedUserMessage, ProgressMessage } from '../../../types/message.js';
import {
  detachedToolCallPaintedInPlace,
  getDetachedToolCall,
  subscribeDetachedToolCalls,
} from '../../../utils/detachedToolCallStore.js';
import { formatDuration } from '../../../utils/format.js';
import {
  type buildMessageLookups,
  CANCEL_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  REJECT_MESSAGE,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
} from '../../../utils/messages.js';
import { getPanesTerminalSize, subscribePanes } from '../../../utils/plugins/functionHooksModules.js';
import { useUiRenderHost } from '../../hooks/useUiRenderHost.js';
import { InVirtualListContext } from '../../messageActions.js';
import { MessageResponse } from '../../MessageResponse.js';
import { PluginRenderedTree } from '../../PluginRasterPanes.js';
import { UserToolCanceledMessage } from './UserToolCanceledMessage.js';
import { UserToolErrorMessage } from './UserToolErrorMessage.js';
import { UserToolRejectMessage } from './UserToolRejectMessage.js';
import { UserToolSuccessMessage } from './UserToolSuccessMessage.js';
import { useGetToolFromMessages } from './utils.js';

type Props = {
  param: ToolResultBlockParam;
  message: NormalizedUserMessage;
  lookups: ReturnType<typeof buildMessageLookups>;
  progressMessagesForMessage: ProgressMessage[];
  style?: 'condensed';
  tools: Tools;
  verbose: boolean;
  width: number | string;
  isTranscriptMode?: boolean;
};

type ResolvedToolUse = NonNullable<ReturnType<typeof useGetToolFromMessages>>;

function isDetachedToolCallPlaceholderResult(toolUseResult: unknown): boolean {
  return (
    typeof toolUseResult === 'object' &&
    toolUseResult !== null &&
    'detachedToolCall' in toolUseResult &&
    (toolUseResult as { detachedToolCall?: unknown }).detachedToolCall === true
  );
}

/** densable `Gae` (@207472669) — freeze value once scrolled into terminal scrollback. */
function useViewportFrozenValue<T>(value: T): [(node: DOMElement | null) => void, T] {
  'use no memo';
  const inVirtualList = React.useContext(InVirtualListContext);
  const [ref, entry, , pureCheck] = useTerminalViewport();
  const isVisible = (pureCheck() ?? entry.isVisible) || inVirtualList;
  const cached = React.useRef(value);
  if (isVisible) {
    cached.current = value;
  }
  return [ref, cached.current];
}

export function UserToolResultMessage(props: Props): React.ReactNode {
  const toolUse = useGetToolFromMessages(props.param.tool_use_id, props.tools, props.lookups, {
    isErrored: props.param.is_error === true,
  });
  if (!toolUse) {
    return null;
  }
  return <UserToolResultMessageBody {...props} toolUse={toolUse} />;
}

function DetachedToolResultInPlace({
  param,
  message,
  lookups,
  progressMessagesForMessage,
  style,
  tools,
  verbose,
  width,
  isTranscriptMode,
  toolUse,
}: Props & { toolUse: ResolvedToolUse }): React.ReactNode {
  const [theme] = useTheme();
  const toolUseID = param.tool_use_id;
  const liveEntry = React.useSyncExternalStore(
    subscribeDetachedToolCalls,
    () => getDetachedToolCall(toolUseID),
    () => getDetachedToolCall(toolUseID),
  );
  // densable Ud + Gae (@207729990): freeze off-screen rows so scrollback height
  // never mutates and bottom <task-notification> (el / Li) paints when scrolled past.
  const [viewportRef, entry] = useViewportFrozenValue(liveEntry);
  const isSettled = entry !== undefined && entry.status !== 'running';
  React.useEffect(() => {
    if (isSettled) {
      detachedToolCallPaintedInPlace(toolUseID);
    }
  }, [toolUseID, isSettled]);

  let body: React.ReactNode = null;
  if (entry === undefined) {
    body = (
      <MessageResponse height={1}>
        <Text dimColor>Result delivered later in the conversation</Text>
      </MessageResponse>
    );
  } else if (entry.status !== 'running') {
    const transcriptSteppedAside =
      isTranscriptMode && entry.settledAt !== undefined ? (
        <MessageResponse height={1}>
          <Text dimColor>
            Stepped aside for your message · finished {formatDuration(Math.max(0, entry.settledAt - entry.detachedAt))}{' '}
            later
          </Text>
        </MessageResponse>
      ) : null;

    if (entry.status === 'completed') {
      const tool = toolUse.tool;
      const isNonObjectData = entry.data !== undefined && (entry.data === null || typeof entry.data !== 'object');
      let directNode: React.ReactNode = null;
      if (isNonObjectData && tool?.renderToolResultMessage !== undefined) {
        const raw =
          tool.renderToolResultMessage(entry.data as never, filterToolProgressMessages(progressMessagesForMessage), {
            style,
            theme,
            tools,
            verbose,
            isTranscriptMode,
            input: toolUse.toolUse.input,
          }) ?? null;
        directNode =
          typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'bigint' ? <Text>{raw}</Text> : raw;
      }
      body = (
        <>
          {isNonObjectData ? (
            directNode
          ) : (
            <UserToolSuccessMessage
              message={{ ...message, toolUseResult: entry.data }}
              lookups={lookups}
              toolUseID={toolUseID}
              progressMessagesForMessage={progressMessagesForMessage}
              style={style}
              tool={tool}
              tools={tools}
              verbose={verbose}
              width={width}
              isTranscriptMode={isTranscriptMode}
            />
          )}
          {transcriptSteppedAside}
        </>
      );
    } else if (entry.status === 'stopped') {
      body = (
        <UserToolRejectMessage
          input={toolUse.toolUse.input as { [key: string]: unknown }}
          progressMessagesForMessage={progressMessagesForMessage}
          tool={toolUse.tool}
          tools={tools}
          lookups={lookups}
          style={style}
          verbose={verbose}
          isTranscriptMode={isTranscriptMode}
        />
      );
    } else {
      body = (
        <>
          <UserToolErrorMessage
            progressMessagesForMessage={progressMessagesForMessage}
            tool={toolUse.tool}
            tools={tools}
            param={{ ...param, content: entry.text ?? '', is_error: true }}
            input={toolUse.toolUse.input}
            output={undefined}
            verbose={verbose}
            isTranscriptMode={isTranscriptMode}
          />
          {transcriptSteppedAside}
        </>
      );
    }
  }

  return (
    <Box ref={viewportRef} flexDirection="column">
      {body}
    </Box>
  );
}

function UserToolResultMessageBody({
  param,
  message,
  lookups,
  progressMessagesForMessage,
  style,
  tools,
  verbose,
  width,
  isTranscriptMode,
  toolUse,
}: Props & { toolUse: ResolvedToolUse }): React.ReactNode {
  const { columns, rows } = useTerminalSize();
  const panesViewport = React.useSyncExternalStore(subscribePanes, getPanesTerminalSize, getPanesTerminalSize);
  const viewportColumns = panesViewport?.conversationColumns ?? columns;
  const output = message.toolUseResult;
  const rendered = useUiRenderHost({
    component: 'ToolResult',
    requestId: param.tool_use_id,
    props: {
      tool_use_id: param.tool_use_id,
      tool: toolUse.toolUse.name,
      output,
      isErrored: param.is_error === true,
    },
    viewport: { columns: viewportColumns, rows },
  });
  if (rendered.drawPending) {
    return (
      <Box
        ref={rendered.hostRef as React.Ref<DOMElement>}
        flexDirection="column"
        drawPending
        {...(rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
      />
    );
  }
  const rewrittenMessage =
    rendered.props.output === output ? message : { ...message, toolUseResult: rendered.props.output };
  const wrap = (engine: React.ReactNode): React.ReactNode => {
    const inner =
      rendered.pluginTree === undefined ? (
        engine
      ) : (
        <PluginRenderedTree
          node={rendered.pluginTree}
          plugin={rendered.pluginName}
          requestId={param.tool_use_id}
          component="ToolResult"
          engine={engine}
        />
      );
    return (
      <Box
        ref={rendered.hostRef as React.Ref<DOMElement>}
        flexDirection="column"
        {...(rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
      >
        {inner}
      </Box>
    );
  };

  if (typeof param.content === 'string' && param.content.startsWith(CANCEL_MESSAGE)) {
    return wrap(<UserToolCanceledMessage />);
  }

  const isInterrupted =
    typeof param.content !== 'string' ||
    !(param.content.startsWith(REJECT_MESSAGE) || param.content.startsWith(REJECT_MESSAGE_WITH_REASON_PREFIX));
  const toolDenialKind = (rewrittenMessage as { toolDenialKind?: string }).toolDenialKind;

  if (
    (typeof param.content === 'string' &&
      (param.content.startsWith(REJECT_MESSAGE) ||
        (param.content.startsWith(REJECT_MESSAGE_WITH_REASON_PREFIX) &&
          toolUse.tool?.renderToolUseRejectedMessage !== undefined))) ||
    param.content === INTERRUPT_MESSAGE_FOR_TOOL_USE
  ) {
    return wrap(
      <UserToolRejectMessage
        input={toolUse.toolUse.input as { [key: string]: unknown }}
        progressMessagesForMessage={progressMessagesForMessage}
        tool={toolUse.tool}
        tools={tools}
        lookups={lookups}
        style={style}
        verbose={verbose}
        isTranscriptMode={isTranscriptMode}
        isInterrupted={isInterrupted}
      />,
    );
  }

  if (toolUse.tool?.backgrounding === 'detach' && isDetachedToolCallPlaceholderResult(rewrittenMessage.toolUseResult)) {
    return wrap(
      <DetachedToolResultInPlace
        param={param}
        message={rewrittenMessage}
        lookups={lookups}
        progressMessagesForMessage={progressMessagesForMessage}
        style={style}
        tools={tools}
        verbose={verbose}
        width={width}
        isTranscriptMode={isTranscriptMode}
        toolUse={toolUse}
      />,
    );
  }

  if (param.is_error) {
    return wrap(
      <UserToolErrorMessage
        progressMessagesForMessage={progressMessagesForMessage}
        tool={toolUse.tool}
        tools={tools}
        param={param}
        input={toolUse.toolUse.input}
        output={rewrittenMessage.toolUseResult}
        verbose={verbose}
        isTranscriptMode={isTranscriptMode}
        toolDenialKind={toolDenialKind}
      />,
    );
  }

  return wrap(
    <UserToolSuccessMessage
      message={rewrittenMessage}
      lookups={lookups}
      toolUseID={toolUse.toolUse.id}
      progressMessagesForMessage={progressMessagesForMessage}
      style={style}
      tool={toolUse.tool}
      tools={tools}
      verbose={verbose}
      width={width}
      isTranscriptMode={isTranscriptMode}
    />,
  );
}
