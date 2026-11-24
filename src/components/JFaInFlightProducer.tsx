/**
 * densable 2.1.212 JFa — React producer for shs(t7r).
 *
 * Mounts inside AppStateProvider, registers AppState reader for non-React
 * stamps (framework), and re-stamps when tasks / todos / queue change.
 *
 * extract: docs/upstream-extraction/v2.1.212/xSe_JFa.extract.md
 */

import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getSessionId, onSessionSwitch } from '../bootstrap/state.js';
import { TaskStoreContext, useAppState, useAppStateStore, useMessageQueue } from '../state/AppState.js';
import { budgetProgressKey, fanItemsKey, isBgJobSession, setBgInFlightRegistry } from '../utils/bgNeedsInputBridge.js';
import { getBootstrapSession, subscribeSessionWorking } from '../utils/sessionHost.js';
import { buildJFaInFlightSnapshot, setJFaAppStateReader, snapshotTurnBudget } from '../utils/task/jfaInFlightStamp.js';
import { onTasksUpdated, type Task } from '../utils/tasks.js';

const NOOP = (): void => {};
const NOOP_SUBSCRIBE = (): (() => void) => NOOP;
const NOOP_TASKS_SNAPSHOT = (): Task[] | undefined => undefined;
const subscribeSessionSwitch = (listener: () => void): (() => void) => onSessionSwitch(() => listener());
const BUDGET_POLL_MS = 1000;

/**
 * densable JFa — returns null; side-effect only.
 * Outside bg job sessions: still registers AppState reader for later stamps.
 */
export function JFaInFlightProducer(): null {
  const store = useAppStateStore();
  const messageQueue = useMessageQueue();
  const taskStore = useContext(TaskStoreContext);
  const isBg = isBgJobSession();
  const tasks = useAppState(s => s.tasks);
  const todosMap = useAppState(s => s.todos);
  // Reactive sessionId so /clear and /resume switch todosMap lookup immediately.
  const sessionId = useSyncExternalStore(subscribeSessionSwitch, getSessionId, getSessionId);
  const sessionTodos = todosMap[sessionId];

  // Subscribe reactively to TasksV2Store (via TaskStoreContext) and in-process
  // onTasksUpdated signals while running as a bg job session.
  const storeTasksV2 = useSyncExternalStore(
    isBg && taskStore ? taskStore.subscribe : NOOP_SUBSCRIBE,
    isBg && taskStore ? taskStore.getSnapshot : NOOP_TASKS_SNAPSHOT,
    NOOP_TASKS_SNAPSHOT,
  );
  const [tasksV2Rev, setTasksV2Rev] = useState(0);
  useEffect(() => {
    if (!isBg) return;
    return onTasksUpdated(() => setTasksV2Rev(rev => rev + 1));
  }, [isBg]);

  // densable PCt
  const queued = useSyncExternalStore(
    messageQueue.subscribe,
    () => messageQueue.getLength(),
    () => messageQueue.getLength(),
  );

  // Track turn output token budget progress reactively via session working
  // transitions and a lightweight unref'd poll while in a bg job session.
  const [polledBudgetKey, setPolledBudgetKey] = useState<number>(() =>
    isBg ? budgetProgressKey(snapshotTurnBudget()) : -1,
  );
  useEffect(() => {
    if (!isBg) return;
    const syncBudget = () => {
      const next = budgetProgressKey(snapshotTurnBudget());
      setPolledBudgetKey(prev => (prev === next ? prev : next));
    };
    syncBudget();
    const unsubWorking = subscribeSessionWorking(getBootstrapSession(), syncBudget);
    const timer = setInterval(syncBudget, BUDGET_POLL_MS);
    timer.unref?.();
    return () => {
      unsubWorking();
      clearInterval(timer);
    };
  }, [isBg, sessionId]);

  // densable Xat(Jjb) — read live budget key on any relevant state or poll tick
  const liveBudgetKey = isBg ? budgetProgressKey(snapshotTurnBudget()) : -1;
  const budgetKey = liveBudgetKey !== polledBudgetKey ? liveBudgetKey : polledBudgetKey;

  useEffect(() => {
    setJFaAppStateReader(() => {
      const s = store.getState();
      return { todos: s.todos, tasks: s.tasks };
    });
    return () => setJFaAppStateReader(null);
  }, [store]);

  const w6eKey = useMemo(() => {
    if (!isBg) return '';
    try {
      const snap = buildJFaInFlightSnapshot({
        tasks: tasks ?? {},
        todos: sessionTodos,
        tasksV2: storeTasksV2,
        queued,
      });
      const ik = fanItemsKey(snap.items as Array<Record<string, unknown>> | undefined);
      return `${sessionId}|${snap.tasks}|${queued}|${snap.kinds.join(',')}|${ik}|${budgetKey}|${tasksV2Rev}`;
    } catch {
      return '';
    }
  }, [isBg, sessionId, tasks, sessionTodos, storeTasksV2, queued, budgetKey, tasksV2Rev]);

  const lastKey = useRef<string>('');
  useEffect(() => {
    if (!isBg) return;
    if (w6eKey === lastKey.current) return;
    lastKey.current = w6eKey;
    // densable JFa XFa = VFa+qFa+zFa — load tasksV2 so shs full replace
    // does not drop zFa fan after framework stamps.
    let cancelled = false;
    void (async () => {
      try {
        let tasksV2: Awaited<ReturnType<typeof import('../utils/tasks.js').listTasks>> | null = storeTasksV2 ?? null;
        try {
          const { listTasks, getTaskListId } = await import('../utils/tasks.js');
          const listed = await listTasks(getTaskListId());
          if (listed.length > 0 || storeTasksV2 === undefined) {
            tasksV2 = listed;
          }
        } catch {
          tasksV2 = storeTasksV2 ?? null;
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
  }, [isBg, w6eKey, tasks, sessionTodos, storeTasksV2, queued]);

  return null;
}
