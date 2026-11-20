/**
 * Generic keybinding setup component for integrating KeybindingProvider into an app.
 *
 * Provides chord state management, a ChordInterceptor, and the KeybindingProvider
 * wrapper. App-specific dependencies (binding loading, change subscription,
 * warning display, debug logging) are injected via props.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Box from '../components/Box.js';
import { InputEvent, type Key } from '../core/events/input-event.js';
import type { KeyboardEvent } from '../core/events/keyboard-event.js';
import type { WheelEvent } from '../core/events/wheel-event.js';
import { getFocusManager } from '../core/focus.js';
import { wheelCaptureOwnedByDescendant } from '../core/hit-test.js';
import type { ParsedKey } from '../core/parse-keypress.js';
import type { DOMElement } from '../core/dom.js';
import { reclaimIfNullOrAncestor } from '../hooks/use-focus-reclaim.js';
import useStdin from '../hooks/use-stdin.js';
import { KeybindingProvider } from './KeybindingContext.js';
import { formatChords, shortcutFormatPlatform } from './formatChord.js';
import { resolveKeyWithChordState } from './resolver.js';
// ChordInterceptor intentionally uses useInput to intercept all keystrokes before
// other handlers process them - this is required for chord sequence support
// eslint-disable-next-line custom-rules/prefer-use-keybindings
import useInput from '../hooks/use-input.js';
import type {
  KeybindingContextName,
  KeybindingsLoadResult,
  ParsedBinding,
  ParsedKeystroke,
  KeybindingWarning,
} from './types.js';

/**
 * Timeout for chord sequences in milliseconds (official 2.1.328 `Ze`: `Je = 3000`).
 * If the user doesn't complete the chord within this time, it's cancelled.
 */
export const CHORD_TIMEOUT_MS = 3000;

export type ChordTimeoutNotification = {
  pending: ParsedKeystroke[];
  key: 'chord-timeout';
  kind: 'feedback';
  text: string;
  row1Hint: string;
  priority: 'immediate';
  timeoutMs: number;
};

/** densable kmo `J` — KeyboardEvent.name → Key flag. */
const KEYBOARD_NAME_TO_FLAG: Record<string, keyof Key> = {
  up: 'upArrow',
  down: 'downArrow',
  left: 'leftArrow',
  right: 'rightArrow',
  pagedown: 'pageDown',
  pageup: 'pageUp',
  home: 'home',
  end: 'end',
  return: 'return',
  escape: 'escape',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
};

/**
 * densable `kmo` — KeyboardEvent → InputEvent `{input,key}` for Yt `G`.
 * Gold: enter → "\\n"; else `[...key].length===1 ? key : ""`.
 */
function kmo(event: KeyboardEvent): { input: string; key: Key } {
  const flag = KEYBOARD_NAME_TO_FLAG[event.name];
  const key: Key = {
    upArrow: flag === 'upArrow',
    downArrow: flag === 'downArrow',
    leftArrow: flag === 'leftArrow',
    rightArrow: flag === 'rightArrow',
    pageDown: flag === 'pageDown',
    pageUp: flag === 'pageUp',
    wheelUp: false,
    wheelDown: false,
    home: flag === 'home',
    end: flag === 'end',
    return: flag === 'return',
    escape: flag === 'escape',
    tab: flag === 'tab',
    backspace: flag === 'backspace',
    delete: flag === 'delete',
    ctrl: event.ctrl,
    shift: event.shift,
    fn: event.fn,
    super: event.superKey,
    meta: event.meta,
  };
  const shortcutKey = event.shortcutKey;
  return {
    input: event.name === 'enter' ? '\n' : [...shortcutKey].length === 1 ? shortcutKey : '',
    key,
  };
}

