import * as React from 'react';
import { AccessibilityContext, Box, type Color, Text, type Theme } from '@anthropic/ink';
import { env } from '../../utils/env.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';

export type ClawdPose =
  | 'default'
  | 'arms-up' // both arms raised (used during jump)
  | 'look-left' // both pupils shifted left
  | 'look-right'; // both pupils shifted right

export type ClawdEyes = 'open' | 'left' | 'right' | 'closed' | 'wink';
export type ClawdArms = 'down' | 'up' | 'one-up';
export type ClawdFeet = 'both' | 'left' | 'right';

export type ClawdPartsPose = {
  eyes: ClawdEyes;
  arms: ClawdArms;
  feet: ClawdFeet;
};

export type ClawdFacing =
  | 'right-12'
  | 'right-30'
  | 'right-55'
  | 'right-75'
  | 'edge'
  | 'back-105'
  | 'back-125'
  | 'back-150'
  | 'back'
  | 'left-75'
  | 'left-55'
  | 'left-30'
  | 'left-12';

export type ClawdTurnPose = {
  facing: ClawdFacing;
};

export type ClawdPoseInput = ClawdPose | ClawdPartsPose | ClawdTurnPose;
export type ClawdCellPainter = (column: number, row: number) => Color;

type Props = {
  pose?: ClawdPoseInput;
  color?: keyof Theme;
  paint?: ClawdCellPainter;
};

// Standard-terminal pose fragments. Each row is split into segments so we can
// vary only the parts that change (eyes, arms) while keeping the body/bg spans
// stable. All poses end up 9 cols wide (densable 239 Bwg / KB; 2.1.289 updated
// feet from {'  '}▝▝ ▝▝{'  '} to ' ▝▝   ▝▝ ' so outer feet align under elbows).
//
// 236 #18 / 239 Bwg: iTerm (and every non-Apple TERM) uses this table — there
// is no iTerm.app branch. Eyes/feet evenness is the glyph set, not font-size
// math. r1 stays 8 cols (r1R empty except arms-up / one-up ▄); r2/feet stay 9.
type Segments = {
  /** row 1 left (no bg): optional raised arm + side */
  r1L: string;
  /** row 1 eyes (with bg): left-eye, forehead, right-eye */
  r1E: string;
  /** row 1 right (no bg): side + optional raised arm */
  r1R: string;
  /** row 2 left (no bg): arm + body curve */
  r2L: string;
  /** row 2 right (no bg): body curve + arm */
  r2R: string;
};

/**
 * densable clawd column footprint. Exported for CondensedLogo / AgentView
 * pathBudget math (Clawd ~9 + gap 2 + pad ≈ 15).
 *
 * densable Fleet header hosts KB with NO fixed width wrapper:
 *   gap:2 marginBottom:1; !wpe && Ys>=70 && <KB/>; text col is plain column.
 * Do not invent width={CLAWD_WIDTH} on Clawd or its host — that clips glyph
 * rows into a solid orange slab (observed in Agents header).
 */
export const CLAWD_WIDTH = 9;

// densable 239 Bwg — do NOT pad default/look r1R; r1 is 8 cols, r2/feet are 9.
// densable KB root: flexDirection column + flexShrink:0 only (no width).
const POSES: Record<ClawdPose, Segments> = {
  default: { r1L: ' ▐', r1E: '▛███▛█', r1R: '', r2L: '▝▜', r2R: '█▀' },
  'look-left': { r1L: ' ▐', r1E: '▟███▟█', r1R: '', r2L: '▝▜', r2R: '█▀' },
  'look-right': { r1L: ' ▐', r1E: '█▟███▟', r1R: '', r2L: '▝▜', r2R: '█▀' },
  'arms-up': { r1L: '▗▟', r1E: '▛███▛█', r1R: '▄', r2L: ' ▜', r2R: '█▘' },
};

const NAMED_PARTS_POSES: Record<ClawdPose, ClawdPartsPose> = {
  default: { eyes: 'open', arms: 'down', feet: 'both' },
  'arms-up': { eyes: 'open', arms: 'up', feet: 'both' },
  'look-left': { eyes: 'left', arms: 'down', feet: 'both' },
  'look-right': { eyes: 'right', arms: 'down', feet: 'both' },
};

