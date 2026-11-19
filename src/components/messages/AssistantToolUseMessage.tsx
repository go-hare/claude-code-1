import type { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React, { useCallback, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import type { ThemeName } from 'src/utils/theme.js';
import type { Command } from '../../commands.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Text, stringWidth, useTerminalViewport, useTheme, type DOMElement } from '@anthropic/ink';
import { StaticRenderContext } from '../../utils/staticRender.js';
import { useAppStateMaybeOutsideOfProvider } from '../../state/AppState.js';
import { findToolByName, type Tool, type ToolProgressData, type Tools } from '../../Tool.js';
import { getDisplayOnlyMcpTool } from './displayOnlyMcpTool.js';
import type { ProgressMessage } from '../../types/message.js';
import { getDetachedToolCall, subscribeDetachedToolCalls } from '../../utils/detachedToolCallStore.js';
import { logError } from '../../utils/log.js';
import { interruptedCall, type buildMessageLookups } from '../../utils/messages.js';
import { getPanesTerminalSize, subscribePanes } from '../../utils/plugins/functionHooksModules.js';
import { useUiRenderHost } from '../hooks/useUiRenderHost.js';
import { PluginRenderedTree } from '../PluginRasterPanes.js';
import { FilePathWidthContext, toolUsePathWidth } from '../FilePathLink.js';
import { MessageResponse } from '../MessageResponse.js';
import { InVirtualListContext, useSelectedMessageBg } from '../messageActions.js';
import { SentryErrorBoundary } from '../SentryErrorBoundary.js';
import { ToolUseLoader } from '../ToolUseLoader.js';
import { HookProgressMessage } from './HookProgressMessage.js';

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref && typeof ref === 'object') {
    (ref as React.MutableRefObject<T | null>).current = value;
  }
}

/** densable `Gae` (@207472669) — freeze detached status once scrolled into scrollback. */
function useViewportFrozenValue<T>(value: T): [(node: DOMElement | null) => void, T] {
  'use no memo';
  const inVirtualList = useContext(InVirtualListContext);
  const [ref, entry, , pureCheck] = useTerminalViewport();
  const isVisible = (pureCheck() ?? entry.isVisible) || inVirtualList;
  const cached = useRef(value);
  if (isVisible) {
    cached.current = value;
  }
  return [ref, cached.current];
}

type Props = {
  param: ToolUseBlockParam;
  addMargin: boolean;
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  inProgressToolUseIDs: Set<string>;
  progressMessagesForMessage: ProgressMessage[];
  shouldAnimate: boolean;
  shouldShowDot: boolean;
  inProgressToolCallCount?: number;
  lookups: ReturnType<typeof buildMessageLookups>;
  isTranscriptMode?: boolean;
  defaultCollapsed?: boolean;
};

