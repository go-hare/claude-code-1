import { memo, type ReactNode } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text, stringWidth } from '@anthropic/ink';
import { truncatePathMiddle, truncateToWidth } from '../../utils/format.js';
import { truncateToWidthNoEllipsis } from '../../utils/truncate.js';
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
  allowWrap = false,
}: {
  item: SuggestionItem;
  maxColumnWidth?: number;
  isSelected: boolean;
  allowWrap?: boolean;
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
  const hasTrailing = Boolean(item.description || item.tag || item.kind !== undefined || item.sourceTag);
  const maxNameWidth = hasTrailing ? Math.floor(columns * 0.4) : columns - 4;
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
  const { kindLaneText, kindLabel, sourceText } = menuKindLane(item);
  // densable passes color "skill", which is not a theme key, so it renders in the default color.
  const laneColor: keyof Theme | undefined = kindLabel === 'agent' ? 'background' : undefined;
  const laneDim = kindLabel !== 'skill' && kindLabel !== 'agent';
  const laneWidth = stringWidth(kindLaneText) + stringWidth(sourceText);
  const descriptionWidth = Math.max(0, columns - displayTextWidth - tagWidth - laneWidth - 4);
  // Skill descriptions can contain newlines (e.g. /claude-api's "TRIGGER
  // when:" block); flatten before measuring so the row is at most two lines.
  const description = item.description ? item.description.replace(/\s+/g, ' ').trim() : '';
  const [firstLine, overflow] = allowWrap
    ? splitDescriptionAtWidth(description, descriptionWidth)
    : [truncateToWidth(description, descriptionWidth), ''];
  const descriptionColor = isSelected ? 'suggestion' : undefined;

  const mainLine = (
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
      {kindLaneText ? (
        <Text color={laneColor} dimColor={laneDim}>
          {kindLaneText}
        </Text>
      ) : null}
      {tagText ? <Text dimColor>{tagText}</Text> : null}
      {sourceText ? <Text dimColor>{sourceText}</Text> : null}
      {/* densable wZt description: contiguousOnly */}
      <QueryHighlightedText
        text={firstLine}
        query={item.query}
        color={descriptionColor}
        isSelected={isSelected}
        bold={nameBold}
        contiguousOnly
      />
    </Text>
  );
  if (!overflow) return mainLine;

  const indent = displayTextWidth + tagWidth + laneWidth;
  return (
    <Box flexDirection="column">
      {mainLine}
      <Text wrap="truncate">
        {' '.repeat(indent)}
        <QueryHighlightedText
          text={truncateToWidth(overflow, Math.max(0, columns - indent - 4))}
          query={item.query}
          color={descriptionColor}
          isSelected={isSelected}
          bold={nameBold}
          contiguousOnly
        />
      </Text>
    </Box>
  );
});

function menuKindLane(item: SuggestionItem): { kindLaneText: string; kindLabel: string; sourceText: string } {
  const kind: string | undefined = item.kind;
  const kindLabel = kind === undefined || kind === 'action' ? '' : kind === 'info' ? 'config' : kind;
  const kindLaneText = kind === undefined ? '' : kindLabel + ' '.repeat(Math.max(0, 7 - stringWidth(kindLabel)));
  const sourceText = item.sourceTag ? `[${item.sourceTag}] ` : '';
  return { kindLaneText, kindLabel, sourceText };
}

/** Split at `width` on a word boundary: `[first line, remainder]`. */
export function splitDescriptionAtWidth(text: string, width: number): [string, string] {
  if (width <= 0 || stringWidth(text) <= width) return [text, ''];
  const head = truncateToWidthNoEllipsis(text, width);
  const tail = text.slice(head.length);
  if (tail.startsWith(' ')) return [head, tail.trimStart()];
  const lastSpace = head.lastIndexOf(' ');
  if (lastSpace > 0) return [head.slice(0, lastSpace), text.slice(lastSpace + 1)];
  return [head, tail];
}

/** Rendered height (1 or 2) of a menu row when descriptions may wrap. */
export function suggestionRowHeight(item: SuggestionItem, columns: number, maxColumnWidth: number): number {
  if (isUnifiedSuggestion(item.id) || !item.description) return 1;
  const nameWidth = Math.min(maxColumnWidth, Math.floor(columns * 0.4));
  const tagWidth = item.tag ? stringWidth(`[${item.tag}] `) : 0;
  const { kindLaneText, sourceText } = menuKindLane(item);
  const descriptionWidth = Math.max(
    0,
    columns - nameWidth - tagWidth - stringWidth(kindLaneText) - stringWidth(sourceText) - 4,
  );
  if (descriptionWidth <= 0) return 1;
  return stringWidth(item.description.replace(/\s+/g, ' ').trim()) > descriptionWidth ? 2 : 1;
}

/**
 * Visible slice for a row budget: grow above the selection up to half the
 * budget, fill below, then backfill above. `used` is the rendered height.
 */
export function suggestionWindow(
  heights: number[],
  selected: number,
  budget: number,
): { start: number; end: number; used: number } {
  const sel = Math.max(0, Math.min(selected, heights.length - 1));
  let start = sel;
  let end = sel + 1;
  let used = heights[sel] ?? 1;
  let above = 0;
  const half = Math.floor(budget / 2);
  while (start > 0 && used < budget && above + (heights[start - 1] ?? 1) <= half) {
    start--;
    above += heights[start] ?? 1;
  }
  used += above;
  while (end < heights.length && used + (heights[end] ?? 1) <= budget) {
    used += heights[end] ?? 1;
    end++;
  }
  while (start > 0 && used + (heights[start - 1] ?? 1) <= budget) {
    start--;
    used += heights[start] ?? 1;
  }
  return { start, end, used };
}

export function suggestionRowBudget(rows: number, overlay: boolean | undefined): number {
  return overlay ? OVERLAY_MAX_ITEMS : Math.max(1, Math.min(Math.max(6, Math.floor(rows / 2)), rows - 3));
}

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
  const { rows, columns } = useTerminalSize();
  // Row budget (leaving space for prompt). Overlay mode (fullscreen) uses a
  // fixed 5 — the floating box sits over the ScrollBox, so terminal height
  // isn't the constraint.
  const budget = suggestionRowBudget(rows, overlay);

  // No suggestions to display
  if (suggestions.length === 0) {
    return null;
  }

  // Use prop if provided (stable width from all commands), otherwise calculate from visible
  const maxColumnWidth = maxColumnWidthProp ?? Math.max(...suggestions.map(item => stringWidth(item.displayText))) + 5;

  const allowWrap = budget >= 2;
  const heights = suggestions.map(item => (allowWrap ? suggestionRowHeight(item, columns, maxColumnWidth) : 1));
  const { start, end, used } = suggestionWindow(heights, selectedSuggestion, budget);
  const visibleItems = suggestions.slice(start, end);
  // In overlay mode the parent is position=absolute with bottom='100%', so
  // padding rows would shift the visible items down into the prompt area.
  const padRows = overlay ? 0 : Math.max(0, budget - used);

  return (
    <Box flexDirection="column" justifyContent={overlay ? undefined : 'flex-end'}>
      {visibleItems.map(item => (
        <SuggestionItemRow
          key={item.id}
          item={item}
          maxColumnWidth={maxColumnWidth}
          isSelected={item.id === suggestions[selectedSuggestion]?.id}
          allowWrap={allowWrap}
        />
      ))}
      {Array.from({ length: padRows }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
    </Box>
  );
}

export default memo(PromptInputFooterSuggestions);
