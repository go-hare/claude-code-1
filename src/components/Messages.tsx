import { feature } from 'bun:bundle';
import chalk from 'chalk';
import { SentryErrorBoundary } from './SentryErrorBoundary.js';
import { randomUUID, type UUID } from 'crypto';
import type { RefObject } from 'react';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { every } from 'src/utils/set.js';
import { getIsRemoteMode } from '../bootstrap/state.js';
import type { Command } from '../commands.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import type { ScrollBoxHandle } from '@anthropic/ink';
import { useTerminalNotification } from '@anthropic/ink';
import { Box } from '@anthropic/ink';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import type { Screen } from '../screens/REPL.js';
import type { Tools } from '../Tool.js';
import { findToolByName } from '../Tool.js';
import type { AgentDefinitionsResult } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import type {
  AssistantMessage,
  Message as MessageType,
  NormalizedMessage,
  ProgressMessage as ProgressMessageType,
  RenderableMessage,
} from '../types/message.js';
import { type AdvisorBlock, isAdvisorBlock } from '../utils/advisor.js';
import { collapseBackgroundBashNotifications } from '../utils/collapseBackgroundBashNotifications.js';
import { collapseHookSummaries } from '../utils/collapseHookSummaries.js';
import {
  collapseReadSearchGroups,
  getSearchExtraToolsOrReadInfo,
  getToolUseIdsFromCollapsedGroup,
  LeftoverCollapseCache,
  leftoverTut,
  leftoverXut,
} from '../utils/collapseReadSearch.js';
import { collapseTeammateShutdowns } from '../utils/collapseTeammateShutdowns.js';
import { filterFoldedLoopNoopMessages } from '../utils/loopNoopFold.js';
import { getGlobalConfig } from '../utils/config.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { type BriefToolStats, collapseFocusTranscript, type FocusTranscriptMessage } from '../utils/focusTranscript.js';
import { isFullscreenEnvEnabled, isFullscreenFeatureGateEnabled } from '../utils/fullscreen.js';
import { applyGrouping } from '../utils/groupToolUses.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { useAppState, useAppStateStore } from '../state/AppState.js';
import {
  buildMessageLookups,
  computeMessageStructureKey,
  EMPTY_LOOKUPS,
  extractTag,
  type MessageLookups,
  updateMessageLookupsIncremental,
  createAssistantMessage,
  deriveUUID,
  getToolUseID,
  getToolUseIDs,
  hasUnresolvedHooksFromLookup,
  isHumanLikeOrigin,
  isMetaVisibleOrigin,
  isPeerInboundExpandClickable,
  isNotEmptyMessage,
  normalizeMessages,
  reorderMessagesInUI,
  type StreamingToolUse,
  shouldShowUserMessage,
} from '../utils/messages.js';
import { plural } from '../utils/stringUtils.js';
import { isOutputLineTruncated } from '../utils/terminal.js';
import { renderableSearchText } from '../utils/transcriptSearch.js';
import { unescapeXmlEntities } from '../utils/xml.js';
import { Divider } from '@anthropic/ink';
import type { UnseenDivider } from './FullscreenLayout.js';
import { LogoV2 } from './LogoV2/LogoV2.js';
import { MessageRow } from './MessageRow.js';
import {
  InVirtualListContext,
  type MessageActionsNav,
  MessageActionsSelectedContext,
  type MessageActionsState,
} from './messageActions.js';
import { isNullRenderingAttachment } from './messages/nullRenderingAttachments.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
import { StatusNotices } from './StatusNotices.js';
import type { JumpHandle } from './VirtualMessageList.js';

// Memoed logo header: this box is the FIRST sibling before all MessageRows
// in main-screen mode. If it becomes dirty on every Messages re-render,
// renderChildren's seenDirtyChild cascade disables prevScreen (blit) for
// ALL subsequent siblings — every MessageRow re-writes from scratch instead
// of blitting. In long sessions (~2800 messages) this is 150K+ writes/frame
// and pegs CPU at 100%. Memo on agentDefinitions so a new messages array
// doesn't invalidate the logo subtree. LogoV2/StatusNotices internally
// subscribe to useAppState/useSettings for their own updates.
const LogoHeader = React.memo(function LogoHeader({
  agentDefinitions,
}: {
  agentDefinitions: AgentDefinitionsResult | undefined;
}): React.ReactNode {
  // LogoV2 has its own internal OffscreenFreeze (catches its useAppState
  // re-renders). This outer freeze catches agentDefinitions changes and any
  // future StatusNotices subscriptions while the header is in scrollback.
  return (
    <OffscreenFreeze>
      <Box flexDirection="column" gap={1}>
        <LogoV2 />
        <React.Suspense fallback={null}>
          <StatusNotices agentDefinitions={agentDefinitions} />
        </React.Suspense>
      </Box>
    </OffscreenFreeze>
  );
});

// Dead code elimination: conditional import for proactive mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../proactive/index.js') : null;
const BRIEF_TOOL_NAME: string | null =
  feature('KAIROS') || feature('KAIROS_BRIEF')
    ? (
        require('@claude-code/builtin-tools/tools/BriefTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/BriefTool/prompt.js')
      ).BRIEF_TOOL_NAME
    : null;
const SEND_USER_FILE_TOOL_NAME: string | null = feature('KAIROS')
  ? (
      require('@claude-code/builtin-tools/tools/SendUserFileTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/SendUserFileTool/prompt.js')
    ).SEND_USER_FILE_TOOL_NAME
  : null;

/* eslint-enable @typescript-eslint/no-require-imports */
import { VirtualMessageList } from './VirtualMessageList.js';
import { StreamingTextPreview } from './StreamingTextPreview.js';
import type { StreamingDisplayStore } from '../utils/streamingTextStore.js';

/**
 * In brief-only mode, filter messages to show ONLY Brief tool_use blocks,
 * their tool_results, and real user input. All assistant text is dropped —
 * if the model forgets to call Brief, the user sees nothing for that turn.
 * That's on the model to get right; the filter does not second-guess it.
 */
export function filterForBriefTool<
  T extends {
    type: string;
    subtype?: string;
    isMeta?: boolean;
    isApiErrorMessage?: boolean;
    origin?: { kind?: string; senderTaskId?: string };
    message?: {
      content: Array<{
        type: string;
        name?: string;
        id?: string;
        tool_use_id?: string;
        thinking?: string;
        signature?: string;
      }>;
    };
    attachment?: {
      type: string;
      isMeta?: boolean;
      origin?: { kind?: string; senderTaskId?: string };
      commandMode?: string;
    };
  },
>(messages: T[], briefToolNames: string[], dropTextToolNames: string[] = briefToolNames): T[] {
  const nameSet = new Set(briefToolNames);
  const dropTextNameSet = new Set(dropTextToolNames);
  const turnsWithBrief = new Set<number>();
  const turnAt: number[] = [];
  let turn = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const block = msg.message?.content[0];
    if (msg.type === 'user' && block?.type !== 'tool_result' && (!msg.isMeta || isMetaVisibleOrigin(msg.origin))) {
      turn++;
    } else if (
      msg.type === 'attachment' &&
      msg.attachment?.type === 'queued_command' &&
      msg.attachment.commandMode === 'prompt' &&
      (isMetaVisibleOrigin(msg.attachment.origin) ||
        (!msg.attachment.isMeta && isHumanLikeOrigin(msg.attachment.origin)))
    ) {
      turn++;
    } else if (
      msg.type === 'assistant' &&
      block?.type === 'tool_use' &&
      block.name &&
      dropTextNameSet.has(block.name)
    ) {
      turnsWithBrief.add(turn);
    }
    turnAt[i] = turn;
  }
  // tool_use always precedes its tool_result in the array, so we can collect
  // IDs and match against them in a single pass.
  const briefToolUseIDs = new Set<string>();
  return messages.filter((msg, idx) => {
    // System messages (attach confirmation, remote errors, compact boundaries)
    // must stay visible — dropping them leaves the viewer with no feedback.
    // Exception: api_metrics is per-turn debug noise (TTFT, config writes,
    // hook timing) that defeats the point of brief mode. Still visible in
    // transcript mode (ctrl+o) which bypasses this filter.
    if (msg.type === 'system') return msg.subtype !== 'api_metrics';
    const block = msg.message?.content[0];
    if (msg.type === 'assistant') {
      // API error messages (auth failures, rate limits, etc.) must stay visible
      if (msg.isApiErrorMessage) return true;
      // Keep Brief tool_use blocks (renders with standard tool call chrome,
      // and must be in the list so buildMessageLookups can resolve tool results)
      if (block?.type === 'tool_use' && block.name && nameSet.has(block.name)) {
        if ('id' in block && typeof block.id === 'string') {
          briefToolUseIDs.add(block.id);
        }
        return true;
      }
      if (
        (block?.type === 'text' || (block !== undefined && leftoverTut(block))) &&
        !turnsWithBrief.has(turnAt[idx]!)
      ) {
        return true;
      }
      return false;
    }
    if (msg.type === 'user') {
      if (block?.type === 'tool_result') {
        return block.tool_use_id !== undefined && briefToolUseIDs.has(block.tool_use_id);
      }
      // densable Ace: keep meta peer/channel/observer/observer-activity.
      // Real user input (!isMeta) always kept; other meta (ticks) drop.
      return !msg.isMeta || isMetaVisibleOrigin(msg.origin);
    }
    if (msg.type === 'attachment') {
      // densable: queued_command prompt kept when Ace(origin) OR
      // (!isMeta && human-like origin). Human mid-turn drain has no origin.
      const att = msg.attachment;
      if (att?.type !== 'queued_command' || att.commandMode !== 'prompt') {
        return false;
      }
      return isMetaVisibleOrigin(att.origin) || (!att.isMeta && isHumanLikeOrigin(att.origin));
    }
    return false;
  });
}

