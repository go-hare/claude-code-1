import figures from 'figures';
import React, {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { fileURLToPath } from 'url';
import { ModalContext } from '../context/modalContext.js';
import { PromptOverlayProvider, usePromptOverlay, usePromptOverlayDialog } from '../context/promptOverlayContext.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  AxcScrollAnchor,
  AxcStickyHost,
  Box,
  Divider,
  ScrollBox,
  type ScrollBoxHandle,
  Text,
  instances,
  stringWidth,
  useTerminalFocus,
} from '@anthropic/ink';
import type { Message } from '../types/message.js';
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js';
import { openBrowser, openPath } from '../utils/browser.js';
import { getAutoScrollEnabled } from '../utils/config.js';
import { isFullscreenEnvEnabled, resolveMouseTrackingMode } from '../utils/fullscreen.js';
import { isAxcStickyMainEnabled } from '../utils/residualUiEnvGates.js';
import { getPlatform } from '../utils/platform.js';
import { recordJumpToBottomClick } from '../utils/scrollTelemetry.js';
import { plural } from '../utils/stringUtils.js';
import { isNullRenderingAttachment } from './messages/nullRenderingAttachments.js';
import { ModalScroller } from './ModalScroller.js';
import PromptInputFooterSuggestions from './PromptInput/PromptInputFooterSuggestions.js';
import type { StickyPrompt } from './VirtualMessageList.js';

/** Rows of transcript context kept visible above the modal pane's ▔ divider. */
const MODAL_TRANSCRIPT_PEEK = 2;
/**
 * densable Wrn `zrn` — fullscreen chrome rows subtracted from bottom maxHeight.
 * Gold: `Kxh=uKr()?g4t-zrn:Math.floor(g4t/2)`, consumed only inside `if(Ns())`.
 * `uKr()` has no definition in the 2.1.234 extract dump (call sites only:
 * Wrn Kxh + eso `a=uKr(); l=t&&!a`). This branch is already
 * `isFullscreenEnvEnabled()` (= Ns), so we take the uKr-true arm (rows-zrn).
 * Do not invent a local uKr. Gold's 50% arm is uKr-false still inside Ns;
 * that cap clipped PromptInput in the empty-transcript screenshot.
 */
const FULLSCREEN_BOTTOM_CHROME_ROWS = 2;

/** Context for scroll-derived chrome (sticky header, pill). StickyTracker
 *  in VirtualMessageList writes via this instead of threading a callback
 *  up through Messages → REPL → FullscreenLayout. The setter is stable so
 *  consuming this context never causes re-renders. */
export const ScrollChromeContext = createContext<{
  setStickyPrompt: (p: StickyPrompt | null) => void;
}>({ setStickyPrompt: () => {} });

type Props = {
  /** Content that scrolls (messages, tool output) */
  scrollable: ReactNode;
  /** Content pinned to the bottom (spinner, prompt, permissions) */
  bottom: ReactNode;
  /** Absolute-positioned content anchored at the bottom-right of the
   *  ScrollBox area, floating over scrollback. Rendered inside the flexGrow
   *  region (not the bottom slot) so the overflowY:hidden cap doesn't clip
   *  it. Fullscreen only — used for the companion speech bubble. */
  bottomFloat?: ReactNode;
  /**
   * densable ozs / fCt — `{content, visible}`. Gold Tyn Bxc is a flex
   * sibling (not absolute). `visible` drives Uxc/Bxc display.
   */
  modal?: { content: ReactNode; visible: boolean };
  /** Ref passed via ModalContext so Tabs (or any scroll-owning descendant)
   *  can attach it to their own ScrollBox for tall content. */
  modalScrollRef?: React.RefObject<ScrollBoxHandle | null>;
  /** Ref to the scroll box for keyboard scrolling. RefObject (not Ref) so
   *  pillVisible's useSyncExternalStore can subscribe to scroll changes. */
  scrollRef?: RefObject<ScrollBoxHandle | null>;
  /** Y-position (scrollHeight at snapshot) of the unseen-divider. Pill
   *  shows while viewport bottom hasn't reached this. Ref so REPL doesn't
   *  re-render on the one-shot snapshot write. */
  dividerYRef?: RefObject<number | null>;
  /** Force-hide the pill (e.g. viewing a sub-agent task). */
  hidePill?: boolean;
  /** Force-hide the sticky prompt header (e.g. viewing a teammate task). */
  hideSticky?: boolean;
  /** Count for the pill text. 0 → "Jump to bottom", >0 → "N new messages". */
  newMessageCount?: number;
  /** Called when the user clicks the "N new" pill. */
  onPillClick?: () => void;
  /**
   * densable Tyn `sidebar` / `sidebarWidth`. Main column is
   * `max(1, columns - sidebarWidth)`. Always mount `sidebar` (even at
   * width 0) so nhu auto-open + keybinding hooks stay alive.
   */
  sidebar?: ReactNode;
  sidebarWidth?: number;
};

