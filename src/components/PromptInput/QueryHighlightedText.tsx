/**
 * densable 2.1.227 `wZt` — render text with query match ranges bolded
 * (not recolored). Selected row keeps row color; unmatched unselected is dim.
 */
import { type ReactNode, useMemo } from 'react';
import { Text } from '@anthropic/ink';
import type { Theme } from '../../utils/theme.js';
import { findQueryMatchRanges } from '../../utils/suggestions/queryMatchRanges.js';

export type QueryHighlightedTextProps = {
  text: string;
  query?: string;
  color?: keyof Theme;
  isSelected: boolean;
  bold?: boolean;
  /** densable contiguousOnly — description uses true (substring only). */
  contiguousOnly?: boolean;
};

export function QueryHighlightedText({
  text,
  query,
  color,
  isSelected,
  bold = false,
  contiguousOnly = false,
}: QueryHighlightedTextProps): ReactNode {
  const ranges = useMemo(
    () => (query ? findQueryMatchRanges(text, query, contiguousOnly) : []),
    [text, query, contiguousOnly],
  );

  if (ranges.length === 0) {
    return (
      <Text color={color} dimColor={!isSelected} bold={bold}>
        {text}
      </Text>
    );
  }

  const parts: ReactNode[] = [];
  const pushSlice = (start: number, end: number, isMatch: boolean) => {
    if (start >= end) return;
    parts.push(
      <Text key={start} color={color} dimColor={!isMatch && !isSelected} bold={bold || isMatch}>
        {text.slice(start, end)}
      </Text>,
    );
  };

  let cursor = 0;
  for (const [start, end] of ranges) {
    pushSlice(cursor, start, false);
    pushSlice(start, end, true);
    cursor = end;
  }
  pushSlice(cursor, text.length, false);

  return <>{parts}</>;
}
