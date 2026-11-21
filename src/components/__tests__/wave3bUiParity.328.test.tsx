import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import React, { useContext, useLayoutEffect } from 'react';
import {
  DialogIdContext,
  DialogWait,
  type DOMElement,
  Ink,
  instances,
  MenuWaitContext,
  ModalContext,
  type ScrollBoxHandle,
  ScrollViewport,
  TerminalSizeContext,
  Text,
  ThemeProvider,
  wrappedRender as render,
} from '@anthropic/ink';
import { lineWidth, reset, resetLineWidthCache } from '../../../packages/@ant/ink/src/core/line-width-cache.js';
import { cellAt, type Screen } from '../../../packages/@ant/ink/src/core/screen.js';
import { setTerminalEmojiWidthCalibrator } from '../../../packages/@ant/ink/src/core/stringWidth.js';
import { useModalRevealEnd } from '../../context/modalContext.js';
import { CurrentDialogIdContext, DialogHost } from '../../dialog/DialogHost.js';
import { DialogStoreContext } from '../../dialog/DialogStoreContext.js';
import { createDialogStore } from '../../dialog/dialogStore.js';
import { SANDBOX_NETWORK_ACCESS_KIND } from '../../dialog/specs/jsuKinds.js';
import { PERMISSION_BASH_KIND, PERMISSION_EXIT_PLAN_MODE_V2_KIND } from '../../dialog/specs/permissionKinds.js';
import { computeDialogPanelVisibility } from '../../screens/REPL.js';
import { AppStateProvider } from '../../state/AppState.js';
import type { Message } from '../../types/message.js';
import { assistantHasVisibleText, ScrollPin } from '../../utils/scrollPin.js';
import { TranscriptStore } from '../../utils/transcriptStore.js';
import { computeUnseenDivider, FullscreenLayout, ScrollChromeContext } from '../FullscreenLayout.js';
import { Messages, selectDeferredMessages } from '../Messages.js';
import { ModalScroller } from '../ModalScroller.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';

