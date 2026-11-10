import figures from 'figures';
import * as React from 'react';
import { useContext } from 'react';
import { useQueuedMessage } from '../../context/QueuedMessageContext.js';
import { Box, Divider, Text, type Theme } from '@anthropic/ink';
import { formatBriefTimestamp } from '../../utils/formatBriefTimestamp.js';
import { findThinkingTriggerPositions, getRainbowColor, isUltrathinkEnabled } from '../../utils/thinking.js';
import { Markdown } from '../Markdown.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import {
  formatHiddenLinesTitle,
  isTruncatedUserPromptText,
  USER_PROMPT_MARKDOWN_MAX_CHARS,
  type UserPromptDisplayText,
} from './userPromptDisplay.js';

type Props = {
  text: UserPromptDisplayText;
  useBriefLayout?: boolean;
  timestamp?: string;
  bodyOnly?: boolean;
  awaitingModel?: boolean;
};

/** densable Gfr — plain / ultrathink rainbow text (no Markdown). */
function RainbowOrPlainText({ text, color }: { text: string; color: keyof Theme }): React.ReactNode {
  const triggers = isUltrathinkEnabled() ? findThinkingTriggerPositions(text) : [];

  if (triggers.length === 0) {
    return <Text color={color}>{text}</Text>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const t of triggers) {
    if (t.start > cursor) {
      parts.push(
        <Text key={`plain-${cursor}`} color={color}>
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
      <Text key={`plain-${cursor}`} color={color}>
        {text.slice(cursor)}
      </Text>,
    );
  }

  return <Text>{parts}</Text>;
}

/** densable Gto — truncation gutter between head/tail. */
function HiddenLinesDivider({
  hiddenLines,
  hiddenChars,
  indent,
}: {
  hiddenLines: number;
  hiddenChars?: number;
  indent: number;
}): React.ReactNode {
  return (
    <Divider
      title={formatHiddenLinesTitle(hiddenLines, hiddenChars)}
      titleAlign="start"
      color="subtle"
      padding={indent}
    />
  );
}

export function HighlightedThinkingText({
  text,
  useBriefLayout,
  timestamp,
  bodyOnly = false,
  awaitingModel = false,
}: Props): React.ReactNode {
  // Brief/assistant mode: chat-style "You" label instead of the ❯ highlight.
  // Parent drops its backgroundColor when this is true, so no grey shows
  // through. No manual wrap needed — Ink wraps inside the parent Box.
  const queued = useQueuedMessage();
  const isQueued = queued?.isQueued ?? false;
  const isSelected = useContext(MessageActionsSelectedContext);
  const queueHighlight = queued?.selectionHighlight;
  const isQueueSelected = queueHighlight === 'on';
  const isDimmed = isQueued || awaitingModel;
  const pointerColor = isQueueSelected || isSelected ? 'suggestion' : 'inactive';
  const pointerAriaLabel = isQueueSelected ? 'selected:' : 'you:';
  const hidePointerGutter = queueHighlight === 'off';
  const showBriefSelectedPointer = isQueueSelected;
  const isObj = isTruncatedUserPromptText(text);
  const hasUltrathinkTrigger = !isObj && isUltrathinkEnabled() && findThinkingTriggerPositions(text).length > 0;
  // densable Zkt: markdown runs for queued / awaitingModel prompts too (with monochrome).
  const useMarkdown = !isObj && text.length <= USER_PROMPT_MARKDOWN_MAX_CHARS && !hasUltrathinkTrigger;

  if (useBriefLayout || bodyOnly) {
    const ts = timestamp ? formatBriefTimestamp(timestamp) : '';
    const bodyColor: keyof Theme = isQueueSelected || isSelected ? 'suggestion' : isDimmed ? 'subtle' : 'text';
    const youColor: keyof Theme = isQueueSelected ? 'suggestion' : isDimmed ? 'subtle' : 'briefLabelYou';
    const paddingLeft = bodyOnly ? 0 : 2;
    let body: React.ReactNode;
    if (isObj) {
      body = (
        <>
          <Text color={bodyColor}>{text.head}</Text>
          <HiddenLinesDivider hiddenLines={text.hiddenLines} indent={paddingLeft} />
          <Text color={bodyColor}>{text.tail}</Text>
        </>
      );
    } else if (useMarkdown) {
      body = (
        <Markdown promptMode color={bodyColor} monochrome={isDimmed}>
          {text}
        </Markdown>
      );
    } else {
      body = <Text color={bodyColor}>{text}</Text>;
    }
    return (
      <Box flexDirection="column" paddingLeft={paddingLeft}>
        {bodyOnly ? null : (
          <Box flexDirection="row">
            {showBriefSelectedPointer ? (
              <Text aria-label="selected:" color="suggestion">
                {figures.pointer}{' '}
              </Text>
            ) : null}
            <Text color={youColor}>You</Text>
            {ts ? <Text dimColor> {ts}</Text> : null}
          </Box>
        )}
        {body}
      </Box>
    );
  }

  // densable Zkt: pointer gutter + body. Indent for Divider accounts for "❯ ".
  const dividerIndent = 3 + (queued?.paddingWidth ?? 0);
  const bodyColor: keyof Theme = isQueueSelected || isSelected ? 'suggestion' : isDimmed ? 'inactive' : 'text';

  let body: React.ReactNode;
  if (isObj) {
    body = (
      <Box flexDirection="column">
        <RainbowOrPlainText text={text.head} color={bodyColor} />
        <HiddenLinesDivider hiddenLines={text.hiddenLines} indent={dividerIndent} />
        <RainbowOrPlainText text={text.tail} color={bodyColor} />
      </Box>
    );
  } else if (useMarkdown) {
    body = (
      <Markdown promptMode color={bodyColor} monochrome={isDimmed}>
        {text}
      </Markdown>
    );
  } else {
    body = <RainbowOrPlainText text={text} color={bodyColor} />;
  }

  return (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        {hidePointerGutter ? (
          <Text>{'  '}</Text>
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

/** densable 2.1.289 Vk — inbound-label prompt body (no background box, no pointer). */
export function InboundPromptText({ text }: { text: UserPromptDisplayText }): React.ReactNode {
  if (!isTruncatedUserPromptText(text)) {
    return <Text wrap="wrap">{text}</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">{text.head}</Text>
      <HiddenLinesDivider hiddenLines={text.hiddenLines} hiddenChars={text.hiddenChars} indent={0} />
      <Text wrap="wrap">{text.tail}</Text>
    </Box>
  );
}
