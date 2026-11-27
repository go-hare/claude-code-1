import {
  Box,
  Button,
  ClockContext,
  Link,
  MOUNT_SETTLE_MS,
  NoSelect,
  Text,
  getFocusManager,
  stringWidth,
  useInput,
  useOptionalKeybindingContext,
  useApp,
  useSelection,
  measureElement,
  type DOMElement,
  type MouseActionEvent,
} from '@anthropic/ink';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { subscribeRenderInvalidation } from '../../utils/render/invalidateAllRenders.js';
import {
  evaluateUiRender,
  getLastUiRenderPlugin,
  focusPane,
  getPanesState,
  normalizeModScrollXTree,
  normalizeModTextWrapAndMaxLines,
  subscribePanes,
  subscribeRasterFrames,
} from '../../utils/plugins/functionHooksModules.js';
import {
  acquirePluginClient,
  clientInstanceKey,
  DETACHED_CLIENT,
  type ClientInstance,
} from '../../utils/plugins/functionHooksClient.js';
import { useHasOpenDialogs } from '../../dialog/DialogStoreContext.js';
import { logForDebugging } from '../../utils/debug.js';
import { parsePatch, type StructuredPatchHunk } from 'diff';
import TextInput from '../TextInput.js';
import { HighlightedCode as BaseHighlightedCode } from '../HighlightedCode.js';
import { Markdown } from '../Markdown.js';
import { PluginImage, PluginRaster } from '../PluginRaster.js';
import { StructuredDiff } from '../StructuredDiff.js';
import { intersperse } from '../../utils/array.js';
import { truncateToWidth } from '../../utils/format.js';
import { encodePluginLinkHref, encodePluginLinkLabel } from '../../utils/plugins/pluginLinkHref.js';
import { L1t, tellerOfPlugin } from '../../utils/plugins/pluginDrawError.js';
import { RZ } from '../../utils/plugins/pluginSiteHold.js';
import {
  BAND_REQUEST_ID,
  type DrawingFocusable,
  type PluginInputMapApi,
  boolProp,
  childList,
  clampModTextLines,
  extractDrawnPlugin,
  firePress,
  flattenDrawingChildren,
  isEngineDrawing,
  isRecord,
  layoutFrom,
  measurePluginClientBox,
  modTextMaxLinesFrom,
  numberProp,
  openListRows,
  pluginClientKeyFromInput,
  pluginClientPointerButton,
  pluginClientPointerKind,
  pluginInputFieldKey,
  pluginInputIsNav,
  pluginInputIsTyped,
  pressOf,
  renderVersion,
  selectWindow,
  snapshot,
  stampedPlugin,
  stringProp,
  textStyleFrom,
} from './drawingHelpers.js';
import {
  type BandInputFocusHost,
  ClickedPressContext,
  type FocusedInput,
  FocusedInputContext,
  FocusedPressContext,
  HeldFocusRefContext,
  type InputFields,
  InputFieldsContext,
  PaneBodyColumnsContext,
  PaneErrorBoundary,
  type PluginActionKeySeat,
  type SelectFields,
  SelectFieldsContext,
  actionComponentRank,
  clearPluginClientFocusedId,
  getPluginActionKeySeats,
  getPluginClientFocusedId,
  pluginFieldContext,
  pluginKeysAreAhead,
  setOpenListRows,
  setPaneFieldHeld,
  setPluginClientFocusedId,
  subscribePluginClientFocus,
  usePaneClickAway,
  usePluginHoverScope,
  usePluginInputSeat,
  useYogaMeasure,
} from './sessionStores.js';
import { type PluginSelectSeat, type PluginSelectSeatRing, usePluginSelectSeat } from './focusAndBandHooks.js';

const HighlightedCode = BaseHighlightedCode as unknown as ComponentType<
  ComponentProps<typeof BaseHighlightedCode> & { startLine?: number; lineNumbers?: boolean }
>;

