import React, { type PropsWithChildren, useContext, useInsertionEffect } from 'react';
import instances from '../core/instances.js';
import {
  DISABLE_MOUSE_TRACKING,
  enableMouseTracking,
  enterAltScreenSequence,
  exitAltScreenSequence,
  type MouseTrackingMode,
} from '../core/termio/dec.js';
import { DISABLE_KITTY_KEYBOARD, ENABLE_KITTY_KEYBOARD, ENABLE_MODIFY_OTHER_KEYS } from '../core/termio/csi.js';
import { supportsExtendedKeys } from '../core/terminal.js';
import { TerminalWriteContext } from '../hooks/useTerminalNotification.js';
import Box from './Box.js';
import { TerminalSizeContext } from './TerminalSizeContext.js';

type Props = PropsWithChildren<{
  /**
   * Official densable AlternateScreen `mouseTracking` (default `"full"`):
   * - `"full"` / `true` — 1000+1002+1003+1006 (wheel + click/drag + hover)
   * - `"scroll"` — 1000+1006 only (wheel; no button-motion/any-motion)
   * - `"off"` / `false` — no mouse tracking
   */
  mouseTracking?: boolean | MouseTrackingMode;
}>;

function normalizeMouseTrackingMode(mouseTracking: boolean | MouseTrackingMode | undefined): MouseTrackingMode {
  if (mouseTracking === undefined || mouseTracking === true) return 'full';
  if (mouseTracking === false) return 'off';
  return mouseTracking;
}

/**
 * Run children in the terminal's alternate screen buffer, constrained to
 * the viewport height. While mounted:
 *
 * - Enters the alt screen (DEC 1049), clears it, homes the cursor
 * - Constrains its own height to the terminal row count, so overflow must
 *   be handled via `overflow: scroll` / flexbox (no native scrollback)
 * - Optionally enables SGR mouse tracking — events surface as `ParsedKey`
 *   (wheel) and update the Ink instance's selection state (click/drag)
 *
 * On unmount, disables mouse tracking and exits the alt screen, restoring
 * the main screen's content. Safe for use in ctrl-o transcript overlays
 * and similar temporary fullscreen views — the main screen is preserved.
 *
 * Notifies the Ink instance via `setAltScreenActive()` so the renderer
 * keeps the cursor inside the viewport (preventing the cursor-restore LF
 * from scrolling content) and so signal-exit cleanup can exit the alt
 * screen if the component's own unmount doesn't run.
 */
export function AlternateScreen({ children, mouseTracking = true }: Props): React.ReactNode {
  const size = useContext(TerminalSizeContext);
  const writeRaw = useContext(TerminalWriteContext);
  const mode = normalizeMouseTrackingMode(mouseTracking);
  const trackingOn = mode !== 'off';

  // useInsertionEffect (not useLayoutEffect): react-reconciler calls
  // resetAfterCommit between the mutation and layout commit phases, and
  // Ink's resetAfterCommit triggers onRender. With useLayoutEffect, that
  // first onRender fires BEFORE this effect — writing a full frame to the
  // main screen with altScreen=false. That frame is preserved when we
  // enter alt screen and revealed on exit as a broken view. Insertion
  // effects fire during the mutation phase, before resetAfterCommit, so
  // ENTER_ALT_SCREEN reaches the terminal before the first frame does.
  // Cleanup timing is unchanged: both insertion and layout effect cleanup
  // run in the mutation phase on unmount, before resetAfterCommit.
  useInsertionEffect(() => {
    const ink = instances.get(process.stdout);
    if (!writeRaw) return;

    writeRaw(enterAltScreenSequence(supportsExtendedKeys()) + enableMouseTracking(mode));
    ink?.setAltScreenActive(true, mode);

    return () => {
      // Snapshot before clearing: Ink.unmount() exits alt-screen itself, then
      // React teardown reaches this cleanup. Match official 2.1.210 by still
      // disabling mouse tracking while suppressing the second 1049l.
      const alreadyInactive = ink ? !ink.isAltScreenActive : false;
      ink?.setAltScreenActive(false);
      ink?.clearTextSelection();
      if (alreadyInactive) {
        writeRaw(trackingOn ? DISABLE_MOUSE_TRACKING : '');
        return;
      }
      writeRaw(
        (trackingOn ? DISABLE_MOUSE_TRACKING : '') +
          exitAltScreenSequence() +
          (ink?.hasUnmounted || !supportsExtendedKeys()
            ? ''
            : DISABLE_KITTY_KEYBOARD + ENABLE_KITTY_KEYBOARD + ENABLE_MODIFY_OTHER_KEYS),
      );
    };
  }, [writeRaw, mode, trackingOn]);

  return (
    <Box flexDirection="column" height={size?.rows ?? 24} width="100%" flexShrink={0}>
      {children}
    </Box>
  );
}
