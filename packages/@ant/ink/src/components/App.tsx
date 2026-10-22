import React, { PureComponent, type ReactNode } from 'react';
// Business-layer callbacks — replaced with inline defaults so this package
// has zero dependencies on business code. The business layer can inject
// implementations via AppCallbacks when needed.
type AppCallbacks = {
  updateLastInteractionTime?: () => void;
  stopCapturingEarlyInput?: () => void;
  logError?: (error: unknown) => void;
  logForDebugging?: (message: string, opts?: { level?: string }) => void;
  /** densable `Ym` / `Fkd.committed` — gracefulShutdown has committed. */
  isShutdownCommitted?: () => boolean;
};

/** Default no-op / safe-default implementations */
const defaultCallbacks: Required<AppCallbacks> = {
  updateLastInteractionTime: () => {},
  stopCapturingEarlyInput: () => {},
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

import { EventEmitter } from '../core/events/emitter.js';
import { createJediTermInputState, rewriteJediTermInput } from '../core/jediTermInput.js';
import {
  createKeyReader,
  flushKeys,
  KEY_READER_NORMAL_MS,
  keyReaderHasPending,
  readKeys,
  type KeyReader,
} from '../core/keyReader.js';
import type { ParsedInput, ParsedKey, ParsedMouse } from '../core/parse-keypress.js';
import reconciler from '../core/reconciler.js';
import { Ns } from '../core/instances.js';
import { clearSelection, finishSelection, hasSelection, type SelectionState } from '../core/selection.js';
import { getAttachStampMs, isAttachUnstable, waitUntilAttachStable } from '../core/attachStamp.js';
import { noteMouseObserved } from '../core/mouseObserved.js';
import { endScreenReaderStartupQuiet } from '../core/screenReaderStartupQuiet.js';
import {
  getCellPixels,
  getMousePixelsSupported,
  isGhosttyXtversion,
  isXtermJs,
  supportsExtendedKeys,
} from '../core/terminal.js';
import { Jk, tD } from '../core/terminalCapabilities.js';
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
import { DISABLE_MOUSE_TRACKING, HIDE_CURSOR, type MouseTrackingMode, SHOW_CURSOR, Yot } from '../core/termio/dec.js';
import AppContext from './AppContext.js';
import { ClockProvider } from './ClockContext.js';
import CursorDeclarationContext, { type CursorDeclarationSetter } from './CursorDeclarationContext.js';
import ErrorOverview from './ErrorOverview.js';
import InputNowContext from './InputNowContext.js';
import StdinContext from './StdinContext.js';
import { TerminalFocusProvider } from './TerminalFocusContext.js';
import { TerminalSizeContext } from './TerminalSizeContext.js';
import { flushNonBlockingStdout } from '../core/nonBlockingStdout.js';

/** densable `O` — gold `u().getPlatform()`; App only branches on `"windows"`. */
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

/** densable `bDn` — Ctrl+Z suspend is off in bg sessions. */
function canSuspendOnCtrlZ(): boolean {
  return process.env.CLAUDE_CODE_SESSION_KIND !== 'bg';
}

/** densable keepalive delay — 2^30 ms; keeps the event loop from sleeping across SIGTSTP. */
const SUSPEND_KEEPALIVE_MS = 1073741824;

/** densable `Gd` — delay before Wg flips raw mode off while a query reply is owed. */
const OWED_REPLY_HOLD_MS = 250;

const REVOKED_TTY_ERRNOS = new Set(['EIO', 'ENOTTY', 'EBADF']);

/** densable `Y` — unknown → Error. */
function Y(n: unknown): Error {
  return n instanceof Error ? n : Error(String(n));
}

/** densable `l` — unknown → message string. */
function l(n: unknown): string {
  return n instanceof Error ? n.message : String(n);
}

/**
 * densable `ot` — stamp `telemetryMessage` on an existing Error; do not wrap.
 */
function ot<T>(n: T, e: string): T {
  try {
    if (n !== null && typeof n === 'object' && !('telemetryMessage' in n) && Object.isExtensible(n)) {
      Object.assign(n, { telemetryMessage: e });
    }
  } catch {
    // ignore
  }
  return n;
}

/**
 * densable `Pw` — `"setRawMode" in e` then try/catch revoked tty.
 */
function setStdinRawMode(stdin: NodeJS.ReadStream, enabled: boolean): void {
  if (!('setRawMode' in stdin) || typeof stdin.setRawMode !== 'function') return;
  try {
    stdin.setRawMode(enabled);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code ?? '') : '';
    if (message.includes('setRawMode failed') || REVOKED_TTY_ERRNOS.has(code)) {
      defaultCallbacks.logForDebugging(`setRawMode(${enabled}) failed on revoked tty: ${message}`);
      return;
    }
    throw err;
  }
}

