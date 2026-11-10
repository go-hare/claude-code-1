import figures from 'figures';
import type { ReactNode } from 'react';
import React from 'react';
import type { ClickEvent } from '../core/events/click-event.js';
import { useDeclaredCursor } from '../hooks/use-declared-cursor.js';
import { Box, Text } from '../index.js';

type ListItemProps = {
  /**
   * Whether this item is currently focused (keyboard selection).
   * Shows the pointer indicator (❯) when true.
   */
  isFocused: boolean;

  /**
   * Whether this item is selected (chosen/checked).
   * Shows the checkmark indicator (✓) when true.
   * @default false
   */
  isSelected?: boolean;

  /**
   * The content to display for this item.
   */
  children: ReactNode;

  /**
   * densable `Ko` icon slot. Painted beside the label, not inside it,
   * so focus color does not swallow the status glyph.
   */
  icon?: ReactNode;
  /** densable `Ko` icon column. 0 means shrink to the glyph. */
  iconWidth?: number;
  /**
   * densable `Ko` has no pointer column. Set when the row's first cell is
   * the icon, not `IC`'s focus glyph.
   */
  hideIndicator?: boolean;
  /** densable `Ko` facts column, after the name. */
  meta?: readonly string[];
  /** densable `Ko` facts column width. 0 shrinks to the text. */
  metaWidth?: number;
  /** densable `Ko` name column width when facts are present. */
  nameWidth?: number;

  /**
   * Optional description text displayed below the main content.
   */
  description?: string;

  /**
   * Show a down arrow indicator instead of pointer (for scroll hints).
   * Only applies when not focused.
   */
  showScrollDown?: boolean;

  /**
   * Show an up arrow indicator instead of pointer (for scroll hints).
   * Only applies when not focused.
   */
  showScrollUp?: boolean;

  /**
   * Whether to apply automatic styling to the children based on focus/selection state.
   * - When true (default): children are wrapped in Text with state-based colors
   * - When false: children are rendered as-is, allowing custom styling
   * @default true
   */
  styled?: boolean;

  /**
   * Whether this item is disabled. Disabled items show dimmed text and no indicators.
   * @default false
   */
  disabled?: boolean;

  /**
   * densable `IC` `idle`: keeps the `❯` pointer dimmed while focus is parked elsewhere (e.g. Tabs header).
   * @default false
   */
  idle?: boolean;

  /**
   * Whether this ListItem should declare the terminal cursor position.
   * Set false when a child (e.g. BaseTextInput) declares its own cursor.
   * @default true
   */
  declareCursor?: boolean;

  /** densable Select option click (yln-guarded by the caller). */
  onClick?: (event: ClickEvent) => void;

  /**
   * densable `IC` `oi` `hovered` — dim pointer when hoverStyle is pointer.
   */
  hovered?: boolean;

  /**
   * densable `IC` `oi` `inverse` — hoverStyle inverse.
   */
  inverse?: boolean;

  /**
   * densable `IC`/`Zi` hover Box — `backgroundColor:q` / `Oe`.
   */
  backgroundColor?: 'userMessageBackground';

  /** densable `IC` `onMouseEnter` / `onMouseLeave`. */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

/**
 * A list item component with focus and selection indicators.
 *
 * Visual states:
 * - Focused: Shows ❯ pointer indicator
 * - Selected: Shows ✓ checkmark
 * - Both: Shows both indicators
 * - Scroll hints: Shows ↑/↓ arrows when at list edges
 *
 * @example
 * // Basic usage
 * <ListItem isFocused={index === focusedIndex} isSelected={selected.has(item)}>
 *   {item.label}
 * </ListItem>
 *
 * @example
 * // With scroll indicators
 * <ListItem isFocused={false} showScrollUp>First visible item</ListItem>
 * ...
 * <ListItem isFocused={false} showScrollDown>Last visible item</ListItem>
 *
 * @example
 * // With description
 * <ListItem isFocused isSelected={false} description="Secondary text here">
 *   Primary text
 * </ListItem>
 *
 * @example
 * // Custom children styling (styled=false)
 * <ListItem isFocused styled={false}>
 *   <Text color="claude">Custom styled content</Text>
 * </ListItem>
 */
export function ListItem({
  isFocused,
  isSelected = false,
  children,
  icon,
  iconWidth = 0,
  hideIndicator = false,
  meta,
  metaWidth = 0,
  nameWidth,
  description,
  showScrollDown,
  showScrollUp,
  styled = true,
  disabled = false,
  idle = false,
  declareCursor,
  onClick,
  hovered = false,
  inverse = false,
  backgroundColor,
  onMouseEnter,
  onMouseLeave,
}: ListItemProps): React.ReactNode {
  // densable `IC` `oi`.
  function renderIndicator(): ReactNode {
    if (disabled) {
      return <Text aria-hidden> </Text>;
    }

    if (isFocused) {
      return (
        <Text aria-hidden color={idle ? undefined : 'suggestion'} dimColor={idle} inverse={inverse}>
          {figures.pointer}
        </Text>
      );
    }

    if (showScrollDown) {
      return (
        <Text aria-label="(more below)" dimColor inverse={inverse}>
          {figures.arrowDown}
        </Text>
      );
    }

    if (showScrollUp) {
      return (
        <Text aria-label="(more above)" dimColor inverse={inverse}>
          {figures.arrowUp}
        </Text>
      );
    }

    if (hovered) {
      return (
        <Text aria-hidden dimColor>
          {figures.pointer}
        </Text>
      );
    }

    return (
      <Text aria-hidden inverse={inverse}>
        {' '}
      </Text>
    );
  }

  // Determine text color based on state
  function getTextColor(): 'success' | 'suggestion' | 'inactive' | undefined {
    if (disabled) {
      return 'inactive';
    }

    if (!styled) {
      return undefined;
    }

    if (isSelected) {
      return 'success';
    }

    if (isFocused && !idle) {
      return 'suggestion';
    }

    return undefined;
  }

  const textColor = getTextColor();

  // densable IC → Vb({line:0,column:0,active:ie}) — no visible field;
  // DualInk Vb defaults visible:u=!1. Do not invent visible:!0.
  // Park the native terminal cursor on the pointer indicator so screen
  // readers / magnifiers track the focused item. (0,0) is the top-left of
  // this Box, where the pointer renders.
  const cursorRef = useDeclaredCursor({
    line: 0,
    column: 0,
    active: isFocused && !disabled && declareCursor !== false,
  });

  // densable IC: `flexDirection:"column", backgroundColor, onClick, enter/leave`
  // only — no alignItems/alignSelf stretch.
  return (
    <Box
      ref={cursorRef}
      flexDirection="column"
      backgroundColor={backgroundColor}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Box flexDirection="row" gap={1}>
        {hideIndicator ? null : <Box flexShrink={0}>{renderIndicator()}</Box>}
        {icon != null ? (
          <Box flexShrink={0} width={iconWidth > 0 ? iconWidth : undefined}>
            {icon}
          </Box>
        ) : null}
        {meta !== undefined && meta.length > 0 && nameWidth !== undefined ? (
          <Box flexShrink={0} width={nameWidth} marginRight={2}>
            {styled ? (
              <Text color={textColor} dimColor={disabled} wrap="truncate-end">
                {children}
              </Text>
            ) : (
              children
            )}
          </Box>
        ) : styled ? (
          <Text color={textColor} dimColor={disabled} wrap="truncate-end">
            {children}
          </Text>
        ) : (
          children
        )}
        {meta !== undefined && meta.length > 0 ? (
          <Box flexShrink={1} maxWidth={metaWidth > 0 ? metaWidth : undefined}>
            <Text dimColor wrap="truncate-end">
              {meta.join(' · ')}
            </Text>
          </Box>
        ) : null}
        {isSelected && !disabled && (
          <Box flexShrink={0}>
            <Text aria-label="(selected)" color="success">
              {figures.tick}
            </Text>
          </Box>
        )}
      </Box>
      {description && (
        <Box paddingLeft={(hideIndicator ? 0 : 2) + (icon != null && iconWidth > 0 ? iconWidth + 1 : 0)}>
          <Text color="inactive" wrap="truncate-end">
            {description}
          </Text>
        </Box>
      )}
    </Box>
  );
}
