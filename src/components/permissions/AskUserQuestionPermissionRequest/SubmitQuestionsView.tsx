import figures from 'figures';
import React from 'react';
import { Box, Divider, StatusIcon, stringWidth, Text } from '@anthropic/ink';
import type { Question } from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js';
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js';
import { ConfirmSelect } from '../../ConfirmSelect.js';
import { PermissionPreviewGutter } from '../PermissionPreviewGutter.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';

type Props = {
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  allQuestionsAnswered: boolean;
  permissionResult: PermissionDecision;
  minContentHeight?: number;
  onFinalResponse: (value: 'submit' | 'cancel') => void;
};

export function SubmitQuestionsView({
  questions,
  currentQuestionIndex,
  answers,
  allQuestionsAnswered,
  permissionResult,
  onFinalResponse,
}: Props): React.ReactNode {
  // minContentHeight kept on Props for callers; densable review body has no minHeight.
  return (
    <Box flexDirection="column" marginTop={1}>
      <Divider color="inactive" />
      <Box flexDirection="column" borderTop borderColor="inactive" paddingTop={0}>
        <QuestionNavigationBar questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} />
        <PermissionRequestTitle title="Review your answers" color="text" />
        {/* densable ZT4/GT4: no minHeight on review body. */}
        <Box flexDirection="column" marginTop={1}>
          {!allQuestionsAnswered && (
            <Box marginBottom={1}>
              <Text color="warning">
                <StatusIcon status="warning" withSpace />
                You have not answered all questions
              </Text>
            </Box>
          )}
          {Object.keys(answers).length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {questions
                .filter((q: Question) => q?.question && answers[q.question])
                .map((q: Question) => {
                  const answer = answers[q?.question];
                  const questionText = q?.question || 'Question';
                  const needsGutter = questionText.includes('\n') || stringWidth(questionText) > 80;

                  return (
                    <Box key={q?.question || 'answer'} flexDirection="column" marginLeft={1}>
                      <PermissionPreviewGutter multiline={needsGutter}>
                        <Text>
                          {figures.bullet} {questionText}
                        </Text>
                      </PermissionPreviewGutter>
                      <Box marginLeft={2}>
                        <Text color="success">
                          {figures.arrowRight} {answer}
                        </Text>
                      </Box>
                    </Box>
                  );
                })}
            </Box>
          )}

          <PermissionRuleExplanation permissionResult={permissionResult} toolType="tool" />
          <Text color="inactive">Ready to submit your answers?</Text>
          <Box marginTop={1}>
            <ConfirmSelect
              confirmLabel="Submit answers"
              cancelLabel="Cancel"
              onConfirm={() => onFinalResponse('submit')}
              onCancel={() => onFinalResponse('cancel')}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