export function AssistantToolUseMessage({
  param: sourceParam,
  addMargin,
  tools,
  commands,
  verbose,
  inProgressToolUseIDs,
  progressMessagesForMessage,
  shouldAnimate,
  shouldShowDot,
  inProgressToolCallCount,
  lookups,
  isTranscriptMode,
  defaultCollapsed,
}: Props): React.ReactNode {
  const terminalSize = useTerminalSize();
  const panesViewport = useSyncExternalStore(subscribePanes, getPanesTerminalSize, getPanesTerminalSize);
  const viewportColumns = panesViewport?.conversationColumns ?? terminalSize.columns;
  const [theme] = useTheme();
  const bg = useSelectedMessageBg();
  const isStaticRender = useContext(StaticRenderContext);
  const pendingWorkerRequest = useAppStateMaybeOutsideOfProvider(state => state.pendingWorkerRequest);
  const liveDetachedEntry = useSyncExternalStore(
    subscribeDetachedToolCalls,
    () => getDetachedToolCall(sourceParam.id),
    () => getDetachedToolCall(sourceParam.id),
  );
  // densable Xu (@207596850): freeze detached status on scrollback (`Gae(xe(ee, ie))`).
  const [viewportRef, detachedEntry] = useViewportFrozenValue(liveDetachedEntry);
  const isDetachedRunning = detachedEntry?.status === 'running';
  const isDetachedFailedOrStopped = detachedEntry?.status === 'failed' || detachedEntry?.status === 'stopped';
  const isRunning = inProgressToolUseIDs.has(sourceParam.id) || isDetachedRunning;
  const isErrored = lookups.erroredToolUseIDs.has(sourceParam.id) || isDetachedFailedOrStopped;
  const resultMsg = lookups.toolResultByToolUseID.get(sourceParam.id);
  const isInterrupted = interruptedCall(resultMsg);
  const output = resultMsg?.type === 'user' ? resultMsg.toolUseResult : undefined;
  // densable ac.useRenderInput("ToolUse") — Xu: rewrite input / toolLabel.
  const rendered = useUiRenderHost({
    component: 'ToolUse',
    requestId: sourceParam.id,
    props: {
      tool_use_id: sourceParam.id,
      tool: sourceParam.name,
      input: sourceParam.input,
      isRunning,
      isErrored,
      isInterrupted,
      output,
    },
    viewport: { columns: viewportColumns, rows: terminalSize.rows },
  });
  const combinedRef = useCallback(
    (node: DOMElement | null) => {
      viewportRef(node);
      assignRef(rendered.hostRef as React.Ref<DOMElement>, node);
    },
    [viewportRef, rendered.hostRef],
  );
  const wrapHost = (engineNode: React.ReactNode): React.ReactNode => {
    if (rendered.drawPending) {
      return (
        <Box
          ref={combinedRef}
          flexDirection="column"
          drawPending
          {...(rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
        />
      );
    }
    const inner =
      rendered.pluginTree !== undefined ? (
        <PluginRenderedTree
          node={rendered.pluginTree}
          plugin={rendered.pluginName}
          requestId={sourceParam.id}
          component="ToolUse"
          engine={engineNode}
        />
      ) : (
        engineNode
      );
    if (inner === null && rendered.minHeight === undefined && !isDetachedRunning) {
      return null;
    }
    return (
      <Box
        ref={rendered.pluginTree !== undefined || engineNode === null ? combinedRef : viewportRef}
        flexDirection="column"
        {...(rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
      >
        {inner}
      </Box>
    );
  };
  const param = useMemo(
    () => (rendered.props.input === sourceParam.input ? sourceParam : { ...sourceParam, input: rendered.props.input }),
    [sourceParam, rendered.props.input],
  );
  const toolLabel =
    typeof rendered.props.tool === 'string' && rendered.props.tool !== sourceParam.name
      ? String(rendered.props.tool)
      : undefined;

  // Memoize on param identity (stable — from the persisted message object).
  // Zod safeParse allocates per call, and some tools' userFacingName()
  // (BashTool → shouldUseSandbox → shell-quote parse) are expensive. Without
  // this, ~50 bash messages × shell-quote-per-render pushed transition
  // render past the shimmer tick → abort → infinite retry (#21605).
  const isErroredTool = lookups.erroredToolUseIDs.has(param.id);
  const parsed = useMemo(() => {
    if (!tools) return null;
    // Official 2.1.323 (#2033) `oae`: fall back to a display-only MCP tool stub
    // when an MCP server connects late (or is disconnected) so resumed MCP tool
    // calls stay visible and don't trigger scrollback repeats on late connect.
    const tool = findToolByName(tools, param.name) ?? getDisplayOnlyMcpTool(param.name, { isErrored: isErroredTool });
    if (!tool) return null;
    const input = tool.inputSchema.safeParse(param.input);
    const data = input.success ? input.data : undefined;
    return {
      tool,
      input,
      userFacingToolName: tool.userFacingName(data),
      userFacingToolNameBackgroundColor: tool.userFacingNameBackgroundColor?.(data),
      isTransparentWrapper: tool.isTransparentWrapper?.() ?? false,
    };
  }, [tools, param, isErroredTool]);

  if (!parsed) {
    // Guard against undefined tools (required prop) or unknown tool name
    logError(new Error(tools ? `Tool ${param.name} not found` : `Tools array is undefined for tool ${param.name}`));
    return wrapHost(null);
  }

  const { tool, input, userFacingToolName, userFacingToolNameBackgroundColor, isTransparentWrapper } = parsed;
  const displayToolName = toolLabel ?? userFacingToolName;

  const isResolved = lookups.resolvedToolUseIDs.has(param.id) && !isDetachedRunning;
  const isQueued = !inProgressToolUseIDs.has(param.id) && !isResolved && !isDetachedRunning;
  const isWaitingForPermission = pendingWorkerRequest?.toolUseId === param.id;
  // densable Xu: rewrite input/toolLabel only. Transcript output rewrite is Xc.
  const renderToolUseTag = tool.renderToolUseTag as
    | ((
        input: unknown,
        context?: {
          toolUseId: string;
          toolUseResult: unknown;
          progressMessages: ProgressMessage[] | undefined;
        },
      ) => React.ReactNode)
    | undefined;

  if (isTransparentWrapper) {
    if (isQueued || isResolved) return wrapHost(null);
    return wrapHost(
      <Box
        ref={rendered.pluginTree === undefined ? (rendered.hostRef as React.Ref<DOMElement>) : undefined}
        flexDirection="column"
        width="100%"
        backgroundColor={bg}
      >
        {renderToolUseProgressMessage(
          tool,
          tools,
          lookups,
          param.id,
          progressMessagesForMessage,
          { verbose, inProgressToolCallCount, isTranscriptMode },
          terminalSize,
        )}
      </Box>,
    );
  }

  if (displayToolName === '') {
    return wrapHost(null);
  }

  const rawRenderedToolUseMessage = input.success
    ? renderToolUseMessage(tool, input.data, {
        theme,
        verbose,
        commands,
        isTranscriptMode,
        toolUseResult: output,
      })
    : null;
  // Official 2.1.323 (#2081): Claude in Chrome tools like `browser_batch` may
  // have no inline secondary info; never drop the tool header (tool name) in
  // fullscreen transcript (ctrl+o) or subagent progress.
  const renderedToolUseMessage =
    rawRenderedToolUseMessage === null && param.name.startsWith('mcp__claude-in-chrome__')
      ? ''
      : rawRenderedToolUseMessage;
  if (renderedToolUseMessage === null) {
    return wrapHost(null);
  }

  const engine = (
    <Box
      ref={rendered.pluginTree === undefined ? (rendered.hostRef as React.Ref<DOMElement>) : undefined}
      flexDirection="row"
      justifyContent="space-between"
      marginTop={addMargin ? 1 : 0}
      width="100%"
      backgroundColor={bg}
    >
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="nowrap" minWidth={stringWidth(displayToolName) + (shouldShowDot ? 2 : 0)}>
          {shouldShowDot &&
            (isQueued ? (
              <Box minWidth={2}>
                <Text aria-label="tool:" dimColor={isQueued}>
                  {BLACK_CIRCLE}
                </Text>
              </Box>
            ) : (
              // WARNING: The code here and in ToolUseLoader is particularly
              // sensitive to what *should* just be trivial refactorings. See
              // the comment in ToolUseLoader for more details.
              <ToolUseLoader
                shouldAnimate={shouldAnimate || isDetachedRunning}
                isUnresolved={!isResolved}
                isError={lookups.erroredToolUseIDs.has(param.id) || isDetachedFailedOrStopped}
              />
            ))}
          <Box flexShrink={0}>
            <Text
              bold
              wrap="truncate-end"
              backgroundColor={userFacingToolNameBackgroundColor}
              color={userFacingToolNameBackgroundColor ? 'inverseText' : undefined}
            >
              {displayToolName}
            </Text>
          </Box>
          {renderedToolUseMessage !== '' && (
            <FilePathWidthContext.Provider
              value={
                verbose || isStaticRender ? null : toolUsePathWidth(viewportColumns, shouldShowDot, displayToolName)
              }
            >
              <Box flexWrap="nowrap">
                <Text>({renderedToolUseMessage})</Text>
              </Box>
            </FilePathWidthContext.Provider>
          )}
          {/* Render tool-specific tags (timeout, model, resume ID, etc.) */}
          {input.success &&
            renderToolUseTag?.(input.data, {
              toolUseId: param.id,
              toolUseResult: output,
              progressMessages: lookups.progressMessagesByToolUseID.get(param.id),
            })}
        </Box>
        {!isResolved &&
          !isQueued &&
          !defaultCollapsed &&
          (isWaitingForPermission ? (
            <MessageResponse height={1}>
              <Text dimColor>Waiting for permission…</Text>
            </MessageResponse>
          ) : (
            renderToolUseProgressMessage(
              tool,
              tools,
              lookups,
              param.id,
              progressMessagesForMessage,
              {
                verbose,
                inProgressToolCallCount,
                isTranscriptMode,
              },
              terminalSize,
            )
          ))}
        {!isResolved && isQueued && renderToolUseQueuedMessage(tool)}
      </Box>
    </Box>
  );
  return wrapHost(engine);
}

function renderToolUseMessage(
  tool: Tool,
  input: unknown,
  {
    theme,
    verbose,
    commands,
    isTranscriptMode,
    toolUseResult,
  }: {
    theme: ThemeName;
    verbose: boolean;
    commands: Command[];
    isTranscriptMode?: boolean;
    toolUseResult?: unknown;
  },
): React.ReactNode {
  try {
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return '';
    }
    return tool.renderToolUseMessage(parsed.data, {
      theme,
      verbose,
      commands,
      isTranscriptMode,
      toolUseResult,
    });
  } catch (error) {
    logError(new Error(`Error rendering tool use message for ${tool.name}: ${error}`));
    return '';
  }
}

function renderToolUseProgressMessage(
  tool: Tool,
  tools: Tools,
  lookups: ReturnType<typeof buildMessageLookups>,
  toolUseID: string,
  progressMessagesForMessage: ProgressMessage[],
  {
    verbose,
    inProgressToolCallCount,
    isTranscriptMode,
  }: {
    verbose: boolean;
    inProgressToolCallCount?: number;
    isTranscriptMode?: boolean;
  },
  terminalSize: { columns: number; rows: number },
): React.ReactNode {
  const toolProgressMessages = progressMessagesForMessage.filter(
    (msg): msg is ProgressMessage<ToolProgressData> => (msg.data as Record<string, unknown>).type !== 'hook_progress',
  );
  try {
    const toolMessages =
      tool.renderToolUseProgressMessage?.(toolProgressMessages, {
        tools,
        verbose,
        terminalSize,
        inProgressToolCallCount: inProgressToolCallCount ?? 1,
        isTranscriptMode,
      }) ?? null;
    return (
      <>
        <SentryErrorBoundary>
          <HookProgressMessage
            hookEvent="PreToolUse"
            lookups={lookups}
            toolUseID={toolUseID}
            verbose={verbose}
            isTranscriptMode={isTranscriptMode}
          />
        </SentryErrorBoundary>
        {toolMessages}
      </>
    );
  } catch (error) {
    logError(new Error(`Error rendering tool use progress message for ${tool.name}: ${error}`));
    return null;
  }
}

function renderToolUseQueuedMessage(tool: Tool): React.ReactNode {
  try {
    return tool.renderToolUseQueuedMessage?.();
  } catch (error) {
    logError(new Error(`Error rendering tool use queued message for ${tool.name}: ${error}`));
    return null;
  }
}
