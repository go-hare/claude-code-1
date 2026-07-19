import * as React from 'react';
import { Suspense, use, useEffect, useState } from 'react';
import { extraUsage as extraUsageCommand } from 'src/commands/extra-usage/index.js';
import { formatCost } from 'src/cost-tracker.js';
import { getSubscriptionType } from 'src/utils/auth.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '@anthropic/ink';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { type ExtraUsage, fetchUtilization, type RateLimit, type Utilization } from '../../services/api/usage.js';
import { formatResetText } from '../../utils/format.js';
import { logError } from '../../utils/log.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import {
  hasNamedTips,
  periodHasSignal,
  scanLocalUsageSafe,
  significantBehaviors,
  USAGE_BEHAVIOR_COPY,
  type UsageNamedPct,
  type UsageScanResult,
} from '../../utils/usageSessionScan.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline, ProgressBar } from '@anthropic/ink';
import { isEligibleForOverageCreditGrant, OverageCreditUpsell } from '../LogoV2/OverageCreditUpsell.js';

type LimitBarProps = {
  title: string;
  limit: RateLimit;
  maxWidth: number;
  showTimeInReset?: boolean;
  extraSubtext?: string;
};

function LimitBar({ title, limit, maxWidth, showTimeInReset = true, extraSubtext }: LimitBarProps): React.ReactNode {
  const { utilization, resets_at } = limit;
  if (utilization === null) {
    return null;
  }

  // Calculate usage percentage
  const usedText = `${Math.floor(utilization)}% used`;

  let subtext: string | undefined;
  if (resets_at) {
    subtext = `Resets ${formatResetText(resets_at, true, showTimeInReset)}`;
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
    try {
      const data = await fetchUtilization();
      setUtilization(data);
    } catch (err) {
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

      {utilization.extra_usage && <ExtraUsageSection extraUsage={utilization.extra_usage} maxWidth={maxWidth} />}

      {isEligibleForOverageCreditGrant() && <OverageCreditUpsell maxWidth={maxWidth} />}

      {/* densable y1o/mYs/hYs: local session usage breakdown with d/w period keys */}
      <UsageBreakdown maxWidth={maxWidth} />

      <Text dimColor>
        <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
      </Text>
    </Box>
  );
}

function UsageBreakdownHeader(): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold wrap="wrap">
        What&apos;s contributing to your limits usage?
      </Text>
    </Box>
  );
}

function UsageBreakdown({ maxWidth }: { maxWidth: number }): React.ReactNode {
  // densable mYs: start scan once; Suspense shows "Scanning local sessions…"
  const [scanPromise] = useState(() => scanLocalUsageSafe());
  return (
    <Suspense
      fallback={
        <Box flexDirection="column">
          <UsageBreakdownHeader />
          <Box marginTop={1}>
            <Text dimColor>Scanning local sessions…</Text>
          </Box>
        </Box>
      }
    >
      <UsageBreakdownInner maxWidth={maxWidth} scanPromise={scanPromise} />
    </Suspense>
  );
}

