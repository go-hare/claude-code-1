/**
 * Gold nn + nn.Item: one ListItem per row, keyboard on the list itself.
 * Not Select's options array.
 * Gold nn visibleCount===void 0 → Lo. Window is leftoverListVisibleCountIdle
 * from host rows, measured chrome Q, and reserve — not a hardcoded 0.
 */
import React, {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AccessibilityContext,
  Box,
  ListItem,
  type ClickEvent,
  type DOMElement,
  type KeyboardEvent,
  type WheelEvent,
  useApp,
  useTerminalSize,
} from '@anthropic/ink';
import figures from 'figures';
import { FePress, LeftoverScrollbar } from './CustomSelect/select.js';
import { useOptionalKeybindingContext } from '../keybindings/KeybindingContext.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import {
  KVeReserveContext,
  LeftoverModalHostContext,
  leftoverChildRows,
  leftoverChromeQ,
  leftoverListVisibleCountIdle,
  leftoverOverflowHint,
} from './FullscreenLayout.js';

type Item<T> = {
  label: ReactNode;
  value: T;
  description?: string;
  /** densable `Oo` — row height. Missing is 1. Not "description means 2". */
  lines?: number;
  icon?: ReactNode;
  facts?: readonly string[];
};

type Props<T> = {
  options: Item<T>[];
  /** Gold nn. Omit → Lo window. Help Commands passes a number and keeps it. */
  visibleOptionCount?: number;
  /** Gold nn defaultFocusIndex. Not autoFocus. */
  defaultFocusIndex?: number;
  isDisabled?: boolean;
  onSelect?: (index: number) => void;
  onCancel?: () => void;
  onFocus?: (index: number) => void;
  /** densable bn edge. Called before the cursor stays put. */
  onUpFromFirst?: () => void;
  onDownFromLast?: () => void;
};

