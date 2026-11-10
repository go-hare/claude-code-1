import React, { useEffect, useMemo, useState } from 'react';
import { extraUsage } from 'src/commands/extra-usage/index.js';
import { Box, Text } from '@anthropic/ink';
import { useClaudeAiLimits } from 'src/services/claudeAiLimitsHook.js';
import { shouldProcessMockLimits } from 'src/services/rateLimitMocking.js'; // Used for /mock-limits command
import { getRateLimitTier, getSubscriptionType, isClaudeAISubscriber } from 'src/utils/auth.js';
import { hasClaudeAiBillingAccess } from 'src/utils/billing.js';
import { MessageResponse } from '../MessageResponse.js';

type UpsellParams = {
  shouldShowUpsell: boolean;
  isMax20x: boolean;
  isExtraUsageCommandEnabled: boolean;
  shouldAutoOpenRateLimitOptionsMenu: boolean;
  isTeamOrEnterprise: boolean;
  hasBillingAccess: boolean;
  serverHidesUpgrade?: boolean;
  serverHidesOverage?: boolean;
  spendLimitNudgePath?: boolean;
};

export function getUpsellMessage({
  shouldShowUpsell,
  isMax20x,
  isExtraUsageCommandEnabled,
  shouldAutoOpenRateLimitOptionsMenu,
  isTeamOrEnterprise,
  hasBillingAccess,
  serverHidesUpgrade,
  serverHidesOverage,
  spendLimitNudgePath,
}: UpsellParams): string | null {
  if (!shouldShowUpsell) return null;

  if (shouldAutoOpenRateLimitOptionsMenu) {
    return 'Opening your options…';
  }

  if (spendLimitNudgePath) {
    return '/usage-credits to adjust your monthly spend limit.';
  }

  const canUseOverage = isExtraUsageCommandEnabled && !serverHidesOverage;

  if (isMax20x) {
    if (canUseOverage) {
      return '/usage-credits to finish what you’re working on.';
    }
    return '/login to switch to an API usage-billed account.';
  }

  if (isTeamOrEnterprise) {
    if (!canUseOverage) {
      return 'Your admin can enable extra usage at claude.ai/admin-settings/usage.';
    }
    if (hasBillingAccess) {
      return '/usage-credits to finish what you’re working on.';
    }
    return '/usage-credits to request more usage from your admin.';
  }

  if (serverHidesUpgrade) {
    if (canUseOverage) {
      return '/usage-credits to finish what you’re working on.';
    }
    return null;
  }

  if (!canUseOverage) {
    return '/upgrade to increase your usage limit.';
  }

  return '/upgrade or /usage-credits to finish what you’re working on.';
}

type RateLimitMessageProps = {
  text: string;
  onOpenRateLimitOptions?: () => void;
};

export function RateLimitMessage({ text, onOpenRateLimitOptions }: RateLimitMessageProps): React.ReactNode {
  const subscriptionType = getSubscriptionType();
  const rateLimitTier = getRateLimitTier();
  const isTeamOrEnterprise = subscriptionType === 'team' || subscriptionType === 'enterprise';
  const isMax20x = subscriptionType === 'max' && rateLimitTier === 'default_claude_max_20x';
  // Always show upsell when using /mock-limits command, otherwise show for subscribers
  const shouldShowUpsell = shouldProcessMockLimits() || isClaudeAISubscriber();

  const canSeeRateLimitOptionsUpsell = shouldShowUpsell && !isMax20x;

  const [hasOpenedInteractiveMenu, setHasOpenedInteractiveMenu] = useState(false);

  // Check actual rate limit status - only auto-open if user is currently rate limited
  // AND we've verified this with the API (resetsAt is only set after API response).
  // This prevents false alerts when resuming sessions with old rate limit messages.
  const status: {
    status: string;
    resetsAt?: number;
    isUsingOverage?: boolean;
    rateLimitType?: string;
    errorCode?: string;
  } = useClaudeAiLimits();
  const isCurrentlyRateLimited =
    status.status === 'rejected' && status.resetsAt !== undefined && !status.isUsingOverage;
  const isUpsellSuppressed =
    status?.rateLimitType === 'seven_day_overage_included' || status?.errorCode === 'credits_required';

  const shouldAutoOpenRateLimitOptionsMenu =
    canSeeRateLimitOptionsUpsell &&
    !hasOpenedInteractiveMenu &&
    isCurrentlyRateLimited &&
    !isUpsellSuppressed &&
    onOpenRateLimitOptions;

  useEffect(() => {
    if (shouldAutoOpenRateLimitOptionsMenu) {
      setHasOpenedInteractiveMenu(true);
      onOpenRateLimitOptions();
    }
  }, [shouldAutoOpenRateLimitOptionsMenu, onOpenRateLimitOptions]);

  const upsell = useMemo(() => {
    if (isUpsellSuppressed) return null;
    const message = getUpsellMessage({
      shouldShowUpsell,
      isMax20x,
      isExtraUsageCommandEnabled: extraUsage.isEnabled(),
      shouldAutoOpenRateLimitOptionsMenu: !!shouldAutoOpenRateLimitOptionsMenu,
      isTeamOrEnterprise,
      hasBillingAccess: hasClaudeAiBillingAccess(),
    });
    if (!message) return null;
    return <Text dimColor>{message}</Text>;
  }, [isUpsellSuppressed, shouldShowUpsell, isMax20x, isTeamOrEnterprise, shouldAutoOpenRateLimitOptionsMenu]);

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">{text}</Text>
        {hasOpenedInteractiveMenu ? null : upsell}
      </Box>
    </MessageResponse>
  );
}
