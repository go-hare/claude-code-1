import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getIsNonInteractiveSession } from '../../bootstrap/state.js';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { type OptionWithDescription, Select } from '../../components/CustomSelect/select.js';
import { Box, Dialog, Text } from '@anthropic/ink';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { logEvent } from '../../services/analytics/index.js';
import { fetchUtilization, formatUsageCreditsAmount } from '../../services/api/usage.js';
import { type ClaudeAILimits, getRawUtilization, type RawUtilization } from '../../services/claudeAiLimits.js';
import { useClaudeAiLimits } from '../../services/claudeAiLimitsHook.js';
import {
  canOfferQuotaAutoResume,
  cancelQuotaAutoResume,
  fireQuotaAutoResumeContinuation,
  getQuotaAutoResumeState,
  getWaitThenContinueOption,
  hasPendingQuotaContinuationInQueue,
  isQuotaAutoResumeEpisodeActive,
  offerArmQuotaAutoResume,
  subscribeQuotaAutoResumeChanged,
} from '../../services/quotaAutoResume.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getOauthAccountInfo, getRateLimitTier, getSubscriptionType, isClaudeAISubscriber } from '../../utils/auth.js';
import { hasClaudeAiBillingAccess } from '../../utils/billing.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isFableModel } from '../../utils/fableConsent.js';
import { leftoverM, leftoverY } from '../../utils/leftoverOt.js';
import { logError } from '../../utils/log.js';
import {
  getDefaultHaikuModel,
  getDefaultMainLoopModel,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  renderModelName,
} from '../../utils/model/model.js';
import { isModelAllowed } from '../../utils/model/modelAllowlist.js';
import { call as extraUsageCall } from '../extra-usage/extra-usage.js';
import { extraUsage } from '../extra-usage/index.js';
import upgrade from '../upgrade/index.js';
import { call as upgradeCall } from '../upgrade/upgrade.js';

/**
 * Official 2.1.323 `SPe` (#1969): detect a rate-limit rejection whose cause is
 * `credits_required` (a model needs usage credits that are turned off or used up).
 */
export function isCreditsRequiredRateLimit(status: {
  status?: string;
  errorCode?: string;
  rateLimitType?: string;
}): boolean {
  return (
    status.status === 'rejected' &&
    status.errorCode === 'credits_required' &&
    (status.rateLimitType === undefined || status.rateLimitType === 'overage')
  );
}

/**
 * Official 2.1.323 `Bt` (#2108): resolve the loaded monthly spend limit from the
 * usage endpoint. When both `monthly_limit` is null/missing and `used_credits` is
 * not a number, treat the load as failed rather than inventing a lower limit.
 */
export function resolveLoadedSpendLimit(
  extraUsageData:
    | {
        monthly_limit?: number | null;
        used_credits?: number | null;
      }
    | null
    | undefined,
): { loadFailed: true } | { loadFailed: false; limitCents: number | null } {
  const monthlyLimit = extraUsageData?.monthly_limit ?? null;
  const usedCredits = extraUsageData?.used_credits;
  if (monthlyLimit === null && typeof usedCredits !== 'number') {
    return { loadFailed: true };
  }
  const effectiveLimit = monthlyLimit === null ? null : Math.max(monthlyLimit, usedCredits ?? 0);
  return { loadFailed: false, limitCents: effectiveLimit };
}

/**
 * Official 2.1.323 `Bt` (#2108): format the spend-limit adjustment row label & hint.
 */
export function formatSpendLimitAdjustRow(params: {
  loadFailed: boolean;
  draftLimitCents: number | null | undefined;
  currentLimitCents: number | null | undefined;
  currency: string;
}): { label: string; hint: string } {
  const { loadFailed, draftLimitCents, currentLimitCents, currency } = params;
  const isLoaded = draftLimitCents !== undefined;
  const valueText = loadFailed
    ? 'unavailable'
    : !isLoaded
      ? '…'
      : draftLimitCents === null
        ? 'Unlimited'
        : formatUsageCreditsAmount(draftLimitCents, currency);
  const hint = loadFailed
    ? ''
    : currentLimitCents === null
      ? '← or → to set a limit'
      : '← or → to adjust · Del to remove limit';
  return {
    label: `Adjust monthly spend limit: ${valueText}`,
    hint,
  };
}

