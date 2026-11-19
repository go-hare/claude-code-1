import { feature } from 'bun:bundle';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { basename } from 'path';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useInterval } from 'usehooks-ts';
import { TASK_NOTIFICATION_TAG } from '../../constants/xml.js';
import { useMinDisplayTime } from '../../hooks/useMinDisplayTime.js';
import { Ansi, Box, Text, useTheme, useTerminalSize, type DOMElement } from '@anthropic/ink';
import { filterToolProgressMessages, findToolByName, type Tools } from '../../Tool.js';
import { getReplPrimitiveTools } from '@claude-code/builtin-tools/tools/REPLTool/primitiveTools.js';
import type { CollapsedReadSearchGroup, NormalizedAssistantMessage, ProgressMessage } from '../../types/message.js';
import { uniq } from '../../utils/array.js';
import {
  commandAsHint,
  getToolSearchOrReadInfo,
  getToolUseIdsFromCollapsedGroup,
  leftoverIhrSubscribe,
  leftoverHx,
  leftoverLastThinkingAtMs,
  leftoverZcMs,
  LEFTOVER_HX_GUTTER,
  LEFTOVER_HX_MAX_LINES,
  LEFTOVER_SS_HOLD_MS,
  MAX_HINT_LINES,
} from '../../utils/collapseReadSearch.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatDuration, formatSecondsShort } from '../../utils/format.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { useAppState } from '../../state/AppState.js';
import { leftoverIhrThinkingStartedAt, useLeftoverIhrStore } from '../../state/leftoverIhrStore.js';
import { getMainThreadAgentId } from '../../bootstrap/state.js';
import {
  CANCEL_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  interruptedCall,
  REJECT_MESSAGE,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  type buildMessageLookups,
} from '../../utils/messages.js';
import { extractSafeToolInputFields } from '../../utils/safeToolInput.js';
import { getPanesTerminalSize, subscribePanes } from '../../utils/plugins/functionHooksModules.js';
import type { ThemeName } from '../../utils/theme.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { FallbackToolUseRejectedMessage } from '../FallbackToolUseRejectedMessage.js';
import { Markdown } from '../Markdown.js';
import { MessageResponse } from '../MessageResponse.js';
import { AssistantThinkingMessage } from './AssistantThinkingMessage.js';
import { getDisplayOnlyMcpTool } from './displayOnlyMcpTool.js';
import { useUiRenderHost } from '../hooks/useUiRenderHost.js';
import { PluginRenderedTree } from '../PluginRasterPanes.js';
import { useSelectedMessageBg } from '../messageActions.js';
import { PrBadge } from '../PrBadge.js';
import { ToolUseLoader } from '../ToolUseLoader.js';
import { UserAgentNotificationMessage } from './UserAgentNotificationMessage.js';
import { UserToolCanceledMessage } from './UserToolResultMessage/UserToolCanceledMessage.js';
import { UserToolErrorMessage } from './UserToolResultMessage/UserToolErrorMessage.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemCollapsed = feature('TEAMMEM')
  ? (require('./teamMemCollapsed.js') as typeof import('./teamMemCollapsed.js'))
  : null;
/* eslint-enable @typescript-eslint/no-require-imports */

// Hold each ⤿ hint for a minimum duration so fast-completing tool calls
// (bash commands, file reads, search patterns) are actually readable instead
// of flickering past in a single frame.
const MIN_HINT_DISPLAY_MS = 700;

/** densable `Ht` — first tool_use block per assistant / grouped_tool_use row. */
function toolUsesFromCollapsedGroup(
  message: CollapsedReadSearchGroup,
): Array<{ id: string; name: string; input: unknown }> {
  const uses: Array<{ id: string; name: string; input: unknown }> = [];
  for (const row of message.messages) {
    const assistants = row.type === 'assistant' ? [row] : row.type === 'grouped_tool_use' ? row.messages : [];
    for (const assistant of assistants) {
      const content = assistant.message?.content;
      const first = Array.isArray(content) ? content[0] : content;
      if (
        first !== undefined &&
        typeof first === 'object' &&
        first !== null &&
        'type' in first &&
        first.type === 'tool_use' &&
        'id' in first &&
        typeof first.id === 'string' &&
        'name' in first &&
        typeof first.name === 'string'
      ) {
        uses.push({
          id: first.id,
          name: first.name,
          input: 'input' in first ? first.input : undefined,
        });
      }
    }
  }
  return uses;
}

/** densable `ES` — `+added -removed`, omitted when both are zero. */
function LeftoverLineDiff({ added, removed }: { added: number; removed: number }): React.ReactNode {
  if (added === 0 && removed === 0) return null;
  return (
    <Text>
      {added > 0 && <Text color="diffAddedWord">+{added}</Text>}
      {added > 0 && removed > 0 ? ' ' : null}
      {removed > 0 && <Text color="diffRemovedWord">-{removed}</Text>}
    </Text>
  );
}

/**
 * densable Io `pc(m,l)` — hold `m` while set; when `m` becomes undefined,
 * keep the last value until `l` ms then clear.
 */
function leftoverPcHold(value: string | undefined, minMs: number): string | undefined {
  const [held, setHeld] = useState(value);
  const stamped = useRef(value !== undefined ? Date.now() : 0);
  useEffect(() => {
    if (value !== undefined) {
      stamped.current = Date.now();
      setHeld(value);
      return;
    }
    const remaining = minMs - (Date.now() - stamped.current);
    if (remaining <= 0) {
      setHeld(undefined);
      return;
    }
    const timer = setTimeout(() => setHeld(undefined), remaining);
    return () => clearTimeout(timer);
  }, [value, minMs]);
  return held;
}

type Props = {
  message: CollapsedReadSearchGroup;
  inProgressToolUseIDs: Set<string>;
  shouldAnimate: boolean;
  verbose: boolean;
  tools: Tools;
  lookups: ReturnType<typeof buildMessageLookups>;
  /** True if this is the currently active collapsed group (last one, still loading) */
  isActiveGroup?: boolean;
  addMargin?: boolean;
};

/** densable `ta` — errored/rejected/canceled tool result in verbose collapsed group */
function VerboseErroredToolResult({
  toolUseID,
  input,
  resultMsg,
  tool,
  tools,
  progressMessagesForMessage,
}: {
  toolUseID: string;
  input: unknown;
  resultMsg: ReturnType<typeof buildMessageLookups>['toolResultByToolUseID'] extends Map<string, infer V>
    ? V | undefined
    : never;
  tool: NonNullable<ReturnType<typeof findToolByName>>;
  tools: Tools;
  progressMessagesForMessage: ProgressMessage[];
}): React.ReactNode {
  const { columns } = useTerminalSize();
  const [theme] = useTheme();
  if (resultMsg?.type !== 'user' || !Array.isArray(resultMsg.message?.content)) {
    return null;
  }
  const block = (resultMsg.message.content as ToolResultBlockParam[]).find(
    b => b.type === 'tool_result' && b.tool_use_id === toolUseID,
  );
  if (block?.type !== 'tool_result') {
    return null;
  }
  if (typeof block.content === 'string' && block.content.startsWith(CANCEL_MESSAGE)) {
    return <UserToolCanceledMessage />;
  }
  const isRejected =
    (typeof block.content === 'string' &&
      (block.content.startsWith(REJECT_MESSAGE) ||
        (block.content.startsWith(REJECT_MESSAGE_WITH_REASON_PREFIX) &&
          tool.renderToolUseRejectedMessage !== undefined))) ||
    block.content === INTERRUPT_MESSAGE_FOR_TOOL_USE;
  if (isRejected) {
    if (!tool.renderToolUseRejectedMessage) {
      return <UserToolCanceledMessage />;
    }
    const parsedInput = tool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return <UserToolCanceledMessage />;
    }
    return (
      tool.renderToolUseRejectedMessage(parsedInput.data, {
        columns,
        messages: [],
        tools,
        verbose: true,
        progressMessagesForMessage: filterToolProgressMessages(progressMessagesForMessage),
        theme,
        isTranscriptMode: true,
      }) ?? <UserToolCanceledMessage />
    );
  }
  return (
    <UserToolErrorMessage
      param={block}
      tool={tool}
      tools={tools}
      input={input}
      output={resultMsg.toolUseResult}
      verbose={true}
      progressMessagesForMessage={progressMessagesForMessage}
      isTranscriptMode={true}
    />
  );
}

type VerboseToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };

/**
 * densable Qc: collapsed-group verbose ToolUse HAS host.
 * Rewrite → Xc `content` / `toolLabel` / `outputOverride:{value}`.
 */
function VerboseToolUseSite({
  content: sourceContent,
  tools,
  lookups,
  inProgressToolUseIDs,
  shouldAnimate,
  theme,
}: {
  content: VerboseToolUseBlock;
  tools: Tools;
  lookups: ReturnType<typeof buildMessageLookups>;
  inProgressToolUseIDs: Set<string>;
  shouldAnimate: boolean;
  theme: ThemeName;
}): React.ReactNode {
  const { columns, rows } = useTerminalSize();
  const panesViewport = useSyncExternalStore(subscribePanes, getPanesTerminalSize, getPanesTerminalSize);
  const viewportColumns = panesViewport?.conversationColumns ?? columns;
  const isRunning = inProgressToolUseIDs.has(sourceContent.id);
  const isErrored = lookups.erroredToolUseIDs.has(sourceContent.id);
  const resultMsg = lookups.toolResultByToolUseID.get(sourceContent.id);
  const isInterrupted = interruptedCall(resultMsg);
  const output = resultMsg?.type === 'user' ? resultMsg.toolUseResult : undefined;
  const rendered = useUiRenderHost({
    component: 'ToolUse',
    requestId: sourceContent.id,
    props: {
      tool_use_id: sourceContent.id,
      tool: sourceContent.name,
      input: sourceContent.input,
      isRunning,
      isErrored,
      isInterrupted,
      output,
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
  const content: VerboseToolUseBlock =
    rendered.props.input === sourceContent.input ? sourceContent : { ...sourceContent, input: rendered.props.input };
  const toolLabel =
    typeof rendered.props.tool === 'string' && rendered.props.tool !== sourceContent.name
      ? rendered.props.tool
      : undefined;
  // densable Qc: `outputOverride:q.props.output===U?void 0:{value:q.props.output}`
  const outputOverride = rendered.props.output === output ? undefined : { value: rendered.props.output };
  const engine = (
    <VerboseToolUse
      content={content}
      tools={tools}
      lookups={lookups}
      inProgressToolUseIDs={inProgressToolUseIDs}
      shouldAnimate={shouldAnimate}
      theme={theme}
      toolLabel={toolLabel}
      outputOverride={outputOverride}
    />
  );
  const inner =
    rendered.pluginTree === undefined ? (
      engine
    ) : (
      <PluginRenderedTree
        node={rendered.pluginTree}
        plugin={rendered.pluginName}
        requestId={sourceContent.id}
        component="ToolUse"
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
}

/** densable Xc: transcript tool_use row. `Ie=C!==void 0?C.value:user.toolUseResult`. */
function VerboseToolUse({
  content,
  tools,
  lookups,
  inProgressToolUseIDs,
  shouldAnimate,
  theme,
  toolLabel,
  outputOverride,
}: {
  content: VerboseToolUseBlock;
  tools: Tools;
  lookups: ReturnType<typeof buildMessageLookups>;
  inProgressToolUseIDs: Set<string>;
  shouldAnimate: boolean;
  theme: ThemeName;
  toolLabel?: string;
  outputOverride?: { value: unknown };
}): React.ReactNode {
  const bg = useSelectedMessageBg();
  // Same REPL-primitive fallback as getSearchExtraToolsOrReadInfo — REPL mode strips
  // these from the execution tools list, but virtual messages still need them
  // to render in verbose mode.
  const isErrorLookup = lookups.erroredToolUseIDs.has(content.id);
  const tool =
    findToolByName(tools, content.name) ??
    findToolByName(getReplPrimitiveTools(), content.name) ??
    getDisplayOnlyMcpTool(content.name, { isErrored: isErrorLookup });
  // densable Xc: `if(!le||le.isTransparentWrapper?.()) return null`
  if (!tool || tool.isTransparentWrapper?.()) return null;

  const isResolved = lookups.resolvedToolUseIDs.has(content.id);
  const isError = lookups.erroredToolUseIDs.has(content.id);
  const isInProgress = inProgressToolUseIDs.has(content.id);

  const resultMsg = lookups.toolResultByToolUseID.get(content.id);
  const rawToolResult =
    outputOverride !== undefined
      ? outputOverride.value
      : resultMsg?.type === 'user'
        ? resultMsg.toolUseResult
        : undefined;
  const parsedOutput = tool.outputSchema?.safeParse(rawToolResult);
  const toolResult = parsedOutput?.success ? parsedOutput.data : undefined;

  const parsedInput = tool.inputSchema.safeParse(content.input);
  const input = parsedInput.success ? parsedInput.data : undefined;
  const userFacingName = toolLabel ?? tool.userFacingName(input);
  const toolUseMessage = input ? tool.renderToolUseMessage(input, { theme, verbose: true }) : null;
  const progressMessages = lookups.progressMessagesByToolUseID.get(content.id) ?? [];
  const renderToolUseTag = tool.renderToolUseTag as
    | ((
        input: unknown,
        context?: {
          toolUseId: string;
          toolUseResult: unknown;
          progressMessages: unknown;
        },
      ) => React.ReactNode)
    | undefined;
  const successResult =
    isResolved && !isError && toolResult !== undefined
      ? tool.renderToolResultMessage?.(toolResult, filterToolProgressMessages(progressMessages), {
          verbose: true,
          tools,
          theme,
          isTranscriptMode: true,
          input: content.input,
        })
      : undefined;
  // #196 (2.1.326): clicking open a collapsed running command row in fullscreen
  // must render live output and timer via renderToolUseProgressMessage.
  const { columns, rows } = useTerminalSize();
  const liveProgressResult =
    !isResolved && isInProgress && tool.renderToolUseProgressMessage
      ? tool.renderToolUseProgressMessage(filterToolProgressMessages(progressMessages), {
          tools,
          verbose: true,
          terminalSize: { columns, rows },
          inProgressToolCallCount: 1,
          isTranscriptMode: true,
        })
      : undefined;
  const showError = isResolved && isError;
  // densable Xc: empty name + no success result + no live progress + no error row → null
  if (
    userFacingName === '' &&
    successResult == null &&
    liveProgressResult == null &&
    !(showError && resultMsg !== undefined)
  ) {
    return null;
  }

  return (
    <Box key={content.id} flexDirection="column" marginTop={1} backgroundColor={bg}>
      {userFacingName !== '' && (
        <Box flexDirection="row">
          <ToolUseLoader shouldAnimate={shouldAnimate && isInProgress} isUnresolved={!isResolved} isError={isError} />
          <Text>
            <Text bold>{userFacingName}</Text>
            {toolUseMessage && <Text>({toolUseMessage})</Text>}
          </Text>
          {input &&
            renderToolUseTag?.(input, {
              toolUseId: content.id,
              toolUseResult: rawToolResult,
              progressMessages: lookups.progressMessagesByToolUseID.get(content.id),
            })}
        </Box>
      )}
      {liveProgressResult != null && <Box>{liveProgressResult}</Box>}
      {successResult != null && <Box>{successResult}</Box>}
      {showError && (
        <VerboseErroredToolResult
          toolUseID={content.id}
          input={content.input}
          resultMsg={resultMsg}
          tool={tool}
          tools={tools}
          progressMessagesForMessage={progressMessages}
        />
      )}
    </Box>
  );
}

/**
 * densable Io `Zc` — live Thought clock. Folded: `max(1000,baseMs)`.
 * Gold live is `C&&E&&!$s`. Gold `Zc` `R=Hhr(y)` — session thinkingStartedAt.
 */
function LeftoverThoughtClock({
  baseMs,
  lastThinkingAtMs,
  live,
}: {
  baseMs: number;
  lastThinkingAtMs: number;
  live: boolean;
}): React.ReactNode {
  const leftoverIhrSession = getMainThreadAgentId();
  useLeftoverIhrStore();
  const leftoverHhrLive = useSyncExternalStore(
    leftoverIhrSubscribe,
    () => leftoverIhrThinkingStartedAt(leftoverIhrSession),
    () => leftoverIhrThinkingStartedAt(leftoverIhrSession),
  );
  const startedAt = live ? leftoverHhrLive : null;
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), startedAt !== null ? 1000 : null);
  return <Text bold>{formatDuration(leftoverZcMs(baseMs, lastThinkingAtMs, now, startedAt))}</Text>;
}

/** densable `og` — 2s live elapsed timer (` · Xs`) on active collapsed groups. */
function CollapsedToolElapsed({
  anchorMs,
  shouldAnimate,
}: {
  anchorMs: number;
  shouldAnimate: boolean;
}): React.ReactNode {
  const [, setTick] = useState(0);
  useInterval(() => setTick(t => t + 1), shouldAnimate ? 1000 : null);
  const elapsed = Date.now() - anchorMs;
  if (elapsed < 2000) {
    return null;
  }
  return <Text dimColor> · {formatDuration(elapsed)}</Text>;
}

/**
 * #157 & #111 (2.1.326, official mvs): determine whether a collapsed tool group
 * should render in active present-tense ("Running…" / "Calling…") or finished
 * past-tense ("Ran" / "Called").
 */
export function resolveCollapsedGroupActiveState({
  toolUseIds,
  inProgressToolUseIDs,
  lookups,
  isActiveGroupProp,
  isViewedAgentTerminal,
}: {
  toolUseIds: readonly string[];
  inProgressToolUseIDs: ReadonlySet<string>;
  lookups: ReturnType<typeof buildMessageLookups>;
  isActiveGroupProp: boolean;
  isViewedAgentTerminal: boolean;
}): boolean {
  if (isViewedAgentTerminal) return false;
  if (toolUseIds.some(id => inProgressToolUseIDs.has(id))) return true;
  if (toolUseIds.length === 0) return isActiveGroupProp;
  const hasWaitingCall = toolUseIds.some(
    id =>
      !lookups.resolvedToolUseIDs.has(id) &&
      !lookups.erroredToolUseIDs.has(id) &&
      !interruptedCall(lookups.toolResultByToolUseID.get(id)),
  );
  if (hasWaitingCall && isActiveGroupProp) return true;
  if (!hasWaitingCall) return false;
  return isActiveGroupProp;
}

/**
 * #192 (2.1.326): select the tool call that should supply the active fullscreen
 * tool group's display hint — preferring the currently running call over a
 * finished or still-queued call.
 */
export function selectActiveDisplayCall(
  uses: ReadonlyArray<{ id: string; name: string; input: unknown }>,
  inProgressToolUseIDs: ReadonlySet<string>,
  resolvedToolUseIDs: ReadonlySet<string>,
): { id: string; name: string; input: unknown } | undefined {
  if (uses.length === 0) return undefined;
  for (let i = uses.length - 1; i >= 0; i--) {
    if (inProgressToolUseIDs.has(uses[i]!.id)) return uses[i];
  }
  let lastResolvedIdx = -1;
  for (let i = uses.length - 1; i >= 0; i--) {
    if (resolvedToolUseIDs.has(uses[i]!.id)) {
      lastResolvedIdx = i;
      break;
    }
  }
  if (lastResolvedIdx + 1 < uses.length) {
    return uses[lastResolvedIdx + 1];
  }
  return uses.at(-1);
}

function formatCallDisplayHint(call: { name: string; input: unknown }): string | undefined {
  const safe = extractSafeToolInputFields(call.input);
  if (safe.command) return commandAsHint(safe.command);
  if (safe.file_path) return getDisplayPath(safe.file_path);
  if (safe.pattern) return `"${safe.pattern}"`;
  if (safe.query) return `"${safe.query}"`;
  return undefined;
}

export function CollapsedReadSearchContent({
  message,
  inProgressToolUseIDs,
  shouldAnimate,
  verbose: sourceVerbose,
  tools,
  lookups,
  isActiveGroup: isActiveGroupProp = false,
  addMargin = true,
}: Props): React.ReactNode {
  const bg = useSelectedMessageBg();
  const { columns, rows } = useTerminalSize();
  const panesViewport = useSyncExternalStore(subscribePanes, getPanesTerminalSize, getPanesTerminalSize);
  const viewportColumns = panesViewport?.conversationColumns ?? columns;
  const toolUsesForRender = toolUsesFromCollapsedGroup(message);
  const rendered = useUiRenderHost({
    component: 'ToolGroup',
    requestId: message.uuid,
    props: {
      calls: toolUsesForRender.map(use => {
        const result = lookups.toolResultByToolUseID.get(use.id);
        return {
          tool_use_id: use.id,
          tool: use.name,
          input: use.input,
          isRunning: inProgressToolUseIDs.has(use.id),
          isErrored: lookups.erroredToolUseIDs.has(use.id),
          isInterrupted: interruptedCall(result),
          output: result?.type === 'user' ? result.toolUseResult : undefined,
        };
      }),
      isActive: isActiveGroupProp === true,
      isExpanded: sourceVerbose,
    },
    viewport: { columns: viewportColumns, rows },
  });
  const wrapToolGroupHost = (engineNode: React.ReactNode): React.ReactNode => {
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
    const tree =
      rendered.pluginTree !== undefined ? (
        <PluginRenderedTree
          node={rendered.pluginTree}
          plugin={rendered.pluginName}
          requestId={message.uuid}
          component="ToolGroup"
          engine={engineNode}
        />
      ) : (
        engineNode
      );
    if (tree === null && rendered.minHeight === undefined) {
      return null;
    }
    return (
      <Box
        ref={rendered.hostRef as React.Ref<DOMElement>}
        flexDirection="column"
        {...(rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
      >
        {tree}
      </Box>
    );
  };
  const verbose = rendered.props.isExpanded === true;
  const {
    searchCount: rawSearchCount,
    readCount: rawReadCount,
    listCount: rawListCount,
    replCount,
    memorySearchCount,
    memoryReadCount,
    memoryWriteCount,
    messages: groupMessages,
  } = message;
  const [theme] = useTheme();
  const toolUseIds = getToolUseIdsFromCollapsedGroup(message);
  // #111 (2.1.326): a stopped/failed/completed background agent's last command
  // must never remain stuck showing "Running…".
  const isViewedAgentTerminal = useAppState(s => {
    const id = s.viewingAgentTaskId;
    if (!id) return false;
    const task = s.tasks[id];
    return task !== undefined && (task.status === 'killed' || task.status === 'failed' || task.status === 'completed');
  });
  const isActiveGroup = resolveCollapsedGroupActiveState({
    toolUseIds,
    inProgressToolUseIDs,
    lookups,
    isActiveGroupProp,
    isViewedAgentTerminal,
  });
  const anyError = toolUseIds.some(id => lookups.erroredToolUseIDs.has(id));
  // densable V6 `fe` — Nvo/interruptedCall on any tool_result in the group.
  const anyInterrupted = toolUseIds.some(id => interruptedCall(lookups.toolResultByToolUseID.get(id)));
  const hasMemoryOps = memorySearchCount > 0 || memoryReadCount > 0 || memoryWriteCount > 0;
  const hasTeamMemoryOps = feature('TEAMMEM') ? teamMemCollapsed!.checkHasTeamMemOps(message) : false;

  // Track the max seen counts so they only ever increase. The debounce timer
  // causes extra re-renders at arbitrary times; during a brief "invisible window"
  // in the streaming executor the group count can dip, which causes jitter.
  const maxReadCountRef = useRef(0);
  const maxSearchCountRef = useRef(0);
  const maxListCountRef = useRef(0);
  const maxMcpCountRef = useRef(0);
  const maxBashCountRef = useRef(0);
  maxReadCountRef.current = Math.max(maxReadCountRef.current, rawReadCount);
  maxSearchCountRef.current = Math.max(maxSearchCountRef.current, rawSearchCount);
  maxListCountRef.current = Math.max(maxListCountRef.current, rawListCount);
  const failedMcpCallCount = message.failedMcpCallCount ?? 0;
  maxMcpCountRef.current = Math.max(maxMcpCountRef.current, (message.mcpCallCount ?? 0) + failedMcpCallCount);
  maxBashCountRef.current = Math.max(maxBashCountRef.current, message.bashCount ?? 0);
  const readCount = maxReadCountRef.current;
  const searchCount = maxSearchCountRef.current;
  const listCount = maxListCountRef.current;
  const mcpCallCount = Math.max(0, maxMcpCountRef.current - failedMcpCallCount);
  // Subtract commands surfaced as "Committed …" / "Created PR …" so the
  // same command isn't counted twice. gitOpBashCount is read live (no max-ref
  // needed — it's 0 until results arrive, then only grows).
  // #158 & #193 (2.1.326): Only deduct Bash calls that NEVER ran (interrupted /
  // rejected / blocked) and are NOT classified as search/list/read; commands that
  // actually ran and exited non-zero remain counted and get `· N failed`.
  const gitOpBashCount = message.gitOpBashCount ?? 0;
  let nonRunBashCount = 0;
  if (isFullscreenEnvEnabled()) {
    for (const gm of groupMessages) {
      const assistants = gm.type === 'grouped_tool_use' ? gm.messages : gm.type === 'assistant' ? [gm] : [];
      for (const assistant of assistants) {
        if (!Array.isArray(assistant.message.content)) continue;
        for (const block of assistant.message.content) {
          if (typeof block !== 'object' || block === null || block.type !== 'tool_use') continue;
          if (block.name !== 'Bash' && block.name !== 'PowerShell') continue;
          const info = getToolSearchOrReadInfo(block.name, block.input, tools);
          if (info.isSearch || info.isList || info.isRead) continue;
          const tr = lookups.toolResultByToolUseID.get(block.id);
          const trBlock =
            tr?.type === 'user' && Array.isArray(tr.message?.content)
              ? (tr.message.content.find(
                  (b): b is ToolResultBlockParam =>
                    typeof b === 'object' &&
                    b !== null &&
                    'type' in b &&
                    b.type === 'tool_result' &&
                    b.tool_use_id === block.id,
                ) ?? undefined)
              : undefined;
          const trContent = typeof trBlock?.content === 'string' ? trBlock.content : '';
          const isDeniedOrRejected =
            trBlock?.is_error === true &&
            (trContent === REJECT_MESSAGE ||
              trContent.startsWith(REJECT_MESSAGE_WITH_REASON_PREFIX) ||
              trContent.includes('permission denied') ||
              trContent.includes('not run') ||
              (tr as { toolDenialKind?: string } | undefined)?.toolDenialKind !== undefined);
          if (interruptedCall(tr) || isDeniedOrRejected) {
            nonRunBashCount++;
          }
        }
      }
    }
  }
  const effectiveRawBashCount = isActiveGroup ? maxBashCountRef.current : (message.bashCount ?? 0);
  const bashCount = isFullscreenEnvEnabled()
    ? Math.max(0, effectiveRawBashCount - gitOpBashCount - nonRunBashCount)
    : 0;

  // densable ySu brief extras: agent / edit / other / frame
  const agentCount = message.agentCount ?? 0;
  const editFileCount = message.editFileCount ?? 0;
  const otherToolCount = message.otherToolCount ?? 0;
  const frameCount = message.frameCount ?? 0;
  const linesAdded = message.linesAdded ?? 0;
  const linesRemoved = message.linesRemoved ?? 0;
  const scratchpadWriteCount = message.scratchpadWriteCount ?? 0;
  const workshopWriteCount = message.workshopWriteCount ?? 0;
  const accountMemoryKeyCount = message.accountMemoryReadKeys?.length ?? 0;
  const accountMemorySearchCount = message.accountMemorySearchCount ?? 0;
  const hasAccountMemory = accountMemoryKeyCount > 0 || accountMemorySearchCount > 0;

  const hasNonMemoryOps =
    searchCount > 0 ||
    readCount > 0 ||
    listCount > 0 ||
    replCount > 0 ||
    mcpCallCount > 0 ||
    bashCount > 0 ||
    gitOpBashCount > 0 ||
    agentCount > 0 ||
    editFileCount > 0 ||
    otherToolCount > 0 ||
    frameCount > 0 ||
    scratchpadWriteCount > 0 ||
    workshopWriteCount > 0 ||
    (message.hookTotalMs ?? 0) > 0;

  const thoughtForMs = message.thoughtForMs ?? 0;
  // densable Io: `Mo>0||l.latestThinkingSummary!==void 0`. Empty Ss still
  // stamps thoughtForMs; the collapsed row stays after fold.
  const hasThoughtFor = thoughtForMs > 0 || message.latestThinkingSummary !== undefined;

  const readPaths = message.readFilePaths;
  const searchArgs = message.searchArgs;
  let incomingHint = message.latestDisplayHint;
  // #192 (2.1.326): in fullscreen mode while active, prefer the currently
  // running call over a finished or queued call for the displayed hint.
  if (isActiveGroup && isFullscreenEnvEnabled()) {
    const uses = toolUsesFromCollapsedGroup(message);
    const activeCall = selectActiveDisplayCall(uses, inProgressToolUseIDs, lookups.resolvedToolUseIDs);
    if (activeCall) {
      const activeHint = formatCallDisplayHint(activeCall);
      if (activeHint !== undefined) {
        incomingHint = activeHint;
      }
    }
  }
  if (incomingHint === undefined) {
    const lastSearchRaw = searchArgs?.at(-1);
    const lastSearch = lastSearchRaw !== undefined ? `"${lastSearchRaw}"` : undefined;
    const lastRead = readPaths?.at(-1);
    incomingHint = lastRead !== undefined ? getDisplayPath(lastRead) : lastSearch;
  }

  // Active REPL calls emit repl_tool_call progress with the current inner
  // tool's name+input. Virtual messages don't arrive until REPL completes,
  // so this is the only source of a live hint during execution.
  if (isActiveGroup) {
    for (const id of toolUseIds) {
      if (!inProgressToolUseIDs.has(id)) continue;
      const latest = lookups.progressMessagesByToolUseID.get(id)?.at(-1)?.data as Record<string, unknown> | undefined;
      // densable 2.1.229 #7: nst(et.toolInput) before display — non-string
      // file_path/pattern/command from resume must not reach getDisplayPath.
      if (latest?.type === 'repl_tool_call' && (latest.phase === 'start' || latest.phase === 'executing')) {
        const safe = extractSafeToolInputFields(latest.toolInput);
        incomingHint =
          safe.file_path ??
          (safe.pattern ? `"${safe.pattern}"` : undefined) ??
          safe.command ??
          (latest.toolName as string | undefined);
      } else if (latest?.type === 'mcp_progress') {
        const progress = typeof latest.progress === 'number' ? latest.progress : undefined;
        const total = typeof latest.total === 'number' ? latest.total : undefined;
        const progressMessage = typeof latest.progressMessage === 'string' ? latest.progressMessage.trim() : '';
        if (progress !== undefined && total !== undefined && total > 0) {
          const pct = Math.round(Math.min(1, Math.max(0, progress / total)) * 100);
          incomingHint = progressMessage ? `${progressMessage} (${pct}%)` : `${pct}%`;
        } else if (progressMessage) {
          incomingHint = progressMessage;
        } else if (progress !== undefined) {
          incomingHint = `Processing… ${progress}`;
        }
      }
    }
  }

  const displayedHint = useMinDisplayTime(incomingHint, MIN_HINT_DISPLAY_MS);

  // densable `$s` summary hold: `CC=pc(C&&!$s?l.latestThinkingSummary:void 0,Mb)`
  // then `ka=em?CC:aB`. Gold absorb is `Tr(tn(thinking))`, not the raw body.
  const leftoverSs = leftoverPcHold(
    isActiveGroup === true && message.isLiveBriefTurn !== true ? message.latestThinkingSummary : undefined,
    LEFTOVER_SS_HOLD_MS,
  );
  const leftoverEm = leftoverSs !== undefined;
  const effectiveHint = leftoverEm ? leftoverSs : displayedHint;

  // In verbose mode, render each tool use with its 1-line result summary
  if (verbose) {
    const toolUses: NormalizedAssistantMessage[] = [];
    const taskNotificationRows: React.ReactNode[] = [];
    for (const msg of groupMessages) {
      if (msg.type === 'assistant') {
        toolUses.push(msg);
      } else if (msg.type === 'grouped_tool_use') {
        toolUses.push(...msg.messages);
      } else if (msg.type === 'user') {
        const first = (msg.message.content as Array<{ type?: string; text?: string }> | undefined)?.[0];
        if (
          first?.type === 'text' &&
          typeof first.text === 'string' &&
          first.text.includes(`<${TASK_NOTIFICATION_TAG}`)
        ) {
          taskNotificationRows.push(
            <Box key={msg.uuid} marginTop={1}>
              <UserAgentNotificationMessage addMargin={false} param={{ type: 'text', text: first.text }} />
            </Box>,
          );
        }
      }
    }

    // densable 2.1.289: verbose map uses content[0] only —
    // thinking && thinking → Ss; else if not tool_use → skip; else Qc.
    // Empty / redacted / summary fallbacks are analog — invent-ban for 1:1.
    const verboseRows: React.ReactNode[] = [];
    for (const msg of toolUses) {
      const blocks = msg.message.content as Array<{
        type: string;
        id?: string;
        name?: string;
        input?: unknown;
        thinking?: string;
      }>;
      const content = blocks[0];
      if (content?.type === 'thinking' && content.thinking) {
        verboseRows.push(
          <Box key={`${msg.uuid}-thinking`} marginTop={1}>
            <AssistantThinkingMessage
              param={{ type: 'thinking', thinking: content.thinking }}
              addMargin={false}
              isTranscriptMode={true}
              verbose={true}
            />
          </Box>,
        );
        continue;
      }
      if (content?.type !== 'tool_use' || !content.id) continue;
      verboseRows.push(
        <VerboseToolUseSite
          key={content.id}
          content={content as VerboseToolUseBlock}
          tools={tools}
          lookups={lookups}
          inProgressToolUseIDs={inProgressToolUseIDs}
          shouldAnimate={shouldAnimate}
          theme={theme}
        />,
      );
    }
    const hookBlock =
      message.hookInfos && message.hookInfos.length > 0 ? (
        <>
          <Text dimColor>
            {'  ⎿  '}Ran {message.hookCount} PreToolUse {message.hookCount === 1 ? 'hook' : 'hooks'} (
            {formatSecondsShort(message.hookTotalMs ?? 0)})
          </Text>
          {message.hookInfos.map((info, idx) => (
            <Text key={`hook-${idx}`} dimColor>
              {'     ⎿ '}
              {info.command} ({formatSecondsShort(info.durationMs ?? 0)})
            </Text>
          ))}
        </>
      ) : null;
    const memoryRows = message.relevantMemories?.map(m => (
      <Box key={m.path} flexDirection="column" marginTop={1}>
        <Text dimColor>
          {'  ⎿  '}Recalled {basename(m.path)}
        </Text>
        <Box paddingLeft={5}>
          <Text>
            <Ansi>{m.content}</Ansi>
          </Text>
        </Box>
      </Box>
    ));
    // densable always returns the verbose column (may be empty Ss list), wrapped
    // through ac.useRenderHook ("ToolGroup") so pluginTree / hostRef / minHeight apply.
    return wrapToolGroupHost(
      <Box flexDirection="column">
        {taskNotificationRows}
        {verboseRows}
        {hookBlock}
        {memoryRows}
      </Box>,
    );
  }

  // Non-verbose mode: Show counts with blinking grey dot while active, green dot when finalized
  // Use present tense when active, past tense when finalized

  // Defensive: If all counts are 0, don't render the collapsed group
  // This shouldn't happen in normal operation, but handles edge cases
  if (!hasMemoryOps && !hasTeamMemoryOps && !hasNonMemoryOps && !hasThoughtFor && !hasAccountMemory) {
    return wrapToolGroupHost(null);
  }

  // Find the slowest in-progress shell command in this group. BashTool yields
  // progress every second but the collapsed renderer never showed it — long
  // commands (npm install, tests) looked frozen. Shown after 2s so fast
  // commands stay clean; the ticking counter reassures that slow ones aren't stuck.
  let shellProgressSuffix = '';
  if (isFullscreenEnvEnabled() && isActiveGroup) {
    let elapsed: number | undefined;
    let lines = 0;
    for (const id of toolUseIds) {
      if (!inProgressToolUseIDs.has(id)) continue;
      const data = lookups.progressMessagesByToolUseID.get(id)?.at(-1)?.data as Record<string, unknown> | undefined;
      if (data?.type !== 'bash_progress' && data?.type !== 'powershell_progress') {
        continue;
      }
      const elapsedSec = data.elapsedTimeSeconds as number | undefined;
      const totalLines = data.totalLines as number | undefined;
      if (elapsed === undefined || (elapsedSec ?? 0) > elapsed) {
        elapsed = elapsedSec;
        lines = totalLines ?? 0;
      }
    }
    if (elapsed !== undefined && elapsed >= 2) {
      const time = formatDuration(elapsed * 1000);
      shellProgressSuffix = lines > 0 ? ` (${time} · ${lines} ${lines === 1 ? 'line' : 'lines'})` : ` (${time})`;
    }
  }

  // #193 (2.1.326): track when each tool ID actually enters inProgressToolUseIDs
  // so the fullscreen tool timer excludes time spent waiting at a permission
  // prompt or queued behind another command.
  const toolRunStartedAtRef = useRef<Map<string, number>>(new Map());
  let activeToolAnchorMs = 0;
  if (isActiveGroup && isFullscreenEnvEnabled()) {
    const nowMs = Date.now();
    for (const id of toolUseIds) {
      if (inProgressToolUseIDs.has(id) && !toolRunStartedAtRef.current.has(id)) {
        toolRunStartedAtRef.current.set(id, nowMs);
      }
    }
    for (let i = groupMessages.length - 1; i >= 0 && !activeToolAnchorMs; i--) {
      const item = groupMessages[i];
      const assistants = item?.type === 'grouped_tool_use' ? item.messages : item?.type === 'assistant' ? [item] : [];
      for (const assistant of assistants) {
        const blocks = assistant.message.content as Array<{ type: string; id?: string }>;
        const runningBlock = blocks.find(
          b => b.type === 'tool_use' && b.id !== undefined && inProgressToolUseIDs.has(b.id),
        );
        if (runningBlock?.id) {
          const ts = typeof assistant.timestamp === 'string' ? Date.parse(assistant.timestamp) : Number.NaN;
          const runStart = toolRunStartedAtRef.current.get(runningBlock.id) ?? 0;
          const base = Number.isFinite(ts) ? Math.max(ts, runStart) : runStart;
          if (base > 0) {
            activeToolAnchorMs = base;
            break;
          }
        }
      }
    }
  }

  // Build non-memory parts first (edit, search, read, repl, mcp, agent, other, bash)
  // densable order: edit → git → frame → search → read → list → repl → mcp → agent → other → bash
  const nonMemParts: React.ReactNode[] = [];

  // Git operations lead the line — they're the load-bearing outcome.
  function pushPart(key: string, verb: string, body: React.ReactNode | null): void {
    const isFirst = nonMemParts.length === 0;
    if (!isFirst) nonMemParts.push(<Text key={`comma-${key}`}>, </Text>);
    const verbText = isFirst ? verb[0]!.toUpperCase() + verb.slice(1) : verb;
    nonMemParts.push(
      <Text key={key}>
        {verbText}
        {body != null ? <> {body}</> : null}
      </Text>,
    );
  }

  // densable Io: Thought/Thinking for <duration> leads the collapsed line.
  // Gold live `C&&E&&!$s` uses `Zc({baseMs,lastThinkingAtMs})`; folded is max(1000,Mo).
  if (hasThoughtFor) {
    const label = isActiveGroup ? 'Thinking' : 'Thought';
    const lastThinkingAtMs = leftoverLastThinkingAtMs(groupMessages);
    const liveClock = isActiveGroup === true && isFullscreenEnvEnabled() && message.isLiveBriefTurn !== true;
    nonMemParts.push(
      <Text key="thought">
        {label} for <LeftoverThoughtClock baseMs={thoughtForMs} lastThinkingAtMs={lastThinkingAtMs} live={liveClock} />
      </Text>,
    );
  }

  // densable: edited N files +lines -lines
  if (editFileCount > 0) {
    const verb = isActiveGroup ? 'editing' : 'edited';
    pushPart(
      'edit',
      verb,
      <Text>
        <Text bold>{editFileCount}</Text> {editFileCount === 1 ? 'file' : 'files'}{' '}
        <LeftoverLineDiff added={linesAdded} removed={linesRemoved} />
      </Text>,
    );
  }

  // densable Jc: scratchpad then workshop, immediately after file edits.
  if (scratchpadWriteCount > 0) {
    const verb = isActiveGroup ? 'making' : 'made';
    pushPart(
      'scratchpad',
      verb,
      <Text>
        <Text bold>{scratchpadWriteCount}</Text> scratchpad {scratchpadWriteCount === 1 ? 'edit' : 'edits'}{' '}
        <LeftoverLineDiff added={message.scratchpadLinesAdded ?? 0} removed={message.scratchpadLinesRemoved ?? 0} />
      </Text>,
    );
  }
  if (workshopWriteCount > 0) {
    const verb = isActiveGroup ? 'making' : 'made';
    pushPart(
      'workshop',
      verb,
      <Text>
        <Text bold>{workshopWriteCount}</Text> page {workshopWriteCount === 1 ? 'edit' : 'edits'}{' '}
        <LeftoverLineDiff added={message.workshopLinesAdded ?? 0} removed={message.workshopLinesRemoved ?? 0} />
      </Text>,
    );
  }

  if (isFullscreenEnvEnabled() && message.commits?.length) {
    const byKind = {
      committed: 'committed',
      amended: 'amended commit',
      'cherry-picked': 'cherry-picked',
    };
    for (const kind of ['committed', 'amended', 'cherry-picked'] as const) {
      const shas = message.commits.filter(c => c.kind === kind).map(c => c.sha);
      if (shas.length) {
        pushPart(kind, byKind[kind], <Text bold>{shas.join(', ')}</Text>);
      }
    }
  }
  if (isFullscreenEnvEnabled() && message.pushes?.length) {
    const branches = uniq(message.pushes.map(p => p.branch));
    pushPart('push', 'pushed to', <Text bold>{branches.join(', ')}</Text>);
  }
  if (isFullscreenEnvEnabled() && message.branches?.length) {
    const byAction = { merged: 'merged', rebased: 'rebased onto' };
    for (const b of message.branches) {
      pushPart(`br-${b.action}-${b.ref}`, byAction[b.action], <Text bold>{b.ref}</Text>);
    }
  }
  if (isFullscreenEnvEnabled() && message.prs?.length) {
    const verbs: Record<string, string> = {
      created: 'created',
      edited: 'edited',
      merged: 'merged',
      commented: 'commented on',
      closed: 'closed',
      reopened: 'reopened',
      ready: 'marked ready',
      draft: 'marked draft',
      'auto-merge-enabled': 'enabled auto-merge on',
      'auto-merge-disabled': 'disabled auto-merge on',
    };
    for (const pr of message.prs) {
      const verb = verbs[pr.action];
      if (!verb) continue;
      const isGitLabMr = pr.url !== undefined && /\/-\/merge_requests\/\d+/.test(pr.url);
      pushPart(
        `pr-${pr.action}-${pr.number}`,
        verb,
        pr.url ? (
          <PrBadge number={pr.number} url={pr.url} bold kind={isGitLabMr ? 'mr' : undefined} />
        ) : (
          <Text bold>
            {isGitLabMr ? 'MR !' : 'PR #'}
            {pr.number}
          </Text>
        ),
      );
    }
  }

  // densable: frame after git, before search
  if (frameCount > 0) {
    pushPart('frame', isActiveGroup ? 'publishing' : 'published', null);
  }

  if (searchCount > 0) {
    const isFirst = nonMemParts.length === 0;
    const searchVerb = isActiveGroup
      ? isFirst
        ? 'Searching for'
        : 'searching for'
      : isFirst
        ? 'Searched for'
        : 'searched for';
    if (!isFirst) {
      nonMemParts.push(<Text key="comma-s">, </Text>);
    }
    nonMemParts.push(
      <Text key="search">
        {searchVerb} <Text bold>{searchCount}</Text> {searchCount === 1 ? 'pattern' : 'patterns'}
      </Text>,
    );
  }

  if (readCount > 0) {
    const isFirst = nonMemParts.length === 0;
    const readVerb = isActiveGroup ? (isFirst ? 'Reading' : 'reading') : isFirst ? 'Read' : 'read';
    if (!isFirst) {
      nonMemParts.push(<Text key="comma-r">, </Text>);
    }
    nonMemParts.push(
      <Text key="read">
        {readVerb} <Text bold>{readCount}</Text> {readCount === 1 ? 'file' : 'files'}
      </Text>,
    );
  }

  if (listCount > 0) {
    const isFirst = nonMemParts.length === 0;
    const listVerb = isActiveGroup ? (isFirst ? 'Listing' : 'listing') : isFirst ? 'Listed' : 'listed';
    if (!isFirst) {
      nonMemParts.push(<Text key="comma-l">, </Text>);
    }
    nonMemParts.push(
      <Text key="list">
        {listVerb} <Text bold>{listCount}</Text> {listCount === 1 ? 'directory' : 'directories'}
      </Text>,
    );
  }

  if (replCount > 0) {
    const replVerb = isActiveGroup ? "REPL'ing" : "REPL'd";
    if (nonMemParts.length > 0) {
      nonMemParts.push(<Text key="comma-repl">, </Text>);
    }
    nonMemParts.push(
      <Text key="repl">
        {replVerb} <Text bold>{replCount}</Text> {replCount === 1 ? 'time' : 'times'}
      </Text>,
    );
  }

  // Official 2.1.323 (#2042 / #2063): detect stopped/cut MCP or fullscreen
  // shell calls (no result recorded) and user-rejected calls (rejected with
  // reason) inside this collapsed tool group.
  const isFullscreen = isFullscreenEnvEnabled();
  type CutToolInfo = { id: string; name: string; isBash: boolean; input: unknown; didNotRun: boolean };
  const cutCalls: CutToolInfo[] = [];
  let cutMcpCount = 0;
  let cutBashCount = 0;
  let rejectedWithReasonCount = 0;
  let blockedCount = 0;
  let failedCount = 0;
  for (const item of groupMessages) {
    const assistants = item.type === 'grouped_tool_use' ? item.messages : item.type === 'assistant' ? [item] : [];
    for (const assistant of assistants) {
      const blocks = assistant.message.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>;
      for (const block of blocks) {
        if (block.type !== 'tool_use' || !block.id || !block.name) continue;
        const resultMsg = lookups.toolResultByToolUseID.get(block.id);
        const resultBlock =
          resultMsg?.type === 'user' && Array.isArray(resultMsg.message?.content)
            ? (resultMsg.message.content.find(
                (b): b is ToolResultBlockParam =>
                  typeof b === 'object' &&
                  b !== null &&
                  'type' in b &&
                  b.type === 'tool_result' &&
                  b.tool_use_id === block.id,
              ) ?? undefined)
            : undefined;
        const resultContent = typeof resultBlock?.content === 'string' ? resultBlock.content : '';
        const isCutResult =
          !isActiveGroup &&
          (!resultBlock ||
            resultContent === INTERRUPT_MESSAGE_FOR_TOOL_USE ||
            resultContent === CANCEL_MESSAGE ||
            resultContent.startsWith('[Tool call skipped:') ||
            resultContent.startsWith('[Tool call interrupted:') ||
            resultContent.startsWith('[Tool call not completed:'));
        const isRejected =
          resultBlock?.is_error === true &&
          (resultContent.startsWith(REJECT_MESSAGE_WITH_REASON_PREFIX) || resultContent === REJECT_MESSAGE);
        const denialKind = (resultMsg as { toolDenialKind?: string } | undefined)?.toolDenialKind;
        const isBlocked =
          resultBlock?.is_error === true &&
          !isRejected &&
          (denialKind === 'automode-blocked' ||
            denialKind === 'blocked' ||
            resultContent.toLowerCase().includes('permission denied') ||
            resultContent.toLowerCase().includes('blocked by'));
        const isSkipped = resultContent.startsWith('[Tool call skipped:');
        const isBashTool =
          (block.name === 'Bash' || block.name === 'PowerShell') &&
          !(() => {
            const info = getToolSearchOrReadInfo(block.name, block.input, tools);
            return info.isSearch || info.isList || info.isRead;
          })();
        const isMcpTool = block.name.startsWith('mcp__');
        if (isCutResult && (isMcpTool || (isFullscreen && isBashTool))) {
          cutCalls.push({
            id: block.id,
            name: block.name,
            isBash: isBashTool,
            input: block.input,
            didNotRun: isSkipped,
          });
          if (isMcpTool) cutMcpCount++;
          if (isBashTool) cutBashCount++;
        } else if (isRejected) {
          rejectedWithReasonCount++;
        } else if (isBlocked) {
          blockedCount++;
        } else if (!isActiveGroup && resultBlock?.is_error === true && !isCutResult) {
          // #158 (2.1.326): commands/tools that ran and failed show `· N failed`.
          failedCount++;
        }
      }
    }
  }

  let cutInputPreview: string | undefined;
  if (cutCalls.length > 0) {
    const firstCut = cutCalls[0]!;
    if (firstCut.input && typeof firstCut.input === 'object' && !Array.isArray(firstCut.input)) {
      const rec = firstCut.input as Record<string, unknown>;
      if (firstCut.isBash && typeof rec.command === 'string' && rec.command.trim()) {
        const lines = rec.command.trim().split('\n');
        cutInputPreview = lines.length > 3 ? `${lines.slice(0, 3).join('\n')}…` : lines.join('\n');
      } else {
        const safeFields = extractSafeToolInputFields(rec);
        const entries = Object.entries(safeFields);
        if (entries.length > 0) {
          cutInputPreview = entries
            .slice(0, 3)
            .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
            .join(', ');
        }
      }
    }
  }

  const effectiveMcpCallCount = Math.max(0, mcpCallCount - cutMcpCount);
  if (effectiveMcpCallCount > 0) {
    const serverLabel = message.mcpServerNames?.map(n => n.replace(/^claude\.ai /, '')).join(', ') || 'MCP';
    const isFirst = nonMemParts.length === 0;
    // densable focus uses "calling/called"; local non-focus still "querying"
    const verb = isActiveGroup ? (isFirst ? 'Calling' : 'calling') : isFirst ? 'Called' : 'called';
    if (!isFirst) {
      nonMemParts.push(<Text key="comma-mcp">, </Text>);
    }
    nonMemParts.push(
      <Text key="mcp">
        {verb} {serverLabel}
        {effectiveMcpCallCount > 1 && (
          <>
            {' '}
            <Text bold>{effectiveMcpCallCount}</Text> times
          </>
        )}
      </Text>,
    );
  }

  // densable: ran/running N agents · description
  if (agentCount > 0) {
    const desc = agentCount === 1 ? (message as { agentDescriptions?: string[] }).agentDescriptions?.[0] : undefined;
    const verb = isActiveGroup ? 'running' : 'ran';
    if (desc !== undefined) {
      pushPart(
        'agent',
        verb,
        <Text>
          agent · <Text bold>{desc}</Text>
        </Text>,
      );
    } else {
      pushPart(
        'agent',
        verb,
        <Text>
          <Text bold>{agentCount}</Text> {agentCount === 1 ? 'agent' : 'agents'}
        </Text>,
      );
    }
  }

  if (otherToolCount > 0) {
    const verb = isActiveGroup ? 'calling' : 'called';
    pushPart(
      'other',
      verb,
      <Text>
        <Text bold>{otherToolCount}</Text> {otherToolCount === 1 ? 'tool' : 'tools'}
      </Text>,
    );
  }

  const effectiveBashCount = Math.max(0, bashCount - cutBashCount);
  if (isFullscreen && effectiveBashCount > 0) {
    const isFirst = nonMemParts.length === 0;
    const verb = isActiveGroup ? (isFirst ? 'Running' : 'running') : isFirst ? 'Ran' : 'ran';
    if (!isFirst) {
      nonMemParts.push(<Text key="comma-bash">, </Text>);
    }
    nonMemParts.push(
      <Text key="bash">
        {verb} <Text bold>{effectiveBashCount}</Text> shell {effectiveBashCount === 1 ? 'command' : 'commands'}
      </Text>,
    );
  }

  const didNotRunCount = cutCalls.filter(c => c.didNotRun).length;
  const noResultRecordedCount = cutCalls.length - didNotRunCount;
  if (noResultRecordedCount > 0) {
    const hadOtherParts = nonMemParts.length > 0;
    pushPart(
      'cut',
      'no result recorded for',
      <Text>
        <Text bold>{noResultRecordedCount}</Text> {hadOtherParts ? 'other ' : ''}
        {noResultRecordedCount === 1 ? 'call' : 'calls'}
      </Text>,
    );
  }
  if (didNotRunCount > 0) {
    const hadOtherParts = nonMemParts.length > 0;
    pushPart(
      'did-not-run',
      'did not run',
      <Text>
        <Text bold>{didNotRunCount}</Text> {hadOtherParts ? 'other ' : ''}
        {didNotRunCount === 1 ? 'call' : 'calls'}
      </Text>,
    );
  }
  // #158 (2.1.326): if all calls in the group were blocked or rejected and nothing else ran,
  // say clearly that they did not run rather than leaving an empty or passing summary.
  if (!isActiveGroup && nonMemParts.length === 0 && (blockedCount > 0 || rejectedWithReasonCount > 0)) {
    const totalNotRun = blockedCount + rejectedWithReasonCount;
    pushPart(
      'not-run-summary',
      'did not run',
      <Text>
        <Text bold>{totalNotRun}</Text> {totalNotRun === 1 ? 'call' : 'calls'}
      </Text>,
    );
  }

  // Build memory parts (auto-memory) — rendered after nonMemParts
  const hasPrecedingNonMem = nonMemParts.length > 0;
  const memParts: React.ReactNode[] = [];

  if (memoryReadCount > 0) {
    const isFirst = !hasPrecedingNonMem && memParts.length === 0;
    const verb = isActiveGroup ? (isFirst ? 'Recalling' : 'recalling') : isFirst ? 'Recalled' : 'recalled';
    if (!isFirst) {
      memParts.push(<Text key="comma-mr">, </Text>);
    }
    memParts.push(
      <Text key="mem-read">
        {verb} <Text bold>{memoryReadCount}</Text> {hasAccountMemory ? 'local ' : ''}
        {memoryReadCount === 1 ? 'memory' : 'memories'}
      </Text>,
    );
  }

  if (memorySearchCount > 0) {
    const isFirst = !hasPrecedingNonMem && memParts.length === 0;
    const verb = isActiveGroup ? (isFirst ? 'Searching' : 'searching') : isFirst ? 'Searched' : 'searched';
    if (!isFirst) {
      memParts.push(<Text key="comma-ms">, </Text>);
    }
    memParts.push(<Text key="mem-search">{`${verb} memories`}</Text>);
  }

  if (memoryWriteCount > 0) {
    const isFirst = !hasPrecedingNonMem && memParts.length === 0;
    const verb = isActiveGroup ? (isFirst ? 'Writing' : 'writing') : isFirst ? 'Wrote' : 'wrote';
    if (!isFirst) {
      memParts.push(<Text key="comma-mw">, </Text>);
    }
    memParts.push(
      <Text key="mem-write">
        {verb} <Text bold>{memoryWriteCount}</Text> {memoryWriteCount === 1 ? 'memory' : 'memories'}
      </Text>,
    );
  }

  const hookInMainLine =
    nonMemParts.length === 0 && memParts.length === 0 && !hasTeamMemoryOps && (message.hookTotalMs ?? 0) > 0;
  if (hookInMainLine) {
    pushPart(
      'hooks',
      'ran',
      <Text>
        <Text bold>{message.hookCount}</Text> PreToolUse {message.hookCount === 1 ? 'hook' : 'hooks'} (
        {formatSecondsShort(message.hookTotalMs ?? 0)})
      </Text>,
    );
  }

  const engine = (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor={bg}>
      <Box flexDirection="row">
        {isActiveGroup ? <ToolUseLoader shouldAnimate isUnresolved isError={anyError} /> : <Box minWidth={2} />}
        <Text dimColor={!isActiveGroup}>
          {nonMemParts}
          {memParts}
          {feature('TEAMMEM')
            ? teamMemCollapsed!.TeamMemCountParts({
                message,
                isActiveGroup,
                hasPrecedingParts: nonMemParts.length > 0 || memParts.length > 0,
              })
            : null}
          {!isActiveGroup && failedCount > 0 && (
            <Text key="failed-count" color="error">
              {' · '}
              {failedCount} failed
            </Text>
          )}
          {activeToolAnchorMs > 0 && message.isLiveBriefTurn !== true && (
            <CollapsedToolElapsed key="tool-elapsed" anchorMs={activeToolAnchorMs} shouldAnimate={shouldAnimate} />
          )}
          {isActiveGroup && <Text key="ellipsis">…</Text>} <CtrlOToExpand />
        </Text>
      </Box>
      {cutInputPreview !== undefined && (
        <MessageResponse>
          <Text dimColor wrap="wrap">
            {cutInputPreview}
          </Text>
        </MessageResponse>
      )}
      {anyInterrupted && <FallbackToolUseRejectedMessage />}
      {blockedCount > 0 && !isActiveGroup && (
        <MessageResponse>
          <Text dimColor wrap="wrap">
            {toolUseIds.length === 1
              ? 'Not run'
              : `${blockedCount} ${blockedCount === 1 ? 'action' : 'actions'} not run`}{' '}
            · permission denied
          </Text>
        </MessageResponse>
      )}
      {rejectedWithReasonCount > 0 && !isActiveGroup && (
        <MessageResponse>
          <Text dimColor wrap="wrap">
            {toolUseIds.length === 1
              ? 'Not run'
              : `${rejectedWithReasonCount} ${rejectedWithReasonCount === 1 ? 'action' : 'actions'} not run`}{' '}
            · rejected
          </Text>
        </MessageResponse>
      )}
      {isActiveGroup && effectiveHint !== undefined && (
        // Row layout: 5-wide gutter for ⎿, then a flex column for the text.
        // #194 (2.1.326): clamp displayed hint lines to MAX_HINT_LINES so a
        // multi-line shell command never fills the fullscreen viewport while running.
        <Box flexDirection="row">
          <Box width={5} flexShrink={0}>
            <Text aria-hidden dimColor>
              {'  ⎿  '}
            </Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {leftoverEm ? (
              <Markdown dimColor italic>
                {leftoverHx(effectiveHint, columns - LEFTOVER_HX_GUTTER, LEFTOVER_HX_MAX_LINES)}
              </Markdown>
            ) : (
              (() => {
                const rawLines = effectiveHint.split('\n');
                const truncated = rawLines.length > MAX_HINT_LINES;
                const displayLines = truncated ? rawLines.slice(0, MAX_HINT_LINES) : rawLines;
                return displayLines.map((line, i, arr) => (
                  <Text key={`hint-${i}`} dimColor>
                    {line}
                    {truncated && i === arr.length - 1 && !line.endsWith('…') ? '…' : null}
                    {i === arr.length - 1 && shellProgressSuffix}
                  </Text>
                ));
              })()
            )}
          </Box>
        </Box>
      )}
      {!hookInMainLine && message.hookTotalMs !== undefined && message.hookTotalMs > 0 && (
        <Text dimColor>
          <Text aria-hidden>{'  ⎿  '}</Text>Ran {message.hookCount} PreToolUse{' '}
          {message.hookCount === 1 ? 'hook' : 'hooks'} ({formatSecondsShort(message.hookTotalMs)})
        </Text>
      )}
    </Box>
  );
  return wrapToolGroupHost(engine);
}
