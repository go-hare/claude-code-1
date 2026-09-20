import React, { useEffect, useRef, useState } from 'react';
import { Box, Byline, KeyboardShortcutHint, Text } from '@anthropic/ink';
import figures from 'figures';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js';
import { useSessionServices } from '../context/sessionServices.js';
import { useDebouncedDigitInput } from './FeedbackSurvey/useDebouncedDigitInput.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  FEEDBACK_CARD_SENT_HOLD_MS,
  FEEDBACK_NOTICE_SHOW_DELAY_MS,
  FEEDBACK_NOTICE_TYPE_LABELS,
  FEEDBACK_TURNOFF_CONFIRM_HOLD_MS,
} from '../utils/feedbackDrafts/constants.js';
import { getFeedbackDraftsSetting, setFeedbackDraftsSetting } from '../utils/feedbackDrafts/gates.js';
import {
  canShowFeedbackTurnOffPrompt,
  clearFeedbackNotice,
  clearFeedbackNoticeForDraft,
  incrementFeedbackTurnOffPromptDeclines,
  markFeedbackNoticeShown,
} from '../utils/feedbackDrafts/notice.js';
import { submitQueuedFeedbackDraft } from '../utils/feedbackDrafts/submitDraft.js';
import { useFeedbackNoticeState, useSessionDraftCount } from '../utils/feedbackDrafts/useSessionDraftCount.js';
import { listFeedbackDrafts } from '../utils/feedbackDrafts/writeDraft.js';
import { isSendFeedbackEnabled } from '../utils/feedbackDrafts/gates.js';

type CardState = 'idle' | 'confirmSend' | 'sending' | 'sent' | 'error' | 'dismissPrompt' | 'offConfirm';

type Props = {
  isLoading: boolean;
  surveyActive: boolean;
  inputValue: string;
  setInputValue: (value: string) => void;
  onOpenFeedback: () => void;
};

