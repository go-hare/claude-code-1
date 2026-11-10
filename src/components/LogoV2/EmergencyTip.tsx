import * as React from 'react';
import { useEffect, useMemo } from 'react';
import { Box, Text } from '@anthropic/ink';
import { getDynamicConfig_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js';

const CONFIG_NAME = 'tengu-top-of-feed-tip';

export function EmergencyTip(): React.ReactNode {
  const tip = useMemo(getTipOfFeed, []);
  // Memoize to prevent re-reads after we save - we want the value at mount time
  const lastShownTip = useMemo(() => getGlobalConfig().lastShownEmergencyTip, []);

  // Show if persistent or if this is a new/different tip
  const shouldShow = Boolean(tip.tip) && (tip.persistent === true || tip.tip !== lastShownTip);

  // Save the tip we're showing so we don't show it again (unless persistent)
  useEffect(() => {
    if (shouldShow && !tip.persistent) {
      saveGlobalConfig(current => {
        if (current.lastShownEmergencyTip === tip.tip) return current;
        return { ...current, lastShownEmergencyTip: tip.tip };
      });
    }
  }, [shouldShow, tip.tip, tip.persistent]);

  if (!shouldShow) {
    return null;
  }

  return (
    <Box paddingLeft={2} flexDirection="column">
      <Text
        {...(tip.color === 'warning'
          ? { color: 'warning' }
          : tip.color === 'error'
            ? { color: 'error' }
            : { dimColor: true })}
      >
        {tip.tip}
      </Text>
    </Box>
  );
}

type TipOfFeed = {
  tip: string;
  color?: 'dim' | 'warning' | 'error';
  persistent?: boolean;
};

const DEFAULT_TIP: TipOfFeed = { tip: '', color: 'dim' };

/**
 * Get the tip of the feed from dynamic config with caching
 * Returns cached value immediately, updates in background
 */
function getTipOfFeed(): TipOfFeed {
  return getDynamicConfig_CACHED_MAY_BE_STALE<TipOfFeed>(CONFIG_NAME, DEFAULT_TIP);
}

export function shouldShowEmergencyTip(): boolean {
  const tip = getTipOfFeed();
  if (!tip.tip) return false;
  return tip.persistent === true || tip.tip !== getGlobalConfig().lastShownEmergencyTip;
}
