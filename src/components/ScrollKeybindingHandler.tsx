import React, { type RefObject, useCallback, useEffect, useRef } from 'react';
import { useNotifications } from '../context/notifications.js';
import { useCopyOnSelect, useSelectionBgColor } from '../hooks/useCopyOnSelect.js';
import type { ScrollBoxHandle, FocusMove, SelectionState } from '@anthropic/ink';
import {
  useSelection,
  type Key,
  useInput,
  isXtermJs,
  getXtversionName,
  getClipboardPath,
  isJediTermArrowFloodActive,
  isJediTermBugConfirmed,
  consumeJediTermArrowBurstCount,
  useStdin,
} from '@anthropic/ink';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { logForDebugging } from '../utils/debug.js';
import { getAutoScrollEnabled } from '../utils/config.js';
import { getPlatform } from '../utils/platform.js';
import { resolveScrollSpeedBase } from '../utils/residualUiEnvGates.js';
import {
  recordPageJump,
  recordReachedScrollbackCap,
  recordScroll,
  recordStickyState,
} from '../utils/scrollTelemetry.js';

/**
 * densable Gsn() — hold-key hint when OSC 52 copy may not reach the system clipboard.
 * Terminal sets from densable xB_ / kB_ / vPe (SEA 2.1.224).
 */
const OSC52_HOLD_VSCODE_TERMS = new Set(['vscode', 'cursor', 'windsurf', 'antigravity', 'codium']);
const OSC52_HOLD_SHIFT_TERMS = new Set([
  'ghostty',
  'kitty',
  'WezTerm',
  'alacritty',
  'xterm',
  'gnome-terminal',
  'vte-based',
  'konsole',
  'windows-terminal',
  'mintty',
  // densable vPe jetbrains family
  'pycharm',
  'intellij',
  'webstorm',
  'phpstorm',
  'rubymine',
  'clion',
  'goland',
  'rider',
  'datagrip',
  'appcode',
  'dataspell',
  'aqua',
  'gateway',
  'fleet',
  'jetbrains',
  'androidstudio',
]);

/** densable Gsn — native-selection modifier label for OSC 52 toast */
export function getNativeSelectionHoldKey(): string {
  // densable M3u: lv()?.terminal ?? ee.terminal ≈ TERM_PROGRAM
  const term = process.env.TERM_PROGRAM;
  if (term === 'Apple_Terminal') return 'Fn';
  if (term === 'iTerm.app') return 'Option';
  // densable: lv()?.isVscodeTerm || xB_.has(term)
  if (isXtermJs() || (term !== undefined && OSC52_HOLD_VSCODE_TERMS.has(term))) {
    return getPlatform() === 'macos' ? 'Option' : 'Shift';
  }
  if (term !== undefined && OSC52_HOLD_SHIFT_TERMS.has(term)) return 'Shift';
  if (process.env.LC_TERMINAL === 'iTerm2') return 'Option';
  // densable: Wsn()||Jws()!==null||Wt()==="macos"
  const ssh = Boolean(process.env.SSH_CONNECTION);
  const mux = Boolean(process.env.TMUX || process.env.STY);
  if (ssh || mux || getPlatform() === 'macos') {
    return 'Shift (Option in iTerm2, Fn in Terminal.app)';
  }
  return 'Shift';
}

type Props = {
  scrollRef: RefObject<ScrollBoxHandle | null>;
  isActive: boolean;
  /** Called after every scroll action with the resulting sticky state and
   *  the handle (for reading scrollTop/scrollHeight post-scroll). */
  onScroll?: (sticky: boolean, handle: ScrollBoxHandle) => void;
  /** Enables modal pager keys (g/G, ctrl+u/d/b/f). Only safe when there
   *  is no text input competing for those characters — i.e. transcript
   *  mode. Defaults to false. When true, G works regardless of editorMode
   *  and sticky state; ctrl+u/d/b/f don't conflict with kill-line/exit/
   *  task:background/kill-agents (none are mounted, or they mount after
   *  this component so stopImmediatePropagation wins). */
  isModal?: boolean;
};

// Official 2.1.210 FSp densable constants (OSp/hP_/gP_/yP_/_P_/bP_/SP_/EP_/
// vP_/NSp/AP_/$Sp/wP_/TP_/HP_/CP_ + jb path kP_/IP_/RP_/DP_/j3i). Keep names
// aligned with local docs but values must match the official binary — do not invent.
//
// Native terminals: hard-window linear ramp (OSp/hP_/gP_). Events closer than
// the window ramp the multiplier; idle gaps reset to `base`. Official F3i
// auto-base is 3 when not wheelFlood (win32/WT/xterm.js decay path).
const WHEEL_ACCEL_WINDOW_MS = 40; // OSp
const WHEEL_ACCEL_STEP = 0.3; // hP_
const WHEEL_ACCEL_MAX = 6; // gP_
const WHEEL_FLOOD_IDLE_MULT = 3; // yP_ — mult = base*yP_ when gap > OSp under wheelFlood

// Encoder bounce debounce + wheel-mode decay curve (_P_/bP_/SP_/EP_/vP_).
const WHEEL_BOUNCE_GAP_MAX_MS = 200; // _P_
const WHEEL_MODE_STEP = 15; // bP_
const WHEEL_MODE_CAP = 15; // SP_
const WHEEL_MODE_RAMP = 3; // EP_
const WHEEL_MODE_IDLE_DISENGAGE_MS = 1500; // vP_

// Decay curve (NSp/AP_/$Sp/wP_/TP_/HP_/CP_) — used when useDecayCurve
// (official: !wheelFlood && (xtermJs || win32 || WT_SESSION)).
const WHEEL_DECAY_HALFLIFE_MS = 150; // NSp
const WHEEL_DECAY_STEP = 7; // AP_ (official 2.1.210; was 5 pre-port)
const WHEEL_BURST_MS = 5; // $Sp
const WHEEL_DECAY_GAP_MS = 80; // wP_
const WHEEL_DECAY_CAP_SLOW = 3; // TP_
const WHEEL_DECAY_CAP_FAST = 36; // HP_ (official 2.1.210; was 6 pre-port)
const WHEEL_DECAY_IDLE_MS = 500; // CP_
// Official jbBypass / kJc path (JediTerm arrow-flood as wheel).
const WHEEL_JB_IDLE_MS = 200; // j3i — reset jbBypass after idle
const WHEEL_JB_FRAC_STEP = 0.35; // kP_
const WHEEL_JB_MULT_STEP = 0.008; // IP_
const WHEEL_JB_BURST_WEIGHT = 0.4; // RP_
const WHEEL_JB_MULT_CAP = 4; // DP_

/**
 * Whether a keypress should clear the virtual text selection. Mimics
 * native terminal selection: any keystroke clears, EXCEPT modified nav
 * keys (shift/opt/cmd + arrow/home/end/page*). In native macOS contexts,
 * shift+nav extends selection, and cmd/opt+nav are often intercepted by
 * the terminal emulator for scrollback nav — neither disturbs selection.
 * Bare arrows DO clear (user's cursor moves, native deselects). Wheel is
 * excluded — scroll:lineUp/Down already clears via the keybinding path.
 */
