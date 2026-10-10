import React, { PureComponent, type ReactNode } from 'react';
// Business-layer callbacks — replaced with inline defaults so this package
// has zero dependencies on business code. The business layer can inject
// implementations via AppCallbacks when needed.
type AppCallbacks = {
  updateLastInteractionTime?: () => void;
  stopCapturingEarlyInput?: () => void;
  isMouseClicksDisabled?: () => boolean;
  logError?: (error: unknown) => void;
  logForDebugging?: (message: string, opts?: { level?: string }) => void;
  /** densable `Ym` / `Fkd.committed` — gracefulShutdown has committed. */
  isShutdownCommitted?: () => boolean;
};

/** Default no-op / safe-default implementations */
const defaultCallbacks: Required<AppCallbacks> = {
  updateLastInteractionTime: () => {},
  stopCapturingEarlyInput: () => {},
  isMouseClicksDisabled: () => false,
  logError: (error: unknown) => console.error(error),
  logForDebugging: (_message: string, _opts?: { level?: string }) => {},
  isShutdownCommitted: () => false,
};

/**
 * Override the default no-op callbacks. Call this from the business layer
 * (e.g. src/ink.tsx) before mounting <App>.
 */
export function setAppCallbacks(cb: AppCallbacks): void {
  Object.assign(defaultCallbacks, cb);
}

function isEnvTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}
import { EventEmitter } from '../core/events/emitter.js';
import { InputEvent } from '../core/events/input-event.js';
import { TerminalFocusEvent } from '../core/events/terminal-focus-event.js';
import {
  createArrowBurstWindow,
  createJediTermInputState,
  rewriteJediTermInput,
  trackArrowBurst,
} from '../core/jediTermInput.js';
import {
  INITIAL_STATE,
  isHeldSgrMousePrefix,
  parkIncompleteMousePrefix,
  type ParsedInput,
  type ParsedKey,
  type ParsedMouse,
  parseMultipleKeypresses,
} from '../core/parse-keypress.js';
import reconciler from '../core/reconciler.js';
import instances from '../core/instances.js';
import { clearSelection, finishSelection, hasSelection, type SelectionState } from '../core/selection.js';
import { waitUntilAttachStable } from '../core/attachStamp.js';
import {
  getCellPixels,
  getMousePixelsSupported,
  isGhosttyXtversion,
  isXtermJs,
  supportsExtendedKeys,
} from '../core/terminal.js';
import { probeTerminalIdentity, reprobeCellPixels as queryCellPixels } from '../core/terminalProbe.js';
import { _getClipboardHostPlatform, readNativeClipboard } from '../core/termio/osc.js';
import type { MouseClickResult } from '../core/events/click-event.js';
import {
  getTerminalFocusGainedAt,
  getTerminalFocused,
  getTerminalFocusState,
  setTerminalFocused,
} from '../core/terminal-focus-state.js';
import { TerminalQuerier } from '../core/terminal-querier.js';
import {
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
  ENABLE_KITTY_KEYBOARD,
  ENABLE_MODIFY_OTHER_KEYS,
  FOCUS_IN,
  FOCUS_OUT,
} from '../core/termio/csi.js';
import {
  DBP,
  DFE,
  DISABLE_MOUSE_TRACKING,
  EBP,
  EFE,
  HIDE_CURSOR,
  type MouseTrackingMode,
  SHOW_CURSOR,
} from '../core/termio/dec.js';
import AppContext from './AppContext.js';
import { ClockProvider } from './ClockContext.js';
import CursorDeclarationContext, { type CursorDeclarationSetter } from './CursorDeclarationContext.js';
import ErrorOverview from './ErrorOverview.js';
import StdinContext from './StdinContext.js';
import { TerminalFocusProvider } from './TerminalFocusContext.js';
import { TerminalSizeContext } from './TerminalSizeContext.js';

// Platforms that support Unix-style process suspension (SIGSTOP/SIGCONT)
const SUPPORTS_SUSPEND = process.platform !== 'win32';

// After this many milliseconds of stdin silence, the next chunk triggers
// a terminal mode re-assert (mouse tracking). Catches tmux detach→attach,
// ssh reconnect, and laptop wake — the terminal resets DEC private modes
// but no signal reaches us. 5s is well above normal inter-keystroke gaps
// but short enough that the first scroll after reattach works.
const STDIN_RESUME_GAP_MS = 5000;