type FocusFilterOptions = {
  /** Tools registry — briefStandalone + MCP/edit classification. */
  tools?: Tools;
  /** Open tail skips stamp; may hang pendingText. */
  isLoading?: boolean;
  /** Remote reply channel path — keep all text. */
  keepAllText?: boolean;
  /** densable yMr transcriptV2 skip (default false). */
  transcriptV2?: boolean;
  /** Async agent toolStats lookup. */
  getAgentToolStats?: (agentId: string) => BriefToolStats | undefined;
};

/**
 * Full focus transcript re-collapse + briefHiddenCount.
 * See `utils/focusTranscript.ts`.
 */
export function filterForFocusTranscript<T extends FocusTranscriptMessage>(
  messages: T[],
  options: FocusFilterOptions = {},
): T[] {
  const { tools, isLoading = false, keepAllText = false, transcriptV2 = false, getAgentToolStats } = options;
  return collapseFocusTranscript(messages, tools, getAgentToolStats, isLoading, {
    keepAllText,
    transcriptV2,
  });
}

/**
 * Full-transcript companion to filterForBriefTool. When the Brief tool is
 * in use, the model's text output is redundant with the SendUserMessage
 * content it wrote right after — drop the text so only the SendUserMessage
 * block shows. Tool calls and their results stay visible.
 *
 * Per-turn: only drops text in turns that actually called Brief. If the
 * model forgets, text still shows — otherwise the user would see nothing.
 */
export function dropTextInBriefTurns<
  T extends {
    type: string;
    isMeta?: boolean;
    origin?: { kind?: string; senderTaskId?: string };
    message?: {
      content: Array<{
        type: string;
        name?: string;
        id?: string;
        tool_use_id?: string;
        is_error?: boolean;
        thinking?: string;
        signature?: string;
      }>;
    };
  },
>(messages: T[], briefToolNames: string[]): T[] {
  const nameSet = new Set(briefToolNames);
  const erroredToolUseIds = new Set<string>();
  for (const msg of messages) {
    if (msg.type !== 'user') continue;
    const block = msg.message?.content[0];
    if (block?.type === 'tool_result' && block.tool_use_id && block.is_error) {
      erroredToolUseIds.add(block.tool_use_id);
    }
  }
  // First pass: find which turns (bounded by non-meta user messages, densable
  // Ace-visible meta still counts as a turn boundary) contain a Brief tool_use.
  // Tag each assistant text block with its turn index.
  const turnsWithBrief = new Set<number>();
  const textIndexToTurn: number[] = [];
  let turn = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const block = msg.message?.content[0];
    if (msg.type === 'user' && block?.type !== 'tool_result' && (!msg.isMeta || isMetaVisibleOrigin(msg.origin))) {
      turn++;
      continue;
    }
    if (msg.type === 'assistant') {
      if (block?.type === 'text' || (block !== undefined && leftoverTut(block))) {
        textIndexToTurn[i] = turn;
      } else if (block?.type === 'tool_use' && block.name && nameSet.has(block.name)) {
        if (!block.id || !erroredToolUseIds.has(block.id)) {
          turnsWithBrief.add(turn);
        }
      }
    }
  }
  if (turnsWithBrief.size === 0) return messages;
  // Second pass: drop text blocks whose turn called Brief.
  return messages.filter((_, i) => {
    const t = textIndexToTurn[i];
    return t === undefined || !turnsWithBrief.has(t);
  });
}

type LastThinkingId = string | ReadonlySet<string> | null;

/**
 * Last thinking block id per human turn (uuid:index).
 * Transcript ctrl+o expands EACH turn — session-last-only blanked earlier turns.
 */
export function collectLastThinkingIdsPerTurn(
  messages: ReadonlyArray<{
    type: string;
    uuid?: string;
    message?: { content?: string | ReadonlyArray<{ type: string }> };
  }>,
): LastThinkingId {
  const blocksOf = (content: string | ReadonlyArray<{ type: string }> | undefined) =>
    typeof content === 'string' || content === undefined ? [] : content;
  const perTurn = new Set<string>();
  let lastInTurn: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === 'user') {
      const content = blocksOf(msg.message?.content);
      const hasToolResult = content.some(block => block.type === 'tool_result');
      if (!hasToolResult) {
        if (lastInTurn) perTurn.add(lastInTurn);
        lastInTurn = null;
      }
    } else if (msg?.type === 'assistant' && lastInTurn === null) {
      const content = blocksOf(msg.message?.content);
      for (let j = content.length - 1; j >= 0; j--) {
        if (content[j]?.type === 'thinking' && msg.uuid) {
          lastInTurn = `${msg.uuid}:${j}`;
          break;
        }
      }
    }
  }
  if (lastInTurn) perTurn.add(lastInTurn);
  if (perTurn.size === 0) return 'no-thinking';
  if (perTurn.size === 1) return [...perTurn][0]!;
  return perTurn;
}

type Props = {
  messages: MessageType[];
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  toolJSX: {
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
  } | null;
  /** densable single-host: Host / _Zt overlays pause message animation. */
  suppressMessageAnimation?: boolean;
  inProgressToolUseIDs: Set<string>;
  isMessageSelectorVisible: boolean;
  conversationId: string;
  screen: Screen;
  streamingToolUses: StreamingToolUse[];
  showAllInTranscript?: boolean;
  agentDefinitions?: AgentDefinitionsResult;
  onOpenRateLimitOptions?: () => void;
  /** Hide the logo/header - used for subagent zoom view */
  hideLogo?: boolean;
  isLoading: boolean;
  /** In transcript mode, hide all thinking blocks except the last one */
  hidePastThinking?: boolean;
  /**
   * densable hasStreamingText (y / Jbe / Ve). Gates collapsed_read_search
   * hasContentAfter AND gold bw Oa (`L&&!Me&&M`).
   */
  hasStreamingText?: boolean;
  /** densable bw `M.stream.previewStore` — gold Oa host. */
  streamingDisplayStore?: StreamingDisplayStore;
  /** When true, only show Brief tool output (hide everything else) */
  isBriefOnly?: boolean;
  /** Fullscreen-mode "─── N new ───" divider. Renders before the first
   *  renderableMessage derived from firstUnseenUuid (matched by the 24-char
   *  prefix that deriveUUID preserves). */
  unseenDivider?: UnseenDivider;
  /** Fullscreen-mode ScrollBox handle. Enables React-level virtualization when present. */
  scrollRef?: RefObject<ScrollBoxHandle | null>;
  /** Fullscreen-mode: enable sticky-prompt tracking (writes via ScrollChromeContext). */
  trackStickyPrompt?: boolean;
  /** Transcript search: jump-to-index + setSearchQuery/nextMatch/prevMatch. */
  jumpRef?: RefObject<JumpHandle | null>;
  /** Transcript search: fires when match count/position changes. */
  onSearchMatchesChange?: (count: number, current: number) => void;
  /** Paint an existing DOM subtree to fresh Screen, scan. Element comes
   *  from the main tree (all real providers). Message-relative positions. */
  scanElement?: (el: import('@anthropic/ink').DOMElement) => import('@anthropic/ink').MatchPosition[];
  /** Position-based CURRENT highlight. positions stable (msg-relative),
   *  rowOffset tracks scroll. null clears. */
  setPositions?: (
    state: {
      positions: import('@anthropic/ink').MatchPosition[];
      rowOffset: number;
      currentIdx: number;
    } | null,
  ) => void;
  /** Bypass MAX_MESSAGES_WITHOUT_VIRTUALIZATION. For one-shot headless renders
   *  (e.g. /export via renderToString) where the memory concern doesn't apply
   *  and the "already in scrollback" justification doesn't hold. */
  disableRenderCap?: boolean;
  /** In-transcript cursor; expanded overrides verbose for selected message. */
  cursor?: MessageActionsState | null;
  setCursor?: (cursor: MessageActionsState | null) => void;
  /** Passed through to VirtualMessageList (heightCache owns visibility). */
  cursorNavRef?: React.Ref<MessageActionsNav>;
  /** Render only collapsed.slice(start, end). For chunked headless export
   *  (streamRenderedMessages in exportRenderer.tsx): prep runs on the FULL
   *  messages array so grouping/lookups are correct, but only this slice
   *  chunk instead of the full session. The logo renders only for chunk 0
   *  (start === 0); later chunks are mid-stream continuations.
   *  Measured Mar 2026: 538-msg session, 20 slices → −55% plateau RSS. */
  renderRange?: readonly [start: number, end: number];
};

const MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE = 30;

// Safety cap for the non-virtualized render path (fullscreen off or
// explicitly disabled). Ink mounts a full fiber tree per message (~250 KB
// RSS each); yoga layout height grows unbounded; the screen buffer is sized
// to fit every line. At ~2000 messages this is ~3000-line screens, ~500 MB
// of fibers, and per-frame write costs that push the process into a GC
// death spiral (observed: 59 GB RSS, 14k mmap/munmap/sec). Content dropped
// from this slice has already been printed to terminal scrollback — users
// can still scroll up natively. VirtualMessageList (the default ant path)
// bypasses this cap entirely. Headless one-shot renders (e.g. /export)
// pass disableRenderCap to opt out — they have no scrollback and the
// memory concern doesn't apply to renderToString.
//
// The slice boundary is tracked as a UUID anchor, not a count-derived
// index. Count-based slicing (slice(-200)) drops one message from the
// front on every append, shifting scrollback content and forcing a full
// terminal reset per turn (CC-941). Quantizing to 50-message steps
// (CC-1154) helped but still shifted on compaction and collapse regrouping
// since those change collapsed.length without adding messages. The UUID
// anchor only advances when rendered count genuinely exceeds CAP+STEP —
// immune to length churn from grouping/compaction (CC-1174).
//
// The anchor stores BOTH uuid and index. Some uuids are unstable between
// renders: collapseHookSummaries derives the merged uuid from the first
// summary in a group, but reorderMessagesInUI reshuffles hook adjacency
// as tool results stream in, changing which summary is first. When the
// uuid vanishes, falling back to the stored index (clamped) keeps the
// slice roughly where it was instead of resetting to 0 — which would
// jump from ~200 rendered messages to the full history, orphaning
// in-progress badge snapshots in scrollback.
const MAX_MESSAGES_WITHOUT_VIRTUALIZATION = 200;
const MESSAGE_CAP_STEP = 50;