export const SPEND_LIMIT_LOAD_FAILED_MESSAGE =
  "Couldn't load your current spend limit, so it can't be changed right now. Try /rate-limit-options again later.";

/** Official 2.1.331 GrowthBook gate (`tengu_melodic_pudding`) for rate-limit menu model switching. */
export const RATE_LIMIT_SWITCH_MODEL_FLAG = 'tengu_melodic_pudding';

/** Official 2.1.331 `d5e` continuation prompt queued after switching models from the rate-limit menu. */
export const AUTO_CONTINUE_AFTER_SWITCH_PROMPT =
  'You can continue now. Continue the task you were working on when the usage limit was reached; do not repeat work that is already complete.';

function isUsageCreditsOnlyModel(model: string | null | undefined): boolean {
  if (!model) return false;
  if (isFableModel(model)) return true;
  const calmSeal = getFeatureValue_CACHED_MAY_BE_STALE<unknown>('tengu_calm_seal', null);
  return (
    Array.isArray(calmSeal) &&
    calmSeal.some(entry => typeof entry === 'string' && entry.trim().toLowerCase() === model.trim().toLowerCase())
  );
}

/**
 * Official 2.1.331 `m6()` — resolve the default non-usage-credits-only fallback
 * model when switching off a rate-limited overage-included model.
 */
export function getRateLimitSwitchModelFallback(options?: {
  noModelFallback?: boolean;
  candidates?: readonly string[];
  allowCheck?: (model: string) => boolean;
}): string | null {
  if (options?.noModelFallback) return null;
  const candidates = options?.candidates ?? [
    getDefaultMainLoopModel(),
    getDefaultOpusModel(),
    getDefaultSonnetModel(),
    getDefaultHaikuModel(),
  ];
  const allowCheck = options?.allowCheck ?? isModelAllowed;
  for (const candidate of candidates) {
    if (!candidate || isUsageCreditsOnlyModel(candidate)) continue;
    if (allowCheck(candidate)) return candidate;
  }
  return null;
}

/**
 * Official 2.1.331 `on(limits, mainLoopModel)` — determine whether the
 * rate-limit options menu should offer a `"Switch to <model> and continue"` row.
 */
export function getSwitchModelTargetForRateLimit(
  limits: Pick<ClaudeAILimits, 'status' | 'rateLimitType'>,
  mainLoopModel: string | null | undefined,
  options?: {
    rawUtilization?: RawUtilization;
    isSubscriber?: boolean;
    billingType?: string | null;
    isInteractive?: boolean;
    isRemote?: boolean;
    flagEnabled?: boolean;
    fallbackModel?: string | null;
  },
): string | null {
  const raw = options?.rawUtilization ?? getRawUtilization();
  const fiveHourUtil = raw.five_hour?.utilization ?? 0;
  const sevenDayUtil = raw.seven_day?.utilization ?? 0;
  const isInteractiveSubscriber =
    (options?.isSubscriber ?? isClaudeAISubscriber()) &&
    (options?.billingType ?? getOauthAccountInfo()?.billingType) !== 'usage_based' &&
    (options?.isInteractive ?? !getIsNonInteractiveSession()) &&
    !(options?.isRemote ?? isEnvTruthy(process.env.CLAUDE_CODE_REMOTE));
  if (
    !(
      limits.rateLimitType === 'seven_day_overage_included' &&
      limits.status === 'rejected' &&
      isUsageCreditsOnlyModel(mainLoopModel) &&
      fiveHourUtil < 1 &&
      sevenDayUtil < 1
    ) ||
    !isInteractiveSubscriber
  ) {
    return null;
  }
  const flagEnabled =
    options?.flagEnabled ?? getFeatureValue_CACHED_MAY_BE_STALE(RATE_LIMIT_SWITCH_MODEL_FLAG, false) === true;
  if (!flagEnabled) return null;
  const fallback = options?.fallbackModel !== undefined ? options.fallbackModel : getRateLimitSwitchModelFallback();
  return fallback ?? null;
}

/**
 * Official 2.1.331 `di` / `Ci` — execute the rate-limit menu switch-model
 * action: emit `tengu_rate_limit_options_menu_select_switch_model`, cancel
 * quota auto-resume, update `mainLoopModel`, enqueue the auto-continuation
 * prompt, record `model_switch` outcome, and report completion via `onDone`.
 */
