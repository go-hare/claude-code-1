import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import React from 'react';
import Ink from '../../../packages/@ant/ink/src/core/ink.js';
import { Box, Text } from '@anthropic/ink';

let matches = false;
let calls = 0;
let resolveHook: ((value: unknown) => void) | undefined;
// Function-hook loading/evaluation can execute external plugin code. Keep this
// fixture process isolated from the other suites' global mock registry.
mock.module('src/utils/plugins/functionHooksModules.ts', () => ({
  hasMatchingFunctionHook: () => matches,
  evaluateUiRender: () => {
    calls++;
    return new Promise(resolve => {
      resolveHook = resolve;
    });
  },
  getLastUiRenderPlugin: () => undefined,
}));
mock.module('src/components/PluginRasterPanes.tsx', () => ({ extractDrawnPlugin: () => undefined }));
const { useUiRenderHost } = await import('../hooks/useUiRenderHost.js');
let commits: Array<Record<string, unknown>> = [];
let renderCount = 0;
function Card({ props }: { props: Record<string, unknown> }) {
  renderCount++;
  const result = useUiRenderHost({
    component: 'ToolUse',
    requestId: 'host-review',
    props,
    viewport: { columns: 80, rows: 24, isFullscreen: false },
  });
  commits.push(result.props);
  return (
    <Box ref={result.hostRef as React.Ref<import('@anthropic/ink').DOMElement>}>
      <Text>{String(result.props.label)}</Text>
    </Box>
  );
}
const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: true });
stdout.resume();
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
const ink = new Ink({
  stdout: stdout as never,
  stdin: stdin as never,
  stderr: new PassThrough() as never,
  patchConsole: false,
  exitOnCtrlC: false,
});
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 50));
  ink.onRender();
};
try {
  const cyclic: Record<string, unknown> = {
    label: 'initial',
    count: 1n,
    toJSON() {
      throw Error('must not serialize');
    },
  };
  cyclic.self = cyclic;
  ink.render(<Card props={cyclic} />);
  await settle();
  assert.equal(renderCount, 1);
  assert.equal(commits.at(-1), cyclic);
  const fresh = { ...cyclic, label: 'fresh' };
  ink.render(<Card props={fresh} />);
  await settle();
  assert.equal(renderCount, 2);
  assert.equal(commits.at(-1), fresh);
  assert.equal(calls, 0);
  matches = true;
  ink.render(<Card props={fresh} />);
  await settle();
  assert.equal(calls, 1);
  resolveHook!({ type: 'engine', props: { label: 'plugin-initial' } });
  await settle();
  assert.equal(commits.at(-1)?.label, 'plugin-initial');
  const before = commits.length;
  const newest = { ...cyclic, label: 'newest' };
  ink.render(<Card props={newest} />);
  await settle();
  assert.equal(commits[before]?.label, 'plugin-initial');
  assert.equal(calls, 2);
  const stale = resolveHook!;
  matches = false;
  ink.render(<Card props={newest} />);
  await settle();
  stale({ type: 'engine', props: { label: 'stale' } });
  await settle();
  assert.equal(commits.at(-1), newest);
  console.log('UI_RENDER_HOST_REVIEW_OK');
} finally {
  ink.unmount();
}
