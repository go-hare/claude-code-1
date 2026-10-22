import figures from 'figures';
import * as React from 'react';
import { useMemo, useRef } from 'react';
import { Box, Text, useAnimationFrame, stringWidth, Byline, useTheme } from '@anthropic/ink';
import { toInkColor } from '../../utils/ink.js';
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import { remainingRetryMs, type RetryStatus } from '../../utils/advisorNetworkStall.js';
import { formatDuration, formatNumber } from '../../utils/format.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';

import { getTheme, type Theme } from '../../utils/theme.js';

import { GlimmerMessage } from './GlimmerMessage.js';
import { SpinnerGlyph } from './SpinnerGlyph.js';
import {
  advanceSpinnerToolWindow,
  emptySpinnerToolWindow,
  formatSpinnerStatusText,
  resolveSpinnerStatusKind,
  STALL_TELEMETRY_THRESHOLDS_MS,
  type OutputLimitRecovery,
} from './statusKind.js';
import { thinkingFadeIntensity } from './thinkingFade.js';
import type { SpinnerMode } from './types.js';
import { useStalledAnimation } from './useStalledAnimation.js';
import { interpolateColor, parseRGB, toRGBColor } from './utils.js';

const SEP_WIDTH = stringWidth(' · ');
const THINKING_BARE_WIDTH = stringWidth('thinking');
const SHOW_TOKENS_AFTER_MS = 30_000;

// Thinking shimmer constants. Previously lived in a separate ThinkingShimmerText
// component with its own useAnimationFrame(50) — inlined here to reuse our
// existing 50ms clock and eliminate the redundant subscriber.
const THINKING_INACTIVE = { r: 153, g: 153, b: 153 };
const THINKING_INACTIVE_SHIMMER = { r: 185, g: 185, b: 185 };
const THINKING_DELAY_MS = 3000;
const THINKING_GLOW_PERIOD_S = 2;

export type SpinnerAnimationRowProps = {
  // Animation inputs
  mode: SpinnerMode;
  reducedMotion: boolean;
  hasActiveTools: boolean;
  responseLengthRef: React.RefObject<number>;

  // Message (stable within a turn)
  message: string;
  messageColor: keyof Theme;
  shimmerColor: keyof Theme;
  overrideColor?: keyof Theme | null;

  // Timer refs (stable references)
  loadingStartTimeRef: React.RefObject<number>;
  totalPausedMsRef: React.RefObject<number>;
  pauseStartTimeRef: React.RefObject<number | null>;

  // Display flags
  spinnerSuffix?: string | null;
  verbose: boolean;
  columns: number;
  /** True while a compaction summary is streaming. */
  compactProgressActiveRef?: React.RefObject<boolean>;
  /** densable compactingStartTime. Elapsed during compact is max(0, now - start). */
  compactingStartTime?: number | null;

  // Teammate-derived (computed by parent from tasks)
  hasRunningTeammates: boolean;
  teammateTokens: number;
  foregroundedTeammate: InProcessTeammateTaskState | undefined;
  /** Leader's turn has completed. Suppresses stall-red since responseLengthRef/hasActiveTools track leader state only. */
  leaderIsIdle?: boolean;

  // Thinking (state owned by parent, mode-dependent)
  thinkingStatus: 'thinking' | number | null;
  effortSuffix: string;
  /**
   * densable 2.1.214 #39 / Msn — when set, replaces the verb row with
   * stalled or error retry countdown.
   */
  retryStatus?: RetryStatus | null;
  /** densable tengu_shining_fractals — tool-running / ran-tool timer. */
  showToolCallTimer?: boolean;
  /** densable outputLimitRecovery — "picking the thought back up". */
  outputLimitRecovery?: OutputLimitRecovery | null;
  /** densable Ye/Je agentId — stall reset when the viewed agent changes. */
  agentId?: string;
};

/**
 * The 50ms-animated portion of SpinnerWithVerb. Owns useAnimationFrame(50)
 * and all values derived from the animation clock (frame, glimmer, token
 * counter animation, elapsed-time, stalled intensity, thinking shimmer).
 *
 * The parent SpinnerWithVerb is freed from the 50ms render loop and only
 * re-renders when its props/app state change (~25x/turn instead of ~383x).
 * That keeps the outer Box shells, useAppState selectors, task filtering,
 * and tip/tree subtrees out of the hot animation path.
 */
