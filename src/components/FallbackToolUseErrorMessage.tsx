import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import * as React from 'react';
import { stripUnderlineAnsi } from 'src/components/shell/OutputLine.js';
import { extractTag } from 'src/utils/messages.js';
import { removeSandboxViolationTags } from 'src/utils/sandbox/sandbox-ui-utils.js';
import { Ansi, Box, Text } from '@anthropic/ink';
import { countCharInString } from '../utils/stringUtils.js';
import { CtrlOToExpand } from './CtrlOToExpand.js';
import { MessageResponse } from './MessageResponse.js';

const MAX_RENDERED_LINES = 10;
const ARTIFACT_AUTHORED_BY_OTHERS_PREFIX = '<artifact-content-authored-by-others/>\n';
const WHOLE_TOOL_USE_ERROR_RE = /^\s*<tool_use_error>([\s\S]*)<\/tool_use_error>\s*$/i;
const NESTED_TOOL_USE_ERROR_RE = /<\/?tool_use_error\b/i;

type Props = {
  result: ToolResultBlockParam['content'];
  verbose: boolean;
  verbatim?: boolean;
};

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    (block as { type?: unknown }).type === 'text' &&
    'text' in block &&
    typeof (block as { text?: unknown }).text === 'string'
  );
}

function unwrapSingleToolUseError(text: string): string | undefined {
  const inner = WHOLE_TOOL_USE_ERROR_RE.exec(text)?.[1];
  return inner !== undefined && !NESTED_TOOL_USE_ERROR_RE.test(inner) ? inner : undefined;
}

function extractArrayErrorText(blocks: readonly unknown[]): string | undefined {
  const joined = blocks
    .flatMap(block => {
      if (!isTextBlock(block)) return [];
      const cleaned = stripUnderlineAnsi(block.text);
      return [unwrapSingleToolUseError(cleaned) ?? cleaned];
    })
    .join('\n');
  return joined.trim() === '' ? undefined : joined;
}

function stripArtifactAuthoredByOthersPrefix(text: string): string {
  return text.startsWith(ARTIFACT_AUTHORED_BY_OTHERS_PREFIX)
    ? text.slice(ARTIFACT_AUTHORED_BY_OTHERS_PREFIX.length)
    : text;
}

/**
 * Official 2.1.328 `OS` (`chunk@318082579.js:1180..1920`) & `Dd` (`chunk@308092713.js:1032`).
 */
export function FallbackToolUseErrorMessage({ result, verbose, verbatim = false }: Props): React.ReactNode {
  const isArray = Array.isArray(result);
  const raw = typeof result === 'string' ? result : isArray ? extractArrayErrorText(result) : undefined;
  const isVerbatim = verbatim || isArray;
  let error: string;

  if (raw === undefined) {
    error = 'Tool execution failed';
  } else {
    const cleaned = (
      isVerbatim
        ? stripUnderlineAnsi(raw)
        : removeSandboxViolationTags(stripUnderlineAnsi(extractTag(raw, 'tool_use_error') ?? raw)).replace(
            /<\/?error>/g,
            '',
          )
    ).trim();
    const visible = verbose ? cleaned : stripArtifactAuthoredByOthersPrefix(cleaned);
    if (!verbose && !isVerbatim && visible.startsWith('InputValidationError: ')) {
      error = 'Invalid tool parameters';
    } else if (visible.startsWith('Error: ') || visible.startsWith('Cancelled: ')) {
      error = visible;
    } else {
      error = `Error: ${visible}`;
    }
  }

  const plusLines = countCharInString(error, '\n') + 1 - MAX_RENDERED_LINES;
  const shown = verbose ? error : error.split('\n').slice(0, MAX_RENDERED_LINES).join('\n');

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">
          <Ansi>{shown}</Ansi>
        </Text>
        {!verbose && plusLines > 0 && (
          <Text dimColor>
            … +{plusLines} {plusLines === 1 ? 'line' : 'lines'} <CtrlOToExpand />
          </Text>
        )}
      </Box>
    </MessageResponse>
  );
}