function UsageBreakdownInner({
  maxWidth,
  scanPromise,
}: {
  maxWidth: number;
  scanPromise: Promise<UsageScanResult>;
}): React.ReactNode {
  const scan = use(scanPromise);
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const dayHas = periodHasSignal(scan.day);
  const weekHas = periodHasSignal(scan.week);
  const anyHas = dayHas || weekHas;

  useKeybindings(
    {
      'settings:periodDay': () => setPeriod('day'),
      'settings:periodWeek': () => setPeriod('week'),
    },
    { context: 'Settings', isActive: anyHas },
  );

  if (!anyHas) return null;

  const snap = period === 'day' ? scan.day : scan.week;
  const behaviors = significantBehaviors(snap);
  const windowLabel = period === 'day' ? '24h' : '7d';
  const emptyPeriod = behaviors.length === 0 && !hasNamedTips(snap);

  return (
    <Box flexDirection="column" width={maxWidth}>
      <UsageBreakdownHeader />
      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          Last {windowLabel} · these are independent characteristics of your usage, not a breakdown
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} gap={1}>
        {emptyPeriod ? (
          <Text dimColor>Nothing over 10% in this period — try the other window.</Text>
        ) : (
          <>
            {behaviors.map(stat => (
              <BehaviorRow key={stat.key} stat={stat} totalCost={snap.totalCost} maxWidth={maxWidth} />
            ))}
            <NamedTip
              top={snap.agents[0]}
              maxWidth={maxWidth}
              headline={(pct, name) => `${pct}% of your usage came from subagents under "${name}"`}
              body="If this runs frequently, consider configuring its subagents with a cheaper model or tightening their prompts."
            />
            <NamedTip
              top={snap.skills[0]}
              maxWidth={maxWidth}
              headline={(pct, name) => `${pct}% of your usage came from /${name}`}
              body="Heavy skills can be scoped down or run with a cheaper model via skill frontmatter."
            />
            <NamedTip
              top={snap.plugins[0]}
              maxWidth={maxWidth}
              headline={(pct, name) => `${pct}% of your usage came from plugin "${name}"`}
              body="Review what this plugin contributes — its agents, skills, and MCP tools all count toward your limit."
            />
            <NamedTip
              top={snap.mcpServers[0]}
              maxWidth={maxWidth}
              headline={(pct, name) => `${pct}% of your usage came from MCP server "${name}"`}
              body="MCP tools can add tokens via large results. Prefer scoped tools and shorter responses."
            />
          </>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          <Byline>
            <ConfigurableShortcutHint action="settings:periodDay" context="Settings" fallback="d" description="day" />
            <ConfigurableShortcutHint action="settings:periodWeek" context="Settings" fallback="w" description="week" />
          </Byline>
        </Text>
      </Box>
    </Box>
  );
}

function BehaviorRow({
  stat,
  totalCost,
  maxWidth,
}: {
  stat: { key: keyof typeof USAGE_BEHAVIOR_COPY; cost: number; count: number };
  totalCost: number;
  maxWidth: number;
}): React.ReactNode {
  const copy = USAGE_BEHAVIOR_COPY[stat.key];
  const pct = totalCost > 0 ? Math.round((stat.cost / totalCost) * 100) : 0;
  return (
    <Box flexDirection="column" width={maxWidth}>
      <Text wrap="wrap">{copy.headline(pct)}</Text>
      <Box paddingLeft={1}>
        <Text dimColor wrap="wrap">
          {copy.body}
        </Text>
      </Box>
    </Box>
  );
}

function NamedTip({
  top,
  maxWidth,
  headline,
  body,
}: {
  top: UsageNamedPct | undefined;
  maxWidth: number;
  headline: (pct: number, name: string) => string;
  body: string;
}): React.ReactNode {
  if (!top || top.pct < 10) return null;
  return (
    <Box flexDirection="column" width={maxWidth}>
      <Text wrap="wrap">{headline(top.pct, top.name)}</Text>
      <Box paddingLeft={1}>
        <Text dimColor wrap="wrap">
          {body}
        </Text>
      </Box>
    </Box>
  );
}

type ExtraUsageSectionProps = {
  extraUsage: ExtraUsage;
  maxWidth: number;
};

const EXTRA_USAGE_SECTION_TITLE = 'Extra usage';

function ExtraUsageSection({ extraUsage, maxWidth }: ExtraUsageSectionProps): React.ReactNode {
  const subscriptionType = getSubscriptionType();
  const isProOrMax = subscriptionType === 'pro' || subscriptionType === 'max';
  if (!isProOrMax) {
    // Only show to Pro and Max, consistent with claude.ai non-admin usage settings
    return false;
  }

  if (!extraUsage.is_enabled) {
    if (extraUsageCommand.isEnabled()) {
      return (
        <Box flexDirection="column">
          <Text bold>{EXTRA_USAGE_SECTION_TITLE}</Text>
          <Text dimColor>Extra usage not enabled · /extra-usage to enable</Text>
        </Box>
      );
    }

    return null;
  }

  if (extraUsage.monthly_limit === null) {
    return (
      <Box flexDirection="column">
        <Text bold>{EXTRA_USAGE_SECTION_TITLE}</Text>
        <Text dimColor>Unlimited</Text>
      </Box>
    );
  }

  if (typeof extraUsage.used_credits !== 'number' || typeof extraUsage.utilization !== 'number') {
    return null;
  }

  const formattedUsedCredits = formatCost(extraUsage.used_credits / 100, 2);
  const formattedMonthlyLimit = formatCost(extraUsage.monthly_limit / 100, 2);
  const now = new Date();
  const oneMonthReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return (
    <LimitBar
      title={EXTRA_USAGE_SECTION_TITLE}
      limit={{
        utilization: extraUsage.utilization,
        // Not applicable for enterprises, but for now we don't render this for them
        resets_at: oneMonthReset.toISOString(),
      }}
      showTimeInReset={false}
      extraSubtext={`${formattedUsedCredits} / ${formattedMonthlyLimit} spent`}
      maxWidth={maxWidth}
    />
  );
}
