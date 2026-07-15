import React, { type PropsWithChildren, type Ref, useImperativeHandle, useRef, useState } from 'react';
import type { Except } from 'type-fest';
import type { DOMElement } from '../core/dom.js';
import { markDirty, scheduleRenderFrom } from '../core/dom.js';
import { markCommitStart } from '../core/reconciler.js';
import { clampScrollTopToContentMax } from '../core/scrollHeightHwm.js';
import type { Styles } from '../core/styles.js';
import Box from './Box.js';

export type ScrollBoxHandle = {
  /**
   * @param opts.preserveHwm Official 2.1.207: keep scrollHeightHwm across a
   * programmatic scroll (virtual-list reanchor) so a transient content shrink
   * does not jump the transcript above the answer.
   */
  scrollTo: (y: number, opts?: { preserveHwm?: boolean }) => void;
  scrollBy: (dy: number) => void;
  /**
   * Scroll so `el`'s top is at the viewport top (plus `offset`). Unlike
   * scrollTo which bakes a number that's stale by the time the throttled
   * render fires, this defers the position read to render time —
   * render-node-to-output reads `el.yogaNode.getComputedTop()` in the
   * SAME Yoga pass that computes scrollHeight. Deterministic. One-shot.
   * @param opts.block "nearest" keeps the element in view without jumping
   * when it is already fully visible (official 2.1.207).
   */
  scrollToElement: (el: DOMElement, offset?: number, opts?: { block?: 'nearest' }) => void;
  scrollToBottom: () => void;
  getScrollTop: () => number;
  getPendingDelta: () => number;
  getScrollHeight: () => number;
  /**
   * Like getScrollHeight, but reads Yoga directly instead of the cached
   * value written by render-node-to-output (throttled, up to 16ms stale).
   * Use when you need a fresh value in useLayoutEffect after a React commit
   * that grew content. Slightly more expensive (native Yoga call).
   */
  getFreshScrollHeight: () => number;
  getViewportHeight: () => number;
  /**
   * Absolute screen-buffer row of the first visible content line (inside
   * padding). Used for drag-to-scroll edge detection.
   */
  getViewportTop: () => number;
  /**
   * True when scroll is pinned to the bottom. Set by scrollToBottom, the
   * initial stickyScroll attribute, and by the renderer when positional
   * follow fires (scrollTop at prevMax, content grows). Cleared by
   * scrollTo/scrollBy. Stable signal for "at bottom" that doesn't depend on
   * layout values (unlike scrollTop+viewportH >= scrollHeight).
   */
  isSticky: () => boolean;
  /**
   * Subscribe to imperative scroll changes (scrollTo/scrollBy/scrollToBottom).
   * Does NOT fire for stickyScroll updates done by the Ink renderer — those
   * happen during Ink's render phase after React has committed. Callers that
   * care about the sticky case should treat "at bottom" as a fallback.
   */
  subscribe: (listener: () => void) => () => void;
  /**
   * Set the render-time scrollTop clamp to the currently-mounted children's
   * coverage span. Called by useVirtualScroll after computing its range;
   * render-node-to-output clamps scrollTop to [min, max] so burst scrollTo
   * calls that race past React's async re-render show the edge of mounted
   * content instead of blank spacer. Pass undefined to disable (sticky,
   * cold start).
   */
  setClampBounds: (min: number | undefined, max: number | undefined) => void;
  /** Official 2.1.207: expose the DOM node for virtual-scroll HWM reanchor. */
  getDomElement: () => DOMElement | null;
};

export type ScrollBoxProps = Except<Styles, 'textWrap' | 'overflow' | 'overflowX' | 'overflowY'> & {
  ref?: Ref<ScrollBoxHandle>;
  /**
   * When true, automatically pins scroll position to the bottom when content
   * grows. Unset manually via scrollTo/scrollBy to break the stickiness.
   */
  stickyScroll?: boolean;
  /**
   * Official 2.1.207: when not sticky, still follow content growth if the
   * viewport was positionally at the previous max. Set false to never auto-
   * follow growth (only stickyScroll pins). Default true.
   */
  followGrowth?: boolean;
};

