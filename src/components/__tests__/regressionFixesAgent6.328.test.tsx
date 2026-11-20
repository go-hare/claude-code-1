import { afterEach, describe, expect, test } from 'bun:test';
import * as React from 'react';
import { PassThrough } from 'stream';
import { AccessibilityContext, Box, KeyboardEvent, useSearchInput, wrappedRender as render } from '@anthropic/ink';
import { Select } from '../CustomSelect/select.js';
import { noteProcessResumed, resetProcessResumedForTests } from '../CustomSelect/use-select-input.js';

function makeTtyPair() {
  const stdout = Object.assign(new PassThrough(), {
    columns: 80,
    rows: 24,
    isTTY: true,
  });
  stdout.resume();
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
  return { stdin, stdout };
}

describe('Agent 6 Regression Fixes — SR Select, SIGCONT grace, and Config search burst', () => {
  const unmounts: Array<() => void> = [];

  afterEach(() => {
    resetProcessResumedForTests();
    while (unmounts.length > 0) {
      unmounts.pop()?.();
    }
  });

  test('P0-2: Screen-reader Select with disablePrintableKeybindings accepts typed digits and commits option', async () => {
    const { stdin, stdout } = makeTtyPair();
    const chosen: string[] = [];
    let cancelled = 0;

    const instance = await render(
      <AccessibilityContext.Provider value={true}>
        <Select<'no' | 'yes'>
          options={[
            { label: 'No, cancel', value: 'no' },
            { label: 'Yes, allow', value: 'yes' },
          ]}
          disablePrintableKeybindings
          declineValue="no"
          onChange={v => chosen.push(v)}
          onCancel={() => {
            cancelled += 1;
          }}
        />
      </AccessibilityContext.Provider>,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 30));

    // Type '2' then Enter in screen-reader mode — must select option 2 ('yes'),
    // NOT be swallowed by visual disablePrintableKeybindings!
    stdin.write('2');
    await new Promise(r => setTimeout(r, 20));
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 30));

    expect(chosen).toEqual(['yes']);
    expect(cancelled).toBe(0);
  });

  test('P2-16: Screen-reader Select ignores digits/Enter during SIGCONT grace window while Esc still cancels', async () => {
    const { stdin, stdout } = makeTtyPair();
    const chosen: string[] = [];
    let cancelled = 0;

    const instance = await render(
      <AccessibilityContext.Provider value={true}>
        <Select<'no' | 'yes'>
          options={[
            { label: 'No, cancel', value: 'no' },
            { label: 'Yes, allow', value: 'yes' },
          ]}
          disablePrintableKeybindings
          onChange={v => chosen.push(v)}
          onCancel={() => {
            cancelled += 1;
          }}
        />
      </AccessibilityContext.Provider>,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 30));

    // Mark process as just resumed via SIGCONT
    noteProcessResumed(Date.now());
    stdin.write('2');
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 20));
    expect(chosen).toEqual([]);

    // Escape still cancels immediately during SIGCONT grace
    stdin.write('\x1b');
    await new Promise(r => setTimeout(r, 60));
    expect(cancelled).toBe(1);
  });

  test('P1-4: useSearchInput with isActiveRef preserves fast-burst characters typed before React commits isActive=true', async () => {
    const { stdout } = makeTtyPair();
    const activeRef = { current: false };
    let latest: ReturnType<typeof useSearchInput> | null = null;

    function Probe(): React.ReactNode {
      const api = useSearchInput({
        isActive: false,
        isActiveRef: activeRef,
        onExit: () => {},
      });
      latest = api;
      return <Box>{api.query}</Box>;
    }

    const instance = await render(<Probe />, {
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 20));
    expect(latest).not.toBeNull();

    // Simulate Config.tsx first char entering search synchronously before React re-renders
    activeRef.current = true;
    latest!.setQuery('t');
    // Characters 2..5 arrive synchronously while isActive prop is still false!
    for (const ch of ['h', 'e', 'm', 'e']) {
      latest!.handleKeyDown(
        new KeyboardEvent({
          name: ch,
          sequence: ch,
          ctrl: false,
          meta: false,
          shift: false,
          option: false,
          super: false,
          fn: false,
        } as ConstructorParameters<typeof KeyboardEvent>[0]),
      );
    }

    expect(latest!.queryRef.current).toBe('theme');
  });
});