type Props = {
  readonly children: ReactNode;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
  readonly exitOnCtrlC: boolean;
  readonly onExit: (error?: Error) => void;
  readonly terminalColumns: number;
  readonly terminalRows: number;
  /**
   * Official isScreenReaderEnabled / accessibilityMode — keep native cursor
   * visible for screen readers and magnifiers.
   */
  readonly isScreenReaderEnabled?: boolean;
  // Text selection state. App mutates this directly from mouse events
  // and calls onSelectionChange to trigger a repaint. Mouse events only
  // arrive when <AlternateScreen> (or similar) enables mouse tracking,
  // so the handler is always wired but dormant until tracking is on.
  readonly selection: SelectionState;
  readonly onSelectionChange: () => void;
  /** densable `onSelectionTakeDown` — announce BEFORE Il/clearSelection. */
  readonly onSelectionTakeDown: () => void;
  // Dispatch a click at (col, row) — hit-tests the DOM tree and bubbles
  // onClick handlers. Returns true if a DOM handler consumed the click.
  // No-op (returns false) outside fullscreen mode (Ink.dispatchClick
  // gates on altScreenActive).
  readonly onClickAt: (
    col: number,
    row: number,
    isWindowActivation?: boolean,
    mods?: { shift: boolean; alt: boolean; ctrl: boolean },
  ) => MouseClickResult;
  // Dispatch hover (onMouseEnter/onMouseLeave) as the pointer moves over
  // DOM elements. Called for mode-1003 motion events with no button held.
  // No-op outside fullscreen (Ink.dispatchHover gates on altScreenActive).
  readonly onHoverAt: (col: number, row: number) => void;
  readonly onHoverLost?: () => void;
  // Look up the OSC 8 hyperlink at (col, row) synchronously at click
  // time. Returns the URL or undefined. The browser-open is deferred by
  // MULTI_CLICK_TIMEOUT_MS so double-click can cancel it.
  readonly getHyperlinkAt: (col: number, row: number) => string | undefined;
  // Open a hyperlink URL in the browser. Called after the timer fires.
  readonly onOpenHyperlink: (url: string) => void;
  // Called on double/triple-click PRESS at (col, row). count=2 selects
  // the word under the cursor; count=3 selects the line. Ink reads the
  // screen buffer to find word/line boundaries and mutates selection,
  // setting isDragging=true so a subsequent drag extends by word/line.
  readonly onMultiClick: (col: number, row: number, count: 2 | 3) => void;
  /**
   * densable `onSelectionStart` — first left press. Ink implements
   * `startSelection` (official `Tp`; `Cy(rootNode)` scope unidentified).
   */
  readonly onSelectionStart: (col: number, row: number) => void;
  // Called on drag-motion. Mode-aware: char mode updates focus to the
  // exact cell; word/line mode snaps to word/line boundaries. Needs
  // screen-buffer access (word boundaries) so lives on Ink, not here.
  readonly onSelectionDrag: (col: number, row: number) => void;
  // Called when stdin data arrives after a >STDIN_RESUME_GAP_MS gap.
  // Ink re-asserts terminal modes: extended key reporting, and (when in
  // fullscreen) re-enters alt-screen + mouse tracking. Idempotent on the
  // terminal side. Optional so testing.tsx doesn't need to stub it.
  readonly onStdinResume?: () => void;
  /**
   * densable onRawModeEnter — Ink.ensureInteractive. Called once when raw mode
   * first enables (rawModeEnabledCount 0→1), before setRawMode(true).
   */
  readonly onRawModeEnter?: () => void;
  // Receives the declared native-cursor position from useDeclaredCursor
  // so ink.tsx can park the terminal cursor there after each frame.
  // Enables IME composition at the input caret and lets screen readers /
  // magnifiers track the input. Optional so testing.tsx doesn't stub it.
  readonly onCursorDeclaration?: CursorDeclarationSetter;
  // Dispatch a keyboard event through the DOM tree. Called for each
  // parsed key alongside the legacy EventEmitter path.
  readonly dispatchKeyboardEvent: (parsedKey: ParsedKey) => void;
  // Official densable lag: bracketed paste → PasteEvent on focused node.
  readonly dispatchPasteEvent: (text: string) => void;
  /**
   * densable `dispatchWheelEvent` — SGR wheel DOM path. Optional so
   * windowActivation stubs don't need it. Gold returns void; Yt capture
   * synthesizes wheelup/wheeldown unless eo.
   */
  readonly dispatchWheelEvent?: (parsedKey: ParsedKey) => void;
  /**
   * DualInk `Jhr` mouse-action bubble (grips / PluginClient onMouseDown).
   * Optional so windowActivation stubs don't need it. Return is unused for
   * consume — gold x1 consume is `onPointerPress` Xd.
   */
  readonly onMouseAction?: (
    col: number,
    row: number,
    button: number,
    type: 'mousedown' | 'mouseup' | 'mousedrag',
  ) => boolean | undefined;
  /**
   * densable `onPointerPress` — Xd + Wl kind down. True skips selection.
   */
  readonly onPointerPress?: (
    col: number,
    row: number,
    button: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    fine?: { col: number; row: number },
  ) => boolean;
  /**
   * densable `onPointerDrag` — captured node Wl kind move. True skips
   * selection-drag.
   */
  readonly onPointerDrag?: (
    col: number,
    row: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    fine?: { col: number; row: number },
  ) => boolean;
  /**
   * densable `onPointerRelease` — Wl kind up. True skips finishSelection.
   */
  readonly onPointerRelease?: (
    col: number,
    row: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    fine?: { col: number; row: number },
  ) => boolean;
  /**
   * densable Twe.focusManager / rootNode — provided via AppContext for lRc
   * reclaim and other Twe consumers (not getFocusManager(wrap)).
   */
  readonly focusManager: import('../core/focus.js').FocusManager;
  readonly rootNode: import('../core/dom.js').DOMElement;
  /**
   * densable `ib.subscribeClicks` — Ink clickListeners bus. Optional so
   * testing.tsx / windowActivation stubs don't need to wire it.
   */
  readonly subscribeClicks?: (
    listener: (
      node: import('../core/dom.js').DOMElement | null | undefined,
      event: import('../core/events/click-event.js').ClickEvent | null,
    ) => void,
  ) => () => void;
  /**
   * densable `ib.subscribeLayout` — Ink layoutListeners bus. Optional so
   * windowActivation stubs don't need to wire it.
   */
  readonly subscribeLayout?: (listener: () => void) => () => void;
  /**
   * densable `ib.subscribeFrames` — Ink frameListeners bus. Optional so
   * windowActivation stubs don't need to wire it.
   */
  readonly subscribeFrames?: (listener: () => void) => () => void;
  /**
   * densable `ib.subscribeHoverTracked` — Ink hoverTrackedListeners bus.
   */
  readonly subscribeHoverTracked?: (listener: () => void) => () => void;
  /**
   * densable Twe `isHoverTracked` — `altScreen && mouseTracking==="full"`.
   */
  readonly isHoverTracked?: () => boolean;
  /**
   * Official densable getMouseMode — "off" | "scroll" | "full".
   * Scroll mode skips click/drag selection (wheel still routes).
   */
  readonly getMouseMode?: () => MouseTrackingMode;
  /**
   * densable `mouseReportsInPixels` — true while DEC 1016 is live.
   */
  readonly mouseReportsInPixels?: () => boolean;
  /**
   * densable `onPointerHover` — DualInk Xd+Wl hover with optional `fine`.
   */
  readonly onPointerHover?: (
    col: number,
    row: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    fine?: { col: number; row: number },
  ) => boolean;
  /**
   * densable `retainFinePointer` — bump 1016 hold; returns release.
   */
  readonly retainFinePointer?: () => () => void;
  /**
   * densable `onCellPixels` — DualInk calls after `p1` so Ink can `syncMousePixels`.
   */
  readonly onCellPixels?: () => void;
};

// Multi-click detection thresholds. 500ms is the macOS default; a small
// position tolerance allows for trackpad jitter between clicks.
const MULTI_CLICK_TIMEOUT_MS = 500;
const MULTI_CLICK_DISTANCE = 1;
/** densable `yvf` — click-to-focus grace after `Jhf()`. */
export const WINDOW_ACTIVATION_GRACE_MS = 400;

/**
 * densable `macCmdClickArrivesWithoutSgrModifierBit` @209579069.
 * Ghostty/Warp on Darwin drop the Cmd SGR modifier bit.
 */
export function macCmdClickArrivesWithoutSgrModifierBit(): boolean {
  return (
    process.platform === 'darwin' &&
    (process.env.TERM_PROGRAM === 'ghostty' || process.env.TERM_PROGRAM === 'WarpTerminal')
  );
}

type ErrorInfo = {
  readonly message: string;
  readonly stack?: string;
};

type State = {
  readonly error?: ErrorInfo;
};

// Root component for all Ink apps
// It renders stdin and stdout contexts, so that children can access them if needed
// It also handles Ctrl+C exiting and cursor visibility
export default class App extends PureComponent<Props, State> {
  static displayName = 'InternalApp';

  static getDerivedStateFromError(error: Error) {
    return { error: { message: error.message, stack: error.stack } };
  }

  override state = {
    error: undefined,
  };

  /** densable `appUnmounted` — set first in componentWillUnmount. */
  appUnmounted = false;

  /**
   * densable `hasReleasedTerminal` — skip SIGCONT raw-mode restore after
   * unmount / shutdown commit / Ink unmount (kill-while-suspended).
   */
  get hasReleasedTerminal(): boolean {
    return (
      this.appUnmounted ||
      defaultCallbacks.isShutdownCommitted() ||
      instances.get(this.props.stdout)?.hasUnmounted === true
    );
  }

  // Count how many components enabled raw mode to avoid disabling
  // raw mode until all components don't need it anymore
  /**
   * densable `cellReprobe` — idle | asking | again. Overlapping p1 coalesces.
   */
  cellReprobe: 'idle' | 'asking' | 'again' = 'idle';

  /**
   * densable `p1` / `reprobeCellPixels` — CSI 16 t again when 1016 is capable.
   */
  reprobeCellPixels(): void {
    if (
      !(this.querier !== null && this.rawModeEnabledCount > 0 && !this.hasReleasedTerminal && getMousePixelsSupported())
    ) {
      return;
    }
    if (this.cellReprobe === 'idle') {
      this.cellReprobe = 'asking';
      void this.runCellReprobe();
      return;
    }
    this.cellReprobe = 'again';
  }

  /** densable `runCellReprobe`. */
  async runCellReprobe(): Promise<void> {
    if (this.querier) {
      await queryCellPixels(this.querier, message => {
        defaultCallbacks.logForDebugging(message);
      });
    }
    if (this.hasReleasedTerminal || !this.querier) return;
    this.props.onCellPixels?.();
    if (this.cellReprobe === 'again') {
      this.cellReprobe = 'asking';
      await this.runCellReprobe();
      return;
    }
    this.cellReprobe = 'idle';
  }

