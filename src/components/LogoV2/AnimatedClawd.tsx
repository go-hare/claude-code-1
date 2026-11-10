import * as React from 'react';
import { useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityContext, Box, Text, type Theme } from '@anthropic/ink';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import {
  CLAWD_WIDTH,
  Clawd,
  type ClawdArms,
  type ClawdCellPainter,
  type ClawdEyes,
  type ClawdFacing,
  type ClawdFeet,
  type ClawdPartsPose,
  type ClawdPoseInput,
  isClawdTurnPose,
  isNonAppleTerminal,
  resolveClawdPartsPose,
} from './Clawd.js';

type PoofKind = 'dot' | 'wave';
type ShadowKind = 'wide' | 'narrow';

type Frame = {
  pose: ClawdPoseInput;
  offset: number;
  x?: number;
  poof?: PoofKind;
  shadow?: ShadowKind;
};

export type ClawdAnimationSequenceName =
  | 'jump'
  | 'look'
  | 'celebrate'
  | 'skip'
  | 'spin'
  | 'peekaboo'
  | 'drop'
  | 'waddle'
  | 'peek'
  | 'wink'
  | 'boop'
  | 'tap'
  | 'sneeze'
  | 'turn'
  | 'coin-hop';

export type AnimatedClawdRestState = {
  pose: ClawdPoseInput;
  paint?: ClawdCellPainter;
  held?: React.ReactNode;
  heldWidth?: number;
};

type Props = {
  autoplay?: boolean;
  sequence?: ClawdAnimationSequenceName;
  delayMs?: number;
  onComplete?: () => void;
  reserveCrouchRow?: boolean;
  color?: keyof Theme;
  rest?: AnimatedClawdRestState;
};

const CLAWD_HEIGHT = 3;
const FRAME_MS = 60;
const IDLE: Frame = { pose: 'default', offset: 0 };
const incrementFrame = (i: number) => i + 1;

const POOF_GLYPHS: Record<PoofKind, string> = {
  dot: '·',
  wave: '~',
};

const SHADOW_SPECS: Record<ShadowKind, { glyphs: string; left: number }> = {
  wide: { glyphs: '▁▁▁', left: 3 },
  narrow: { glyphs: '▁', left: 4 },
};

function crouchPoof(): Frame[] {
  return [
    { pose: 'default', offset: 1, poof: 'dot' },
    { pose: 'default', offset: 1, poof: 'wave' },
  ];
}

function hold(
  pose: ClawdPoseInput,
  frames: number,
  opts: { offset?: number; x?: number; poof?: PoofKind; shadow?: ShadowKind } = {},
): Frame[] {
  const { offset = 0, x, poof, shadow } = opts;
  return Array.from({ length: frames }, () => ({ pose, offset, x, poof, shadow }));
}

function turnSweep(facings: readonly ClawdFacing[], shadow?: ShadowKind): Frame[] {
  return facings.flatMap(facing => hold({ facing }, 1, { shadow }));
}

function partsPose(eyes: ClawdEyes, arms: ClawdArms = 'down', feet: ClawdFeet = 'both'): ClawdPartsPose {
  return { eyes, arms, feet };
}

const BLINK_TAIL: readonly Frame[] = [...hold(partsPose('closed'), 1), IDLE];

const JUMP: readonly Frame[] = [
  ...crouchPoof(),
  ...hold('arms-up', 3),
  ...hold('default', 1),
  ...crouchPoof(),
  ...hold('arms-up', 3),
  ...hold('default', 1),
];

const LOOK: readonly Frame[] = [...hold('look-right', 5), ...hold('look-left', 5), ...hold('default', 1)];

const AUTOPLAY_LOOP: readonly Frame[] = [...hold('default', 12), ...hold('look-right', 5), ...hold('look-left', 5)];

const CELEBRATE: readonly Frame[] = [...JUMP, ...hold('default', 3, { offset: 1 })];

