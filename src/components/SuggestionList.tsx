import React from 'react';
import { Box, Text } from '@anthropic/ink';

type SuggestionItem = {
  id: string;
  displayText: string;
  description: string;
};

type SuggestionListProps = {
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  maxColumnWidth?: number;
  noPad?: boolean;
  hoveredId?: string | null;
  onHoverChange?: (id: string | null) => void;
  onSelect?: (index: number) => void;
};

export type { SuggestionItem, SuggestionListProps };

export function SuggestionList({
  suggestions,
  selectedSuggestion,
  maxColumnWidth = 35,
  noPad,
  hoveredId,
  onHoverChange,
  onSelect,
}: SuggestionListProps) {
  return (
    <Box flexDirection="column" paddingLeft={noPad ? 0 : 1} onMouseLeave={() => onHoverChange?.(null)}>
      {suggestions.map((item, index) => {
        const isSelected = index === selectedSuggestion;
        const isHovered = hoveredId === item.id;
        const highlight = isHovered || isSelected;

        const padded = item.displayText.padEnd(maxColumnWidth);

        return (
          <Box key={item.id} onMouseEnter={() => onHoverChange?.(item.id)} onClick={() => onSelect?.(index)}>
            {highlight ? <Text inverse>{padded}</Text> : <Text>{padded}</Text>}
            <Text dimColor> {item.description}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>tab accept · ↑↓ navigate</Text>
      </Box>
    </Box>
  );
}
