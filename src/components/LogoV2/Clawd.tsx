import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { env } from '../../utils/env.js';

export type ClawdPose =
  | 'default'
  | 'arms-up' // both arms raised (used during jump)
  | 'look-left' // both pupils shifted left
  | 'look-right'; // both pupils shifted right

type Props = {
  pose?: ClawdPose;
};

// Standard-terminal pose fragments. Each row is split into segments so we can
// vary only the parts that change (eyes, arms) while keeping the body/bg spans
// stable. All poses end up 9 cols wide (densable tRp / KB).
//
// arms-up: the row-2 arm shapes (▝▜ / ▛▘) move to row 1 as their
// bottom-heavy mirrors (▗▟ / ▙▖) — same silhouette, one row higher.
//
// look-* use top-quadrant eye chars (▙/▟) so both eyes change from the
// default (▛/▜, bottom pupils) — otherwise only one eye would appear to move.
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
 */
export const CLAWD_WIDTH = 9;

// densable tRp — do NOT pad r1R; densable r1 is 8 cols, r2/r3 are 9.
// flexShrink:0 (not fixed width) is what densable uses to stop layout squash.
const POSES: Record<ClawdPose, Segments> = {
  default: { r1L: ' ▐', r1E: '▛███▜', r1R: '▌', r2L: '▝▜', r2R: '▛▘' },
  'look-left': { r1L: ' ▐', r1E: '▟███▟', r1R: '▌', r2L: '▝▜', r2R: '▛▘' },
  'look-right': { r1L: ' ▐', r1E: '▙███▙', r1R: '▌', r2L: '▝▜', r2R: '▛▘' },
  'arms-up': { r1L: '▗▟', r1E: '▛███▜', r1R: '▙▖', r2L: ' ▜', r2R: '▛ ' },
};

// Apple Terminal uses a bg-fill trick (see below), so only eye poses make
// sense. Arm poses fall back to default. densable rRp.
const APPLE_EYES: Record<ClawdPose, string> = {
  default: ' ▗   ▖ ',
  'look-left': ' ▘   ▘ ',
  'look-right': ' ▝   ▝ ',
  'arms-up': ' ▗   ▖ ',
};

export function Clawd({ pose = 'default' }: Props = {}): React.ReactNode {
  if (env.terminal === 'Apple_Terminal') {
    return <AppleTerminalClawd pose={pose} />;
  }
  const p = POSES[pose];
  // densable KB: flexShrink:0 only — no fixed width (width was clipping the
  // Apple/standard glyph rows into a solid orange blob on fleet header).
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text>
        <Text color="clawd_body">{p.r1L}</Text>
        <Text color="clawd_body" backgroundColor="clawd_background">
          {p.r1E}
        </Text>
        <Text color="clawd_body">{p.r1R}</Text>
      </Text>
      <Text>
        <Text color="clawd_body">{p.r2L}</Text>
        <Text color="clawd_body" backgroundColor="clawd_background">
          █████
        </Text>
        <Text color="clawd_body">{p.r2R}</Text>
      </Text>
      <Text color="clawd_body">
        {'  '}▘▘ ▝▝{'  '}
      </Text>
    </Box>
  );
}

function AppleTerminalClawd({ pose }: { pose: ClawdPose }): React.ReactNode {
  // Apple's Terminal renders vertical space between chars by default.
  // It does NOT render vertical space between background colors
  // so we use background color to draw the main shape.
  // densable _ta: column + alignItems center only (no fixed width / flexShrink).
  //
  // Eye FG: densable uses clawd_background (truecolor black). On Apple
  // Terminal with COLORTERM=truecolor, pure rgb(0,0,0) on orange bg often
  // paints as "no ink" → solid orange bar with no pupils. Use basic
  // ansi:black (SGR 30) so pupils stay visible while body keeps true
  // Claude orange rgb(215,119,87) — do NOT clamp global chalk to level 2
  // (that cubes orange → washed salmon 174). densable Ypg level-2 Chalk is
  // chart-only; Clawd keeps the global truecolor path for body color.
  return (
    <Box flexDirection="column" alignItems="center">
      <Text>
        <Text color="clawd_body">▗</Text>
        <Text color="ansi:black" backgroundColor="clawd_body">
          {APPLE_EYES[pose]}
        </Text>
        <Text color="clawd_body">▖</Text>
      </Text>
      <Text backgroundColor="clawd_body">{' '.repeat(7)}</Text>
      <Text color="clawd_body">▘▘ ▝▝</Text>
    </Box>
  );
}
