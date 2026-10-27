import React, { type ReactNode, useContext, useRef, useState } from 'react';
import chalk from 'chalk';
import figures from 'figures';
import { AccessibilityContext, Box, ListItem, Text, type ClickEvent, useDeclaredCursor } from '@anthropic/ink';
import {
  LeftoverIheWindowContext,
  LeftoverNnDtContext,
  leftoverNnDtBind,
  leftoverNnFit,
  leftoverNnIconCol,
  leftoverNnNameColor,
  leftoverNnSrLine,
  leftoverVdeInverse,
  leftoverVdePointer,
  leftoverVdeTint,
} from '../FullscreenLayout.js';
import type { DOMElement } from '@anthropic/ink';

export type SelectOptionProps = {
  /**
   * Determines if option is focused.
   */
  readonly isFocused: boolean;

  /**
   * Determines if option is selected.
   */
  readonly isSelected: boolean;

  /**
   * Option label.
   */
  readonly children: ReactNode;

  /**
   * Optional description to display below the label.
   */
  readonly description?: string;

  /**
   * Determines if the down arrow should be shown.
   */
  readonly shouldShowDownArrow?: boolean;

  /**
   * Determines if the up arrow should be shown.
   */
  readonly shouldShowUpArrow?: boolean;

  /**
   * Whether ListItem should declare the terminal cursor position.
   * Set false when a child declares its own cursor (e.g. BaseTextInput).
   */
  readonly declareCursor?: boolean;

  readonly onClick?: (event: ClickEvent) => void;

  /** densable Un Ko. */
  readonly icon?: ReactNode;
  readonly meta?: string[];
  readonly iconWidth?: number;
  readonly nameWidth?: number;
  readonly factsWidth?: number;

  /**
   * densable `$e` `Zi` `she` — default `tint`.
   * Color terminals: hover `userMessageBackground`.
   * `chalk.level===0`: inverse.
   */
  readonly hoverStyle?: 'tint' | 'inverse' | 'pointer' | 'none';
};

export function SelectOption({
  isFocused,
  isSelected,
  children,
  description,
  shouldShowDownArrow,
  shouldShowUpArrow,
  declareCursor,
  onClick,
  icon,
  meta,
  iconWidth = 0,
  nameWidth,
  factsWidth = 0,
  hoverStyle: hoverStyleProp,
}: SelectOptionProps): React.ReactNode {
  const leftoverNnDt = useContext(LeftoverNnDtContext);
  const leftoverScreenReader = useContext(AccessibilityContext);
  const leftoverNameColor = leftoverNnNameColor(isFocused);
  // densable `$e` `Zi`/`IC` `VDe` — per-row boolean. leftover Ihe identity
  // is the whole list; matching it paints every row that ever hovered.
  // Gold `if(i!==null&&!l)a(null)` clears when ihe window rotates.
  const leftoverIhe = useContext(LeftoverIheWindowContext);
  const leftoverIheRef = useRef(leftoverIhe);
  const [hovered, setHovered] = useState(false);
  if (leftoverIheRef.current !== leftoverIhe) {
    leftoverIheRef.current = leftoverIhe;
    if (hovered) setHovered(false);
  }
  const leftoverClickable = onClick !== undefined;
  // densable `she(o="tint")` — `me.level===0?"inverse":o`.
  const leftoverHoverStyle = chalk.level === 0 ? 'inverse' : (hoverStyleProp ?? 'tint');
  // Gold IC: background only when hovered and tint. Keyboard focus does not paint.
  const leftoverHoverTint = leftoverVdeTint(leftoverClickable, hovered, leftoverHoverStyle)
    ? ('userMessageBackground' as const)
    : undefined;
  const leftoverHoverPointer = leftoverVdePointer(leftoverClickable, hovered, leftoverHoverStyle);
  const leftoverHoverInverse = leftoverVdeInverse(leftoverClickable, hovered, leftoverHoverStyle);
  const facts = factsWidth > 0 && meta && meta.length > 0 ? leftoverNnFit(meta, factsWidth) : undefined;
  const nn = icon !== undefined || facts !== undefined || nameWidth !== undefined;
  if (leftoverScreenReader && nn) {
    const label = typeof children === 'string' || typeof children === 'number' ? String(children) : '';
    return (
      <Box>
        {icon}
        <Text>{leftoverNnSrLine(label, meta ?? [], description)}</Text>
      </Box>
    );
  }
  const body = nn ? (
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
      <Box>
        {iconWidth > 0 && icon !== undefined && icon !== null ? (
          <Box flexShrink={0} width={iconWidth} marginRight={1}>
            {icon}
          </Box>
        ) : null}
        <Box
          flexShrink={facts === undefined ? 1 : 0}
          width={facts === undefined ? undefined : nameWidth}
          marginRight={facts === undefined ? 0 : 3}
        >
          <Text color={leftoverNameColor} wrap="truncate-end">
            {children}
          </Text>
        </Box>
        {facts !== undefined ? (
          <Box flexShrink={1} maxWidth={factsWidth}>
            <Text dimColor wrap="truncate-end">
              {facts}
            </Text>
          </Box>
        ) : null}
      </Box>
      {description ? (
        <Box paddingLeft={leftoverNnIconCol(iconWidth)}>
          <Text color="inactive" wrap="truncate-end">
            {description}
          </Text>
        </Box>
      ) : null}
    </Box>
  ) : (
    children
  );
  // densable `$e` `t7` is IC. leftover Lo Un/Dt bind stays on leftoverNn.
  const item = (
    <ListItem
      isFocused={isFocused}
      isSelected={isSelected}
      description={nn ? undefined : description}
      showScrollDown={shouldShowDownArrow}
      showScrollUp={shouldShowUpArrow}
      styled={false}
      declareCursor={declareCursor}
      onClick={onClick}
      hovered={leftoverHoverPointer}
      inverse={leftoverHoverInverse}
      backgroundColor={leftoverHoverTint}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {body}
    </ListItem>
  );
  if (!nn) return item;
  return (
    <Box ref={(node: DOMElement | null) => leftoverNnDtBind(leftoverNnDt, node)} flexShrink={0} flexDirection="column">
      {item}
    </Box>
  );
}

