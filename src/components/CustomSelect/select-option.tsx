import React, { type ReactNode, useContext, useState } from 'react';
import { AccessibilityContext, Box, ListItem, Text, type ClickEvent } from '@anthropic/ink';
import {
  LeftoverIheWindowContext,
  LeftoverNnDtContext,
  leftoverIheHoverClear,
  leftoverIheHoverOn,
  leftoverNnDtBind,
  leftoverNnFit,
  leftoverNnIconCol,
  leftoverNnNameColor,
  leftoverNnSrLine,
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
}: SelectOptionProps): React.ReactNode {
  const current = useContext(LeftoverIheWindowContext);
  const leftoverNnDt = useContext(LeftoverNnDtContext);
  const leftoverScreenReader = useContext(AccessibilityContext);
  const leftoverNameColor = leftoverNnNameColor(isFocused);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  if (leftoverIheHoverClear(hoveredId, current)) setHoveredId(null);
  const hovered = leftoverIheHoverOn(hoveredId, current);
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
  return (
    <Box
      ref={(node: DOMElement | null) => leftoverNnDtBind(leftoverNnDt, node)}
      onMouseEnter={() => setHoveredId(current)}
      onMouseLeave={() => setHoveredId(null)}
    >
      <ListItem
        isFocused={isFocused || hovered}
        isSelected={isSelected}
        description={nn ? undefined : description}
        showScrollDown={shouldShowDownArrow}
        showScrollUp={shouldShowUpArrow}
        styled={false}
        declareCursor={declareCursor}
        onClick={onClick}
      >
        {body}
      </ListItem>
    </Box>
  );
}