function isHumanTurnOrigin(origin: { kind?: string } | undefined): boolean {
  return origin === undefined || origin.kind === 'human';
}

/**
 * densable 2.1.289 xd (@207890283) — fold consecutive turn_duration messages
 * with identical non-zero (pendingBackgroundAgentCount, pendingWorkflowCount)
 * when not in verbose/transcript mode.
 */
export function collapseDuplicateTurnDurationMessages<T extends RenderableMessage>(
  messages: T[],
  skipCollapse: boolean,
): T[] {
  if (skipCollapse) return messages;
  let lastAgents = 0;
  let lastWorkflows = 0;
  let out: T[] | null = null;
  for (const [idx, msg] of messages.entries()) {
    if (msg.type === 'system' && msg.subtype === 'turn_duration') {
      const m = msg as unknown as {
        pendingBackgroundAgentCount?: number;
        pendingWorkflowCount?: number;
        budgetLimit?: number;
        briefHiddenCount?: number;
      };
      const agents = m.pendingBackgroundAgentCount ?? 0;
      const workflows = m.pendingWorkflowCount ?? 0;
      const isDuplicate =
        (agents > 0 || workflows > 0) &&
        agents === lastAgents &&
        workflows === lastWorkflows &&
        m.budgetLimit === undefined &&
        (m.briefHiddenCount ?? 0) === 0;
      lastAgents = agents;
      lastWorkflows = workflows;
      if (isDuplicate) {
        out ??= messages.slice(0, idx);
        continue;
      }
    } else if (
      msg.type === 'user'
        ? !msg.isMeta &&
          msg.toolUseResult === undefined &&
          !msg.isCompactSummary &&
          isHumanTurnOrigin(msg.origin as { kind?: string } | undefined)
        : msg.type === 'attachment' &&
          msg.attachment.type === 'queued_command' &&
          msg.attachment.isMeta !== true &&
          msg.attachment.commandMode !== 'task-notification' &&
          isHumanTurnOrigin(msg.attachment.origin as { kind?: string } | undefined)
    ) {
      lastAgents = 0;
      lastWorkflows = 0;
    }
    out?.push(msg);
  }
  return out ?? messages;
}

/** densable Vb — cap non-virtualized slice to Math.min(200, rows) in fullscreen. */
function getNonVirtualizedMessageCap(rows: number, isFullscreen: boolean): number {
  return isFullscreen ? Math.min(MAX_MESSAGES_WITHOUT_VIRTUALIZATION, rows) : MAX_MESSAGES_WITHOUT_VIRTUALIZATION;
}

export type SliceAnchor = { uuid: string; idx: number } | null;

/** Exported for testing. Mutates anchorRef when the window needs to advance. */
export function computeSliceStart(
  collapsed: ReadonlyArray<{ uuid: string }>,
  anchorRef: { current: SliceAnchor },
  cap = MAX_MESSAGES_WITHOUT_VIRTUALIZATION,
  step = MESSAGE_CAP_STEP,
): number {
  const anchor = anchorRef.current;
  const anchorIdx = anchor ? collapsed.findIndex(m => m.uuid === anchor.uuid) : -1;
  // Anchor found → use it. Anchor lost → fall back to stored index
  // (clamped) so collapse-regrouping uuid churn doesn't reset to 0.
  let start = anchorIdx >= 0 ? anchorIdx : anchor ? Math.min(anchor.idx, Math.max(0, collapsed.length - cap)) : 0;
  if (collapsed.length - start > cap + step) {
    start = collapsed.length - cap;
  }
  // Refresh anchor from whatever lives at the current start — heals a
  // stale uuid after fallback and captures a new one after advancement.
  const msgAtStart = collapsed[start];
  if (msgAtStart && (anchor?.uuid !== msgAtStart.uuid || anchor.idx !== start)) {
    anchorRef.current = { uuid: msgAtStart.uuid, idx: start };
  } else if (!msgAtStart && anchor) {
    anchorRef.current = null;
  }
  return start;
}

type TranscriptMessage = Exclude<NormalizedMessage, ProgressMessageType>;

/**
 * densable `class Ea` / `VI` (@207902546) — stateful splitter that compares
 * elements by reference (`===`) against its previous `transcript` and `progress`
 * arrays and returns the exact same `transcript` array reference when only
 * `progress` messages change.
 */
class TranscriptProgressSplitter {
  transcript: TranscriptMessage[] = [];
  progress: ProgressMessageType[] = [];

  split(messages: NormalizedMessage[]): {
    transcript: TranscriptMessage[];
    progress: ProgressMessageType[];
  } {
    const prevTranscript = this.transcript;
    const prevProgress = this.progress;
    let tIdx = 0;
    let pIdx = 0;
    let nextTranscript: TranscriptMessage[] | null = null;
    let nextProgress: ProgressMessageType[] | null = null;
    for (const msg of messages) {
      if (msg.type === 'progress') {
        const pMsg = msg as ProgressMessageType;
        if (nextProgress !== null) {
          nextProgress.push(pMsg);
        } else if (prevProgress[pIdx] === pMsg) {
          pIdx++;
        } else {
          nextProgress = prevProgress.slice(0, pIdx);
          nextProgress.push(pMsg);
        }
      } else if (nextTranscript !== null) {
        nextTranscript.push(msg);
      } else if (prevTranscript[tIdx] === msg) {
        tIdx++;
      } else {
        nextTranscript = prevTranscript.slice(0, tIdx);
        nextTranscript.push(msg);
      }
    }
    nextTranscript ??= tIdx === prevTranscript.length ? prevTranscript : prevTranscript.slice(0, tIdx);
    nextProgress ??= pIdx === prevProgress.length ? prevProgress : prevProgress.slice(0, pIdx);
    this.transcript = nextTranscript;
    this.progress = nextProgress;
    return { transcript: nextTranscript, progress: nextProgress };
  }
}

type HookEventKey = MessageLookups['inProgressHookCounts'] extends Map<string, Map<infer K, number>> ? K : never;

/**
 * densable `Ad` (@207899971) — build `progressMessagesByToolUseID` and
 * `inProgressHookCounts` from `progress` messages, skipping `tool_heartbeat`.
 */
function buildProgressLookups(
  progress: ProgressMessageType[],
): Pick<MessageLookups, 'progressMessagesByToolUseID' | 'inProgressHookCounts'> {
  const progressMessagesByToolUseID = new Map<string, ProgressMessageType[]>();
  const inProgressHookCounts = new Map<string, Map<HookEventKey, number>>();
  for (const msg of progress) {
    const data = msg.data as { type?: string; hookEvent?: HookEventKey };
    if (data.type === 'tool_heartbeat') continue;
    const parentToolUseID = msg.parentToolUseID as string;
    const existing = progressMessagesByToolUseID.get(parentToolUseID);
    if (existing) {
      existing.push(msg);
    } else {
      progressMessagesByToolUseID.set(parentToolUseID, [msg]);
    }
    if (data.type === 'hook_progress' && data.hookEvent) {
      const hookEvent = data.hookEvent;
      let byHookEvent = inProgressHookCounts.get(parentToolUseID);
      if (!byHookEvent) {
        byHookEvent = new Map();
        inProgressHookCounts.set(parentToolUseID, byHookEvent);
      }
      byHookEvent.set(hookEvent, (byHookEvent.get(hookEvent) ?? 0) + 1);
    }
  }
  return { progressMessagesByToolUseID, inProgressHookCounts };
}

type ProjectedMessageLookups = MessageLookups & {
  firstTextBlockUuidByMessageID?: Map<string, string>;
};

const EMPTY_FIRST_TEXT_MAP = new Map<string, string>();

