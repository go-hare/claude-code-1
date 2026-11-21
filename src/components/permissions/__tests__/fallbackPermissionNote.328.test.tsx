import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { PassThrough } from 'node:stream';
import { ThemeProvider, wrappedRender as render } from '@anthropic/ink';
import { REPLTool } from '@claude-code/builtin-tools/tools/REPLTool/REPLTool.js';
import { wrapReplToolForCodeMode } from '../../../services/codeMode/executor.js';
import {
  resetCodeModeOptInStateForTests,
  setEngineCheckResultForTests,
  settleCodeModeOptIn,
} from '../../../services/codeMode/optIn.js';
import { AppStateProvider } from '../../../state/AppState.js';
import { FallbackPermissionRequest } from '../FallbackPermissionRequest.js';

const CURSOR_FORWARD_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[(\\d+)C`, 'g');
const ANSI_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

function stripAnsi(s: string): string {
  return s.replace(CURSOR_FORWARD_RE, (_m, n) => ' '.repeat(Number(n))).replace(ANSI_RE, '');
}

async function renderToText(element: React.ReactElement): Promise<string> {
  const stdout = Object.assign(new PassThrough(), {
    columns: 140,
    rows: 40,
    isTTY: true,
  }) as unknown as NodeJS.WriteStream;
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

  let output = '';
  stdout.on('data', chunk => {
    output += String(chunk);
  });

  const instance = await render(
    React.createElement(
      AppStateProvider,
      null,
      React.createElement(
        ThemeProvider as React.ComponentType<{
          initialState: 'dark';
          children?: React.ReactNode;
        }>,
        { initialState: 'dark' },
        element,
      ),
    ),
    { stdout, stdin, patchConsole: false, exitOnCtrlC: false },
  );
  await new Promise(resolve => setTimeout(resolve, 40));
  instance.unmount();
  return stripAnsi(output);
}

afterEach(() => {
  resetCodeModeOptInStateForTests();
});

describe('P2-#12: FallbackPermissionRequest renders tool.permissionNote', () => {
  test('renders permissionNote from wrapReplToolForCodeMode(REPLTool) between rule explanation and prompt', async () => {
    setEngineCheckResultForTests('passed');
    settleCodeModeOptIn({ state: 'on', source: 'shell' });

    const wrappedRepl = wrapReplToolForCodeMode(REPLTool, () => []);
    const input = { code: '1 + 1', description: 'Add two numbers' };
    const toolUseContext = {
      getAppState: () => ({
        toolPermissionContext: {
          mode: 'default',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: false,
        },
      }),
    };

    const rendered = await renderToText(
      React.createElement(FallbackPermissionRequest, {
        toolUseConfirm: {
          tool: wrappedRepl,
          input,
          toolUseID: 'toolu_repl_note_1',
          description: 'Run code',
          permissionResult: {
            behavior: 'ask',
            message: 'Allow Code?',
          },
          assistantMessage: {
            message: { id: 'msg_note_1' },
          },
          onAllow: () => {},
          onReject: () => {},
          onAbort: () => {},
          recheckPermission: async () => {},
        } as never,
        toolUseContext: toolUseContext as never,
        onDone: () => {},
        onReject: () => {},
        verbose: false,
        workerBadge: undefined,
      }),
    );

    const normalized = rendered.replace(/\s+/g, ' ');
    expect(normalized).toContain("Yes runs Claude's code.");
    expect(normalized).toContain("Claude's own summary of it");
    expect(normalized).toContain('Each tool call that needs approval');
  });
});
