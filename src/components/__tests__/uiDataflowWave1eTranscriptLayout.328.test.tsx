import { describe, expect, test } from 'bun:test';
import type { UUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import React, { useContext, useLayoutEffect } from 'react';
import {
  instances,
  ModalContext,
  type ScrollBoxHandle,
  ScrollViewport,
  Text,
  ThemeProvider,
  wrappedRender as render,
} from '@anthropic/ink';
import { cellAt, type Screen } from '../../../packages/@ant/ink/src/core/screen.js';
import { useModalRevealEnd } from '../../context/modalContext.js';
import { DialogHost } from '../../dialog/DialogHost.js';
import { DialogStoreProvider } from '../../dialog/DialogStoreContext.js';
import { createDialogStore } from '../../dialog/dialogStore.js';
import { HOST_PARKED_TYPING_QUESTION } from '../../dialog/hostPark.js';
import { PERMISSION_EXIT_PLAN_MODE_V2_KIND } from '../../dialog/specs/permissionKinds.js';
import type { BashEditDiff } from '../../../packages/builtin-tools/src/tools/BashTool/bashEditDiff.js';
import BashToolResultMessage, {
  resetFirstExplainedDiff,
} from '../../../packages/builtin-tools/src/tools/BashTool/BashToolResultMessage.js';
import {
  getCwdState,
  getSessionId,
  setCwdState,
  snapshotOutputTokensForTurn,
  switchSession,
} from '../../bootstrap/state.js';
import { TasksV2Store } from '../../hooks/useTasksV2.js';
import { AppStateProvider, TaskStoreContext } from '../../state/AppState.js';
import type { Tools } from '../../Tool.js';
import type { SessionId } from '../../types/ids.js';
import type {
  AssistantMessage,
  CollapsedReadSearchGroup,
  GroupedToolUseMessage,
  Message as MessageType,
  NormalizedAssistantMessage,
  NormalizedUserMessage,
  ProgressMessage,
  UserMessage,
} from '../../types/message.js';
import type { QueuedCommand } from '../../types/textInputTypes.js';
import { getBgInFlightRegistry, resetBgInFlightRegistry } from '../../utils/bgNeedsInputBridge.js';
import { getCwd, getCwdVersion, subscribeCwd } from '../../utils/cwd.js';
import { applyGrouping, type MessageWithoutProgress } from '../../utils/groupToolUses.js';
import {
  buildMessageLookups,
  IncrementalNormalizer,
  normalizeMessages,
  updateMessageLookupsIncremental,
} from '../../utils/messages.js';
import { ScrollPin } from '../../utils/scrollPin.js';
import { computeUnseenDivider, FullscreenLayout } from '../FullscreenLayout.js';
import { JFaInFlightProducer } from '../JFaInFlightProducer.js';
import { areMessagePropsEqual, type Props as MessageComponentProps } from '../Message.js';
import { shouldRenderStatically } from '../Messages.js';
import { ModalScroller } from '../ModalScroller.js';
import { pairQueuedCommandMessages } from '../PromptInput/PromptInputQueuedCommands.js';
import { computeClampedHighlightRowOffset } from '../VirtualMessageList.js';

const ROOT = join(import.meta.dir, '../../..');

function createTestStreams(columns = 60, rows = 14) {
  const stdout = Object.assign(new PassThrough(), {
    columns,
    rows,
    isTTY: true,
  }) as unknown as NodeJS.WriteStream;
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {
      return stdin;
    },
    ref() {
      return stdin;
    },
    unref() {
      return stdin;
    },
  }) as unknown as NodeJS.ReadStream;
  return { stdout, stdin };
}