export type SelectZiOptionProps = {
  readonly isFocused: boolean;
  readonly shouldShowDownArrow?: boolean;
  readonly shouldShowUpArrow?: boolean;
  readonly onClick?: (event: ClickEvent) => void;
  readonly hoverStyle?: 'tint' | 'inverse' | 'pointer' | 'none';
  readonly children: ReactNode;
};

/**
 * densable `$e` `Zi` @202785693 — two-column host.
 * Focus/hover/arrows only. No `isSelected` tick (tick is inline in the label column).
 * Row: indicator + children. Do not invent minify `Zi`.
 */
export function SelectZiOption({
  isFocused,
  shouldShowDownArrow = false,
  shouldShowUpArrow = false,
  onClick,
  hoverStyle: hoverStyleProp,
  children,
}: SelectZiOptionProps): React.ReactNode {
  const leftoverIhe = useContext(LeftoverIheWindowContext);
  const leftoverIheRef = useRef(leftoverIhe);
  const [hovered, setHovered] = useState(false);
  if (leftoverIheRef.current !== leftoverIhe) {
    leftoverIheRef.current = leftoverIhe;
    if (hovered) setHovered(false);
  }
  const leftoverClickable = onClick !== undefined;
  const leftoverHoverStyle = chalk.level === 0 ? 'inverse' : (hoverStyleProp ?? 'tint');
  const leftoverHoverTint = leftoverVdeTint(leftoverClickable, hovered, leftoverHoverStyle)
    ? ('userMessageBackground' as const)
    : undefined;
  const leftoverHoverPointer = leftoverVdePointer(leftoverClickable, hovered, leftoverHoverStyle);
  const leftoverHoverInverse = leftoverVdeInverse(leftoverClickable, hovered, leftoverHoverStyle);
  const cursorRef = useDeclaredCursor({
    line: 0,
    column: 0,
    active: isFocused,
  });

  let indicator: React.ReactNode;
  if (isFocused) {
    indicator = (
      <Text color="suggestion" inverse={leftoverHoverInverse}>
        {figures.pointer}
      </Text>
    );
  } else if (shouldShowDownArrow) {
    indicator = (
      <Text dimColor inverse={leftoverHoverInverse}>
        {figures.arrowDown}
      </Text>
    );
  } else if (shouldShowUpArrow) {
    indicator = (
      <Text dimColor inverse={leftoverHoverInverse}>
        {figures.arrowUp}
      </Text>
    );
  } else if (leftoverHoverPointer) {
    indicator = <Text dimColor>{figures.pointer}</Text>;
  } else {
    indicator = <Text inverse={leftoverHoverInverse}> </Text>;
  }

  return (
    <Box
      ref={cursorRef}
      flexDirection="row"
      flexShrink={0}
      backgroundColor={leftoverHoverTint}
      onClick={onClick}
      onMouseEnter={leftoverClickable ? () => setHovered(true) : undefined}
      onMouseLeave={leftoverClickable ? () => setHovered(false) : undefined}
    >
      <Box flexShrink={0}>{indicator}</Box>
      {children}
    </Box>
  );
}
