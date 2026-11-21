import { afterEach, describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import React, { useEffect } from 'react';
import {
  Box,
  Dialog,
  InputNowContext,
  Text,
  type DOMElement,
  type InputClock,
  useWantEveryKey,
  wrappedRender as render,
} from '@anthropic/ink';
import { DialogIdContext, MenuWaitContext } from '../../../packages/@ant/ink/src/components/InputNowContext.js';
import type { DOMNode } from '../../../packages/@ant/ink/src/core/dom.js';
import { InputGate } from '../../../packages/@ant/ink/src/core/inputGate.js';
import { AppStateProvider } from '../../state/AppState.js';
import { BaseTextInput } from '../BaseTextInput.js';
import { Select, type OptionWithDescription } from '../CustomSelect/select.js';

function makeStreams(columns = 80, rows = 24) {
  let output = '';
  const stdout = Object.assign(new PassThrough(), {
    columns,
    rows,
    isTTY: true,
  }) as unknown as NodeJS.WriteStream;
  stdout.on('data', (chunk: Buffer | string) => {
    output += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  });
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
  }) as unknown as NodeJS.ReadStream;
  return {
    stdout,
    stdin,
    getOutput: () => output,
  };
}

function findNode(root: DOMElement, predicate: (node: DOMElement) => boolean): DOMElement | null {
  if (predicate(root)) return root;
  for (const child of root.childNodes) {
    if (child.nodeName !== '#text') {
      const hit = findNode(child, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

function textOf(node: DOMNode): string {
  if (node.nodeName === '#text') return node.nodeValue;
  return node.childNodes.map(textOf).join('');
}

async function flush(ms = 40): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

describe('Wave 3C 2.1.328 parity fixes (BaseTextInput, useWantEveryKey, DialogWait, Select.no)', () => {
  const activeInstances: Array<{ unmount: () => void }> = [];

  afterEach(() => {
    while (activeInstances.length > 0) {
      activeInstances.pop()?.unmount();
    }
  });

  test('P1-#14: BaseTextInput stays strictly 1 row on single-line overflow and never unmounts children across overflow boundary', async () => {
    const { stdout, stdin, getOutput } = makeStreams(40, 12);
    let mountCount = 0;
    function ChildProbe(): React.ReactNode {
      useEffect(() => {
        mountCount++;
      }, []);
      return null;
    }

    const rootBox: { current: DOMElement | null } = { current: null };
    function makeProps(value: string) {
      return {
        value,
        onChange: () => {},
        cursorOffset: value.length,
        onChangeCursorOffset: () => {},
        columns: 20,
        multiline: false,
        maxVisibleLines: 1,
        focus: false,
        showCursor: false,
        terminalFocus: true,
        inputState: {
          onInput: () => {},
          renderedValue: value,
          offset: value.length,
          setOffset: () => {},
          cursorLine: 0,
          cursorColumn: value.length,
          viewportCharOffset: 0,
          viewportCharEnd: value.length,
        },
      };
    }

    const inst = await render(
      <Box
        ref={el => {
          rootBox.current = el;
        }}
      >
        <BaseTextInput {...makeProps('short')}>
          <ChildProbe />
        </BaseTextInput>
      </Box>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    activeInstances.push(inst);
    await flush();
    expect(mountCount).toBe(1);
    expect(rootBox.current?.yogaNode?.getComputedHeight()).toBe(1);

    // Grow past columns=20: must stay strictly 1 row, zero fabricated overflow text, and zero remount!
    inst.rerender(
      <Box
        ref={el => {
          rootBox.current = el;
        }}
      >
        <BaseTextInput {...makeProps('a'.repeat(50))}>
          <ChildProbe />
        </BaseTextInput>
      </Box>,
    );
    await flush();
    expect(mountCount).toBe(1);
    expect(rootBox.current?.yogaNode?.getComputedHeight()).toBe(1);
    expect(getOutput()).not.toContain('more chars');
    expect(getOutput()).not.toContain('hidden');
  });

  test('P1-#14: multiline BaseTextInput with viewport clipping does not add an extra overflowBadge row', async () => {
    const { stdout, stdin, getOutput } = makeStreams(60, 12);
    const rootBox: { current: DOMElement | null } = { current: null };
    const full = 'line1\nline2\nline3\nline4\nline5';
    const inst = await render(
      <Box
        ref={el => {
          rootBox.current = el;
        }}
      >
        <BaseTextInput
          value={full}
          onChange={() => {}}
          cursorOffset={6}
          onChangeCursorOffset={() => {}}
          columns={40}
          multiline
          maxVisibleLines={2}
          focus={false}
          showCursor={false}
          terminalFocus
          inputState={{
            onInput: () => {},
            renderedValue: 'line2\nline3',
            offset: 6,
            setOffset: () => {},
            cursorLine: 0,
            cursorColumn: 0,
            viewportCharOffset: 6,
            viewportCharEnd: 17,
          }}
        />
      </Box>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    activeInstances.push(inst);
    await flush();
    expect(rootBox.current?.yogaNode?.getComputedHeight()).toBe(2);
    expect(getOutput()).not.toContain('hidden');
  });

  test('P1-#11: useWantEveryKey registers synchronously in useLayoutEffect with DialogIdContext owner', async () => {
    const { stdout, stdin } = makeStreams(60, 12);
    const events: string[] = [];
    const registeredOwners: unknown[] = [];
    const clock: InputClock = Object.assign(() => Date.now(), {
      wantEveryKey: (owner: unknown) => {
        events.push(`want:${String(owner)}`);
        registeredOwners.push(owner);
        return () => {
          events.push(`unwant:${String(owner)}`);
        };
      },
    });

    function Probe(): React.ReactNode {
      useWantEveryKey(true);
      useEffect(() => {
        events.push('passive-effect');
      }, []);
      return <Text>probe</Text>;
    }

    const inst = await render(
      <InputNowContext.Provider value={clock}>
        <DialogIdContext.Provider value="dlg-42">
          <Probe />
        </DialogIdContext.Provider>
      </InputNowContext.Provider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    activeInstances.push(inst);
    await flush();

    // Must run in useLayoutEffect BEFORE passive useEffect, with DialogIdContext owner 'dlg-42'
    expect(registeredOwners).toEqual(['dlg-42']);
    expect(events.indexOf('want:dlg-42')).toBeGreaterThan(-1);
    expect(events.indexOf('passive-effect')).toBeGreaterThan(events.indexOf('want:dlg-42'));

    inst.unmount();
    activeInstances.pop();
    expect(events).toContain('unwant:dlg-42');
  });

  test('P1-#11: Dialog wires InputGate .wait and Select wires .no (key, isBeingTyped, goTo) live end-to-end', async () => {
    const { stdout, stdin } = makeStreams(80, 20);
    const options: OptionWithDescription<string>[] = [
      { label: 'Allow once', value: 'yes' },
      { label: 'Allow always', value: 'always' },
      { label: 'No, tell Claude what to do', value: 'no', type: 'input', onChange: () => {} },
    ];

    const rootBox: { current: DOMElement | null } = { current: null };
    let focusedSeen: string | undefined;
    const inst = await render(
      <AppStateProvider>
        <Box
          ref={el => {
            rootBox.current = el;
          }}
          flexDirection="column"
        >
          <Dialog title="Approve action?" onCancel={() => {}}>
            <Select
              options={options}
              declineValue="no"
              onFocus={v => {
                focusedSeen = v;
              }}
              onChange={() => {}}
            />
          </Dialog>
        </Box>
      </AppStateProvider>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    activeInstances.push(inst);
    await flush(50);

    expect(rootBox.current).not.toBeNull();
    const waitNode = findNode(rootBox.current!, n => n.wait !== undefined);
    const noNode = findNode(rootBox.current!, n => n.no !== undefined);
    expect(waitNode).not.toBeNull();
    expect(noNode).not.toBeNull();

    // Dialog wait defaults to non-menu (isMenu: false) and owner: null outside DialogHost
    expect(waitNode!.wait!.isMenu).toBe(false);
    expect(waitNode!.wait!.owner).toBeNull();

    // Select attaches official `.no` metadata: key is quoted 1-based index of declineValue
    expect(noNode!.no!.key).toBe('"3"');
    expect(noNode!.no!.isBeingTyped()).toBe(false);

    // Simulate freshly painted frame at t=1000 and test InputGate behavior live
    waitNode!.firstFrame = { writtenAt: 1000 };
    noNode!.firstFrame = { writtenAt: 1000 };
    const owners: unknown[] = [];
    const gate = new InputGate(owner => owners.includes(owner));

    // Decline shortcut '"3"' passes immediately even at t=1050
    expect(gate.drops(noNode!, '"3"', 1050)).toBe(false);

    // Accidental early Return at t=1080 is DROPPED and triggers DialogWait guidance row
    expect(gate.drops(noNode!, 'return', 1080)).toBe(true);
    await flush(60);
    const waitText = textOf(waitNode!);
    expect(waitText).toContain('Not answered yet');
    expect(waitText).toContain('wait a second, then press again');

    // A second different key in burst upgrades guidance to '↓ after a second'
    expect(gate.drops(noNode!, '"a"', 1120)).toBe(true);
    await flush(60);
    expect(textOf(waitNode!)).toContain('↓ after a second');

    // goTo() moves focus to declineValue ('no') and returns restore callback
    const restore = noNode!.no!.goTo();
    await flush(40);
    expect(focusedSeen).toBe('no');
    expect(noNode!.no!.isBeingTyped()).toBe(true);
    restore?.();
    await flush(40);
    expect(focusedSeen).toBe('yes');
    expect(noNode!.no!.isBeingTyped()).toBe(false);

    // wantEveryKey opt-out for owner null bypasses InputGate immediately
    owners.push(null);
    expect(gate.drops(noNode!, 'return', 1150)).toBe(false);
  });

  test('P1-#11: DialogWait respects MenuWaitContext and yields inside DialogIdContext (no double-gating)', async () => {
    const { stdout, stdin } = makeStreams(80, 16);
    const rootBox: { current: DOMElement | null } = { current: null };
    const inst = await render(
      <Box
        ref={el => {
          rootBox.current = el;
        }}
        flexDirection="column"
      >
        <MenuWaitContext.Provider value={true}>
          <Dialog title="Menu" onCancel={() => {}}>
            <Text>item</Text>
          </Dialog>
        </MenuWaitContext.Provider>
      </Box>,
      { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
    );
    activeInstances.push(inst);
    await flush(40);

    const waitNode = findNode(rootBox.current!, n => n.wait !== undefined);
    expect(waitNode).not.toBeNull();
    expect(waitNode!.wait!.isMenu).toBe(true);

    // Inside DialogIdContext (DialogHost owns <Wait>), Dialog's internal DialogWait yields
    inst.rerender(
      <Box
        ref={el => {
          rootBox.current = el;
        }}
        flexDirection="column"
      >
        <DialogIdContext.Provider value="dialog-host-1">
          <Dialog title="Hosted" onCancel={() => {}}>
            <Text>body</Text>
          </Dialog>
        </DialogIdContext.Provider>
      </Box>,
    );
    await flush(40);
    const waitNodeInsideHost = findNode(rootBox.current!, n => n.wait !== undefined);
    expect(waitNodeInsideHost).toBeNull();
  });
});
