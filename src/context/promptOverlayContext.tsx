/**
 * Portal for content that floats above the prompt so it escapes
 * FullscreenLayout's bottom-slot `overflowY:hidden` clip.
 *
 * The clip is load-bearing (CC-668: tall pastes squash the ScrollBox
 * without it), but floating overlays use `position:absolute
 * bottom="100%"` to float above the prompt — and Ink's clip stack
 * intersects ALL descendants, so they were clipped to ~1 row.
 *
 * Two channels:
 * - `useSetPromptOverlay` — slash-command suggestion data (structured,
 *   written by PromptInputFooter)
 * - `useSetPromptOverlayDialog` — arbitrary dialog node (e.g.
 *   AutoModeOptInDialog, written by PromptInput)
 *
 * FullscreenLayout reads both and renders them outside the clipped slot.
 *
 * Split into data/setter context pairs so writers never re-render on
 * their own writes — the setter contexts are stable.
 */
import { useApp, type DOMElement } from '@anthropic/ink';
import {
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
import type { SuggestionItem } from '../components/PromptInput/PromptInputFooterSuggestions.js';

export type PromptOverlayData = {
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  maxColumnWidth?: number;
  emptyMessage?: string;
  hoveredId?: string | null;
  onSelect?: (index: number, id: string) => void;
  onHoverChange?: (id: string | null) => void;
};

type Setter<T> = (d: T | null) => void;

type AnchorContextValue = {
  anchor: RefObject<DOMElement | null>;
  container?: RefObject<DOMElement | null>;
};

const DataContext = createContext<PromptOverlayData | null>(null);
const SetContext = createContext<Setter<PromptOverlayData> | null>(null);
const DialogContext = createContext<ReactNode>(null);
const SetDialogContext = createContext<Setter<ReactNode> | null>(null);
const AnchorContext = createContext<AnchorContextValue | null>(null);

export function PromptOverlayProvider({
  container,
  children,
}: {
  container?: RefObject<DOMElement | null>;
  children: ReactNode;
}): ReactNode {
  const [data, setData] = useState<PromptOverlayData | null>(null);
  const [dialog, setDialog] = useState<ReactNode>(null);
  const anchor = useRef<DOMElement | null>(null);
  const anchorCtx = useMemo(() => ({ anchor, container }), [container]);
  return (
    <AnchorContext.Provider value={anchorCtx}>
      <SetContext.Provider value={setData}>
        <SetDialogContext.Provider value={setDialog}>
          <DataContext.Provider value={data}>
            <DialogContext.Provider value={dialog}>{children}</DialogContext.Provider>
          </DataContext.Provider>
        </SetDialogContext.Provider>
      </SetContext.Provider>
    </AnchorContext.Provider>
  );
}

export function usePromptOverlay(): PromptOverlayData | null {
  return useContext(DataContext);
}

export function usePromptOverlayDialog(): ReactNode {
  return useContext(DialogContext);
}

export function usePromptOverlayAnchorRef(): RefObject<DOMElement | null> | undefined {
  return useContext(AnchorContext)?.anchor;
}

export function useIsPromptOverlayShowing(): boolean {
  const data = useContext(DataContext);
  const dialog = useContext(DialogContext);
  return (data !== null && (data.suggestions.length > 0 || Boolean(data.emptyMessage))) || dialog != null;
}

function relativeTopWithin(node: DOMElement, ancestor: DOMElement): number {
  let top = 0;
  let cur: DOMElement | undefined = node;
  while (cur !== undefined && cur !== ancestor) {
    top += cur.yogaNode?.getComputedTop() ?? 0;
    cur = cur.parentNode;
  }
  return cur === ancestor ? top : -1;
}

type YogaMarginHolder = {
  getComputedMargin?: (edge: number) => number;
  yoga?: { getComputedMargin?: (edge: number) => number };
};

function readComputedMarginTop(el: DOMElement): number {
  const holder = el.yogaNode as unknown as YogaMarginHolder | undefined;
  if (typeof holder?.getComputedMargin === 'function') {
    return holder.getComputedMargin(1);
  }
  if (typeof holder?.yoga?.getComputedMargin === 'function') {
    return holder.yoga.getComputedMargin(1);
  }
  const styleMargin = el.style.marginTop ?? el.style.marginY ?? el.style.margin;
  return typeof styleMargin === 'number' ? styleMargin : 0;
}

function firstTopAnchorCandidate(container: DOMElement): DOMElement | null {
  let cur: DOMElement | undefined = container;
  while (cur) {
    let nextChild: DOMElement | undefined;
    for (const child of cur.childNodes) {
      if (child.nodeName === '#text') continue;
      if (child.style.position === 'absolute' || child.style.display === 'none') continue;
      nextChild = child;
      break;
    }
    if (!nextChild?.yogaNode) return null;
    const marginTop = readComputedMarginTop(nextChild);
    if (marginTop > 0) return nextChild;
    if (nextChild.yogaNode.getComputedTop() > 0) return null;
    cur = nextChild;
  }
  return null;
}

/**
 * densable `tr()` — top margin of the prompt anchor box inside `container` (`Ve`)
 * when nothing sits above it (`relativeTop === marginTop`).
 */
export function usePromptOverlayAnchorMarginTop(): number {
  const ctx = useContext(AnchorContext);
  const { subscribeLayout } = useApp();
  const read = useCallback(() => {
    const containerEl = ctx?.container?.current;
    if (!containerEl) return 0;
    const anchorEl = ctx?.anchor.current ?? firstTopAnchorCandidate(containerEl);
    if (!anchorEl?.yogaNode) return 0;
    const top = relativeTopWithin(anchorEl, containerEl);
    if (top < 0) return 0;
    const marginTop = readComputedMarginTop(anchorEl);
    return top === marginTop ? marginTop : 0;
  }, [ctx]);
  const snapshot = useSyncExternalStore(subscribeLayout, read, read);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    if (!Object.is(read(), snapshot)) bump();
  });
  return snapshot;
}

/**
 * Register suggestion data for the floating overlay. Clears on unmount.
 * No-op outside the provider (non-fullscreen renders inline instead).
 */
export function useSetPromptOverlay(data: PromptOverlayData | null): void {
  const set = useContext(SetContext);
  useEffect(() => {
    if (!set) return;
    set(data);
  }, [set, data]);
  useEffect(() => {
    if (!set) return;
    return () => set(null);
  }, [set]);
}

/**
 * Register a dialog node to float above the prompt. Clears on unmount.
 * No-op outside the provider (non-fullscreen renders inline instead).
 */
export function useSetPromptOverlayDialog(node: ReactNode): void {
  const set = useContext(SetDialogContext);
  useEffect(() => {
    if (!set) return;
    set(node);
  }, [set, node]);
  useEffect(() => {
    if (!set) return;
    return () => set(null);
  }, [set]);
}