/**
 * densable `Wg` — drop the OSC/DA owed-reply hold. If the raw-mode refcount is
 * already 0, force setRawMode(false) (the hold may have deferred that flip).
 */
function clearOwedReplyHold(app: App, stdin: NodeJS.ReadStream): void {
  if (app.owedReplyHold === undefined) return;
  clearTimeout(app.owedReplyHold);
  app.owedReplyHold = undefined;
  if (app.rawModeEnabledCount === 0) {
    setStdinRawMode(stdin, false);
  }
}

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
  /**
   * densable `props.modes` (`dqe`) — same instance as Ink.modes.
   */
  readonly modes: import('../core/terminalModes.js').TerminalModes;
  // Receives the declared native-cursor position from useDeclaredCursor
  // so ink.tsx can park the terminal cursor there after each frame.
  // Enables IME composition at the input caret and lets screen readers /
  // magnifiers track the input. Optional so testing.tsx doesn't stub it.
  readonly onCursorDeclaration?: CursorDeclarationSetter;
  // Dispatch a keyboard event through the DOM tree. Called for each
  // parsed key alongside the legacy EventEmitter path.
  readonly dispatchKeyboardEvent: (parsedKey: ParsedKey, extras?: { soloKeypress?: boolean }) => void;
  /** densable `onInputPriorityFrame` — `Kd` paste/key (not wheel/mouse name). */
  readonly onInputPriorityFrame: () => void;
  // Official densable lag: bracketed paste → PasteEvent on focused node.
  readonly dispatchPasteEvent: (text: string) => void;
  /**
   * densable `dispatchWheelEvent` — SGR wheel DOM path. Optional so
   * windowActivation stubs don't need it. Gold returns void; Yt capture
   * synthesizes wheelup/wheeldown unless eo.
   */
  readonly dispatchWheelEvent: (parsedKey: ParsedKey) => void;
  /**
   * densable `fileLinkOpensInPanel` — Ink `fileHyperlinkOpensInPanel?.()===!0`.
   */
  readonly fileLinkOpensInPanel?: () => boolean;
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
   * densable `HC().terminalImages` — kitty `Jd`. Optional so testing stubs
   * don't need it.
   */
  readonly terminalImages: import('../core/terminalImages.js').TerminalImages | null;
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

type State = {
  readonly error?: Error;
};

// Root component for all Ink apps
// It renders stdin and stdout contexts, so that children can access them if needed
// It also handles Ctrl+C exiting and cursor visibility
export default class App extends PureComponent<Props, State> {
  static displayName = 'InternalApp';