  rawModeEnabledCount = 0;

  internal_eventEmitter = new EventEmitter();
  keyParseState = INITIAL_STATE;
  // Official JediTerm input rewrite state (RJc / eag densables).
  jediTermInput = createJediTermInputState();
  arrowBurstWindow = createArrowBurstWindow();
  // Timer for flushing incomplete escape sequences / pending high-byte
  // CSI u UTF-8 reassembly (official 2.1.210 App densable).
  incompleteEscapeTimer: NodeJS.Timeout | null = null;
  /**
   * Deadline (performance.now()) for flushing a pending multi-byte UTF-8
   * reassembly run assembled from high-byte CSI u events. Official
   * `byteRunDeadlineAt` — without this, ESC[239u ESC[188u ESC[154u] split
   * across stdin chunks never completes if no further keys arrive, and a
   * later unrelated key flushes Latin-1 garbage instead of `：`.
   */
  byteRunDeadlineAt: number | null = null;
  /**
   * densable mousePrefixDropAt — deadline to Jyf-park a Qpr incomplete
   * SGR mouse prefix out of the tokenizer.
   */
  mousePrefixDropAt: number | null = null;
  /**
   * densable droppedPrefixDropAt — deadline to drop a parked
   * droppedMousePrefix if no completing chunk arrives.
   */
  droppedPrefixDropAt: number | null = null;
  // Timeout durations for incomplete sequences (ms)
  readonly NORMAL_TIMEOUT = 50; // Short timeout for regular esc sequences
  // Official 2.1.210 uses 2000ms for open paste brackets.
  readonly PASTE_TIMEOUT = 2000;
  /** densable MOUSE_PREFIX_TIMEOUT — hold split SGR mouse reports this long. */
  readonly MOUSE_PREFIX_TIMEOUT = 2000;

  // Gold: querier=stdout.isTTY&&stdin.isTTY?new jon(stdout):null
  querier = this.props.stdout.isTTY && this.props.stdin.isTTY ? new TerminalQuerier(this.props.stdout) : null;
  /** densable attachProbeDeferred — in-flight lock for daemon FOCUS_IN bv. */
  attachProbeDeferred = false;

  // Multi-click tracking for double/triple-click text selection. A click
  // within MULTI_CLICK_TIMEOUT_MS and MULTI_CLICK_DISTANCE of the previous
  // click increments clickCount; otherwise it resets to 1.
  lastClickTime = 0;
  lastClickCol = -1;
  lastClickRow = -1;
  clickCount = 0;
  /** densable `pressIsWindowActivation` — last left-press was click-to-focus. */
  pressIsWindowActivation = false;
  /** densable `windowActivationClickArmed` — next consume can mark activation. */
  windowActivationClickArmed = true;
  /** densable `lastActivationInputTime` — last latch consume / key (wall clock). */
  lastActivationInputTime = Number.NEGATIVE_INFINITY;
  // Deferred hyperlink-open timer — cancelled if a second click arrives
  // within MULTI_CLICK_TIMEOUT_MS (so double-clicking a hyperlink selects
  // the word without also opening the browser). DOM onClick dispatch is
  // NOT deferred — it returns true from onClickAt and skips this timer.
  pendingHyperlinkTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * densable `pendingHyperlinkOpensInPanel`. SEA schedules with `=!1`
   * and never assigns `=!0` — dblclick still gates `!opensInPanel`.
   */
  pendingHyperlinkOpensInPanel = false;
  // Last mode-1003 motion position. Terminals already dedupe to cell
  // granularity but this also lets us skip dispatchHover entirely on
  // repeat events (drag-then-release at same cell, etc.).
  lastHoverCol = -1;
  lastHoverRow = -1;
  lastHoverOnTarget = false;
  /**
   * densable `pendingPastePress` — middle/right paste fires on release (gold `E1`).
   * Gold `Os=1` is MULTI_CLICK_DISTANCE.
   */
  pendingPastePress: { button: number; col: number; row: number } | null = null;

  // Timestamp of last stdin chunk (performance.now(), same clock as
  // incompleteEscapeTimer / byteRunDeadlineAt — official 2.1.210 App).
  // Used to detect long gaps (tmux attach, ssh reconnect, laptop wake)
  // and trigger terminal mode re-assert. Initialized to now so startup
  // doesn't false-trigger.
  lastStdinTime = performance.now();

  // Determines if TTY is supported on the provided stdin
  isRawModeSupported(): boolean {
    return this.props.stdin.isTTY;
  }

  override render() {
    return (
      <TerminalSizeContext.Provider
        value={{
          columns: this.props.terminalColumns,
          rows: this.props.terminalRows,
        }}
      >
        <AppContext.Provider
          value={{
            exit: this.handleExit,
            focusManager: this.props.focusManager,
            rootNode: this.props.rootNode,
            dispatchPasteEvent: this.props.dispatchPasteEvent,
            subscribeLayout: this.props.subscribeLayout ?? (() => () => {}),
            subscribeFrames: this.props.subscribeFrames ?? (() => () => {}),
            subscribeClicks: this.props.subscribeClicks ?? (() => () => {}),
            isHoverTracked: this.props.isHoverTracked ?? (() => false),
            subscribeHoverTracked: this.props.subscribeHoverTracked ?? (() => () => {}),
            retainFinePointer: this.props.retainFinePointer ?? (() => () => {}),
          }}
        >
          <StdinContext.Provider
            value={{
              stdin: this.props.stdin,
              setRawMode: this.handleSetRawMode,
              isRawModeSupported: this.isRawModeSupported(),

              internal_exitOnCtrlC: this.props.exitOnCtrlC,

              internal_eventEmitter: this.internal_eventEmitter,
              internal_querier: this.querier,
            }}
          >
            <TerminalFocusProvider>
              <ClockProvider>
                <CursorDeclarationContext.Provider value={this.props.onCursorDeclaration ?? (() => {})}>
                  {this.state.error ? <ErrorOverview error={this.state.error} /> : this.props.children}
                </CursorDeclarationContext.Provider>
              </ClockProvider>
            </TerminalFocusProvider>
          </StdinContext.Provider>
        </AppContext.Provider>
      </TerminalSizeContext.Provider>
    );
  }

  override componentDidMount() {
    // Official: hide cursor unless accessibility / screen-reader mode.
    if (
      this.props.stdout.isTTY &&
      !this.props.isScreenReaderEnabled &&
      !isEnvTruthy(process.env.CLAUDE_CODE_ACCESSIBILITY)
    ) {
      this.props.stdout.write(HIDE_CURSOR);
    }
  }

  override componentWillUnmount() {
    this.appUnmounted = true;
    if (this.props.stdout.isTTY) {
      this.props.stdout.write(SHOW_CURSOR);
    }

    // Clear any pending timers
    if (this.incompleteEscapeTimer) {
      clearTimeout(this.incompleteEscapeTimer);
      this.incompleteEscapeTimer = null;
    }
    if (this.pendingHyperlinkTimer) {
      clearTimeout(this.pendingHyperlinkTimer);
      this.pendingHyperlinkTimer = null;
      this.pendingHyperlinkOpensInPanel = false;
    }
    // ignore calling setRawMode on an handle stdin it cannot be called
    if (this.isRawModeSupported()) {
      this.handleSetRawMode(false);
    } else {
      // Even when raw mode was never enabled (e.g. non-TTY stdin on
      // Windows Node.js), ensure stdin is unref'd so the process can
      // exit. earlyInput may have called ref() before Ink mounted.
      try {
        this.props.stdin.unref();
      } catch {
        // stdin may already be destroyed
      }
    }
  }