function arraysReferenceEqual<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** densable `Oy` (@207904000) */
function mapsShallowEqual<K, V>(a: ReadonlyMap<K, V> | undefined, b: ReadonlyMap<K, V> | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

/** densable `Mr` (@207904100) */
function projectMapSubset<K, V>(source: Map<K, V>, keys: Iterable<K>, emptyFallback: Map<K, V>): Map<K, V> {
  let projected: Map<K, V> | undefined;
  for (const k of keys) {
    const v = source.get(k);
    if (v !== undefined) {
      projected ??= new Map();
      projected.set(k, v);
    }
  }
  return projected ?? emptyFallback;
}

/** densable `Fy` (@207904200) */
function projectSetSubset<T>(source: Set<T>, keys: Iterable<T>, emptyFallback: Set<T>): Set<T> {
  let projected: Set<T> | undefined;
  for (const k of keys) {
    if (source.has(k)) {
      projected ??= new Set();
      projected.add(k);
    }
  }
  return projected ?? emptyFallback;
}

/** densable `S_` (@207903350) */
function collectRowToolUseIDs(row: RenderableMessage): string[] {
  switch (row.type) {
    case 'assistant': {
      const ids: string[] = [];
      const content = row.message.content;
      if (Array.isArray(content)) {
        for (const block of content as Array<{
          type: string;
          id?: string;
          tool_use_id?: string;
        }>) {
          if (
            (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') &&
            typeof block.id === 'string'
          ) {
            ids.push(block.id);
          } else if ('tool_use_id' in block && typeof block.tool_use_id === 'string') {
            ids.push(block.tool_use_id);
          }
        }
      }
      return ids;
    }
    case 'user': {
      const ids: string[] = [];
      if (row.sourceToolUseID) ids.push(row.sourceToolUseID);
      const content = row.message.content;
      if (Array.isArray(content)) {
        for (const block of content as Array<{
          type: string;
          tool_use_id?: string;
        }>) {
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            ids.push(block.tool_use_id);
          }
        }
      }
      return ids;
    }
    case 'attachment':
    case 'system': {
      const id = getToolUseID(row);
      return id === null ? [] : [id];
    }
    case 'grouped_tool_use':
      return row.messages
        .map(m => {
          const content = m.message.content;
          const first = Array.isArray(content) ? (content[0] as { id?: string } | undefined) : undefined;
          return first?.id ?? '';
        })
        .filter(Boolean);
    case 'collapsed_read_search':
      return getToolUseIdsFromCollapsedGroup(row);
    default:
      return [];
  }
}

/** densable `w_` (@207903680) */
function areRowLookupsEqual(
  prev: ProjectedMessageLookups,
  next: ProjectedMessageLookups,
  rowToolUseIDs: Set<string>,
  rowAndSiblingToolUseIDs: Set<string>,
): boolean {
  for (const id of rowAndSiblingToolUseIDs) {
    if (prev.resolvedToolUseIDs.has(id) !== next.resolvedToolUseIDs.has(id)) {
      return false;
    }
  }
  for (const id of rowToolUseIDs) {
    const prevSiblings = prev.siblingToolUseIDs.get(id);
    const nextSiblings = next.siblingToolUseIDs.get(id);
    if (
      prev.erroredToolUseIDs.has(id) !== next.erroredToolUseIDs.has(id) ||
      prev.toolResultByToolUseID.get(id) !== next.toolResultByToolUseID.get(id) ||
      prev.toolUseByToolUseID.get(id) !== next.toolUseByToolUseID.get(id) ||
      (prevSiblings === undefined || nextSiblings === undefined
        ? prevSiblings !== nextSiblings
        : prevSiblings.size !== nextSiblings.size || !every(prevSiblings, nextSiblings)) ||
      !arraysReferenceEqual(prev.progressMessagesByToolUseID.get(id), next.progressMessagesByToolUseID.get(id)) ||
      !mapsShallowEqual(prev.inProgressHookCounts.get(id), next.inProgressHookCounts.get(id)) ||
      !mapsShallowEqual(prev.resolvedHookCounts.get(id), next.resolvedHookCounts.get(id))
    ) {
      return false;
    }
  }
  return true;
}

/** densable `b_` (@207903000) */
function projectRowLookups(
  row: RenderableMessage,
  lookups: ProjectedMessageLookups,
  prev: ProjectedMessageLookups | undefined,
): ProjectedMessageLookups {
  const rowToolUseIDs = new Set(collectRowToolUseIDs(row));
  const assistantMsgId = row.type === 'assistant' ? (row.message.id ?? null) : null;
  const firstTextUuid =
    assistantMsgId === null ? undefined : lookups.firstTextBlockUuidByMessageID?.get(assistantMsgId);
  if (rowToolUseIDs.size === 0 && firstTextUuid === undefined) {
    return EMPTY_LOOKUPS;
  }
  const rowAndSiblingToolUseIDs = new Set(rowToolUseIDs);
  for (const id of rowToolUseIDs) {
    for (const siblingId of lookups.siblingToolUseIDs.get(id) ?? []) {
      rowAndSiblingToolUseIDs.add(siblingId);
    }
  }
  if (
    prev &&
    (assistantMsgId === null || prev.firstTextBlockUuidByMessageID?.get(assistantMsgId) === firstTextUuid) &&
    areRowLookupsEqual(prev, lookups, rowToolUseIDs, rowAndSiblingToolUseIDs)
  ) {
    return prev;
  }
  return {
    siblingToolUseIDs: projectMapSubset(lookups.siblingToolUseIDs, rowToolUseIDs, EMPTY_LOOKUPS.siblingToolUseIDs),
    progressMessagesByToolUseID: projectMapSubset(
      lookups.progressMessagesByToolUseID,
      rowToolUseIDs,
      EMPTY_LOOKUPS.progressMessagesByToolUseID,
    ),
    inProgressHookCounts: projectMapSubset(
      lookups.inProgressHookCounts,
      rowToolUseIDs,
      EMPTY_LOOKUPS.inProgressHookCounts,
    ),
    resolvedHookCounts: projectMapSubset(lookups.resolvedHookCounts, rowToolUseIDs, EMPTY_LOOKUPS.resolvedHookCounts),
    toolResultByToolUseID: projectMapSubset(
      lookups.toolResultByToolUseID,
      rowToolUseIDs,
      EMPTY_LOOKUPS.toolResultByToolUseID,
    ),
    toolUseByToolUseID: projectMapSubset(lookups.toolUseByToolUseID, rowToolUseIDs, EMPTY_LOOKUPS.toolUseByToolUseID),
    firstTextBlockUuidByMessageID:
      assistantMsgId === null || firstTextUuid === undefined
        ? EMPTY_FIRST_TEXT_MAP
        : new Map([[assistantMsgId, firstTextUuid]]),
    normalizedMessageCount: lookups.normalizedMessageCount,
    resolvedToolUseIDs: projectSetSubset(
      lookups.resolvedToolUseIDs,
      rowAndSiblingToolUseIDs,
      EMPTY_LOOKUPS.resolvedToolUseIDs,
    ),
    erroredToolUseIDs: projectSetSubset(lookups.erroredToolUseIDs, rowToolUseIDs, EMPTY_LOOKUPS.erroredToolUseIDs),
  };
}

/**
 * densable `class Ia` / `GI` (@207902892) — per-row lookup projector.
 */
class RowLookupsProjector {
  private source: WeakRef<ProjectedMessageLookups> | null = null;
  private generation = 0;
  private byRow = new WeakMap<RenderableMessage, { generation: number; projection: ProjectedMessageLookups }>();

  forRow(row: RenderableMessage, lookups: ProjectedMessageLookups): ProjectedMessageLookups {
    if (this.source?.deref() !== lookups) {
      this.source = new WeakRef(lookups);
      this.generation++;
    }
    const entry = this.byRow.get(row);
    if (entry && entry.generation === this.generation) {
      return entry.projection;
    }
    const projected = projectRowLookups(row, lookups, entry?.projection);
    if (projected === EMPTY_LOOKUPS) {
      if (entry) {
        this.byRow.delete(row);
      }
    } else if (entry) {
      entry.generation = this.generation;
      entry.projection = projected;
    } else {
      this.byRow.set(row, {
        generation: this.generation,
        projection: projected,
      });
    }
    return projected;
  }
}

/** densable `_Mr` (@191149164) — attachment that flushes a collapsed read/search group. */
function isGroupFlushingAttachment(msg: RenderableMessage): boolean {
  if (msg.type !== 'attachment') return false;
  const att = msg.attachment;
  if (att.type === 'queued_command') {
    const origin =
      att.origin !== null && typeof att.origin === 'object'
        ? (att.origin as { kind?: string; senderTaskId?: string })
        : undefined;
    if (att.commandMode === 'task-notification') return true;
    if (
      (origin?.kind === 'peer' && origin.senderTaskId !== undefined) ||
      origin?.kind === 'observer' ||
      origin?.kind === 'coordinator'
    ) {
      return true;
    }
    if (att.commandMode !== 'prompt') return false;
    if (att.isMeta !== true && isHumanLikeOrigin(origin)) return true;
    const kind = origin?.kind;
    return kind === 'channel' || kind === 'peer' || kind === 'slack-ping';
  }
  if (att.type === 'teammate_mailbox') {
    return Array.isArray(att.messages) && att.messages.length > 0;
  }
  return false;
}

/**
 * densable `Hd` (@207907549) — scan backwards from `messages.length - 1` to find
 * the last index with non-collapsible content. Computed once per render instead
 * of scanning forward per row.
 */
function findLastContentIndex(messages: RenderableMessage[], tools: Tools, streamingToolUseIDs: Set<string>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === 'assistant') {
      const content = Array.isArray(msg.message.content)
        ? (msg.message.content[0] as { type: string; name?: string; input?: unknown; id?: string } | undefined)
        : undefined;
      if (content?.type === 'thinking' || content?.type === 'redacted_thinking') {
        if (leftoverXut(msg)) return i;
        continue;
      }
      if (content?.type === 'tool_use') {
        if (getSearchExtraToolsOrReadInfo(content.name!, content.input, tools).isCollapsible) {
          continue;
        }
        if (streamingToolUseIDs.has(content.id!)) {
          continue;
        }
      }
      return i;
    }
    if (msg?.type === 'attachment' && isGroupFlushingAttachment(msg)) {
      return i;
    }
    if (msg?.type === 'system' || msg?.type === 'attachment') {
      continue;
    }
    if (msg?.type === 'user') {
      const content = Array.isArray(msg.message.content)
        ? (msg.message.content[0] as { type: string } | undefined)
        : undefined;
      if (content?.type === 'tool_result') {
        continue;
      }
    }
    if (msg?.type === 'grouped_tool_use') {
      const firstContent = Array.isArray(msg.messages[0]?.message.content)
        ? (msg.messages[0]?.message.content[0] as { input?: unknown } | undefined)
        : undefined;
      if (getSearchExtraToolsOrReadInfo(msg.toolName, firstContent?.input, tools).isCollapsible) {
        continue;
      }
    }
    return i;
  }
  return -1;
}