/**
 * Tracks the in-transcript "N new messages" divider position while the
 * user is scrolled up. Snapshots message count AND scrollHeight the first
 * time sticky breaks. scrollHeight ≈ the y-position of the divider in the
 * scroll content (it renders right after the last message that existed at
 * snapshot time).
 *
 * `pillVisible` lives in FullscreenLayout (not here) — it subscribes
 * directly to ScrollBox via useSyncExternalStore with a boolean snapshot
 * against `dividerYRef`, so per-frame scroll never re-renders REPL.
 * `dividerIndex` stays here because REPL needs it for computeUnseenDivider
 * → Messages' divider line; it changes only ~twice/scroll-session
 * (first scroll-away + repin), acceptable REPL re-render cost.
 *
 * `onScrollAway` must be called by every scroll-away action with the
 * handle; `onRepin` by submit/scroll-to-bottom.
 */
export function useUnseenDivider(messageCount: number): {
  /** Index into messages[] where the divider line renders. Cleared on
   *  sticky-resume (scroll back to bottom) so the "N new" line doesn't
   *  linger once everything is visible. */
  dividerIndex: number | null;
  /** scrollHeight snapshot at first scroll-away — the divider's y-position.
   *  FullscreenLayout subscribes to ScrollBox and compares viewport bottom
   *  against this for pillVisible. Ref so writes don't re-render REPL. */
  dividerYRef: RefObject<number | null>;
  onScrollAway: (handle: ScrollBoxHandle) => void;
  onRepin: () => void;
  /** Scroll the handle so the divider line is at the top of the viewport. */
  jumpToNew: (handle: ScrollBoxHandle | null) => void;
  /** Shift dividerIndex and dividerYRef when messages are prepended
   *  (infinite scroll-back). indexDelta = number of messages prepended;
   *  heightDelta = content height growth in rows. */
  shiftDivider: (indexDelta: number, heightDelta: number) => void;
} {
  const [dividerIndex, setDividerIndex] = useState<number | null>(null);
  // Ref holds the current count for onScrollAway to snapshot. Written in
  // the render body (not useEffect) so wheel events arriving between a
  // message-append render and its effect flush don't capture a stale
  // count (off-by-one in the baseline). React Compiler bails out here —
  // acceptable for a hook instantiated once in REPL.
  const countRef = useRef(messageCount);
  countRef.current = messageCount;
  // scrollHeight snapshot — the divider's y in content coords. Ref-only:
  // read synchronously in onScrollAway (setState is batched, can't
  // read-then-write in the same callback) AND by FullscreenLayout's
  // pillVisible subscription. null = pinned to bottom.
  const dividerYRef = useRef<number | null>(null);

  const onRepin = useCallback(() => {
    // Don't clear dividerYRef here — a trackpad momentum wheel event
    // racing in the same stdin batch would see null and re-snapshot,
    // overriding the setDividerIndex(null) below. The useEffect below
    // clears the ref after React commits the null dividerIndex, so the
    // ref stays non-null until the state settles.
    setDividerIndex(null);
  }, []);

  const onScrollAway = useCallback((handle: ScrollBoxHandle) => {
    // Nothing below the viewport → nothing to jump to. Covers both:
    // • empty/short session: scrollUp calls scrollTo(0) which breaks sticky
    //   even at scrollTop=0 (wheel-up on fresh session showed the pill)
    // • click-to-select at bottom: useDragToScroll.check() calls
    //   scrollTo(current) to break sticky so streaming content doesn't shift
    //   under the selection, then onScroll(false, …) — but scrollTop is still
    //   at max (Sarah Deaton, #claude-code-feedback 2026-03-15)
    // pendingDelta: scrollBy accumulates without updating scrollTop. Without
    // it, wheeling up from max would see scrollTop==max and suppress the pill.
    const max = Math.max(0, handle.getScrollHeight() - handle.getViewportHeight());
    if (handle.getScrollTop() + handle.getPendingDelta() >= max) return;
    // Snapshot only on the FIRST scroll-away. onScrollAway fires on EVERY
    // scroll action (not just the initial break from sticky) — this guard
    // preserves the original baseline so the count doesn't reset on the
    // second PageUp. Subsequent calls are ref-only no-ops (no REPL re-render).
    if (dividerYRef.current === null) {
      dividerYRef.current = handle.getScrollHeight();
      // New scroll-away session → move the divider here (replaces old one)
      setDividerIndex(countRef.current);
    }
  }, []);

  const jumpToNew = useCallback((handle: ScrollBoxHandle | null) => {
    if (!handle) return;
    // scrollToBottom (not scrollTo(dividerY)): sets stickyScroll=true so
    // useVirtualScroll mounts the tail and render-node-to-output pins
    // scrollTop=maxScroll. scrollTo sets stickyScroll=false → the clamp
    // (still at top-range bounds before React re-renders) pins scrollTop
    // back, stopping short. The divider stays rendered (dividerIndex
    // unchanged) so users see where new messages started; the clear on
    // next submit/explicit scroll-to-bottom handles cleanup.
    handle.scrollToBottom();
  }, []);

  // Sync dividerYRef with dividerIndex. When onRepin fires (submit,
  // scroll-to-bottom), it sets dividerIndex=null but leaves the ref
  // non-null — a wheel event racing in the same stdin batch would
  // otherwise see null and re-snapshot. Deferring the ref clear to
  // useEffect guarantees the ref stays non-null until React has committed
  // the null dividerIndex, blocking the if-null guard in onScrollAway.
  //
  // Also handles /clear, rewind, teammate-view swap — if the count drops
  // below the divider index, the divider would point at nothing.
  useEffect(() => {
    if (dividerIndex === null) {
      dividerYRef.current = null;
    } else if (messageCount < dividerIndex) {
      dividerYRef.current = null;
      setDividerIndex(null);
    }
  }, [messageCount, dividerIndex]);

  const shiftDivider = useCallback((indexDelta: number, heightDelta: number) => {
    setDividerIndex(idx => (idx === null ? null : idx + indexDelta));
    if (dividerYRef.current !== null) {
      dividerYRef.current += heightDelta;
    }
  }, []);

  return {
    dividerIndex,
    dividerYRef,
    onScrollAway,
    onRepin,
    jumpToNew,
    shiftDivider,
  };
}