/** densable `qt` / `Ut` — register fallback keybinding for Button `props.action`. */
function PluginButtonActionKeys({
  plugin,
  handle,
  action,
  component,
}: {
  plugin: string;
  handle: unknown;
  action: string;
  component?: string;
}): ReactNode {
  const keybindingContext = useOptionalKeybindingContext();
  const dialogOpen = useHasOpenDialogs();
  const rank = actionComponentRank(component);
  const [seat] = useState<PluginActionKeySeat>(() => ({
    action,
    rank,
    seq: 0,
    plugin,
    handle,
  }));
  const bindings = keybindingContext?.bindings;
  const contexts = useMemo(
    () => [...new Set((bindings ?? []).filter(b => b.action === action).map(b => b.context))],
    [action, bindings],
  );
  useLayoutEffect(() => {
    seat.plugin = plugin;
    seat.handle = handle;
    seat.rank = rank;
  });
  useEffect(() => {
    const seats = getPluginActionKeySeats();
    seat.action = action;
    seats.add(seat);
    return () => seats.remove(seat);
  }, [action, seat]);
  useEffect(() => {
    if (!keybindingContext || dialogOpen) return;
    const seats = getPluginActionKeySeats();
    const unsubs = contexts.map(ctx =>
      keybindingContext.registerHandler({
        action,
        context: ctx,
        handler: () => {
          const winner = seats.winnerOf(action);
          if (winner === undefined) return;
          firePress(winner.plugin, winner.handle);
        },
      }),
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [keybindingContext, action, contexts, dialogOpen]);
  useInput(
    (input, key, event) => {
      if (!keybindingContext || dialogOpen) return;
      const toCheck = [...new Set([...keybindingContext.activeContexts, ...contexts, 'Global'])];
      const resolved = keybindingContext.resolve(input, key, toCheck);
      if (resolved.type !== 'match' || resolved.action !== action) return;
      const winner = getPluginActionKeySeats().winnerOf(action);
      if (winner === undefined) return;
      keybindingContext.setPendingChord(null);
      firePress(winner.plugin, winner.handle);
      event.stopImmediatePropagation();
    },
    { isActive: !dialogOpen && contexts.length > 0 },
  );
  return null;
}

/** densable `NMn` — release Ink focus if activeElement is inside `node`. */
function releaseButtonInkFocus(node: DOMElement | null): void {
  if (!node) return;
  try {
    const fm = getFocusManager(node);
    let cur: DOMElement | undefined = fm.activeElement ?? undefined;
    while (cur && cur !== node) cur = cur.parentNode;
    if (cur === node) fm.blur();
  } catch {
    /* detached node */
  }
}

function PluginPressButton({
  plugin,
  handle,
  element,
  label,
  hotkey,
  action,
  plain,
  dimColor,
  variant,
  hover,
  component,
}: {
  plugin: string;
  handle: unknown;
  element?: string;
  label: string;
  hotkey?: string;
  action?: string;
  plain?: boolean;
  dimColor?: boolean;
  variant?: string;
  hover?: Record<string, unknown>;
  component?: string;
}): ReactNode {
  const focusedPress = useContext(FocusedPressContext);
  const reportHeldFocus = useContext(HeldFocusRefContext);
  const hasKeyboardFocus = focusedPress !== null && focusedPress.plugin === plugin && focusedPress.handle === handle;
  const boxRef = useRef<DOMElement | null>(null);
  const [boxHovered, setBoxHovered] = useState(false);
  const hoverScope = usePluginHoverScope(plugin, hover);
  const hoverLit = hover !== undefined && (hoverScope.isScoped ? hoverScope.isHot : boxHovered);
  const hoverTextOverrides = hoverLit ? textStyleFrom(hover) : {};
  return (
    <Box
      ref={boxRef}
      flexShrink={0}
      alignSelf="flex-start"
      {...(element !== undefined && { elementKey: element, elementPlugin: plugin })}
      {...(hotkey !== undefined && { hotkey })}
      onClick={event => {
        releaseButtonInkFocus(boxRef.current);
        event.stopImmediatePropagation();
      }}
      {...(hover !== undefined && {
        onMouseEnter: () => {
          setBoxHovered(true);
          hoverScope.onMouseEnter();
        },
        onMouseLeave: () => {
          setBoxHovered(false);
          hoverScope.onMouseLeave();
        },
      })}
    >
      {action !== undefined && (
        <PluginButtonActionKeys plugin={plugin} handle={handle} action={action} component={component} />
      )}
      <Button
        ref={hasKeyboardFocus ? reportHeldFocus : undefined}
        tabIndex={-1}
        flexShrink={0}
        alignSelf="flex-start"
        onAction={() => firePress(plugin, handle)}
      >
        {state => {
          const inverse = state.focused || state.hovered || hasKeyboardFocus;
          const dim = dimColor === true && !inverse;
          if (plain === true) {
            return (
              <Text inverse={inverse} dimColor={dim} {...hoverTextOverrides}>
                {hotkey === undefined ? (
                  label
                ) : (
                  <>
                    <Text color="suggestion">{hotkey}</Text>
                    {': '}
                    {label}
                  </>
                )}
              </Text>
            );
          }
          return (
            <Text
              inverse={inverse}
              bold
              dimColor={dim}
              color={variant === 'primary' ? 'suggestion' : undefined}
              {...hoverTextOverrides}
            >
              {`[ ${label} ]`}
            </Text>
          );
        }}
      </Button>
    </Box>
  );
}

/** Alias densable `BDe` for local Input/Select field keys. */
const inputFieldKey = pluginInputFieldKey;

function PluginPressInput({
  plugin,
  handle,
  element,
  label,
  placeholder,
  value,
  submitLabel,
  rows,
}: {
  plugin: string;
  handle: unknown;
  element?: string;
  label?: string;
  placeholder?: string;
  value?: string;
  submitLabel?: string;
  rows?: number;
}): ReactNode {
  const focus = useContext(FocusedInputContext);
  const clicked = useContext(ClickedPressContext);
  const fields = useContext(InputFieldsContext);
  const focusedPress = useContext(FocusedPressContext);
  const reportHeldFocus = useContext(HeldFocusRefContext);
  const fieldKey = element ?? '';
  const focused =
    focus?.focused !== null &&
    focus?.focused !== undefined &&
    focus.focused.plugin === plugin &&
    focus.focused.handle === handle;
  const hasKeyboardFocus =
    focused || (focusedPress !== null && focusedPress.plugin === plugin && focusedPress.handle === handle);
  const isInputFocused = focused || (fields !== null && hasKeyboardFocus);
  /** densable `Wt` `h` — `Xjt.textOf(plugin, element) ?? value ?? ""`. */
  const shown = (fields !== null && fieldKey !== '' ? fields.textOf(plugin, fieldKey) : undefined) ?? value ?? '';
  const [cursor, setCursor] = useState(shown.length);
  const { columns: terminalColumns, rows: terminalRows } = useTerminalSize();
  // densable Wt — prefer XXt body columns over full terminal width.
  const bodyColumns = useContext(PaneBodyColumnsContext);
  const columns = bodyColumns ?? terminalColumns;
  useEffect(() => {
    if (isInputFocused) setCursor(Number.MAX_SAFE_INTEGER);
  }, [isInputFocused]);
  const empty = shown === '';
  const visibleRows = Math.max(1, Math.min(rows ?? 1, terminalRows));
  const isMultiline = visibleRows > 1;
  const prefix = label === undefined ? '' : `${label}: `;
  const submit = ` ⏎ ${submitLabel ?? 'submit'}`;
  const multilineHint = isMultiline && isInputFocused ? `${submit} · shift+⏎ / \\⏎ new line` : submit;
  const remainingColumns = columns - stringWidth(prefix);
  const hint = remainingColumns - stringWidth(multilineHint) >= columns / 2 ? multilineHint : submit;
  const fieldColumns = Math.max(12, remainingColumns - stringWidth(hint));
  return (
    <Box
      ref={hasKeyboardFocus ? reportHeldFocus : undefined}
      flexDirection="row"
      flexShrink={0}
      height={isMultiline ? visibleRows : undefined}
      overflow={isMultiline ? 'hidden' : undefined}
      {...(fieldKey !== '' && { elementKey: fieldKey, elementPlugin: plugin })}
      onClick={event => {
        if (event.isWindowActivation) return;
        clicked?.({ plugin, handle });
        if (fieldKey !== '') {
          focus?.setFocused({ plugin, handle, element: fieldKey, value });
        }
      }}
    >
      {prefix !== '' && <Text bold={isInputFocused}>{prefix}</Text>}
      {isInputFocused ? (
        <TextInput
          value={shown}
          onChange={next => {
            if (fields !== null && fieldKey !== '') {
              fields.edit({ plugin, handle, element: fieldKey }, next);
              return;
            }
            firePress(plugin, handle, { kind: 'change', value: next });
          }}
          onSubmit={next => {
            if (fields !== null && fieldKey !== '') {
              fields.submit({ plugin, handle, element: fieldKey, value: next });
            } else {
              firePress(plugin, handle, { kind: 'submit', value: next });
            }
            focus?.setFocused(null);
          }}
          placeholder={placeholder}
          columns={fieldColumns}
          cursorOffset={Math.min(cursor, shown.length)}
          onChangeCursorOffset={setCursor}
          inputFilter={isMultiline ? next => next.replace(/\r\n?/g, '\n') : undefined}
          maxVisibleLines={isMultiline ? visibleRows : undefined}
          focus
          showCursor
          multiline={isMultiline}
          disableEscapeDoublePress
        />
      ) : (
        <Text dimColor={empty} wrap={isMultiline ? 'wrap' : 'truncate-end'}>
          {empty ? (placeholder ?? '') : shown}
        </Text>
      )}
      {isInputFocused && <Text dimColor>{hint}</Text>}
    </Box>
  );
}

function PluginPressSelect({
  plugin,
  handle,
  element,
  label,
  options,
  value,
}: {
  plugin: string;
  handle: unknown;
  element?: string;
  label?: string;
  options: Array<{ value: string; label?: string }>;
  value?: string;
}): ReactNode {
  const fields = useContext(SelectFieldsContext);
  const clicked = useContext(ClickedPressContext);
  const focusedPress = useContext(FocusedPressContext);
  const reportHeldFocus = useContext(HeldFocusRefContext);
  const fieldKey = element ?? '';
  const picked = fields !== null && fieldKey !== '' ? fields.pickedOf(plugin, fieldKey) : undefined;
  const shown = picked ?? value;
  const current = options.find(option => option.value === shown);
  const prefix = label === undefined ? '' : `${label}: `;
  const openRec = fields?.open;
  const isOpen = openRec !== null && openRec !== undefined && openRec.plugin === plugin && openRec.handle === handle;
  const highlight = isOpen ? openRec.highlight : 0;
  const { first, size, hidden } = selectWindow(isOpen ? options.length : 0, highlight);
  const hasKeyboardFocus = focusedPress !== null && focusedPress.plugin === plugin && focusedPress.handle === handle;
  return (
    <Box
      ref={hasKeyboardFocus ? reportHeldFocus : undefined}
      flexDirection="column"
      flexShrink={0}
      {...(fieldKey !== '' && { elementKey: fieldKey, elementPlugin: plugin })}
      onClick={event => {
        if (event.isWindowActivation) return;
        clicked?.({ plugin, handle });
        if (fields !== null && fieldKey !== '') {
          fields.focus({ plugin, handle, element: fieldKey, options });
          fields.toggle({ plugin, handle, element: fieldKey, options, value });
          return;
        }
        if (options.length > 0) {
          const curIdx = options.findIndex(option => option.value === shown);
          const nextOpt = options[(curIdx + 1) % options.length];
          if (nextOpt !== undefined) {
            firePress(plugin, handle, { value: nextOpt.value });
          }
        }
      }}
    >
      <Text wrap="truncate-end">
        {prefix !== '' && <Text bold={hasKeyboardFocus}>{prefix}</Text>}
        {current === undefined ? (
          <Text dimColor>none</Text>
        ) : (
          <Text inverse={hasKeyboardFocus && !isOpen}>{current.label ?? current.value}</Text>
        )}
        <Text dimColor>{isOpen ? ' ▴' : ' ▾'}</Text>
      </Text>
      {options.slice(first, first + size).map((option, i) => (
        <Text key={option.value} inverse={first + i === highlight} wrap="truncate-end">
          {`  ${option.label ?? option.value}`}
        </Text>
      ))}
      {hidden > 0 && <Text dimColor>{`  … ${hidden} more`}</Text>}
    </Box>
  );
}

const PLUGIN_CODE_DEFAULT_COLUMNS = 80;

const PLUGIN_DIFF_MAX_LINE = 1_000_000_000;

function sanitizePluginCodeText(line: string): string {
  return line.replace(/\t/g, '  ').replace(/[؜‪-‮⁦-⁩]/gu, '�');
}

function pluginDiffGutterWidth(hunk: StructuredPatchHunk): number {
  return `+ ${Math.max(hunk.oldStart + hunk.oldLines - 1, hunk.newStart + hunk.newLines - 1, 1)} `.length;
}

function parsePluginDiffHunks(source: string): StructuredPatchHunk[] | undefined {
  let patches: ReturnType<typeof parsePatch>;
  try {
    patches = parsePatch(source);
  } catch {
    return undefined;
  }
  const hunks = patches
    .flatMap(patch => patch.hunks)
    .map(hunk => ({
      ...hunk,
      lines: hunk.lines.filter(line => !line.startsWith('\\')),
    }));
  if (hunks.length === 0) return undefined;
  const invalid = hunks.some(
    ({ oldStart, oldLines, newStart, newLines }) =>
      ![oldStart, oldLines, newStart, newLines].every(
        value => Number.isSafeInteger(value) && value >= 0 && value <= PLUGIN_DIFF_MAX_LINE,
      ),
  );
  return invalid ? undefined : hunks;
}

function formatPluginDiffHunks(hunks: StructuredPatchHunk[], width: number, truncate: boolean): StructuredPatchHunk[] {
  return hunks.map(hunk => {
    const budget = Math.max(1, width - pluginDiffGutterWidth(hunk));
    return {
      ...hunk,
      lines: hunk.lines.map(line => {
        const prefix = line.slice(0, 1);
        const rest = sanitizePluginCodeText(line.slice(1));
        return prefix + (truncate ? truncateToWidth(rest, budget) : rest);
      }),
    };
  });
}

function clipPluginCodeLines(source: string, width: number, startLine: number | undefined): string {
  const lines = source.replace(/\n$/, '').split('\n');
  const gutter = startLine !== undefined ? String(startLine + lines.length - 1).length + 2 : 0;
  const budget = Math.max(1, width - gutter);
  return lines.map(line => truncateToWidth(sanitizePluginCodeText(line), budget)).join('\n');
}

function PluginCode({
  source,
  language,
  path,
  startLine,
  format,
  wrap,
}: {
  source?: unknown;
  language?: unknown;
  path?: unknown;
  startLine?: unknown;
  format?: unknown;
  wrap?: unknown;
}): ReactNode {
  const rawText = typeof source === 'string' ? source : '';
  const lang = typeof language === 'string' && language !== '' ? language : undefined;
  const codePath = typeof path === 'string' ? path : undefined;
  const start =
    typeof startLine === 'number' && Number.isSafeInteger(startLine) && startLine >= 1 ? startLine : undefined;
  // densable `Ye`: language → `source.${language}`; else `path ?? ""`.
  const filePath = lang !== undefined ? `source.${lang}` : (codePath ?? '');
  const codeBoxRef = useRef<DOMElement | null>(null);
  const measuredWidth = useYogaMeasure(() =>
    codeBoxRef.current ? Math.floor(measureElement(codeBoxRef.current).width) : 0,
  );
  // densable 2.1.289: highlight once at the pane's final width, not a
  // provisional 80-column pass and not a 0-width measure of an empty box.
  const bodyColumns = useContext(PaneBodyColumnsContext);
  const fallbackWidth = bodyColumns !== null && bodyColumns > 0 ? bodyColumns : PLUGIN_CODE_DEFAULT_COLUMNS;
  const width = measuredWidth > 0 ? measuredWidth : fallbackWidth;
  const truncate = wrap === 'truncate-end';
  const parsedHunks = useMemo(() => (format === 'diff' ? parsePluginDiffHunks(rawText) : undefined), [rawText, format]);
  const hunks = useMemo(
    () => (parsedHunks === undefined ? undefined : formatPluginDiffHunks(parsedHunks, width, truncate)),
    [parsedHunks, width, truncate],
  );
  const text = useMemo(
    () => (truncate ? clipPluginCodeLines(rawText, width, start) : rawText),
    [rawText, width, start, truncate],
  );
  return (
    <Box ref={codeBoxRef} flexDirection="column" flexGrow={1} flexShrink={1}>
      {hunks !== undefined ? (
        intersperse(
          hunks.map((hunk, i) => (
            <Box flexDirection="column" key={`hunk-${i}`}>
              <StructuredDiff patch={hunk} dim={false} width={width} filePath={filePath} firstLine={null} />
            </Box>
          )),
          i => (
            <NoSelect fromLeftEdge key={`ellipsis-${i}`}>
              <Text dimColor>...</Text>
            </NoSelect>
          ),
        )
      ) : text === '' ? (
        <Text>{text}</Text>
      ) : (
        // <HighlightedCode code={text} filePath={filePath} width={width} />
        <HighlightedCode
          code={text}
          filePath={filePath}
          width={width}
          startLine={start}
          lineNumbers={start !== undefined}
        />
      )}
    </Box>
  );
}

function normalizeMarkdownLinkHref(href: string): string {
  const candidate = /^www\./i.test(href) ? `http://${href}` : href;
  try {
    return new URL(candidate).href;
  } catch {
    return candidate;
  }
}

function isPressableMarkdownLink(href: string, pressableLinks: unknown): boolean {
  if (pressableLinks === undefined || pressableLinks === true) return true;
  if (!Array.isArray(pressableLinks)) return false;
  const target = normalizeMarkdownLinkHref(href);
  return pressableLinks.some(item => typeof item === 'string' && normalizeMarkdownLinkHref(item) === target);
}

const PLUGIN_MARKDOWN_LINK_SCHEMES: ReadonlySet<string> = new Set(['https', 'http', 'file']);

const PLUGIN_MARKDOWN_LINK_DELAY_MS = 500;

function PluginMarkdown({
  text,
  dimColor,
  press,
  elementKey,
  pressableLinks,
}: {
  text: string;
  dimColor?: boolean;
  press?: { plugin: string; handle: unknown };
  elementKey?: string;
  pressableLinks?: unknown;
}): ReactNode {
  const clock = useContext(ClockContext);
  const selection = useSelection();
  const [mountedAt] = useState(() => clock?.now() ?? Date.now());
  const cancelPendingRef = useRef<(() => void) | null>(null);
  const latestPressRef = useRef({ press, pressableLinks });
  latestPressRef.current = { press, pressableLinks };
  useEffect(() => () => cancelPendingRef.current?.(), []);
  const markdownProps = {
    dimColor,
    linkSchemes: PLUGIN_MARKDOWN_LINK_SCHEMES,
    stripPromptTags: false,
  };
  const body = <Markdown {...markdownProps}>{text}</Markdown>;
  if (press === undefined) {
    return elementKey === undefined ? (
      body
    ) : (
      <Box flexDirection="column" elementKey={elementKey}>
        {body}
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      {...(elementKey !== undefined && { elementKey })}
      elementPlugin={press.plugin}
      onClick={event => {
        const href = event.hyperlinkUrl;
        if (href === undefined || event.mods.ctrl || event.mods.alt || !isPressableMarkdownLink(href, pressableLinks)) {
          event.allowDefault();
          return;
        }
        const now = clock?.now() ?? Date.now();
        if (event.isWindowActivation || now - mountedAt < MOUNT_SETTLE_MS) {
          event.dropAsStray();
          return;
        }
        event.stopImmediatePropagation();
        cancelPendingRef.current?.();
        if (selection.hasSelection()) return;
        const unsubscribe = selection.subscribe(() => {
          if (selection.hasSelection()) cancelPendingRef.current?.();
        });
        const fire = () => {
          cancelPendingRef.current = null;
          unsubscribe();
          const current = latestPressRef.current;
          if (current.press !== undefined && isPressableMarkdownLink(href, current.pressableLinks)) {
            firePress(current.press.plugin, current.press.handle, { href });
          }
        };
        const cancelTimer = clock
          ? clock.setTimeout(fire, PLUGIN_MARKDOWN_LINK_DELAY_MS)
          : (() => {
              const timer = setTimeout(fire, PLUGIN_MARKDOWN_LINK_DELAY_MS);
              return () => clearTimeout(timer);
            })();
        cancelPendingRef.current = () => {
          cancelPendingRef.current = null;
          unsubscribe();
          cancelTimer();
        };
      }}
    >
      {body}
    </Box>
  );
}

function PluginClient({
  plugin,
  moduleName,
  elementKey,
  requestId,
  component = 'AbovePrompt',
  props,
  drawn,
  width,
  height,
  flexGrow,
  engine,
}: {
  plugin: string;
  moduleName: string;
  elementKey?: string;
  requestId?: string;
  /** densable `Z` / `L1t(..., "Client")` component. */
  component?: string;
  props?: unknown;
  /** densable `o.drawn` — Client node props identity (`x(()=>i.drawnAgain(),[i,o.drawn])`). */
  drawn?: unknown;
  width?: number;
  height?: number;
  flexGrow?: number;
  engine?: ReactNode;
}): ReactNode {
  const instanceRef = useRef<ClientInstance>(DETACHED_CLIENT);
  const [snapshot, setSnapshot] = useState(() => DETACHED_CLIENT.getSnapshot());
  const [initialProps] = useState(() => props);
  const lastPropsRef = useRef<unknown>(initialProps);
  const boxRef = useRef<DOMElement | null>(null);
  const measuredWidth = useYogaMeasure(() => measurePluginClientBox(boxRef.current).width);
  const measuredHeight = useYogaMeasure(() => measurePluginClientBox(boxRef.current).height);
  useLayoutEffect(() => {
    const instance = acquirePluginClient({
      plugin,
      component,
      key: elementKey ?? '',
      module: moduleName,
      requestId,
      props: initialProps,
    });
    instanceRef.current = instance;
    lastPropsRef.current = initialProps;
    setSnapshot(instance.getSnapshot());
    const unsub = instance.subscribe(() => setSnapshot(instance.getSnapshot()));
    return () => {
      unsub();
      instance.release();
      instanceRef.current = DETACHED_CLIENT;
    };
  }, [plugin, component, moduleName, elementKey, requestId, initialProps]);
  useLayoutEffect(() => {
    if (Object.is(lastPropsRef.current, props)) return;
    lastPropsRef.current = props;
    instanceRef.current.setProps(props);
  }, [props]);
  useLayoutEffect(() => {
    // densable `Xt(()=>{i.laidOut()})` — layout mark, not snapshot-driven.
    instanceRef.current.laidOut();
  });
  useLayoutEffect(() => {
    // densable `x(()=>{i.resize(R,T)},[i,R,T])` — size only; snapshot in this
    // dep list remount-paints in a loop (RootREPLBoundary #185).
    instanceRef.current.resize(measuredWidth, measuredHeight);
  }, [measuredWidth, measuredHeight]);
  useEffect(() => {
    // densable `x(()=>{i.drawnAgain()},[i,o.drawn])` — Client node props identity.
    instanceRef.current.drawnAgain();
  }, [drawn]);
  const isDrawn = snapshot.status === 'drawn';
  // densable `Z` / `i.id` — same key as acquirePluginClient.
  const clientId = clientInstanceKey({
    plugin,
    surface: 'terminal',
    requestId: requestId ?? 'detached',
    key: elementKey ?? '',
  });
  const panesFocusedId = useSyncExternalStore(subscribePanes, () => getPanesState().focusedId);
  const clientHeld =
    useSyncExternalStore(subscribePluginClientFocus, getPluginClientFocusedId, getPluginClientFocusedId) === clientId;
  useEffect(() => {
    // densable oo: pane focusedId + this client held → DQt(null).
    if (panesFocusedId !== null && clientHeld) setPluginClientFocusedId(null);
  }, [panesFocusedId, clientHeld]);
  const clientAway = useCallback(() => {
    clearPluginClientFocusedId(clientId);
  }, [clientId]);
  const clientAwayRef = usePaneClickAway(clientAway);
  useEffect(() => () => clearPluginClientFocusedId(clientId), [clientId]);
  const pointerAt = useRef({ x: 0, y: 0 });
  const acceptsPointer = isDrawn && instanceRef.current.acceptsPointer();
  const acceptsKeys = isDrawn && instanceRef.current.acceptsKeys();
  const pointerLive = acceptsPointer || acceptsKeys;
  const { retainFinePointer } = useApp();
  useEffect(() => {
    // densable fDn(F): retainFinePointer while Client acceptsPointer.
    if (!acceptsPointer) return;
    return retainFinePointer();
  }, [acceptsPointer, retainFinePointer]);
  useInput(
    (input, key, event) => {
      // densable oo `sb`: only while NLe.focusedId===id.
      const live = instanceRef.current;
      if (getPluginClientFocusedId() !== clientId) return;
      if (!live.acceptsKeys()) {
        clientAway();
        return;
      }
      const leave = key.escape || (key.ctrl && (input === 'c' || input === 'd'));
      if (leave) {
        setPluginClientFocusedId(null);
        if (key.escape) event.stopImmediatePropagation();
        return;
      }
      const mapped = pluginClientKeyFromInput(input === '' ? event.input : input, key);
      if (mapped === undefined) return;
      live.key(mapped);
      event.stopImmediatePropagation();
    },
    { isActive: clientHeld, prepend: true },
  );
  const firePointer = (kind: 'down' | 'up' | 'move' | 'enter' | 'leave', event?: MouseActionEvent): void => {
    const live = instanceRef.current;
    if (kind === 'down' && live.acceptsKeys()) {
      focusPane(null);
      setPluginClientFocusedId(clientId);
    }
    const x = event?.localCol ?? pointerAt.current.x;
    const y = event?.localRow ?? pointerAt.current.y;
    pointerAt.current = { x, y };
    const namedButton = pluginClientPointerButton(event?.button);
    live.pointer({
      type: kind,
      x,
      y,
      ...(namedButton !== undefined ? { button: namedButton } : {}),
      ...(event?.shift ? { shift: true } : {}),
      ...(event?.alt ? { alt: true } : {}),
      ...(event?.ctrl ? { ctrl: true } : {}),
      ...(event?.fine ? { fine: { x: event.fine.col, y: event.fine.row } } : {}),
    });
  };
  const clientResetKey = snapshot.status === 'failed' ? `failed:${snapshot.text}` : snapshot.status;
  const clientFallback = (
    <Box
      flexShrink={0}
      overflow="hidden"
      {...(width !== undefined && { width })}
      {...(height !== undefined && { height })}
      {...(flexGrow !== undefined && { flexGrow })}
    >
      <Text> </Text>
    </Box>
  );
  return (
    <PaneErrorBoundary
      resetKey={clientResetKey}
      telemetryMessage={() => L1t(component, tellerOfPlugin(plugin), 'Client')}
      onError={error => {
        instanceRef.current.threw(error);
      }}
      fallback={clientFallback}
    >
      <Box
        ref={node => {
          boxRef.current = node;
          clientAwayRef.current = node;
        }}
        flexDirection="column"
        flexShrink={0}
        overflow="hidden"
        {...(elementKey !== undefined && { elementKey, elementPlugin: plugin })}
        {...(snapshot.status !== 'drawn' && snapshot.status !== 'failed' ? { drawPending: true } : {})}
        {...(width !== undefined && { width })}
        {...(height !== undefined && { height })}
        {...(flexGrow !== undefined && { flexGrow })}
        {...(pointerLive
          ? {
              onPointer: (event: MouseActionEvent) => firePointer(pluginClientPointerKind(event.type), event),
              onMouseEnter: () => {
                instanceRef.current.pointer({ type: 'enter', ...pointerAt.current });
              },
              onMouseLeave: () => {
                instanceRef.current.pointer({ type: 'leave', ...pointerAt.current });
              },
            }
          : {})}
      >
        {isDrawn ? (
          <DrawingNode
            node={snapshot.tree}
            plugin={plugin}
            requestId={requestId}
            index={0}
            engine={engine}
            component={component}
          />
        ) : null}
        {snapshot.status === 'failed' && (
          <Text dimColor wrap="truncate-end">
            {snapshot.text}
          </Text>
        )}
      </Box>
    </PaneErrorBoundary>
  );
}

function HoverBox({
  isInline,
  props,
  hover,
  plugin,
  elementKey,
  elementPlugin,
  children,
}: {
  isInline: boolean;
  props: Record<string, unknown>;
  hover: Record<string, unknown>;
  plugin?: string;
  elementKey?: string;
  elementPlugin?: string;
  children: ReactNode;
}): ReactNode {
  const [hot, setHot] = useState(false);
  const scope = usePluginHoverScope(plugin ?? elementPlugin, hover);
  const active = scope.isScoped ? scope.isHot : hot;
  if (isInline) {
    const textProps = {
      ...textStyleFrom(props),
      ...(active ? textStyleFrom(hover) : {}),
    };
    return (
      <Text
        {...textProps}
        hoverFollowsPaint={true}
        onMouseEnter={() => {
          setHot(true);
          scope.onMouseEnter();
        }}
        onMouseLeave={() => {
          setHot(false);
          scope.onMouseLeave();
        }}
      >
        {children}
      </Text>
    );
  }
  const layout = { ...layoutFrom(props), ...(active ? layoutFrom(hover) : {}) };
  return (
    <Box
      {...layout}
      {...(elementKey !== undefined && { elementKey })}
      {...(elementPlugin !== undefined && { elementPlugin })}
      flexDirection={layout.flexDirection ?? 'column'}
      hoverFollowsPaint={true}
      onMouseEnter={() => {
        setHot(true);
        scope.onMouseEnter();
      }}
      onMouseLeave={() => {
        setHot(false);
        scope.onMouseLeave();
      }}
    >
      {children}
    </Box>
  );
}

/**
 * densable `pt` → Ink: Button/Input/Select/Code/Markdown/Client/Svg/Link/Raster/Image/engine/Box/Text.
 * Stamps plugin onto Raster like gold `Te`.
 */
export function DrawingNode({
  node: rawNode,
  plugin: fallbackPlugin,
  requestId,
  index,
  engine,
  seenKeys,
  component = 'AbovePrompt',
  scrollXNormalized = false,
}: {
  node: unknown;
  plugin: string;
  requestId?: string;
  index: number;
  /** densable `pt` `i(ref)` — engine node. Pane/AbovePrompt is null; UserMessage is the engine draw. */
  engine?: ReactNode;
  seenKeys?: Set<unknown>;
  /** densable `Z` / Client `L1t` component. */
  component?: string;
  /** Internal flag so `normalizeModScrollXTree` runs once per root drawing tree. */
  scrollXNormalized?: boolean;
}): ReactNode {
  const node = scrollXNormalized ? rawNode : normalizeModScrollXTree(rawNode);
  if (typeof node === 'string') return <Text>{node}</Text>;
  if (Array.isArray(node)) {
    return flattenDrawingChildren(node).map((child, i) => (
      <DrawingNode
        key={i}
        node={child}
        plugin={fallbackPlugin}
        requestId={requestId}
        index={i}
        engine={engine}
        component={component}
        scrollXNormalized
      />
    ));
  }
  if (!isRecord(node)) return null;
  if (node.type === 'engine') return engine ?? null;
  const props = isRecord(node.props) ? node.props : node;
  const type = typeof node.type === 'string' ? node.type : undefined;
  const key = (typeof props.key === 'string' && props.key) || (typeof node.key === 'string' && node.key) || undefined;
  const plugin = stampedPlugin(node, fallbackPlugin);
  const owner = plugin;
  const req =
    (typeof props.requestId === 'string' && props.requestId) ||
    (typeof node.requestId === 'string' && node.requestId) ||
    requestId;
  const columns =
    typeof props.columns === 'number' ? props.columns : typeof node.columns === 'number' ? node.columns : 1;
  const rows = typeof props.rows === 'number' ? props.rows : typeof node.rows === 'number' ? node.rows : 1;
  const cells = typeof props.cells === 'string' ? props.cells : typeof node.cells === 'string' ? node.cells : undefined;
  if (type === 'Raster' && key && req) {
    return (
      <PluginRaster
        key={`raster:${plugin}:${key}`}
        plugin={plugin}
        requestId={req}
        elementKey={key}
        columns={columns}
        rows={rows}
        cells={cells}
      />
    );
  }
  if (type === 'Image' && key && req) {
    const alt = typeof props.alt === 'string' ? props.alt : typeof node.alt === 'string' ? node.alt : undefined;
    const imageSource = isRecord(props.source) ? props.source : isRecord(node.source) ? node.source : undefined;
    return (
      <PluginImage
        key={`image:${plugin}:${key}`}
        plugin={plugin}
        requestId={req}
        elementKey={key}
        source={imageSource}
        columns={columns}
        rows={rows}
        alt={alt}
      />
    );
  }
  if (type === 'Button') {
    const press = pressOf(node, owner);
    if (press === undefined) return null;
    const childLabel = childList(node, props)
      .filter((child): child is string => typeof child === 'string')
      .join('');
    const buttonHover = isRecord(node.hover) ? node.hover : isRecord(props.hover) ? props.hover : undefined;
    return (
      <PluginPressButton
        plugin={press.plugin}
        handle={press.handle}
        element={key}
        label={stringProp(props, node, 'label') ?? childLabel}
        hotkey={stringProp(props, node, 'hotkey')}
        action={stringProp(props, node, 'action')}
        plain={boolProp(props, 'plain')}
        dimColor={boolProp(props, 'dimColor')}
        variant={stringProp(props, node, 'variant')}
        hover={buttonHover}
        component={component}
      />
    );
  }
  if (type === 'Input') {
    const press = pressOf(node, owner);
    if (press === undefined) return null;
    return (
      <PluginPressInput
        plugin={press.plugin}
        handle={press.handle}
        element={key}
        label={stringProp(props, node, 'label')}
        placeholder={stringProp(props, node, 'placeholder')}
        value={stringProp(props, node, 'value')}
        submitLabel={stringProp(props, node, 'submitLabel')}
        rows={numberProp(props, node, 'rows')}
      />
    );
  }
  if (type === 'Select') {
    const press = pressOf(node, owner);
    if (press === undefined) return null;
    const rawOptions = props.options;
    const options = Array.isArray(rawOptions)
      ? rawOptions.flatMap(item => {
          if (!isRecord(item) || typeof item.value !== 'string') return [];
          return [
            {
              value: item.value,
              ...(typeof item.label === 'string' && { label: item.label }),
            },
          ];
        })
      : [];
    return (
      <PluginPressSelect
        plugin={press.plugin}
        handle={press.handle}
        label={stringProp(props, node, 'label')}
        element={key}
        options={options}
        value={stringProp(props, node, 'value')}
      />
    );
  }
  if (type === 'Code') {
    return (
      <PluginCode
        source={props.source}
        language={props.language}
        path={props.path}
        startLine={props.startLine}
        format={props.format}
        wrap={props.wrap}
      />
    );
  }
  if (type === 'Markdown') {
    const text = stringProp(props, node, 'text') ?? '';
    return (
      <PluginMarkdown
        text={text}
        dimColor={boolProp(props, 'dimColor')}
        press={'press' in node ? pressOf(node, owner) : undefined}
        elementKey={key}
        pressableLinks={props.pressableLinks}
      />
    );
  }
  if (type === 'Client') {
    return (
      <PluginClient
        key={`client:${plugin}:${key}`}
        plugin={plugin}
        moduleName={stringProp(props, node, 'module') ?? ''}
        elementKey={key}
        requestId={req}
        component={component}
        props={props.props}
        drawn={props}
        width={numberProp(props, node, 'width')}
        height={numberProp(props, node, 'height')}
        flexGrow={numberProp(props, node, 'flexGrow')}
        engine={engine}
      />
    );
  }
  if (type === 'Svg') {
    return <Text dimColor>{stringProp(props, node, 'alt') ?? ''}</Text>;
  }
  const kids = childList(node, props);
  const siblingKeys = new Set();
  const mapped = kids.map((child, i) =>
    (type === 'Text' || type === 'Link') && typeof child === 'string' ? (
      child
    ) : (
      <DrawingNode
        key={i}
        node={child}
        plugin={owner}
        requestId={req}
        index={i}
        engine={engine}
        seenKeys={siblingKeys}
        component={component}
        scrollXNormalized
      />
    ),
  );
  if (type === 'Link') {
    const href = stringProp(props, node, 'href') ?? '';
    const label = stringProp(props, node, 'label');
    // densable pane Link: visible URL is `PYe(k)`, OSC 8 url is `HYe(k)`.
    const shown = encodePluginLinkLabel(href);
    const inner = mapped.length > 0 ? mapped : [label ?? shown];
    const fallback =
      mapped.length === 0 && label === undefined ? undefined : (
        <Text>
          {inner} <Text dimColor>{shown}</Text>
        </Text>
      );
    return (
      <Link url={encodePluginLinkHref(href)} fallback={fallback}>
        {inner}
      </Link>
    );
  }
  const groupPlugin =
    isRecord(node.group) && typeof node.group.plugin === 'string' && node.group.plugin !== ''
      ? node.group.plugin
      : owner;
  const hover = isRecord(node.hover) ? node.hover : isRecord(props.hover) ? props.hover : undefined;
  if (type === 'Box' && key !== undefined) {
    const live = seenKeys === undefined || !seenKeys.has(key);
    if (seenKeys !== undefined) seenKeys.add(key);
    const layoutProps = { ...props };
    delete layoutProps.key;
    if (hover !== undefined) {
      return (
        <HoverBox
          key={live ? String(key) : undefined}
          isInline={false}
          props={layoutProps}
          hover={hover}
          plugin={groupPlugin}
          elementKey={String(key)}
          elementPlugin={owner}
        >
          {mapped}
        </HoverBox>
      );
    }
    return (
      <Box
        key={live ? String(key) : undefined}
        flexDirection="column"
        elementKey={String(key)}
        elementPlugin={owner}
        {...layoutFrom(layoutProps)}
      >
        {mapped}
      </Box>
    );
  }
  if (type === 'Text') {
    const normalizedTextProps = normalizeModTextWrapAndMaxLines(props);
    const rawText =
      typeof normalizedTextProps.text === 'string'
        ? normalizedTextProps.text
        : typeof node.text === 'string'
          ? node.text
          : mapped.length === 0
            ? null
            : undefined;
    const maxLines = modTextMaxLinesFrom(normalizedTextProps);
    const text = typeof rawText === 'string' && maxLines !== undefined ? clampModTextLines(rawText, maxLines) : rawText;
    const textProps = textStyleFrom(normalizedTextProps);
    const isClip = normalizedTextProps.wrap === 'clip';
    const content =
      hover !== undefined ? (
        <HoverBox isInline props={normalizedTextProps} hover={hover} plugin={groupPlugin}>
          {text !== undefined ? text : mapped}
        </HoverBox>
      ) : (
        <Text {...textProps}>{text !== undefined ? text : mapped}</Text>
      );
    if (maxLines !== undefined) {
      return (
        <Box flexDirection="column" maxHeight={maxLines} overflow="hidden" flexShrink={1}>
          {content}
        </Box>
      );
    }
    if (isClip) {
      return (
        <Box overflowX="hidden" flexShrink={1}>
          {content}
        </Box>
      );
    }
    return content;
  }
  if (hover !== undefined) {
    return (
      <HoverBox isInline={false} props={props} hover={hover} plugin={groupPlugin}>
        {mapped}
      </HoverBox>
    );
  }
  return (
    <Box flexDirection="column" key={key ?? index} {...layoutFrom(props)}>
      {mapped}
    </Box>
  );
}

function extractEngineSlotProps(node: unknown): Record<string, unknown> | undefined {
  if (!isRecord(node)) return undefined;
  if (node.type === 'engine') {
    return isRecord(node.props) ? node.props : undefined;
  }
  if (node.type === 'Button' || node.type === 'Input' || node.type === 'Select') {
    return undefined;
  }
  const props = isRecord(node.props) ? node.props : {};
  for (const child of childList(node, props)) {
    const found = extractEngineSlotProps(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * densable `fr` / `ar` consumer: `Hoe().ui.render` then `pt`. Fail and
 * engine reply settle as gold `RZ` so `pr` can see `isFallback`.
 */
export function useRenderDrawing(
  input: Record<string, unknown> | null,
  inputKey: string,
): {
  drawn: unknown;
  drawnPlugin: string;
  engineProps: Record<string, unknown> | undefined;
  markThrown: () => void;
} {
  const [drawn, setDrawn] = useState<unknown>(undefined);
  const [drawnPlugin, setDrawnPlugin] = useState('');
  const [engineProps, setEngineProps] = useState<Record<string, unknown> | undefined>(undefined);
  const inputRef = useRef(input);
  inputRef.current = input;
  const version = useSyncExternalStore(subscribeRenderInvalidation, renderVersion, renderVersion);
  useSyncExternalStore(subscribeRasterFrames, snapshot, snapshot);
  useEffect(() => {
    const current = inputRef.current;
    if (current === null) {
      setDrawn(undefined);
      setDrawnPlugin('');
      setEngineProps(undefined);
      return;
    }
    const abort = new AbortController();
    void evaluateUiRender(current, abort.signal).then(
      tree => {
        if (!abort.signal.aborted) {
          const owner =
            extractDrawnPlugin(tree, String(current.component ?? ''), String(current.requestId ?? '')) ??
            getLastUiRenderPlugin();
          setDrawnPlugin(owner);
          setEngineProps(extractEngineSlotProps(tree));
          setDrawn(isEngineDrawing(tree) ? RZ : tree);
        }
      },
      err => {
        // densable `mr` — site failed log then engine fallback (`RZ`).
        logForDebugging(
          `ui.render (${String(current.component)} ${String(current.requestId ?? '')}): site failed: ${err instanceof Error ? err.message : String(err)}`,
          { level: 'error' },
        );
        if (!abort.signal.aborted) {
          setEngineProps(undefined);
          setDrawn(RZ);
        }
      },
    );
    return () => {
      abort.abort();
    };
  }, [inputKey, version]);
  const markThrown = useCallback(() => {
    setEngineProps(undefined);
    setDrawn(RZ);
  }, []);
  return { drawn, drawnPlugin, engineProps, markThrown };
}

function PluginSiteFields({
  children,
  site = 'Pane',
  requestId,
  focusables,
  selectSeat,
  inputSeat,
  inputFocusHost,
}: {
  children: ReactNode;
  /** densable `$q` `XP(focusable, site)` — Pane vs AbovePrompt. */
  site?: 'Pane' | 'AbovePrompt';
  /** densable `kL` requestId — Pane id or above-prompt. */
  requestId?: string;
  focusables?: readonly DrawingFocusable[];
  /** densable `_Ee`/`pee` lifted y$ — same object as g$ `fr`. */
  selectSeat: PluginSelectSeat;
  /** densable `_Ee`/`pee` lifted m$ — same object as g$ `rr`/`inputs`. */
  inputSeat: PluginInputMapApi;
  /** densable `_Ee` Input focus — parent ring land, not a process bridge. */
  inputFocusHost?: BandInputFocusHost;
}): ReactNode {
  const ySelect = selectSeat;
  const open = ySelect.fields.open;
  const [localFocused, setLocalFocused] = useState<FocusedInput | null>(null);
  const focused = inputFocusHost !== undefined ? inputFocusHost.focused : localFocused;
  const setFocused = inputFocusHost?.setFocused ?? setLocalFocused;
  const fieldsRef = useRef<InputFields | null>(null);
  const selectRef = useRef<SelectFields | null>(null);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const fields: InputFields = {
    textOf: inputSeat.fields.textOf,
    edit: inputSeat.fields.edit,
    textNow: inputSeat.textNow,
    submit: inputSeat.submit,
  };
  const select: SelectFields = {
    pickedOf: ySelect.fields.pickedOf,
    open,
    toggle: ySelect.toggle,
    move: ySelect.move,
    typeahead: ySelect.typeahead,
    close: ySelect.close,
    focusedSelect: ySelect.focusedSelect,
    focus: ySelect.focus,
    unfocus: ySelect.unfocus,
  };
  fieldsRef.current = fields;
  selectRef.current = select;
  // densable `nr=s$(ts,Gn)` — open Select extra rows into *band* maxHeight.
  // Gold `_Ee` only; Pane Select must not bump the AbovePrompt store.
  const openOptionCount = open?.options.length ?? 0;
  useEffect(() => {
    if (site !== 'AbovePrompt') return;
    setOpenListRows(openListRows(open, openOptionCount));
    return () => setOpenListRows(0);
  }, [open, openOptionCount, site]);
  const focusApi = useMemo(
    () => ({
      focused,
      setFocused: (next: FocusedInput | null) => {
        if (next !== null) ySelect.close();
        setFocused(next);
      },
    }),
    [focused, setFocused, ySelect],
  );
  const keys = useOptionalKeybindingContext();
  const fieldHeld = focused !== null || open !== null || ySelect.focusedSelect !== null;
  const renderedFocus = useRef({ focused, select: ySelect.focusedSelect });
  useEffect(() => {
    renderedFocus.current = { focused, select: ySelect.focusedSelect };
  });
  useLayoutEffect(() => {
    setPaneFieldHeld(fieldHeld);
    return () => setPaneFieldHeld(false);
  }, [fieldHeld]);
  useInput(
    (input, key, event) => {
      if (key.wheelUp || key.wheelDown) return;
      const selectNow = selectRef.current;
      const focusedSelect = selectNow?.focusedSelect ?? null;
      const openNow = selectNow?.open ?? null;
      const heldNow = focusedRef.current;
      const rendered = renderedFocus.current;
      const isAhead = pluginKeysAreAhead({ focused: heldNow, select: focusedSelect }, rendered);
      const contextNow = pluginFieldContext(
        focusedSelect !== null ? 'Select' : heldNow !== null ? 'Input' : undefined,
        site,
      );
      const contextRendered = pluginFieldContext(
        rendered.select !== null && rendered.select !== undefined
          ? 'Select'
          : rendered.focused !== null && rendered.focused !== undefined
            ? 'Input'
            : undefined,
        site,
      );
      let selectIntercepted = false;
      if (focusedSelect !== null && selectNow !== null) {
        // densable y$.intercept → g$ selectKeys (site usePluginBandKeys + local useInput).
        if (ySelect.intercept(input, key)) {
          event.stopImmediatePropagation();
          return;
        }
        if (openNow !== null) {
          if (key.downArrow) {
            selectNow.move(1);
            event.stopImmediatePropagation();
            return;
          }
          if (key.upArrow) {
            selectNow.move(-1);
            event.stopImmediatePropagation();
            return;
          }
          if (key.return) {
            selectNow.toggle({
              plugin: openNow.plugin,
              handle: openNow.handle,
              element: openNow.element,
              options: openNow.options,
            });
            event.stopImmediatePropagation();
            return;
          }
        }
        selectIntercepted = true;
      }
      /**
       * densable `$q`: if !isAhead, do not steal (keys go to rendered Pane).
       * Select intercept above is gold `x_(Kq.intercept)` and still runs.
       * Then Global match → do not steal; then Input Wq/jq.
       */
      if (!isAhead) return;
      const nowHit = keys?.resolve(input, key, [contextNow]);
      if (nowHit?.type === 'match') {
        event.stopImmediatePropagation();
        return;
      }
      const globalHit = keys?.resolve(input, key, ['Global']);
      if (globalHit?.type === 'match') return;
      const renderedHit = keys?.resolve(input, key, [contextRendered]);
      if (renderedHit?.type === 'match') {
        event.stopImmediatePropagation();
        return;
      }
      const held = focusedRef.current;
      const inputFields = fieldsRef.current;
      if (held === null || inputFields === null) return;
      if (selectIntercepted) return;
      const shown = inputFields.textNow(held);
      if (key.backspace) {
        inputFields.edit(held, [...shown].slice(0, -1).join(''));
        event.stopImmediatePropagation();
        return;
      }
      const typed = input === '' ? event.input : input;
      if (pluginInputIsTyped(typed, key)) {
        inputFields.edit(held, shown + typed);
        event.stopImmediatePropagation();
        return;
      }
      if (pluginInputIsNav(input, key)) {
        event.stopImmediatePropagation();
      }
    },
    { isActive: fieldHeld, prepend: true },
  );
  return (
    <FocusedInputContext.Provider value={focusApi}>
      <InputFieldsContext.Provider value={fields}>
        <SelectFieldsContext.Provider value={select}>{children}</SelectFieldsContext.Provider>
      </InputFieldsContext.Provider>
    </FocusedInputContext.Provider>
  );
}

export function PluginSiteFieldsOwned({
  children,
  site = 'Pane',
  requestId,
  focusables,
  selectRing,
}: {
  children: ReactNode;
  site?: 'Pane' | 'AbovePrompt';
  requestId?: string;
  focusables?: readonly DrawingFocusable[];
  selectRing?: PluginSelectSeatRing;
}): ReactNode {
  const seatRequestId = requestId ?? (site === 'AbovePrompt' ? BAND_REQUEST_ID : 'Pane');
  const selectSeat = usePluginSelectSeat(focusables, site, seatRequestId, selectRing);
  const inputSeat = usePluginInputSeat(focusables, site, seatRequestId);
  return (
    <PluginSiteFields
      site={site}
      requestId={requestId}
      focusables={focusables}
      selectSeat={selectSeat}
      inputSeat={inputSeat}
    >
      {children}
    </PluginSiteFields>
  );
}

export function rebuild(
  drawn: unknown,
  plugin: string,
  requestId: string,
  engine?: ReactNode,
  site: 'Pane' | 'AbovePrompt' = 'Pane',
  focusables?: readonly DrawingFocusable[],
  selectSeat?: PluginSelectSeat,
  inputSeat?: PluginInputMapApi,
  inputFocusHost?: BandInputFocusHost,
  component: string = site,
): ReactNode {
  if (drawn === undefined || isEngineDrawing(drawn)) return engine ?? null;
  const node = (
    <DrawingNode node={drawn} plugin={plugin} requestId={requestId} index={0} engine={engine} component={component} />
  );
  if (selectSeat !== undefined && inputSeat !== undefined) {
    return (
      <PluginSiteFields
        site={site}
        requestId={requestId}
        focusables={focusables}
        selectSeat={selectSeat}
        inputSeat={inputSeat}
        inputFocusHost={inputFocusHost}
      >
        {node}
      </PluginSiteFields>
    );
  }
  return (
    <PluginSiteFieldsOwned site={site} requestId={requestId} focusables={focusables}>
      {node}
    </PluginSiteFieldsOwned>
  );
}