const SPIN: readonly Frame[] = [
  ...hold('look-left', 2),
  ...hold('look-right', 2),
  ...hold('look-left', 2),
  ...hold('arms-up', 3),
  ...hold('default', 1),
];

const SKIP: readonly Frame[] = [
  ...hold('default', 1, { offset: 1, x: -CLAWD_WIDTH }),
  ...hold('arms-up', 2, { x: -6 }),
  ...hold('default', 1, { x: -6 }),
  ...hold('default', 1, { offset: 1, x: -6 }),
  ...hold('arms-up', 2, { x: -3 }),
  ...hold('default', 1, { x: -3 }),
  ...hold('default', 1, { offset: 1, x: -3 }),
  ...hold('arms-up', 2),
  ...crouchPoof(),
  ...hold('default', 1),
];

const PEEKABOO: readonly Frame[] = [
  ...hold('default', 1, { offset: CLAWD_HEIGHT }),
  ...hold('default', 3, { offset: 2 }),
  ...hold('look-right', 3, { offset: 2 }),
  ...hold('look-left', 3, { offset: 2 }),
  ...hold('default', 2, { offset: 2 }),
  ...hold('default', 1, { offset: 1 }),
  ...hold('arms-up', 4),
  ...hold('default', 2),
  ...BLINK_TAIL,
];

const DROP: readonly Frame[] = [
  ...hold('arms-up', 1, { offset: -CLAWD_HEIGHT }),
  ...hold('arms-up', 2, { offset: -2 }),
  ...hold('arms-up', 2, { offset: -1 }),
  ...hold('arms-up', 1),
  ...crouchPoof(),
  ...hold('default', 3),
  ...BLINK_TAIL,
];

const WADDLE: readonly Frame[] = [
  ...hold('look-right', 1, { x: -CLAWD_WIDTH }),
  ...[-6, -5, -4, -3, -2, -1].flatMap(x => hold(partsPose('right', 'down', x % 2 === 0 ? 'left' : 'right'), 2, { x })),
  ...hold('look-right', 2),
  ...hold('default', 2),
  ...BLINK_TAIL,
];

const PEEK: readonly Frame[] = [
  ...hold('look-right', 1, { x: -CLAWD_WIDTH }),
  ...hold('look-right', 5, { x: -6 }),
  ...hold('look-right', 3, { x: -CLAWD_WIDTH }),
  ...hold('look-right', 4, { x: -5 }),
  ...hold('arms-up', 2, { x: -3 }),
  ...hold('arms-up', 2),
  ...crouchPoof(),
  IDLE,
];

const WINK: readonly Frame[] = [...hold(partsPose('wink'), 5), IDLE];

const BOOP: readonly Frame[] = [
  ...hold(partsPose('closed'), 1, { offset: 1, poof: 'dot' }),
  ...hold(partsPose('closed'), 2, { offset: 1, poof: 'wave' }),
  ...hold('look-left', 4),
  ...hold('default', 2),
  ...BLINK_TAIL,
];

const TAP: readonly Frame[] = [
  ...hold(partsPose('open', 'down', 'left'), 2),
  ...hold(partsPose('open', 'down', 'right'), 2),
  ...hold(partsPose('open', 'down', 'left'), 2),
  ...hold(partsPose('open', 'down', 'right'), 2),
  ...hold(partsPose('open', 'down', 'left'), 1),
  ...hold(partsPose('open', 'down', 'right'), 1),
  ...hold('arms-up', 3),
  IDLE,
];

const SNEEZE: readonly Frame[] = [
  ...hold(partsPose('closed', 'up'), 4),
  ...hold(partsPose('closed'), 2, { offset: 1, poof: 'wave' }),
  ...hold(partsPose('closed'), 2),
  ...hold('default', 2),
  ...BLINK_TAIL,
];