  override componentDidCatch(error: Error) {
    this.handleExit(error);
  }

  handleSetRawMode = (isEnabled: boolean): void => {
    const { stdin } = this.props;

    if (!this.isRawModeSupported()) {
      if (stdin === process.stdin) {
        throw new Error(
          'Raw mode is not supported on the current process.stdin, which Ink uses as input stream by default.\nRead about how to prevent this error on https://github.com/vadimdemedes/ink/#israwmodesupported',
        );
      } else {
        throw new Error(
          'Raw mode is not supported on the stdin provided to Ink.\nRead about how to prevent this error on https://github.com/vadimdemedes/ink/#israwmodesupported',
        );
      }
    }

    stdin.setEncoding('utf8');

    if (isEnabled) {
      // Ensure raw mode is enabled only once
      if (this.rawModeEnabledCount === 0) {
        // Stop early input capture right before we add our own readable handler.
        // Both use the same stdin 'readable' + read() pattern, so they can't
        // coexist -- the early capture handler would drain stdin before ours
        // can see it. The buffered text is preserved for REPL.tsx via consumeEarlyInput().
        defaultCallbacks.stopCapturingEarlyInput();

        // densable: this.props.onRawModeEnter?.() before ref/setRawMode —
        // attaches resize/SIGCONT + hides cursor (Ink.ensureInteractive).
        this.props.onRawModeEnter?.();

        // Safety net: remove any pre-existing readable listeners that aren't
        // ours. In builds where setAppCallbacks() was never called, the early
        // input capture's readableHandler remains attached and would consume
        // all stdin data before our handleReadable sees it.
        const existingListeners = stdin.listeners('readable');
        for (const listener of existingListeners) {
          if (listener !== this.handleReadable) {
            stdin.removeListener('readable', listener as any);
          }
        }

        stdin.ref();
        stdin.setRawMode(true);
        stdin.addListener('readable', this.handleReadable);
        // Enable bracketed paste mode
        this.props.stdout.write(EBP);
        // Enable terminal focus reporting (DECSET 1004)
        this.props.stdout.write(EFE);
        // Enable extended key reporting so ctrl+shift+<letter> is
        // distinguishable from ctrl+<letter>. We write both the kitty stack
        // push (CSI >1u) and xterm modifyOtherKeys level 2 (CSI >4;2m) —
        // terminals honor whichever they implement (tmux only accepts the
        // latter).
        if (supportsExtendedKeys()) {
          this.props.stdout.write(ENABLE_KITTY_KEYBOARD);
          this.props.stdout.write(ENABLE_MODIFY_OTHER_KEYS);
        }
        // Gold 251: non-daemon first raw-mode runs full bv (XTVERSION+DECRQM).
        // Daemon waits for FOCUS_IN attachProbeDeferred / Rlt then bv.
        if (process.env.CLAUDE_BG_BACKEND !== 'daemon') {
          setImmediate(() => {
            if (this.querier && !this.hasReleasedTerminal) {
              void probeTerminalIdentity(this.querier, message => {
                defaultCallbacks.logForDebugging(message);
              }).then(() => {
                instances.get(this.props.stdout)?.syncMousePixels();
              });
            }
          });
        }
      }

      this.rawModeEnabledCount++;
      return;
    }

    // Disable raw mode only when no components left that are using it
    if (--this.rawModeEnabledCount === 0) {
      // Guard: React 19 runs new useLayoutEffect setup before old cleanup when
      // replacing the tree (e.g., showSetupDialog → launchResumeChooser).
      // If the old tree had more useInput hooks than the new tree, the old
      // cleanup over-decrements the count to 0 even though the new tree has
      // active listeners. Detect this and fix the count instead of disabling.
      const activeListeners = this.internal_eventEmitter.listenerCount('input');
      if (activeListeners > 0) {
        this.rawModeEnabledCount = activeListeners;
        return;
      }

      this.props.stdout.write(DISABLE_MODIFY_OTHER_KEYS);
      this.props.stdout.write(DISABLE_KITTY_KEYBOARD);
      // Disable terminal focus reporting (DECSET 1004)
      this.props.stdout.write(DFE);
      // Disable bracketed paste mode
      this.props.stdout.write(DBP);
      if (!instances.get(this.props.stdout)?.isHandoffRawMode) {
        stdin.setRawMode(false);
      }
      stdin.removeListener('readable', this.handleReadable);
      stdin.unref();
    }
  };

  // Helper to flush incomplete escape sequences and pending high-byte CSI u
  // UTF-8 reassembly. Aligned with official 2.1.210 App densable.
  flushIncomplete = (): void => {
    // Clear the timer reference
    this.incompleteEscapeTimer = null;

    const hasIncomplete = Boolean(this.keyParseState.incomplete);
    const hasPendingBytes = (this.keyParseState.pendingByteEvents?.length ?? 0) > 0;
    const inPaste = this.keyParseState.mode === 'IN_PASTE';

    // Only proceed if we have incomplete sequences, open paste, or a
    // half-assembled multi-byte UTF-8 run from high-byte CSI u events.
    // Official densable App: no ESC-less orphan-SGR hold.
    if (!hasIncomplete && !inPaste && !hasPendingBytes) return;

    // Fullscreen: if stdin has data waiting, it's almost certainly the
    // continuation of the buffered sequence (e.g. `[<64;74;16M` after a
    // lone ESC). Node's event loop runs the timers phase before the poll
    // phase, so when a heavy render blocks the loop past 50ms, this timer
    // fires before the queued readable event even though the bytes are
    // already buffered. Re-arm instead of flushing: handleReadable will
    // drain stdin next and clear this timer. Prevents both the spurious
    // Escape key and the lost scroll event.
    if (this.props.stdin.readableLength > 0) {
      this.incompleteEscapeTimer = setTimeout(this.flushIncomplete, this.NORMAL_TIMEOUT);
      return;
    }

    // densable Jyf: park Qpr incomplete SGR prefix after mousePrefixDropAt.
    if (
      this.mousePrefixDropAt !== null &&
      performance.now() >= this.mousePrefixDropAt &&
      this.keyParseState.mode !== 'IN_PASTE' &&
      isHeldSgrMousePrefix(this.keyParseState.incomplete)
    ) {
      this.keyParseState = parkIncompleteMousePrefix(this.keyParseState);
      this.mousePrefixDropAt = null;
      this.droppedPrefixDropAt = performance.now() + this.MOUSE_PREFIX_TIMEOUT;
    }

    // Official: if only an incomplete ESC sequence remains, recompute the
    // remaining timeout from lastStdinTime so a blocked event loop doesn't
    // flush early relative to the intended NORMAL/PASTE window.
    // Re-read after Jyf — parked prefix must not re-arm the 50ms window.
    if (this.keyParseState.incomplete) {
      const budget = this.keyParseState.mode === 'IN_PASTE' ? this.PASTE_TIMEOUT : this.NORMAL_TIMEOUT;
      const remaining = budget - (performance.now() - this.lastStdinTime);
      if (remaining > 0) {
        this.incompleteEscapeTimer = setTimeout(this.flushIncomplete, remaining);
        return;
      }
    }

    // Process incomplete / pending bytes as a flush operation (input=null).
    // This reuses all existing parsing logic (including pendingByteEvents).
    this.processInput(null);
  };

