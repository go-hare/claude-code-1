import { feature } from 'bun:bundle';
import chalk from 'chalk';
import { type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { coerce } from 'semver';
import {
  AccessibilityContext,
  Box,
  type ClickEvent,
  type Color,
  type DOMElement,
  Link,
  Text,
  type Theme,
  getTheme,
  stringWidth,
  useAnimationFrame,
  useTerminalFocus,
  useTerminalViewport,
  useTheme,
} from '@anthropic/ink';
import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js';
import { type BridgeStatusInfo, getBridgeStatus } from '../../bridge/bridgeStatusUtil.js';
import { getIsNonInteractiveSession } from '../../bootstrap/state.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useAppState } from '../../state/AppState.js';
import { type GlobalConfig, getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { getEffortSuffix, isUltracodeModeActive } from '../../utils/effort.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { truncate } from '../../utils/format.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import {
  formatModelAndBilling,
  getLogoDisplayData,
  hasUnseenReleaseVersion,
  truncatePath,
} from '../../utils/logoV2Utils.js';
import { parseUserSpecifiedModel, renderModelSetting } from '../../utils/model/model.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { getNativeSelectionHoldKey } from '../ScrollKeybindingHandler.js';
import type { RGBColor } from '../Spinner/types.js';
import { interpolateColor, parseRGB, toRGBColor } from '../Spinner/utils.js';
import { StatusIcon } from '@anthropic/ink';
import { AnimatedClawd, type ClawdAnimationSequenceName } from './AnimatedClawd.js';
import { CLAWD_WIDTH, Clawd, isNonAppleTerminal, type ClawdPartsPose } from './Clawd.js';

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

const APPLE_TERMINAL_ENTRANCE_NAMES: readonly ClawdAnimationSequenceName[] = ALL_ENTRANCE_NAMES.filter(
  name => name !== 'turn' && name !== 'coin-hop',
);

let clawdEntranceTaken = false;

function hasForceFirstLaunchEnv(): boolean {
  const raw = process.env.CLAUDE_CODE_FORCE_FIRST_LAUNCH;
  if (raw === undefined) return false;
  if (coerce(raw) !== null) return true;
  return isEnvTruthy(raw);
}

function takeClawdEntrance(): ClawdAnimationSequenceName | undefined {
  if (clawdEntranceTaken) return undefined;
  const lastSeen = (getGlobalConfig() as GlobalConfig & { lastClawdEntranceVersion?: string }).lastClawdEntranceVersion;
  if (!hasForceFirstLaunchEnv() && !hasUnseenReleaseVersion(lastSeen)) {
    return undefined;
  }
  clawdEntranceTaken = true;
  const pool = isNonAppleTerminal() ? ALL_ENTRANCE_NAMES : APPLE_TERMINAL_ENTRANCE_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function useClawdEntrance(enabled: boolean): ClawdAnimationSequenceName | undefined {
  const [entrance] = useState<ClawdAnimationSequenceName | undefined>(() =>
    enabled ? takeClawdEntrance() : undefined,
  );
  useEffect(() => {
    if (entrance === undefined) return;
    const lastSeen = (getGlobalConfig() as GlobalConfig & { lastClawdEntranceVersion?: string })
      .lastClawdEntranceVersion;
    if (!hasUnseenReleaseVersion(lastSeen)) return;
    saveGlobalConfig(current => {
      const prev = (current as GlobalConfig & { lastClawdEntranceVersion?: string }).lastClawdEntranceVersion;
      if (!hasUnseenReleaseVersion(prev)) return current;
      return {
        ...current,
        lastClawdEntranceVersion: MACRO.VERSION,
      } as GlobalConfig;
    });
  }, [entrance]);
  return entrance;
}

const WAND_FRAME_MS = 128;
const WAND_CYCLE_MS = 24 * WAND_FRAME_MS;
const WAND_WIDTH = 2;
const WAND_ORIGIN = { column: CLAWD_WIDTH + 1, row: 0 };
const WAVE_SPEED = 7;
const WAVE_FRONT_FALLOFF = 0.9;
const WAVE_TAIL_FALLOFF = 1.8;
const ECHO_WAVE = { behind: 3.5, share: 0.4 };
const QUANTIZE_STEPS = 8;
const PURE_WHITE: RGBColor = { r: 255, g: 255, b: 255 };
const WAND_HANDLE_GLYPH = '╱';
const WAND_FLAME_GLYPH = '✦';

const DARK_WAND_PALETTE = {
  crest: 0.8,
  wood: { r: 208, g: 162, b: 100 },
  woodLit: { r: 255, g: 240, b: 184 },
  ember: { r: 240, g: 128, b: 72 },
  gold: { r: 255, g: 204, b: 104 },
  bright: { r: 255, g: 236, b: 160 },
  flare: { r: 255, g: 252, b: 235 },
};

const LIGHT_WAND_PALETTE = {
  crest: 0.7,
  wood: { r: 150, g: 104, b: 48 },
  woodLit: { r: 196, g: 120, b: 24 },
  ember: { r: 232, g: 150, b: 40 },
  gold: { r: 240, g: 118, b: 24 },
  bright: { r: 238, g: 84, b: 16 },
  flare: { r: 224, g: 40, b: 8 },
};

const CYCLE_FRAMES = WAND_CYCLE_MS / WAND_FRAME_MS;
const FLARE_FRAMES = 2;
const DECAY_FRAMES = 3;
const BUILDUP_FRAMES = 4;

const ULTRACODE_POSE: ClawdPartsPose = {
  eyes: 'open',
  arms: 'one-up',
  feet: 'both',
};

const RC_PILL_MIN_COLUMNS = 60;

type WandColors = {
  wand: Color;
  flame: Color;
  isFlaring: boolean;
};

function staticWandColors(isLight: boolean): WandColors {
  const { wood, gold } = isLight ? LIGHT_WAND_PALETTE : DARK_WAND_PALETTE;
  return { wand: toRGBColor(wood), flame: toRGBColor(gold), isFlaring: false };
}

function waveEnvelope(delta: number): number {
  return Math.exp(delta >= 0 ? -delta / WAVE_TAIL_FALLOFF : delta / WAVE_FRONT_FALLOFF);
}

function createWandWavePainter(
  baseRgb: RGBColor,
  timeMs: number,
  isLight: boolean,
): (col: number, row: number) => Color {
  const crestRgb = interpolateColor(baseRgb, PURE_WHITE, (isLight ? LIGHT_WAND_PALETTE : DARK_WAND_PALETTE).crest);
  const radius = ((timeMs % WAND_CYCLE_MS) / 1000) * WAVE_SPEED;
  return (col: number, row: number): Color => {
    const dist = Math.hypot(col - WAND_ORIGIN.column, 2 * (row - WAND_ORIGIN.row));
    const intensity = Math.max(
      waveEnvelope(radius - dist),
      ECHO_WAVE.share * waveEnvelope(radius - ECHO_WAVE.behind - dist),
    );
    const quantized = Math.round(intensity * QUANTIZE_STEPS) / QUANTIZE_STEPS;
    return toRGBColor(interpolateColor(baseRgb, crestRgb, quantized));
  };
}

function animatedWandColors(timeMs: number, isLight: boolean): WandColors {
  const { wood, woodLit, ember, gold, bright, flare } = isLight ? LIGHT_WAND_PALETTE : DARK_WAND_PALETTE;
  const frameInCycle = Math.floor((timeMs % WAND_CYCLE_MS) / WAND_FRAME_MS);
  if (frameInCycle < FLARE_FRAMES) {
    return { wand: toRGBColor(woodLit), flame: toRGBColor(flare), isFlaring: true };
  }
  if (frameInCycle < FLARE_FRAMES + DECAY_FRAMES) {
    const t = (frameInCycle - FLARE_FRAMES + 1) / DECAY_FRAMES;
    return {
      wand: toRGBColor(interpolateColor(woodLit, wood, t)),
      flame: toRGBColor(interpolateColor(bright, gold, t)),
      isFlaring: false,
    };
  }
  if (frameInCycle >= CYCLE_FRAMES - BUILDUP_FRAMES) {
    const t = (frameInCycle - (CYCLE_FRAMES - BUILDUP_FRAMES) + 1) / BUILDUP_FRAMES;
    return {
      wand: toRGBColor(interpolateColor(wood, woodLit, t / 2)),
      flame: toRGBColor(interpolateColor(gold, bright, t)),
      isFlaring: false,
    };
  }
  const tick = Math.floor(timeMs / WAND_FRAME_MS);
  const flicker = Math.round((Math.abs(Math.sin(tick * 12.9898) * 43758.5453) % 1) * QUANTIZE_STEPS) / QUANTIZE_STEPS;
  return {
    wand: toRGBColor(wood),
    flame: toRGBColor(interpolateColor(ember, gold, flicker)),
    isFlaring: false,
  };
}

function UltracodeWand({ wand, usesTerminalColors }: { wand: WandColors; usesTerminalColors: boolean }): ReactNode {
  const wandColor: Color | keyof Theme = usesTerminalColors ? 'warning' : wand.wand;
  const flameColor: Color | keyof Theme = usesTerminalColors ? 'warning' : wand.flame;
  return (
    <Text>
      <Text color={wandColor} bold>
        {WAND_HANDLE_GLYPH}
      </Text>
      <Text color={flameColor} bold={wand.isFlaring}>
        {WAND_FLAME_GLYPH}
      </Text>
    </Text>
  );
}

function isLightTheme(themeName: string): boolean {
  return themeName === 'light' || themeName === 'light-daltonized' || themeName === 'light-ansi';
}

function HeaderClawd({
  fullscreen,
  entrance,
  ultra,
}: {
  fullscreen: boolean;
  entrance?: ClawdAnimationSequenceName;
  ultra: boolean;
}): ReactNode {
  const srContext = useContext(AccessibilityContext);
  const screenReader = srContext || isScreenReaderModeEnabled();
  const [reducedMotion] = useState(() => Boolean(getInitialSettings().prefersReducedMotion));
  const [themeName] = useTheme();
  const light = isLightTheme(themeName);
  const effortUltraRgb = parseRGB(getTheme(themeName).effortUltra);
  const terminalFocused = useTerminalFocus();
  const [viewportRef, { isVisible }] = useTerminalViewport();

  const canAnimateWand =
    ultra &&
    fullscreen &&
    terminalFocused &&
    !getIsNonInteractiveSession() &&
    !reducedMotion &&
    !screenReader &&
    effortUltraRgb !== null &&
    chalk.level >= 3 &&
    isNonAppleTerminal();

  const [animRef, timeMs] = useAnimationFrame(canAnimateWand ? WAND_FRAME_MS : null);
  const activeAnimation = canAnimateWand && isVisible;

  if (screenReader) {
    return null;
  }

  const bodyColor = ultra ? 'effortUltra' : undefined;
  const wandElement = (
    <UltracodeWand
      wand={activeAnimation ? animatedWandColors(timeMs, light) : staticWandColors(light)}
      usesTerminalColors={effortUltraRgb === null}
    />
  );
  const mergedRef = (el: DOMElement | null) => {
    animRef(el);
    viewportRef(el);
  };
  const width = ultra ? CLAWD_WIDTH + WAND_WIDTH : CLAWD_WIDTH;

  return (
    <Box ref={mergedRef} flexShrink={0} width={width}>
      {fullscreen ? (
        <AnimatedClawd
          sequence={entrance}
          delayMs={100}
          color={bodyColor}
          rest={
            ultra
              ? {
                  pose: ULTRACODE_POSE,
                  paint:
                    activeAnimation && effortUltraRgb !== null
                      ? createWandWavePainter(effortUltraRgb, timeMs, light)
                      : undefined,
                  held: wandElement,
                  heldWidth: WAND_WIDTH,
                }
              : undefined
          }
        />
      ) : (
        <>
          <Clawd pose={ultra ? ULTRACODE_POSE : 'default'} color={bodyColor} />
          {ultra ? wandElement : null}
        </>
      )}
    </Box>
  );
}

type RcPillStatus = BridgeStatusInfo;

export const RC_ACTIVE_BADGE_KEY = 'rc-active-badge';
export const RC_ACTIVE_VERBOSE_CAP = 5;

function shouldShowVerboseRcActive(): boolean {
  const seen = (getGlobalConfig() as GlobalConfig & { seenNotifications?: Record<string, number> }).seenNotifications;
  return (seen?.[RC_ACTIVE_BADGE_KEY] ?? 0) < RC_ACTIVE_VERBOSE_CAP;
}

export function formatRcPillLabel(label: string): string {
  return label === '/rc active' && !shouldShowVerboseRcActive() ? '/rc' : label;
}

function recordRcActiveImpression(): void {
  if (!shouldShowVerboseRcActive()) return;
  saveGlobalConfig(current => {
    const seen = (current as GlobalConfig & { seenNotifications?: Record<string, number> }).seenNotifications ?? {};
    return {
      ...current,
      seenNotifications: {
        ...seen,
        [RC_ACTIVE_BADGE_KEY]: (seen[RC_ACTIVE_BADGE_KEY] ?? 0) + 1,
      },
    } as GlobalConfig;
  });
}

function appendFromCliParam(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('from', 'cli');
    return parsed.toString();
  } catch {
    return url;
  }
}

function useRcHeaderStatus(enabled: boolean): RcPillStatus | null {
  const { columns } = useTerminalSize();
  const eligible = enabled && columns >= RC_PILL_MIN_COLUMNS;
  const raw = useAppState(s => {
    if (!feature('BRIDGE_MODE')) return null;
    if (!eligible || s.replBridgeOutboundOnly) return null;
    if (!s.replBridgeEnabled && s.replBridgeError === undefined) return null;
    return getBridgeStatus({
      error: s.replBridgeError,
      connected: s.replBridgeConnected,
      sessionActive: s.replBridgeSessionActive,
      reconnecting: s.replBridgeReconnecting,
    });
  });
  if (!feature('BRIDGE_MODE')) return null;
  return raw !== null && isBridgeEnabled() ? raw : null;
}

function compactRcPillLabel(status: RcPillStatus): string {
  return chalk.level === 0 && status.label !== '/rc active' ? status.label : '/rc';
}

function RemoteControlStatusPill({
  status,
  highlighted = false,
  compact = false,
}: {
  status: RcPillStatus;
  highlighted?: boolean;
  compact?: boolean;
}): ReactNode {
  const [hovered, setHovered] = useState(false);
  const sessionUrl = useAppState(s => s.replBridgeSessionUrl);
  const impressionRecordedRef = useRef(false);
  const label = compact ? compactRcPillLabel(status) : formatRcPillLabel(status.label);

  useEffect(() => {
    if (!compact && status.label === '/rc active' && !impressionRecordedRef.current) {
      impressionRecordedRef.current = true;
      recordRcActiveImpression();
    }
  }, [compact, status.label]);

  const handleClick = (event: ClickEvent) => {
    logEvent('tengu_rc_pill_clicked', {
      trigger: 'click' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      label: label as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    event.allowDefault();
  };

  const active = highlighted || hovered;

  return (
    <Box
      flexShrink={0}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Text color={active ? 'background' : status.color} inverse={active} wrap="truncate">
        {sessionUrl ? <Link url={appendFromCliParam(sessionUrl)}>{label}</Link> : label}
      </Text>
    </Box>
  );
}

function getTuiJustSwitchedMode(): 'fullscreen' | 'default' | undefined {
  switch (process.env.CLAUDE_CODE_TUI_JUST_SWITCHED) {
    case 'fullscreen':
      return isFullscreenEnvEnabled() ? 'fullscreen' : undefined;
    case 'default':
      return 'default';
    default:
      return undefined;
  }
}

function TuiJustSwitchedNotice(): ReactNode {
  switch (getTuiJustSwitchedMode()) {
    case 'fullscreen':
      return (
        <Box flexDirection="column">
          <Text>
            <StatusIcon status="success" withSpace />
            <Text color="success">Using flicker-free rendering</Text>
            <Text dimColor> · if you want to go back, use /tui default</Text>
          </Text>
          <Text dimColor>{'  '}· Click to move your cursor in the text input</Text>
          <Text dimColor>{'  '}· Click to expand collapsed tool results</Text>
          <Text dimColor>{'  '}· By default, text auto-copies when you select it (/config to change)</Text>
          <Text dimColor>
            {'  '}· Hold {getNativeSelectionHoldKey()} while selecting to use your terminal&apos;s native copy instead
          </Text>
        </Box>
      );
    case 'default':
      return <Text dimColor>Switched back to the classic renderer</Text>;
    default:
      return null;
  }
}

type Props = {
  oneShotsAllowed?: boolean;
};

export function CondensedLogo({ oneShotsAllowed = true }: Props = {}): ReactNode {
  const { columns } = useTerminalSize();
  const srContext = useContext(AccessibilityContext);
  const screenReader = srContext || isScreenReaderModeEnabled();
  const agent = useAppState(s => s.agent);
  const effortValue = useAppState(s => s.effortValue);
  const ultracode = useAppState(s => s.ultracode);
  const model = useMainLoopModel();
  const resolvedModel = parseUserSpecifiedModel(model);
  const modelDisplayName = renderModelSetting(model);
  const { version, cwd, billingType, agentName: agentNameFromSettings } = getLogoDisplayData();

  // Prefer AppState.agent (set from --agent CLI flag) over settings
  const agentName = agent ?? agentNameFromSettings;
  const justSwitched = getTuiJustSwitchedMode() !== undefined;
  const fullscreen = isFullscreenEnvEnabled();
  const entrance = useClawdEntrance(oneShotsAllowed && fullscreen);
  const ultraActive = isUltracodeModeActive(resolvedModel, effortValue, ultracode);
  const rcStatus = useRcHeaderStatus(fullscreen && oneShotsAllowed);

  // Calculate available width for text content
  // Account for: condensed clawd width (11 chars) + gap (2) + padding (2) = 15 chars
  const textWidth = Math.max(columns - 15, 20);

  // Truncate version to fit within available width, accounting for "Claude Code v" prefix
  const versionPrefix = 'Claude Code v';
  const truncatedVersion = screenReader ? version : truncate(version, Math.max(textWidth - versionPrefix.length, 6));

  const effortSuffix = getEffortSuffix(resolvedModel, effortValue, ultracode);
  const { shouldSplit, truncatedModel, truncatedBilling } = screenReader
    ? { shouldSplit: false, truncatedModel: modelDisplayName + effortSuffix, truncatedBilling: billingType }
    : formatModelAndBilling(modelDisplayName + effortSuffix, billingType, textWidth);

  const rcWidthReserve = rcStatus ? 3 + stringWidth(formatRcPillLabel(rcStatus.label)) : 0;
  const separator = ' · ';
  const atPrefix = '@';
  const cwdAvailableWidth =
    (agentName ? textWidth - atPrefix.length - stringWidth(agentName) - separator.length : textWidth) - rcWidthReserve;
  const truncatedCwd = screenReader ? cwd : truncatePath(cwd, Math.max(cwdAvailableWidth, 10));
  const atAgent = agentName ? `@${agentName}` : '';
  const cwdLine = [atAgent, truncatedCwd].filter(Boolean).join(separator);

  const body = (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2} alignItems="center">
        <HeaderClawd fullscreen={fullscreen} entrance={entrance} ultra={ultraActive} />

        {/* Info */}
        <Box flexDirection="column">
          <Text>
            <Text bold>Claude Code</Text> <Text dimColor>v{truncatedVersion}</Text>
          </Text>
          {shouldSplit ? (
            <>
              <Text dimColor>{truncatedModel}</Text>
              <Text dimColor>{truncatedBilling}</Text>
            </>
          ) : (
            <Text dimColor>
              {truncatedModel} · {truncatedBilling}
            </Text>
          )}
          {rcStatus ? (
            <Box flexDirection="row">
              <Text dimColor wrap="truncate-start">
                {cwdLine ? `${cwdLine} · ` : ''}
              </Text>
              <RemoteControlStatusPill status={rcStatus} />
            </Box>
          ) : cwdLine ? (
            <Text dimColor>{cwdLine}</Text>
          ) : null}
        </Box>
      </Box>
      {justSwitched && (
        <Box paddingLeft={2} flexDirection="column" marginTop={1}>
          <TuiJustSwitchedNotice />
        </Box>
      )}
    </Box>
  );

  return fullscreen ? body : <OffscreenFreeze>{body}</OffscreenFreeze>;
}
