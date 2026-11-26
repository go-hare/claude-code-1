import type * as React from 'react';
import { useCallback, useEffect } from 'react';
import { type AppState, useAppStateStore, useSetAppState } from '../state/AppState.js';
import { dismissToastItem, holdToastItem } from '../components/toastStore.js';
import { notificationsHoldToasts } from '../utils/replDiffMouseHost.js';
import { getActiveSessionFromAls, getBootstrapSession, RootSessionSlot, runWithSession } from '../utils/sessionHost.js';
import type { Theme } from '../utils/theme.js';

type Priority = 'low' | 'medium' | 'high' | 'immediate';

/** densable addNotification segment (idle-return-hint / contextual). */
export type NotificationSegment = {
  text: string;
  dim?: boolean;
  bold?: boolean;
  color?: keyof Theme;
  url?: string;
};

type BaseNotification = {
  key: string;
  /** densable kind: contextual | feedback | warning | … (metadata only). */
  kind?: string;
  /** densable toast source line. Not `kind`. */
  plugin?: string;
  /** densable Nu `u.pinned` — sticky list, not the toast slot. */
  pinned?: boolean;
  /** densable Ire `v.wrap` — wrap pinned notice instead of truncating. */
  wrap?: boolean;
  color?: keyof Theme;
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
  /**
   * densable `exemptFromDiffPanelHold` — toast may fire while `WJ`
   * (`diffPanelVisible`) holds the queue.
   */
  exemptFromDiffPanelHold?: boolean;
  /**
   * densable `heldDuringDiffPanel` — immediate toast queued while the
   * Obe panel latch is on; promoted when `auo` clears it.
   */
  heldDuringDiffPanel?: boolean;
  /** densable `requeueOnPreempt` — keep an immediate toast when preempted. */
  requeueOnPreempt?: boolean;
  /** densable toast record. `leaving` is the exit, not the end of a hover. */
  phase?: 'shown' | 'leaving';
  shownAt?: number;
  leavesAt?: number;
  heldAt?: number;
};

type TextNotification = BaseNotification & {
  text: string;
  color?: keyof Theme;
};

type JSXNotification = BaseNotification & {
  jsx: React.ReactNode;
};

type SegmentNotification = BaseNotification & {
  segments: NotificationSegment[];
};

type AddNotificationFn = (content: Notification) => void;
type RemoveNotificationFn = (key: string) => void;

export type Notification = TextNotification | JSXNotification | SegmentNotification;

const DEFAULT_TIMEOUT_MS = 8000;
/**
 * Official 2.1.328 (`chunk@307329163.js`): long-lived / sticky notices
 * (e.g. 24h quota-auto-resume or 24d idle upsell) yield to normal queued
 * notifications and requeue underneath instead of starving the slot.
 */
export const STICKY_NOTIFICATION_TIMEOUT_MS = 3_600_000;

// Track current timeout per root session to clear it when preempted or when the last consumer unmounts
type NotificationSessionState = {
  currentTimeoutId: NodeJS.Timeout | null;
  activeNotificationMounts: number;
};

const notificationSessionSlot = new RootSessionSlot<NotificationSessionState>(() => ({
  currentTimeoutId: null,
  activeNotificationMounts: 0,
}));

function getNotificationSessionState(): NotificationSessionState {
  return notificationSessionSlot.of(getBootstrapSession());
}

function clearNotificationTimeoutFor(state: NotificationSessionState): void {
  if (state.currentTimeoutId) {
    clearTimeout(state.currentTimeoutId);
    state.currentTimeoutId = null;
  }
}

function clearCurrentNotificationTimeout(): void {
  const state = notificationSessionSlot.peek(getBootstrapSession());
  if (state) clearNotificationTimeoutFor(state);
}

function scheduleCurrentNotificationTimeout(timeoutMs: number, callback: () => void): void {
  const state = getNotificationSessionState();
  clearNotificationTimeoutFor(state);
  const capturedSession = getActiveSessionFromAls();
  const id = setTimeout(() => {
    if (state.currentTimeoutId === id) {
      state.currentTimeoutId = null;
    }
    if (capturedSession !== undefined && getActiveSessionFromAls() !== capturedSession) {
      runWithSession(capturedSession, callback);
    } else {
      callback();
    }
  }, timeoutMs);
  state.currentTimeoutId = id;
  id.unref?.();
}