  static getDerivedStateFromError(error: Error) {
    // densable: return{error:n}
    return { error };
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
      this.appUnmounted || defaultCallbacks.isShutdownCommitted() || Ns().get(this.props.stdout)?.hasUnmounted === true
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
  /**
   * densable `owedReplyHold` — timeout while a terminal query reply is owed.
   * Armed when raw-mode count hits 0 and querier.owed()>0 (Gd=250); Wg / unmount / suspend consume it.
   */
  owedReplyHold: ReturnType<typeof setTimeout> | undefined = undefined;
  /**
   * densable `cancelExtendedKeysSettle` — tD().onSettle("extendedKeys") while
   * the probe is pending; reassertKeys on true.
   */
  cancelExtendedKeysSettle: (() => void) | undefined = undefined;

  internal_eventEmitter = new EventEmitter();
  /** densable `keyReader` — `Zy` bag, not a loose parse state. */
  keyReader: KeyReader = createKeyReader(performance.now());
  // Official JediTerm input rewrite state (RJc / eag densables).
  jediTermInput = createJediTermInputState();
  /** densable `arrowWindow` / `arrowWindowDir` — gold `M1`. */
  arrowWindow: Array<{ t: number; n: number }> = [];
  arrowWindowDir = '';
  /** densable `emitJediTermScrollBug`. */
  emitJediTermScrollBug = (): boolean => this.internal_eventEmitter.emit('jediterm-scroll-bug');
  // Timer for flushing incomplete escape sequences / pending high-byte
  // CSI u UTF-8 reassembly (official 2.1.210 App densable).
  incompleteEscapeTimer: NodeJS.Timeout | null = null;
  /** densable `readArrivedAt` — pin Date.now() around discreteUpdates(v1). */
  readArrivedAt: number | null = null;
  /** densable `inputNow` — `()=>this.readArrivedAt??Date.now()`. */
  inputNow = (): number => this.readArrivedAt ?? Date.now();

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
            subscribeFrames: this.props.subscribeFrames,
            subscribeClicks: this.props.subscribeClicks ?? (() => () => {}),
            subscribeHoverTracked: this.props.subscribeHoverTracked,
            isHoverTracked: this.props.isHoverTracked,
            retainFinePointer: this.props.retainFinePointer ?? (() => () => {}),
            terminalImages: this.props.terminalImages,
          }}
        >
          <StdinContext.Provider
            value={{
              stdin: this.props.stdin,
              setRawMode: this.handleSetRawMode,
              isRawModeSupported: this.isRawModeSupported(),
              internal_eventEmitter: this.internal_eventEmitter,
              internal_querier: this.querier,
              internal_jediTermInput: this.jediTermInput,
            }}
          >
            <TerminalFocusProvider>
              <ClockProvider>
                <CursorDeclarationContext.Provider value={this.props.onCursorDeclaration ?? (() => {})}>
                  <InputNowContext.Provider value={this.inputNow}>
                    {this.state.error ? <ErrorOverview error={this.state.error} /> : this.props.children}
                  </InputNowContext.Provider>
                </CursorDeclarationContext.Provider>
              </ClockProvider>
            </TerminalFocusProvider>
          </StdinContext.Provider>
        </AppContext.Provider>
      </TerminalSizeContext.Provider>
    );
  }

  override componentDidMount() {
    // densable: drain `_pendingRawModeDelta` then bind `n.setRawMode=this.handleSetRawMode`.
    const root = this.props.rootNode;
    const pending = root._pendingRawModeDelta ?? 0;
    root._pendingRawModeDelta = 0;
    for (let i = 0; i < pending; i++) this.handleSetRawMode(true);
    for (let i = 0; i > pending; i--) this.handleSetRawMode(false);
    root.setRawMode = this.handleSetRawMode;
  }

  override componentWillUnmount() {
    this.appUnmounted = true;
    this.props.rootNode.setRawMode = undefined;
    if (this.props.stdout.isTTY) {
      this.props.stdout.write(SHOW_CURSOR);
    }

    // Clear any pending timers
    if (this.incompleteEscapeTimer) {
      clearTimeout(this.incompleteEscapeTimer);
      this.incompleteEscapeTimer = null;
    }
    // densable: if(owedReplyHold!==void 0) clearTimeout, unset, Pw(stdin, false)
    if (this.owedReplyHold !== undefined) {
      clearTimeout(this.owedReplyHold);
      this.owedReplyHold = undefined;
      setStdinRawMode(this.props.stdin, false);
    }
    if (this.pendingHyperlinkTimer) {
      clearTimeout(this.pendingHyperlinkTimer);
      this.pendingHyperlinkTimer = null;
      this.pendingHyperlinkOpensInPanel = false;
    }
    // densable: while(rawModeEnabledCount>0) handleSetRawMode(false)
    if (this.isRawModeSupported()) {
      while (this.rawModeEnabledCount > 0) this.handleSetRawMode(false);
    }
  }

  override componentDidCatch(error: Error, _info: React.ErrorInfo): void {
    // densable `wy`: t(`[reportRenderError] …`, {level:"error"}) then tengu.
    // Ink has no Us(); skip telemetry, keep the t() log. Gold `$g` only
    // accepts PascalCase names; `u?.componentStack` is tengu-only.
    const rawName = error.name;
    const className = typeof rawName === 'string' && /^[A-Z][a-zA-Z]{0,63}$/.test(rawName) ? rawName : 'unknown';
    try {
      defaultCallbacks.logForDebugging(`[reportRenderError] React boundary caught ${className}: ${l(error)}`, {
        level: 'error',
      });
    } catch {
      // ignore
    }
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

        // densable: if(owedReplyHold!==void 0) clearTimeout, unset — before onRawModeEnter
        // (M6(); clear hold; onRawModeEnter; ref; setRawMode(true)).
        if (this.owedReplyHold !== undefined) {
          clearTimeout(this.owedReplyHold);
          this.owedReplyHold = undefined;
        }

        // densable: this.props.onRawModeEnter?.() before ref/setRawMode —
        // attaches resize/SIGCONT + hides cursor (Ink.ensureInteractive).
        this.props.onRawModeEnter?.();

        stdin.ref();
        setStdinRawMode(stdin, true);
        stdin.addListener('readable', this.handleReadable);
        this.querier?.setInputAttached(true);
        if (O() === 'windows') {
          stdin.resume();
          stdin.pause();
        }
        const { modes } = this.props;
        this.props.stdout.write(modes.set('bracketedPaste') + modes.set('themeReports') + modes.set('focusEvents'));
        if (O() === 'windows') {
          this.props.stdout.write(Yot);
        }
        this.props.stdout.write(modes.set('extendedKeys'));
        // densable: let m=tD(); if(m.get("extendedKeys").state==="pending") onSettle
        const caps = tD();
        if (caps.get('extendedKeys').state === 'pending') {
          this.cancelExtendedKeysSettle = caps.onSettle('extendedKeys', y => {
            if (y && !this.hasReleasedTerminal) this.props.stdout.write(modes.reassertKeys());
          });
        }
        // Gold 251: non-daemon first raw-mode runs full bv (XTVERSION+DECRQM).
        // Daemon waits for FOCUS_IN attachProbeDeferred / Rlt then bv.
        if (process.env.CLAUDE_BG_BACKEND !== 'daemon') {
          setImmediate(() => {
            if (this.querier && !this.hasReleasedTerminal) {
              void probeTerminalIdentity(this.querier, tD());
            }
          });
        }
      }

      this.rawModeEnabledCount++;
      return;
    }

    // densable: if(this.rawModeEnabledCount<=0)return; if(--count===0)
    if (this.rawModeEnabledCount <= 0) return;
    if (--this.rawModeEnabledCount === 0) {
      this.cancelExtendedKeysSettle?.();
      this.cancelExtendedKeysSettle = undefined;

      const modes = this.props.modes;
      this.props.stdout.write(
        modes.reset('extendedKeys') +
          modes.reset('focusEvents') +
          modes.reset('themeReports') +
          modes.reset('bracketedPaste'),
      );
      // densable: after mode-reset writes, if !isHandoffRawMode:
      // owed()>0 && !appUnmounted → arm Wg@Gd=250 (do not setRawMode(false) yet);
      // else drainStdin if owed()>0, then Pw(stdin, false).
      if (!Ns().get(this.props.stdout)?.isHandoffRawMode) {
        if (this.querier && this.querier.owed() > 0 && !this.appUnmounted) {
          this.owedReplyHold = setTimeout(clearOwedReplyHold, OWED_REPLY_HOLD_MS, this, stdin);
          this.owedReplyHold.unref?.();
        } else {
          if (this.querier && this.querier.owed() > 0) {
            Ns().get(this.props.stdout)?.drainStdin();
          }
          setStdinRawMode(stdin, false);
        }
      }
      this.querier?.setInputAttached(false);
      stdin.removeListener('readable', this.handleReadable);
      stdin.unref();
    }
  };

  flushIncomplete = (): void => {
    this.incompleteEscapeTimer = null;
    if (!keyReaderHasPending(this.keyReader)) return;
    if (this.props.stdin.readableLength > 0) this.handleReadable();
    if (!keyReaderHasPending(this.keyReader)) return;
    if (this.props.stdin.readableLength > 0) {
      this.incompleteEscapeTimer = setTimeout(this.flushIncomplete, KEY_READER_NORMAL_MS);
      return;
    }
    const now = performance.now();
    this.applyKeysRead(flushKeys(this.keyReader, now), now);
  };

  processInput = (input: string | Buffer | null, now: number): void => {
    this.applyKeysRead(readKeys(this.keyReader, input, now), now);
  };

  applyKeysRead = (result: { keys: ParsedInput[]; reader: KeyReader; wakeAt: number | null }, now: number): void => {
    this.keyReader = result.reader;
    if (this.incompleteEscapeTimer) {
      clearTimeout(this.incompleteEscapeTimer);
      this.incompleteEscapeTimer = null;
    }
    if (result.wakeAt !== null) {
      this.incompleteEscapeTimer = setTimeout(this.flushIncomplete, Math.max(0, result.wakeAt - now));
    }
    if (result.keys.length > 0) {
      if (result.keys.some(isInputPriorityItem)) this.props.onInputPriorityFrame();
      const prevArrived = this.readArrivedAt;
      this.readArrivedAt = Date.now();
      try {
        reconciler.discreteUpdates(processKeysInBatch, this, result.keys, undefined, undefined);
      } finally {
        this.readArrivedAt = prevArrived;
      }
    }
  };

  handleReadable = (): void => {
    const now = performance.now();
    if (now - this.lastStdinTime > STDIN_RESUME_GAP_MS) {
      this.props.onStdinResume?.();
    }
    this.lastStdinTime = now;
    try {
      let chunk;
      while ((chunk = this.props.stdin.read() as string | null) !== null) {
        this.processInput(chunk, now);
      }
    } catch (error) {
      // densable: c(ot(Y(u), "stdin readable handler threw during input processing"))
      defaultCallbacks.logError(ot(Y(error), 'stdin readable handler threw during input processing'));

      // densable: if count>0 && listener missing, t(warn) then addListener.
      const { stdin } = this.props;
      try {
        let leftover;
        while ((leftover = stdin.read() as string | null) !== null) {
          this.processInput(leftover, now);
        }
      } catch {
        // drain failed — still re-attach below
      }
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
    const prev = getTerminalFocusState();
    if (!isFocused || Date.now() - this.lastActivationInputTime >= WINDOW_ACTIVATION_GRACE_MS) {
      this.windowActivationClickArmed = true;
    }
    setTerminalFocused(isFocused);
    if (isFocused && prev === 'blurred') {
      this.reprobeCellPixels();
    }
    if (isFocused && prev === 'blurred') {
      Ns().get(this.props.stdout)?.proactiveAtlasResetOnFocus();
    }
    if (
      isFocused &&
      prev !== 'focused' &&
      process.env.CLAUDE_BG_BACKEND === 'daemon' &&
      this.querier &&
      !this.attachProbeDeferred
    ) {
      this.attachProbeDeferred = true;
      void waitUntilAttachStable().then(() => {
        this.attachProbeDeferred = false;
        if (this.querier && !this.hasReleasedTerminal) {
          Jk().resetCapabilities();
          void probeTerminalIdentity(this.querier, tD());
        }
      });
    }
  };

  handleSuspend = (): void => {
    if (!this.isRawModeSupported()) {
      return;
    }

    // densable: write SHOW_CURSOR + mouse-off + modes.suspend() BEFORE dropping
    // raw mode. suspend keeps entries; later handleSetRawMode(false) reset() is
    // a no-op while suspended. SIGCONT then resume() re-emits on sequences.
    const rawModeCountBeforeSuspend = this.rawModeEnabledCount;
    const modes = this.props.modes;
    if (this.props.stdout.isTTY) {
      this.props.stdout.write(SHOW_CURSOR + DISABLE_MOUSE_TRACKING + modes.suspend());
    }
    while (this.rawModeEnabledCount > 0) {
      this.handleSetRawMode(false);
    }

    this.internal_eventEmitter.emit('suspend');

    // densable: setInterval(()=>{}, 1073741824) — keepalive across process sleep.
    const keepalive = setInterval(() => {}, SUSPEND_KEEPALIVE_MS);
    const resumeHandler = () => {
      // gold: if(clearInterval(u), removeListener, hasReleasedTerminal) return
      clearInterval(keepalive);
      process.removeListener('SIGCONT', resumeHandler);
      if (this.hasReleasedTerminal) {
        return;
      }
      for (let i = 0; i < rawModeCountBeforeSuspend; i++) {
        if (this.isRawModeSupported()) {
          this.handleSetRawMode(true);
        }
      }
      if (this.props.stdout.isTTY) {
        const a11y = Boolean(process.env.CLAUDE_CODE_ACCESSIBILITY) || (this.props.isScreenReaderEnabled ?? false);
        this.props.stdout.write(modes.resume() + (a11y ? '' : HIDE_CURSOR));
      }
      this.internal_eventEmitter.emit('resume');
    };

    process.on('SIGCONT', resumeHandler);
    // gold: if(owedReplyHold!==void 0) drainStdin + Wg; then gZt(); kill TSTP
    if (this.owedReplyHold !== undefined) {
      Ns().get(this.props.stdout)?.drainStdin();
      clearOwedReplyHold(this, this.props.stdin);
    }
    flushNonBlockingStdout();
    // densable: process.kill(0, "SIGTSTP") — group TSTP, not SIGSTOP on pid.
    process.kill(0, 'SIGTSTP');
  };
}