/**
 * Counts assistant turns in messages[dividerIndex..end). A "turn" is what
 * users think of as "a new message from Claude" — not raw assistant entries
 * (one turn yields multiple entries: tool_use blocks + text blocks). We count
 * non-assistant→assistant transitions, but only for entries that actually
 * carry text — tool-use-only entries are skipped (like progress messages)
 * so "⏺ Searched for 13 patterns, read 6 files" doesn't tick the pill.
 */
export function countUnseenAssistantTurns(messages: readonly Message[], dividerIndex: number): number {
  let count = 0;
  let prevWasAssistant = false;
  for (let i = dividerIndex; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.type === 'progress') continue;
    // Tool-use-only assistant entries aren't "new messages" to the user —
    // skip them the same way we skip progress. prevWasAssistant is NOT
    // updated, so a text block immediately following still counts as the
    // same turn (tool_use + text from one API response = 1).
    if (m.type === 'assistant' && !assistantHasVisibleText(m)) continue;
    const isAssistant = m.type === 'assistant';
    if (isAssistant && !prevWasAssistant) count++;
    prevWasAssistant = isAssistant;
  }
  return count;
}

function assistantHasVisibleText(m: Message): boolean {
  if (m.type !== 'assistant') return false;
  if (!Array.isArray(m.message!.content)) return false;
  for (const b of m.message!.content) {
    if (typeof b !== 'string' && b.type === 'text' && b.text.trim() !== '') return true;
  }
  return false;
}

