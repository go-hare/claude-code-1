import * as React from 'react';
import { type RGBColor, Text, stringWidth, useTheme } from '@anthropic/ink';
import { getGraphemeSegmenter } from '../../utils/intl.js';
import { getTheme, type Theme } from '../../utils/theme.js';
import type { SpinnerMode } from './types.js';
import { interpolateColor, parseRGB, toRGBColor } from './utils.js';

type Props = {
  message: string;
  mode: SpinnerMode;
  messageColor: keyof Theme;
  glimmerIndex: number;
  flashOpacity: number;
  shimmerColor: keyof Theme;
  stalledIntensity?: number;
  /** densable RTt thinkingIntensity — fade verb toward theme.warning after stall hold. */
  thinkingIntensity?: number;
};

const ERROR_RED = { r: 171, g: 43, b: 63 };

/**
 * densable `RTt`. Gold returns:
 *   stalled / thinking / tool-use / offscreen → 2 Text (message + space)
 *   on-screen shimmer → before&& / shim / after&& / space
 * DualInk leftoverGs analog extra of always-4-Text left h=0 nodes in the
 * wrap row; leftoverGs then dirty-clears the outer width-100% column
 * (verb + Tip) every glimmerIndex tick.
 */
export function GlimmerMessage({
  message,
  mode,
  messageColor,
  glimmerIndex,
  flashOpacity,
  shimmerColor,
  stalledIntensity = 0,
  thinkingIntensity = 0,
}: Props): React.ReactNode {
  const [themeName] = useTheme();
  const theme = getTheme(themeName);

  const { segments, messageWidth } = React.useMemo(() => {
    const segs: { segment: string; width: number }[] = [];
    for (const { segment } of getGraphemeSegmenter().segment(message)) {
      segs.push({ segment, width: stringWidth(segment) });
    }
    return { segments: segs, messageWidth: stringWidth(message) };
  }, [message]);

  if (!message) return null;

  if (stalledIntensity > 0) {
    const baseColorStr = theme[messageColor];
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    const color: keyof Theme | RGBColor = baseRGB
      ? toRGBColor(interpolateColor(baseRGB, ERROR_RED, stalledIntensity))
      : stalledIntensity > 0.5
        ? 'error'
        : messageColor;
    return (
      <>
        <Text color={color}>{message}</Text>
        <Text color={color}> </Text>
      </>
    );
  }

  if (thinkingIntensity > 0) {
    const baseColorStr = theme[messageColor];
    const warningStr = theme.warning;
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    const warningRGB = warningStr ? parseRGB(warningStr) : null;
    const color: keyof Theme | RGBColor =
      baseRGB && warningRGB
        ? toRGBColor(interpolateColor(baseRGB, warningRGB, thinkingIntensity))
        : thinkingIntensity > 0.5
          ? 'warning'
          : messageColor;
    return (
      <>
        <Text color={color}>{message}</Text>
        <Text color={color}> </Text>
      </>
    );
  }

  if (mode === 'tool-use') {
    const baseColorStr = theme[messageColor];
    const shimmerColorStr = theme[shimmerColor];
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    const shimmerRGB = shimmerColorStr ? parseRGB(shimmerColorStr) : null;
    const color: keyof Theme | RGBColor =
      baseRGB && shimmerRGB
        ? toRGBColor(interpolateColor(baseRGB, shimmerRGB, flashOpacity))
        : flashOpacity > 0.5
          ? shimmerColor
          : messageColor;
    return (
      <>
        <Text color={color}>{message}</Text>
        <Text color={messageColor}> </Text>
      </>
    );
  }

  const shimmerStart = glimmerIndex - 1;
  const shimmerEnd = glimmerIndex + 1;
  if (shimmerStart >= messageWidth || shimmerEnd < 0) {
    return (
      <>
        <Text color={messageColor}>{message}</Text>
        <Text color={messageColor}> </Text>
      </>
    );
  }

  const clampedStart = Math.max(0, shimmerStart);
  let colPos = 0;
  let before = '';
  let shim = '';
  let after = '';
  for (const { segment, width } of segments) {
    if (colPos + width <= clampedStart) {
      before += segment;
    } else if (colPos > shimmerEnd) {
      after += segment;
    } else {
      shim += segment;
    }
    colPos += width;
  }

  return (
    <>
      {before ? <Text color={messageColor}>{before}</Text> : null}
      <Text color={shimmerColor}>{shim}</Text>
      {after ? <Text color={messageColor}>{after}</Text> : null}
      <Text color={messageColor}> </Text>
    </>
  );
}
