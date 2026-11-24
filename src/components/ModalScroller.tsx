/**
 * densable lRc — modal pane scroller around ozs content (non-Qvt / non-AXC).
 * Gold: docs/upstream-extraction/v2.1.239/snippets/gold-fullscreen-modal-layout.txt
 */
import figures from 'figures';
import React, {
  type ReactNode,
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
  type ScrollViewport,
  Text,
  useApp,
  useInterval,
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
  /** Optional explicit modal identity key; changing it resets scrollTop and claimedHeight. */
  modalKey?: string | number | null;
  /** Official 2.1.328 `Xc` onClaim — notifies FullscreenLayout of child claimed height. */
  onClaim?: (height: number | null) => void;
  children: ReactNode;
};

type ModalContentIdentity = {
  modalKey: string | number | null;
  childType: unknown;
  childKey: string | number | null;
  innerType: unknown;
  innerKey: string | number | null;
};

function getModalContentIdentity(
  modalKey: string | number | null | undefined,
  children: ReactNode,
): ModalContentIdentity {
  const el = React.isValidElement(children) ? children : null;
  const rawInner = el ? (el.props as { children?: ReactNode } | null | undefined)?.children : undefined;
  const innerEl = React.isValidElement(rawInner) ? rawInner : null;
  return {
    modalKey: modalKey ?? null,
    childType: el ? el.type : null,
    childKey: el ? el.key : null,
    innerType: innerEl ? innerEl.type : null,
    innerKey: innerEl ? innerEl.key : null,
  };
}

function isSameModalIdentity(a: ModalContentIdentity, b: ModalContentIdentity): boolean {
  return (
    a.modalKey === b.modalKey &&
    a.childType === b.childType &&
    a.childKey === b.childKey &&
    a.innerType === b.innerType &&
    a.innerKey === b.innerKey
  );
}

export function ModalScroller({ scrollViewport, maxRows, modalKey, onClaim, children }: Props): React.ReactNode {
  // Detect modal identity swaps synchronously during render and remount the
  // inner scroller via a monotonic key. React runs the unmounting scroller's
  // layout cleanups (releasing scrollViewport + onClaim(null)) strictly BEFORE
  // the new modal's mount useLayoutEffect (claimScrollBox / revealEnd), so a
  // direct modal A -> modal B swap resets stale scrollTop/claimedHeight/focus
  // without ever clobbering modal B's mount-time claimScrollBox or revealEnd.
  const nextIdentity = getModalContentIdentity(modalKey, children);
  const identityRef = useRef<{ identity: ModalContentIdentity; gen: number } | null>(null);
  if (identityRef.current === null) {
    identityRef.current = { identity: nextIdentity, gen: 0 };
  } else if (!isSameModalIdentity(identityRef.current.identity, nextIdentity)) {
    identityRef.current = { identity: nextIdentity, gen: identityRef.current.gen + 1 };
  }
  return (
    <ModalScrollerInner
      key={identityRef.current.gen}
      scrollViewport={scrollViewport}
      maxRows={maxRows}
      onClaim={onClaim}
    >
      {children}
    </ModalScrollerInner>
  );
}

type InnerProps = Omit<Props, 'modalKey'>;

function ModalScrollerInner({ scrollViewport, maxRows, onClaim, children }: InnerProps): React.ReactNode {
  const zxc = useContext(ModalContext);
  const onClaimRef = useRef(onClaim);
  onClaimRef.current = onClaim;
  const claimedHeightRef = useRef<number | null>(null);
  const [claimedHeight, setClaimedHeight] = useState<number | null>(null);
  const claimScrollBox = useCallback((height: number | null) => {
    claimedHeightRef.current = height;
    setClaimedHeight(height);
    onClaimRef.current?.(height);
  }, []);
  const claimed = claimedHeight !== null;
  const remainingRows = Math.max(0, maxRows - (claimedHeight ?? 0));
  const innerScrollRef = useRef<ScrollBoxHandle | null>(null);

  const [overflow, setOverflow] = useState<OverflowState>(EMPTY_OVERFLOW);
  // Official 2.1.328 `Xc` `Ye`: tracks an active revealEnd() hold so the top ↑
  // scroll hint stays hidden while snapped to the end of the modal pane.
  const revealingEndRef = useRef(false);

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
    const below = canScroll && scrollTop < contentHeight - viewportHeight;
    const above = canScroll && scrollTop > 0 && (below || !revealingEndRef.current);
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

  // Official 2.1.328 `Xc` `vt` (@318476113 @31050): snap modal ScrollBox to
  // the bottom and suppress the top ↑ hint until the returned cleanup runs.
  const revealEnd = useCallback(() => {
    revealingEndRef.current = true;
    scrollViewport?.handle?.scrollTo(Number.MAX_SAFE_INTEGER);
    return () => {
      revealingEndRef.current = false;
    };
  }, [scrollViewport]);

  // When a newly mounted modal calls revealEnd() on initial mount, overflow
  // starts false (height=undefined) until measure() detects contentHeight >
  // remainingRows and constrains ScrollBox height; re-snap once overflow flips
  // true so mount-time revealEnd() actually lands at the bottom.
  useLayoutEffect(() => {
    if (revealingEndRef.current && overflow.overflows) {
      scrollViewport?.handle?.scrollTo(Number.MAX_SAFE_INTEGER);
    }
  }, [overflow.overflows, scrollViewport]);

  // Official 2.1.328 `Xc` `Tl(Pt, 50)`: use Ink's ClockContext-driven
  // useInterval instead of raw setInterval so timers stay clock-managed.
  const pollTick = useCallback(() => {
    measure();
    reclaimFocus();
  }, [measure, reclaimFocus]);
  useInterval(pollTick, 50);

  // Release claimed height in layout-cleanup phase on unmount (or identity-swap
  // remount) so it always runs BEFORE a replacement modal's mount
  // useLayoutEffect claims its own height.
  useLayoutEffect(() => {
    return () => {
      onClaimRef.current?.(null);
    };
  }, []);

  const innerRows = Math.max(0, zxc?.rows ?? maxRows);
  const innerColumns = Math.max(0, zxc?.columns ?? 0);
  const innerValue = useMemo(
    () => ({
      rows: innerRows,
      columns: innerColumns,
      scrollViewport: scrollViewport ?? null,
      claimScrollBox,
      revealEnd,
    }),
    [innerRows, innerColumns, scrollViewport, claimScrollBox, revealEnd],
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

  const scrollBoxHeight = !claimed && overflow.overflows ? Math.max(0, remainingRows) : undefined;
  const attachInnerScroll = useCallback(
    (handle: ScrollBoxHandle | null) => {
      innerScrollRef.current = handle;
      if (handle && revealingEndRef.current) {
        handle.scrollTo(Number.MAX_SAFE_INTEGER);
      }
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
