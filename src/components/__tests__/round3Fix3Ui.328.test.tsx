import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import chalk from 'chalk';
import * as React from 'react';
import { Box, type KeyboardEvent, Text, useSearchInput, wrappedRender as render } from '@anthropic/ink';
import { ApiKeyStep } from '../../commands/install-github-app/ApiKeyStep.js';
import { CheckExistingSecretStep } from '../../commands/install-github-app/CheckExistingSecretStep.js';
import { ChooseRepoStep } from '../../commands/install-github-app/ChooseRepoStep.js';
import {
  AutoDefaultNudgeDialog,
  consumePendingAutoDefaultNudgeDraft,
} from '../../dialog/dialogs/AutoDefaultNudgeDialog.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { AppStateProvider, useSetAppState } from '../../state/AppState.js';
import type { TaskState } from '../../tasks/types.js';
import { CONFIRM_SELECT_ARM_MS } from '../ConfirmSelect.js';
import { ConsoleOAuthFlow } from '../ConsoleOAuthFlow.js';
import { BackgroundTaskStatus } from '../tasks/BackgroundTaskStatus.js';

function makeTtyPair() {
  const chunks: string[] = [];
  const stdout = Object.assign(new PassThrough(), {
    columns: 120,
    rows: 40,
    isTTY: true,
  });
  stdout.on('data', (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
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
  });
  return {
    stdin,
    stdout,
    getOutput: () => chunks.join(''),
    clearOutput: () => {
      chunks.length = 0;
    },
  };
}

function stripAnsi(s: string): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: preserve cursor-forward spaces emitted by Ink diff renderer
      .replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(Number(n)))
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escape sequences
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip OSC sequences
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  );
}

