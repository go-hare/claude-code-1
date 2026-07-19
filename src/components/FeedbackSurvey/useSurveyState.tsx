import { randomUUID } from 'crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js';
import type { FeedbackSurveyResponse } from './utils.js';

/**
 * densable cpe survey state machine.
 * Residual adds: pending + handleUndo (djb=3000ms confirm window), autoDismiss.
 */
type SurveyState = 'closed' | 'open' | 'pending' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';

/** densable djb: delay after digit select before commit (escape undoes). */
export const SURVEY_PENDING_COMMIT_MS = 3000;

type UseSurveyStateOptions = {
  hideThanksAfterMs: number;
  onOpen: (appearanceId: string) => void | Promise<void>;
  onSelect: (appearanceId: string, selected: FeedbackSurveyResponse) => void | Promise<void>;
  /**
   * densable onAbandon (cpe): fired when abandon() closes an open survey
   * without a response (explicit dismiss path). Not fired for otherSurveyActive
   * supersede (densable only setState('closed') there).
   */
  onAbandon?: (appearanceId: string) => void | Promise<void>;
  /**
   * densable otherSurveyActive: when true while this survey is open, force-close
   * without onAbandon telemetry (higher-priority survey took over).
   */
  otherSurveyActive?: boolean;
  /**
   * densable autoDismissAfterMs: when open, auto-close after this delay and fire
   * onAutoDismiss (not onAbandon).
   */
  autoDismissAfterMs?: number;
  onAutoDismiss?: (appearanceId: string) => void | Promise<void>;
  shouldShowTranscriptPrompt?: (selected: FeedbackSurveyResponse) => boolean;
  onTranscriptPromptShown?: (appearanceId: string, surveyResponse: FeedbackSurveyResponse) => void;
  onTranscriptSelect?: (
    appearanceId: string,
    selected: TranscriptShareResponse,
    surveyResponse: FeedbackSurveyResponse | null,
  ) => boolean | Promise<boolean>;
};

