import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import React from 'react';
import { wrappedRender } from '@anthropic/ink';
import { getMainThreadAgentId } from '../../bootstrap/state.js';
import { MessageQueueContext } from '../../state/AppState.js';
import { createMessageQueue, getActiveMessageQueue, setActiveMessageQueue } from '../../utils/messageQueueManager.js';
import { QueryGuard } from '../../utils/QueryGuard.js';
import { useQueueProcessor } from '../useQueueProcessor.js';
import { createStore } from '../../state/store.js';
import { useDeferredHookMessages } from '../useDeferredHookMessages.js';

const waitForCommit = () => new Promise(resolve => setTimeout(resolve, 30));

test.each([
  'settles',
  'another-turn',
  'rejected',
  'unmount',
  'handover',
])('resurrected prompts respect the SessionStart wait: %s', async scenario => {
  const previousQueue = getActiveMessageQueue();
  const queue = createMessageQueue();
  const queryGuard = new QueryGuard();
  const handOverInFlight = createStore(false);
  const hooks = Promise.withResolvers<[]>();
  let readWait: (() => Promise<void> | undefined) | undefined;
  const setMessages = () => {};
  let executions = 0;
  queue.enqueue({
    agentId: getMainThreadAgentId(),
    mode: 'prompt',
    origin: { kind: 'human' },
    value: 'resurrected prompt',
    admissionExempt: 'resurrected',
  });
  setActiveMessageQueue(queue);
  const executeQueuedInput = async () => {
    executions++;
    queryGuard.reserve();
  };
  function Probe() {
    const awaitSessionStartHooks = useDeferredHookMessages(hooks.promise, setMessages);
    readWait = awaitSessionStartHooks;
    useQueueProcessor({
      executeQueuedInput,
      hasActiveLocalJsxUI: false,
      queryGuard,
      awaitSessionStartHooks,
      handOverInFlight,
    });
    return null;
  }
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {
      return stdin;
    },
    ref() {
      return stdin;
    },
    unref() {
      return stdin;
    },
  });
  const instance = await wrappedRender(
    <MessageQueueContext.Provider value={queue}>
      <Probe />
    </MessageQueueContext.Provider>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );
  let unmounted = false;
  try {
    await waitForCommit();
    expect(executions).toBe(0);
    expect(queue.getLength()).toBe(1);
    const pending = readWait!();
    expect(pending).toBeInstanceOf(Promise);
    void pending?.catch(() => {});
    if (scenario === 'another-turn' || scenario === 'rejected') queryGuard.reserve();
    if (scenario === 'handover') handOverInFlight.setState(() => true);
    if (scenario === 'unmount') {
      instance.unmount();
      unmounted = true;
    }
    if (scenario === 'rejected') hooks.reject(new Error('SessionStart failed'));
    else hooks.resolve([]);
    await waitForCommit();
    if (scenario !== 'settles') {
      expect(executions).toBe(0);
      expect(queue.getLength()).toBe(1);
      if (scenario === 'unmount') return;
      expect(readWait!()).toBeUndefined();
      queryGuard.cancelReservation();
      if (scenario === 'handover') handOverInFlight.setState(() => false);
      await waitForCommit();
    }
    expect(executions).toBe(1);
    expect(readWait!()).toBeUndefined();
    expect(queue.getLength()).toBe(0);
    await waitForCommit();
    expect(executions).toBe(1);
  } finally {
    hooks.resolve([]);
    if (!unmounted) instance.unmount();
    setActiveMessageQueue(previousQueue);
  }
});
