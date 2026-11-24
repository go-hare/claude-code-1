import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { PassThrough } from 'stream';
import { AccessibilityContext, ModalContext, TerminalSizeContext, Text, wrappedRender as render } from '@anthropic/ink';
import instances from '../../../packages/@ant/ink/src/core/instances.js';
import { cellAt, type Screen } from '../../../packages/@ant/ink/src/core/screen.js';
import type { Question } from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { addToTotalSessionCost, resetCostState } from '../../cost-tracker.js';
import { HOST_PARKED_TYPING_QUESTION, HOST_PARKED_TYPING_SUGGESTION } from '../../dialog/hostPark.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { AppStateProvider } from '../../state/AppState.js';
import { type AppState, getDefaultAppState } from '../../state/AppStateStore.js';
import { createStore } from '../../state/store.js';
import { getGlobalConfig } from '../../utils/config.js';
import { explicitSessionEffort } from '../../utils/effort.js';
import { EffortPanel, resetEffortCacheMissAckForTest } from '../EffortPanel/EffortPanel.js';
import { filterModelPickerOptions, ModelEffortSlider, ModelPicker } from '../ModelPicker.js';
import { QuestionView } from '../permissions/AskUserQuestionPermissionRequest/QuestionView.js';
import { SubmitQuestionsView } from '../permissions/AskUserQuestionPermissionRequest/SubmitQuestionsView.js';
import { ExitPlanModePermissionRequest } from '../permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
import type { ToolUseConfirm } from '../permissions/PermissionRequest.js';

const ROOT = join(import.meta.dir, '../../..');

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const csiForwardRe = new RegExp(`${ESC}\\[(\\d*)C`, 'g');
const csiAnyRe = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const oscRe = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');

function stripAnsi(s: string): string {
  return s
    .replace(csiForwardRe, (_, n: string) => ' '.repeat(n ? Number(n) : 1))
    .replace(csiAnyRe, '')
    .replace(oscRe, '');
}

function readScreenText(stdout: NodeJS.WriteStream): string {
  const ink = instances.get(stdout) as unknown as {
    frontFrame?: {
      screen?: Screen;
    };
  };
  const screen = ink?.frontFrame?.screen;
  if (!screen) return '';
  const lines: string[] = [];
  for (let y = 0; y < screen.height; y++) {
    let row = '';
    for (let x = 0; x < screen.width; x++) {
      row += cellAt(screen, x, y)?.char ?? ' ';
    }
    lines.push(row.trimEnd());
  }
  return lines.join('\n');
}

async function flushUi(ms = 45): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

type RenderHarness = {
  getText: () => string;
  getRaw: () => string;
  clearOutput: () => void;
  writeKey: (data: string) => void;
  unmount: () => void;
};

