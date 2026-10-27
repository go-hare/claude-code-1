import * as React from 'react';
import { Box, type RGBColor, Text, useTheme } from '@anthropic/ink';
import { getTheme, type Theme } from '../../utils/theme.js';
import { cosinePulse } from './statusKind.js';
import { getDefaultCharacters, interpolateColor, parseRGB, toRGBColor } from './utils.js';

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

/**
 * densable Rte `w(35)` — one `s` Box for the glyph. DualInk leftoverGs
 * `clear`s a recreated width-2 Box every frame and blanks `Wandering`.
 */
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

  let color: keyof Theme | RGBColor = messageColor;
  let char = REDUCED_MOTION_DOT;
  let bold = false;
  let dimColor = false;

  if (reducedMotion) {
    const pulse = 1 - cosinePulse(time, REDUCED_MOTION_CYCLE_MS);
    const colorKey = thinkingIntensity > 0 ? 'warning' : messageColor;
    const baseColorStr = theme[colorKey];
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    bold = thinkingIntensity >= 0.5;
    char = REDUCED_MOTION_DOT;
    if (baseRGB) {
      const mid = interpolateColor(baseRGB, PULSE_BLACK, 0.5);
      const interpolated = interpolateColor(mid, baseRGB, pulse);
      color = toRGBColor(interpolated);
    } else {
      color = colorKey;
      dimColor = pulse < 0.5;
    }
  } else {
    // densable Rte: o=KCe()[le%q.length] with le=Xn in 0..h7t.length-1,
    // so the ping-pong table is only the forward h7t half.
    const spinnerFrames = getDefaultCharacters();
    char = spinnerFrames[frame] ?? spinnerFrames[0] ?? '·';

    if (stalledIntensity > 0) {
      const baseColorStr = theme[messageColor];
      const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
      if (baseRGB) {
        color = toRGBColor(interpolateColor(baseRGB, ERROR_RED, stalledIntensity));
      } else {
        color = stalledIntensity > 0.5 ? 'error' : messageColor;
      }
    } else if (thinkingIntensity > 0) {
      const baseColorStr = theme[messageColor];
      const warningStr = theme.warning;
      const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
      const warningRGB = warningStr ? parseRGB(warningStr) : null;
      bold = thinkingIntensity >= 0.5;
      if (baseRGB && warningRGB) {
        color = toRGBColor(interpolateColor(baseRGB, warningRGB, thinkingIntensity));
      } else {
        color = thinkingIntensity > 0.5 ? 'warning' : messageColor;
      }
    } else {
      color = messageColor;
    }
  }

  return (
    <Box flexWrap="wrap" height={1} width={2} accessibility={GLYPH_A11Y}>
      <Text color={color} bold={bold || undefined} dimColor={dimColor || undefined}>
        {char}
      </Text>
    </Box>
  );
}
