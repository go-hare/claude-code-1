import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { useEffect } from 'react';
import Ink from '../../../../packages/@ant/ink/src/core/ink.js';
import { useArrowKeyHistory } from '../../../hooks/useArrowKeyHistory.js';
import { usePromptSuggestion } from '../../../hooks/usePromptSuggestion.js';
import { AppStateProvider, useAppState } from '../../../state/AppState.js';
import { type AppState, getDefaultAppState } from '../../../state/AppStateStore.js';
import { createStore } from '../../../state/store.js';
import type { PastedContent } from '../../../utils/config.js';
import { useMaybeTruncateInput } from '../useMaybeTruncateInput.js';

const ROOT = join(import.meta.dir, '../../../..');

function makeFakeStream() {
  const ee = new EventEmitter() as unknown as NodeJS.WriteStream & NodeJS.ReadStream;
  (ee as unknown as { isTTY: boolean }).isTTY = false;
  (ee as unknown as { columns: number }).columns = 80;
  (ee as unknown as { rows: number }).rows = 24;
  (ee as unknown as { write: (s: string) => boolean }).write = () => true;
  (ee as unknown as { setEncoding: () => void }).setEncoding = () => {};
  (ee as unknown as { ref: () => void }).ref = () => {};
  (ee as unknown as { unref: () => void }).unref = () => {};
  (ee as unknown as { read: () => null }).read = () => null;
  return ee;
}

function createTestInk(): Ink {
  return new Ink({
    stdout: makeFakeStream(),
    stdin: makeFakeStream(),
    stderr: makeFakeStream(),
    exitOnCtrlC: false,
    patchConsole: false,
  });
}