/** densable `Pp` / `Lmr` (@207632799) — cached bash output block parser. */
function parseBashOutputBlock(
  cache: WeakMap<object, { stdout: string; stderr: string }>,
  block: { text?: string },
): { stdout: string; stderr: string } {
  const cached = cache.get(block);
  if (cached) return cached;
  const content = block.text ?? '';
  const rawStdout = extractTag(content, 'bash-stdout') ?? '';
  const parsed = {
    stdout: extractTag(rawStdout, 'persisted-output') ?? unescapeXmlEntities(rawStdout),
    stderr: unescapeXmlEntities(extractTag(content, 'bash-stderr') ?? ''),
  };
  cache.set(block, parsed);
  return parsed;
}

/** Check whether a tool_result error has >3 lines. */
function isToolResultErrorTruncated(content: unknown): boolean {
  if (typeof content === 'string') {
    let lines = 1;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10 && ++lines > 3) return true;
    }
    return false;
  }
  if (!Array.isArray(content)) return false;
  let lines = 0;
  for (const item of content) {
    lines += 1;
    if (lines > 3) return true;
    if (
      typeof item === 'object' &&
      item !== null &&
      'type' in item &&
      (item as { type: unknown }).type === 'text' &&
      'text' in item &&
      typeof (item as { text: unknown }).text === 'string'
    ) {
      const text = (item as { text: string }).text;
      let idx = 0;
      while (lines <= 3) {
        idx = text.indexOf('\n', idx);
        if (idx === -1) break;
        idx++;
        lines++;
      }
      if (lines > 3) return true;
    }
  }
  return false;
}

