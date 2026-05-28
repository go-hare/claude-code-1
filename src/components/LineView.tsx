import React from 'react';
import { Box, Text } from '@anthropic/ink';

type LineViewProps = {
  query: string;
  cursorOffset: number;
  onCursorOffsetChange?: (offset: number) => void;
  placeholder?: string;
  prefix?: string;
  prefixDim?: boolean;
  isFocused: boolean;
  isTerminalFocused?: boolean;
  width?: string | number;
  borderless?: boolean;
};

export function LineView({
  query,
  cursorOffset,
  placeholder,
  prefix,
  prefixDim,
  isFocused,
  isTerminalFocused: _isTerminalFocused,
  width,
  borderless,
}: LineViewProps) {
  const renderPrefix = () => {
    if (!prefix) return null;
    if (prefixDim) {
      return <Text dimColor>{prefix} </Text>;
    }
    return <Text>{prefix} </Text>;
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
  };

  return (
    <Box
      width={width}
      borderStyle={borderless ? undefined : 'round'}
      paddingLeft={borderless ? 0 : 1}
      paddingRight={borderless ? 0 : 1}
    >
      {renderPrefix()}
      {renderContent()}
    </Box>
  );
}
