import type * as React from 'react';
import { useCallback, useEffect } from 'react';
import { useAppStateStore, useSetAppState } from '../state/AppState.js';
import type { Theme } from '../utils/theme.js';

type Priority = 'low' | 'medium' | 'high' | 'immediate';

type BaseNotification = {
  key: string;
  /**
   * Keys of notifications that this notification invalidates.
   * If a notification is invalidated, it will be removed from the queue
   * and, if currently displayed, cleared immediately.
   */
  invalidates?: string[];
  priority: Priority;
  timeoutMs?: number;
  /**
   * Combine notifications with the same key, like Array.reduce().
   * Called as fold(accumulator, incoming) when a notification with a matching
   * key already exists in the queue or is currently displayed.
   * Returns the merged notification (should carry fold forward for future merges).
   */
  fold?: (accumulator: Notification, incoming: Notification) => Notification;
};

type TextNotification = BaseNotification & {
  text: string;
  color?: keyof Theme;
};

type JSXNotification = BaseNotification & {
  jsx: React.ReactNode;
};

type AddNotificationFn = (content: Notification) => void;
type RemoveNotificationFn = (key: string) => void;

export type Notification = TextNotification | JSXNotification;

const DEFAULT_TIMEOUT_MS = 8000;

// Track current timeout to clear it when immediate notifications arrive
let currentTimeoutId: NodeJS.Timeout | null = null;

export function useNotifications(): {
  addNotification: AddNotificationFn;
  removeNotification: RemoveNotificationFn;
} {
  const store = useAppStateStore();
  const setAppState = useSetAppState();

  // Process queue when current notification finishes or queue changes
  const processQueue = useCallback(() => {
    setAppState(prev => {
      const next = getNext(prev.notifications.queue);
      if (prev.notifications.current !== null || !next) {
        return prev;
      }

      currentTimeoutId = setTimeout(
        (setAppState, nextKey, processQueue) => {
          currentTimeoutId = null;
          setAppState(prev => {
            // Compare by key instead of reference to handle re-created notifications
            if (prev.notifications.current?.key !== nextKey) {
              return prev;
            }
            return {
              ...prev,
              notifications: {
                queue: prev.notifications.queue,
                current: null,
              },
            };
          });
          processQueue();
        },
        next.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        setAppState,
        next.key,
        processQueue,
      );

      return {
        ...prev,
        notifications: {
          queue: prev.notifications.queue.filter(_ => _ !== next),
          current: next,
        },
      };
    });
  }, [setAppState]);

  const addNotification = useCallback<AddNotificationFn>(
    (notif: Notification) => {
      // Handle immediate priority notifications
      if (notif.priority === 'immediate') {
        // Clear any existing timeout since we're showing a new immediate notification
        if (currentTimeoutId) {
          clearTimeout(currentTimeoutId);
          currentTimeoutId = null;
        }

        // Set up timeout for the immediate notification
        currentTimeoutId = setTimeout(
          (setAppState, notif, processQueue) => {
            currentTimeoutId = null;
            setAppState(prev => {
              // Compare by key instead of reference to handle re-created notifications
              if (prev.notifications.current?.key !== notif.key) {
                return prev;
              }
              return {
                ...prev,
                notifications: {
                  queue: prev.notifications.queue.filter(_ => !notif.invalidates?.includes(_.key)),
                  current: null,
                },
              };
            });
            processQueue();
          },
          notif.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          setAppState,
          notif,
          processQueue,
        );

        // Show the immediate notification right away
        setAppState(prev => ({
          ...prev,
          notifications: {
            current: notif,
            queue:
              // Only re-queue the current notification if it's not immediate
              [...(prev.notifications.current ? [prev.notifications.current] : []), ...prev.notifications.queue].filter(
                _ => _.priority !== 'immediate' && !notif.invalidates?.includes(_.key),
              ),
          },
        }));
        return; // IMPORTANT: Exit addNotification for immediate notifications
      }

      // Handle non-immediate notifications
      setAppState(prev => {
        const applied = applyNonImmediateNotification(prev.notifications, notif);
        if (applied.timeoutAction !== 'none') {
          if (currentTimeoutId) {
            clearTimeout(currentTimeoutId);
            currentTimeoutId = null;
          }
          if (applied.timeoutAction === 'reset' && applied.notifications.current) {
            const shown = applied.notifications.current;
            currentTimeoutId = setTimeout(
              (setAppState, key, processQueue) => {
                currentTimeoutId = null;
                setAppState(p => {
                  if (p.notifications.current?.key !== key) {
                    return p;
                  }
                  return {
                    ...p,
                    notifications: {
                      queue: p.notifications.queue,
                      current: null,
                    },
                  };
                });
                processQueue();
              },
              shown.timeoutMs ?? DEFAULT_TIMEOUT_MS,
              setAppState,
              shown.key,
              processQueue,
            );
          }
        }
        if (
          applied.notifications.current === prev.notifications.current &&
          applied.notifications.queue === prev.notifications.queue
        ) {
          return prev;
        }
        return {
          ...prev,
          notifications: applied.notifications,
        };
      });

      // Process queue after adding the notification
      processQueue();
    },
    [setAppState, processQueue],
  );

  const removeNotification = useCallback<RemoveNotificationFn>(
    (key: string) => {
      setAppState(prev => {
        const isCurrent = prev.notifications.current?.key === key;
        const inQueue = prev.notifications.queue.some(n => n.key === key);

        if (!isCurrent && !inQueue) {
          return prev;
        }

        if (isCurrent && currentTimeoutId) {
          clearTimeout(currentTimeoutId);
          currentTimeoutId = null;
        }

        return {
          ...prev,
          notifications: {
            current: isCurrent ? null : prev.notifications.current,
            queue: prev.notifications.queue.filter(n => n.key !== key),
          },
        };
      });

      processQueue();
    },
    [setAppState, processQueue],
  );

  // Process queue on mount if there are notifications in the initial state.
  // Imperative read (not useAppState) — a subscription in a mount-only
  // effect would be vestigial and make every caller re-render on queue changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (store.getState().notifications.queue.length > 0) {
      processQueue();
    }
  }, []);

  return { addNotification, removeNotification };
}