export function shouldClearSelectionOnKey(key: Key): boolean {
  if (key.wheelUp || key.wheelDown) return false;
  const isNav =
    key.leftArrow ||
    key.rightArrow ||
    key.upArrow ||
    key.downArrow ||
    key.home ||
    key.end ||
    key.pageUp ||
    key.pageDown;
  if (isNav && (key.shift || key.meta || key.super)) return false;
  return true;
}

/**
 * Map a keypress to a selection focus move (keyboard extension). Only
 * shift extends — that's the universal text-selection modifier. cmd
 * (super) only arrives via kitty keyboard protocol — in most terminals
 * cmd+arrow is intercepted by the emulator and never reaches the pty, so
 * no super branch. shift+home/end covers line-edge jumps (and fn+shift+
 * left/right on mac laptops = shift+home/end). shift+opt (word-jump) not
 * yet implemented — falls through to shouldClearSelectionOnKey which
 * preserves (modified nav). Returns null for non-extend keys.
 */
export function selectionFocusMoveForKey(key: Key): FocusMove | null {
  if (!key.shift || key.meta) return null;
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.home) return 'lineStart';
  if (key.end) return 'lineEnd';
  return null;
}

export type WheelAccelState = {
  time: number;
  mult: number;
  dir: 0 | 1 | -1;
  /**
   * Official useDecayCurve (J3): !wheelFlood && (xtermJs || win32 || WT).
   * Selects the exponential decay path in computeWheelStep/FSp.
   * Kept as `xtermJs` for historical call sites; equals useDecayCurve.
   */
  xtermJs: boolean;
  /** Official useDecayCurve field (same as xtermJs flag above). */
  useDecayCurve: boolean;
  /** Carried fractional scroll (decay path). scrollBy floors, so without
   *  this a mult of 1.5 gives 1 row every time. */
  frac: number;
  /** Baseline rows/event (official F3i/wog/jediTerm). */
  base: number;
  pendingFlip: boolean;
  wheelMode: boolean;
  burstCount: number;
  /** Official wheelFlood ($3i) — Cursor/VSCode flood path under !useDecayCurve. */
  wheelFlood: boolean;
  /** Official accelEnabled (settings.wheelScrollAccelerationEnabled, default true). */
  accelEnabled: boolean;
  /** Official jbBypass — sticky while kJc() arrow-flood is active. */
  jbBypass: boolean;
};

/** Official $3i densable — wheel flood hosts (Cursor / certain VS Code /
 *  xterm.js via XTVERSION). Flood path uses window mult, not decay. */
export function isWheelFloodHost(
  env: NodeJS.ProcessEnv = process.env,
  xtversion: string | undefined = getXtversionName(),
): boolean {
  if (env.CURSOR_TRACE_ID !== undefined) return true;
  if (env.VSCODE_GIT_ASKPASS_MAIN?.includes('cursor')) return true;
  if (env.TERM_PROGRAM === 'vscode') {
    const v = parseVscodeVersionTriple(env.TERM_PROGRAM_VERSION);
    if (v !== null) return v >= 1_092_000 && v < 1_105_000;
  }
  return xtversion?.startsWith('xterm.js') ?? false;
}

/** Official Aog densable — pack semver major.minor.patch into integer. */
function parseVscodeVersionTriple(version: string | undefined): number | null {
  if (!version) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return null;
  return +m[1]! * 1e6 + +m[2]! * 1000 + +m[3]!;
}

/** Official JediTerm detection (TERMINAL_EMULATOR). */
export function isJediTerm(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERMINAL_EMULATOR === 'JetBrains-JediTerm';
}

/**
 * Official F3i densable: !wheelFlood → 3, else 1.
 * (xtermJs/wtSession args are present in the binary but `(e||!0)` is always
 * true, so the effective rule is flood-gated only.)
 */
export function resolveOfficialAutoScrollBase(wheelFlood: boolean): number {
  return !wheelFlood ? 3 : 1;
}

/**
 * Official J3 densable profile (portable: process.platform, not hardcoded
 * win32 from the Windows native binary).
 */
export type WheelProfile = {
  useDecayCurve: boolean;
  base: number;
  xtermJs: boolean;
  wheelFlood: boolean;
  jediTerm: boolean;
  wtSession: boolean;
  platform: string;
  termProgram: string;
};

export function resolveWheelProfile(env: NodeJS.ProcessEnv = process.env): WheelProfile {
  const xtversion = getXtversionName();
  const wheelFlood = isWheelFloodHost(env, xtversion);
  const jediTerm = isJediTerm(env);
  const wtSession = !!env.WT_SESSION;
  const xtermJs = isXtermJs();
  const platform = process.platform;
  // Official: useDecayCurve:!r&&(i||s==="win32"||o)
  const useDecayCurve = !wheelFlood && (xtermJs || platform === 'win32' || wtSession);
  // Official: base:n?2:wog(i,r,o) where wog = SCROLL_SPEED override on F3i
  const autoBase = jediTerm ? 2 : resolveOfficialAutoScrollBase(wheelFlood);
  const base = resolveScrollSpeedBase(env, autoBase);
  return {
    useDecayCurve,
    base,
    xtermJs,
    wheelFlood,
    jediTerm,
    wtSession,
    platform,
    termProgram: env.TERM_PROGRAM ?? 'unset',
  };
}

/**
 * Official FSp densable — compute rows for one wheel event.
 * Returns 0 when a direction flip is deferred for bounce detection.
 * Exported for tests.
 */
