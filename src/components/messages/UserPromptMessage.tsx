import { feature } from 'bun:bundle';
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React, { useContext, useMemo } from 'react';
import { getKairosActive, getUserMsgOptIn } from '../../bootstrap/state.js';
import { Box } from '@anthropic/ink';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { useAppState } from '../../state/AppState.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { logError } from '../../utils/log.js';
import { countCharInString } from '../../utils/stringUtils.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import { HighlightedThinkingText } from './HighlightedThinkingText.js';
import { truncateUserPromptForDisplay } from './userPromptDisplay.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  isTranscriptMode?: boolean;
  timestamp?: string;
};

export function UserPromptMessage({ addMargin, param: { text }, isTranscriptMode, timestamp }: Props): React.ReactNode {
  // REPL.tsx passes isBriefOnly={viewedTeammateTask ? false : isBriefOnly}
  // but that prop isn't threaded this deep — replicate the override by
  // reading viewingAgentTaskId directly. Computed here (not in the child)
  // so the parent Box can drop its backgroundColor: in brief mode the
  // child renders a label-style layout, and Box backgroundColor paints
  // behind children unconditionally (they can't opt out).
  //
  // Hooks must always be called unconditionally to satisfy React rules.
  // The feature gate is applied to the computed value, not the hook call.
  const isBriefOnlyState = useAppState(s => s.isBriefOnly);
  const viewingAgentTaskIdState = useAppState(s => s.viewingAgentTaskId);
  // Hoisted to mount-time — per-message component, re-renders on every scroll.
  const briefEnvEnabledState = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_BRIEF), []);
  const useBriefLayout =
    feature('KAIROS') || feature('KAIROS_BRIEF')
      ? (getKairosActive() ||
          (getUserMsgOptIn() &&
            (briefEnvEnabledState || getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_brief', false)))) &&
        isBriefOnlyState &&
        !isTranscriptMode &&
        !viewingAgentTaskIdState
      : false;

  // densable V3i: truncate to {head,hiddenLines,tail} (not string ellipsis).
  const displayText = useMemo(() => truncateUserPromptForDisplay(text, countCharInString), [text]);

  const isSelected = useContext(MessageActionsSelectedContext);

  if (!text) {
    logError(new Error('No content found in user prompt message'));
    return null;
  }

  return (
    <Box
      flexDirection="column"
      marginTop={addMargin ? 1 : 0}
      backgroundColor={isSelected ? 'messageActionsBackground' : useBriefLayout ? undefined : 'userMessageBackground'}
      paddingRight={useBriefLayout ? 0 : 1}
    >
      <HighlightedThinkingText
        text={displayText}
        useBriefLayout={useBriefLayout}
        timestamp={useBriefLayout ? timestamp : undefined}
      />
    </Box>
  );
}
