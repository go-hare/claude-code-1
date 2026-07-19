import React from 'react';
import { Box, Text } from '@anthropic/ink';

type LineViewProps = {
  query: string;
  cursorOffset: number;
  onCursorOffsetChange?: (offset: number) => void;
  placeholder?: string;
  prefix?: string;
  prefixDim?: boolean;
  /** Optional color for prefix (e.g. bash `!` mode). */
  prefixColor?: string;
  isFocused: boolean;
  isTerminalFocused?: boolean;
  width?: string | number;
  borderless?: boolean;
  borderColor?: string;
  borderDimColor?: boolean;
};

/**
 * Single- or multi-line composer line. Multiline keeps a simple column of
 * lines with a per-line cursor (FleetView Shift+Enter).
 */
export function LineView({
  query,
  cursorOffset,
  placeholder,
  prefix,
  prefixDim,
  prefixColor,
  isFocused,
  isTerminalFocused: _isTerminalFocused,
  width,
  borderless,
  borderColor,
  borderDimColor,
}: LineViewProps) {
  const renderPrefix = () => {
    if (!prefix) return null;
    if (prefixDim) {
      return (
        <Text dimColor color={prefixColor as never}>
          {prefix}{' '}
        </Text>
      );
    }
    return (
      <Text color={prefixColor as never} bold={!!prefixColor}>
        {prefix}{' '}
      </Text>
    );
  };

  const renderLine = (line: string, lineStart: number, isLast: boolean) => {
    const lineEnd = lineStart + line.length;
    const cursorInLine = cursorOffset >= lineStart && cursorOffset <= lineEnd;
    // On non-last lines cursor at lineEnd maps to newline; show at end of line.
    if (!isFocused || !cursorInLine) {
      return (
        <Text key={lineStart}>
          {line}
          {!isLast ? '\n' : null}
        </Text>
      );
    }
    const local = Math.min(Math.max(0, cursorOffset - lineStart), line.length);
    const before = line.slice(0, local);
    const cursorChar = local < line.length ? line[local]! : ' ';
    const after = line.slice(local + 1);
    return (
      <Text key={lineStart}>
        {before}
        <Text inverse>{cursorChar}</Text>
        {after}
        {!isLast ? '\n' : null}
      </Text>
    );
  };

  const renderContent = () => {
    if (query.length === 0) {
      if (isFocused) {
        return (
          <>
            <Text inverse> </Text>
            {placeholder && <Text dimColor>{placeholder}</Text>}
          </>
        );
      }
      return placeholder ? <Text dimColor>{placeholder}</Text> : null;
    }

    if (!query.includes('\n')) {
      const before = query.slice(0, cursorOffset);
      const cursorChar = cursorOffset < query.length ? query[cursorOffset] : ' ';
      const after = query.slice(cursorOffset + 1);
      return (
        <>
          <Text>{before}</Text>
          {isFocused ? <Text inverse>{cursorChar}</Text> : <Text>{cursorChar}</Text>}
          {after.length > 0 && <Text>{after}</Text>}
        </>
      );
    }

    // Multiline: render as column of lines with cursor on the active line.
    const lines = query.split('\n');
    let offset = 0;
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => {
          const start = offset;
          const node = renderLine(line, start, i === lines.length - 1);
          offset += line.length + 1; // +1 for the newline separator (except we still advance)
          return <Box key={`ln-${i}`}>{node}</Box>;
        })}
      </Box>
    );
  };

  return (
    <Box
      width={width}
      borderStyle={borderless ? undefined : 'round'}
      borderColor={borderless ? undefined : (borderColor as never)}
      borderDimColor={borderless ? undefined : borderDimColor}
      paddingLeft={borderless ? 0 : 1}
      paddingRight={borderless ? 0 : 1}
      flexDirection={query.includes('\n') ? 'row' : 'row'}
      alignItems={query.includes('\n') ? 'flex-start' : 'center'}
    >
      {renderPrefix()}
      {renderContent()}
    </Box>
  );
}
