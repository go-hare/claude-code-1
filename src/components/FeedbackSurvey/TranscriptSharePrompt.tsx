import React, { useCallback } from 'react';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Button, Link, Text } from '@anthropic/ink';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';

export type TranscriptShareResponse = 'yes' | 'no' | 'dont_ask_again';

type Props = {
  onSelect: (option: TranscriptShareResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
};

const PROMPT_MESSAGE = 'Can Anthropic look at your session transcript to help us improve Claude Code?';
const DATA_USAGE_DOCS_URL = 'https://code.claude.com/docs/en/data-usage#session-quality-surveys';

const RESPONSE_KEYS = ['y', 'n', 'd'] as const;
type ResponseKey = (typeof RESPONSE_KEYS)[number];

const KEY_TO_RESPONSE: Record<ResponseKey, TranscriptShareResponse> = {
  y: 'yes',
  n: 'no',
  d: 'dont_ask_again',
} as const;

const TRANSCRIPT_SHARE_OPTIONS: ReadonlyArray<{
  key: ResponseKey;
  label: string;
  width?: number;
}> = [
  { key: 'y', label: 'Yes', width: 10 },
  { key: 'n', label: 'No', width: 10 },
  { key: 'd', label: "Don't ask again" },
];

export function isValidTranscriptShareInput(input: string): boolean {
  return (RESPONSE_KEYS as readonly string[]).includes(input.toLowerCase());
}

export function TranscriptSharePrompt({ onSelect, inputValue, setInputValue }: Props): React.ReactNode {
  const handleSelect = useCallback(
    (response: TranscriptShareResponse) => {
      setInputValue('');
      onSelect(response);
    },
    [onSelect, setInputValue],
  );

  useDebouncedDigitInput({
    inputValue,
    setInputValue,
    isValidDigit: (ch): ch is string => isValidTranscriptShareInput(ch),
    onDigit: ch => {
      const normalized = ch.toLowerCase();
      if (isValidTranscriptShareInput(normalized)) {
        handleSelect(KEY_TO_RESPONSE[normalized as ResponseKey]);
      }
    },
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="ansi:cyan">{BLACK_CIRCLE} </Text>
        <Text bold>{PROMPT_MESSAGE}</Text>
      </Box>

      <Box marginLeft={2}>
        <Text dimColor>
          Learn more: <Link url={DATA_USAGE_DOCS_URL}>{DATA_USAGE_DOCS_URL}</Link>
        </Text>
      </Box>

      <Box marginLeft={2}>
        {TRANSCRIPT_SHARE_OPTIONS.map(({ key, label, width }) => (
          <Box key={key} width={width}>
            <Button tabIndex={-1} onAction={() => handleSelect(KEY_TO_RESPONSE[key])}>
              {({ hovered }) => (
                <Text backgroundColor={hovered ? 'userMessageBackground' : undefined}>
                  <Text color="ansi:cyan">{key}</Text>: {label}
                </Text>
              )}
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