/**
 * A Box with `overflow: scroll` and an imperative scroll API.
 *
 * Children are laid out at their full Yoga-computed height inside a
 * constrained container. At render time, only children intersecting the
 * visible window (scrollTop..scrollTop+height) are rendered (viewport
 * culling). Content is translated by -scrollTop and clipped to the box bounds.
 *
 * Works best inside a fullscreen (constrained-height root) Ink tree.
 */
function ScrollBox({
  children,
  ref,
  stickyScroll,
  followGrowth,
  ...style
}: PropsWithChildren<ScrollBoxProps>): React.ReactNode {
  const domRef = useRef<DOMElement>(null);
  // scrollTo/scrollBy bypass React: they mutate scrollTop on the DOM node,
  // mark it dirty, and call the root's throttled scheduleRender directly.
  // The Ink renderer reads scrollTop from the node — no React state needed,
  // no reconciler overhead per wheel event. The microtask defer coalesces
  // multiple scrollBy calls in one input batch (discreteUpdates) into one
  // render — otherwise scheduleRender's leading edge fires on the FIRST
  // event before subsequent events mutate scrollTop. scrollToBottom still
  // forces a React render: sticky is attribute-observed, no DOM-only path.
  const [, forceRender] = useState(0);
  const listenersRef = useRef(new Set<() => void>());
  const renderQueuedRef = useRef(false);

  const notify = () => {
    for (const l of listenersRef.current) l();
  };

  function scrollMutated(el: DOMElement): void {
    // Signal background intervals (IDE poll, LSP poll, GCS fetch, orphan
    // check) to skip their next tick — they compete for the event loop and
    // contributed to 1402ms max frame gaps during scroll drain.
    // noop — injected by business layer via onScrollActivity callback
    markDirty(el);
    markCommitStart();
    notify();
    if (renderQueuedRef.current) return;
    renderQueuedRef.current = true;
    queueMicrotask(() => {
      renderQueuedRef.current = false;
      scheduleRenderFrom(el);
    });
  }

  useImperativeHandle(
    ref,
    (): ScrollBoxHandle => ({
      scrollTo(y: number, opts?: { preserveHwm?: boolean }) {
        const el = domRef.current;
        if (!el) return;
        // Explicit false overrides the DOM attribute so manual scroll
        // breaks stickiness. Render code checks ?? precedence.
        el.stickyScroll = false;
        // Official 2.1.207: clear HWM unless preserveHwm (virtual reanchor).
        if (!opts?.preserveHwm) {
          el.scrollHeightHwm = undefined;
        }
        el.pendingScrollDelta = undefined;
        el.scrollAnchor = undefined;
        el.scrollTop = Math.max(0, Math.floor(y));
        scrollMutated(el);
      },
      scrollToElement(el: DOMElement, offset = 0, opts?: { block?: 'nearest' }) {
        const box = domRef.current;
        if (!box) return;
        box.stickyScroll = false;
        box.scrollHeightHwm = undefined;
        box.pendingScrollDelta = undefined;
        box.scrollAnchor = {
          el,
          offset,
          nearest: opts?.block === 'nearest',
        };
        scrollMutated(box);
      },
      scrollBy(dy: number) {
        const el = domRef.current;
        if (!el) return;
        el.stickyScroll = false;
        el.scrollHeightHwm = undefined;
        // Wheel input cancels any in-flight anchor seek — user override.
        el.scrollAnchor = undefined;
        // Accumulate in pendingScrollDelta; renderer drains it at a capped
        // rate so fast flicks show intermediate frames. Pure accumulator:
        // scroll-up followed by scroll-down naturally cancels.
        // Official 2.1.207: clamp HWM-overscrolled scrollTop to content max
        // before accumulating pending (pQe).
        el.scrollTop = clampScrollTopToContentMax(el.scrollTop ?? 0, el.scrollHeight, el.scrollViewportHeight);
        el.pendingScrollDelta = (el.pendingScrollDelta ?? 0) + Math.floor(dy);
        scrollMutated(el);
      },
      scrollToBottom() {
        const el = domRef.current;
        if (!el) return;
        el.pendingScrollDelta = undefined;
        el.scrollAnchor = undefined;
        // Drop virtual-scroll clamp + HWM BEFORE the sticky remount paints.
        // useVirtualScroll's setClampBounds is useLayoutEffect (after Ink's
        // resetAfterCommit), so a leftover clamp from the scrolled-up range
        // would still apply on this paint: visual scrollTop lands in the
        // freshly-mounted topSpacer → white flash on "Jump to bottom" click.
        el.scrollClampMin = undefined;
        el.scrollClampMax = undefined;
        el.scrollHeightHwm = undefined;
        // stickyScroll=false attribute means never auto-pin; jump to bottom
        // once without re-enabling sticky (official).
        if (stickyScroll === false) {
          el.scrollTop = Math.max(0, (el.scrollHeight ?? 0) - (el.scrollViewportHeight ?? 0));
          scrollMutated(el);
          return;
        }
        el.stickyScroll = true;
        // Eager pin so the first paint after notify (tail remount) is already
        // at bottom even if React/Ink batching reorders the sticky follow.
        const vh = el.scrollViewportHeight ?? 0;
        const sh = el.scrollHeight ?? 0;
        if (vh > 0 && sh > 0) {
          el.scrollTop = Math.max(0, sh - vh);
        }
        markDirty(el);
        notify();
        forceRender(n => n + 1);
        // Second paint after React mounts the sticky tail range — the first
        // forceRender may still have stale scrollHeight from the mid-list
        // mount; Ink's sticky follow then pins to the true maxScroll.
        queueMicrotask(() => {
          scheduleRenderFrom(el);
        });
      },
      getScrollTop() {
        return domRef.current?.scrollTop ?? 0;
      },
      getPendingDelta() {
        // Accumulated-but-not-yet-drained delta. useVirtualScroll needs
        // this to mount the union [committed, committed+pending] range —
        // otherwise intermediate drain frames find no children (blank).
        return domRef.current?.pendingScrollDelta ?? 0;
      },
      getScrollHeight() {
        return domRef.current?.scrollHeight ?? 0;
      },
      getFreshScrollHeight() {
        const content = domRef.current?.childNodes[0] as DOMElement | undefined;
        return content?.yogaNode?.getComputedHeight() ?? domRef.current?.scrollHeight ?? 0;
      },
      getViewportHeight() {
        return domRef.current?.scrollViewportHeight ?? 0;
      },
      getViewportTop() {
        return domRef.current?.scrollViewportTop ?? 0;
      },
      isSticky() {
        const el = domRef.current;
        if (!el) return false;
        return el.stickyScroll ?? Boolean(el.attributes['stickyScroll']);
      },
      subscribe(listener: () => void) {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
      setClampBounds(min, max) {
        const el = domRef.current;
        if (!el) return;
        el.scrollClampMin = min;
        el.scrollClampMax = max;
      },
      getDomElement() {
        return domRef.current;
      },
    }),
    // stickyScroll is closed over by scrollToBottom's one-shot path.
    // notify/scrollMutated only close over refs + imports — stable.
    [stickyScroll],
  );

  // Structure: outer viewport (overflow:scroll, constrained height) >
  // inner content (flexGrow:1, flexShrink:0 — fills at least the viewport
  // but grows beyond it for tall content). flexGrow:1 lets children use
  // spacers to pin elements to the bottom of the scroll area. Yoga's
  // Overflow.Scroll prevents the viewport from growing to fit the content.
  // The renderer computes scrollHeight from the content box and culls
  // content's children based on scrollTop.
  //
  // stickyScroll / followGrowth are passed as DOM attributes (via ink-box
  // directly) so they're available on the first render — ref callbacks fire
  // after the initial commit, which is too late for the first frame.
  return (
    <ink-box
      ref={el => {
        domRef.current = el;
        if (el) el.scrollTop ??= 0;
      }}
      style={{
        flexWrap: 'nowrap',
        flexDirection: style.flexDirection ?? 'row',
        flexGrow: style.flexGrow ?? 0,
        flexShrink: style.flexShrink ?? 1,
        ...style,
        overflowX: 'scroll',
        overflowY: 'scroll',
      }}
      {...(stickyScroll ? { stickyScroll: true } : {})}
      {...(followGrowth === false ? { followGrowth: false } : {})}
    >
      <Box flexDirection="column" flexGrow={1} flexShrink={0} width="100%">
        {children}
      </Box>
    </ink-box>
  );
}

export default ScrollBox;
