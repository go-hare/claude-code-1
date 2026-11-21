import { afterEach, describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import React, { useMemo, useState } from 'react';
import {
  Box,
  FrameScheduler,
  LayoutController,
  OverlayController,
  PointerController,
  ScrollBox,
  type ScrollBoxHandle,
  ScrollViewport,
  Text,
  wrappedRender as render,
} from '@anthropic/ink';
import Ink from '../../../packages/@ant/ink/src/core/ink.js';
import Output from '../../../packages/@ant/ink/src/core/output.js';
import { computeUnseenDivider } from '../FullscreenLayout.js';
import { ScrollPin } from '../../utils/scrollPin.js';
import { TranscriptStore } from '../../utils/transcriptStore.js';
import {
  appendChildNode,
  createNode,
  createTextNode,
  type DOMElement,
  type InputGateNoOption,
  type InputGateWait,
  markDirty,
  setStyle,
} from '../../../packages/@ant/ink/src/core/dom.js';
import { emptyFrame } from '../../../packages/@ant/ink/src/core/frame.js';
import { InputGate } from '../../../packages/@ant/ink/src/core/inputGate.js';
import instances from '../../../packages/@ant/ink/src/core/instances.js';
import {
  leftoverGsDecstbmOk,
  shiftCachedLayoutSubtree,
} from '../../../packages/@ant/ink/src/core/render-node-to-output.js';
import createRenderer from '../../../packages/@ant/ink/src/core/renderer.js';
import { CharPool, cellAt, HyperlinkPool, type Screen, StylePool } from '../../../packages/@ant/ink/src/core/screen.js';
import { setIsInteractive } from '../../bootstrap/state.js';
import { QueuedMessageProvider, useQueuedMessage } from '../../context/QueuedMessageContext.js';
import { DEFAULT_RENDER_PACING, RenderPacingContext } from '../../context/renderPacingContext.js';
import { useVirtualScroll } from '../../hooks/useVirtualScroll.js';
import { useOptionalAppState } from '../../state/AppState.js';
import { isEarlyKeyGuardEnabled, isNewRendererEnabled } from '../../utils/inkRoot.js';

describe('UI 2.1.328 1:1 alignment fixes', () => {
  const prevDisableGuard = process.env.CLAUDE_CODE_DISABLE_EARLY_KEY_GUARD;

  afterEach(() => {
    setIsInteractive(true);
    if (prevDisableGuard === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_EARLY_KEY_GUARD;
    } else {
      process.env.CLAUDE_CODE_DISABLE_EARLY_KEY_GUARD = prevDisableGuard;
    }
  });

  test('isEarlyKeyGuardEnabled matches official l1 gate (headless off, env override)', () => {
    setIsInteractive(false);
    expect(isEarlyKeyGuardEnabled({ CLAUDE_CODE_DISABLE_EARLY_KEY_GUARD: '0' })).toBe(false);

    setIsInteractive(true);
    expect(isEarlyKeyGuardEnabled({ CLAUDE_CODE_DISABLE_EARLY_KEY_GUARD: '1' })).toBe(false);
    expect(isEarlyKeyGuardEnabled({ CLAUDE_CODE_DISABLE_EARLY_KEY_GUARD: '0' })).toBe(true);
    expect(isEarlyKeyGuardEnabled({ CLAUDE_CODE_DISABLE_EARLY_KEY_GUARD: 'false' })).toBe(true);
  });

  test('<Box wait no> forwards InputGate metadata to DOMElement via reconciler', async () => {
    let boxNode: DOMElement | null = null;
    const stdout = Object.assign(new PassThrough(), {
      columns: 80,
      rows: 24,
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

    let droppedSeen: string | null | undefined;
    const gateWait: InputGateWait = {
      isMenu: true,
      owner: 'dialog-test',
      onChange: dropped => {
        droppedSeen = dropped;
      },
    };
    const gateNo: InputGateNoOption = {
      key: 'n',
      isBeingTyped: () => false,
      goTo: () => undefined,
    };
    const instance = await render(
      <Box
        ref={el => {
          boxNode = el;
        }}
        wait={gateWait}
        no={gateNo}
      >
        <Text>gated</Text>
      </Box>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    await new Promise(r => setTimeout(r, 30));
    expect(boxNode).not.toBeNull();
    expect(boxNode!.wait).toBe(gateWait);
    expect(boxNode!.no).toBe(gateNo);

    const gate = new InputGate();
    boxNode!.firstFrame = { writtenAt: 100 };
    expect(gate.drops(boxNode!, 'return', 120)).toBe(true);
    expect(droppedSeen).toBe('return');

    instance.unmount();
  });

  test('useOptionalAppState safely returns fallback outside AppStateProvider', async () => {
    let seen: string | undefined;
    function Probe(): React.ReactNode {
      seen = useOptionalAppState(s => s.viewingAgentTaskId ?? 'none', 'fallback-val');
      return <Text>{seen}</Text>;
    }
    const stdout = Object.assign(new PassThrough(), {
      columns: 80,
      rows: 24,
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

    const instance = await render(<Probe />, { stdout, stdin, patchConsole: false, exitOnCtrlC: false });
    await new Promise(r => setTimeout(r, 20));
    expect(seen).toBe('fallback-val');
    instance.unmount();
  });

  test('leftoverGsDecstbmOk rejects paintsPastRect and shiftCachedLayoutSubtree keeps cachedLayout.y aligned', () => {
    expect(
      leftoverGsDecstbmOk({
        prevScreen: true,
        heightDeltaOk: true,
        overlayActive: false,
        absPrevInContent: false,
        backgroundOk: true,
        paintsPastRect: true,
      }),
    ).toBe(false);

    const child = {
      nodeName: 'ink-box',
      cachedLayout: { x: 0, y: 12, width: 80, height: 3, clip: { x1: 0, x2: 80, y1: 12, y2: 15 } },
      childNodes: [],
    } as unknown as DOMElement;
    const parent = {
      nodeName: 'ink-box',
      cachedLayout: { x: 0, y: 10, width: 80, height: 5 },
      scrollViewportTop: 11,
      childNodes: [child],
    } as unknown as DOMElement;

    shiftCachedLayoutSubtree(parent, -2);
    expect(parent.cachedLayout?.y).toBe(8);
    expect(parent.cachedLayout?.shifted).toBe(true);
    expect(parent.scrollViewportTop).toBe(9);
    expect(child.cachedLayout?.y).toBe(10);
    expect(child.cachedLayout?.shifted).toBe(true);
    expect(child.cachedLayout?.clip).toEqual({ x1: 0, x2: 80, y1: 10, y2: 13 });
  });

  test('ScrollBox fast-path scroll keeps cachedLayout.y synced and renders non-blank after expanding two items + streaming', async () => {
    const readLines = (sc: Screen): string[] => {
      const lines: string[] = [];
      for (let y = 0; y < sc.height; y++) {
        let row = '';
        for (let x = 0; x < sc.width; x++) {
          row += cellAt(sc, x, y)?.char ?? ' ';
        }
        lines.push(row);
      }
      return lines;
    };

    let setDemoState!: React.Dispatch<
      React.SetStateAction<{ count: number; expanded: ReadonlySet<number>; streamExtra: number }>
    >;
    let viewportRef: ScrollViewport | null = null;

    function Demo(): React.ReactNode {
      const viewport = useMemo(() => new ScrollViewport(), []);
      viewportRef = viewport;
      const [st, setSt] = useState<{ count: number; expanded: ReadonlySet<number>; streamExtra: number }>({
        count: 15,
        expanded: new Set(),
        streamExtra: 0,
      });
      setDemoState = setSt;
      const keys = Array.from({ length: st.count }, (_, i) => `k-${i}`);
      const vs = useVirtualScroll(viewport, keys, 80);
      const [start, end] = vs.range;

      return (
        <Box flexDirection="column" height={24} width={80}>
          <ScrollBox ref={viewport.attach} flexGrow={1} flexDirection="column" paddingTop={1} stickyScroll>
            <Box ref={vs.spacerRef} height={vs.topSpacer} flexShrink={0} />
            {keys.slice(start, end).map((k, idx) => {
              const i = start + idx;
              const exp = st.expanded.has(i);
              const lineCount =
                i === 13 ? (exp ? 60 : 5) : i === 14 ? (exp ? 12 : 2) : i >= 15 ? 1 + st.streamExtra : 2;
              return (
                <Box
                  key={k}
                  ref={vs.measureRef(k)}
                  flexDirection="column"
                  flexShrink={0}
                  backgroundColor={exp ? 'userMessageBackgroundHover' : undefined}
                  paddingBottom={exp ? 1 : undefined}
                >
                  {Array.from({ length: lineCount }, (_, l) => (
                    <Text key={l}>{`msg-${i} line-${l}`}</Text>
                  ))}
                </Box>
              );
            })}
            {vs.bottomSpacer > 0 ? <Box height={vs.bottomSpacer} flexShrink={0} /> : null}
          </ScrollBox>
          <Box height={2} flexShrink={0}>
            <Text>{'> prompt'}</Text>
          </Box>
        </Box>
      );
    }

    const stdout = Object.assign(new PassThrough(), {
      columns: 80,
      rows: 24,
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

    const instance = await render(<Demo />, { stdout, stdin, patchConsole: false, exitOnCtrlC: false });
    const ink = instances.get(stdout) as unknown as { frontFrame: { screen: Screen } };
    const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
    await wait(60);

    // Expand both Write-like item (13) and Thought-like item (14)
    setDemoState(s => ({ ...s, expanded: new Set([13]) }));
    await wait(60);
    setDemoState(s => ({ ...s, expanded: new Set([13, 14]) }));
    await wait(60);

    // Stream new output across multiple fast-path scroll frames
    setDemoState(s => ({ ...s, count: 16, streamExtra: 0 }));
    await wait(50);
    for (let step = 1; step <= 4; step++) {
      setDemoState(s => ({ ...s, streamExtra: step }));
      await wait(40);
    }

    const lines = readLines(ink.frontFrame.screen).slice(1, 22);
    const nonBlank = lines.filter(l => l.trim().length > 0).length;
    expect(nonBlank).toBeGreaterThanOrEqual(18);

    // Verify visible child's cachedLayout.y matches its actual screen coordinate (no drift)
    const content = viewportRef!.handle?.getDomElement()?.childNodes[0] as DOMElement | undefined;
    expect(content).toBeDefined();
    const contentY = content!.cachedLayout?.y ?? 0;
    for (const child of content!.childNodes) {
      const elem = child as DOMElement;
      if (!elem.cachedLayout || !elem.yogaNode) continue;
      expect(elem.cachedLayout.y).toBe(contentY + elem.yogaNode.getComputedTop());
    }

    // Collapse item 14 and ensure viewport repopulates cleanly without blanking
    setDemoState(s => ({ ...s, expanded: new Set([13]) }));
    await wait(60);
    const linesAfterCollapse = readLines(ink.frontFrame.screen).slice(1, 22);
    expect(linesAfterCollapse.filter(l => l.trim().length > 0).length).toBeGreaterThanOrEqual(18);

    instance.unmount();
  });

  test('ScrollViewport (oEt) stacks handles and routes subscriber notifications across mounts', () => {
    const viewport = new ScrollViewport();
    let notifications = 0;
    const unsub = viewport.subscribe(() => {
      notifications++;
    });

    const listenersA = new Set<() => void>();
    const handleA = {
      subscribe: (fn: () => void) => {
        listenersA.add(fn);
        return () => listenersA.delete(fn);
      },
    } as unknown as ScrollBoxHandle;
    const listenersB = new Set<() => void>();
    const handleB = {
      subscribe: (fn: () => void) => {
        listenersB.add(fn);
        return () => listenersB.delete(fn);
      },
    } as unknown as ScrollBoxHandle;

    const detachA = viewport.attach(handleA);
    expect(viewport.handle).toBe(handleA);
    expect(listenersA.size).toBe(1);

    for (const fn of listenersA) fn();
    expect(notifications).toBe(1);

    const detachB = viewport.attach(handleB);
    expect(viewport.handle).toBe(handleB);
    expect(listenersA.size).toBe(0);
    expect(listenersB.size).toBe(1);

    for (const fn of listenersB) fn();
    expect(notifications).toBe(2);

    detachB();
    expect(viewport.handle).toBe(handleA);
    expect(listenersA.size).toBe(1);

    detachA();
    expect(viewport.handle).toBeNull();
    unsub();
  });

  test('IncrementalPainter (Lm) renders firstRow slice, reuses clean rows, and propagates paintCache.changed', () => {
    const stylePool = new StylePool();
    const charPool = new CharPool();
    const hyperlinkPool = new HyperlinkPool();

    const root = createNode('ink-root');
    setStyle(root, { flexDirection: 'column' });
    const rows: DOMElement[] = [];
    for (let i = 0; i < 5; i++) {
      const box = createNode('ink-box');
      const txt = createNode('ink-text');
      appendChildNode(txt, createTextNode(`row-${i}`) as unknown as DOMElement);
      appendChildNode(box, txt);
      appendChildNode(root, box);
      rows.push(txt);
    }
    root.yogaNode!.setWidth(20);
    root.yogaNode!.calculateLayout(20);

    const renderer = createRenderer(root, stylePool);
    let front = emptyFrame(5, 20, stylePool, charPool, hyperlinkPool);
    let back = emptyFrame(5, 20, stylePool, charPool, hyperlinkPool);

    const readRow = (sc: Screen, y: number): string => {
      let s = '';
      for (let x = 0; x < sc.width; x++) s += cellAt(sc, x, y)?.char ?? ' ';
      return s.trimEnd();
    };

    const f1 = renderer({
      frontFrame: front,
      backFrame: back,
      isTTY: true,
      terminalWidth: 20,
      terminalRows: 5,
      altScreen: false,
      prevFrameContaminated: false,
      firstRow: () => 2,
    });
    expect(f1.top).toBe(2);
    expect(f1.screen.height).toBe(3);
    expect(readRow(f1.screen, 0)).toBe('row-2');
    expect(readRow(f1.screen, 1)).toBe('row-3');
    expect(readRow(f1.screen, 2)).toBe('row-4');
    expect(rows[3]!.paintCache).toBeDefined();

    // Mutate only row 3 -> markDirty marks row 3 'self' and ancestors 'child'
    const textNode = rows[3]!.childNodes[0]!;
    if (textNode.nodeName === '#text') textNode.nodeValue = 'row-3-edited';
    markDirty(rows[3]!);
    expect(rows[3]!.paintCache?.changed).toBe('self');
    expect(root.paintCache?.changed).toBe('child');
    root.yogaNode!.calculateLayout(20);

    back = front;
    front = f1;
    const f2 = renderer({
      frontFrame: front,
      backFrame: back,
      isTTY: true,
      terminalWidth: 20,
      terminalRows: 5,
      altScreen: false,
      prevFrameContaminated: false,
      firstRow: () => 2,
    });
    expect(readRow(f2.screen, 0)).toBe('row-2');
    expect(readRow(f2.screen, 1)).toBe('row-3-edited');
    expect(readRow(f2.screen, 2)).toBe('row-4');
  });

  test('useVirtualScroll accepts ScrollViewport directly under RenderPacingContext without blanking', async () => {
    const viewport = new ScrollViewport();
    let rangeSeen: readonly [number, number] = [0, 0];

    function List({ count }: { count: number }): React.ReactNode {
      const keys = Array.from({ length: count }, (_, i) => `k-${i}`);
      const vs = useVirtualScroll(viewport, keys, 60);
      rangeSeen = vs.range;
      return (
        <Box flexDirection="column" height={12} width={60}>
          <ScrollBox ref={viewport.attach} flexGrow={1} flexDirection="column" stickyScroll>
            <Box ref={vs.spacerRef} height={vs.topSpacer} flexShrink={0} />
            {keys.slice(vs.range[0], vs.range[1]).map(k => (
              <Box key={k} ref={vs.measureRef(k)} flexShrink={0}>
                <Text>{`line-${k}`}</Text>
              </Box>
            ))}
          </ScrollBox>
        </Box>
      );
    }

    const stdout = Object.assign(new PassThrough(), {
      columns: 60,
      rows: 12,
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

    const instance = await render(
      <RenderPacingContext.Provider value={DEFAULT_RENDER_PACING}>
        <List count={20} />
      </RenderPacingContext.Provider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    await new Promise(r => setTimeout(r, 50));
    expect(viewport.handle).not.toBeNull();
    expect(rangeSeen[1]).toBe(20);
    expect(rangeSeen[0]).toBeLessThan(20);
    instance.unmount();
    expect(viewport.handle).toBeNull();
  });

  test('ScrollPin (Zse) tracks unseenDivider, repin rules, and dialog anchor restoration', () => {
    const scrollEvents: Array<{ kind: string; y?: number }> = [];
    let sticky = true;
    const handle = {
      isSticky: () => sticky,
      getScrollTop: () => 20,
      getPendingDelta: () => 0,
      getScrollHeight: () => 100,
      getViewportHeight: () => 20,
      scrollToBottom: () => {
        sticky = true;
        scrollEvents.push({ kind: 'bottom' });
      },
      scrollTo: (y: number) => {
        sticky = false;
        scrollEvents.push({ kind: 'to', y });
      },
      subscribe: () => () => {},
    } as unknown as ScrollBoxHandle;

    const pin = new ScrollPin({
      computeDivider: (msgs, idx) => computeUnseenDivider(msgs as never, idx),
    });
    const detach = pin.viewport.attach(handle);
    const msg1 = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-000000000001',
      message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
    };
    const msg2 = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-000000000002',
      message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] },
    };
    pin.syncMessages([msg1 as never]);

    // Scroll away captures dividerY and baseline index
    sticky = false;
    pin.onUserScroll(false, handle);
    expect(pin.dividerY).toBe(100);

    // New assistant message increments unseenDivider
    pin.syncMessages([msg1 as never, msg2 as never]);
    expect(pin.getSnapshot().unseenDivider?.count).toBe(1);

    // Typing while scrolled away does NOT yank
    pin.onPromptEdit('a', '');
    expect(scrollEvents.length).toBe(0);

    // Dialog show + leave restores prior scroll position
    expect(pin.showDialog({ row: 40, rows: 10 }, true)).toBe(true);
    expect(scrollEvents.at(-1)).toEqual({ kind: 'to', y: 30 });
    pin.onDialogLeft();
    expect(scrollEvents.at(-1)).toEqual({ kind: 'to', y: 20 });

    // jumpToNew repins to bottom
    pin.jumpToNew();
    expect(scrollEvents.at(-1)).toEqual({ kind: 'bottom' });
    detach();
  });

  test('Ink newRenderer=true wires LayoutController, OverlayController, and renderToBytes (inline + fullscreen)', async () => {
    const written: string[] = [];
    const stdout = Object.assign(new PassThrough(), {
      columns: 40,
      rows: 10,
      isTTY: true,
    }) as unknown as NodeJS.WriteStream;
    stdout.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));
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

    const ink = new Ink({
      stdout,
      stdin,
      stderr: new PassThrough() as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
      newRenderer: true,
    });
    expect(ink.renderers).toBeDefined();
    expect(ink.layout).toBeInstanceOf(LayoutController);
    expect(ink.overlays).toBeInstanceOf(OverlayController);

    // Main-screen inline/covering byte render
    ink.render(
      <Box flexDirection="column">
        <Text>NEW_RENDERER_LINE_1</Text>
        <Text>NEW_RENDERER_LINE_2</Text>
      </Box>,
    );
    await new Promise(r => setTimeout(r, 40));
    ink.onRender();
    expect(written.join('')).toContain('NEW_RENDERER_LINE_1');

    // Alt-screen fullscreen byte render
    written.length = 0;
    ink.setAltScreenActive(true, 'full');
    ink.render(
      <Box flexDirection="column" height={10} width={40}>
        <Text>FULLSCREEN_BYTE_OK</Text>
      </Box>,
    );
    await new Promise(r => setTimeout(r, 40));
    ink.onRender();
    expect(written.join('')).toContain('FULLSCREEN_BYTE_OK');
    ink.unmount();
  });

  test('Output.writeDirected right-aligns rtl lines within maxWidth', () => {
    const stylePool = new StylePool();
    const screen = {
      width: 10,
      height: 2,
      stylePool,
      charPool: new CharPool(),
      hyperlinkPool: new HyperlinkPool(),
    };
    const out = new Output({
      width: 10,
      height: 2,
      stylePool,
      screen: emptyFrame(2, 10, stylePool, screen.charPool, screen.hyperlinkPool).screen,
    });
    out.writeDirected(0, 0, 'abc', undefined, 'rtl', 10);
    const sc = out.get();
    let line = '';
    for (let x = 0; x < 10; x++) line += cellAt(sc, x, 0)?.char ?? ' ';
    expect(line).toBe('       abc');
  });

  test('isNewRendererEnabled honors CLAUDE_CODE_NEW_RENDERER env override', () => {
    expect(isNewRendererEnabled({ CLAUDE_CODE_NEW_RENDERER: '1' })).toBe(true);
    expect(isNewRendererEnabled({ CLAUDE_CODE_NEW_RENDERER: '0' })).toBe(false);
    expect(isNewRendererEnabled({ CLAUDE_CODE_NEW_RENDERER: 'false' })).toBe(false);
  });

  test('TranscriptStore drives ScrollPin directly without manual syncMessages and Ink delegates to controllers', () => {
    const store = new TranscriptStore();
    const pin = new ScrollPin({
      transcript: store,
      computeDivider: (msgs, idx) => computeUnseenDivider(msgs as never, idx),
    });
    const handle = {
      isSticky: () => false,
      getScrollTop: () => 0,
      getPendingDelta: () => 0,
      getScrollHeight: () => 80,
      getViewportHeight: () => 20,
      scrollToBottom: () => {},
      scrollTo: () => {},
      subscribe: () => () => {},
    } as unknown as ScrollBoxHandle;
    const detach = pin.viewport.attach(handle);
    const m1 = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-000000000011',
      message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
    };
    const m2 = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-000000000012',
      message: { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
    };
    store.setMessages([m1 as never]);
    pin.onUserScroll(false, handle);
    store.setMessages([m1 as never, m2 as never]);
    expect(pin.getSnapshot().unseenDivider?.count).toBe(1);
    pin.dispose();
    detach();

    const stdout = Object.assign(new PassThrough(), {
      columns: 40,
      rows: 10,
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
    const ink = new Ink({
      stdout,
      stdin,
      stderr: new PassThrough() as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
      newRenderer: true,
    });
    expect(ink.pointer).toBeInstanceOf(PointerController);
    expect(ink.scheduler).toBeInstanceOf(FrameScheduler);
    expect(ink.selection).toBe(ink.overlays.selection);
    ink.setSearchHighlight('needle');
    expect(ink.overlays.searchHighlightQuery).toBe('needle');
    ink.fallbackToOldRenderer('test_fault');
    expect(ink.renderers).toBeUndefined();
    ink.unmount();
  });

  test('QueuedMessageProvider (CTo) renders flush at column 0 without paddingX={2} wrapper', async () => {
    let seenCtx: ReturnType<typeof useQueuedMessage>;
    function Probe(): React.ReactNode {
      seenCtx = useQueuedMessage();
      return <Text>● Agent finished</Text>;
    }
    const stdout = Object.assign(new PassThrough(), {
      columns: 40,
      rows: 5,
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

    const instance = await render(
      <QueuedMessageProvider selectionHighlight="on" noticeSystemLines={true}>
        <Probe />
      </QueuedMessageProvider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    await new Promise(r => setTimeout(r, 40));
    const ink = instances.get(stdout) as unknown as { frontFrame: { screen: Screen } };
    let line0 = '';
    for (let x = 0; x < ink.frontFrame.screen.width; x++) {
      line0 += cellAt(ink.frontFrame.screen, x, 0)?.char ?? ' ';
    }
    expect(line0.trimEnd()).toBe('● Agent finished');
    expect(seenCtx).toEqual({
      isQueued: true,
      selectionHighlight: 'on',
      noticeSystemLines: true,
    });
    instance.unmount();
  });
});
