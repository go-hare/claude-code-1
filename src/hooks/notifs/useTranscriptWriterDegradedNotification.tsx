/**
 * densable 2.1.217 #2 — oei / SIf live warning when transcript writes fail.
 * Subscribes densable FUe store (wUs) and shows high-priority notice.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import {
  formatTranscriptWriterDegradedNotificationText,
  getTranscriptWriterDegraded,
  subscribeTranscriptWriterHealth,
} from 'src/utils/transcriptWriterHealth.js';

const NOTIF_KEY = 'transcript-writer-degraded';

export function useTranscriptWriterDegradedNotification(): void {
  const { addNotification, removeNotification } = useNotifications();
  const degraded = useSyncExternalStore(
    subscribeTranscriptWriterHealth,
    getTranscriptWriterDegraded,
    getTranscriptWriterDegraded,
  );

  useEffect(() => {
    if (degraded === null) {
      removeNotification(NOTIF_KEY);
      return;
    }
    addNotification({
      key: NOTIF_KEY,
      text: formatTranscriptWriterDegradedNotificationText(degraded),
      color: 'warning',
      priority: 'high',
      // stay until recovered or replaced
      timeoutMs: 60_000,
    });
  }, [degraded, addNotification, removeNotification]);
}