export type UnseenDivider = { firstUnseenUuid: Message['uuid']; count: number };

/**
 * Builds the unseenDivider object REPL passes to Messages + the pill.
 * Returns undefined only when no content has arrived past the divider
 * yet (messages[dividerIndex] doesn't exist). Once ANY message arrives
 * — including tool_use-only assistant entries and tool_result user entries
 * that countUnseenAssistantTurns skips — count floors at 1 so the pill
 * flips from "Jump to bottom" to "1 new message". Without the floor,
 * the pill stays "Jump to bottom" through an entire tool-call sequence
 * until Claude's text response lands.
 */
export function computeUnseenDivider(
  messages: readonly Message[],
  dividerIndex: number | null,
): UnseenDivider | undefined {
  if (dividerIndex === null) return undefined;
  // Skip progress and null-rendering attachments when picking the divider
  // anchor — Messages.tsx filters these out of renderableMessages before the
  // dividerBeforeIndex search, so their UUID wouldn't be found (CC-724).
  // Hook attachments use randomUUID() so nothing shares their 24-char prefix.
  let anchorIdx = dividerIndex;
  while (
    anchorIdx < messages.length &&
    (messages[anchorIdx]?.type === 'progress' || isNullRenderingAttachment(messages[anchorIdx]!))
  ) {
    anchorIdx++;
  }
  const uuid = messages[anchorIdx]?.uuid;
  if (!uuid) return undefined;
  const count = countUnseenAssistantTurns(messages, dividerIndex);
  return { firstUnseenUuid: uuid, count: Math.max(1, count) };
}

/**
 * Layout wrapper for the REPL. In fullscreen mode, puts scrollable
 * content in a sticky-scroll box and pins bottom content via flexbox.
 * Outside fullscreen mode, renders content sequentially so the existing
 * main-screen scrollback rendering works unchanged.
 *
 * Fullscreen defaults ON (official 2.1.210 / PR #21439). Opt out with
 * CLAUDE_CODE_NO_FLICKER=0 or settings.tui="default". The <AlternateScreen>
 * wrapper (alt buffer + mouse tracking + height constraint) lives at REPL's
 * root so nothing can accidentally render outside it.
 */
