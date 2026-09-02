/**
 * densable Vru — permission_ask_user_question DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM(v4t,Vru)`. Esc/onCancel → `{behavior:"deny"}`.
 * Questions from Fwl wum payload. Submit `{...input, answers}`.
 * Ofy key:question + preview kind full|withheld. DualInk analog
 * QuestionView / multiSelect / annotations / submit review / Chat about.
 * DualInk analog images + AfkCountdown + highlight.
 * Omit gold image convert. Do not wrap AskUserQuestionPermissionRequest.
 * Host answer is store.answer; do not dequeue.
 */
import React, { Suspense, use, useCallback, useMemo, useRef, useState } from 'react';
import { stringWidth, useTheme, useTerminalFocus } from '@anthropic/ink';
import { QuestionView } from '../../components/permissions/AskUserQuestionPermissionRequest/QuestionView.js';
import { SubmitQuestionsView } from '../../components/permissions/AskUserQuestionPermissionRequest/SubmitQuestionsView.js';
import { AfkCountdown } from '../../components/permissions/AskUserQuestionPermissionRequest/AfkCountdown.js';
import { useMultipleChoiceState } from '../../components/permissions/AskUserQuestionPermissionRequest/use-multiple-choice-state.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { type CliHighlight, getCliHighlightPromise } from '../../utils/cliHighlight.js';
import type { Question } from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js';
import type { PastedContent } from '../../utils/config.js';
import type { ImageDimensions } from '../../utils/imageResizer.js';
import { cacheImagePath, storeImage } from '../../utils/imageStore.js';
import { logError } from '../../utils/log.js';
import { applyMarkdown } from '../../utils/markdown.js';
import { getPlanFilePath } from '../../utils/plans.js';
import { askUserQuestionTimeoutToMs } from '../../utils/settings/settings.js';
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js';
import type { DialogRendererProps } from '../DialogHost.js';
import {
  type AskUserQuestionPermissionPayload,
  buildAskUserQuestionAnnotations,
  convertImagesToBlocks,
  formatAskUserQuestionAnswer,
  formatAskUserQuestionChatAboutFeedback,
  formatAskUserQuestionSkipInterviewFeedback,
  normalizeAskQuestions,
  resolveAskUserQuestionDeny,
  resolveAskUserQuestionSubmit,
  toDualInkQuestions,
} from '../permissionAsk.js';

const MIN_CONTENT_HEIGHT = 12;
const MIN_CONTENT_WIDTH = 40;
const CONTENT_CHROME_OVERHEAD = 15;

function coercePermissionDecision(raw: unknown): PermissionDecision {
  if (typeof raw === 'object' && raw !== null && 'behavior' in raw) {
    const behavior = (raw as { behavior?: unknown }).behavior;
    if (behavior === 'allow' || behavior === 'deny' || behavior === 'ask') {
      return raw as PermissionDecision;
    }
  }
  return { behavior: 'ask', message: '' };
}

export function PermissionAskUserQuestionDialog(props: DialogRendererProps): React.ReactNode {
  const settings = useSettings();
  if (settings.syntaxHighlightingDisabled) {
    return <PermissionAskUserQuestionDialogBody {...props} highlight={null} />;
  }
  return (
    <Suspense fallback={<PermissionAskUserQuestionDialogBody {...props} highlight={null} />}>
      <PermissionAskUserQuestionWithHighlight {...props} />
    </Suspense>
  );
}

function PermissionAskUserQuestionWithHighlight(props: DialogRendererProps): React.ReactNode {
  const highlight = use(getCliHighlightPromise());
  return <PermissionAskUserQuestionDialogBody {...props} highlight={highlight} />;
}

