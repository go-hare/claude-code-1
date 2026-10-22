import React, { createContext, useEffect, useState } from 'react';
import { FRAME_INTERVAL_MS } from '../core/constants.js';
import { useTerminalFocus } from '../hooks/use-terminal-focus.js';

export type Clock = {
  subscribeKeepAlive: (onChange: () => void) => () => void;
  subscribeFollower: (onChange: () => void) => () => void;
  now: () => number;
  setTickInterval: (ms: number) => void;
  setTimeout: (callback: () => void, ms: number) => () => void;
};

/** densable `Lo` — floor for `KTt` when alt-screen full-repaint is on. */
const ALT_SCREEN_MIN_ANIM_MS = 480;

/**
 * densable `KTt` then `Math.ceil(KTt(o)/Vh)*Vh`.
 * Gold: `a.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT?Math.max(o,Lo):o`.
 */
export function snapClockIntervalMs(intervalMs: number): number {
  const stepped = process.env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT
    ? Math.max(intervalMs, ALT_SCREEN_MIN_ANIM_MS)
    : intervalMs;
  return Math.ceil(stepped / FRAME_INTERVAL_MS) * FRAME_INTERVAL_MS;
}

export function createClock(tickIntervalMs: number): Clock {
  const subscribers = new Map<() => void, boolean>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let currentTickIntervalMs = tickIntervalMs;
  // densable `l` — stamped at construction (`performance.now()`).
  const origin = performance.now();
  // densable `i` — last tick snapshot while the interval is live.
  let tickTime = 0;

  function tick(): void {
    tickTime = performance.now() - origin;
    for (const onChange of subscribers.keys()) {
      onChange();
    }
  }

  function updateInterval(): void {
    const anyKeepAlive = [...subscribers.values()].some(Boolean);

    if (anyKeepAlive) {
      if (interval !== null) {
        clearInterval(interval);
      } else {
        tickTime = performance.now() - origin;
      }
      interval = setInterval(tick, currentTickIntervalMs);
    } else if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  }

  // densable `f` — gold Clock inner helper (not a public bind).
  function f(onChange: () => void, keepAlive: boolean): () => void {
    subscribers.set(onChange, keepAlive);
    updateInterval();
    return () => {
      subscribers.delete(onChange);
      updateInterval();
    };
  }

  return {
    subscribeKeepAlive(onChange) {
      return f(onChange, true);
    },
    subscribeFollower(onChange) {
      return f(onChange, false);
    },
    now() {
      if (interval !== null) return tickTime;
      return performance.now() - origin;
    },
    setTickInterval(ms) {
      if (ms === currentTickIntervalMs) return;
      currentTickIntervalMs = ms;
      updateInterval();
    },
    setTimeout(callback, ms) {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  };
}

export const ClockContext = createContext<Clock | null>(null);

const BLURRED_TICK_INTERVAL_MS = FRAME_INTERVAL_MS * 2;

// Own component so App.tsx doesn't re-render when the clock is created.
// The clock value is stable (created once via useState), so the provider
// never causes consumer re-renders on its own.
export function ClockProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [clock] = useState(() => createClock(FRAME_INTERVAL_MS));
  const focused = useTerminalFocus();

  useEffect(() => {
    clock.setTickInterval(focused ? FRAME_INTERVAL_MS : BLURRED_TICK_INTERVAL_MS);
  }, [clock, focused]);

  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}
