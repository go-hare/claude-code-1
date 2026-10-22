import figures from 'figures';
import React, {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
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
  TerminalSizeContext,
  Text,
  instances,
  stringWidth,
  useApp,
  useTerminalFocus,
  type DOMElement,
} from '@anthropic/ink';
import type { Message } from '../types/message.js';
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js';
import { openBrowser, openPath } from '../utils/browser.js';
import { getAutoScrollEnabled } from '../utils/config.js';
import { isFullscreenEnvEnabled, resolveMouseTrackingMode } from '../utils/fullscreen.js';
import { isAxcStickyMainEnabled } from '../utils/residualUiEnvGates.js';
import { getPlatform } from '../utils/platform.js';
import { useAppState } from '../state/AppState.js';
import { recordJumpToBottomClick } from '../utils/scrollTelemetry.js';
import { plural } from '../utils/stringUtils.js';
import { isNullRenderingAttachment } from './messages/nullRenderingAttachments.js';
import { ModalScroller } from './ModalScroller.js';
import PromptInputFooterSuggestions from './PromptInput/PromptInputFooterSuggestions.js';
import type { StickyPrompt } from './VirtualMessageList.js';

/** Rows of transcript context kept visible above the modal pane's ▔ divider. */
const MODAL_TRANSCRIPT_PEEK = 2;
/**
 * densable 2.1.289 tot `VCe` / `Ne`. Gold:
 *   `Ne=Zot()||XMn()?te-VCe:Math.floor(te/2)`
 * `VCe=2`. `Zot` = history-search overlay; `XMn` = elicitation / elicitation-url.
 * Default (idle typing) is half the terminal so a growing PromptInput cannot
 * squeeze ScrollBox to a sliver (transcript flash). Overlay arms keep rows-2
 * so HistorySearch / elicitation still fill the chrome.
 */
const FULLSCREEN_BOTTOM_CHROME_ROWS = 2;
const HISTORY_SEARCH_OVERLAY = 'history-search';
const ELICITATION_OVERLAYS = new Set(['elicitation', 'elicitation-url']);

/** Context for scroll-derived chrome (sticky header, pill). StickyTracker
 *  in VirtualMessageList writes via this instead of threading a callback
 *  up through Messages → REPL → FullscreenLayout. The setter is stable so
 *  consuming this context never causes re-renders. */
export const ScrollChromeContext = createContext<{
  setStickyPrompt: (p: StickyPrompt | null) => void;
}>({ setStickyPrompt: () => {} });

/**
 * densable prompt maxHeight `gt = max(0, Ne - pt)`. `pt` is the measured
 * above-prompt box. PromptInput subtracts footer lines from this budget.
 */
export const PromptChromeBudgetContext = createContext<number | undefined>(undefined);

/**
 * densable tot leftover chrome claim (`zot` / `Hm`).
 * Gold `SR(El,Hm)=El+Hm.rows()-Hm.owed`.
 */
export type LeftoverChromeClaim = {
  rows: () => number;
  owed: number;
};

/** densable tot `SR`. */
export function leftoverChromeReduce(acc: number, claim: LeftoverChromeClaim): number {
  return acc + claim.rows() - claim.owed;
}

/** densable Lo `qe` — leftover-null / Q-null list window. */
export const LEFTOVER_LIST_FALLBACK = 3;
/** densable Lo `hn` — non-leftover floor. */
export const LEFTOVER_LIST_FLOOR = 7;
/** densable Lo `Tte` — non-leftover reserve when modal has no `reserve`. */
export const LEFTOVER_LIST_RESERVE = 1;

/**
 * densable Lo leftover chrome `T` — `Js(R).height-Js(I).height`.
 * Gold: `R=t?.box.current??I; while(t===null&&!l) R=R.parentNode`.
 * Leftover / modal skip the walk. Idle walks to the root parent.
 */
export function leftoverChromeQ(
  list: DOMElement | null,
  modalBox: DOMElement | null = null,
  walkParents = false,
): number | null {
  if (list == null) return null;
  const listH = list.yogaNode?.getComputedHeight() ?? 0;
  let parent: DOMElement | undefined = modalBox ?? list;
  if (walkParents && modalBox == null) {
    let node: DOMElement | undefined = list;
    while (node.parentNode) node = node.parentNode as DOMElement;
    parent = node;
  }
  const parentH = parent?.yogaNode?.getComputedHeight() ?? 0;
  return parentH - listH;
}

/**
 * densable Lo leftover path `H`.
 * Gold `E=N+Js(W).height` `$l` → `q=l?F` → `H=max(1,q-Q)`.
 * `N` is leftover `Ye`/`Pe`; `W` is list/p5 box.
 */
export function leftoverListVisibleCount(leftover: number | null, hostH: number, chromeQ: number | null): number {
  if (leftover === null || chromeQ === null) return LEFTOVER_LIST_FALLBACK;
  return Math.max(1, leftover + hostH - chromeQ);
}

/**
 * densable `_Ee` `bt=$l(...)`.
 * no leftover context → rows; leftover null or unmounted host with settled →
 * settled??rows; else hostH+leftover.
 */
export function leftoverPluginBandBudget(
  leftoverOf: (() => number | null) | null,
  leftover: number | null,
  host: unknown,
  hostH: number,
  settled: number | undefined,
  rows: number,
): number {
  if (leftoverOf === null) return rows;
  if (leftover === null || (host === null && settled !== undefined)) {
    return settled ?? rows;
  }
  return Math.max(0, Math.min(rows, hostH + leftover));
}

/**
 * densable Lo non-leftover `H`.
 * `q=rows-reserve`; `H=max(1,min(max(hn,floor(rows/2)),q-Q))`.
 */
export function leftoverListVisibleCountIdle(
  rows: number,
  chromeQ: number | null,
  reserve = LEFTOVER_LIST_RESERVE,
): number {
  if (chromeQ === null) return LEFTOVER_LIST_FALLBACK;
  const q = rows - reserve;
  return Math.max(1, Math.min(Math.max(LEFTOVER_LIST_FLOOR, Math.floor(rows / 2)), q - chromeQ));
}

/**
 * densable Lo modal `d` path — `q=k`, `H=max(1,q-Q)`.
 */
export function leftoverListVisibleCountModal(rows: number, chromeQ: number | null): number {
  if (chromeQ === null) return LEFTOVER_LIST_FALLBACK;
  return Math.max(1, rows - chromeQ);
}

/**
 * densable inner `oo` `Z` — `E===void 0||E==="glyph"&&B===1?"count":E`.
 */
export function leftoverInnerOverflowHint(
  hint: LeftoverOverflowHint | undefined,
  visible: number,
): LeftoverOverflowHint | undefined {
  if (hint === undefined || (hint === 'glyph' && visible === 1)) return 'count';
  return hint;
}