const PRIORITIES: Record<Priority, number> = {
  immediate: 0,
  high: 1,
  medium: 2,
  low: 3,
};
export function getNext(queue: Notification[]): Notification | undefined {
  if (queue.length === 0) return undefined;
  return queue.reduce((min, n) => (PRIORITIES[n.priority] < PRIORITIES[min.priority] ? n : min));
}

export type NotificationsBucket = {
  current: Notification | null;
  queue: Notification[];
};

/**
 * Pure merge for non-immediate addNotification.
 * Same key on current/queue is replaced (latest text wins) so effort/ultracode
 * toasts update while a prior toast with the same key is still visible.
 */
export function applyNonImmediateNotification(
  state: NotificationsBucket,
  notif: Notification,
): {
  notifications: NotificationsBucket;
  /** none | clear existing current timeout | clear + schedule for new current */
  timeoutAction: 'none' | 'clear' | 'reset';
} {
  // Check if we can fold into an existing notification with the same key
  if (notif.fold) {
    if (state.current?.key === notif.key) {
      const folded = notif.fold(state.current, notif);
      return {
        notifications: {
          current: folded,
          queue: state.queue,
        },
        timeoutAction: 'reset',
      };
    }
    const foldIdx = state.queue.findIndex(_ => _.key === notif.key);
    if (foldIdx !== -1) {
      const folded = notif.fold(state.queue[foldIdx]!, notif);
      const newQueue = [...state.queue];
      newQueue[foldIdx] = folded;
      return {
        notifications: {
          current: state.current,
          queue: newQueue,
        },
        timeoutAction: 'none',
      };
    }
  }

  // Same key already displayed: replace content (caller resets timeout).
  if (state.current?.key === notif.key) {
    return {
      notifications: {
        current: notif,
        queue: state.queue.filter(_ => _.key !== notif.key),
      },
      timeoutAction: 'reset',
    };
  }

  // Same key already queued: replace the queued entry (latest wins).
  const queueIdx = state.queue.findIndex(_ => _.key === notif.key);
  if (queueIdx !== -1) {
    const newQueue = [...state.queue];
    newQueue[queueIdx] = notif;
    return {
      notifications: {
        current: state.current,
        queue: newQueue,
      },
      timeoutAction: 'none',
    };
  }

  const invalidatesCurrent = state.current !== null && notif.invalidates?.includes(state.current.key);

  return {
    notifications: {
      current: invalidatesCurrent ? null : state.current,
      queue: [...state.queue.filter(_ => _.priority !== 'immediate' && !notif.invalidates?.includes(_.key)), notif],
    },
    // Invalidate clears the current toast timeout; processQueue will arm the next.
    timeoutAction: invalidatesCurrent ? 'clear' : 'none',
  };
}