export function SpinnerAnimationRow({
  mode,
  reducedMotion,
  hasActiveTools,
  responseLengthRef,
  message,
  messageColor,
  shimmerColor,
  overrideColor,
  loadingStartTimeRef,
  totalPausedMsRef,
  pauseStartTimeRef,
  spinnerSuffix,
  verbose,
  columns,
  compactProgressActiveRef,
  compactingStartTime = null,
  hasRunningTeammates,
  teammateTokens,
  foregroundedTeammate,
  leaderIsIdle = false,
  thinkingStatus,
  effortSuffix,
  retryStatus = null,
  showToolCallTimer = false,
  outputLimitRecovery = null,
  agentId,
}: SpinnerAnimationRowProps): React.ReactNode {
  const [themeName] = useTheme();
  const theme = getTheme(themeName);

  // densable Msn always animates countdown; keep the 50ms clock when status is set.
  const [viewportRef, time] = useAnimationFrame(reducedMotion && !retryStatus ? null : 50);

  // densable #18: monotonic elapsed (performance.now) matching loadingStartTimeRef
  const now = performance.now();
  const loadingElapsedMs =
    pauseStartTimeRef.current !== null
      ? pauseStartTimeRef.current - loadingStartTimeRef.current - totalPausedMsRef.current
      : now - loadingStartTimeRef.current - totalPausedMsRef.current;
  const isCompactingForElapsed = compactProgressActiveRef?.current === true;
  // densable Je: O && u !== null ? max(0, N - u) : loading elapsed.
  const elapsedTimeMs =
    isCompactingForElapsed && compactingStartTime != null ? Math.max(0, now - compactingStartTime) : loadingElapsedMs;

  // Track wall-clock turn start for teammates. While a swarm is running the
  // leader's elapsedTimeMs may jump around (new API calls reset
  // loadingStartTimeRef; pauses freeze it), so we anchor to the earliest
  // derived start seen so far. When no teammates are running this just tracks
  // derivedStart every frame, effectively resetting for the next swarm.
  const derivedStart = now - elapsedTimeMs;
  const turnStartRef = useRef(derivedStart);
  if (!hasRunningTeammates || derivedStart < turnStartRef.current) {
    turnStartRef.current = derivedStart;
  }

  // === Animation derivations from `time` ===
  const currentResponseLength = responseLengthRef.current;

  // densable Je It: tools || thinking || (compact && mode!==responding) || paused.
  // KEEP leaderIsIdle — responseLengthRef/hasActiveTools track leader only.
  const isCompacting = compactProgressActiveRef?.current === true;
  const stallHold =
    hasActiveTools ||
    leaderIsIdle ||
    mode === 'thinking' ||
    (isCompacting && mode !== 'responding') ||
    pauseStartTimeRef.current !== null;
  const { isStalled, stalledIntensity, timeSinceLastToken } = useStalledAnimation(
    time,
    currentResponseLength,
    stallHold,
    reducedMotion,
    agentId,
  );

  // densable Je stall telemetry Un=[1e4,45000,300000].
  const stallFiredRef = useRef(new Set<number>());
  const maxStallMsRef = useRef(0);
  const stallAgentRef = useRef(agentId);
  if (stallAgentRef.current !== agentId) {
    stallAgentRef.current = agentId;
    stallFiredRef.current = new Set();
    maxStallMsRef.current = 0;
  }
  if (timeSinceLastToken === 0) {
    if (stallFiredRef.current.size > 0) {
      logEvent('tengu_spinner_stall_cleared', {
        max_stall_ms: Math.round(maxStallMsRef.current),
        mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        override_color: overrideColor != null,
        response_length: currentResponseLength,
        thresholds_fired: stallFiredRef.current.size,
      });
      stallFiredRef.current = new Set();
      maxStallMsRef.current = 0;
    }
  } else {
    if (timeSinceLastToken > maxStallMsRef.current) {
      maxStallMsRef.current = timeSinceLastToken;
    }
    for (const threshold of STALL_TELEMETRY_THRESHOLDS_MS) {
      if (timeSinceLastToken >= threshold && !stallFiredRef.current.has(threshold)) {
        stallFiredRef.current.add(threshold);
        logEvent('tengu_spinner_stalled_ui', {
          threshold_ms: threshold,
          mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          override_color: overrideColor != null,
          time_since_last_token_ms: Math.round(timeSinceLastToken),
          response_length: currentResponseLength,
          render_loop_dark: timeSinceLastToken - threshold > 5000,
        });
      }
    }
  }

  // densable Fe/qe/ze: wall-clock tool window + thinking burst.
  const nowWall = Date.now();
  const toolWindowRef = useRef(emptySpinnerToolWindow());
  toolWindowRef.current = advanceSpinnerToolWindow(toolWindowRef.current, {
    now: nowWall,
    isThinking: mode === 'thinking',
    hasActiveTools,
    thinkingStatus,
  });
  const statusKind = resolveSpinnerStatusKind(toolWindowRef.current, {
    now: nowWall,
    hasActiveTools,
    thinkingStatus,
    showToolCallTimer,
    outputLimitRecovery,
  });
  const thinkingTarget = thinkingFadeIntensity(
    nowWall,
    toolWindowRef.current.thinkingBurstStart,
    mode === 'thinking',
    hasActiveTools,
  );
  const thinkingIntensityRef = useRef(0);
  const thinkingSmoothTimeRef = useRef(time);
  if (mode !== 'thinking' || hasActiveTools) {
    thinkingIntensityRef.current = 0;
    thinkingSmoothTimeRef.current = time;
  } else if (!reducedMotion && (thinkingTarget > 0 || thinkingIntensityRef.current > 0)) {
    const dt = time - thinkingSmoothTimeRef.current;
    if (dt >= 50) {
      const steps = Math.floor(dt / 50);
      let current = thinkingIntensityRef.current;
      for (let i = 0; i < steps; i++) {
        const diff = thinkingTarget - current;
        if (Math.abs(diff) < 0.01) {
          current = thinkingTarget;
          break;
        }
        current += diff * 0.1;
      }
      thinkingIntensityRef.current = current;
      thinkingSmoothTimeRef.current = time;
    }
  } else {
    thinkingIntensityRef.current = thinkingTarget;
    thinkingSmoothTimeRef.current = time;
  }
  const thinkingIntensity = reducedMotion ? thinkingTarget : thinkingIntensityRef.current;

  // densable Je `frame:mt` is Xn cosine. Analog Ink + Xn dwells at ping-pong
  // peaks → 闪 (Image 27/37). KEEP KCe indexed by time/120 (gold Launching `ne`).
  const frame = reducedMotion ? 0 : Math.floor(time / 120);

  const glimmerSpeed = mode === 'requesting' ? 50 : 200;
  // message is stable within a turn; stringWidth is expensive enough (Bun native
  // call per code point) to memoize explicitly across the 50ms loop.
  const glimmerMessageWidth = useMemo(() => stringWidth(message), [message]);
  const cycleLength = glimmerMessageWidth + 20;
  const cyclePosition = Math.floor(time / glimmerSpeed);
  const glimmerIndex = reducedMotion
    ? -100
    : isStalled
      ? -100
      : mode === 'requesting'
        ? (cyclePosition % cycleLength) - 10
        : glimmerMessageWidth + 10 - (cyclePosition % cycleLength);

  const flashOpacity = reducedMotion ? 0 : mode === 'tool-use' ? (Math.sin((time / 1000) * Math.PI) + 1) / 2 : 0;

  // === Token counter animation (smooth increment, driven by 50ms clock) ===
  const tokenCounterRef = useRef(currentResponseLength);
  if (reducedMotion) {
    tokenCounterRef.current = currentResponseLength;
  } else {
    const gap = currentResponseLength - tokenCounterRef.current;
    if (gap > 0) {
      let increment;
      if (gap < 70) {
        increment = 3;
      } else if (gap < 200) {
        increment = Math.max(8, Math.ceil(gap * 0.15));
      } else {
        increment = 50;
      }
      tokenCounterRef.current = Math.min(tokenCounterRef.current + increment, currentResponseLength);
    }
  }
  const displayedResponseLength = tokenCounterRef.current;
  const leaderTokens = Math.round(displayedResponseLength / 4);

  const effectiveElapsedMs = hasRunningTeammates ? Math.max(elapsedTimeMs, now - turnStartRef.current) : elapsedTimeMs;
  const timerText = formatDuration(effectiveElapsedMs);
  const timerWidth = stringWidth(timerText);

  // === Token count (leader + teammates, or foregrounded teammate) ===
  const totalTokens =
    foregroundedTeammate && !foregroundedTeammate.isIdle
      ? (foregroundedTeammate.progress?.tokenCount ?? 0)
      : leaderTokens + teammateTokens;
  const tokenCount = formatNumber(totalTokens);
  const tokensText = hasRunningTeammates ? `${tokenCount} tokens` : `${figures.arrowDown} ${tokenCount} tokens`;
  const tokensWidth = stringWidth(tokensText);

  // densable qe + no() + Je lt: tool-running / recovering / thinking / thought-for.
  const { text: formattedStatus, progressiveThinkingBase } = formatSpinnerStatusText(statusKind, effortSuffix);
  let thinkingText = formattedStatus;
  let thinkingWidthValue = thinkingText ? stringWidth(thinkingText) : 0;

  // === Progressive width gating ===
  const messageWidth = glimmerMessageWidth + 2;
  const sep = SEP_WIDTH;

  const wantsThinking = thinkingText !== null;
  const wantsTimerAndTokens = verbose || hasRunningTeammates || effectiveElapsedMs > SHOW_TOKENS_AFTER_MS;

  const availableSpace = columns - messageWidth - 5;

  let showThinking = wantsThinking && availableSpace > thinkingWidthValue;
  if (
    !showThinking &&
    wantsThinking &&
    statusKind.kind === 'thinking' &&
    (effortSuffix || progressiveThinkingBase !== 'thinking')
  ) {
    if (availableSpace > THINKING_BARE_WIDTH) {
      thinkingText = 'thinking';
      thinkingWidthValue = THINKING_BARE_WIDTH;
      showThinking = true;
    }
  }
  const usedAfterThinking = showThinking ? thinkingWidthValue + sep : 0;

  const showTimer = wantsTimerAndTokens && availableSpace > usedAfterThinking + timerWidth;
  const usedAfterTimer = usedAfterThinking + (showTimer ? timerWidth + sep : 0);

  const showTokens = wantsTimerAndTokens && totalTokens > 0 && availableSpace > usedAfterTimer + tokensWidth;

  const thinkingOnly =
    showThinking && statusKind.kind === 'thinking' && !spinnerSuffix && !showTimer && !showTokens && true;

  // === Thinking shimmer color (formerly ThinkingShimmerText's own timer) ===
  // Same sine-wave opacity, but derived from our shared `time` instead of a
  // second useAnimationFrame(50) subscription.
  const thinkingElapsedSec = (time - THINKING_DELAY_MS) / 1000;
  const thinkingOpacity =
    time < THINKING_DELAY_MS ? 0 : (Math.sin((thinkingElapsedSec * Math.PI * 2) / THINKING_GLOW_PERIOD_S) + 1) / 2;
  const thinkingShimmerBase = interpolateColor(THINKING_INACTIVE, THINKING_INACTIVE_SHIMMER, thinkingOpacity);
  const warningRGB = theme.warning ? parseRGB(theme.warning) : null;
  // densable mo: lerp the gray shimmer toward warning as thinkingIntensity rises.
  const thinkingShimmerColor = toRGBColor(
    warningRGB && thinkingIntensity > 0
      ? interpolateColor(thinkingShimmerBase, warningRGB, thinkingIntensity)
      : thinkingShimmerBase,
  );
  const thinkingLabelColor = !warningRGB && thinkingIntensity > 0.5 ? 'warning' : undefined;
  const thoughtForColor = thinkingIntensity > 0 ? 'warning' : undefined;

  // === Build status parts ===
  const parts = [
    ...(spinnerSuffix
      ? [
          <Text dimColor key="suffix">
            {spinnerSuffix}
          </Text>,
        ]
      : []),
    ...(showTimer
      ? [
          <Text dimColor key="elapsedTime">
            {timerText}
          </Text>,
        ]
      : []),
    ...(showTokens
      ? [
          <Box flexDirection="row" key="tokens">
            {!hasRunningTeammates && <SpinnerModeGlyph mode={mode} />}
            <Text dimColor>{tokenCount} tokens</Text>
          </Box>,
        ]
      : []),
    ...(showThinking && thinkingText
      ? [
          statusKind.kind === 'thinking' && !reducedMotion ? (
            <Text key="thinking" color={thinkingLabelColor ?? thinkingShimmerColor}>
              {thinkingOnly ? `(${thinkingText})` : thinkingText}
            </Text>
          ) : (
            <Text dimColor={!thoughtForColor} color={thoughtForColor} key="thinking">
              {thinkingText}
            </Text>
          ),
        ]
      : []),
  ];

  // Gold Je ht is nullable. Official Ink does not flash on null↔JSX.
  // Analog markDirty walks ancestors — nullable status insert/remove
  // (Image 37 thinking-with-xhigh) repaints the whole spinner row.
  // KEEP: always mount a 3-child slot (Text, Box, Text) so the row never
  // appendChildNode/removeChildNode the status sibling.
  const teammateActive = Boolean(foregroundedTeammate && !foregroundedTeammate.isIdle);
  const showStatusParens = !teammateActive && parts.length > 0 && !thinkingOnly;
  const statusSlot = (
    <Box flexDirection="row" flexWrap="wrap">
      <Text dimColor>{teammateActive ? '(esc to interrupt ' : showStatusParens ? '(' : ''}</Text>
      <Box flexDirection="row">
        {teammateActive && foregroundedTeammate ? (
          <Text color={toInkColor(foregroundedTeammate.identity.color)}>{foregroundedTeammate.identity.agentName}</Text>
        ) : (
          <Byline>{parts.length > 0 ? parts : <Text dimColor>{''}</Text>}</Byline>
        )}
      </Box>
      <Text dimColor>{teammateActive || showStatusParens ? ')' : ''}</Text>
    </Box>
  );

  // densable Msn(status) — replaces verb/glimmer row when retryStatus is set.
  // void time keeps the 50ms clock subscribed so the countdown ticks live.
  if (retryStatus) {
    void time;
    const remainMs = remainingRetryMs(retryStatus.deadline);
    const mostSignificantOnly = remainMs >= 300_000;
    const countdown = formatDuration(remainMs, { mostSignificantOnly });
    const errorMark = (
      <Box aria-hidden flexWrap="wrap" height={1} width={2}>
        <Text color="error">{figures.cross}</Text>
      </Box>
    );
    if (retryStatus.kind === 'stalled') {
      return (
        <Box ref={viewportRef} flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
          {errorMark}
          <Box flexShrink={1}>
            <Text color="error">Waiting for API response</Text>
            <Text dimColor>
              {' · will retry in '}
              {countdown}
              {' · check your network'}
            </Text>
          </Box>
        </Box>
      );
    }
    // densable error path: " · Retrying in {n} · attempt a/b"
    const rateLimits = (retryStatus.error as { rateLimits?: { resetsAt?: number } } | undefined)?.rateLimits;
    const resetsSuffix =
      rateLimits?.resetsAt != null
        ? ` (${formatDuration(Math.max(0, rateLimits.resetsAt * 1000 - Date.now()), { mostSignificantOnly: true })})`
        : '';
    return (
      <Box ref={viewportRef} flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
        {errorMark}
        <Box flexShrink={1}>
          <Text dimColor>
            {` · Retrying in ${countdown}${resetsSuffix} · attempt ${retryStatus.attempt}/${retryStatus.maxRetries}`}
          </Text>
        </Box>
      </Box>
    );
  }

  const spinnerRow = (
    <Box ref={viewportRef} flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
      <SpinnerGlyph
        frame={frame}
        messageColor={messageColor}
        stalledIntensity={overrideColor ? 0 : stalledIntensity}
        thinkingIntensity={overrideColor ? 0 : thinkingIntensity}
        reducedMotion={reducedMotion}
        time={time}
      />
      <GlimmerMessage
        message={message}
        mode={mode}
        messageColor={messageColor}
        glimmerIndex={glimmerIndex}
        flashOpacity={flashOpacity}
        shimmerColor={shimmerColor}
        stalledIntensity={overrideColor ? 0 : stalledIntensity}
        thinkingIntensity={overrideColor ? 0 : thinkingIntensity}
      />
      {statusSlot}
    </Box>
  );

  return spinnerRow;
}

function SpinnerModeGlyph({ mode }: { mode: SpinnerMode }): React.ReactNode {
  switch (mode) {
    case 'tool-input':
    case 'tool-use':
    case 'responding':
    case 'thinking':
      return (
        <Box width={2}>
          <Text dimColor>{figures.arrowDown}</Text>
        </Box>
      );
    case 'requesting':
      return (
        <Box width={2}>
          <Text dimColor>{figures.arrowUp}</Text>
        </Box>
      );
  }
}
