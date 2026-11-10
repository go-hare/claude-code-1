import React, { useEffect, useRef, useState } from 'react';
import stripAnsi from 'strip-ansi';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw escape handling for survey undo/followup
import { Box, KeyboardShortcutHint, StatusIcon, Text, useInput } from '@anthropic/ink';
import { normalizeFullWidthDigits } from '../../utils/stringUtils.js';
import TextInput from '../TextInput.js';
import { FeedbackSurveyView, isValidResponseInput } from './FeedbackSurveyView.js';
import {
  isValidTranscriptShareInput,
  TranscriptSharePrompt,
  type TranscriptShareResponse,
} from './TranscriptSharePrompt.js';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';
import type { FeedbackSurveyResponse } from './utils.js';

export type SurveyDisplayState =
  | 'closed'
  | 'open'
  | 'pending'
  | 'followup_prompt'
  | 'thanks'
  | 'transcript_prompt'
  | 'submitting'
  | 'submitted'
  | 'share_failed';

export type FollowupResolveResult = {
  text: string | null;
  method: 'enter' | 'enter_empty' | 'escape' | 'timeout' | 'turn_yield';
};

export type FollowupAskConfig = {
  maxChars: number;
  autoDismissAfterMs: number;
};

const DEFAULT_FOLLOWUP_ASK_CONFIG: FollowupAskConfig = {
  maxChars: 500,
  autoDismissAfterMs: 30_000,
};

type Props = {
  state: SurveyDisplayState;
  lastResponse: FeedbackSurveyResponse | null;
  handleSelect: (selected: FeedbackSurveyResponse) => void;
  handleUndo?: () => void;
  handleTranscriptSelect?: (selected: TranscriptShareResponse) => void;
  handleFollowupResolve?: (result: FollowupResolveResult) => void;
  followupAskConfig?: FollowupAskConfig;
  followupArmActive?: boolean;
  turnInProgress?: boolean;
  submittingShare?: boolean;
  thanksFromFollowup?: boolean;
  inputValue: string;
  setInputValue: (value: string) => void;
  onRequestFeedback?: (command?: string) => void;
  appearanceId?: string;
  surveyType?: string;
  message?: React.ReactNode;
  messageBold?: boolean;
  showNotSure?: boolean;
  transcriptBundlePath?: string | null;
};

const RESPONSE_LABELS: Record<string, string> = {
  bad: 'Bad',
  fine: 'Fine',
  good: 'Good',
  not_sure: 'Unsure',
};

const FOLLOWUP_QUESTIONS: Record<string, string> = {
  good: 'What went well?',
  bad: 'What went wrong?',
  fine: 'Tell us more',
  not_sure: 'Tell us more',
};

const FOLLOWUP_TELL_US_COPY: Record<string, string> = {
  good: 'tell us what went well',
  bad: 'tell us what went wrong',
  fine: 'tell us more',
  not_sure: 'tell us more',
};

function sanitizeSingleLineFollowup(raw: string): string {
  return stripAnsi(raw)
    .replace(/\r\n|\r|\n/g, ' ')
    .replaceAll('\t', ' ');
}

function clampFollowupCodePoints(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return chars.slice(0, maxChars).join('');
}