/** densable `Yd`. */
function isHoverMotionButton(button: number): boolean {
  return (button & 32) !== 0 && (button & 3) === 3;
}

/** densable `Id` — user-intent for attachQuietDrain / soloKeypress. */
function isUserIntentItem(item: ParsedInput): boolean {
  switch (item.kind) {
    case 'response':
    case 'focus':
      return false;
    case 'paste':
      return true;
    case 'mouse':
      return !isHoverMotionButton(item.button);
    case 'key':
      return item.name !== 'mouse';
  }
}

/** densable `Kd` — paste or key that is not wheel/mouse-name. */
function isInputPriorityItem(item: ParsedInput): boolean {
  return (
    item.kind === 'paste' ||
    (item.kind === 'key' && item.name !== 'wheelup' && item.name !== 'wheeldown' && item.name !== 'mouse')
  );
}

/** densable `Zg`. */
function isNonMotionMouse(item: ParsedInput): boolean {
  return item.kind === 'mouse' && (item.button & 32) === 0;
}

/** densable `g1`. */
function isFlushSyncBatchItem(item: ParsedInput): boolean {
  return isInputPriorityItem(item) || isNonMotionMouse(item) || item.kind === 'focus';
}

function countMatching(items: ParsedInput[], pred: (item: ParsedInput) => boolean): number {
  let n = 0;
  for (const item of items) if (pred(item)) n++;
  return n;
}

