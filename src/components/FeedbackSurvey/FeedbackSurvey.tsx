import React, { useEffect, useRef } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { Box, Text, useInput } from '@anthropic/ink';
import { useAppState } from '../../state/AppState.js';
import { normalizeSurveyDigitInput } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { FeedbackSurveyView, isValidResponseInput } from './FeedbackSurveyView.js';
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js';
import { TranscriptSharePrompt } from './TranscriptSharePrompt.js';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';
import type { FeedbackSurveyResponse } from './utils.js';

type SurveyUiState = 'closed' | 'open' | 'pending' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';

type MemoryCitationProp = {
  sentence: string;
  filenames: string[];
};

type Props = {
  state: SurveyUiState;
  lastResponse: FeedbackSurveyResponse | null;
  handleSelect: (selected: FeedbackSurveyResponse) => void;
  handleUndo?: () => void;
  handleTranscriptSelect?: (selected: TranscriptShareResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  onRequestFeedback?: () => void;
  message?: string;
  /**
   * densable onAbandon: when open survey was shown then user types non-response
   * input, fire once (parent usually closes survey + telemetry).
   */
  onAbandon?: () => void;
  /** densable showNotSure: allow "4" as not-sure response digit in view. residual off. */
  showNotSure?: boolean;
  /**
   * densable memoryCitation (UBa): when set, open state uses citation message
   * chrome instead of the plain session/memory prompt.
   */
  memoryCitation?: MemoryCitationProp | null;
};

const RESPONSE_LABEL: Record<Exclude<FeedbackSurveyResponse, 'dismissed'>, string> = {
  bad: 'Bad',
  fine: 'Fine',
  good: 'Good',
  not_sure: 'Unsure',
};

const FOLLOWUP_PROMPT: Record<Exclude<FeedbackSurveyResponse, 'dismissed'>, string> = {
  good: 'tell us what went well',
  bad: 'tell us what went wrong',
  fine: 'tell us more',
  not_sure: 'tell us more',
};

export function FeedbackSurvey({
  state,
  lastResponse,
  handleSelect,
  handleUndo,
  handleTranscriptSelect,
  inputValue,
  setInputValue,
  onRequestFeedback,
  message,
  onAbandon,
  showNotSure = false,
  memoryCitation = null,
}: Props): React.ReactNode {
  // densable upe refs: g=hasBeenVisible, y=hiddenWhileTyping, _=abandonFired
  const hasBeenVisibleRef = useRef(false);
  const hiddenWhileTypingRef = useRef(false);
  const abandonFiredRef = useRef(false);
  const onAbandonRef = useRef(onAbandon);
  onAbandonRef.current = onAbandon;
  const stateRef = useRef(state);
  if (stateRef.current !== state) {
    if (state === 'open') {
      hasBeenVisibleRef.current = false;
      hiddenWhileTypingRef.current = false;
      abandonFiredRef.current = false;
    }
    stateRef.current = state;
  }

  useEffect(() => {
    if (hiddenWhileTypingRef.current && !abandonFiredRef.current && state === 'open') {
      abandonFiredRef.current = true;
      onAbandonRef.current?.();
    }
  });

  if (state === 'closed') {
    return null;
  }

  // densable upe pending → DRf (Feedback: Bad · Esc undo)
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
      />
    );
  }

  if (state === 'submitted') {
    return (
      <Box marginTop={1}>
        <Text color="success">{'\u2713'} Thanks for sharing your transcript!</Text>
      </Box>
    );
  }

  if (state === 'submitting') {
    return (
      <Box marginTop={1}>
        <Text dimColor>Sharing transcript{'\u2026'}</Text>
      </Box>
    );
  }

  if (state === 'transcript_prompt') {
    if (!handleTranscriptSelect) {
      return null;
    }
    // Hide prompt if user is typing non-response characters
    if (inputValue && !['1', '2', '3'].includes(inputValue)) {
      return null;
    }
    return (
      <TranscriptSharePrompt onSelect={handleTranscriptSelect} inputValue={inputValue} setInputValue={setInputValue} />
    );
  }

  // state === 'open'
  // densable: hide when typing non-response; after once-visible → abandon
  // densable Z0f on single-char input before VGo validity check
  const responseInput = inputValue.length === 1 ? normalizeSurveyDigitInput(inputValue) : inputValue;
  const validOpenInput = responseInput ? isValidResponseInput(responseInput, showNotSure) : true;
  if (responseInput && !validOpenInput) {
    if (hasBeenVisibleRef.current) {
      hiddenWhileTypingRef.current = true;
    }
    return null;
  }
  if (hiddenWhileTypingRef.current) {
    return null;
  }
  hasBeenVisibleRef.current = true;

  // densable upe: memoryCitation → UBa citation chrome; else jvr plain message.
  if (memoryCitation) {
    return (
      <MemoryCitationSurveyView
        citation={memoryCitation}
        onSelect={handleSelect}
        inputValue={inputValue}
        setInputValue={setInputValue}
      />
    );
  }

  return (
    <FeedbackSurveyView
      onSelect={handleSelect}
      inputValue={inputValue}
      setInputValue={setInputValue}
      message={message}
      showNotSure={showNotSure}
    />
  );
}