export function computeWheelStep(state: WheelAccelState, dir: 1 | -1, now: number): number {
  // Official FSp head: if (kJc()) { jbBypass path ... }
  if (isJediTermArrowFloodActive()) {
    const gap = now - state.time;
    if (!state.jbBypass || gap > WHEEL_JB_IDLE_MS) {
      state.jbBypass = true;
      state.frac = 0;
      state.mult = 1;
    } else if (dir !== state.dir) {
      state.frac = 0;
    }
    state.dir = dir;
    state.time = now;
    const burst = consumeJediTermArrowBurstCount();
    if (state.accelEnabled) {
      state.mult = Math.min(WHEEL_JB_MULT_CAP, state.mult + WHEEL_JB_MULT_STEP + burst * WHEEL_JB_BURST_WEIGHT);
    }
    state.frac += WHEEL_JB_FRAC_STEP * state.mult;
    const rows = Math.floor(state.frac);
    state.frac -= rows;
    return rows;
  }
  if (state.jbBypass) {
    state.jbBypass = false;
    state.pendingFlip = false;
    state.wheelMode = false;
    state.burstCount = 0;
    state.frac = 0;
    state.dir = 0;
  }

  // Official: if (!e.useDecayCurve) { ... native / flood ... } else { decay }
  if (!state.useDecayCurve) {
    // Official wheelFlood path under window mode.
    if (state.wheelFlood) {
      const gap = now - state.time;
      state.time = now;
      state.dir = dir;
      state.mult = gap > WHEEL_ACCEL_WINDOW_MS ? state.base * WHEEL_FLOOD_IDLE_MULT : state.base;
      return Math.max(1, Math.floor(state.mult));
    }

    // Device-switch guard ①: idle disengage.
    if (state.wheelMode && now - state.time > WHEEL_MODE_IDLE_DISENGAGE_MS) {
      state.wheelMode = false;
      state.burstCount = 0;
      state.mult = state.base;
    }

    if (state.pendingFlip) {
      state.pendingFlip = false;
      if (dir !== state.dir || now - state.time > WHEEL_BOUNCE_GAP_MAX_MS) {
        state.dir = dir;
        state.time = now;
        state.mult = state.base;
        return Math.max(1, Math.floor(state.mult));
      }
      state.wheelMode = true;
    }

    const gap = now - state.time;
    if (dir !== state.dir && state.dir !== 0) {
      state.pendingFlip = true;
      state.time = now;
      return 0;
    }
    state.dir = dir;
    state.time = now;

    if (state.wheelMode) {
      if (gap < WHEEL_BURST_MS) {
        if (++state.burstCount >= 5) {
          state.wheelMode = false;
          state.burstCount = 0;
          state.mult = state.base;
        } else {
          return 1;
        }
      } else {
        state.burstCount = 0;
      }
    }

    // Official: wheelMode && accelEnabled → decay-style wheel mode.
    if (state.wheelMode && state.accelEnabled) {
      const m = 0.5 ** (gap / WHEEL_DECAY_HALFLIFE_MS);
      // Official: Math.max(SP_*Math.min(base,1), base*2)
      const cap = Math.max(WHEEL_MODE_CAP * Math.min(state.base, 1), state.base * 2);
      const next = 1 + (state.mult - 1) * m + WHEEL_MODE_STEP * m;
      state.mult = Math.min(cap, next, state.mult + WHEEL_MODE_RAMP);
      return Math.max(1, Math.floor(state.mult));
    }

    // Trackpad / hi-res native window ramp (or accel disabled → base).
    if (gap > WHEEL_ACCEL_WINDOW_MS || !state.accelEnabled) {
      state.mult = state.base;
    } else {
      // Official: Math.max(gP_*Math.min(base,1), base*2)
      const cap = Math.max(WHEEL_ACCEL_MAX * Math.min(state.base, 1), state.base * 2);
      state.mult = Math.min(cap, state.mult + WHEEL_ACCEL_STEP);
    }
    return Math.max(1, Math.floor(state.mult));
  }

  // ─── Decay curve (useDecayCurve: xterm.js / win32 / WT_SESSION) ───
  const gap = now - state.time;
  const sameDir = dir === state.dir;
  state.time = now;
  state.dir = dir;
  if (sameDir && gap < WHEEL_BURST_MS) return 1;
  // Official: !accelEnabled → fixed base rows.
  if (!state.accelEnabled) return Math.max(1, Math.floor(state.base));
  if (!sameDir || gap > WHEEL_DECAY_IDLE_MS) {
    // Official: mult = Math.max(2, base) (base is often 3 on win32).
    state.mult = Math.max(2, state.base);
    state.frac = 0;
  } else {
    const m = 0.5 ** (gap / WHEEL_DECAY_HALFLIFE_MS);
    const cap = gap >= WHEEL_DECAY_GAP_MS ? WHEEL_DECAY_CAP_SLOW : WHEEL_DECAY_CAP_FAST;
    state.mult = Math.min(cap, 1 + (state.mult - 1) * m + WHEEL_DECAY_STEP * m);
  }
  const total = state.mult + state.frac;
  const rows = Math.floor(total);
  state.frac = total - rows;
  return rows;
}

/**
 * Official wog densable via resolveScrollSpeedBase — default is official
 * auto base (F3i=3 when not flood), not 1.
 */
export function readScrollSpeedBase(defaultBase = 3): number {
  return resolveScrollSpeedBase(process.env, defaultBase);
}

/** Official PP_ densable — initial wheel accel state. */
export function initWheelAccel(
  useDecayCurve = false,
  base = 1,
  wheelFlood = false,
  accelEnabled = true,
): WheelAccelState {
  return {
    time: 0,
    mult: base,
    dir: 0,
    xtermJs: useDecayCurve,
    useDecayCurve,
    frac: 0,
    base,
    pendingFlip: false,
    wheelMode: false,
    burstCount: 0,
    wheelFlood,
    accelEnabled,
    jbBypass: false,
  };
}

/**
 * Official vc("wheelScrollAccelerationEnabled", true) densable — merged
 * settings (getInitialSettings), default true.
 */