export function isStickyNotification(notice: Notification | null): boolean {
  return notice !== null && (notice.timeoutMs ?? DEFAULT_TIMEOUT_MS) >= STICKY_NOTIFICATION_TIMEOUT_MS;
}

/** densable `che(u,r)` — notification visible unless held and not exempt. */
export function isNotificationVisible(notice: Notification | null, hold: boolean): notice is Notification {
  return notice !== null && (!hold || notice.exemptFromDiffPanelHold === true);
}

/** densable `p(u,r)` — keep preempted toast unless immediate without hold/requeue. */
export function shouldRequeueOnPreempt(existing: Notification, incoming: Notification): boolean {
  return (
    (existing.priority !== 'immediate' ||
      existing.requeueOnPreempt === true ||
      existing.heldDuringDiffPanel === true) &&
    !incoming.invalidates?.includes(existing.key)
  );
}

function processNotificationQueue(setAppState: (updater: (prev: AppState) => AppState) => void): void {
  setAppState(prev => {
    if (!prev?.notifications) return prev;
    // densable `WJ` — while Obe is mounted, only exempt toasts dequeue.
    const pool = notificationsHoldToasts(prev)
      ? prev.notifications.queue.filter(n => n.exemptFromDiffPanelHold)
      : prev.notifications.queue;
    const nonStickyPool = pool.filter(n => !isStickyNotification(n));
    const next = getNext(nonStickyPool) ?? getNext(pool);
    if (!next) {
      return prev;
    }
    const current = prev.notifications.current;
    const canPreemptForHeldImmediate =
      current !== null &&
      next.priority === 'immediate' &&
      next.heldDuringDiffPanel === true &&
      current.priority !== 'immediate';
    const canPreemptStickyCurrent = current !== null && isStickyNotification(current) && !isStickyNotification(next);
    const requeueCurrent = canPreemptForHeldImmediate || canPreemptStickyCurrent ? current : null;
    if (current !== null && requeueCurrent === null) {
      return prev;
    }

    const nextKey = next.key;
    scheduleCurrentNotificationTimeout(next.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
      setAppState(p => {
        if (!p?.notifications) return p;
        // Compare by key instead of reference to handle re-created notifications
        if (p.notifications.current?.key !== nextKey) {
          return p;
        }
        return {
          ...p,
          notifications: withPinned(p.notifications, {
            queue: p.notifications.queue,
            current: null,
          }),
        };
      });
      processNotificationQueue(setAppState);
    });

    return {
      ...prev,
      notifications: withPinned(prev.notifications, {
        queue: [
          ...(requeueCurrent !== null && shouldRequeueOnPreempt(requeueCurrent, next) ? [requeueCurrent] : []),
          ...prev.notifications.queue.filter(_ => _ !== next),
        ],
        current: next.heldDuringDiffPanel ? { ...next, heldDuringDiffPanel: undefined } : next,
      }),
    };
  });
}

/**
 * Enqueue one or more non-immediate notifications from outside React (e.g.
 * SessionEnd hook failure reporting in hooks.ts) and drain the queue with a
 * proper dismissal timer so `notifications.current` is never frozen forever.
 */