  // Process input through the parser and handle the results
  processInput = (input: string | Buffer | null): void => {
    // densable: expire parked droppedMousePrefix / flushedEscapePrefix after droppedPrefixDropAt.
    if (
      this.droppedPrefixDropAt !== null &&
      performance.now() >= this.droppedPrefixDropAt &&
      (this.keyParseState.droppedMousePrefix || this.keyParseState.flushedEscapePrefix)
    ) {
      this.keyParseState = { ...this.keyParseState, droppedMousePrefix: '', flushedEscapePrefix: '' };
      this.droppedPrefixDropAt = null;
    }
    // Parse input using our state machine
    const prevState = this.keyParseState;
    const [keys, newState] = parseMultipleKeypresses(this.keyParseState, input);
    this.keyParseState = newState;

    // Process ALL keys in a SINGLE discreteUpdates call to prevent
    // "Maximum update depth exceeded" error when many keys arrive at once
    // (e.g., from paste operations or holding keys rapidly).
    // This batches all state updates from handleInput and all useInput
    // listeners together within one high-priority update context.
    if (keys.length > 0) {
      reconciler.discreteUpdates(processKeysInBatch, this, keys, undefined, undefined);
    }

    // Official 2.1.210: arm / clear the high-byte UTF-8 reassembly deadline
    // and a single timer covering incomplete ESC, open paste, or pending
    // multi-byte CSI u fragments.
    // Note: parseMultipleKeypresses always returns a new pendingByteEvents
    // array (spread copy), so we cannot use reference inequality like
    // official densable (`t.pendingByteEvents !== i`). Extend the deadline
    // only when the reassembly run grows or is newly started.
    const now = performance.now();
    const pending = this.keyParseState.pendingByteEvents ?? [];
    const prevPendingLen = prevState.pendingByteEvents?.length ?? 0;
    if (pending.length === 0) {
      this.byteRunDeadlineAt = null;
    } else if (pending.length > prevPendingLen || this.byteRunDeadlineAt === null) {
      // New or extended reassembly run — give it NORMAL_TIMEOUT to complete.
      this.byteRunDeadlineAt = now + this.NORMAL_TIMEOUT;
    }

    // densable: arm / extend mousePrefixDropAt while Qpr(incomplete).
    if (this.keyParseState.mode !== 'IN_PASTE' && isHeldSgrMousePrefix(this.keyParseState.incomplete)) {
      if (
        !(
          this.mousePrefixDropAt !== null &&
          isHeldSgrMousePrefix(prevState.incomplete) &&
          this.keyParseState.incomplete.startsWith(prevState.incomplete)
        )
      ) {
        this.mousePrefixDropAt = now + this.MOUSE_PREFIX_TIMEOUT;
      }
    } else {
      this.mousePrefixDropAt = null;
    }
    if (this.keyParseState.droppedMousePrefix || this.keyParseState.flushedEscapePrefix) {
      if (!prevState.droppedMousePrefix && !prevState.flushedEscapePrefix) {
        this.droppedPrefixDropAt = now + this.MOUSE_PREFIX_TIMEOUT;
      }
    } else {
      this.droppedPrefixDropAt = null;
    }

    if (this.incompleteEscapeTimer) {
      clearTimeout(this.incompleteEscapeTimer);
      this.incompleteEscapeTimer = null;
    }

    // Official densable App: PASTE_TIMEOUT for open paste; Qpr incomplete
    // waits until mousePrefixDropAt (not 50ms); else NORMAL_TIMEOUT.
    const incompleteOrPasteMs =
      this.keyParseState.incomplete || this.keyParseState.mode === 'IN_PASTE'
        ? this.keyParseState.mode === 'IN_PASTE'
          ? this.PASTE_TIMEOUT
          : this.mousePrefixDropAt !== null
            ? Math.max(0, this.mousePrefixDropAt - now)
            : this.NORMAL_TIMEOUT
        : null;
    // Don't race paste with a byte-run deadline (paste may legitimately
    // pause longer than NORMAL_TIMEOUT between high-byte fragments).
    const byteRunMs =
      this.byteRunDeadlineAt === null || this.keyParseState.mode === 'IN_PASTE'
        ? null
        : Math.max(0, this.byteRunDeadlineAt - now);

    let waitMs: number | null;
    if (incompleteOrPasteMs === null) {
      waitMs = byteRunMs;
    } else if (byteRunMs === null) {
      waitMs = incompleteOrPasteMs;
    } else {
      waitMs = Math.min(incompleteOrPasteMs, byteRunMs);
    }

    if (waitMs !== null) {
      this.incompleteEscapeTimer = setTimeout(this.flushIncomplete, waitMs);
    }
  };

  handleReadable = (): void => {
    // Detect long stdin gaps (tmux attach, ssh reconnect, laptop wake).
    // The terminal may have reset DEC private modes; re-assert mouse
    // tracking. Checked before the read loop so one performance.now()
    // covers all chunks in this readable event (official 2.1.210).
    const now = performance.now();
    if (now - this.lastStdinTime > STDIN_RESUME_GAP_MS) {
      this.props.onStdinResume?.();
    }
    this.lastStdinTime = now;
    try {
      let chunk;
      while ((chunk = this.props.stdin.read() as string | null) !== null) {
        // Process the input chunk
        this.processInput(chunk);
      }
    } catch (error) {
      // In Bun, an uncaught throw inside a stream 'readable' handler can
      // permanently wedge the stream: data stays buffered and 'readable'
      // never re-emits. Catching here ensures the stream stays healthy so
      // subsequent keystrokes are still delivered.
      defaultCallbacks.logError(error);

      // Re-attach the listener in case the exception detached it.
      // Bun may remove the listener after an error; without this,
      // the session freezes permanently (stdin reader dead, event loop alive).
      const { stdin } = this.props;
      if (this.rawModeEnabledCount > 0 && !stdin.listeners('readable').includes(this.handleReadable)) {
        defaultCallbacks.logForDebugging('handleReadable: re-attaching stdin readable listener after error recovery', {
          level: 'warn',
        });
        stdin.addListener('readable', this.handleReadable);
      }
    }
  };

  handleInput = (input: string | undefined): void => {
    // Exit on Ctrl+C
    if (input === '\x03' && this.props.exitOnCtrlC) {
      this.handleExit();
    }

    // Note: Ctrl+Z (suspend) is now handled in processKeysInBatch using the
    // parsed key to support both raw (\x1a) and CSI u format from Kitty
    // keyboard protocol terminals (Ghostty, iTerm2, kitty, WezTerm)
  };

  handleExit = (error?: Error): void => {
    if (this.isRawModeSupported()) {
      this.handleSetRawMode(false);
    }

    this.props.onExit(error);
  };

  /**
   * densable `consumeWindowActivationLatch` — records input time and
   * consumes the one-shot armed flag. Returns true if this input may be
   * the click that focused the window.
   */
  consumeWindowActivationLatch(now: number): boolean {
    this.lastActivationInputTime = now;
    if (!this.windowActivationClickArmed) return false;
    this.windowActivationClickArmed = false;
    return true;
  }

  handleTerminalFocus = (isFocused: boolean): void => {
    // Gold 251: if(!t||Date.now()-lastActivationInputTime>=xv) armed=!0
    //   Pgn(t); t&&prev==="blurred" → proactiveAtlasResetOnFocus
    //   daemon && querier && !attachProbeDeferred → Rlt().then(bv)
    // densable does NOT repaintAfterFocus / forceRedraw on FOCUS_IN.
    const prev = getTerminalFocusState();
    if (!isFocused || Date.now() - this.lastActivationInputTime >= WINDOW_ACTIVATION_GRACE_MS) {
      this.windowActivationClickArmed = true;
    }
    setTerminalFocused(isFocused);
    if (isFocused && prev === 'blurred') {
      this.reprobeCellPixels();
      instances.get(this.props.stdout)?.proactiveAtlasResetOnFocus();
    }
    if (isFocused && process.env.CLAUDE_BG_BACKEND === 'daemon' && this.querier && !this.attachProbeDeferred) {
      this.attachProbeDeferred = true;
      void waitUntilAttachStable().then(() => {
        this.attachProbeDeferred = false;
        if (this.querier && !this.hasReleasedTerminal) {
          void probeTerminalIdentity(this.querier, message => {
            defaultCallbacks.logForDebugging(message);
          }).then(() => {
            instances.get(this.props.stdout)?.syncMousePixels();
          });
        }
      });
    }
  };

