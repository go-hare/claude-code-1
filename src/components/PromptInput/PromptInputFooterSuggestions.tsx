import { memo, type ReactNode } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text, stringWidth } from '@anthropic/ink';
import { truncatePathMiddle, truncateToWidth } from '../../utils/format.js';
import type { Theme } from '../../utils/theme.js';
import { QueryHighlightedText } from './QueryHighlightedText.js';

export type SuggestionItem = {
  id: string;
  displayText: string;
  tag?: string;
  description?: string;
  metadata?: unknown;
  color?: keyof Theme;
  /**
   * densable 2.1.227 — lowercase query for match-range bold highlight in
   * slash / typeahead menus (`kh.query` → `wZt`).
   */
  query?: string;
  /** Official menu kind lanes (tengu_mint_lanes / ENABLE_MENU_KIND_LANES). */
  kind?: 'skill' | 'action';
  sourceTag?: 'project' | 'org';
};

export type SuggestionType =
  | 'command'
  | 'file'
  | 'directory'
  | 'agent'
  | 'shell'
  | 'custom-title'
  | 'slack-channel'
  | 'emoji'
  | 'none';

export const OVERLAY_MAX_ITEMS = 5;

/**
 * Get the icon for a suggestion based on its type
 * Icons: + for files, ◇ for MCP resources, * for agents
 */
function getIcon(itemId: string): string {
  if (itemId.startsWith('file-')) return '+';
  if (itemId.startsWith('mcp-resource-')) return '◇';
  if (itemId.startsWith('agent-')) return '*';
  return '+';
}

/**
 * Check if an item is a unified suggestion type (file, mcp-resource, or agent)
 */
function isUnifiedSuggestion(itemId: string): boolean {
  return itemId.startsWith('file-') || itemId.startsWith('mcp-resource-') || itemId.startsWith('agent-');
}

const SuggestionItemRow = memo(function SuggestionItemRow({
  item,
  maxColumnWidth,
  isSelected,
}: {
  item: SuggestionItem;
  maxColumnWidth?: number;
  isSelected: boolean;
}): ReactNode {
  const columns = useTerminalSize().columns;
  const isUnified = isUnifiedSuggestion(item.id);

  // For unified suggestions (file, mcp-resource, agent), use single-line layout with icon
  if (isUnified) {
    const icon = getIcon(item.id);
    const textColor: keyof Theme | undefined = isSelected ? 'suggestion' : undefined;
    const dimColor = !isSelected;

    const isFile = item.id.startsWith('file-');
    const isMcpResource = item.id.startsWith('mcp-resource-');

    // Calculate layout widths
    // Layout: "X " (2) + displayText + " – " (3) + description + padding (4)
    const iconWidth = 2; // icon + space (fixed)
    const paddingWidth = 4;
    const separatorWidth = item.description ? 3 : 0; // ' – ' separator

    // For files, truncate middle of path to show both directory context and filename
    // For MCP resources, limit displayText to 30 chars (truncate from end)
    // For agents, no truncation
    let displayText: string;
    if (isFile) {
      // Reserve space for description if present, otherwise use all available space
      const descReserve = item.description ? Math.min(20, stringWidth(item.description)) : 0;
      const maxPathLength = columns - iconWidth - paddingWidth - separatorWidth - descReserve;
      displayText = truncatePathMiddle(item.displayText, maxPathLength);
    } else if (isMcpResource) {
      const maxDisplayTextLength = 30;
      displayText = truncateToWidth(item.displayText, maxDisplayTextLength);
    } else {
      displayText = item.displayText;
    }

    const availableWidth = columns - iconWidth - stringWidth(displayText) - separatorWidth - paddingWidth;

    // Build the full line as a single string to prevent wrapping
    let lineContent: string;
    if (item.description) {
      const maxDescLength = Math.max(0, availableWidth);
      const truncatedDesc = truncateToWidth(item.description.replace(/\s+/g, ' '), maxDescLength);
      lineContent = `${icon} ${displayText} – ${truncatedDesc}`;
    } else {
      lineContent = `${icon} ${displayText}`;
    }

    return (
      <Text color={textColor} dimColor={dimColor} wrap="truncate">
        {lineContent}
      </Text>
    );
  }

  // densable footer (non-unified): selected row blue only; match chars bold via wZt.
  // Cap the command name column at 40% of terminal width to ensure description has space
  const maxNameWidth = Math.floor(columns * 0.4);
  const displayTextWidth = Math.min(maxColumnWidth ?? stringWidth(item.displayText) + 5, maxNameWidth);

  const textColor = item.color || (isSelected ? 'suggestion' : undefined);
  const shouldDim = !isSelected;
  // densable: emoji: id rows get pointer + bold when selected
  const isEmoji = item.id.startsWith('emoji:');
  // densable Ge.pointer = '❯' (❯) when selected, two spaces when not
  const emojiPointer = isEmoji ? (isSelected ? '❯ ' : '  ') : '';
  const emojiPointerWidth = stringWidth(emojiPointer);
  const nameBold = isEmoji && isSelected;

  // Truncate and pad the display text to fixed width
  let displayText = item.displayText;
  if (stringWidth(displayText) > displayTextWidth - 2) {
    displayText =
      displayText.includes('/') || displayText.includes('\\')
        ? truncatePathMiddle(displayText, displayTextWidth - 2)
        : truncateToWidth(displayText, displayTextWidth - 2);
  }
  const padSpaces = ' '.repeat(Math.max(0, displayTextWidth - stringWidth(displayText) - emojiPointerWidth));

  const tagText = item.tag ? `[${item.tag}] ` : '';
  const tagWidth = stringWidth(tagText);
  const descriptionWidth = Math.max(0, columns - displayTextWidth - tagWidth - 4);
  // Skill descriptions can contain newlines (e.g. /claude-api's "TRIGGER
  // when:" block). A multi-line row grows the overlay past minHeight; when
  // the filter narrows past that skill, the overlay shrinks and leaves
  // ghost rows. Flatten to one line before truncating.
  const truncatedDescription = item.description
    ? truncateToWidth(item.description.replace(/\s+/g, ' '), descriptionWidth)
    : '';
  const descriptionColor = isSelected ? 'suggestion' : undefined;

  return (
    <Text wrap="truncate">
      {emojiPointer ? (
        <Text color={textColor} dimColor={shouldDim} bold={nameBold}>
          {emojiPointer}
        </Text>
      ) : null}
      {/* densable wZt — name column: match bold, not recolor */}
      <QueryHighlightedText
        text={displayText}
        query={item.query}
        color={textColor}
        isSelected={isSelected}
        bold={nameBold}
      />
      <Text color={textColor} dimColor={shouldDim} bold={nameBold}>
        {padSpaces}
      </Text>
      {tagText ? (
        <Text color={item.tag === 'local' ? 'ansi:yellow' : undefined} dimColor={item.tag !== 'local'}>
          {tagText}
        </Text>
      ) : null}
      {/* densable wZt description: contiguousOnly */}
      {truncatedDescription ? (
        <QueryHighlightedText
          text={truncatedDescription}
          query={item.query}
          color={descriptionColor}
          isSelected={isSelected}
          bold={nameBold}
          contiguousOnly
        />
      ) : null}
    </Text>
  );
});

