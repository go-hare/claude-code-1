import figures from 'figures';
import React, { useEffect, useRef, useState } from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text, stringWidth } from '@anthropic/ink';
import { useAppState, useSetAppState } from '../state/AppState.js';
import type { AppState } from '../state/AppStateStore.js';
import { getGlobalConfig } from '../utils/config.js';
import type { Theme } from '../utils/theme.js';
import { getCompanion } from './companion.js';
import { renderFace, renderSprite, spriteFrameCount } from './sprites.js';
import { RARITY_COLORS } from './types.js';
import { isBuddyEnabled } from './enabled.js';
import { installCompanionObserver } from './companionReact.js';

installCompanionObserver();

const TICK_MS = 1000;
const BUBBLE_SHOW = 10; // ticks → ~10s at 1000ms
const FADE_WINDOW = 3; // last ~3s the bubble dims so you know it's about to go
const PET_BURST_MS = 2500; // how long hearts float after /buddy pet

// Idle sequence: mostly rest (frame 0), occasional fidget (frames 1-2), rare blink.
// Sequence indices map to sprite frames; -1 means "blink on frame 0".
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0];

// Hearts float up-and-out over 5 ticks (~2.5s). Prepended above the sprite.
const H = figures.heart;
const PET_HEARTS = [
  `   ${H}    ${H}   `,
  `  ${H}  ${H}   ${H}  `,
  ` ${H}   ${H}  ${H}   `,
  `${H}  ${H}      ${H} `,
  '·    ·   ·  ',
];

function wrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur.length + w.length + 1 > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function SpeechBubble({ text, color, fading }: { text: string; color: keyof Theme; fading: boolean }): React.ReactNode {
  const lines = wrap(text, 30);
  const borderColor = fading ? 'inactive' : color;
  return (
    <Box flexDirection="row" alignItems="center">
      <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} width={34}>
        {lines.map((l, i) => (
          <Text key={i} italic dimColor={!fading} color={fading ? 'inactive' : undefined}>
            {l}
          </Text>
        ))}
      </Box>
      <Text color={borderColor}>─</Text>
    </Box>
  );
}

export const MIN_COLS_FOR_FULL_SPRITE = 100;
const SPRITE_BODY_WIDTH = 12;
const NAME_ROW_PAD = 2; // focused state wraps name in spaces: ` name `
const SPRITE_PADDING_X = 2;
const BUBBLE_WIDTH = 36; // SpeechBubble box (34) + tail column
const NARROW_QUIP_CAP = 24;

function spriteColWidth(nameWidth: number): number {
  return Math.max(SPRITE_BODY_WIDTH, nameWidth + NAME_ROW_PAD);
}

// Width the sprite area consumes. PromptInput subtracts this so text wraps
// correctly. The speech bubble sits inline beside the sprite in both modes,
// so a speaking companion also reserves BUBBLE_WIDTH.
// Narrow terminals: 0 — REPL.tsx stacks the one-liner on its own row
// (above input in fullscreen, below in scrollback), so no reservation.
export function companionReservedColumns(terminalColumns: number, speaking: boolean): number {
  if (!isBuddyEnabled()) return 0;
  const companion = getCompanion();
  if (!companion || getGlobalConfig().companionMuted) return 0;
  if (terminalColumns < MIN_COLS_FOR_FULL_SPRITE) return 0;
  const nameWidth = stringWidth(companion.name);
  const bubble = speaking ? BUBBLE_WIDTH : 0;
  return spriteColWidth(nameWidth) + SPRITE_PADDING_X + bubble;
}