export function FullscreenLayout({
  scrollable,
  bottom,
  bottomFloat,
  modal,
  modalScrollRef,
  scrollRef,
  dividerYRef,
  hidePill = false,
  hideSticky = false,
  newMessageCount = 0,
  onPillClick,
  sidebar,
  sidebarWidth = 0,
}: Props): React.ReactNode {
  const { rows: terminalRows, columns } = useTerminalSize();
  // Scroll-derived chrome state lives HERE, not in REPL. StickyTracker
  // writes via ScrollChromeContext; pillVisible subscribes directly to
  // ScrollBox. Both change rarely (pill flips once per threshold crossing,
  // sticky changes ~5-20×/transcript) — re-rendering FullscreenLayout on
  // those is fine; re-rendering the 6966-line REPL + its 22+ useAppState
  // selectors per-scroll-frame was not.
  // densable 2.1.234 Wrn: raw useState setter in ScrollChromeContext (H9D).
  // StickyTracker dedups on idx; no isSameStickyPrompt / null↔null wrapper.
  const [stickyPrompt, setStickyPrompt] = useState<StickyPrompt | null>(null);
  const chromeCtx = useMemo(() => ({ setStickyPrompt }), []);
  // Boolean-quantized scroll subscription. Snapshot is "is viewport bottom
  // above the divider y?" — Object.is on a boolean → FullscreenLayout only
  // re-renders when the pill should actually flip, not per-frame.
  const subscribe = useCallback(
    (listener: () => void) => scrollRef?.current?.subscribe(listener) ?? (() => {}),
    [scrollRef],
  );
  const pillVisible = useSyncExternalStore(subscribe, () => {
    // densable Wrn Ddw: sticky never shows the pill; dividerY is the unseen
    // snapshot; without a divider, pill only when auto-scroll is off and the
    // viewport is short of content (user scrolled up with followGrowth false).
    const s = scrollRef?.current;
    if (!s) return false;
    if (s.isSticky()) return false;
    const viewportBottom = s.getScrollTop() + s.getPendingDelta() + s.getViewportHeight();
    const dividerY = dividerYRef?.current;
    if (dividerY != null) {
      return viewportBottom < dividerY && viewportBottom < s.getScrollHeight();
    }
    return !getAutoScrollEnabled() && viewportBottom < s.getScrollHeight();
  });
  // Wire up hyperlink click handling — in fullscreen mode, mouse tracking
  // intercepts clicks before the terminal can open OSC 8 links natively.
  useLayoutEffect(() => {
    if (!isFullscreenEnvEnabled()) return;
    const ink = instances.get(process.stdout);
    if (!ink) return;
    ink.onHyperlinkClick = url => {
      // Most OSC 8 links emitted by Claude Code are file:// URLs from
      // FilePathLink (FileEdit/FileWrite/FileRead tool output). openBrowser
      // rejects non-http(s) protocols — route file: to openPath instead.
      if (url.startsWith('file:')) {
        try {
          void openPath(fileURLToPath(url));
        } catch {
          // Malformed file: URLs (e.g. file://host/path from plain-text
          // detection) cause fileURLToPath to throw — ignore silently.
        }
      } else {
        void openBrowser(url);
      }
    };
    return () => {
      ink.onHyperlinkClick = undefined;
    };
  }, []);

  if (isFullscreenEnvEnabled()) {
    // densable Tyn `if (Vs())` — $xc + Uxc + Bxc. Gold returns this tree
    // before Qvt is even considered (`return MF0}if(Qvt())`). Qvt is NOT
    // nested inside Vs. Sticky chrome (SEA gold-layout-js-0):
    //   null           — at bottom / cleared
    //   {text,scrollTo}— scrolled up, sticky header shows
    //   'clicked'      — header click: hide header so content ❯ takes row 0
    // padCollapsed = sticky != null (covers {text} and 'clicked'). After
    // click: header gone + paddingTop=0 → viewportTop=0 → ❯ at row 0. Next
    // scroll re-fires StickyTracker with a fresh {text} (1-row shift OK).
    // Anti-#185 is StickyTracker's idx early-return, not a pad latch.
    const sticky = hideSticky ? null : stickyPrompt;
    const headerPrompt = sticky != null && sticky !== 'clicked' ? sticky : null;
    const padCollapsed = sticky != null;
    const mainColumns = Math.max(1, columns - sidebarWidth);
    const showPill = !hidePill && pillVisible;
    const pillNode = showPill ? (
      <NewMessagesPill
        count={newMessageCount}
        onClick={() => {
          // densable i8l: onClick={zxh} only — StickyTracker clears
          // when scrollToBottom repins isSticky.
          onPillClick?.();
        }}
      />
    ) : null;
    const modalVisible = modal?.visible ?? false;

    return (
      <PromptOverlayProvider>
        <Box flexDirection="column" flexGrow={1} overflow="hidden" width="100%">
          {/* $xc — scroll + sidebar row */}
          <Box flexDirection="row" flexGrow={1} overflow="hidden" width="100%">
            <Box flexDirection="column" flexGrow={1} width={mainColumns} overflow="hidden">
              {headerPrompt != null && <StickyPromptHeader text={headerPrompt.text} onClick={headerPrompt.scrollTo} />}
              <ScrollBox
                ref={scrollRef}
                flexGrow={1}
                flexDirection="column"
                paddingTop={padCollapsed ? 0 : 1}
                stickyScroll
                followGrowth={getAutoScrollEnabled()}
              >
                {/* Vs() QW children = C9t{[b9t, pyn]} — no overlay-in-ScrollBox */}
                <ScrollChromeContext value={chromeCtx}>
                  {scrollable}
                  <AxcScrollAnchor />
                </ScrollChromeContext>
              </ScrollBox>
              {pillNode}
              {bottomFloat != null && (
                <Box position="absolute" bottom={0} right={0} opaque>
                  {bottomFloat}
                </Box>
              )}
            </Box>
            {sidebar != null && (
              <Box flexDirection="column" width={sidebarWidth} flexShrink={0} overflow="hidden">
                {sidebar}
              </Box>
            )}
          </Box>
          {/* Uxc — prompt chrome (hidden while ozs visible) */}
          <Box
            flexDirection="column"
            flexShrink={0}
            width="100%"
            maxHeight={Math.max(1, terminalRows - FULLSCREEN_BOTTOM_CHROME_ROWS)}
            display={modalVisible ? 'none' : 'flex'}
          >
            <SuggestionsOverlay />
            <DialogOverlay />
            <Box flexDirection="column" width="100%" flexGrow={1} flexShrink={0} overflowY="hidden">
              {bottom}
            </Box>
          </Box>
          {/* Bxc — ozs pane */}
          {modal != null && (
            <ModalContext
              value={{
                rows: terminalRows - MODAL_TRANSCRIPT_PEEK - 1,
                columns: columns - 4,
                scrollRef: modalScrollRef ?? null,
                claimScrollBox: null,
              }}
            >
              <Box
                flexShrink={0}
                width="100%"
                maxHeight={terminalRows - MODAL_TRANSCRIPT_PEEK}
                flexDirection="column"
                overflow="hidden"
                display={modalVisible ? 'flex' : 'none'}
              >
                <Box flexShrink={0}>
                  <Divider color="permission" char="▔" />
                </Box>
                <ModalScroller scrollRef={modalScrollRef} maxRows={terminalRows - MODAL_TRANSCRIPT_PEEK - 1}>
                  {modal.content}
                </ModalScroller>
              </Box>
            </ModalContext>
          )}
        </Box>
      </PromptOverlayProvider>
    );
  }

  // densable Tyn `if (Qvt())` — sibling AFTER Vs return, not nested in it.
  // Gold: xxc({scrollRef, scrollable:IKe, bottom:w9t, overlay:E9t})
  // IKe = C9t{value:WTg, children:[b9t, pyn]} — pyn is kxc (AxcScrollAnchor).
  // E9t = fCt!=null ? uN + H({flexDirection:"column", paddingX:Aee, children:fCt.content}) : null
  // xxc overlay slot is absolute+opaque (owned by AxcStickyHost). No Ob/▔, no
  // lRc, no pushUp, no sidebar. Qvt() body is not in the 239 dump — keep
  // CLAUDE_CODE_AXC_STICKY_MAIN opt-in (do not product-default ON).
  const axcSticky = isAxcStickyMainEnabled() && scrollRef != null;
  if (axcSticky) {
    // Match Vs ozs: only mount opaque overlay when RPs visible (not suppressed).
    const overlayNode =
      modal != null && modal.visible ? (
        <ModalContext
          value={{
            rows: terminalRows - MODAL_TRANSCRIPT_PEEK - 1,
            columns: columns - 4,
            scrollRef: modalScrollRef ?? null,
            claimScrollBox: null,
          }}
        >
          <Box flexDirection="column" paddingX={2}>
            {modal.content}
          </Box>
        </ModalContext>
      ) : null;
    return (
      <PromptOverlayProvider>
        <AxcStickyHost
          scrollRef={scrollRef}
          scrollable={
            <ScrollChromeContext value={chromeCtx}>
              {scrollable}
              <AxcScrollAnchor />
            </ScrollChromeContext>
          }
          bottom={
            <>
              <SuggestionsOverlay />
              <DialogOverlay />
              {bottom}
            </>
          }
          overlay={overlayNode}
        />
      </PromptOverlayProvider>
    );
  }

  // Gold else: Fragment{[C9t{b9t}, v9t, fCt?.content]} — no overlay.
  return (
    <>
      {scrollable}
      {bottom}
      {modal?.content}
    </>
  );
}