/** densable Yt `it` — consume KeyboardEvent after G/N chord path. */
function it(event: KeyboardEvent | WheelEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

export type KeybindingSetupProps = {
  children: React.ReactNode;

  /** Load bindings synchronously for initial render */
  loadBindings: () => KeybindingsLoadResult;

  /** Subscribe to binding changes; return an unsubscribe function */
  subscribeToChanges: (callback: (result: KeybindingsLoadResult) => void) => () => void;

  /** Initialize any file watcher (idempotent). Called once on mount. */
  initWatcher?: () => void | Promise<void>;

  /** Optional callback when warnings are emitted (initial load or reload) */
  onWarnings?: (warnings: KeybindingWarning[], isReload: boolean) => void;

  /** Optional debug logger */
  onDebugLog?: (message: string) => void;

  /**
   * Optional callback invoked when a pending chord times out after CHORD_TIMEOUT_MS
   * (official 2.1.328 `Ze` `chord-timeout` feedback notification).
   */
  onChordTimeout?: (notification: ChordTimeoutNotification) => void;
};

/** Track InputEvents already chord-checked during capture phase so ChordInterceptor does not double-process them. */
const captureCheckedEvents = new WeakSet<InputEvent>();

export function KeybindingSetup({
  children,
  loadBindings,
  subscribeToChanges,
  initWatcher,
  onWarnings,
  onDebugLog,
  onChordTimeout,
}: KeybindingSetupProps): React.ReactNode {
  // Load bindings synchronously for initial render
  const [loadResult, setLoadResult] = useState<KeybindingsLoadResult>(() => {
    const result = loadBindings();
    onDebugLog?.(
      `[keybindings] KeybindingSetup initialized with ${result.bindings.length} bindings, ${result.warnings.length} warnings`,
    );
    return result;
  });

  const { bindings, warnings } = loadResult;

  // Track if this is a reload (not initial load)
  const [isReload, setIsReload] = useState(false);

  // Notify about warnings
  useEffect(() => {
    onWarnings?.(warnings, isReload);
  }, [warnings, isReload, onWarnings]);

  // Chord state management - use ref for immediate access, state for re-renders
  const pendingChordRef = useRef<ParsedKeystroke[] | null>(null);
  const [pendingChord, setPendingChordState] = useState<ParsedKeystroke[] | null>(null);
  const chordTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handler registry for action callbacks (used by ChordInterceptor to invoke handlers)
  const handlerRegistryRef = useRef(
    new Map<
      string,
      Set<{
        action: string;
        context: KeybindingContextName;
        handler: () => void;
      }>
    >(),
  );

  // Active context tracking for keybinding priority resolution
  const activeContextsRef = useRef<Set<KeybindingContextName>>(new Set());

  const registerActiveContext = useCallback((context: KeybindingContextName) => {
    activeContextsRef.current.add(context);
  }, []);

  const unregisterActiveContext = useCallback((context: KeybindingContextName) => {
    activeContextsRef.current.delete(context);
  }, []);

  // Clear chord timeout when component unmounts or chord changes
  const clearChordTimeout = useCallback(() => {
    if (chordTimeoutRef.current) {
      clearTimeout(chordTimeoutRef.current);
      chordTimeoutRef.current = null;
    }
  }, []);

  // Wrapper for setPendingChord that manages timeout and syncs ref+state
  const setPendingChord = useCallback(
    (pending: ParsedKeystroke[] | null) => {
      clearChordTimeout();

      if (pending !== null) {
        // Set timeout to cancel chord if not completed
        chordTimeoutRef.current = setTimeout(
          (pendingChordRef, setPendingChordState, timedOutPending) => {
            onDebugLog?.('[keybindings] Chord timeout - cancelling');
            pendingChordRef.current = null;
            setPendingChordState(null);
            if (onChordTimeout) {
              const chordDisplay = formatChords([timedOutPending], {
                platform: shortcutFormatPlatform(),
              });
              onChordTimeout({
                pending: timedOutPending,
                key: 'chord-timeout',
                kind: 'feedback',
                text: `${chordDisplay} cancelled · no next key within ${CHORD_TIMEOUT_MS / 1000}s`,
                row1Hint: `${chordDisplay} timed out`,
                priority: 'immediate',
                timeoutMs: CHORD_TIMEOUT_MS,
              });
            }
          },
          CHORD_TIMEOUT_MS,
          pendingChordRef,
          setPendingChordState,
          pending,
        );
      }

      // Update ref immediately for synchronous access in resolve()
      pendingChordRef.current = pending;
      // Update state to trigger re-renders for UI updates
      setPendingChordState(pending);
    },
    [clearChordTimeout, onDebugLog, onChordTimeout],
  );

  useEffect(() => {
    // Initialize file watcher (idempotent - only runs once)
    void initWatcher?.();

    // Subscribe to changes
    const unsubscribe = subscribeToChanges(result => {
      // Any callback invocation is a reload since initial load happens
      // synchronously in useState, not via this subscription
      setIsReload(true);

      setLoadResult(result);
      onDebugLog?.(`[keybindings] Reloaded: ${result.bindings.length} bindings, ${result.warnings.length} warnings`);
    });

    return () => {
      unsubscribe();
      clearChordTimeout();
    };
  }, [subscribeToChanges, initWatcher, clearChordTimeout, onDebugLog]);

  const { internal_eventEmitter } = useStdin();
  // densable Yt nR — Xt `d()` then subscribe. Gold never focus(self) while a
  // descendant (prompt tabIndex 0) is focused. Parent layout runs after child.
  const keybindingRootRef = useRef<DOMElement | null>(null);
  useLayoutEffect(() => {
    const node = keybindingRootRef.current;
    if (!node) return;
    let fm: ReturnType<typeof getFocusManager>;
    try {
      fm = getFocusManager(node);
    } catch {
      return;
    }
    const reclaim = (): void => {
      const current = keybindingRootRef.current;
      if (!current) return;
      reclaimIfNullOrAncestor(fm, current);
    };
    reclaim();
    return fm.subscribe(reclaim);
  }, []);
  // Shared chord interception logic used in capture phase (ahead of ALL
  // EventEmitter listeners including `{ prepend: true }`, matching official Gt)
  // and as a fallback in ChordInterceptor for synthetic direct 'input' emits.
  const interceptChord = useCallback(
    (input: string, key: Key): boolean => {
      // Wheel events can never start chord sequences — scroll:lineUp/Down are
      // single-key bindings handled by per-component useKeybindings hooks, not
      // here. Skip the registry scan. Mid-chord wheel still falls through so
      // scrolling cancels the pending chord like any other non-matching key.
      if ((key.wheelUp || key.wheelDown) && pendingChordRef.current === null) {
        return false;
      }

      const registry = handlerRegistryRef.current;
      const handlerContexts = new Set<KeybindingContextName>();
      if (registry) {
        for (const handlers of registry.values()) {
          for (const registration of handlers) {
            handlerContexts.add(registration.context);
          }
        }
      }
      const contexts: KeybindingContextName[] = [...handlerContexts, ...activeContextsRef.current, 'Global'];
      const wasInChord = pendingChordRef.current !== null;
      const result = resolveKeyWithChordState(input, key, contexts, bindings, pendingChordRef.current);

      switch (result.type) {
        case 'chord_started':
          setPendingChord(result.pending);
          return true;

        case 'match': {
          setPendingChord(null);
          if (wasInChord) {
            const contextsSet = new Set(contexts);
            if (registry) {
              const handlers = registry.get(result.action);
              if (handlers && handlers.size > 0) {
                for (const registration of handlers) {
                  if (contextsSet.has(registration.context)) {
                    registration.handler();
                    break;
                  }
                }
              }
            }
            // Official 2.1.323 (#1990) `U`: swallow the completing key of a
            // chord (unless wheel) even when the chord's action has no active
            // handler in the current dialog/context.
            return !key.wheelUp && !key.wheelDown;
          }
          return false;
        }

        case 'chord_cancelled':
          setPendingChord(null);
          return true;

        case 'unbound':
          setPendingChord(null);
          return true;

        case 'none':
          return false;
      }
    },
    [bindings, setPendingChord],
  );

  // densable Yt `G` — kmo + capture-phase chord interception ahead of
  // `{ prepend: true }` listeners, then InputEvent dispatch.
  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent) => {
      const { input, key } = kmo(event);
      // densable: focused node's textEntry===true and a single printable key
      // is input, not a shortcut — EXCEPT mid-chord (#1990), where the second
      // key must still complete/cancel the pending chord instead of acting on
      // the text field.
      const target = event.target as { attributes?: { textEntry?: boolean } } | null;
      if (
        pendingChordRef.current === null &&
        target?.attributes?.textEntry === true &&
        event.key.length === 1 &&
        !event.ctrl &&
        !event.meta &&
        !event.superKey
      ) {
        return;
      }
      if (interceptChord(input, key)) {
        it(event);
        return;
      }
      const parsed: ParsedKey = {
        kind: 'key',
        name: event.name,
        fn: event.fn,
        ctrl: event.ctrl,
        meta: event.meta,
        shift: event.shift,
        option: false,
        super: event.superKey,
        sequence: event.sequence,
        raw: event.sequence,
      };
      const inputEvent = new InputEvent(parsed);
      captureCheckedEvents.add(inputEvent);
      internal_eventEmitter.emit('input', inputEvent);
      if (inputEvent.didStopImmediatePropagation()) {
        it(event);
      }
    },
    [interceptChord, internal_eventEmitter],
  );
  // densable Yt `N` — onWheelCapture synthesizes wheelup/wheeldown unless
  // eo: a descendant onWheel owns the hit (ReplDiff / plugin panes).
  const handleWheelCapture = useCallback(
    (event: WheelEvent) => {
      if (wheelCaptureOwnedByDescendant(event.target, event.currentTarget, event.col, event.row)) {
        return;
      }
      const wheelKey: Key = {
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        wheelUp: event.deltaY < 0,
        wheelDown: event.deltaY > 0,
        home: false,
        end: false,
        return: false,
        escape: false,
        tab: false,
        backspace: false,
        delete: false,
        ctrl: event.ctrl,
        shift: event.shift,
        fn: false,
        super: false,
        meta: event.meta,
      };
      if (interceptChord('', wheelKey)) {
        it(event);
        return;
      }
      const name = event.deltaY < 0 ? 'wheelup' : 'wheeldown';
      const parsed: ParsedKey = {
        kind: 'key',
        name,
        fn: false,
        ctrl: event.ctrl,
        meta: event.meta,
        shift: event.shift,
        option: false,
        super: false,
        sequence: '',
        raw: '',
      };
      const inputEvent = new InputEvent(parsed);
      captureCheckedEvents.add(inputEvent);
      internal_eventEmitter.emit('input', inputEvent);
      it(event);
    },
    [interceptChord, internal_eventEmitter],
  );

  return (
    <KeybindingProvider
      bindings={bindings}
      pendingChordRef={pendingChordRef}
      pendingChord={pendingChord}
      setPendingChord={setPendingChord}
      activeContexts={activeContextsRef.current}
      registerActiveContext={registerActiveContext}
      unregisterActiveContext={unregisterActiveContext}
      handlerRegistryRef={handlerRegistryRef}
    >
      <Box
        ref={keybindingRootRef}
        tabIndex={-1}
        flexDirection="column"
        flexGrow={1}
        onKeyDownCapture={handleKeyDownCapture}
        onWheelCapture={handleWheelCapture}
      >
        <ChordInterceptor interceptChord={interceptChord} />
        {children}
      </Box>
    </KeybindingProvider>
  );
}

/**
 * Fallback chord interceptor for direct `internal_eventEmitter.emit('input')`
 * paths that bypass DOM capture. Normal keyboard/wheel events are already
 * chord-checked in capture phase before any `useInput` listener (including
 * `{ prepend: true }`) runs.
 */
function ChordInterceptor({ interceptChord }: { interceptChord: (input: string, key: Key) => boolean }): null {
  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      if (captureCheckedEvents.has(event)) {
        return;
      }
      if (interceptChord(input, key)) {
        event.stopImmediatePropagation();
      }
    },
    [interceptChord],
  );

  useInput(handleInput, { prepend: true });

  return null;
}
