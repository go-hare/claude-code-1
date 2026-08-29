/**
 * densable lRc — modal pane scroller around ozs content (non-Qvt / non-AXC).
 * Gold: docs/upstream-extraction/v2.1.239/snippets/gold-fullscreen-modal-layout.txt
 */
import figures from 'figures';
import React, {
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  type DOMElement,
  type KeyboardEvent,
  ModalContext,
  ScrollBox,
  type ScrollBoxHandle,
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
  scrollRef?: RefObject<ScrollBoxHandle | null> | null;
  maxRows: number;
  children: ReactNode;
};

export function ModalScroller({ scrollRef: vJ, maxRows, children }: Props): React.ReactNode {
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

  useLayoutEffect(() => {
    if (vJ && claimedHeightRef.current === null) {
      vJ.current = innerScrollRef.current;
      return () => {
        if (vJ.current === innerScrollRef.current) {
          vJ.current = null;
        }
      };
    }
    return undefined;
  }, [vJ]);

  const [overflow, setOverflow] = useState<OverflowState>(EMPTY_OVERFLOW);

  const measure = useCallback(() => {
    const handle = vJ?.current;
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
  }, [remainingRows, vJ]);

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

  const subscribedHandleRef = useRef<ScrollBoxHandle | null>(null);
  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    measure();
    subscribedHandleRef.current = vJ?.current ?? null;
    unsubscribeRef.current = subscribedHandleRef.current?.subscribe(measure);
    return () => {
      unsubscribeRef.current?.();
    };
  }, [measure, vJ]);

  useEffect(() => {
    const id = setInterval(() => {
      const current = vJ?.current ?? null;
      if (current !== subscribedHandleRef.current) {
        unsubscribeRef.current?.();
        subscribedHandleRef.current = current;
        unsubscribeRef.current = current?.subscribe(measure);
      }
      measure();
      reclaimFocus();
    }, 50);
    return () => {
      clearInterval(id);
    };
  }, [measure, reclaimFocus, vJ]);

  const innerRows = zxc?.rows ?? maxRows;
  const innerColumns = zxc?.columns ?? 0;
  const innerValue = useMemo(
    () => ({
      rows: innerRows,
      columns: innerColumns,
      scrollRef: vJ ?? null,
      claimScrollBox,
    }),
    [innerRows, innerColumns, vJ, claimScrollBox],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrl || event.meta || event.shift) {
        return;
      }
      const handle = vJ?.current;
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
    [remainingRows, vJ],
  );

  const scrollBoxHeight = !claimed && overflow.overflows ? remainingRows : undefined;

  return (
    <ModalContext value={innerValue}>
      <Box ref={wrapRef} flexDirection="column" flexShrink={0} onKeyDown={onKeyDown}>
        <ScrollBox
          ref={innerScrollRef}
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