async function mountUi(
  node: React.ReactNode,
  opts?: {
    columns?: number;
    rows?: number;
    appState?: Partial<AppState>;
    modal?: { rows: number; columns: number } | null;
    screenReader?: boolean;
  },
): Promise<RenderHarness> {
  const columns = opts?.columns ?? 100;
  const rows = opts?.rows ?? 30;
  let raw = '';
  const stdout = Object.assign(new PassThrough(), { columns, rows, isTTY: true });
  stdout.on('data', (chunk: Buffer | string) => {
    raw += String(chunk);
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
  const store = createStore<AppState>({
    ...getDefaultAppState(),
    ...(opts?.appState ?? {}),
  });

  const wrappedModal =
    opts?.modal != null ? (
      <ModalContext.Provider value={{ rows: opts.modal.rows, columns: opts.modal.columns, scrollViewport: null }}>
        {node}
      </ModalContext.Provider>
    ) : (
      node
    );

  const wrappedSr =
    opts?.screenReader !== undefined ? (
      <AccessibilityContext.Provider value={opts.screenReader}>{wrappedModal}</AccessibilityContext.Provider>
    ) : (
      wrappedModal
    );

  const instance = await render(
    <TerminalSizeContext.Provider value={{ columns, rows }}>
      <AppStateProvider store={store}>
        <KeybindingSetup>{wrappedSr}</KeybindingSetup>
      </AppStateProvider>
    </TerminalSizeContext.Provider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    },
  );
  await flushUi(50);

  return {
    getText: () => readScreenText(stdout as unknown as NodeJS.WriteStream) || stripAnsi(raw),
    getRaw: () => raw,
    clearOutput: () => {
      raw = '';
    },
    writeKey: (data: string) => {
      stdin.write(data);
    },
    unmount: () => {
      instance.unmount();
    },
  };
}

describe('Official 2.1.328 UI Alignment — Worker U4 (Permissions, ModelPicker, EffortPanel, AskUserQuestion, hostPark)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    resetEffortCacheMissAckForTest();
  });

  describe('Item 1: PermissionDialog framed-card mode & ExitPlanMode modal border suppression', () => {
    test('PermissionDialog supports frame, titleSuffix, hideBorder, marginTop, and hasPanelInset', async () => {
      let cancelled = false;
      const framed = await mountUi(
        <PermissionDialog
          title="Run command"
          subtitle="git status"
          frame={{
            onCancel: () => {
              cancelled = true;
            },
            titleSuffix: 'runs on remote',
            notice: 'Sandbox disabled',
            hints: <Text key="tab">tab to edit</Text>,
          }}
        >
          <Text>Command body</Text>
        </PermissionDialog>,
      );
      cleanups.push(framed.unmount);

      const framedText = framed.getText();
      expect(framedText).toContain('Run command');
      expect(framedText).toContain('· runs on remote');
      expect(framedText).toContain('git status');
      expect(framedText).toContain('Command body');
      expect(framedText).toContain('Sandbox disabled');
      expect(framedText).toContain('esc to cancel');
      expect(framedText).toContain('/permissions');
      expect(framedText).toContain('tab to edit');
      expect(cancelled).toBe(false);

      const hiddenHints = await mountUi(
        <PermissionDialog
          title="Allow network request"
          frame={{
            onCancel: () => {},
            titleSuffix: 'outside of sandbox',
            showHintLine: false,
            showPermissionsHint: false,
          }}
        >
          <Text>Host: example.com</Text>
        </PermissionDialog>,
      );
      cleanups.push(hiddenHints.unmount);
      const hiddenHintsText = hiddenHints.getText();
      expect(hiddenHintsText).toContain('Allow network request');
      expect(hiddenHintsText).toContain('· outside of sandbox');
      expect(hiddenHintsText).not.toContain('/permissions');
      expect(hiddenHintsText).not.toContain('esc to cancel');

      const noBorder = await mountUi(
        <PermissionDialog
          title="Compact Title"
          hideBorder={true}
          marginTop={0}
          hasPanelInset={true}
          titleSuffix="extra"
        >
          <Text>Body line</Text>
        </PermissionDialog>,
      );
      cleanups.push(noBorder.unmount);
      const noBorderText = noBorder.getText();
      expect(noBorderText).toContain('Compact Title');
      expect(noBorderText).toContain('· extra');
      expect(noBorderText).toContain('Body line');
      expect(noBorderText).not.toContain('────');
    });

    test('ExitPlanModePermissionRequest suppresses redundant top border & "Here is Claude\'s plan:" in compact modal and uses "plan saved"', async () => {
      const makeConfirm = (): ToolUseConfirm =>
        ({
          tool: { name: 'ExitPlanModeV1' },
          description: '',
          input: { plan: '# Step 1\nDo the thing.' },
          toolUseID: 'tu-exit-plan-328',
          permissionResult: { behavior: 'ask', message: '' },
          permissionPromptStartTimeMs: 0,
          assistantMessage: { message: {} },
          toolUseContext: {},
          onUserInteraction() {},
          onAbort() {},
          onAllow() {},
          onReject() {},
          async recheckPermission() {},
        }) as unknown as ToolUseConfirm;

      const inlineUi = await mountUi(
        <ExitPlanModePermissionRequest
          toolUseConfirm={makeConfirm()}
          toolUseContext={{} as never}
          onDone={() => {}}
          onReject={() => {}}
          verbose={false}
          workerBadge={undefined}
        />,
        { columns: 90, rows: 30 },
      );
      cleanups.push(inlineUi.unmount);
      const inlineText = inlineUi.getText();
      expect(inlineText).toContain('Ready to code?');
      expect(inlineText).toContain("Here is Claude's plan:");

      const compactModalUi = await mountUi(
        <ExitPlanModePermissionRequest
          toolUseConfirm={makeConfirm()}
          toolUseContext={{} as never}
          onDone={() => {}}
          onReject={() => {}}
          verbose={false}
          workerBadge={undefined}
        />,
        { columns: 90, rows: 24, modal: { rows: 20, columns: 86 } },
      );
      cleanups.push(compactModalUi.unmount);
      const compactModalText = compactModalUi.getText();
      expect(compactModalText).toContain('Ready to code?');
      expect(compactModalText).not.toContain("Here is Claude's plan:");

      const exitPlanSrc = readFileSync(
        join(ROOT, 'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx'),
        'utf8',
      );
      expect(exitPlanSrc).toContain('plan saved');
      expect(exitPlanSrc).not.toContain('Plan saved!');
      expect(exitPlanSrc).toContain('hideBorder={compactModal}');
      expect(exitPlanSrc).toContain('marginTop={modalMarginTop}');
    });
  });

  describe('Item 2: ModelPicker official 2.1.328 alignment', () => {
    test('filterModelPickerOptions filters by label and ANSI-stripped description', () => {
      const opts = [
        { label: 'Sonnet', description: '\x1b[33mEveryday\x1b[0m coding' },
        { label: 'Opus', description: 'Deep reasoning' },
        { label: 'Haiku', description: 'Fast lightweight' },
      ];
      expect(filterModelPickerOptions(opts, '')).toHaveLength(3);
      expect(filterModelPickerOptions(opts, 'haiku').map(o => o.label)).toEqual(['Haiku']);
      expect(filterModelPickerOptions(opts, 'everyday').map(o => o.label)).toEqual(['Sonnet']);
      expect(filterModelPickerOptions(opts, 'does-not-exist')).toEqual([]);
    });

    test('ModelEffortSlider renders official r6 dot slider with arrows and label', async () => {
      const ui = await mountUi(
        <ModelEffortSlider
          effort="high"
          defaultEffort="high"
          levels={['low', 'medium', 'high', 'max']}
          isAdjustable={true}
        />,
      );
      cleanups.push(ui.unmount);
      const text = ui.getText();
      expect(text).toContain('Effort High (default)');
      expect(text).toContain('←');
      expect(text).toContain('● ● ● ○');
      expect(text).toContain('→');
    });

    test('ModelPicker renders permission title, updated subtitle/fast-mode copy, italic footer order, search box, and preserves Enter vs s onSetDefault contract', async () => {
      const pickerSrc = readFileSync(join(ROOT, 'src/components/ModelPicker.tsx'), 'utf8');
      expect(pickerSrc).toContain('<Text color="permission" bold>');
      expect(pickerSrc).not.toContain('<Text color="remember" bold>');
      expect(pickerSrc).toContain('<Text dimColor italic>');
      expect(pickerSrc).toContain('Fast mode is on (/fast). Switching models can turn it off.');
      expect(pickerSrc).not.toContain('Fast mode is <Text bold>ON</Text>');

      const defaultCalls: Array<string | null> = [];
      const selectCalls: Array<string | null> = [];

      const ui = await mountUi(
        <ModelPicker
          initial={null}
          onSelect={model => selectCalls.push(model)}
          onSetDefault={model => defaultCalls.push(model)}
          onCancel={() => {}}
          isStandaloneCommand
          showFastModeNotice
        />,
        { columns: 100, rows: 35 },
      );
      cleanups.push(ui.unmount);

      const initialText = ui.getText();
      expect(initialText).toContain('Select model');
      expect(initialText).toContain('Your pick is the default for new sessions. For other models, use --model.');
      expect(initialText).toContain('Search models…');
      // Shortcut order: `s to use this session only` appears before `Enter to set as default`
      const sIdx = initialText.indexOf('s to use this session only');
      const slashIdx = initialText.indexOf('/ to search');
      const enterIdx = initialText.indexOf('Enter to set as default');
      expect(sIdx).toBeGreaterThan(-1);
      expect(slashIdx).toBeGreaterThan(sIdx);
      expect(enterIdx).toBeGreaterThan(slashIdx);

      // Interactive `/` search filter with zero matches shows `No models match "..."`
      ui.clearOutput();
      ui.writeKey('/');
      await flushUi(30);
      ui.writeKey('zzzznope');
      await flushUi(50);
      expect(ui.getText()).toContain('No models match "zzzznope"');

      // Esc clears query; second Esc exits search mode cleanly back to list
      ui.writeKey('\x1b');
      await flushUi(100);
      ui.writeKey('\x1b');
      await flushUi(100);

      // Press `s` (session-only) -> calls onSelect WITHOUT calling onSetDefault
      ui.writeKey('s');
      await flushUi(60);
      expect(selectCalls.length).toBe(1);
      expect(defaultCalls.length).toBe(0);

      // Mount second picker and press Enter -> calls BOTH onSetDefault and onSelect
      const ui2 = await mountUi(
        <ModelPicker
          initial={null}
          onSelect={model => selectCalls.push(model)}
          onSetDefault={model => defaultCalls.push(model)}
          onCancel={() => {}}
          isStandaloneCommand
        />,
        { columns: 100, rows: 35 },
      );
      cleanups.push(ui2.unmount);
      ui2.writeKey('\r');
      await flushUi(40);
      expect(defaultCalls.length).toBe(1);
      expect(selectCalls.length).toBe(2);
    });
  });

  describe('Item 3: EffortPanel official 2.1.328 alignment', () => {
    test('uses permission title color, italic footer with s before Enter to save, and narrow-terminal carousel fallback', async () => {
      const panelSrc = readFileSync(join(ROOT, 'src/components/EffortPanel/EffortPanel.tsx'), 'utf8');
      expect(panelSrc).toContain('<Text bold color="permission">');
      expect(panelSrc).not.toContain('<Text bold color="suggestion">');
      expect(panelSrc).toContain('<Text dimColor italic>');

      const wideUi = await mountUi(<EffortPanel appStateEffort="medium" onDone={() => {}} />, {
        columns: 80,
        rows: 24,
        appState: {
          mainLoopModel: 'claude-opus-4-7',
          sessionEffort: explicitSessionEffort('medium'),
        },
      });
      cleanups.push(wideUi.unmount);
      const wideText = wideUi.getText();
      expect(wideText).toContain('Effort');
      expect(wideText).toContain('Faster');
      expect(wideText).toContain('Smarter');
      const sPos = wideText.indexOf('s to use this session only');
      const savePos = wideText.indexOf('Enter to save');
      expect(sPos).toBeGreaterThan(-1);
      expect(savePos).toBeGreaterThan(sPos);

      // Narrow terminal (< slider width + 4) switches to `‹ level ›` carousel
      const narrowUi = await mountUi(<EffortPanel appStateEffort="medium" onDone={() => {}} />, {
        columns: 36,
        rows: 24,
        appState: {
          mainLoopModel: 'claude-opus-4-7',
          sessionEffort: explicitSessionEffort('medium'),
        },
      });
      cleanups.push(narrowUi.unmount);
      const narrowText = narrowUi.getText();
      expect(narrowText).toContain('‹ medium ›');
      expect(narrowText).not.toContain('Faster');
    });

    test('suppresses s and switches Enter to "use this session only" on max or CLAUDE_CODE_EFFORT_LEVEL env override', async () => {
      const maxUi = await mountUi(<EffortPanel appStateEffort="max" onDone={() => {}} />, {
        columns: 80,
        rows: 24,
        appState: {
          mainLoopModel: 'claude-opus-4-7',
          sessionEffort: explicitSessionEffort('max'),
        },
      });
      cleanups.push(maxUi.unmount);
      const maxText = maxUi.getText();
      expect(maxText).toContain('Enter to use this session only');
      expect(maxText).not.toContain('s to use this session only');
      expect(maxText).not.toContain('Enter to save');

      const prevEnv = process.env.CLAUDE_CODE_EFFORT_LEVEL;
      process.env.CLAUDE_CODE_EFFORT_LEVEL = 'low';
      cleanups.push(() => {
        if (prevEnv === undefined) delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
        else process.env.CLAUDE_CODE_EFFORT_LEVEL = prevEnv;
      });
      const envUi = await mountUi(<EffortPanel appStateEffort="low" onDone={() => {}} />, {
        columns: 80,
        rows: 24,
        appState: {
          mainLoopModel: 'claude-opus-4-7',
          sessionEffort: explicitSessionEffort('low'),
        },
      });
      cleanups.push(envUi.unmount);
      const envText = envUi.getText();
      expect(envText).toContain('Enter to use this session only');
      expect(envText).not.toContain('s to use this session only');
    });

    test('shows mid-conversation warm-cache confirmation dialog (bfe) before committing cache-busting effort change', async () => {
      resetCostState();
      cleanups.push(() => resetCostState());
      addToTotalSessionCost(
        0.01,
        {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use: null,
          service_tier: null,
          cache_creation: null,
          inference_geo: null,
          iterations: null,
          speed: null,
        } as never,
        'claude-opus-4-5-20251101',
      );

      const doneMessages: string[] = [];
      const ui = await mountUi(
        <EffortPanel appStateEffort="high" promptCacheMayBeWarm={true} onDone={msg => doneMessages.push(msg)} />,
        {
          columns: 90,
          rows: 24,
          appState: {
            mainLoopModel: 'claude-opus-4-5-20251101',
            sessionEffort: explicitSessionEffort('high'),
          },
        },
      );
      cleanups.push(ui.unmount);

      // Move left from high -> medium and press Enter
      ui.clearOutput();
      ui.writeKey('\x1b[D');
      await flushUi(35);
      ui.writeKey('\r');
      await flushUi(60);

      const confirmText = ui.getText();
      expect(doneMessages).toHaveLength(0);
      expect(confirmText).toContain('Change effort level?');
      expect(confirmText).toContain('Your next response will be slower and use more tokens');
      expect(confirmText).toContain('Yes, switch to medium');
      expect(confirmText).toContain('No, go back');

      // Press Esc on confirmation dialog -> returns to effort slider without calling onDone
      ui.writeKey('\x1b');
      await flushUi(120);
      expect(doneMessages).toHaveLength(0);
      expect(ui.getText()).toContain('Faster');

      // Confirm again and accept ("Yes, switch to medium")
      ui.writeKey('\r');
      await flushUi(80);
      ui.writeKey('\r');
      await flushUi(80);
      expect(doneMessages.length).toBe(1);
    });
  });

  describe('Item 4: SubmitQuestionsView single divider & warning copy', () => {
    test('renders single horizontal rule (no borderTop below Divider) and "Some questions are unanswered"', async () => {
      const submitSrc = readFileSync(
        join(ROOT, 'src/components/permissions/AskUserQuestionPermissionRequest/SubmitQuestionsView.tsx'),
        'utf8',
      );
      expect(submitSrc).not.toContain('borderTop');
      expect(submitSrc).toContain('Some questions are unanswered');
      expect(submitSrc).not.toContain('You have not answered all questions');

      const questions: Question[] = [
        {
          question: 'Pick a color?',
          header: 'Color',
          options: [{ label: 'Blue', description: 'Sky' }],
          multiSelect: false,
        },
      ];
      const ui = await mountUi(
        <SubmitQuestionsView
          questions={questions}
          currentQuestionIndex={1}
          answers={{}}
          allQuestionsAnswered={false}
          permissionResult={{ behavior: 'ask', message: '' }}
          onFinalResponse={() => {}}
        />,
      );
      cleanups.push(ui.unmount);
      const text = ui.getText();
      expect(text).toContain('Some questions are unanswered');
      expect(text).not.toContain('You have not answered all questions');
      // Only one continuous horizontal rule line at the top
      const dividerLines = text.split('\n').filter(line => /─{10,}/.test(line));
      expect(dividerLines.length).toBe(1);
    });
  });

  describe('Item 5: QuestionView Vim mode indicator & Escape hint suppression', () => {
    test('shows -- INSERT -- and suppresses Esc to cancel when vim mode is active in Other input, then restores on Esc', async () => {
      const cfg = getGlobalConfig() as { editorMode?: 'default' | 'vim' | 'normal' };
      const prevEditorMode = cfg.editorMode;
      cfg.editorMode = 'vim';
      cleanups.push(() => {
        cfg.editorMode = prevEditorMode;
      });

      let cancelCount = 0;
      const question: Question = {
        question: 'What next?',
        header: 'Next',
        options: [
          { label: 'Ship it', description: 'Deploy' },
          { label: 'Iterate', description: 'Refine' },
        ],
        multiSelect: false,
      };

      const ui = await mountUi(
        <QuestionView
          question={question}
          questions={[question]}
          currentQuestionIndex={0}
          answers={{}}
          questionStates={{ 'What next?': { selectedValue: '__other__', textInputValue: '' } }}
          onUpdateQuestionState={() => {}}
          onAnswer={() => {}}
          onTextInputFocus={() => {}}
          onCancel={() => {
            cancelCount++;
          }}
          onSubmit={() => {}}
          onRespondToClaude={() => {}}
        />,
        { columns: 100, rows: 24 },
      );
      cleanups.push(ui.unmount);

      const insertText = ui.getText();
      expect(insertText).toContain('-- INSERT --');
      expect(insertText).not.toContain('Esc to cancel');

      // First Esc exits vim INSERT -> NORMAL without cancelling
      ui.writeKey('\x1b');
      await flushUi(120);
      expect(cancelCount).toBe(0);
      const normalText = ui.getText();
      expect(normalText).not.toContain('-- INSERT --');
      expect(normalText).toContain('Esc to cancel');

      // Second Esc cancels QuestionView
      ui.writeKey('\x1b');
      await flushUi(120);
      expect(cancelCount).toBe(1);
    });
  });

  describe('Item 6: hostPark.ts draft-parked cue punctuation', () => {
    test('uses sentence punctuation (". It shows...") matching official VOt/KOt', () => {
      expect(HOST_PARKED_TYPING_QUESTION).toBe(
        "Claude has a question for you. It shows once you send or clear what you're typing.",
      );
      expect(HOST_PARKED_TYPING_SUGGESTION).toBe(
        "Claude has a suggestion for you. It shows once you send or clear what you're typing.",
      );
    });
  });
});