const ARM_SEGMENTS: Record<ClawdArms, Omit<Segments, 'r1E'>> = {
  down: { r1L: POSES.default.r1L, r1R: POSES.default.r1R, r2L: POSES.default.r2L, r2R: POSES.default.r2R },
  up: {
    r1L: POSES['arms-up'].r1L,
    r1R: POSES['arms-up'].r1R,
    r2L: POSES['arms-up'].r2L,
    r2R: POSES['arms-up'].r2R,
  },
  'one-up': { r1L: ' ▐', r1R: '▄', r2L: '▝▜', r2R: '█▘' },
};

type EyeSpan = { glyphs: string; lid?: boolean };

const EYE_SPANS: Record<ClawdEyes, readonly EyeSpan[]> = {
  open: [{ glyphs: POSES.default.r1E }],
  left: [{ glyphs: POSES['look-left'].r1E }],
  right: [{ glyphs: POSES['look-right'].r1E }],
  closed: [{ glyphs: '▂', lid: true }, { glyphs: '███' }, { glyphs: '▂', lid: true }, { glyphs: '█' }],
  wink: [{ glyphs: '▛███' }, { glyphs: '▂', lid: true }, { glyphs: '█' }],
};

const FEET_GLYPHS: Record<ClawdFeet, string> = {
  both: ' ▝▝   ▝▝ ',
  left: ' ▝▝      ',
  right: '      ▝▝ ',
};

// Apple Terminal uses a bg-fill trick (see below), so only eye poses make
// sense. Arm poses fall back to default. densable rRp / 2.1.289 Ie.
const APPLE_EYES: Record<ClawdPose | ClawdEyes, string> = {
  default: ' ▗   ▖ ',
  'look-left': ' ▘   ▘ ',
  'look-right': ' ▝   ▝ ',
  'arms-up': ' ▗   ▖ ',
  open: ' ▗   ▖ ',
  left: ' ▘   ▘ ',
  right: ' ▝   ▝ ',
  closed: ' ▂   ▂ ',
  wink: ' ▗   ▂ ',
};

type TurnRow = { glyphs: string; from: number; to: number };

const TURN_FRAMES: Record<ClawdFacing, readonly TurnRow[]> = {
  'right-12': [
    { glyphs: ' ▐█▜██▛█ ', from: 2, to: 8 },
    { glyphs: '▝▜██████▀', from: 2, to: 7 },
    { glyphs: ' ▝▝   ▝▝ ', from: 0, to: 0 },
  ],
  'right-30': [
    { glyphs: '  █▛██▛▌ ', from: 2, to: 7 },
    { glyphs: ' ▝█████▛ ', from: 2, to: 7 },
    { glyphs: '  ▘▘  ▘▘ ', from: 0, to: 0 },
  ],
  'right-55': [
    { glyphs: '  ▐█▛█▜  ', from: 3, to: 7 },
    { glyphs: '  ▐████  ', from: 3, to: 7 },
    { glyphs: '  ▝▝ ▝▝  ', from: 0, to: 0 },
  ],
  'right-75': [
    { glyphs: '   ██▛▌  ', from: 3, to: 6 },
    { glyphs: '   ███▌  ', from: 3, to: 6 },
    { glyphs: '   ▘  ▘  ', from: 0, to: 0 },
  ],
  edge: [
    { glyphs: '   ▐██   ', from: 4, to: 6 },
    { glyphs: '   ▐██   ', from: 4, to: 6 },
    { glyphs: '   ▝ ▝   ', from: 0, to: 0 },
  ],
  'back-105': [
    { glyphs: '   ███▌  ', from: 3, to: 6 },
    { glyphs: '   ███▌  ', from: 3, to: 6 },
    { glyphs: '   ▘  ▘  ', from: 0, to: 0 },
  ],
  'back-125': [
    { glyphs: '  ▐████  ', from: 3, to: 7 },
    { glyphs: '  ▐████  ', from: 3, to: 7 },
    { glyphs: '  ▝▝ ▝▝  ', from: 0, to: 0 },
  ],
  'back-150': [
    { glyphs: '  █████▌ ', from: 2, to: 7 },
    { glyphs: ' ▝█████▛ ', from: 2, to: 7 },
    { glyphs: '  ▘▘  ▘▘ ', from: 0, to: 0 },
  ],
  back: [
    { glyphs: ' ▐██████ ', from: 2, to: 8 },
    { glyphs: '▝▜██████▀', from: 2, to: 7 },
    { glyphs: ' ▝▝   ▝▝ ', from: 0, to: 0 },
  ],
  'left-75': [
    { glyphs: '   ▛██▌  ', from: 3, to: 6 },
    { glyphs: '   ███▌  ', from: 3, to: 6 },
    { glyphs: '   ▘  ▘  ', from: 0, to: 0 },
  ],
  'left-55': [
    { glyphs: '  ▐▜▛██  ', from: 3, to: 7 },
    { glyphs: '  ▐████  ', from: 3, to: 7 },
    { glyphs: '  ▝▝ ▝▝  ', from: 0, to: 0 },
  ],
  'left-30': [
    { glyphs: '  ▛██▛█▌ ', from: 2, to: 7 },
    { glyphs: ' ▝█████▛ ', from: 2, to: 7 },
    { glyphs: '  ▘▘  ▘▘ ', from: 0, to: 0 },
  ],
  'left-12': [
    { glyphs: ' ▐▛███▜█ ', from: 2, to: 8 },
    { glyphs: '▝▜██████▀', from: 2, to: 7 },
    { glyphs: ' ▝▝   ▝▝ ', from: 0, to: 0 },
  ],
};

