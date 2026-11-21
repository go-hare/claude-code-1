import autoBind from 'auto-bind';
import { closeSync, constants as fsConstants, openSync, readSync, writeSync } from 'fs';
import noop from 'lodash-es/noop.js';
import React, { type ReactNode } from 'react';
import type { FiberRoot } from 'react-reconciler';
import { ConcurrentRoot } from 'react-reconciler/constants.js';
import { onExit } from 'signal-exit';
import Yoga from './yoga-layout/index.js';
import { TerminalImages } from './terminalImages.js';
import { isTmuxPaneFresh, Jk } from './terminalCapabilities.js';
import { format } from 'util';
import { colorize } from './colorize.js';
import AccessibilityContext from '../components/AccessibilityContext.js';
import App from '../components/App.js';
import TerminalModesContext from '../components/TerminalModesContext.js';
import type { CursorDeclaration, CursorDeclarationSetter } from '../components/CursorDeclarationContext.js';
import { OWED_REPLY_HOLD_MS } from './constants.js';
import {
  installNonBlockingStdout,
  isNonBlockingStdoutInstalled,
  shouldInstallNonBlockingStdout,
  type NonBlockingStdoutHandle,
  type StdoutBackpressureEpisode,
} from './nonBlockingStdout.js';
import { restoreTerminalModes, TerminalModes } from './terminalModes.js';
import { InkTree } from './tree.js';
import * as dom from './dom.js';
import { ClickEvent, EMPTY_CLICK_MODS, type ClickMods, type MouseClickResult } from './events/click-event.js';
import { KeyboardEvent } from './events/keyboard-event.js';
import { PasteEvent } from './events/paste-event.js';
import { FocusManager } from './focus.js';
import {
  INPUT_GATE_OTHER,
  INPUT_GATE_WAY_OUT,
  InputGate,
  isPrintableKeyboardEvent,
  shortcutKeyForInputGate,
} from './inputGate.js';
import { emptyFrame, type Diff, type Frame, type FrameEvent } from './frame.js';
import { WheelEvent } from './events/wheel-event.js';
import {
  bubbleClick,
  cellIsBlankForHover,
  dispatchHover,
  followHover as applyFollowHover,
  dispatchPointer,
  findPointerHoverTarget,
  hitPointerHover,
  hitTest,
  nodeHasWheelHandler,
} from './hit-test.js';
import instances, { Ns } from './instances.js';
import { FrameScheduler } from './frame-scheduler.js';
import { LayoutController } from './layout-controller.js';
import { LogUpdate } from './log-update.js';
import {
  createNewRenderers,
  frameToRenderTarget,
  getTerminalRenderCapabilities,
  type NewRendererBundle,
  type RenderTargetFrame,
  type TerminalRenderCapabilities,
} from './new-renderer.js';
import { optimize } from './optimizer.js';
import Output from './output.js';
import { OverlayController } from './overlay-controller.js';
import { PointerController } from './pointer-controller.js';
import type { ParsedKey } from './parse-keypress.js';
import reconciler, {
  dispatcher,
  getLastCommitMs,
  isDebugRepaintsEnabled,
  recordYogaMs,
  resetProfileCounters,
} from './reconciler.js';
import renderNodeToOutput, { createRenderFrameContext, leftoverGsDropCachedLayout } from './render-node-to-output.js';
import { type MatchPosition, scanPositions } from './render-to-screen.js';
import createRenderer, { type Renderer } from './renderer.js';
import {
  CellWidth,
  CharPool,
  cellAt,
  createScreen,
  fillFullRepaintSentinel,
  HyperlinkPool,
  migrateScreenPools,
  type Screen,
  StylePool,
} from './screen.js';
import {
  captureScrolledRows,
  clearSelection,
  extendSelection,
  type FocusMove,
  findPlainTextUrlAt,
  getSelectedText,
  hasSelection,
  moveFocus,
  type SelectionState,
  selectLineAt,
  selectWordAt,
  shiftSelection,
  selectionScopeAt,
  startSelection,
  updateSelection,
} from './selection.js';
import {
  computeScreenReaderPark,
  countNewlines,
  eraseScreenReaderLinesUp as evt,
  isGraphemeBoundary as Iv,
  mergePreserveRanges,
  wrapCellWidth as Ko,
  wrapScreenReaderLineByCells as hv,
  type ScreenReaderAnchor,
  type ScreenReaderPark,
} from './screenReaderPark.js';
import { expandTabsForWrap as r7 } from './tabstops.js';
import { wrapAnsi } from './wrapAnsi.js';
import { resetLineWidthCache } from './line-width-cache.js';
import { createTerminalEmojiWidthCalibrator, setTerminalEmojiWidthCalibrator, stringWidth } from './stringWidth.js';
import { isJediTermEnv } from './jediTermInput.js';
import { eraseViewportInPlace } from './clearTerminal.js';
import {
  getCellPixels,
  getMousePixelsSupported,
  isITerm2OrTmuxXtversion,
  isSynchronizedOutputSupported,
  isXtermJs,
  subscribeMousePixelsSupported,
  SYNC_OUTPUT_SUPPORTED,
  type Terminal,
  recordSlowestWrite,
  writeContentToTerminal,
  writeDiffToTerminal,
  kittyKeyboardPopSeq,
} from './terminal.js';
import type { TerminalQuerier } from './terminal-querier.js';
import { cursorPosition as cursorPositionQuery } from './terminal-querier.js';
import { endScreenReaderStartupQuiet, getScreenReaderStartupQuietRemainingMs } from './screenReaderStartupQuiet.js';
import {
  drainScreenReaderAnnouncements,
  endScreenReaderHold,
  getScreenReaderPreparkMs,
  isScreenReaderHoldActive,
  startScreenReaderHold,
  takeScreenReaderAnnouncementHoldMs,
} from './screenReaderAnnounce.js';
import {
  extractScreenReaderOutput,
  findScreenReaderNodeStartIndex,
  sanitizeScreenReaderText,
  type ScreenReaderDOMNode,
} from './screenReaderTree.js';
import { MAX_TERMINAL_COLUMNS, MAX_TERMINAL_ROWS, readStdoutSize, sanitizeTerminalDimension } from './terminalSize.js';
import {
  csi,
  CURSOR_HOME,
  cursorMove,
  cursorPosition,
  cursorTo,
  ERASE_SCREEN,
  RESET_SCROLL_REGION,
} from './termio/csi.js';
import {
  ATLAS_KEY_THRESHOLD,
  ATLAS_RESET_COOLDOWN_MS,
  ATLAS_RESET_OSC,
  clearAtlasKeys,
  getAtlasKeyStats,
  isAtlasResetEnabled,
  isAtlasResetSuppressed,
  isAtlasResetThrottleBypassed,
  recordAtlasReset,
} from './xtermAtlas.js';
import {
  DEC,
  decreset,
  DFE,
  DISABLE_MOUSE_TRACKING,
  EFE,
  enableMouseTracking,
  ENTER_ALT_SCREEN,
  EXIT_ALT_SCREEN,
  HIDE_CURSOR,
  SHOW_CURSOR,
  type MouseTrackingMode,
} from './termio/dec.js';
import { LINK_END, printsUnknownSequences, setClipboard } from './termio/osc.js';
import { TerminalWriteProvider } from '../hooks/useTerminalNotification.js';

// Alt-screen: renderer.ts sets cursor.visible = !isTTY || screen.height===0,
// which is always false in alt-screen (TTY + content fills screen).
// Reusing a frozen object saves 1 allocation per frame.
const ALT_SCREEN_ANCHOR_CURSOR = Object.freeze({ x: 0, y: 0, visible: false });
const CURSOR_HOME_PATCH = Object.freeze({
  type: 'stdout' as const,
  content: CURSOR_HOME,
});
const ERASE_THEN_HOME_PATCH = Object.freeze({
  type: 'stdout' as const,
  content: ERASE_SCREEN + CURSOR_HOME,
});

// Cached per-Ink-instance, invalidated on resize. frame.cursor.y for
// alt-screen is always terminalRows - 1 (renderer.ts).
function makeAltScreenParkPatch(terminalRows: number) {
  return Object.freeze({
    type: 'stdout' as const,
    content: cursorPosition(terminalRows, 1),
  });
}

/** Official LIVE_COUNTS_INTERVAL_MS — throttle expensive DOM/fiber walks. */
const LIVE_COUNTS_INTERVAL_MS = 100;

/** Reused walk stacks (official jIh/WIh) — avoid alloc on hot sample path. */
const fiberWalkStack: FiberLike[] = [];
const domWalkStack: DomLike[] = [];

type FiberLike = {
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  alternate?: FiberLike | null;
};

type DomLike = {
  childNodes?: ArrayLike<unknown>;
};

/**
 * Official Dxc — count live React fibers under root (incl. alternate trees).
 */
function countLiveFibers(root: FiberLike | null | undefined): number {
  if (!root) return 0;
  let count = 0;
  const stack = fiberWalkStack;
  stack.length = 0;
  stack.push(root);
  while (stack.length > 0) {
    const node = stack.pop()!;
    count++;
    if (node.alternate) count++;
    if (node.sibling) stack.push(node.sibling);
    if (node.child) stack.push(node.child);
  }
  stack.length = 0;
  return count;
}

/**
 * Official Pxc — count live Ink DOM nodes under root (childNodes walk).
 */
function countLiveDomNodes(root: DomLike | null | undefined): number {
  if (!root) return 0;
  let count = 0;
  const stack = domWalkStack;
  stack.length = 0;
  stack.push(root);
  while (stack.length > 0) {
    const node = stack.pop()!;
    count++;
    if (node.childNodes) {
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) {
        stack.push(kids[i] as DomLike);
      }
    }
  }
  stack.length = 0;
  return count;
}