/** densable leftover Fqe */
export function FeedbackDraftNotice({
  isLoading,
  surveyActive,
  inputValue,
  setInputValue,
  onOpenFeedback,
}: Props): React.ReactNode {
  const { notice } = useFeedbackNoticeState();
  const queued = useSessionDraftCount();
  const { storageV5, credentials } = useSessionServices();
  const { columns } = useTerminalSize();
  const [state, setState] = useState<CardState>('idle');
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const draftIdRef = useRef(notice?.draftId ?? null);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const declined = useRef(false);
  const enabled = isSendFeedbackEnabled();
  const quiet = getFeedbackDraftsSetting() === 'quiet';
  const visible = enabled && notice !== null;
  const busy = isLoading || surveyActive;
  const modal = state === 'dismissPrompt' || state === 'offConfirm';
  const [armed, setArmed] = useState(!busy && !quiet);

  useEffect(() => {
    if (busy || quiet || modal) {
      setArmed(false);
      return;
    }
    if (armed) return;
    const timer = setTimeout(() => setArmed(true), FEEDBACK_NOTICE_SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [busy, quiet, modal, armed]);

  function clearSentTimer(): void {
    if (sentTimer.current !== null) {
      clearTimeout(sentTimer.current);
      sentTimer.current = null;
    }
  }
  function clearOffTimer(): void {
    if (offTimer.current !== null) {
      clearTimeout(offTimer.current);
      offTimer.current = null;
    }
  }

  if (notice !== null && notice.draftId !== draftIdRef.current) {
    draftIdRef.current = notice.draftId;
    clearSentTimer();
    if (state !== 'idle' && state !== 'dismissPrompt' && state !== 'offConfirm') {
      setState('idle');
      setError(null);
      sending.current = false;
    }
  }

  useEffect(() => {
    if (
      (isLoading || surveyActive || quiet) &&
      (state === 'confirmSend' || state === 'dismissPrompt' || state === 'offConfirm')
    ) {
      clearOffTimer();
      setState('idle');
    }
  }, [isLoading, surveyActive, quiet, state]);

  useEffect(() => {
    if (state === 'dismissPrompt' && inputValue !== '' && inputValue.normalize('NFKC') !== '0') {
      if (!declined.current) {
        declined.current = true;
        incrementFeedbackTurnOffPromptDeclines(storageV5);
        logEvent('tengu_feedback_turnoff_prompt_declined', {});
      }
      setState('idle');
    }
  }, [state, inputValue, storageV5]);

  useEffect(() => {
    if (!visible || notice === null || busy || quiet || modal || !armed) return;
    if (markFeedbackNoticeShown(notice.draftId)) {
      logEvent('tengu_feedback_notice_shown', {
        type: notice.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }
  }, [visible, quiet, busy, armed, modal, notice]);

  useEffect(
    () => () => {
      if (sentTimer.current !== null && draftIdRef.current !== null) {
        clearSentTimer();
        clearFeedbackNoticeForDraft(draftIdRef.current);
      }
      clearOffTimer();
    },
    [],
  );

  function logShown(draft: { draftId: string; type: string }): void {
    if (markFeedbackNoticeShown(draft.draftId)) {
      logEvent('tengu_feedback_notice_shown', {
        type: draft.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }
  }

  function close(via: string): void {
    clearSentTimer();
    clearOffTimer();
    if (via !== 'sent') {
      logEvent(via === 'dismiss' ? 'tengu_feedback_notice_dismissed' : 'tengu_feedback_notice_opened', {
        type: (notice?.type ?? 'bug') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        via: via as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }
    sending.current = false;
    setState('idle');
    setError(null);
    clearFeedbackNotice();
  }

  function dismiss(): void {
    close('dismiss');
    if (canShowFeedbackTurnOffPrompt()) {
      declined.current = false;
      logEvent('tengu_feedback_turnoff_prompt_shown', {});
      setState('dismissPrompt');
    }
  }

  function keepDrafts(): void {
    if (!declined.current) {
      declined.current = true;
      incrementFeedbackTurnOffPromptDeclines(storageV5);
      logEvent('tengu_feedback_turnoff_prompt_declined', {});
    }
    setState('idle');
  }

  function turnOff(): void {
    void setFeedbackDraftsSetting('off', { storageV5, via: 'card' });
    clearFeedbackNotice();
    clearOffTimer();
    setState('offConfirm');
    offTimer.current = setTimeout(() => {
      offTimer.current = null;
      setState('idle');
    }, FEEDBACK_TURNOFF_CONFIRM_HOLD_MS);
  }

  async function sendAsIs(draftId: string): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setState('sending');
    setError(null);
    let result: { success: boolean; message?: string };
    try {
      const { queued: drafts } = await listFeedbackDrafts(undefined, storageV5);
      const draft = drafts.find(item => item.draft_id === draftId);
      if (!draft) {
        sending.current = false;
        clearFeedbackNoticeForDraft(draftId);
        if (draftIdRef.current === draftId) setState('idle');
        return;
      }
      const posted = await submitQueuedFeedbackDraft({
        draft,
        includeTranscript: false,
        currentSessionMessages: [],
        via: 'card_send_as_is',
        storageV5,
        credentials,
      });
      result = { success: posted.success, message: posted.error };
    } catch {
      result = { success: false, message: "Couldn't send feedback." };
    }
    logEvent('tengu_feedback_card_send', {
      type: (notice?.type ?? 'bug') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      success: (result.success ? 1 : 0) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    if (draftIdRef.current !== draftId) return;
    if (!result.success) {
      sending.current = false;
      setError(result.message ?? "Couldn't send feedback.");
      setState('error');
      return;
    }
    setState('sent');
    sentTimer.current = setTimeout(() => close('sent'), FEEDBACK_CARD_SENT_HOLD_MS);
  }

  useDebouncedDigitInput({
    inputValue,
    setInputValue,
    isValidDigit: (char): char is string =>
      state === 'dismissPrompt' ? char === '0' : char === '0' || char === '1' || (char === '2' && state !== 'error'),
    enabled:
      !quiet &&
      !busy &&
      ((visible && (state === 'idle' || state === 'confirmSend' || state === 'error')) || state === 'dismissPrompt'),
    onDigit: digit => {
      setInputValue('');
      if (state === 'dismissPrompt') {
        turnOff();
        return;
      }
      if (notice === null) return;
      logShown(notice);
      if (digit === '1') {
        close('review');
        onOpenFeedback();
      } else if (digit === '0') {
        if (state === 'confirmSend') setState('idle');
        else dismiss();
      } else if (state === 'idle') {
        setState('confirmSend');
      } else if (state === 'confirmSend') {
        void sendAsIs(notice.draftId);
      }
    },
  });

  useKeybinding(
    'chat:cancel',
    () => {
      if (state === 'dismissPrompt') {
        keepDrafts();
        return;
      }
      if (notice !== null) logShown(notice);
      if (state === 'confirmSend') {
        setState('idle');
        return;
      }
      dismiss();
    },
    {
      context: 'Chat',
      isActive:
        !quiet &&
        !busy &&
        inputValue === '' &&
        (state === 'dismissPrompt' || (visible && state !== 'sending' && state !== 'sent' && state !== 'offConfirm')),
    },
  );

  if (state === 'dismissPrompt') {
    return (
      <Box marginTop={1} marginBottom={1}>
        <Text>
          Turn off Claude-drafted feedback?{' '}
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="0" action="turn off" />
              <KeyboardShortcutHint shortcut="escape" action="keep" />
            </Byline>
          </Text>
        </Text>
      </Box>
    );
  }
  if (state === 'offConfirm') {
    return (
      <Box marginTop={1} marginBottom={1}>
        <Text>
          <Text color="success">{figures.tick} </Text>
          Claude-drafted feedback is off. Turn back on in /config
        </Text>
      </Box>
    );
  }
  if (!visible || quiet || notice === null) return null;

  const more = Math.max(0, queued - 1);
  const kind = FEEDBACK_NOTICE_TYPE_LABELS[notice.type as keyof typeof FEEDBACK_NOTICE_TYPE_LABELS] ?? 'Feedback';
  const hints =
    state === 'confirmSend' ? (
      <Text>
        Send without reviewing <Text dimColor>(full draft + env, no transcript)</Text>?{' '}
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="2" action="send" />
            <KeyboardShortcutHint shortcut="escape" action="back" />
          </Byline>
        </Text>
      </Text>
    ) : state === 'sending' ? (
      <Text dimColor>Sending…</Text>
    ) : state === 'sent' ? (
      <Text>
        <Text color="success">{figures.tick} </Text>
        Sent
      </Text>
    ) : state === 'error' ? (
      <Text>
        <Text color="error">{figures.cross} </Text>
        <Text color="error">{error}</Text>{' '}
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="1" action="review & retry" />
            <KeyboardShortcutHint shortcut="escape" action="dismiss" />
          </Byline>
        </Text>
      </Text>
    ) : (
      <Text dimColor>
        <Byline>
          <KeyboardShortcutHint shortcut="1" action="review" />
          <KeyboardShortcutHint shortcut="2" action="send" />
          <KeyboardShortcutHint shortcut="0" action="dismiss" />
          {more > 0 && `+${more} more queued`}
        </Byline>
      </Text>
    );

  const title = (
    <Box flexShrink={1}>
      <Text wrap="truncate-end">
        <Text color="claude" aria-hidden>
          {figures.pointerSmall}{' '}
        </Text>
        {kind} drafted: <Text bold>{notice.title}</Text>
      </Text>
    </Box>
  );

  if (busy) return null;
  return (
    <Box marginTop={1} marginBottom={1} flexDirection="column">
      {title}
      <Text dimColor wrap="truncate-end">
        {notice.detailsPreview.slice(0, Math.max(1, columns - 4))}
      </Text>
      {hints}
    </Box>
  );
}
