import * as React from 'react';
import { useEffect, useState } from 'react';
import stripAnsi from 'strip-ansi';
import { z } from 'zod';
import { usageCredits as usageCreditsCommand } from 'src/commands/extra-usage/index.js';
import { getSubscriptionType, hasProfileScope, isClaudeAISubscriber } from 'src/utils/auth.js';
import { formatTotalCost } from '../../cost-tracker.js';
import { useSessionServices } from '../../context/sessionServices.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Byline, ProgressBar, Text, type Theme } from '@anthropic/ink';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getFeatureValue_CACHED_MAY_BE_STALE, isGrowthBookEnabled } from '../../services/analytics/growthbook.js';
import {
  type ExtraUsage,
  fetchUtilization,
  formatUsageCreditsAmount,
  type RateLimit,
  resolveExtraUsageUtilization,
  seedUtilizationFromOpenHeaders,
  type UsagePlanLimit,
  type Utilization,
} from '../../services/api/usage.js';
import { getRawUtilization } from '../../services/claudeAiLimits.js';
import { spendLimitBarProps } from './spendLimitBar.js';
import { useAppState } from '../../state/AppState.js';
import { getContextWindowForModel } from '../../utils/context.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { errorMessage } from '../../utils/errors.js';
import { aggregatePluginSkillListing, skillListingCharsPerToken } from '../../utils/usagePluginFootprint.js';
import {
  BEHAVIOR_PCT_MIN,
  behaviorsOverMin,
  scanUsageTranscripts,
  usageTranscriptScanPermission,
  windowHasNamedRows,
  type UsageBehaviorKey,
  type UsageBehaviorStat,
  type UsageScanResult,
  type UsageScanWindow,
} from '../../utils/usageSessionScan.js';
import { formatResetText, formatRelativeTimeAgo, formatTokens } from '../../utils/format.js';
import {
  collectLoopUsageRows,
  formatLoopEvery,
  LOOP_USAGE_COL,
  LOOP_USAGE_VISIBLE_ROWS,
  LOOP_USAGE_WIDE_MIN,
} from '../../utils/loopUsage.js';
import { logError } from '../../utils/log.js';
import { getAPIProvider } from '../../utils/model/providers.js';
import { getSurfaceRemoteHandle } from '../../utils/sessionNameUniqueness.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import { getTheme } from '../../utils/theme.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';

type TrailingLine = { text: string; color?: keyof Theme };

type LimitBarProps = {
  title: string;
  limit: RateLimit;
  maxWidth: number;
  showTimeInReset?: boolean;
  /** densable iXl alwaysShowDateInReset — force date in reset subtext. */
  alwaysShowDateInReset?: boolean;
  extraSubtext?: string;
  subtextOverride?: string;
  /** densable Rt trailingLines — per-bar attribution under the reset subtext. */
  trailingLines?: TrailingLine[];
};