/**
 * densable inner `oo` `j=E===void 0&&h>B` → `ee=max(1,B-2)`.
 */
export function leftoverInnerWindow(
  hint: LeftoverOverflowHint | undefined,
  visible: number,
  contentRows: number,
): number {
  if (hint === undefined && contentRows > visible) return Math.max(1, visible - 2);
  return visible;
}

/**
 * densable Lo `l=i!==null&&!d` — leftover AND NOT modal.
 */
export function leftoverXor(hasLeftover: boolean, inModal: boolean): boolean {
  return hasLeftover && !inModal;
}

/**
 * densable Lo chrome T walk: `while(t===null&&!l)`.
 * Walk only when p5 host is absent AND leftover xor is off.
 */
export function leftoverChromeWalkParents(hasP5: boolean, inLeftoverXor: boolean): boolean {
  return !hasP5 && !inLeftoverXor;
}

/**
 * densable Lo latch `k=d?t?.rows??u:a.rows`.
 */
export function leftoverLatchRows(
  inModal: boolean,
  modalRows: number | undefined,
  modalFallback: number,
  terminalRows: number,
): number {
  return inModal ? (modalRows ?? modalFallback) : terminalRows;
}

/**
 * densable leftover F host `W=t?.box.current??v.current`.
 */
export function leftoverFHostHeight(modalBox: DOMElement | null, list: DOMElement | null): number {
  const host = modalBox ?? list;
  return host?.yogaNode?.getComputedHeight() ?? 0;
}

/**
 * densable inner oo `U=j&&ee===B-2`.
 */
export function leftoverMoreRowLines(
  hint: LeftoverOverflowHint | undefined,
  visible: number,
  contentRows: number,
): boolean {
  if (hint !== undefined || contentRows <= visible) return false;
  return leftoverInnerWindow(hint, visible, contentRows) === visible - 2;
}

/** densable inner oo `Oo` — heading/item lines, default 1. */
export function leftoverChildRows(lines?: number): number {
  if (lines === undefined || !Number.isFinite(lines)) return 1;
  return Math.max(1, Math.trunc(lines));
}

/**
 * densable Lo leftover owed.
 * `B.every(Ee)?Number(Boolean(emptyMessage)):B.map(Oo).reduce(yt,0)`.
 */
export function leftoverOwedRows(
  childCount: number,
  lines?: Array<number | undefined>,
  headings?: boolean[],
  emptyMessage?: unknown,
): number {
  const allHeading =
    childCount > 0 && headings !== undefined && headings.length === childCount && headings.every(Boolean);
  if (allHeading) return Number(Boolean(emptyMessage));
  let acc = 0;
  for (let i = 0; i < childCount; i++) acc += leftoverChildRows(lines?.[i]);
  return acc;
}

/** densable `$e` `ho` — thumb top/size on a track of `height`. */
export function leftoverScrollThumb(
  offset: number,
  visible: number,
  total: number,
  height: number,
): { top: number; size: number } {
  const size = Math.min(Math.max(1, Math.round((visible / total) * height)), Math.max(1, height - 1));
  const slack = height - size;
  const maxOffset = total - visible;
  if (offset <= 0) return { top: 0, size };
  if (offset >= maxOffset) return { top: slack, size };
  const top = Math.round((offset / maxOffset) * slack);
  if (slack < 2) return { top, size };
  return { top: Math.min(Math.max(1, top), slack - 1), size };
}

/** densable `$e` `un` — pointer top → content offset. */
export function leftoverScrollOffsetFromThumb(top: number, visible: number, total: number, height: number): number {
  const { size } = leftoverScrollThumb(0, visible, total, height);
  const slack = height - size;
  const maxOffset = total - visible;
  if (top <= 0) return 0;
  if (top >= slack) return maxOffset;
  const offset = Math.round((top / slack) * maxOffset);
  if (maxOffset < 2) return offset;
  return Math.min(Math.max(1, offset), maxOffset - 1);
}

/** densable inner `co` `$o=1000` — je press then same-row dropAsStray. */
export const LEFTOVER_JE_DROPS_MS = 1000;

export function leftoverJeDropsClick(
  pressed: { at: number; row: number } | null,
  row: number,
  now: number,
  windowMs = LEFTOVER_JE_DROPS_MS,
): boolean {
  if (pressed === null) return false;
  if (row !== pressed.row || now - pressed.at >= windowMs) return false;
  return true;
}

/** densable `$e` grab bag after left-down. */
export type LeftoverScrollGrab = {
  trackRow: number;
  visible: number;
  total: number;
  height: number;
  grab: number;
  asked: number;
};

/**
 * densable `$e` pointer: up clears; left-down stores trackRow/grab;
 * thumb-inside drag skips onScrollTo (`!U`).
 */
export function leftoverScrollbarPointer(
  event: { type: string; button: number; row: number; localRow: number },
  thumb: { top: number; size: number },
  bar: { visible: number; total: number; height: number; offset: number },
  grab: LeftoverScrollGrab | null,
): { grab: LeftoverScrollGrab | null; scrollTo?: number } {
  if (event.type === 'mouseup') return { grab: null };
  const isDown = event.type === 'mousedown' && event.button === 0;
  const onThumb = isDown && event.localRow >= thumb.top && event.localRow < thumb.top + thumb.size;
  let next = grab;
  if (isDown) {
    next = {
      trackRow: event.row - event.localRow,
      visible: bar.visible,
      total: bar.total,
      height: bar.height,
      grab: onThumb ? event.localRow - thumb.top : Math.floor(thumb.size / 2),
      asked: bar.offset,
    };
  }
  if (next === null) return { grab: null };
  const raw = leftoverScrollOffsetFromThumb(
    event.row - next.trackRow - next.grab,
    next.visible,
    next.total,
    next.height,
  );
  const asked = raw >= next.total - next.visible ? next.total - Math.min(next.visible, bar.visible) : raw;
  if (asked === next.asked) return { grab: next };
  next.asked = asked;
  // densable `!U` — only the initiating left-down on the thumb skips onScrollTo.
  // Subsequent drag (`!isDown`) always calls onScrollTo.
  if (onThumb) return { grab: next };
  return { grab: next, scrollTo: asked };
}

/** densable GXt `v=l&&t.total>t.visible`. Track (spacer or `$e`) only when hover-tracked. */
export function leftoverGxtShowTrack(hoverTracked: boolean, overflows: boolean): boolean {
  return hoverTracked && overflows;
}

/** densable GXt `v=l&&t.total>t.visible` then `S=v&&(u?$e:spacer)`. */
export function leftoverGxtPaintBar(hoverTracked: boolean, hovered: boolean, overflows: boolean): boolean {
  return leftoverGxtShowTrack(hoverTracked, overflows) && hovered;
}

