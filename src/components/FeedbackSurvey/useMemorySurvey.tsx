import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isFeedbackSurveyDisabled } from 'src/services/analytics/config.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { isAutoMemoryEnabled } from '../../memdir/paths.js';
import { isPolicyAllowed } from '../../services/policyLimits/index.js';
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js';
import type { Message } from '../../types/message.js';
import { saveGlobalConfig } from '../../utils/config.js';
import { isAutoManagedMemoryFile } from '../../utils/memoryFileDetection.js';
import { isForceMemorySurveyEnabled } from '../../utils/residualMoreEnvGates.js';
import { isFeedbackSurveyEnvDisabled } from '../../utils/residualFinalEnvGates.js';
import { extractMemoryCitationFromAssistantContent } from '../../utils/memoryCitation.js';
import { MEMORY_SURVEY_RESPONSE_SCORE, writeMemorySurveyRatings } from '../../utils/memorySurveyRating.js';
import { extractTextContent, getLastAssistantMessage } from '../../utils/messages.js';
import { logOTelEvent } from '../../utils/telemetry/events.js';
import { submitTranscriptShare } from './submitTranscriptShare.js';
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js';
import { useSurveyState } from './useSurveyState.js';
import type { FeedbackSurveyResponse } from './utils.js';

/** densable Sjb */
const HIDE_THANKS_AFTER_MS = 5000;
/** densable Ejb: auto-close open memory survey after 60s → event_type timeout */
const AUTO_DISMISS_AFTER_MS = 60_000;
const MEMORY_SURVEY_GATE = 'tengu_dunwich_bell';
const MEMORY_SURVEY_EVENT = 'tengu_memory_survey_event';
/** densable Cjb / Ajb — default 0.2 when GB unset or non-numeric. */
const MEMORY_SURVEY_PROBABILITY_FLAG = 'tengu_velvet_moth';
const DEFAULT_SURVEY_PROBABILITY = 0.2;
const TRANSCRIPT_SHARE_TRIGGER = 'memory_survey';

/** densable Ajb — sampling probability for memory survey appear. */
function getMemorySurveyProbability(): number {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(MEMORY_SURVEY_PROBABILITY_FLAG, DEFAULT_SURVEY_PROBABILITY);
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_SURVEY_PROBABILITY;
}

const MEMORY_WORD_RE = /\bmemor(?:y|ies)\b/i;

function hasMemoryFileRead(messages: Message[]): boolean {
  for (const message of messages) {
    if (message.type !== 'assistant') {
      continue;
    }
    const content = message.message!.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (block.type !== 'tool_use' || block.name !== FILE_READ_TOOL_NAME) {
        continue;
      }
      const input = block.input as { file_path?: unknown };
      if (typeof input.file_path === 'string' && isAutoManagedMemoryFile(input.file_path)) {
        return true;
      }
    }
  }
  return false;
}

