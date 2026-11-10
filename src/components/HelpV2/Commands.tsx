import * as React from 'react';
import { useContext, useMemo } from 'react';
import { AccessibilityContext, Box, Text, useTabHeaderFocus } from '@anthropic/ink';
import { type Command, formatDescriptionWithSource } from '../../commands.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { truncate } from '../../utils/truncate.js';
import { ItemList } from '../ItemList.js';

type Props = {
  commands: Command[];
  maxHeight: number;
  columns: number;
  title: string;
  onCancel: () => void;
  emptyMessage?: string;
};

export function Commands({ commands, maxHeight, columns, title, onCancel, emptyMessage }: Props): React.ReactNode {
  const { headerFocused, focusHeader } = useTabHeaderFocus();
  const srContext = useContext(AccessibilityContext);
  const screenReader = srContext || isScreenReaderModeEnabled();
  const maxWidth = Math.max(1, columns - 10);
  const visibleOptionCount = 2 * Math.max(1, Math.floor((maxHeight - 10) / 2));

  const options = useMemo(() => {
    // Custom commands can appear more than once (e.g. same name at user and
    // project scope). Dedupe by name to avoid React key collisions in Select.
    const seen = new Set<string>();
    return commands
      .filter(cmd => {
        if (seen.has(cmd.name)) return false;
        seen.add(cmd.name);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(cmd => {
        const fullDescription = formatDescriptionWithSource(cmd);
        return {
          label: `/${cmd.name}`,
          value: cmd.name,
          description: truncate(fullDescription, maxWidth, true),
          fullDescription,
          lines: 2,
        };
      });
  }, [commands, maxWidth]);

  return (
    <Box flexDirection="column" paddingY={1}>
      {commands.length === 0 && emptyMessage ? (
        <Text dimColor>{emptyMessage}</Text>
      ) : (
        <>
          <Text>{title}</Text>
          <Box marginTop={1}>
            {screenReader ? (
              <Box flexDirection="column">
                {options.map((item, idx) => (
                  <Text key={item.value}>
                    {idx + 1}. {item.label} — {item.fullDescription}
                  </Text>
                ))}
              </Box>
            ) : (
              <ItemList
                options={options}
                visibleOptionCount={visibleOptionCount}
                onUpFromFirst={focusHeader}
                onCancel={headerFocused ? focusHeader : onCancel}
                isDisabled={headerFocused}
              />
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
