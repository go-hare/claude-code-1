import chalk from 'chalk';
import React, {
  createContext,
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
import { ClockContext } from '../components/ClockContext.js';
import ScrollBox from '../components/ScrollBox.js';
import type { DOMElement } from '../core/dom.js';
import { type ClickEvent, MOUNT_SETTLE_MS } from '../core/events/click-event.js';
import type { KeyboardEvent } from '../core/events/keyboard-event.js';
import { isInTree } from '../core/focus.js';
import measureElement from '../core/measure-element.js';
import { stringWidth } from '../core/stringWidth.js';
import useApp from '../hooks/use-app.js';
import { useDeclaredCursor } from '../hooks/use-declared-cursor.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text } from '../index.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import {
  ModalContext,
  useIsInsideModal,
  useModalClaimScrollBox,
  useModalOrTerminalSize,
  useModalScrollRef,
} from './modalContext.js';
import type { Theme } from './theme-types.js';

const noopSubscribe = () => () => {};

function useRegistrationCounter(): [boolean, () => () => void] {
  const [count, setCount] = useState(0);
  const register = useCallback(() => {
    setCount(n => n + 1);
    return () => setCount(n => n - 1);
  }, []);
  return [count > 0, register];
}

function useStrayTabClickGuard(): (event: ClickEvent) => boolean {
  const clock = useContext(ClockContext);
  const [mountedAt] = useState(() => clock?.now() ?? Date.now());
  return useCallback(
    (event: ClickEvent) => {
      const now = clock?.now() ?? Date.now();
      if (event.isWindowActivation || now - mountedAt < MOUNT_SETTLE_MS) {
        event.dropAsStray();
        return true;
      }
      return false;
    },
    [clock, mountedAt],
  );
}

type TabsProps = {
  children: Array<React.ReactElement<TabProps>>;
  title?: string;
  color?: keyof Theme;
  defaultTab?: string;
  hidden?: boolean;
  useFullWidth?: boolean;
  /** Controlled mode: current selected tab id/title */
  selectedTab?: string;
  /** Controlled mode: callback when tab changes */
  onTabChange?: (tabId: string) => void;
  /** Optional banner to display below tabs header */
  banner?: React.ReactNode;
  /** Disable keyboard navigation (e.g. when a child component handles arrow keys) */
  disableNavigation?: boolean;
  /**
   * Initial focus state for the tab header row. Defaults to true (header
   * focused, nav always works). Keep the default for Select/list content —
   * those only use up/down so there's no conflict; pass
   * isDisabled={headerFocused} to the Select instead. Only set false when
   * content actually binds left/right/tab (e.g. enum cycling), and show a
   * "↑ tabs" footer hint — without it tabs look broken.
   */
  initialHeaderFocused?: boolean;
  /**
   * Fixed height for the content area. When set, all tabs render within the
   * same height (overflow hidden) so switching tabs doesn't cause layout
   * shifts. Shorter tabs get whitespace; taller tabs are clipped.
   */
  contentHeight?: number;
  /**
   * densable `stableHeight` — inside modal ScrollBox uses fixed `height` instead
   * of `maxHeight`; outside modal uses `minHeight` instead of `height`+clip.
   */
  stableHeight?: boolean;
  /**
   * Let Tab/←/→ switch tabs from focused content. Opt-in since some
   * content uses those keys; pass a reactive boolean to cede them when
   * needed. Switching from content focuses the header.
   */
  navFromContent?: boolean;
};

type TabsContextValue = {
  selectedTab: string | undefined;
  width: number | undefined;
  headerFocused: boolean;
  focusHeader: () => void;
  blurHeader: () => void;
  registerOptIn: () => () => void;
  registerNavigationOwner: () => () => void;
};

const TabsContext = createContext<TabsContextValue>({
  selectedTab: undefined,
  width: undefined,
  // Default for components rendered outside a Tabs (tests, standalone):
  // content has focus, focusHeader is a no-op.
  headerFocused: false,
  focusHeader: () => {},
  blurHeader: () => {},
  registerOptIn: () => () => {},
  registerNavigationOwner: () => () => {},
});

const EMPTY_MODAL_FALLBACK = { rows: 0, columns: 0 };

export function Tabs({
  title,
  color,
  defaultTab,
  children,
  hidden,
  useFullWidth,
  selectedTab: controlledSelectedTab,
  onTabChange,
  banner,
  disableNavigation,
  initialHeaderFocused = true,
  contentHeight,
  stableHeight = false,
  navFromContent = false,
}: TabsProps): React.ReactNode {
  // densable 2.1.216 #23: inside FullscreenLayout modal, ModalContext.columns
  // is terminal-4 (paddingX=2 each side). useTerminalSize() alone over-reports
  // and lets tab content/dialogs stretch past the panel's right edge.
  const terminalSize = useTerminalSize();
  const { columns: terminalWidth } = useModalOrTerminalSize(terminalSize);
  const tabs = children.map(child => [child.props.id ?? child.props.title, child.props.title] as const);
  const defaultTabIndex = defaultTab ? tabs.findIndex(tab => defaultTab === tab[0]) : 0;

  // Support both controlled and uncontrolled modes
  const isControlled = controlledSelectedTab !== undefined;
  const [internalSelectedTab, setInternalSelectedTab] = useState(defaultTabIndex !== -1 ? defaultTabIndex : 0);

  // In controlled mode, find the index of the controlled tab
  const controlledTabIndex = isControlled ? tabs.findIndex(tab => tab[0] === controlledSelectedTab) : -1;
  const selectedTabIndex = isControlled ? (controlledTabIndex !== -1 ? controlledTabIndex : 0) : internalSelectedTab;

  const modalContext = useContext(ModalContext);
  const modalScrollRef = useModalScrollRef();
  const claimScrollBox = useModalClaimScrollBox();

  const bannerRef = useRef<DOMElement>(null);
  const [bannerHeight, setBannerHeight] = useState(0);
  const headerRef = useRef<DOMElement>(null);
  const [headerHeight, setHeaderHeight] = useState(1);

  useLayoutEffect(() => {
    const nextBannerHeight = bannerRef.current ? measureElement(bannerRef.current).height : 0;
    if (nextBannerHeight !== bannerHeight) setBannerHeight(nextBannerHeight);
    const nextHeaderHeight = headerRef.current ? Math.max(1, measureElement(headerRef.current).height) : 1;
    if (nextHeaderHeight !== headerHeight) setHeaderHeight(nextHeaderHeight);
  });

  // densable e_ @202788797: `oe = (hidden ? 0 : headerHeight + 1) + bannerHeight`
  const headerChromeRows = (hidden ? 0 : headerHeight + 1) + bannerHeight;
  useLayoutEffect(() => {
    if (!claimScrollBox) {
      return;
    }
    claimScrollBox(headerChromeRows);
    return () => claimScrollBox(null);
  }, [claimScrollBox, headerChromeRows]);

  const { rows: modalRows } = useModalOrTerminalSize(EMPTY_MODAL_FALLBACK);
  const ownsModalScroll = claimScrollBox != null && modalScrollRef !== null;
  const contentMaxRows = ownsModalScroll ? Math.max(0, modalRows - headerChromeRows) : undefined;
  const innerModalContext = useMemo(
    () => (modalContext && ownsModalScroll ? { ...modalContext, claimScrollBox: null } : null),
    [modalContext, ownsModalScroll],
  );

  const { focusManager, rootNode } = useApp();
  const [headerFocused, setHeaderFocused] = useState(initialHeaderFocused);
  const focusHeader = useCallback(() => {
    if (headerRef.current) focusManager?.focus(headerRef.current);
    setHeaderFocused(true);
  }, [focusManager]);
  const blurHeader = useCallback(() => {
    focusManager?.blur();
    setHeaderFocused(false);
  }, [focusManager]);

  const [optedIn, registerOptIn] = useRegistrationCounter();
  const [navOwned, registerNavigationOwner] = useRegistrationCounter();
  const navigationDisabled = Boolean(disableNavigation || navOwned);
  const headerNavActive = headerFocused || !optedIn;

  const contentRef = useRef<DOMElement>(null);
  const contentHasFocus = useSyncExternalStore(
    focusManager?.subscribe ?? noopSubscribe,
    () => {
      const contentEl = contentRef.current;
      const active = focusManager?.activeElement;
      if (!contentEl || !active) return false;
      return isInTree(active, contentEl);
    },
    () => false,
  );
  const showHeaderCursor = (!optedIn ? !contentHasFocus : headerNavActive) && !navigationDisabled;

  const [tabEpoch, bumpTabEpoch] = useReducer((n: number) => n + 1, 0);
  const pendingTabRef = useRef<{ epoch: number; index: number } | null>(null);

  const selectTabIndex = (newIndex: number, keepContentFocus = false) => {
    pendingTabRef.current = { epoch: tabEpoch, index: newIndex };
    bumpTabEpoch();
    const newTabId = tabs[newIndex]?.[0];
    if (isControlled && onTabChange && newTabId) {
      onTabChange(newTabId);
    } else {
      setInternalSelectedTab(newIndex);
    }
    if (keepContentFocus) return;
    focusHeader();
  };

  const handleTabChange = (offset: number, keepContentFocus = false) => {
    const pending = pendingTabRef.current;
    const baseIndex = pending?.epoch === tabEpoch ? pending.index : selectedTabIndex;
    selectTabIndex((baseIndex + tabs.length + offset) % tabs.length, keepContentFocus);
  };

  useKeybindings(
    {
      'tabs:next': () => handleTabChange(1),
      'tabs:previous': () => handleTabChange(-1),
    },
    {
      context: 'Tabs',
      isActive: !hidden && !navigationDisabled && headerNavActive,
    },
  );

  // When the header is focused, down-arrow returns focus to content. Only
  // active when the selected tab has opted in via useTabHeaderFocus() —
  // legacy tabs have nowhere to return focus to.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (hidden || navigationDisabled) return;
    if (!headerFocused) {
      if (
        e.key === 'left' ||
        e.key === 'right' ||
        e.key === 'tab' ||
        (optedIn && (e.key === 'up' || e.key === 'down'))
      ) {
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'left' || e.key === 'right' || e.key === 'tab') {
      e.preventDefault();
    } else if (e.key === 'down' && optedIn) {
      e.preventDefault();
      if (focusManager && rootNode) {
        focusManager.focusDirection('down', rootNode);
      }
      setHeaderFocused(false);
    }
  };

  // Opt-in: same tabs:next/previous actions, active from content.
  useKeybindings(
    {
      'tabs:next': () => handleTabChange(1, true),
      'tabs:previous': () => handleTabChange(-1, true),
    },
    {
      context: 'Tabs',
      isActive: navFromContent && !headerFocused && optedIn && !hidden && !navigationDisabled,
    },
  );

  // Calculate spacing to fill the available width. No keyboard hint in the
  // header row — content footers own hints (see useTabHeaderFocus docs).
  const titleWidth = title ? stringWidth(title) + 1 : 0; // +1 for gap
  const tabsWidth = tabs.reduce(
    (sum, [, tabTitle]) => sum + (tabTitle ? stringWidth(tabTitle) : 0) + 2 + 1, // +2 for padding, +1 for gap
    0,
  );
  const usedWidth = titleWidth + tabsWidth;
  const spacerWidth = useFullWidth ? Math.max(0, terminalWidth - usedWidth) : 0;

  const contentWidth = useFullWidth ? terminalWidth : undefined;

  return (
    <TabsContext.Provider
      value={{
        selectedTab: tabs[selectedTabIndex]![0],
        width: contentWidth,
        headerFocused,
        focusHeader,
        blurHeader,
        registerOptIn,
        registerNavigationOwner,
      }}
    >
      <Box
        flexDirection="column"
        // flexShrink=0 inside modal slot — the modal's absolute Box has no
        // explicit height (grows to fit, maxHeight cap), so flexGrow=1 here
        // resolves to 0 on re-render and the body blanks on Down arrow.
        // See #23592. Outside modal, leave layout alone.
        flexShrink={modalScrollRef ? 0 : undefined}
      >
        {!hidden && (
          <Box
            ref={headerRef}
            tabIndex={0}
            autoFocus={initialHeaderFocused}
            onFocus={() => setHeaderFocused(true)}
            onBlur={() => setHeaderFocused(false)}
            onKeyDown={handleKeyDown}
            flexDirection="row"
            flexWrap="wrap"
            columnGap={1}
            flexShrink={modalScrollRef ? 0 : undefined}
            alignSelf={!useFullWidth ? 'flex-start' : undefined}
          >
            {title !== undefined && (
              <Box flexShrink={0}>
                <Text bold color={color}>
                  {title}
                </Text>
              </Box>
            )}
            {tabs.map(([id, tabTitle], i) => (
              <TabHeaderItem
                key={id}
                title={tabTitle}
                isCurrent={selectedTabIndex === i}
                headerFocused={showHeaderCursor}
                color={color ?? 'suggestion'}
                onClick={navigationDisabled ? undefined : () => selectTabIndex(i)}
              />
            ))}
            {spacerWidth > 0 && <Text>{' '.repeat(spacerWidth)}</Text>}
          </Box>
        )}
        {banner != null && (
          <Box ref={bannerRef} flexDirection="column" flexShrink={0}>
            {banner}
          </Box>
        )}
        {ownsModalScroll ? (
          // Inside the modal slot: own the ScrollBox here so the tabs
          // header row above sits OUTSIDE the scroll area — it can never
          // scroll off. The ref reaches REPL's ScrollKeybindingHandler via
          // ModalContext. Keyed by selectedTabIndex → remounts on tab
          // switch, resetting scrollTop to 0 without scrollTo() timing games.
          <Box ref={contentRef} width={contentWidth} marginTop={hidden ? 0 : 1} flexShrink={0}>
            <ScrollBox
              key={selectedTabIndex}
              ref={modalScrollRef}
              flexDirection="column"
              flexShrink={0}
              height={stableHeight ? contentMaxRows : undefined}
              maxHeight={stableHeight ? undefined : contentMaxRows}
              stickyScroll={false}
            >
              <ModalContext.Provider value={innerModalContext}>{children}</ModalContext.Provider>
            </ScrollBox>
          </Box>
        ) : (
          <Box
            ref={contentRef}
            width={contentWidth}
            marginTop={hidden ? 0 : 1}
            height={stableHeight ? undefined : contentHeight}
            minHeight={stableHeight ? contentHeight : undefined}
            overflowY={contentHeight !== undefined && !stableHeight ? 'hidden' : undefined}
            flexShrink={modalScrollRef ? 0 : undefined}
          >
            {children}
          </Box>
        )}
      </Box>
    </TabsContext.Provider>
  );
}

type TabHeaderItemProps = {
  title: string;
  isCurrent: boolean;
  headerFocused: boolean;
  color: keyof Theme | undefined;
  onClick: (() => void) | undefined;
};

function TabHeaderItem({ title, isCurrent, headerFocused, color, onClick }: TabHeaderItemProps): React.ReactNode {
  const [hovered, setHovered] = useState(false);
  const isStrayClick = useStrayTabClickGuard();
  const clickable = onClick !== undefined;
  const cursorRef = useDeclaredCursor({
    line: 0,
    column: 1,
    active: isCurrent && headerFocused,
  });
  const noColor = chalk.level === 0;
  const hasColorCursor = Boolean(color && isCurrent && headerFocused && !noColor);
  const handleClick =
    onClick === undefined
      ? undefined
      : (event: ClickEvent) => {
          if (isStrayClick(event)) return;
          onClick();
        };

  return (
    <Box
      ref={cursorRef}
      flexShrink={0}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hasColorCursor ? (
        <Text backgroundColor={color} color="inverseText" bold>
          {' '}
          {title}{' '}
        </Text>
      ) : (
        <Text inverse={isCurrent} bold={isCurrent} underline={hovered && clickable}>
          {' '}
          {title}{' '}
        </Text>
      )}
    </Box>
  );
}

