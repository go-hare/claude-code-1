/**
 * Generic keybinding setup component for integrating KeybindingProvider into an app.
 *
 * Provides chord state management, a ChordInterceptor, and the KeybindingProvider
 * wrapper. App-specific dependencies (binding loading, change subscription,
 * warning display, debug logging) are injected via props.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { InputEvent } from '../core/events/input-event.js';
// ChordInterceptor intentionally uses useInput to intercept all keystrokes before
// other handlers process them - this is required for chord sequence support
// eslint-disable-next-line custom-rules/prefer-use-keybindings
import useInput from '../hooks/use-input.js';
import type { Key } from '../core/events/input-event.js';
import { type HandlerRegistration, KeybindingProvider, type PreDispatchHandler } from './KeybindingContext.js';
import { resolveKeyWithChordState } from './resolver.js';
import type {
  KeybindingContextName,
  KeybindingsLoadResult,
  ParsedBinding,
  ParsedKeystroke,
  KeybindingWarning,
} from './types.js';

/**
 * Timeout for chord sequences in milliseconds.
 * If the user doesn't complete the chord within this time, it's cancelled.
 */
const CHORD_TIMEOUT_MS = 1000;

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
};

export function KeybindingSetup({
  children,
  loadBindings,
  subscribeToChanges,
  initWatcher,
  onWarnings,
  onDebugLog,
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
  const handlerRegistryRef = useRef(new Map<string, Set<HandlerRegistration>>());

  // densable preDispatchRef — handlers run after chord path, before singleKey
  const preDispatchRef = useRef(new Set<PreDispatchHandler>());

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
          (pendingChordRef, setPendingChordState) => {
            onDebugLog?.('[keybindings] Chord timeout - cancelling');
            pendingChordRef.current = null;
            setPendingChordState(null);
          },
          CHORD_TIMEOUT_MS,
          pendingChordRef,
          setPendingChordState,
        );
      }

      // Update ref immediately for synchronous access in resolve()
      pendingChordRef.current = pending;
      // Update state to trigger re-renders for UI updates
      setPendingChordState(pending);
    },
    [clearChordTimeout, onDebugLog],
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
      preDispatchRef={preDispatchRef}
    >
      <ChordInterceptor
        bindings={bindings}
        pendingChordRef={pendingChordRef}
        setPendingChord={setPendingChord}
        activeContexts={activeContextsRef.current}
        handlerRegistryRef={handlerRegistryRef}
        preDispatchRef={preDispatchRef}
      />
      {children}
    </KeybindingProvider>
  );
}

/**
 * Global chord interceptor that registers useInput FIRST (before children).
 *
 * This component intercepts keystrokes that are part of chord sequences and
 * stops propagation before other handlers (like PromptInput) can see them.
 *
 * Without this, the second key of a chord (e.g., 'r' in "ctrl+c r") would be
 * captured by PromptInput and added to the input field before the keybinding
 * system could recognize it as completing a chord.
 *
 * densable also runs preDispatch (Q0t/Wlr) after the chord path and before
 * singleKey — selection esc/ctrl+c, digit-submit guards, etc. Then scans
 * singleKey handlers for non-chord keystrokes (e.g. enter rebound away from
 * chat:submit, or chat:submit rebound to a non-enter key). Handlers opt in
 * via singleKey:true.
 */
