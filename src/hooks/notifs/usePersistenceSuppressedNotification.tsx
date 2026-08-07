/**
 * densable 2.1.217 #2 — nei / gIf startup warning when transcript saving is off.
 * Causes: skip_prompt_history | nested_marker (user-visible Gsn subset).
 */
import { useEffect } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import {
  formatPersistenceSuppressedNotificationText,
  getUserVisiblePersistenceSuppressCause,
} from 'src/utils/sessionPersistenceStatus.js';
import { useStartupNotification } from './useStartupNotification.js';

export function usePersistenceSuppressedNotification(): void {
  const cause = getUserVisiblePersistenceSuppressCause();

  useEffect(() => {
    if (cause === null) return;
    logEvent('tengu_persistence_suppressed', {
      cause: cause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
  }, [cause]);

  useStartupNotification(() => {
    if (cause === null) return null;
    return {
      key: 'persistence-suppressed',
      text: formatPersistenceSuppressedNotificationText(cause),
      color: 'warning' as const,
      priority: 'high' as const,
      // densable pinned notice — keep visible longer than default
      timeoutMs: 20_000,
    };
  });
}