function createTestStreams(columns = 80, rows = 24) {
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

function readScreenText(stdout: NodeJS.WriteStream): string {
  const ink = instances.get(stdout) as unknown as {
    frontFrame: {
      screen: Screen;
    };
  };
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
}

function findDomNode(root: DOMElement, predicate: (node: DOMElement) => boolean): DOMElement | null {
  if (predicate(root)) return root;
  for (const child of root.childNodes) {
    if (child.nodeName !== '#text') {
      const hit = findDomNode(child, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

describe('Wave 3B UI/Viewport/Transcript/ScrollPin/InputGate 2.1.328 parity', () => {
  test('Item 1 (P1-#12): selectDeferredMessages (kw) defers only when head matches and switches immediately on clear/compact', () => {
    const m1 = { uuid: 'u1' };
    const m2 = { uuid: 'u2' };
    const m3 = { uuid: 'u3' };
    const deferred = [m1, m2];
    const liveSameHead = [m1, m2, m3];
    const liveCompacted = [m3];

    expect(selectDeferredMessages(deferred, liveSameHead, true)).toBe(deferred);
    expect(selectDeferredMessages(deferred, liveSameHead, false)).toBe(liveSameHead);
    expect(selectDeferredMessages(deferred, liveCompacted, true)).toBe(liveCompacted);
    expect(selectDeferredMessages([], liveSameHead, true)).toBe(liveSameHead);
  });

  test('Item 1 (P1-#12): Messages (Tje) synchronizes live TranscriptStore and placeholderText so user prompt never echoes twice or resurrects after compact', async () => {
    const store = new TranscriptStore([]);
    const drawnLengths: number[] = [];
    const { stdout, stdin } = createTestStreams(80, 16);

    const makeProps = (override: Partial<React.ComponentProps<typeof Messages>> = {}) => ({
      source: { kind: 'live' as const, transcript: store, conversationId: 'conv-1', isMain: true },
      tools: [],
      commands: [],
      verbose: false,
      toolJSX: null,
      inProgressToolUseIDs: new Set<string>(),
      isMessageSelectorVisible: false,
      conversationId: 'conv-1',
      screen: 'prompt' as const,
      streamingToolUses: [],
      hideLogo: true,
      isLoading: true,
      showStreamingText: true,
      placeholderText: 'UNIQUE_PROMPT_ECHO_328',
      placeholderBaseline: 0,
      hidePlaceholder: false,
      onRowsDrawn: (drawn: readonly Message[]) => {
        drawnLengths.push(drawn.length);
      },
      ...override,
    });

    const instance = await render(
      <AppStateProvider>
        <ThemeProvider initialState="dark">
          <Messages {...makeProps()} />
        </ThemeProvider>
      </AppStateProvider>,
      {
        stdout,
        stdin,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    );
    try {
      await new Promise(r => setTimeout(r, 60));
      const frame1 = readScreenText(stdout);
      expect(frame1.split('UNIQUE_PROMPT_ECHO_328').length - 1).toBe(1);
      expect(drawnLengths.at(-1)).toBe(0);

      // Real UserMessage lands in TranscriptStore — placeholder must vanish in the exact same commit
      const realUserMsg = {
        type: 'user',
        uuid: '00000000-0000-4000-8000-0000000000aa',
        message: { role: 'user', content: 'UNIQUE_PROMPT_ECHO_328' },
      } as unknown as Message;
      store.setMessages([realUserMsg]);
      await new Promise(r => setTimeout(r, 60));
      const frame2 = readScreenText(stdout);
      expect(frame2.split('UNIQUE_PROMPT_ECHO_328').length - 1).toBe(1);
      expect(drawnLengths.at(-1)).toBe(1);

      // Mid-turn compaction shrinks store back <= baseline (0) — latch prevents echo resurrection
      store.setMessages([]);
      await new Promise(r => setTimeout(r, 60));
      const frame3 = readScreenText(stdout);
      expect(frame3).not.toContain('UNIQUE_PROMPT_ECHO_328');
      expect(drawnLengths.at(-1)).toBe(0);
    } finally {
      instance.unmount();
    }

    // Verify REPL.tsx uses single-source transcriptProjection without redundant messages prop or layout-effect shadow copy
    const replSrc = readFileSync(join(import.meta.dir, '../../screens/REPL.tsx'), 'utf8');
    expect(replSrc).toContain('transcript: transcriptProjection');
    expect(replSrc).not.toContain('transcriptStore.setMessages(messages)');
    expect(replSrc).not.toContain('messages={displayedMessages}');
  });

  test('Item 2 (P1-#17): FullscreenLayout memoizes TerminalSizeContext and ModalContext across stickyPrompt updates', async () => {
    const prevFullscreen = process.env.CLAUDE_CODE_NO_FLICKER;
    process.env.CLAUDE_CODE_NO_FLICKER = '1';
    const { stdout, stdin } = createTestStreams(80, 24);
    const seenMainSizes: unknown[] = [];
    const seenModalCtxs: unknown[] = [];
    let mainChildRenders = 0;
    let modalChildRenders = 0;
    const triggerStickyRef: { current: ((prompt: { text: string; scrollTo: () => void } | null) => void) | null } = {
      current: null,
    };

    const MemoMainChild = React.memo(function MemoMainChild() {
      mainChildRenders++;
      seenMainSizes.push(useContext(TerminalSizeContext));
      const chrome = useContext(ScrollChromeContext);
      triggerStickyRef.current = chrome?.setStickyPrompt ?? null;
      return <Text>MAIN_CHILD</Text>;
    });

    const ModalProbe = React.memo(function ModalProbe() {
      modalChildRenders++;
      seenModalCtxs.push(useContext(ModalContext));
      return <Text>MODAL_CHILD</Text>;
    });

    const scrollPin = new ScrollPin({
      computeDivider: (msgs, idx) => computeUnseenDivider(msgs, idx),
    });

    const instance = await render(
      <AppStateProvider>
        <ThemeProvider initialState="dark">
          <FullscreenLayout
            scrollViewport={scrollPin.viewport}
            modalScrollViewport={scrollPin.modalViewport}
            unseen={scrollPin}
            scrollable={<MemoMainChild />}
            bottom={<Text>PROMPT</Text>}
            modal={{ content: <ModalProbe />, visible: false }}
          />
        </ThemeProvider>
      </AppStateProvider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await new Promise(r => setTimeout(r, 80));
      const initialMainRenders = mainChildRenders;
      const initialModalRenders = modalChildRenders;
      const settledMainSize = seenMainSizes.at(-1);
      const settledModalCtx = seenModalCtxs.at(-1);
      expect(initialMainRenders).toBeGreaterThanOrEqual(1);
      expect(initialModalRenders).toBeGreaterThanOrEqual(1);

      // Trigger internal FullscreenLayout state change (stickyPrompt) without changing terminal dimensions
      triggerStickyRef.current?.({ text: 'sticky prompt', scrollTo: () => {} });
      await new Promise(r => setTimeout(r, 80));

      // Neither memoized child may re-render due to an unstable TerminalSizeContext or ModalContext object
      expect(mainChildRenders).toBe(initialMainRenders);
      expect(modalChildRenders).toBe(initialModalRenders);
      expect(Object.is(seenMainSizes.at(-1), settledMainSize)).toBe(true);
      expect(Object.is(seenModalCtxs.at(-1), settledModalCtx)).toBe(true);
    } finally {
      instance.unmount();
      scrollPin.dispose();
      if (prevFullscreen === undefined) {
        delete process.env.CLAUDE_CODE_NO_FLICKER;
      } else {
        process.env.CLAUDE_CODE_NO_FLICKER = prevFullscreen;
      }
    }
  });

  test('Item 3 (P1-#18): assistantHasVisibleText (KEs), ScrollPin streaming guard, and computeUnseenDivider (qEs)', () => {
    const toolOnlyMsg = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-000000000101',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }] },
    } as unknown as Message;
    const textMsg = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-000000000102',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the answer' }] },
    } as unknown as Message;
    const turnDuration = {
      type: 'system',
      subtype: 'turn_duration',
      uuid: '00000000-0000-4000-8000-000000000103',
    } as unknown as Message;
    const skillListing = {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-000000000104',
      attachment: { type: 'skill_listing' },
    } as unknown as Message;
    const thinkingOnly = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-000000000105',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal thoughts', signature: 'sig' }] },
    } as unknown as Message;

    expect(assistantHasVisibleText(toolOnlyMsg)).toBe(false);
    expect(assistantHasVisibleText(textMsg)).toBe(true);

    // qEs: skips turn_duration unconditionally
    expect(computeUnseenDivider([turnDuration, textMsg], 0)?.firstUnseenUuid).toBe(textMsg.uuid);

    // qEs in briefMode: skips skill_listing & thinking-only assistant rows, anchoring on textMsg
    expect(computeUnseenDivider([skillListing, thinkingOnly, textMsg], 0, true)?.firstUnseenUuid).toBe(textMsg.uuid);

    // qEs in briefMode fallback: when only thinking-only assistant row follows, falls back to it
    expect(computeUnseenDivider([skillListing, thinkingOnly], 0, true)?.firstUnseenUuid).toBe(thinkingOnly.uuid);

    // ScrollPin #w: tool-use-only assistant message arriving while wasStreamingAtScrollAway must NOT advance dividerIndex
    const pin = new ScrollPin({
      computeDivider: (msgs, idx) => computeUnseenDivider(msgs, idx),
    });
    const fakeHandle = {
      isSticky: () => false,
      getScrollTop: () => 0,
      getPendingDelta: () => 0,
      getScrollHeight: () => 100,
      getViewportHeight: () => 20,
      scrollToBottom: () => {},
      scrollTo: () => {},
      subscribe: () => () => {},
    } as unknown as ScrollBoxHandle;
    const detach = pin.viewport.attach(fakeHandle);
    pin.setReplyStreaming(true);
    pin.syncMessages([]);
    pin.onUserScroll(false, fakeHandle);
    pin.syncMessages([toolOnlyMsg]);
    expect(pin.getSnapshot().unseenDivider?.firstUnseenUuid).toBe(toolOnlyMsg.uuid);

    // Now if a text assistant message arrives first while streaming, #w advances past it (not stuck on already-seen streaming reply)
    const pin2 = new ScrollPin({
      computeDivider: (msgs, idx) => computeUnseenDivider(msgs, idx),
    });
    const detach2 = pin2.viewport.attach(fakeHandle);
    pin2.setReplyStreaming(true);
    pin2.syncMessages([]);
    pin2.onUserScroll(false, fakeHandle);
    pin2.syncMessages([textMsg]);
    expect(pin2.getSnapshot().unseenDivider).toBeUndefined();
    detach();
    detach2();
  });

  test('Item 3 & 7: DialogHost aliases DialogIdContext, renders DialogWait, and calls scrollRegion.onDialogLeft on exit', async () => {
    expect(CurrentDialogIdContext).toBe(DialogIdContext);

    const store = createDialogStore();
    const scrollEvents: Array<{ kind: string; y?: number }> = [];
    const pin = new ScrollPin({
      computeDivider: (msgs, idx) => computeUnseenDivider(msgs, idx),
    });
    const fakeHandle = {
      isSticky: () => false,
      getScrollTop: () => 15,
      getPendingDelta: () => 0,
      getScrollHeight: () => 100,
      getViewportHeight: () => 20,
      scrollToBottom: () => {
        scrollEvents.push({ kind: 'bottom' });
      },
      scrollTo: (y: number) => {
        scrollEvents.push({ kind: 'to', y });
      },
      subscribe: () => () => {},
    } as unknown as ScrollBoxHandle;
    const detach = pin.viewport.attach(fakeHandle);

    // Prime a dialog return target via showDialog so onDialogLeft restores scroll position 15
    expect(pin.showDialog({ row: 50, rows: 10 }, true)).toBe(true);
    expect(scrollEvents.at(-1)).toEqual({ kind: 'to', y: 40 });

    const { stdout, stdin } = createTestStreams(80, 16);
    store.open({
      id: 'dlg-cold-1',
      kind: 'cold_resume_quota',
      payload: {
        inactiveSince: Date.now() - 60_000,
        contextTokens: 50_000,
        percentOfFiveHourLimit: 10,
        trigger: 'idle',
        focusedAction: 'continue',
        offersLookUp: false,
        offersSummary: false,
        hasUnsentDraft: false,
      },
      userInvoked: true,
    });

    const instance = await render(
      <AppStateProvider>
        <ThemeProvider initialState="dark">
          <DialogStoreContext.Provider value={store}>
            <DialogHost variant="inline" scrollRegion={pin} />
          </DialogStoreContext.Provider>
        </ThemeProvider>
      </AppStateProvider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await new Promise(r => setTimeout(r, 60));
      const ink = instances.get(stdout) as unknown as { rootNode: DOMElement };
      const topId = store.getState().open[0]!.id;
      expect(topId).toBe('dlg-cold-1');
      const waitHost = findDomNode(ink.rootNode, n => n.wait !== undefined);
      expect(waitHost).not.toBeNull();
      expect(waitHost?.wait?.isMenu).toBe(true);
      expect(waitHost?.wait?.owner).toBe(topId);

      // Dismiss dialog → DialogHost cleanup must invoke scrollPin.onDialogLeft() and restore scrollTop=15
      store.dismiss(topId);
      await new Promise(r => setTimeout(r, 60));
      expect(scrollEvents.at(-1)).toEqual({ kind: 'to', y: 15 });
    } finally {
      instance.unmount();
      detach();
      pin.dispose();
    }
  });

  test('Item 4 (P2-#7): ModalScroller uses ClockContext useInterval (no raw setInterval) and exposes revealEnd on ModalContext', async () => {
    const scrollerSrc = readFileSync(join(import.meta.dir, '../ModalScroller.tsx'), 'utf8');
    expect(scrollerSrc).toContain('useInterval(');
    expect(scrollerSrc).not.toContain('setInterval(');

    const scrollViewport = new ScrollViewport();
    let capturedRevealEnd: (() => () => void) | undefined;
    function RevealProbe() {
      const revealEnd = useModalRevealEnd();
      useLayoutEffect(() => {
        capturedRevealEnd = revealEnd;
      }, [revealEnd]);
      return (
        <>
          {Array.from({ length: 24 }, (_, idx) => (
            <Text key={idx}>{`MODAL_ROW_${idx}`}</Text>
          ))}
        </>
      );
    }

    const { stdout, stdin } = createTestStreams(60, 14);
    const instance = await render(
      <ThemeProvider initialState="dark">
        <ModalScroller scrollViewport={scrollViewport} maxRows={8}>
          <RevealProbe />
        </ModalScroller>
      </ThemeProvider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await new Promise(r => setTimeout(r, 120));
      expect(typeof capturedRevealEnd).toBe('function');
      expect(scrollViewport.handle).not.toBeNull();

      // Calling revealEnd() snaps ScrollBox to the end and suppresses the top ↑ hint while held at bottom
      const release = capturedRevealEnd!();
      await new Promise(r => setTimeout(r, 140));
      expect(scrollViewport.handle!.getScrollTop()).toBeGreaterThan(0);
      expect(readScreenText(stdout)).not.toContain('↑');

      // Releasing revealEnd restores the top ↑ hint on the next ClockContext interval tick
      release();
      await new Promise(r => setTimeout(r, 140));
      expect(readScreenText(stdout)).toContain('↑');
    } finally {
      instance.unmount();
    }
  });

  test('Item 5 (P2-#9) & Item 6 (log.permissionMode): computeDialogPanelVisibility matches official Ize/VBe and REPL wires modal.footer + log.permissionMode', () => {
    // Official Ize kind inside active modal slot → inPane=true, abovePrompt=false
    expect(
      computeDialogPanelVisibility({
        onScreenBlockingKind: PERMISSION_EXIT_PLAN_MODE_V2_KIND,
        modalSlotActive: true,
        panelHidesPrompt: false,
        pinnedConsentShowing: false,
        dialogOverPanel: false,
        fullscreen: true,
      }),
    ).toEqual({ inPane: true, abovePrompt: false, drawn: true });

    // Official Ize inline kind (not in modal) → inPane=false, abovePrompt=true
    expect(
      computeDialogPanelVisibility({
        onScreenBlockingKind: PERMISSION_BASH_KIND,
        modalSlotActive: false,
        panelHidesPrompt: false,
        pinnedConsentShowing: false,
        dialogOverPanel: false,
        fullscreen: true,
      }),
    ).toEqual({ inPane: false, abovePrompt: true, drawn: true });

    expect(
      computeDialogPanelVisibility({
        onScreenBlockingKind: SANDBOX_NETWORK_ACCESS_KIND,
        modalSlotActive: false,
        panelHidesPrompt: false,
        pinnedConsentShowing: false,
        dialogOverPanel: false,
        fullscreen: true,
      }),
    ).toEqual({ inPane: false, abovePrompt: true, drawn: true });

    // Non-Ize kind with no panel/consent/overPanel → nothing drawn
    expect(
      computeDialogPanelVisibility({
        onScreenBlockingKind: 'cost_threshold',
        modalSlotActive: false,
        panelHidesPrompt: false,
        pinnedConsentShowing: false,
        dialogOverPanel: false,
        fullscreen: true,
      }),
    ).toEqual({ inPane: false, abovePrompt: false, drawn: false });

    const replSrc = readFileSync(join(import.meta.dir, '../../screens/REPL.tsx'), 'utf8');
    expect(replSrc).toContain('dialogPanelVis.inPane ? <PromptBannerFooter');
    expect(replSrc).toContain('dialogPanelVis.abovePrompt && <PromptBannerFooter');
    expect(replSrc).toContain('storedPermissionMode: log.permissionMode');
    expect(replSrc).not.toContain('storedPermissionMode: log.mode');
  });

  test('Item 7 (Wave 3C): @anthropic/ink exports DialogIdContext/MenuWaitContext/DialogWait; PermissionDialog attaches DialogWait standalone and yields inside DialogIdContext', async () => {
    expect(DialogIdContext).toBeDefined();
    expect(MenuWaitContext).toBeDefined();
    expect(typeof DialogWait).toBe('function');

    const { stdout, stdin } = createTestStreams(60, 12);
    const instance = await render(
      <PermissionDialog title="Allow Bash?">
        <Text>Run ls</Text>
      </PermissionDialog>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await new Promise(r => setTimeout(r, 50));
      const ink = instances.get(stdout) as unknown as { rootNode: DOMElement };
      const waitHost = findDomNode(ink.rootNode, n => n.wait !== undefined);
      expect(waitHost).not.toBeNull();
      expect(waitHost?.wait?.isMenu).toBe(false);
    } finally {
      instance.unmount();
    }

    // Inside DialogIdContext (DialogHost), PermissionDialog's internal DialogWait yields (no double-gating)
    const { stdout: stdout2, stdin: stdin2 } = createTestStreams(60, 12);
    const instance2 = await render(
      <DialogIdContext.Provider value="dlg-99">
        <PermissionDialog title="Allow Bash?">
          <Text>Run ls</Text>
        </PermissionDialog>
      </DialogIdContext.Provider>,
      { stdout: stdout2, stdin: stdin2, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await new Promise(r => setTimeout(r, 50));
      const ink2 = instances.get(stdout2) as unknown as { rootNode: DOMElement };
      const waitHost2 = findDomNode(ink2.rootNode, n => n.wait !== undefined);
      expect(waitHost2).toBeNull();
    } finally {
      instance2.unmount();
    }
  });

  test('Item 8 (Wave 3A): resetLineWidthCache / reset clears stale cached widths and Ink constructor calls it after calibrating emoji width', () => {
    expect(reset).toBe(resetLineWidthCache);
    try {
      resetLineWidthCache();
      setTerminalEmojiWidthCalibrator(() => 2);
      expect(lineWidth('👍🏽')).toBe(2);

      // Update calibrator: cache still returns stale value until resetLineWidthCache() runs
      setTerminalEmojiWidthCalibrator(() => 4);
      expect(lineWidth('👍🏽')).toBe(2);
      resetLineWidthCache();
      expect(lineWidth('👍🏽')).toBe(4);

      // Constructing Ink with newRenderer=true on a TTY calibrates AND resets line-width cache
      setTerminalEmojiWidthCalibrator(() => 7);
      resetLineWidthCache();
      expect(lineWidth('👍🏽')).toBe(7);

      const { stdout, stdin } = createTestStreams(40, 10);
      const ink = new Ink({
        stdout,
        stdin,
        stderr: new PassThrough() as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
        newRenderer: true,
      });
      try {
        // Cache was reset by Ink constructor so '👍🏽' is no longer stale 7
        expect(lineWidth('👍🏽')).not.toBe(7);
      } finally {
        ink.unmount();
      }
    } finally {
      setTerminalEmojiWidthCalibrator(undefined);
      resetLineWidthCache();
    }
  });
});
