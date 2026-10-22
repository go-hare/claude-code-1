import React, { type PropsWithChildren, useContext, useInsertionEffect } from 'react';
import { Ns } from '../core/instances.js';
import { type MouseTrackingMode } from '../core/termio/dec.js';
import Box from './Box.js';
import { TerminalSizeContext } from './TerminalSizeContext.js';
import TerminalModesContext from './TerminalModesContext.js';
import AlternateScreenHoverContext from './AlternateScreenHoverContext.js';
import { TerminalWriteContext } from '../hooks/useTerminalNotification.js';

type SurfaceColors = {
  background?: string | number;
  foreground?: string | number;
};

type Props = PropsWithChildren<{
  /**
   * Official densable AlternateScreen `mouseTracking` (default `"full"`):
   * - `"full"` / `true` — 1000+1002+1003+1006 (wheel + click/drag + hover)
   * - `"scroll"` — 1000+1006 only (wheel; no button-motion/any-motion)
   * - `"off"` / `false` — no mouse tracking
   */
  mouseTracking?: boolean | MouseTrackingMode;
  /**
   * densable `surface` — gold `c`. First insertion effect: `if(!t||!c)return`
   * then `r.set("surface",c)` via keepForNextFrame.
   */
  surface?: SurfaceColors;
}>;

function normalizeMouseTrackingMode(mouseTracking: boolean | MouseTrackingMode | undefined): MouseTrackingMode {
  // DualInk boolean aliases; gold `a=x===void 0?"full":x` for mode strings.
  if (mouseTracking === undefined || mouseTracking === true) return 'full';
  if (mouseTracking === false) return 'off';
  return mouseTracking;
}

/**
 * densable `Oae`.
 */
export function AlternateScreen({ children, mouseTracking, surface }: Props): React.ReactNode {
  const size = useContext(TerminalSizeContext);
  const writeRaw = useContext(TerminalWriteContext);
  const modes = useContext(TerminalModesContext);
  const mode = normalizeMouseTrackingMode(mouseTracking);

  // gold first Axe: if(!t||!c)return; r.set("surface",c) keepForNextFrame
  useInsertionEffect(() => {
    if (!writeRaw || !surface) return;
    const ink = Ns().get(process.stdout);
    const seq = modes?.set('surface', surface) ?? '';
    if (!ink?.keepForNextFrame(seq)) writeRaw(seq);
    return () => {
      const off = modes?.reset('surface') ?? '';
      if (!ink?.keepForNextFrame(off)) writeRaw(off);
    };
  }, [writeRaw, modes, surface]);

  // gold second Axe: if(!t)return; set altScreen+mouse+nativeCursorSeq
  useInsertionEffect(() => {
    if (!writeRaw) return;
    if (!modes) return;
    const ink = Ns().get(process.stdout);
    const enter = modes.set('altScreen') + modes.set('mouse', mode) + (ink?.nativeCursorSeq ?? '');
    if (!ink?.keepForNextFrame(enter)) writeRaw(enter);
    ink?.setAltScreenActive(true, mode);
    return () => {
      const leave = ink?.setAltScreenActive(false) ?? '';
      ink?.clearTextSelection();
      const mouseOff = modes.reset('mouse');
      const altOff = modes.reset('altScreen');
      const stillLive = altOff !== '' && !ink?.hasUnmounted;
      const keys = stillLive ? modes.reassert('extendedKeys') : '';
      const cursor = stillLive ? (ink?.nativeCursorSeq ?? '') : '';
      writeRaw(leave + mouseOff + altOff + keys + cursor);
    };
  }, [writeRaw, mode, modes]);

  return (
    <Box flexDirection="column" height={size?.rows ?? 24} width="100%" flexShrink={0}>
      <AlternateScreenHoverContext.Provider value={mode === 'full'}>{children}</AlternateScreenHoverContext.Provider>
    </Box>
  );
}