export function FeedbackSurvey({
  state,
  lastResponse,
  handleSelect,
  handleUndo,
  handleTranscriptSelect,
  handleFollowupResolve,
  followupAskConfig = DEFAULT_FOLLOWUP_ASK_CONFIG,
  followupArmActive = false,
  turnInProgress = false,
  submittingShare = true,
  inputValue,
  setInputValue,
  onRequestFeedback,
  appearanceId,
  surveyType,
  message,
  messageBold,
  showNotSure = false,
  transcriptBundlePath,
}: Props): React.ReactNode {
  if (state === 'closed') {
    return null;
  }

  if (state === 'pending') {
    return <FeedbackSurveyPending lastResponse={lastResponse} onUndo={handleUndo} />;
  }

  if (state === 'thanks') {
    return (
      <FeedbackSurveyThanks
        lastResponse={lastResponse}
        inputValue={inputValue}
        setInputValue={setInputValue}
        onRequestFeedback={onRequestFeedback}
        appearanceId={appearanceId}
        surveyType={surveyType}
        followupArmActive={followupArmActive}
      />
    );
  }

  if (state === 'submitted') {
    return (
      <Box marginTop={1}>
        {transcriptBundlePath ? (
          <Box flexDirection="column">
            <Text color="success">
              <StatusIcon status="success" withSpace />
              Transcript bundle saved
            </Text>
            <Text dimColor wrap="wrap">
              {transcriptBundlePath}
            </Text>
            <Text wrap="wrap">
              Send this file to your Anthropic account representative or attach it to your support request.
            </Text>
          </Box>
        ) : (
          <Text color="success">
            <StatusIcon status="success" withSpace />
            Thanks for sharing your transcript!
          </Text>
        )}
      </Box>
    );
  }

  // densable 2.1.224 #16 — failed share must not look like success
  if (state === 'share_failed') {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color="error">
          <StatusIcon status="error" withSpace />
          {"Couldn't share the transcript."}
        </Text>
        <Text dimColor>You can share details with /feedback instead.</Text>
      </Box>
    );
  }

  if (state === 'submitting') {
    return (
      <Box marginTop={1}>
        <Text dimColor>{submittingShare ? 'Sharing transcript…' : 'Sending feedback…'}</Text>
      </Box>
    );
  }

  if (state === 'followup_prompt') {
    if (!handleFollowupResolve) {
      return null;
    }
    const responseKey = lastResponse && lastResponse !== 'dismissed' ? lastResponse : 'bad';
    return (
      <FeedbackSurveyFollowupPrompt
        onResolve={handleFollowupResolve}
        question={FOLLOWUP_QUESTIONS[responseKey] ?? 'Tell us more'}
        maxChars={followupAskConfig.maxChars}
        autoDismissAfterMs={followupAskConfig.autoDismissAfterMs}
        turnInProgress={turnInProgress}
      />
    );
  }

  if (state === 'transcript_prompt') {
    if (!handleTranscriptSelect) {
      return null;
    }
    if (inputValue && !isValidTranscriptShareInput(inputValue)) {
      return null;
    }
    return (
      <TranscriptSharePrompt onSelect={handleTranscriptSelect} inputValue={inputValue} setInputValue={setInputValue} />
    );
  }

  // state === 'open'
  const normalizedInput = inputValue.length === 1 ? normalizeFullWidthDigits(inputValue) : inputValue;
  if (normalizedInput && !isValidResponseInput(normalizedInput, showNotSure)) {
    return null;
  }

  return (
    <FeedbackSurveyView
      onSelect={handleSelect}
      inputValue={inputValue}
      setInputValue={setInputValue}
      message={message}
      messageBold={messageBold}
      showNotSure={showNotSure}
    />
  );
}

function FeedbackSurveyPending({
  lastResponse,
  onUndo,
}: {
  lastResponse: FeedbackSurveyResponse | null;
  onUndo?: () => void;
}): React.ReactNode {
  useInput((_input, key) => {
    if (key.escape) {
      onUndo?.();
    }
  });

  const label = lastResponse && lastResponse !== 'dismissed' ? (RESPONSE_LABELS[lastResponse] ?? '') : '';

  return (
    <Box marginTop={1}>
      <Text dimColor>
        Feedback: <Text color="text">{label}</Text> · <KeyboardShortcutHint shortcut="esc" action="undo" />
      </Text>
    </Box>
  );
}