export function CompanionSprite(): React.ReactNode {
  const reaction = useAppState(s => s.companionReaction);
  const petAt = useAppState(s => s.companionPetAt);
  const focused = useAppState(s => s.footerSelection === 'companion');
  const setAppState = useSetAppState();
  const { columns } = useTerminalSize();
  const [tick, setTick] = useState(0);
  const lastSpokeTick = useRef(0);
  // Sync-during-render (not useEffect) so the first post-pet render already
  // has petStartTick=tick and petAge=0 — otherwise frame 0 is skipped.
  const [{ petStartTick, forPetAt }, setPetStart] = useState({
    petStartTick: 0,
    forPetAt: petAt,
  });
  if (petAt !== forPetAt) {
    setPetStart({ petStartTick: tick, forPetAt: petAt });
  }

  useEffect(() => {
    const timer = setInterval(setT => setT((t: number) => t + 1), TICK_MS, setTick);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!reaction) return;
    lastSpokeTick.current = tick;
    const timer = setTimeout(
      setA =>
        setA((prev: AppState) =>
          prev.companionReaction === undefined ? prev : { ...prev, companionReaction: undefined },
        ),
      BUBBLE_SHOW * TICK_MS,
      setAppState,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick intentionally captured at reaction-change, not tracked
  }, [reaction, setAppState]);

  if (!isBuddyEnabled()) return null;
  const companion = getCompanion();
  if (!companion || getGlobalConfig().companionMuted) return null;

  const color = RARITY_COLORS[companion.rarity];
  const colWidth = spriteColWidth(stringWidth(companion.name));

  const bubbleAge = reaction ? tick - lastSpokeTick.current : 0;
  const fading = reaction !== undefined && bubbleAge >= BUBBLE_SHOW - FADE_WINDOW;

  const petAge = petAt ? tick - petStartTick : Infinity;
  const petting = petAge * TICK_MS < PET_BURST_MS;

  // Narrow terminals: collapse to one-line face. When speaking, the quip
  // replaces the name beside the face (no room for a bubble).
  if (columns < MIN_COLS_FOR_FULL_SPRITE) {
    const quip =
      reaction && reaction.length > NARROW_QUIP_CAP ? reaction.slice(0, NARROW_QUIP_CAP - 1) + '…' : reaction;
    const label = quip ? `"${quip}"` : focused ? ` ${companion.name} ` : companion.name;
    return (
      <Box paddingX={1} alignSelf="flex-end">
        <Text>
          {petting && <Text color="autoAccept">{figures.heart} </Text>}
          <Text bold color={color}>
            {renderFace(companion)}
          </Text>{' '}
          <Text
            italic
            dimColor={!focused && !reaction}
            bold={focused}
            inverse={focused && !reaction}
            color={reaction ? (fading ? 'inactive' : color) : focused ? color : undefined}
          >
            {label}
          </Text>
        </Text>
      </Box>
    );
  }
  const frameCount = spriteFrameCount(companion.species);
  const heartFrame = petting ? PET_HEARTS[petAge % PET_HEARTS.length] : null;

  let spriteFrame: number;
  let blink = false;
  if (reaction || petting) {
    // Excited: cycle all fidget frames fast
    spriteFrame = tick % frameCount;
  } else {
    const step = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length]!;
    if (step === -1) {
      spriteFrame = 0;
      blink = true;
    } else {
      spriteFrame = step % frameCount;
    }
  }

  const body = renderSprite(companion, spriteFrame).map(line => (blink ? line.replaceAll(companion.eye, '-') : line));
  // Overlay hearts on the hat slot (line 0 is blank in idle frames). Do not
  // prepend — an extra row grows the flex-end companion/prompt sibling and
  // jumps PromptInput's round top border.
  const sprite = heartFrame ? [heartFrame, ...body.slice(1)] : body;

  // Name row doubles as hint row — unfocused shows dim name + ↓ discovery,
  // focused shows inverse name. The enter-to-open hint lives in
  // PromptInputFooter's right column so this row stays one line and the
  // sprite doesn't jump up when selected. flexShrink=0 stops the
  // inline-bubble row wrapper from squeezing the sprite to fit.
  const spriteColumn = (
    <Box flexDirection="column" flexShrink={0} alignItems="center" width={colWidth}>
      {sprite.map((line, i) => (
        <Text key={i} color={i === 0 && heartFrame ? 'autoAccept' : color}>
          {line}
        </Text>
      ))}
      <Text italic bold={focused} dimColor={!focused} color={focused ? color : undefined} inverse={focused}>
        {focused ? ` ${companion.name} ` : companion.name}
      </Text>
    </Box>
  );

  if (!reaction) {
    // flexShrink=0 matches the speaking-path wrapper. DualInk KEEP companion
    // is a tot.bottom sibling gold Iz does not have; shrinking here lets the
    // PromptInput leftover pin fight yoga and flash the round ─ borders.
    return (
      <Box paddingX={1} flexShrink={0}>
        {spriteColumn}
      </Box>
    );
  }

  // Bubble sits inline beside the sprite in both modes. PromptInput gives up
  // BUBBLE_WIDTH while speaking, so it does not float over the scroll column.
  return (
    <Box flexDirection="row" alignItems="flex-end" paddingX={1} flexShrink={0}>
      <SpeechBubble text={reaction} color={color} fading={fading} />
      {spriteColumn}
    </Box>
  );
}
