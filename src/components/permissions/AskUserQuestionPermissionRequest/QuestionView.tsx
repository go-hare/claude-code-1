import figures from 'figures';
import React, { useCallback, useRef, useState } from 'react';
import { type KeyboardEvent, Box, Byline, Divider, KeyboardShortcutHint, stringWidth, Text } from '@anthropic/ink';
import { useAppState } from '../../../state/AppState.js';
import type {
  Question,
  QuestionOption,
} from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js';
import type { AskPreview, EngineConfirmDisplayBody } from '../../../dialog/permissionAsk.js';
import type { PastedContent } from '../../../utils/config.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import type { ImageDimensions } from '../../../utils/imageResizer.js';
import { editPromptInEditor } from '../../../utils/promptEditor.js';
import { type OptionWithDescription, Select, SelectMulti } from '../../CustomSelect/index.js';
import { FilePathLink } from '../../FilePathLink.js';
import { PermissionPreviewGutter } from '../PermissionPreviewGutter.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PreviewQuestionView } from './PreviewQuestionView.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
import type { QuestionState } from './use-multiple-choice-state.js';

type Props = {
  question: Question;
  questions: Question[];
  /** densable DY displayQuestion — engine confirm title. */
  displayQuestion?: string;
  /** densable DY displayBody — engine confirm body after the blank line. */
  displayBody?: EngineConfirmDisplayBody[];
  optionPreviews?: (AskPreview | undefined)[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  questionStates: Record<string, QuestionState>;
  hideSubmitTab?: boolean;
  planFilePath?: string;
  pastedContents?: Record<number, PastedContent>;
  minContentHeight?: number;
  minContentWidth?: number;
  onUpdateQuestionState: (questionText: string, updates: Partial<QuestionState>, isMultiSelect: boolean) => void;
  onAnswer: (questionText: string, label: string | string[], textInput?: string, shouldAdvance?: boolean) => void;
  onTextInputFocus: (isInInput: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onRespondToClaude: () => void;
  onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void;
  onRemoveImage?: (id: number) => void;
};

export function QuestionView({
  question,
  questions,
  displayQuestion,
  displayBody,
  optionPreviews,
  currentQuestionIndex,
  answers,
  questionStates,
  hideSubmitTab = false,
  planFilePath,
  minContentHeight,
  minContentWidth,
  onUpdateQuestionState,
  onAnswer,
  onTextInputFocus,
  onCancel,
  onSubmit,
  onTabPrev,
  onTabNext,
  onRespondToClaude,
  onImagePaste,
  pastedContents,
  onRemoveImage,
}: Props): React.ReactNode {
  const isInPlanMode = useAppState(s => s.toolPermissionContext.mode) === 'plan';
  const [isFooterFocused, setIsFooterFocused] = useState(false);
  const [isOtherFocused, setIsOtherFocused] = useState(false);
  const latestOtherInputRef = useRef<{ question: string; value: string } | null>(null);

  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : null;

  const handleFocus = useCallback(
    (value: string) => {
      const isOther = value === '__other__';
      setIsOtherFocused(isOther);
      onTextInputFocus(isOther);
    },
    [onTextInputFocus],
  );

  const handleDownFromLastItem = useCallback(() => {
    setIsFooterFocused(true);
  }, []);

  const handleUpFromFooter = useCallback(() => {
    setIsFooterFocused(false);
  }, []);

  const chatAboutOptionNumber = question.options.length + 2;

  // Handle keyboard input when footer is focused (or number shortcut from option list)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const normalizedKey = e.key.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
      if (!isFooterFocused) {
        if (!isOtherFocused && !e.ctrl && !e.meta && normalizedKey === String(chatAboutOptionNumber)) {
          e.preventDefault();
          onRespondToClaude();
        }
        return;
      }

      if (e.key === 'up' || (e.ctrl && e.key === 'p')) {
        e.preventDefault();
        handleUpFromFooter();
        return;
      }

      if (e.key === 'return' || normalizedKey === String(chatAboutOptionNumber)) {
        e.preventDefault();
        onRespondToClaude();
        return;
      }

      if (e.key === 'escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [chatAboutOptionNumber, isFooterFocused, isOtherFocused, handleUpFromFooter, onRespondToClaude, onCancel],
  );

  const textOptions: OptionWithDescription<string>[] = question.options.map((opt: QuestionOption) => ({
    type: 'text' as const,
    value: opt.label,
    label: opt.label,
    description: opt.description,
  }));

  const questionText = question.question;
  const questionState = questionStates[questionText];

  const handleOpenEditor = useCallback(
    async (currentValue: string, setValue: (value: string) => void) => {
      const result = await editPromptInEditor(currentValue);

      if (result.content !== null && result.content !== currentValue) {
        // Update the Select's internal state for immediate UI update
        setValue(result.content);
        // Also update the question state for persistence
        onUpdateQuestionState(questionText, { textInputValue: result.content }, question.multiSelect ?? false);
      }
    },
    [questionText, onUpdateQuestionState, question.multiSelect],
  );

  const otherOption: OptionWithDescription<string> = {
    type: 'input' as const,
    value: '__other__',
    label: 'Other',
    placeholder: question.multiSelect ? 'Type something' : 'Type something.',
    initialValue: questionState?.textInputValue ?? '',
    onChange: (value: string) => {
      latestOtherInputRef.current = { question: questionText, value };
      onUpdateQuestionState(questionText, { textInputValue: value }, question.multiSelect ?? false);
    },
  };

  const options = [...textOptions, otherOption];

  // Check if any option has a preview and it's not multi-select
  // Previews only supported for single-select questions
  const hasAnyPreview =
    !question.multiSelect &&
    (question.options.some(opt => opt.preview !== undefined) || (optionPreviews?.some(p => p !== undefined) ?? false));

  // Delegate to PreviewQuestionView for carousel-style preview mode
  if (hasAnyPreview) {
    return (
      <PreviewQuestionView
        question={question}
        questions={questions}
        optionPreviews={optionPreviews}
        currentQuestionIndex={currentQuestionIndex}
        answers={answers}
        questionStates={questionStates}
        hideSubmitTab={hideSubmitTab}
        minContentHeight={minContentHeight}
        minContentWidth={minContentWidth}
        onUpdateQuestionState={onUpdateQuestionState}
        onAnswer={onAnswer}
        onTextInputFocus={onTextInputFocus}
        onCancel={onCancel}
        onTabPrev={onTabPrev}
        onTabNext={onTabNext}
        onRespondToClaude={onRespondToClaude}
      />
    );
  }

  const needsGutter = question.question.includes('\n') || stringWidth(question.question) > 80;

  return (
    <Box flexDirection="column" marginTop={0} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      {isInPlanMode && planFilePath && (
        <Box flexDirection="column" gap={0}>
          <Divider color="inactive" />
          <Text color="inactive">
            Planning: <FilePathLink filePath={planFilePath} />
          </Text>
        </Box>
      )}
      <Divider color="inactive" />
      <Box flexDirection="column" paddingTop={0}>
        <QuestionNavigationBar
          questions={questions}
          currentQuestionIndex={currentQuestionIndex}
          answers={answers}
          hideSubmitTab={hideSubmitTab}
        />
        <PermissionPreviewGutter multiline={needsGutter}>
          <PermissionRequestTitle title={displayQuestion ?? question.question} color={'text'} />
          {displayBody && displayBody.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {displayBody.map((part, i) =>
                part.kind === 'fileLink' ? (
                  <FilePathLink key={`${part.path}-${i}`} filePath={part.path} />
                ) : (
                  <Text key={`body-${i}`}>{part.text}</Text>
                ),
              )}
            </Box>
          )}
        </PermissionPreviewGutter>

        {/* densable XT4: no minHeight on the options+footer column. Local
            minContentHeight forced tall Ask under tot.bottom overflowY:hidden
            and mid-clipped options into the Chat-about footer when Explore
            returned. Keep the prop for Preview maxLines only. */}
        <Box flexDirection="column">
          <Box marginTop={1}>
            {question.multiSelect ? (
              <SelectMulti
                key={question.question}
                options={options}
                defaultValue={questionStates[question.question]?.selectedValue as string[] | undefined}
                onChange={(values: string[]) => {
                  onUpdateQuestionState(questionText, { selectedValue: values }, true);
                  const textInput = values.includes('__other__')
                    ? latestOtherInputRef.current?.question === questionText
                      ? latestOtherInputRef.current.value
                      : questionStates[questionText]?.textInputValue
                    : undefined;
                  const finalValues = values.filter(v => v !== '__other__').concat(textInput ? [textInput] : []);
                  onAnswer(questionText, finalValues, undefined, false);
                }}
                onFocus={handleFocus}
                onCancel={onCancel}
                submitButtonText={currentQuestionIndex === questions.length - 1 ? 'Submit' : 'Next'}
                onSubmit={onSubmit}
                onDownFromLastItem={handleDownFromLastItem}
                isDisabled={isFooterFocused}
                onOpenEditor={handleOpenEditor}
                onImagePaste={onImagePaste}
                pastedContents={pastedContents}
                onRemoveImage={onRemoveImage}
              />
            ) : (
              <Select
                key={question.question}
                options={options}
                defaultValue={questionStates[question.question]?.selectedValue as string | undefined}
                onChange={(value: string) => {
                  onUpdateQuestionState(questionText, { selectedValue: value }, false);
                  const textInput = value === '__other__' ? questionStates[questionText]?.textInputValue : undefined;
                  onAnswer(questionText, value, textInput);
                }}
                onFocus={handleFocus}
                onCancel={onCancel}
                onDownFromLastItem={handleDownFromLastItem}
                isDisabled={isFooterFocused}
                layout="compact-vertical"
                onOpenEditor={handleOpenEditor}
                onImagePaste={onImagePaste}
                pastedContents={pastedContents}
                onRemoveImage={onRemoveImage}
              />
            )}
          </Box>
          {/* Footer section - always visible, separate from Select */}
          <Box flexDirection="column">
            <Divider color="inactive" />
            <Box flexDirection="row" gap={1}>
              {isFooterFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
              <Text color={isFooterFocused ? 'suggestion' : undefined}>{options.length + 1}. Chat about this</Text>
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text color="inactive" dimColor>
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="select" />
                {questions.length === 1 ? (
                  <KeyboardShortcutHint shortcut={`${figures.arrowUp}/${figures.arrowDown}`} action="navigate" />
                ) : (
                  <Text>Tab/Arrow keys to navigate</Text>
                )}
                {isOtherFocused && editorName && (
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