function PermissionAskUserQuestionDialogBody({
  payload,
  answer,
  highlight,
}: DialogRendererProps & { highlight: CliHighlight | null }): React.ReactNode {
  const p = payload as AskUserQuestionPermissionPayload;
  const hostQuestions = useMemo(() => normalizeAskQuestions(p.questions), [p.questions]);
  const questions = useMemo(() => toDualInkQuestions(hostQuestions), [hostQuestions]);
  const { rows: terminalRows } = useTerminalSize();
  const [theme] = useTheme();
  const afkTimeoutMs = useMemo(() => askUserQuestionTimeoutToMs(), []);
  const isTerminalFocused = useTerminalFocus();
  const setAppState = useSetAppState();

  const { globalContentHeight, globalContentWidth } = useMemo(() => {
    let maxHeight = 0;
    let maxWidth = 0;
    const FOOTER_HELP_LINES = 7;
    const maxAllowedHeight = Math.max(MIN_CONTENT_HEIGHT, terminalRows - CONTENT_CHROME_OVERHEAD);
    const PREVIEW_OVERHEAD = 11;
    for (const q of questions) {
      const hasPreview = q.options.some(opt => opt.preview);
      if (hasPreview) {
        const maxPreviewContentLines = Math.max(1, maxAllowedHeight - PREVIEW_OVERHEAD);
        let maxPreviewBoxHeight = 0;
        for (const opt of q.options) {
          if (opt.preview) {
            const rendered = applyMarkdown(opt.preview, theme, highlight);
            const previewLines = rendered.split('\n');
            const isTruncated = previewLines.length > maxPreviewContentLines;
            const displayedLines = isTruncated ? maxPreviewContentLines : previewLines.length;
            maxPreviewBoxHeight = Math.max(maxPreviewBoxHeight, displayedLines + (isTruncated ? 1 : 0) + 2);
            for (const line of previewLines) {
              maxWidth = Math.max(maxWidth, stringWidth(line));
            }
          }
        }
        const rightPanelHeight = maxPreviewBoxHeight + 2;
        const leftPanelHeight = q.options.length + 2;
        const sideByHeight = Math.max(leftPanelHeight, rightPanelHeight);
        maxHeight = Math.max(maxHeight, sideByHeight + FOOTER_HELP_LINES);
      } else {
        maxHeight = Math.max(maxHeight, q.options.length + 3 + FOOTER_HELP_LINES);
      }
    }
    return {
      globalContentHeight: Math.min(Math.max(maxHeight, MIN_CONTENT_HEIGHT), maxAllowedHeight),
      globalContentWidth: Math.max(maxWidth, MIN_CONTENT_WIDTH),
    };
  }, [questions, terminalRows, theme, highlight]);

  const [pastedContentsByQuestion, setPastedContentsByQuestion] = useState<
    Record<string, Record<number, PastedContent>>
  >({});
  const nextPasteIdRef = useRef(0);

  const onImagePaste = useCallback(
    (
      questionText: string,
      base64Image: string,
      mediaType?: string,
      filename?: string,
      dimensions?: ImageDimensions,
      _sourcePath?: string,
    ) => {
      const pasteId = nextPasteIdRef.current++;
      const newContent: PastedContent = {
        id: pasteId,
        type: 'image',
        content: base64Image,
        mediaType: mediaType || 'image/png',
        filename: filename || 'Pasted image',
        dimensions,
      };
      cacheImagePath(newContent, setAppState);
      void storeImage(newContent, setAppState);
      setPastedContentsByQuestion(prev => ({
        ...prev,
        [questionText]: { ...(prev[questionText] ?? {}), [pasteId]: newContent },
      }));
    },
    [setAppState],
  );

  const onRemoveImage = useCallback((questionText: string, id: number) => {
    setPastedContentsByQuestion(prev => {
      const questionContents = { ...(prev[questionText] ?? {}) };
      delete questionContents[id];
      return { ...prev, [questionText]: questionContents };
    });
  }, []);

  const allImageAttachments = Object.values(pastedContentsByQuestion)
    .flatMap(contents => Object.values(contents))
    .filter(c => c.type === 'image');

  const toolPermissionContextMode = useAppState(s => s.toolPermissionContext.mode);
  const isInPlanMode = toolPermissionContextMode === 'plan';
  const planFilePath = isInPlanMode ? getPlanFilePath() : undefined;

  const {
    currentQuestionIndex,
    answers,
    questionStates,
    isInTextInput,
    nextQuestion,
    prevQuestion,
    updateQuestionState,
    setAnswer,
    setTextInputMode,
  } = useMultipleChoiceState();

  const currentQuestion = currentQuestionIndex < (questions?.length || 0) ? questions?.[currentQuestionIndex] : null;
  const isInSubmitView = currentQuestionIndex === (questions?.length || 0);
  const allQuestionsAnswered = questions?.every((q: Question) => q?.question && !!answers[q.question]) ?? false;
  const hideSubmitTab = questions.length === 1 && !questions[0]?.multiSelect;

  const deny = useCallback((): void => {
    answer({ behavior: 'deny' });
  }, [answer]);

  const submit = useCallback(
    (nextAnswers: Record<string, string>, extras?: { afkTimeoutMs?: number }) => {
      const annotations = buildAskUserQuestionAnnotations(hostQuestions, nextAnswers, questionStates);
      void convertImagesToBlocks(allImageAttachments)
        .then(blocks => {
          answer(
            resolveAskUserQuestionSubmit(p, nextAnswers, {
              ...(extras?.afkTimeoutMs !== undefined ? { afkTimeoutMs: extras.afkTimeoutMs } : {}),
              ...(blocks && blocks.length > 0 ? { contentBlocks: blocks } : {}),
              ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
            }),
          );
        })
        .catch(logError);
    },
    [allImageAttachments, answer, hostQuestions, p, questionStates],
  );

  const handleAfkTimeout = useCallback(
    (timeoutMs: number) => {
      submit(answers, { afkTimeoutMs: timeoutMs });
    },
    [answers, submit],
  );

  const denyWithFeedback = useCallback(
    (feedback: string) => {
      void convertImagesToBlocks(allImageAttachments)
        .then(blocks => {
          answer(
            resolveAskUserQuestionDeny({
              feedback,
              ...(blocks && blocks.length > 0 ? { contentBlocks: blocks } : {}),
            }),
          );
        })
        .catch(logError);
    },
    [allImageAttachments, answer],
  );

  const handleRespondToClaude = useCallback(() => {
    denyWithFeedback(formatAskUserQuestionChatAboutFeedback(questions, answers));
  }, [answers, denyWithFeedback, questions]);

  const handleFinishPlanInterview = useCallback(() => {
    denyWithFeedback(formatAskUserQuestionSkipInterviewFeedback(questions, answers));
  }, [answers, denyWithFeedback, questions]);

  const handleQuestionAnswer = useCallback(
    (questionText: string, label: string | string[], textInput?: string, shouldAdvance: boolean = true) => {
      let resolved: string;
      const isMultiSelect = Array.isArray(label);
      if (isMultiSelect) {
        resolved = label.join(', ');
      } else {
        const questionImages = Object.values(pastedContentsByQuestion[questionText] ?? {}).filter(
          c => c.type === 'image',
        );
        resolved = formatAskUserQuestionAnswer(label, textInput, questionImages.length);
      }
      const isSingleQuestion = questions.length === 1;
      if (!isMultiSelect && isSingleQuestion && shouldAdvance) {
        submit({ ...answers, [questionText]: resolved });
        return;
      }
      setAnswer(questionText, resolved, shouldAdvance);
    },
    [answers, pastedContentsByQuestion, questions.length, setAnswer, submit],
  );

  const handleFinalResponse = useCallback(
    (value: 'submit' | 'cancel'): void => {
      if (value === 'cancel') {
        deny();
        return;
      }
      submit(answers);
    },
    [answers, deny, submit],
  );

  const maxIndex = hideSubmitTab ? (questions?.length || 1) - 1 : questions?.length || 0;

  const handleTabPrev = useCallback(() => {
    if (currentQuestionIndex > 0) {
      prevQuestion();
    }
  }, [currentQuestionIndex, prevQuestion]);

  const handleTabNext = useCallback(() => {
    if (currentQuestionIndex < maxIndex) {
      nextQuestion();
    }
  }, [currentQuestionIndex, maxIndex, nextQuestion]);

  useKeybindings(
    {
      'tabs:previous': handleTabPrev,
      'tabs:next': handleTabNext,
    },
    { context: 'Tabs', isActive: !(isInTextInput && !isInSubmitView) },
  );

  const afkEnabled = isTerminalFocused && afkTimeoutMs !== null;

  if (currentQuestion) {
    return (
      <>
        <QuestionView
          question={currentQuestion}
          questions={questions}
          currentQuestionIndex={currentQuestionIndex}
          answers={answers}
          questionStates={questionStates}
          hideSubmitTab={hideSubmitTab}
          minContentHeight={globalContentHeight}
          minContentWidth={globalContentWidth}
          planFilePath={planFilePath}
          onUpdateQuestionState={updateQuestionState}
          onAnswer={handleQuestionAnswer}
          onTextInputFocus={setTextInputMode}
          onCancel={deny}
          onSubmit={nextQuestion}
          onTabPrev={handleTabPrev}
          onTabNext={handleTabNext}
          onRespondToClaude={handleRespondToClaude}
          onFinishPlanInterview={handleFinishPlanInterview}
          onImagePaste={(base64, mediaType, filename, dims, path) =>
            onImagePaste(currentQuestion.question, base64, mediaType, filename, dims, path)
          }
          pastedContents={pastedContentsByQuestion[currentQuestion.question] ?? {}}
          onRemoveImage={id => onRemoveImage(currentQuestion.question, id)}
        />
        <AfkCountdown enabled={afkEnabled} timeoutMs={afkTimeoutMs} onTimeout={handleAfkTimeout} />
      </>
    );
  }

  if (isInSubmitView) {
    return (
      <>
        <SubmitQuestionsView
          questions={questions}
          currentQuestionIndex={currentQuestionIndex}
          answers={answers}
          allQuestionsAnswered={allQuestionsAnswered}
          permissionResult={coercePermissionDecision(p.permissionResult)}
          minContentHeight={globalContentHeight}
          onFinalResponse={handleFinalResponse}
        />
        <AfkCountdown enabled={afkEnabled} timeoutMs={afkTimeoutMs} onTimeout={handleAfkTimeout} />
      </>
    );
  }

  return null;
}
