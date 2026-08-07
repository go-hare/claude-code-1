/**
 * densable 2.1.217 #16 — oauth-expiry warning (3-day window).
 * Surfaces: startup notification (`gYp` / `zYf`) when mAr() returns daysLeft.
 */
import { useStartupNotification } from './useStartupNotification.js';
import { formatLoginExpiryWarningText, getLoginExpiryWarning } from '../../utils/oauthLoginExpiry.js';

export function useOauthExpiryNotification(): void {
  useStartupNotification(() => {
    const warning = getLoginExpiryWarning();
    if (!warning) return null;
    return {
      key: 'oauth-expiry-warning',
      text: formatLoginExpiryWarningText(warning.daysLeft),
      color: 'warning' as const,
      priority: 'high' as const,
      // densable statusline path uses timeoutMs:15000 for daysLeft<=1; keep 15s for all
      timeoutMs: 15_000,
    };
  });
}
