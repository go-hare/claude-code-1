import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useTerminalViewport } from '../hooks/use-terminal-viewport.js';
import { Box, type DOMElement, measureElement } from '../index.js';

type Props = {
  children: React.ReactNode;
  lock?: 'always' | 'offscreen';
  restartKey?: unknown;
};

/**
 * densable `YV`. Gold:
 *   p = lock==="always" && (rows/cols/restartKey changed)
 *   H = (lock==="always" || !isVisible) && !p
 *   N = max(state.minHeight, x.current)
 *   B = ke(yN)!==null  — CLI scheduler Provider (always set in REPL)
 *   if p: reset minHeight to measured
 *   else if P>N: if B && offscreen && visible && h>=min && recompute():
 *                  x.current=h; return
 *                else setState minHeight
 * DualInk press `baseButton` omitted from 审查差异.
 */
export function Ratchet({ children, lock = 'always', restartKey }: Props): React.ReactNode {
  const [viewportRef, { isVisible }, recompute] = useTerminalViewport();
  const { rows, columns } = useTerminalSize();
  const innerRef = useRef<DOMElement | null>(null);
  const [snap, setSnap] = useState({
    minHeight: 0,
    rows,
    columns,
    restartKey,
  });
  const resized =
    lock === 'always' && (snap.rows !== rows || snap.columns !== columns || snap.restartKey !== restartKey);
  const engaged = (lock === 'always' || !isVisible) && !resized;
  const pendingRef = useRef(0);
  const floor = Math.max(snap.minHeight, pendingRef.current);

  useLayoutEffect(() => {
    if (!innerRef.current) return;
    const { height } = measureElement(innerRef.current);
    const h = Math.min(height, rows);
    if (resized) {
      setSnap({ minHeight: h, rows, columns, restartKey });
      return;
    }
    if (height > floor) {
      if (lock === 'offscreen' && !engaged && h >= snap.minHeight && recompute()) {
        pendingRef.current = h;
        return;
      }
      pendingRef.current = 0;
      setSnap(prev => (prev.minHeight === h ? prev : { ...prev, minHeight: h }));
    }
  });

  return (
    <Box minHeight={engaged ? floor : undefined} ref={viewportRef}>
      <Box ref={innerRef} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