/** densable K4t: keep first maxLines, append ellipsis if truncated. */
function truncateToMaxLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join('\n')}\u2026`;
}

const MEMORY_CITATION_LEAD = 'Claude recalled a memory:';
const MEMORY_CITATION_ASK = "How was Claude's recollection?";
const MEMORY_CITATION_MAX_LINES = 4;

/**
 * densable UBa: memory survey open chrome with cited sentence + showNotSure.
 * Non-verbose mode clamps the citation body to 4 lines.
 */
function MemoryCitationSurveyView({
  citation,
  onSelect,
  inputValue,
  setInputValue,
}: {
  citation: MemoryCitationProp;
  onSelect: (selected: FeedbackSurveyResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
}): React.ReactNode {
  const verbose = useAppState(s => s.verbose);
  const trimmed = citation.sentence.trim();
  const body = trimmed && !verbose ? truncateToMaxLines(trimmed, MEMORY_CITATION_MAX_LINES) : trimmed;
  const message = body ? (
    <>
      {MEMORY_CITATION_LEAD}
      {'\n\n'}
      {body}
      {'\n\n'}
      {MEMORY_CITATION_ASK} <Text dimColor>(optional)</Text>
    </>
  ) : (
    <>
      {MEMORY_CITATION_ASK} <Text dimColor>(optional)</Text>
    </>
  );

  return (
    <FeedbackSurveyView
      onSelect={onSelect}
      inputValue={inputValue}
      setInputValue={setInputValue}
      message={message}
      messageBold={false}
      showNotSure
    />
  );
}

type PendingProps = {
  lastResponse: FeedbackSurveyResponse | null;
  onUndo?: () => void;
};

/** densable DRf: Feedback: Bad · Esc undo during pending commit window */
function FeedbackSurveyPending({ lastResponse, onUndo }: PendingProps): React.ReactNode {
  useInput(
    (_input, key) => {
      if (key.escape) {
        onUndo?.();
      }
    },
    { isActive: Boolean(onUndo) },
  );

  const label = lastResponse && lastResponse !== 'dismissed' ? RESPONSE_LABEL[lastResponse] : '';

  return (
    <Box marginTop={1}>
      <Text dimColor>
        Feedback: <Text color="text">{label}</Text>
        {' \u00b7 '}
        <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="undo" />
      </Text>
    </Box>
  );
}

type ThanksProps = {
  lastResponse: FeedbackSurveyResponse | null;
  inputValue: string;
  setInputValue: (value: string) => void;
  onRequestFeedback?: () => void;
};

const isFollowUpDigit = (char: string): char is '1' => char === '1';

function FeedbackSurveyThanks({
  lastResponse,
  inputValue,
  setInputValue,
  onRequestFeedback,
}: ThanksProps): React.ReactNode {
  // densable lWb: follow-up for any non-dismissed response (not only good)
  const followUpKey = lastResponse && lastResponse !== 'dismissed' ? lastResponse : null;
  const showFollowUp = Boolean(onRequestFeedback && followUpKey);

  // Listen for "1" keypress to launch /feedback
  useDebouncedDigitInput({
    inputValue,
    setInputValue,
    isValidDigit: isFollowUpDigit,
    enabled: Boolean(showFollowUp),
    once: true,
    mountDelayMs: 0,
    onDigit: () => {
      logEvent('tengu_feedback_survey_event', {
        event_type: 'followup_accepted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        response: lastResponse as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      onRequestFeedback?.();
    },
  });

  const feedbackCommand = process.env.USER_TYPE === 'ant' ? '/issue' : '/feedback';

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="success">Thanks for the feedback!</Text>
      {showFollowUp && followUpKey ? (
        <Text dimColor>
          (Optional) Press [<Text color="ansi:cyan">1</Text>] to {FOLLOWUP_PROMPT[followUpKey]} {' \u00b7 '}
          {feedbackCommand}
        </Text>
      ) : lastResponse === 'bad' ? (
        <Text dimColor>Use /issue to report model behavior issues.</Text>
      ) : (
        <Text dimColor>Use {feedbackCommand} to share detailed feedback anytime.</Text>
      )}
    </Box>
  );
}