const MessagesImpl = ({
  messages,
  tools,
  commands,
  verbose,
  toolJSX,
  suppressMessageAnimation = false,
  inProgressToolUseIDs,
  isMessageSelectorVisible,
  conversationId,
  screen,
  streamingToolUses,
  showAllInTranscript = false,
  agentDefinitions,
  onOpenRateLimitOptions,
  hideLogo = false,
  isLoading,
  hidePastThinking = false,
  hasStreamingText,
  streamingDisplayStore,
  isBriefOnly = false,
  unseenDivider,
  scrollRef,
  trackStickyPrompt,
  jumpRef,
  onSearchMatchesChange,
  scanElement,
  setPositions,
  disableRenderCap = false,
  cursor = null,
  setCursor,
  cursorNavRef,
  renderRange,
}: Props): React.ReactNode => {
  const { columns, rows } = useTerminalSize();
  const isFullscreen = isFullscreenEnvEnabled();
  const isTranscriptMode = screen === 'transcript';
  const toggleShowAllShortcut = useShortcutDisplay('transcript:toggleShowAll', 'Transcript', 'Ctrl+E');
  const briefTranscript = useAppState(s => s.briefTranscript);
  // densable W = showMessageTimestamps && tengu_silk_hinge
  const showMessageTimestamps =
    Boolean(useAppState(s => s.showMessageTimestamps)) &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_silk_hinge', false);
  // focus vs /brief: isBriefOnly wins when both on (stricter SendUserMessage-only path).
  const focusTranscriptActive = Boolean(briefTranscript) && isFullscreenFeatureGateEnabled() && !isBriefOnly;
  // async agent toolStats for focus transcript summary
  const appStore = useAppStateStore();

  const messagesBeforeLoopFold = useMemo(
    () => (verbose || isTranscriptMode ? messages : filterFoldedLoopNoopMessages(messages)),
    [messages, verbose, isTranscriptMode],
  );
  const normalizedMessages = useMemo(
    () => normalizeMessages(messagesBeforeLoopFold).filter(isNotEmptyMessage),
    [messagesBeforeLoopFold],
  );

  const [transcriptProgressSplitter] = useState(() => new TranscriptProgressSplitter());
  const [rowLookupsProjector] = useState(() => new RowLookupsProjector());
  const [streamingToolUseFilter] = useState(() => new StreamingToolUseFilter());

  const { transcript, progress: progressMessages } = useMemo(
    () => transcriptProgressSplitter.split(normalizedMessages),
    [transcriptProgressSplitter, normalizedMessages],
  );

  // Last thinking block per human turn + latest bash output.
  // densable Ew: all thinking blocks render when isTranscriptMode || verbose.
  const { lastThinkingBlockId, latestBashOutputUUID } = useMemo(() => {
    let bashUUID: string | null = null;
    for (let i = transcript.length - 1; i >= 0; i--) {
      const msg = transcript[i];
      if (msg?.type !== 'user') continue;
      const content = msg.message!.content as Array<{ type: string; text?: string }>;
      for (const block of content) {
        if (block.type === 'text') {
          const text = block.text ?? '';
          if (text.startsWith('<bash-stdout') || text.startsWith('<bash-stderr')) {
            bashUUID = msg.uuid;
            break;
          }
        }
      }
      if (bashUUID) break;
    }
    if (!hidePastThinking || isTranscriptMode || verbose) {
      return { lastThinkingBlockId: null, latestBashOutputUUID: bashUUID };
    }
    return {
      lastThinkingBlockId: collectLastThinkingIdsPerTurn(transcript),
      latestBashOutputUUID: bashUUID,
    };
  }, [transcript, hidePastThinking, isTranscriptMode, verbose]);

  // streamingToolUses updates on every input_json_delta while transcript
  // stays stable — precompute the Set so the filter is O(k) not O(n×k) per chunk.
  const normalizedToolUseIDs = useMemo(() => getToolUseIDs(transcript), [transcript]);

  // densable 246 $M/jM/_e: proxy `tool_use` without `id` must still render —
  // mint a stable id via WeakMap keyed on contentBlock (wrapper is recreated
  // on every input_json_delta; not stream/`Owe` synthesis).
  const mintedStreamingToolUseIdsRef = useRef<WeakMap<object, string> | null>(null);
  const resolveStreamingToolUseId = useCallback((stu: StreamingToolUse): { id: string; minted: boolean } => {
    const map = (mintedStreamingToolUseIdsRef.current ??= new WeakMap());
    return resolveMintedStreamingToolUseId(map, stu);
  }, []);

  const streamingToolUsesWithoutInProgress = useMemo(
    () => streamingToolUseFilter.next(streamingToolUses, inProgressToolUseIDs, normalizedToolUseIDs),
    [streamingToolUseFilter, streamingToolUses, inProgressToolUseIDs, normalizedToolUseIDs],
  );

  const syntheticStreamingToolUseMessages = useMemo(
    () =>
      streamingToolUsesWithoutInProgress.flatMap(streamingToolUse => {
        const { id, minted } = resolveStreamingToolUseId(streamingToolUse);
        const contentBlock = minted ? { ...streamingToolUse.contentBlock, id } : streamingToolUse.contentBlock;
        const msg = createAssistantMessage({
          content: [contentBlock],
        });
        // Real API ids: deriveUUID for stable React keys across memo recomputes.
        // Minted ids: use the minted UUID directly (densable `ce?V:Hg(V,0)`).
        msg.uuid = minted ? (id as UUID) : deriveUUID(id as UUID, 0);
        return normalizeMessages([msg]);
      }),
    [streamingToolUsesWithoutInProgress, resolveStreamingToolUseId],
  );

  // Hoisted to mount-time — this component re-renders on every scroll.
  const disableVirtualScroll = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL), []);
  // Virtual scroll replaces the transcript cap: everything is scrollable and
  // memory is bounded by the mounted-item count, not the total. scrollRef is
  // only passed when isFullscreenEnvEnabled() is true (REPL.tsx gates it),
  // so scrollRef's presence is the signal.
  const virtualScrollRuntimeGate = scrollRef != null && !disableVirtualScroll;
  const shouldTruncate = isTranscriptMode && !showAllInTranscript && !virtualScrollRuntimeGate;

  // Anchor for the first rendered message in the non-virtualized cap slice.
  // Monotonic advance only — mutation during render is idempotent (safe
  // under StrictMode double-render). See MAX_MESSAGES_WITHOUT_VIRTUALIZATION
  // comment above for why this replaced count-based slicing.
  const sliceAnchorRef = useRef<SliceAnchor>(null);
  const prevSliceSyncRef = useRef({ conversationId, verbose });
  if (prevSliceSyncRef.current.conversationId !== conversationId) {
    prevSliceSyncRef.current.conversationId = conversationId;
    sliceAnchorRef.current = null;
  }
  if (prevSliceSyncRef.current.verbose !== verbose) {
    prevSliceSyncRef.current.verbose = verbose;
    sliceAnchorRef.current = null;
  }

  // Cache for buildMessageLookups: avoids rebuilding 8 Maps/Sets when only
  // message content changed during streaming (text/thinking deltas). The key
  // captures only structural info (types, IDs), so content-only deltas skip
  // the rebuild entirely.
  const collapseCacheRef = useRef<LeftoverCollapseCache | null>(null);
  let collapseCache = collapseCacheRef.current;
  if (collapseCache === null) {
    collapseCache = new LeftoverCollapseCache();
    collapseCacheRef.current = collapseCache;
  }

  const lookupsCacheRef = useRef<{
    key: string;
    lookups: MessageLookups;
    normalizedCount: number;
    messageCount: number;
    lastAssistantMsgId: string | undefined;
  } | null>(null);

  // Expensive message transforms — filter, reorder, group, collapse, transcriptLookups.
  // Depends on `transcript` (NOT `normalizedMessages` / `progress`), so 1s bash/hook
  // progress ticks completely skip reorderMessagesInUI, applyGrouping,
  // collapseReadSearchGroups, collapseTeammateShutdowns, collapseHookSummaries,
  // collapseBackgroundBashNotifications, filterFoldedLoopNoopMessages, and buildMessageLookups.
  const { collapsed, transcriptLookups, hasTruncatedMessages, hiddenMessageCount } = useMemo(() => {
    const compactAwareMessages = transcript;

    const messagesToShowNotTruncated = reorderMessagesInUI(
      compactAwareMessages.filter(
        msg => !isNullRenderingAttachment(msg) && shouldShowUserMessage(msg, isTranscriptMode),
      ) as Parameters<typeof reorderMessagesInUI>[0],
      syntheticStreamingToolUseMessages,
    );
    // Three-tier filtering. Transcript mode (ctrl+o screen) is truly unfiltered.
    // Brief-only: SendUserMessage + user input only. Default: drop redundant
    // assistant text in turns where SendUserMessage was called (the model's
    // text is working-notes that duplicate the SendUserMessage content).
    const briefToolNames = [BRIEF_TOOL_NAME, SEND_USER_FILE_TOOL_NAME].filter((n): n is string => n !== null);
    // dropTextInBriefTurns should only trigger on SendUserMessage turns —
    // SendUserFile delivers a file without replacement text, so dropping
    // assistant text for file-only turns would leave the user with no context.
    const dropTextToolNames = [BRIEF_TOOL_NAME].filter((n): n is string => n !== null);
    const briefFiltered =
      briefToolNames.length > 0 && !isTranscriptMode
        ? isBriefOnly
          ? filterForBriefTool(
              messagesToShowNotTruncated as Parameters<typeof filterForBriefTool>[0],
              briefToolNames,
              dropTextToolNames,
            )
          : dropTextToolNames.length > 0
            ? dropTextInBriefTurns(
                messagesToShowNotTruncated as Parameters<typeof dropTextInBriefTurns>[0],
                dropTextToolNames,
              )
            : messagesToShowNotTruncated
        : messagesToShowNotTruncated;

    const messagesToShow = shouldTruncate
      ? briefFiltered.slice(-MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE)
      : briefFiltered;

    const hasTruncatedMessages = shouldTruncate && briefFiltered.length > MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE;

    // densable 2.1.289 bd (@207950450) — hide messages folded by UXm loop noop-fold
    // fire lines BEFORE applyGrouping and collapseReadSearchGroups; skip when verbose || isTranscriptMode.
    const loopUnfolded =
      verbose || isTranscriptMode
        ? (messagesToShow as MessageType[])
        : filterFoldedLoopNoopMessages(messagesToShow as MessageType[]);

    const { messages: groupedMessages } = applyGrouping(loopUnfolded, tools, verbose);

    const collapsedBase = collapseBackgroundBashNotifications(
      collapseHookSummaries(
        collapseTeammateShutdowns(
          collapseReadSearchGroups(groupedMessages, tools, {
            expandRows: isTranscriptMode && virtualScrollRuntimeGate,
            cache: collapseCache,
          }),
        ),
      ),
      verbose,
    );
    // Focus transcript re-collapse + toolStats + pendingText + briefHiddenCount.
    const getAgentToolStats = (agentId: string): BriefToolStats | undefined => {
      const task = appStore.getState().tasks[agentId] as
        | { type?: string; result?: { toolStats?: BriefToolStats } }
        | undefined;
      if (task?.type === 'local_agent') return task.result?.toolStats;
      return undefined;
    };
    const afterFocus =
      focusTranscriptActive && !isTranscriptMode
        ? (filterForFocusTranscript(collapsedBase as Parameters<typeof filterForFocusTranscript>[0], {
            tools,
            isLoading,
            getAgentToolStats,
          }) as typeof collapsedBase)
        : collapsedBase;
    const collapsed = collapseDuplicateTurnDurationMessages(afterFocus, verbose || isTranscriptMode);

    const lookupsKey = computeMessageStructureKey(transcript, messagesToShow as MessageType[]);
    const currentLastAssistantMsgId = (() => {
      const lastMsg = (messagesToShow as MessageType[]).at(-1);
      return lastMsg?.type === 'assistant' ? (lastMsg as AssistantMessage).message?.id : undefined;
    })();
    let transcriptLookups: MessageLookups;
    if (lookupsCacheRef.current && lookupsCacheRef.current.key === lookupsKey) {
      transcriptLookups = lookupsCacheRef.current.lookups;
    } else if (
      lookupsCacheRef.current &&
      transcript.length >= lookupsCacheRef.current.normalizedCount &&
      (messagesToShow as MessageType[]).length >= lookupsCacheRef.current.messageCount &&
      // If lastAssistantMsgId changed, previous "in-progress" assistant may
      // now be orphaned — force a full rebuild to pick up the new status.
      lookupsCacheRef.current.lastAssistantMsgId === currentLastAssistantMsgId
    ) {
      // Try incremental update when only new messages were appended
      const updated = updateMessageLookupsIncremental(
        lookupsCacheRef.current.lookups,
        lookupsCacheRef.current.normalizedCount,
        lookupsCacheRef.current.messageCount,
        transcript,
        messagesToShow as MessageType[],
      );
      if (updated) {
        transcriptLookups = updated;
        lookupsCacheRef.current = {
          key: lookupsKey,
          lookups: transcriptLookups,
          normalizedCount: transcript.length,
          messageCount: (messagesToShow as MessageType[]).length,
          lastAssistantMsgId: currentLastAssistantMsgId,
        };
      } else {
        transcriptLookups = buildMessageLookups(transcript, messagesToShow as MessageType[]);
        lookupsCacheRef.current = {
          key: lookupsKey,
          lookups: transcriptLookups,
          normalizedCount: transcript.length,
          messageCount: (messagesToShow as MessageType[]).length,
          lastAssistantMsgId: currentLastAssistantMsgId,
        };
      }
    } else {
      transcriptLookups = buildMessageLookups(transcript, messagesToShow as MessageType[]);
      lookupsCacheRef.current = {
        key: lookupsKey,
        lookups: transcriptLookups,
        normalizedCount: transcript.length,
        messageCount: (messagesToShow as MessageType[]).length,
        lastAssistantMsgId: currentLastAssistantMsgId,
      };
    }

    const hiddenMessageCount = messagesToShowNotTruncated.length - MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE;

    return {
      collapsed,
      transcriptLookups,
      hasTruncatedMessages,
      hiddenMessageCount,
    };
  }, [
    verbose,
    transcript,
    isTranscriptMode,
    syntheticStreamingToolUseMessages,
    shouldTruncate,
    tools,
    isBriefOnly,
    focusTranscriptActive,
    isLoading,
    appStore,
    virtualScrollRuntimeGate,
    collapseCache,
  ]);

  const progressLookups = useMemo(() => buildProgressLookups(progressMessages), [progressMessages]);

  const lookups = useMemo(() => ({ ...transcriptLookups, ...progressLookups }), [transcriptLookups, progressLookups]);

  // Cheap slice — only runs when scroll range or slice config changes.
  const renderableMessages = useMemo(() => {
    // Safety cap for the non-virtualized render path. Applied here (not at
    // the JSX site) so renderMessageRow's index-based lookups and
    // dividerBeforeIndex compute on the same array. VirtualMessageList
    // never sees this slice — virtualScrollRuntimeGate is constant for the
    // component's lifetime (scrollRef is either always passed or never).
    // renderRange is first: the chunked export path slices the
    // post-grouping array so each chunk gets correct tool-call grouping.
    const capApplies = !virtualScrollRuntimeGate && !disableRenderCap;
    const nonVirtualizedCap = getNonVirtualizedMessageCap(rows, isFullscreen);
    const sliceStart = capApplies ? computeSliceStart(collapsed, sliceAnchorRef, nonVirtualizedCap) : 0;
    return renderRange
      ? collapsed.slice(renderRange[0], renderRange[1])
      : sliceStart > 0
        ? collapsed.slice(sliceStart)
        : collapsed;
  }, [collapsed, renderRange, virtualScrollRuntimeGate, disableRenderCap, rows, isFullscreen, conversationId, verbose]);

  const streamingToolUseIDs = useMemo(
    () => new Set(streamingToolUses.map(stu => resolveStreamingToolUseId(stu).id)),
    [streamingToolUses, resolveStreamingToolUseId],
  );

  const lastContentIndex = useMemo(
    () => findLastContentIndex(renderableMessages, tools, streamingToolUseIDs),
    [renderableMessages, tools, streamingToolUseIDs],
  );

  // Divider insertion point and selected index: combined into a single pass
  // over renderableMessages to avoid two separate findIndex traversals.
  const { dividerBeforeIndex, selectedIdx } = useMemo(() => {
    if (!unseenDivider && !cursor) return { dividerBeforeIndex: -1, selectedIdx: -1 };
    let dIdx = -1;
    let sIdx = -1;
    const prefix = unseenDivider?.firstUnseenUuid.slice(0, 24);
    for (let i = 0; i < renderableMessages.length; i++) {
      const m = renderableMessages[i];
      if (dIdx === -1 && prefix && m.uuid.slice(0, 24) === prefix) dIdx = i;
      if (sIdx === -1 && cursor && m.uuid === cursor.uuid) sIdx = i;
      if (dIdx !== -1 && sIdx !== -1) break;
    }
    return { dividerBeforeIndex: dIdx, selectedIdx: sIdx };
  }, [unseenDivider, cursor, renderableMessages]);

  // Fullscreen: click a message to toggle verbose rendering for it. Keyed by
  // tool_use_id where available so a tool_use and its tool_result (separate
  // rows) expand together; falls back to uuid for groups/thinking. Stale keys
  // are harmless — they never match anything in renderableMessages.
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Bumped on each expand/collapse so VirtualMessageList can invalidate
  // heightCache + clear scrollHeightHwm (stale expand heights leave blank
  // spacer after collapse when not sticky).
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const prevExpandConversationIdRef = useRef(conversationId);
  if (prevExpandConversationIdRef.current !== conversationId) {
    prevExpandConversationIdRef.current = conversationId;
    if (expandedKeys.size > 0) {
      setExpandedKeys(new Set());
      setLayoutEpoch(n => n + 1);
    }
  }
  const onItemClick = useCallback((msg: RenderableMessage) => {
    const k = expandKey(msg);
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    setLayoutEpoch(n => n + 1);
  }, []);
  const isItemExpanded = useCallback(
    (msg: RenderableMessage) => expandedKeys.size > 0 && expandedKeys.has(expandKey(msg)),
    [expandedKeys],
  );
  // Only hover/click messages where the verbose toggle reveals more:
  // collapsed read/search groups, or tool results that self-report truncation
  // via isResultTruncated. Callback must be stable across message updates: if
  // its identity (or return value) flips during streaming, onMouseEnter
  // attaches after the mouse is already inside → hover never fires. tools is
  // session-stable; lookups is read via ref so the callback doesn't churn on
  // every new message.
  const lookupsRef = useRef(lookups);
  lookupsRef.current = lookups;
  const bashOutputCacheRef = useRef(new WeakMap<object, { stdout: string; stderr: string }>());
  const isItemClickable = useCallback(
    (msg: RenderableMessage): boolean => {
      if (msg.type === 'collapsed_read_search') return true;
      if (msg.type === 'attachment') {
        if (verbose || isTranscriptMode) return false;
        if (msg.attachment?.type === 'queued_command') {
          return isPeerInboundExpandClickable(msg);
        }
        if (msg.attachment?.type === 'teammate_mailbox') {
          return Array.isArray(msg.attachment.messages) && msg.attachment.messages.length > 0;
        }
        return msg.attachment?.type === 'goal_status' && Boolean((msg.attachment as { reason?: string }).reason);
      }
      if (msg.type === 'assistant') {
        if (verbose || isTranscriptMode) return false;
        const content = msg.message!.content;
        const b = (Array.isArray(content) ? content[0] : undefined) as unknown as AdvisorBlock | undefined;
        return (
          b != null && isAdvisorBlock(b) && b.type === 'advisor_tool_result' && b.content.type === 'advisor_result'
        );
      }
      if (msg.type !== 'user') return false;
      const b = (
        msg.message!.content as Array<{
          type: string;
          text?: string;
          tool_use_id?: string;
          is_error?: boolean;
          content?: unknown;
          [key: string]: unknown;
        }>
      )[0];
      if (
        b?.type === 'text' &&
        typeof b.text === 'string' &&
        (b.text.startsWith('<bash-stdout') || b.text.startsWith('<bash-stderr'))
      ) {
        if (verbose || isTranscriptMode || msg.uuid === latestBashOutputUUID) {
          return false;
        }
        const parsed = parseBashOutputBlock(bashOutputCacheRef.current, b);
        const bashTool = findToolByName(tools, 'Bash');
        if (bashTool?.isResultTruncated) {
          return bashTool.isResultTruncated({ ...parsed, interrupted: false } as never, { columns });
        }
        return isOutputLineTruncated(parsed.stdout, columns) || isOutputLineTruncated(parsed.stderr, columns);
      }
      if (b?.type === 'text') {
        if (verbose || isTranscriptMode) return false;
        return isPeerInboundExpandClickable(msg);
      }
      if (b?.type !== 'tool_result') return false;
      if (b.is_error) {
        return isToolResultErrorTruncated(b.content);
      }
      if (!msg.toolUseResult) return false;
      const name = lookupsRef.current.toolUseByToolUseID.get(b.tool_use_id ?? '')?.name;
      const tool = name ? findToolByName(tools, name) : undefined;
      return tool?.isResultTruncated?.(msg.toolUseResult as never, { columns }) ?? false;
    },
    [columns, tools, verbose, isTranscriptMode, latestBashOutputUUID],
  );

  const canAnimate =
    (!toolJSX || !!toolJSX.shouldContinueAnimation) && !suppressMessageAnimation && !isMessageSelectorVisible;

  const hasToolsInProgress = inProgressToolUseIDs.size > 0;

  // Report progress to terminal (for terminals that support OSC 9;4)
  const { progress } = useTerminalNotification();
  const prevProgressState = useRef<string | null>(null);
  const progressEnabled =
    getGlobalConfig().terminalProgressBarEnabled &&
    !getIsRemoteMode() &&
    !(proactiveModule?.isProactiveActive() ?? false);
  useEffect(() => {
    const state = progressEnabled ? (hasToolsInProgress ? 'indeterminate' : 'completed') : null;
    if (prevProgressState.current === state) return;
    prevProgressState.current = state;
    progress(state);
  }, [progress, progressEnabled, hasToolsInProgress]);
  useEffect(() => {
    return () => progress(null);
  }, [progress]);

  const messageKey = useCallback((msg: RenderableMessage) => `${msg.uuid}-${conversationId}`, [conversationId]);

  const renderMessageRow = useCallback(
    (msg: RenderableMessage, index: number) => {
      const prevType = index > 0 ? renderableMessages[index - 1]?.type : undefined;
      const isUserContinuation = msg.type === 'user' && prevType === 'user';
      // Official 2.1.289: collapsed && (!!streamingText || index < lastContentIndex).
      const hasContentAfter = msg.type === 'collapsed_read_search' && (!!hasStreamingText || index < lastContentIndex);

      const k = messageKey(msg);
      const row = (
        <MessageRow
          key={k}
          message={msg}
          isUserContinuation={isUserContinuation}
          hasContentAfter={hasContentAfter}
          tools={tools}
          commands={commands}
          verbose={verbose || isItemExpanded(msg) || (cursor?.expanded === true && index === selectedIdx)}
          inProgressToolUseIDs={inProgressToolUseIDs}
          streamingToolUseIDs={streamingToolUseIDs}
          screen={screen}
          canAnimate={canAnimate}
          onOpenRateLimitOptions={onOpenRateLimitOptions}
          lastThinkingBlockId={lastThinkingBlockId}
          latestBashOutputUUID={latestBashOutputUUID}
          columns={columns}
          isLoading={isLoading}
          lookups={rowLookupsProjector.forRow(msg, lookups)}
          showMessageTimestamps={showMessageTimestamps}
        />
      );

      // Per-row Provider — only 2 rows re-render on selection change.
      // Wrapped BEFORE divider branch so both return paths get it.
      const wrapped = (
        <MessageActionsSelectedContext.Provider key={k} value={index === selectedIdx}>
          {row}
        </MessageActionsSelectedContext.Provider>
      );

      if (unseenDivider && index === dividerBeforeIndex) {
        return [
          <Box key="unseen-divider" marginTop={1}>
            <Divider
              title={`${unseenDivider.count} new ${plural(unseenDivider.count, 'message')}`}
              width={columns}
              color="inactive"
            />
          </Box>,
          wrapped,
        ];
      }
      return wrapped;
    },
    [
      renderableMessages,
      hasStreamingText,
      lastContentIndex,
      messageKey,
      tools,
      commands,
      verbose,
      isItemExpanded,
      cursor?.expanded,
      selectedIdx,
      inProgressToolUseIDs,
      streamingToolUseIDs,
      screen,
      canAnimate,
      onOpenRateLimitOptions,
      lastThinkingBlockId,
      latestBashOutputUUID,
      columns,
      isLoading,
      rowLookupsProjector,
      lookups,
      showMessageTimestamps,
      unseenDivider,
      dividerBeforeIndex,
    ],
  );

  // Search indexing: for tool_result messages, look up the Tool and use
  // its extractSearchText — tool-owned, precise, matches what
  // renderToolResultMessage shows. Falls back to renderableSearchText
  // (duck-types toolUseResult) for tools that haven't implemented it,
  // and for all non-tool-result message types. The drift-catcher test
  // (searchExtraToolsText.test.tsx) renders + compares to keep these in sync.
  //
  // A second-React-root reconcile approach was tried and ruled out
  // (measured 3.1ms/msg, growing — flushSyncWork processes all roots;
  // component hooks mutate shared state → main root accumulates updates).
  const searchTextCache = useRef(new WeakMap<RenderableMessage, string>());
  const extractSearchText = useCallback(
    (msg: RenderableMessage): string => {
      const cached = searchTextCache.current.get(msg);
      if (cached !== undefined) return cached;
      let text = renderableSearchText(msg);
      // If this is a tool_result message and the tool implements
      // extractSearchText, prefer that — it's precise (tool-owned)
      // vs renderableSearchText's field-name heuristic.
      if (msg.type === 'user' && msg.toolUseResult && Array.isArray(msg.message.content)) {
        const tr = msg.message.content.find(b => b.type === 'tool_result');
        if (tr && 'tool_use_id' in tr) {
          const tu = lookups.toolUseByToolUseID.get(tr.tool_use_id);
          const tool = tu && findToolByName(tools, tu.name);
          const extracted = tool?.extractSearchText?.(msg.toolUseResult as never);
          // undefined = tool didn't implement → keep heuristic. Empty
          // string = tool says "nothing to index" → respect that.
          if (extracted !== undefined) text = extracted;
        }
      }
      // Cache LOWERED: setSearchQuery's hot loop indexOfs per keystroke.
      // Lowering here (once, at warm) vs there (every keystroke) trades
      // ~same steady-state memory for zero per-keystroke alloc. Cache
      // GC's with messages on transcript exit. Tool methods return raw;
      // renderableSearchText already lowercases (redundant but cheap).
      const lowered = text.toLowerCase();
      searchTextCache.current.set(msg, lowered);
      return lowered;
    },
    [tools, lookups],
  );

  return (
    <SentryErrorBoundary name="MessagesBoundary">
      {/* Logo */}
      {!hideLogo && !(renderRange && renderRange[0] > 0) && <LogoHeader agentDefinitions={agentDefinitions} />}

      {/* Truncation indicator */}
      {hasTruncatedMessages && (
        <Divider
          title={`${toggleShowAllShortcut} to show ${chalk.bold(hiddenMessageCount)} previous messages`}
          width={columns}
        />
      )}

      {/* Show all indicator */}
      {isTranscriptMode &&
        showAllInTranscript &&
        hiddenMessageCount > 0 &&
        // disableRenderCap (e.g. [ dump-to-scrollback) means we're uncapped
        // as a one-shot escape hatch, not a toggle — ctrl+e is dead and
        // nothing is actually "hidden" to restore.
        !disableRenderCap && (
          <Divider
            title={`${toggleShowAllShortcut} to hide ${chalk.bold(hiddenMessageCount)} previous messages`}
            width={columns}
          />
        )}

      {/* Messages - rendered as memoized MessageRow components.
          flatMap inserts the unseen-divider as a separate keyed sibling so
          (a) non-fullscreen renders pay no per-message Fragment wrap, and
          (b) divider toggle in fullscreen preserves all MessageRows by key.
          Pre-compute derived values instead of passing renderableMessages to
          each row - React Compiler pins props in the fiber's memoCache, so
          passing the array would accumulate every historical version
          (~1-2MB over a 7-turn session). */}
      {virtualScrollRuntimeGate ? (
        <InVirtualListContext.Provider value={true}>
          <VirtualMessageList
            messages={renderableMessages}
            scrollRef={scrollRef}
            columns={columns}
            itemKey={messageKey}
            renderItem={renderMessageRow}
            onItemClick={onItemClick}
            isItemClickable={isItemClickable}
            isItemExpanded={isItemExpanded}
            layoutEpoch={layoutEpoch}
            trackStickyPrompt={trackStickyPrompt}
            selectedIndex={selectedIdx >= 0 ? selectedIdx : undefined}
            cursorNavRef={cursorNavRef}
            setCursor={setCursor}
            jumpRef={jumpRef}
            onSearchMatchesChange={onSearchMatchesChange}
            scanElement={scanElement}
            setPositions={setPositions}
            extractSearchText={extractSearchText}
          />
        </InVirtualListContext.Provider>
      ) : (
        renderableMessages.flatMap(renderMessageRow)
      )}

      {/* gold bw: L&&!Me&&M ? e(Oa,{store}) : null */}
      {hasStreamingText && !isBriefOnly && streamingDisplayStore ? (
        <StreamingTextPreview store={streamingDisplayStore} />
      ) : null}
    </SentryErrorBoundary>
  );
};