type Props = {
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  maxColumnWidth?: number;
  /**
   * When true, the suggestions are rendered inside a position=absolute
   * overlay. We omit minHeight and flex-end so the y-clamp in the
   * renderer doesn't push fewer items down into the prompt area.
   */
  overlay?: boolean;
};

export function PromptInputFooterSuggestions({
  suggestions,
  selectedSuggestion,
  maxColumnWidth: maxColumnWidthProp,
  overlay,
}: Props): ReactNode {
  const { rows } = useTerminalSize();
  // Maximum number of suggestions to show at once (leaving space for prompt).
  // Overlay mode (fullscreen) uses a fixed 5 — the floating box sits over
  // the ScrollBox, so terminal height isn't the constraint.
  const maxVisibleItems = overlay ? OVERLAY_MAX_ITEMS : Math.min(6, Math.max(1, rows - 3));

  // No suggestions to display
  if (suggestions.length === 0) {
    return null;
  }

  // Use prop if provided (stable width from all commands), otherwise calculate from visible
  const maxColumnWidth = maxColumnWidthProp ?? Math.max(...suggestions.map(item => stringWidth(item.displayText))) + 5;

  // Calculate visible items range based on selected index
  const startIndex = Math.max(
    0,
    Math.min(selectedSuggestion - Math.floor(maxVisibleItems / 2), suggestions.length - maxVisibleItems),
  );
  const endIndex = Math.min(startIndex + maxVisibleItems, suggestions.length);
  const visibleItems = suggestions.slice(startIndex, endIndex);

  // In non-overlay (inline) mode, justifyContent keeps suggestions
  // anchored to the bottom (near the prompt). In overlay mode we omit
  // both minHeight and flex-end: the parent is position=absolute with
  // bottom='100%', so its y is clamped to 0 by the renderer when it
  // would go negative. Adding minHeight + flex-end would create empty
  // padding rows that shift the visible items down into the prompt area
  // when the list has fewer items than maxVisibleItems.
  return (
    <Box flexDirection="column" justifyContent={overlay ? undefined : 'flex-end'}>
      {visibleItems.map(item => (
        <SuggestionItemRow
          key={item.id}
          item={item}
          maxColumnWidth={maxColumnWidth}
          isSelected={item.id === suggestions[selectedSuggestion]?.id}
        />
      ))}
    </Box>
  );
}

export default memo(PromptInputFooterSuggestions);