const TURN: readonly Frame[] = [
  ...turnSweep(['right-12', 'right-30', 'right-55', 'right-75', 'edge']),
  ...turnSweep(['back-105', 'back-125', 'back-150', 'back', 'back']),
  ...turnSweep(['back-150', 'back-125', 'back-105', 'edge']),
  ...turnSweep(['left-75', 'left-55', 'left-30', 'left-12']),
  IDLE,
];

const COIN_HOP: readonly Frame[] = [
  ...hold('default', 2, { offset: 1 }),
  ...hold('arms-up', 1, { shadow: 'wide' }),
  ...turnSweep(['right-55', 'edge', 'back-125', 'back'], 'narrow'),
  ...turnSweep(['back-125', 'edge', 'left-55'], 'narrow'),
  ...hold('arms-up', 1, { shadow: 'wide' }),
  ...crouchPoof(),
  IDLE,
];

const SEQUENCES: Record<ClawdAnimationSequenceName, readonly Frame[]> = {
  jump: JUMP,
  look: LOOK,
  celebrate: CELEBRATE,
  skip: SKIP,
  spin: SPIN,
  peekaboo: PEEKABOO,
  drop: DROP,
  waddle: WADDLE,
  peek: PEEK,
  wink: WINK,
  boop: BOOP,
  tap: TAP,
  sneeze: SNEEZE,
  turn: TURN,
  'coin-hop': COIN_HOP,
};

const ALL_ENTRANCE_NAMES: readonly ClawdAnimationSequenceName[] = [
  'skip',
  'jump',
  'look',
  'spin',
  'peekaboo',
  'drop',
  'waddle',
  'peek',
  'wink',
  'boop',
  'tap',
  'sneeze',
  'turn',
  'coin-hop',
];

const CLICK_SEQUENCE_NAMES: readonly ClawdAnimationSequenceName[] = ALL_ENTRANCE_NAMES.filter(
  name => (SEQUENCES[name][0]?.x ?? 0) === 0,
);

function filterForTerminal(
  names: readonly ClawdAnimationSequenceName[],
  nonApple: boolean,
): readonly ClawdAnimationSequenceName[] {
  if (nonApple) return names;
  return names.filter(name => {
    const frames = SEQUENCES[name];
    const first = frames[0];
    if (first === undefined || isClawdTurnPose(first.pose)) return false;
    return (
      !frames.some(frame => isClawdTurnPose(frame.pose)) &&
      (resolveClawdPartsPose(first.pose).eyes !== 'open' || first.offset !== 0 || (first.x ?? 0) !== 0)
    );
  });
}

function withDelayFrames(name: ClawdAnimationSequenceName, delayMs: number | undefined): readonly Frame[] {
  const frames = SEQUENCES[name];
  const first = frames[0];
  if (!delayMs || first === undefined) return frames;
  const lead = (first.x ?? 0) !== 0 || Math.abs(first.offset) >= CLAWD_HEIGHT ? first : IDLE;
  const count = Math.max(1, Math.round(delayMs / FRAME_MS));
  return [...Array.from({ length: count }, () => lead), ...frames];
}