export function useMemorySurvey(
  messages: Message[],
  isLoading: boolean,
  hasActivePrompt = false,
  { enabled = true, otherSurveyActive = false }: { enabled?: boolean; otherSurveyActive?: boolean } = {},
): {
  state: 'closed' | 'open' | 'pending' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';
  lastResponse: FeedbackSurveyResponse | null;
  /** densable citation from last opened memory survey (cc-memory span). */
  citation: { sentence: string; filenames: string[] } | null;
  handleSelect: (selected: FeedbackSurveyResponse) => void;
  handleUndo: () => void;
  abandon: () => void;
  handleTranscriptSelect: (selected: TranscriptShareResponse) => void;
} {
  // Track assistant message UUIDs that were already evaluated so we don't
  // re-roll probability on re-renders or re-scan messages for the same turn.
  const seenAssistantUuids = useRef<Set<string>>(new Set());
  // densable u: last opened citation (filenames used for surveyRating write-back)
  const openCitationRef = useRef<{
    sentence: string;
    filenames: string[];
  } | null>(null);
  // densable s: first message uuid — detect /clear resets
  const firstMessageUuidRef = useRef<string | null>(null);
  // densable l/c: last opened citation for residual UI consumers
  const [citation, setCitation] = useState<{
    sentence: string;
    filenames: string[];
  } | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const onOpen = useCallback((appearanceId: string) => {
    logEvent(MEMORY_SURVEY_EVENT, {
      event_type: 'appeared' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'appeared',
      appearance_id: appearanceId,
      survey_type: 'memory',
    });
  }, []);

  // densable g: responded + optional surveyRating write-back for cited files
  const onSelect = useCallback((appearanceId: string, selected: FeedbackSurveyResponse) => {
    logEvent(MEMORY_SURVEY_EVENT, {
      event_type: 'responded' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      response: selected as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'responded',
      appearance_id: appearanceId,
      response: selected,
      survey_type: 'memory',
    });
    const score = MEMORY_SURVEY_RESPONSE_SCORE[selected];
    const cited = openCitationRef.current;
    if (score !== undefined && cited && cited.filenames.length > 0) {
      void writeMemorySurveyRatings(cited.filenames, score);
    }
  }, []);

  // densable f: autoDismiss → event_type "timeout"
  const onAutoDismiss = useCallback((appearanceId: string) => {
    logEvent(MEMORY_SURVEY_EVENT, {
      event_type: 'timeout' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'timeout',
      appearance_id: appearanceId,
      survey_type: 'memory',
    });
  }, []);

  // densable m: abandon → event_type "abandoned"
  const onAbandon = useCallback((appearanceId: string) => {
    logEvent(MEMORY_SURVEY_EVENT, {
      event_type: 'abandoned' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'abandoned',
      appearance_id: appearanceId,
      survey_type: 'memory',
    });
  }, []);

  // densable y: always false (memory survey does not open transcript share)
  const shouldShowTranscriptPrompt = useCallback((_selected: FeedbackSurveyResponse) => {
    return false;
  }, []);

  const onTranscriptPromptShown = useCallback((appearanceId: string) => {
    logEvent(MEMORY_SURVEY_EVENT, {
      event_type: 'transcript_prompt_appeared' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger: TRANSCRIPT_SHARE_TRIGGER as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'transcript_prompt_appeared',
      appearance_id: appearanceId,
      survey_type: 'memory',
    });
  }, []);

  const onTranscriptSelect = useCallback(
    async (appearanceId: string, selected: TranscriptShareResponse): Promise<boolean> => {
      logEvent(MEMORY_SURVEY_EVENT, {
        event_type: `transcript_share_${selected}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        trigger: TRANSCRIPT_SHARE_TRIGGER as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });

      if (selected === 'dont_ask_again') {
        saveGlobalConfig(current => ({
          ...current,
          transcriptShareDismissed: true,
        }));
      }

      if (selected === 'yes') {
        const result = await submitTranscriptShare(messagesRef.current, TRANSCRIPT_SHARE_TRIGGER, appearanceId);
        logEvent(MEMORY_SURVEY_EVENT, {
          event_type: (result.success
            ? 'transcript_share_submitted'
            : 'transcript_share_failed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          trigger: TRANSCRIPT_SHARE_TRIGGER as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        return result.success;
      }

      return false;
    },
    [],
  );

  const { state, lastResponse, open, abandon, handleSelect, handleUndo, handleTranscriptSelect } = useSurveyState({
    hideThanksAfterMs: HIDE_THANKS_AFTER_MS,
    otherSurveyActive,
    autoDismissAfterMs: AUTO_DISMISS_AFTER_MS,
    onOpen,
    onSelect,
    onAutoDismiss,
    onAbandon,
    shouldShowTranscriptPrompt,
    onTranscriptPromptShown,
    onTranscriptSelect,
  });

  const lastAssistant = useMemo(() => getLastAssistantMessage(messages), [messages]);

  useEffect(() => {
    if (!enabled) return;

    // densable: empty transcript resets citation + seen set
    if (messages.length === 0) {
      seenAssistantUuids.current.clear();
      firstMessageUuidRef.current = null;
      openCitationRef.current = null;
      setCitation(null);
      return;
    }

    // densable s: first-message uuid change (e.g. /clear) → reseed seen set
    const firstUuid = messages[0]?.uuid ?? null;
    if (firstMessageUuidRef.current !== firstUuid) {
      firstMessageUuidRef.current = firstUuid;
      seenAssistantUuids.current.clear();
      for (const msg of messages) {
        if (msg.type === 'assistant') {
          seenAssistantUuids.current.add(msg.uuid);
        }
      }
      return;
    }

    if (state !== 'closed' || isLoading || hasActivePrompt) {
      return;
    }

    if (otherSurveyActive) {
      return;
    }

    // Official CLAUDE_CODE_FORCE_MEMORY_SURVEY force-on; else GB gate.
    // 3P default: survey off (no GrowthBook on Bedrock/Vertex/Foundry).
    if (!isForceMemorySurveyEnabled() && !getFeatureValue_CACHED_MAY_BE_STALE(MEMORY_SURVEY_GATE, false)) {
      return;
    }

    if (!isAutoMemoryEnabled()) {
      return;
    }

    if (isFeedbackSurveyDisabled()) {
      return;
    }

    if (!isPolicyAllowed('allow_product_feedback')) {
      return;
    }

    if (isFeedbackSurveyEnvDisabled()) {
      return;
    }

    if (!lastAssistant || seenAssistantUuids.current.has(lastAssistant.uuid)) {
      return;
    }

    // densable kjb: require <cc-memory> citation spans (not bare "memory" word).
    // Residual keeps MEMORY_WORD_RE as a cheap prefilter only when no citation
    // tags are present at all — still refuse open without a real citation.
    const citationHit = extractMemoryCitationFromAssistantContent(lastAssistant.message.content);
    seenAssistantUuids.current.add(lastAssistant.uuid);
    if (citationHit === null) {
      // Legacy residual: memory-file-read + word "memory" still allowed when
      // force gate is on (no model citation tags in older transcripts).
      if (!isForceMemorySurveyEnabled()) {
        return;
      }
      const text = extractTextContent(
        Array.isArray(lastAssistant.message.content) ? lastAssistant.message.content : [],
        ' ',
      );
      if (!MEMORY_WORD_RE.test(text) || !hasMemoryFileRead(messages)) {
        return;
      }
    }

    // densable: !Rjb() && Math.random() >= Ajb() → skip (Rjb always false).
    if (Math.random() >= getMemorySurveyProbability() && !isForceMemorySurveyEnabled()) {
      return;
    }

    openCitationRef.current = citationHit;
    setCitation(citationHit);
    open();
  }, [enabled, otherSurveyActive, state, isLoading, hasActivePrompt, lastAssistant, messages, open]);

  return {
    state,
    lastResponse,
    citation,
    handleSelect,
    handleUndo,
    abandon,
    handleTranscriptSelect,
  };
}