function ChordInterceptor({
  bindings,
  pendingChordRef,
  setPendingChord,
  activeContexts,
  handlerRegistryRef,
  preDispatchRef,
}: {
  bindings: ParsedBinding[];
  pendingChordRef: React.RefObject<ParsedKeystroke[] | null>;
  setPendingChord: (pending: ParsedKeystroke[] | null) => void;
  activeContexts: Set<KeybindingContextName>;
  handlerRegistryRef: React.RefObject<Map<string, Set<HandlerRegistration>>>;
  preDispatchRef: React.RefObject<Set<PreDispatchHandler>>;
}): null {
  /**
   * densable Wlr — invoke preDispatch handlers; first truthy return consumes
   * the event via stopImmediatePropagation.
   */
  const runPreDispatch = useCallback(
    (input: string, key: Key, event: InputEvent): boolean => {
      const handlers = preDispatchRef.current;
      if (!handlers || handlers.size === 0) return false;
      for (const handler of handlers) {
        try {
          if (handler(input, key, event) === true) {
            event.stopImmediatePropagation();
            return true;
          }
        } catch {
          // densable swallows handler errors via xe(_PA) — keep interceptor alive
        }
      }
      return false;
    },
    [preDispatchRef],
  );

  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      // Wheel events can never start chord sequences — scroll:lineUp/Down are
      // single-key bindings handled by per-component useKeybindings hooks, not
      // here. Skip the registry scan. Mid-chord wheel still falls through so
      // scrolling cancels the pending chord like any other non-matching key.
      if ((key.wheelUp || key.wheelDown) && pendingChordRef.current === null) {
        return;
      }

      // Build context list from registered handlers + activeContexts + Global
      const registry = handlerRegistryRef.current;
      const handlerContexts = new Set<KeybindingContextName>();
      if (registry) {
        for (const handlers of registry.values()) {
          for (const registration of handlers) {
            handlerContexts.add(registration.context);
          }
        }
      }
      const contexts: KeybindingContextName[] = [...handlerContexts, ...activeContexts, 'Global'];

      // Track whether we're completing a chord (pending was non-null)
      const wasInChord = pendingChordRef.current !== null;

      // Check if this keystroke is part of a chord sequence
      const result = resolveKeyWithChordState(input, key, contexts, bindings, pendingChordRef.current);

      switch (result.type) {
        case 'chord_started':
          // This key starts a chord - store pending state and stop propagation
          setPendingChord(result.pending);
          event.stopImmediatePropagation();
          return;

        case 'chord_cancelled':
          setPendingChord(null);
          event.stopImmediatePropagation();
          return;

        case 'unbound':
          // densable: mid-chord unbound cancels + stops; otherwise fall through
          // so singleKey handlers can still fire for non-chord unbound keys.
          setPendingChord(null);
          if (wasInChord) {
            event.stopImmediatePropagation();
            return;
          }
          break;

        case 'match': {
          // Clear pending state
          setPendingChord(null);

          // Chord completions (multi-keystroke) invoke handlers here and stop.
          // Single-keystroke matches fall through to the singleKey scan so
          // opt-in handlers (singleKey:true) can fire without double-handling
          // default enter:chat:submit (which registers singleKey:false).
          if (wasInChord) {
            if (registry) {
              const handlers = registry.get(result.action);
              if (handlers && handlers.size > 0) {
                for (const registration of handlers) {
                  if (contexts.includes(registration.context) || activeContexts.has(registration.context)) {
                    registration.handler();
                    event.stopImmediatePropagation();
                    return;
                  }
                }
              }
            }
            return;
          }
          break;
        }

        case 'none':
          // No chord involvement — fall through to preDispatch + singleKey
          break;
      }

      // densable: if(!lAo) return — no registry, nothing to dispatch
      if (!registry) return;

      // densable Wlr: preDispatch after chord path, before singleKey
      // (EPA skip is densable keyboard-event reentry; fork useInput path has no EPA)
      if (runPreDispatch(input, key, event)) {
        return;
      }

      // densable singleKey path: after chord match/none/unbound (non-chord),
      // scan handlers that opted into single-key interceptor dispatch.
      const resolvedByContext = new Map<KeybindingContextName, string | null>();
      for (const handlers of registry.values()) {
        for (const registration of handlers) {
          if (!registration.singleKey) continue;

          let resolved = resolvedByContext.get(registration.context);
          if (resolved === undefined) {
            const singleResult = resolveKeyWithChordState(
              input,
              key,
              [...activeContexts, registration.context, 'Global'],
              bindings,
              null,
            );
            resolved = singleResult.type === 'match' ? singleResult.action : null;
            resolvedByContext.set(registration.context, resolved);
          }

          if (resolved === registration.action) {
            if (registration.handler() !== false) {
              event.stopImmediatePropagation();
              return;
            }
          }
        }
      }
    },
    [bindings, pendingChordRef, setPendingChord, activeContexts, handlerRegistryRef, runPreDispatch],
  );

  useInput(handleInput);

  return null;
}
