import React, { useContext, useLayoutEffect, useReducer, useRef } from 'react';
import { useTerminalSize, useTerminalViewport, Box } from '@anthropic/ink';
import { InVirtualListContext } from './messageActions.js';

type Props = {
  children: React.ReactNode;
};

/**
 * densable 2.1.212 E0 — freezes children when scrolled into scrollback.
 *
 * Any content change above the viewport forces log-update.ts into a full terminal
 * reset (it cannot partially update rows that have scrolled out). For content that
 * updates on a timer — spinners, elapsed counters — this produces a reset per tick.
 *
 * When offscreen, returns the same ReactElement reference that was cached during
 * the last visible render. React's reconciler bails on identical element refs, so
 * the subtree never re-renders, producing zero diff.
 *
 * densable #28: on terminal columns/rows change while frozen, recompute visibility
 * and force a re-render when the node is (again) visible so welcome-banner panel
 * widths recompute after a combined width+height resize in fullscreen.
 *
 * The cache is one slot deep: the first re-render after scrolling back into view
 * picks up the live children. Content still updates normally while visible.
 */
export function OffscreenFreeze({ children }: Props): React.ReactNode {
  // React Compiler: reading cached.current in the return is the entire
  // freeze mechanism — memoizing this component would defeat it. Opt out.
  'use no memo';
  const inVirtualList = useContext(InVirtualListContext);
  // densable r = Ure (TerminalSizeContext) — columns/rows deps for #28
  const { columns, rows } = useTerminalSize();
  // densable YVe: [ref, entry, recompute, pureCheck]
  const [ref, entry, recompute, pureCheck] = useTerminalViewport();
  const cached = useRef(children);
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  // densable: u = !((s() ?? o.isVisible) || t)
  // pureCheck during render so dual-dimension resize sees live yoga geometry.
  const isVisible = pureCheck() ?? entry.isVisible;
  const frozen = !(isVisible || inVirtualList);
  // Virtual list has no terminal scrollback — the ScrollBox clips inside the
  // viewport, so there's nothing to freeze. Freezing there also blocks
  // click-to-expand since useTerminalViewport's visibility calc can disagree
  // with the ScrollBox's virtual scroll position.
  if (!frozen) {
    cached.current = children;
  }

  // densable: useLayoutEffect(() => { if (u && i()) l() }, [d, p, u, i])
  // When frozen and size changes, recompute; if now visible, force update so
  // the next paint refreshes a.current with new panel widths (LogoV2 #28).
  useLayoutEffect(() => {
    if (frozen && recompute()) {
      forceUpdate();
    }
  }, [columns, rows, frozen, recompute]);

  return <Box ref={ref}>{cached.current}</Box>;
}
