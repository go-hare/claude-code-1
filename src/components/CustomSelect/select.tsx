import figures from 'figures';
import React, {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Ansi,
  Box,
  ClockContext,
  Text,
  stringWidth,
  useApp,
  useDeclaredCursor,
  useTerminalSize,
  type ClickEvent,
  type DOMElement,
  type MouseActionEvent,
  type KeyboardEvent,
  type WheelEvent,
  useHoverTracked,
  AccessibilityContext,
  useFocusReclaim,
  useOptionalKeybindingContext,
} from '@anthropic/ink';
import { useIsInsideModal, useModalOrTerminalSize } from '../../context/modalContext.js';
import {
  AbovePromptLeftoverContext,
  LeftoverModalHostContext,
  leftoverChromeLatch,
  leftoverChromeQ,
  leftoverChromeWalkParents,
  leftoverFHostHeight,
  leftoverInnerOverflowHint,
  leftoverInnerWindow,
  leftoverLatchRows,
  leftoverListVisibleCount,
  leftoverListVisibleCountIdle,
  leftoverListVisibleCountModal,
  leftoverGxtHeight,
  leftoverGxtClearHover,
  leftoverGxtPaintBar,
  leftoverGxtShowTrack,
  leftoverThumbColor,
  leftoverThumbPointerOn,
  leftoverArrowUpOn,
  leftoverArrowDownOn,
  leftoverWheelOn,
  leftoverJeDropsClick,
  leftoverJePressEnabled,
  leftoverMoreRowLines,
  leftoverOverflowHint,
  leftoverChildRows,
  leftoverHeadingOccupiesLine,
  leftoverLineCount,
  leftoverNavigableCount,
  leftoverIheWindowValue,
  leftoverBindAcceptOn,
  leftoverScreenReaderRadio,
  leftoverScrollbarHidden,
  leftoverBgOn,
  leftoverScreenReaderEatKey,
  leftoverG5DrawLabels,
  leftoverG5Index,
  leftoverG5Headings,
  leftoverG5Prompt,
  leftoverG5Dze,
  leftoverG5HaSelect,
  leftoverG5Refuse,
  leftoverG5ShowPrompt,
  leftoverG5Digit,
  leftoverG5ParseIndex,
  leftoverG5Invalid,
  leftoverG5Disabled,
  leftoverG5EmptyInput,
  leftoverG5SubmitKind,
  leftoverG5FocusTyped,
  leftoverG5PromptCursorOn,
  leftoverG5PromptColumn,
  leftoverPnFits,
  leftoverPnPin,
  leftoverPnCursorInView,
  leftoverPnSpareLines,
  leftoverPnScrollOn,
  leftoverPnBarVisible,
  leftoverWindowStartLine,
  leftoverLineToNav,
  leftoverMarkerLines,
  leftoverPnWindow,
  leftoverRowClip,
  leftoverIheHoverOn,
  leftoverIheHoverClear,
  LeftoverIheWindowContext,
  leftoverOwedRows,
  leftoverScrollbarPointer,
  leftoverScrollThumb,
  LEFTOVER_FE_CLICK_MS,
  LEFTOVER_FE_REPEAT_INITIAL_MS,
  LEFTOVER_FE_REPEAT_MS,
  leftoverXor,
  leftoverNnFacts,
  leftoverNnDtWidth,
  leftoverNnFromOptions,
  leftoverNnIconWidth,
  leftoverNnItemLines,
  leftoverNnLiveWidth,
  leftoverVmnRn,
  LeftoverNnDtContext,
  useLeftoverChromeClaim,
  type LeftoverScrollGrab,
} from '../FullscreenLayout.js';
import { count } from '../../utils/array.js';
import type { PastedContent } from '../../utils/config.js';
import type { ImageDimensions } from '../../utils/imageResizer.js';
import { SelectInputOption } from './select-input-option.js';
import { SelectOption } from './select-option.js';
import { useSelectInput } from './use-select-input.js';
import { useSelectState } from './use-select-state.js';
import { useStrayClickGuard } from './use-stray-click.js';

// Extract text content from ReactNode for width calculation
function getTextContent(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (React.isValidElement<{ children?: ReactNode }>(node)) {
    return getTextContent(node.props.children);
  }
  return '';
}

/** densable inner `kTt` — je dropsClick value context. */
const LeftoverJeDropsContext = createContext<(event: ClickEvent) => boolean>(() => false);

/** densable inner `VDe` — consume ihe identity for GXt hover. */
function LeftoverIheHoverTrack({
  hoverTracked,
  children,
}: {
  hoverTracked: boolean;
  children: (hovered: boolean, setHovered: (on: boolean) => void) => React.ReactNode;
}): React.ReactNode {
  const current = useContext(LeftoverIheWindowContext);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  if (leftoverIheHoverClear(hoveredId, current)) setHoveredId(null);
  if (leftoverGxtClearHover(hoveredId !== null, hoverTracked)) setHoveredId(null);
  const hovered = leftoverIheHoverOn(hoveredId, current);
  const setHovered = (on: boolean) => setHoveredId(on ? current : null);
  return children(hovered, setHovered);
}

/** densable inner `oo` GXt + spareLines `le` + je placement. */
const LEFTOVER_SCROLLBAR_ARROWS_MIN = 5;

