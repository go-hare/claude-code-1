import { feature } from 'bun:bundle';
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import React, { useContext, useMemo } from 'react';
import { getKairosActive, getUserMsgOptIn } from '../../bootstrap/state.js';
import {
  formatImageRef,
  parseReferences,
  shouldMarkPastedContent,
  unwrapPastedContentForDisplay,
} from '../../history.js';
import { Box, Text } from '@anthropic/ink';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { useAppState } from '../../state/AppState.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { redactImageNotShownForDisplay } from '../../utils/imageResizer.js';
import { logError } from '../../utils/log.js';
import { toSafeFileUrl } from '../../utils/markdownFileUrl.js';
import { countCharInString } from '../../utils/stringUtils.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import { HighlightedThinkingText, InboundPromptText } from './HighlightedThinkingText.js';
import { truncateUserPromptForDisplay, USER_PROMPT_MARKDOWN_MAX_CHARS } from './userPromptDisplay.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  isTranscriptMode?: boolean;
  timestamp?: string;
  origin?: { kind?: string; name?: string; plugin?: string };
  awaitingModel?: boolean;
  followsSpeakerLabel?: boolean;
  followsInboundLabel?: boolean;
  hidePluginOriginHeader?: boolean;
  /** densable TDe draw(c.props.text) — PluginUserMessageSite rewrite. */
  rewrittenText?: string;
};

function isSubagentHistoryEnabled(): boolean {
  const raw = process.env.CLAUDE_CODE_SUBAGENT_HISTORY;
  if (raw !== undefined) {
    return isEnvTruthy(raw);
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_rustling_crescent', true);
}

export function formatPluginPromptOriginName(name: string): string {
  const short = name.split('@')[0]?.trim();
  return short ? short : 'unnamed';
}

export function UserPromptMessage({
  addMargin,
  param,
  isTranscriptMode,
  timestamp,
  origin,
  awaitingModel,
  followsSpeakerLabel = false,
  followsInboundLabel = false,
  hidePluginOriginHeader = false,
  rewrittenText,
}: Props): React.ReactNode {
  const rawText = rewrittenText ?? param.text;
  // Official 2.1.328 (`Odn` = `ARr(NI() ? Dml(d, lGe()) : d)`): unwrap
  // `<pasted_content id="...">` display tags when pasted content marking is enabled.
  const unwrappedText = shouldMarkPastedContent() ? unwrapPastedContentForDisplay(rawText) : rawText;
  // Official 2.1.328 #606 (`uRr`): redact `[Image not shown, read it from <cache>]`
  // back to `[Image]` in user prompt display so background-agent messages do not
  // display a long filesystem cache path.
  const text = !isTranscriptMode ? redactImageNotShownForDisplay(unwrappedText) : unwrappedText;
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
  // Official 2.1.328 `qj` (@318163544:111329): resolve coordinator sender label
  // ("main" vs "another agent") when viewing a local_agent subagent transcript.
  const coordinatorSender = useAppState(s => {
    const task = s.viewingAgentTaskId ? s.tasks[s.viewingAgentTaskId] : undefined;
    if (task?.type !== 'local_agent' || !isSubagentHistoryEnabled()) {
      return null;
    }
    return (task as { parentAgentId?: string }).parentAgentId === undefined ? 'main' : 'another agent';
  });
  // Official 2.1.328 `Zn` + `storedImagePaths` lookup (@318163544:113297):
  // build OSC 8 markLinks map for `[Image #N]` placeholders under followsSpeakerLabel.
  const imageIds = useMemo(() => {
    if (!followsSpeakerLabel || !text) return [];
    if (origin !== undefined && origin.kind !== 'human') return [];
    if (text.length > USER_PROMPT_MARKDOWN_MAX_CHARS) return [];
    const seen = new Set<number>();
    for (const ref of parseReferences(text)) {
      if (ref.match.startsWith('[Image #')) {
        seen.add(ref.id);
      }
    }
    return [...seen];
  }, [followsSpeakerLabel, origin, text]);
  const storedImagePathsKey = useAppState(s => imageIds.map(id => s.storedImagePaths?.get(id) ?? '').join('\x00'));
  const markLinks = useMemo(() => {
    if (imageIds.length === 0) return undefined;
    const paths = storedImagePathsKey.split('\x00');
    const map = new Map<string, string>();
    imageIds.forEach((id, idx) => {
      const path = paths[idx];
      const url = path ? toSafeFileUrl(path) : null;
      if (url !== null) {
        map.set(formatImageRef(id), url);
      }
    });
    return map.size > 0 ? map : undefined;
  }, [imageIds, storedImagePathsKey]);
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

  const followsAnyLabel = followsSpeakerLabel || followsInboundLabel;
  let originHeader: string | undefined;
  if (!hidePluginOriginHeader && origin?.kind === 'plugin' && typeof origin.name === 'string') {
    originHeader = `Prompt from the ${formatPluginPromptOriginName(origin.name)} plugin`;
  } else if (origin?.kind === 'coordinator' && coordinatorSender !== null && !followsAnyLabel) {
    originHeader =
      typeof origin.plugin === 'string'
        ? `From the ${formatPluginPromptOriginName(origin.plugin)} plugin`
        : `From ${coordinatorSender}`;
  }
  const innerMargin = originHeader === undefined && addMargin ? 1 : 0;

  const body = followsInboundLabel ? (
    <InboundPromptText text={displayText} />
  ) : followsSpeakerLabel ? (
    <Box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={isSelected ? 'messageActionsBackground' : 'userMessageBackground'}
    >
      <HighlightedThinkingText text={displayText} bodyOnly awaitingModel={awaitingModel} markLinks={markLinks} />
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

  return originHeader === undefined ? (
    body
  ) : (
    <Box flexDirection="column" marginTop={addMargin && !followsAnyLabel ? 1 : 0}>
      <Text dimColor>
        <Text aria-hidden>{figures.pointerSmall} </Text>
        {originHeader}
      </Text>
      {body}
    </Box>
  );
}
