import type * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
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
  /**
   * densable ylr / token-warning: still render while DiffPanel is open.
   */
  exemptFromDiffPanelHold?: boolean;
  /**
   * densable heldDuringDiffPanel: immediate was deferred because DiffPanel was
   * open; when promoted after hold, the flag is cleared.
   */
  heldDuringDiffPanel?: boolean;
  /**
   * densable mks/requeueOnPreempt: allow an immediate notification to be
   * re-queued when preempted by another immediate (or held immediate).
   */
  requeueOnPreempt?: boolean;
  /**
   * densable pinned: sticky notice outside the transient queue (e.g.
   * launch-prompt-warning). Not subject to DiffPanel hold or timeouts.
   */
  pinned?: boolean;
  /**
   * densable kind: metadata for producers (warning/hint/event/feedback).
   * Not used by queue/filter logic; optional for densable parity.
   */
  kind?: 'warning' | 'hint' | 'event' | 'feedback';
};

/** densable notifications state shape (current + queue + pinned). */
export type NotificationsState = {
  current: Notification | null;
  queue: Notification[];
  pinned: Notification[];
};

/**
 * densable glr: remove a key from current / queue / pinned.
 * Returns the same object when nothing matched.
 */
export function removeNotificationFromState(
  state: NotificationsState,
  key: string,
): NotificationsState {
  const isCurrent = state.current?.key === key;
  const inQueue = state.queue.some(n => n.key === key);
  const inPinned = state.pinned.some(n => n.key === key);
  if (!isCurrent && !inQueue && !inPinned) return state;
  return {
    current: isCurrent ? null : state.current,
    queue: state.queue.filter(n => n.key !== key),
    pinned: inPinned ? state.pinned.filter(n => n.key !== key) : state.pinned,
  };
}

/** densable D0b: higher priority first for pinned list sort. */
export function compareNotificationPriority(
  a: Notification,
  b: Notification,
): number {
  return PRIORITIES[a.priority] - PRIORITIES[b.priority];
}