  handleSuspend = (): void => {
    if (!this.isRawModeSupported()) {
      return;
    }

    // Store the exact raw mode count to restore it properly
    const rawModeCountBeforeSuspend = this.rawModeEnabledCount;

    // Completely disable raw mode before suspending
    while (this.rawModeEnabledCount > 0) {
      this.handleSetRawMode(false);
    }

    // Show cursor, disable focus reporting, and disable mouse tracking
    // before suspending. DISABLE_MOUSE_TRACKING is a no-op if tracking
    // wasn't enabled, so it's safe to emit unconditionally — without
    // it, SGR mouse sequences would appear as garbled text at the
    // shell prompt while suspended.
    if (this.props.stdout.isTTY) {
      this.props.stdout.write(SHOW_CURSOR + DFE + DISABLE_MOUSE_TRACKING);
    }

    // Emit suspend event for Claude Code to handle. Mostly just has a notification
    this.internal_eventEmitter.emit('suspend');

    // Set up resume handler
    const resumeHandler = () => {
      process.removeListener('SIGCONT', resumeHandler);
      // densable: if(this.hasReleasedTerminal)return — kill-while-suspended
      // must not re-enable raw mode / hide cursor after shutdown cleanup.
      if (this.hasReleasedTerminal) {
        return;
      }
      // Restore raw mode to exact previous state
      for (let i = 0; i < rawModeCountBeforeSuspend; i++) {
        if (this.isRawModeSupported()) {
          this.handleSetRawMode(true);
        }
      }

      // Hide cursor (unless in accessibility / screen-reader mode) and re-enable focus reporting after resuming
      if (this.props.stdout.isTTY) {
        if (!this.props.isScreenReaderEnabled && !isEnvTruthy(process.env.CLAUDE_CODE_ACCESSIBILITY)) {
          this.props.stdout.write(HIDE_CURSOR);
        }
        // Re-enable focus reporting to restore terminal state
        this.props.stdout.write(EFE);
      }

      // Emit resume event for Claude Code to handle
      this.internal_eventEmitter.emit('resume');
    };

    process.on('SIGCONT', resumeHandler);
    // densable: process.kill(0, "SIGTSTP") — group TSTP, not SIGSTOP on pid.
    process.kill(0, 'SIGTSTP');
  };
}

// Helper to process all keys within a single discrete update context.
// discreteUpdates expects (fn, a, b, c, d) -> fn(a, b, c, d)
function processKeysInBatch(app: App, items: ParsedInput[], _unused1: undefined, _unused2: undefined): void {
  // Official Xsg densable order: RJc (JediTerm rewrite) then eag (arrow-burst).
  const now = performance.now();
  const rewritten = rewriteJediTermInput(app.jediTermInput, items, now, () => {
    app.internal_eventEmitter.emit('jediterm-scroll-bug');
  });
  const burst = trackArrowBurst(app.arrowBurstWindow, rewritten, now);
  if (burst) {
    app.internal_eventEmitter.emit('arrow-burst', burst);
    app.props.onStdinResume?.();
  }
  items = rewritten;

  // Update interaction time for notification timeout tracking.
  // This is called from the central input handler to avoid having multiple
  // stdin listeners that can cause race conditions and dropped input.
  // Terminal responses (kind: 'response') are automated, not user input.
  // Mode-1003 no-button motion is also excluded — passive cursor drift is
  // not engagement (would suppress idle notifications + defer housekeeping).
  if (
    items.some(i => i.kind === 'key' || (i.kind === 'mouse' && !((i.button & 0x20) !== 0 && (i.button & 0x03) === 3)))
  ) {
    defaultCallbacks.updateLastInteractionTime();
  }

  for (const item of items) {
    // Terminal responses (DECRPM, DA1, OSC replies, etc.) are not user
    // input — route them to the querier to resolve pending promises.
    if (item.kind === 'response') {
      app.querier?.onResponse(item.response);
      continue;
    }

    // Mouse click/drag events update selection state (fullscreen only).
    // Terminal sends 1-indexed col/row; convert to 0-indexed for the
    // screen buffer. Button bit 0x20 = drag (motion while button held).
    if (item.kind === 'mouse') {
      // densable: press && !Yd(button) && !cAe() → handleTerminalFocus(true)
      // Gold Yd = (button&32)!==0 && (button&3)===3; cAe = terminalFocus!=="blurred".
      if (
        item.action === 'press' &&
        !((item.button & 0x20) !== 0 && (item.button & 0x03) === 3) &&
        !getTerminalFocused()
      ) {
        app.handleTerminalFocus(true);
      }
      // Official densable: getMouseMode()==="scroll" skips left-button click
      // handling (button&3===0) so selection/cursor don't fight wheel-only mode.
      const mode = app.props.getMouseMode?.() ?? 'full';
      if (mode === 'scroll' && (item.button & 3) === 0) {
        app.pendingPastePress = null;
        continue;
      }
      handleMouseEvent(app, item);
      continue;
    }

    const sequence = item.sequence;

    // Handle terminal focus events (DECSET 1004)
    if (sequence === FOCUS_IN) {
      app.handleTerminalFocus(true);
      const event = new TerminalFocusEvent('terminalfocus');
      app.internal_eventEmitter.emit('terminalfocus', event);
      continue;
    }
    if (sequence === FOCUS_OUT) {
      app.handleTerminalFocus(false);
      // Defensive: if we lost the release event (mouse released outside
      // terminal window — some emulators drop it rather than capturing the
      // pointer), focus-out is the next observable signal that the drag is
      // over. Without this, drag-to-scroll's timer runs until the scroll
      // boundary is hit.
      if (app.props.selection.isDragging) {
        finishSelection(app.props.selection);
        app.props.onSelectionChange();
      }
      const event = new TerminalFocusEvent('terminalblur');
      app.internal_eventEmitter.emit('terminalblur', event);
      continue;
    }

    // Failsafe: if we receive input, the terminal must be focused.
    // densable: non-wheel/non-mouse also consumeWindowActivationLatch.
    if (!getTerminalFocused()) {
      setTerminalFocused(true);
    }
    app.consumeWindowActivationLatch(Date.now());

    // Handle Ctrl+Z (suspend) using parsed key to support both raw (\x1a) and
    // CSI u format (\x1b[122;5u) from Kitty keyboard protocol terminals
    if (item.name === 'z' && item.ctrl && SUPPORTS_SUSPEND) {
      app.handleSuspend();
      continue;
    }

    // Official densable lag (2.1.210):
    //   if (!isPasted) handleInput(seq)          // only exitOnCtrlC side-effect
    //   if (isPasted) dispatchPasteEvent(seq)
    //   else if (wheel/mouse) dispatchWheelEvent  // NEVER keydown
    //   else dispatchKeyboardEvent
    // Bracketed paste is a separate PasteEvent — never keydown insert.
    // Keyboard InputEvent is Yt `G` (kmo + L). Wheel InputEvent is Yt `N`.
    // Mouse still emits InputEvent here (no Yt analog).
    if (!item.isPasted) {
      app.handleInput(sequence);
    }
    if (item.isPasted) {
      app.props.dispatchPasteEvent(item.sequence ?? '');
      continue;
    }
    // Official: wheel/mouse never enter KeyboardEvent / insert path.
    // densable: no post-wheel multi-key absorb of lone M/m.
    // parse-keypress kTd = whole-token re-ESC only; incomplete CSI lives in
    // tokenizer.buffer() until NORMAL_TIMEOUT flush. Progressive desync residue
    // empties in KeyboardEvent xM_ / isSgrMouseResidue (fork under-strip).
    if (item.name === 'wheelup' || item.name === 'wheeldown' || item.name === 'mouse') {
      // densable lag: wheel → dispatchWheelEvent only (never InputEvent).
      // Yt onWheelCapture synthesizes wheelup/wheeldown unless eo.
      if (item.name !== 'mouse') {
        app.props.dispatchWheelEvent?.(convertWheelIfPixels(app, item));
        continue;
      }
      const event = new InputEvent(item);
      app.internal_eventEmitter.emit('input', event);
      continue;
    }
    // Official: keyboard DOM path (onKeyDown / focus tree).
    // densable Yt `G` (kmo + L) is the InputEvent source — not a second emit here.
    app.props.dispatchKeyboardEvent(item);
  }
}