export function ItemList<T>({
  options,
  visibleOptionCount,
  defaultFocusIndex = 0,
  isDisabled = false,
  onSelect,
  onCancel,
  onFocus,
  onUpFromFirst,
  onDownFromLast,
}: Props<T>): React.ReactNode {
  const host = useContext(LeftoverModalHostContext);
  const screenReader = useContext(AccessibilityContext);
  const kve = useContext(KVeReserveContext);
  const kveRef = useRef(kve);
  kveRef.current = kve;
  const { rows: terminalRows } = useTerminalSize();
  const listRef = useRef<DOMElement | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const { subscribeLayout } = useApp();
  const readChrome = useCallback(() => {
    const current = hostRef.current;
    const reserveBox = kveRef.current?.box.current ?? current?.box.current ?? null;
    return leftoverChromeQ(listRef.current, reserveBox, current == null && kveRef.current == null) ?? 0;
  }, []);
  const measuredChromeQ = useSyncExternalStore(subscribeLayout, readChrome, () => 0);
  const idleWindow = leftoverListVisibleCountIdle(
    kve?.rows ?? host?.rows ?? terminalRows,
    measuredChromeQ,
    kve?.reserve ?? host?.reserve,
  );
  const windowCount = visibleOptionCount ?? idleWindow;
  const heightOf = (index: number): number => leftoverChildRows(options[index]?.lines);
  const lineOf = (index: number): number => {
    let line = 0;
    for (let i = 0; i < index && i < options.length; i++) line += heightOf(i);
    return line;
  };
  const lineCount = options.reduce((sum, _option, index) => sum + heightOf(index), 0);
  const last = Math.max(0, options.length - 1);
  const indexAt = (line: number): number => {
    let used = 0;
    for (let i = 0; i < options.length; i++) {
      const height = heightOf(i);
      if (line < used + height) return i;
      used += height;
    }
    return last;
  };
  const indexFrom = (line: number): number => {
    let used = 0;
    for (let i = 0; i < options.length; i++) {
      if (used >= line) return i;
      used += heightOf(i);
    }
    return last;
  };
  const counted = lineCount;
  const hint = leftoverOverflowHint(windowCount, undefined);
  const snapDown = (line: number): number => lineOf(indexAt(line));
  const [cursor, setCursor] = useState(() => Math.min(defaultFocusIndex, last));
  const cursorValue = options[cursor]?.value;
  useEffect(() => {
    const found = options.findIndex(option => option.value === cursorValue);
    if (found >= 0 && found !== cursor) setCursor(found);
  }, [options, cursor, cursorValue]);
  const [from, setFrom] = useState(0);
  const fromRef = useRef(from);
  fromRef.current = from;
  const markerAt = (origin: number): number => {
    if (hint !== undefined) return 0;
    const end = Math.min(counted, origin + windowCount);
    return (origin > 0 ? 1 : 0) + (end < counted ? 1 : 0);
  };
  const contentRoom = (origin: number): number => Math.max(1, windowCount - markerAt(origin));
  const clampOrigin = (origin: number): number => {
    let next = Math.max(0, origin);
    for (let pass = 0; pass < 4; pass++) {
      const limit = Math.max(0, counted - contentRoom(next));
      const clamped = Math.max(0, Math.min(limit, next));
      if (clamped === next) return next;
      next = clamped;
    }
    return next;
  };
  const origin = snapDown(from);
  const visible = contentRoom(origin);
  const startIndex = indexFrom(origin);
  const shown = (() => {
    const rows: typeof options = [];
    let used = 0;
    for (const option of options.slice(startIndex)) {
      const height = leftoverChildRows(option.lines);
      if (rows.length > 0 && used + height > visible) break;
      rows.push(option);
      used += height;
    }
    return rows;
  })();
  const shownLines = shown.reduce((sum, option) => sum + leftoverChildRows(option.lines), 0);
  const fits = windowCount >= counted;
  const spare = fits ? 0 : Math.max(0, visible - shownLines);
  const move = (next: number): void => {
    const clamped = Math.max(0, Math.min(last, next));
    setCursor(clamped);
    setFrom(start => {
      const cursorLine = lineOf(clamped);
      const cursorEnd = cursorLine + heightOf(clamped);
      let origin = start;
      for (let pass = 0; pass < 4; pass++) {
        const room = contentRoom(origin);
        let next = origin;
        if (cursorLine < next) next = cursorLine;
        if (cursorEnd > next + room) next = cursorEnd - room;
        next = snapDown(clampOrigin(next));
        if (next === origin) break;
        origin = next;
      }
      return snapDown(origin);
    });
    onFocus?.(clamped);
  };
  const step = (delta: number): void => {
    if (cursor === (delta < 0 ? 0 : last)) {
      if (delta < 0) onUpFromFirst?.();
      else onDownFromLast?.();
      return;
    }
    move(cursor + delta);
  };
  const page = (delta: number): void => {
    if (fits) return;
    if (windowCount === 1) {
      step(delta);
      return;
    }
    const span = Math.max(1, shownLines);
    const target = Math.max(0, Math.min(counted - 1, lineOf(cursor) + delta * span));
    const landed = indexAt(snapDown(target));
    move(delta > 0 ? Math.max(landed, cursor + 1) : Math.min(landed, cursor - 1));
  };
  const binding = useOptionalKeybindingContext();
  const keysOn = !isDisabled && options.length > 0 && binding !== null;
  useKeybinding('select:next', () => step(1), { context: 'Select', isActive: keysOn });
  useKeybinding('select:previous', () => step(-1), { context: 'Select', isActive: keysOn });
  useKeybinding('select:pageDown', () => page(1), { context: 'Select', isActive: keysOn });
  useKeybinding('select:pageUp', () => page(-1), { context: 'Select', isActive: keysOn });
  useKeybinding('select:first', () => move(0), { context: 'Select', isActive: keysOn });
  useKeybinding('select:last', () => move(last), { context: 'Select', isActive: keysOn });
  useKeybinding('select:cancel', () => onCancel?.(), { context: 'Select', isActive: keysOn && onCancel !== undefined });
  useKeybinding('select:accept', () => onSelect?.(cursor), {
    context: 'Select',
    isActive: keysOn && onSelect !== undefined,
  });
  const onKeyDown = (event: KeyboardEvent): void => {
    if (binding !== null || isDisabled || options.length === 0 || event.key !== 'return') return;
    onSelect?.(cursor);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const placeCursor = (origin: number): void => {
    const room = contentRoom(origin);
    setCursor(current => {
      const next = Math.max(indexAt(origin), Math.min(indexAt(Math.max(origin, origin + room - 1)), current));
      if (next !== current) onFocus?.(next);
      return next;
    });
  };
  const neighbor = (line: number, dir: number): number => {
    const here = snapDown(line);
    if (dir > 0) return lineOf(Math.min(last, indexFrom(here) + 1));
    return here <= 0 ? 0 : lineOf(Math.max(0, indexFrom(here) - 1));
  };
  const scrollBy = (delta: number): void => {
    setFrom(start => {
      const base = snapDown(start);
      let next = snapDown(clampOrigin(base + delta));
      if (delta > 0 && next <= base) next = neighbor(base, 1);
      if (delta < 0 && next >= base) next = neighbor(base, -1);
      next = snapDown(clampOrigin(next));
      placeCursor(next);
      return next;
    });
  };
  const scrollToEdge = (end: boolean): void => {
    setFrom(() => {
      const next = snapDown(clampOrigin(end ? counted : 0));
      placeCursor(next);
      return next;
    });
  };
  const onWheel = (event: WheelEvent): void => {
    if (isDisabled || event.deltaY === 0) return;
    scrollBy(event.deltaY > 0 ? 1 : -1);
    event.stopImmediatePropagation();
  };
  const moreAbove = startIndex;
  const moreBelow = Math.max(0, options.length - (startIndex + shown.length));
  const glyph = hint === 'glyph';
  const countHint = hint === undefined && !fits;
  const rows = (
    <>
      {countHint && moreAbove > 0 ? (
        <Box paddingLeft={1}>
          <FePress paddingX={1} repeat onPress={isDisabled ? undefined : () => scrollToEdge(false)}>
            {`${figures.arrowUp} ${moreAbove} more`}
          </FePress>
        </Box>
      ) : null}
      {shown.map((option, offset) => {
        const index = startIndex + offset;
        return (
          <Box
            key={String(option.value)}
            flexDirection="column"
            height={leftoverChildRows(option.lines)}
            overflow="hidden"
          >
            <ListItem
              isFocused={!isDisabled && index === cursor}
              isSelected={false}
              description={option.description}
              icon={option.icon}
              meta={option.facts}
              showScrollUp={glyph && offset === 0 && moreAbove > 0}
              showScrollDown={glyph && offset === shown.length - 1 && moreBelow > 0}
              onClick={(event: ClickEvent) => {
                if (isDisabled) return;
                move(index);
                onSelect?.(index);
                event.stopImmediatePropagation();
              }}
            >
              {option.label}
            </ListItem>
          </Box>
        );
      })}
      {spare > 0 ? <Box flexShrink={0} height={spare} /> : null}
      {countHint && moreBelow > 0 ? (
        <Box paddingLeft={1}>
          <FePress paddingX={1} repeat onPress={isDisabled ? undefined : () => scrollToEdge(true)}>
            {`${figures.arrowDown} ${moreBelow} more`}
          </FePress>
        </Box>
      ) : null}
    </>
  );
  const [barHover, setBarHover] = useState(false);
  const list = (
    <Box
      ref={listRef}
      flexDirection="column"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onWheel={isDisabled || fits ? undefined : onWheel}
    >
      {rows}
    </Box>
  );
  const overflows = counted > visible;
  return (
    <Box flexDirection="row" gap={1} onMouseEnter={() => setBarHover(true)} onMouseLeave={() => setBarHover(false)}>
      {list}
      {overflows ? (
        barHover ? (
          <LeftoverScrollbar
            offset={from}
            visible={visible}
            total={counted}
            arrows={markerAt(from) > 0}
            height={markerAt(from) > 0 ? windowCount : undefined}
            screenReader={screenReader}
            onScrollBy={isDisabled ? undefined : scrollBy}
            onScrollTo={isDisabled ? undefined : origin => scrollBy(origin - fromRef.current)}
          />
        ) : (
          <Box width={1} flexShrink={0} />
        )
      ) : null}
    </Box>
  );
}