export function AnimatedClawd({
  autoplay = false,
  sequence,
  delayMs,
  onComplete,
  reserveCrouchRow = false,
  color,
  rest,
}: Props = {}): React.ReactNode {
  const srContext = useContext(AccessibilityContext);
  const screenReader = srContext || isScreenReaderModeEnabled();
  const { pose, bounceOffset, x, poof, shadow, isPlaying, onClick } = useClawdAnimation(
    autoplay,
    sequence,
    delayMs,
    onComplete,
    screenReader,
  );

  if (screenReader) {
    return null;
  }

  const containerHeight = reserveCrouchRow ? CLAWD_HEIGHT + 1 : CLAWD_HEIGHT;
  const activeRest = isPlaying ? undefined : rest;
  const totalWidth = CLAWD_WIDTH + (rest?.heldWidth ?? 0);
  const adjustedOffset = bounceOffset > 1 ? bounceOffset + containerHeight - CLAWD_HEIGHT : bounceOffset;
  const effectivePose = activeRest?.pose ?? pose;
  const effectivePaint = activeRest?.paint;

  return (
    <Box height={containerHeight} width={totalWidth} flexShrink={0} noSelect onClick={onClick}>
      <Box height={containerHeight} width={CLAWD_WIDTH} flexDirection="column" flexShrink={0} overflow="hidden">
        <Box marginTop={adjustedOffset} marginLeft={x} flexShrink={0}>
          <Clawd pose={effectivePose} color={color} paint={effectivePaint} />
        </Box>
        {poof && bounceOffset > 0 ? (
          <>
            <Box position="absolute" top={CLAWD_HEIGHT - 1} left={0}>
              <Text color="inactive">{POOF_GLYPHS[poof]}</Text>
            </Box>
            <Box position="absolute" top={CLAWD_HEIGHT - 1} right={0}>
              <Text color="inactive">{POOF_GLYPHS[poof]}</Text>
            </Box>
          </>
        ) : null}
        {shadow ? (
          <Box position="absolute" top={CLAWD_HEIGHT - 1} left={SHADOW_SPECS[shadow].left}>
            <Text color="inactive">{SHADOW_SPECS[shadow].glyphs}</Text>
          </Box>
        ) : null}
      </Box>
      {activeRest ? <Box flexShrink={0}>{activeRest.held}</Box> : null}
    </Box>
  );
}

function useClawdAnimation(
  autoplay: boolean,
  sequence: ClawdAnimationSequenceName | undefined,
  delayMs: number | undefined,
  onComplete: (() => void) | undefined,
  screenReader: boolean,
): {
  pose: ClawdPoseInput;
  bounceOffset: number;
  x: number;
  poof?: PoofKind;
  shadow?: ShadowKind;
  isPlaying: boolean;
  onClick: () => void;
} {
  const [disabled] = useState(() => Boolean(getInitialSettings().prefersReducedMotion) || screenReader);
  const shouldStartImmediately = (autoplay || sequence !== undefined) && !disabled;
  const [frameIndex, setFrameIndex] = useState(shouldStartImmediately ? 0 : -1);
  const [frames, setFrames] = useState<readonly Frame[]>(() =>
    sequence ? withDelayFrames(sequence, delayMs) : autoplay ? AUTOPLAY_LOOP : JUMP,
  );
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const clickableRef = useRef(!sequence);

  useEffect(() => {
    if (disabled) {
      onCompleteRef.current?.();
    }
  }, [disabled]);

  const onClick = () => {
    if (autoplay || disabled || frameIndex !== -1 || !clickableRef.current) return;
    const pool = filterForTerminal(CLICK_SEQUENCE_NAMES, isNonAppleTerminal());
    const chosen = pool[Math.floor(Math.random() * pool.length)] ?? 'jump';
    setFrames(SEQUENCES[chosen]);
    setFrameIndex(0);
  };

  useEffect(() => {
    if (frameIndex === -1) return;
    if (frameIndex >= frames.length) {
      clickableRef.current = true;
      onCompleteRef.current?.();
      setFrameIndex(autoplay && !sequence ? 0 : -1);
      return;
    }
    const timer = setTimeout(setFrameIndex, FRAME_MS, incrementFrame);
    return () => clearTimeout(timer);
  }, [frameIndex, frames, autoplay, sequence]);

  const restFrame = sequence ? (SEQUENCES[sequence][SEQUENCES[sequence].length - 1] ?? IDLE) : IDLE;
  const isPlaying = frameIndex >= 0 && frameIndex < frames.length;
  const current = isPlaying ? frames[frameIndex]! : restFrame;
  return {
    pose: current.pose,
    bounceOffset: current.offset,
    x: current.x ?? 0,
    poof: current.poof,
    shadow: current.shadow,
    isPlaying,
    onClick,
  };
}
