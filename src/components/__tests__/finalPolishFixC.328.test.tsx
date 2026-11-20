import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as React from 'react';
import { wrappedRender as render } from '@anthropic/ink';
import { AppStateProvider, useSetAppState } from '../../state/AppState.js';
import type { TaskState } from '../../tasks/types.js';
import { BackgroundTaskStatus } from '../tasks/BackgroundTaskStatus.js';
import { ConsoleOAuthFlow } from '../ConsoleOAuthFlow.js';

function makeTtyPair() {
  const stdout = Object.assign(new PassThrough(), {
    columns: 100,
    rows: 30,
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

class ErrorBoundary extends React.Component<
  { onError: (err: Error) => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  override componentDidCatch(error: Error): void {
    this.props.onError(error);
  }
  override render(): React.ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

const HOOK_CALL_RE =
  /\buse(State|Effect|Memo|Callback|Ref|LayoutEffect|ImperativeHandle|Keybinding|Keybindings|Input|TerminalSize|AppState|SetAppState|EffectEvent)\s*\(/;

describe('Final Polish Fix C — UI Rules of Hooks & Config Search', () => {
  const unmounts: Array<() => void> = [];

  afterEach(() => {
    while (unmounts.length > 0) {
      unmounts.pop()?.();
    }
  });

  test('P0-1: BackgroundTaskStatus transitions runningTasks 0 -> 1 -> 0 without violating Rules of Hooks', async () => {
    const { stdin, stdout } = makeTtyPair();
    const errors: Error[] = [];
    let setTasksFn: ((tasks: Record<string, TaskState>) => void) | null = null;

    function Harness(): React.ReactNode {
      const setAppState = useSetAppState();
      setTasksFn = nextTasks => {
        setAppState(prev => ({ ...prev, tasks: nextTasks }));
      };
      return <BackgroundTaskStatus tasksSelected={false} onOpenDialog={() => {}} />;
    }

    const instance = await render(
      <ErrorBoundary onError={e => errors.push(e)}>
        <AppStateProvider>
          <Harness />
        </AppStateProvider>
      </ErrorBoundary>,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 30));
    expect(setTasksFn).not.toBeNull();
    expect(errors).toEqual([]);

    const runningShellTask = {
      id: 'shell-1',
      type: 'local_bash',
      status: 'running',
      command: 'sleep 10',
      description: 'sleep 10',
      startTime: Date.now(),
      isBackgrounded: true,
    } as unknown as TaskState;

    // Transition 0 -> 1 running tasks (previously crashed with "Rendered more hooks")
    setTasksFn!({ 'shell-1': runningShellTask });
    await new Promise(r => setTimeout(r, 30));
    expect(errors).toEqual([]);

    // Transition 1 -> 0 running tasks (previously crashed with "Rendered fewer hooks")
    setTasksFn!({});
    await new Promise(r => setTimeout(r, 30));
    expect(errors).toEqual([]);

    // Static guard: no hooks after first return inside BackgroundTaskStatus
    const src = readFileSync(join(import.meta.dir, '../tasks/BackgroundTaskStatus.tsx'), 'utf8');
    const fnStart = src.indexOf('export function BackgroundTaskStatus(');
    const fnEnd = src.indexOf('type AgentPillProps', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    const firstReturnIdx = fnBody.indexOf('\n    return (');
    expect(firstReturnIdx).toBeGreaterThan(0);
    expect(fnBody.slice(firstReturnIdx)).not.toMatch(HOOK_CALL_RE);
  });

  test('P0-2: BackgroundTasksDialog calls zero hooks after its detail-view early return', () => {
    const src = readFileSync(join(import.meta.dir, '../tasks/BackgroundTasksDialog.tsx'), 'utf8');
    const fnStart = src.indexOf('export function BackgroundTasksDialog(');
    const fnEnd = src.indexOf('\nfunction canForegroundItem(', fnStart);
    expect(fnStart).toBeGreaterThan(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = src.slice(fnStart, fnEnd);

    const earlyReturnAnchor = "if (viewState.mode !== 'list' && viewState.mode !== 'actions' && typedTasks)";
    const earlyReturnIdx = fnBody.indexOf(earlyReturnAnchor);
    expect(earlyReturnIdx).toBeGreaterThan(0);

    const beforeEarlyReturn = fnBody.slice(0, earlyReturnIdx);
    const afterEarlyReturn = fnBody.slice(earlyReturnIdx);

    // All three hoisted useMemos + ref sync live before the early return
    expect(beforeEarlyReturn).toContain('const sections = useMemo(');
    expect(beforeEarlyReturn).toContain('const { itemListOptions, optionToRowIndex, rowToOptionIndex } = useMemo(');
    expect(beforeEarlyReturn).toContain('optionToRowIndexRef.current = optionToRowIndex;');
    expect(beforeEarlyReturn).toContain('const defaultFocusIndex = useMemo(');

    // Zero React hook calls remain after the early return
    expect(afterEarlyReturn).not.toMatch(HOOK_CALL_RE);
  });

  test('P0-3: ConsoleOAuthFlow OAuthStatusMessage has zero hooks in switch branches and transitions cleanly at runtime', async () => {
    const src = readFileSync(join(import.meta.dir, '../ConsoleOAuthFlow.tsx'), 'utf8');
    const fnStart = src.indexOf('function OAuthStatusMessage(');
    const fnEnd = src.indexOf('\ntype BedrockAccessKeysStatus', fnStart);
    expect(fnStart).toBeGreaterThan(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const oauthStatusMessageBody = src.slice(fnStart, fnEnd);

    // Zero React hook calls anywhere inside OAuthStatusMessage
    expect(oauthStatusMessageBody).not.toMatch(HOOK_CALL_RE);

    // All 5 stateful branches are extracted into standalone components
    expect(oauthStatusMessageBody).toContain('<CustomPlatformStep');
    expect(oauthStatusMessageBody).toContain('<OpenAIChatApiStep');
    expect(oauthStatusMessageBody).toContain('<ChatGptSubscriptionStep');
    expect(oauthStatusMessageBody).toContain('<GeminiApiStep');
    expect(oauthStatusMessageBody).toContain('<ChinaApiKeyStep');
    expect(src).toContain('function CustomPlatformStep(');
    expect(src).toContain('function OpenAIChatApiStep(');
    expect(src).toContain('function ChatGptSubscriptionStep(');
    expect(src).toContain('function GeminiApiStep(');
    expect(src).toContain('function ChinaApiKeyStep(');

    // Runtime transition test: idle -> custom_platform -> idle without React hook crash
    const { stdin, stdout } = makeTtyPair();
    const errors: Error[] = [];
    const instance = await render(
      <ErrorBoundary onError={e => errors.push(e)}>
        <ConsoleOAuthFlow onDone={() => {}} />
      </ErrorBoundary>,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 40));
    expect(errors).toEqual([]);

    // First option in idle Select is 'custom_platform' — Enter enters CustomPlatformStep
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 40));
    expect(errors).toEqual([]);

    // Esc returns to idle
    stdin.write('\x1b');
    await new Promise(r => setTimeout(r, 40));
    expect(errors).toEqual([]);
  });

  test('P1-4: Config.tsx uses setSearchModeSync(true) for both select:previous-at-top and settings:search', () => {
    const src = readFileSync(join(import.meta.dir, '../Settings/Config.tsx'), 'utf8');
    const kbStart = src.indexOf("'select:previous': () => {");
    const kbEnd = src.indexOf("context: 'Settings',", kbStart);
    expect(kbStart).toBeGreaterThan(0);
    expect(kbEnd).toBeGreaterThan(kbStart);
    const kbBlock = src.slice(kbStart, kbEnd);

    expect(kbBlock).not.toContain('setIsSearchMode(true)');
    expect(kbBlock).toMatch(/'select:previous':[\s\S]*?setSearchModeSync\(true\)/);
    expect(kbBlock).toMatch(/'settings:search':[\s\S]*?setSearchModeSync\(true\)/);
  });
});