function LimitBar({
  title,
  limit,
  maxWidth,
  showTimeInReset = true,
  alwaysShowDateInReset = false,
  extraSubtext,
  subtextOverride,
  trailingLines,
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
  if (subtextOverride !== undefined) {
    subtext = subtextOverride;
  }

  const maxBarWidth = 50;
  const usedLabelSpace = 12;
  if (maxWidth >= maxBarWidth + usedLabelSpace) {
    return (
      <Box flexDirection="column" flexShrink={0}>
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
        <TrailingLines lines={trailingLines} />
      </Box>
    );
  } else {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <Text>
          <Text bold>{title}</Text>
          {subtext && (
            <>
              <Text> </Text>
              <Text dimColor>· {subtext}</Text>
            </>
          )}
        </Text>
        <TrailingLines lines={trailingLines} />
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

/** densable `In` — `(lines ?? []).map((u, h) => <Text dimColor={!u.color} color={u.color}>)`. */
function TrailingLines({ lines }: { lines?: TrailingLine[] }): React.ReactNode {
  if (!lines || lines.length === 0) {
    return null;
  }
  return lines.map((line, i) => (
    <Text key={i} dimColor={!line.color} color={line.color}>
      {line.text}
    </Text>
  ));
}

/** densable `O_` / `T_` / `ff` / `O_e` (`Ake` / `We`). */
const DEFAULT_OVERAGE_INCLUDED_MODELS: readonly string[] = Object.freeze(['Fable', 'Fable 5', 'Fable 5.1']);
const EMPTY_OVERAGE_INCLUDED_MODELS: readonly string[] = Object.freeze([]);

function defaultOverageIncludedModels(): readonly string[] {
  return isGrowthBookEnabled() ? EMPTY_OVERAGE_INCLUDED_MODELS : DEFAULT_OVERAGE_INCLUDED_MODELS;
}

export function getOverageIncludedModelsAllowlist(): readonly string[] {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>('tengu_usage_overage_included_models', null);
  if (raw === null || raw === undefined) {
    return defaultOverageIncludedModels();
  }
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
}

function isWeeklyScopedModelLimit(
  entry: unknown,
): entry is UsagePlanLimit & { scope: { model: { display_name: string } } } {
  if (typeof entry !== 'object' || entry === null) return false;
  const candidate = entry as UsagePlanLimit;
  return candidate.kind === 'weekly_scoped' && typeof candidate.scope?.model?.display_name === 'string';
}

/** densable `ext` / `UNt(limits, Ake())`. */
export function buildModelScopedWeekBars(
  limits: UsagePlanLimit[] | null | undefined,
  allowlist: readonly string[],
): Array<{
  bar: string;
  title: string;
  displayName: string;
  limit: RateLimit;
  alwaysShowDateInReset: true;
}> {
  const lowered = allowlist.map(name => name.toLowerCase());
  if (lowered.length === 0 || !Array.isArray(limits)) return [];
  return limits
    .filter(isWeeklyScopedModelLimit)
    .filter(entry => lowered.includes(entry.scope.model.display_name.toLowerCase()))
    .map(entry => {
      const displayName = entry.scope.model.display_name;
      return {
        bar: displayName,
        title: `Current week (${displayName})`,
        displayName,
        limit: {
          utilization: entry.percent,
          resets_at: entry.resets_at,
        },
        alwaysShowDateInReset: true as const,
      };
    });
}

const rateLimitPromoNoticeSchema = z.array(
  z.object({
    bar: z.string(),
    text: z.string(),
    variant: z
      .custom<keyof Theme>(val => typeof val === 'string' && Object.hasOwn(getTheme('dark'), val))
      .optional()
      .catch(undefined),
  }),
);

/** densable `jfo` / `mxo`. */
function getRateLimitPromoNotices(): Array<{
  bar: string;
  text: string;
  variant?: keyof Theme;
}> {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>('tengu_rate_limit_promo_notices', []);
  const parsed = rateLimitPromoNoticeSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * densable Ln/$n — Usage tab shell: session cost, optional plugin footprint,
 * then gateway spend OR subscriber plan limits OR Esc.
 */
export function Usage(): React.ReactNode {
  const { columns } = useTerminalSize();
  const maxWidth = Math.min(columns - 2, 80);
  const subscriber = isClaudeAISubscriber() && hasProfileScope();
  const isThinClient = getSurfaceRemoteHandle() !== null;
  return (
    <UsagePane>
      <SessionCostSection isThinClient={isThinClient} />
      {isPluginSkillListingFootprintEnabled() && <PluginSkillListingFootprint />}
      {getAPIProvider() === 'gateway' ? (
        <GatewayUsageSection maxWidth={maxWidth} />
      ) : subscriber ? (
        <PlanLimitsUsage maxWidth={maxWidth} />
      ) : (
        <EscCancelHint />
      )}
    </UsagePane>
  );
}

function isPluginSkillListingFootprintEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_LANTERN_PRISM)) {
    return true;
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_lantern_prism', false);
}

function EscCancelHint(): React.ReactNode {
  return (
    <Text dimColor>
      <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
    </Text>
  );
}

/** densable `$a` / `sr` — thin-client `get_session_cost` `.text` via `br()` (`IO().remote`). */
export async function fetchThinClientSessionCost(): Promise<string> {
  const remote = getSurfaceRemoteHandle();
  if (!remote || typeof remote.sendControlRequest !== 'function') {
    return 'Remote cost unavailable';
  }
  try {
    const result = await remote.sendControlRequest({ subtype: 'get_session_cost' });
    if (typeof result?.text === 'string') {
      return result.text;
    }
    return 'Remote cost unavailable';
  } catch (err) {
    return `Remote cost unavailable (${errorMessage(err)})`;
  }
}

/** densable Bs/ei — local formatTotalCost (bke), remote get_session_cost when thin. */
function SessionCostSection({
  isThinClient = getSurfaceRemoteHandle() !== null,
}: {
  isThinClient?: boolean;
}): React.ReactNode {
  const [text, setText] = useState(() => (isThinClient ? null : stripAnsi(formatTotalCost())));
  useEffect(() => {
    if (!isThinClient) {
      setText(stripAnsi(formatTotalCost()));
      return;
    }
    let cancelled = false;
    void fetchThinClientSessionCost().then(value => {
      if (!cancelled) setText(stripAnsi(value));
    });
    return () => {
      cancelled = true;
    };
  }, [isThinClient]);
  return (
    <Box flexDirection="column" gap={1} flexShrink={0}>
      <Text bold>{isThinClient ? 'Session (remote)' : 'Session'}</Text>
      <Text dimColor wrap="wrap">
        {text ?? 'Loading remote cost…'}
      </Text>
    </Box>
  );
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/** densable Cn/kn. */
function PluginSkillListingFootprint(): React.ReactNode {
  const pluginCommands = useAppState(s => s.plugins.commands);
  const mcpCommands = useAppState(s => s.mcp.commands);
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const effectiveModel = mainLoopModelForSession ?? mainLoopModel ?? undefined;
  const footprint = React.useMemo(() => {
    const charsPerToken = skillListingCharsPerToken(effectiveModel);
    const contextTokens = effectiveModel ? getContextWindowForModel(effectiveModel) : undefined;
    return aggregatePluginSkillListing([...pluginCommands, ...mcpCommands], charsPerToken, contextTokens);
  }, [pluginCommands, mcpCommands, effectiveModel]);
  if (footprint.byPlugin.length === 0) {
    return null;
  }
  const cap = footprint.overBudget
    ? ' (capped at the listing budget; per-plugin figures above are pre-truncation)'
    : '';
  return (
    <Box flexDirection="column" marginTop={1} flexShrink={0}>
      <Text bold>Plugin skill-listing footprint</Text>
      <Text dimColor wrap="wrap">
        What each plugin's skill descriptions add to the system prompt (cached input after the first turn). Agents and
        MCP tools not yet counted.
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {footprint.byPlugin.map(row => (
          <Box key={row.pluginName} flexDirection="row">
            <Box width={28}>
              <Text dimColor>{row.pluginName}</Text>
            </Box>
            <Text dimColor>
              {row.skillCount} {plural(row.skillCount, 'skill')} · ~{row.approxTokens} tok/turn
            </Text>
          </Box>
        ))}
        <Box flexDirection="row" marginTop={1}>
          <Box width={28}>
            <Text>Total</Text>
          </Box>
          <Text>
            ~{footprint.totalTokens} tok/turn{cap}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

/** densable Js/Ws — gateway spend only, not the subscriber plan-limit bars. */
function GatewayUsageSection({ maxWidth }: { maxWidth: number }): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1} flexShrink={0}>
      <SpendLimitSection maxWidth={maxWidth} />
      <EscCancelHint />
    </Box>
  );
}

function PlanLimitsUsage({ maxWidth }: { maxWidth: number }): React.ReactNode {
  const [utilization, setUtilization] = useState<Utilization | null>(
    () => seedUtilizationFromOpenHeaders()?.utilization ?? null,
  );
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUtilization = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setEnrichError(null);
    const seed = seedUtilizationFromOpenHeaders();
    if (seed) {
      setUtilization(prev => (seed.source === 'headers' ? seed.utilization : (prev ?? seed.utilization)));
    }
    try {
      const data = await fetchUtilization();
      setUtilization(data);
      setEnrichError(null);
    } catch (err) {
      const axiosError = err as { response?: { status?: number; data?: unknown } };
      const isRateLimited = axiosError.response?.status === 429;
      if (seed) {
        setEnrichError(
          seed.source === 'persisted'
            ? isRateLimited
              ? 'Showing last-known usage (rate limited — try again in a moment)'
              : 'Showing last-known usage (could not refresh)'
            : isRateLimited
              ? 'Per-model breakdown unavailable (rate limited — try again in a moment)'
              : 'Could not refresh usage data',
        );
        return;
      }
      if (isRateLimited) {
        setError('Usage endpoint is rate limited. Please try again in a moment.');
        return;
      }
      logError(err as Error);
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
    { context: 'Settings', isActive: (!!error || !!enrichError) && !isLoading },
  );

  if (error) {
    return (
      <Box flexDirection="column" gap={1} flexShrink={0}>
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
      <Box flexDirection="column" gap={1} flexShrink={0}>
        <Text dimColor>Loading usage data…</Text>
        <EscCancelHint />
      </Box>
    );
  }

  // Only Max and Team plans have a Sonnet limit that differs from the weekly
  // limit (see rateLimitMessages.ts). For other plans the bar is redundant.
  // Show for null (unknown plan) to stay consistent with rateLimitMessages.ts,
  // which labels it "Sonnet limit" in that case.
  const subscriptionType = getSubscriptionType();
  const showSonnetBar = subscriptionType === 'max' || subscriptionType === 'team' || subscriptionType === null;

  const promoNotices = getRateLimitPromoNotices();
  const trailingLinesForBar = (bar: string): TrailingLine[] =>
    promoNotices
      .filter(notice => notice.bar.toLowerCase() === bar.toLowerCase())
      .map(notice => ({ text: notice.text, color: notice.variant }));

  const limits: Array<{
    bar: string;
    title: string;
    limit: RateLimit | null | undefined;
    alwaysShowDateInReset: boolean;
  }> = [
    {
      bar: 'five_hour',
      title: 'Current session',
      limit: utilization.five_hour,
      alwaysShowDateInReset: false,
    },
    {
      bar: 'seven_day',
      title: 'Current week (all models)',
      limit: utilization.seven_day,
      alwaysShowDateInReset: true,
    },
    ...(showSonnetBar
      ? [
          {
            bar: 'seven_day_sonnet',
            title: 'Current week (Sonnet only)',
            limit: utilization.seven_day_sonnet,
            alwaysShowDateInReset: true,
          },
        ]
      : []),
    ...buildModelScopedWeekBars(utilization.limits, getOverageIncludedModelsAllowlist()),
  ];

  return (
    <Box flexDirection="column" gap={1} flexShrink={0}>
      {limits.map(
        ({ bar, title, limit, alwaysShowDateInReset }) =>
          limit && (
            <LimitBar
              key={title}
              title={title}
              limit={limit}
              maxWidth={maxWidth}
              alwaysShowDateInReset={alwaysShowDateInReset}
              trailingLines={trailingLinesForBar(bar)}
            />
          ),
      )}

      {utilization.cinder_cove && (
        <LimitBar
          title="Claude Code and Cowork credit"
          limit={utilization.cinder_cove}
          maxWidth={maxWidth}
          subtextOverride={formatCinderCoveSubtext(utilization.cinder_cove.resets_at)}
        />
      )}

      <ContributingUsageSection maxWidth={maxWidth} />

      {utilization.extra_usage && <ExtraUsageSection extraUsage={utilization.extra_usage} maxWidth={maxWidth} />}

      {enrichError && <Text dimColor>{enrichError}</Text>}
      {isLoading && !enrichError && <Text dimColor>Refreshing…</Text>}

      <Text dimColor>
        <Byline>
          {enrichError && (
            <ConfigurableShortcutHint action="settings:retry" context="Settings" fallback="r" description="retry" />
          )}
          <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
        </Byline>
      </Text>
    </Box>
  );
}

function formatCinderCoveSubtext(resetsAt: string | null | undefined): string {
  return resetsAt
    ? `One-time credit · Expires ${new Date(resetsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
    : 'One-time credit';
}

function ContributingHeading({ withSubtitle }: { withSubtitle?: boolean }): React.ReactNode {
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text bold wrap="wrap">
        {"What's contributing to your limits usage?"}
      </Text>
      {withSubtitle !== false && (
        <Text dimColor wrap="wrap">
          Approximate, based on local sessions on this machine — does not include other devices or claude.ai
        </Text>
      )}
    </Box>
  );
}

const EMPTY_USAGE_WINDOW: UsageScanWindow = {
  totalCost: 0,
  requestCount: 0,
  sessionCount: 0,
  behaviors: [],
  agents: [],
  skills: [],
  plugins: [],
  mcpServers: [],
  loops: [],
};

const NAMED_SHARE_NAME_WIDTH = 28;
const NAMED_SHARE_PCT_WIDTH = 6;

const BEHAVIOR_CARDS: Record<UsageBehaviorKey, { headline: (pct: number) => string; body: string }> = {
  cache_miss: {
    headline: pct => `${pct}% of your usage hit a >100k-token cache miss`,
    body: 'Uncached input is expensive, and often happens when sending a message to a session that has gone idle. /compact before stepping away keeps the cold-start small.',
  },
  long_context: {
    headline: pct => `${pct}% of your usage was at >150k context`,
    body: 'Longer sessions are more expensive even when cached. /compact mid-task, /clear when switching to new tasks.',
  },
  subagent_heavy: {
    headline: pct => `${pct}% of your usage came from subagent-heavy sessions`,
    body: 'Each subagent runs its own requests. Be deliberate about spawning them — and consider configuring a cheaper model for simpler subagents.',
  },
  high_parallel: {
    headline: pct => `${pct}% of your usage was while 4+ sessions ran in parallel`,
    body: "All sessions share one limit. If you don't need them all at once, queueing uses it more evenly.",
  },
  cron: {
    headline: pct => `${pct}% of your usage came from sessions active for 8+ hours`,
    body: 'These are often background/loop sessions. Continuous usage can add up quickly so make sure it is intentional.',
  },
};

function formatSubagentTopHeadline(pct: number, name: string): string {
  return `${pct}% of your usage came from subagents under "${name}"`;
}

function formatSkillTopHeadline(pct: number, name: string): string {
  return `${pct}% of your usage came from /${name}`;
}

function formatPluginTopHeadline(pct: number, name: string): string {
  return `${pct}% of your usage came from the plugin "${name}"`;
}

function formatMcpServerTopHeadline(pct: number, name: string): string {
  return `${pct}% of your usage came from the MCP server "${name}"`;
}

function formatSkillLabel(name: string): string {
  return `/${name}`;
}

function BehaviorCalloutCard({
  stat,
  totalCost,
  maxWidth,
}: {
  stat: UsageBehaviorStat;
  totalCost: number;
  maxWidth: number;
}): React.ReactNode {
  const card = BEHAVIOR_CARDS[stat.key];
  const pct = Math.round((stat.cost / totalCost) * 100);
  return (
    <Box flexDirection="column" width={maxWidth}>
      <Text wrap="wrap">{card.headline(pct)}</Text>
      <Box paddingLeft={1}>
        <Text dimColor wrap="wrap">
          {card.body}
        </Text>
      </Box>
    </Box>
  );
}

function TopContributorCalloutCard({
  top,
  maxWidth,
  headline,
  body,
}: {
  top: { name: string; pct: number } | undefined;
  maxWidth: number;
  headline: (pct: number, name: string) => string;
  body: string;
}): React.ReactNode {
  if (!top || top.pct < BEHAVIOR_PCT_MIN) {
    return null;
  }
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

function NamedShareTable({
  title,
  rows,
  label,
}: {
  title: string;
  rows: Array<{ name: string; pct: number }>;
  label?: (name: string) => string;
}): React.ReactNode {
  if (rows.length === 0) return null;
  const visible = rows.slice(0, LOOP_USAGE_VISIBLE_ROWS);
  const more = rows.length - visible.length;
  return (
    <Box flexDirection="column">
      <Box width={NAMED_SHARE_NAME_WIDTH + NAMED_SHARE_PCT_WIDTH} justifyContent="space-between">
        <Text>{title}</Text>
        <Text dimColor>% of usage</Text>
      </Box>
      {visible.map(row => (
        <Box key={row.name}>
          <Box width={NAMED_SHARE_NAME_WIDTH}>
            <Text dimColor wrap="truncate-end">
              {label ? label(row.name) : row.name}
            </Text>
          </Box>
          <Box width={NAMED_SHARE_PCT_WIDTH} justifyContent="flex-end">
            <Text dimColor>{row.pct}%</Text>
          </Box>
        </Box>
      ))}
      {more > 0 && (
        <Text dimColor>
          {'… '}
          {more} more
        </Text>
      )}
    </Box>
  );
}

function ContributingWindowBody({
  window,
  maxWidth,
  period,
}: {
  window: UsageScanWindow;
  maxWidth: number;
  period: 'day' | 'week';
}): React.ReactNode {
  const over = behaviorsOverMin(window);
  const named = windowHasNamedRows(window);
  const label = period === 'day' ? '24h' : '7d';
  return (
    <>
      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          Last {label} · these are independent characteristics of your usage, not a breakdown
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column" gap={1}>
        {over.length === 0 && !named ? (
          <Text dimColor>Nothing over {BEHAVIOR_PCT_MIN}% in this period — try the other window.</Text>
        ) : (
          <>
            {over.map(stat => (
              <BehaviorCalloutCard key={stat.key} stat={stat} totalCost={window.totalCost} maxWidth={maxWidth} />
            ))}
            <TopContributorCalloutCard
              top={window.agents[0]}
              maxWidth={maxWidth}
              headline={formatSubagentTopHeadline}
              body="If this runs frequently, consider configuring its subagents with a cheaper model or tightening their prompts."
            />
            <TopContributorCalloutCard
              top={window.skills[0]}
              maxWidth={maxWidth}
              headline={formatSkillTopHeadline}
              body="Heavy skills can be scoped down or run with a cheaper model via skill frontmatter."
            />
            <TopContributorCalloutCard
              top={window.plugins[0]}
              maxWidth={maxWidth}
              headline={formatPluginTopHeadline}
              body="Review what this plugin contributes — its agents, skills, and MCP tools all count toward your limit."
            />
            <TopContributorCalloutCard
              top={window.mcpServers[0]}
              maxWidth={maxWidth}
              headline={formatMcpServerTopHeadline}
              body="MCP tool results stay in context for the rest of the session. /compact to flush them, or disable servers you don't need."
            />
            {!named ? (
              <Box flexDirection="column">
                <Text bold>Skills, subagents, plugins, and MCP servers</Text>
                <Text dimColor wrap="wrap">
                  No attribution data yet · accumulates as you use Claude
                </Text>
              </Box>
            ) : (
              <>
                <NamedShareTable title="Skills" rows={window.skills} label={formatSkillLabel} />
                <NamedShareTable title="Subagents" rows={window.agents} />
                <NamedShareTable title="Plugins" rows={window.plugins} />
                <NamedShareTable title="MCP servers" rows={window.mcpServers} />
                <LoopsUsageTable rows={window.loops} maxWidth={maxWidth} />
              </>
            )}
          </>
        )}
      </Box>
    </>
  );
}

/** densable ks/Ts. */
function ContributingUsageSection({ maxWidth }: { maxWidth: number }): React.ReactNode {
  const { storageV5 } = useSessionServices();
  const [permission] = useState(usageTranscriptScanPermission);
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const [scan, setScan] = useState<UsageScanResult | null | undefined>(permission.allowed ? undefined : null);
  useEffect(() => {
    if (!permission.allowed) return;
    let cancelled = false;
    void scanUsageTranscripts(storageV5)
      .catch(err => {
        logError(err as Error);
        return { day: EMPTY_USAGE_WINDOW, week: EMPTY_USAGE_WINDOW };
      })
      .then(result => {
        if (!cancelled) setScan(result);
      });
    return () => {
      cancelled = true;
    };
  }, [permission.allowed, storageV5]);

  const window = scan ? (period === 'day' ? scan.day : scan.week) : undefined;
  const hasEither =
    scan !== undefined &&
    scan !== null &&
    (behaviorsOverMin(scan.day).length > 0 ||
      windowHasNamedRows(scan.day) ||
      behaviorsOverMin(scan.week).length > 0 ||
      windowHasNamedRows(scan.week));

  useKeybinding('settings:periodDay', () => setPeriod('day'), {
    context: 'Settings',
    isActive: hasEither,
  });
  useKeybinding('settings:periodWeek', () => setPeriod('week'), {
    context: 'Settings',
    isActive: hasEither,
  });

  if (!permission.allowed) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <ContributingHeading withSubtitle={false} />
        <Box marginTop={1} width={maxWidth}>
          <Text dimColor wrap="wrap">
            {permission.reason}
          </Text>
        </Box>
      </Box>
    );
  }
  if (scan === undefined) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <ContributingHeading />
        <Box marginTop={1}>
          <Text dimColor>Scanning local sessions…</Text>
        </Box>
      </Box>
    );
  }
  if (scan === null || !hasEither) {
    return null;
  }
  if (!window) return null;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <ContributingHeading />
      <ContributingWindowBody window={window} maxWidth={maxWidth} period={period} />
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

/** densable Ln/$n — outer 100% width, inner column flexShrink=0 so progress bars don't shrink-loop. */
function UsagePane({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column" gap={1} flexShrink={0}>
        {children}
      </Box>
    </Box>
  );
}

/** densable 2.1.251 Dl — Spend limit bar / HPe empty arm from jL().overage. */
function SpendLimitSection({ maxWidth }: { maxWidth: number }): React.ReactNode {
  const model = spendLimitBarProps(getRawUtilization().overage);
  if (!model) {
    return null;
  }
  if (model.type === 'placeholder') {
    return <Text dimColor>{model.text}</Text>;
  }
  return (
    <LimitBar
      title={model.title}
      limit={{ utilization: model.utilization, resets_at: model.resetsAtIso }}
      maxWidth={maxWidth}
      alwaysShowDateInReset={model.alwaysShowDateInReset}
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

/** densable 2.1.243 #1 — SEA `$s` Loops table. Rows come from the contributing host. */
function LoopsUsageTable({
  rows,
  maxWidth,
}: {
  rows: ReturnType<typeof collectLoopUsageRows>;
  maxWidth: number;
}): React.ReactNode {
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
              text={row.runs > 0 && row.tokens > 0 ? formatTokens(Math.round(row.tokens / row.runs)) : '–'}
            />
          )}
          <LoopCol
            width={LOOP_USAGE_COL.lastRun}
            text={row.lastRunMs > 0 ? formatRelativeTimeAgo(new Date(row.lastRunMs), { now }) : '–'}
          />
        </Box>
      ))}
      {more > 0 && (
        <Text dimColor>
          {'… '}
          {more} more
        </Text>
      )}
    </Box>
  );
}
