import React from 'react';
import { Text } from '../index.js';
import type { Theme } from './theme-types.js';

type Props = {
  /**
   * How much progress to display, between 0 and 1 inclusive
   */
  ratio: number; // [0, 1]

  /**
   * How many characters wide to draw the progress bar
   */
  width: number; // how many characters wide

  /**
   * Optional color for the filled portion of the bar
   */
  fillColor?: keyof Theme;

  /**
   * Optional color for the empty portion of the bar
   */
  emptyColor?: keyof Theme;

  /**
   * Visual style of the progress bar
   */
  variant?: 'block' | 'pill';
};

const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
const PILL_CHARS = { fill: '▰', empty: '▱' };
const PILL_CHARS_FALLBACK = { fill: '█', empty: '░' };

function hasGeometricShapesInkBleedBug(): boolean {
  return process.env.TERM === 'xterm-ghostty' || process.env.TERM_PROGRAM === 'ghostty';
}

function getPillChars(): { fill: string; empty: string } {
  return hasGeometricShapesInkBleedBug() ? PILL_CHARS_FALLBACK : PILL_CHARS;
}

export function ProgressBar({
  ratio: inputRatio,
  width,
  fillColor,
  emptyColor,
  variant = 'block',
}: Props): React.ReactNode {
  // densable 2.1.229 #8: narrow/zero terminal widths must not feed String.repeat
  // a negative count (RangeError). Clamp width before floor/repeat.
  const barWidth = Math.max(0, Math.floor(width));
  const ratio = Math.min(1, Math.max(0, inputRatio));
  if (variant === 'pill') {
    const { fill, empty } = getPillChars();
    const filled = Math.round(ratio * barWidth);
    return (
      <Text>
        <Text color={fillColor}>{fill.repeat(filled)}</Text>
        <Text color={emptyColor} dimColor={emptyColor === undefined}>
          {empty.repeat(Math.max(0, barWidth - filled))}
        </Text>
      </Text>
    );
  }
  const ariaLabel = `${Math.round(ratio * 100)}%`;
  if (barWidth === 0) {
    return (
      <Text color={fillColor} backgroundColor={emptyColor} aria-label={ariaLabel}>
        {''}
      </Text>
    );
  }
  const whole = Math.floor(ratio * barWidth);
  const segments = [BLOCKS[BLOCKS.length - 1]!.repeat(whole)];
  if (whole < barWidth) {
    const remainder = ratio * barWidth - whole;
    const middle = Math.floor(remainder * (BLOCKS.length - 1));
    segments.push(BLOCKS[middle]!);

    const empty = barWidth - whole - 1;
    if (empty > 0) {
      segments.push(BLOCKS[0]!.repeat(empty));
    }
  }

  return (
    <Text color={fillColor} backgroundColor={emptyColor} aria-label={ariaLabel}>
      {segments.join('')}
    </Text>
  );
}
