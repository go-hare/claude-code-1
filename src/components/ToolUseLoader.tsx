import React from 'react';
import { BLACK_CIRCLE } from '../constants/figures.js';

import { Box, Text } from '@anthropic/ink';
import { useBlink } from '../hooks/useBlink.js';
import { useAppStateMaybeOutsideOfProvider } from '../state/AppState.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';

type Props = {
  isError: boolean;
  isUnresolved: boolean;
  shouldAnimate: boolean;
};

export function ToolUseLoader({ isError, isUnresolved, shouldAnimate }: Props): React.ReactNode {
  const isScreenReader = isScreenReaderModeEnabled();
  const reducedMotion = useAppStateMaybeOutsideOfProvider(s => s.settings.prefersReducedMotion) ?? false;
  const [ref, isBlinking] = useBlink(shouldAnimate && !isScreenReader && !reducedMotion);
  const staticActiveInReducedMotion = isUnresolved && shouldAnimate && reducedMotion && !isScreenReader;

  const color = staticActiveInReducedMotion ? 'text' : isUnresolved ? undefined : isError ? 'error' : 'success';

  // WARNING: The code here and in AssistantToolUseMessage is particularly
  // sensitive to what *should* just be trivial refactorings. A `<dim>x</dim>`
  // followed *immediately* by `<bold>y</bold>` tag incorrectly renders `y` as
  // dim! This is because `</dim>` and `</bold>` are both reset by \x1b[22m
  // due to historical reasons, and chalk can't distinguish between them.
  // The symptom you'll see if we get this wrong is the tool name blinks along
  // with this loading indicator, which looks quite bad.
  // https://github.com/chalk/chalk/issues/290
  return (
    <Box ref={ref} minWidth={2}>
      <Text
        aria-label={isError ? 'tool error:' : 'tool:'}
        color={color}
        dimColor={isUnresolved && !staticActiveInReducedMotion}
      >
        {!shouldAnimate || isBlinking || isError || !isUnresolved ? BLACK_CIRCLE : ' '}
      </Text>
    </Box>
  );
}
