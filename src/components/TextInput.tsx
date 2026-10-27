import { feature } from 'bun:bundle';
import chalk from 'chalk';
import React, { useRef } from 'react';
import { useVoiceState } from '../context/voice.js';
import { useClipboardImageHint } from '../hooks/useClipboardImageHint.js';
import { useSettings } from '../hooks/useSettings.js';
import { useTextInput } from '../hooks/useTextInput.js';
import { Box, color, isNativeCursorEnabled, useAnimationFrame, useTerminalFocus, useTheme } from '@anthropic/ink';
import type { BaseTextInputProps } from '../types/textInputTypes.js';
import { leftoverXt, leftoverXy } from '../utils/leftoverXy.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { BaseTextInput } from './BaseTextInput.js';
import { hueToRgb } from './Spinner/utils.js';

// Block characters for waveform bars: space (silent) + 8 rising block elements.
const BARS = ' \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';

// Mini waveform cursor width
const CURSOR_WAVEFORM_WIDTH = 1;

// Smoothing factor (0 = instant, 1 = frozen). Applied as EMA to
// smooth both rises and falls for a steady, non-jittery bar.
const SMOOTH = 0.7;

// Boost factor for audio levels — computeLevel normalizes with a
// conservative divisor (rms/2000), so normal speech sits around
// 0.3-0.5. This multiplier lets the bar use the full range.
const LEVEL_BOOST = 1.8;

// Raw audio level threshold (pre-boost) below which the cursor is
// grey. computeLevel returns sqrt(rms/2000), so ambient mic noise
// typically sits at 0.05-0.15. Speech starts around 0.2+.
const SILENCE_THRESHOLD = 0.15;

export type Props = BaseTextInputProps & {
  highlights?: TextHighlight[];
};

export default function TextInput(props: Props): React.ReactNode {
  const [theme] = useTheme();
  const isTerminalFocused = useTerminalFocus();
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;

  const voiceStateRaw = useVoiceState(s => s.voiceState);
  const voiceState = feature('VOICE_MODE') ? voiceStateRaw : ('idle' as const);
  const isVoiceRecording = voiceState === 'recording';

  const audioLevelsRaw = useVoiceState(s => s.voiceAudioLevels);
  const audioLevels = feature('VOICE_MODE') ? audioLevelsRaw : [];
  const smoothedRef = useRef<number[]>(new Array(CURSOR_WAVEFORM_WIDTH).fill(0));

  const needsAnimation = isVoiceRecording && !reducedMotion;
  const [animRefRaw, animTimeRaw] = useAnimationFrame(needsAnimation ? 50 : null);
  const animRef = feature('VOICE_MODE') ? animRefRaw : () => {};
  const animTime = feature('VOICE_MODE') ? animTimeRaw : 0;

  // Show hint when terminal regains focus and clipboard has an image
  useClipboardImageHint(isTerminalFocused, !!props.onImagePaste);

  // densable ir: S=!i?Xt:P?hex:u?Yt:xY. u=eD() nativeCursor. P=nst hex.
  const nativeCursor = isNativeCursorEnabled();
  const leftoverVoiceHex = isVoiceRecording && !reducedMotion;
  let invert: (text: string) => string;
  if (!isTerminalFocused) {
    invert = leftoverXt;
  } else if (leftoverVoiceHex) {
    // Single-bar waveform from the latest audio level
    const smoothed = smoothedRef.current;
    const raw = audioLevels.length > 0 ? (audioLevels[audioLevels.length - 1] ?? 0) : 0;
    const target = Math.min(raw * LEVEL_BOOST, 1);
    smoothed[0] = (smoothed[0] ?? 0) * SMOOTH + target * (1 - SMOOTH);
    const displayLevel = smoothed[0] ?? 0;
    const barIndex = Math.max(1, Math.min(Math.round(displayLevel * (BARS.length - 1)), BARS.length - 1));
    const isSilent = raw < SILENCE_THRESHOLD;
    const hue = ((animTime / 1000) * 90) % 360;
    const { r, g, b } = isSilent ? { r: 128, g: 128, b: 128 } : hueToRgb(hue);
    invert = () => chalk.rgb(r, g, b)(BARS[barIndex]!);
  } else if (nativeCursor) {
    invert = leftoverXt;
  } else {
    invert = leftoverXy;
  }

  const textInputState = useTextInput({
    value: props.value,
    onChange: props.onChange,
    onSubmit: props.onSubmit,
    onExit: props.onExit,
    onExitMessage: props.onExitMessage,
    onLeftArrowOnEmpty: props.onLeftArrowOnEmpty,
    onLeftArrowOnEmptyMessage: props.onLeftArrowOnEmptyMessage,
    onHistoryReset: props.onHistoryReset,
    onHistoryUp: props.onHistoryUp,
    onHistoryDown: props.onHistoryDown,
    onClearInput: props.onClearInput,
    onHoldCleared: props.onHoldCleared,
    focus: props.focus,
    mask: props.mask,
    multiline: props.multiline,
    // densable ir @202727401: `E=t.showCursor&&!c?" ":""` — c=Xe() screen
    // reader only. Native eD() switches invert to Yt/identity; it does not
    // clear cursorChar. Vim path still gates with !eD (gold N=eD).
    cursorChar: props.showCursor && !isScreenReaderModeEnabled() ? ' ' : '',
    highlightPastedText: props.highlightPastedText,
    invert,
    themeText: color('text', theme),
    columns: props.columns,
    maxVisibleLines: props.maxVisibleLines,
    onImagePaste: props.onImagePaste,
    disableCursorMovementForUpDownKeys: props.disableCursorMovementForUpDownKeys,
    disableEscapeDoublePress: props.disableEscapeDoublePress,
    externalOffset: props.cursorOffset,
    onOffsetChange: props.onChangeCursorOffset,
    inputFilter: props.inputFilter,
    inlineGhostText: props.inlineGhostText,
    dim: chalk.dim,
    liveValueRef: props.liveValueRef,
    liveOffsetRef: props.liveOffsetRef,
  });

  return (
    <Box ref={animRef}>
      <BaseTextInput
        inputState={textInputState}
        terminalFocus={isTerminalFocused}
        highlights={props.highlights}
        invert={invert}
        hidePlaceholderText={isVoiceRecording}
        {...props}
        // densable UTt `visible:!c` — soft invert cell (voice hex or leftoverXy)
        // counts as painted so the hardware caret stays off. Native / unfocused
        // identity invert is unpainted. Match Vim `!nativeCursor` when focused.
        cursorCellPainted={leftoverVoiceHex || (isTerminalFocused && !nativeCursor)}
      />
    </Box>
  );
}
