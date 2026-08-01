import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import React from 'react';
import { wrappedRender as render } from '@anthropic/ink';
import { AppStateProvider } from '../../state/AppState.js';
import { call as panelCall } from '../panel/panelCall.js';
import { WorkflowHistoryDialog } from '../panel/WorkflowHistoryDialog.js';
import { __resetWorkflowServiceForTests, getWorkflowService } from '../service.js';

// densable GsK: /workflows mounts a Host that starts on WorkflowHistoryDialog
// (and can swap to BackgroundTasksDialog for live detail).
test('panelCall returns Host that opens WorkflowHistoryDialog (densable GsK)', async () => {
  const element = (await (panelCall as unknown as (a: unknown, b: unknown, c: unknown) => Promise<React.ReactNode>)(
    () => {},
    { canUseTool: undefined },
    '',
  )) as React.ReactElement;
  expect(React.isValidElement(element)).toBe(true);
  // Host is an inner function component; render path is covered by mount test.
  expect(typeof element.type).toBe('function');
});

// WorkflowHistoryDialog mount triggers loadPersistedRuns once (disk hydrate for history rows).
test('WorkflowHistoryDialog mount triggers loadPersistedRuns once', async () => {
  __resetWorkflowServiceForTests();
  const svc = getWorkflowService();
  let calls = 0;
  const orig = svc.loadPersistedRuns.bind(svc);
  svc.loadPersistedRuns = async () => {
    calls++;
  };

  const stdout = new PassThrough();
  // consume data to avoid buffer overflow (render writes multiple frames)
  stdout.on('data', () => {});
  let instance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;
  try {
    // History dialog reads AppState via useAppState — must wrap provider.
    instance = await render(
      React.createElement(
        AppStateProvider,
        null,
        React.createElement(WorkflowHistoryDialog, {
          onDone: () => {},
        }),
      ),
      { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false },
    );
    // after mount useEffect triggers asynchronously; wait a tick for React commit + effect to complete
    await new Promise(r => setTimeout(r, 50));

    expect(calls).toBe(1);
  } finally {
    instance?.unmount();
    svc.loadPersistedRuns = orig;
    __resetWorkflowServiceForTests();
  }
});

// Detail mode pins by taskId: index re-sort must not retarget open row / kill target.
test('history detail pin: itemId survives list re-sort (index mismatch)', () => {
  type Row = { taskId: string; startTime: number };
  const open = (items: Row[], itemId: string, selected: number) => {
    const focusedByIndex = items[Math.min(selected, Math.max(0, items.length - 1))];
    const pinned = items.find(i => i.taskId === itemId) ?? null;
    return { focusedByIndex, pinned };
  };

  // Open diskB at index 1 of [diskA, diskB]
  let items: Row[] = [
    { taskId: 'diskA', startTime: 2 },
    { taskId: 'diskB', startTime: 1 },
  ];
  let selected = 1;
  const itemId = items[selected]!.taskId;
  let snap = open(items, itemId, selected);
  expect(snap.pinned?.taskId).toBe('diskB');
  expect(snap.focusedByIndex?.taskId).toBe('diskB');

  // Newer live run inserts at top → index 1 is no longer diskB
  items = [
    { taskId: 'live1', startTime: 9 },
    { taskId: 'diskA', startTime: 2 },
    { taskId: 'diskB', startTime: 1 },
  ];
  snap = open(items, itemId, selected);
  expect(snap.focusedByIndex?.taskId).toBe('diskA'); // stale index
  expect(snap.pinned?.taskId).toBe('diskB'); // pin wins

  // re-sync selected to pinned index (dialog useEffect)
  selected = items.findIndex(i => i.taskId === itemId);
  snap = open(items, itemId, selected);
  expect(selected).toBe(2);
  expect(snap.focusedByIndex?.taskId).toBe('diskB');
  expect(snap.pinned?.taskId).toBe('diskB');
});