function FeedbackSurveyFollowupPrompt({
  onResolve,
  question,
  maxChars,
  autoDismissAfterMs,
  turnInProgress = false,
}: {
  onResolve: (result: FollowupResolveResult) => void;
  question: string;
  maxChars: number;
  autoDismissAfterMs: number;
  turnInProgress?: boolean;
}): React.ReactNode {
  useRegisterOverlay('survey-followup');
  const { columns } = useTerminalSize();
  const [value, setValue] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [hasTyped, setHasTyped] = useState(false);
  const [exitKeyLabel, setExitKeyLabel] = useState<string | null>(null);
  const resolvedRef = useRef(false);
  const valueRef = useRef('');

  const resolveOnce = (result: FollowupResolveResult) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolve(result);
  };

  useEffect(() => {
    if (hasTyped) return;
    const timer = setTimeout(() => {
      resolveOnce({ text: null, method: 'timeout' });
    }, autoDismissAfterMs);
    return () => clearTimeout(timer);
  });

  useEffect(() => {
    if (turnInProgress && valueRef.current.trim() === '') {
      resolveOnce({ text: null, method: 'turn_yield' });
    }
  });

  const handleChange = (nextRaw: string) => {
    const cleaned = clampFollowupCodePoints(sanitizeSingleLineFollowup(nextRaw), maxChars);
    valueRef.current = cleaned;
    setValue(cleaned);
    if (nextRaw.trim().length > 0) {
      setHasTyped(true);
    }
  };

  useInput((_input, key) => {
    if (!key.escape) return;
    if (valueRef.current.trim() !== '') {
      valueRef.current = '';
      setValue('');
      setCursorOffset(0);
      return;
    }
    resolveOnce({ text: null, method: 'escape' });
  });

  const handleSubmit = () => {
    const trimmed = valueRef.current.trim();
    if (trimmed === '') {
      resolveOnce({ text: null, method: 'enter_empty' });
    } else {
      resolveOnce({ text: clampFollowupCodePoints(trimmed, maxChars), method: 'enter' });
    }
  };

  const charCount = Array.from(value).length;
  const atLimit = charCount >= maxChars;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="ansi:cyan">{BLACK_CIRCLE} </Text>
        <Text bold>{question} </Text>
        <Text dimColor>(optional)</Text>
      </Box>
      <Box marginLeft={2}>
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          columns={Math.min(Math.max(columns - 4, 20), 120)}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          focus={true}
          showCursor={true}
          multiline={false}
          inputFilter={sanitizeSingleLineFollowup}
          onExit={() => resolveOnce({ text: null, method: 'escape' })}
          onExitMessage={(show, keyName) => setExitKeyLabel(show ? (keyName ?? 'Ctrl-C') : null)}
        />
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>
          <KeyboardShortcutHint shortcut="enter" action={value.trim() ? 'send' : 'skip'} />
          {' · '}
          <KeyboardShortcutHint shortcut="esc" action={value.trim() ? 'clear' : 'skip'} />
          {exitKeyLabel && (
            <>
              {'  '}
              <Text color="warning">
                <KeyboardShortcutHint
                  shortcut={exitKeyLabel === 'Ctrl-D' ? 'ctrl+d' : 'ctrl+c'}
                  action="again to skip"
                />
              </Text>
            </>
          )}
          {value.length > 0 && (
            <>
              {'  '}
              <Text color={atLimit ? 'warning' : undefined}>
                {charCount}/{maxChars}
              </Text>
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
}

type ThanksProps = {
  lastResponse: FeedbackSurveyResponse | null;
  inputValue: string;
  setInputValue: (value: string) => void;
  onRequestFeedback?: (command?: string) => void;
  appearanceId?: string;
  surveyType?: string;
  followupArmActive?: boolean;
};

const isFollowUpDigit = (char: string): char is '1' => char === '1';

function FeedbackSurveyThanks({
  lastResponse,
  inputValue,
  setInputValue,
  onRequestFeedback,
  appearanceId,
  surveyType,
  followupArmActive = false,
}: ThanksProps): React.ReactNode {
  const activeResponse = lastResponse && lastResponse !== 'dismissed' ? lastResponse : null;
  const feedbackCommand = activeResponse ? '/feedback' : null;
  const showFollowUp = Boolean(onRequestFeedback && activeResponse && !followupArmActive);

  useDebouncedDigitInput({
    inputValue,
    setInputValue,
    isValidDigit: isFollowUpDigit,
    enabled: showFollowUp,
    once: true,
    onDigit: () => {
      setInputValue('');
      logEvent('tengu_feedback_survey_event', {
        event_type: 'followup_accepted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        response: lastResponse as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(appearanceId && {
          appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(surveyType && {
          survey_type: surveyType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      });
      if (feedbackCommand) {
        onRequestFeedback?.(feedbackCommand);
      }
    },
  });

  const tellUsCopy = activeResponse ? (FOLLOWUP_TELL_US_COPY[activeResponse] ?? 'tell us more') : 'tell us more';

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="success">Thanks for the feedback!</Text>
      {showFollowUp && activeResponse && feedbackCommand ? (
        <Text dimColor>
          (Optional) Press [<Text color="ansi:cyan">1</Text>] to {tellUsCopy} · {feedbackCommand}
        </Text>
      ) : (
        <Text dimColor>Use /feedback to share detailed feedback anytime.</Text>
      )}
    </Box>
  );
}
