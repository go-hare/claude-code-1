import React, { useContext } from 'react';
import { useAnimationFrame } from '../hooks/use-animation-frame.js';
import { AccessibilityContext, Box, Text } from '../index.js';

/**
 * densable Ws @203400000 — ping-pong asterisk spinner (`KCe()`), height=1 width=2.
 * Keeps U+2731 `✱` at index 2 so emoji-regex stays 1-column wide.
 */
const GHOSTTY_SPINNER_FRAMES = ['·', '✢', '✱', '✶', '✻', '✻'];
const DEFAULT_SPINNER_FRAMES = ['·', '✢', '✱', '✶', '✻', '✽'];

const GHOSTTY_PING_PONG = [...GHOSTTY_SPINNER_FRAMES, ...[...GHOSTTY_SPINNER_FRAMES].reverse()];
const DEFAULT_PING_PONG = [...DEFAULT_SPINNER_FRAMES, ...[...DEFAULT_SPINNER_FRAMES].reverse()];

function getSpinnerPingPongFrames(): string[] {
  if (process.env.TERM === 'xterm-ghostty') {
    return GHOSTTY_PING_PONG;
  }
  return DEFAULT_PING_PONG;
}

// densable Ws `Em(Ko(cr))` — settings.prefersReducedMotion. Ink cannot import
// src settings, so the host injects the reader at startup.
let _prefersReducedMotion: () => boolean = () => false;

/** Inject the `prefersReducedMotion` settings reader. Call once at startup. */
export function setSpinnerReducedMotionGetter(getter: () => boolean): void {
  _prefersReducedMotion = getter;
}

/**
 * Animated Claude asterisk spinner for LoadingState (`hr` → `Ws`).
 */
export function Spinner(): React.ReactNode {
  const isScreenReader = useContext(AccessibilityContext);
  const reducedMotion = _prefersReducedMotion() || isScreenReader;
  const [ref, time] = useAnimationFrame(reducedMotion ? null : 120);

  if (reducedMotion) {
    return (
      <Box ref={ref} aria-hidden flexWrap="wrap" height={1} width={2}>
        <Text color="text">●</Text>
      </Box>
    );
  }

  const spinnerFrames = getSpinnerPingPongFrames();
  const frame = Math.floor(time / 120) % spinnerFrames.length;

  return (
    <Box ref={ref} aria-hidden flexWrap="wrap" height={1} width={2}>
      <Text color="text">{spinnerFrames[frame]}</Text>
    </Box>
  );
}