/**
 * densable `Qx`/`Fd` — pixel SGR → 1-indexed cells + unfloored `fine`.
 * `Math.max(1, Math.floor(n/f.width)+1)` analog.
 */
export function pixelToCellCoords(
  n: number,
  u: number,
  f: { width: number; height: number },
): { col: number; row: number; fine: { col: number; row: number } } {
  const fine = { col: n / f.width, row: u / f.height };
  return {
    col: Math.max(1, Math.floor(fine.col) + 1),
    row: Math.max(1, Math.floor(fine.row) + 1),
    fine,
  };
}

/** densable `b1` — rewrite ParsedMouse when DEC 1016 is live. */
function convertMouseIfPixels(app: App, u: ParsedMouse): ParsedMouse {
  const f = getCellPixels();
  if (!app.props.mouseReportsInPixels?.() || f === undefined) return u;
  return { ...u, ...pixelToCellCoords(u.col, u.row, f) };
}

/** densable `S1` — wheel col/row via Fd, drop fine. */
function convertWheelIfPixels(app: App, u: ParsedKey): ParsedKey {
  const f = getCellPixels();
  const { col, row } = u;
  if (!app.props.mouseReportsInPixels?.() || f === undefined || col === undefined || row === undefined) {
    return u;
  }
  const g = pixelToCellCoords(col, row, f);
  return { ...u, col: g.col, row: g.row };
}

/**
 * densable `E1` — consume `pendingPastePress` on release.
 * Match stored button or X10 `button===3`; distance gold `Os=1`.
 */
function consumePendingMousePaste(app: App, baseButton: number, col: number, row: number): void {
  const pending = app.pendingPastePress;
  app.pendingPastePress = null;
  if (
    pending == null ||
    (baseButton !== pending.button && baseButton !== 3) ||
    Math.abs(col - pending.col) > MULTI_CLICK_DISTANCE ||
    Math.abs(row - pending.row) > MULTI_CLICK_DISTANCE
  ) {
    return;
  }
  const sel = app.props.selection;
  const platform = _getClipboardHostPlatform();
  if (pending.button === 2 && (platform === 'windows' || platform === 'wsl' || platform === 'linux')) {
    if (hasSelection(sel)) {
      app.props.onSelectionTakeDown();
      clearSelection(sel);
      app.props.onSelectionChange();
    } else if (!isXtermJs()) {
      void readNativeClipboard('clipboard').then(text => {
        if (text) app.props.dispatchPasteEvent(text);
      });
    }
  } else if (pending.button === 1 && platform === 'linux') {
    void readNativeClipboard('primary').then(text => {
      if (text) app.props.dispatchPasteEvent(text);
    });
  }
}

/** densable `Ir` — SGR button bits 0x04/0x08/0x10. */
function sgrButtonMods(button: number): { shift: boolean; alt: boolean; ctrl: boolean } {
  return {
    shift: (button & 4) !== 0,
    alt: (button & 8) !== 0,
    ctrl: (button & 16) !== 0,
  };
}