export function isWheelScrollAccelerationEnabled(): boolean {
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/settings/settings.js') as typeof import('../utils/settings/settings.js');
    const v = getInitialSettings().wheelScrollAccelerationEnabled;
    if (v === false) return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Official USp densable — lazy profile + log on first wheel event.
 * Re-reads J3-equivalent profile so XTVERSION / settings have settled.
 */
function initAndLogWheelAccel(): WheelAccelState {
  const profile = resolveWheelProfile();
  const accelEnabled = isWheelScrollAccelerationEnabled();
  logForDebugging(
    `wheel accel: ${profile.useDecayCurve ? 'decay' : 'window (native)'} · base=${profile.base} · platform=${profile.platform} · TERM_PROGRAM=${profile.termProgram}` +
      `${profile.wheelFlood ? ' · wheelFlood' : ''}` +
      `${profile.jediTerm ? ' · jediTerm' : ''}` +
      `${isJediTermBugConfirmed() ? ' · jbBugConfirmed' : ''}` +
      `${accelEnabled ? '' : ' · accelDisabled'}`,
  );
  return initWheelAccel(profile.useDecayCurve, profile.base, profile.wheelFlood, accelEnabled);
}

// Drag-to-scroll: when dragging past the viewport edge, scroll by this many
// rows every AUTOSCROLL_INTERVAL_MS. Mode 1002 mouse tracking only fires on
// cell change, so a timer is needed to continue scrolling while stationary.
const AUTOSCROLL_LINES = 2;
const AUTOSCROLL_INTERVAL_MS = 50;
// Hard cap on consecutive auto-scroll ticks. If the release event is lost
// (mouse released outside terminal window — some emulators don't capture the
// pointer and drop the release), isDragging stays true and the timer would
// run until a scroll boundary. Cap bounds the damage; any new drag motion
// event restarts the count via check()→start().
const AUTOSCROLL_MAX_TICKS = 200; // 10s @ 50ms

/**
 * Keyboard scroll navigation for the fullscreen layout's message scroll box.
 * PgUp/PgDn scroll by half-viewport. Mouse wheel scrolls by a few lines.
 * Scrolling breaks sticky mode; Ctrl+End re-enables it. Wheeling down at
 * the bottom also re-enables sticky so new content follows naturally.
 */
export function ScrollKeybindingHandler({ scrollRef, isActive, onScroll, isModal = false }: Props): React.ReactNode {
  const selection = useSelection();
  const { addNotification } = useNotifications();
  const { internal_eventEmitter } = useStdin();
  // Lazy-inited on first wheel event so the XTVERSION probe (fired at
  // raw-mode-enable time) has resolved by then — initializing in useRef()
  // would read getWheelBase() before the probe reply arrives over SSH.
  // Official fXs: also cache last J3 profile so XTVERSION/flood changes
  // re-init accel state; always refresh base from live profile.
  const wheelAccel = useRef<WheelAccelState | null>(null);
  const wheelProfileRef = useRef<WheelProfile | null>(null);

  // Official g gate: only count when an onScroll listener is mounted
  // (fullscreen / transcript chrome path). Headless / non-scroll hosts skip.
  const trackTelemetry = onScroll != null;
  // Stable wrapper so we can both record sticky dwell time (ALi densable)
  // and forward to the caller's onScroll without identity thrash.
  const callerOnScrollRef = useRef(onScroll);
  callerOnScrollRef.current = onScroll;
  const notifyScroll = useCallback(
    (sticky: boolean, handle: ScrollBoxHandle) => {
      if (trackTelemetry) recordStickyState(sticky);
      callerOnScrollRef.current?.(sticky, handle);
    },
    [trackTelemetry],
  );

  // When the handler unmounts, stop the unpinned clock (official cleanup ALi(true)).
  useEffect(() => {
    if (!trackTelemetry) return;
    return () => {
      recordStickyState(true);
    };
  }, [trackTelemetry]);

  // Official VSp densable — arrow-burst / jediterm-scroll-bug toasts.
  useEffect(() => {
    if (!internal_eventEmitter) return;
    let arrowNotified = false;
    let pendingToast: ReturnType<typeof setTimeout> | undefined;
    const onArrowBurst = (payload: { direction?: string; count?: number }) => {
      if (!arrowNotified) {
        arrowNotified = true;
        logForDebugging(`tengu_scroll_arrows_detected count=${payload?.count ?? 0} up=${payload?.direction === 'up'}`);
      }
      // Defer like official setTimeout(..., 200)
      if (pendingToast !== undefined) clearTimeout(pendingToast);
      pendingToast = setTimeout(() => {
        pendingToast = undefined;
        addNotification({
          key: 'scroll-as-arrows',
          text: 'Scroll wheel is sending arrow keys · use PgUp/PgDn to scroll',
          color: 'warning',
          priority: 'immediate',
          timeoutMs: 12000,
        });
      }, 200);
    };
    const onJediBug = () => {
      logForDebugging('tengu_jediterm_scroll_bug_detected');
      addNotification({
        key: 'jediterm-scroll-bug',
        text: 'Scroll support in JetBrains IDE 2025.2 terminals is experimental · upgrade to 2025.3+ for the best experience',
        color: 'suggestion',
        priority: 'immediate',
        timeoutMs: 15000,
      });
    };
    internal_eventEmitter.on('arrow-burst', onArrowBurst);
    internal_eventEmitter.on('jediterm-scroll-bug', onJediBug);
    return () => {
      if (pendingToast !== undefined) clearTimeout(pendingToast);
      internal_eventEmitter.off('arrow-burst', onArrowBurst);
      internal_eventEmitter.off('jediterm-scroll-bug', onJediBug);
    };
  }, [internal_eventEmitter, addNotification]);

  function ensureWheelAccel(): WheelAccelState {
    const profile = resolveWheelProfile();
    if (wheelProfileRef.current !== null) {
      const prev = wheelProfileRef.current;
      if (
        prev.useDecayCurve !== profile.useDecayCurve ||
        prev.wheelFlood !== profile.wheelFlood ||
        prev.jediTerm !== profile.jediTerm ||
        prev.wtSession !== profile.wtSession ||
        prev.xtermJs !== profile.xtermJs
      ) {
        wheelAccel.current = null;
      }
    }
    wheelProfileRef.current = profile;
    wheelAccel.current ??= initAndLogWheelAccel();
    // Official: c.current.base = J3().base every event (SCROLL_SPEED may change).
    wheelAccel.current.base = profile.base;
    return wheelAccel.current;
  }

  function showCopiedToast(text: string): void {
    // getClipboardPath reads env synchronously — predicts what setClipboard
    // did (native pbcopy / tmux load-buffer / raw OSC 52) so we can tell
    // the user whether paste will Just Work or needs prefix+].
    // densable toast: char/chars plural + Gsn() hold key on osc52.
    const path = getClipboardPath();
    const n = text.length;
    const unit = n === 1 ? 'char' : 'chars';
    let msg: string;
    switch (path) {
      case 'native':
        msg = `copied ${n} ${unit} to clipboard`;
        break;
      case 'tmux-buffer':
        msg = `copied ${n} ${unit} to tmux buffer · paste with prefix + ]`;
        break;
      case 'osc52':
        msg = `sent ${n} ${unit} via OSC 52 · if paste fails, hold ${getNativeSelectionHoldKey()} while selecting for native copy`;
        break;
    }
    addNotification({
      key: 'selection-copied',
      text: msg,
      color: 'suggestion',
      priority: 'immediate',
      timeoutMs: path === 'native' ? 2000 : 4000,
    });
  }

  function copyAndToast(): void {
    const text = selection.copySelection();
    if (text) showCopiedToast(text);
  }

  // Translate selection to track a keyboard page jump. Selection coords are
  // screen-buffer-local; a scrollTo that moves content by N rows must also
  // shift anchor+focus by N so the highlight stays on the same text (native
  // terminal behavior: selection moves with content, clips at viewport
  // edges). Rows that scroll out of the viewport are captured into
  // scrolledOffAbove/Below before the scroll so getSelectedText still
  // returns the full text. Wheel scroll (scroll:lineUp/Down via scrollBy)
  // still clears — its async pendingScrollDelta drain means the actual
  // delta isn't known synchronously (follow-up).
  function translateSelectionForJump(s: ScrollBoxHandle, delta: number): void {
    const sel = selection.getState();
    if (!sel?.anchor || !sel.focus) return;
    const top = s.getViewportTop();
    const bottom = top + s.getViewportHeight() - 1;
    // Only translate if the selection is ON scrollbox content. Selections
    // in the footer/prompt/StickyPromptHeader are on static text — the
    // scroll doesn't move what's under them. Same guard as ink.tsx's
    // auto-follow translate (commit 36a8d154).
    if (sel.anchor.row < top || sel.anchor.row > bottom) return;
    // Cross-boundary: anchor in scrollbox, focus in footer/header. Mirror
    // ink.tsx's Flag-3 guard — fall through without shifting OR capturing.
    // The static endpoint pins the selection; shifting would teleport it
    // into scrollbox content.
    if (sel.focus.row < top || sel.focus.row > bottom) return;
    const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
    const cur = s.getScrollTop() + s.getPendingDelta();
    // Actual scroll distance after boundary clamp. jumpBy may call
    // scrollToBottom when target >= max but the view can't move past max,
    // so the selection shift is bounded here.
    const actual = Math.max(0, Math.min(max, cur + delta)) - cur;
    if (actual === 0) return;
    if (actual > 0) {
      // Scrolling down: content moves up. Rows at the TOP leave viewport.
      // Anchor+focus shift -actual so they track the content that moved up.
      selection.captureScrolledRows(top, top + actual - 1, 'above');
      selection.shiftSelection(-actual, top, bottom);
    } else {
      // Scrolling up: content moves down. Rows at the BOTTOM leave viewport.
      const a = -actual;
      selection.captureScrolledRows(bottom - a + 1, bottom, 'below');
      selection.shiftSelection(a, top, bottom);
    }
  }

  useKeybindings(
    {
      'scroll:pageUp': () => {
        const s = scrollRef.current;
        if (!s) return;
        if (trackTelemetry) recordPageJump();
        const d = -Math.max(1, Math.floor(s.getViewportHeight() / 2));
        translateSelectionForJump(s, d);
        const sticky = jumpBy(s, d, trackTelemetry);
        notifyScroll(sticky, s);
      },
      'scroll:pageDown': () => {
        const s = scrollRef.current;
        if (!s) return;
        if (trackTelemetry) recordPageJump();
        const d = Math.max(1, Math.floor(s.getViewportHeight() / 2));
        translateSelectionForJump(s, d);
        const sticky = jumpBy(s, d, trackTelemetry);
        notifyScroll(sticky, s);
      },
      'scroll:lineUp': () => {
        // Wheel: scrollBy accumulates into pendingScrollDelta, drained async
        // by the renderer. captureScrolledRows can't read the outgoing rows
        // before they leave (drain is non-deterministic). Clear for now.
        selection.clearSelection();
        const s = scrollRef.current;
        // Return false (not consumed) when the ScrollBox content fits —
        // scroll would be a no-op. Lets a child component's handler take
        // the wheel event instead (e.g. Settings Config's list navigation
        // inside the centered Modal, where the paginated slice always fits).
        if (!s || s.getScrollHeight() <= s.getViewportHeight()) return false;
        if (trackTelemetry) recordScroll();
        const accel = ensureWheelAccel();
        scrollUp(s, computeWheelStep(accel, -1, performance.now()), trackTelemetry);
        notifyScroll(false, s);
      },
      'scroll:lineDown': () => {
        selection.clearSelection();
        const s = scrollRef.current;
        if (!s || s.getScrollHeight() <= s.getViewportHeight()) return false;
        if (trackTelemetry) recordScroll();
        const accel = ensureWheelAccel();
        const step = computeWheelStep(accel, 1, performance.now());
        const reachedBottom = scrollDown(s, step);
        notifyScroll(reachedBottom, s);
      },
      'scroll:top': () => {
        const s = scrollRef.current;
        if (!s) return;
        // Official p2r densable: top jump marks scrollback cap reached.
        if (trackTelemetry) recordReachedScrollbackCap();
        translateSelectionForJump(s, -(s.getScrollTop() + s.getPendingDelta()));
        s.scrollTo(0);
        notifyScroll(false, s);
      },
      'scroll:bottom': () => {
        const s = scrollRef.current;
        if (!s) return;
        const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
        translateSelectionForJump(s, max - (s.getScrollTop() + s.getPendingDelta()));
        // scrollTo(max) eager-writes scrollTop so the render-phase sticky
        // follow computes followDelta=0. Without this, scrollToBottom()
        // alone leaves scrollTop stale → followDelta=max-stale →
        // shiftSelectionForFollow applies the SAME shift we already did
        // above, 2× offset. scrollToBottom() then re-enables sticky.
        s.scrollTo(max);
        s.scrollToBottom();
        notifyScroll(true, s);
      },
      'selection:copy': copyAndToast,
    },
    { context: 'Scroll', isActive },
  );

  // scroll:halfPage*/fullPage* have no default key bindings — ctrl+u/d/b/f
  // all have real owners in normal mode (kill-line/exit/task:background/
  // kill-agents). Transcript mode gets them via the isModal raw useInput
  // below. These handlers stay for custom rebinds only.
  useKeybindings(
    {
      'scroll:halfPageUp': () => {
        const s = scrollRef.current;
        if (!s) return;
        if (trackTelemetry) recordPageJump();
        const d = -Math.max(1, Math.floor(s.getViewportHeight() / 2));
        translateSelectionForJump(s, d);
        const sticky = jumpBy(s, d, trackTelemetry);
        notifyScroll(sticky, s);
      },
      'scroll:halfPageDown': () => {
        const s = scrollRef.current;
        if (!s) return;
        if (trackTelemetry) recordPageJump();
        const d = Math.max(1, Math.floor(s.getViewportHeight() / 2));
        translateSelectionForJump(s, d);
        const sticky = jumpBy(s, d, trackTelemetry);
        notifyScroll(sticky, s);
      },
      'scroll:fullPageUp': () => {
        const s = scrollRef.current;
        if (!s) return;
        if (trackTelemetry) recordPageJump();
        const d = -Math.max(1, s.getViewportHeight());
        translateSelectionForJump(s, d);
        const sticky = jumpBy(s, d, trackTelemetry);
        notifyScroll(sticky, s);
      },
      'scroll:fullPageDown': () => {
        const s = scrollRef.current;
        if (!s) return;
        if (trackTelemetry) recordPageJump();
        const d = Math.max(1, s.getViewportHeight());
        translateSelectionForJump(s, d);
        const sticky = jumpBy(s, d, trackTelemetry);
        notifyScroll(sticky, s);
      },
    },
    { context: 'Scroll', isActive },
  );

  // Modal pager keys — transcript mode only. less/tmux copy-mode lineage:
  // ctrl+u/d (half-page), ctrl+b/f (full-page), g/G (top/bottom). Tom's
  // resolution (2026-03-15): "In ctrl-o mode, ctrl-u, ctrl-d, etc. should
  // roughly just work!" — transcript is the copy-mode container.
  //
  // Safe because the conflicting handlers aren't reachable here:
  //   ctrl+u → kill-line, ctrl+d → exit: PromptInput not mounted
  //   ctrl+b → task:background: SessionBackgroundHint not mounted
  //   ctrl+f → chat:killAgents moved to ctrl+x ctrl+k; no conflict
  //   g/G → printable chars: no prompt to eat them, no vim/sticky gate needed
  //
  // TODO(search): `/`, n/N — build on Richard Kim's d94b07add4 (branch
  // claude/jump-recent-message-CEPcq). getItemY Yoga-walk + computeOrigin +
  // anchorY already solve scroll-to-index. jumpToPrevTurn is the n/N
  // template. Single-shot via OVERSCAN_ROWS=80; two-phase was tried and
  // abandoned (❯ oscillation). See team memory scroll-copy-mode-design.md.
  useInput(
    (input, key, event) => {
      const s = scrollRef.current;
      if (!s) return;
      const act = modalPagerAction(input, key);
      // Official y densable telemetry: line → scrolls, top → cap, other jumps → page.
      if (trackTelemetry && act !== null) {
        if (act === 'lineUp' || act === 'lineDown') recordScroll();
        else if (act === 'top') recordReachedScrollbackCap();
        else if (act !== 'bottom') recordPageJump();
      }
      const sticky = applyModalPagerAction(s, act, d => translateSelectionForJump(s, d), trackTelemetry);
      if (sticky === null) return;
      notifyScroll(sticky, s);
      event.stopImmediatePropagation();
    },
    { isActive: isActive && isModal },
  );

  // Esc clears selection; any other keystroke also clears it (matches
  // native terminal behavior where selection disappears on input).
  // Ctrl+C copies when a selection exists — needed on legacy terminals
  // where ctrl+shift+c sends the same byte (\x03, shift is lost) and
  // cmd+c never reaches the pty (terminal intercepts it for Edit > Copy).
  // Handled via raw useInput so we can conditionally consume: Esc/Ctrl+C
  // only stop propagation when a selection exists, letting them still work
  // for cancel-request / interrupt otherwise. Other keys never stop
  // propagation — they're observed to clear selection as a side-effect.
  // The selection:copy keybinding (ctrl+shift+c / cmd+c) registers above
  // via useKeybindings and consumes its event before reaching here.
  useInput(
    (input, key, event) => {
      if (!selection.hasSelection()) return;
      if (key.escape) {
        selection.clearSelection();
        event.stopImmediatePropagation();
        return;
      }
      if (key.ctrl && !key.shift && !key.meta && input === 'c') {
        copyAndToast();
        event.stopImmediatePropagation();
        return;
      }
      const move = selectionFocusMoveForKey(key);
      if (move) {
        selection.moveFocus(move);
        event.stopImmediatePropagation();
        return;
      }
      if (shouldClearSelectionOnKey(key)) {
        selection.clearSelection();
      }
    },
    { isActive },
  );

  useDragToScroll(scrollRef, selection, isActive, notifyScroll);
  useCopyOnSelect(selection, isActive, showCopiedToast);
  useSelectionBgColor(selection);

  return null;
}

/**
 * Auto-scroll the ScrollBox when the user drags a selection past its top or
 * bottom edge. The anchor is shifted in the opposite direction so it stays
 * on the same content (content that was at viewport row N is now at row N±d
 * after scrolling by d). Focus stays at the mouse position (edge row).
 *
 * Selection coords are screen-buffer-local, so the anchor is clamped to the
 * viewport bounds once the original content scrolls out. To preserve the full
 * selection, rows about to scroll out are captured into scrolledOffAbove/
 * scrolledOffBelow before each scroll step and joined back in by
 * getSelectedText.
 */
function useDragToScroll(
  scrollRef: RefObject<ScrollBoxHandle | null>,
  selection: ReturnType<typeof useSelection>,
  isActive: boolean,
  onScroll: Props['onScroll'],
): void {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const dirRef = useRef<-1 | 0 | 1>(0); // -1 scrolling up, +1 down, 0 idle
  // Survives stop() — reset only on drag-finish. See check() for semantics.
  const lastScrolledDirRef = useRef<-1 | 0 | 1>(0);
  const ticksRef = useRef(0);
  // onScroll may change identity every render (if not memoized by caller).
  // Read through a ref so the effect doesn't re-subscribe and kill the timer
  // on each scroll-induced re-render.
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  useEffect(() => {
    if (!isActive) return;

    function stop(): void {
      dirRef.current = 0;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    function tick(): void {
      const sel = selection.getState();
      const s = scrollRef.current;
      const dir = dirRef.current;
      // dir === 0 defends against a stale interval (start() may have set one
      // after the immediate tick already called stop() at a scroll boundary).
      // ticks cap defends against a lost release event (mouse released
      // outside terminal window) leaving isDragging stuck true.
      if (!sel?.isDragging || !sel.focus || !s || dir === 0 || ++ticksRef.current > AUTOSCROLL_MAX_TICKS) {
        stop();
        return;
      }
      // scrollBy accumulates into pendingScrollDelta; the screen buffer
      // doesn't update until the next render drains it. If a previous
      // tick's scroll hasn't drained yet, captureScrolledRows would read
      // stale content (same rows as last tick → duplicated in the
      // accumulator AND missing the rows that actually scrolled out).
      // Skip this tick; the 50ms interval will retry after Ink's 16ms
      // render catches up. Also prevents shiftAnchor from desyncing.
      if (s.getPendingDelta() !== 0) return;
      const top = s.getViewportTop();
      const bottom = top + s.getViewportHeight() - 1;
      // Clamp anchor within [top, bottom]. Not [0, bottom]: the ScrollBox
      // padding row at 0 would produce a blank line between scrolledOffAbove
      // and the on-screen content in getSelectedText. The padding-row
      // highlight was a minor visual nicety; text correctness wins.
      if (dir < 0) {
        if (s.getScrollTop() <= 0) {
          stop();
          return;
        }
        // Scrolling up: content moves down in viewport, so anchor row +N.
        // Clamp to actual scroll distance so anchor stays in sync when near
        // the top boundary (renderer clamps scrollTop to 0 on drain).
        const actual = Math.min(AUTOSCROLL_LINES, s.getScrollTop());
        // Capture rows about to scroll out the BOTTOM before scrollBy
        // overwrites them. Only rows inside the selection are captured
        // (captureScrolledRows intersects with selection bounds).
        selection.captureScrolledRows(bottom - actual + 1, bottom, 'below');
        selection.shiftAnchor(actual, 0, bottom);
        s.scrollBy(-AUTOSCROLL_LINES);
      } else {
        const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
        if (s.getScrollTop() >= max) {
          stop();
          return;
        }
        // Scrolling down: content moves up in viewport, so anchor row -N.
        // Clamp to actual scroll distance so anchor stays in sync when near
        // the bottom boundary (renderer clamps scrollTop to max on drain).
        const actual = Math.min(AUTOSCROLL_LINES, max - s.getScrollTop());
        // Capture rows about to scroll out the TOP.
        selection.captureScrolledRows(top, top + actual - 1, 'above');
        selection.shiftAnchor(-actual, top, bottom);
        s.scrollBy(AUTOSCROLL_LINES);
      }
      onScrollRef.current?.(false, s);
    }

    function start(dir: -1 | 1): void {
      // Record BEFORE early-return: the empty-accumulator reset in check()
      // may have zeroed this during the pre-crossing phase (accumulators
      // empty until the anchor row enters the capture range). Re-record
      // on every call so the corruption is instantly healed.
      lastScrolledDirRef.current = dir;
      if (dirRef.current === dir) return; // already going this way
      stop();
      dirRef.current = dir;
      ticksRef.current = 0;
      tick();
      // tick() may have hit a scroll boundary and called stop() (dir reset to
      // 0). Only start the interval if we're still going — otherwise the
      // interval would run forever with dir === 0 doing nothing useful.
      if (dirRef.current === dir) {
        timerRef.current = setInterval(tick, AUTOSCROLL_INTERVAL_MS);
      }
    }

    // Re-evaluated on every selection change (start/drag/finish/clear).
    // Drives drag-to-scroll autoscroll when the drag leaves the viewport.
    // Prior versions broke sticky here on drag-start to prevent selection
    // drift during streaming — ink.tsx now translates selection coords by
    // the follow delta instead (native terminal behavior: view keeps
    // scrolling, highlight walks up with the text). Keeping sticky also
    // avoids useVirtualScroll's tail-walk → forward-walk phantom growth.
    function check(): void {
      const s = scrollRef.current;
      if (!s) {
        stop();
        return;
      }
      const top = s.getViewportTop();
      const bottom = top + s.getViewportHeight() - 1;
      const sel = selection.getState();
      // Pass the LAST-scrolled direction (not dirRef) so the anchor guard is
      // bypassed after shiftAnchor has clamped anchor toward row 0. Using
      // lastScrolledDirRef (survives stop()) lets autoscroll resume after a
      // brief mouse dip into the viewport. Same-direction only — a mouse
      // jump from below-bottom to above-top must stop, since reversing while
      // the scrolledOffAbove/Below accumulators hold the prior direction's
      // rows would duplicate text in getSelectedText. Reset on drag-finish
      // OR when both accumulators are empty: startSelection clears them
      // (selection.ts), so a new drag after a lost-release (isDragging
      // stuck true, the reason AUTOSCROLL_MAX_TICKS exists) still resets.
      // Safe: start() below re-records lastScrolledDirRef before its
      // early-return, so a mid-scroll reset here is instantly undone.
      if (!sel?.isDragging || (sel.scrolledOffAbove.length === 0 && sel.scrolledOffBelow.length === 0)) {
        lastScrolledDirRef.current = 0;
      }
      const dir = dragScrollDirection(sel, top, bottom, lastScrolledDirRef.current);
      if (dir === 0) {
        // Blocked reversal: focus jumped to the opposite edge (off-window
        // drag return, fast flick). handleSelectionDrag already moved focus
        // past the anchor, flipping selectionBounds — the accumulator is
        // now orphaned (holds rows on the wrong side). Clear it so
        // getSelectedText matches the visible highlight.
        if (lastScrolledDirRef.current !== 0 && sel?.focus) {
          const want = sel.focus.row < top ? -1 : sel.focus.row > bottom ? 1 : 0;
          if (want !== 0 && want !== lastScrolledDirRef.current) {
            sel.scrolledOffAbove = [];
            sel.scrolledOffBelow = [];
            sel.scrolledOffAboveSW = [];
            sel.scrolledOffBelowSW = [];
            lastScrolledDirRef.current = 0;
          }
        }
        stop();
      } else start(dir);
    }

    const unsubscribe = selection.subscribe(check);
    return () => {
      unsubscribe();
      stop();
      lastScrolledDirRef.current = 0;
    };
  }, [isActive, scrollRef, selection]);
}

/**
 * Compute autoscroll direction for a drag selection relative to the ScrollBox
 * viewport. Returns 0 when not dragging, anchor/focus missing, or the anchor
 * is outside the viewport — a multi-click or drag that started in the input
 * area must not commandeer the message scroll (double-click in the input area
 * while scrolled up previously corrupted the anchor via shiftAnchor and
 * spuriously scrolled the message history every 50ms until release).
 *
 * alreadyScrollingDir bypasses the anchor-in-viewport guard once autoscroll
 * is active (shiftAnchor legitimately clamps the anchor toward row 0, below
 * `top`) but only allows SAME-direction continuation. If the focus jumps to
 * the opposite edge (below→above or above→below — possible with a fast flick
 * or off-window drag since mode 1002 reports on cell change, not per cell),
 * returns 0 to stop — reversing without clearing scrolledOffAbove/Below
 * would duplicate captured rows when they scroll back on-screen.
 */
export function dragScrollDirection(
  sel: SelectionState | null,
  top: number,
  bottom: number,
  alreadyScrollingDir: -1 | 0 | 1 = 0,
): -1 | 0 | 1 {
  if (!sel?.isDragging || !sel.anchor || !sel.focus) return 0;
  const row = sel.focus.row;
  const want: -1 | 0 | 1 = row < top ? -1 : row > bottom ? 1 : 0;
  if (alreadyScrollingDir !== 0) {
    // Same-direction only. Focus on the opposite side, or back inside the
    // viewport, stops the scroll — captured rows stay in scrolledOffAbove/
    // Below but never scroll back on-screen, so getSelectedText is correct.
    return want === alreadyScrollingDir ? want : 0;
  }
  // Anchor must be inside the viewport for us to own this drag. If the
  // user started selecting in the input box or header, autoscrolling the
  // message history is surprising and corrupts the anchor via shiftAnchor.
  if (sel.anchor.row < top || sel.anchor.row > bottom) return 0;
  return want;
}

// Keyboard page jumps: scrollTo() writes scrollTop directly and clears
// pendingScrollDelta — one frame, no drain. scrollBy() accumulates into
// pendingScrollDelta which the renderer drains over several frames
// (render-node-to-output.ts drainProportional/drainAdaptive) — correct for
// wheel smoothness, wrong for PgUp/ctrl+u where the user expects a snap.
// Target is relative to scrollTop+pendingDelta so a jump mid-wheel-burst
// lands where the wheel was heading.
//
// trackTelemetry (official poe r flag): when a jump lands at scrollTop 0,
// mark reachedScrollbackCap (p2r densable).
export function jumpBy(s: ScrollBoxHandle, delta: number, trackTelemetry = false): boolean {
  const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
  const target = s.getScrollTop() + s.getPendingDelta() + delta;
  if (target >= max) {
    // Eager-write scrollTop so follow-scroll sees followDelta=0. Callers
    // that ran translateSelectionForJump already shifted; scrollToBottom()
    // alone would double-shift via the render-phase sticky follow.
    s.scrollTo(max);
    // densable OJh on the max branch: autoScroll off clamps without sticky.
    if (getAutoScrollEnabled()) {
      s.scrollToBottom();
    }
    return true;
  }
  if (target <= 0 && trackTelemetry) {
    recordReachedScrollbackCap();
  }
  s.scrollTo(Math.max(0, target));
  return false;
}

// Wheel-down past maxScroll re-enables sticky so wheeling at the bottom
// naturally re-pins (matches typical chat-app behavior). Returns the
// resulting sticky state so callers can propagate it.
function scrollDown(s: ScrollBoxHandle, amount: number): boolean {
  const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
  // Include pendingDelta: scrollBy accumulates into pendingScrollDelta
  // without updating scrollTop, so getScrollTop() alone is stale within
  // a batch of wheel events. Without this, wheeling to the bottom never
  // re-enables sticky scroll.
  const effectiveTop = s.getScrollTop() + s.getPendingDelta();
  if (effectiveTop + amount >= max) {
    // densable OJh: autoScroll on → sticky pin; off → clamp to max without sticky.
    if (getAutoScrollEnabled()) {
      s.scrollToBottom();
    } else {
      s.scrollTo(max);
    }
    return true;
  }
  s.scrollBy(amount);
  return false;
}

// Wheel-up past scrollTop=0 clamps via scrollTo(0), clearing
// pendingScrollDelta so aggressive wheel bursts (e.g. MX Master free-spin)
// don't accumulate an unbounded negative delta. Without this clamp,
// useVirtualScroll's [effLo, effHi] span grows past what MAX_MOUNTED_ITEMS
// can cover and intermediate drain frames render at scrollTops with no
// mounted children — blank viewport.
export function scrollUp(s: ScrollBoxHandle, amount: number, trackTelemetry = false): void {
  // Include pendingDelta: scrollBy accumulates without updating scrollTop,
  // so getScrollTop() alone is stale within a batch of wheel events.
  const effectiveTop = s.getScrollTop() + s.getPendingDelta();
  if (effectiveTop - amount <= 0) {
    // Official UP_ densable: wheel-up past top marks scrollback cap.
    if (trackTelemetry) recordReachedScrollbackCap();
    s.scrollTo(0);
    return;
  }
  s.scrollBy(-amount);
}

export type ModalPagerAction =
  | 'lineUp'
  | 'lineDown'
  | 'halfPageUp'
  | 'halfPageDown'
  | 'fullPageUp'
  | 'fullPageDown'
  | 'top'
  | 'bottom';

/**
 * Maps a keystroke to a modal pager action. Exported for testing.
 * Returns null for keys the modal pager doesn't handle (they fall through).
 *
 * ctrl+u/d/b/f are the less-lineage bindings. g/G are bare letters (only
 * safe when no prompt is mounted). G arrives as input='G' shift=false on
 * legacy terminals, or input='g' shift=true on kitty-protocol terminals.
 * Lowercase g needs the !shift guard so it doesn't also match kitty-G.
 *
 * Key-repeat: stdin coalesces held-down printables into one multi-char
 * string (e.g. 'ggg'). Only uniform-char batches are handled — mixed input
 * like 'gG' isn't key-repeat. g/G are idempotent absolute jumps, so the
 * count is irrelevant (consuming the batch just prevents it from leaking
 * to the selection-clear-on-printable handler).
 */
export function modalPagerAction(
  input: string,
  key: Pick<Key, 'ctrl' | 'meta' | 'shift' | 'upArrow' | 'downArrow' | 'home' | 'end'>,
): ModalPagerAction | null {
  if (key.meta) return null;
  // Special keys first — arrows/home/end arrive with empty or junk input,
  // so these must be checked before any input-string logic. shift is
  // reserved for selection-extend (selectionFocusMoveForKey); ctrl+home/end
  // already has a useKeybindings route to scroll:top/bottom.
  if (!key.ctrl && !key.shift) {
    if (key.upArrow) return 'lineUp';
    if (key.downArrow) return 'lineDown';
    if (key.home) return 'top';
    if (key.end) return 'bottom';
  }
  if (key.ctrl) {
    if (key.shift) return null;
    switch (input) {
      case 'u':
        return 'halfPageUp';
      case 'd':
        return 'halfPageDown';
      case 'b':
        return 'fullPageUp';
      case 'f':
        return 'fullPageDown';
      // emacs-style line scroll (less accepts both ctrl+n/p and ctrl+e/y).
      // Works during search nav — fine-adjust after a jump without
      // leaving modal. No !searchOpen gate on this useInput's isActive.
      case 'n':
        return 'lineDown';
      case 'p':
        return 'lineUp';
      default:
        return null;
    }
  }
  // Bare letters. Key-repeat batches: only act on uniform runs.
  const c = input[0];
  if (!c || input !== c.repeat(input.length)) return null;
  // kitty sends G as input='g' shift=true; legacy as 'G' shift=false.
  // Check BEFORE the shift-gate so both hit 'bottom'.
  if (c === 'G' || (c === 'g' && key.shift)) return 'bottom';
  if (key.shift) return null;
  switch (c) {
    case 'g':
      return 'top';
    // j/k re-added per Tom Mar 18 — reversal of Mar 16 removal. Works
    // during search nav (fine-adjust after n/N lands) since isModal is
    // independent of searchOpen.
    case 'j':
      return 'lineDown';
    case 'k':
      return 'lineUp';
    // less: space = page down, b = page up. ctrl+b already maps above;
    // bare b is the less-native version.
    case ' ':
      return 'fullPageDown';
    case 'b':
      return 'fullPageUp';
    default:
      return null;
  }
}

/**
 * Applies a modal pager action to a ScrollBox. Returns the resulting sticky
 * state, or null if the action was null (nothing to do — caller should fall
 * through). Calls onBeforeJump(delta) before scrolling so the caller can
 * translate the text selection by the scroll delta (capture outgoing rows,
 * shift anchor+focus) instead of clearing it. Exported for testing.
 */
export function applyModalPagerAction(
  s: ScrollBoxHandle,
  act: ModalPagerAction | null,
  onBeforeJump: (delta: number) => void,
  trackTelemetry = false,
): boolean | null {
  switch (act) {
    case null:
      return null;
    case 'lineUp':
    case 'lineDown': {
      const d = act === 'lineDown' ? 1 : -1;
      onBeforeJump(d);
      return jumpBy(s, d, trackTelemetry);
    }
    case 'halfPageUp':
    case 'halfPageDown': {
      const half = Math.max(1, Math.floor(s.getViewportHeight() / 2));
      const d = act === 'halfPageDown' ? half : -half;
      onBeforeJump(d);
      return jumpBy(s, d, trackTelemetry);
    }
    case 'fullPageUp':
    case 'fullPageDown': {
      const page = Math.max(1, s.getViewportHeight());
      const d = act === 'fullPageDown' ? page : -page;
      onBeforeJump(d);
      return jumpBy(s, d, trackTelemetry);
    }
    case 'top':
      onBeforeJump(-(s.getScrollTop() + s.getPendingDelta()));
      s.scrollTo(0);
      return false;
    case 'bottom': {
      const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
      onBeforeJump(max - (s.getScrollTop() + s.getPendingDelta()));
      // Eager-write scrollTop before scrollToBottom — same double-shift
      // fix as scroll:bottom and jumpBy's max branch.
      s.scrollTo(max);
      s.scrollToBottom();
      return true;
    }
  }
}
