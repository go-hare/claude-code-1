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

/** densable RTt thinking/stall/tool-use is 2 Text. Analog Ink markDirty walks
 *  ancestors — 4→2 removeChildNode flashes the whole spinner row (Image 37).
 *  KEEP a stable 4-Text sibling shape on every 50ms path. */
function stableVerbRow(color: keyof Theme | RGBColor, message: string): React.ReactNode {
  return (
    <>
      <Text color={color}>{message}</Text>
      <Text color={color}>{''}</Text>
      <Text color={color}>{''}</Text>
      <Text color={color}> </Text>
    </>
  );
}

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

  // This component re-renders at 20fps (glimmerIndex changes every 50ms) but
  // message is stable within a turn. Precompute grapheme segmentation + widths
  // once per message instead of per frame. Measured -81% on the shimmer path.
  const { segments, messageWidth } = React.useMemo(() => {
    const segs: { segment: string; width: number }[] = [];
    for (const { segment } of getGraphemeSegmenter().segment(message)) {
      segs.push({ segment, width: stringWidth(segment) });
    }
    return { segments: segs, messageWidth: stringWidth(message) };
  }, [message]);

  if (!message) return null;

  // When stalled, show text that smoothly transitions to red
  if (stalledIntensity > 0) {
    const baseColorStr = theme[messageColor];
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;

    if (baseRGB) {
      const interpolated = interpolateColor(baseRGB, ERROR_RED, stalledIntensity);
      return stableVerbRow(toRGBColor(interpolated), message);
    }

    // Fallback for ANSI themes: use messageColor until fully stalled, then error
    const color = stalledIntensity > 0.5 ? 'error' : messageColor;
    return stableVerbRow(color, message);
  }

  // densable RTt: after stall, fade the verb toward theme.warning.
  if (thinkingIntensity > 0) {
    const baseColorStr = theme[messageColor];
    const warningStr = theme.warning;
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    const warningRGB = warningStr ? parseRGB(warningStr) : null;

    if (baseRGB && warningRGB) {
      const interpolated = interpolateColor(baseRGB, warningRGB, thinkingIntensity);
      return stableVerbRow(toRGBColor(interpolated), message);
    }

    const color = thinkingIntensity > 0.5 ? 'warning' : messageColor;
    return stableVerbRow(color, message);
  }

  // tool-use mode: all chars flash with the same opacity, so render as a
  // single <Text> instead of N individual FlashingChar components.
  if (mode === 'tool-use') {
    const baseColorStr = theme[messageColor];
    const shimmerColorStr = theme[shimmerColor];
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    const shimmerRGB = shimmerColorStr ? parseRGB(shimmerColorStr) : null;

    if (baseRGB && shimmerRGB) {
      const interpolated = interpolateColor(baseRGB, shimmerRGB, flashOpacity);
      return stableVerbRow(toRGBColor(interpolated), message);
    }

    const color = flashOpacity > 0.5 ? shimmerColor : messageColor;
    return stableVerbRow(color, message);
  }

  // densable RTt offscreen is 2 Text. Analog Ink appendChildNode/removeChildNode
  // markDirty the whole spinner row on 2↔4 (Image 37 闪, official Ink does not).
  // KEEP a stable 4-Text sibling shape; offscreen puts the whole message in `before`.
  const shimmerStart = glimmerIndex - 1;
  const shimmerEnd = glimmerIndex + 1;
  const glimmerOffscreen = shimmerStart >= messageWidth || shimmerEnd < 0;
  const clampedStart = glimmerOffscreen ? messageWidth : Math.max(0, shimmerStart);
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
      <Text color={messageColor}>{before}</Text>
      <Text color={shimmerColor}>{shim}</Text>
      <Text color={messageColor}>{after}</Text>
      <Text color={messageColor}> </Text>
    </>
  );
}