function makeUuid(suffix: number): UUID {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}` as UUID;
}

function makeUserMsg(suffix: number, text: string): UserMessage {
  return {
    type: 'user',
    uuid: makeUuid(suffix),
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: text },
  } as unknown as UserMessage;
}

function makeAssistantTextMsg(
  suffix: number,
  apiId: string,
  text: string,
  stopReason: string | null = 'end_turn',
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: makeUuid(suffix),
    timestamp: '2026-01-01T00:00:01.000Z',
    message: {
      id: apiId,
      role: 'assistant',
      stop_reason: stopReason,
      content: [{ type: 'text', text }],
    },
  } as unknown as AssistantMessage;
}

function makeAssistantToolUseMsg(
  suffix: number,
  apiId: string,
  toolUseId: string,
  toolName = 'Grep',
  stopReason: string | null = 'tool_use',
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: makeUuid(suffix),
    timestamp: '2026-01-01T00:00:02.000Z',
    message: {
      id: apiId,
      role: 'assistant',
      stop_reason: stopReason,
      content: [{ type: 'tool_use', id: toolUseId, name: toolName, input: {} }],
    },
  } as unknown as AssistantMessage;
}

function makeToolResultUserMsg(suffix: number, toolUseId: string, text = 'ok'): UserMessage {
  return {
    type: 'user',
    uuid: makeUuid(suffix),
    timestamp: '2026-01-01T00:00:03.000Z',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }],
    },
  } as unknown as UserMessage;
}

function makeProgressMsg(suffix: number, parentToolUseID: string, elapsed: number): ProgressMessage {
  return {
    type: 'progress',
    uuid: makeUuid(suffix),
    timestamp: '2026-01-01T00:00:04.000Z',
    parentToolUseID,
    toolUseID: parentToolUseID,
    data: {
      type: 'bash_progress',
      elapsedTimeSeconds: elapsed,
      output: `tick-${elapsed}`,
      fullOutput: `tick-${elapsed}`,
      totalLines: 1,
    },
  } as unknown as ProgressMessage;
}

describe('Wave 1E Domain 3 — Transcript, VirtualList, ScrollPin, Layout, Queue, JFa, StatusLine, BashDiff', () => {
  test('P0-D3-1: IncrementalNormalizer preserves normalized object references across progress ticks and appended turns', () => {
    const normalizer = new IncrementalNormalizer({ filterEmpty: true });
    const u1 = makeUserMsg(1, 'hello');
    const a1 = makeAssistantToolUseMsg(2, 'api-1', 'tu-1', 'Bash');
    const p1 = makeProgressMsg(3, 'tu-1', 1);
    const p2 = makeProgressMsg(4, 'tu-1', 2);

    const out1 = normalizer.normalize([u1, a1, p1]);
    expect(out1).toHaveLength(3);

    // Progress tick replacement in a small (< RECENT) transcript preserves
    // exact object references for unchanged user & assistant messages via WeakMap.
    const out2 = normalizer.normalize([u1, a1, p2]);
    expect(out2).toHaveLength(3);
    expect(out2[0]).toBe(out1[0]);
    expect(out2[1]).toBe(out1[1]);
    expect(out2[2]).toBe(p2);

    // Larger transcript (> RECENT=4): appending a new message walks only the tail
    // and preserves every earlier normalized message object reference.
    const many: MessageType[] = [];
    for (let i = 10; i < 30; i++) {
      many.push(makeUserMsg(i, `user-${i}`));
    }
    const big1 = normalizer.normalize(many);
    const tail = makeAssistantTextMsg(31, 'api-31', 'reply');
    const big2 = normalizer.normalize([...many, tail]);
    expect(big2).toHaveLength(many.length + 1);
    expect(normalizer.lastWalked).toBeLessThanOrEqual(IncrementalNormalizer.RECENT);
    for (let i = 0; i < many.length; i++) {
      expect(big2[i]).toBe(big1[i]);
    }

    // Multi-block message flips isNewChain identically to stateless normalizeMessages().
    const multiBlock = {
      type: 'assistant',
      uuid: makeUuid(40),
      timestamp: '2026-01-01T00:00:05.000Z',
      message: {
        id: 'api-40',
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'part 1' },
          { type: 'text', text: 'part 2' },
        ],
      },
    } as unknown as AssistantMessage;
    const afterMulti = makeUserMsg(41, 'follow up');
    const freshNormalizer = new IncrementalNormalizer();
    const incOut = freshNormalizer.normalize([u1, multiBlock, afterMulti]);
    const statelessOut = normalizeMessages([u1, multiBlock, afterMulti]);
    expect(incOut.map(m => m.uuid)).toEqual(statelessOut.map(m => m.uuid));
  });

  test('P0-D3-1: applyGrouping WeakMap preserves GroupedToolUseMessage references & Messages.tsx removes duplicate loop-fold + narrows extractSearchText deps', () => {
    const groupableTools = [{ name: 'Grep', renderGroupedToolUse: () => null }] as unknown as Tools;
    const m1 = normalizeMessages([makeAssistantToolUseMsg(1, 'api-g1', 'tu-g1', 'Grep')])[0]!;
    const m2 = normalizeMessages([makeAssistantToolUseMsg(2, 'api-g1', 'tu-g2', 'Grep')])[0]!;
    const extraText = normalizeMessages([makeAssistantTextMsg(3, 'api-g2', 'after')])[0]!;

    const first = applyGrouping([m1, m2] as MessageWithoutProgress[], groupableTools, false);
    const second = applyGrouping([m1, m2, extraText] as MessageWithoutProgress[], groupableTools, false);
    expect(first.messages[0]?.type).toBe('grouped_tool_use');
    expect(second.messages[0]).toBe(first.messages[0]);

    // When a tool_result arrives for one of the grouped tool uses, a fresh object is emitted.
    const r1 = normalizeMessages([makeToolResultUserMsg(4, 'tu-g1', 'hit')])[0]!;
    const third = applyGrouping([m1, m2, r1, extraText] as MessageWithoutProgress[], groupableTools, false);
    expect(third.messages[0]).not.toBe(first.messages[0]);
    expect((third.messages[0] as GroupedToolUseMessage).results).toHaveLength(1);

    const messagesSrc = readFileSync(join(ROOT, 'src/components/Messages.tsx'), 'utf8');
    expect(messagesSrc).toContain('new IncrementalNormalizer({ filterEmpty: true })');
    expect(messagesSrc.split('filterFoldedLoopNoopMessages(').length - 1).toBe(1);
    expect(messagesSrc).toContain('transcriptLookups.toolUseByToolUseID.get(tr.tool_use_id)');
    expect(messagesSrc).toContain('[tools, transcriptLookups]');
  });

  test('P1-D3-1: computeClampedHighlightRowOffset clamps scrollTop against maxScroll near bottom of transcript', () => {
    // ScrollBox height=100, viewport=20 => maxScroll=80.
    // scrollTo(88) writes unclamped 88 before paint; highlight must clamp to 80
    // so item at top=90 lands at lo=10, rowOffset=vpTop+10=11 (match row 13).
    const res = computeClampedHighlightRowOffset({
      top: 90,
      vpTop: 1,
      vpHeight: 20,
      scrollHeight: 100,
      scrollTop: 88,
      pendingDelta: 0,
    });
    expect(res.clampedScrollTop).toBe(80);
    expect(res.lo).toBe(10);
    expect(res.rowOffset).toBe(11);

    // Content shorter than viewport => maxScroll=0, clampedScrollTop=0.
    const shortRes = computeClampedHighlightRowOffset({
      top: 5,
      vpTop: 2,
      vpHeight: 20,
      scrollHeight: 12,
      scrollTop: 7,
      pendingDelta: 3,
    });
    expect(shortRes.clampedScrollTop).toBe(0);
    expect(shortRes.rowOffset).toBe(7);

    // Pending negative delta clamps at 0.
    const negRes = computeClampedHighlightRowOffset({
      top: 4,
      vpTop: 1,
      vpHeight: 20,
      scrollHeight: 100,
      scrollTop: 2,
      pendingDelta: -10,
    });
    expect(negRes.clampedScrollTop).toBe(0);
    expect(negRes.rowOffset).toBe(5);
  });

  test('P1-D3-4: shouldRenderStatically keeps live tools/subagents dynamic in ctrl+o and Message.areMessagePropsEqual updates growing grouped/collapsed rows', () => {
    const tuMsg = normalizeMessages([makeAssistantToolUseMsg(1, 'api-1', 'tu-live', 'Bash')])[0]!;
    const unresolvedLookups = buildMessageLookups([tuMsg], [tuMsg]);
    const inProgress = new Set(['tu-live']);
    const emptySet = new Set<string>();

    // In ctrl+o (screen === 'transcript'), in-progress / unresolved tools must NOT be static.
    expect(
      shouldRenderStatically(tuMsg, emptySet, inProgress, new Set(['tu-live']), 'transcript', unresolvedLookups),
    ).toBe(false);
    expect(
      shouldRenderStatically(
        tuMsg,
        new Set(['tu-live']),
        emptySet,
        new Set(['tu-live']),
        'transcript',
        unresolvedLookups,
      ),
    ).toBe(false);

    // Once resolved and no longer in progress, it becomes static.
    const trMsg = normalizeMessages([makeToolResultUserMsg(2, 'tu-live', 'done')])[0]!;
    const resolvedLookups = buildMessageLookups([tuMsg, trMsg], [tuMsg, trMsg]);
    expect(shouldRenderStatically(tuMsg, emptySet, emptySet, new Set(['tu-live']), 'transcript', resolvedLookups)).toBe(
      true,
    );

    // Grouped tool use with an unresolved member stays dynamic in ctrl+o.
    const tu2 = normalizeMessages([makeAssistantToolUseMsg(3, 'api-1', 'tu-live-2', 'Bash')])[0]!;
    const grouped: GroupedToolUseMessage = {
      type: 'grouped_tool_use',
      toolName: 'Bash',
      messages: [tuMsg as NormalizedAssistantMessage, tu2 as NormalizedAssistantMessage],
      results: [trMsg as NormalizedUserMessage],
      displayMessage: tuMsg as NormalizedAssistantMessage,
      uuid: `grouped-${tuMsg.uuid}`,
      timestamp: tuMsg.timestamp,
      messageId: 'api-1',
    };
    expect(shouldRenderStatically(grouped, emptySet, emptySet, emptySet, 'transcript', resolvedLookups)).toBe(false);

    // Collapsed read/search group with unresolved tool stays dynamic in ctrl+o.
    const collapsed: CollapsedReadSearchGroup = {
      type: 'collapsed_read_search',
      uuid: `collapsed-${tuMsg.uuid}`,
      timestamp: tuMsg.timestamp,
      messages: [tuMsg as NormalizedAssistantMessage],
      searchCount: 1,
      readCount: 0,
      listCount: 0,
      replCount: 0,
      memorySearchCount: 0,
      readFilePaths: [],
      searchArgs: [],
      listArgs: [],
      displayMessage: tuMsg as NormalizedAssistantMessage,
    } as unknown as CollapsedReadSearchGroup;
    expect(shouldRenderStatically(collapsed, emptySet, inProgress, emptySet, 'transcript', unresolvedLookups)).toBe(
      false,
    );
    expect(shouldRenderStatically(collapsed, emptySet, emptySet, emptySet, 'transcript', resolvedLookups)).toBe(true);

    // Message.areMessagePropsEqual must NOT bail out when a grouped_tool_use grows while keeping same uuid.
    const groupedGrown: GroupedToolUseMessage = {
      ...grouped,
      results: [trMsg as NormalizedUserMessage, trMsg as NormalizedUserMessage],
    };
    const baseProps = {
      message: grouped,
      lookups: resolvedLookups,
      addMargin: true,
      tools: [],
      commands: [],
      verbose: false,
      inProgressToolUseIDs: emptySet,
      progressMessagesForMessage: [],
      shouldAnimate: false,
      shouldShowDot: true,
      isTranscriptMode: true,
      isStatic: true,
      containerWidth: 80,
      lastThinkingBlockId: null,
      latestBashOutputUUID: null,
    } as unknown as MessageComponentProps;

    expect(areMessagePropsEqual(baseProps, { ...baseProps })).toBe(true);
    expect(areMessagePropsEqual(baseProps, { ...baseProps, message: groupedGrown })).toBe(false);
  });

  test('P1-D3-5: updateMessageLookupsIncremental preserves multi-tool siblingToolUseIDs, never mutates existing lookups, and falls back on reorder', () => {
    const tu1 = normalizeMessages([makeAssistantToolUseMsg(1, 'api-par', 'tu-a', 'Read')])[0]!;
    const tu2 = normalizeMessages([makeAssistantToolUseMsg(2, 'api-par', 'tu-b', 'Read')])[0]!;
    const tr1 = normalizeMessages([makeToolResultUserMsg(3, 'tu-a', 'content-a')])[0]!;

    // Step 1: initial build with tu1 only
    const baseLookups = buildMessageLookups([tu1], [tu1]);
    expect([...baseLookups.siblingToolUseIDs.get('tu-a')!]).toEqual(['tu-a']);

    // Step 2: append normalized tu2 sharing apiMessageId 'api-par'
    const updated = updateMessageLookupsIncremental(baseLookups, 1, 1, [tu1, tu2], [tu1, tu2], {
      previousNormalizedMessages: [tu1],
      previousMessages: [tu1],
    });
    expect(updated).not.toBeNull();
    expect(updated).not.toBe(baseLookups);

    // Both tu-a and tu-b must see the full sibling set {'tu-a', 'tu-b'}!
    expect(updated!.siblingToolUseIDs.get('tu-a')).toEqual(new Set(['tu-a', 'tu-b']));
    expect(updated!.siblingToolUseIDs.get('tu-b')).toEqual(new Set(['tu-a', 'tu-b']));

    // Existing lookups object and its internal Sets/Maps must be completely unmutated!
    expect(baseLookups.siblingToolUseIDs.get('tu-a')).toEqual(new Set(['tu-a']));
    expect(baseLookups.siblingToolUseIDs.has('tu-b')).toBe(false);
    expect(baseLookups.normalizedMessageCount).toBe(1);

    // Step 3: reorderMessagesInUI inserts tr1 between tu1 and tu2 -> NOT strictly append-only -> returns null
    const reordered = updateMessageLookupsIncremental(updated!, 2, 2, [tu1, tu2, tr1], [tu1, tr1, tu2], {
      previousNormalizedMessages: [tu1, tu2],
      previousMessages: [tu1, tu2],
    });
    expect(reordered).toBeNull();

    // Even without options, seeing already-known 'tu-b' at index >= previousMessageCount returns null!
    const reorderedNoOpts = updateMessageLookupsIncremental(updated!, 2, 2, [tu1, tu2, tr1], [tu1, tr1, tu2]);
    expect(reorderedNoOpts).toBeNull();
  });

  test('P1-D3-6: Messages.tsx precomputes labelledRenderableRows Set instead of O(N) indexOf inside isItemClickable', () => {
    const messagesSrc = readFileSync(join(ROOT, 'src/components/Messages.tsx'), 'utf8');
    expect(messagesSrc).toContain('const labelledRenderableRows = useMemo');
    expect(messagesSrc).toContain('labelledRowsRef.current.has(msg)');
    expect(messagesSrc).not.toContain('currentMessages.indexOf(msg)');
  });

  test('P1-D3-7 & P1-D3-3: ScrollPin resets divider/scrolledAway on head UUID compaction replacement and exposes resetForCompaction / resetForTranscriptExit', () => {
    let scrolledToBottomCount = 0;
    const fakeHandle = {
      isSticky: () => false,
      getScrollTop: () => 10,
      getPendingDelta: () => 0,
      getScrollHeight: () => 500,
      getViewportHeight: () => 20,
      scrollToBottom: () => {
        scrolledToBottomCount++;
      },
      scrollTo: () => {},
      subscribe: () => () => {},
    } as unknown as ScrollBoxHandle;

    const pin = new ScrollPin({
      computeDivider: (msgs, idx) => computeUnseenDivider(msgs, idx),
    });
    const detach = pin.viewport.attach(fakeHandle);

    const old1 = makeAssistantTextMsg(1, 'api-1', 'old 1');
    const old2 = makeAssistantTextMsg(2, 'api-2', 'old 2');
    const old3 = makeAssistantTextMsg(3, 'api-3', 'old 3');
    pin.syncMessages([old1, old2]);
    pin.onUserScroll(false, fakeHandle);
    expect(pin.dividerY).toBe(500);
    expect(pin.isScrolledAway).toBe(true);

    pin.syncMessages([old1, old2, old3]);
    expect(pin.getSnapshot().unseenDivider?.count).toBe(1);

    // Compaction replaces transcript with 3 NEW messages (length 3 >= dividerIndex 2!).
    // Head message UUID changed -> ScrollPin MUST reset dividerY, unseenDivider, and scrolledAway.
    const compact1 = makeAssistantTextMsg(101, 'api-c1', 'compact boundary');
    const compact2 = makeAssistantTextMsg(102, 'api-c2', 'summary');
    const compact3 = makeAssistantTextMsg(103, 'api-c3', 'post-compact');
    pin.syncMessages([compact1, compact2, compact3]);
    expect(pin.dividerY).toBeNull();
    expect(pin.getSnapshot().unseenDivider).toBeUndefined();
    expect(pin.isScrolledAway).toBe(false);

    // Explicit resetForCompaction & resetForTranscriptExit
    pin.onUserScroll(false, fakeHandle);
    expect(pin.dividerY).toBe(500);
    expect(pin.isScrolledAway).toBe(true);
    pin.resetForCompaction();
    expect(pin.dividerY).toBeNull();
    expect(pin.isScrolledAway).toBe(false);

    // P1-8: Older-history prepends (useAssistantHistory: [...older, ...prev]
    // and transient index-0 sentinel insert/removal) must NOT wipe dividerY,
    // scrolledAway, or unseenDivider, and shiftDivider must shift cleanly.
    const h1 = makeAssistantTextMsg(201, 'api-h1', 'history 1');
    const h2 = makeAssistantTextMsg(202, 'api-h2', 'history 2');
    const h3 = makeAssistantTextMsg(203, 'api-h3', 'history 3');
    const older1 = makeAssistantTextMsg(198, 'api-o1', 'older 1');
    const older2 = makeAssistantTextMsg(199, 'api-o2', 'older 2');
    const sentinel = {
      type: 'system',
      subtype: 'informational',
      content: 'loading older messages…',
      isMeta: false,
      timestamp: '2026-01-01T00:00:00.000Z',
      uuid: makeUuid(197),
      level: 'info',
    } as unknown as MessageType;

    pin.syncMessages([h1, h2]);
    pin.onUserScroll(false, fakeHandle);
    pin.syncMessages([h1, h2, h3]);
    expect(pin.dividerY).toBe(500);
    expect(pin.isScrolledAway).toBe(true);
    expect(pin.getSnapshot().unseenDivider).toEqual({ firstUnseenUuid: h3.uuid, count: 1 });

    // Step 1: useAssistantHistory inserts loading sentinel at index 0
    pin.syncMessages([sentinel, h1, h2, h3]);
    expect(pin.dividerY).toBe(500);
    expect(pin.isScrolledAway).toBe(true);
    expect(pin.getSnapshot().unseenDivider).toEqual({ firstUnseenUuid: h3.uuid, count: 1 });

    // Step 2: fetchOlderEvents resolves with hasMore=true -> drops sentinel and prepends [older1, older2]
    pin.syncMessages([older1, older2, h1, h2, h3]);
    expect(pin.dividerY).toBe(500);
    expect(pin.isScrolledAway).toBe(true);
    // Layout effect runs shiftDivider(2, 120) -> shifts dividerIndex 2->4 and dividerY 500->620 without double-shifting
    pin.shiftDivider(2, 120);
    expect(pin.dividerY).toBe(620);
    expect(pin.isScrolledAway).toBe(true);
    expect(pin.getSnapshot().unseenDivider).toEqual({ firstUnseenUuid: h3.uuid, count: 1 });

    // Direct prepend without sentinel also preserves pin state
    const older0 = makeAssistantTextMsg(196, 'api-o0', 'older 0');
    pin.syncMessages([older0, older1, older2, h1, h2, h3]);
    pin.shiftDivider(1, 40);
    expect(pin.dividerY).toBe(660);
    expect(pin.isScrolledAway).toBe(true);
    expect(pin.getSnapshot().unseenDivider).toEqual({ firstUnseenUuid: h3.uuid, count: 1 });

    // Subsequent append after prepend increments unseen count accurately
    const h4 = makeAssistantTextMsg(204, 'api-h4', 'history 4');
    pin.syncMessages([older0, older1, older2, h1, h2, h3, h4]);
    expect(pin.getSnapshot().unseenDivider).toEqual({ firstUnseenUuid: h3.uuid, count: 1 });

    pin.onUserScroll(false, fakeHandle);
    expect(pin.isScrolledAway).toBe(true);
    pin.resetForTranscriptExit();
    expect(pin.dividerY).toBeNull();
    expect(pin.isScrolledAway).toBe(false);
    expect(scrolledToBottomCount).toBe(1);

    detach();
    pin.dispose();
  });

  test('P1-D3-8: pairQueuedCommandMessages pairs every normalized block with its originating QueuedCommand', () => {
    const cmdMulti: QueuedCommand = {
      value: [
        { type: 'text', text: 'first block' },
        { type: 'text', text: 'second block' },
      ],
      mode: 'prompt',
      ideSelection: { filePath: '/tmp/a.ts', text: 'const x = 1', lineCount: 1 },
    };
    const cmdSecond: QueuedCommand = {
      value: 'second queued prompt',
      mode: 'prompt',
      ideSelection: { filePath: '/tmp/b.ts', text: 'const y = 2', lineCount: 1 },
    };

    const pairs = pairQueuedCommandMessages([cmdMulti, cmdSecond]);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]?.command).toBe(cmdMulti);
    expect(pairs[1]?.command).toBe(cmdMulti);
    expect(pairs[2]?.command).toBe(cmdSecond);
    // ideSelection renders only on the final block of cmdMulti (pairs[1], where pairs[2].command !== cmdMulti)
    expect(pairs[1]?.command !== pairs[2]?.command).toBe(true);
    expect(pairs[0]?.command === pairs[1]?.command).toBe(true);
  });

  test('P2-D3-11 & P2-D1-21: JFaInFlightProducer reacts to TasksV2Store, session switch, and turn token budget', async () => {
    const prevKind = process.env.CLAUDE_CODE_SESSION_KIND;
    const prevSessionId = getSessionId();
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg';
    resetBgInFlightRegistry();

    const listeners = new Set<() => void>();
    let snapshotTasks: Array<{
      id: string;
      subject: string;
      description: string;
      status: 'pending' | 'in_progress' | 'completed';
      blocks: string[];
      blockedBy: string[];
    }> = [];
    const mockTaskStore = {
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      getSnapshot: () => snapshotTasks,
    } as unknown as TasksV2Store;

    const { stdout, stdin } = createTestStreams(60, 10);
    const instance = await render(
      <AppStateProvider>
        <TaskStoreContext.Provider value={mockTaskStore}>
          <JFaInFlightProducer />
        </TaskStoreContext.Provider>
      </AppStateProvider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await new Promise(r => setTimeout(r, 60));

      // 1. TasksV2Store emits a new task -> JFaInFlightProducer stamps it into bg in-flight registry
      snapshotTasks = [
        {
          id: 'task-v2-1',
          subject: 'Build widget',
          description: 'Build widget',
          status: 'in_progress',
          blocks: [],
          blockedBy: [],
        },
      ];
      for (const fn of listeners) fn();
      await new Promise(r => setTimeout(r, 80));
      const snap1 = getBgInFlightRegistry();
      expect(snap1?.items?.some(item => item.id === 'todo:task-v2-1')).toBe(true);

      // 2. Turn token budget changes + session switches -> producer re-stamps with updated budget
      snapshotOutputTokensForTurn(1000);
      switchSession('00000000-0000-4000-8000-000000009999' as SessionId);
      await new Promise(r => setTimeout(r, 80));
      const snap2 = getBgInFlightRegistry();
      const budget = snap2?.budget as { spent: number; target: number } | undefined;
      expect(budget?.target).toBe(1000);
    } finally {
      instance.unmount();
      snapshotOutputTokensForTurn(null);
      switchSession(prevSessionId);
      resetBgInFlightRegistry();
      if (prevKind === undefined) {
        delete process.env.CLAUDE_CODE_SESSION_KIND;
      } else {
        process.env.CLAUDE_CODE_SESSION_KIND = prevKind;
      }
    }
  });

  test('P2-D3-12 & P2-D4-16: ModalScroller resets scrollTop & claimedHeight on modal swap and tiny dimensions clamp >= 0', async () => {
    const scrollViewport = new ScrollViewport();
    const claimedHistory: Array<number | null> = [];

    function ModalA() {
      const ctx = useContext(ModalContext);
      useLayoutEffect(() => {
        ctx?.claimScrollBox?.(4);
      }, [ctx]);
      return (
        <>
          {Array.from({ length: 24 }, (_, idx) => (
            <Text key={idx}>{`MODAL_A_ROW_${idx}`}</Text>
          ))}
        </>
      );
    }

    function ModalB() {
      return (
        <>
          {Array.from({ length: 24 }, (_, idx) => (
            <Text key={idx}>{`MODAL_B_ROW_${idx}`}</Text>
          ))}
        </>
      );
    }

    const { stdout, stdin } = createTestStreams(60, 14);
    const instance = await render(
      <ThemeProvider initialState="dark">
        <ModalScroller
          scrollViewport={scrollViewport}
          maxRows={8}
          modalKey="modal-a"
          onClaim={h => claimedHistory.push(h)}
        >
          <ModalA />
        </ModalScroller>
      </ThemeProvider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await new Promise(r => setTimeout(r, 80));
      expect(claimedHistory.at(-1)).toBe(4);
      scrollViewport.handle?.scrollTo(10);

      // Swap directly to ModalB without unmounting ModalScroller
      instance.rerender(
        <ThemeProvider initialState="dark">
          <ModalScroller
            scrollViewport={scrollViewport}
            maxRows={8}
            modalKey="modal-b"
            onClaim={h => claimedHistory.push(h)}
          >
            <ModalB />
          </ModalScroller>
        </ThemeProvider>,
      );
      await new Promise(r => setTimeout(r, 80));
      expect(claimedHistory.at(-1)).toBeNull();
      expect(scrollViewport.handle?.getScrollTop() ?? 0).toBe(0);

      // P1-6A: Swapping directly to a modal that claims height in useLayoutEffect
      // on mount (e.g. ExitPlanMode) must NOT be clobbered by parent cleanup!
      function ModalCClaiming() {
        const ctx = useContext(ModalContext);
        useLayoutEffect(() => {
          ctx?.claimScrollBox?.(6);
        }, [ctx]);
        return <Text>MODAL_C_CLAIMING</Text>;
      }
      instance.rerender(
        <ThemeProvider initialState="dark">
          <ModalScroller
            scrollViewport={scrollViewport}
            maxRows={12}
            modalKey="modal-c"
            onClaim={h => claimedHistory.push(h)}
          >
            <ModalCClaiming />
          </ModalScroller>
        </ThemeProvider>,
      );
      await new Promise(r => setTimeout(r, 80));
      expect(claimedHistory.at(-1)).toBe(6);

      // P1-6A: Swapping directly to a modal that calls revealEnd() in
      // useLayoutEffect on mount must keep scroll snapped to end!
      function ModalDRevealEnd() {
        const revealEnd = useModalRevealEnd();
        useLayoutEffect(() => revealEnd?.(), [revealEnd]);
        return (
          <>
            {Array.from({ length: 24 }, (_, idx) => (
              <Text key={idx}>{`MODAL_D_ROW_${idx}`}</Text>
            ))}
          </>
        );
      }
      instance.rerender(
        <ThemeProvider initialState="dark">
          <ModalScroller
            scrollViewport={scrollViewport}
            maxRows={8}
            modalKey="modal-d"
            onClaim={h => claimedHistory.push(h)}
          >
            <ModalDRevealEnd />
          </ModalScroller>
        </ThemeProvider>,
      );
      await new Promise(r => setTimeout(r, 120));
      expect(claimedHistory.at(-1)).toBeNull();
      expect(scrollViewport.handle?.getScrollTop() ?? 0).toBeGreaterThan(0);
    } finally {
      instance.unmount();
    }

    // Verify unclamped negative layout dimensions are guarded with Math.max(0, ...)
    const layoutSrc = readFileSync(join(ROOT, 'src/components/FullscreenLayout.tsx'), 'utf8');
    expect(layoutSrc).toContain('const maxModalRows = Math.max(0, terminalRows - MODAL_TRANSCRIPT_PEEK - 1);');
    expect(layoutSrc).toContain('const modalColumns = Math.max(0, columns - 4);');
    expect(layoutSrc).toContain('maxHeight={Math.max(0, terminalRows - MODAL_TRANSCRIPT_PEEK)}');

    const scrollerSrc = readFileSync(join(ROOT, 'src/components/ModalScroller.tsx'), 'utf8');
    expect(scrollerSrc).toContain('const remainingRows = Math.max(0, maxRows - (claimedHeight ?? 0));');
    expect(scrollerSrc).toContain('Math.max(0, remainingRows)');

    const assistantTextSrc = readFileSync(join(ROOT, 'src/components/messages/AssistantTextMessage.tsx'), 'utf8');
    expect(assistantTextSrc).toContain('width={Math.max(0, columns - 10)}');
  });

  test('P2-D3-13 & BashToolResultMessage: cwd external store notifies subscribers, StatusLine fixes applied, and BashEditDiff uses WeakRef', async () => {
    const originalCwd = getCwdState();
    const originalVersion = getCwdVersion();
    let notifications = 0;
    const unsub = subscribeCwd(() => {
      notifications++;
    });
    try {
      const nextCwd = originalCwd === '/tmp' ? '/var/tmp' : '/tmp';
      setCwdState(nextCwd);
      expect(getCwd()).toBe(nextCwd);
      expect(notifications).toBe(1);
      expect(getCwdVersion()).toBe(originalVersion + 1);
    } finally {
      unsub();
      setCwdState(originalCwd);
    }

    const statusLineSrc = readFileSync(join(ROOT, 'src/components/StatusLine.tsx'), 'utf8');
    expect(statusLineSrc).toContain('useSyncExternalStore(subscribeCwd, getCwd, getCwd)');
    expect(statusLineSrc).toContain('const builtinExceeds200kTokens = useMemo');
    expect(statusLineSrc).toContain('const builtinRateLimits = useMemo');
    // cacheOnResponse must run inside useEffect, not synchronously in render body
    const cachePillStart = statusLineSrc.indexOf('function CachePill(');
    const cachePillEnd = statusLineSrc.indexOf('export function statusLineShouldDisplay(');
    const cachePillBody = statusLineSrc.slice(cachePillStart, cachePillEnd);
    const effectIdx = cachePillBody.indexOf('useEffect(() => {\n    if (usage === null');
    const callIdx = cachePillBody.indexOf('cacheOnResponse(usage)');
    expect(effectIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(effectIdx);

    // BashToolResultMessage uses WeakRef (not strong singleton) and supports resetFirstExplainedDiff
    const bashResultSrc = readFileSync(
      join(ROOT, 'packages/builtin-tools/src/tools/BashTool/BashToolResultMessage.tsx'),
      'utf8',
    );
    expect(bashResultSrc).toContain('WeakRef<BashEditDiff>');
    expect(bashResultSrc).not.toContain('let firstExplainedDiff: BashEditDiff | null = null');

    resetFirstExplainedDiff();
    const diff1: BashEditDiff = {
      files: [
        {
          filePath: '/tmp/foo.ts',
          created: false,
          deleted: false,
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
        },
      ],
      moreFiles: 0,
      skipped: false,
      unavailable: false,
      shared: false,
    };
    const { stdout, stdin } = createTestStreams(80, 12);
    const inst = await render(
      <ThemeProvider initialState="dark">
        <BashToolResultMessage content={{ stdout: '', stderr: '', bashEditDiff: diff1 }} verbose={false} />
      </ThemeProvider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await new Promise(r => setTimeout(r, 40));
      resetFirstExplainedDiff();
    } finally {
      inst.unmount();
    }
  });

  test('P1-6B & P2-11: FullscreenLayout isolates toolJSX modal key from unrelated dialogStore churn & draft-parked modal cue is visible once in fullscreen and non-fullscreen', async () => {
    const readScreen = (stdout: NodeJS.WriteStream): string => {
      const ink = instances.get(stdout) as unknown as { frontFrame?: { screen?: Screen } };
      const screen = ink?.frontFrame?.screen;
      if (!screen) return '';
      const lines: string[] = [];
      for (let y = 0; y < screen.height; y++) {
        let row = '';
        for (let x = 0; x < screen.width; x++) {
          row += cellAt(screen, x, y)?.char ?? ' ';
        }
        lines.push(row.trimEnd());
      }
      return lines.join('\n');
    };

    const prevFullscreen = process.env.CLAUDE_CODE_NO_FLICKER;
    process.env.CLAUDE_CODE_NO_FLICKER = '1';
    try {
      // P1-6B: Changing dialogStore while FullscreenLayout renders a toolJSX modal
      // must NOT remount or reset the toolJSX modal's scroll position.
      const dialogStore = createDialogStore();
      const modalScrollViewport = new ScrollViewport();
      let toolJsxMounts = 0;
      function ToolPanel() {
        useLayoutEffect(() => {
          toolJsxMounts++;
        }, []);
        return (
          <>
            {Array.from({ length: 24 }, (_, idx) => (
              <Text key={idx}>{`TOOL_PANEL_ROW_${idx}`}</Text>
            ))}
          </>
        );
      }
      const { stdout, stdin } = createTestStreams(80, 18);
      const inst = await render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <DialogStoreProvider store={dialogStore}>
              <FullscreenLayout
                modalScrollViewport={modalScrollViewport}
                scrollable={<Text>SCROLL</Text>}
                bottom={<Text>PROMPT</Text>}
                modal={{ key: 'tooljsx', content: <ToolPanel />, visible: true }}
              />
            </DialogStoreProvider>
          </ThemeProvider>
        </AppStateProvider>,
        { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 80));
        expect(toolJsxMounts).toBe(1);
        modalScrollViewport.handle?.scrollTo(5);
        await new Promise(r => setTimeout(r, 40));
        const scrolledTop = modalScrollViewport.handle?.getScrollTop() ?? 0;
        expect(scrolledTop).toBeGreaterThan(0);

        // Mutate unrelated dialogStore in the background
        dialogStore.open({ id: 'bg-dlg-1', kind: 'permission_prompt', payload: {} });
        await new Promise(r => setTimeout(r, 60));
        expect(toolJsxMounts).toBe(1);
        expect(modalScrollViewport.handle?.getScrollTop()).toBe(scrolledTop);
      } finally {
        inst.unmount();
      }

      // P2-11 (fullscreen): ExitPlanMode ('modal' layout) parked by 'draft' must show
      // HOST_PARKED_TYPING_QUESTION visibly ONCE (via visible abovePrompt bottom host).
      const parkedStore = createDialogStore();
      parkedStore.open({
        id: 'exit-plan-1',
        kind: PERMISSION_EXIT_PLAN_MODE_V2_KIND,
        payload: { requestId: 'req-ep-1' },
      });
      const { stdout: fsOut, stdin: fsIn } = createTestStreams(100, 18);
      const fsInst = await render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <DialogStoreProvider store={parkedStore}>
              <FullscreenLayout
                scrollable={
                  <>
                    <Text>HISTORY</Text>
                    <DialogHost variant="inline" suppressReason="draft" />
                  </>
                }
                abovePrompt={<DialogHost variant="bottom" suppressReason="draft" />}
                bottom={<Text>DRAFT_PROMPT</Text>}
                modal={{
                  key: 'dialog:exit-plan-1',
                  content: <DialogHost variant="modal" suppressReason="draft" />,
                  visible: false,
                }}
              />
            </DialogStoreProvider>
          </ThemeProvider>
        </AppStateProvider>,
        { stdout: fsOut, stdin: fsIn, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 80));
        const fsScreen = readScreen(fsOut);
        expect(fsScreen.split(HOST_PARKED_TYPING_QUESTION).length - 1).toBe(1);
      } finally {
        fsInst.unmount();
      }

      // P2-11 (non-fullscreen): ExitPlanMode parked by 'draft' still shows cue ONCE.
      process.env.CLAUDE_CODE_NO_FLICKER = '0';
      const { stdout: classicOut, stdin: classicIn } = createTestStreams(100, 18);
      const classicInst = await render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <DialogStoreProvider store={parkedStore}>
              <FullscreenLayout
                scrollable={
                  <>
                    <Text>HISTORY</Text>
                    <DialogHost variant="inline" suppressReason="draft" />
                  </>
                }
                abovePrompt={<DialogHost variant="bottom" suppressReason="draft" />}
                bottom={<Text>DRAFT_PROMPT</Text>}
                modal={{
                  key: 'dialog:exit-plan-1',
                  content: <DialogHost variant="modal" suppressReason="draft" />,
                  visible: false,
                }}
              />
            </DialogStoreProvider>
          </ThemeProvider>
        </AppStateProvider>,
        { stdout: classicOut, stdin: classicIn, patchConsole: false, exitOnCtrlC: false },
      );
      try {
        await new Promise(r => setTimeout(r, 80));
        const classicScreen = readScreen(classicOut);
        expect(classicScreen.split(HOST_PARKED_TYPING_QUESTION).length - 1).toBe(1);
      } finally {
        classicInst.unmount();
      }
    } finally {
      if (prevFullscreen === undefined) {
        delete process.env.CLAUDE_CODE_NO_FLICKER;
      } else {
        process.env.CLAUDE_CODE_NO_FLICKER = prevFullscreen;
      }
    }

    const layoutSrc = readFileSync(join(ROOT, 'src/components/FullscreenLayout.tsx'), 'utf8');
    expect(layoutSrc).not.toContain('topDialogId');
    expect(layoutSrc).toContain('modalKey={modal.key}');

    const replSrc = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8');
    expect(replSrc).toContain("key: topDialog ? `dialog:${topDialog.id}` : 'dialog'");
    expect(replSrc).toContain("key: 'tooljsx'");
  });
});