describe('UI Data-Flow Wave 2 — PromptInput / History / Typeahead / Truncation regressions', () => {
  test('P2-D2-15: useMaybeTruncateInput advances nextPasteIdRef past truncation-allocated ID', async () => {
    const nextPasteIdRef = { current: 1 };
    let latestInput = 'a'.repeat(10_050);
    let latestPasted: Record<number, PastedContent> = {};

    function Harness({ value, pasted }: { value: string; pasted: Record<number, PastedContent> }) {
      useMaybeTruncateInput({
        input: value,
        pastedContents: pasted,
        onInputChange: v => {
          latestInput = v;
        },
        setCursorOffset: () => {},
        setPastedContents: next => {
          latestPasted = next;
        },
        nextPasteIdRef,
      });
      return null;
    }

    const ink = createTestInk();
    ink.render(<Harness value={latestInput} pasted={latestPasted} />);
    try {
      await new Promise(r => setTimeout(r, 30));
      expect(latestInput).toContain('[...Truncated text #1');
      expect(latestPasted[1]?.type).toBe('text');
      // Next paste must allocate ID 2 (not overwrite #1)
      expect(nextPasteIdRef.current).toBe(2);
    } finally {
      ink.unmount();
    }
  });

  test('P1-D2-6: useArrowKeyHistory in bash mode preserves index & draft and never underflows to -1', async () => {
    type Api = ReturnType<typeof useArrowKeyHistory>;
    let api: Api | null = null;
    let currentValue = 'git st';
    let currentMode: 'prompt' | 'bash' = 'bash';

    function Harness({ value, mode }: { value: string; mode: 'prompt' | 'bash' }) {
      api = useArrowKeyHistory(
        (v, m) => {
          currentValue = v;
          currentMode = m === 'bash' ? 'bash' : 'prompt';
        },
        value,
        {},
        undefined,
        mode,
      );
      return null;
    }

    const ink = createTestInk();
    ink.render(
      <AppStateProvider>
        <Harness value={currentValue} mode={currentMode} />
      </AppStateProvider>,
    );
    try {
      await new Promise(r => setTimeout(r, 20));
      expect(api).not.toBeNull();

      // Trigger first Up in bash mode
      api!.onHistoryUp();
      await new Promise(r => setTimeout(r, 40));

      // If history had bash entries, index is 1 and Down returns cleanly to saved draft;
      // if history had 0 bash entries, index rolled back cleanly to 0 (never -1).
      if (api!.historyIndex === 1) {
        const atBottom = api!.onHistoryDown();
        expect(atBottom).toBe(false);
        expect(currentValue).toBe('git st');
        expect(currentMode).toBe('bash');
      } else {
        expect(api!.historyIndex).toBe(0);
        expect(currentValue).toBe('git st');
        const atBottom = api!.onHistoryDown();
        expect(atBottom).toBe(true);
      }

      // Source invariant: cache invalidation never resets historyIndexRef to 0 and rollback clamps >= 0
      const historySrc = readFileSync(join(ROOT, 'src/hooks/useArrowKeyHistory.tsx'), 'utf8');
      expect(historySrc).toContain('historyIndexRef.current = Math.max(0, historyIndexRef.current - 1);');
      expect(historySrc).not.toContain(
        'historyCacheModeFilter.current = modeFilter;\n        historyIndexRef.current = 0;',
      );
    } finally {
      ink.unmount();
    }
  });

  test('P0-D2-1, P0-D4-1, P1-D1-6, P1-D2-1, P1-D2-5, P2-D1-17, P2-D2-15, P2-D2-17: PromptInput & QuestionView invariants', () => {
    const promptSrc = readFileSync(join(ROOT, 'src/components/PromptInput/PromptInput.tsx'), 'utf8');

    // P0-D2-1 & P1-7: empty/queueEditIndex/named_agent chat:sendNow passes sendQueuedOnly: true
    expect(promptSrc).toContain(
      "if (submitOptions?.sendNow && (state.queueEditIndex !== null || (inputParam.trim() === '' && !hasImages))) {",
    );
    expect(promptSrc.split('{ sendNow: true, sendQueuedOnly: true }').length - 1).toBe(3);

    // P0-D4-1: hostBlocksKeys unblocks typing when DialogHost is parked behind draft
    expect(promptSrc).toContain('const hostBlocksKeys = useHasBlockingOpenDialogs() && !isDialogParked;');

    // P1-D1-6 & P2-7: markShown() runs in useEffect and re-fires when replacement suggestions arrive with shownAt === 0
    expect(promptSrc).toContain(
      'const promptSuggestionUnshown = promptSuggestionState.shownAt === 0;\n  useEffect(() => {\n    if (showPromptSuggestion && promptSuggestionUnshown) {\n      markShown();\n    }\n  }, [showPromptSuggestion, promptSuggestionUnshown, promptSuggestionState.text, markShown]);',
    );
    expect(promptSrc).toContain(
      'useEffect(() => {\n    if (!shouldSuppressSuggestionForTiming || !promptSuggestionState.text) {',
    );

    // P1-D2-1: holdForReview commits stripped pastedContents to React state
    expect(promptSrc).toContain(
      'if (stripped.pastedContents !== activePastedContents) {\n          setPastedContents(stripped.pastedContents);\n          pastedContentsRef.current = stripped.pastedContents;',
    );

    // P1-D2-5: raw useInput guarded by { isActive: isRawPromptInputActive }
    expect(promptSrc).toContain('const isRawPromptInputActive =');
    expect(promptSrc).toContain('!isModalOverlayActive &&');
    expect(promptSrc).toContain('!showBridgeDialog &&');
    expect(promptSrc).toContain('!showModelPicker &&');
    expect(promptSrc).toContain('!showFastModePicker &&');
    expect(promptSrc).toContain('!showThinkingToggle &&');
    expect(promptSrc).toContain('!isSearchingHistory;');
    expect(promptSrc).toContain('{ isActive: isRawPromptInputActive },');

    // P2-D1-17: narrowed selectors & stable EMPTY_TASK_DECORATIONS
    expect(promptSrc).toContain("const showSpinnerTree = useAppState(s => s.expandedView === 'teammates');");
    expect(promptSrc).toContain('const EMPTY_TASK_DECORATIONS: Record<string, { content: string }> = {};');
    expect(promptSrc).toContain(
      'const taskDecorations = useAppState(s => s.taskDecorations ?? EMPTY_TASK_DECORATIONS);',
    );
    const questionSrc = readFileSync(
      join(ROOT, 'src/components/permissions/AskUserQuestionPermissionRequest/QuestionView.tsx'),
      'utf8',
    );
    expect(questionSrc).toContain("const isInPlanMode = useAppState(s => s.toolPermissionContext.mode === 'plan');");

    // P2-D2-15: allocatePasteId advances past existing/truncated IDs
    expect(promptSrc).toContain('const pasteId = allocatePasteId();');
    expect(promptSrc).toContain('nextPasteIdRef,');

    // P2-D2-17: applyInputChange does not shadow mode and only intercepts '!' in prompt mode
    expect(promptSrc).toContain('const nextMode = getModeFromInput(value);');
    expect(promptSrc).toContain("if (mode === 'prompt' && insertedAtStart && nextMode !== 'prompt') {");
  });

  test('P2-D2-14 & P2-D2-16: useTypeahead clears stale bash ghost text, guards async completions, and slices at startPos', () => {
    const src = readFileSync(join(ROOT, 'src/hooks/useTypeahead.tsx'), 'utf8');

    // P2-D2-14 & P2-8: empty bash input clears inlineGhostText and async bash history guards latestModeRef
    expect(src).toContain(
      "if (mode === 'bash') {\n        latestBashInputRef.current = value;\n        if (!value.trim()) {\n          setInlineGhostText(undefined);",
    );
    expect(src).toContain("if (latestModeRef.current !== 'bash' || latestBashInputRef.current !== value) {");
    expect(src).toContain("if (mode !== 'bash') {\n    latestBashInputRef.current = '';\n  }");

    // P2-D2-16: request-id + live-input staleness guards across all async paths
    expect(src).toContain('const dirReqId = ++latestDirRequestIdRef.current;');
    expect(src).toContain('dirReqId !== latestDirRequestIdRef.current');
    expect(src).toContain('const titleReqId = ++latestCustomTitleRequestIdRef.current;');
    expect(src).toContain('titleReqId !== latestCustomTitleRequestIdRef.current');
    expect(src).toContain('const tabReqId = ++latestTabRequestIdRef.current;');
    expect(src).toContain('tabReqId !== latestTabRequestIdRef.current');

    // P2-D2-16: slice at completionToken.startPos with updated cursorOffset instead of String.replace
    expect(src).not.toContain('input.replace(completionToken.token, replacementValue)');
    expect(src).toContain(
      'input.slice(0, completionToken.startPos) +\n            replacementValue +\n            input.slice(completionToken.startPos + completionToken.token.length);',
    );
    expect(src).toContain('const nextCursorOffset = completionToken.startPos + replacementValue.length;');
  });

  test('P2-7: markShown effect marks direct replacement prompt suggestions (shownAt === 0) while showPromptSuggestion stays true', async () => {
    const store = createStore<AppState>({
      ...getDefaultAppState(),
      promptSuggestion: {
        text: 'run bun test',
        promptId: 'user_intent',
        shownAt: 0,
        acceptedAt: 0,
        generationRequestId: 'gen-1',
      },
    });

    function SuggestionHarness() {
      const promptSuggestionState = useAppState(s => s.promptSuggestion);
      const { suggestion: promptSuggestion, markShown } = usePromptSuggestion({
        inputValue: '',
        isAssistantResponding: false,
      });
      const showPromptSuggestion = Boolean(promptSuggestion);
      const promptSuggestionUnshown = promptSuggestionState.shownAt === 0;
      useEffect(() => {
        if (showPromptSuggestion && promptSuggestionUnshown) {
          markShown();
        }
      }, [showPromptSuggestion, promptSuggestionUnshown, promptSuggestionState.text, markShown]);
      return null;
    }

    const ink = createTestInk();
    ink.render(
      <AppStateProvider store={store}>
        <SuggestionHarness />
      </AppStateProvider>,
    );
    try {
      await new Promise(r => setTimeout(r, 30));
      const firstShownAt = store.getState().promptSuggestion.shownAt;
      expect(firstShownAt).toBeGreaterThan(0);

      // Directly replace the visible suggestion with a new unshown suggestion while showPromptSuggestion stays true
      store.setState(prev => ({
        ...prev,
        promptSuggestion: {
          text: 'commit the changes',
          promptId: 'user_intent',
          shownAt: 0,
          acceptedAt: 0,
          generationRequestId: 'gen-2',
        },
      }));
      await new Promise(r => setTimeout(r, 30));
      expect(store.getState().promptSuggestion.text).toBe('commit the changes');
      expect(store.getState().promptSuggestion.shownAt).toBeGreaterThan(0);

      // Even replacing with identical text and shownAt === 0 re-marks shown
      store.setState(prev => ({
        ...prev,
        promptSuggestion: {
          text: 'commit the changes',
          promptId: 'user_intent',
          shownAt: 0,
          acceptedAt: 0,
          generationRequestId: 'gen-3',
        },
      }));
      await new Promise(r => setTimeout(r, 30));
      expect(store.getState().promptSuggestion.shownAt).toBeGreaterThan(0);
    } finally {
      ink.unmount();
    }
  });
});
