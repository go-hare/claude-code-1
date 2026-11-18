import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js';
import { isUsageCreditsHintEnabled } from '../../services/rateLimitMessages.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getClaudeAIOAuthTokens, getOauthAccountInfo, isClaudeAISubscriber } from '../../utils/auth.js';
import { openBrowser } from '../../utils/browser.js';
import { logError } from '../../utils/log.js';
import { Login } from '../login/login.js';

function buildUpgradeUrl(campaign: string): string {
  return `https://claude.ai/upgrade/max?utm_source=claude_code&utm_medium=cli&utm_campaign=${campaign}`;
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode | null> {
  const url = buildUpgradeUrl('upgrade_command');
  try {
    // Check if user is already on the highest Max plan (20x)
    if (isClaudeAISubscriber()) {
      const tokens = getClaudeAIOAuthTokens();
      let isMax20x = false;

      if (tokens?.subscriptionType && tokens?.rateLimitTier) {
        isMax20x = tokens.subscriptionType === 'max' && tokens.rateLimitTier === 'default_claude_max_20x';
      } else if (tokens?.accessToken) {
        const profile = await getOauthProfileFromOauthToken(tokens.accessToken);
        isMax20x =
          profile?.organization?.organization_type === 'claude_max' &&
          profile?.organization?.rate_limit_tier === 'default_claude_max_20x';
      }

      if (isMax20x) {
        const usageCreditsCommand = isUsageCreditsHintEnabled() ? '/usage-credits' : undefined;
        setTimeout(
          onDone,
          0,
          usageCreditsCommand
            ? `You’re already on the highest Max subscription plan. For additional usage, run ${usageCreditsCommand}.`
            : 'You are already on the highest Max subscription plan. For additional usage, run /login to switch to an API usage-billed account.',
        );
        return null;
      }
    }

    const billingType = getOauthAccountInfo()?.billingType;
    if (
      isClaudeAISubscriber() &&
      (billingType === 'apple_subscription' || billingType === 'google_play_subscription')
    ) {
      const usageCreditsCommand = isUsageCreditsHintEnabled() ? '/usage-credits' : undefined;
      const baseMessage =
        billingType === 'apple_subscription'
          ? 'Your plan is billed through the App Store. To change it, open Claude for iOS and go to Settings → Billing. After you change it, run /login here so the new plan takes effect.'
          : 'Your plan is billed through Google Play. To change it, open Claude for Android and go to Settings. After you change it, run /login here so the new plan takes effect.';
      setTimeout(
        onDone,
        0,
        usageCreditsCommand ? `${baseMessage} For additional usage now, run ${usageCreditsCommand}.` : baseMessage,
      );
      return null;
    }

    await openBrowser(url);

    return (
      <Login
        startingMessage={'Starting new login following /upgrade. Exit with Ctrl-C to use existing account.'}
        onDone={success => {
          context.onChangeAPIKey();
          onDone(success ? 'Login successful' : 'Login interrupted');
        }}
      />
    );
  } catch (error) {
    logError(error as Error);
    setTimeout(onDone, 0, `Failed to open browser. Please visit ${url} to upgrade.`);
  }
  return null;
}
