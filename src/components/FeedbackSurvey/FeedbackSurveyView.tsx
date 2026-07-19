import React, { type ReactNode } from 'react';
import { Box, Text } from '@anthropic/ink';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';
import type { FeedbackSurveyResponse } from './utils.js';

type Props = {
  onSelect: (option: FeedbackSurveyResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  /** densable jvr message — string or rich ReactNode (UBa citation chrome). */
  message?: ReactNode;
  /** densable messageBold — default true for session prompt; UBa uses false. */
  messageBold?: boolean;
  /** densable showNotSure: show "4: Unsure" and accept digit 4. */
  showNotSure?: boolean;
};

const RESPONSE_INPUTS = ['0', '1', '2', '3'] as const;
const RESPONSE_INPUTS_WITH_NOT_SURE = ['0', '1', '2', '3', '4'] as const;
type ResponseInput = (typeof RESPONSE_INPUTS_WITH_NOT_SURE)[number];

const inputToResponse: Record<ResponseInput, FeedbackSurveyResponse> = {
  '0': 'dismissed',
  '1': 'bad',
  '2': 'fine',
  '3': 'good',
  '4': 'not_sure',
} as const;

export const isValidResponseInput = (input: string, showNotSure = false): input is ResponseInput => {
  if (showNotSure) {
    return (RESPONSE_INPUTS_WITH_NOT_SURE as readonly string[]).includes(input);
  }
  return (RESPONSE_INPUTS as readonly string[]).includes(input);
};

const DEFAULT_MESSAGE = 'How is Claude doing this session? (optional)';

export function FeedbackSurveyView({
  onSelect,
  inputValue,
  setInputValue,
  message = DEFAULT_MESSAGE,
  messageBold = true,
  showNotSure = false,
}: Props): React.ReactNode {
  useDebouncedDigitInput({
    inputValue,
    setInputValue,
    isValidDigit: (d): d is ResponseInput => isValidResponseInput(d, showNotSure),
    onDigit: digit => onSelect(inputToResponse[digit as ResponseInput]),
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="ansi:cyan">● </Text>
        <Text bold={messageBold}>{message}</Text>
      </Box>

      <Box marginLeft={2}>
        <Box width={10}>
          <Text>
            <Text color="ansi:cyan">1</Text>: Bad
          </Text>
        </Box>
        <Box width={10}>
          <Text>
            <Text color="ansi:cyan">2</Text>: Fine
          </Text>
        </Box>
        <Box width={10}>
          <Text>
            <Text color="ansi:cyan">3</Text>: Good
          </Text>
        </Box>
        {showNotSure ? (
          <Box width={12}>
            <Text>
              <Text color="ansi:cyan">4</Text>: Unsure
            </Text>
          </Box>
        ) : null}
        <Box>
          <Text>
            <Text color="ansi:cyan">0</Text>: Dismiss
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
