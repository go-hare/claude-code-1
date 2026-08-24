import figures from 'figures';
import * as React from 'react';
import { useContext } from 'react';
import { useQueuedMessage } from '../../context/QueuedMessageContext.js';
import { Box, Divider, Text } from '@anthropic/ink';
import { formatBriefTimestamp } from '../../utils/formatBriefTimestamp.js';
import { findThinkingTriggerPositions, getRainbowColor, isUltrathinkEnabled } from '../../utils/thinking.js';
import { Markdown } from '../Markdown.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import {
  formatHiddenLinesTitle,
  isTruncatedUserPromptText,
  shouldRenderUserPromptMarkdown,
  type UserPromptDisplayText,
} from './userPromptDisplay.js';

type Props = {
  text: UserPromptDisplayText;
  useBriefLayout?: boolean;
  timestamp?: string;
};

/** densable Gfr — plain / ultrathink rainbow text (no Markdown). */
function RainbowOrPlainText({ text }: { text: string }): React.ReactNode {
  const triggers = isUltrathinkEnabled() ? findThinkingTriggerPositions(text) : [];

  if (triggers.length === 0) {
    return <Text color="text">{text}</Text>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const t of triggers) {
    if (t.start > cursor) {
      parts.push(
        <Text key={`plain-${cursor}`} color="text">
          {text.slice(cursor, t.start)}
        </Text>,
      );
    }
    for (let i = t.start; i < t.end; i++) {
      parts.push(
        <Text key={`rb-${i}`} color={getRainbowColor(i - t.start)}>
          {text[i]}
        </Text>,
      );
    }
    cursor = t.end;
  }
  if (cursor < text.length) {
    parts.push(
      <Text key={`plain-${cursor}`} color="text">
        {text.slice(cursor)}
      </Text>,
    );
  }

  return <Text>{parts}</Text>;
}

/** densable Gto — truncation gutter between head/tail. */
function HiddenLinesDivider({ hiddenLines, indent }: { hiddenLines: number; indent: number }): React.ReactNode {
  return <Divider title={formatHiddenLinesTitle(hiddenLines)} titleAlign="start" color="subtle" padding={indent} />;
}

export function HighlightedThinkingText({ text, useBriefLayout, timestamp }: Props): React.ReactNode {
  // Brief/assistant mode: chat-style "You" label instead of the ❯ highlight.
  // Parent drops its backgroundColor when this is true, so no grey shows
  // through. No manual wrap needed — Ink wraps inside the parent Box.
  const queued = useQueuedMessage();
  const isQueued = queued?.isQueued ?? false;
  const isSelected = useContext(MessageActionsSelectedContext);
  const queueHighlight = queued?.selectionHighlight;
  const isQueueSelected = queueHighlight === 'on';
  const pointerColor = isQueueSelected || isSelected ? 'suggestion' : 'subtle';
  const pointerAriaLabel = isQueueSelected ? 'selected:' : 'you:';
  const hidePointerGutter = queueHighlight === 'off';
  const showBriefSelectedPointer = isQueueSelected;
  const isObj = isTruncatedUserPromptText(text);
  const hasUltrathinkTrigger = !isObj && isUltrathinkEnabled() && findThinkingTriggerPositions(text).length > 0;
  // densable j3i Bto
  const useMarkdown = shouldRenderUserPromptMarkdown(text, {
    isQueued,
    hasUltrathinkTrigger,
  });

  if (useBriefLayout) {
    const ts = timestamp ? formatBriefTimestamp(timestamp) : '';
    const bodyColor = isQueued ? 'subtle' : 'text';
    // densable j3i brief: URl=selectionHighlight==="on" → pointer + You color suggestion
    const youColor = isQueueSelected ? 'suggestion' : isQueued ? 'subtle' : 'briefLabelYou';
    let body: React.ReactNode;
    if (isObj) {
      body = (
        <>
          <Text color={bodyColor}>{text.head}</Text>
          <HiddenLinesDivider hiddenLines={text.hiddenLines} indent={2} />
          <Text color={bodyColor}>{text.tail}</Text>
        </>
      );
    } else if (useMarkdown) {
      body = (
        <Markdown promptMode color={bodyColor}>
          {text}
        </Markdown>
      );
    } else {
      body = <Text color={bodyColor}>{text}</Text>;
    }
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Box flexDirection="row">
          {showBriefSelectedPointer ? (
            <Text aria-label="selected:" color="suggestion">
              {figures.pointer}{' '}
            </Text>
          ) : null}
          <Text color={youColor}>You</Text>
          {ts ? <Text dimColor> {ts}</Text> : null}
        </Box>
        {body}
      </Box>
    );
  }

  // densable: pointer gutter + body. Indent for Divider accounts for "❯ ".
  const dividerIndent = 3 + (queued?.paddingWidth ?? 0);

  let body: React.ReactNode;
  if (isObj) {
    body = (
      <Box flexDirection="column">
        <RainbowOrPlainText text={text.head} />
        <HiddenLinesDivider hiddenLines={text.hiddenLines} indent={dividerIndent} />
        <RainbowOrPlainText text={text.tail} />
      </Box>
    );
  } else if (useMarkdown) {
    body = (
      <Markdown promptMode color="text">
        {text}
      </Markdown>
    );
  } else {
    body = <RainbowOrPlainText text={text} />;
  }

  return (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        {hidePointerGutter ? (
          <Text> </Text>
        ) : (
          <Text aria-label={pointerAriaLabel} color={pointerColor}>
            {figures.pointer}{' '}
          </Text>
        )}
      </Box>
      {body}
    </Box>
  );
}