type TabProps = {
  title: string;
  id?: string;
  children: React.ReactNode;
};

export function Tab({ title, id, children }: TabProps): React.ReactNode {
  const { selectedTab, width } = useContext(TabsContext);
  const insideModal = useIsInsideModal();
  if (selectedTab !== (id ?? title)) {
    return null;
  }

  return (
    <Box width={width} flexShrink={insideModal ? 0 : undefined}>
      {children}
    </Box>
  );
}

export function useTabsWidth(): number | undefined {
  const { width } = useContext(TabsContext);
  return width;
}

/**
 * Opt into header-focus gating. Returns the current header focus state and a
 * callback to hand focus back to the tab row. For a Select, pass
 * `isDisabled={headerFocused}` and `onUpFromFirstItem={focusHeader}`; keep the
 * parent Tabs' initialHeaderFocused at its default so tab/←/→ work on mount.
 *
 * Calling this hook registers a ↓-blurs-header opt-in on mount. Don't call it
 * above an early return that renders static text — ↓ will blur the header with
 * no onUpFromFirstItem to recover. Split the component so the hook only runs
 * when the Select renders.
 */
export function useTabHeaderFocus(): {
  headerFocused: boolean;
  focusHeader: () => void;
  blurHeader: () => void;
} {
  const { headerFocused, focusHeader, blurHeader, registerOptIn } = useContext(TabsContext);
  useLayoutEffect(registerOptIn, [registerOptIn]);
  return { headerFocused, focusHeader, blurHeader };
}

export function useTabNavigationOwner(): void {
  const { registerNavigationOwner } = useContext(TabsContext);
  useLayoutEffect(registerNavigationOwner, [registerNavigationOwner]);
}