/** densable 246 `$M` — non-empty string tool_use id. */
export function hasNonEmptyStreamingToolUseId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0;
}

/**
 * densable 246 `_e` mint — key WeakMap on `contentBlock`, not the
 * StreamingToolUse wrapper (messages.ts recreates the wrapper on each
 * input_json_delta while keeping the same contentBlock ref).
 */
export function resolveMintedStreamingToolUseId(
  map: WeakMap<object, string>,
  stu: StreamingToolUse,
  mint: () => string = randomUUID,
): { id: string; minted: boolean } {
  const raw = stu.contentBlock.id;
  if (hasNonEmptyStreamingToolUseId(raw)) {
    return { id: raw, minted: false };
  }
  const cached = map.get(stu.contentBlock);
  if (cached) return { id: cached, minted: true };
  const minted = mint();
  map.set(stu.contentBlock, minted);
  return { id: minted, minted: true };
}

const EMPTY_STREAMING_TOOL_USES: StreamingToolUse[] = [];

/**
 * densable `class Fm` (@207966081) — preserves previous array reference when
 * `filterStreamingToolUsesWithoutInProgress` produces an identical element list.
 */
class StreamingToolUseFilter {
  previous: StreamingToolUse[] = EMPTY_STREAMING_TOOL_USES;