export function executeRateLimitSwitchModel(params: {
  targetModel: string;
  setAppState: ToolUseContext['setAppState'];
  onDone: RateLimitOptionsMenuProps['onDone'];
  enqueueContinuation?: (prompt: string) => void;
}): void {
  const { targetModel, setAppState, onDone, enqueueContinuation } = params;
  logEvent('tengu_rate_limit_options_menu_select_switch_model', {});
  try {
    cancelQuotaAutoResume('model_switch');
    setAppState(prev => ({
      ...prev,
      mainLoopModel: targetModel,
    }));
    if (enqueueContinuation) {
      enqueueContinuation(AUTO_CONTINUE_AFTER_SWITCH_PROMPT);
    } else {
      fireQuotaAutoResumeContinuation(AUTO_CONTINUE_AFTER_SWITCH_PROMPT);
    }
    leftoverY('model_switch');
    onDone(`Switched to ${renderModelName(targetModel)} for this session · /model to change`, {
      display: 'system',
    });
  } catch (err) {
    logError(err);
    leftoverM('model_switch', 'limit_menu_switch_threw');
    onDone("Couldn't switch models. Run /model to switch.", { display: 'system' });
  }
}

type RateLimitOptionsMenuOptionType =
  | 'upgrade'
  | 'extra-usage'
  | 'cancel'
  | 'auto-resume'
  | 'cancel-auto-resume'
  | 'switch-model';

type RateLimitOptionsMenuProps = {
  onDone: (
    result?: string,
    options?:
      | {
          display?: CommandResultDisplay | undefined;
        }
      | undefined,
  ) => void;
  context: ToolUseContext & LocalJSXCommandContext;
};