/** densable `$e` `q=E||R?"suggestion"`. */
export function leftoverThumbColor(thumbHover: boolean, dragging: boolean): 'suggestion' | undefined {
  return thumbHover || dragging ? 'suggestion' : undefined;
}

/** densable `$e` `G=d||R?Q:void 0` — onPointer only when onScrollTo or dragging. */
export function leftoverThumbPointerOn(hasScrollTo: boolean, dragging: boolean): boolean {
  return hasScrollTo || dragging;
}

/** densable `$e` up-arrow `l&&t>0`. */
export function leftoverArrowUpOn(offset: number): boolean {
  return offset > 0;
}

/** densable `$e` down-arrow `l&&t<a-i`. */
export function leftoverArrowDownOn(offset: number, visible: number, total: number): boolean {
  return offset < total - visible;
}

/** densable `onWheel:!ee&&!ne.fits`. */
export function leftoverWheelOn(disabled: boolean, fits: boolean): boolean {
  return !disabled && !fits;
}

/** densable heading line occupancy — headings consume a row, not a cursor. */
export function leftoverHeadingOccupiesLine(heading: boolean | undefined): boolean {
  return heading === true;
}

/**
 * densable heading `M.push(H++)` — headings occupy a `pn` line, not a cursor.
 * Items use `Oo` / leftoverChildRows.
 */
export function leftoverLineCount(options: Array<{ heading?: boolean; lines?: number }>): number {
  let n = 0;
  for (const option of options) {
    n += leftoverHeadingOccupiesLine(option.heading) ? 1 : leftoverChildRows(option.lines);
  }
  return n;
}

/** densable ihe `${windowStart} ${childKeys}`. */
export function leftoverIheWindowValue(windowStart: number | undefined, childKeys: string): string {
  return `${windowStart === undefined ? 0 : windowStart} ${childKeys}`;
}

/** densable `de` `T&&!Yl()` — return-accept only when keybinding context is absent. */
export function leftoverBindAcceptOn(canAccept: boolean, hasKeybinding: boolean): boolean {
  return canAccept && !hasKeybinding;
}

/** densable En `Xe()&&onSelect` — screen-reader radio, skip Lo/oo. */
export function leftoverScreenReaderRadio(screenReader: boolean, hasOnSelect: boolean): boolean {
  return screenReader && hasOnSelect;
}

/** densable `$e` `ZM` — Xe hides the scrollbar. */
export function leftoverScrollbarHidden(screenReader: boolean): boolean {
  return screenReader;
}

/**
 * densable `Bg(y,!_)` / g5 `Bg(Oe,!S)` — auto-focus when enabled.
 * Gold g5 still focuses on Xe radio.
 */
export function leftoverBgOn(enabled: boolean, _screenReaderRadio = false): boolean {
  return enabled;
}

/** densable En SR onKeyDown eats return/space. */
export function leftoverScreenReaderEatKey(key: string): boolean {
  return key === 'return' || key === ' ';
}

/** densable En `g5` `drawLabels:!0`. */
export function leftoverG5DrawLabels(screenReaderRadio: boolean): boolean {
  return screenReaderRadio;
}

/** densable En `g5` `index:gt+1`. */
export function leftoverG5Index(nav: number): number {
  return nav + 1;
}

/**
 * densable En headings map — `d.set(l.length, [...d.get(l.length)??[], v])`.
 * Headings attach to the next item index (or past the last item).
 */
export function leftoverG5Headings<T>(options: Array<{ heading?: boolean; label?: T }>): Map<number, T[]> {
  const map = new Map<number, T[]>();
  let itemIndex = 0;
  for (const option of options) {
    if (leftoverHeadingOccupiesLine(option.heading)) {
      if (option.label !== undefined) {
        map.set(itemIndex, [...(map.get(itemIndex) ?? []), option.label]);
      }
      continue;
    }
    itemIndex++;
  }
  return map;
}

/**
 * densable `g5` prompt — `Select with numbers [1-N]` then Enter / Escape.
 */
export function leftoverG5Prompt(count: number, hasCancel: boolean, arrowNav = false): string {
  if (count === 0) return `Nothing to select${hasCancel ? '. Escape to cancel' : ''}`;
  const then = hasCancel ? 'Enter to submit, Escape to cancel' : 'Enter to submit';
  const arrows = arrowNav ? ' or up / down arrow keys' : '';
  return `Select with numbers [1-${count}]${arrows}. Then ${then}`;
}

/** densable g5 `DZe` — GB `tengu_ax_sr_arrow_nav` default false. */
export const LEFTOVER_G5_ARROW_NAV_GB = 'tengu_ax_sr_arrow_nav';

export function leftoverG5Dze(arrowNavEnabled: boolean): boolean {
  return arrowNavEnabled;
}

/** densable g5 `ha("select", !!l&&!S)`. */
export function leftoverG5HaSelect(hasCancel: boolean, disabled: boolean): boolean {
  return hasCancel && !disabled;
}

/** densable g5 `I?.()` refuseInput. */
export function leftoverG5Refuse(refuseInput: (() => boolean) | undefined): boolean {
  return refuseInput?.() === true;
}

/** densable g5 `xt=!C&&!(S&&q)`. */
export function leftoverG5ShowPrompt(
  disableSelection: boolean,
  disabled: boolean,
  hidePromptWhileDisabled: boolean,
): boolean {
  return !disableSelection && !(disabled && hidePromptWhileDisabled);
}

/** densable VMn `ha("multi-select", !!d&&!C)`. */
export function leftoverVmnHa(hasCancel: boolean, disabled: boolean): boolean {
  return leftoverG5HaSelect(hasCancel, disabled);
}

/** densable VMn `HV(B4(key)).replace(，/,).replace(、/,)`. */
export function leftoverVmnNormalize(key: string): string {
  return key.replace('，', ',').replace('、', ',');
}

/** densable VMn typed tokens — comma / space / ideographic comma. */
export function leftoverVmnToken(key: string): boolean {
  return /^[0-9, ]$/.test(leftoverVmnNormalize(key));
}

export function leftoverVmnParse(typed: string, count: number): { indexes: number[] } | { error: string } {
  const raw = typed.trim();
  if (raw === '') return { indexes: [] };
  const bits = raw.split(/[\s,]+/).filter(Boolean);
  if (bits.length === 0) return { indexes: [] };
  const seen = new Set<number>();
  const indexes: number[] = [];
  for (const bit of bits) {
    if (!/^\d+$/.test(bit)) {
      return {
        error: `Invalid selection "${bit}". Enter numbers between 1 and ${count}, comma- or space-separated.`,
      };
    }
    const n = Number.parseInt(bit, 10);
    if (seen.has(n)) continue;
    seen.add(n);
    if (n < 1 || n > count) {
      return {
        error: `Invalid selection "${bit}". Enter numbers between 1 and ${count}, comma- or space-separated.`,
      };
    }
    indexes.push(n - 1);
  }
  return { indexes };
}