/** densable `M1` — App `arrowWindow` / `arrowWindowDir`. */
function trackAppArrowBurst(app: App, items: ParsedInput[]): void {
  const first = items[0];
  if (
    first?.kind !== 'key' ||
    (first.name !== 'up' && first.name !== 'down') ||
    first.ctrl ||
    first.meta ||
    first.shift ||
    !items.every(item => item.kind === 'key' && item.name === first.name && !item.ctrl && !item.meta && !item.shift)
  ) {
    app.arrowWindow.length = 0;
    return;
  }
  if (app.arrowWindowDir !== first.name) {
    app.arrowWindow.length = 0;
    app.arrowWindowDir = first.name;
  }
  const now = performance.now();
  const window = app.arrowWindow;
  window.push({ t: now, n: items.length });
  while (window.length > 0 && now - window[0]!.t > 100) {
    window.shift();
  }
  let count = 0;
  for (const entry of window) count += entry.n;
  if (count >= 8) {
    app.internal_eventEmitter.emit('arrow-burst', { direction: first.name, count });
    app.props.onStdinResume?.();
    window.length = 0;
  }
}

// Helper to process all keys within a single discrete update context.
// discreteUpdates expects (fn, a, b, c, d) -> fn(a, b, c, d)
function processKeysInBatch(app: App, items: ParsedInput[], _unused1: undefined, _unused2: undefined): void {
  // densable v1: Ext(Date.now()); if(!y&&u.some(Id)) lae(), yor()
  const attachQuiet = isAttachUnstable(Date.now());
  if (!attachQuiet && items.some(isUserIntentItem)) {
    defaultCallbacks.updateLastInteractionTime();
    endScreenReaderStartupQuiet();
  }

  const rewritten = rewriteJediTermInput(app.jediTermInput, items, performance.now(), app.emitJediTermScrollBug);
  trackAppArrowBurst(app, rewritten);
  items = rewritten;

  const soloKeypress = countMatching(items, isUserIntentItem) === 1;
  const multiFlush = countMatching(items, isFlushSyncBatchItem) > 1;
  let flushed = false;

  for (const item of items) {
    if (attachQuiet && isUserIntentItem(item) && !(item.kind === 'key' && item.name === 'left')) {
      defaultCallbacks.logForDebugging(
        `attachQuietDrain: dropped ${item.kind} (ms_since_stamp=${Date.now() - getAttachStampMs()})`,
        {
          level: 'debug',
        },
      );
      continue;
    }
    if (item.kind === 'response') {
      if (!(app.querier?.onResponse(item.response) ?? false) && item.response.type === 'kittyGraphics') {
        app.props.terminalImages?.refused(item.response.id, item.response.message);
      }
      continue;
    }
    if (item.kind === 'mouse') {
      noteMouseObserved();
      if (item.action === 'press' && !isHoverMotionButton(item.button) && !getTerminalFocused()) {
        app.handleTerminalFocus(true);
      }
      if (app.props.getMouseMode?.() === 'scroll' && (item.button & 3) === 0) {
        app.pendingPastePress = null;
        continue;
      }
      if (isNonMotionMouse(item)) {
        if (multiFlush && flushed) reconciler.flushSyncWork();
        flushed = true;
      }
      handleMouseEvent(app, item);
      continue;
    }
    if (item.kind === 'focus') {
      if (multiFlush && flushed) reconciler.flushSyncWork();
      app.handleTerminalFocus(item.focused);
      if (multiFlush) reconciler.flushSyncWork();
      flushed = true;
      if (!item.focused && app.props.selection.isDragging) {
        finishSelection(app.props.selection);
        app.props.onSelectionChange();
      }
      continue;
    }
    if (item.kind === 'paste' || (item.name !== 'wheelup' && item.name !== 'wheeldown' && item.name !== 'mouse')) {
      if (!getTerminalFocused()) {
        setTerminalFocused(true);
        reconciler.flushSyncWork();
      }
      app.consumeWindowActivationLatch(Date.now());
    }
    if (isInputPriorityItem(item)) {
      if (multiFlush && flushed) reconciler.flushSyncWork();
      flushed = true;
    }
    if (item.kind === 'paste') {
      app.props.dispatchPasteEvent(item.text);
      continue;
    }
    if (item.name === 'z' && item.ctrl && canSuspendOnCtrlZ()) {
      app.handleSuspend();
      continue;
    }
    app.handleInput(item.sequence);
    if (item.name === 'wheelup' || item.name === 'wheeldown' || item.name === 'mouse') {
      if (item.name !== 'mouse') {
        noteMouseObserved();
        app.props.dispatchWheelEvent(convertWheelIfPixels(app, item));
      }
    } else {
      app.props.dispatchKeyboardEvent(item, { soloKeypress });
    }
  }
  if (multiFlush && flushed) reconciler.flushSyncWork();
}