// Slack-style pill. Absolute overlay at bottom={0} of the scrollwrap — floats
// over the ScrollBox's last content row, only obscuring the centered pill
// text (the rest of the row shows ScrollBox content). Scroll-smear from
// DECSTBM shifting the pill's pixels is repaired at the Ink layer
// (absoluteRectsPrev third-pass in render-node-to-output.ts, #23939). Shows
// "Jump to bottom" when count is 0 (scrolled away but no new messages yet —
// the dead zone where users previously thought chat stalled).
//
// Official 2.1.210 densable Bta: adaptive label (click / shortcut / pageDown
// / bare ↓), Badge (Ey) with textColor+padded+truncate-end, noSelect on the
// hit box. Official still uses left/right=0 full-width absolute — we keep
// content-width + computed left: dirty absolute nodes clear their full cached
// rect before re-paint (output.clear fromAbsolute), so a full-width wrapper
// would wipe the entire last transcript row on hover (backgroundColor flip),
// blanking text under the transparent gaps (e.g. "价值" under "意图").
function NewMessagesPill({ count, onClick }: { count: number; onClick?: () => void }): React.ReactNode {
  const [hover, setHover] = useState(false);
  const { columns } = useTerminalSize();
  const terminalFocused = useTerminalFocus();
  // Official defaults (vRp/CRp densables via platform table).
  const bottomDefault = 'ctrl+end';
  const pageDownDefault = 'pagedown';
  const bottomShortcut = getShortcutDisplay('scroll:bottom', 'Scroll', bottomDefault);
  const pageDownShortcut = getShortcutDisplay('scroll:pageDown', 'Scroll', pageDownDefault);
  const base = count > 0 ? `${count} new ${plural(count, 'message')}` : 'Jump to bottom';
  // Official: macOS + bottom binding is empty/default → prefer click or fn+↓
  // wording; otherwise show the resolved scroll:bottom chord.
  const isMacDefaultBottom = getPlatform() === 'macos' && (bottomShortcut === '' || bottomShortcut === bottomDefault);
  const mouseClickable = resolveMouseTrackingMode() === 'full' && terminalFocused;
  const pageDownHint = pageDownShortcut === pageDownDefault ? `fn+${figures.arrowDown}` : pageDownShortcut;
  let preferred: string;
  if (isMacDefaultBottom && mouseClickable) {
    preferred = `${base} (click) ${figures.arrowDown}`;
  } else if (isMacDefaultBottom && pageDownHint) {
    preferred = `${base}: ${pageDownHint} to scroll`;
  } else if (bottomShortcut) {
    preferred = `${base} (${bottomShortcut}) ${figures.arrowDown}`;
  } else {
    preferred = `${base} ${figures.arrowDown}`;
  }
  // Official width fallthrough: full → base+↓ → base (columns-2 budget).
  const maxWidth = Math.max(0, columns - 2);
  const bare = `${base} ${figures.arrowDown}`;
  const label = [preferred, bare, base].find(s => stringWidth(s) <= maxWidth) ?? base;
  // Badge (Ey densable): padded spaces + text color + truncate-end.
  const text = ` ${label} `;
  const width = stringWidth(text);
  const left = Math.max(0, Math.floor((columns - width) / 2));
  const bg = hover ? 'userMessageBackgroundHover' : 'userMessageBackground';
  // Official Bta densable: wLi() then onClick — pill clicks only, not
  // scroll:bottom keybindings.
  const handleClick = () => {
    recordJumpToBottomClick();
    onClick?.();
  };
  return (
    <Box position="absolute" bottom={0} left={left}>
      <Box noSelect onClick={handleClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <Text backgroundColor={bg} color="text" wrap="truncate-end">
          {text}
        </Text>
      </Box>
    </Box>
  );
}

// Context breadcrumb: when scrolled up into history, pin the current
// conversation turn's prompt above the viewport so you know what Claude was
// responding to. Normal-flow sibling BEFORE the ScrollBox (mirrors the pill
// below it) — shrinks the ScrollBox by exactly 1 row via flex, stays outside
// the DECSTBM scroll region. Click jumps back to the prompt.
//
// Height is FIXED at 1 row (truncate-end for long prompts). A variable-height
// header (1 when short, 2 when wrapped) shifts the ScrollBox by 1 row every
// time the sticky prompt switches during scroll — content jumps on screen
// even with scrollTop unchanged (the DECSTBM region top shifts with the
// ScrollBox, and the diff engine sees "everything moved"). Fixed height
// keeps the ScrollBox anchored; only the header TEXT changes, not its box.
function StickyPromptHeader({ text, onClick }: { text: string; onClick: () => void }): React.ReactNode {
  const [hover, setHover] = useState(false);
  return (
    <Box
      flexShrink={0}
      width="100%"
      height={1}
      paddingRight={1}
      backgroundColor={hover ? 'userMessageBackgroundHover' : 'userMessageBackground'}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Text color="subtle" wrap="truncate-end">
        {figures.pointer} {text}
      </Text>
    </Box>
  );
}

// Slash-command suggestion overlay — see promptOverlayContext.tsx for why
// it's portaled. Scroll-smear from floating over the DECSTBM region is
// repaired at the Ink layer (absoluteRectsPrev in render-node-to-output.ts).
// The renderer clamps negative y to 0 for absolute elements (see
// render-node-to-output.ts), so the top rows (best matches) stay visible
// even when the overlay extends above the viewport. We omit minHeight and
// flex-end here: they would create empty padding rows that shift visible
// items down into the prompt area when the list has fewer items than max.
function SuggestionsOverlay(): React.ReactNode {
  const data = usePromptOverlay();
  if (!data || data.suggestions.length === 0) return null;
  return (
    <Box position="absolute" bottom="100%" left={0} right={0} paddingX={2} paddingTop={1} flexDirection="column" opaque>
      <PromptInputFooterSuggestions
        suggestions={data.suggestions}
        selectedSuggestion={data.selectedSuggestion}
        maxColumnWidth={data.maxColumnWidth}
        overlay
      />
    </Box>
  );
}

// Dialog portaled from PromptInput (AutoModeOptInDialog) — same clip-escape
// pattern as SuggestionsOverlay. Renders later in tree order so it paints
// over suggestions if both are ever up (they shouldn't be).
function DialogOverlay(): React.ReactNode {
  const node = usePromptOverlayDialog();
  if (!node) return null;
  return (
    <Box position="absolute" bottom="100%" left={0} right={0} opaque>
      {node}
    </Box>
  );
}
