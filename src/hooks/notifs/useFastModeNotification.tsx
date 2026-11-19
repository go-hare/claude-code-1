import { useEffect, useRef } from 'react';
import { type Notification, useNotifications } from 'src/context/notifications.js';
import { getOpus48FastModeDeprecationNotice } from 'src/services/api/withRetry.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import {
  type CooldownReason,
  isFastModeEnabled,
  onCooldownExpired,
  onCooldownTriggered,
  onFastModeOverageRejection,
  onOrgFastModeChanged,
} from 'src/utils/fastMode.js';
import { formatDuration } from 'src/utils/format.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';

const COOLDOWN_STARTED_KEY = 'fast-mode-cooldown-started';
const COOLDOWN_EXPIRED_KEY = 'fast-mode-cooldown-expired';
const ORG_CHANGED_KEY = 'fast-mode-org-changed';
const OVERAGE_REJECTED_KEY = 'fast-mode-overage-rejected';

/**
 * Official 2.1.316 `Auo` (#1479): surface Opus 4.8 fast mode deprecation notice
 * when fast mode is enabled on Opus 4.8 before `tengu_sunset_penguin_opus48`.
 */
export function maybeNotifyOpus48FastModeDeprecation(
  model: string | null | undefined,
  isFastMode: boolean,
  addNotification: (notice: Notification) => void,
  nowMs?: number,
): boolean {
  if (!isFastMode || !model) {
    return false;
  }
  const notice = getOpus48FastModeDeprecationNotice(model, nowMs);
  if (!notice) {
    return false;
  }
  addNotification(notice);
  return true;
}

export function useFastModeNotification(mainLoopModel?: string): void {
  const { addNotification } = useNotifications();
  const isFastMode = useAppState(s => s.fastMode);
  const stateMainLoopModel = useAppState(s => s.mainLoopModel);
  const effectiveModel = mainLoopModel ?? stateMainLoopModel;
  const setAppState = useSetAppState();
  const lastOpus48NoticeModelRef = useRef<string | null>(null);

  // #1479: Notify when Opus 4.8 fast mode is enabled before sunset removal date
  useEffect(() => {
    if (getIsRemoteMode()) return;
    if (!isFastMode || !effectiveModel) {
      lastOpus48NoticeModelRef.current = null;
      return;
    }
    if (lastOpus48NoticeModelRef.current === effectiveModel) {
      return;
    }
    if (maybeNotifyOpus48FastModeDeprecation(effectiveModel, isFastMode, addNotification)) {
      lastOpus48NoticeModelRef.current = effectiveModel;
    }
  }, [addNotification, effectiveModel, isFastMode]);

  // Notify when org fast mode status changes
  useEffect(() => {
    if (getIsRemoteMode()) return;
    if (!isFastModeEnabled()) {
      return;
    }

    return onOrgFastModeChanged(orgEnabled => {
      if (orgEnabled) {
        addNotification({
          key: ORG_CHANGED_KEY,
          color: 'fastMode',
          priority: 'immediate',
          text: 'Fast mode is now available · /fast to turn on',
        });
      } else if (isFastMode) {
        // Org disabled fast mode — permanently turn off fast mode
        setAppState(prev => ({ ...prev, fastMode: false }));
        addNotification({
          key: ORG_CHANGED_KEY,
          color: 'warning',
          priority: 'immediate',
          text: 'Fast mode has been disabled by your organization',
        });
      }
    });
  }, [addNotification, isFastMode, setAppState]);

  // Notify when fast mode is rejected due to overage/extra usage issues
  useEffect(() => {
    if (getIsRemoteMode()) return;
    if (!isFastModeEnabled()) return;

    return onFastModeOverageRejection(message => {
      setAppState(prev => ({ ...prev, fastMode: false }));
      addNotification({
        key: OVERAGE_REJECTED_KEY,
        kind: 'feedback',
        color: 'error',
        priority: 'immediate',
        text: message,
      });
    });
  }, [addNotification, setAppState]);

  useEffect(() => {
    if (getIsRemoteMode()) return;
    if (!isFastMode) {
      return;
    }

    const unsubTriggered = onCooldownTriggered((resetAt, reason) => {
      const resetIn = formatDuration(resetAt - Date.now(), {
        hideTrailingZeros: true,
      });
      const message = getCooldownMessage(reason, resetIn);
      addNotification({
        key: COOLDOWN_STARTED_KEY,
        invalidates: [COOLDOWN_EXPIRED_KEY],
        text: message,
        color: 'warning',
        priority: 'immediate',
      });
    });
    const unsubExpired = onCooldownExpired(() => {
      addNotification({
        key: COOLDOWN_EXPIRED_KEY,
        invalidates: [COOLDOWN_STARTED_KEY],
        color: 'fastMode',
        text: `Fast limit reset · now using fast mode`,
        priority: 'immediate',
      });
    });
    return () => {
      unsubTriggered();
      unsubExpired();
    };
  }, [addNotification, isFastMode]);
}

function getCooldownMessage(reason: CooldownReason, resetIn: string): string {
  switch (reason) {
    case 'overloaded':
      return `Fast mode overloaded and is temporarily unavailable · resets in ${resetIn}`;
    case 'rate_limit':
      return `Fast limit reached and temporarily disabled · resets in ${resetIn}`;
  }
}