/**
 * densable `Qx`/`Fd` — pixel SGR → 1-indexed cells + unfloored `fine`.
 * `Math.max(1, Math.floor(n/f.width)+1)`.
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
  // densable `x1(n,b1(n,T))` — convert pixel SGR before the 1-indexed → 0-indexed step.
  m = convertMouseIfPixels(app, m);

  const sel = app.props.selection;
  // Terminal coords are 1-indexed; screen buffer is 0-indexed
  const col = m.col - 1;
  const row = m.row - 1;
  const baseButton = m.button & 0x03;
  const mods = sgrButtonMods(m.button);
  // densable `Yd`: press + motion + no button.
  const isHoverMotion = m.action === 'press' && (m.button & 0x20) !== 0 && baseButton === 3;
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
    if (
      (m.button & 0x20) !== 0 &&
      app.props.onPointerDrag !== undefined &&
      app.props.onPointerDrag(col, row, mods, m.fine)
    ) {
      return;
    }
    if (baseButton !== 0) {
      // densable x1 comma: `clickCount=0,(u.button&32)===0&&(g===1||g===2)&&onPointerPress`.
      app.clickCount = 0;
      if (
        (m.button & 0x20) === 0 &&
        (baseButton === 1 || baseButton === 2) &&
        app.props.onPointerPress?.(col, row, baseButton, mods, m.fine)
      ) {
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
    // densable x1: onPointerPress left as `0` (`g===0` / baseButton).
    if (app.props.onPointerPress?.(col, row, baseButton, mods, m.fine)) {
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
  if (app.props.onPointerRelease?.(col, row, mods, m.fine)) return;

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