function RateLimitOptionsMenu({ onDone, context }: RateLimitOptionsMenuProps): React.ReactNode {
  const [subCommandJSX, setSubCommandJSX] = useState<React.ReactNode>(null);
  const claudeAiLimits = useClaudeAiLimits();
  const subscriptionType = getSubscriptionType();
  const rateLimitTier = getRateLimitTier();
  const hasExtraUsageEnabled = getOauthAccountInfo()?.hasExtraUsageEnabled === true;
  const isUsageBased = getOauthAccountInfo()?.billingType === 'usage_based';
  const isMax = subscriptionType === 'max';
  const isMax20x = isMax && rateLimitTier === 'default_claude_max_20x';
  const isTeamOrEnterprise = subscriptionType === 'team' || subscriptionType === 'enterprise';
  const buyFirst = getFeatureValue_CACHED_MAY_BE_STALE('tengu_jade_anvil_4', false);
  const [isCreditsRequired] = useState(() => isCreditsRequiredRateLimit(claudeAiLimits));
  const [switchModelTarget] = useState(() =>
    getSwitchModelTargetForRateLimit(claudeAiLimits, context.options.mainLoopModel),
  );
  const [spendLimitState, setSpendLimitState] = useState<
    | { loaded: false; loadFailed: false }
    | { loaded: false; loadFailed: true }
    | { loaded: true; loadFailed: false; limitCents: number | null }
  >({ loaded: false, loadFailed: false });
  const isSpendLimitNudge =
    !isTeamOrEnterprise &&
    claudeAiLimits.overageDisabledReason === 'org_level_disabled_until' &&
    hasClaudeAiBillingAccess() &&
    extraUsage.isEnabled();
  useEffect(() => {
    if (!isSpendLimitNudge) return;
    let cancelled = false;
    void fetchUtilization()
      .then(data => {
        if (cancelled) return;
        const resolved = resolveLoadedSpendLimit(data?.extra_usage);
        if (resolved.loadFailed) {
          setSpendLimitState({ loaded: false, loadFailed: true });
          return;
        }
        setSpendLimitState({ loaded: true, loadFailed: false, limitCents: resolved.limitCents });
      })
      .catch(() => {
        if (!cancelled) {
          setSpendLimitState({ loaded: false, loadFailed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isSpendLimitNudge]);
  const quotaPhase = useSyncExternalStore(
    subscribeQuotaAutoResumeChanged,
    () => getQuotaAutoResumeState().phase,
    () => getQuotaAutoResumeState().phase,
  );
  // densable v3h = p$t(phase) — episode still owns wait
  const episodeActive = isQuotaAutoResumeEpisodeActive(getQuotaAutoResumeState());
  const resetAlreadyPassed = claudeAiLimits.resetsAt !== undefined && claudeAiLimits.resetsAt * 1000 <= Date.now();
  const waitOption = getWaitThenContinueOption(claudeAiLimits.resetsAt, resetAlreadyPassed);

  const options = useMemo<OptionWithDescription<RateLimitOptionsMenuOptionType>[]>(() => {
    const actionOptions: OptionWithDescription<RateLimitOptionsMenuOptionType>[] = [];

    if (extraUsage.isEnabled()) {
      const hasBillingAccess = hasClaudeAiBillingAccess();
      const needsToRequestFromAdmin = isTeamOrEnterprise && !hasBillingAccess;
      // Org spend cap depleted - non-admins can't request more since there's nothing to allocate
      // - out_of_credits: wallet empty
      // - org_level_disabled_until: org spend cap hit for the month
      // - org_service_zero_credit_limit: org service has zero credit limit
      const isOrgSpendCapDepleted =
        claudeAiLimits.overageDisabledReason === 'out_of_credits' ||
        claudeAiLimits.overageDisabledReason === 'org_level_disabled_until' ||
        claudeAiLimits.overageDisabledReason === 'org_service_zero_credit_limit';

      // Hide for non-admin Team/Enterprise users when org spend cap is depleted
      if (needsToRequestFromAdmin && isOrgSpendCapDepleted) {
        // Don't show extra-usage option
      } else {
        const isOverageState =
          claudeAiLimits.overageStatus === 'rejected' || claudeAiLimits.overageStatus === 'allowed_warning';
        const creditsNoun = isUsageBased ? 'usage' : 'usage credits';

        let label: string;
        if (needsToRequestFromAdmin) {
          label = isOverageState ? 'Ask your admin for more usage' : 'Ask your admin for more usage';
        } else if (isSpendLimitNudge && spendLimitState.loadFailed) {
          label = formatSpendLimitAdjustRow({
            loadFailed: true,
            draftLimitCents: undefined,
            currentLimitCents: undefined,
            currency: 'USD',
          }).label;
        } else {
          label = hasExtraUsageEnabled ? `Add funds to continue with ${creditsNoun}` : `Switch to ${creditsNoun}`;
        }

        actionOptions.push({
          label,
          value: 'extra-usage',
        });
      }
    }

    if (!isMax20x && !isTeamOrEnterprise && upgrade.isEnabled()) {
      actionOptions.push({
        label: 'Upgrade your plan',
        value: 'upgrade',
      });
    }

    const cancelOption: OptionWithDescription<RateLimitOptionsMenuOptionType> = {
      label: isUsageBased || isCreditsRequired ? 'Stop' : 'Stop and wait for limit to reset',
      value: 'cancel',
    };

    // densable: v3h ? Don't continue… : d$t ? Wait here… : undefined
    // Official 2.1.323 (#1969): credits_required has no reset window to wait for.
    const autoResumeOption: OptionWithDescription<RateLimitOptionsMenuOptionType> | undefined = episodeActive
      ? {
          label: "Don't continue automatically",
          value: 'cancel-auto-resume',
        }
      : !isCreditsRequired && canOfferQuotaAutoResume(claudeAiLimits)
        ? {
            label: waitOption.label,
            value: 'auto-resume',
          }
        : undefined;

    const secondaryOptions: OptionWithDescription<RateLimitOptionsMenuOptionType>[] = [];
    if (autoResumeOption) {
      secondaryOptions.push(autoResumeOption);
    }
    if (switchModelTarget !== null) {
      secondaryOptions.push({
        label: `Switch to ${renderModelName(switchModelTarget)} and continue`,
        value: 'switch-model',
      });
    }

    if (buyFirst) {
      return [...actionOptions, cancelOption, ...secondaryOptions];
    }
    return [cancelOption, ...secondaryOptions, ...actionOptions];
  }, [
    buyFirst,
    isMax20x,
    isTeamOrEnterprise,
    hasExtraUsageEnabled,
    isUsageBased,
    isCreditsRequired,
    switchModelTarget,
    isSpendLimitNudge,
    spendLimitState.loadFailed,
    episodeActive,
    waitOption.label,
    claudeAiLimits,
    quotaPhase,
  ]);

  function handleCancel(): void {
    // densable RZi: Klr() || Ado==="stale" → Nyr(); Klr = WXa pending
    // continuation only — armed countdown must NOT cancel (use
    // "Don't continue automatically" for that). Esc/Stop → prefill + skip.
    if (hasPendingQuotaContinuationInQueue() || quotaPhase === 'stale') {
      logEvent('tengu_rate_limit_options_menu_cancel', {});
      cancelQuotaAutoResume('dialog');
      onDone(
        'Automatic continue cancelled. Your session will wait for you instead; /rate-limit-options can arm it again.',
      );
      return;
    }
    logEvent('tengu_rate_limit_options_menu_cancel', {});
    (
      context as ToolUseContext & {
        prefillRateLimitAutoQueueContinue?: () => void;
      }
    ).prefillRateLimitAutoQueueContinue?.();
    onDone(undefined, { display: 'skip' });
  }

  function handleSelectAutoResume(): void {
    logEvent('tengu_rate_limit_options_menu_select_auto_resume', {});
    // densable xZi: Vqn && VXa(M4f); else prefill + skip
    if (
      claudeAiLimits.status !== 'rejected' ||
      claudeAiLimits.resetsAt === undefined ||
      !offerArmQuotaAutoResume(claudeAiLimits, Date.now(), 'dialog')
    ) {
      (
        context as ToolUseContext & {
          prefillRateLimitAutoQueueContinue?: () => void;
        }
      ).prefillRateLimitAutoQueueContinue?.();
      onDone(undefined, { display: 'skip' });
      return;
    }
    onDone(
      `Claude Code will continue automatically ${waitOption.confirmationPhrase}. Keep this session open; it may still pause for permission prompts. Press esc to cancel the wait.`,
    );
  }

  function handleCancelAutoResume(): void {
    logEvent('tengu_rate_limit_options_menu_cancel_auto_resume', {});
    cancelQuotaAutoResume('dialog');
    onDone(
      'Automatic continue cancelled. Your session will wait for you instead; /rate-limit-options can arm it again.',
    );
  }

  function handleSelectSwitchModel(): void {
    if (switchModelTarget === null) return;
    executeRateLimitSwitchModel({
      targetModel: switchModelTarget,
      setAppState: context.setAppState,
      onDone,
    });
  }

  function handleSelect(value: RateLimitOptionsMenuOptionType): void {
    // densable A3h: upgrade/team/extra-usage cancel pending auto-queue
    if (value === 'upgrade' || value === 'extra-usage') {
      (
        context as ToolUseContext & {
          cancelRateLimitAutoQueueContinue?: () => void;
        }
      ).cancelRateLimitAutoQueueContinue?.();
    }
    if (value === 'upgrade') {
      logEvent('tengu_rate_limit_options_menu_select_upgrade', {});
      void upgradeCall(onDone, context).then(jsx => {
        if (jsx) {
          setSubCommandJSX(jsx);
        }
      });
    } else if (value === 'extra-usage') {
      if (isSpendLimitNudge && spendLimitState.loadFailed) {
        onDone(SPEND_LIMIT_LOAD_FAILED_MESSAGE, { display: 'system' });
        return;
      }
      logEvent('tengu_rate_limit_options_menu_select_extra_usage', {});
      void extraUsageCall(onDone, context).then(jsx => {
        if (jsx) {
          setSubCommandJSX(jsx);
        }
      });
    } else if (value === 'auto-resume') {
      handleSelectAutoResume();
    } else if (value === 'cancel-auto-resume') {
      handleCancelAutoResume();
    } else if (value === 'switch-model') {
      handleSelectSwitchModel();
    } else if (value === 'cancel') {
      handleCancel();
    }
  }

  if (subCommandJSX) {
    return subCommandJSX;
  }

  return (
    <Dialog title="What do you want to do?" onCancel={handleCancel} color="suggestion">
      <Select<RateLimitOptionsMenuOptionType>
        options={options}
        onChange={handleSelect}
        visibleOptionCount={options.length}
      />
    </Dialog>
  );
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <RateLimitOptionsMenu onDone={onDone} context={context} />;
}
