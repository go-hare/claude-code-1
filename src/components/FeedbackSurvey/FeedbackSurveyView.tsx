import React, { useCallback, useMemo } from 'react';
import { Box, Button, MOUNT_SETTLE_MS, Text } from '@anthropic/ink';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';
import type { FeedbackSurveyResponse } from './utils.js';

type SurveyChoiceValue = FeedbackSurveyResponse | 'not_sure';

type Props = {
  onSelect: (option: FeedbackSurveyResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  message?: React.ReactNode;
  messageBold?: boolean;
  mountDelayMs?: number;
  showNotSure?: boolean;
};

type ResponseKey = '0' | '1' | '2' | '3' | '4';

const KEY_TO_RESPONSE: Record<ResponseKey, SurveyChoiceValue> = {
  '0': 'dismissed',
  '1': 'bad',
  '2': 'fine',
  '3': 'good',
  '4': 'not_sure',
};

const BASE_OPTIONS: ReadonlyArray<{ key: ResponseKey; label: string }> = [
  { key: '1', label: 'Bad' },
  { key: '2', label: 'Fine' },
  { key: '3', label: 'Good' },
];

const NOT_SURE_OPTION = { key: '4' as const, label: 'Unsure' };
const DISMISS_OPTION = { key: '0' as const, label: 'Dismiss' };
const OPTION_WIDTH = 10;

export function isValidResponseInput(input: string, showNotSure = false): input is ResponseKey {
  if (input === '4') return showNotSure;
  return input === '0' || input === '1' || input === '2' || input === '3';
}

const DEFAULT_MESSAGE = 'How is Claude doing this session? (optional)';

export function FeedbackSurveyView({
  onSelect,
  inputValue,
  setInputValue,
  message = DEFAULT_MESSAGE,
  messageBold = true,
  mountDelayMs = MOUNT_SETTLE_MS,
  showNotSure = false,
}: Props): React.ReactNode {
  const options = useMemo(
    () => (showNotSure ? [...BASE_OPTIONS, NOT_SURE_OPTION, DISMISS_OPTION] : [...BASE_OPTIONS, DISMISS_OPTION]),
    [showNotSure],
  );

  const handleChoose = useCallback(
    (key: ResponseKey) => {
      setInputValue('');
      onSelect(KEY_TO_RESPONSE[key] as FeedbackSurveyResponse);
    },
    [onSelect, setInputValue],
  );

  const checkValidDigit = useCallback(
    (char: string): char is ResponseKey => isValidResponseInput(char, showNotSure),
    [showNotSure],
  );

  useDebouncedDigitInput({
    inputValue,
    setInputValue,
    isValidDigit: checkValidDigit,
    onDigit: handleChoose,
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Box minWidth={2}>
          <Text color="ansi:cyan">●</Text>
        </Box>
        <Text bold={messageBold} wrap="wrap">
          {message}
        </Text>
      </Box>

      <Box marginLeft={2}>
        {options.map(({ key, label }) => (
          <Box key={key} width={OPTION_WIDTH}>
            <Button tabIndex={-1} mountSettleMs={mountDelayMs} onAction={() => handleChoose(key)}>
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