function isBenchLiveCountsEnvEnabled(): boolean {
  const v = process.env.CLAUDE_CODE_BENCH_LIVE_COUNTS;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isEnvTruthyLike(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/** densable `O` — gold `u().getPlatform()`; ctor only branches on `"windows"`. */
function O(): 'macos' | 'windows' | 'linux' {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
}

/** densable `ZY` / `MHe` — relative cursor for gold onRenderScreenReader BODY. */
function ZY(dx: number, dy: number): string {
  let r = '';
  if (dx < 0) r += csi(-dx, 'D');
  else if (dx > 0) r += csi(dx, 'C');
  if (dy < 0) r += csi(-dy, 'A');
  else if (dy > 0) r += csi(dy, 'B');
  return r;
}

/** densable `Go` / `Gn` — true when frame fills or exceeds viewport height. */
function frameFillsViewport(frame: Frame): boolean {
  return (frame.top ?? 0) + frame.screen.height >= frame.viewport.height;
}

/** Official 2.1.328 `yS` — collect combined bounding top & height of active popovers relative to `top`. */
function collectPopoverBounds(root: dom.DOMElement, top: number): { top: number; height: number } | undefined {
  let minTop = Infinity;
  let totalHeight = 0;
  for (const ref of root.popovers ?? []) {
    const rect = ref.current?.cachedLayout;
    if (rect?.height) {
      minTop = Math.min(minTop, rect.y - top);
      totalHeight += rect.height;
    }
  }
  return totalHeight > 0 ? { top: minTop, height: totalHeight } : undefined;
}

const HYPERLINK_POOL_LIMIT = 4096; // jg
const MAX_INLINE_LEAVE_CELLS = 134_217_728; // Jm
const INPUT_RECOVERY_HOLD_MS = 150; // q2n
const RESTORE_CURSOR = '\x1b8'; // fm

/** Official 2.1.328 `uS` — decide whether periodic pool reset/compaction should run. */
function shouldResetPools(elapsedMs: number, stylePool: StylePool, lastStyleLiveSize: number): boolean {
  const minInterval = stylePool.isNearCapacity ? 1000 : 30_000;
  return elapsedMs > minInterval && (elapsedMs > 300_000 || stylePool.needsCompaction(lastStyleLiveSize));
}

/** Official 2.1.328 `ES` — alt-screen cursor positioning callback for iTerm2 inline images. */
function altScreenMoveTo(width: number, height: number): (col: number, row: number) => string | undefined {
  return (col, row) =>
    col >= 0 && row >= 0 && col < width && row < height ? cursorPosition(row + 1, col + 1) : undefined;
}

/** Official 2.1.328 `wS` — main-screen relative cursor positioning callback for iTerm2 inline images. */
function mainScreenMoveTo(
  frame: Frame,
  cursor: { x: number; y: number },
  rows: number,
  scrolledOut: number,
): (col: number, row: number) => string | undefined {
  const total = Math.max(frame.screen.height, frame.cursor.y + 1);
  const topVisible = Math.max(0, total - rows, scrolledOut);
  const parkedY = Math.min(Math.max(cursor.y, topVisible), topVisible + rows - 1);
  return (col, row) =>
    col < 0 || row < topVisible || row >= frame.screen.height
      ? undefined
      : `${RESTORE_CURSOR}\r${cursorMove(col, row - parkedY)}`;
}

/** Official 2.1.328 `SS` — tmux pane-relative placement helper for iTerm2 inline images. */
function tmuxPaneMoveTo(
  pane: { top: number; left: number },
  enabled: boolean,
  width: number,
  height: number,
): (col: number, row: number) => { row: number; column: number } | undefined {
  return (col, row) =>
    enabled && col >= 0 && row >= 0 && col < width && row < height
      ? { row: pane.top + row + 1, column: pane.left + col + 1 }
      : undefined;
}

/** densable `Yv` @193398232 — move from parked cursor to frame cursor and erase up. */
function eraseMainScreenFrame(
  cursor: { x: number; y: number },
  displayCursor: { x: number; y: number } | null,
): string {
  return (displayCursor === null ? '' : ZY(cursor.x - displayCursor.x, cursor.y - displayCursor.y)) + evt(cursor.y + 1);
}

const REVOKED_TTY_CODES = new Set(['EIO', 'ENOTTY', 'EBADF']);

/** densable `Pw` @193040828 — setRawMode swallowing revoked-tty errors. */
function safeSetRawMode(stdin: NodeJS.ReadStream, mode: boolean, logger: Logger): void {
  const tty = stdin as NodeJS.ReadStream & { setRawMode?: (raw: boolean) => void };
  if (typeof tty.setRawMode !== 'function') return;
  try {
    tty.setRawMode(mode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
    if (msg.includes('setRawMode failed') || REVOKED_TTY_CODES.has(code)) {
      logger.debug(`setRawMode(${mode}) failed on revoked tty: ${msg}`);
      return;
    }
    throw err;
  }
}

export type Logger = {
  debug(message: string, options?: { level?: string }): void;
  error(error: Error | unknown): void;
};

export type Options = {
  stdout: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  stderr: NodeJS.WriteStream;
  exitOnCtrlC: boolean;
  patchConsole: boolean;
  waitUntilExit?: () => Promise<void>;
  onFrame?: (event: FrameEvent) => void;
  /** Called before each render cycle. Replaces flushInteractionTime(). */
  onBeforeRender?: () => void;
  /** Injected logger. Replaces logForDebugging / logError imports. */
  logger?: Logger;
  /**
   * Official isScreenReaderEnabled. When unset, falls back to INK_SCREEN_READER
   * on TTY (official constructor). When true, onRender routes to
   * onRenderScreenReader (plain-text + park ANSI write path).
   */
  isScreenReaderEnabled?: boolean;
  /** densable `eD()` — `et()` / createRoot pin. */
  nativeCursor?: boolean;
  /** Official 2.1.328 (`pressClock`) — monotonic clock for InputGate press timing. */
  pressClock?: () => number;
  /** Official 2.1.328 (`timesPresses`) — enables early-key InputGate dropping when true. */
  timesPresses?: () => boolean;
  /** Official 2.1.328 (`newRenderer`) — enables the covering/inline/fullscreen byte renderer + IncrementalPainter. */
  newRenderer?: boolean;
};

/** No-op logger used when no logger is injected. */
const noopLogger: Logger = {
  debug() {},
  error() {},
};

export default class Ink {
  private readonly log: LogUpdate;
  /** Official 2.1.328 `this.renderers` — covering/inline/fullscreen byte renderers when `newRenderer` is enabled. */
  renderers: NewRendererBundle | undefined;
  /** Official 2.1.328 `this.layout` (`Cs`) — Yoga layout & `subscribeLayout` controller. */
  readonly layout: LayoutController;
  /** Official 2.1.328 `this.overlays` (`Fm`) — selection / search / hoveredLink overlay controller. */
  readonly overlays: OverlayController;
  /** Official 2.1.328 `this.pointer` — hover / click / pointerCapture controller. */
  readonly pointer: PointerController = new PointerController();
  /** Official 2.1.328 `this.scheduler` (`xm`) — paced frame & backpressure scheduler. */
  readonly scheduler: FrameScheduler;
  private readonly terminal: Terminal;
  private scheduleRender: (() => void) & { cancel?: () => void };
  // Ignore last render after unmounting a tree to prevent empty output before exit
  private isUnmounted = false;
  private isPaused = false;
  /**
   * densable `modes` (`dqe`) — DEC stack. `isHandedOff` ORs `isSuspended`.
   */
  readonly modes = new TerminalModes();
  /**
   * densable `ownTree` — set when `tree()` is used instead of React `render()`.
   */
  private ownTree: InkTree | undefined;
  /**
   * densable `nonBlockingStdout` — gold `mbo` wrap of process.stdout.write.
   */
  private nonBlockingStdout: NonBlockingStdoutHandle | null = null;
  /**
   * densable `isHandedOff` —
   * `this.isPaused||this.modes.isSuspended||this.ownTree!==void 0&&Ns().has(this.options.stdout)`.
   * `Ns` is gold `Ht.of(U().host)`.
   */
  get isHandedOff(): boolean {
    return this.isPaused || this.modes.isSuspended || (this.ownTree !== undefined && Ns().has(this.options.stdout));
  }
  private pacerNow = (): number => performance.now();
  /**
   * densable renderCalled — set true on first render(). unmount only writes
   * renderPreviousOutput when renderCalled && !isPaused (handoffAltScreen
   * pauses so open→attach does not repaint/exit mid-handoff).
   */
  private renderCalled = false;
  private readonly container: FiberRoot;
  private rootNode: dom.DOMElement;
  readonly focusManager: FocusManager;
  private renderer: Renderer;
  private readonly stylePool: StylePool;
  private charPool: CharPool;
  private hyperlinkPool: HyperlinkPool;
  private exitPromise?: Promise<void>;
  private restoreConsole?: () => void;
  /** densable `hasExited` / `exitError` — settled before mode restore. */
  private hasExited = false;
  private exitError: Error | undefined;
  private restoreStderr?: () => void;
  /**
   * densable unsubscribeTTYHandlers — set lazily by ensureInteractive (not
   * constructor). Presence means resize/SIGCONT handlers are attached.
   */
  private unsubscribeTTYHandlers?: () => void;
  /**
   * densable hasRendered — first onRender sets true; subsequent frames call
   * ensureInteractive so TTY handlers re-attach after detach races.
   */
  private hasRendered = false;
  private terminalColumns: number;
  private terminalRows: number;
  /** densable loggedGarbageWinsize — warnGarbageWinsizeOnce fires once. */
  private loggedGarbageWinsize = false;
  private currentNode: ReactNode = null;
  private frontFrame: Frame;
  private backFrame: Frame;
  private lastPoolResetTime = performance.now();
  /**
   * densable lastAtlasResetAt — throttle for maybeProactiveAtlasReset (xterm.js
   * color atlas OSC 104). Focus path uses proactiveAtlasResetOnFocus without
   * the throttle (densable 2.1.217).
   */
  private lastAtlasResetAt = 0;
  private lastStyleLiveSize = 0;
  private isFrameOwed = false;
  private takesInputFrom = 0;
  /** Official liveCountsEnabled from CLAUDE_CODE_BENCH_LIVE_COUNTS. */
  private readonly liveCountsEnabled: boolean;
  private lastLiveCountSampleAt = 0;
  /**
   * Official accessibilityMode from CLAUDE_CODE_ACCESSIBILITY (magnifier).
   * Separate from isScreenReaderEnabled (ax screen-reader path).
   */
  private readonly accessibilityMode: boolean;
  /** Official isScreenReaderEnabled — routes onRender → onRenderScreenReader. */
  private readonly isScreenReaderEnabled: boolean;
  /**
   * densable isExiting — set true at unmount start so SR quiet gate is
   * skipped for the final paint.
   */
  private isExiting = false;
  /**
   * densable srStartupQuietTimer — defers first SR paints during quiet window.
   */
  private srStartupQuietTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * densable `srPreParkTimer` — park-then-repaint after `$to` pre-park write.
   */
  private srPreParkTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * densable `srAnnouncementHoldTimer` — hold SR frame until announcement TTL.
   */
  private srAnnouncementHoldTimer: ReturnType<typeof setTimeout> | null = null;
  /** densable `srPreParked` — CHA pre-park already written this SR rewrite. */
  private srPreParked = false;
  /**
   * densable `srHeldAnnouncements` — persist drained SR announcements across
   * frames until content above them changes (or growth exceeds KC=3).
   */
  private srHeldAnnouncements: string[] = [];
  /** densable `BXo` — `a.CLAUDE_AX_REWRITE_HELD_ANNOUNCEMENT??!1`. */
  private srRewriteHeldAnnouncement = Boolean(process.env.CLAUDE_AX_REWRITE_HELD_ANNOUNCEMENT ?? false);
  /** densable `KC` — max extra held-announcement rows before drop. */
  private static readonly SR_HELD_ANNOUNCEMENT_MAX_EXTRA = 3;
  /** Official prevScreenReaderLines — last written SR frame lines. */
  private prevScreenReaderLines: string[] = [];
  /** Official prevScreenReaderPark — last parked SR cursor. */
  private prevScreenReaderPark: ScreenReaderPark = { row: 0, col: 0 };
  /**
   * densable prevScreenReaderAnchor — tracks whether suffix-append is safe
   * (2.1.219 #15: avoid rewriting entire input line on each keystroke).
   */
  private prevScreenReaderAnchor: ScreenReaderAnchor = 'clean';
  /**
   * densable prevScreenReaderParkDeclared — previous frame had a declared
   * cursor (l!==null). Required for 2.1.222 #15 EOL delete fast path.
   */
  private prevScreenReaderParkDeclared = false;
  private altScreenParkPatch: Readonly<{ type: 'stdout'; content: string }>;
  /** Single source of truth: delegates directly to `this.overlays.selection`. */
  get selection(): SelectionState {
    return this.overlays.selection;
  }
  subscribeClicks = (
    listener: (node: dom.DOMElement | null | undefined, event: ClickEvent | null) => void,
  ): (() => void) => this.pointer.subscribeClicks(listener);
  subscribeLayout = (listener: () => void): (() => void) => this.layout.subscribeLayout(listener);
  /**
   * densable `hoverTrackedListeners` / `subscribeHoverTracked`.
   * Notified on `setAltScreenActive` via `queueMicrotask`.
   */
  private readonly hoverTrackedListeners = new Set<() => void>();
  /**
   * densable `subscribeHoverTracked=(n)=>(this.hoverTrackedListeners.add(n),()=>{...})`.
   */
  subscribeHoverTracked = (listener: () => void): (() => void) => {
    this.hoverTrackedListeners.add(listener);
    return () => {
      this.hoverTrackedListeners.delete(listener);
    };
  };
  /**
   * densable `isHoverTracked=()=>this.altScreenActive&&this.altScreenMouseTracking==="full"`.
   */
  isHoverTracked = (): boolean => this.altScreenActive && this.altScreenMouseTracking === 'full';
  /**
   * densable `frameListeners` / `subscribeFrames` — paint bus for `mDn`.
   * `tellFrameListeners()` after onRender paint, immediately before `onFrame`.
   */
  private readonly frameListeners = new Set<() => void>();
  /**
   * densable `subscribeFrames=(n)=>(this.frameListeners.add(n),()=>{...})`.
   */
  subscribeFrames = (listener: () => void): (() => void) => {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  };
  /**
   * Official 2.1.328 (`pressClock` / `inputGate` / `dropsInput` / `noteIfStray` /
   * `noteFrameWritten` @307262416): early-key guard with `wantEveryKey` opt-out.
   */
  pressClock = (): number => this.options.pressClock?.() ?? performance.now();
  readonly inputGate = new InputGate(owner => this.rootNode.wantEveryKey?.includes(owner) === true);
  isTimingPresses = (): boolean => this.options.timesPresses?.() ?? false;
  private queuedFrames: Array<{ frame: dom.FrameStamp; queuedAt: number }> = [];

  dropsInput(target: dom.DOMElement, input: string, pressedAt: number | undefined, detail?: unknown): boolean {
    if (pressedAt === undefined || !this.isTimingPresses()) return false;
    this.noteQueueWritten();
    return this.inputGate.drops(target, input, pressedAt, detail);
  }

  noteIfStray(event: KeyboardEvent | PasteEvent, target: dom.DOMElement): void {
    if (
      this.isTimingPresses() &&
      !event.defaultPrevented &&
      !event._isPropagationStopped() &&
      !event.didStopImmediatePropagation()
    ) {
      this.inputGate.noteStrayText(target);
    }
  }

  private noteFrameWritten(): void {
    const frame = (this.rootNode.lastFrame = this.rootNode.nextFrame ?? {
      writtenAt: Number.POSITIVE_INFINITY,
    });
    this.queuedFrames.push({ frame, queuedAt: this.pressClock() });
    this.rootNode.nextFrame = { writtenAt: Number.POSITIVE_INFINITY };
    this.noteQueueWritten();
  }

  private noteQueueWritten(): void {
    const now = this.pressClock();
    const hasQueued = Boolean(this.nonBlockingStdout?.queuedBytes());
    this.queuedFrames = this.queuedFrames.filter(({ frame, queuedAt }) => {
      const stillQueued = hasQueued && now - queuedAt < 2000;
      if (!stillQueued) frame.writtenAt = now;
      return stillQueued;
    });
  }

  /**
   * densable `tellFrameListeners(){this.noteFrameWritten();for(let n of this.frameListeners)n()}`.
   */
  private tellFrameListeners(): void {
    this.noteFrameWritten();
    for (const listener of this.frameListeners) listener();
  }
  /**
   * densable `tellClickedNowhere` — alt-screen exit delivers `(null,null)`
   * on a microtask so ITt click-away can drop pane focus.
   */
  private tellClickedNowhere(): void {
    this.pointer.tellClickedNowhere();
  }
  private readonly appRef = React.createRef<App>();
  // Set by <AlternateScreen> via setAltScreenActive(). Controls the
  // renderer's cursor.y clamping (keeps cursor in-viewport to avoid
  // LF-induced scroll when screen.height === terminalRows) and gates
  // alt-screen-aware SIGCONT/resize/unmount handling.
  private altScreenActive = false;
  // Official densable altScreenMouseTracking: "off" | "scroll" | "full".
  // Set by <AlternateScreen> so SIGCONT / resize / reassert re-enable the
  // same DEC mode set (not all AlternateScreen uses want tracking).
  private altScreenMouseTracking: MouseTrackingMode = 'off';
  // True when the previous frame's screen buffer cannot be trusted for
  // blit — selection overlay mutated it, resetFramesForAltScreen()
  // replaced it with blanks, or forceRedraw() reset it to 0×0. Forces
  // one full-render frame; steady-state frames after clear it and regain
  // the blit + narrow-damage fast path.
  private prevFrameContaminated = false;
  /**
   * densable `keptForNextFrame` / `leftAltScreenSinceFrame` — DEC sequences
   * coalesced into the next paint so AlternateScreen 1049h is not a separate
   * write from the first frame.
   */
  private keptForNextFrame = '';
  private leftAltScreenSinceFrame = false;
  // Set by handleResize: prepend ERASE_SCREEN to the next onRender's patches
  // INSIDE the BSU/ESU block so clear+paint is atomic. Writing ERASE_SCREEN
  // synchronously in handleResize would leave the screen blank for the ~80ms
  // render() takes; deferring into the atomic block means old content stays
  // visible until the new frame is fully ready.
  private needsEraseBeforePaint = false;
  /**
   * densable `get altScreenFullRepaint(){return a.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT}`.
   * Live env — ads() / applyFleetViewHostWindowsEnv may set the flag after
   * Ink construction. AgentView / FleetView sets this on Windows (and
   * WT_SESSION) so every alt-screen frame rewrites all cells (ConPTY
   * incremental-diff). Gold onRender: full damage + sentinel prev + pin.
   */
  private get altScreenFullRepaint(): boolean {
    return isEnvTruthyLike(process.env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT);
  }
  /** densable `fullRepaintSentinelScreen` — spacer-filled prev for full damage. */
  private fullRepaintSentinelScreen: Screen | undefined = undefined;
  // Native cursor positioning: a component (via useDeclaredCursor) declares
  // where the terminal cursor should be parked after each frame. Terminal
  // emulators render IME preedit text at the physical cursor position, and
  // screen readers / screen magnifiers track it — so parking at the text
  // input's caret makes CJK input appear inline and lets a11y tools follow.
  private cursorDeclaration: CursorDeclaration | null = null;
  // Main-screen: physical cursor position after the declared-cursor move,
  // tracked separately from frame.cursor (which must stay at content-bottom
  // for log-update's relative-move invariants). Alt-screen doesn't need
  // this — every frame begins with CSI H. null = no move emitted last frame.
  private displayCursor: { x: number; y: number; emittedRows: number } | null = null;
  /**
   * densable `Jd` kitty registry. Ctor: `terminalImages=new Jd(()=>this.scheduleRender())`.
   */
  private readonly terminalImages = new TerminalImages(() => this.scheduleRender());
  /**
   * densable `imagesStale` — SIGCONT / resume / alt reset / full reset mark
   * kitty cells dirty. onRender consume: `if(this.imagesStale)this.imagesStale=!1,this.terminalImages.retransmitAll()` immediately before renderer.
   */
  private imagesStale = false;
  /**
   * densable `nativeCursorVisible` — gold handleResume sets this to
   * `accessibilityMode` on the main-screen arm.
   */
  private nativeCursorVisible = false;
  /**
   * densable `bgWorkerForceShowCursor` —
   * `altScreenFullRepaint && !nativeCursor && SESSION_KIND==="bg" && windows`.
   */
  private bgWorkerForceShowCursor = false;
  /**
   * densable `mainScreenBehindAlt` — snapshot of the main screen while alt is
   * active. handleResume clears it on the main-screen arm.
   */
  private mainScreenBehindAlt: { viewport: { width: number; height: number }; erase: string } | undefined;
  private isFinishingWrites = false;
  private renderAllocFailures = 0;
  private isRedrawingAtOnce = false;
  private unwritten:
    | {
        tries: number;
        isLost: boolean;
        wasContaminated: boolean;
        beingWritten: string | undefined;
        error: unknown;
        shown: {
          nativeCursorVisible: boolean;
          displayCursor: { x: number; y: number; emittedRows: number } | null;
          frontFrame: Frame;
          backFrame: Frame;
          mainScreenBehindAlt: { viewport: { width: number; height: number }; erase: string } | undefined;
        };
      }
    | undefined = undefined;
  private readonly logger: Logger;

  constructor(private readonly options: Options) {
    autoBind(this);
    this.logger = options.logger ?? noopLogger;
    // Official: this.liveCountsEnabled=ct(process.env.CLAUDE_CODE_BENCH_LIVE_COUNTS)
    this.liveCountsEnabled = isBenchLiveCountsEnvEnabled();
    // Official: this.accessibilityMode=be.CLAUDE_CODE_ACCESSIBILITY
    this.accessibilityMode = isEnvTruthyLike(process.env.CLAUDE_CODE_ACCESSIBILITY);
    // densable: bgWorkerForceShowCursor = this.altScreenFullRepaint && !nativeCursor && bg && windows
    // (reads the live getter at ctor — gold ctor snapshot of SESSION_KIND/windows)
    this.bgWorkerForceShowCursor =
      this.altScreenFullRepaint &&
      !this.options.nativeCursor &&
      process.env.CLAUDE_CODE_SESSION_KIND === 'bg' &&
      O() === 'windows';
    this.nativeCursorVisible = this.accessibilityMode;
    // Official: e.isScreenReaderEnabled ?? (!!stdout.isTTY && ct(INK_SCREEN_READER))
    this.isScreenReaderEnabled =
      options.isScreenReaderEnabled ?? (!!options.stdout.isTTY && isEnvTruthyLike(process.env.INK_SCREEN_READER));

    if (this.options.patchConsole) {
      this.restoreConsole = this.patchConsole();
      this.restoreStderr = this.patchStderr();
    }

    this.terminal = {
      stdout: options.stdout,
      stderr: options.stderr,
      tolerateDeadStdout: process.env.CLAUDE_BG_BACKEND === 'daemon',
      stdoutDead: false,
    };

    // densable: stdout===process.stdout && (fZt()||gbo(...)) → mbo(handleStdoutBackpressure)
    if (options.stdout === process.stdout && (isNonBlockingStdoutInstalled() || shouldInstallNonBlockingStdout())) {
      this.nonBlockingStdout = installNonBlockingStdout(this.handleStdoutBackpressure);
    }

    // densable @193349870: reset DECSTBM margins + show cursor on real TTY stdout
    if (options.stdout === process.stdout && options.stdout.isTTY) {
      options.stdout.write('\x1b7' + RESET_SCROLL_REGION + '\x1b8' + SHOW_CURSOR);
    }

    // densable pCi(stdout, warnGarbageWinsizeOnce) — clamp, not || 80/24
    const ctorSize = readStdoutSize(options.stdout, this.warnGarbageWinsizeOnce);
    this.terminalColumns = ctorSize.cols;
    this.terminalRows = ctorSize.rows;
    this.altScreenParkPatch = makeAltScreenParkPatch(this.terminalRows);
    this.stylePool = new StylePool();
    this.charPool = new CharPool();
    this.hyperlinkPool = new HyperlinkPool();
    this.frontFrame = emptyFrame(
      this.terminalRows,
      this.terminalColumns,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool,
    );
    this.backFrame = emptyFrame(
      this.terminalRows,
      this.terminalColumns,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool,
    );

    this.log = new LogUpdate({
      isTTY: (options.stdout.isTTY as boolean | undefined) || false,
      stylePool: this.stylePool,
    });
    this.renderers =
      options.newRenderer && !this.isScreenReaderEnabled ? createNewRenderers(this.stylePool) : undefined;
    // Official 2.1.328 (`Ucl(DS()),Qf.reset()` @402924): calibrate terminal
    // emoji widths and drop stale line-width cache entries when the new byte
    // renderer drives a real TTY.
    if (this.renderers && options.stdout.isTTY) {
      setTerminalEmojiWidthCalibrator(createTerminalEmojiWidthCalibrator());
      resetLineWidthCache();
    }

    this.scheduler = new FrameScheduler(
      () => this.onRender(),
      () => this.nonBlockingStdout?.queuedBytes() ?? 0,
      () => this.pacerNow(),
    );
    // densable: scheduleRender=Object.assign(()=>this.scheduleFrame(),{cancel:()=>this.cancelScheduledFrame()})
    // Test env uses onImmediateRender (direct onRender) so lastFrame() tests stay sync.
    this.scheduleRender = Object.assign(() => this.scheduler.scheduleFrame(), {
      cancel: () => this.scheduler.cancelScheduledFrame(),
    });

    // Ignore last render after unmounting a tree to prevent empty output before exit
    this.isUnmounted = false;

    // Unmount when process exits
    this.unsubscribeExit = onExit(this.unmount, { alwaysLast: false });

    // densable: this.rootNode=_r("ink-root",hs.Config.create())
    const yogaConfig = Yoga.Config.create();
    this.rootNode = dom.createNode('ink-root', yogaConfig);
    this.layout = new LayoutController(this.rootNode, yogaConfig, {
      width: () => (this.options.stdout.isTTY || this.options.stdout.columns ? this.terminalColumns : undefined),
      onFailed: () => {
        if (!this.isScreenReaderEnabled) {
          this.isFrameOwed = true;
          this.prevFrameContaminated = true;
        }
      },
      invalidatePrevFrame: () => {
        this.prevFrameContaminated = true;
      },
      onFaultMessage: (msg, opts) => this.logger.debug(msg, opts ?? { level: 'warn' }),
      onFaultError: err => this.logger.error(err),
      onYogaMs: ms => recordYogaMs(ms),
    });
    this.overlays = new OverlayController(this.rootNode, this.stylePool, {
      screen: () => this.frontFrame.screen,
      isAltScreenActive: () => this.altScreenActive,
      scheduleRender: () => this.scheduleRender(),
    });
    this.pointer.setHost({
      isAltScreenActive: () => this.altScreenActive,
      showsWhatInputAnswers: this.showsWhatInputAnswers,
    });
    this.focusManager = new FocusManager((target, event) => dispatcher.dispatchDiscrete(target, event));
    this.rootNode.focusManager = this.focusManager;
    this.rootNode.nextFrame = { writtenAt: Number.POSITIVE_INFINITY };
    this.rootNode.popovers = this.renderers ? new Set() : undefined;
    this.renderer = createRenderer(this.rootNode, this.stylePool);
    this.rootNode.onRender = this.scheduleRender;
    this.rootNode.onImmediateRender = this.onRender;
    this.rootNode.onComputeLayout = () => {
      // densable 2.1.228 #1: runLayoutPass with try/recover instead of bare
      // calculateLayout — yoga faults clear caches and re-layout once.
      // densable 2.1.239: TTY + stale winsize → syncTerminalSize then
      // queueMicrotask render (after this layout pass).
      if (this.isUnmounted) {
        return;
      }
      if (this.options.stdout.isTTY && this.syncTerminalSize()) {
        const node = this.currentNode;
        if (node !== null) {
          queueMicrotask(() => {
            if (!this.isUnmounted) this.render(node);
          });
        }
      }
      const yoga = this.rootNode.yogaNode;
      if (yoga) {
        this.runLayoutPass(yoga);
      }
      this.notifyLayoutListeners();
    };

    this.container = reconciler.createContainer(
      this.rootNode,
      ConcurrentRoot,
      null,
      false,
      null,
      'id',
      noop, // onUncaughtError
      noop, // onCaughtError
      noop, // onRecoverableError
      noop, // onDefaultTransitionIndicator
    );

    // @ts-expect-error MACRO-replaced comparison — always false in production builds
    if ('production' === 'development') {
      reconciler.injectIntoDevTools({
        bundleType: 0,
        // Reporting React DOM's version, not Ink's
        // See https://github.com/facebook/react/issues/16666#issuecomment-532639905
        version: '16.13.1',
        rendererPackageName: 'ink',
      });
    }
  }

  private handleResume = () => {
    this.forgetPointer();
    if (!this.options.stdout.isTTY) {
      return;
    }

    dom.stampFirstFrame(this.rootNode);
    // densable: process.kill(pid, SIGWINCH) then alt: if modes.isSuspended
    // resetFrames+imagesStale+scheduleRender (App resume() reasserts DEC);
    // else reenter. Main: clear mainScreenBehindAlt, reset frames, imagesStale,
    // nativeCursorVisible=accessibilityMode. No analog mouse write on SIGCONT.
    // Official 2.1.327 (#411): in restricted sandboxes process.kill can throw
    // EPERM; fall back to emitting SIGWINCH directly on the process.
    try {
      process.kill(process.pid, 'SIGWINCH');
    } catch (err) {
      this.logger.debug(`Can't send SIGWINCH on resume, emitting it: ${String(err)}`, { level: 'warn' });
      setImmediate(() => process.emit('SIGWINCH'));
    }
    if (this.altScreenActive) {
      if (this.modes.isSuspended) {
        this.resetFramesForAltScreen();
        this.imagesStale = true;
        this.scheduleRender();
        return;
      }
      this.reenterAltScreen();
      return;
    }

    // Main screen: start fresh to prevent clobbering terminal content
    this.mainScreenBehindAlt = undefined;
    this.frontFrame = emptyFrame(
      this.frontFrame.viewport.height,
      this.frontFrame.viewport.width,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool,
    );
    this.backFrame = emptyFrame(
      this.backFrame.viewport.height,
      this.backFrame.viewport.width,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool,
    );
    this.log.reset();
    this.renderers?.inline.reset();
    this.prevFrameContaminated = true;
    this.imagesStale = true;
    this.displayCursor = null;
    this.nativeCursorVisible = this.accessibilityMode;
    this.resetScreenReaderDiffState();
    this.scheduleRender();
  };

  /** Official resetScreenReaderDiffState — clear prev SR frame + park + anchor. */
  resetScreenReaderDiffState(): void {
    this.prevScreenReaderLines = [];
    this.prevScreenReaderPark = { row: 0, col: 0 };
    this.prevScreenReaderParkDeclared = false;
    this.prevScreenReaderAnchor = 'clean';
    this.srPreParked = false;
  }

  /**
   * densable `oyr` — stamp the cut node on the ink-root (`transcriptFrontCutRows`).
   */
  setTranscriptFrontCut(cutNode: unknown): void {
    let node: typeof this.rootNode | undefined = this.rootNode;
    while (node.parentNode !== undefined) node = node.parentNode;
    if (node.nodeName === 'ink-root') {
      (node as { transcriptFrontCutRows?: unknown }).transcriptFrontCutRows = cutNode;
    }
  }

  /**
   * densable `applyTranscriptFrontCut` — splice dropped transcript rows out of
   * the previous SR frame when the park is below the cut.
   */
  applyTranscriptFrontCut(
    cutNode: unknown,
    fullText: string,
    lineBaseRows: readonly number[],
    newLines: readonly string[],
  ): void {
    if (this.prevScreenReaderAnchor !== 'clean') return;
    const prev = this.prevScreenReaderLines;
    const park = this.prevScreenReaderPark;
    const above = prev.length - this.terminalRows;
    if (above <= 0) return;
    const start = findScreenReaderNodeStartIndex(this.rootNode as ScreenReaderDOMNode, cutNode as ScreenReaderDOMNode);
    if (start === null) return;
    const M = lineBaseRows[countNewlines(fullText.slice(0, start))];
    if (M === undefined) return;
    for (let T = 1; M + T + 1 < above; T++) {
      let aligned = true;
      let nonempty = 0;
      for (let F = M + T + 1; F < above; F++) {
        const L = F - T;
        if (L >= newLines.length || prev[F] !== newLines[L]) {
          aligned = false;
          break;
        }
        if (prev[F] !== '') nonempty++;
      }
      if (!aligned || nonempty < this.terminalRows) continue;
      if (park.row >= M && park.row < M + T) return;
      this.prevScreenReaderLines = [...prev.slice(0, M), newLines[M], ...prev.slice(M + T + 1)];
      if (park.row >= M + T) {
        this.prevScreenReaderPark = { row: park.row - T, col: park.col };
      }
      return;
    }
  }

  private handleWinch = () => {
    this.appRef.current?.reprobeCellPixels();
  };

  // densable handleResize = () => { if (!syncTerminalSize()) return; reprobeCellPixels(); render }
  // NOT debounced. A debounce opens a window where stdout.columns is NEW
  // but this.terminalColumns/Yoga are OLD — any scheduleRender during that
  // window (spinner, clock) makes log-update detect a width change and
  // clear the screen, then the debounce fires and clears again (double
  // blank→paint flicker).
  private handleResize = () => {
    if (!this.syncTerminalSize()) return;
    this.appRef.current?.reprobeCellPixels();
    if (this.currentNode !== null) {
      this.rootNode.layoutStale ||= Boolean(this.renderers);
      this.render(this.currentNode);
      if (!this.renderers || !this.rootNode.layoutStale) return;
    }
    this.rootNode.layoutStale = false;
    this.rootNode.onComputeLayout?.();
    this.scheduleRender();
  };

  /**
   * densable syncTerminalSize — false if winsize unchanged.
   * Alt + !isHandedOff + TTY: re-assert mouse, resetFrames, needsEraseBeforePaint.
   * Do NOT write ENTER_ALT_SCREEN or ERASE_SCREEN here (iTerm ?1049h flicker).
   */
  private syncTerminalSize(): boolean {
    if (!this.hasStaleTerminalSize()) return false;
    const { columns, rows } = this.stdoutSize();
    if (
      !this.altScreenActive &&
      this.frontFrame.screen.height > 0 &&
      (rows < this.terminalRows || columns !== this.terminalColumns)
    ) {
      this.renderers?.inline.invalidate();
    }
    this.terminalColumns = columns;
    this.terminalRows = rows;
    this.altScreenParkPatch = makeAltScreenParkPatch(this.terminalRows);
    this.resetScreenReaderDiffState();
    if (this.altScreenActive && !this.isHandedOff && this.options.stdout.isTTY) {
      if (this.altScreenMouseTracking !== 'off') {
        this.options.stdout.write(this.mouseOnSeq());
      }
      this.resetFramesForAltScreen();
      this.needsEraseBeforePaint = true;
      this.renderers?.fullscreen.invalidate('resize');
    }
    return true;
  }

  resolveExitPromise: () => void = () => {
    this.exitPromise ??= Promise.resolve();
  };
  rejectExitPromise: (reason?: Error) => void = (reason?: Error) => {
    if (this.exitPromise === undefined) {
      this.exitPromise = Promise.reject(reason);
      this.exitPromise.catch(() => {});
    }
  };
  unsubscribeExit: () => void = () => {};

  /**
   * densable 2.1.216 prepareTerminalForHandoff — GUI external editor path.
   * Pause Ink, disable mouse tracking + focus events, release stdin so the
   * host terminal does not emit mouse/focus garbage while a detached GUI
   * editor owns the window. Pair with restoreTerminalAfterHandoff().
   */
  prepareTerminalForHandoff(): void {
    this.pause();
    this.forgetPointer();
    this.options.stdout.write((this.altScreenMouseTracking !== 'off' ? DISABLE_MOUSE_TRACKING : '') + DFE);
    this.nonBlockingStdout?.flush();
    this.suspendStdin();
  }

  /**
   * densable 2.1.216 restoreTerminalAfterHandoff — reverse of
   * prepareTerminalForHandoff after a GUI editor spawnSync returns.
   */
  restoreTerminalAfterHandoff(): void {
    this.resumeStdin();
    this.options.stdout.write(this.mouseOnSeq() + EFE);
    this.resume();
  }

  /**
   * Pause Ink and hand the terminal over to an external TUI (e.g. git
   * commit editor). In non-fullscreen mode this enters the alt screen;
   * in fullscreen mode we're already in alt so we just clear it.
   * Call `exitAlternateScreen()` when done to restore Ink.
   */
  enterAlternateScreen(): void {
    this.pause();
    const uncovered = this.uncover();
    if (uncovered !== '') {
      this.options.stdout.write(uncovered);
    }
    this.forgetPointer();
    // densable: modes.suspend("altScreen") + (already-alt?"":1049h+kittyPop) + SGR0 + show + 2J + H
    this.options.stdout.write(
      this.modes.suspend('altScreen') +
        (this.altScreenActive ? '' : ENTER_ALT_SCREEN + kittyKeyboardPopSeq()) +
        '\x1b[0m' +
        SHOW_CURSOR +
        ERASE_SCREEN +
        CURSOR_HOME,
    );
    this.nonBlockingStdout?.flush();
    this.suspendStdin();
  }

  /**
   * Resume Ink after an external TUI handoff with a full repaint.
   * In non-fullscreen mode this exits the alt screen back to main;
   * in fullscreen mode we re-enter alt and clear + repaint.
   *
   * The re-enter matters: terminal editors (vim, nano, less) write
   * smcup/rmcup (?1049h/?1049l), so even though we started in alt,
   * the editor's rmcup on exit drops us to main screen. Without
   * re-entering, the 2J below wipes the user's main-screen scrollback
   * and subsequent renders land in main — native terminal scroll
   * returns, fullscreen scroll is dead.
   */
  exitAlternateScreen(): void {
    this.resumeStdin();
    const hideCursor = this.altScreenActive || !(this.accessibilityMode || this.isScreenReaderEnabled);
    this.options.stdout.write(
      (this.altScreenActive ? '' : EXIT_ALT_SCREEN) +
        (hideCursor ? HIDE_CURSOR : '') +
        this.modes.resume({ clearKeys: true }) +
        (this.altScreenActive ? HIDE_CURSOR : ''),
    );
    if (this.altScreenActive) {
      this.resetFramesForAltScreen();
      this.imagesStale = true;
    } else if (!this.isScreenReaderEnabled) {
      if (frameFillsViewport(this.frontFrame) || this.renderers?.inline.mustRedraw) {
        this.log.forceFullReset();
        this.renderers?.inline.invalidate();
        this.prevFrameContaminated = true;
        this.imagesStale = true;
      } else {
        this.options.stdout.write(eraseMainScreenFrame(this.frontFrame.cursor, this.displayCursor));
        this.repaint();
      }
    }
    this.resume();
  }

  /**
   * Delegate layout execution and fault recovery to `this.layout` (`LayoutController`).
   */
  private runLayoutPass(_yogaNode?: NonNullable<typeof this.rootNode.yogaNode>): void {
    this.layout.runLayoutPass();
  }

  /**
   * densable requestInputPriorityFrame — arm SSo interval for _So=50ms.
   * Gold also ends an SR announcement hold (`pWe`) and drops held
   * announcements so the next paint is not stuck behind the timer.
   */
  requestInputPriorityFrame = (): void => {
    this.scheduler.prioritizeInput(this.pacerNow() + 50);
    let dirty = false;
    if (this.srAnnouncementHoldTimer !== null) {
      endScreenReaderHold();
      dirty = true;
    }
    if (this.isScreenReaderEnabled && this.srHeldAnnouncements.length > 0) {
      this.srHeldAnnouncements = [];
      dirty = true;
    }
    if (dirty) this.onRender();
  };

  /**
   * densable scheduleFrame — Vh=16 / SSo=4 pacer. Leading path queues a
   * microtask onRender; else a timeout to lastPacedFrameAt+interval.
   */
  private scheduleFrame(): void {
    this.scheduler.scheduleFrame();
  }

  private cancelScheduledFrame(): void {
    this.scheduler.cancelScheduledFrame();
  }

  private handleStdoutBackpressure = (episode: StdoutBackpressureEpisode): void => {
    if (episode.droppedBytes > 0) {
      const probe = episode.endedBy === 'drain';
      this.appRef.current?.querier?.resync({ probe });
      if (!this.isFinishingWrites) {
        if (probe) {
          this.reassertTerminalModes();
          this.forceRedraw();
        } else {
          this.repaint();
        }
      }
    }
    if (episode.endedBy === 'drain') {
      this.scheduler.resumeFromBacklog();
    }
    if (episode.droppedBytes > 0 || episode.durationMs >= 1000) {
      this.logger.debug(
        `tengu_stdout_backpressure duration_ms=${episode.durationMs} peak_queued_bytes=${episode.peakQueuedBytes} dropped_bytes=${episode.droppedBytes}`,
      );
    }
  };

  get nativeCursorSeq(): string {
    if (this.accessibilityMode || this.isScreenReaderEnabled) return '';
    return this.nativeCursorVisible ? SHOW_CURSOR : HIDE_CURSOR;
  }

  private notifyLayoutListeners(): void {
    this.layout.notifyLayoutListeners();
  }

  private static readonly MAX_UNWRITTEN_RETRIES = 3;

  /**
   * Official 2.1.327/328 `beginFrame`: snapshot displayed state (and inline /
   * covering renderer state) before painting so a failed frame can be rolled
   * back and retried cleanly instead of leaving the screen blank or frozen.
   */
  private beginFrame(): void {
    if (!this.options.stdout.isTTY) return;
    this.renderers?.inline.frameBegins();
    this.renderers?.covering.frameBegins();
    this.unwritten = {
      tries: 0,
      isLost: false,
      wasContaminated: this.prevFrameContaminated,
      ...this.unwritten,
      beingWritten: undefined,
      error: undefined,
      shown: {
        nativeCursorVisible: this.nativeCursorVisible,
        displayCursor: this.displayCursor,
        frontFrame: this.frontFrame,
        backFrame: this.backFrame,
        mainScreenBehindAlt: this.mainScreenBehindAlt,
      },
    };
  }

  private takeBackUnwrittenFrame(snapshot: NonNullable<typeof this.unwritten>): void {
    snapshot.isLost = true;
    this.nativeCursorVisible = snapshot.shown.nativeCursorVisible;
    this.displayCursor = snapshot.shown.displayCursor;
    this.frontFrame = snapshot.shown.frontFrame;
    this.backFrame = snapshot.shown.backFrame;
    this.mainScreenBehindAlt = snapshot.shown.mainScreenBehindAlt;
    this.renderers?.inline.frameWasLost();
    this.renderers?.covering.frameWasLost();
    if (!this.renderers) {
      this.forgetWhatIsShown();
    }
    if (snapshot.beingWritten !== undefined) {
      this.keptForNextFrame = `\x1b[m${printsUnknownSequences() ? '' : LINK_END}${snapshot.beingWritten}${this.keptForNextFrame}`;
      this.renderers?.inline.invalidate();
    }
  }

  /**
   * Official 2.1.328 `showsWhatInputAnswers()` (@410863) — ensure the terminal
   * actually shows the current frame before accepting input. Retries a lost or
   * owed frame synchronously; holds input for `INPUT_RECOVERY_HOLD_MS` if it
   * still fails or just recovered.
   */
  showsWhatInputAnswers = (): boolean => {
    if (this.unwritten) {
      try {
        this.onRender();
      } catch (err) {
        this.logger.debug(`A lost frame still can't be drawn: ${String(err)}`);
      }
    } else if (this.layout.layoutDamaged || this.isFrameOwed) {
      try {
        this.onRender();
      } catch (err) {
        this.logger.error(err);
        this.invalidatePrevFrame();
        this.scheduleRender();
        this.takesInputFrom = this.pressClock() + INPUT_RECOVERY_HOLD_MS;
      }
    }
    return !this.unwritten && !this.isFrameOwed && this.pressClock() >= this.takesInputFrom;
  };

  onRender() {
    if (this.isUnmounted || this.isHandedOff) {
      return;
    }
    try {
      this.drawFrame();
      if (!this.unwritten?.isLost) {
        this.unwritten = undefined;
      }
    } catch (err) {
      const snapshot = this.unwritten;
      if (!snapshot || snapshot.error === err) {
        throw err;
      }
      snapshot.error = err;
      const canRetryAtOnce = !snapshot.isLost && !this.isRedrawingAtOnce;
      this.takeBackUnwrittenFrame(snapshot);
      if (err instanceof RangeError) {
        this.handleRenderAllocationFailure('onRender', err);
      }
      if (!canRetryAtOnce && ++snapshot.tries > Ink.MAX_UNWRITTEN_RETRIES) {
        this.prevFrameContaminated = snapshot.wasContaminated;
        if (err instanceof RangeError) {
          this.unwritten = undefined;
          return;
        }
        throw err;
      }
      this.prevFrameContaminated = true;
      this.imagesStale = true;
      if (canRetryAtOnce) {
        this.isRedrawingAtOnce = true;
        try {
          this.onRender();
        } finally {
          this.isRedrawingAtOnce = false;
        }
      }
      if (this.unwritten?.isLost && !this.isRedrawingAtOnce) {
        this.scheduleRender();
      }
    }
  }

  private drawFrame(retrying = false): void {
    if (this.isUnmounted || this.isHandedOff) {
      return;
    }
    this.beginFrame();
    // densable: if(this.hasRendered&&!this.isExiting)this.ensureInteractive();
    // this.hasRendered=!0
    if (this.hasRendered && !this.isExiting) {
      this.ensureInteractive();
    }
    this.hasRendered = true;
    this.scheduler.invalidatePendingMicrotask();
    this.scheduler.cancelDrainFrame();
    this.scheduler.cancelScheduledFrame();

    // densable: if(this.rootNode.layoutStale){ clear; stale winsize → handleResize
    // else onComputeLayout + flushSyncWork }. Re-layout after Ab subscribe.
    if (this.rootNode.layoutStale) {
      this.rootNode.layoutStale = false;
      if (this.options.stdout.isTTY && this.hasStaleTerminalSize()) {
        this.handleResize();
      } else {
        this.rootNode.onComputeLayout?.();
        reconciler.flushSyncWork();
      }
      if (this.isUnmounted || this.isHandedOff) {
        return;
      }
    } else if (this.renderers && this.options.stdout.isTTY && this.hasStaleTerminalSize()) {
      this.handleResize();
      if (this.isUnmounted || this.isHandedOff) {
        return;
      }
    }

    if (this.layout.failedLayouts > 0 || this.layout.layoutDamaged) {
      this.layout.runLayoutPass();
    }

    // Flush deferred interaction-time update before rendering so we call
    // Date.now() at most once per frame instead of once per keypress.
    // Done before the render to avoid dirtying state that would trigger
    // an extra React re-render cycle.
    this.options.onBeforeRender?.();

    // Screen reader plain-text frame write path
    if (this.isScreenReaderEnabled) {
      this.writeKeptForNextFrame();
      this.leftAltScreenSinceFrame = false;
      this.onRenderScreenReader();
      this.noteFrameWritten();
      this.unwritten = undefined;
      return;
    }

    if (this.layout.failedLayouts > 0) {
      return;
    }
    this.beginFrame();

    const renderStart = performance.now();
    const { columns: terminalWidth, rows: terminalRows } = this.stdoutSize();

    // densable: overlay sig before renderer. Gold:
    //   x=`${m?.row},${m?.col},${y?.row},${y?.col}|${query}|${g?.currentIdx},...`
    //   R=prevFrameContaminated||x!==prevOverlaySig
    //   M=m!==null&&y!==null&&!sqe||!!query||!!g
    const leftoverGsContaminated = this.prevFrameContaminated || this.overlays.changedSinceLastFrame();
    const leftoverGsOverlay = this.overlays.isActive();

    // densable: after overlay sig, before renderer — consume kitty dirty flag.
    // biome-ignore lint/complexity/noCommaOperator: gold imagesStale consume is comma-operator
    if (this.imagesStale) (this.imagesStale = false), this.terminalImages.retransmitAll();

    const tmuxHost = Jk();
    const tmuxPane = process.env.TMUX ? tmuxHost.tmuxPane : undefined;
    const isTmuxPassthrough = tmuxPane !== undefined && tmuxPane.passthrough !== 'off';
    this.terminalImages.isTmuxPassthrough = isTmuxPassthrough;

    // 2.1.326 #48: degrade gracefully on memory allocation failure (RangeError)
    // during screen allocation or rendering instead of crashing the session.
    const activeRenderers = this.options.stdout.isTTY ? this.renderers : undefined;
    let damagedDuringPaint = false;
    const frame = (() => {
      try {
        const painted = this.layout.paint(retrying, () => {
          const frame = this.renderer({
            frontFrame: this.frontFrame,
            backFrame: this.backFrame,
            isTTY: this.options.stdout.isTTY,
            terminalWidth,
            terminalRows,
            altScreen: this.altScreenActive,
            prevFrameContaminated: leftoverGsContaminated,
            overlayActive: leftoverGsOverlay,
            firstRow: activeRenderers
              ? contentHeight =>
                  this.altScreenActive
                    ? 0
                    : activeRenderers.covering.firstRow(this.shownOnMainScreen(), contentHeight, {
                        width: terminalWidth,
                        height: terminalRows,
                      })
              : undefined,
          });
          return frame;
        });
        if (painted === undefined) {
          damagedDuringPaint = true;
        }
        return painted;
      } catch (err) {
        if (err instanceof RangeError && !this.unwritten) {
          this.handleRenderAllocationFailure('renderer', err);
          return undefined;
        }
        throw err;
      }
    })();
    if (damagedDuringPaint) {
      return this.drawFrame(true);
    }
    if (frame === undefined) return;
    const rendererMs = performance.now() - renderStart;

    this.overlays.followScroll(frame.followScroll ?? null);
    const overlayPainted =
      this.altScreenActive && this.overlays.paint(frame.screen, this.pointer.hoverCol, this.pointer.hoverRow);
    const frameLayoutShifted = frame.layoutShifted === true;

    // densable: no height-0 / visually-empty early return here — LogUpdate
    // still receives the frame. (Local empty-skips after external 2J remount
    // left the physical alt buffer black until a later content frame.)
    if (activeRenderers) {
      let rendered: ReturnType<Ink['renderToBytes']> | undefined;
      try {
        rendered = this.renderToBytes(frame, terminalWidth, terminalRows, activeRenderers);
      } catch (err) {
        this.leaveNewRenderer(err instanceof Error ? err.message : String(err));
      }
      if (rendered !== undefined) {
        if (rendered.hasDiff) {
          this.maybeProactiveAtlasReset(rendered.patches);
        }
        const itermSeq = this.placeItermForFrame(
          frame,
          rendered.before,
          activeRenderers.inline.scrolledOutRows + activeRenderers.covering.countIn(frame) - (frame.top ?? 0),
          terminalWidth,
          terminalRows,
          tmuxHost,
          tmuxPane,
          isTmuxPassthrough,
        );
        if (itermSeq !== '') {
          rendered.patches.push({ type: 'stdout', content: itermSeq });
        }
        const pendingImages = this.terminalImages.drain();
        if (pendingImages !== '') {
          rendered.patches.unshift({ type: 'stdout', content: pendingImages });
        }
        const writeStart = performance.now();
        this.leftAltScreenSinceFrame = false;
        const kept = this.takeKeptForNextFrame();
        if (this.unwritten) {
          this.unwritten.beingWritten = kept + pendingImages;
        }
        const skipSync =
          this.skipSyncMarkers() ||
          (!rendered.mayTear && pendingImages === '' && itermSeq === '') ||
          (isTmuxPassthrough && (this.terminalImages.size > 0 || pendingImages !== ''));
        writeDiffToTerminal(this.terminal, rendered.patches, skipSync, terminalRows, kept);
        if (this.isFrameOwed || (this.unwritten?.isLost && !this.isRedrawingAtOnce)) {
          dom.stampFirstFrame(this.rootNode);
          this.takesInputFrom = this.pressClock() + INPUT_RECOVERY_HOLD_MS;
        }
        this.unwritten = undefined;
        this.isFrameOwed = false;
        activeRenderers.fullscreen.frameWasWritten();
        const writeMs = performance.now() - writeStart;
        this.maybeResetPools(renderStart);
        this.prevFrameContaminated = false;
        this.repaintAfterStaleAbsolutePaint(frame);
        if (frame.scrollDrainPending) {
          this.scheduler.scheduleExtraFrame();
        }
        const yc = this.layout.takeYogaCounters();
        const commitMs = this.rootNode.lastCommitMs ?? 0;
        this.rootNode.lastCommitMs = 0;
        this.rootNode.scrollCommitStartedAt = undefined;
        resetProfileCounters();
        if (rendered.hasDiff || frameLayoutShifted) this.followHover();
        this.tellFrameListeners();
        this.options.onFrame?.({
          durationMs: performance.now() - renderStart,
          flickers: rendered.flickers,
          phases: {
            renderer: rendererMs,
            diff: rendered.diffMs,
            optimize: 0,
            write: writeMs,
            patches: rendered.patches.length,
            yoga: yc.ms,
            commit: commitMs,
            yogaVisited: yc.visited,
            yogaMeasured: yc.measured,
            yogaCacheHits: yc.cacheHits,
            yogaLive: yc.live,
          },
        });
        return;
      }
    }

    if (
      frameLayoutShifted ||
      overlayPainted ||
      leftoverGsContaminated ||
      (this.altScreenFullRepaint && this.altScreenActive)
    ) {
      frame.screen.damage = {
        x: 0,
        y: 0,
        width: frame.screen.width,
        height: frame.screen.height,
      };
    }

    // Alt-screen: anchor the physical cursor to (0,0) before every diff.
    // All cursor moves in log-update are RELATIVE to prev.cursor; if tmux
    // (or any emulator) perturbs the physical cursor out-of-band (status
    // bar refresh, pane redraw, Cmd+K wipe), the relative moves drift and
    // content creeps up 1 row/frame. CSI H resets the physical cursor;
    // passing prev.cursor=(0,0) makes the diff compute from the same spot.
    // Self-healing against any external cursor manipulation. Main-screen
    // can't do this — cursor.y tracks scrollback rows CSI H can't reach.
    // The CSI H write is deferred until after the diff is computed so we
    // can skip it for empty diffs (no writes → physical cursor unused).
    // densable altScreenFullRepaint: replace prev.screen with a spacer
    // sentinel so every next cell differs and LogUpdate rewrites all
    // glyphs (ConPTY incremental-diff corruption on Windows FleetView).
    const behindAltErase = this.returnToMainScreen();

    let prevFrame = this.frontFrame;
    if (this.altScreenActive) {
      prevFrame = { ...this.frontFrame, cursor: ALT_SCREEN_ANCHOR_CURSOR };
      if (this.altScreenFullRepaint) {
        const { width, height } = this.frontFrame.screen;
        if (this.fullRepaintSentinelScreen?.width !== width || this.fullRepaintSentinelScreen?.height !== height) {
          this.fullRepaintSentinelScreen = createScreen(
            width,
            height,
            this.stylePool,
            this.charPool,
            this.hyperlinkPool,
          );
          fillFullRepaintSentinel(this.fullRepaintSentinelScreen);
        }
        prevFrame = { ...prevFrame, screen: this.fullRepaintSentinelScreen };
      }
    }

    const tDiff = performance.now();
    let diff: Diff;
    try {
      diff = this.log.render(prevFrame, frame, this.altScreenActive, this.decstbmSafe());
    } catch (err) {
      if (err instanceof RangeError && !this.unwritten) {
        this.handleRenderAllocationFailure('diff', err);
        return;
      }
      throw err;
    }
    const diffMs = performance.now() - tDiff;
    // Swap buffers
    this.backFrame = this.frontFrame;
    this.frontFrame = frame;

    this.maybeResetPools(renderStart);

    const flickers: FrameEvent['flickers'] = [];
    for (const patch of diff) {
      if (patch.type === 'clearTerminal') {
        flickers.push({
          desiredHeight: frame.screen.height,
          availableHeight: frame.viewport.height,
          reason: patch.reason,
        });
        if (isDebugRepaintsEnabled() && patch.debug) {
          const chain = dom.findOwnerChainAtRow(this.rootNode, patch.debug.triggerY);
          this.logger.debug(
            `[REPAINT] full reset · ${patch.reason} · row ${patch.debug.triggerY}\n` +
              `  prev: "${patch.debug.prevLine}"\n` +
              `  next: "${patch.debug.nextLine}"\n` +
              `  culprit: ${chain.length ? chain.join(' < ') : '(no owner chain captured)'}`,
            { level: 'warn' },
          );
        }
      }
    }

    const tOptimize = performance.now();
    const optimized = optimize(diff);
    const optimizeMs = performance.now() - tOptimize;
    const hasDiff = optimized.length > 0;
    // Periodic self-healing: for main-screen mode, emit ERASE_SCREEN + HOME
    // to clear the terminal before the diff. Alt-screen has its own CSI H
    // anchor + cursor park below. BSU/ESU wraps erase+paint atomically on
    // supported terminals (main-screen always uses sync markers).
    if (this.altScreenActive && hasDiff) {
      // Prepend CSI H to anchor the physical cursor to (0,0) so
      // log-update's relative moves compute from a known spot (self-healing
      // against out-of-band cursor drift, see the ALT_SCREEN_ANCHOR_CURSOR
      // comment above). Append CSI row;1 H to park the cursor at the bottom
      // row (where the prompt input is) — without this, the cursor ends
      // wherever the last diff write landed (a different row every frame),
      // making iTerm2's cursor guide flicker as it chases the cursor.
      // BSU/ESU protects content atomicity but iTerm2's guide tracks cursor
      // position independently. Parking at bottom (not 0,0) keeps the guide
      // where the user's attention is.
      //
      // After resize, prepend ERASE_SCREEN too. The diff only writes cells
      // that changed; cells where new=blank and prev-buffer=blank get skipped
      // — but the physical terminal still has stale content there (shorter
      // lines at new width leave old-width text tails visible). ERASE inside
      // BSU/ESU is atomic: old content stays visible until the whole
      // erase+paint lands, then swaps in one go. Writing ERASE_SCREEN
      // synchronously in handleResize would blank the screen for the ~80ms
      // render() takes.
      if (this.needsEraseBeforePaint) {
        this.needsEraseBeforePaint = false;
        optimized.unshift(
          isITerm2OrTmuxXtversion() && process.env.CLAUDE_BG_BACKEND !== 'daemon'
            ? { type: 'stdout', content: eraseViewportInPlace(terminalRows) }
            : ERASE_THEN_HOME_PATCH,
        );
      } else {
        optimized.unshift(CURSOR_HOME_PATCH);
      }
      optimized.push(this.altScreenParkPatch);
    }
    if (behindAltErase !== '') {
      optimized.unshift({ type: 'stdout', content: behindAltErase });
    }

    // Native cursor positioning: park the terminal cursor at the declared
    // position so IME preedit text renders inline and screen readers /
    // magnifiers can follow the input. nodeCache holds the absolute screen
    // rect populated by renderNodeToOutput this frame (including scrollTop
    // translation) — if the declared node didn't render (stale declaration
    // after remount, or scrolled out of view), it won't be in the cache
    // and no move is emitted.
    const decl = this.cursorDeclaration;
    const rect = decl !== null ? decl.node.cachedLayout : undefined;
    const rawTarget =
      decl !== null && rect !== undefined ? { x: rect.x + decl.relativeX, y: rect.y + decl.relativeY } : null;
    const didFullReset = diff.some(patch => patch.type === 'clearTerminal');
    // Main-screen viewport top row in frame coordinates. Parking the physical
    // cursor above viewportTop clamps at terminal row 0 while displayCursor
    // records the unclamped y — on the next frame the preamble moves DOWN by
    // (prevFrame.cursor.y - parked.y) from row 0, permanently overshooting
    // downward and ghosting/duplicating lines (e.g. Select options).
    const mainScreenViewportTop = this.altScreenActive
      ? 0
      : Math.max(
          this.log.scrolledOutRowsOf(frame) ?? 0,
          frame.cursor.y >= frame.screen.height && frame.screen.height >= frame.viewport.height
            ? frame.screen.height - frame.viewport.height + 1
            : 0,
        );
    const target =
      rawTarget !== null &&
      !this.altScreenActive &&
      (rawTarget.y < mainScreenViewportTop || rawTarget.y > frame.cursor.y)
        ? null
        : rawTarget;
    const parked = this.displayCursor;

    // Preserve the empty-diff zero-write fast path: skip all cursor writes
    // when nothing rendered AND the park target is unchanged.
    const targetMoved = target !== null && (parked === null || parked.x !== target.x || parked.y !== target.y);
    const nativeCursorWanted = Boolean(decl?.visible) || this.accessibilityMode;
    const nativeCursorFlip =
      Boolean(this.options.nativeCursor) &&
      target !== null &&
      decl !== null &&
      nativeCursorWanted !== this.nativeCursorVisible;
    if (hasDiff || targetMoved || nativeCursorFlip || (target === null && parked !== null)) {
      const maxVerticalMove = terminalRows - 1;
      const clampVerticalMove = (dy: number): number => Math.max(-maxVerticalMove, Math.min(maxVerticalMove, dy));
      // Main-screen preamble: log-update's relative moves assume the
      // physical cursor is at prevFrame.cursor. If last frame parked it
      // elsewhere, move back before the diff runs. Alt-screen's CSI H
      // (and full-reset clearTerminal) already resets cursor position.
      if (parked !== null && !this.altScreenActive && hasDiff && !didFullReset) {
        const pdx = prevFrame.cursor.x - parked.x;
        const pdy = clampVerticalMove(prevFrame.cursor.y - parked.y);
        if (pdx !== 0 || pdy !== 0) {
          optimized.unshift({ type: 'stdout', content: cursorMove(pdx, pdy) });
        }
      }

      if (target !== null) {
        if (this.altScreenActive) {
          // Absolute CUP (1-indexed); next frame's CSI H resets regardless.
          // Emitted after altScreenParkPatch so the declared position wins.
          const row = Math.min(Math.max(target.y + 1, 1), terminalRows);
          const col = Math.min(Math.max(target.x + 1, 1), terminalWidth);
          optimized.push({ type: 'stdout', content: cursorPosition(row, col) });
        } else {
          // After the diff (or preamble), cursor is at frame.cursor. If no
          // diff AND previously parked, it's still at the old park position
          // (log-update wrote nothing). Otherwise it's at frame.cursor.
          const from = !hasDiff && parked !== null ? parked : { x: frame.cursor.x, y: frame.cursor.y };
          const dx = target.x - from.x;
          const dy = clampVerticalMove(target.y - from.y);
          if (dx !== 0 || dy !== 0) {
            optimized.push({ type: 'stdout', content: cursorMove(dx, dy) });
          }
        }
        this.displayCursor = { ...target, emittedRows: terminalRows };
        if (this.options.nativeCursor || this.bgWorkerForceShowCursor) {
          const show = this.bgWorkerForceShowCursor || Boolean(decl?.visible) || this.accessibilityMode;
          if (this.nativeCursorVisible) {
            optimized.unshift({ type: 'cursorHide' });
          }
          if (show) {
            optimized.push({ type: 'cursorShow' });
          }
          this.nativeCursorVisible = show;
        }
      } else {
        // Declaration cleared (input blur, unmount). Restore physical cursor
        // to frame.cursor before forgetting the park position — otherwise
        // displayCursor=null lies about where the cursor is, and the NEXT
        // frame's preamble (or log-update's relative moves) computes from a
        // wrong spot. The preamble above handles hasDiff; this handles
        // !hasDiff (e.g. accessibility mode where blur doesn't change
        // renderedValue since invert is identity).
        if (parked !== null && !this.altScreenActive && !hasDiff) {
          const rdx = frame.cursor.x - parked.x;
          const rdy = clampVerticalMove(frame.cursor.y - parked.y);
          if (rdx !== 0 || rdy !== 0) {
            optimized.push({ type: 'stdout', content: cursorMove(rdx, rdy) });
          }
        }
        this.displayCursor = null;
        if (
          (this.options.nativeCursor || this.bgWorkerForceShowCursor) &&
          this.nativeCursorVisible &&
          !this.accessibilityMode
        ) {
          optimized.unshift({ type: 'cursorHide' });
          this.nativeCursorVisible = false;
        }
      }
    }

    // densable: if (hasDiff) this.maybeProactiveAtlasReset(S) before efs write
    if (hasDiff) {
      this.maybeProactiveAtlasReset(optimized);
    }
    // Official 2.1.305 (#1054) + 2.1.310 (#1206): emit iTerm2 inline images (OSC 1337)
    // with tmux DCS passthrough + pane-relative placement when inside tmux.
    const itermSeq = this.placeItermForFrame(
      frame,
      didFullReset ? undefined : prevFrame.screen,
      this.log.scrolledOutRowsOf(frame) ?? 0,
      terminalWidth,
      terminalRows,
      tmuxHost,
      tmuxPane,
      isTmuxPassthrough,
    );
    if (itermSeq !== '') {
      optimized.push({ type: 'stdout', content: itermSeq });
    }
    // densable: terminalImages.drain() prepended onto the patch list.
    const imageSeq = this.terminalImages.drain();
    if (imageSeq !== '') {
      optimized.unshift({ type: 'stdout', content: imageSeq });
    }

    const tWrite = performance.now();
    this.leftAltScreenSinceFrame = false;
    const kept = this.takeKeptForNextFrame();
    if (this.unwritten) {
      this.unwritten.beingWritten = kept + imageSeq;
    }
    // Official 2.1.327 (#452): skip BSU/ESU sync markers when tmux
    // allow-passthrough is enabled and passthrough images are active/draining,
    // so tmux and the outer kitty/Ghostty/iTerm2 terminal do not desync and
    // garble rows.
    const skipSync = this.skipSyncMarkers() || (isTmuxPassthrough && (this.terminalImages.size > 0 || imageSeq !== ''));
    // densable dyr(this.terminal,X,skipSyncMarkers(),f,this.takeKeptForNextFrame())
    writeDiffToTerminal(this.terminal, optimized, skipSync, terminalRows, kept);
    if (this.isFrameOwed || (this.unwritten?.isLost && !this.isRedrawingAtOnce)) {
      dom.stampFirstFrame(this.rootNode);
      this.takesInputFrom = this.pressClock() + INPUT_RECOVERY_HOLD_MS;
    }
    const writeMs = performance.now() - tWrite;
    this.unwritten = undefined;
    this.isFrameOwed = false;

    // densable: this.prevFrameContaminated=!1 then repaintAfterStaleAbsolutePaint.
    // Gold does not keep selActive/hlActive on the flag — F||L already full-damage
    // the current frame; next frame re-applies overlays.
    this.prevFrameContaminated = false;
    this.repaintAfterStaleAbsolutePaint(frame);

    // A ScrollBox has pendingScrollDelta left to drain — schedule the next
    // frame. MUST NOT call this.scheduleRender() here: queuePacedFrame already
    // ran this onRender from a microtask; re-entering scheduleFrame this tick
    // would either no-op (frameMicrotaskQueued) or queue another frame too soon.
    // Use a plain timeout. If a wheel event arrives first, its scheduleRender
    // path fires a render which clears this timer at the top of onRender.
    //
    // Drain frames stay on a short timer; regular frames go through scheduleFrame.
    if (frame.scrollDrainPending) {
      this.scheduler.scheduleExtraFrame();
    }

    const yc = this.layout.takeYogaCounters();
    const yogaMs = yc.ms;
    const commitMs = this.rootNode.lastCommitMs ?? getLastCommitMs();
    this.rootNode.lastCommitMs = 0;
    this.rootNode.scrollCommitStartedAt = undefined;
    // Reset so drain-only frames (no React commit) don't repeat stale values.
    resetProfileCounters();
    if (hasDiff || frameLayoutShifted) this.followHover();
    this.tellFrameListeners();
    this.options.onFrame?.({
      durationMs: performance.now() - renderStart,
      phases: {
        renderer: rendererMs,
        diff: diffMs,
        optimize: optimizeMs,
        write: writeMs,
        patches: diff.length,
        yoga: yogaMs,
        commit: commitMs,
        yogaVisited: yc.visited,
        yogaMeasured: yc.measured,
        yogaCacheHits: yc.cacheHits,
        yogaLive: yc.live,
        // Official: ...liveCountsEnabled && shouldSampleLiveCounts() && {domLive, fiberLive}
        ...(this.liveCountsEnabled && this.shouldSampleLiveCounts()
          ? {
              domLive: countLiveDomNodes(this.rootNode),
              fiberLive: countLiveFibers((this.container as unknown as { current?: FiberLike | null }).current),
            }
          : {}),
      },
      flickers,
    });
  }

  private placeItermForFrame(
    frame: Frame,
    prevScreen: Screen | undefined,
    scrolledOutRows: number,
    terminalWidth: number,
    terminalRows: number,
    tmuxHost: ReturnType<typeof Jk>,
    tmuxPane: ReturnType<typeof Jk>['tmuxPane'],
    isTmuxPassthrough: boolean,
  ): string {
    const allowDraw = isTmuxPaneFresh(isTmuxPassthrough, tmuxHost.tmuxPaneAnsweredAt, performance.now());
    return this.terminalImages.placeIterm(
      frame.screen,
      prevScreen,
      this.altScreenActive
        ? altScreenMoveTo(terminalWidth, terminalRows)
        : mainScreenMoveTo(frame, this.displayCursor ?? frame.cursor, terminalRows, scrolledOutRows),
      isTmuxPassthrough && tmuxPane
        ? tmuxPaneMoveTo(
            tmuxPane,
            this.altScreenActive && tmuxPane.isPlaced && !tmuxHost.isTmuxPaneAsked,
            terminalWidth,
            terminalRows,
          )
        : undefined,
      allowDraw,
    );
  }

  /**
   * Official shouldSampleLiveCounts — at most once per LIVE_COUNTS_INTERVAL_MS.
   */
  private shouldSampleLiveCounts(): boolean {
    const now = performance.now();
    if (now - this.lastLiveCountSampleAt < LIVE_COUNTS_INTERVAL_MS) {
      return false;
    }
    this.lastLiveCountSampleAt = now;
    return true;
  }

  /**
   * Official onRenderScreenReader — plain-text frame write path for
   * INK_SCREEN_READER / isScreenReaderEnabled.
   *
   * densable 2.1.217: while Xqc()>0 and not exiting, schedule one timer and
   * skip paint so the startup SR announcement is not cut off.
   *
   * Extract DOM text (o1r) → hard-wrap lines → plan diff → s3n/i3n/MHe ANSI
   * → stdout.write; park cursor at declared caret.
   */
  onRenderScreenReader(): void {
    // densable: if (!this.isExiting) { let x=Xqc(); if(x>0){ schedule qXn+onRender; return } }
    if (!this.isExiting) {
      const remainingMs = getScreenReaderStartupQuietRemainingMs();
      if (remainingMs > 0) {
        if (this.srStartupQuietTimer === null) {
          this.srStartupQuietTimer = setTimeout(() => {
            this.srStartupQuietTimer = null;
            endScreenReaderStartupQuiet();
            this.onRender();
          }, remainingMs);
        }
        return;
      }
    }

    // densable: pending pre-park / announcement-hold skip the rest of the
    // SR paint unless unmount is flushing (`isExiting`).
    if (this.srPreParkTimer !== null) {
      if (!this.isExiting) return;
      clearTimeout(this.srPreParkTimer);
      this.srPreParkTimer = null;
    }
    if (this.srAnnouncementHoldTimer !== null) {
      if (isScreenReaderHoldActive() && !this.isExiting) return;
      clearTimeout(this.srAnnouncementHoldTimer);
      this.srAnnouncementHoldTimer = null;
    }

    // densable xYr: text + preserveRanges (aria-preserve-whitespace)
    const extracted = extractScreenReaderOutput(this.rootNode as ScreenReaderDOMNode);
    const n = extracted.text;
    const u = extracted.preserveRanges;
    const f = extracted.rowPrefixRanges;
    const { columns: m } = this.stdoutSize();
    // Gold wrap BODY inline in onRenderScreenReader (not materializeScreenReaderLines).
    const y = mergePreserveRanges(u);
    const g = n === '' ? [] : n.split('\n');
    const x: string[] = [];
    const R: number[] = [];
    let M = 0;
    for (const se of g) {
      const ue = M + se.length;
      const Te = M + se.trimEnd().length < ue && y.some(([Ve, st]) => Ve < ue && ue <= st);
      const Ne = f.find(([Ve, st]) => (se === '' ? Ve <= M && M <= st : Ve < ue && M < st))?.[2] ?? '';
      const Ie = m - Ko(Ne) >= 2 ? Ne : '';
      const tt = Ie.trimEnd();
      R.push(x.length);
      if (se === '') {
        x.push(tt);
      } else {
        const Ve =
          Ne === '' || m < 2 ? wrapAnsi(se, m, { trim: false, hard: true }).split('\n') : hv(r7(se), m - Ko(Ie));
        for (let st = 0; st < Ve.length; st++) {
          const Rt = Ve[st]!;
          const yt = Te && st === Ve.length - 1 ? Rt : Rt.trimEnd();
          x.push(yt === '' ? tt : Ie + yt);
        }
      }
      M = ue + 1;
    }
    const originalFullText = n;
    // densable `T=this.computeScreenReaderPark(n,R,x,m)` before announcements.
    const declaredPark = this.computeScreenReaderPark(n, R, x, m);
    const drained = drainScreenReaderAnnouncements()
      .map(text => sanitizeScreenReaderText(text))
      .filter(text => text !== '');
    if (drained.length > 0 || this.isExiting) {
      this.srHeldAnnouncements = drained;
    }
    const F = x.length;
    let N = -1;
    for (const se of this.srHeldAnnouncements) {
      for (const ue of se.split('\n')) {
        if (N === -1 && drained.length > 0) {
          N = x.length;
        }
        if (ue === '') {
          x.push('');
        } else {
          const ye = wrapAnsi(ue, m, { trim: false, hard: true });
          for (const Te of ye.split('\n')) {
            x.push(Te.trimEnd());
          }
        }
      }
    }
    // densable `L=WXo(),I=wv(this.rootNode)` — consume hold before skip / `$to`.
    const holdMs = takeScreenReaderAnnouncementHoldMs();
    const cut = this.rootNode.transcriptFrontCutRows ?? null;
    this.rootNode.transcriptFrontCutRows = undefined;
    if (cut !== null) {
      this.applyTranscriptFrontCut(cut, originalFullText, R, x);
    }
    const extra = x.length - F;
    const tooBig = extra > Math.min(Ink.SR_HELD_ANNOUNCEMENT_MAX_EXTRA, Math.floor(this.terminalRows / 4));
    if (tooBig) this.srHeldAnnouncements = [];
    const prev = this.prevScreenReaderLines;
    if (
      drained.length === 0 &&
      extra > 0 &&
      (tooBig ||
        (!this.srRewriteHeldAnnouncement &&
          (prev.length !== x.length || x.some((se, ue) => ue < F && se !== prev[ue]))))
    ) {
      this.srHeldAnnouncements = [];
      x.length = F;
    }

    // Gold onRenderScreenReader BODY: inline K / J / N.
    const B = this.prevScreenReaderLines;
    const W = Math.max(0, x.length - 1);
    const q = declaredPark ?? { row: W, col: stringWidth(x[W] ?? '') };
    let K = 0;
    const X = Math.min(B.length, x.length);
    while (K < X && B[K] === x[K]) K++;
    if (N !== -1 && K > N) K = N;
    const J = K === B.length && K === x.length;
    const ie = this.prevScreenReaderPark;
    const le = q.row === ie.row && q.col === ie.col;
    if (J && le) {
      if (this.srPreParked) {
        this.srPreParked = false;
        this.options.stdout.write(cursorTo(q.col + 1));
      }
      this.prevScreenReaderParkDeclared = declaredPark !== null;
      return;
    }
    if (
      !J &&
      N === -1 &&
      !this.srPreParked &&
      (this.prevScreenReaderAnchor === 'clean' ||
        (this.prevScreenReaderAnchor === 'lastRowAnchored' && K === B.length - 1 && ie.row === K && q.row === K)) &&
      B.length === x.length &&
      K >= B.length - this.terminalRows &&
      ie.row >= B.length - this.terminalRows &&
      (x[K] ?? '').startsWith(B[K] ?? '') &&
      !(x[K] ?? '').includes('\t')
    ) {
      let se = true;
      for (let Ne = K + 1; Ne < B.length; Ne++) {
        if (B[Ne] !== x[Ne]) {
          se = false;
          break;
        }
      }
      const ue = se ? (x[K] ?? '').slice((B[K] ?? '').length) : '';
      const ye = ue === '' ? 0 : stringWidth(B[K] ?? '');
      if (
        ue !== '' &&
        stringWidth(String.fromCodePoint(ue.codePointAt(0)!)) > 0 &&
        ye + stringWidth(ue) === stringWidth(x[K] ?? '') &&
        Iv(x[K] ?? '', (B[K] ?? '').length)
      ) {
        const Ne = (K !== ie.row ? ZY(0, K - ie.row) : '') + cursorTo(ye + 1);
        const Ie = cursorTo(q.col + 1) + (q.row !== K ? ZY(0, q.row - K) : '');
        this.writeContent(Ne + ue + Ie);
        this.prevScreenReaderLines = x;
        this.prevScreenReaderPark = q;
        this.prevScreenReaderParkDeclared = declaredPark !== null;
        return;
      }
    }
    if (
      !J &&
      N === -1 &&
      !this.srPreParked &&
      (this.prevScreenReaderAnchor === 'clean' ||
        (this.prevScreenReaderAnchor === 'lastRowAnchored' && K === B.length - 1 && ie.row === K && q.row === K)) &&
      B.length === x.length &&
      K >= B.length - this.terminalRows &&
      (B[K] ?? '').startsWith(x[K] ?? '') &&
      !(B[K] ?? '').includes('\t')
    ) {
      let se = true;
      for (let Ne = K + 1; Ne < B.length; Ne++) {
        if (B[Ne] !== x[Ne]) {
          se = false;
          break;
        }
      }
      const ue = se ? (B[K] ?? '').slice((x[K] ?? '').length) : '';
      const ye = ue === '' ? 0 : stringWidth(x[K] ?? '');
      if (
        ue !== '' &&
        stringWidth(String.fromCodePoint(ue.codePointAt(0)!)) > 0 &&
        ye + stringWidth(ue) === stringWidth(B[K] ?? '') &&
        Iv(B[K] ?? '', (x[K] ?? '').length) &&
        (!/\s/.test(ue) || /^\s+$/.test(ue)) &&
        declaredPark !== null &&
        this.prevScreenReaderParkDeclared &&
        ie.row === K &&
        ie.col === stringWidth(B[K] ?? '')
      ) {
        const Ne = cursorTo(ye + 1);
        const Ie = cursorTo(q.col + 1) + (q.row !== K ? ZY(0, q.row - K) : '');
        this.writeContent(Ne + csi('K') + Ie);
        this.prevScreenReaderLines = x;
        this.prevScreenReaderPark = q;
        this.prevScreenReaderParkDeclared = declaredPark !== null;
        return;
      }
    }
    if (!this.isExiting && !J && K < x.length && N === -1 && !this.srPreParked) {
      const se = getScreenReaderPreparkMs();
      if (se > 0) {
        this.options.stdout.write(csi('G'));
        this.srPreParked = true;
        this.srPreParkTimer = setTimeout(() => {
          this.srPreParkTimer = null;
          this.onRender();
        }, se);
        return;
      }
    }
    const ne = Math.max(0, B.length - 1);
    const he = ie.row !== ne ? ZY(0, ne - ie.row) : '';
    const ce = B.length - this.terminalRows;
    if (ce > K && ce < x.length) {
      let se = K;
      let ue = K;
      while (ue < ce) {
        if (x[ue] === '') {
          ue++;
          continue;
        }
        while (se < ce && B[se] === '') se++;
        if (se === ce || B[se] !== x[ue]) break;
        se++;
        ue++;
      }
      if (ue === ce) K = ce;
    }
    const Ee = K === x.length && K > 0;
    const Ae = ce > K || (Ee && ce === K);
    const pe = evt(Math.min(B.length - K, this.terminalRows));
    const fe = x.slice(K).join('\n');
    let xe: string;
    if (J) xe = '';
    else if (K === B.length) xe = K > 0 ? `\n${fe}` : fe;
    else if (K === x.length) xe = K > 0 && !Ae ? pe + ZY(0, -1) : pe;
    else xe = pe + fe;
    const Ce = cursorTo(q.col + 1) + (q.row !== W ? ZY(0, q.row - W) : '');
    this.writeContent(he + xe + Ce);
    if (N !== -1 && holdMs > 0 && !this.isExiting) {
      startScreenReaderHold(performance.now() + holdMs);
      this.srAnnouncementHoldTimer = setTimeout(() => {
        this.srAnnouncementHoldTimer = null;
        this.onRender();
      }, holdMs);
    }
    this.prevScreenReaderLines = x;
    this.prevScreenReaderPark = q;
    this.prevScreenReaderParkDeclared = declaredPark !== null;
    this.srPreParked = false;
    if (!J) {
      const se = x.length - K;
      const ue = q.row === x.length - 1;
      const ye = x.length < B.length;
      const Te = B.length <= this.terminalRows;
      if (Ae && se < this.terminalRows) this.prevScreenReaderAnchor = 'broken';
      else if (se >= Math.min(x.length, this.terminalRows)) this.prevScreenReaderAnchor = 'clean';
      else if (se > 0) {
        if (this.prevScreenReaderAnchor === 'broken') this.prevScreenReaderAnchor = ue ? 'lastRowAnchored' : 'broken';
        else if (this.prevScreenReaderAnchor === 'lastRowAnchored') {
          if (!ue) this.prevScreenReaderAnchor = 'broken';
        } else if (ye && !Te) this.prevScreenReaderAnchor = ue ? 'lastRowAnchored' : 'broken';
      } else if (this.prevScreenReaderAnchor === 'lastRowAnchored') this.prevScreenReaderAnchor = 'broken';
      else if (ye && this.prevScreenReaderAnchor === 'clean' && !Te) {
        this.prevScreenReaderAnchor = ue ? 'lastRowAnchored' : 'broken';
      }
    } else if (
      this.prevScreenReaderAnchor === 'lastRowAnchored' &&
      (ie.row !== Math.max(0, B.length - 1) || q.row !== W)
    ) {
      this.prevScreenReaderAnchor = 'broken';
    }
  }

  /**
   * Official computeScreenReaderPark method form — gold
   * `computeScreenReaderPark(n,u,f,m)` on Ink.
   */
  computeScreenReaderPark(
    fullText: string,
    lineBaseRows: readonly number[],
    lines: readonly string[],
    columns: number,
  ): ScreenReaderPark | null {
    const decl = this.cursorDeclaration;
    if (decl === null) return null;
    const nodeStart = findScreenReaderNodeStartIndex(
      this.rootNode as ScreenReaderDOMNode,
      decl.node as ScreenReaderDOMNode,
    );
    if (nodeStart === null) return null;
    return computeScreenReaderPark(
      fullText,
      lineBaseRows,
      lines.length,
      columns,
      {
        nodeStartIndex: nodeStart,
        relativeX: decl.relativeX,
        relativeY: decl.relativeY,
      },
      stringWidth,
    );
  }

  pause(): void {
    // Flush pending React updates and render before pausing.
    reconciler.flushSyncFromReconciler();
    this.onRender();
    this.finishWrites();

    this.isPaused = true;
  }

  /** Prevent unmount from disabling raw mode (caller will take over stdin). */
  handoffRawMode(): void {
    this._handoffRawMode = true;
  }

  get isHandoffRawMode(): boolean {
    return this._handoffRawMode;
  }

  private _handoffRawMode = false;

  /** Prevent unmount from exiting alt screen (caller will reuse it). */
  handoffAltScreen(): void {
    this.isPaused = true;
    this.altScreenActive = false;
    this.endPointerCapture();
    this.tellClickedNowhere();
    this.modes.reset('altScreen');
    this.modes.reset('surface');
  }

  resume(): void {
    this.isPaused = false;
    dom.stampFirstFrame(this.rootNode);
    this.onRender();
  }

  /**
   * Reset frame buffers so the next render writes the full screen from scratch.
   * Call this before resume() when the terminal content has been corrupted by
   * an external process (e.g. tmux, shell, full-screen TUI).
   */
  repaint(): void {
    this.renderers?.fullscreen.invalidate();
    this.mainScreenBehindAlt = undefined;
    this.frontFrame = emptyFrame(
      this.frontFrame.viewport.height,
      this.frontFrame.viewport.width,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool,
    );
    this.backFrame = emptyFrame(
      this.backFrame.viewport.height,
      this.backFrame.viewport.width,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool,
    );
    this.log.reset();
    this.renderers?.inline.reset();
    // Physical cursor position is unknown after external terminal corruption.
    // Clear displayCursor so the cursor preamble doesn't emit a stale
    // relative move from where we last parked it.
    this.displayCursor = null;
    // densable: this.prevFrameContaminated=!0 — emptyFrame is 0×0; next
    // paint must full-render, not blit from the discarded prev screen.
    this.prevFrameContaminated = true;
    // Official repaint also resets screen-reader diff state
    this.resetScreenReaderDiffState();
    this.imagesStale = true;
  }

  /**
   * Official 2.1.328 `shownOnMainScreen()` (@419520) — returns the currently
   * displayed main-screen frame preserving `frontFrame.viewport` (never
   * overwriting it with the new size) and merging `displayCursor`.
   */
  private shownOnMainScreen(): RenderTargetFrame {
    const { frontFrame, displayCursor } = this;
    return {
      screen: frontFrame.screen,
      top: frontFrame.top ?? 0,
      viewport: frontFrame.viewport,
      cursor: displayCursor ? { ...frontFrame.cursor, x: displayCursor.x, y: displayCursor.y } : frontFrame.cursor,
    };
  }

  private getRenderCaps(): TerminalRenderCapabilities {
    return getTerminalRenderCapabilities({
      synchronizedOutput: this.decstbmSafe(),
      repaintsEveryCell: this.altScreenFullRepaint && this.altScreenActive,
      clearSavesToScrollback: isITerm2OrTmuxXtversion() && process.env.CLAUDE_BG_BACKEND !== 'daemon',
      printsUnknownSequences: printsUnknownSequences(),
    });
  }

  /**
   * Official 2.1.328 `uncover()` (@419600) — reveal rows hidden behind a
   * covering popover before alt-screen entry, cursor parking, or unmount.
   */
  private uncover(): string {
    if (!this.renderers || this.altScreenActive || this.unwritten?.beingWritten !== undefined) {
      return '';
    }
    const { encoder, inline, covering } = this.renderers;
    const caps = this.getRenderCaps();
    for (let attempt = 0; attempt < 2; attempt++) {
      inline.frameBegins();
      covering.frameBegins();
      try {
        encoder.isCursorVisible = this.nativeCursorVisible;
        const bytes = covering.uncover(this.shownOnMainScreen(), caps);
        this.nativeCursorVisible = encoder.isCursorVisible;
        return bytes;
      } catch (err) {
        inline.frameWasLost();
        covering.frameWasLost();
        this.logger.error(err);
      }
    }
    return '';
  }

  /** Official 2.1.328 `returnToMainScreen()` — consume `mainScreenBehindAlt` erase sequence. */
  private returnToMainScreen(): string {
    const behind = this.mainScreenBehindAlt;
    if (this.altScreenActive || behind === undefined) return '';
    this.mainScreenBehindAlt = undefined;
    this.frontFrame = emptyFrame(
      behind.viewport.height,
      behind.viewport.width,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool,
    );
    return behind.erase;
  }

  /** Official 2.1.328 `rowsAboveScreenOf(frame)` — rows above the active inline slice. */
  private rowsAboveScreenOf(frame: Frame): number {
    return (frame.top ?? 0) - (this.renderers?.covering.countIn(frame) ?? 0);
  }

  /**
   * Official 2.1.328 `leaveNewRenderer(reason)` (@425801) — disable the new
   * byte renderer, inflate `frontFrame` height and cursor Y by top-sliced rows
   * so `LogUpdate` stays vertically aligned, and force redraw when required.
   */
  leaveNewRenderer(reason: string): boolean {
    const above = this.rowsAboveScreenOf(this.frontFrame);
    if (above * this.terminalColumns >= MAX_INLINE_LEAVE_CELLS) {
      return false;
    }
    let nextFront = this.frontFrame;
    if (above !== 0) {
      const { screen, cursor, viewport } = nextFront;
      try {
        nextFront = {
          viewport,
          screen: createScreen(
            screen.width,
            Math.max(0, above + screen.height),
            this.stylePool,
            this.charPool,
            this.hyperlinkPool,
          ),
          cursor: { ...cursor, y: Math.max(0, above + cursor.y) },
        };
      } catch (err) {
        this.logger.debug(`No memory for the old renderer: ${String(err)}`, { level: 'warn' });
        return false;
      }
    }
    this.logger.debug(`Back to the old renderer: ${reason}`, { level: 'warn' });
    const needsFullRedraw =
      reason === 'cursor_misplaced' ||
      reason === 'widths_differ' ||
      this.altScreenActive ||
      Boolean(this.unwritten) ||
      frameFillsViewport(this.frontFrame);
    this.renderers = undefined;
    this.rootNode.popovers = undefined;
    this.frontFrame = nextFront;
    if (this.unwritten) {
      this.unwritten.wasContaminated = true;
    }
    if (this.displayCursor) {
      this.displayCursor = { ...this.displayCursor, y: Math.max(0, above + this.displayCursor.y) };
    }
    this.log.reset();
    this.prevFrameContaminated = true;
    if (needsFullRedraw) {
      this.log.forceFullReset();
      this.forceRedraw();
    }
    return true;
  }

  /**
   * Back-compat alias for `leaveNewRenderer(reason)` — always disables
   * `this.renderers` and clears `rootNode.popovers`.
   */
  fallbackToOldRenderer(reason: string): void {
    if (!this.leaveNewRenderer(reason)) {
      this.renderers = undefined;
      this.rootNode.popovers = undefined;
      this.log.reset();
      this.log.forceFullReset();
      this.prevFrameContaminated = true;
    }
  }

  /**
   * Official 2.1.328 `renderToBytes(frame, width, height, renderers)` — encodes
   * a rendered frame via `FullscreenRenderer` (alt-screen) or `CoveringRenderer`
   * (main-screen), swapping `frontFrame` / `backFrame` and updating `displayCursor`.
   */
  private renderToBytes(
    frame: Frame,
    width: number,
    height: number,
    renderers: NewRendererBundle,
  ): {
    patches: Diff;
    hasDiff: boolean;
    before: Screen | undefined;
    mayTear: boolean;
    flickers: FrameEvent['flickers'];
    diffMs: number;
  } {
    const start = performance.now();
    const decl = this.cursorDeclaration;
    const declRect = decl?.node.cachedLayout;
    const top = frame.top ?? 0;
    const declaredPos =
      decl && declRect ? { x: declRect.x + decl.relativeX, y: declRect.y + decl.relativeY - top } : null;
    renderers.encoder.isCursorVisible = this.nativeCursorVisible;
    const popover = this.terminalImages.hasItermImages ? undefined : collectPopoverBounds(this.rootNode, top);
    const target = frameToRenderTarget(
      frame,
      { width, height },
      {
        ...(declaredPos ?? frame.cursor),
        visible:
          this.accessibilityMode ||
          (declaredPos !== null &&
            (this.bgWorkerForceShowCursor || (Boolean(this.options.nativeCursor) && Boolean(decl?.visible)))),
        staysVisible: this.accessibilityMode,
      },
      popover,
    );
    const caps = this.getRenderCaps();
    const prefixBytes = this.returnToMainScreen();
    const res = this.altScreenActive
      ? renderers.fullscreen.render(target, caps)
      : renderers.covering.render(this.shownOnMainScreen(), target, caps, prefixBytes);
    if (isDebugRepaintsEnabled() && res.changedRow !== undefined) {
      const chain = dom.findOwnerChainAtRow(this.rootNode, res.changedRow);
      this.logger.debug(`[REPAINT] full reset · row ${res.changedRow} · culprit: ${chain.join(' < ')}`, {
        level: 'warn',
      });
    }
    this.nativeCursorVisible = renderers.encoder.isCursorVisible;
    this.displayCursor = declaredPos ? { ...declaredPos, emittedRows: height } : null;
    this.backFrame = this.frontFrame;
    this.frontFrame = frame;
    return {
      patches: res.bytes === '' ? [] : [{ type: 'stdout', content: res.bytes }],
      hasDiff: res.hasChanges,
      before: this.terminalImages.hasItermImages ? renderers.rows.withoutWrittenCells(frame.screen) : undefined,
      mayTear: res.mayTear,
      flickers: res.cleared
        ? [{ desiredHeight: top + frame.screen.height, availableHeight: height, reason: res.cleared }]
        : [],
      diffMs: performance.now() - start,
    };
  }

  /**
   * Clear the physical terminal and force a full redraw.
   *
   * densable forceRedraw(e?: {flushReact?: boolean}):
   * - optional flushReact syncs reconciler before paint
   * - xterm.js: emitAtlasReset (OSC 104) before repaint
   * - alt: needsErase + resetFrames; main: forceFullReset + contaminated
   * - always resetScreenReaderDiffState + onRender
   *
   * Recovery path when the terminal was cleared externally (Cmd+K, app-switch
   * buffer wipe) and the diff engine thinks unchanged cells need no paint.
   */
  forceRedraw(opts?: { flushReact?: boolean }): boolean {
    if (!this.options.stdout.isTTY || this.isUnmounted || this.isHandedOff) return false;
    if (opts?.flushReact) {
      reconciler.flushSyncWork();
    }
    // densable: if (zv()) this.emitAtlasReset()
    if (isXtermJs()) {
      this.emitAtlasReset();
    }
    if (this.hasStaleTerminalSize()) {
      this.renderers?.inline.invalidate();
      this.handleResize();
      if (this.unwritten?.isLost) {
        this.renderers?.inline.invalidate();
        return false;
      }
      return true;
    }
    this.forgetWhatIsShown();
    this.onRender();
    return !this.unwritten?.isLost;
  }

  private forgetWhatIsShown(): void {
    if (this.altScreenActive) {
      this.needsEraseBeforePaint = true;
      this.displayCursor = null;
      this.resetFramesForAltScreen();
      this.renderers?.fullscreen.invalidate('clear');
      this.imagesStale = true;
    } else {
      this.log.forceFullReset();
      this.renderers?.inline.invalidate();
      this.prevFrameContaminated = true;
      this.imagesStale = true;
    }
    this.resetScreenReaderDiffState();
  }

  /**
   * densable emitAtlasReset — OSC 104;255 (reset color 255 / atlas).
   * xterm.js hosts accumulate color atlas entries; resetting on focus/redraw
   * prevents stale palette mapping after external buffer wipe.
   * densable: write LWu (or unshift into patch list), Lor(), lastAtlasResetAt=now.
   */
  /**
   * densable emitAtlasReset — write LWu (or unshift), Lor(), lastAtlasResetAt.
   * densable does NOT call Wds here; callers that need telemetry call
   * recordAtlasReset after (delta/focus only — forceRedraw does not).
   */
  emitAtlasReset(patches?: Diff): void {
    const seq = ATLAS_RESET_OSC;
    if (patches) {
      patches.unshift({ type: 'stdout', content: seq });
    } else {
      this.options.stdout.write(seq);
    }
    clearAtlasKeys();
    this.lastAtlasResetAt = performance.now();
  }

  /**
   * densable maybeProactiveAtlasReset(S) — after a non-empty frame diff,
   * if atlasKeys ≥ 2000 and cooldown elapsed (or throttle bypassed),
   * prepend OSC 104 to the same patch list before write.
   * Gates: Por && !Uds && atlasKeys≥tiy && (R2u || cooldown) && zv().
   */
  maybeProactiveAtlasReset(patches: Diff): void {
    if (!isAtlasResetEnabled()) return;
    if (isAtlasResetSuppressed()) return;
    if (getAtlasKeyStats().atlasKeys < ATLAS_KEY_THRESHOLD) return;
    if (!isAtlasResetThrottleBypassed() && performance.now() - this.lastAtlasResetAt < ATLAS_RESET_COOLDOWN_MS) {
      return;
    }
    if (!isXtermJs()) return;
    this.emitAtlasReset(patches);
    recordAtlasReset('delta');
  }

  /**
   * densable proactiveAtlasResetOnFocus — FOCUS_IN after blurred.
   * densable: Por() && !Uds() && TTY && !unmounted && !paused && zv().
   */
  proactiveAtlasResetOnFocus(): void {
    if (
      !isAtlasResetEnabled() ||
      isAtlasResetSuppressed() ||
      !this.options.stdout.isTTY ||
      this.isUnmounted ||
      this.isPaused ||
      !isXtermJs()
    ) {
      return;
    }
    this.emitAtlasReset();
    recordAtlasReset('focus');
  }

  /**
   * densable `stdoutSize()` — `dCi(..., "fallback", warnGarbageWinsizeOnce)`.
   */
  stdoutSize(): { columns: number; rows: number } {
    return {
      columns: sanitizeTerminalDimension(
        this.options.stdout.columns,
        this.terminalColumns,
        MAX_TERMINAL_COLUMNS,
        'fallback',
        this.warnGarbageWinsizeOnce,
      ),
      rows: sanitizeTerminalDimension(
        this.options.stdout.rows,
        this.terminalRows,
        MAX_TERMINAL_ROWS,
        'fallback',
        this.warnGarbageWinsizeOnce,
      ),
    };
  }

  /** densable warnGarbageWinsizeOnce — first garbage/absurd winsize only. */
  warnGarbageWinsizeOnce = (message: string): void => {
    if (this.loggedGarbageWinsize) return;
    this.loggedGarbageWinsize = true;
    this.logger.debug(message, { level: 'warn' });
  };

  /**
   * densable probeExternalClear(querier) — iTerm.app / Apple_Terminal only
   * (caller gates). 1-based clamp: `min(max(y+1,1), rows, emittedRows)`.
   * When rows===1 the clamp is always ≤1 so 1-row nvim never wipe-redraws.
   */
  async probeExternalClear(querier: TerminalQuerier): Promise<boolean> {
    if (!this.altScreenActive || this.isPaused || this.isUnmounted) return false;
    const sent = this.displayCursor;
    if (!sent) return false;
    const rowOf = (cursor: { y: number; emittedRows: number }): number =>
      Math.min(Math.max(cursor.y + 1, 1), this.stdoutSize().rows, cursor.emittedRows);
    if (rowOf(sent) <= 1) return false;
    const pos = await querier.send(cursorPositionQuery());
    if (pos?.row !== 1) return false;
    const parked = this.displayCursor;
    if (parked === null || rowOf(parked) <= 1) return false;
    this.logger.debug(
      `probeExternalClear: detected wipe (parked at y=${parked.y}, sent at y=${sent.y}, terminal reports row=1 col=${pos.col})`,
      { level: 'warn' },
    );
    this.forceRedraw();
    return true;
  }

  private hasStaleTerminalSize(): boolean {
    const { columns, rows } = this.stdoutSize();
    return columns !== this.terminalColumns || rows !== this.terminalRows;
  }

  /**
   * Mark the previous frame as untrustworthy for blit, forcing the next
   * render to do a full-damage diff instead of the per-node fast path.
   *
   * Lighter than forceRedraw() — no screen clear, no extra write. Call
   * from a useLayoutEffect cleanup when unmounting a tall overlay: the
   * blit fast path can copy stale cells from the overlay frame into rows
   * the shrunken layout no longer reaches, leaving a ghost title/divider.
   * onRender resets the flag at frame end so it's one-shot.
   */
  invalidatePrevFrame(): void {
    this.prevFrameContaminated = true;
  }

  /**
   * Full-damage repaint without erasing the alt buffer.
   *
   * Hosts may wipe the alt buffer while we are backgrounded without
   * DECXCPR row=1 (probe only on iTerm/Apple). densable still avoids
   * forceRedraw on focus (erase → black screen risk); this only dirties
   * the prev frame and paints immediately.
   *
   * Throttled: FOCUS_IN thrash / double-delivery must not spin full paints.
   * Callers: every FOCUS_IN, and stdin-gap reassert (focus events often drop).
   */
  private lastSoftRepaintAt = 0;
  repaintAfterFocus(): void {
    if (!this.options.stdout.isTTY || this.isUnmounted || this.isPaused) {
      return;
    }
    const now = performance.now();
    // 80ms ≈ one frame budget; coalesces burst FOCUS_IN without delaying recovery
    if (now - this.lastSoftRepaintAt < 80) {
      this.prevFrameContaminated = true;
      return;
    }
    this.lastSoftRepaintAt = now;
    this.prevFrameContaminated = true;
    this.onRender();
  }

  /**
   * Called by the <AlternateScreen> component on mount/unmount.
   * Controls cursor.y clamping in the renderer and gates alt-screen-aware
   * behavior in SIGCONT/resize/unmount handlers. Repaints on change so
   * the first alt-screen frame (and first main-screen frame on exit) is
   * a full redraw with no stale diff state.
   */
  /**
   * densable ensureInteractive — lazy-attach resize/SIGCONT, hide cursor when
   * not in accessibilityMode. densable: if(this.unsubscribeTTYHandlers||!TTY)return;
   * if(!accessibilityMode)stdout.write(op); attach; store unsubscribe.
   * Also wired as App onRawModeEnter.
   */
  ensureInteractive = (): void => {
    if (this.unsubscribeTTYHandlers || !this.options.stdout.isTTY) {
      return;
    }
    if (!this.accessibilityMode && !this.isScreenReaderEnabled) {
      this.writeAfterKept(HIDE_CURSOR);
    }
    this.options.stdout.on('resize', this.handleResize);
    process.on('SIGCONT', this.handleResume);
    process.on('SIGWINCH', this.handleWinch);
    this.unsubscribeTTYHandlers = () => {
      this.options.stdout.off('resize', this.handleResize);
      process.off('SIGCONT', this.handleResume);
      process.off('SIGWINCH', this.handleWinch);
    };
  };

  /**
   * densable `CDn` / `ADn` @193007549 + @193364480 — DECSTBM scroll-region
   * optimization requires settled DEC 2026 (`o7()`), non-daemon, no mux
   * (TMUX/ZELLIJ), not JetBrains JediTerm, not xterm.js, not Windows Terminal,
   * not full-repaint mode, and active sync markers.
   */
  private decstbmSafe(): boolean {
    if (process.env.CLAUDE_BG_BACKEND === 'daemon') return false;
    return (
      isSynchronizedOutputSupported(false) &&
      process.env.TMUX == null &&
      process.env.ZELLIJ == null &&
      !isJediTermEnv() &&
      !isXtermJs() &&
      process.env.WT_SESSION == null &&
      !this.altScreenFullRepaint &&
      !this.skipSyncMarkers()
    );
  }

  /**
   * densable skipSyncMarkers() — when true, dj8/writeDiff skips BSU/ESU.
   * densable: !TTY || !QQ() || !unsubscribeTTYHandlers → skip.
   * Handlers attach lazily in ensureInteractive; before that, DEC 2026
   * markers can desync (especially FleetView open→attach remount).
   */
  skipSyncMarkers(): boolean {
    if (!this.options.stdout.isTTY) return true;
    if (!SYNC_OUTPUT_SUPPORTED()) return true;
    if (!this.unsubscribeTTYHandlers) return true;
    return false;
  }

  /**
   * Official densable setAltScreenActive(active, mode="off").
   * `mouseTracking` accepts boolean (legacy) or densable mode string.
   *
   * Gold does NOT write DEC 1049 here — that is AlternateScreen's insertion
   * effect (iTerm ?1049h flicker if Ink also 2J). This only flags alt-screen
   * + seeds blank frames so the first onRender diffs against a known buffer.
   */
  setAltScreenActive(active: boolean, mouseTracking: boolean | MouseTrackingMode = 'off'): string {
    if (!active) {
      this.writeKeptForNextFrame();
      this.leftAltScreenSinceFrame = true;
    }
    if (this.altScreenActive === active) return '';
    if (active && this.keptForNextFrame !== '') {
      this.keptForNextFrame =
        this.uncover() + (this.isHandedOff ? '' : this.moveCursorBelowFrame()) + this.keptForNextFrame;
    }
    this.altScreenActive = active;
    const mode: MouseTrackingMode = !active
      ? 'off'
      : mouseTracking === true
        ? 'full'
        : mouseTracking === false
          ? 'off'
          : mouseTracking;
    this.altScreenMouseTracking = mode;
    if (!active) {
      this.forgetPointer();
      this.overlays.clearLinkUnderline();
    }
    queueMicrotask(() => {
      if (this.isUnmounted) return;
      for (const listener of this.hoverTrackedListeners) listener();
    });
    this.syncMousePixels();
    if (active) {
      this.ensureInteractive();
      const candidate =
        this.isHandedOff || this.isScreenReaderEnabled || this.renderers?.inline.mustRedraw || O() === 'windows'
          ? undefined
          : (this.mainScreenBehindAlt ??
            (this.options.stdout.isTTY && !frameFillsViewport(this.frontFrame)
              ? {
                  viewport: this.frontFrame.viewport,
                  erase:
                    this.frontFrame.screen.height === 0 && this.displayCursor === null
                      ? ''
                      : eraseMainScreenFrame(this.frontFrame.cursor, this.displayCursor),
                }
              : undefined));
      const size = this.stdoutSize();
      const snapshot =
        candidate?.viewport.width === size.columns && candidate.viewport.height === size.rows ? candidate : undefined;
      this.resetFramesForAltScreen();
      this.mainScreenBehindAlt = snapshot;
      return '';
    }
    this.endPointerCapture();
    this.tellClickedNowhere();
    const snapshot = this.isHandedOff || this.isUnmounted ? undefined : this.mainScreenBehindAlt;
    this.repaint();
    this.mainScreenBehindAlt = snapshot;
    return snapshot === undefined ? '' : cursorPosition(this.terminalRows, 1) + evt(this.terminalRows);
  }

  /**
   * densable `keepForNextFrame` — gold:
   *   if (leftAlt || unmounted) return false
   *   if (kept==="" && n!=="") setImmediate(writeKept)
   *   kept+=n; return true
   * Gold's first scheduleFrame is always `queuePacedFrame` (`lastPacedFrameAt`
   * is -Inf), so `queueMicrotask(onRender)` `takeKept`s before `setImmediate`
   * writes. If a prior onRender already armed the 16ms timeout, promote that
   * paint to a microtask so the same order holds (otherwise 1049h lands
   * between frames and blanks the transcript while PromptInput stays).
   */
  keepForNextFrame(seq: string): boolean {
    if (this.leftAltScreenSinceFrame || this.isUnmounted) return false;
    if (this.keptForNextFrame === '' && seq !== '') {
      setImmediate(this.writeKeptForNextFrame);
      this.scheduler.promoteToMicrotask();
    }
    this.keptForNextFrame += seq;
    return true;
  }

  private takeKeptForNextFrame(): string {
    const seq = this.keptForNextFrame;
    this.keptForNextFrame = '';
    return seq;
  }

  private writeKeptForNextFrame = (): void => {
    const seq = this.takeKeptForNextFrame();
    if (seq !== '' && !this.isUnmounted) {
      writeContentToTerminal(this.terminal, seq);
    }
  };

  private writeAfterKept(seq: string): void {
    if (this.keptForNextFrame !== '') this.keptForNextFrame += seq;
    else this.options.stdout.write(seq);
  }

  /** densable `restoreConsolePatches`. */
  private restoreConsolePatches(): void {
    this.restoreConsole?.();
    this.restoreConsole = undefined;
    this.restoreStderr?.();
    this.restoreStderr = undefined;
  }

  /**
   * densable `writeBeforeExit` — `stdout===process.stdout` uses writeSync(1).
   */
  private writeBeforeExit = (seq: string): void => {
    if (this.options.stdout === process.stdout) writeSync(1, seq);
    else this.options.stdout.write(seq);
  };

  /** Official densable getMouseMode — current alt-screen tracking mode. */
  getMouseMode = (): MouseTrackingMode => this.altScreenMouseTracking;

  /**
   * densable `pixelReportsLive` — DEC 1016 currently asserted.
   */
  pixelReportsLive = false;
  /** densable `finePointerHolds` — retainFinePointer refcount. */
  private finePointerHolds = 0;

  /** densable `mouseReportsInPixels=()=>this.pixelReportsLive`. */
  mouseReportsInPixels = (): boolean => this.pixelReportsLive;

  /**
   * densable `syncMousePixels` — on iff holds>0 && alt && full && capability && cellPixels.
   * Capability is DECRPM 1016 (not GrowthBook `tD().now`).
   */
  syncMousePixels = (): void => {
    if (this.isUnmounted) return;
    const on =
      this.finePointerHolds > 0 &&
      this.altScreenActive &&
      this.altScreenMouseTracking === 'full' &&
      getMousePixelsSupported() &&
      getCellPixels() !== undefined;
    if (on === this.modes.isSet('mousePixels')) return;
    const seq = on ? this.modes.set('mousePixels') : this.modes.reset('mousePixels');
    const write = seq !== '' && !this.isHandedOff;
    if (write) this.writeAfterKept(seq);
    const querier = this.appRef.current?.querier;
    if (write && querier && this.appRef.current && this.appRef.current.rawModeEnabledCount > 0) {
      void querier.flush().then(() => {
        this.pixelReportsLive = on;
      });
    } else {
      this.pixelReportsLive = on;
    }
  };

  /**
   * densable `retainFinePointer` — bump hold, settle-subscribe mousePixels, sync.
   * Gold `tD().onSettle("mousePixels", sync)` — probe store, not GrowthBook.
   */
  private cancelFinePointerSettle: (() => void) | undefined;

  retainFinePointer = (): (() => void) => {
    this.finePointerHolds++;
    this.cancelFinePointerSettle ??= subscribeMousePixelsSupported(() => this.syncMousePixels());
    this.syncMousePixels();
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      this.finePointerHolds--;
      this.syncMousePixels();
    };
  };

  /**
   * densable `handlePointerHover` — Xd + Wl kind move. Skips if not alt-screen.
   */
  handlePointerHover = (
    col: number,
    row: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    fine?: { col: number; row: number },
  ): boolean => {
    if (!this.altScreenActive) return false;
    // densable: releasePointerCapture then Xd. forgetPointer does not drop capture.
    this.releasePointerCapture(col, row, mods, fine);
    return hitPointerHover(this.rootNode, col, row, mods, fine);
  };

  /**
   * densable `releasePointerCapture` — Wl kind up on the captured node.
   */
  private releasePointerCapture(
    col: number,
    row: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    fine?: { col: number; row: number },
  ): boolean {
    const capture = this.pointer.endCapture();
    if (!capture) return false;
    dispatchPointer(capture.node, 'up', col, row, capture.button, mods, fine);
    return true;
  }

  /**
   * densable `handlePointerPress` — Xd hit → capture + Wl kind down.
   * True skips App selection.
   */
  handlePointerPress = (
    col: number,
    row: number,
    button: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    fine?: { col: number; row: number },
  ): boolean => {
    if (!this.pointer.canAcceptPointerPress(this.altScreenActive)) return false;
    this.releasePointerCapture(col, row, mods, fine);
    const target = findPointerHoverTarget(this.rootNode, col, row);
    if (!target) return false;
    this.pointer.capture = { node: target, button, col, row };
    dispatchPointer(target, 'down', col, row, button, mods, fine);
    return true;
  };

  /**
   * densable `handlePointerDrag` — captured node Wl kind move.
   */
  handlePointerDrag = (
    col: number,
    row: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    fine?: { col: number; row: number },
  ): boolean => {
    const capture = this.pointer.capture;
    if (!capture) return false;
    capture.col = col;
    capture.row = row;
    dispatchPointer(capture.node, 'move', col, row, capture.button, mods, fine);
    return true;
  };

  /**
   * densable `handlePointerRelease` — releasePointerCapture Wl kind up.
   */
  handlePointerRelease = (
    col: number,
    row: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    fine?: { col: number; row: number },
  ): boolean => {
    return this.releasePointerCapture(col, row, mods, fine);
  };

  /** densable `isPointerCaptured` — DualInk capture is live. */
  isPointerCaptured(): boolean {
    return this.pointer.capture !== null;
  }

  /**
   * densable `endPointerCapture` — release at the last captured cell with
   * empty mods. Used when leaving alt-screen / handoff (gold forgetPointer
   * does not drop capture).
   */
  endPointerCapture(): void {
    const capture = this.pointer.capture;
    if (capture) {
      this.releasePointerCapture(capture.col, capture.row, {
        shift: false,
        alt: false,
        ctrl: false,
      });
    }
  }

  /** densable `mouseOnSeq` — tracking enable + reassert 1016 if live. */
  private mouseOnSeq(): string {
    return enableMouseTracking(this.altScreenMouseTracking) + this.modes.reassert('mousePixels');
  }

  /**
   * Main-screen mouse tracking (Axc sticky / MainScreenShell). Does not
   * toggle alt-screen. Mode is stored in altScreenMouseTracking so resize
   * / handoff paths re-assert the same sequences.
   */
  setMouseTracking(mouseTracking: boolean | MouseTrackingMode): void {
    const mode: MouseTrackingMode = mouseTracking === true ? 'full' : mouseTracking === false ? 'off' : mouseTracking;
    this.altScreenMouseTracking = mode;
    // Stack only — MainScreenShell writes the DEC. Gold reassert('mouse')
    // reads this entry after sleep-wake / stdin-gap.
    if (this.modes.isSet('mouse')) this.modes.reset('mouse');
    if (mode === 'off') return;
    this.modes.set('mouse', mode);
    this.ensureInteractive();
  }

  get isAltScreenActive(): boolean {
    return this.altScreenActive;
  }

  /**
   * densable `recordContentWrite=(e,t)=>{Nki(this.terminal,e,t)}`.
   * Axc `onWrite` after commitImmediate / restore flush.
   */
  recordContentWrite = (startedMs: number, bytes: number): void => {
    recordSlowestWrite(this.terminal, startedMs, bytes);
  };

  /** densable `writeContent(e){g7a(this.terminal,e)}`. */
  writeContent(content: string): void {
    writeContentToTerminal(this.terminal, content);
  }

  /** densable `getStylePool()` — exposed for xxc / J$0 gap serializer. */
  getStylePool(): StylePool {
    return this.stylePool;
  }

  getCharPool(): CharPool {
    return this.charPool;
  }

  getHyperlinkPool(): HyperlinkPool {
    return this.hyperlinkPool;
  }

  get hasUnmounted(): boolean {
    return this.isUnmounted;
  }

  /**
   * densable `holdsRawMode` —
   * `(this.appRef.current?.rawModeEnabledCount??0)>0`.
   */
  get holdsRawMode(): boolean {
    return (this.appRef.current?.rawModeEnabledCount ?? 0) > 0;
  }

  /**
   * Re-assert terminal modes after a gap (>5s stdin silence or event-loop
   * stall). Catches tmux detach→attach, ssh reconnect, and laptop
   * sleep/wake — none of which send SIGCONT. The terminal may reset DEC
   * private modes on reconnect; this method restores them.
   *
   * Always re-asserts extended key reporting and mouse tracking. Mouse
   * tracking is idempotent (DEC private mode set-when-set is a no-op). The
   * Kitty keyboard protocol is NOT — CSI >5u is a stack push, so we pop
   * first to keep depth balanced (pop on empty stack is a no-op per spec,
   * so after a terminal reset this still restores depth 0→1). Without the
   * pop, each >5s idle gap adds a stack entry, and the single pop on exit
   * or suspend can't drain them — the shell is left in CSI u mode where
   * Ctrl+C/Ctrl+D leak as escape sequences. The alt-screen
   * re-entry (ERASE_SCREEN + frame reset) is NOT idempotent — it blanks the
   * screen — so it's opt-in via includeAltScreen. The stdin-gap caller fires
   * on ordinary >5s idle + keypress and must not erase; the event-loop stall
   * detector fires on genuine sleep/wake and opts in. tmux attach / ssh
   * reconnect typically send a resize, which already covers alt-screen via
   * handleResize.
   */
  reassertTerminalModes = (includeAltScreen = false): void => {
    if (!this.options.stdout.isTTY) return;
    if (this.isHandedOff || this.isUnmounted) return;
    this.options.stdout.write(
      '\x1b(B\x0f' +
        this.modes.reassert('bracketedPaste') +
        this.modes.reassert('extendedKeys') +
        this.modes.reassert('mouse') +
        this.modes.reassert('mousePixels'),
    );
    if (includeAltScreen && this.altScreenActive) {
      this.reenterAltScreen();
    }
  };

  /**
   * Mark this instance as unmounted so future unmount() calls early-return.
   * Called by gracefulShutdown's cleanupTerminalModes() after it has sent
   * EXIT_ALT_SCREEN but before the remaining terminal-reset sequences.
   * Without this, signal-exit's deferred ink.unmount() (triggered by
   * process.exit()) runs the full unmount path: onRender() + writeSync
   * cleanup block + updateContainerSync → AlternateScreen unmount cleanup.
   * The result is 2-3 redundant EXIT_ALT_SCREEN sequences landing on the
   * main screen AFTER printResumeHint(), which tmux (at least) interprets
   * as restoring the saved cursor position — clobbering the resume hint.
   */
  /**
   * 2.1.326 #48: Recover from RangeError memory allocation failure during
   * rendering/screen creation by recycling pools, marking the previous frame
   * contaminated, and dropping the current frame instead of crashing.
   */
  private handleRenderAllocationFailure(stage: string, err: RangeError): void {
    this.fullRepaintSentinelScreen = undefined;
    this.prevFrameContaminated = true;
    this.imagesStale = true;
    try {
      this.resetPools();
    } catch {
      // Ignore secondary allocation failure while recovering.
    }
    if (++this.renderAllocFailures <= 5) {
      this.logger.debug(
        `ink ${stage} allocation failed (${err.name}: ${err.message}); frame dropped to keep session alive`,
        { level: 'warn' },
      );
    }
  }

  /**
   * 2.1.326 #203 / 2.1.328 `finishWrites`: flush non-blocking stdout and any
   * queued DEC prefix before suspend/unmount.
   */
  finishWrites(): void {
    if (this.isHandedOff) return;
    this.isFinishingWrites = true;
    try {
      this.nonBlockingStdout?.flush();
    } finally {
      this.isFinishingWrites = false;
    }
    this.writeKeptForNextFrame();
  }

  /**
   * 2.1.326 #203 / 2.1.328 `moveCursorBelowFrame`: move physical cursor from
   * the declared caret position down to content bottom before Ctrl+Z / exit.
   */
  moveCursorBelowFrame = (): string => {
    const prev = this.displayCursor;
    const uncovered = this.isHandedOff ? '' : this.uncover();
    if (prev === null || this.altScreenActive || !this.options.stdout.isTTY) {
      return uncovered;
    }
    this.displayCursor = null;
    const dx = this.frontFrame.cursor.x - prev.x;
    const dy = this.frontFrame.cursor.y - prev.y;
    return uncovered + (dx !== 0 || dy !== 0 ? cursorMove(dx, dy) : '');
  };

  /**
   * 2.1.326 #203 / 2.1.328 `prepareToSuspend`: flush pending writes and return
   * cursor-below-frame sequence so the shell prompt after Ctrl+Z lands cleanly.
   */
  prepareToSuspend = (): string => {
    this.finishWrites();
    return this.moveCursorBelowFrame();
  };

  detachForShutdown(): void {
    const wasMouseTracking = this.altScreenMouseTracking !== 'off';
    this.nonBlockingStdout?.flush();
    if (!this.isUnmounted) {
      const moveSeq = this.moveCursorBelowFrame();
      if (moveSeq !== '') {
        this.writeBeforeExit(moveSeq);
      }
    }
    this.isUnmounted = true;
    this.altScreenActive = false;
    this.altScreenMouseTracking = 'off';
    // Cancel any pending paced frame so it doesn't fire between
    // cleanupTerminalModes() and process.exit() and write to main screen.
    this.scheduleRender.cancel?.();
    this.unsubscribeTTYHandlers?.();
    const stdin = this.options.stdin as NodeJS.ReadStream & {
      isRaw?: boolean;
      setRawMode?: (m: boolean) => void;
    };
    this.drainStdin(wasMouseTracking ? MOUSE_EXIT_DRAIN_MS : 0);
    if (stdin.isTTY && stdin.isRaw && !this._handoffRawMode) {
      safeSetRawMode(stdin, false, this.logger);
    }
    const streams = stdin === process.stdin ? [stdin, process.stdin] : [stdin];
    for (const stream of new Set(streams)) {
      stream.removeAllListeners?.('readable');
      stream.removeAllListeners?.('data');
      stream.removeAllListeners?.('keypress');
      stream.pause?.();
      stream.unref?.();
    }
  }

  /**
   * densable `aqe` + `resync({probe:!1})` when a query reply is still owed.
   */
  drainStdin(quietDrainMs = 0): Buffer | undefined {
    const querier = this.appRef.current?.querier;
    const drained = drainStdin(this.options.stdin, querier?.owed() ?? 0, quietDrainMs);
    if (querier && querier.owed() > 0) querier.resync({ probe: false });
    return drained;
  }

  /**
   * Re-enter alt-screen, clear, home, re-enable mouse tracking, and reset
   * frame buffers so the next render repaints from scratch. Self-heal for
   * SIGCONT, resize, and stdin-gap/event-loop-stall (sleep/wake) — any of
   * which can leave the terminal in main-screen mode while altScreenActive
   * stays true. ENTER_ALT_SCREEN is a terminal-side no-op if already in alt.
   *
   * densable 2.1.217: always calls onRender() after resetFrames — without it
   * the blank seeded frames sit until an unrelated state change, leaving a
   * black message area after resume/focus recovery.
   */
  private reenterAltScreen(): void {
    this.options.stdout.write(this.modes.reassertFrom('altScreen'));
    this.resetFramesForAltScreen();
    this.imagesStale = true;
    this.onRender();
  }

  /**
   * Seed prev/back frames with full-size BLANK screens (rows×cols of empty
   * cells, not 0×0). In alt-screen mode, next.screen.height is always
   * terminalRows; if prev.screen.height is 0 (emptyFrame's default),
   * log-update sees heightDelta > 0 ('growing') and calls renderFrameSlice,
   * whose trailing per-row CR+LF at the last row scrolls the alt screen,
   * permanently desyncing the virtual and physical cursors by 1 row.
   *
   * With a rows×cols blank prev, heightDelta === 0 → standard diffEach
   * → moveCursorTo (CSI cursorMove, no LF, no scroll).
   *
   * viewport.height = rows + 1 matches the renderer's alt-screen output,
   * preventing a spurious resize trigger on the first frame. cursor.y = 0
   * matches the physical cursor after ENTER_ALT_SCREEN + CSI H (home).
   */
  private resetFramesForAltScreen(): void {
    const rows = this.terminalRows;
    const cols = this.terminalColumns;
    const blank = (): Frame => ({
      screen: createScreen(cols, rows, this.stylePool, this.charPool, this.hyperlinkPool),
      viewport: { width: cols, height: rows + 1 },
      cursor: { x: 0, y: 0, visible: true },
    });
    this.mainScreenBehindAlt = undefined;
    try {
      this.frontFrame = blank();
      this.backFrame = blank();
    } catch (err) {
      if (err instanceof RangeError) {
        this.handleRenderAllocationFailure('resetFramesForAltScreen', err);
        return;
      }
      throw err;
    }
    this.renderers?.fullscreen.invalidate();
    this.log.reset();
    this.renderers?.inline.reset();
    // Defense-in-depth: alt-screen skips the cursor preamble anyway (CSI H
    // resets), but a stale displayCursor would be misleading if we later
    // exit to main-screen without an intervening render.
    this.displayCursor = null;
    // Fresh frontFrame is blank rows×cols — blitting from it would copy
    // blanks over content. Next alt-screen frame must full-render.
    this.prevFrameContaminated = true;
  }

  /**
   * densable `Xk().getSelectedText` — screen-buffer selection, no clipboard.
   */
  getSelectedText(): string {
    if (!hasSelection(this.selection)) return '';
    return getSelectedText(this.selection, this.frontFrame.screen);
  }

  /**
   * Copy the current selection to the clipboard without clearing the
   * highlight. Matches iTerm2's copy-on-select behavior where the selected
   * region stays visible after the automatic copy.
   */
  copySelectionNoClear(): string {
    if (!hasSelection(this.selection)) return '';
    const text = getSelectedText(this.selection, this.frontFrame.screen);
    if (text) {
      // Raw OSC 52, or DCS-passthrough-wrapped OSC 52 inside tmux (tmux
      // drops it silently unless allow-passthrough is on — no regression).
      void setClipboard(text).then(raw => {
        if (raw) this.options.stdout.write(raw);
      });
    }
    return text;
  }

  /**
   * Copy the current text selection to the system clipboard via OSC 52
   * and clear the selection. Returns the copied text (empty if no selection).
   */
  copySelection(): string {
    if (!hasSelection(this.selection)) return '';
    const text = this.copySelectionNoClear();
    this.notifySelectionTakeDown();
    clearSelection(this.selection);
    this.notifySelectionChange();
    return text;
  }

  /** Clear the current text selection without copying. */
  clearTextSelection(): void {
    if (!hasSelection(this.selection)) return;
    this.notifySelectionTakeDown();
    clearSelection(this.selection);
    this.notifySelectionChange();
  }

  /**
   * Set the search highlight query. Non-empty → all visible occurrences
   * are inverted (SGR 7) on the next frame; first one also underlined.
   * Empty → clears (prevFrameContaminated handles the frame after). Same
   * damage-tracking machinery as selection — setCellStyleId doesn't track
   * damage, so the overlay forces full-frame damage while active.
   */
  setSearchHighlight(query: string): void {
    if (this.overlays.searchHighlightQuery === query) return;
    this.overlays.searchHighlightQuery = query;
    this.scheduleRender();
  }

  scanElementSubtree(el: dom.DOMElement): MatchPosition[] {
    if (!this.overlays.searchHighlightQuery || !el.yogaNode) return [];
    const width = Math.ceil(el.yogaNode.getComputedWidth());
    const height = Math.ceil(el.yogaNode.getComputedHeight());
    if (width <= 0 || height <= 0) return [];
    const elLeft = el.yogaNode.getComputedLeft();
    const elTop = el.yogaNode.getComputedTop();
    const screen = createScreen(width, height, this.stylePool, this.charPool, this.hyperlinkPool);
    const output = new Output({
      width,
      height,
      stylePool: this.stylePool,
      screen,
    });
    renderNodeToOutput(el, output, createRenderFrameContext({ consumeClears: false }), {
      offsetX: -elLeft,
      offsetY: -elTop,
      prevScreen: undefined,
    });
    const rendered = output.get();
    leftoverGsDropCachedLayout(el);
    dom.markDirty(el);
    const positions = scanPositions(rendered, this.overlays.searchHighlightQuery);
    this.logger.debug(
      `scanElementSubtree: q='${this.overlays.searchHighlightQuery}' ` +
        `el=${width}x${height}@(${elLeft},${elTop}) n=${positions.length} ` +
        `[${positions
          .slice(0, 10)
          .map(p => `${p.row}:${p.col}`)
          .join(',')}` +
        `${positions.length > 10 ? ',…' : ''}]`,
    );
    return positions;
  }

  setSearchPositions(
    state: {
      positions: MatchPosition[];
      rowOffset: number;
      currentIdx: number;
    } | null,
  ): void {
    this.overlays.searchPositions = state;
    this.scheduleRender();
  }

  /**
   * Set the selection highlight background color. Replaces the per-cell
   * SGR-7 inverse with a solid theme-aware bg (matches native terminal
   * selection). Accepts the same color formats as Text backgroundColor
   * (rgb(), ansi:name, #hex, ansi256()) — colorize() routes through
   * chalk so the tmux/xterm.js level clamps in colorize.ts apply and
   * the emitted SGR is correct for the current terminal.
   *
   * Called by React-land once theme is known (ScrollKeybindingHandler's
   * useEffect watching useTheme). Before that call, withSelectionBg
   * falls back to withInverse so selection still renders on the first
   * frame; the effect fires before any mouse input so the fallback is
   * unobservable in practice.
   */
  setSelectionBgColor(color: string): void {
    // Wrap a NUL marker, then split on it to extract the open/close SGR.
    // colorize returns the input unchanged if the color string is bad —
    // no NUL-split then, so fall through to null (inverse fallback).
    const wrapped = colorize('\0', color, 'background');
    const nul = wrapped.indexOf('\0');
    if (nul <= 0 || nul === wrapped.length - 1) {
      this.stylePool.setSelectionBg(null);
      return;
    }
    this.stylePool.setSelectionBg({
      type: 'ansi',
      code: wrapped.slice(0, nul),
      endCode: wrapped.slice(nul + 1), // always \x1b[49m for bg
    });
    // No scheduleRender: this is called from a React effect that already
    // runs inside the render cycle, and the bg only matters once a
    // selection exists (which itself triggers a full-damage frame).
  }

  /**
   * Capture text from rows about to scroll out of the viewport during
   * drag-to-scroll. Must be called BEFORE the ScrollBox scrolls so the
   * screen buffer still holds the outgoing content. Accumulated into
   * the selection state and joined back in by getSelectedText.
   */
  captureScrolledRows(firstRow: number, lastRow: number, side: 'above' | 'below'): void {
    captureScrolledRows(this.selection, this.frontFrame.screen, firstRow, lastRow, side);
  }

  /**
   * Shift anchor AND focus by dRow, clamped to [minRow, maxRow]. Used by
   * keyboard scroll handlers (PgUp/PgDn etc.) so the highlight tracks the
   * content instead of disappearing. Unlike shiftAnchor (drag-to-scroll),
   * this moves BOTH endpoints — the user isn't holding the mouse at one
   * edge. Supplies screen.width for the col-reset-on-clamp boundary.
   */
  shiftSelectionForScroll(dRow: number, minRow: number, maxRow: number): void {
    const hadSel = hasSelection(this.selection);
    shiftSelection(this.selection, dRow, minRow, maxRow, this.frontFrame.screen.width);
    // Official ybf keeps the selection when both ends leave the viewport
    // (accumulator swap). Notify only if some other path cleared.
    if (hadSel && !hasSelection(this.selection)) {
      this.notifySelectionChange();
    }
  }

  /**
   * Keyboard selection extension (shift+arrow/home/end). Moves focus;
   * anchor stays fixed so the highlight grows or shrinks relative to it.
   * Left/right wrap across row boundaries — native macOS text-edit
   * behavior: shift+left at col 0 wraps to end of the previous row.
   * Up/down clamp at viewport edges (no scroll-to-extend yet). Drops to
   * char mode. No-op outside alt-screen or without an active selection.
   */
  moveSelectionFocus(move: FocusMove): void {
    if (!this.altScreenActive) return;
    const { focus, scope } = this.selection;
    if (!focus) return;
    const { width, height } = this.frontFrame.screen;
    const minCol = scope ? scope.x1 : 0;
    const maxCol = (scope ? Math.min(scope.x2, width) : width) - 1;
    const maxRow = height - 1;
    let { col, row } = focus;
    switch (move) {
      case 'left':
        if (col > minCol) col--;
        else if (row > 0) {
          col = maxCol;
          row--;
        }
        break;
      case 'right':
        if (col < maxCol) col++;
        else if (row < maxRow) {
          col = minCol;
          row++;
        }
        break;
      case 'up':
        if (row > 0) row--;
        break;
      case 'down':
        if (row < maxRow) row++;
        break;
      case 'lineStart':
        col = minCol;
        break;
      case 'lineEnd':
        col = maxCol;
        break;
    }
    if (col === focus.col && row === focus.row) return;
    moveFocus(this.selection, col, row);
    this.notifySelectionChange();
  }

  /** Whether there is an active text selection. */
  hasTextSelection(): boolean {
    return hasSelection(this.selection);
  }

  /**
   * Subscribe to selection state changes. Fires whenever the selection
   * is started, updated, cleared, or copied. Returns an unsubscribe fn.
   */
  subscribeToSelectionChange(cb: () => void): () => void {
    return this.overlays.subscribeToSelectionChange(cb);
  }

  /** densable `subscribeToSelectionTakeDown(n){return this.selectionTakeDown.subscribe(n)}`. */
  subscribeToSelectionTakeDown(cb: () => void): () => void {
    return this.overlays.subscribeToSelectionTakeDown(cb);
  }

  private notifySelectionTakeDown(): void {
    this.overlays.notifySelectionTakeDown();
  }

  private notifySelectionChange(): void {
    if (this.isUnmounted) return;
    this.scheduleRender();
    this.overlays.notifySelectionChange();
  }

  dispatchClick(col: number, row: number): boolean {
    return this.dispatchMouseClick(col, row, false) !== 'unhandled';
  }

  dispatchMouseClick(
    col: number,
    row: number,
    isWindowActivation = false,
    mods?: ClickMods,
    pressedAt?: number,
  ): MouseClickResult {
    if (!this.showsWhatInputAnswers()) return 'stray';
    if (!this.altScreenActive) return 'unhandled';
    const hit = hitTest(this.rootNode, col, row);
    const blank =
      cellIsBlankForHover(this.rootNode, this.frontFrame.screen, hit, col, row) && !this.litWhereClicked(hit, col, row);
    const hyperlinkUrl = this.getHyperlinkAt(col, row);
    const event = new ClickEvent(col, row, blank, hyperlinkUrl, isWindowActivation, mods ?? EMPTY_CLICK_MODS);
    if (hit && !isWindowActivation && this.dropsInput(hit, 'click', pressedAt)) return 'stray';
    this.pointer.notifyClicks(hit, event);
    const handled = bubbleClick(this.rootNode, event, hit);
    if (event.droppedAsStray) return 'stray';
    if (handled && event.endsClickChain) return 'repeat';
    return handled ? 'handled' : 'unhandled';
  }

  private litWhereClicked(hit: dom.DOMElement | null, col: number, row: number): boolean {
    if (col !== this.pointer.hoverCol || row !== this.pointer.hoverRow) return false;
    let node: dom.DOMElement | undefined = hit ?? undefined;
    while (node) {
      if (node.attributes.hoverIgnoresBlankCells && this.pointer.hoveredNodes.has(node)) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  private repaintAfterStaleAbsolutePaint(frame: Frame): void {
    if (!frame.staleAbsolutePaint) return;
    this.prevFrameContaminated = true;
    this.scheduleRender();
  }

  dispatchHover(col: number, row: number): void {
    if (!this.altScreenActive) return;
    this.overlays.hoverLinkAt(col, row, this.isHoverTracked());
    this.pointer.hoverCol = col;
    this.pointer.hoverRow = row;
    this.pointer.hoverFollowStreak = 0;
    this.pointer.hoverFollowHeldUntil = 0;
    dispatchHover(this.rootNode, col, row, this.pointer.hoveredNodes, this.frontFrame.screen);
  }

  forgetPointer(): void {
    this.pointer.clearHoverCoords();
    this.overlays.clearHoveredLink();
    const app = this.appRef.current;
    if (app !== null) {
      app.lastHoverCol = -1;
      app.lastHoverRow = -1;
      app.lastHoverOnTarget = false;
    }
  }

  followHover(): void {
    if (!this.altScreenActive || this.pointer.hoverCol < 0 || performance.now() < this.pointer.hoverFollowHeldUntil) {
      return;
    }
    const changed = applyFollowHover(
      this.rootNode,
      this.pointer.hoverCol,
      this.pointer.hoverRow,
      this.pointer.hoveredNodes,
      this.frontFrame.screen,
    );
    this.pointer.hoverFollowStreak = changed ? this.pointer.hoverFollowStreak + 1 : 0;
    if (this.pointer.hoverFollowStreak >= 4) {
      this.pointer.hoverFollowStreak = 0;
      this.pointer.hoverFollowHeldUntil = performance.now() + 1000;
    }
  }

  dispatchKeyboardEvent(parsedKey: ParsedKey, extras?: { soloKeypress?: boolean; pressedAt?: number }): boolean {
    const focusedBefore = this.focusManager.activeElement;
    const target = focusedBefore ?? this.rootNode;
    const event = new KeyboardEvent(parsedKey, extras);
    const isWayOut = parsedKey.ctrl ? parsedKey.name === 'c' || parsedKey.name === 'd' : parsedKey.name === 'escape';
    const isPrintable = isPrintableKeyboardEvent(event);
    const inputTag =
      event.name === 'escape' || (this.altScreenActive && /^page/.test(event.name))
        ? INPUT_GATE_OTHER
        : isWayOut
          ? INPUT_GATE_WAY_OUT
          : isPrintable
            ? `"${event.key}"`
            : event.ctrl || event.meta || event.superKey || event.shift
              ? `"${shortcutKeyForInputGate(event) || event.sequence}"`
              : event.name;
    const hasInput = event.shortcutKey !== '' || event.name !== '';
    const detail = target.attributes.textEntry === true ? undefined : event;
    if (hasInput && this.dropsInput(target, inputTag, extras?.pressedAt, detail)) {
      return event.isReadAsEscapeThenKey;
    }
    if (!this.showsWhatInputAnswers() && !isWayOut) {
      return false;
    }

    dispatcher.dispatchDiscrete(target, event);
    if (isPrintable) {
      this.noteIfStray(event, target);
    }

    // Tab cycling is the default action — only fires if no handler
    // called preventDefault(). Mirrors browser behavior.
    if (!event.defaultPrevented && parsedKey.name === 'tab' && !parsedKey.ctrl && !parsedKey.meta) {
      if (parsedKey.shift) {
        this.focusManager.focusPrevious(this.rootNode);
      } else {
        this.focusManager.focusNext(this.rootNode);
      }
    }
    if (
      !event.defaultPrevented &&
      !event._isPropagationStopped() &&
      !event.didStopImmediatePropagation() &&
      !parsedKey.ctrl &&
      !parsedKey.meta &&
      !parsedKey.option &&
      !parsedKey.shift &&
      focusedBefore &&
      this.focusManager.activeElement === focusedBefore &&
      (parsedKey.name === 'up' || parsedKey.name === 'down' || parsedKey.name === 'left' || parsedKey.name === 'right')
    ) {
      if (this.focusManager.focusDirection(parsedKey.name, this.rootNode)) {
        this.logger.debug(`tengu_spatial_focus_nav direction=${parsedKey.name}`);
      }
    }
    return event.isReadAsEscapeThenKey;
  }

  /**
   * Official densable 2.1.210/2.1.328 dispatchPasteEvent:
   *   focusManager.activeElement ?? root → InputGate drops check → PasteEvent → noteIfStray
   * Bracketed paste is a separate event from keydown (kind paste).
   */
  dispatchPasteEvent(text: string, pressedAt?: number): void {
    const target = this.focusManager.activeElement ?? this.rootNode;
    if (!this.dropsInput(target, 'paste', pressedAt) && this.showsWhatInputAnswers()) {
      const event = new PasteEvent(text);
      dispatcher.dispatchDiscrete(target, event);
      this.noteIfStray(event, target);
    }
  }

  /**
   * densable `dispatchWheelEvent` — SGR wheel → WheelEvent on the hit
   * node that has onWheel (`VC`), else focused/root. Gold: no return;
   * `pointerCapture` skips. Yt `onWheelCapture` synthesizes keybindings.
   */
  dispatchWheelEvent = (parsed: ParsedKey): void => {
    if (this.pointer.capture) return;
    if (!this.showsWhatInputAnswers()) return;
    const seq = parsed.sequence ?? '';
    const payload = seq.startsWith('\x1b') ? seq.slice(1) : seq;
    const match = payload.match(/^\[<(\d+);(\d+);(\d+)[Mm]$/);
    // densable S1: prefer ParsedKey col/row (already cell-converted when 1016 live).
    const col = parsed.col != null ? parsed.col - 1 : match ? Number(match[2]) - 1 : undefined;
    const row = parsed.row != null ? parsed.row - 1 : match ? Number(match[3]) - 1 : undefined;
    const cell =
      col !== undefined && row !== undefined && Number.isFinite(col) && Number.isFinite(row) ? { col, row } : null;
    const hit = cell ? hitTest(this.rootNode, cell.col, cell.row) : null;
    // Gold: y=(f&&VC(f)?f:null)??focus??root. VC is ancestor-only.
    const target = (hit && nodeHasWheelHandler(hit) ? hit : null) ?? this.focusManager.activeElement ?? this.rootNode;
    const event = new WheelEvent(parsed.name === 'wheeldown' ? 1 : -1, {
      ctrl: parsed.ctrl,
      shift: parsed.shift,
      meta: parsed.meta || parsed.option,
      ...(cell !== null && { col: cell.col, row: cell.row }),
    });
    dispatcher.dispatchContinuous(target, event);
  };
  /**
   * Look up the URL at (col, row) in the current front frame. Checks for
   * an OSC 8 hyperlink first, then falls back to scanning the row for a
   * plain-text URL (mouse tracking intercepts the terminal's native
   * Cmd+Click URL detection, so we replicate it). This is a pure lookup
   * with no side effects — call it synchronously at click time so the
   * result reflects the screen the user actually clicked on, then defer
   * the browser-open action via a timer.
   */
  getHyperlinkAt(col: number, row: number): string | undefined {
    if (!this.altScreenActive) return undefined;
    const screen = this.frontFrame.screen;
    const cell = cellAt(screen, col, row);
    let url = cell?.hyperlink;
    // SpacerTail cells (right half of wide/CJK/emoji chars) store the
    // hyperlink on the head cell at col-1.
    if (!url && cell?.width === CellWidth.SpacerTail && col > 0) {
      url = cellAt(screen, col - 1, row)?.hyperlink;
    }
    return url ?? findPlainTextUrlAt(screen, col, row);
  }

  /**
   * Optional callback fired when clicking an OSC 8 hyperlink in fullscreen
   * mode. Set by FullscreenLayout via useLayoutEffect.
   */
  onHyperlinkClick: ((url: string) => void) | undefined;

  /**
   * Stable prototype wrapper for onHyperlinkClick. Passed to <App> as
   * onOpenHyperlink so the prop is a bound method (autoBind'd) that reads
   * the mutable field at call time — not the undefined-at-render value.
   */
  openHyperlink(url: string): void {
    this.onHyperlinkClick?.(url);
  }

  /**
   * densable `fileHyperlinkOpensInPanel` — FullscreenLayout pins a getter.
   * `fileLinkOpensInPanel()` is `this.fileHyperlinkOpensInPanel?.()===!0`.
   */
  fileHyperlinkOpensInPanel: (() => boolean) | undefined;

  fileLinkOpensInPanel(): boolean {
    return this.fileHyperlinkOpensInPanel?.() === true;
  }

  /**
   * Handle a double- or triple-click at (col, row): select the word or
   * line under the cursor by reading the current screen buffer. Called on
   * PRESS (not release) so the highlight appears immediately and drag can
   * extend the selection word-by-word / line-by-line. Falls back to
   * char-mode startSelection if the click lands on a noSelect cell.
   */
  /**
   * densable `onSelectionStart` → `Tp(this.selection,e,o,Cy(...))`.
   */
  handleSelectionStart(col: number, row: number): void {
    this.notifySelectionTakeDown();
    startSelection(this.selection, col, row, selectionScopeAt(this.rootNode, col, row));
  }

  handleMultiClick(col: number, row: number, count: 2 | 3): void {
    if (!this.altScreenActive) return;
    const screen = this.frontFrame.screen;
    this.notifySelectionTakeDown();
    // selectWordAt/selectLineAt no-op on noSelect/out-of-bounds. Seed with
    // a char-mode selection so the press still starts a drag even if the
    // word/line scan finds nothing selectable.
    startSelection(this.selection, col, row, selectionScopeAt(this.rootNode, col, row));
    if (count === 2) selectWordAt(this.selection, screen, col, row);
    else selectLineAt(this.selection, screen, row);
    // Ensure hasSelection is true so release doesn't re-dispatch onClickAt.
    // selectWordAt no-ops on noSelect; selectLineAt no-ops out-of-bounds.
    if (!this.selection.focus) this.selection.focus = this.selection.anchor;
    this.notifySelectionChange();
  }

  /**
   * Handle a drag-motion at (col, row). In char mode updates focus to the
   * exact cell. In word/line mode snaps to word/line boundaries so the
   * selection extends by word/line like native macOS. Gated on
   * altScreenActive for the same reason as dispatchClick.
   */
  handleSelectionDrag(col: number, row: number): void {
    if (!this.altScreenActive) return;
    const sel = this.selection;
    // Analog: some terminals emit the first hold as motion (button|0x20)
    // without a prior press-only event. Seed Cy so updateSelection can run.
    if (!sel.isDragging) {
      startSelection(sel, col, row, selectionScopeAt(this.rootNode, col, row));
    }
    if (sel.anchorSpan) {
      extendSelection(sel, this.frontFrame.screen, col, row);
    } else {
      updateSelection(sel, col, row);
    }
    this.notifySelectionChange();
  }

  // Methods to properly suspend stdin for external editor usage
  // This is needed to prevent Ink from swallowing keystrokes when an external editor is active
  private stdinListeners: Array<{
    event: string;
    listener: (...args: unknown[]) => void;
  }> = [];
  private wasRawMode = false;

  suspendStdin(): void {
    const stdin = this.options.stdin;
    if (!stdin.isTTY) {
      return;
    }

    // Store and remove all 'readable' event listeners temporarily
    // This prevents Ink from consuming stdin while the editor is active
    const readableListeners = stdin.listeners('readable');
    this.logger.debug(
      `[stdin] suspendStdin: removing ${readableListeners.length} readable listener(s), wasRawMode=${(stdin as NodeJS.ReadStream & { isRaw?: boolean }).isRaw ?? false}`,
    );
    readableListeners.forEach(listener => {
      this.stdinListeners.push({
        event: 'readable',
        listener: listener as (...args: unknown[]) => void,
      });
      stdin.removeListener('readable', listener as (...args: unknown[]) => void);
    });

    // If raw mode is enabled, disable it temporarily
    const stdinWithRaw = stdin as NodeJS.ReadStream & {
      isRaw?: boolean;
      setRawMode?: (mode: boolean) => void;
    };
    if (stdinWithRaw.isRaw && !this._handoffRawMode) {
      if ((this.appRef.current?.querier?.owed() ?? 0) > 0) this.drainStdin();
      safeSetRawMode(stdin, false, this.logger);
      this.wasRawMode = true;
    }
  }

  resumeStdin(): void {
    const stdin = this.options.stdin;
    if (!stdin.isTTY) {
      return;
    }

    // Re-attach all the stored listeners
    if (this.stdinListeners.length === 0 && !this.wasRawMode) {
      this.logger.debug('[stdin] resumeStdin: called with no stored listeners and wasRawMode=false (possible desync)', {
        level: 'warn',
      });
    }
    this.logger.debug(
      `[stdin] resumeStdin: re-attaching ${this.stdinListeners.length} listener(s), wasRawMode=${this.wasRawMode}`,
    );
    this.stdinListeners.forEach(({ event, listener }) => {
      stdin.addListener(event, listener);
    });
    this.stdinListeners = [];

    // Re-enable raw mode if it was enabled before
    if (this.wasRawMode) {
      safeSetRawMode(stdin, true, this.logger);
      this.wasRawMode = false;
    }
  }

  // Stable identity for TerminalWriteContext. MUST be an instance arrow
  // (not a prototype method): context consumers call `writeRaw(seq)` as a
  // free function, so a method would lose `this` and throw before
  // ENTER_ALT_SCREEN / setAltScreenActive ever land. That leaves Ink on
  // main-screen while the UI still sizes to terminalRows — Esc/cancel then
  // hits LogUpdate fullReset (Bj8 wipe) and paints blank for seconds.
  // An inline arrow inside render() would also be wrong: new identity every
  // render() → AlternateScreen useInsertionEffect re-fires → exit+re-enter
  // (densable ME_ deps [writeRaw, mouseTracking]).
  private writeRaw = (data: string): void => {
    this.options.stdout.write(data);
  };

  private setCursorDeclaration: CursorDeclarationSetter = (decl, clearIfNode) => {
    if (decl === null && clearIfNode !== undefined && this.cursorDeclaration?.node !== clearIfNode) {
      return;
    }
    this.cursorDeclaration = decl;
  };

  /**
   * densable `tree()` — imperative DOM instead of React `render()`.
   * Gold: throws if render() already ran; then ensureInteractive + ownTree.
   */
  tree(): InkTree {
    if (this.renderCalled) {
      throw new Error("Ink: this root is React's (render() was called), so it can't be drawn with Tree too");
    }
    this.ensureInteractive();
    this.ownTree ??= new InkTree(this.rootNode);
    Ns().treeRoots.set(this.options.stdout, this);
    return this.ownTree;
  }

  render(node: ReactNode): void {
    // densable: if(this.ownTree) throw; this.renderCalled=!0,this.currentNode=H
    if (this.ownTree) {
      throw new Error("Ink: this root is drawn with Tree (tree() was called), so it can't be React's too");
    }
    this.renderCalled = true;
    this.currentNode = node;

    const tree = (
      <App
        ref={this.appRef}
        stdin={this.options.stdin}
        stdout={this.options.stdout}
        stderr={this.options.stderr}
        exitOnCtrlC={this.options.exitOnCtrlC}
        onExit={this.unmount}
        subscribeLayout={this.subscribeLayout}
        subscribeFrames={this.subscribeFrames}
        subscribeClicks={this.subscribeClicks}
        subscribeHoverTracked={this.subscribeHoverTracked}
        isHoverTracked={this.isHoverTracked}
        retainFinePointer={this.retainFinePointer}
        terminalImages={this.terminalImages}
        terminalColumns={this.terminalColumns}
        terminalRows={this.terminalRows}
        selection={this.selection}
        onSelectionChange={this.notifySelectionChange}
        onSelectionTakeDown={this.notifySelectionTakeDown}
        onClickAt={this.dispatchMouseClick}
        onHoverAt={this.dispatchHover}
        onHoverLost={this.forgetPointer}
        onPointerPress={this.handlePointerPress}
        onPointerDrag={this.handlePointerDrag}
        onPointerRelease={this.handlePointerRelease}
        onPointerHover={this.handlePointerHover}
        getHyperlinkAt={this.getHyperlinkAt}
        onOpenHyperlink={this.openHyperlink}
        fileLinkOpensInPanel={this.fileLinkOpensInPanel}
        onMultiClick={this.handleMultiClick}
        onSelectionStart={this.handleSelectionStart}
        onSelectionDrag={this.handleSelectionDrag}
        onStdinResume={this.reassertTerminalModes}
        modes={this.modes}
        getMouseMode={this.getMouseMode}
        mouseReportsInPixels={this.mouseReportsInPixels}
        onCellPixels={this.syncMousePixels}
        onRawModeEnter={this.ensureInteractive}
        onCursorDeclaration={this.setCursorDeclaration}
        dispatchKeyboardEvent={this.dispatchKeyboardEvent}
        onInputPriorityFrame={this.requestInputPriorityFrame}
        prepareToSuspend={this.prepareToSuspend}
        dispatchPasteEvent={this.dispatchPasteEvent}
        dispatchWheelEvent={this.dispatchWheelEvent}
        pressClock={this.pressClock}
        focusManager={this.focusManager}
        rootNode={this.rootNode}
        isScreenReaderEnabled={this.isScreenReaderEnabled}
      >
        <AccessibilityContext.Provider value={this.isScreenReaderEnabled}>
          <TerminalWriteProvider value={this.writeRaw}>
            <TerminalModesContext.Provider value={this.modes}>{node}</TerminalModesContext.Provider>
          </TerminalWriteProvider>
        </AccessibilityContext.Provider>
      </App>
    );

    reconciler.updateContainerSync(tree, this.container, null, noop);
    reconciler.flushSyncWork();
  }

  unmount(error?: Error | number | null): void {
    if (this.isUnmounted) {
      return;
    }

    if (error instanceof Error) {
      this.exitError = error;
      this.hasExited = true;
      this.rejectExitPromise(error);
    } else {
      this.hasExited = true;
      this.resolveExitPromise();
    }

    // densable: this.isExiting=!0; clear srStartupQuietTimer; then final onRender
    this.isExiting = true;
    if (this.srStartupQuietTimer !== null) {
      clearTimeout(this.srStartupQuietTimer);
      this.srStartupQuietTimer = null;
    }
    if (this.srPreParkTimer !== null) {
      clearTimeout(this.srPreParkTimer);
      this.srPreParkTimer = null;
    }
    if (this.srAnnouncementHoldTimer !== null) {
      clearTimeout(this.srAnnouncementHoldTimer);
      this.srAnnouncementHoldTimer = null;
    }

    this.finishWrites();
    this.writeKeptForNextFrame();
    try {
      this.onRender();
    } catch (renderErr) {
      if (!this.unwritten) throw renderErr;
      this.logger.error(renderErr);
    }
    this.unsubscribeExit();
    this.restoreConsolePatches();
    this.unsubscribeTTYHandlers?.();
    this.cancelFinePointerSettle?.();
    this.cancelFinePointerSettle = undefined;

    // densable: if(this.renderCalled&&!this.isHandedOff) dyr(..., skipSync, stdoutSize().rows)
    if (this.renderCalled && !this.isHandedOff) {
      const diff = this.log.renderPreviousOutput_DEPRECATED(this.frontFrame);
      const uncovered = this.uncover();
      if (uncovered !== '') {
        diff.unshift({ type: 'stdout', content: uncovered });
      }
      writeDiffToTerminal(this.terminal, optimize(diff), this.skipSyncMarkers(), this.stdoutSize().rows);
    }

    this.nonBlockingStdout?.flush();
    if (this.options.stdout.isTTY) {
      const wasMouseTracking = this.altScreenMouseTracking !== 'off';
      try {
        if (!this.isHandedOff) {
          const moveSeq = this.moveCursorBelowFrame();
          if (moveSeq !== '') {
            this.writeBeforeExit(moveSeq);
          }
        }
        if (wasMouseTracking) {
          const mouseOff = this.modes.reset('mousePixels') + this.modes.reset('mouse');
          if (mouseOff !== '') {
            this.writeBeforeExit(mouseOff);
          }
        }
        restoreTerminalModes(this.modes, this.writeBeforeExit);
        this.altScreenActive = false;
        this.altScreenMouseTracking = 'off';
        this.drainStdin(wasMouseTracking ? MOUSE_EXIT_DRAIN_MS : 0);
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err) {
          this.logger.debug(`unmount terminal cleanup writeSync failed: ${err}`, { level: 'error' });
        } else {
          throw err;
        }
      }
    }

    this.isUnmounted = true;
    this.cancelFinePointerSettle = undefined;

    // Cancel any pending paced frames to prevent accessing freed Yoga nodes
    this.scheduleRender.cancel?.();
    this.scheduler.cancelAll();

    reconciler.updateContainerSync(null, this.container, null, noop);
    reconciler.flushSyncWork();
    if (this.ownTree) {
      for (const child of this.rootNode.childNodes.slice()) {
        if (child.nodeName !== '#text') {
          dom.removeChildNode(this.rootNode, child);
        }
      }
    }
    const registry = Ns();
    if (registry.treeRoots.get(this.options.stdout) === this) {
      registry.treeRoots.delete(this.options.stdout);
    }
    instances.delete(this.options.stdout);

    // Free the root yoga node, then clear its reference. Children are already
    // freed by the reconciler's removeChildFromContainer; using .free() (not
    // .freeRecursive()) avoids double-freeing them.
    this.rootNode.yogaNode?.free();
    this.rootNode.yogaNode = undefined;
  }

  async waitUntilExit(): Promise<void> {
    if (this.hasExited) {
      if (this.exitError) throw this.exitError;
      return;
    }
    this.exitPromise ||= new Promise((resolve, reject) => {
      this.resolveExitPromise = resolve;
      this.rejectExitPromise = reject;
    });

    return this.exitPromise;
  }

  resetLineCount(): void {
    if (this.options.stdout.isTTY) {
      // Swap so old front becomes back (for screen reuse), then reset front
      this.backFrame = this.frontFrame;
      this.frontFrame = emptyFrame(
        this.frontFrame.viewport.height,
        this.frontFrame.viewport.width,
        this.stylePool,
        this.charPool,
        this.hyperlinkPool,
      );
      this.log.reset();
      // frontFrame is reset, so frame.cursor on the next render is (0,0).
      // Clear displayCursor so the preamble doesn't compute a stale delta.
      this.displayCursor = null;
    }
  }

  /**
   * Official 2.1.328 `maybeResetPools` (`uS` @338364) — compacts `stylePool`
   * when near capacity or over budget and recycles `hyperlinkPool` on cap.
   */
  maybeResetPools(renderStart: number): void {
    const elapsed = renderStart - this.lastPoolResetTime;
    if (!shouldResetPools(elapsed, this.stylePool, this.lastStyleLiveSize)) {
      return;
    }
    this.lastPoolResetTime = renderStart;
    this.resetPools();
  }

  /**
   * Official 2.1.328 `Ts.resetPools()` (@444781) — keeps `charPool` intact,
   * replaces `hyperlinkPool` only when `size > HYPERLINK_POOL_LIMIT`, and
   * compacts `stylePool` only when `needsCompaction(lastStyleLiveSize)`.
   */
  resetPools(): void {
    const resetLinks = this.hyperlinkPool.size > HYPERLINK_POOL_LIMIT;
    const compactStyles = this.stylePool.needsCompaction(this.lastStyleLiveSize);
    if (!resetLinks && !compactStyles) return;
    if (resetLinks) {
      this.hyperlinkPool = new HyperlinkPool();
    }
    migrateScreenPools(
      this.frontFrame.screen,
      this.charPool,
      this.hyperlinkPool,
      compactStyles ? this.stylePool.compact() : undefined,
    );
    if (compactStyles) {
      this.lastStyleLiveSize = this.stylePool.size;
    }
    this.backFrame.screen.hyperlinkPool = this.hyperlinkPool;
    this.fullRepaintSentinelScreen = undefined;
  }

  patchConsole(): () => void {
    const con = console;
    const originals: Partial<Record<keyof Console, Console[keyof Console]>> = {};
    const toDebug = (...args: unknown[]) => this.logger.debug(`console.log: ${format(...args)}`);
    const toError = (...args: unknown[]) => this.logger.error(new Error(`console.error: ${format(...args)}`));
    for (const m of CONSOLE_STDOUT_METHODS) {
      originals[m] = con[m];
      con[m] = toDebug;
    }
    for (const m of CONSOLE_STDERR_METHODS) {
      originals[m] = con[m];
      con[m] = toError;
    }
    originals.assert = con.assert;
    con.assert = (condition: unknown, ...args: unknown[]) => {
      if (!condition) toError(...args);
    };
    return () => Object.assign(con, originals);
  }

  /**
   * Intercept process.stderr.write so stray writes (config.ts, hooks.ts,
   * third-party deps) don't corrupt the alt-screen buffer. patchConsole only
   * hooks console.* methods — direct stderr writes bypass it, land at the
   * parked cursor, scroll the alt-screen, and desync frontFrame from the
   * physical terminal. Next diff writes only changed-in-React cells at
   * absolute coords → interleaved garbage.
   *
   * Swallows the write (routes text to the debug log) and, in alt-screen,
   * forces a full-damage repaint as a defensive recovery. Not patching
   * process.stdout — Ink itself writes there.
   */
  private patchStderr(): () => void {
    const stderr = process.stderr;
    const originalWrite = stderr.write;
    let reentered = false;
    const intercept = (
      chunk: Uint8Array | string,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean => {
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      // Reentrancy guard: logger.debug → writeToStderr → here. Pass
      // through to the original so --debug-to-stderr still works and we
      // don't stack-overflow.
      if (reentered) {
        const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : undefined;
        return originalWrite.call(stderr, chunk, encoding, callback);
      }
      reentered = true;
      try {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        this.logger.debug(`[stderr] ${text}`, { level: 'warn' });
        if (this.altScreenActive && !this.isUnmounted && !this.isPaused) {
          this.prevFrameContaminated = true;
          this.scheduleRender();
        }
      } finally {
        reentered = false;
        callback?.();
      }
      return true;
    };
    stderr.write = intercept;
    return () => {
      if (stderr.write === intercept) {
        stderr.write = originalWrite;
      }
    };
  }
}

/** densable `Kv` — count DA1 replies in a latin1 buffer. */
function countDa1Replies(buf: Buffer): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: gold `Kv` DA1 CSI
  return buf.toString('latin1').match(/\x1b\[\?[\d;]*c/g)?.length ?? 0;
}

/** densable `YC` — nonblocking read; EAGAIN → 0, other errors → -1. */
function readTtyNonblock(fd: number, buf: Buffer): number {
  try {
    return readSync(fd, buf, 0, buf.length, null);
  } catch (err) {
    return err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'EAGAIN' ? 0 : -1;
  }
}

/** 2.1.326 #202: brief window to drain in-flight SGR mouse sequences on fullscreen exit. */
const MOUSE_EXIT_DRAIN_MS = 25;
const MOUSE_EXIT_QUIET_MS = 4;

/**
 * densable `aqe(n=process.stdin,u=0)`. `owed` is `querier.owed()`: wait up
 * to `Gd` for that many DA1 replies on `/dev/tty`.
 * 2.1.326 #202: optional `quietDrainMs` drains late mouse tracking escape
 * sequences after disabling mouse tracking so they do not leak to the shell.
 */
/* eslint-disable custom-rules/no-sync-fs -- must be sync; called from signal handler / unmount */
export function drainStdin(stdin: NodeJS.ReadStream = process.stdin, owed = 0, quietDrainMs = 0): Buffer | undefined {
  if (!stdin.isTTY) return;
  const chunks: Buffer[] = [];
  try {
    let chunk: string | Buffer | null;
    while ((chunk = stdin.read()) !== null) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    }
  } catch {
    /* stream may be destroyed */
  }
  const tty = stdin as NodeJS.ReadStream & {
    isRaw?: boolean;
    setRawMode?: (raw: boolean) => void;
  };
  const wasRaw = tty.isRaw === true;
  let fd = -1;
  try {
    if (!wasRaw) tty.setRawMode?.(true);
    fd = openSync('/dev/tty', fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    const buf = Buffer.alloc(1024);
    const now = performance.now();
    const deadline = owed > 0 ? now + OWED_REPLY_HOLD_MS : quietDrainMs > 0 ? now + quietDrainMs : 0;
    let remaining = owed - countDa1Replies(Buffer.concat(chunks));
    let lastMouseChunkAt = chunks.length > 0 ? now : 0;
    for (let reads = 0; reads < 64; ) {
      const n = readTtyNonblock(fd, buf);
      if (n > 0) {
        const piece = Buffer.from(buf.subarray(0, n));
        chunks.push(piece);
        remaining -= countDa1Replies(piece);
        lastMouseChunkAt = performance.now();
        reads++;
        continue;
      }
      const t = performance.now();
      const waitingForReplies = remaining > 0;
      const waitingForQuietMouse =
        owed <= 0 &&
        quietDrainMs > 0 &&
        t < deadline &&
        (lastMouseChunkAt === 0 || t - lastMouseChunkAt < MOUSE_EXIT_QUIET_MS);
      if (n < 0 || (!waitingForReplies && !waitingForQuietMouse) || t >= deadline) break;
      Bun.sleepSync(2);
    }
  } catch {
    // EAGAIN (buffer empty — expected), ENXIO/ENOENT (no controlling tty),
    // EBADF/EIO (TTY revoked — SIGHUP, SSH disconnect)
  } finally {
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    if (!wasRaw) {
      try {
        tty.setRawMode?.(false);
      } catch {
        /* TTY may be gone */
      }
    }
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}
/* eslint-enable custom-rules/no-sync-fs */

const CONSOLE_STDOUT_METHODS = [
  'log',
  'info',
  'debug',
  'dir',
  'dirxml',
  'count',
  'countReset',
  'group',
  'groupCollapsed',
  'groupEnd',
  'table',
  'time',
  'timeEnd',
  'timeLog',
] as const;
const CONSOLE_STDERR_METHODS = ['warn', 'error', 'trace'] as const;