/** densable VMn At — disabled / type==="input" / two-input refuse. */
export function leftoverVmnParseOptions<T extends { disabled?: boolean; type?: string }>(
  typed: string,
  options: T[],
): { indexes: number[]; inputIndex?: number } | { error: string } {
  const parsed = leftoverVmnParse(typed, options.length);
  if ('error' in parsed) return parsed;
  let inputIndex: number | undefined;
  const indexes: number[] = [];
  for (const i of parsed.indexes) {
    const option = options[i];
    if (option?.disabled === true) {
      return { error: leftoverG5Disabled(i + 1) };
    }
    if (option?.type === 'input') {
      if (inputIndex !== undefined) return { error: leftoverVmnTwoInputs() };
      inputIndex = i;
      continue;
    }
    indexes.push(i);
  }
  return inputIndex === undefined ? { indexes } : { indexes, inputIndex };
}

/** densable Io — "A, B, or C". */
export function leftoverVmnJoinThen(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} or ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, or ${parts.at(-1)}`;
}

export function leftoverVmnPrompt(
  count: number,
  hasCancel: boolean,
  arrowNav: boolean,
  submitLabel?: string,
  typed = '',
  defaultsOn = false,
  spaceToggle = false,
): string {
  const arrows = arrowNav ? ' or up / down arrow keys' : '';
  const then = leftoverVmnJoinThen([
    ...(spaceToggle ? ['Space to toggle'] : []),
    `Enter to ${submitLabel ?? 'submit'}`,
    ...(defaultsOn ? ['bare Enter for defaults'] : []),
    ...(hasCancel ? ['Escape to cancel'] : []),
  ]);
  return `Select with numbers [1-${count}] (comma- or space-separated for several)${arrows}. Then ${then}: ${typed}`;
}

export function leftoverVmnInputPrompt(index1: number, label: string, typed: string): string {
  return `Enter text for option ${index1} (${label}), or Escape for the list: ${typed}`;
}

export function leftoverVmnTwoInputs(): string {
  return 'Only one free-text option can be included per selection.';
}

/** densable VMn `X.current` race. */
export function leftoverVmnRace(): string {
  return 'Part of that entry arrived before the list was ready — enter your selection again.';
}

/** densable VMn `ee=!C&&M===null`. */
export function leftoverVmnCursorOn(disabled: boolean, arrowFocused: boolean): boolean {
  return leftoverG5PromptCursorOn(disabled, false, arrowFocused);
}

/** densable Rn flags. */
export function leftoverVmnRnFlags(selected: boolean, disabled: boolean): string {
  return [disabled ? '(disabled)' : null, selected ? '(selected)' : null].filter(Boolean).join(' ');
}

/** densable `ii=300` `ys` `Na` `ks`. */
export const LEFTOVER_VMN_KS = 300;

export function leftoverVmnYs(text: string, n: number): string {
  if (text.length <= n) return text;
  let out = '';
  let count = 0;
  for (const ch of text) {
    if (count >= n) break;
    out += ch;
    count++;
  }
  return out;
}

export function leftoverVmnKs(text: string): string {
  if (text.length <= LEFTOVER_VMN_KS) return text;
  const t = leftoverVmnYs(text, LEFTOVER_VMN_KS);
  if (t === text) return text;
  const extra = [...text].length - LEFTOVER_VMN_KS;
  return `${t} … +${extra} more characters`;
}

export function leftoverVmnRn(
  index1: number,
  label: string,
  description: string | undefined,
  selected: boolean,
  disabled: boolean,
  drawLabel = false,
): string {
  const flags = leftoverVmnRnFlags(selected, disabled);
  const desc = description ? ` — ${description}` : '';
  if (drawLabel) {
    const W = flags ? ` ${flags}` : '';
    return `${index1}.${W}${label}${desc}`;
  }
  const prefix = flags ? `${flags} ` : '';
  return `${index1}. ${prefix}${leftoverVmnKs(`${label}${desc}`)}`;
}

/** densable VMn Escape `ue.raw`. */
export function leftoverVmnEscapeTyped(inInput: boolean, raw: string): string {
  return inInput ? raw : '';
}

/** densable VMn `selected:N?N.has(zo):Vt.has(In.value)`. */
export function leftoverVmnPaintSelected(
  toggle: ReadonlySet<number> | null,
  index: number,
  inDefaults: boolean,
): boolean {
  return toggle !== null ? toggle.has(index) : inDefaults;
}

export function leftoverVmnToggleSet(
  prev: ReadonlySet<number> | null,
  defaults: Iterable<number>,
  index: number,
): Set<number> {
  const next = new Set(prev ?? defaults);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

export function leftoverVmnSpaceToggle(arrowNav: boolean, arrowFocused: boolean, key: string): boolean {
  return arrowNav && arrowFocused && key === ' ';
}

/** densable leftover chrome `nn` `Pn=2` `io=3` `Bn=50` `Ln=6`. */
export const LEFTOVER_NN_PAD = 2;
export const LEFTOVER_NN_GAP = 3;
export const LEFTOVER_NN_NAME_CAP = 50;
export const LEFTOVER_NN_FACTS_FLOOR = 6;

/**
 * densable Un `U`/`M` — facts/name widths from host minus icon.
 * `U=L+X>h&&h<2*Ln?0:min(j,facts)`; `M=min(L,h-U)`.
 */
export function leftoverNnBudget(
  hostWidth: number,
  iconWidth: number,
  nameMax: number,
  factsMax: number,
): { nameWidth: number; factsWidth: number } {
  const T = Math.max(0, hostWidth - LEFTOVER_NN_PAD);
  const P = Math.max(0, iconWidth);
  const L = Math.min(LEFTOVER_NN_NAME_CAP, Math.max(0, nameMax));
  const X = Math.max(0, factsMax);
  const h = T - (P > 0 ? P + 1 : 0) - LEFTOVER_NN_GAP;
  const j = h - Math.min(L, Math.max(Math.ceil(h / 2), h - X));
  const factsWidth = L + X > h && h < 2 * LEFTOVER_NN_FACTS_FLOOR ? 0 : Math.min(j, Math.max(0, X));
  const nameWidth = Math.min(L, Math.max(0, h - factsWidth));
  return { nameWidth, factsWidth };
}

export function leftoverNnItemLines(description: string | undefined): number {
  return description ? 2 : 1;
}

/** densable so — longest prefix of facts that still fits `width`. */
export function leftoverNnFit(facts: string[], width: number): string {
  if (facts.length === 0) return '';
  let kept = '';
  for (let i = 0; i < facts.length; i++) {
    const next = facts.slice(0, i + 1).join(' · ');
    if (i > 0 && stringWidth(next) > width) break;
    kept = next;
  }
  return kept;
}

export function leftoverNnFacts(meta: Array<string | number | boolean> | undefined): string[] {
  return (meta ?? []).map(bit => leftoverNnText(bit)).filter(bit => bit !== '');
}

export function leftoverNnText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function leftoverNnJoin(facts: string[]): string {
  return facts.join(' · ');
}

export function leftoverNnIconCol(iconWidth: number): number {
  return iconWidth > 0 ? iconWidth + 1 : 0;
}

/**
 * densable Un `v()` — Dt child yoga else `(host||columns)-Pn`.
 */
export function leftoverNnLiveWidth(hostWidth: number, columns: number, childWidth = 0): number {
  if (childWidth > 0) return childWidth;
  return Math.max(0, (hostWidth > 0 ? hostWidth : columns) - LEFTOVER_NN_PAD);
}

/** densable Ko `U=T?"suggestion":void 0`. */
export function leftoverNnNameColor(focused: boolean): 'suggestion' | undefined {
  return focused ? 'suggestion' : undefined;
}

/** densable Dt `d.add(j)` / unmount delete. */
export function leftoverNnDtBind(nodes: Set<DOMElement> | null, node: DOMElement | null): (() => void) | undefined {
  if (!nodes || !node) return undefined;
  nodes.add(node);
  return () => {
    nodes.delete(node);
  };
}

/** densable Un `v` `[p]=l` first child width. */
export function leftoverNnDtWidth(nodes: Iterable<DOMElement>): number {
  for (const node of nodes) {
    const w = node.yogaNode?.getComputedWidth() ?? 0;
    if (w > 0) return w;
  }
  return 0;
}

/** densable sst — max JCe status icon width. */
export function leftoverNnStatusIconWidth(): number {
  return Math.max(
    stringWidth(figures.tick),
    stringWidth(figures.cross),
    stringWidth(figures.warning),
    stringWidth(figures.info),
    stringWidth(figures.circle),
    stringWidth('…'),
    1,
  );
}

/** densable Ht `gf(H)&&H.type===Ze?sst():ae(UR(H))`. */
export function leftoverNnIconWidth(icon: unknown, isStatus = false): number {
  if (icon === undefined || icon === null || icon === false) return 0;
  if (isStatus) return leftoverNnStatusIconWidth();
  if (typeof icon === 'string' || typeof icon === 'number' || typeof icon === 'boolean') {
    return stringWidth(String(icon));
  }
  if (Array.isArray(icon)) {
    return stringWidth(icon.map(bit => leftoverNnText(bit)).join(''));
  }
  if (typeof icon === 'object' && 'props' in icon) {
    const props = (icon as { props?: { status?: unknown; children?: unknown } }).props;
    if (props && 'status' in props) return leftoverNnStatusIconWidth();
    return leftoverNnIconWidth(props?.children, false);
  }
  return leftoverNnStatusIconWidth();
}

/** densable Ko Xe SR: `, facts` + `. description`. */
export function leftoverNnSrLine(label: string, facts: string[], description: string | undefined): string {
  const C = facts.length > 0 ? `, ${leftoverNnJoin(facts)}` : '';
  const P = description ? `. ${description}` : '';
  return `${label}${C}${P}`;
}

/** densable Un P/L/X then leftoverNnBudget. */
export function leftoverNnFromOptions(
  hostWidth: number,
  rows: Array<{ iconWidth: number; name: string; facts: string[] }>,
): { nameWidth: number; factsWidth: number; iconWidth: number } | null {
  if (hostWidth <= 0) return null;
  if (rows.every(row => row.iconWidth === 0 && row.facts.length === 0)) return null;
  const iconWidth = Math.max(0, ...rows.map(row => row.iconWidth));
  const named = rows.filter(row => row.facts.length > 0);
  const nameMax = Math.max(0, ...named.map(row => stringWidth(row.name)));
  const factsMax = Math.max(0, ...named.map(row => stringWidth(leftoverNnJoin(row.facts))));
  const T = Math.max(0, hostWidth);
  const P = Math.max(0, iconWidth);
  const L = Math.min(LEFTOVER_NN_NAME_CAP, Math.max(0, nameMax));
  const X = Math.max(0, factsMax);
  const h = T - (P > 0 ? P + 1 : 0) - LEFTOVER_NN_GAP;
  const j = h - Math.min(L, Math.max(Math.ceil(h / 2), h - X));
  const fitted = Math.max(0, ...named.map(row => stringWidth(leftoverNnFit(row.facts, j))));
  const factsWidth = L + X > h && h < 2 * LEFTOVER_NN_FACTS_FLOOR ? 0 : Math.min(j, fitted);
  const nameWidth = Math.min(L, Math.max(0, h - factsWidth));
  return { nameWidth, factsWidth, iconWidth };
}

/** densable leftover chrome `fe` `_n=150` `Vn=400` `zn=60`. */
export const LEFTOVER_FE_CLICK_MS = 150;
export const LEFTOVER_FE_REPEAT_INITIAL_MS = 400;
export const LEFTOVER_FE_REPEAT_MS = 60;

/** densable g5 digit type-to-select. */
export function leftoverG5Digit(key: string): boolean {
  return key.length === 1 && key >= '0' && key <= '9';
}

export function leftoverG5ParseIndex(typed: string, count: number): number | null {
  const n = Number.parseInt(typed, 10);
  if (!Number.isFinite(n) || n < 1 || n > count) return null;
  return n - 1;
}

export function leftoverG5Invalid(typed: string, count: number): string {
  if (count === 0) return `Invalid selection "${typed}". Nothing to select.`;
  return `Invalid selection "${typed}". Enter a number between 1 and ${count}.`;
}

export function leftoverG5Disabled(index1: number): string {
  return `Option ${index1} is disabled.`;
}

export function leftoverG5EmptyInput(): string {
  return 'Enter some text, or Escape for the list.';
}

/** densable g5 return: typed buffer, else arrow focus. */
export function leftoverG5SubmitKind(typed: string, hasArrowFocus: boolean): 'typed' | 'focus' | 'none' {
  if (typed.length > 0) return 'typed';
  if (hasArrowFocus) return 'focus';
  return 'none';
}

/** densable g5 `ne(String(R.current+1))` — navigable 1-based, headings skip. */
export function leftoverG5FocusTyped(
  options: Array<{ heading?: boolean; value?: unknown }>,
  focusedValue: unknown,
): string | null {
  if (focusedValue === undefined) return null;
  let nav = 0;
  for (const option of options) {
    if (leftoverHeadingOccupiesLine(option.heading)) continue;
    if (option.value === focusedValue) return String(leftoverG5Index(nav));
    nav++;
  }
  return null;
}

/**
 * densable g5 `Ye=!S&&!C&&N===null` — prompt cursor on when no arrow focus.
 */
export function leftoverG5PromptCursorOn(disabled: boolean, disableSelection: boolean, arrowFocused: boolean): boolean {
  return !disabled && !disableSelection && !arrowFocused;
}

/** densable g5 `Ee=ae(je)` — prompt cursor column. */
export function leftoverG5PromptColumn(prompt: string): number {
  return stringWidth(prompt);
}

/** densable pn cursor in the pinned window. */
export function leftoverPnCursorInView(cursorNav: number, from: number, to: number): boolean {
  return cursorNav >= from && cursorNav < to;
}

/**
 * densable pn `pin:()=>S(M(I(),E()))` — latch window start.
 * In view: keep current start. Else: cursor's window start (`M`).
 */
export function leftoverPnPin(windowStart: number, cursorInView: boolean, cursorWindowStart: number): number {
  return cursorInView ? windowStart : cursorWindowStart;
}

/** densable pn `fits:H` `z-k>=o`. */
export function leftoverPnFits(lineCount: number, windowRows: number): boolean {
  return windowRows >= lineCount;
}

/** densable pn `G=H?0:max(0,W-C(k,z)-z+k)`. Analog: 0 when fits. */
export function leftoverPnSpareLines(fits: boolean, windowRows: number, shown: number): number {
  return fits ? 0 : Math.max(0, windowRows - shown);
}

/** densable pn bar `onScrollTo:H?void 0`. */
export function leftoverPnScrollOn(fits: boolean): boolean {
  return !fits;
}

/** densable pn `_=z-k+G`. */
export function leftoverPnBarVisible(windowStart: number, windowEnd: number, spare: number): number {
  return windowEnd - windowStart + spare;
}

/** densable pn line → nav cursor. Headings map to the next item. */
export function leftoverLineToNav(options: Array<{ heading?: boolean; lines?: number }>, lineIndex: number): number {
  let line = 0;
  let nav = 0;
  for (const option of options) {
    if (leftoverHeadingOccupiesLine(option.heading)) {
      if (line >= lineIndex) return nav;
      line += 1;
      continue;
    }
    if (line >= lineIndex) return nav;
    line += leftoverChildRows(option.lines);
    nav++;
  }
  return Math.max(0, nav - 1);
}

/** densable ihe `Xn` — consumed by VDe / LeftoverIheHoverTrack / IC. */
export const LeftoverIheWindowContext = createContext('');

/** densable Un `Dt` — Ko row yoga nodes for leftoverNnLiveWidth child. */
export const LeftoverNnDtContext = createContext<Set<DOMElement> | null>(null);

/** densable bn `markerLines` `f=u?1:0`. */
export function leftoverMarkerLines(moreRowLines: boolean): number {
  return moreRowLines ? 1 : 0;
}

/** densable pn `W=t+2*l`. */
export function leftoverPnWindow(visibleCount: number, markerLines: number): number {
  return visibleCount + 2 * markerLines;
}

/** densable heading `M.push(H++)` then item `H+=Oo`. Convert nav index to line. */
export function leftoverNavToLine(options: Array<{ heading?: boolean; lines?: number }>, navIndex: number): number {
  let nav = 0;
  let line = 0;
  for (const option of options) {
    if (leftoverHeadingOccupiesLine(option.heading)) {
      line += 1;
      continue;
    }
    if (nav >= navIndex) return line;
    line += leftoverChildRows(option.lines);
    nav++;
  }
  return line;
}

/**
 * densable pn window start — include heading run immediately before the nav item.
 */
export function leftoverWindowStartLine(
  options: Array<{ heading?: boolean; lines?: number }>,
  navFrom: number,
): number {
  let line = 0;
  let nav = 0;
  let headingRun = 0;
  for (const option of options) {
    if (leftoverHeadingOccupiesLine(option.heading)) {
      headingRun += 1;
      line += 1;
      continue;
    }
    if (nav === navFrom) return line - headingRun;
    line += leftoverChildRows(option.lines);
    nav++;
    headingRun = 0;
  }
  return Math.max(0, line - headingRun);
}

/** densable oo `He` slice with nav index (headings keep the next cursor). */
export function leftoverLineWindowSlice<T extends { heading?: boolean; lines?: number }>(
  options: T[],
  lineStart: number,
  lineEnd: number,
): Array<T & { index: number }> {
  const out: Array<T & { index: number }> = [];
  let line = 0;
  let nav = 0;
  for (const option of options) {
    if (line >= lineStart && line < lineEnd) out.push({ ...option, index: nav });
    if (leftoverHeadingOccupiesLine(option.heading)) {
      line += 1;
      continue;
    }
    line += leftoverChildRows(option.lines);
    nav++;
  }
  return out;
}

/** densable oo `He` `ge>=re&&ge<de` — include by line occupancy. */
export function leftoverLineSlice<T extends { heading?: boolean; lines?: number }>(
  options: T[],
  lineStart: number,
  lineEnd: number,
): T[] {
  const out: T[] = [];
  let line = 0;
  for (const option of options) {
    if (line >= lineStart && line < lineEnd) out.push(option);
    line += leftoverHeadingOccupiesLine(option.heading) ? 1 : leftoverChildRows(option.lines);
  }
  return out;
}

/** densable oo `k.push(Math.min(X[Y]??1, ee))`. */
export function leftoverRowHeight(lines: number | undefined, windowRows: number): number {
  return Math.min(leftoverChildRows(lines), Math.max(1, windowRows));
}

/** densable oo item `height:k[be] overflow:"hidden"` — headings skip clip. */
export function leftoverRowClip(
  heading: boolean | undefined,
  lines: number | undefined,
  windowRows: number,
): number | undefined {
  if (leftoverHeadingOccupiesLine(heading)) return undefined;
  return leftoverRowHeight(lines, windowRows);
}

/** densable VDe `l=o&&i===t` — hover on when identity matches. */
export function leftoverIheHoverOn(hoveredIdentity: string | null, currentIdentity: string): boolean {
  return hoveredIdentity === currentIdentity;
}

/** densable VDe `if(i!==null&&!l)a(null)`. */
export function leftoverIheHoverClear(hoveredIdentity: string | null, currentIdentity: string): boolean {
  return hoveredIdentity !== null && hoveredIdentity !== currentIdentity;
}

/**
 * densable headingLines — headings are not cursor slots.
 * `from`/`to` are navigable indices.
 */
export function leftoverNavigableCount(options: Array<{ heading?: boolean }>): number {
  let n = 0;
  for (const option of options) {
    if (option.heading !== true) n++;
  }
  return n;
}

export function leftoverVisibleSlice<T extends { heading?: boolean }>(options: T[], from: number, to: number): T[] {
  const out: T[] = [];
  let nav = 0;
  for (const option of options) {
    if (option.heading === true) {
      if (nav >= from && nav < to) out.push(option);
      continue;
    }
    if (nav >= from && nav < to) out.push(option);
    nav++;
  }
  return out;
}

/** densable GXt `if(u&&!l)d(!1)` — clear local hover when hover-tracked is off. */
export function leftoverGxtClearHover(hovered: boolean, hoverTracked: boolean): boolean {
  return hovered && !hoverTracked;
}

/** densable inner oo `m.spareLines`. */
export function leftoverSpareLines(windowRows: number, shown: number): number {
  return Math.max(0, windowRows - shown);
}

/** densable GXt `height:U?B`. */
export function leftoverGxtHeight(moreRowLines: boolean, visible: number): number | undefined {
  return moreRowLines ? visible : undefined;
}

/**
 * densable inner oo je `Ae` — `onPress` empty when disabled and no
 * `onDisabledRowClick`.
 */
export function leftoverJePressEnabled(disabled: boolean, onDisabledRowClick: unknown): boolean {
  return !(disabled && onDisabledRowClick === undefined);
}

/**
 * densable Lo chrome latch `U`/`Q`.
 * Same rows+width: `Q=max(U.chrome,S??U.chrome)`; else `Q=S`.
 */
export function leftoverChromeLatch(
  prev: { rows: number; width: number; chrome: number } | null,
  rows: number,
  width: number,
  chrome: number | null,
): { latch: { rows: number; width: number; chrome: number } | null; q: number | null } {
  const same = prev !== null && prev.rows === rows && prev.width === width;
  const nextLatch =
    chrome !== null && (prev === null || !same || chrome > prev.chrome) ? { rows, width, chrome } : prev;
  const q = same ? Math.max(prev?.chrome ?? 0, chrome ?? prev?.chrome ?? 0) : chrome;
  return { latch: nextLatch, q };
}

/** densable Lo leftover overflowHint `G`. */
export type LeftoverOverflowHint = 'none' | 'glyph' | 'count';

export function leftoverOverflowHint(
  visible: number,
  hint: LeftoverOverflowHint | undefined,
): LeftoverOverflowHint | undefined {
  if (visible === 1) return 'none';
  if (visible < LEFTOVER_LIST_FALLBACK && hint !== 'none') return 'glyph';
  if (hint === 'count') return undefined;
  return hint;
}

/**
 * densable tot `zot` — leftover chrome (`Lo`) registers `{rows, owed}`.
 * tot `wt` appends; unmount filters.
 */
export const LeftoverChromeSubscribeContext = createContext<((claim: LeftoverChromeClaim) => () => void) | null>(null);

/**
 * densable tot `f5` leftover for `_Ee` / PluginAbovePromptSite.
 * Gold Ye: `Ne - We.height - ye.height` (prompt inner + above inner).
 * Gold Pe: `Ye===null?null:ut.reduce(SR,Ye)`.
 */
export const AbovePromptLeftoverContext = createContext<(() => number | null) | null>(null);

/**
 * densable leftover modal host `Ue` / `KVe` / `p5()`.
 * Gold Lo chrome `T`: `R=t?.box.current??I`.
 */
export type LeftoverModalHost = {
  box: RefObject<DOMElement | null>;
  rows: number;
  reserve?: number;
};

export const LeftoverModalHostContext = createContext<LeftoverModalHost | null>(null);

/**
 * densable leftover chrome `Xt` — register `{rows, owed}` while inside tot We.
 */
export function useLeftoverChromeClaim(hostRef: RefObject<DOMElement | null>, owed: number, enabled = true): void {
  const subscribe = useContext(LeftoverChromeSubscribeContext);
  useEffect(() => {
    if (!enabled || subscribe === null) return;
    return subscribe({
      rows: () => hostRef.current?.yogaNode?.getComputedHeight() ?? owed,
      owed,
    });
  }, [subscribe, hostRef, owed, enabled]);
}

/**
 * densable `$l(o)` — `Pt(subscribeLayout, o)` + layout-effect bump when
 * `!Object.is(o(), snapshot)`. Gold tot `qe` is
 * `$e.current===null?0:Js($e.current).height` — raw yoga height, no Math.round.
 * Rounding spinner/companion sub-pixels rewrote PromptInput maxHeight every
 * frame and flashed the transcript.
 */
function useYogaHeight(ref: RefObject<DOMElement | null>): number {
  const { subscribeLayout } = useApp();
  const read = useCallback(() => {
    // densable qe: `$e.current===null?0:Js($e.current).height` — no finite gate.
    return ref.current?.yogaNode?.getComputedHeight() ?? 0;
  }, [ref]);
  const snapshot = useSyncExternalStore(subscribeLayout, read, read);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    if (!Object.is(read(), snapshot)) bump();
  });
  return snapshot;
}

type Props = {
  /** Content that scrolls (messages, tool output) */
  scrollable: ReactNode;
  /** Content pinned to the bottom (spinner, prompt, permissions) */
  bottom: ReactNode;
  /**
   * densable abovePrompt (vh). Capped at Ne on its own; the prompt box
   * receives the leftover `max(0, Ne - measured height)`.
   */
  abovePrompt?: ReactNode;
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
   * `max(1, columns - sidebarWidth - dockWidth)`. Always mount `sidebar`
   * (even at width 0) so nhu auto-open + keybinding hooks stay alive.
   */
  sidebar?: ReactNode;
  sidebarWidth?: number;
  /**
   * densable U8e `dock` / `dockWidth` — gold iZ PaneDock sibling column
   * (right of scroll+sidebar). Width 0 hides the column. Not the Tyn
   * `sidebar` slot (ReplDiffSidebar lives there).
   */
  dock?: ReactNode;
  dockWidth?: number;
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
  abovePrompt,
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
  dock,
  dockWidth = 0,
}: Props): React.ReactNode {
  const { rows: terminalRows, columns } = useTerminalSize();
  // densable tot `Zot()||XMn()` — only history-search / elicitation take rows-2.
  const expandBottomChrome = useAppState(s => {
    for (const id of s.activeOverlays) {
      if (id === HISTORY_SEARCH_OVERLAY || ELICITATION_OVERLAYS.has(id)) {
        return true;
      }
    }
    return false;
  });
  const bottomMaxHeight = expandBottomChrome
    ? Math.max(1, terminalRows - FULLSCREEN_BOTTOM_CHROME_ROWS)
    : Math.max(1, Math.floor(terminalRows / 2));
  const abovePromptRef = useRef<DOMElement | null>(null);
  const aboveInnerRef = useRef<DOMElement | null>(null);
  const promptInnerRef = useRef<DOMElement | null>(null);
  const leftoverModalBoxRef = useRef<DOMElement | null>(null);
  const leftoverModalHost = useMemo(
    (): LeftoverModalHost => ({
      box: leftoverModalBoxRef,
      rows: terminalRows - MODAL_TRANSCRIPT_PEEK - 1,
    }),
    [terminalRows],
  );
  const abovePromptHeight = useYogaHeight(abovePromptRef);
  // densable `gt=Math.max(0,Ne-pt)` — always, even when T is undefined.
  // Gold always mounts `$e` (abovePrompt wrapper); pt is that box's yoga height.
  const promptMaxHeight = Math.max(0, bottomMaxHeight - abovePromptHeight);
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
  // densable tot `yR` / `wt` — leftover chrome claims for Pe = Ye.reduce(SR).
  const [leftoverClaims, setLeftoverClaims] = useState<LeftoverChromeClaim[]>([]);
  const subscribeLeftoverChrome = useCallback((claim: LeftoverChromeClaim) => {
    setLeftoverClaims(prev => [...prev, claim]);
    return () => setLeftoverClaims(prev => prev.filter(row => row !== claim));
  }, []);
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
    const mainColumns = Math.max(1, columns - sidebarWidth - dockWidth);
    const dockVisible = dock != null && dockWidth > 0;
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
    // densable tot `Ye` / leftover `Pe` — `_Ee` budgets from this, not a
    // second `floor(rows/2)`. Modal or missing prompt inner → null
    // (gold `Fe||We==null`).
    // densable tot `Ye` — leftover without chrome claims.
    // tot We wraps `f5({value:Ye})` so Lo `ke(f5)` sizes the list.
    const leftoverYe = (): number | null => {
      if (modalVisible) return null;
      const promptInner = promptInnerRef.current;
      if (promptInner == null) return null;
      const promptH = promptInner.yogaNode?.getComputedHeight() ?? 0;
      const aboveH = aboveInnerRef.current?.yogaNode?.getComputedHeight() ?? 0;
      return bottomMaxHeight - promptH - aboveH;
    };
    // densable tot `Pe` — `Ye===null?null:ut.reduce(SR,Ye)`.
    const leftoverOf = (): number | null => {
      const ye = leftoverYe();
      if (ye === null) return null;
      return leftoverClaims.reduce(leftoverChromeReduce, ye);
    };

    return (
      <PromptOverlayProvider>
        <Box flexDirection="column" flexGrow={1} overflow="hidden" width="100%">
          {/* $xc — scroll + sidebar row */}
          <Box flexDirection="row" flexGrow={1} overflow="hidden" width="100%">
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
              <Box flexDirection="row" flexGrow={1} overflow="hidden" width="100%" alignItems="stretch">
                {/* densable tot `jg`/`Me` — left column sees columns=mainColumns
                    so Ec Jump-to-bottom centers in the transcript, not the
                    full terminal (sidebar is a sibling outside this context). */}
                <TerminalSizeContext value={{ columns: mainColumns, rows: terminalRows }}>
                  <Box flexDirection="column" flexGrow={1} width={mainColumns} overflow="hidden">
                    {headerPrompt != null && (
                      <StickyPromptHeader text={headerPrompt.text} onClick={headerPrompt.scrollTo} />
                    )}
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
                </TerminalSizeContext>
                {sidebar != null &&
                  (sidebarWidth > 0 ? (
                    <TerminalSizeContext value={{ columns: Math.max(1, sidebarWidth), rows: terminalRows }}>
                      <Box
                        flexDirection="column"
                        width={sidebarWidth}
                        height="100%"
                        alignSelf="stretch"
                        flexShrink={0}
                        overflow="hidden"
                        backgroundColor="composerSidebarBackground"
                      >
                        {sidebar}
                      </Box>
                    </TerminalSizeContext>
                  ) : (
                    sidebar
                  ))}
              </Box>
              <Box
                ref={abovePromptRef}
                flexDirection="column"
                flexShrink={0}
                width="100%"
                maxHeight={bottomMaxHeight}
                overflowY="hidden"
                display={modalVisible ? 'none' : 'flex'}
              >
                <Box ref={aboveInnerRef} flexDirection="column" flexShrink={0} width="100%">
                  <AbovePromptLeftoverContext value={leftoverOf}>{abovePrompt}</AbovePromptLeftoverContext>
                </Box>
              </Box>
            </Box>
            {dock != null && (
              <Box
                flexDirection="column"
                width={dockWidth}
                flexShrink={0}
                overflow="hidden"
                display={dockVisible ? 'flex' : 'none'}
              >
                {dock}
              </Box>
            )}
          </Box>
          {/* Uxc — prompt chrome (hidden while ozs visible). maxHeight is Ne minus measured abovePrompt. */}
          <PromptChromeBudgetContext value={promptMaxHeight}>
            <Box
              flexDirection="column"
              flexShrink={0}
              width="100%"
              maxHeight={promptMaxHeight}
              display={modalVisible ? 'none' : 'flex'}
            >
              <SuggestionsOverlay />
              <DialogOverlay />
              <Box
                ref={promptInnerRef}
                flexDirection="column"
                width="100%"
                flexGrow={1}
                flexShrink={0}
                overflowY="hidden"
              >
                <AbovePromptLeftoverContext value={leftoverYe}>
                  <LeftoverChromeSubscribeContext value={subscribeLeftoverChrome}>
                    {bottom}
                  </LeftoverChromeSubscribeContext>
                </AbovePromptLeftoverContext>
              </Box>
            </Box>
          </PromptChromeBudgetContext>
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
              <LeftoverModalHostContext value={leftoverModalHost}>
                <Box
                  ref={leftoverModalBoxRef}
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
              </LeftoverModalHostContext>
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
          <LeftoverModalHostContext value={leftoverModalHost}>
            <Box ref={leftoverModalBoxRef} flexDirection="column" paddingX={2}>
              {modal.content}
            </Box>
          </LeftoverModalHostContext>
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

// densable Ec / Bta — absolute overlay at bottom of the transcript column.
// Gold: left=0 right=0 justifyContent=center. Tyn wraps this column in
// TerminalSizeContext {columns: mainColumns}, so "center" is the left pane
// (not the full terminal once /diff is open). Shows "Jump to bottom" when
// count is 0 (scrolled away but no new messages yet).
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
  const bg = hover ? 'userMessageBackgroundHover' : 'userMessageBackground';
  // Official Bta densable: wLi() then onClick — pill clicks only, not
  // scroll:bottom keybindings.
  const handleClick = () => {
    recordJumpToBottomClick();
    onClick?.();
  };
  return (
    <Box position="absolute" bottom={0} left={0} right={0} justifyContent="center">
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