export function resolveClawdPartsPose(pose: ClawdPose | ClawdPartsPose): ClawdPartsPose {
  return typeof pose === 'string' ? NAMED_PARTS_POSES[pose] : pose;
}

export function isClawdTurnPose(pose: ClawdPoseInput): pose is ClawdTurnPose {
  return typeof pose !== 'string' && 'facing' in pose;
}

export function isNonAppleTerminal(): boolean {
  return env.terminal !== 'Apple_Terminal';
}

/**
 * densable KB / _ta / 2.1.289 Xge.
 * Standard KB: column + flexShrink:0; theme keys clawd_body / clawd_background.
 * Apple _ta: keep flexShrink:0 and ansi:black pupils so Fleet header row pressure
 * and Apple Terminal truecolor do not crush or wash out pupils.
 */
export function Clawd({ pose = 'default', color = 'clawd_body', paint }: Props = {}): React.ReactNode {
  const srContext = React.useContext(AccessibilityContext);
  if (srContext || isScreenReaderModeEnabled()) {
    return null;
  }
  if (isClawdTurnPose(pose)) {
    return isNonAppleTerminal() ? (
      <TurnClawd facing={pose.facing} color={color} />
    ) : (
      <AppleTerminalClawd eyes="open" color={color} />
    );
  }
  const parts = resolveClawdPartsPose(pose);
  if (env.terminal === 'Apple_Terminal') {
    return <AppleTerminalClawd eyes={parts.eyes} color={color} />;
  }

  const arms = ARM_SEGMENTS[parts.arms];
  const feet = FEET_GLYPHS[parts.feet];

  // Fast static path when default clawd_body with no per-cell paint and open/left/right single-span eyes
  if (!paint && color === 'clawd_body' && EYE_SPANS[parts.eyes].length === 1 && !EYE_SPANS[parts.eyes][0]?.lid) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <Text>
          <Text color="clawd_body">{arms.r1L}</Text>
          <Text color="clawd_body" backgroundColor="clawd_background">
            {EYE_SPANS[parts.eyes][0]!.glyphs}
          </Text>
          <Text color="clawd_body">{arms.r1R}</Text>
        </Text>
        <Text>
          <Text color="clawd_body">{arms.r2L}</Text>
          <Text color="clawd_body" backgroundColor="clawd_background">
            █████
          </Text>
          <Text color="clawd_body">{arms.r2R}</Text>
        </Text>
        <Text color="clawd_body">{feet}</Text>
      </Box>
    );
  }

  const cellPaint: ClawdCellPainter = paint ?? (() => color as Color);
  const positionedEyes: Array<{ span: EyeSpan; column: number }> = [];
  for (const span of EYE_SPANS[parts.eyes]) {
    const prev = positionedEyes[positionedEyes.length - 1];
    positionedEyes.push({
      span,
      column: prev ? prev.column + prev.span.glyphs.length : 2,
    });
  }

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text>
        <PaintedSpan glyphs={arms.r1L} column={0} row={0} paint={cellPaint} />
        {positionedEyes.map(({ span, column }) => (
          <PaintedSpan
            key={column}
            glyphs={span.glyphs}
            column={column}
            row={0}
            paint={cellPaint}
            on={span.lid ? 'lid' : 'eyes'}
          />
        ))}
        <PaintedSpan glyphs={arms.r1R} column={8} row={0} paint={cellPaint} />
      </Text>
      <Text>
        <PaintedSpan glyphs={arms.r2L} column={0} row={1} paint={cellPaint} />
        <PaintedSpan glyphs="█████" column={2} row={1} paint={cellPaint} on="eyes" />
        <PaintedSpan glyphs={arms.r2R} column={7} row={1} paint={cellPaint} />
      </Text>
      <Text>
        <PaintedSpan glyphs={feet} column={0} row={2} paint={cellPaint} />
      </Text>
    </Box>
  );
}

