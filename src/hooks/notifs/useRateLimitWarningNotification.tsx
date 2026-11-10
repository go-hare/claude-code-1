import { useEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { type ClaudeAILimits, getRateLimitWarning, getUsingOverageText } from 'src/services/claudeAiLimits.js';
import { useClaudeAiLimits } from 'src/services/claudeAiLimitsHook.js';
import { isUsageCreditsHintEnabled } from 'src/services/rateLimitMessages.js';
import { useAppState } from 'src/state/AppState.js';
import { getOauthAccountInfo, getSubscriptionType, isClaudeAISubscriber } from 'src/utils/auth.js';
import { hasClaudeAiBillingAccess } from 'src/utils/billing.js';
import { type EffortValue, modelSupportsEffort, resolveAppliedEffort } from 'src/utils/effort.js';
import { parseUserSpecifiedModel, renderModelName } from 'src/utils/model/model.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';

type RateLimitLeverHint = {
  lever: 'model' | 'effort';
  text: string;
};

/** densable `$Po` — actionable lever hint for Pro 7-day early warnings. */
function getRateLimitLeverHint(
  limits: ClaudeAILimits,
  model: string,
  effortValue: EffortValue | undefined,
): RateLimitLeverHint | null {
  if (getSubscriptionType() !== 'pro') return null;
  if (limits.rateLimitType !== 'seven_day') return null;
  if (model.includes('fable')) {
    return { lever: 'model', text: 'try /model opus · more runway' };
  }
  if (model.includes('opus')) {
    return { lever: 'model', text: 'try /model sonnet · ~2× runway' };
  }
  if (!modelSupportsEffort(model)) return null;
  const effort = resolveAppliedEffort(model, effortValue);
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') {
    return { lever: 'effort', text: 'try /effort medium' };
  }
  return null;
}

/** densable `FPo` — model switch / buy-more hint when overage rate limit warns on Fable. */
function getOverageModelHint(model: string): string | null {
  const parsed = parseUserSpecifiedModel(model);
  if (!parsed.includes('fable') || !isClaudeAISubscriber() || getOauthAccountInfo()?.billingType === 'usage_based') {
    return null;
  }
  if (!isUsageCreditsHintEnabled() || !hasClaudeAiBillingAccess()) {
    return 'Switch models to keep working.';
  }
  return `Buy more to keep using ${renderModelName(parsed)}, or switch models to keep working.`;
}

export function useRateLimitWarningNotification(model: string): void {
  const { addNotification } = useNotifications();
  const claudeAiLimits = useClaudeAiLimits();
  const effortValue = useAppState(s => s.effortValue);
  // claudeAiLimits reference is stable until statusListeners fire (API
  // response), so these skip the Intl formatting work on most REPL renders.
  const rateLimitWarning = useMemo(() => getRateLimitWarning(claudeAiLimits, model), [claudeAiLimits, model]);
  const usingOverageText = useMemo(() => getUsingOverageText(claudeAiLimits), [claudeAiLimits]);
  const shownWarningRef = useRef<string | null>(null);
  const subscriptionType = getSubscriptionType();
  const hasBillingAccess = hasClaudeAiBillingAccess();
  const isTeamOrEnterprise = subscriptionType === 'team' || subscriptionType === 'enterprise';

  // Track overage mode transitions
  const [hasShownOverageNotification, setHasShownOverageNotification] = useState(false);

  // Show immediate notification when entering overage mode
  useEffect(() => {
    if (getIsRemoteMode()) return;
    if (claudeAiLimits.isUsingOverage && !hasShownOverageNotification && (!isTeamOrEnterprise || hasBillingAccess)) {
      addNotification({
        key: 'limit-reached',
        text: usingOverageText,
        priority: 'immediate',
      });
      setHasShownOverageNotification(true);
    } else if (!claudeAiLimits.isUsingOverage && hasShownOverageNotification) {
      // Reset when no longer in overage mode
      setHasShownOverageNotification(false);
    }
  }, [
    claudeAiLimits.isUsingOverage,
    usingOverageText,
    hasShownOverageNotification,
    addNotification,
    hasBillingAccess,
    isTeamOrEnterprise,
  ]);

  // Show warning notification for approaching limits (densable `Dnt`)
  useEffect(() => {
    if (getIsRemoteMode()) return;
    if (!rateLimitWarning || rateLimitWarning === shownWarningRef.current) return;
    if (
      claudeAiLimits.status === 'allowed_warning' &&
      claudeAiLimits.rateLimitType === 'five_hour' &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_cosmic_lake', false)
    ) {
      return;
    }
    shownWarningRef.current = rateLimitWarning;
    const leverHint = getRateLimitLeverHint(claudeAiLimits, model, effortValue);
    const overageHint = claudeAiLimits.rateLimitType === 'overage' ? getOverageModelHint(model) : null;
    addNotification({
      key: 'rate-limit-warning',
      segments: [
        { text: rateLimitWarning, color: 'warning' },
        ...(leverHint ? [{ text: ` · ${leverHint.text}`, dim: true }] : []),
        ...(overageHint ? [{ text: ` · ${overageHint}`, dim: true }] : []),
      ],
      priority: 'high',
    });
    if (leverHint) {
      logEvent('tengu_rate_limit_lever_hint', {
        lever: leverHint.lever as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }
  }, [rateLimitWarning, claudeAiLimits, model, effortValue, addNotification]);
}
