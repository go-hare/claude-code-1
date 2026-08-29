/**
 * Main-screen fullscreen shell for Axc sticky (no DEC 1049 alt buffer).
 *
 * Mirrors AlternateScreen's viewport height + mouse tracking, but does not
 * enter alt-screen or call setAltScreenActive — so Ink.frameSink / Axc stay
 * active (alt suspends Axc).
 */

import React, { type PropsWithChildren, useContext, useInsertionEffect } from 'react';
import instances from '../core/instances.js';
import { DISABLE_MOUSE_TRACKING, enableMouseTracking, type MouseTrackingMode } from '../core/termio/dec.js';
import { TerminalWriteContext } from '../hooks/useTerminalNotification.js';
import Box from './Box.js';
import { TerminalSizeContext } from './TerminalSizeContext.js';

type Props = PropsWithChildren<{
  /**
   * Same contract as AlternateScreen.mouseTracking:
   * `"full"` / true | `"scroll"` | `"off"` / false
   */
  mouseTracking?: boolean | MouseTrackingMode;
}>;

function normalizeMouseTrackingMode(mouseTracking: boolean | MouseTrackingMode | undefined): MouseTrackingMode {
  if (mouseTracking === undefined || mouseTracking === true) return 'full';
  if (mouseTracking === false) return 'off';
  return mouseTracking;
}

/**
 * Constrains children to terminal rows and optionally enables SGR mouse
 * tracking on the main screen (for sticky Axc / CLAUDE_CODE_AXC_STICKY_MAIN).
 */
export function MainScreenShell({ children, mouseTracking = true }: Props): React.ReactNode {
  const size = useContext(TerminalSizeContext);
  const writeRaw = useContext(TerminalWriteContext);
  const mode = normalizeMouseTrackingMode(mouseTracking);
  const trackingOn = mode !== 'off';

  useInsertionEffect(() => {
    const ink = instances.get(process.stdout);
    if (!writeRaw) return;

    writeRaw(enableMouseTracking(mode));
    ink?.setMouseTracking(mode);

    return () => {
      ink?.setMouseTracking('off');
      if (trackingOn) writeRaw(DISABLE_MOUSE_TRACKING);
    };
  }, [writeRaw, mode, trackingOn]);

  return (
    <Box flexDirection="column" height={size?.rows ?? 24} width="100%" flexShrink={0}>
      {children}
    </Box>
  );
}