function PaintedSpan({
  glyphs,
  column,
  row,
  paint,
  on,
}: {
  glyphs: string;
  column: number;
  row: number;
  paint: ClawdCellPainter;
  on?: 'eyes' | 'lid';
}): React.ReactNode {
  const runs: Array<{ glyphs: string; color: Color }> = [];
  const chars = Array.from(glyphs);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const last = runs[runs.length - 1];
    const resolved = ch === ' ' && last ? last.color : paint(column + i, row);
    if (last?.color === resolved) {
      last.glyphs += ch;
    } else {
      runs.push({ glyphs: ch, color: resolved });
    }
  }
  return runs.map((run, idx) => (
    <Text
      key={idx}
      color={on === 'lid' ? 'clawd_background' : run.color}
      backgroundColor={on === 'lid' ? run.color : on ? 'clawd_background' : undefined}
    >
      {run.glyphs}
    </Text>
  ));
}

function TurnClawd({ facing, color }: { facing: ClawdFacing; color: keyof Theme }): React.ReactNode {
  const rows = TURN_FRAMES[facing];
  return (
    <Box flexDirection="column" flexShrink={0}>
      {rows.map((row, idx) => (
        <Text key={idx} color={color}>
          {row.glyphs.slice(0, row.from)}
          <Text backgroundColor="clawd_background">{row.glyphs.slice(row.from, row.to)}</Text>
          {row.glyphs.slice(row.to)}
        </Text>
      ))}
    </Box>
  );
}

function AppleTerminalClawd({ eyes, color }: { eyes: ClawdEyes; color: keyof Theme }): React.ReactNode {
  // Apple's Terminal renders vertical space between chars by default.
  // It does NOT render vertical space between background colors
  // so we use background color to draw the main shape.
  //
  // Eye FG: keep ansi:black (SGR 30) so pupils stay visible on Apple Terminal
  // truecolor while body keeps Claude orange / effortUltra.
  if (color === 'clawd_body') {
    return (
      <Box flexDirection="column" alignItems="center" flexShrink={0}>
        <Text>
          <Text color="clawd_body">▗</Text>
          <Text color="ansi:black" backgroundColor="clawd_body">
            {APPLE_EYES[eyes]}
          </Text>
          <Text color="clawd_body">▖</Text>
        </Text>
        <Text backgroundColor="clawd_body">{' '.repeat(7)}</Text>
        <Text color="clawd_body">{'▘▘   ▝▝'}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" alignItems="center" flexShrink={0}>
      <Text>
        <Text color={color}>▗</Text>
        <Text color="ansi:black" backgroundColor={color}>
          {APPLE_EYES[eyes]}
        </Text>
        <Text color={color}>▖</Text>
      </Text>
      <Text backgroundColor={color}>{' '.repeat(7)}</Text>
      <Text color={color}>{'▘▘   ▝▝'}</Text>
    </Box>
  );
}
