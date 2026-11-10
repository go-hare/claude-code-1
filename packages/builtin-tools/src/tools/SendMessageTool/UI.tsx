import React from 'react';
import stripAnsi from 'strip-ansi';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { OutputLine } from 'src/components/shell/OutputLine.js';
import { Text } from '@anthropic/ink';
import { sanitizeDisplayText, sanitizeDisplayTextInner } from 'src/utils/displaySanitize.js';
import { getGraphemeSegmenter } from 'src/utils/intl.js';
import { jsonParse } from 'src/utils/slowOperations.js';
import type { Input, SendMessageToolOutput } from './SendMessageTool.js';

const DEFAULT_IGNORABLE_RE = /\p{DI}/gu;

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  if (typeof input.to === 'string' && input.to.startsWith('did:') && typeof input.message === 'string') {
    const clean = (s: string) =>
      sanitizeDisplayTextInner(stripAnsi(s).replace(DEFAULT_IGNORABLE_RE, ''), false)
        .replace(/[\s⠀]+/g, ' ')
        .trim();
    const msg = clean(input.message);
    const segments = Array.from(getGraphemeSegmenter().segment(msg), s => s.segment);
    const count = segments.length;
    const truncated = count > 200 ? `${segments.slice(0, 200).join('')}… [${count} chars total]` : msg;
    return sanitizeDisplayText(`${clean(input.to)} ← "${truncated}"`);
  }
  if (typeof input.message !== 'object' || input.message === null) {
    return null;
  }
  if (input.message.type === 'plan_approval_response') {
    return input.message.approve ? `approve plan from: ${input.to}` : `reject plan from: ${input.to}`;
  }
  return null;
}

function formatInlineHandback(handback: {
  displayName: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}): string {
  const texts = handback.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text!)
    .join('\n');
  return `Resumed agent ${handback.displayName}. Result:\n\n${texts || '(no text output)'}`;
}

export function renderToolResultMessage(
  content: SendMessageToolOutput | string,
  _progressMessages: unknown,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  let parsed: unknown = content;
  if (typeof content === 'string') {
    try {
      parsed = jsonParse(content);
    } catch {
      return <OutputLine content={content} verbose={verbose} />;
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return typeof content === 'string' ? <OutputLine content={content} verbose={verbose} /> : null;
  }

  const result = parsed as SendMessageToolOutput & {
    display?: string;
    inlineHandback?: {
      displayName: string;
      content: ReadonlyArray<{ type: string; text?: string }>;
    };
    message?: string;
  };

  if ('routing' in result && result.routing) {
    return null;
  }

  if ('request_id' in result && result.request_id !== undefined && 'target' in result && result.target !== undefined) {
    return null;
  }

  const text = result.display ?? (result.inlineHandback ? formatInlineHandback(result.inlineHandback) : result.message);

  if (text === undefined) {
    return null;
  }

  return (
    <MessageResponse>
      <Text dimColor>{text}</Text>
    </MessageResponse>
  );
}