describe('Round 3 Fix 3 — UI P0/P1 Regressions', () => {
  const unmounts: Array<() => void> = [];

  afterEach(() => {
    consumePendingAutoDefaultNudgeDraft();
    while (unmounts.length > 0) {
      unmounts.pop()?.();
    }
  });

  test('BH4-P0-1: ChatGptSubscriptionStep stores onDone in ref, resets startedRef on cleanup, and Login memoizes onDone', () => {
    const oauthSrc = readFileSync(join(import.meta.dir, '../ConsoleOAuthFlow.tsx'), 'utf8');
    const stepStart = oauthSrc.indexOf('function ChatGptSubscriptionStep(');
    const stepEnd = oauthSrc.indexOf('type GeminiApiStatus', stepStart);
    expect(stepStart).toBeGreaterThan(0);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBody = oauthSrc.slice(stepStart, stepEnd);

    expect(stepBody).toContain('const onDoneRef = useRef(onDone);');
    expect(stepBody).toContain('onDoneRef.current = onDone;');
    expect(stepBody).toContain('onDoneRef.current()');
    expect(stepBody).toContain('startedRef.current = false;');
    expect(stepBody).toContain('}, [setOAuthStatus]);');
    expect(stepBody).not.toContain('}, [setOAuthStatus, onDone]);');

    const loginSrc = readFileSync(join(import.meta.dir, '../../commands/login/login.tsx'), 'utf8');
    const loginStart = loginSrc.indexOf('export function Login(');
    expect(loginStart).toBeGreaterThan(0);
    const loginBody = loginSrc.slice(loginStart);
    expect(loginBody).toContain('const handleOAuthDone = React.useCallback(');
    expect(loginBody).toContain('onDone={handleOAuthDone}');
    expect(loginBody).not.toContain('onDone={() => props.onDone(true, mainLoopModel)}');
  });

  test('BH4-P0-2: platform_setup Enter selects Amazon Bedrock instead of bouncing back to idle', async () => {
    const { stdin, stdout, getOutput, clearOutput } = makeTtyPair();
    const instance = await render(
      <AppStateProvider>
        <KeybindingSetup>
          <ConsoleOAuthFlow onDone={() => {}} />
        </KeybindingSetup>
      </AppStateProvider>,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 40));

    // Press '8' (3rd-party platform) to enter platform_setup
    clearOutput();
    stdin.write('8');
    await new Promise(r => setTimeout(r, 60));
    expect(stripAnsi(getOutput())).toContain('Using 3rd-party platforms');

    // Press Enter on the first option (Amazon Bedrock) — must NOT bounce back to idle!
    clearOutput();
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 60));
    const afterEnter = stripAnsi(getOutput());
    expect(afterEnter).toContain('Set up Amazon Bedrock');
    expect(afterEnter).toContain('Access key ID');
    expect(afterEnter).not.toContain('Select login method');

    // Esc from bedrock_access_keys returns to platform_setup
    clearOutput();
    stdin.write('\x1b');
    await new Promise(r => setTimeout(r, 80));
    expect(stripAnsi(getOutput())).toContain('Using 3rd-party platforms');

    // Esc from platform_setup returns to idle
    clearOutput();
    stdin.write('\x1b');
    await new Promise(r => setTimeout(r, 80));
    expect(stripAnsi(getOutput())).toContain('Select login method');
  });

  test('BH4-P1-3: AutoDefaultNudgeDialog useInput prepends ahead of child Select after arming window', async () => {
    const { stdin, stdout } = makeTtyPair();
    const answers: string[] = [];

    const instance = await render(
      <AppStateProvider>
        <KeybindingSetup>
          <AutoDefaultNudgeDialog
            currentMode="default"
            onAnswer={result => {
              answers.push(result);
            }}
          />
        </KeybindingSetup>
      </AppStateProvider>,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());

    // Wait past the arming window so Select is active (previously Select swallowed keys before parent useInput)
    await new Promise(r => setTimeout(r, CONFIRM_SELECT_ARM_MS + 80));

    // Type printable text keystroke-by-keystroke — must be captured into draft and lock Enter
    for (const ch of 'hello') {
      stdin.write(ch);
      await new Promise(r => setTimeout(r, 5));
    }
    await new Promise(r => setTimeout(r, 30));

    // Enter while locked must NOT accept or answer
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 30));
    expect(answers).toEqual([]);

    // Down arrow unlocks Enter and moves Select focus to 'declined'
    stdin.write('\x1b[B');
    await new Promise(r => setTimeout(r, 30));

    // Enter now submits the focused option and flushes the captured stray draft
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 40));
    expect(answers).toEqual(['declined']);
    expect(consumePendingAutoDefaultNudgeDraft()).toBe('hello');
  });

  test('BH4-P1-4: Config useKeybindings yields via isSearchModeRef during fast burst entering search mode', async () => {
    // 1. Static check on Config.tsx: all list-mode keybindings guard with isSearchModeRef.current
    const configSrc = readFileSync(join(import.meta.dir, '../Settings/Config.tsx'), 'utf8');
    const kbStart = configSrc.indexOf("useKeybinding(\n    'confirm:no',");
    const kbEnd = configSrc.indexOf('const handleKeyDown = useCallback(', kbStart);
    expect(kbStart).toBeGreaterThan(0);
    expect(kbEnd).toBeGreaterThan(kbStart);
    const kbSection = configSrc.slice(kbStart, kbEnd);
    const guardMatches = kbSection.match(/if \(isSearchModeRef\.current\) return false;/g) ?? [];
    // confirm:no, settings:close, select:previous, select:next, scroll:lineUp, scroll:lineDown,
    // select:accept, select:previousValue, select:nextValue, settings:search => 10 handlers
    expect(guardMatches.length).toBeGreaterThanOrEqual(10);

    // 2. Runtime check: fast burst "a", "j", "k", "/", " " while React state `isSearchMode`
    // has NOT yet committed (kept false to model pre-commit burst delivery), verifying
    // useKeybindings yields via `if (isSearchModeRef.current) return false` so keys reach search.
    const { stdin, stdout } = makeTtyPair();
    let toggledCount = 0;
    let movedCount = 0;
    let latestQuery = '';

    function BurstProbe(): React.ReactNode {
      // Intentionally keep React state isSearchMode=false so useKeybindings stays isActive=true
      // (simulating the pre-commit burst window before React re-renders).
      const isSearchMode = false;
      const isSearchModeRef = React.useRef(false);

      const {
        query,
        setQuery,
        handleKeyDown: handleSearchKeyDown,
      } = useSearchInput({
        isActive: isSearchMode,
        isActiveRef: isSearchModeRef,
        onExit: () => {
          isSearchModeRef.current = false;
        },
      });
      latestQuery = query;

      useKeybindings(
        {
          'select:previous': () => {
            if (isSearchModeRef.current) return false;
            movedCount += 1;
          },
          'select:next': () => {
            if (isSearchModeRef.current) return false;
            movedCount += 1;
          },
          'select:accept': () => {
            if (isSearchModeRef.current) return false;
            toggledCount += 1;
          },
          'settings:search': () => {
            if (isSearchModeRef.current) return false;
            isSearchModeRef.current = true;
            setQuery('');
          },
        },
        { context: 'Settings', isActive: !isSearchMode },
      );

      const onKeyDown = React.useCallback(
        (e: KeyboardEvent) => {
          if (isSearchModeRef.current) {
            handleSearchKeyDown(e);
            return;
          }
          if (e.defaultPrevented) return;
          if (e.key.length === 1 && e.key !== ' ' && e.key !== 'j' && e.key !== 'k') {
            e.preventDefault();
            isSearchModeRef.current = true;
            setQuery(e.key);
          }
        },
        [handleSearchKeyDown, setQuery],
      );

      return (
        <Box tabIndex={0} autoFocus onKeyDown={onKeyDown}>
          <Text>{query}</Text>
        </Box>
      );
    }

    const instance = await render(
      <AppStateProvider>
        <KeybindingSetup>
          <BurstProbe />
        </KeybindingSetup>
      </AppStateProvider>,
      {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      },
    );
    unmounts.push(() => instance.unmount());
    await new Promise(r => setTimeout(r, 40));

    // Send "a", "j", "k", "/", " " while useKeybindings still has isActive=true
    for (const ch of ['a', 'j', 'k', '/', ' ']) {
      stdin.write(ch);
      await new Promise(r => setTimeout(r, 5));
    }
    await new Promise(r => setTimeout(r, 50));

    expect(toggledCount).toBe(0);
    expect(movedCount).toBe(0);
    expect(latestQuery).toBe('ajk/ ');
  });

  test('BH4-P1-5: install-github-app Select onChange passes fresh override to onSubmit across all 3 steps', async () => {
    // 1. ChooseRepoStep: even if parent prop useCurrentRepo=false & repoUrl="", selecting 'current' passes fresh override
    {
      const { stdin, stdout } = makeTtyPair();
      const submitted: Array<unknown> = [];
      const instance = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <ChooseRepoStep
              currentRepo="anthropics/claude-code"
              useCurrentRepo={false}
              repoUrl=""
              onRepoUrlChange={() => {}}
              onToggleUseCurrentRepo={() => {}}
              onSubmit={override => submitted.push(override)}
            />
          </KeybindingSetup>
        </AppStateProvider>,
        {
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
          patchConsole: false,
        },
      );
      unmounts.push(() => instance.unmount());
      await new Promise(r => setTimeout(r, 30));

      // Up arrow (from 'typed' to 'current') + Enter in one synchronous burst
      stdin.write('\x1b[A\r');
      await new Promise(r => setTimeout(r, 40));
      expect(submitted).toEqual([{ useCurrentRepo: true, selectedRepoName: 'anthropics/claude-code' }]);
    }

    // 2. CheckExistingSecretStep: focusing 'new' then Up+Enter in one burst passes fresh { useExistingSecret: true, secretName: 'ANTHROPIC_API_KEY' }
    {
      const { stdin, stdout } = makeTtyPair();
      const submitted: Array<unknown> = [];
      function Wrapper(): React.ReactNode {
        const [useExisting, setUseExisting] = React.useState(true);
        const [name, setName] = React.useState('ANTHROPIC_API_KEY');
        return (
          <CheckExistingSecretStep
            useExistingSecret={useExisting}
            secretName={name}
            onToggleUseExistingSecret={v => {
              setUseExisting(v);
              setName(v ? 'ANTHROPIC_API_KEY' : '');
            }}
            onSecretNameChange={setName}
            onSubmit={override => submitted.push(override)}
          />
        );
      }
      const instance = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <Wrapper />
          </KeybindingSetup>
        </AppStateProvider>,
        {
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
          patchConsole: false,
        },
      );
      unmounts.push(() => instance.unmount());
      await new Promise(r => setTimeout(r, 30));

      // Move focus to 'new' so parent state becomes useExisting=false, secretName=''
      stdin.write('\x1b[B');
      await new Promise(r => setTimeout(r, 30));
      // Now Up + Enter in one synchronous burst before React commits useExisting=true
      stdin.write('\x1b[A\r');
      await new Promise(r => setTimeout(r, 40));
      expect(submitted).toEqual([{ useExistingSecret: true, secretName: 'ANTHROPIC_API_KEY' }]);
    }

    // 3. ApiKeyStep: parent state selectedOption='oauth', Up+Enter in one burst passes { selectedApiKeyOption: 'existing' }
    {
      const { stdin, stdout } = makeTtyPair();
      const submitted: Array<unknown> = [];
      const instance = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <ApiKeyStep
              existingApiKey="sk-ant-existing"
              useExistingKey={false}
              apiKeyOrOAuthToken=""
              selectedOption="oauth"
              onApiKeyChange={() => {}}
              onToggleUseExistingKey={() => {}}
              onSelectOption={() => {}}
              onCreateOAuthToken={() => {}}
              onSubmit={override => submitted.push(override)}
            />
          </KeybindingSetup>
        </AppStateProvider>,
        {
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
          patchConsole: false,
        },
      );
      unmounts.push(() => instance.unmount());
      await new Promise(r => setTimeout(r, 30));

      // Up arrow from 'oauth' to 'existing' + Enter in one synchronous burst
      stdin.write('\x1b[A\r');
      await new Promise(r => setTimeout(r, 40));
      expect(submitted).toEqual([{ selectedApiKeyOption: 'existing' }]);
    }

    // 4. Verify install-github-app.tsx consumes all override fields ahead of stale state
    const appSrc = readFileSync(
      join(import.meta.dir, '../../commands/install-github-app/install-github-app.tsx'),
      'utf8',
    );
    expect(appSrc).toContain('override?.useCurrentRepo ?? state.useCurrentRepo');
    expect(appSrc).toContain('override?.useExistingSecret ?? state.useExistingSecret');
    expect(appSrc).toContain('override?.secretName ?? state.secretName');
    expect(appSrc).toContain('override?.selectedApiKeyOption ?? state.selectedApiKeyOption');
  });

  test('BH4-P1-6: BackgroundTaskStatus highlights the viewed teammate by taskId even when active-first sorting reorders pills', async () => {
    const prevLevel = chalk.level;
    chalk.level = 3;
    try {
      const { stdin, stdout, getOutput, clearOutput } = makeTtyPair();
      let setStateFn: ((updater: (prev: any) => any) => void) | null = null;

      const alphaIdle = {
        id: 'task-alpha',
        type: 'in_process_teammate',
        status: 'running',
        isIdle: true,
        identity: { agentName: 'alpha', color: 'blue' },
        startTime: Date.now(),
      } as unknown as TaskState;

      const betaActive = {
        id: 'task-beta',
        type: 'in_process_teammate',
        status: 'running',
        isIdle: false,
        identity: { agentName: 'beta', color: 'green' },
        startTime: Date.now(),
      } as unknown as TaskState;

      function Harness(): React.ReactNode {
        const setAppState = useSetAppState();
        setStateFn = setAppState;
        return <BackgroundTaskStatus tasksSelected={false} />;
      }

      const instance = await render(
        <AppStateProvider>
          <Harness />
        </AppStateProvider>,
        {
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
          patchConsole: false,
        },
      );
      unmounts.push(() => instance.unmount());
      await new Promise(r => setTimeout(r, 30));
      expect(setStateFn).not.toBeNull();

      // Viewing idle 'alpha' while active 'beta' sorts BEFORE 'alpha' in allPills
      clearOutput();
      setStateFn!(prev => ({
        ...prev,
        tasks: { 'task-alpha': alphaIdle, 'task-beta': betaActive },
        viewingAgentTaskId: 'task-alpha',
      }));
      await new Promise(r => setTimeout(r, 50));

      const outAlpha = getOutput();
      const plainAlpha = stripAnsi(outAlpha);
      // Verify active 'beta' is rendered before idle 'alpha'
      expect(plainAlpha.indexOf('@beta')).toBeGreaterThan(-1);
      expect(plainAlpha.indexOf('@alpha')).toBeGreaterThan(plainAlpha.indexOf('@beta'));

      // Verify @alpha has ANSI bold (1m or ;1m) and @beta does NOT have ANSI bold
      // biome-ignore lint/suspicious/noControlCharactersInRegex: inspect ANSI bold SGR around pill text
      const boldAlphaRe = /\x1b\[(?:[0-9;]*;)?1(?:;[0-9;]*)?m[^\x1b]*@alpha/;
      // biome-ignore lint/suspicious/noControlCharactersInRegex: inspect ANSI bold SGR around pill text
      const boldBetaRe = /\x1b\[(?:[0-9;]*;)?1(?:;[0-9;]*)?m[^\x1b]*@beta/;
      expect(outAlpha).toMatch(boldAlphaRe);
      expect(outAlpha).not.toMatch(boldBetaRe);

      // Switch viewingAgentTaskId to 'task-beta' -> now @beta must be bold and @alpha must not
      clearOutput();
      setStateFn!(prev => ({
        ...prev,
        viewingAgentTaskId: 'task-beta',
      }));
      await new Promise(r => setTimeout(r, 50));
      const outBeta = getOutput();
      expect(outBeta).toMatch(boldBetaRe);
      expect(outBeta).not.toMatch(boldAlphaRe);
    } finally {
      chalk.level = prevLevel;
    }
  });
});