/** Exported for testing. Mutates app.props.selection and click/hover state. */
export function handleMouseEvent(app: App, m: ParsedMouse): void {
  // Allow disabling click handling while keeping wheel scroll (which goes
  // through the keybinding system as 'wheelup'/'wheeldown', not here).
  if (defaultCallbacks.isMouseClicksDisabled()) return;

  // densable `x1(n,b1(n,T))` — convert pixel SGR before the 1-indexed → 0-indexed step.
  m = convertMouseIfPixels(app, m);

  const sel = app.props.selection;
  // Terminal coords are 1-indexed; screen buffer is 0-indexed
  const col = m.col - 1;
  const row = m.row - 1;
  const baseButton = m.button & 0x03;
  // densable `Yd`: press + motion + no button. Gold `x1` returns before DualInk press/drag.
  const isHoverMotion = m.action === 'press' && (m.button & 0x20) !== 0 && baseButton === 3;
  // densable x1: DualInk Jhr still fires; consume is onPointerPress/Drag/Release (Xd).
  // Gold packs left as `0` and middle/right as `g=button&3`; mods via `Ir(u.button)`.
  const consumeDualInk = (type: 'mousedown' | 'mouseup' | 'mousedrag'): boolean => {
    app.props.onMouseAction?.(col, row, m.button, type);
    const mods = sgrButtonMods(m.button);
    if (type === 'mousedown') {
      return app.props.onPointerPress?.(col, row, baseButton, mods, m.fine) === true;
    }
    if (type === 'mousedrag') {
      return app.props.onPointerDrag?.(col, row, mods, m.fine) === true;
    }
    return app.props.onPointerRelease?.(col, row, mods, m.fine) === true;
  };
  if (!isHoverMotion && app.lastHoverCol !== -1 && (col !== app.lastHoverCol || row !== app.lastHoverRow)) {
    app.lastHoverCol = -1;
    app.lastHoverRow = -1;
    app.lastHoverOnTarget = false;
    app.props.onHoverLost?.();
  }

  if (m.action === 'press') {
    if (isHoverMotion) {
      // Mode-1003 motion with no button held. Dispatch hover; skip the
      // rest of this handler (no selection, no click-count side effects).
      // Lost-release recovery: no-button motion while isDragging=true means
      // the release happened outside the terminal window (iTerm2 doesn't
      // capture the pointer past window bounds, so the SGR 'm' never
      // arrives). Finish the selection here so copy-on-select fires. The
      // FOCUS_OUT handler covers the "switched apps" case but not "released
      // past the edge, came back" — and tmux drops focus events unless
      // `focus-events on` is set, so this is the more reliable signal.
      if (sel.isDragging) {
        finishSelection(sel);
        app.props.onSelectionChange();
      }
      const sameCell = col === app.lastHoverCol && row === app.lastHoverRow;
      if (!sameCell) {
        app.lastHoverCol = col;
        app.lastHoverRow = row;
        app.props.onHoverAt(col, row);
      }
      // densable x1: if (!M || u.fine!==void 0 && n.lastHoverOnTarget)
      if (!sameCell || (m.fine !== undefined && app.lastHoverOnTarget)) {
        app.lastHoverOnTarget = app.props.onPointerHover?.(col, row, sgrButtonMods(m.button), m.fine) ?? false;
      }
      return;
    }
    // densable x1: non-motion clears a leftover pending paste (left press cancels).
    if ((m.button & 0x20) === 0) {
      app.pendingPastePress = null;
    }
    // densable x1: DualInk drag consume before selection-drag / non-left paste.
    if ((m.button & 0x20) !== 0 && consumeDualInk('mousedrag')) return;
    if (baseButton !== 0) {
      // densable x1 comma: `clickCount=0,(u.button&32)===0&&(g===1||g===2)&&onPointerPress`.
      app.clickCount = 0;
      if ((m.button & 0x20) === 0 && (baseButton === 1 || baseButton === 2) && consumeDualInk('mousedown')) {
        return;
      }
      if ((m.button & 0x20) === 0) {
        app.consumeWindowActivationLatch(Date.now());
      }
      // densable x1: store middle/right press; gold `E1` pastes on release.
      if ((m.button & 0x20) === 0 && (baseButton === 1 || baseButton === 2)) {
        app.pendingPastePress = { button: baseButton, col, row };
      }
      return;
    }
    if ((m.button & 0x20) !== 0) {
      // Drag motion: mode-aware extension (char/word/line). onSelectionDrag
      // calls notifySelectionChange internally — no extra onSelectionChange.
      app.props.onSelectionDrag(col, row);
      return;
    }
    // Lost-release fallback for mode-1002-only terminals: a fresh press
    // while isDragging=true means the previous release was dropped (cursor
    // left the window). Finish that selection so copy-on-select fires
    // before startSelection/onMultiClick clobbers it. Mode-1003 terminals
    // hit the no-button-motion recovery above instead, so this is rare.
    if (sel.isDragging) {
      finishSelection(sel);
      app.props.onSelectionChange();
    }
    // densable x1: onPointerPress left → clickCount=0; return (no selection).
    if (consumeDualInk('mousedown')) {
      app.clickCount = 0;
      return;
    }
    // Fresh left press. Detect multi-click HERE (not on release) so the
    // word/line highlight appears immediately and a subsequent drag can
    // extend by word/line like native macOS. Previously detected on
    // release, which meant (a) visible latency before the word highlights
    // and (b) double-click+drag fell through to char-mode selection.
    const now = Date.now();
    // densable: pressIsWindowActivation = consumeLatch(now) && now-Jhf()<yvf
    app.pressIsWindowActivation =
      app.consumeWindowActivationLatch(now) && now - getTerminalFocusGainedAt() < WINDOW_ACTIVATION_GRACE_MS;
    if (app.pressIsWindowActivation) {
      app.clickCount = 0;
    } else {
      const nearLast =
        now - app.lastClickTime < MULTI_CLICK_TIMEOUT_MS &&
        Math.abs(col - app.lastClickCol) <= MULTI_CLICK_DISTANCE &&
        Math.abs(row - app.lastClickRow) <= MULTI_CLICK_DISTANCE;
      app.clickCount = nearLast ? app.clickCount + 1 : 1;
      app.lastClickTime = now;
      app.lastClickCol = col;
      app.lastClickRow = row;
    }
    if (app.clickCount >= 2) {
      // densable: cancel unless pendingHyperlinkOpensInPanel
      if (app.pendingHyperlinkTimer && !app.pendingHyperlinkOpensInPanel) {
        clearTimeout(app.pendingHyperlinkTimer);
        app.pendingHyperlinkTimer = null;
      }
      // Cap at 3 (line select) for quadruple+ clicks.
      const count = app.clickCount === 2 ? 2 : 3;
      app.props.onMultiClick(col, row, count);
      return;
    }
    app.props.onSelectionStart(col, row);
    // SGR bit 0x08 = alt (xterm.js wires altKey here, not metaKey — see
    // comment at the hyperlink-open guard below). On macOS xterm.js,
    // receiving alt means macOptionClickForcesSelection is OFF (otherwise
    // xterm.js would have consumed the event for native selection).
    sel.lastPressHadAlt = (m.button & 0x08) !== 0;
    app.props.onSelectionChange();
    return;
  }

  // densable x1: gold `E1` then onPointerRelease. Paste on release, not press.
  consumePendingMousePaste(app, baseButton, col, row);
  if (consumeDualInk('mouseup')) return;

  // Release: end the drag even for non-zero button codes. Some terminals
  // encode release with the motion bit or button=3 "no button" (carried
  // over from pre-SGR X10 encoding) — filtering those would orphan
  // isDragging=true and leave drag-to-scroll's timer running until the
  // scroll boundary. Only act on non-left releases when we ARE dragging
  // (so an unrelated middle/right click-release doesn't touch selection).
  if (baseButton !== 0) {
    if (!sel.isDragging) return;
    finishSelection(sel);
    app.props.onSelectionChange();
    return;
  }
  finishSelection(sel);
  // NOTE: unlike the old release-based detection we do NOT reset clickCount
  // on release-after-drag. This aligns with NSEvent.clickCount semantics:
  // an intervening drag doesn't break the click chain. Practical upside:
  // trackpad jitter during an intended double-click (press→wobble→release
  // →press) now correctly resolves to word-select instead of breaking to a
  // fresh single click. The nearLast window (500ms, 1 cell) bounds the
  // effect — a deliberate drag past that just starts a fresh chain.
  // A press+release with no drag in char mode is a click: anchor set,
  // focus null → hasSelection false. In word/line mode the press already
  // set anchor+focus (hasSelection true), so release just keeps the
  // highlight. The anchor check guards against an orphaned release (no
  // prior press — e.g. button was held when mouse tracking was enabled).
  if (!hasSelection(sel) && sel.anchor) {
    // Single click: dispatch DOM click immediately (cursor repositioning
    // etc. are latency-sensitive). If no DOM handler consumed it, defer
    // the hyperlink check so a second click can cancel it.
    const clickResult = app.props.onClickAt(col, row, app.pressIsWindowActivation, sgrButtonMods(m.button));
    if (clickResult === 'stray' || clickResult === 'repeat') {
      app.clickCount = 0;
      app.lastClickTime = 0;
    }
    if (clickResult === 'unhandled' && !app.pressIsWindowActivation) {
      // Resolve the hyperlink URL synchronously while the screen buffer
      // still reflects what the user clicked — deferring only the
      // browser-open so double-click can cancel it.
      const url = app.props.getHyperlinkAt(col, row);
      // xterm.js (VS Code, Cursor, Windsurf, etc.) has its own OSC 8 link
      // handler that fires on Cmd+click *without consuming the mouse event*
      // (Linkifier._handleMouseUp calls link.activate() but never
      // preventDefault/stopPropagation). The click is also forwarded to the
      // pty as SGR, so both VS Code's terminalLinkManager AND our handler
      // here would open the URL — twice. We can't filter on Cmd: xterm.js
      // drops metaKey before SGR encoding (ICoreMouseEvent has no meta
      // field; the SGR bit we call 'meta' is wired to alt). Let xterm.js
      // own link-opening; Cmd+click is the native UX there anyway.
      // densable: url && TERM_PROGRAM!=="vscode" && !xi() &&
      //   ((button&24)!==0 || macCmdClick() || ME())
      // ME = isGhosttyXtversion. Do not treat ME as false.
      if (
        url &&
        process.env.TERM_PROGRAM !== 'vscode' &&
        !isXtermJs() &&
        ((m.button & 24) !== 0 || macCmdClickArrivesWithoutSgrModifierBit() || isGhosttyXtversion())
      ) {
        // Clear any prior pending timer — clicking a second link
        // supersedes the first (only the latest click opens).
        if (app.pendingHyperlinkTimer) {
          clearTimeout(app.pendingHyperlinkTimer);
        }
        app.pendingHyperlinkOpensInPanel = false;
        app.pendingHyperlinkTimer = setTimeout(
          (app, url) => {
            app.pendingHyperlinkTimer = null;
            app.pendingHyperlinkOpensInPanel = false;
            app.props.onOpenHyperlink(url);
          },
          MULTI_CLICK_TIMEOUT_MS,
          app,
          url,
        );
      }
    }
  }
  app.props.onSelectionChange();
}
