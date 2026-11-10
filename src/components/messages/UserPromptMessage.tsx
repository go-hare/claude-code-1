import { feature } from 'bun:bundle';
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import React, { useContext, useMemo } from 'react';
import { getKairosActive, getUserMsgOptIn } from '../../bootstrap/state.js';
import { Box, Text } from '@anthropic/ink';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { useAppState } from '../../state/AppState.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { logError } from '../../utils/log.js';
import { countCharInString } from '../../utils/stringUtils.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import { HighlightedThinkingText, InboundPromptText } from './HighlightedThinkingText.js';
import { truncateUserPromptForDisplay } from './userPromptDisplay.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  isTranscriptMode?: boolean;
  timestamp?: string;
  origin?: { kind?: string; name?: string };
  awaitingModel?: boolean;
  followsSpeakerLabel?: boolean;
  followsInboundLabel?: boolean;
};

function formatPluginPromptOriginName(name: string): string {
  const short = name.split('@')[0]?.trim();
  return short ? short : 'unnamed';
}

export function UserPromptMessage({
  addMargin,
  param: { text },
  isTranscriptMode,
  timestamp,
  origin,
  awaitingModel,
  followsSpeakerLabel = false,
  followsInboundLabel = false,
}: Props): React.ReactNode {
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

  // densable Qkt: truncate to {head,hiddenLines,hiddenChars,tail} (not string ellipsis).
  const displayText = useMemo(() => truncateUserPromptForDisplay(text, countCharInString), [text]);

  const isSelected = useContext(MessageActionsSelectedContext);

  if (!text) {
    logError(new Error('No content found in user prompt message'));
    return null;
  }

  const pluginOriginName = origin?.kind === 'plugin' && typeof origin.name === 'string' ? origin.name : undefined;
  const innerMargin = pluginOriginName === undefined && addMargin ? 1 : 0;

  const body = followsInboundLabel ? (
    <InboundPromptText text={displayText} />
  ) : followsSpeakerLabel ? (
    <Box flexDirection="column">
      <HighlightedThinkingText text={displayText} bodyOnly awaitingModel={awaitingModel} />
    </Box>
  ) : (
    <Box
      flexDirection="column"
      marginTop={innerMargin}
      backgroundColor={isSelected ? 'messageActionsBackground' : useBriefLayout ? undefined : 'userMessageBackground'}
      paddingRight={useBriefLayout ? 0 : 1}
    >
      <HighlightedThinkingText
        text={displayText}
        useBriefLayout={useBriefLayout}
        timestamp={useBriefLayout ? timestamp : undefined}
        awaitingModel={awaitingModel}
      />
    </Box>
  );

  if (pluginOriginName === undefined) {
    return body;
  }

  return (
    <Box flexDirection="column" marginTop={addMargin && !followsSpeakerLabel && !followsInboundLabel ? 1 : 0}>
      <Text dimColor>
        <Text aria-hidden>{figures.pointerSmall} </Text>
        Prompt from the {formatPluginPromptOriginName(pluginOriginName)} plugin
      </Text>
      {body}
    </Box>
  );
}