  next(
    streamingToolUses: StreamingToolUse[],
    inProgressToolUseIDs: Set<string>,
    normalizedToolUseIDs: Set<string>,
  ): StreamingToolUse[] {
    this.previous = filterStreamingToolUsesWithoutInProgress(
      streamingToolUses,
      inProgressToolUseIDs,
      normalizedToolUseIDs,
      this.previous,
    );
    return this.previous;
  }
}

/**
 * densable 246 `jM` / 289 `mI` — streaming tool uses not yet in progress / normalized.
 * Missing `id` is kept (caller mints for render); present ids dedupe.
 */
export function filterStreamingToolUsesWithoutInProgress(
  streamingToolUses: StreamingToolUse[],
  inProgressToolUseIDs: Set<string>,
  normalizedToolUseIDs: Set<string>,
  previous: StreamingToolUse[] = EMPTY_STREAMING_TOOL_USES,
): StreamingToolUse[] {
  const seen = new Set<string>();
  const out: StreamingToolUse[] = [];
  for (const stu of streamingToolUses) {
    const id = stu.contentBlock.id;
    if (hasNonEmptyStreamingToolUseId(id)) {
      if (inProgressToolUseIDs.has(id) || normalizedToolUseIDs.has(id) || seen.has(id)) {
        continue;
      }
      seen.add(id);
    }
    out.push(stu);
  }
  if (out.length === 0) return EMPTY_STREAMING_TOOL_USES;
  if (out.length === previous.length && out.every((item, idx) => item === previous[idx])) {
    return previous;
  }
  return out;
}

/** Key for click-to-expand: tool_use_id where available (so tool_use + its
 *  tool_result expand together), else uuid for groups/thinking. */
function expandKey(msg: RenderableMessage): string {
  return (msg.type === 'assistant' || msg.type === 'user' ? getToolUseID(msg) : null) ?? msg.uuid;
}

// Custom comparator to prevent unnecessary re-renders during streaming.
// Default React.memo does shallow comparison which fails when:
// 1. onOpenRateLimitOptions callback is recreated (doesn't affect render output)
// 2. streamingToolUses array is recreated on every delta, but only contentBlock matters for rendering
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export const Messages = React.memo(MessagesImpl, (prev, next) => {
  const keys = Object.keys(prev) as (keyof typeof prev)[];
  for (const key of keys) {
    if (
      key === 'onOpenRateLimitOptions' ||
      key === 'scrollRef' ||
      key === 'trackStickyPrompt' ||
      key === 'setCursor' ||
      key === 'cursorNavRef' ||
      key === 'jumpRef' ||
      key === 'onSearchMatchesChange' ||
      key === 'scanElement' ||
      key === 'setPositions'
    )
      continue;
    if (prev[key] !== next[key]) {
      if (key === 'streamingToolUses') {
        const p = prev.streamingToolUses;
        const n = next.streamingToolUses;
        if (p.length === n.length && p.every((item, i) => item.contentBlock === n[i]?.contentBlock)) {
          continue;
        }
      }
      if (key === 'inProgressToolUseIDs') {
        if (setsEqual(prev.inProgressToolUseIDs, next.inProgressToolUseIDs)) {
          continue;
        }
      }
      if (key === 'unseenDivider') {
        const p = prev.unseenDivider;
        const n = next.unseenDivider;
        if (p?.firstUnseenUuid === n?.firstUnseenUuid && p?.count === n?.count) {
          continue;
        }
      }
      if (key === 'tools') {
        const p = prev.tools;
        const n = next.tools;
        if (p.length === n.length && p.every((tool, i) => tool.name === n[i]?.name)) {
          continue;
        }
      }
      return false;
    }
  }
  return true;
});

export function shouldRenderStatically(
  message: RenderableMessage,
  streamingToolUseIDs: Set<string>,
  inProgressToolUseIDs: Set<string>,
  siblingToolUseIDs: ReadonlySet<string>,
  screen: Screen,
  lookups: ReturnType<typeof buildMessageLookups>,
): boolean {
  if (screen === 'transcript') {
    return true;
  }
  switch (message.type) {
    case 'attachment':
    case 'user':
    case 'assistant': {
      if (message.type === 'assistant') {
        const block = (message.message!.content as Array<{ type: string; id?: string }>)[0];
        if (block?.type === 'server_tool_use') {
          return lookups.resolvedToolUseIDs.has(block.id!);
        }
      }
      const toolUseID = getToolUseID(message);
      if (!toolUseID) {
        return true;
      }
      if (streamingToolUseIDs.has(toolUseID)) {
        return false;
      }
      if (inProgressToolUseIDs.has(toolUseID)) {
        return false;
      }

      // Check if there are any unresolved PostToolUse hooks for this tool use
      // If so, keep the message transient so the HookProgressMessage can update
      if (hasUnresolvedHooksFromLookup(toolUseID, 'PostToolUse', lookups)) {
        return false;
      }

      return every(siblingToolUseIDs, lookups.resolvedToolUseIDs);
    }
    case 'system': {
      // api errors always render dynamically, since we hide
      // them as soon as we see another non-error message.
      return message.subtype !== 'api_error';
    }
    case 'grouped_tool_use': {
      const allResolved = message.messages.every(msg => {
        const content = (msg.message!.content as Array<{ type: string; id?: string }>)[0];
        return content?.type === 'tool_use' && lookups.resolvedToolUseIDs.has(content.id!);
      });
      return allResolved;
    }
    case 'collapsed_read_search': {
      // In prompt mode, never mark as static to prevent flicker between API turns
      // (In transcript mode, we already returned true at the top of this function)
      return false;
    }
    default:
      return true;
  }
}
