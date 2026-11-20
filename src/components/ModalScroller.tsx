/**
 * densable lRc — modal pane scroller around ozs content (non-Qvt / non-AXC).
 * Gold: docs/upstream-extraction/v2.1.239/snippets/gold-fullscreen-modal-layout.txt
 */
import figures from 'figures';
import React, { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  type DOMElement,
  type KeyboardEvent,
  ModalContext,
  ScrollBox,
  type ScrollBoxHandle,
  type ScrollViewport,
  Text,
  useApp,
} from '@anthropic/ink';

/** densable Aee — horizontal padding on lRc children. */
const MODAL_SCROLLER_PADDING_X = 2;

type OverflowState = {
  overflows: boolean;
  above: boolean;
  below: boolean;
  hintTop: number;
  hintBottom: number;
};

const EMPTY_OVERFLOW: OverflowState = {
  overflows: false,
  above: false,
  below: false,
  hintTop: 0,
  hintBottom: 0,
};

type Props = {
  scrollViewport?: ScrollViewport | null;
  maxRows: number;
  children: ReactNode;
};

export function ModalScroller({ scrollViewport, maxRows, children }: Props): React.ReactNode {
  const zxc = useContext(ModalContext);
  const claimedHeightRef = useRef<number | null>(null);
  const [claimedHeight, setClaimedHeight] = useState<number | null>(null);
  const claimScrollBox = useCallback((height: number | null) => {
    claimedHeightRef.current = height;
    setClaimedHeight(height);
  }, []);
  const claimed = claimedHeight !== null;
  const remainingRows = maxRows - (claimedHeight ?? 0);
  const innerScrollRef = useRef<ScrollBoxHandle | null>(null);

  const [overflow, setOverflow] = useState<OverflowState>(EMPTY_OVERFLOW);

  const measure = useCallback(() => {
    const handle = scrollViewport?.handle;
    if (!handle) {
      return;
    }
    const contentHeight = handle.getFreshScrollHeight();
    const viewportHeight = handle.getViewportHeight() || remainingRows;
    const wrapTop = innerScrollRef.current?.getViewportTop() ?? 0;
    const wrapHeight = innerScrollRef.current?.getViewportHeight() ?? 0;
    const hintTop = Math.max(0, handle.getViewportTop() - wrapTop);
    const hintBottom = Math.max(0, wrapHeight - hintTop - viewportHeight);
    const page = claimedHeightRef.current !== null ? viewportHeight : remainingRows;
    const overflows = contentHeight > page;
    const scrollTop = handle.getScrollTop() + handle.getPendingDelta();
    const canScroll = contentHeight - page > 2;
    const above = canScroll && scrollTop > 0;
    const below = canScroll && scrollTop < contentHeight - viewportHeight;
    setOverflow(prev =>
      prev.overflows === overflows &&
      prev.above === above &&
      prev.below === below &&
      prev.hintTop === hintTop &&
      prev.hintBottom === hintBottom
        ? prev
        : { overflows, above, below, hintTop, hintBottom },
    );
  }, [remainingRows, scrollViewport]);

  const wrapRef = useRef<DOMElement | null>(null);
  const savedFocusRef = useRef<DOMElement | null>(null);
  // densable Twe.focusManager — lRc Syn / JF0
  const { focusManager: vyn } = useApp();

  const reclaimFocus = useCallback(() => {
    const Gxc = wrapRef.current;
    // Gold: if (!Gxc || !vyn) return
    if (!Gxc || !vyn) {
      return;
    }
    for (let Vxc: DOMElement | undefined | null = vyn.activeElement ?? undefined; Vxc; Vxc = Vxc.parentNode) {
      if (Vxc === Gxc) {
        savedFocusRef.current = vyn.activeElement;
        return;
      }
    }
    const ZF0 = savedFocusRef.current;
    for (let qxc: DOMElement | undefined | null = ZF0 ?? undefined; qxc; qxc = qxc.parentNode) {
      if (qxc === Gxc) {
        // Gold: vyn.focus(ZF0). Loop body only reachable when ZF0 is truthy.
        vyn.focus(ZF0!);
        return;
      }
    }
    vyn.focus(Gxc);
  }, [vyn]);

  useEffect(() => {
    reclaimFocus();
  }, [reclaimFocus]);

  useEffect(() => {
    measure();
    const unsub = scrollViewport?.subscribe(measure);
    return () => {
      unsub?.();
    };
  }, [measure, scrollViewport]);

  useEffect(() => {
    const id = setInterval(() => {
      measure();
      reclaimFocus();
    }, 50);
    return () => {
      clearInterval(id);
    };
  }, [measure, reclaimFocus]);

  const innerRows = zxc?.rows ?? maxRows;
  const innerColumns = zxc?.columns ?? 0;
  const innerValue = useMemo(
    () => ({
      rows: innerRows,
      columns: innerColumns,
      scrollViewport: scrollViewport ?? null,
      claimScrollBox,
    }),
    [innerRows, innerColumns, scrollViewport, claimScrollBox],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrl || event.meta || event.shift) {
        return;
      }
      const handle = scrollViewport?.handle;
      if (!handle) {
        return;
      }
      const contentHeight = handle.getFreshScrollHeight();
      const viewportHeight = handle.getViewportHeight() || remainingRows;
      const page = claimedHeightRef.current !== null ? viewportHeight : remainingRows;
      if (contentHeight <= page) {
        return;
      }
      if (event.key === 'up' || event.key === 'down') {
        handle.scrollBy(event.key === 'down' ? 1 : -1);
        event.preventDefault();
        return;
      }
      if (event.key === 'pageup' || event.key === 'pagedown') {
        const delta = Math.max(1, page);
        handle.scrollBy(event.key === 'pagedown' ? delta : -delta);
        event.preventDefault();
        return;
      }
      if (event.key === 'home') {
        handle.scrollTo(0);
        event.preventDefault();
        return;
      }
      if (event.key === 'end') {
        handle.scrollToBottom();
        event.preventDefault();
      }
    },
    [remainingRows, scrollViewport],
  );

  const scrollBoxHeight = !claimed && overflow.overflows ? remainingRows : undefined;
  const attachInnerScroll = useCallback(
    (handle: ScrollBoxHandle | null) => {
      innerScrollRef.current = handle;
      if (!claimed && scrollViewport) {
        const detach = scrollViewport.attach(handle);
        return () => {
          detach();
          innerScrollRef.current = null;
        };
      }
      return undefined;
    },
    [claimed, scrollViewport],
  );

  return (
    <ModalContext value={innerValue}>
      <Box ref={wrapRef} flexDirection="column" flexShrink={0} onKeyDown={onKeyDown}>
        <ScrollBox
          ref={attachInnerScroll}
          flexDirection="column"
          flexShrink={0}
          height={scrollBoxHeight}
          stickyScroll={false}
        >
          <Box flexDirection="column" paddingX={MODAL_SCROLLER_PADDING_X} flexShrink={0}>
            {children}
          </Box>
        </ScrollBox>
        {overflow.above && (
          <Box position="absolute" top={overflow.hintTop} right={1}>
            <Text dimColor>{figures.arrowUp}</Text>
          </Box>
        )}
        {overflow.below && (
          <Box position="absolute" bottom={overflow.hintBottom} right={1}>
            <Text dimColor>{figures.arrowDown}</Text>
          </Box>
        )}
      </Box>
    </ModalContext>
  );
}
