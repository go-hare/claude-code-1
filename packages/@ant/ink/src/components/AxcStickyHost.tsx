/**
 * densable `xxc` — main-screen sticky host: constructs `Axc`, installs
 * `Ink.frameSink`, layout-effect → `handleResize`.
 *
 * Gold: docs/upstream-extraction/v2.1.239/snippets/gold-project-c-xxc-host.txt
 *
 * While `Ink.isAltScreenActive`, sink suspends Axc and returns `false` so
 * Ink falls through to normal cell-diff paint. Axc is main-screen only.
 *
 * Live Qvt arm (`CLAUDE_CODE_AXC_STICKY_MAIN`) mounts this from FullscreenLayout
 * as densable `xxc({scrollable,bottom,overlay})`. `AxcFrameSinkBridge` remains
 * the tip-only install against a foreign Yoga tree — not the Qvt host.
 */

import React, { createContext, type ReactNode, type RefObject, useContext, useRef } from 'react';
import type { DOMElement } from '../core/dom.js';
import { NATIVE_HISTORY_BOTTOM_CHROME } from '../core/nativeHistoryPump.js';
import { useAxcFrameSink } from '../hooks/useAxcFrameSink.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import Box from './Box.js';
import ScrollBox, { type ScrollBoxHandle } from './ScrollBox.js';

/** densable `rSs` — scroll-anchor context for transcriptEnd (kxc / X$0). */
export const AxcScrollAnchorContext = createContext<RefObject<DOMElement | null> | null>(null);

export type AxcStickyHostProps = {
  scrollable: ReactNode;
  bottom: ReactNode;
  /** densable `pushUp` — chrome above bottom slot (spinner / suggestions). */
  pushUp?: ReactNode;
  overlay?: ReactNode;
  scrollRef?: RefObject<ScrollBoxHandle | null>;
};

/**
 * densable `xxc({scrollable,bottom,pushUp,overlay,scrollRef})`.
 */
export function AxcStickyHost({
  scrollable,
  bottom,
  pushUp,
  overlay,
  scrollRef: externalScrollRef,
}: AxcStickyHostProps): React.ReactNode {
  const { rows } = useTerminalSize();
  const bottomRef = useRef<DOMElement | null>(null);
  const overlayRef = useRef<DOMElement | null>(null);
  const anchorRef = useRef<DOMElement | null>(null);
  const localScrollRef = useRef<ScrollBoxHandle | null>(null);
  const scrollRef = externalScrollRef ?? localScrollRef;

  useAxcFrameSink({ scrollRef, bottomRef, overlayRef, anchorRef });

  return (
    <Box flexDirection="column" height={rows} width="100%" flexShrink={0}>
      <ScrollBox ref={scrollRef} flexGrow={1} flexDirection="column" stickyScroll>
        <AxcScrollAnchorContext.Provider value={anchorRef}>{scrollable}</AxcScrollAnchorContext.Provider>
      </ScrollBox>
      <Box
        ref={bottomRef}
        flexDirection="column"
        flexShrink={0}
        minHeight={NATIVE_HISTORY_BOTTOM_CHROME}
        maxHeight={rows - 2}
      >
        {pushUp}
        {bottom}
      </Box>
      {overlay != null ? (
        <Box
          ref={overlayRef}
          flexDirection="column"
          flexShrink={0}
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          opaque
        >
          {overlay}
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Tip bridge: install densable frameSink against an existing ScrollBox
 * (FullscreenLayout) without replacing Yoga structure. Callers must pass
 * bottomRef (prompt chrome / pushUp) and optionally overlayRef (modal) so
 * Axc can paint them — frameSink skips Ink cell-diff.
 *
 * Provides AxcScrollAnchorContext so transcript can mount densable kxc.
 */
export function AxcFrameSinkBridge({
  children,
  scrollRef,
  bottomRef,
  overlayRef,
  anchorRef: externalAnchorRef,
}: {
  children: ReactNode;
  scrollRef: RefObject<ScrollBoxHandle | null>;
  bottomRef?: RefObject<DOMElement | null>;
  overlayRef?: RefObject<DOMElement | null>;
  anchorRef?: RefObject<DOMElement | null>;
}): React.ReactNode {
  const localAnchorRef = useRef<DOMElement | null>(null);
  const anchorRef = externalAnchorRef ?? localAnchorRef;
  useAxcFrameSink({ scrollRef, bottomRef, overlayRef, anchorRef });
  return <AxcScrollAnchorContext.Provider value={anchorRef}>{children}</AxcScrollAnchorContext.Provider>;
}

/** densable `kxc` — zero-height scroll anchor for transcriptEnd. */
export function AxcScrollAnchor(): React.ReactNode {
  const ctx = useContext(AxcScrollAnchorContext);
  const local = useRef<DOMElement | null>(null);
  const ref = ctx ?? local;
  return <Box ref={ref} height={0} />;
}
