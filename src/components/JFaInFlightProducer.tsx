/**
 * densable 2.1.212 JFa — React producer for shs(t7r).
 *
 * Mounts inside AppStateProvider, registers AppState reader for non-React
 * stamps (framework), and re-stamps when tasks / todos / queue change.
 *
 * extract: docs/upstream-extraction/v2.1.212/xSe_JFa.extract.md
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { getSessionId } from '../bootstrap/state.js';
import { useAppState, useAppStateStore } from '../state/AppState.js';
import { budgetProgressKey, fanItemsKey, isBgJobSession, setBgInFlightRegistry } from '../utils/bgNeedsInputBridge.js';
import { getCommandQueueLength, subscribeToCommandQueue } from '../utils/messageQueueManager.js';
import { buildJFaInFlightSnapshot, setJFaAppStateReader, snapshotTurnBudget } from '../utils/task/jfaInFlightStamp.js';

/**
 * densable JFa — returns null; side-effect only.
 * Outside bg job sessions: still registers AppState reader for later stamps.
 */
export function JFaInFlightProducer(): null {
  const store = useAppStateStore();
  const tasks = useAppState(s => s.tasks);
  const todosMap = useAppState(s => s.todos);
  const sessionId = getSessionId();
  const sessionTodos = todosMap[sessionId];

  // densable PCt
  const queued = useSyncExternalStore(subscribeToCommandQueue, getCommandQueueLength, getCommandQueueLength);

  // densable Xat(Jjb) — recompute with task/todo/queue deps
  const budgetKey = useMemo(
    () => budgetProgressKey(snapshotTurnBudget()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stamp when tasks/todos/queue move
    [tasks, sessionTodos, queued],
  );

  useEffect(() => {
    setJFaAppStateReader(() => {
      const s = store.getState();
      return { todos: s.todos, tasks: s.tasks };
    });
    return () => setJFaAppStateReader(null);
  }, [store]);

  const w6eKey = useMemo(() => {
    if (!isBgJobSession()) return '';
    try {
      const snap = buildJFaInFlightSnapshot({
        tasks: tasks ?? {},
        todos: sessionTodos,
        queued,
      });
      const ik = fanItemsKey(snap.items as Array<Record<string, unknown>> | undefined);
      return `${snap.tasks}|${queued}|${snap.kinds.join(',')}|${ik}|${budgetKey}`;
    } catch {
      return '';
    }
  }, [tasks, sessionTodos, queued, budgetKey]);

  const lastKey = useRef<string>('');
  useEffect(() => {
    if (!isBgJobSession()) return;
    if (w6eKey === lastKey.current) return;
    lastKey.current = w6eKey;
    // densable JFa XFa = VFa+qFa+zFa — load tasksV2 so shs full replace
    // does not drop zFa fan after framework stamps.
    let cancelled = false;
    void (async () => {
      try {
        let tasksV2: Awaited<ReturnType<typeof import('../utils/tasks.js').listTasks>> | null = null;
        try {
          const { listTasks, getTaskListId } = await import('../utils/tasks.js');
          tasksV2 = await listTasks(getTaskListId());
        } catch {
          tasksV2 = null;
        }
        if (cancelled) return;
        setBgInFlightRegistry(
          buildJFaInFlightSnapshot({
            tasks: tasks ?? {},
            todos: sessionTodos,
            tasksV2,
            queued,
          }),
        );
      } catch {
        // never throw into render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [w6eKey, tasks, sessionTodos, queued]);

  return null;
}
