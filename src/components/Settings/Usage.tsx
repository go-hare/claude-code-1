import * as React from 'react';
import { useEffect, useState } from 'react';
import { usageCredits as usageCreditsCommand } from 'src/commands/extra-usage/index.js';
import { getSubscriptionType } from 'src/utils/auth.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '@anthropic/ink';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import {
  type ExtraUsage,
  fetchUtilization,
  formatUsageCreditsAmount,
  type RateLimit,
  resolveExtraUsageUtilization,
  seedUtilizationFromOpenHeaders,
  type Utilization,
} from '../../services/api/usage.js';
import { getRawUtilization } from '../../services/claudeAiLimits.js';
import { spendLimitBarProps } from './spendLimitBar.js';
import { useAppState } from '../../state/AppState.js';
import type { Message } from '../../types/message.js';
import { formatResetText, formatRelativeTimeAgo, formatTokens } from '../../utils/format.js';
import {
  collectLoopUsageRows,
  formatLoopEvery,
  LOOP_USAGE_COL,
  LOOP_USAGE_VISIBLE_ROWS,
  LOOP_USAGE_WIDE_MIN,
} from '../../utils/loopUsage.js';
import { logError } from '../../utils/log.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline, ProgressBar } from '@anthropic/ink';
import { isEligibleForOverageCreditGrant, OverageCreditUpsell } from '../LogoV2/OverageCreditUpsell.js';

type LimitBarProps = {
  title: string;
  limit: RateLimit;
  maxWidth: number;
  showTimeInReset?: boolean;
  /** densable iXl alwaysShowDateInReset — force date in reset subtext. */
  alwaysShowDateInReset?: boolean;
  extraSubtext?: string;
};

function LimitBar({
  title,
  limit,
  maxWidth,
  showTimeInReset = true,
  alwaysShowDateInReset = false,
  extraSubtext,
}: LimitBarProps): React.ReactNode {
  const { utilization, resets_at } = limit;
  if (utilization === null) {
    return null;
  }

  // Calculate usage percentage
  const usedText = `${Math.floor(utilization)}% used`;

  let subtext: string | undefined;
  if (resets_at) {
    subtext = `Resets ${formatResetText(resets_at, true, showTimeInReset, alwaysShowDateInReset)}`;
  }

  if (extraSubtext) {
    if (subtext) {
      subtext = `${extraSubtext} · ${subtext}`;
    } else {
      subtext = extraSubtext;
    }
  }

  const maxBarWidth = 50;
  const usedLabelSpace = 12;
  if (maxWidth >= maxBarWidth + usedLabelSpace) {
    return (
      <Box flexDirection="column">
        <Text bold>{title}</Text>
        <Box flexDirection="row" gap={1}>
          <ProgressBar
            ratio={utilization / 100}
            width={maxBarWidth}
            fillColor="rate_limit_fill"
            emptyColor="rate_limit_empty"
          />
          <Text>{usedText}</Text>
        </Box>
        {subtext && <Text dimColor>{subtext}</Text>}
      </Box>
    );
  } else {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{title}</Text>
          {subtext && (
            <>
              <Text> </Text>
              <Text dimColor>· {subtext}</Text>
            </>
          )}
        </Text>
        <ProgressBar
          ratio={utilization / 100}
          width={maxWidth}
          fillColor="rate_limit_fill"
          emptyColor="rate_limit_empty"
        />
        <Text>{usedText}</Text>
      </Box>
    );
  }
}