function leftoverScrollbar({
  offset,
  visible,
  total,
  height,
  arrows,
  screenReader,
  onScrollTo,
  onScrollBy,
}: {
  offset: number;
  visible: number;
  total: number;
  height?: number;
  arrows: boolean;
  screenReader: boolean;
  onScrollTo?: (offset: number) => void;
  onScrollBy?: (delta: number) => void;
}): React.ReactNode {
  const grabRef = useRef<LeftoverScrollGrab | null>(null);
  const [thumbHover, setThumbHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackH = height === undefined ? visible : height;
  useEffect(() => {
    return () => {
      if (holdRef.current) clearTimeout(holdRef.current);
    };
  }, []);
  const hidden = leftoverScrollbarHidden(screenReader) || total <= visible || trackH < 1;
  if (hidden) return null;
  const showArrows = arrows && trackH >= LEFTOVER_SCROLLBAR_ARROWS_MIN;
  const innerH = showArrows ? trackH - 2 : trackH;
  const { top, size } = leftoverScrollThumb(offset, visible, total, innerH);
  const below = innerH - top - size;
  const pipe = (n: number) => (n > 0 ? Array.from({ length: n }, () => figures.lineVertical).join('\n') : '');
  const thumb = Array.from({ length: size }, () => figures.squareSmallFilled).join('\n');
  const thumbColor = leftoverThumbColor(thumbHover, dragging);
  const pointerOn = leftoverThumbPointerOn(onScrollTo !== undefined, dragging);
  const stopHold = () => {
    if (holdRef.current) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  };
  const startHold = (delta: number) => {
    onScrollBy?.(delta);
    stopHold();
    const tick = () => {
      holdRef.current = setTimeout(() => {
        onScrollBy?.(delta);
        tick();
      }, LEFTOVER_FE_REPEAT_MS);
    };
    holdRef.current = setTimeout(tick, LEFTOVER_FE_REPEAT_INITIAL_MS);
  };
  return (
    <Box flexDirection="column" flexShrink={0}>
      {showArrows && leftoverArrowUpOn(offset) ? (
        <Box
          onPointer={(event: MouseActionEvent) => {
            if (event.type === 'mousedown' && event.button === 0) startHold(-1);
            if (event.type === 'mouseup') stopHold();
          }}
          onMouseLeave={stopHold}
        >
          <Text>{figures.arrowUp}</Text>
        </Box>
      ) : null}
      <Box
        flexDirection="column"
        flexShrink={0}
        onMouseEnter={onScrollTo ? () => setThumbHover(true) : undefined}
        onMouseLeave={onScrollTo ? () => setThumbHover(false) : undefined}
        onPointer={
          pointerOn
            ? (event: MouseActionEvent) => {
                if (event.type === 'mousedown') setDragging(true);
                if (event.type === 'mouseup') setDragging(false);
                const next = leftoverScrollbarPointer(
                  event,
                  { top, size },
                  { visible, total, height: innerH, offset },
                  grabRef.current,
                );
                grabRef.current = next.grab;
                if (next.scrollTo !== undefined) onScrollTo?.(next.scrollTo);
              }
            : undefined
        }
      >
        {top > 0 ? <Text dimColor>{pipe(top)}</Text> : null}
        <Text color={thumbColor}>{thumb}</Text>
        {below > 0 ? <Text dimColor>{pipe(below)}</Text> : null}
      </Box>
      {showArrows && leftoverArrowDownOn(offset, visible, total) ? (
        <Box
          onPointer={(event: MouseActionEvent) => {
            if (event.type === 'mousedown' && event.button === 0) startHold(1);
            if (event.type === 'mouseup') stopHold();
          }}
          onMouseLeave={stopHold}
        >
          <Text>{figures.arrowDown}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function leftoverListFrame({
  hostRef,
  moreRowLines,
  scrollBar,
  gxtHeight,
  spare,
  aboveCount,
  belowCount,
  innerHint,
  onJePress,
  emptyMessage,
  optionCount,
  offset,
  visible,
  total,
  onScrollTo,
  onScrollBy,
  jeDropsRef,
  now,
  wheelOn,
  onKeyDown,
  windowStart,
  focusOn,
  screenReader,
  screenReaderRadio,
  g5Prompt,
  g5CursorActive,
  g5ShowPrompt = true,
  nnDt,
  children,
}: {
  hostRef: React.RefObject<DOMElement | null>;
  nnDt: Set<DOMElement>;
  moreRowLines: boolean;
  scrollBar: boolean;
  gxtHeight: number;
  spare: number;
  aboveCount: number;
  belowCount: number;
  innerHint: 'none' | 'glyph' | 'count' | undefined;
  onJePress?: (direction: number) => (event: ClickEvent) => void;
  emptyMessage?: React.ReactNode;
  optionCount: number;
  offset: number;
  visible: number;
  total: number;
  onScrollTo: (offset: number) => void;
  onScrollBy: (delta: number) => void;
  jeDropsRef: React.RefObject<{ at: number; row: number } | null>;
  now: () => number;
  wheelOn: boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
  windowStart: number;
  focusOn: boolean;
  screenReader: boolean;
  screenReaderRadio: boolean;
  g5Prompt?: string;
  g5CursorActive?: boolean;
  g5ShowPrompt?: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  const hoverTracked = useHoverTracked();
  useFocusReclaim(hostRef, focusOn);
  const g5CursorRef = useDeclaredCursor({
    line: 0,
    column: leftoverG5PromptColumn(g5Prompt ?? ''),
    active: Boolean(screenReaderRadio && g5Prompt && g5CursorActive),
  });
  const dropsClick = (event: ClickEvent) => leftoverJeDropsClick(jeDropsRef.current, event.row, now());
  const leftoverIheValue = leftoverIheWindowValue(
    windowStart,
    React.Children.toArray(children)
      .map(child => (React.isValidElement(child) ? String(child.key ?? '') : ''))
      .join(),
  );
  const wrap = (node: React.ReactNode) => (
    <LeftoverIheWindowContext value={leftoverIheValue}>
      <LeftoverNnDtContext value={nnDt}>
        <LeftoverJeDropsContext value={dropsClick}>
          <Box
            ref={hostRef}
            flexDirection="column"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onWheel={
              wheelOn
                ? (event: WheelEvent) => {
                    if (event.deltaY === 0) return;
                    onScrollBy(event.deltaY > 0 ? 1 : -1);
                    event.stopImmediatePropagation();
                  }
                : undefined
            }
          >
            {node}
          </Box>
        </LeftoverJeDropsContext>
      </LeftoverNnDtContext>
    </LeftoverIheWindowContext>
  );
  if (screenReaderRadio) {
    return wrap(
      <>
        {optionCount === 0 ? emptyMessage != null ? <Text dimColor>{emptyMessage}</Text> : null : children}
        {g5ShowPrompt && g5Prompt ? (
          <Box ref={g5CursorRef}>
            <Text dimColor>{g5Prompt}</Text>
          </Box>
        ) : null}
      </>,
    );
  }
  const spareBox = spare > 0 ? <Box flexShrink={0} height={spare} /> : null;
  const above =
    innerHint === 'count' ? <LeftoverCountHint direction="above" count={aboveCount} onPress={onJePress?.(-1)} /> : null;
  const below =
    innerHint === 'count' ? <LeftoverCountHint direction="below" count={belowCount} onPress={onJePress?.(1)} /> : null;
  const body = (
    <>
      {children}
      {spareBox}
    </>
  );
  if (optionCount === 0) {
    return wrap(emptyMessage != null ? <Text dimColor>{emptyMessage}</Text> : null);
  }
  if (!scrollBar) {
    return wrap(
      <>
        {above}
        {body}
        {below}
      </>,
    );
  }
  const overflows = total > visible;
  const height = leftoverGxtHeight(moreRowLines, gxtHeight);
  const showTrack = leftoverGxtShowTrack(hoverTracked, overflows);
  const gxt = (hovered: boolean, setHovered: (on: boolean) => void) => {
    const paintBar = leftoverGxtPaintBar(hoverTracked, hovered, overflows);
    const bar = showTrack ? (
      paintBar ? (
        leftoverScrollbar({
          offset,
          visible,
          total,
          height,
          arrows: moreRowLines,
          screenReader,
          onScrollTo,
          onScrollBy,
        })
      ) : (
        <Box width={1} flexShrink={0} />
      )
    ) : null;
    return (
      <Box
        flexDirection="row"
        gap={1}
        height={height}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Box flexDirection="column" flexGrow={1}>
          {moreRowLines ? (
            <>
              {above}
              {body}
              {below}
            </>
          ) : (
            body
          )}
        </Box>
        {bar}
      </Box>
    );
  };
  if (moreRowLines) {
    return wrap(<LeftoverIheHoverTrack hoverTracked={hoverTracked}>{gxt}</LeftoverIheHoverTrack>);
  }
  return wrap(
    <LeftoverIheHoverTrack hoverTracked={hoverTracked}>
      {(hovered, setHovered) => (
        <>
          {above}
          {gxt(hovered, setHovered)}
          {below}
        </>
      )}
    </LeftoverIheHoverTrack>,
  );
}

/** densable inner `oo` `je` — `{↑|↓} N more` when overflowHint is count. */
function LeftoverCountHint({
  direction,
  count,
  onPress,
}: {
  direction: 'above' | 'below';
  count: number;
  onPress?: (event: ClickEvent) => void;
}): React.ReactNode {
  const dropsClick = useContext(LeftoverJeDropsContext);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (delayRef.current) clearTimeout(delayRef.current);
    };
  }, []);
  if (count <= 0) return null;
  const glyph = direction === 'above' ? figures.arrowUp : figures.arrowDown;
  const label = `${glyph} ${count} more`;
  return (
    <Box
      paddingLeft={1}
      onClick={(event: ClickEvent) => {
        if (dropsClick(event)) {
          event.dropAsStray();
          return;
        }
        event.stopImmediatePropagation();
        event.endClickChain();
        if (delayRef.current) return;
        delayRef.current = setTimeout(() => {
          delayRef.current = null;
          onPress?.(event);
        }, LEFTOVER_FE_CLICK_MS);
      }}
    >
      {onPress ? (
        <Box paddingX={1}>
          <Text dimColor>{label}</Text>
        </Box>
      ) : (
        <Text dimColor>{label}</Text>
      )}
    </Box>
  );
}

type BaseOption<T> = {
  description?: string;
  dimDescription?: boolean;
  label: ReactNode;
  value: T;
  disabled?: boolean;
  /** densable inner oo `Oo` / `Cn(o)?.lines`. */
  lines?: number;
  heading?: boolean;
  /** densable leftover chrome Un `icon` / `meta`. */
  icon?: ReactNode;
  meta?: Array<string | number | boolean>;
};

export type OptionWithDescription<T = string> =
  | (BaseOption<T> & {
      type?: 'text';
    })
  | (BaseOption<T> & {
      type: 'input';
      onChange: (value: string) => void;
      placeholder?: string;
      initialValue?: string;
      /**
       * Controls behavior when submitting with empty input:
       * - true: calls onChange (treats empty as valid submission)
       * - false (default): calls onCancel (treats empty as cancellation)
       *
       * Also affects initial Enter press: when true, submits immediately;
       * when false, enters input mode first so user can type.
       */
      allowEmptySubmitToCancel?: boolean;
      /**
       * When true, always shows the label alongside the input value, regardless of
       * the global inlineDescriptions/showLabel setting. Use this when the label
       * provides important context that should always be visible (e.g., "Yes, and allow...").
       */
      showLabelWithValue?: boolean;
      /**
       * Custom separator between label and value when showLabel is true.
       * Defaults to ", ". Use ": " for labels that read better with a colon.
       */
      labelValueSeparator?: string;
      /**
       * When true, automatically reset cursor to end of line when:
       * - Option becomes focused
       * - Input value changes
       * This prevents cursor position bugs when the input value updates asynchronously.
       */
      resetCursorOnUpdate?: boolean;
    });

export type SelectProps<T> = {
  /**
   * When disabled, user input is ignored.
   *
   * @default false
   */
  readonly isDisabled?: boolean;

  /**
   * When true, prevents selection on Enter but allows scrolling.
   *
   * @default false
   */
  readonly disableSelection?: boolean;

  /**
   * densable g5 `refuseInput` — `I?.()` aborts return / arrows / digits.
   */
  readonly refuseInput?: () => boolean;

  /**
   * densable g5 `hidePromptWhileDisabled` — `xt=!C&&!(S&&q)`.
   *
   * @default false
   */
  readonly hidePromptWhileDisabled?: boolean;

  /**
   * densable g5 `DZe` — screen-reader arrow nav (`tengu_ax_sr_arrow_nav`).
   *
   * @default false
   */
  readonly arrowNav?: boolean;

  /**
   * When true, hides the numeric indexes next to each option.
   *
   * @default false
   */
  readonly hideIndexes?: boolean;

  /**
   * Number of visible options.
   *
   * @default 5
   */
  readonly visibleOptionCount?: number;

  /**
   * densable Lo `o.overflowHint` — passed into leftover overflowHint G.
   */
  readonly overflowHint?: 'none' | 'glyph' | 'count';

  /**
   * densable inner oo `scrollBar` — default ON (`W=!0`).
   */
  readonly scrollBar?: boolean;

  /**
   * densable inner oo `onDisabledRowClick`.
   */
  readonly onDisabledRowClick?: (index: number) => void;

  /**
   * densable inner oo `emptyMessage`.
   */
  readonly emptyMessage?: ReactNode;

  /**
   * Highlight text in option labels.
   */
  readonly highlightText?: string;

  /**
   * Options.
   */
  readonly options: OptionWithDescription<T>[];

  /**
   * Default value.
   */
  readonly defaultValue?: T;

  /**
   * Callback when cancel is pressed.
   */
  readonly onCancel?: () => void;

  /**
   * Callback when selected option changes.
   */
  readonly onChange?: (value: T) => void;

  /**
   * Callback when focused option changes.
   * Note: This is for one-way notification only. Avoid combining with focusValue
   * for bidirectional sync, as this can cause feedback loops.
   */
  readonly onFocus?: (value: T) => void;

  /**
   * Initial value to focus. This is used to set focus when the component mounts.
   */
  readonly defaultFocusValue?: T;

  /**
   * Layout of the options.
   * - `compact` (default) tries to use one line per option
   * - `expanded` uses multiple lines and an empty line between options
   * - `compact-vertical` uses compact index formatting with descriptions below labels
   */
  readonly layout?: 'compact' | 'expanded' | 'compact-vertical';

  /**
   * When true, descriptions are rendered inline after the label instead of
   * in a separate column. Use this for short descriptions like hints.
   *
   * @default false
   */
  readonly inlineDescriptions?: boolean;

  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  readonly onUpFromFirstItem?: () => void;

  /**
   * Callback when user presses down from the last item.
   * If provided, navigation will not wrap to the first item.
   */
  readonly onDownFromLastItem?: () => void;

  /**
   * Callback when input mode should be toggled for an option.
   * Called when Tab is pressed (to enter or exit input mode).
   */
  readonly onInputModeToggle?: (value: T) => void;

  /**
   * Callback to open external editor for editing input option values.
   * When provided, ctrl+g will trigger this callback in input options
   * with the current value and a setter function to update the internal state.
   */
  readonly onOpenEditor?: (currentValue: string, setValue: (value: string) => void) => void;

  /**
   * Optional callback when an image is pasted into an input option.
   */
  readonly onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void;

  /**
   * Pasted content to display inline in input options.
   */
  readonly pastedContents?: Record<number, PastedContent>;

  /**
   * Callback to remove a pasted image by its ID.
   */
  readonly onRemoveImage?: (id: number) => void;

  /**
   * densable inner oo `onRowKeyDown`.
   */
  readonly onRowKeyDown?: (event: KeyboardEvent, focusedIndex: number) => void;
};

export function Select<T>({
  isDisabled = false,
  hideIndexes = false,
  visibleOptionCount = 5,
  overflowHint: overflowHintProp,
  scrollBar = true,
  onDisabledRowClick,
  emptyMessage,
  highlightText,
  options,
  defaultValue,
  onCancel,
  onChange,
  onFocus,
  defaultFocusValue,
  layout = 'compact',
  disableSelection = false,
  refuseInput,
  hidePromptWhileDisabled = false,
  arrowNav = false,
  inlineDescriptions = false,
  onUpFromFirstItem,
  onDownFromLastItem,
  onInputModeToggle,
  onOpenEditor,
  onImagePaste,
  pastedContents,
  onRemoveImage,
  onRowKeyDown,
}: SelectProps<T>): React.ReactNode {
  // Image selection mode state
  const [imagesSelected, setImagesSelected] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  // State for input type options
  const [inputValues, setInputValues] = useState<Map<T, string>>(() => {
    const initialMap = new Map<T, string>();
    options.forEach(option => {
      if (option.type === 'input' && option.initialValue) {
        initialMap.set(option.value, option.initialValue);
      }
    });
    return initialMap;
  });

  // Track the last initialValue we synced, so we can detect user edits
  const lastInitialValues = useRef<Map<T, string>>(new Map());

  // Sync initialValue changes to inputValues state, but only if user hasn't edited
  useEffect(() => {
    for (const option of options) {
      if (option.type === 'input' && option.initialValue !== undefined) {
        const lastInitial = lastInitialValues.current.get(option.value) ?? '';
        const currentValue = inputValues.get(option.value) ?? '';
        const newInitial = option.initialValue;

        // Only update if:
        // 1. The initialValue has changed
        // 2. The user hasn't edited (current value still matches the last initialValue we set)
        if (newInitial !== lastInitial && currentValue === lastInitial) {
          setInputValues(prev => {
            const next = new Map(prev);
            next.set(option.value, newInitial);
            return next;
          });
        }

        // Always track the latest initialValue
        lastInitialValues.current.set(option.value, newInitial);
      }
    }
  }, [options, inputValues]);

  // densable leftover chrome Lo @203458487: T/S `$l`, latch U/Q, leftover
  // `H=max(1,q-Q)`, idle `hn=7` + floor(rows/2), overflowHint G, shell
  // `visibleCount:H` (this Select is Lo+oo welded).
  const leftoverHostRef = useRef<DOMElement | null>(null);
  const leftoverNnDt = useRef(new Set<DOMElement>()).current;
  const leftoverGet = useContext(AbovePromptLeftoverContext);
  const leftoverModal = useContext(LeftoverModalHostContext);
  const inModal = useIsInsideModal();
  const inLeftoverXorClaim = leftoverXor(leftoverGet !== null, inModal);
  useLeftoverChromeClaim(
    leftoverHostRef,
    leftoverOwedRows(
      options.length,
      options.map(option => option.lines ?? leftoverNnItemLines(option.description)),
      options.map(option => option.heading === true),
      emptyMessage,
    ),
    inLeftoverXorClaim,
  );
  const { subscribeLayout } = useApp();
  const terminalSize = useTerminalSize();
  const { rows: sizeRows } = useModalOrTerminalSize(terminalSize);
  const leftoverLayoutTick = useSyncExternalStore(
    subscribeLayout,
    () => {
      const n = leftoverHostRef.current;
      return `${n?.yogaNode?.getComputedHeight() ?? 0}|${n?.yogaNode?.getComputedWidth() ?? 0}|${sizeRows}`;
    },
    () => '',
  );
  void leftoverLayoutTick;
  const leftoverList = leftoverHostRef.current;
  const leftoverModalBox = leftoverModal?.box.current ?? null;
  const leftoverXorOn = leftoverXor(leftoverGet !== null, inModal);
  const leftoverHostH = leftoverFHostHeight(leftoverModalBox, leftoverList);
  const leftoverWidth = leftoverList?.yogaNode?.getComputedWidth() ?? 0;
  const leftoverChromeS = leftoverChromeQ(
    leftoverList,
    leftoverModalBox,
    leftoverChromeWalkParents(leftoverModal != null, leftoverXorOn),
  );
  const leftoverLatchRowsNow = leftoverLatchRows(inModal, leftoverModal?.rows, sizeRows, terminalSize.rows);
  const [chromeLatch, setChromeLatch] = useState<{
    rows: number;
    width: number;
    chrome: number;
  } | null>(null);
  const leftoverLatchNow = leftoverChromeLatch(chromeLatch, leftoverLatchRowsNow, leftoverWidth, leftoverChromeS);
  if (leftoverLatchNow.latch !== chromeLatch) setChromeLatch(leftoverLatchNow.latch);
  const leftoverVisible = leftoverXorOn
    ? leftoverListVisibleCount(leftoverGet?.() ?? null, leftoverHostH, leftoverLatchNow.q)
    : inModal
      ? leftoverListVisibleCountModal(leftoverLatchRowsNow, leftoverLatchNow.q)
      : leftoverListVisibleCountIdle(leftoverLatchRowsNow, leftoverLatchNow.q, leftoverModal?.reserve);
  const leftoverAwareVisible = leftoverVisible;
  const overflowHint = leftoverOverflowHint(leftoverAwareVisible, overflowHintProp);
  const leftoverWindow = leftoverInnerWindow(overflowHint, leftoverAwareVisible, options.length);
  const innerHint = leftoverInnerOverflowHint(overflowHint, leftoverAwareVisible);
  const moreRowLines = leftoverMoreRowLines(overflowHint, leftoverAwareVisible, options.length);

  const state = useSelectState({
    visibleOptionCount: leftoverWindow,
    moreRowLines,
    options,
    defaultValue,
    onChange,
    onCancel,
    onFocus,
    focusValue: defaultFocusValue,
  });

  // densable yln + Dql: disableSelection===true hides onClick; 'numeric' stays clickable.
  const isStrayClick = useStrayClickGuard();
  const clock = useContext(ClockContext);
  const jePressedRef = useRef<{ at: number; row: number } | null>(null);
  const leftoverJePress = leftoverJePressEnabled(isDisabled, onDisabledRowClick)
    ? (direction: number) => (event: ClickEvent) => {
        if (isStrayClick(event)) return;
        jePressedRef.current = { at: clock?.now() ?? Date.now(), row: event.row };
        state.scrollToEdge(direction, isDisabled);
        if (isDisabled) onDisabledRowClick?.(state.focusedIndex);
      }
    : undefined;
  const leftoverPnRows = leftoverPnWindow(leftoverWindow, leftoverMarkerLines(moreRowLines));
  const leftoverFits = leftoverPnFits(leftoverLineCount(options), leftoverPnRows);
  const leftoverShown = state.visibleOptions.reduce(
    (acc, option) => acc + (leftoverHeadingOccupiesLine(option.heading) ? 1 : leftoverChildRows(option.lines)),
    0,
  );
  const leftoverSpare = leftoverPnSpareLines(leftoverFits, leftoverPnRows, leftoverShown);
  const leftoverLineStart = leftoverWindowStartLine(options, state.visibleFromIndex);
  const leftoverBarVisible = leftoverPnBarVisible(leftoverLineStart, leftoverLineStart + leftoverPnRows, leftoverSpare);
  const leftoverScrollOn = leftoverPnScrollOn(leftoverFits);
  const leftoverWheel = leftoverWheelOn(isDisabled, leftoverFits);
  const leftoverNn = leftoverNnFromOptions(
    leftoverNnLiveWidth(
      leftoverHostRef.current?.yogaNode?.getComputedWidth() ?? 0,
      leftoverWidth || terminalSize.columns,
      leftoverNnDtWidth(leftoverNnDt),
    ),
    options.map(option => ({
      iconWidth: leftoverNnIconWidth(option.icon),
      name: getTextContent(option.label),
      facts: leftoverNnFacts(option.meta),
    })),
  );
  const leftoverScreenReader = useContext(AccessibilityContext);
  const leftoverHasKeybinding = useOptionalKeybindingContext() !== null;
  const leftoverSrRadio = leftoverScreenReaderRadio(leftoverScreenReader, onChange !== undefined);
  const leftoverFocusOn = leftoverBgOn(!isDisabled, leftoverSrRadio);
  const leftoverG5Nav = leftoverNavigableCount(options);
  const [leftoverG5Typed, setLeftoverG5Typed] = useState('');
  const [leftoverG5Error, setLeftoverG5Error] = useState<string | null>(null);
  const [leftoverG5ArrowNav, setLeftoverG5ArrowNav] = useState(false);
  const leftoverG5CursorActive = leftoverG5PromptCursorOn(isDisabled, disableSelection === true, leftoverG5ArrowNav);
  const leftoverPin = () => {
    const typed = leftoverG5FocusTyped(options, state.focusedValue);
    if (typed === null) return;
    const nav = leftoverG5ParseIndex(typed, leftoverG5Nav);
    if (nav === null) return;
    const from = leftoverPnPin(
      state.visibleFromIndex,
      leftoverPnCursorInView(nav, state.visibleFromIndex, state.visibleToIndex),
      nav,
    );
    if (from !== state.visibleFromIndex) state.scrollTo(from);
  };
  const leftoverDrawLabels = leftoverG5DrawLabels(leftoverSrRadio);
  const leftoverG5Map = leftoverG5Headings(
    options.map(option => ({ heading: option.heading, label: getTextContent(option.label) })),
  );
  const leftoverArrowNav = leftoverG5Dze(arrowNav);
  const leftoverShowPrompt = leftoverG5ShowPrompt(disableSelection === true, isDisabled, hidePromptWhileDisabled);
  const leftoverG5Text = leftoverSrRadio
    ? `${leftoverG5Prompt(leftoverG5Nav, onCancel !== undefined, leftoverArrowNav)}${leftoverG5Typed ? `: ${leftoverG5Typed}` : ''}${leftoverG5Error ? `\n${leftoverG5Error}` : ''}`
    : undefined;
  const leftoverClip = (option: OptionWithDescription<T>, node: React.ReactNode) => {
    const height = leftoverRowClip(option.heading, option.lines, leftoverWindow);
    if (height === undefined) return node;
    return (
      <Box key={String(option.value)} height={height} overflow="hidden">
        {node}
      </Box>
    );
  };
  const leftoverG5Children = leftoverSrRadio
    ? (() => {
        const rows: React.ReactNode[] = [];
        let nav = 0;
        for (const option of options) {
          if (option.heading === true) continue;
          const attached = leftoverG5Map.get(nav);
          if (attached) {
            for (const heading of attached) {
              rows.push(
                <Text key={`leftover-g5-h-${nav}-${heading}`} dimColor>
                  {heading}
                </Text>,
              );
            }
          }
          rows.push(
            <Text key={String(option.value)}>
              {leftoverVmnRn(
                leftoverG5Index(nav),
                getTextContent(option.label),
                option.description,
                false,
                option.disabled === true,
                leftoverDrawLabels,
              )}
            </Text>,
          );
          nav++;
        }
        const trailing = leftoverG5Map.get(nav);
        if (trailing) {
          for (const heading of trailing) {
            rows.push(
              <Text key={`leftover-g5-t-${heading}`} dimColor>
                {heading}
              </Text>,
            );
          }
        }
        return rows;
      })()
    : null;
  const leftoverG5Commit = (typed: string) => {
    if (disableSelection) return;
    leftoverPin();
    const items = options.filter(option => option.heading !== true);
    const focused = items.find(option => option.type === 'input' && option.value === state.focusedValue);
    if (focused?.type === 'input') {
      if (typed === '') {
        setLeftoverG5Error(leftoverG5EmptyInput());
        return;
      }
      onChange?.(focused.value);
      setLeftoverG5Typed('');
      setLeftoverG5Error(null);
      return;
    }
    const idx = leftoverG5ParseIndex(typed, leftoverG5Nav);
    if (idx === null) {
      setLeftoverG5Error(leftoverG5Invalid(typed, leftoverG5Nav));
      return;
    }
    const option = items[idx];
    if (option?.disabled === true) {
      setLeftoverG5Error(leftoverG5Disabled(idx + 1));
      return;
    }
    if (option?.type === 'input') {
      state.focusOption(option.value);
      setLeftoverG5Typed(option.initialValue ?? '');
      setLeftoverG5Error(null);
      return;
    }
    if (option !== undefined) {
      state.focusOption(option.value);
      onChange?.(option.value);
      setLeftoverG5Typed('');
      setLeftoverG5Error(null);
    }
  };
  const leftoverBindKeyDown = (event: KeyboardEvent) => {
    if (isDisabled) return;
    if (leftoverSrRadio) {
      if (event.ctrl || event.meta) return;
      if (event.key === 'escape') {
        event.preventDefault();
        onCancel?.();
        return;
      }
      if (event.key === 'return') {
        event.preventDefault();
        if (leftoverG5Refuse(refuseInput)) return;
        const kind = leftoverG5SubmitKind(leftoverG5Typed, leftoverG5ArrowNav);
        if (kind === 'typed') leftoverG5Commit(leftoverG5Typed);
        else if (kind === 'focus') {
          const typed = leftoverG5FocusTyped(options, state.focusedValue);
          if (typed !== null) leftoverG5Commit(typed);
        }
        return;
      }
      if (event.key === 'backspace' || event.key === 'delete') {
        event.preventDefault();
        setLeftoverG5Typed(prev => prev.slice(0, -1));
        setLeftoverG5Error(null);
        return;
      }
      if (leftoverArrowNav && (event.name === 'up' || event.name === 'down')) {
        event.preventDefault();
        if (leftoverG5Refuse(refuseInput)) return;
        setLeftoverG5Error(null);
        setLeftoverG5Typed('');
        setLeftoverG5ArrowNav(true);
        leftoverPin();
        if (event.name === 'up') state.focusPreviousOption();
        else state.focusNextOption();
        return;
      }
      if (leftoverG5Digit(event.key)) {
        event.preventDefault();
        if (leftoverG5Refuse(refuseInput)) return;
        setLeftoverG5Error(null);
        setLeftoverG5Typed(prev => prev + event.key);
        return;
      }
      if (leftoverScreenReaderEatKey(event.key)) event.stopPropagation();
      return;
    }
    if (event.key === 'return' && leftoverBindAcceptOn(!disableSelection, leftoverHasKeybinding)) {
      state.selectFocusedOption();
      const focused = state.getFocusedValue();
      if (focused !== undefined) state.onChange?.(focused);
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    onRowKeyDown?.(event, Math.max(0, state.focusedIndex - 1));
  };
  const optionOnClick = (option: OptionWithDescription<T>) => {
    if (isDisabled || disableSelection === true || option.disabled === true) {
      return undefined;
    }
    return (event: ClickEvent) => {
      if (isStrayClick(event)) {
        return;
      }
      if (leftoverJeDropsClick(jePressedRef.current, event.row, clock?.now() ?? Date.now())) {
        event.dropAsStray();
        return;
      }
      if (option.type === 'input') {
        state.focusOption(option.value);
      } else {
        state.onChange?.(option.value);
      }
    };
  };

  useSelectInput({
    isDisabled,
    disableSelection: disableSelection || (hideIndexes ? 'numeric' : false),
    state,
    options,
    isMultiSelect: false, // Select is always single-choice
    onUpFromFirstItem,
    onDownFromLastItem,
    onInputModeToggle,
    inputValues,
    imagesSelected,
    onEnterImageSelection: () => {
      if (pastedContents && Object.values(pastedContents).some(c => c.type === 'image')) {
        const imageCount = count(Object.values(pastedContents), c => c.type === 'image');
        setImagesSelected(true);
        setSelectedImageIndex(imageCount - 1);
        return true;
      }
      return false;
    },
  });

  const styles = {
    container: () => ({ flexDirection: 'column' as const }),
    highlightedText: () => ({ bold: true }),
  };

  if (layout === 'expanded') {
    const maxIndexWidth = state.options.length.toString().length;

    return leftoverListFrame({
      hostRef: leftoverHostRef,
      moreRowLines,
      scrollBar,
      gxtHeight: leftoverAwareVisible,
      spare: leftoverSpare,
      aboveCount: state.visibleFromIndex,
      belowCount: Math.max(0, options.length - state.visibleToIndex),
      innerHint,
      onJePress: leftoverJePress,
      emptyMessage,
      optionCount: options.length,
      offset: leftoverLineStart,
      visible: leftoverBarVisible,
      total: leftoverLineCount(options),
      onScrollTo: leftoverScrollOn
        ? (offset: number) => {
            state.scrollTo(leftoverLineToNav(options, offset));
          }
        : () => undefined,
      onScrollBy: state.scrollBy,
      jeDropsRef: jePressedRef,
      now: () => clock?.now() ?? Date.now(),
      wheelOn: leftoverWheel,
      onKeyDown: leftoverBindKeyDown,
      windowStart: state.visibleFromIndex,
      focusOn: leftoverFocusOn,
      screenReader: leftoverScreenReader,
      screenReaderRadio: leftoverSrRadio,
      g5Prompt: leftoverG5Text,
      g5CursorActive: leftoverG5CursorActive,
      g5ShowPrompt: leftoverShowPrompt,
      nnDt: leftoverNnDt,
      children: leftoverSrRadio
        ? leftoverG5Children
        : state.visibleOptions.map((option, index) => {
            const isFirstVisibleOption = option.index === state.visibleFromIndex;
            const isLastVisibleOption = option.index === state.visibleToIndex - 1;
            const areMoreOptionsBelow = state.visibleToIndex < options.length;
            const areMoreOptionsAbove = state.visibleFromIndex > 0;

            const i = state.visibleFromIndex + index + 1;

            const isFocused = !isDisabled && state.focusedValue === option.value;
            const isSelected = state.value === option.value;

            // Handle input type options
            if (option.type === 'input') {
              const inputValue = inputValues.has(option.value)
                ? inputValues.get(option.value)!
                : option.initialValue || '';

              return (
                <SelectInputOption
                  key={String(option.value)}
                  option={option}
                  isFocused={isFocused}
                  isSelected={isSelected}
                  shouldShowDownArrow={innerHint === 'glyph' && areMoreOptionsBelow && isLastVisibleOption}
                  shouldShowUpArrow={innerHint === 'glyph' && areMoreOptionsAbove && isFirstVisibleOption}
                  maxIndexWidth={maxIndexWidth}
                  index={i}
                  inputValue={inputValue}
                  onInputChange={value => {
                    setInputValues(prev => {
                      const next = new Map(prev);
                      next.set(option.value, value);
                      return next;
                    });
                  }}
                  onSubmit={(value: string) => {
                    const hasImageAttachments =
                      pastedContents && Object.values(pastedContents).some(c => c.type === 'image');
                    if (value.trim() || hasImageAttachments || option.allowEmptySubmitToCancel) {
                      onChange?.(option.value);
                    } else {
                      onCancel?.();
                    }
                  }}
                  onExit={onCancel}
                  layout="expanded"
                  showLabel={inlineDescriptions}
                  onOpenEditor={onOpenEditor}
                  resetCursorOnUpdate={option.resetCursorOnUpdate}
                  onImagePaste={onImagePaste}
                  pastedContents={pastedContents}
                  onRemoveImage={onRemoveImage}
                  imagesSelected={imagesSelected}
                  selectedImageIndex={selectedImageIndex}
                  onImagesSelectedChange={setImagesSelected}
                  onSelectedImageIndexChange={setSelectedImageIndex}
                  onClick={optionOnClick(option)}
                />
              );
            }

            // Handle text type options
            let label: ReactNode = option.label;

            // Only apply highlight when label is a string
            if (typeof option.label === 'string' && highlightText && option.label.includes(highlightText)) {
              const labelText = option.label;
              const index = labelText.indexOf(highlightText);

              label = (
                <>
                  {labelText.slice(0, index)}
                  <Text {...styles.highlightedText()}>{highlightText}</Text>
                  {labelText.slice(index + highlightText.length)}
                </>
              );
            }

            const isOptionDisabled = option.disabled === true;
            const optionColor = isOptionDisabled
              ? undefined
              : isSelected
                ? 'success'
                : isFocused
                  ? 'suggestion'
                  : undefined;

            return leftoverClip(
              option,
              <Box flexDirection="column" flexShrink={0}>
                <SelectOption
                  isFocused={isFocused}
                  isSelected={isSelected}
                  shouldShowDownArrow={innerHint === 'glyph' && areMoreOptionsBelow && isLastVisibleOption}
                  shouldShowUpArrow={innerHint === 'glyph' && areMoreOptionsAbove && isFirstVisibleOption}
                  onClick={optionOnClick(option)}
                  description={leftoverNn ? option.description : undefined}
                  icon={leftoverNn ? option.icon : undefined}
                  meta={leftoverNn ? leftoverNnFacts(option.meta) : undefined}
                  iconWidth={leftoverNn?.iconWidth}
                  nameWidth={leftoverNn?.nameWidth}
                  factsWidth={leftoverNn?.factsWidth}
                >
                  <Text dimColor={isOptionDisabled} color={optionColor}>
                    {label}
                  </Text>
                </SelectOption>
                {!leftoverNn && option.description && (
                  <Box paddingLeft={2}>
                    <Text dimColor={isOptionDisabled || option.dimDescription !== false} color={optionColor}>
                      <Ansi>{option.description}</Ansi>
                    </Text>
                  </Box>
                )}
                <Text> </Text>
              </Box>,
            );
          }),
    });
  }

  if (layout === 'compact-vertical') {
    const maxIndexWidth = hideIndexes ? 0 : state.options.length.toString().length;

    return leftoverListFrame({
      hostRef: leftoverHostRef,
      moreRowLines,
      scrollBar,
      gxtHeight: leftoverAwareVisible,
      spare: leftoverSpare,
      aboveCount: state.visibleFromIndex,
      belowCount: Math.max(0, options.length - state.visibleToIndex),
      innerHint,
      onJePress: leftoverJePress,
      emptyMessage,
      optionCount: options.length,
      offset: leftoverLineStart,
      visible: leftoverBarVisible,
      total: leftoverLineCount(options),
      onScrollTo: leftoverScrollOn
        ? (offset: number) => {
            state.scrollTo(leftoverLineToNav(options, offset));
          }
        : () => undefined,
      onScrollBy: state.scrollBy,
      jeDropsRef: jePressedRef,
      now: () => clock?.now() ?? Date.now(),
      wheelOn: leftoverWheel,
      onKeyDown: leftoverBindKeyDown,
      windowStart: state.visibleFromIndex,
      focusOn: leftoverFocusOn,
      screenReader: leftoverScreenReader,
      screenReaderRadio: leftoverSrRadio,
      g5Prompt: leftoverG5Text,
      g5CursorActive: leftoverG5CursorActive,
      g5ShowPrompt: leftoverShowPrompt,
      nnDt: leftoverNnDt,
      children: leftoverSrRadio
        ? leftoverG5Children
        : state.visibleOptions.map((option, index) => {
            const isFirstVisibleOption = option.index === state.visibleFromIndex;
            const isLastVisibleOption = option.index === state.visibleToIndex - 1;
            const areMoreOptionsBelow = state.visibleToIndex < options.length;
            const areMoreOptionsAbove = state.visibleFromIndex > 0;

            const i = state.visibleFromIndex + index + 1;

            const isFocused = !isDisabled && state.focusedValue === option.value;
            const isSelected = state.value === option.value;

            // Handle input type options
            if (option.type === 'input') {
              const inputValue = inputValues.has(option.value)
                ? inputValues.get(option.value)!
                : option.initialValue || '';

              return (
                <SelectInputOption
                  key={String(option.value)}
                  option={option}
                  isFocused={isFocused}
                  isSelected={isSelected}
                  shouldShowDownArrow={innerHint === 'glyph' && areMoreOptionsBelow && isLastVisibleOption}
                  shouldShowUpArrow={innerHint === 'glyph' && areMoreOptionsAbove && isFirstVisibleOption}
                  maxIndexWidth={maxIndexWidth}
                  index={i}
                  inputValue={inputValue}
                  onInputChange={value => {
                    setInputValues(prev => {
                      const next = new Map(prev);
                      next.set(option.value, value);
                      return next;
                    });
                  }}
                  onSubmit={(value: string) => {
                    const hasImageAttachments =
                      pastedContents && Object.values(pastedContents).some(c => c.type === 'image');
                    if (value.trim() || hasImageAttachments || option.allowEmptySubmitToCancel) {
                      onChange?.(option.value);
                    } else {
                      onCancel?.();
                    }
                  }}
                  onExit={onCancel}
                  layout="compact"
                  showLabel={inlineDescriptions}
                  onOpenEditor={onOpenEditor}
                  resetCursorOnUpdate={option.resetCursorOnUpdate}
                  onImagePaste={onImagePaste}
                  pastedContents={pastedContents}
                  onRemoveImage={onRemoveImage}
                  imagesSelected={imagesSelected}
                  selectedImageIndex={selectedImageIndex}
                  onImagesSelectedChange={setImagesSelected}
                  onSelectedImageIndexChange={setSelectedImageIndex}
                  onClick={optionOnClick(option)}
                />
              );
            }

            // Handle text type options
            let label: ReactNode = option.label;

            // Only apply highlight when label is a string
            if (typeof option.label === 'string' && highlightText && option.label.includes(highlightText)) {
              const labelText = option.label;
              const index = labelText.indexOf(highlightText);

              label = (
                <>
                  {labelText.slice(0, index)}
                  <Text {...styles.highlightedText()}>{highlightText}</Text>
                  {labelText.slice(index + highlightText.length)}
                </>
              );
            }

            const isOptionDisabled = option.disabled === true;

            return leftoverClip(
              option,
              <Box flexDirection="column" flexShrink={0}>
                <SelectOption
                  isFocused={isFocused}
                  isSelected={isSelected}
                  shouldShowDownArrow={innerHint === 'glyph' && areMoreOptionsBelow && isLastVisibleOption}
                  shouldShowUpArrow={innerHint === 'glyph' && areMoreOptionsAbove && isFirstVisibleOption}
                  onClick={optionOnClick(option)}
                  description={leftoverNn ? option.description : undefined}
                  icon={leftoverNn ? option.icon : undefined}
                  meta={leftoverNn ? leftoverNnFacts(option.meta) : undefined}
                  iconWidth={leftoverNn?.iconWidth}
                  nameWidth={leftoverNn?.nameWidth}
                  factsWidth={leftoverNn?.factsWidth}
                >
                  <>
                    {!hideIndexes && <Text dimColor>{`${i}.`.padEnd(maxIndexWidth + 1)}</Text>}
                    <Text
                      dimColor={isOptionDisabled}
                      color={
                        isOptionDisabled ? undefined : isSelected ? 'success' : isFocused ? 'suggestion' : undefined
                      }
                    >
                      {label}
                    </Text>
                  </>
                </SelectOption>
                {!leftoverNn && option.description && (
                  <Box paddingLeft={hideIndexes ? 4 : maxIndexWidth + 4}>
                    <Text
                      dimColor={isOptionDisabled || option.dimDescription !== false}
                      color={
                        isOptionDisabled ? undefined : isSelected ? 'success' : isFocused ? 'suggestion' : undefined
                      }
                    >
                      <Ansi>{option.description}</Ansi>
                    </Text>
                  </Box>
                )}
              </Box>,
            );
          }),
    });
  }

  const maxIndexWidth = hideIndexes ? 0 : state.options.length.toString().length;

  // Check if any visible options have descriptions (for two-column layout)
  // Also check that there are NO input options, since they're not supported in two-column layout
  // Skip two-column layout when inlineDescriptions is enabled
  const hasInputOptions = state.visibleOptions.some(opt => opt.type === 'input');
  const hasDescriptions = !inlineDescriptions && !hasInputOptions && state.visibleOptions.some(opt => opt.description);

  // Pre-compute option data for two-column layout
  const optionData = state.visibleOptions.map((option, index) => {
    const isFirstVisibleOption = option.index === state.visibleFromIndex;
    const isLastVisibleOption = option.index === state.visibleToIndex - 1;
    const areMoreOptionsBelow = state.visibleToIndex < options.length;
    const areMoreOptionsAbove = state.visibleFromIndex > 0;
    const i = state.visibleFromIndex + index + 1;
    const isFocused = !isDisabled && state.focusedValue === option.value;
    const isSelected = state.value === option.value;
    const isOptionDisabled = option.disabled === true;

    let label: ReactNode = option.label;
    if (typeof option.label === 'string' && highlightText && option.label.includes(highlightText)) {
      const labelText = option.label;
      const idx = labelText.indexOf(highlightText);
      label = (
        <>
          {labelText.slice(0, idx)}
          <Text {...styles.highlightedText()}>{highlightText}</Text>
          {labelText.slice(idx + highlightText.length)}
        </>
      );
    }

    return {
      option,
      index: i,
      label,
      isFocused,
      isSelected,
      isOptionDisabled,
      shouldShowDownArrow: innerHint === 'glyph' && areMoreOptionsBelow && isLastVisibleOption,
      shouldShowUpArrow: innerHint === 'glyph' && areMoreOptionsAbove && isFirstVisibleOption,
    };
  });

  // Calculate max label width for alignment when descriptions exist
  if (hasDescriptions) {
    const maxLabelWidth = Math.max(
      ...optionData.map(data => {
        if (data.option.type === 'input') return 0;
        const labelText = getTextContent(data.option.label);
        // Width: indicator (1) + space (1) + index + label + space + checkmark (1)
        const indexWidth = hideIndexes ? 0 : maxIndexWidth + 2;
        const checkmarkWidth = data.isSelected ? 2 : 0;
        return 2 + indexWidth + stringWidth(labelText) + checkmarkWidth;
      }),
    );

    return leftoverListFrame({
      hostRef: leftoverHostRef,
      moreRowLines,
      scrollBar,
      gxtHeight: leftoverAwareVisible,
      spare: leftoverSpare,
      aboveCount: state.visibleFromIndex,
      belowCount: Math.max(0, options.length - state.visibleToIndex),
      innerHint,
      onJePress: leftoverJePress,
      emptyMessage,
      optionCount: options.length,
      offset: leftoverLineStart,
      visible: leftoverBarVisible,
      total: leftoverLineCount(options),
      onScrollTo: leftoverScrollOn
        ? (offset: number) => {
            state.scrollTo(leftoverLineToNav(options, offset));
          }
        : () => undefined,
      onScrollBy: state.scrollBy,
      jeDropsRef: jePressedRef,
      now: () => clock?.now() ?? Date.now(),
      wheelOn: leftoverWheel,
      onKeyDown: leftoverBindKeyDown,
      windowStart: state.visibleFromIndex,
      focusOn: leftoverFocusOn,
      screenReader: leftoverScreenReader,
      screenReaderRadio: leftoverSrRadio,
      g5Prompt: leftoverG5Text,
      g5CursorActive: leftoverG5CursorActive,
      g5ShowPrompt: leftoverShowPrompt,
      nnDt: leftoverNnDt,
      children: leftoverSrRadio
        ? leftoverG5Children
        : optionData.map(data => {
            if (data.option.type === 'input') {
              // Input options not supported in two-column layout
              return null;
            }
            const labelText = getTextContent(data.option.label);
            const indexWidth = hideIndexes ? 0 : maxIndexWidth + 2;
            const checkmarkWidth = data.isSelected ? 2 : 0;
            const currentLabelWidth = 2 + indexWidth + stringWidth(labelText) + checkmarkWidth;
            const padding = maxLabelWidth - currentLabelWidth;

            return leftoverClip(
              data.option,
              <TwoColumnRow isFocused={data.isFocused} onClick={optionOnClick(data.option)}>
                {/* Label part - no gap, handle spacing explicitly */}
                <Box flexDirection="row" flexShrink={0}>
                  {data.isFocused ? (
                    <Text color="suggestion">{figures.pointer}</Text>
                  ) : data.shouldShowDownArrow ? (
                    <Text dimColor>{figures.arrowDown}</Text>
                  ) : data.shouldShowUpArrow ? (
                    <Text dimColor>{figures.arrowUp}</Text>
                  ) : (
                    <Text> </Text>
                  )}
                  <Text> </Text>
                  <Text
                    dimColor={data.isOptionDisabled}
                    color={
                      data.isOptionDisabled
                        ? undefined
                        : data.isSelected
                          ? 'success'
                          : data.isFocused
                            ? 'suggestion'
                            : undefined
                    }
                  >
                    {!hideIndexes && <Text dimColor>{`${data.index}.`.padEnd(maxIndexWidth + 2)}</Text>}
                    {data.label}
                  </Text>
                  {data.isSelected && <Text color="success"> {figures.tick}</Text>}
                  {/* Padding to align descriptions */}
                  {padding > 0 && <Text>{' '.repeat(padding)}</Text>}
                </Box>
                {/* Description part */}
                <Box flexGrow={1} marginLeft={2}>
                  <Text
                    wrap="wrap"
                    dimColor={data.isOptionDisabled || data.option.dimDescription !== false}
                    color={
                      data.isOptionDisabled
                        ? undefined
                        : data.isSelected
                          ? 'success'
                          : data.isFocused
                            ? 'suggestion'
                            : undefined
                    }
                  >
                    <Ansi>{data.option.description || ' '}</Ansi>
                  </Text>
                </Box>
              </TwoColumnRow>,
            );
          }),
    });
  }

  return leftoverListFrame({
    hostRef: leftoverHostRef,
    moreRowLines,
    scrollBar,
    gxtHeight: leftoverAwareVisible,
    spare: leftoverSpare,
    aboveCount: state.visibleFromIndex,
    belowCount: Math.max(0, options.length - state.visibleToIndex),
    innerHint,
    onJePress: leftoverJePress,
    emptyMessage,
    optionCount: options.length,
    offset: leftoverLineStart,
    visible: leftoverBarVisible,
    total: leftoverLineCount(options),
    onScrollTo: leftoverScrollOn
      ? (offset: number) => {
          state.scrollTo(leftoverLineToNav(options, offset));
        }
      : () => undefined,
    onScrollBy: state.scrollBy,
    jeDropsRef: jePressedRef,
    now: () => clock?.now() ?? Date.now(),
    wheelOn: leftoverWheel,
    onKeyDown: leftoverBindKeyDown,
    windowStart: state.visibleFromIndex,
    focusOn: leftoverFocusOn,
    screenReader: leftoverScreenReader,
    screenReaderRadio: leftoverSrRadio,
    g5Prompt: leftoverG5Text,
    g5CursorActive: leftoverG5CursorActive,
    g5ShowPrompt: leftoverShowPrompt,
    nnDt: leftoverNnDt,
    children: leftoverSrRadio
      ? leftoverG5Children
      : state.visibleOptions.map((option, index) => {
          // Handle input type options
          if (option.type === 'input') {
            const inputValue = inputValues.has(option.value)
              ? inputValues.get(option.value)!
              : option.initialValue || '';

            const isFirstVisibleOption = option.index === state.visibleFromIndex;
            const isLastVisibleOption = option.index === state.visibleToIndex - 1;
            const areMoreOptionsBelow = state.visibleToIndex < options.length;
            const areMoreOptionsAbove = state.visibleFromIndex > 0;

            const i = state.visibleFromIndex + index + 1;

            const isFocused = !isDisabled && state.focusedValue === option.value;
            const isSelected = state.value === option.value;

            return leftoverClip(
              option,
              <SelectInputOption
                option={option}
                isFocused={isFocused}
                isSelected={isSelected}
                shouldShowDownArrow={innerHint === 'glyph' && areMoreOptionsBelow && isLastVisibleOption}
                shouldShowUpArrow={innerHint === 'glyph' && areMoreOptionsAbove && isFirstVisibleOption}
                maxIndexWidth={maxIndexWidth}
                index={i}
                inputValue={inputValue}
                onInputChange={value => {
                  setInputValues(prev => {
                    const next = new Map(prev);
                    next.set(option.value, value);
                    return next;
                  });
                }}
                onSubmit={(value: string) => {
                  const hasImageAttachments =
                    pastedContents && Object.values(pastedContents).some(c => c.type === 'image');
                  if (value.trim() || hasImageAttachments || option.allowEmptySubmitToCancel) {
                    onChange?.(option.value);
                  } else {
                    onCancel?.();
                  }
                }}
                onExit={onCancel}
                layout="compact"
                showLabel={inlineDescriptions}
                onOpenEditor={onOpenEditor}
                resetCursorOnUpdate={option.resetCursorOnUpdate}
                onImagePaste={onImagePaste}
                pastedContents={pastedContents}
                onRemoveImage={onRemoveImage}
                imagesSelected={imagesSelected}
                selectedImageIndex={selectedImageIndex}
                onImagesSelectedChange={setImagesSelected}
                onSelectedImageIndexChange={setSelectedImageIndex}
                onClick={optionOnClick(option)}
              />,
            );
          }

          // Handle text type options
          let label: ReactNode = option.label;

          // Only apply highlight when label is a string
          if (typeof option.label === 'string' && highlightText && option.label.includes(highlightText)) {
            const labelText = option.label;
            const index = labelText.indexOf(highlightText);

            label = (
              <>
                {labelText.slice(0, index)}
                <Text {...styles.highlightedText()}>{highlightText}</Text>
                {labelText.slice(index + highlightText.length)}
              </>
            );
          }

          const isFirstVisibleOption = option.index === state.visibleFromIndex;
          const isLastVisibleOption = option.index === state.visibleToIndex - 1;
          const areMoreOptionsBelow = state.visibleToIndex < options.length;
          const areMoreOptionsAbove = state.visibleFromIndex > 0;

          const i = state.visibleFromIndex + index + 1;

          const isFocused = !isDisabled && state.focusedValue === option.value;
          const isSelected = state.value === option.value;
          const isOptionDisabled = option.disabled === true;

          return leftoverClip(
            option,
            <SelectOption
              isFocused={isFocused}
              isSelected={isSelected}
              shouldShowDownArrow={innerHint === 'glyph' && areMoreOptionsBelow && isLastVisibleOption}
              shouldShowUpArrow={innerHint === 'glyph' && areMoreOptionsAbove && isFirstVisibleOption}
              onClick={optionOnClick(option)}
              description={leftoverNn ? option.description : undefined}
              icon={leftoverNn ? option.icon : undefined}
              meta={leftoverNn ? leftoverNnFacts(option.meta) : undefined}
              iconWidth={leftoverNn?.iconWidth}
              nameWidth={leftoverNn?.nameWidth}
              factsWidth={leftoverNn?.factsWidth}
            >
              <Box flexDirection="row" flexShrink={0}>
                {!hideIndexes && <Text dimColor>{`${i}.`.padEnd(maxIndexWidth + 2)}</Text>}
                <Text
                  dimColor={isOptionDisabled}
                  color={isOptionDisabled ? undefined : isSelected ? 'success' : isFocused ? 'suggestion' : undefined}
                >
                  {label}
                  {inlineDescriptions && option.description && (
                    <Text dimColor={isOptionDisabled || option.dimDescription !== false}> {option.description}</Text>
                  )}
                </Text>
              </Box>
              {!leftoverNn && !inlineDescriptions && option.description && (
                <Box flexShrink={99} marginLeft={2}>
                  <Text
                    wrap="wrap-trim"
                    dimColor={isOptionDisabled || option.dimDescription !== false}
                    color={isOptionDisabled ? undefined : isSelected ? 'success' : isFocused ? 'suggestion' : undefined}
                  >
                    <Ansi>{option.description}</Ansi>
                  </Text>
                </Box>
              )}
            </SelectOption>,
          );
        }),
  });
}

// Row container for the two-column (label + description) layout. Unlike
// the other Select layouts, this one doesn't render through SelectOption →
// ListItem, so it declares the native cursor directly. Parks the cursor
// on the pointer indicator so screen readers / magnifiers track focus.
function TwoColumnRow({
  isFocused,
  children,
  onClick,
}: {
  isFocused: boolean;
  children: ReactNode;
  onClick?: (event: ClickEvent) => void;
}): React.ReactNode {
  const cursorRef = useDeclaredCursor({
    line: 0,
    column: 0,
    active: isFocused,
  });
  return (
    <Box ref={cursorRef} flexDirection="row" onClick={onClick}>
      {children}
    </Box>
  );
}
