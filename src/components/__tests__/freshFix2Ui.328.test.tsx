import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { CuPermissionRequest, CuPermissionResponse, ResolvedAppRequest } from '@ant/computer-use-mcp/types';
import { DEFAULT_GRANT_FLAGS } from '@ant/computer-use-mcp/types';
import * as React from 'react';
import { wrappedRender as render } from '@anthropic/ink';
import { ApiKeyStep } from '../../commands/install-github-app/ApiKeyStep.js';
import { CheckExistingSecretStep } from '../../commands/install-github-app/CheckExistingSecretStep.js';
import { ChooseRepoStep } from '../../commands/install-github-app/ChooseRepoStep.js';
import {
  AutoDefaultNudgeDialog,
  consumePendingAutoDefaultNudgeDraft,
} from '../../dialog/dialogs/AutoDefaultNudgeDialog.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { AppStateProvider } from '../../state/AppState.js';
import { CONFIRM_SELECT_ARM_MS } from '../ConfirmSelect.js';
import { ConsoleOAuthFlow } from '../ConsoleOAuthFlow.js';
import { Select } from '../CustomSelect/select.js';
import { isEscapeThenKeyDecline } from '../CustomSelect/use-select-input.js';
import {
  ComputerUseApproval,
  selectVisibleComputerUseApps,
} from '../permissions/ComputerUseApproval/ComputerUseApproval.js';