export function enqueueNotificationsOutsideReact(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  items: readonly Notification[],
): void {
  if (items.length === 0) return;
  for (const notif of items) {
    setAppState(prev => {
      if (!prev?.notifications) return prev;
      const applied = applyNonImmediateNotification(prev.notifications, notif);
      if (applied.timeoutAction !== 'none') {
        clearCurrentNotificationTimeout();
        if (applied.timeoutAction === 'reset' && applied.notifications.current) {
          const shown = applied.notifications.current;
          scheduleCurrentNotificationTimeout(shown.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
            setAppState(p => {
              if (!p?.notifications || p.notifications.current?.key !== shown.key) {
                return p;
              }
              return {
                ...p,
                notifications: withPinned(p.notifications, {
                  queue: p.notifications.queue,
                  current: null,
                }),
              };
            });
            processNotificationQueue(setAppState);
          });
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
  }
  processNotificationQueue(setAppState);
}

export function useNotifications(): {
  addNotification: AddNotificationFn;
  removeNotification: RemoveNotificationFn;
  processQueue: () => void;
  holdToast: (key: string, held: boolean) => void;
  dismissToast: (key: string) => void;
  patchNotification: (key: string, patch: Partial<Notification>) => void;
} {
  const store = useAppStateStore();
  const setAppState = useSetAppState();

  // Process queue when current notification finishes or queue changes
  const processQueue = useCallback(() => {
    processNotificationQueue(setAppState);
  }, [setAppState]);

  const addNotification = useCallback<AddNotificationFn>(
    (notif: Notification) => {
      // densable Nu: pinned notices occupy the dedicated list, not current/queue.
      if (notif.pinned) {
        setAppState(prev => {
          if (prev.notifications.pinned.some(n => n.key === notif.key)) {
            return prev;
          }
          return {
            ...prev,
            notifications: {
              ...prev.notifications,
              pinned: [...prev.notifications.pinned, notif],
            },
          };
        });
        return;
      }

      // Handle immediate priority notifications
      if (notif.priority === 'immediate') {
        // densable `!WJ` — Obe latch queues immediate as heldDuringDiffPanel.
        if (notificationsHoldToasts(store.getState())) {
          const held = { ...notif, heldDuringDiffPanel: true };
          setAppState(prev => {
            const applied = applyNonImmediateNotification(prev.notifications, held);
            if (
              applied.notifications.current === prev.notifications.current &&
              applied.notifications.queue === prev.notifications.queue
            ) {
              return prev;
            }
            return { ...prev, notifications: applied.notifications };
          });
          processQueue();
          return;
        }

        // Clear any existing timeout and set up timeout for the immediate notification
        scheduleCurrentNotificationTimeout(notif.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
          setAppState(prev => {
            // Compare by key instead of reference to handle re-created notifications
            if (prev.notifications.current?.key !== notif.key) {
              return prev;
            }
            return {
              ...prev,
              notifications: withPinned(prev.notifications, {
                queue: prev.notifications.queue.filter(_ => !notif.invalidates?.includes(_.key)),
                current: null,
              }),
            };
          });
          processQueue();
        });

        // Show the immediate notification right away
        setAppState(prev => ({
          ...prev,
          notifications: withPinned(prev.notifications, {
            current: notif,
            queue: [
              ...(prev.notifications.current ? [prev.notifications.current] : []),
              ...prev.notifications.queue,
            ].filter(_ => shouldRequeueOnPreempt(_, notif)),
          }),
        }));
        return; // IMPORTANT: Exit addNotification for immediate notifications
      }

      // Handle non-immediate notifications
      setAppState(prev => {
        const applied = applyNonImmediateNotification(prev.notifications, notif);
        if (applied.timeoutAction !== 'none') {
          clearCurrentNotificationTimeout();
          if (applied.timeoutAction === 'reset' && applied.notifications.current) {
            const shown = applied.notifications.current;
            scheduleCurrentNotificationTimeout(shown.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
              setAppState(p => {
                if (p.notifications.current?.key !== shown.key) {
                  return p;
                }
                return {
                  ...p,
                  notifications: withPinned(p.notifications, {
                    queue: p.notifications.queue,
                    current: null,
                  }),
                };
              });
              processQueue();
            });
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
    [setAppState, processQueue, store],
  );

  const removeNotification = useCallback<RemoveNotificationFn>(
    (key: string) => {
      setAppState(prev => {
        const isCurrent = prev.notifications.current?.key === key;
        const inQueue = prev.notifications.queue.some(n => n.key === key);
        const inPinned = prev.notifications.pinned.some(n => n.key === key);

        if (!isCurrent && !inQueue && !inPinned) {
          return prev;
        }

        if (isCurrent) {
          clearCurrentNotificationTimeout();
        }

        return {
          ...prev,
          notifications: {
            current: isCurrent ? null : prev.notifications.current,
            queue: prev.notifications.queue.filter(n => n.key !== key),
            pinned: prev.notifications.pinned.filter(n => n.key !== key),
          },
        };
      });

      processQueue();
    },
    [setAppState, processQueue],
  );

  // Process queue on mount if there are notifications in the initial state,
  // and clear the active dismissal timer when the last consumer unmounts.
  // Imperative read (not useAppState) — a subscription in a mount-only
  // effect would be vestigial and make every caller re-render on queue changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const state = getNotificationSessionState();
    state.activeNotificationMounts += 1;
    if (store.getState().notifications.queue.length > 0) {
      processQueue();
    }
    return () => {
      state.activeNotificationMounts = Math.max(0, state.activeNotificationMounts - 1);
      if (state.activeNotificationMounts === 0) {
        clearNotificationTimeoutFor(state);
      }
    };
  }, []);

  const patchNotification = useCallback(
    (key: string, patch: Partial<Notification>) => {
      setAppState(prev => {
        const apply = (notice: Notification | null): Notification | null =>
          notice?.key === key ? { ...notice, ...patch } : notice;
        return {
          ...prev,
          notifications: {
            ...prev.notifications,
            current: apply(prev.notifications.current),
            queue: prev.notifications.queue.map(notice => apply(notice) ?? notice),
          },
        };
      });
    },
    [setAppState],
  );

  /** The drawn toast is the store record, not the notification queue. */
  const holdToast = useCallback((key: string, held: boolean) => {
    holdToastItem(key, held);
  }, []);

  const dismissToast = useCallback((key: string) => {
    dismissToastItem(key);
  }, []);

  return { addNotification, removeNotification, processQueue, holdToast, dismissToast, patchNotification };
}

const PRIORITIES: Record<Priority, number> = {
  immediate: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** densable `eDt` — priority order for pinned notifications. */
export function compareNotificationPriority(a: Notification, b: Notification): number {
  return PRIORITIES[a.priority] - PRIORITIES[b.priority];
}
export function getNext(queue: Notification[]): Notification | undefined {
  if (queue.length === 0) return undefined;
  return queue.reduce((min, n) => (PRIORITIES[n.priority] < PRIORITIES[min.priority] ? n : min));
}

export type NotificationsBucket = {
  current: Notification | null;
  queue: Notification[];
  /** densable Nu `pinned[]` — RXc list. Idle hint is NOT pinned. */
  pinned: Notification[];
};

function withPinned(
  state: NotificationsBucket,
  next: { current: Notification | null; queue: Notification[] },
): NotificationsBucket {
  return {
    pinned: state.pinned ?? [],
    current: next.current,
    queue: next.queue,
  };
}

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
        notifications: withPinned(state, {
          current: folded,
          queue: state.queue,
        }),
        timeoutAction: 'reset',
      };
    }
    const foldIdx = state.queue.findIndex(_ => _.key === notif.key);
    if (foldIdx !== -1) {
      const folded = notif.fold(state.queue[foldIdx]!, notif);
      const newQueue = [...state.queue];
      newQueue[foldIdx] = folded;
      return {
        notifications: withPinned(state, {
          current: state.current,
          queue: newQueue,
        }),
        timeoutAction: 'none',
      };
    }
  }

  // Replace same-key notification with latest content (matching JSDoc above)
  // so status toasts (quota-auto-resume, MCP connectivity, settings errors,
  // effort/ultracode) reflect fresh copy instead of freezing on first emit.
  if (state.current?.key === notif.key) {
    return {
      notifications: withPinned(state, {
        current: notif,
        queue: state.queue,
      }),
      timeoutAction: 'reset',
    };
  }
  const existingIdx = state.queue.findIndex(_ => _.key === notif.key);
  if (existingIdx !== -1) {
    const newQueue = [...state.queue];
    newQueue[existingIdx] = notif;
    return {
      notifications: withPinned(state, {
        current: state.current,
        queue: newQueue,
      }),
      timeoutAction: 'none',
    };
  }

  const invalidatesCurrent = state.current !== null && notif.invalidates?.includes(state.current.key);

  return {
    notifications: withPinned(state, {
      current: invalidatesCurrent ? null : state.current,
      queue: [...state.queue.filter(_ => shouldRequeueOnPreempt(_, notif)), notif],
    }),
    // Invalidate clears the current toast timeout; processQueue will arm the next.
    timeoutAction: invalidatesCurrent ? 'clear' : 'none',
  };
}