// PRIORITIES forward-declared via const below — hoist rank table for helpers.
const PRIORITIES: Record<Priority, number> = {
  immediate: 0,
  high: 1,
  medium: 2,
  low: 3,
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
type ProcessQueueFn = () => void;

export type Notification = TextNotification | JSXNotification;

const DEFAULT_TIMEOUT_MS = 8000;

// Track current timeout to clear it when immediate notifications arrive
let currentTimeoutId: NodeJS.Timeout | null = null;

/**
 * densable ylr: whether a current notification should paint while DiffPanel
 * may be holding the footer.
 */
export function isNotificationVisibleDuringDiffPanel(current: Notification | null, diffPanelVisible: boolean): boolean {
  return current !== null && (!diffPanelVisible || current.exemptFromDiffPanelHold === true);
}

/**
 * densable mks: keep existing entry when preempted (unless invalidated).
 * Immediate entries requeue only with requeueOnPreempt or heldDuringDiffPanel.
 */
export function shouldRequeueOnPreempt(existing: Notification, incoming: Notification): boolean {
  return (
    (existing.priority !== 'immediate' ||
      existing.requeueOnPreempt === true ||
      existing.heldDuringDiffPanel === true) &&
    !incoming.invalidates?.includes(existing.key)
  );
}

/** densable processQueue candidate set when DiffPanel is open. */
export function queueForDiffPanel(queue: Notification[], diffPanelVisible: boolean): Notification[] {
  if (!diffPanelVisible) return queue;
  return queue.filter(n => n.exemptFromDiffPanelHold === true);
}

function scheduleClearCurrent(
  setAppState: ReturnType<typeof useSetAppState>,
  key: string,
  processQueue: ProcessQueueFn,
  timeoutMs: number | undefined,
  /** densable immediate-path timeout also drops invalidated queue keys. */
  invalidates?: string[],
): void {
  currentTimeoutId = setTimeout(
    (setAppStateArg, nextKey, processQueueArg, invalidateKeys: string[] | undefined) => {
      currentTimeoutId = null;
      setAppStateArg(prev => {
        if (prev.notifications.current?.key !== nextKey) {
          return prev;
        }
        const nextQueue =
          invalidateKeys && invalidateKeys.length > 0
            ? prev.notifications.queue.filter(n => !invalidateKeys.includes(n.key))
            : prev.notifications.queue;
        return {
          ...prev,
          notifications: {
            ...prev.notifications,
            queue: nextQueue,
            current: null,
          },
        };
      });
      processQueueArg();
    },
    timeoutMs ?? DEFAULT_TIMEOUT_MS,
    setAppState,
    key,
    processQueue,
    invalidates,
  );
}

export function useNotifications(): {
  addNotification: AddNotificationFn;
  removeNotification: RemoveNotificationFn;
  processQueue: ProcessQueueFn;
} {
  const store = useAppStateStore();
  const setAppState = useSetAppState();
  const prevDiffPanelVisible = useRef(store.getState().diffPanelVisible);

  // Process queue when current notification finishes or queue changes
  const processQueue = useCallback(() => {
    setAppState(prev => {
      const candidates = queueForDiffPanel(prev.notifications.queue, prev.diffPanelVisible);
      const next = getNext(candidates);
      if (!next) {
        return prev;
      }

      // densable: only preempt a non-immediate current with a held immediate
      const requeuedCurrent =
        prev.notifications.current !== null &&
        next.priority === 'immediate' &&
        next.heldDuringDiffPanel === true &&
        prev.notifications.current.priority !== 'immediate'
          ? prev.notifications.current
          : null;
      if (prev.notifications.current !== null && requeuedCurrent === null) {
        return prev;
      }

      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }

      const nextKey = next.key;
      scheduleClearCurrent(
        setAppState,
        nextKey,
        processQueue,
        next.timeoutMs,
        next.invalidates,
      );

      const restQueue = prev.notifications.queue.filter(_ => _ !== next);
      const withRequeued =
        requeuedCurrent !== null && shouldRequeueOnPreempt(requeuedCurrent, next)
          ? [requeuedCurrent, ...restQueue]
          : restQueue;

      const current: Notification = next.heldDuringDiffPanel ? { ...next, heldDuringDiffPanel: undefined } : next;

      return {
        ...prev,
        notifications: {
          ...prev.notifications,
          queue: withRequeued,
          current,
        },
      };
    });
  }, [setAppState]);

  const addNotification = useCallback<AddNotificationFn>(
    (notif: Notification) => {
      // densable: pinned notices go to sticky list (no timeout / DiffPanel hold).
      // Same-key re-add replaces content so producers (Pqo) can refresh jsx
      // when launchWarning length/type changes without clearing first.
      if (notif.pinned) {
        setAppState(prev => {
          const pinned = prev.notifications.pinned ?? [];
          const idx = pinned.findIndex(n => n.key === notif.key);
          if (idx !== -1) {
            if (pinned[idx] === notif) return prev;
            const nextPinned = [...pinned];
            nextPinned[idx] = notif;
            return {
              ...prev,
              notifications: {
                ...prev.notifications,
                pinned: nextPinned,
              },
            };
          }
          return {
            ...prev,
            notifications: {
              ...prev.notifications,
              pinned: [...pinned, notif],
            },
          };
        });
        return;
      }

      const diffPanelVisible = store.getState().diffPanelVisible;

      // densable: immediate only paints immediately when DiffPanel is closed.
      // While open, mark heldDuringDiffPanel and fall through to queue path.
      if (notif.priority === 'immediate' && !diffPanelVisible) {
        if (currentTimeoutId) {
          clearTimeout(currentTimeoutId);
          currentTimeoutId = null;
        }

        // densable: immediate timeout filters invalidates from queue on clear
        scheduleClearCurrent(
          setAppState,
          notif.key,
          processQueue,
          notif.timeoutMs,
          notif.invalidates,
        );

        setAppState(prev => ({
          ...prev,
          notifications: {
            ...prev.notifications,
            current: notif,
            queue: [
              ...(prev.notifications.current ? [prev.notifications.current] : []),
              ...prev.notifications.queue,
            ].filter(_ => shouldRequeueOnPreempt(_, notif)),
          },
        }));
        return;
      }

      const enqueued: Notification = notif.priority === 'immediate' ? { ...notif, heldDuringDiffPanel: true } : notif;

      setAppState(prev => {
        if (enqueued.fold) {
          if (prev.notifications.current?.key === enqueued.key) {
            const folded = enqueued.fold(prev.notifications.current, enqueued);
            if (currentTimeoutId) {
              clearTimeout(currentTimeoutId);
              currentTimeoutId = null;
            }
            scheduleClearCurrent(
              setAppState,
              folded.key,
              processQueue,
              folded.timeoutMs,
              folded.invalidates,
            );

            return {
              ...prev,
              notifications: {
                ...prev.notifications,
                current: folded,
                queue: prev.notifications.queue,
              },
            };
          }

          const queueIdx = prev.notifications.queue.findIndex(_ => _.key === enqueued.key);
          if (queueIdx !== -1) {
            const folded = enqueued.fold(prev.notifications.queue[queueIdx]!, enqueued);
            const newQueue = [...prev.notifications.queue];
            newQueue[queueIdx] = folded;
            return {
              ...prev,
              notifications: {
                ...prev.notifications,
                current: prev.notifications.current,
                queue: newQueue,
              },
            };
          }
        }

        const queuedKeys = new Set(prev.notifications.queue.map(_ => _.key));
        const shouldAdd = !queuedKeys.has(enqueued.key) && prev.notifications.current?.key !== enqueued.key;

        if (!shouldAdd) return prev;

        const invalidatesCurrent =
          prev.notifications.current !== null && enqueued.invalidates?.includes(prev.notifications.current.key);

        if (invalidatesCurrent && currentTimeoutId) {
          clearTimeout(currentTimeoutId);
          currentTimeoutId = null;
        }

        return {
          ...prev,
          notifications: {
            ...prev.notifications,
            current: invalidatesCurrent ? null : prev.notifications.current,
            queue: [...prev.notifications.queue.filter(_ => shouldRequeueOnPreempt(_, enqueued)), enqueued],
          },
        };
      });

      processQueue();
    },
    [setAppState, processQueue, store],
  );

  const removeNotification = useCallback<RemoveNotificationFn>(
    (key: string) => {
      setAppState(prev => {
        const next = removeNotificationFromState(
          {
            current: prev.notifications.current,
            queue: prev.notifications.queue,
            pinned: prev.notifications.pinned ?? [],
          },
          key,
        );
        if (
          next.current === prev.notifications.current &&
          next.queue === prev.notifications.queue &&
          next.pinned === (prev.notifications.pinned ?? [])
        ) {
          return prev;
        }

        if (prev.notifications.current?.key === key && currentTimeoutId) {
          clearTimeout(currentTimeoutId);
          currentTimeoutId = null;
        }

        return {
          ...prev,
          notifications: next,
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

  // densable: when DiffPanel closes, drain held non-exempt notifications.
  useEffect(() => {
    prevDiffPanelVisible.current = store.getState().diffPanelVisible;
    return store.subscribe(() => {
      const visible = store.getState().diffPanelVisible;
      const wasVisible = prevDiffPanelVisible.current;
      prevDiffPanelVisible.current = visible;
      if (wasVisible && !visible) {
        processQueue();
      }
    });
  }, [store, processQueue]);

  return { addNotification, removeNotification, processQueue };
}

export function getNext(queue: Notification[]): Notification | undefined {
  if (queue.length === 0) return undefined;
  return queue.reduce((min, n) => (PRIORITIES[n.priority] < PRIORITIES[min.priority] ? n : min));
}
