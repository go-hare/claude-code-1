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
  getStatusIconMaxWidth,
  ListItem,
  StatusIcon,
  stringWidth,
  Text,
  type ClickEvent,
  type DOMElement,
  type KeyboardEvent,
  type WheelEvent,
  useApp,
  useHoverTracked,
  useModalOrTerminalSize,
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
  leftoverNnFit,
  leftoverNnFromOptions,
  leftoverNnLiveWidth,
  leftoverOverflowHint,
} from './FullscreenLayout.js';

function extractNodeText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractNodeText).join('');
  if (React.isValidElement<{ children?: ReactNode }>(node)) {
    return extractNodeText(node.props.children);
  }
  return '';
}

function measureItemIconWidth(icon: ReactNode): number {
  if (icon == null) return 0;
  if (React.isValidElement(icon) && icon.type === StatusIcon) {
    return getStatusIconMaxWidth();
  }
  return stringWidth(extractNodeText(icon));
}

type Item<T> = {
  label: ReactNode;
  value: T;
  description?: string;
  /** densable `Un` → `nl.Item` — explicit lines, else 2 when description is present, else 1. */
  lines?: number;
  icon?: ReactNode;
  facts?: readonly string[];
  /** Non-selectable section heading row (`nl.Heading`). */
  heading?: boolean;
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
  const hoverTracked = useHoverTracked();
  const kve = useContext(KVeReserveContext);
  const kveRef = useRef(kve);
  kveRef.current = kve;
  const terminalSize = useTerminalSize();
  const { rows: terminalRows } = terminalSize;
  const { columns: modalColumns } = useModalOrTerminalSize(terminalSize);
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
  const readListWidth = useCallback(() => listRef.current?.yogaNode?.getComputedWidth() ?? 0, []);
  const measuredListWidth = useSyncExternalStore(subscribeLayout, readListWidth, () => 0);
  const nnWidths = leftoverNnFromOptions(
    leftoverNnLiveWidth(measuredListWidth, modalColumns),
    options
      .filter(option => !option.heading)
      .map(option => ({
        iconWidth: measureItemIconWidth(option.icon),
        name: extractNodeText(option.label),
        facts: (option.facts ?? []).filter(fact => fact !== ''),
      })),
  );
  const idleWindow = leftoverListVisibleCountIdle(
    kve?.rows ?? host?.rows ?? terminalRows,
    measuredChromeQ,
    kve?.reserve ?? host?.reserve,
  );
  const windowCount = visibleOptionCount ?? idleWindow;
  const rowLines = (option: Item<T> | undefined): number =>
    leftoverChildRows(option?.lines ?? (option?.description ? 2 : 1));
  const heightOf = (index: number): number => rowLines(options[index]);
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
  const isNavigable = (index: number): boolean => Boolean(options[index] && !options[index]?.heading);
  const findNavigable = (fromIdx: number, dir: 1 | -1): number => {
    for (let i = Math.max(0, Math.min(last, fromIdx)); i >= 0 && i <= last; i += dir) {
      if (isNavigable(i)) return i;
    }
    return Math.max(0, Math.min(last, fromIdx));
  };
  const firstNavigable = findNavigable(0, 1);
  const lastNavigable = findNavigable(last, -1);
  const counted = lineCount;
  const hint = leftoverOverflowHint(windowCount, undefined);
  const snapDown = (line: number): number => lineOf(indexAt(line));
  const [cursor, setCursor] = useState(() => {
    const initial = Math.min(defaultFocusIndex, last);
    return isNavigable(initial) ? initial : findNavigable(initial, 1);
  });
  const cursorValue = options[cursor]?.value;
  useEffect(() => {
    const found = options.findIndex(option => !option.heading && option.value === cursorValue);
    if (found >= 0 && found !== cursor) setCursor(found);
    else if (!isNavigable(cursor)) {
      const fallback = findNavigable(cursor, 1);
      if (fallback !== cursor) setCursor(fallback);
    }
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
      const height = rowLines(option);
      if (rows.length > 0 && used + height > visible) break;
      rows.push(option);
      used += height;
    }
    return rows;
  })();
  const shownLines = shown.reduce((sum, option) => sum + rowLines(option), 0);
  const fits = windowCount >= counted;
  const spare = fits ? 0 : Math.max(0, visible - shownLines);
  const move = (next: number, dir: 1 | -1 = 1): void => {
    const rawClamped = Math.max(0, Math.min(last, next));
    const clamped = isNavigable(rawClamped) ? rawClamped : findNavigable(rawClamped, dir);
    setCursor(clamped);
    setFrom(start => {
      const cursorLine = clamped === firstNavigable ? 0 : lineOf(clamped);
      const cursorEnd = lineOf(clamped) + heightOf(clamped);
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
    const dir: 1 | -1 = delta < 0 ? -1 : 1;
    if (cursor === (delta < 0 ? firstNavigable : lastNavigable)) {
      if (delta < 0) onUpFromFirst?.();
      else onDownFromLast?.();
      return;
    }
    let next = cursor + delta;
    while (next >= 0 && next <= last && !isNavigable(next)) {
      next += dir;
    }
    if (next < 0 || next > last || !isNavigable(next)) {
      if (delta < 0) onUpFromFirst?.();
      else onDownFromLast?.();
      return;
    }
    move(next, dir);
  };
  const page = (delta: number): void => {
    if (fits) return;
    if (windowCount === 1) {
      step(delta);
      return;
    }
    const dir: 1 | -1 = delta > 0 ? 1 : -1;
    const span = Math.max(1, shownLines);
    const target = Math.max(0, Math.min(counted - 1, lineOf(cursor) + delta * span));
    const landed = indexAt(snapDown(target));
    move(delta > 0 ? Math.max(landed, cursor + 1) : Math.min(landed, cursor - 1), dir);
  };
  const binding = useOptionalKeybindingContext();
  const keysOn = !isDisabled && options.length > 0 && binding !== null;
  useKeybinding('select:next', () => step(1), { context: 'Select', isActive: keysOn });
  useKeybinding('select:previous', () => step(-1), { context: 'Select', isActive: keysOn });
  useKeybinding('select:pageDown', () => page(1), { context: 'Select', isActive: keysOn });
  useKeybinding('select:pageUp', () => page(-1), { context: 'Select', isActive: keysOn });
  useKeybinding('select:first', () => move(firstNavigable, 1), { context: 'Select', isActive: keysOn });
  useKeybinding('select:last', () => move(lastNavigable, -1), { context: 'Select', isActive: keysOn });
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
      const lo = indexAt(origin);
      const hi = indexAt(Math.max(origin, origin + room - 1));
      const raw = Math.max(lo, Math.min(hi, current));
      const next = isNavigable(raw) ? raw : findNavigable(raw, raw <= lo ? 1 : -1);
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
        if (option.heading) {
          return (
            <Box
              key={String(option.value)}
              flexDirection="column"
              height={rowLines(option)}
              overflow="hidden"
              paddingLeft={2}
            >
              {typeof option.label === 'string' ? <Text dimColor>{option.label}</Text> : option.label}
            </Box>
          );
        }
        const rawFacts = (option.facts ?? []).filter(fact => fact !== '');
        const fittedFacts =
          nnWidths && nnWidths.factsWidth > 0 && rawFacts.length > 0
            ? leftoverNnFit(rawFacts, nnWidths.factsWidth)
            : '';
        const metaProp = nnWidths === null ? option.facts : fittedFacts !== '' ? [fittedFacts] : undefined;
        const iconProp = option.icon ?? (nnWidths && nnWidths.iconWidth > 0 ? <Text /> : undefined);
        return (
          <Box key={String(option.value)} flexDirection="column" height={rowLines(option)} overflow="hidden">
            <ListItem
              isFocused={index === cursor}
              idle={isDisabled}
              declareCursor={!isDisabled}
              isSelected={false}
              description={option.description}
              icon={iconProp}
              iconWidth={nnWidths?.iconWidth}
              nameWidth={nnWidths?.nameWidth}
              meta={metaProp}
              metaWidth={nnWidths?.factsWidth}
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
  if (barHover && !hoverTracked) {
    setBarHover(false);
  }
  const list = (
    <Box
      ref={listRef}
      flexDirection="column"
      flexGrow={1}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onWheel={isDisabled || fits ? undefined : onWheel}
    >
      {rows}
    </Box>
  );
  const overflows = counted > visible;
  const showScrollbarTrack = hoverTracked && overflows;
  return (
    <Box flexDirection="row" gap={1} onMouseEnter={() => setBarHover(true)} onMouseLeave={() => setBarHover(false)}>
      {list}
      {showScrollbarTrack ? (
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
