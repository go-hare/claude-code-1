import React, { type ReactNode } from 'react';
import { ListItem, type ClickEvent } from '@anthropic/ink';

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
}: SelectOptionProps): React.ReactNode {
  return (
    <ListItem
      isFocused={isFocused}
      isSelected={isSelected}
      description={description}
      showScrollDown={shouldShowDownArrow}
      showScrollUp={shouldShowUpArrow}
      styled={false}
      declareCursor={declareCursor}
      onClick={onClick}
    >
      {children}
    </ListItem>
  );
}