export function Usage(): React.ReactNode {
  const [utilization, setUtilization] = useState<Utilization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { columns } = useTerminalSize();

  const availableWidth = columns - 2; // 2 for screen padding
  const maxWidth = Math.min(availableWidth, 80);

  const loadUtilization = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const seed = seedUtilizationFromOpenHeaders();
    if (seed) {
      setUtilization(seed.utilization);
    }
    try {
      const data = await fetchUtilization();
      setUtilization(data);
    } catch (err) {
      if (seed) {
        setError(
          seed.source === 'persisted' ? 'Showing last-known usage (could not refresh)' : 'Could not refresh usage data',
        );
        return;
      }
      logError(err as Error);
      const axiosError = err as { response?: { data?: unknown } };
      const responseBody = axiosError.response?.data ? jsonStringify(axiosError.response.data) : undefined;
      setError(responseBody ? `Failed to load usage data: ${responseBody}` : 'Failed to load usage data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUtilization();
  }, [loadUtilization]);

  useKeybinding(
    'settings:retry',
    () => {
      void loadUtilization();
    },
    { context: 'Settings', isActive: !!error && !isLoading },
  );

  if (error) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="error">Error: {error}</Text>
        <Text dimColor>
          <Byline>
            <ConfigurableShortcutHint action="settings:retry" context="Settings" fallback="r" description="retry" />
            <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
          </Byline>
        </Text>
      </Box>
    );
  }

  if (!utilization) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Loading usage data…</Text>
        <Text dimColor>
          <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
        </Text>
      </Box>
    );
  }

  // Only Max and Team plans have a Sonnet limit that differs from the weekly
  // limit (see rateLimitMessages.ts). For other plans the bar is redundant.
  // Show for null (unknown plan) to stay consistent with rateLimitMessages.ts,
  // which labels it "Sonnet limit" in that case.
  const subscriptionType = getSubscriptionType();
  const showSonnetBar = subscriptionType === 'max' || subscriptionType === 'team' || subscriptionType === null;

  const limits = [
    {
      title: 'Current session',
      limit: utilization.five_hour,
    },
    {
      title: 'Current week (all models)',
      limit: utilization.seven_day,
    },
    ...(showSonnetBar
      ? [
          {
            title: 'Current week (Sonnet only)',
            limit: utilization.seven_day_sonnet,
          },
        ]
      : []),
  ];

  return (
    <Box flexDirection="column" gap={1} width="100%">
      {limits.some(({ limit }) => limit) || <Text dimColor>/usage is only available for subscription plans.</Text>}

      {limits.map(
        ({ title, limit }) => limit && <LimitBar key={title} title={title} limit={limit} maxWidth={maxWidth} />,
      )}

      <SpendLimitSection maxWidth={maxWidth} />

      {utilization.extra_usage && <ExtraUsageSection extraUsage={utilization.extra_usage} maxWidth={maxWidth} />}

      {isEligibleForOverageCreditGrant() && <OverageCreditUpsell maxWidth={maxWidth} />}

      <LoopsUsageTable maxWidth={maxWidth} />

      <Text dimColor>
        <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
      </Text>
    </Box>
  );
}

/** densable 2.1.251 Dl — Spend limit bar from jL().overage. */
function SpendLimitSection({ maxWidth }: { maxWidth: number }): React.ReactNode {
  const bar = spendLimitBarProps(getRawUtilization().overage);
  if (!bar) {
    return null;
  }
  return (
    <LimitBar
      title={bar.title}
      limit={{ utilization: bar.utilization, resets_at: bar.resetsAtIso }}
      maxWidth={maxWidth}
      alwaysShowDateInReset={bar.alwaysShowDateInReset}
    />
  );
}

type ExtraUsageSectionProps = {
  extraUsage: ExtraUsage;
  maxWidth: number;
};

/** SEA iXl R5t — renamed from "Extra usage". */
const USAGE_CREDITS_SECTION_TITLE = 'Usage credits';

