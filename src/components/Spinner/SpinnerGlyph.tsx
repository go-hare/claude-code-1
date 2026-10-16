import * as React from 'react';
import { Box, Text, useTheme } from '@anthropic/ink';
import { getTheme, type Theme } from '../../utils/theme.js';
import { cosinePulse } from './statusKind.js';
import { getSpinnerPingPongFrames, interpolateColor, parseRGB, toRGBColor } from './utils.js';

const REDUCED_MOTION_DOT = '●';
const REDUCED_MOTION_CYCLE_MS = 2000;
const ERROR_RED = { r: 171, g: 43, b: 63 };
const PULSE_BLACK = { r: 0, g: 0, b: 0 };
// densable Rte `"aria-hidden":!0` is a primitive. Ink setAccessibility is
// reference-equal — a fresh `{ hidden: true }` every 50ms markDirty's the
// glyph Box and the whole spinner row flashes on the first turn.
const GLYPH_A11Y = { hidden: true } as const;

type Props = {
  frame: number;
  messageColor: keyof Theme;
  stalledIntensity?: number;
  thinkingIntensity?: number;
  reducedMotion?: boolean;
  time?: number;
};

function GlyphBox({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <Box flexWrap="wrap" height={1} width={2} accessibility={GLYPH_A11Y}>
      {children}
    </Box>
  );
}

export function SpinnerGlyph({
  frame,
  messageColor,
  stalledIntensity = 0,
  thinkingIntensity = 0,
  reducedMotion = false,
  time = 0,
}: Props): React.ReactNode {
  const [themeName] = useTheme();
  const theme = getTheme(themeName);

  // densable Rte reduced-motion: 1-jTt(time, 2000) pulse toward black; warning if thinking.
  if (reducedMotion) {
    const pulse = 1 - cosinePulse(time, REDUCED_MOTION_CYCLE_MS);
    const colorKey = thinkingIntensity > 0 ? 'warning' : messageColor;
    const baseColorStr = theme[colorKey];
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    const bold = thinkingIntensity >= 0.5;

    if (baseRGB) {
      const mid = interpolateColor(baseRGB, PULSE_BLACK, 0.5);
      const interpolated = interpolateColor(mid, baseRGB, pulse);
      return (
        <GlyphBox>
          <Text color={toRGBColor(interpolated)} bold={bold}>
            {REDUCED_MOTION_DOT}
          </Text>
        </GlyphBox>
      );
    }

    return (
      <GlyphBox>
        <Text color={colorKey} dimColor={pulse < 0.5} bold={bold}>
          {REDUCED_MOTION_DOT}
        </Text>
      </GlyphBox>
    );
  }

  // densable Rte: KCe ping-pong (wr/yr), index `frame % length`. Call per paint.
  const spinnerFrames = getSpinnerPingPongFrames();
  const spinnerChar = spinnerFrames[frame % spinnerFrames.length];

  if (stalledIntensity > 0) {
    const baseColorStr = theme[messageColor];
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;

    if (baseRGB) {
      const interpolated = interpolateColor(baseRGB, ERROR_RED, stalledIntensity);
      return (
        <GlyphBox>
          <Text color={toRGBColor(interpolated)}>{spinnerChar}</Text>
        </GlyphBox>
      );
    }

    const color = stalledIntensity > 0.5 ? 'error' : messageColor;
    return (
      <GlyphBox>
        <Text color={color}>{spinnerChar}</Text>
      </GlyphBox>
    );
  }

  if (thinkingIntensity > 0) {
    const baseColorStr = theme[messageColor];
    const warningStr = theme.warning;
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    const warningRGB = warningStr ? parseRGB(warningStr) : null;
    const bold = thinkingIntensity >= 0.5;

    if (baseRGB && warningRGB) {
      const interpolated = interpolateColor(baseRGB, warningRGB, thinkingIntensity);
      return (
        <GlyphBox>
          <Text bold={bold} color={toRGBColor(interpolated)}>
            {spinnerChar}
          </Text>
        </GlyphBox>
      );
    }

    const color = thinkingIntensity > 0.5 ? 'warning' : messageColor;
    return (
      <GlyphBox>
        <Text bold={bold} color={color}>
          {spinnerChar}
        </Text>
      </GlyphBox>
    );
  }

  return (
    <GlyphBox>
      <Text color={messageColor}>{spinnerChar}</Text>
    </GlyphBox>
  );
}
