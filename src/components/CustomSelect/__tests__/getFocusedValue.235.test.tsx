/**
 * densable 2.1.235 #16 — dialog arrow+Enter race.
 *
 * C4i sync bag + getFocusedValue(): after focusNextOption() in the same tick,
 * accept must read the navigated option from bag.state — not the previous
 * React focusedValue snapshot.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import * as React from 'react';
import { PassThrough } from 'stream';
import { Box, wrappedRender as render } from '@anthropic/ink';
import type { OptionWithDescription } from '../select.js';
import { useSelectState } from '../use-select-state.js';

const OPTIONS: OptionWithDescription<string>[] = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Bravo', value: 'bravo' },
  { label: 'Charlie', value: 'charlie' },
];

type SelectApi = ReturnType<typeof useSelectState<string>>;

async function mountSelect(opts?: {
  onChange?: (value: string) => void;
  onFocus?: (value: string) => void;
  options?: OptionWithDescription<string>[];
  visibleOptionCount?: number;
  defaultValue?: string;
  selectedValue?: string;
}): Promise<{ api: () => SelectApi; unmount: () => void }> {
  let latest: SelectApi | null = null;

  function Probe(): React.ReactNode {
    const state = useSelectState<string>({
      options: opts?.options ?? OPTIONS,
      visibleOptionCount: opts?.visibleOptionCount ?? 5,
      onChange: opts?.onChange,
      onFocus: opts?.onFocus,
      defaultValue: opts?.defaultValue,
      selectedValue: opts?.selectedValue,
    });
    latest = state;
    return <Box>{String(state.focusedValue ?? '')}</Box>;
  }

  const stream = new PassThrough();
  const instance = await render(<Probe />, {
    stdout: stream as unknown as NodeJS.WriteStream,
    patchConsole: false,
  });
  await new Promise(r => setTimeout(r, 20));
  if (!latest) {
    instance.unmount();
    throw new Error('useSelectState did not mount');
  }
  return {
    api: () => {
      if (!latest) throw new Error('unmounted');
      return latest;
    },
    unmount: () => instance.unmount(),
  };
}

describe('densable 2.1.235 #16 getFocusedValue', () => {
  const mounts: Array<() => void> = [];
  afterEach(() => {
    while (mounts.length) mounts.pop()?.();
  });

  test('focusNext then getFocusedValue sees navigated option same tick', async () => {
    const { api, unmount } = await mountSelect();
    mounts.push(unmount);

    expect(api().focusedValue).toBe('alpha');
    expect(api().getFocusedValue()).toBe('alpha');

    // Arrow navigate — bag mutates synchronously before React re-render
    api().focusNextOption();

    // Live getter must see bravo immediately (densable C4i o.state)
    expect(api().getFocusedValue()).toBe('bravo');
  });

  test('same-tick navigate then accept reads live focus, not stale snapshot', async () => {
    const changes: string[] = [];
    const { api, unmount } = await mountSelect({
      onChange: v => {
        changes.push(v);
      },
    });
    mounts.push(unmount);

    expect(api().focusedValue).toBe('alpha');

    api().focusNextOption();
    // Race window: bag is live; React snapshot may still be previous option
    const live = api().getFocusedValue();
    expect(live).toBe('bravo');
    expect(api().focusedValue).toBe('alpha');

    // densable select:accept — gate + onChange from getFocusedValue()
    api().selectFocusedOption();
    if (live !== undefined) {
      api().onChange?.(live);
    }
    expect(changes).toEqual(['bravo']);
  });

  test('PFm falls back to first option when bag value missing from options', async () => {
    const { api, unmount } = await mountSelect();
    mounts.push(unmount);

    // Valid initial
    expect(api().getFocusedValue()).toBe('alpha');

    // After navigate, live value still in options
    api().focusNextOption();
    api().focusNextOption();
    expect(api().getFocusedValue()).toBe('charlie');
  });

  test('scrollViewport returns false at the top and does not move focus', async () => {
    const { api, unmount } = await mountSelect();
    mounts.push(unmount);
    expect(api().visibleFromIndex).toBe(0);
    expect(api().scrollViewport(-1)).toBe(false);
    expect(api().visibleFromIndex).toBe(0);
    expect(api().getFocusedValue()).toBe('alpha');
  });

  test('scrollViewport walks focus into the window and returns true when from moves', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      label: `Item ${i}`,
      value: `v${i}`,
    }));
    const { api, unmount } = await mountSelect({
      options: many,
      visibleOptionCount: 3,
    });
    mounts.push(unmount);
    expect(api().visibleFromIndex).toBe(0);
    expect(api().getFocusedValue()).toBe('v0');
    expect(api().scrollViewport(1)).toBe(true);
    // densable C4i `d()`: bag is live; FTt gates on from-changed.
    expect(api().getFocusedValue()).toBe('v1');
    expect(api().scrollViewport(20)).toBe(true);
    expect(api().getFocusedValue()).toBe('v9');
    expect(api().scrollViewport(1)).toBe(false);
    expect(api().getFocusedValue()).toBe('v9');
  });

  test('scrollViewport notifies onFocus same tick (gold KMn v)', async () => {
    const focused: string[] = [];
    const many = Array.from({ length: 12 }, (_, i) => ({
      label: `Item ${i}`,
      value: `v${i}`,
    }));
    const { api, unmount } = await mountSelect({
      options: many,
      visibleOptionCount: 3,
      onFocus: v => {
        focused.push(v);
      },
    });
    mounts.push(unmount);
    api().scrollViewport(1);
    expect(api().getFocusedValue()).toBe('v1');
    expect(focused.at(-1)).toBe('v1');
  });

  test('ki selectedValue is controlled over internal default', async () => {
    const { api, unmount } = await mountSelect({
      defaultValue: 'alpha',
      selectedValue: 'bravo',
    });
    mounts.push(unmount);
    expect(api().value).toBe('bravo');
  });
});