function ExtraUsageSection({ extraUsage, maxWidth }: ExtraUsageSectionProps): React.ReactNode {
  const subscriptionType = getSubscriptionType();
  const isProOrMax = subscriptionType === 'pro' || subscriptionType === 'max';
  const isTeamOrEnterprise = subscriptionType === 'team' || subscriptionType === 'enterprise';
  // densable iXl gate: Pro/Max OR Team/Enterprise (not Pro/Max-only)
  if (!isProOrMax && !isTeamOrEnterprise) {
    return null;
  }

  if (!extraUsage.is_enabled) {
    // Off-state CTA is Pro/Max-only (+ /usage-credits command enabled)
    if (isProOrMax && usageCreditsCommand.isEnabled()) {
      return (
        <Box flexDirection="column">
          <Text bold>{USAGE_CREDITS_SECTION_TITLE}</Text>
          <Text dimColor>Usage credits are off · /usage-credits to turn them on</Text>
        </Box>
      );
    }
    // team|enterprise + disabled → hide row
    return null;
  }

  if (extraUsage.monthly_limit === null) {
    if (isProOrMax) {
      return (
        <Box flexDirection="column">
          <Text bold>{USAGE_CREDITS_SECTION_TITLE}</Text>
          <Text dimColor>Unlimited</Text>
        </Box>
      );
    }
    // Team/Enterprise unlimited: spend-only subtitle (no ProgressBar)
    if (typeof extraUsage.used_credits !== 'number') {
      return null;
    }
    const spent = formatUsageCreditsAmount(extraUsage.used_credits, extraUsage.currency ?? 'USD');
    return (
      <Box flexDirection="column">
        <Text bold>{USAGE_CREDITS_SECTION_TITLE}</Text>
        <Text dimColor>{`${spent} spent`}</Text>
      </Box>
    );
  }

  if (typeof extraUsage.used_credits !== 'number') {
    return null;
  }

  const utilization = resolveExtraUsageUtilization({
    utilization: extraUsage.utilization,
    monthly_limit: extraUsage.monthly_limit,
    used_credits: extraUsage.used_credits,
  });
  const currency = extraUsage.currency ?? 'USD';
  const formattedUsedCredits = formatUsageCreditsAmount(extraUsage.used_credits, currency);
  const formattedMonthlyLimit = formatUsageCreditsAmount(extraUsage.monthly_limit, currency);
  const now = new Date();
  const oneMonthReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return (
    <LimitBar
      title={USAGE_CREDITS_SECTION_TITLE}
      limit={{
        utilization,
        resets_at: oneMonthReset.toISOString(),
      }}
      showTimeInReset={false}
      alwaysShowDateInReset
      extraSubtext={`${formattedUsedCredits} / ${formattedMonthlyLimit} spent`}
      maxWidth={maxWidth}
    />
  );
}

function LoopCol({ width, text }: { width: number; text: string }): React.ReactNode {
  return (
    <Box width={width} justifyContent="flex-end">
      <Text dimColor wrap="truncate-end">
        {text}
      </Text>
    </Box>
  );
}

/** densable 2.1.243 #1 — SEA `Xu` Loops table on `/usage`. */
function LoopsUsageTable({ maxWidth }: { maxWidth: number }): React.ReactNode {
  const messages = useAppState(s => {
    const raw = (s as { messages?: unknown }).messages;
    return Array.isArray(raw) ? (raw as Message[]) : [];
  });
  const rows = React.useMemo(() => collectLoopUsageRows(messages), [messages]);
  if (rows.length === 0) {
    return null;
  }

  const showPerRun = maxWidth >= LOOP_USAGE_WIDE_MIN;
  const fixed =
    LOOP_USAGE_COL.every +
    LOOP_USAGE_COL.runs +
    LOOP_USAGE_COL.tokens +
    (showPerRun ? LOOP_USAGE_COL.perRun : 0) +
    LOOP_USAGE_COL.lastRun;
  const promptWidth = Math.max(12, maxWidth - fixed);
  const visible = rows.slice(0, LOOP_USAGE_VISIBLE_ROWS);
  const more = rows.length - visible.length;
  const now = new Date();

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={promptWidth}>
          <Text>Loops</Text>
        </Box>
        <LoopCol width={LOOP_USAGE_COL.every} text="every" />
        <LoopCol width={LOOP_USAGE_COL.runs} text="runs" />
        <LoopCol width={LOOP_USAGE_COL.tokens} text="tokens" />
        {showPerRun && <LoopCol width={LOOP_USAGE_COL.perRun} text="per run" />}
        <LoopCol width={LOOP_USAGE_COL.lastRun} text="last run" />
      </Box>
      {visible.map(row => (
        <Box key={row.prompt}>
          <Box width={promptWidth}>
            <Text dimColor wrap="truncate-end">
              {row.prompt}
            </Text>
          </Box>
          <LoopCol width={LOOP_USAGE_COL.every} text={formatLoopEvery(row)} />
          <LoopCol width={LOOP_USAGE_COL.runs} text={String(row.runs)} />
          <LoopCol width={LOOP_USAGE_COL.tokens} text={formatTokens(row.tokens)} />
          {showPerRun && (
            <LoopCol
              width={LOOP_USAGE_COL.perRun}
              text={row.runs > 0 && row.tokens > 0 ? formatTokens(Math.round(row.tokens / row.runs)) : '\u2013'}
            />
          )}
          <LoopCol
            width={LOOP_USAGE_COL.lastRun}
            text={row.lastRunMs > 0 ? formatRelativeTimeAgo(new Date(row.lastRunMs), { now }) : '\u2013'}
          />
        </Box>
      ))}
      {more > 0 && (
        <Text dimColor>
          {'\u2026 '}
          {more} more
        </Text>
      )}
    </Box>
  );
}