function makeTtyPair(dims: { columns?: number; rows?: number } = {}) {
  const chunks: string[] = [];
  const stdout = Object.assign(new PassThrough(), {
    columns: dims.columns ?? 120,
    rows: dims.rows ?? 40,
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

function makeApp(bundleId: string, displayName: string, isSentinel = false): ResolvedAppRequest {
  return {
    requestedName: displayName,
    resolved: {
      bundleId,
      displayName,
      path: `/Applications/${displayName}.app`,
    },
    isSentinel,
    alreadyGranted: false,
    proposedTier: 'full',
  };
}

describe('Fresh Fix 2 — UI B Regressions', () => {
  const unmounts: Array<() => void> = [];

  afterEach(() => {
    consumePendingAutoDefaultNudgeDraft();
    while (unmounts.length > 0) {
      unmounts.pop()?.();
    }
  });

  test('B-P0-1: selectVisibleComputerUseApps prioritizes 2-row sentinel apps and reserves 1 row for overflow warning', () => {
    const apps: ResolvedAppRequest[] = [
      makeApp('com.example.one', 'AppOne'),
      makeApp('com.example.two', 'AppTwo'),
      makeApp('com.example.three', 'AppThree'),
      makeApp('com.apple.Terminal', 'Terminal', true),
    ];
    // Total rows = 1 + 1 + 1 + 2 = 5 > budget 4 -> maxContentRows = 3:
    // Terminal (2 rows) + AppOne (1 row) = 3 rows, preserving original order [AppOne, Terminal].
    const packed = selectVisibleComputerUseApps(apps, 4);
    expect(packed.hiddenCount).toBe(2);
    expect(packed.visibleApps.map(a => a.resolved?.bundleId)).toEqual(['com.example.one', 'com.apple.Terminal']);
  });

  test('B-P0-1: ComputerUseApproval excludes hidden overflow apps from checked count, grant, and user_denied', async () => {
    // rows: 16, reservedRows: 12 (no reason/flags) -> appRowBudget = 4 -> maxContentRows = 3
    const { stdin, stdout, getOutput } = makeTtyPair({ columns: 120, rows: 16 });
    const responses: CuPermissionResponse[] = [];
    const request: CuPermissionRequest = {
      requestId: 'req-cu-overflow',
      reason: '',
      screenshotFiltering: 'native',
      apps: [
        makeApp('com.example.one', 'AppOne'),
        makeApp('com.example.two', 'AppTwo'),
        makeApp('com.example.three', 'AppThree'),
        makeApp('com.apple.Terminal', 'Terminal', true),
      ],
      requestedFlags: { ...DEFAULT_GRANT_FLAGS },
    };

    const instance = await render(
      <AppStateProvider>
        <KeybindingSetup>
          <ComputerUseApproval request={request} onDone={resp => responses.push(resp)} />
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

    const rendered = stripAnsi(getOutput());
    expect(rendered).toContain('Terminal');
    expect(rendered).toContain('AppOne');
    expect(rendered).not.toContain('AppTwo');
    expect(rendered).not.toContain('AppThree');
    expect(rendered).toContain('… +2 more apps not shown, and not included in this grant.');
    expect(rendered).toContain('Allow for this session (2 apps)');

    // Wait past arming window, move from 'deny' to 'allow_all', and confirm
    await new Promise(r => setTimeout(r, CONFIRM_SELECT_ARM_MS + 60));
    stdin.write('\x1b[B');
    await new Promise(r => setTimeout(r, 30));
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 40));

    expect(responses).toHaveLength(1);
    const resp = responses[0]!;
    expect(resp.granted.map(g => g.bundleId)).toEqual(['com.example.one', 'com.apple.Terminal']);
    // Hidden apps must NOT be granted AND must NOT be recorded as user_denied
    expect(resp.denied).toEqual([]);
  });

  test('B-P1-2: Select #558 declines on unbound Alt+X without hijacking bound Alt+T or Alt+Up/Down', async () => {
    // Unit checks on isEscapeThenKeyDecline
    expect(
      isEscapeThenKeyDecline('up', { meta: true, upArrow: true }, { hasDeclinePrompt: true, isInInput: false }),
    ).toBe(false);
    expect(isEscapeThenKeyDecline('down', { meta: true }, { hasDeclinePrompt: true, isInInput: false })).toBe(false);
    expect(isEscapeThenKeyDecline('return', { meta: true }, { hasDeclinePrompt: true, isInInput: false })).toBe(false);
    expect(
      isEscapeThenKeyDecline('t', { meta: true }, { hasDeclinePrompt: true, isInInput: false, isBoundShortcut: true }),
    ).toBe(false);
    expect(
      isEscapeThenKeyDecline('x', { meta: true }, { hasDeclinePrompt: true, isInInput: false, isBoundShortcut: false }),
    ).toBe(true);

    // Full Ink render with KeybindingSetup + bound chat:thinkingToggle (meta+t)
    const { stdin, stdout } = makeTtyPair();
    let thinkingToggled = 0;
    let cancelled = 0;

    function PromptWithShortcut(): React.ReactNode {
      useKeybinding(
        'chat:thinkingToggle',
        () => {
          thinkingToggled += 1;
        },
        { context: 'Chat' },
      );
      return (
        <Select
          options={[
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
          ]}
          declineValue="no"
          disablePrintableKeybindings
          onChange={() => {}}
          onCancel={() => {
            cancelled += 1;
          }}
        />
      );
    }

    const instance = await render(
      <AppStateProvider>
        <KeybindingSetup>
          <PromptWithShortcut />
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

    // Bound Alt+T must invoke chat:thinkingToggle and NOT cancel the Select
    stdin.write('\x1bt');
    await new Promise(r => setTimeout(r, 60));
    expect(thinkingToggled).toBe(1);
    expect(cancelled).toBe(0);

    // Alt+Up / Alt+Down must NOT cancel the Select
    stdin.write('\x1b[1;3A');
    await new Promise(r => setTimeout(r, 40));
    stdin.write('\x1b[1;3B');
    await new Promise(r => setTimeout(r, 40));
    expect(cancelled).toBe(0);

    // Unbound single-char printable Alt+X MUST decline/cancel the Select
    stdin.write('\x1bx');
    await new Promise(r => setTimeout(r, 60));
    expect(cancelled).toBe(1);
  });

  test('B-P1-3: AutoDefaultNudgeDialog aligns copy 1:1, hides indexes, allows early arrows via refuseInput, and captures paste', async () => {
    // 1. Copy, hideIndexes, and early arrow navigation while Enter is refused
    {
      const { stdin, stdout, getOutput } = makeTtyPair();
      const answers: string[] = [];
      const instance = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <AutoDefaultNudgeDialog currentMode="acceptEdits" onAnswer={r => answers.push(r)} />
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

      const out = stripAnsi(getOutput());
      expect(out).toContain('Make auto mode your default permission mode?');
      expect(out).toContain(
        'Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions',
      );
      expect(out).toContain('Yes, set auto mode as my default permission mode');
      expect(out).toContain('No, keep Accept edits');
      expect(out).not.toContain('1. Yes, set auto mode');
      expect(out).not.toContain('2. No, keep');

      // During the arming settle window, Down arrow moves focus to 'declined' while Enter is refused
      stdin.write('\x1b[B');
      await new Promise(r => setTimeout(r, 20));
      stdin.write('\r');
      await new Promise(r => setTimeout(r, 20));
      expect(answers).toEqual([]);

      // After settle window expires, Enter submits the option navigated to during the settle window
      await new Promise(r => setTimeout(r, CONFIRM_SELECT_ARM_MS + 60));
      stdin.write('\r');
      await new Promise(r => setTimeout(r, 40));
      expect(answers).toEqual(['declined']);
    }

    // 2. Bracketed paste captured into stray draft and locks Enter until navigation
    {
      const { stdin, stdout } = makeTtyPair();
      const answers: string[] = [];
      const instance = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <AutoDefaultNudgeDialog currentMode="default" onAnswer={r => answers.push(r)} />
          </KeybindingSetup>
        </AppStateProvider>,
        {
          stdin: stdin as unknown as NodeJS.ReadStream,
          stdout: stdout as unknown as NodeJS.WriteStream,
          patchConsole: false,
        },
      );
      unmounts.push(() => instance.unmount());
      await new Promise(r => setTimeout(r, CONFIRM_SELECT_ARM_MS + 60));

      stdin.write('\x1b[200~pasted prompt\x1b[201~');
      await new Promise(r => setTimeout(r, 40));

      // Enter is locked after paste
      stdin.write('\r');
      await new Promise(r => setTimeout(r, 30));
      expect(answers).toEqual([]);

      // Down arrow unlocks Enter; Enter commits 'declined' and flushes pasted draft
      stdin.write('\x1b[B');
      await new Promise(r => setTimeout(r, 30));
      stdin.write('\r');
      await new Promise(r => setTimeout(r, 40));
      expect(answers).toEqual(['declined']);
      expect(consumePendingAutoDefaultNudgeDraft()).toBe('pasted prompt');
    }
  });

  test('B-P1-4 & B-P1-5: ApiKeyStep paste moves cursor to end, and isDisabled blocks submit/cancel during isCheckingSecret', async () => {
    // 1. Paste sets cursorOffset to trimmed.length so subsequent typing appends at the end
    {
      const { stdin, stdout } = makeTtyPair();
      const submitted: Array<unknown> = [];
      function Harness(): React.ReactNode {
        const [key, setKey] = React.useState('');
        return (
          <ApiKeyStep
            existingApiKey={null}
            useExistingKey={false}
            apiKeyOrOAuthToken={key}
            onApiKeyChange={setKey}
            onToggleUseExistingKey={() => {}}
            onSubmit={override => submitted.push(override)}
          />
        );
      }
      const instance = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <Harness />
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

      stdin.write('\x1b[200~  sk-ant-123  \x1b[201~');
      await new Promise(r => setTimeout(r, 40));
      stdin.write('X');
      await new Promise(r => setTimeout(r, 30));
      stdin.write('\r');
      await new Promise(r => setTimeout(r, 40));
      expect(submitted).toEqual([{ selectedApiKeyOption: 'new', apiKeyOrOAuthToken: 'sk-ant-123X' }]);
    }

    // 2. isDisabled blocks submit and Esc while secret check is in flight
    {
      const { stdin, stdout } = makeTtyPair();
      let submitCount = 0;
      let cancelCount = 0;
      const instance = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <ApiKeyStep
              existingApiKey="sk-ant-existing"
              useExistingKey={true}
              apiKeyOrOAuthToken=""
              onApiKeyChange={() => {}}
              onToggleUseExistingKey={() => {}}
              onSubmit={() => {
                submitCount += 1;
              }}
              onCancel={() => {
                cancelCount += 1;
              }}
              isDisabled={true}
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

      stdin.write('\r');
      await new Promise(r => setTimeout(r, 30));
      stdin.write('\x1b');
      await new Promise(r => setTimeout(r, 60));
      expect(submitCount).toBe(0);
      expect(cancelCount).toBe(0);
    }

    // 3. install-github-app.tsx guards handleSubmit with isCheckingSecret, passes isDisabled, and ignores stale resolutions
    const appSrc = readFileSync(
      join(import.meta.dir, '../../commands/install-github-app/install-github-app.tsx'),
      'utf8',
    );
    expect(appSrc).toContain('if (state.isCheckingSecret || isCheckingSecretRef.current)');
    expect(appSrc).toContain('isDisabled={Boolean(state.isCheckingSecret)}');
    expect(appSrc).toContain('if (unmountedRef.current || secretCheckGenRef.current !== checkGen');
  });

  test('B-P2-6: ConsoleOAuthFlow BedrockAccessKeysStep preserves submittedValue on burst submit & ChinaApiKeyStep resets cursor', async () => {
    const oauthSrc = readFileSync(join(import.meta.dir, '../ConsoleOAuthFlow.tsx'), 'utf8');
    // ChinaApiKeyStep resets chinaKeyCursor alongside chinaKeyValue
    const chinaIdx = oauthSrc.indexOf("if (modelId === '__custom__')");
    expect(chinaIdx).toBeGreaterThan(0);
    const chinaBlock = oauthSrc.slice(chinaIdx, chinaIdx + 360);
    expect(chinaBlock).toContain("setChinaKeyValue('');");
    expect(chinaBlock).toContain('setChinaKeyCursor(0);');

    // BedrockAccessKeysStep forwards submittedValue in all 3 fields and handleApplyCredentials
    const bedrockStart = oauthSrc.indexOf('function BedrockAccessKeysStep(');
    const bedrockEnd = oauthSrc.indexOf('type CustomPlatformStatus', bedrockStart);
    const bedrockBody = oauthSrc.slice(bedrockStart, bedrockEnd);
    expect(bedrockBody).toContain('(submittedSessionToken?: string)');
    expect(bedrockBody).toContain('const nextAccessKeyId = submittedValue ?? oauthStatus.accessKeyId;');
    expect(bedrockBody).toContain('const nextSecretAccessKey = submittedValue ?? oauthStatus.secretAccessKey;');
    expect(bedrockBody).toContain('onSubmit={submittedValue => handleApplyCredentials(submittedValue)}');

    // Runtime burst test: open Bedrock access keys and submit Access key ID in a single synchronous burst
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

    // Enter platform_setup -> Amazon Bedrock
    stdin.write('8');
    await new Promise(r => setTimeout(r, 60));
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 60));

    // Type Access key ID + Enter in one synchronous burst (before React commits onChange).
    // Avoid characters overlapping the "AKIA…" placeholder so Ink's diff renderer emits the full value.
    clearOutput();
    stdin.write('WXYZ12345\r');
    await new Promise(r => setTimeout(r, 60));
    const afterBurst = stripAnsi(getOutput());
    expect(afterBurst).toContain('WXYZ12345');
  });

  test('B-P2-7: CheckExistingSecretStep and ChooseRepoStep reset cursorOffset on switching to text input', async () => {
    // 1. CheckExistingSecretStep
    {
      const { stdin, stdout } = makeTtyPair();
      const submitted: Array<unknown> = [];
      function Harness(): React.ReactNode {
        const [useExisting, setUseExisting] = React.useState(true);
        const [secretName, setSecretName] = React.useState('ANTHROPIC_API_KEY');
        return (
          <CheckExistingSecretStep
            useExistingSecret={useExisting}
            secretName={secretName}
            onToggleUseExistingSecret={v => {
              setUseExisting(v);
              setSecretName(v ? 'ANTHROPIC_API_KEY' : '');
            }}
            onSecretNameChange={setSecretName}
            onSubmit={override => submitted.push(override)}
          />
        );
      }
      const instance = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <Harness />
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

      // Move to 'New secret name', Enter to start editing, type name and submit
      stdin.write('\x1b[B');
      await new Promise(r => setTimeout(r, 30));
      stdin.write('\r');
      await new Promise(r => setTimeout(r, 30));
      stdin.write('MY_CUSTOM_KEY\r');
      await new Promise(r => setTimeout(r, 40));
      expect(submitted).toEqual([{ useExistingSecret: false, secretName: 'MY_CUSTOM_KEY' }]);
    }

    // 2. ChooseRepoStep
    {
      const { stdin, stdout } = makeTtyPair();
      const submitted: Array<unknown> = [];
      function Harness(): React.ReactNode {
        const [useCurrent, setUseCurrent] = React.useState(true);
        const [repoUrl, setRepoUrl] = React.useState('owner/existing-repo');
        return (
          <ChooseRepoStep
            currentRepo="owner/existing-repo"
            useCurrentRepo={useCurrent}
            repoUrl={repoUrl}
            onToggleUseCurrentRepo={v => {
              setUseCurrent(v);
              setRepoUrl(v ? 'owner/existing-repo' : '');
            }}
            onRepoUrlChange={setRepoUrl}
            onSubmit={override => submitted.push(override)}
          />
        );
      }
      const instance = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <Harness />
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

      // Move to 'Another repository', Enter to start editing, type repo and submit
      stdin.write('\x1b[B');
      await new Promise(r => setTimeout(r, 30));
      stdin.write('\r');
      await new Promise(r => setTimeout(r, 30));
      stdin.write('acme/new-repo\r');
      await new Promise(r => setTimeout(r, 40));
      expect(submitted).toEqual([{ useCurrentRepo: false, selectedRepoName: 'acme/new-repo' }]);
    }
  });
});
