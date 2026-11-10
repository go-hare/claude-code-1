import figures from 'figures';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { type KeyboardEvent, Box, Byline, Divider, KeyboardShortcutHint, stringWidth, Text } from '@anthropic/ink';
import { useKeybinding, useKeybindings } from '../../../keybindings/useKeybinding.js';
import type { Question } from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { type AskPreview, mapOfyPreview } from '../../../dialog/permissionAsk.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import { editPromptInEditor } from '../../../utils/promptEditor.js';
import TextInput from '../../TextInput.js';
import { PermissionPreviewGutter } from '../PermissionPreviewGutter.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PreviewBox } from './PreviewBox.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
import type { QuestionState } from './use-multiple-choice-state.js';

type Props = {
  question: Question;
  questions: Question[];
  optionPreviews?: (AskPreview | undefined)[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  questionStates: Record<string, QuestionState>;
  hideSubmitTab?: boolean;
  minContentHeight?: number;
  minContentWidth?: number;
  onUpdateQuestionState: (questionText: string, updates: Partial<QuestionState>, isMultiSelect: boolean) => void;
  onAnswer: (questionText: string, label: string | string[], textInput?: string, shouldAdvance?: boolean) => void;
  onTextInputFocus: (isInInput: boolean) => void;
  onCancel: () => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onRespondToClaude: () => void;
};

/**
 * A side-by-side question view for questions with preview content.
 * Displays a vertical option list on the left with a preview panel on the right.
 */
export function PreviewQuestionView({
  question,
  questions,
  optionPreviews,
  currentQuestionIndex,
  answers,
  questionStates,
  hideSubmitTab = false,
  minContentHeight,
  minContentWidth,
  onUpdateQuestionState,
  onAnswer,
  onTextInputFocus,
  onCancel,
  onTabPrev,
  onTabNext,
  onRespondToClaude,
}: Props): React.ReactNode {
  const [isFooterFocused, setIsFooterFocused] = useState(false);
  const [isInNotesInput, setIsInNotesInput] = useState(false);
  const [cursorOffset, setCursorOffset] = useState(0);

  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : null;

  const questionText = question.question;
  const questionState = questionStates[questionText];

  // Only real options — no "Other" for preview questions
  const allOptions = question.options;

  // Track which option is focused (for preview display)
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [hasNavigated, setHasNavigated] = useState(false);

  // Reset focusedIndex when navigating to a different question
  const prevQuestionText = useRef(questionText);
  if (prevQuestionText.current !== questionText) {
    prevQuestionText.current = questionText;
    const selected = questionState?.selectedValue as string | undefined;
    const idx = selected ? allOptions.findIndex(opt => opt.label === selected) : -1;
    setFocusedIndex(idx >= 0 ? idx : 0);
    setHasNavigated(false);
  }

  const focusedOption = allOptions[focusedIndex];
  const selectedValue = questionState?.selectedValue as string | undefined;
  const notesValue = questionState?.textInputValue || '';

  const handleSelectOption = useCallback(
    (index: number) => {
      const option = allOptions[index];
      if (!option) return;

      setFocusedIndex(index);
      onUpdateQuestionState(questionText, { selectedValue: option.label }, false);

      onAnswer(questionText, option.label);
    },
    [allOptions, questionText, onUpdateQuestionState, onAnswer],
  );

  const handleNavigate = useCallback(
    (direction: 'up' | 'down' | number) => {
      if (isInNotesInput) return;

      let newIndex: number;
      if (typeof direction === 'number') {
        newIndex = direction;
      } else if (direction === 'up') {
        newIndex = focusedIndex > 0 ? focusedIndex - 1 : focusedIndex;
      } else {
        newIndex = focusedIndex < allOptions.length - 1 ? focusedIndex + 1 : focusedIndex;
      }

      if (newIndex >= 0 && newIndex < allOptions.length) {
        setFocusedIndex(newIndex);
        if (newIndex !== focusedIndex) {
          setHasNavigated(true);
        }
      }
    },
    [focusedIndex, allOptions.length, isInNotesInput],
  );

  // Handle ctrl+g to open external editor for notes
  useKeybinding(
    'chat:externalEditor',
    async () => {
      const currentValue = questionState?.textInputValue || '';
      const result = await editPromptInEditor(currentValue);
      if (result.content !== null && result.content !== currentValue) {
        onUpdateQuestionState(questionText, { textInputValue: result.content }, false);
      }
    },
    { context: 'Chat', isActive: isInNotesInput && !!editor },
  );

  // Handle left/right arrow and tab for question navigation.
  // This must be in the child component (not just the parent) because child useInput
  // handlers register first on the event emitter and fire before parent handlers.
  // Without this, the parent's useKeybindings may not fire reliably depending on
  // listener ordering in the event emitter.
  useKeybindings(
    {
      'tabs:previous': () => onTabPrev?.(),
      'tabs:next': () => onTabNext?.(),
    },
    { context: 'Tabs', isActive: !isInNotesInput && !isFooterFocused },
  );

  // Re-submit the answer (plain label) when exiting notes input.
  // Notes are stored in questionStates and collected at submit time via annotations.
  const handleNotesExit = useCallback(() => {
    setIsInNotesInput(false);
    onTextInputFocus(false);
    if (notesValue.trim() && hasNavigated) {
      handleSelectOption(focusedIndex);
    } else if (selectedValue) {
      onAnswer(questionText, selectedValue);
    } else if (notesValue.trim()) {
      onAnswer(questionText, '(notes only)');
    }
  }, [
    notesValue,
    hasNavigated,
    handleSelectOption,
    focusedIndex,
    selectedValue,
    questionText,
    onAnswer,
    onTextInputFocus,
  ]);

  const handleDownFromPreview = useCallback(() => {
    setIsFooterFocused(true);
  }, []);

  const handleUpFromFooter = useCallback(() => {
    setIsFooterFocused(false);
  }, []);

  // Handle keyboard input for option/footer/notes navigation.
  // Always active — the handler routes internally based on isFooterFocused/isInNotesInput.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isFooterFocused) {
        if (e.key === 'up' || (e.ctrl && e.key === 'p')) {
          e.preventDefault();
          handleUpFromFooter();
          return;
        }

        if (e.key === 'return') {
          e.preventDefault();
          onRespondToClaude();
          return;
        }

        if (e.key === 'escape') {
          e.preventDefault();
          onCancel();
        }
        return;
      }

      if (isInNotesInput) {
        // In notes input mode, handle escape to exit back to option navigation
        if (e.key === 'escape') {
          e.preventDefault();
          handleNotesExit();
        }
        return;
      }

      // Handle option navigation (vertical)
      if (e.key === 'up' || (e.ctrl && e.key === 'p')) {
        e.preventDefault();
        if (focusedIndex > 0) {
          handleNavigate('up');
        }
      } else if (e.key === 'down' || (e.ctrl && e.key === 'n')) {
        e.preventDefault();
        if (focusedIndex === allOptions.length - 1) {
          // At bottom of options, go to footer
          handleDownFromPreview();
        } else {
          handleNavigate('down');
        }
      } else if (e.key === 'return') {
        e.preventDefault();
        handleSelectOption(focusedIndex);
      } else if (e.key === 'n' && !e.ctrl && !e.meta) {
        // Press 'n' to focus the notes input
        e.preventDefault();
        setIsInNotesInput(true);
        onTextInputFocus(true);
      } else if (e.key === 'escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key.length === 1 && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (idx < allOptions.length) {
          handleNavigate(idx);
        }
      }
    },
    [
      isFooterFocused,
      isInNotesInput,
      focusedIndex,
      allOptions.length,
      handleUpFromFooter,
      handleDownFromPreview,
      handleNavigate,
      handleSelectOption,
      handleNotesExit,
      onRespondToClaude,
      onCancel,
      onTextInputFocus,
    ],
  );

  const resolvedPreview = optionPreviews ? optionPreviews[focusedIndex] : mapOfyPreview(focusedOption?.preview);
  const previewContent =
    resolvedPreview === undefined
      ? null
      : resolvedPreview.kind === 'full'
        ? resolvedPreview.markdown
        : '(preview cannot be shown in full — compare the option labels and descriptions instead)';

  // The right panel's available width is terminal minus the left panel and gap.
  const LEFT_PANEL_WIDTH = 30;
  const { columns, rows } = useTerminalSize();
  const previewMaxWidth = columns - LEFT_PANEL_WIDTH - 4;

  // Lines used within the content area that aren't preview content:
  // 1: marginTop on side-by-side box
  // 2: PreviewBox borders (top + bottom)
  // 2: notes section (marginTop=1 + text)
  // 2: footer section (marginTop=1 + divider)
  // 1: "Chat about this" line
  // 1: plan mode line (may or may not show)
  // 2: help text (marginTop=1 + text)
  const PREVIEW_OVERHEAD = 11;

  // Cap preview lines from the parent height budget. densable MT4/XT4 do not
  // pin minHeight on this column — only truncate preview content.
  const maxPreviewLines = useMemo(() => {
    return minContentHeight ? Math.max(1, minContentHeight - PREVIEW_OVERHEAD) : Math.max(1, rows - 26);
  }, [minContentHeight, rows]);

  const needsGutter = question.question.includes('\n') || stringWidth(question.question) > 80;

  return (
    <Box flexDirection="column" marginTop={1} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Divider color="inactive" />
      <Box flexDirection="column" paddingTop={0}>
        <QuestionNavigationBar
          questions={questions}
          currentQuestionIndex={currentQuestionIndex}
          answers={answers}
          hideSubmitTab={hideSubmitTab}
        />
        <PermissionPreviewGutter multiline={needsGutter}>
          <PermissionRequestTitle title={question.question} color={'text'} />
        </PermissionPreviewGutter>

        <Box flexDirection="column">
          {/* Side-by-side layout: options on left, preview on right */}
          <Box marginTop={1} flexDirection="row" gap={4}>
            {/* Left panel: vertical option list */}
            <Box flexDirection="column" width={30}>
              {allOptions.map((option, index) => {
                const isFocused = focusedIndex === index;
                const isSelected = selectedValue === option.label;

                return (
                  <Box key={option.label} flexDirection="row">
                    {isFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
                    <Text dimColor> {index + 1}.</Text>
                    <Text color={isSelected ? 'success' : isFocused ? 'suggestion' : undefined} bold={isFocused}>
                      {' '}
                      {option.label}
                    </Text>
                    {isSelected && <Text color="success"> {figures.tick}</Text>}
                  </Box>
                );
              })}
            </Box>

            {/* Right panel: preview + notes */}
            <Box flexDirection="column" flexGrow={1}>
              <PreviewBox
                content={previewContent || 'No preview available'}
                maxLines={maxPreviewLines}
                minWidth={minContentWidth}
                maxWidth={previewMaxWidth}
              />
              <Box marginTop={1} flexDirection="row" gap={1}>
                <Text color="suggestion">Notes:</Text>
                {isInNotesInput ? (
                  <TextInput
                    value={notesValue}
                    placeholder="Add notes on this design…"
                    onChange={value => {
                      onUpdateQuestionState(questionText, { textInputValue: value }, false);
                    }}
                    onSubmit={handleNotesExit}
                    onExit={handleNotesExit}
                    focus={true}
                    showCursor={true}
                    columns={60}
                    cursorOffset={cursorOffset}
                    onChangeCursorOffset={setCursorOffset}
                    disableEscapeDoublePress={true}
                  />
                ) : (
                  <Text dimColor italic>
                    {notesValue || 'press n to add notes'}
                  </Text>
                )}
              </Box>
            </Box>
          </Box>

          {/* Footer section */}
          <Box flexDirection="column" marginTop={1}>
            <Divider color="inactive" />
            <Box flexDirection="row" gap={1}>
              {isFooterFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
              <Text color={isFooterFocused ? 'suggestion' : undefined}>Chat about this</Text>
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text color="inactive" dimColor>
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="select" />
                <KeyboardShortcutHint shortcut={`${figures.arrowUp}/${figures.arrowDown}`} action="navigate" />
                <KeyboardShortcutHint shortcut="n" action="add notes" />
                {questions.length > 1 && <KeyboardShortcutHint shortcut="Tab" action="switch questions" />}
                {isInNotesInput && editorName && (
                  <KeyboardShortcutHint shortcut="ctrl+g" action={`edit in ${editorName}`} />
                )}
                <KeyboardShortcutHint shortcut="Esc" action="cancel" />
              </Byline>
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