export function useSurveyState({
  hideThanksAfterMs,
  onOpen,
  onSelect,
  onAbandon,
  otherSurveyActive = false,
  autoDismissAfterMs,
  onAutoDismiss,
  shouldShowTranscriptPrompt,
  onTranscriptPromptShown,
  onTranscriptSelect,
}: UseSurveyStateOptions): {
  state: SurveyState;
  lastResponse: FeedbackSurveyResponse | null;
  open: () => void;
  /** densable abandon: close open survey + fire onAbandon */
  abandon: () => void;
  handleSelect: (selected: FeedbackSurveyResponse) => boolean;
  /** densable handleUndo: cancel pending commit and return to open */
  handleUndo: () => void;
  handleTranscriptSelect: (selected: TranscriptShareResponse) => void;
} {
  const [state, setState] = useState<SurveyState>('closed');
  const [lastResponse, setLastResponse] = useState<FeedbackSurveyResponse | null>(null);
  const appearanceId = useRef(randomUUID());
  const lastResponseRef = useRef<FeedbackSurveyResponse | null>(null);
  // densable keeps onAbandon ref so abandon callback identity can stay stable
  const onAbandonRef = useRef(onAbandon);
  onAbandonRef.current = onAbandon;
  const onAutoDismissRef = useRef(onAutoDismiss);
  onAutoDismissRef.current = onAutoDismiss;
  // densable E.current: pending commit timer (cleared on undo / unmount)
  const pendingCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pendingCommitTimerRef.current !== null) {
        clearTimeout(pendingCommitTimerRef.current);
        pendingCommitTimerRef.current = null;
      }
    },
    [],
  );

  const showThanksThenClose = useCallback(() => {
    setState('thanks');
    setTimeout(
      (setState, setLastResponse) => {
        setState('closed');
        setLastResponse(null);
      },
      hideThanksAfterMs,
      setState,
      setLastResponse,
    );
  }, [hideThanksAfterMs]);

  const showSubmittedThenClose = useCallback(() => {
    setState('submitted');
    setTimeout(setState, hideThanksAfterMs, 'closed');
  }, [hideThanksAfterMs]);

  const open = useCallback(() => {
    if (state !== 'closed') {
      return;
    }
    setState('open');
    appearanceId.current = randomUUID();
    void onOpen(appearanceId.current);
  }, [state, onOpen]);

  // densable abandon(H): only when currently open
  const abandon = useCallback(() => {
    if (state !== 'open') return;
    setState('closed');
    setLastResponse(null);
    void onAbandonRef.current?.(appearanceId.current);
  }, [state]);

  // densable: otherSurveyActive closes open survey without abandon telemetry
  useEffect(() => {
    if (otherSurveyActive && state === 'open') {
      setState('closed');
      setLastResponse(null);
    }
  }, [otherSurveyActive, state]);

  // densable autoDismiss: qu-style timer while open
  useEffect(() => {
    if (state !== 'open' || autoDismissAfterMs == null || autoDismissAfterMs <= 0) {
      return;
    }
    const t = setTimeout(() => {
      setState('closed');
      setLastResponse(null);
      void onAutoDismissRef.current?.(appearanceId.current);
    }, autoDismissAfterMs);
    return () => clearTimeout(t);
  }, [state, autoDismissAfterMs]);

  // densable P: commit selected response (fires after pending window or dismissed immediately)
  const commitSelect = useCallback(
    (selected: FeedbackSurveyResponse): boolean => {
      pendingCommitTimerRef.current = null;
      void onSelect(appearanceId.current, selected);

      if (selected === 'dismissed') {
        setState('closed');
        setLastResponse(null);
      } else if (shouldShowTranscriptPrompt?.(selected)) {
        setState('transcript_prompt');
        onTranscriptPromptShown?.(appearanceId.current, selected);
        return true;
      } else {
        showThanksThenClose();
      }
      return false;
    },
    [showThanksThenClose, onSelect, shouldShowTranscriptPrompt, onTranscriptPromptShown],
  );

  // densable O: handleSelect → pending for non-dismissed, commit after djb
  const handleSelect = useCallback(
    (selected: FeedbackSurveyResponse): boolean => {
      setLastResponse(selected);
      lastResponseRef.current = selected;
      if (selected === 'dismissed') {
        return commitSelect(selected);
      }
      setState('pending');
      if (pendingCommitTimerRef.current !== null) {
        clearTimeout(pendingCommitTimerRef.current);
      }
      pendingCommitTimerRef.current = setTimeout(() => {
        commitSelect(selected);
      }, SURVEY_PENDING_COMMIT_MS);
      // pending path never shows transcript immediately
      return false;
    },
    [commitSelect],
  );

  // densable N: handleUndo — cancel pending commit, reopen survey
  const handleUndo = useCallback(() => {
    if (pendingCommitTimerRef.current !== null) {
      clearTimeout(pendingCommitTimerRef.current);
      pendingCommitTimerRef.current = null;
    }
    setLastResponse(null);
    lastResponseRef.current = null;
    setState('open');
  }, []);

  const handleTranscriptSelect = useCallback(
    (selected: TranscriptShareResponse) => {
      switch (selected) {
        case 'yes':
          setState('submitting');
          void (async () => {
            try {
              const success = await onTranscriptSelect?.(appearanceId.current, selected, lastResponseRef.current);
              if (success) {
                showSubmittedThenClose();
              } else {
                showThanksThenClose();
              }
            } catch {
              showThanksThenClose();
            }
          })();
          break;
        case 'no':
        case 'dont_ask_again':
          void onTranscriptSelect?.(appearanceId.current, selected, lastResponseRef.current);
          showThanksThenClose();
          break;
      }
    },
    [showThanksThenClose, showSubmittedThenClose, onTranscriptSelect],
  );

  return {
    state,
    lastResponse,
    open,
    abandon,
    handleSelect,
    handleUndo,
    handleTranscriptSelect,
  };
}
