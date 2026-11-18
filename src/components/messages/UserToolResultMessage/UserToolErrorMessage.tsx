import { feature } from 'bun:bundle';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import stripAnsi from 'strip-ansi';
import { BULLET_OPERATOR } from '../../../constants/figures.js';
import { Byline, Link, Text } from '@anthropic/ink';
import { filterToolProgressMessages, type Tool, type Tools } from '../../../Tool.js';
import type { ProgressMessage } from '../../../types/message.js';
import {
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  isClassifierDenial,
  PLAN_REJECTION_PREFIX,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
} from '../../../utils/messages.js';
import { FallbackToolUseErrorMessage } from '../../FallbackToolUseErrorMessage.js';
import { InterruptedByUser } from '../../InterruptedByUser.js';
import { MessageResponse } from '../../MessageResponse.js';
import { RejectedPlanMessage } from './RejectedPlanMessage.js';
import { RejectedToolUseMessage } from './RejectedToolUseMessage.js';

const CLASSIFIER_REJECTION_PREFIX_1 =
  'Permission for this action has been denied by the Claude Code auto mode classifier. Reason: ';
const CLASSIFIER_REJECTION_PREFIX_2 = 'Permission for this action has been denied. Reason: ';
const CLASSIFIER_REASON_END = '. If you have other tasks';

function extractClassifierDenialReason(content: string): string | null {
  const prefix = content.startsWith(CLASSIFIER_REJECTION_PREFIX_1)
    ? CLASSIFIER_REJECTION_PREFIX_1
    : content.startsWith(CLASSIFIER_REJECTION_PREFIX_2)
      ? CLASSIFIER_REJECTION_PREFIX_2
      : null;
  if (!prefix) return null;
  const rest = content.slice(prefix.length);
  const idx = rest.indexOf(CLASSIFIER_REASON_END);
  if (idx <= 0) return null;
  return rest.slice(0, idx);
}

/**
 * Official 2.1.296 (#541): Ri(toolDenialKind, verbose) & On({ callCount })
 */
export const AUTOMODE_UNAVAILABLE_REASON = "auto mode's check had no usable answer";

export function isAutomodeUnavailable(toolDenialKind: string | undefined, verbose: boolean): boolean {
  return (toolDenialKind === 'automode-unavailable' || toolDenialKind === 'automode-parsing-error') && verbose !== true;
}

export function AutomodeNotRunRow({ callCount }: { callCount?: number }): React.ReactNode {
  const label = callCount === undefined ? 'Not run' : `${callCount} ${callCount === 1 ? 'action' : 'actions'} not run`;
  return (
    <Byline>
      <Text>{label}</Text>
      <Text>{AUTOMODE_UNAVAILABLE_REASON}</Text>
    </Byline>
  );
}

type Props = {
  progressMessagesForMessage: ProgressMessage[];
  tool?: Tool; // undefined when resuming an old conversation that uses an old tool
  tools: Tools;
  param: ToolResultBlockParam;
  input?: unknown;
  output?: unknown;
  verbose: boolean;
  isTranscriptMode?: boolean;
  toolDenialKind?: string;
};

export function UserToolErrorMessage({
  progressMessagesForMessage,
  tool,
  tools,
  param,
  input,
  output,
  verbose,
  isTranscriptMode,
  toolDenialKind,
}: Props): React.ReactNode {
  if (typeof param.content === 'string' && param.content.includes(INTERRUPT_MESSAGE_FOR_TOOL_USE)) {
    return (
      <MessageResponse height={1}>
        <InterruptedByUser />
      </MessageResponse>
    );
  }

  if (typeof param.content === 'string' && param.content.startsWith(PLAN_REJECTION_PREFIX)) {
    // Extract the plan content from the error message
    const planContent = param.content.substring(PLAN_REJECTION_PREFIX.length);
    return <RejectedPlanMessage plan={planContent} />;
  }

  if (typeof param.content === 'string' && param.content.startsWith(REJECT_MESSAGE_WITH_REASON_PREFIX)) {
    return <RejectedToolUseMessage />;
  }

  if (feature('TRANSCRIPT_CLASSIFIER') && typeof param.content === 'string' && isClassifierDenial(param.content)) {
    const reason = extractClassifierDenialReason(stripAnsi(param.content));
    // Denied by auto mode classifier · ... see https://code.claude.com/docs/s/claude-code-auto-mode
    return (
      <MessageResponse>
        <Text dimColor>
          Denied by auto mode classifier <Text aria-hidden>{BULLET_OPERATOR} </Text>
          {reason && (
            <>
              {reason} <Text aria-hidden>{BULLET_OPERATOR} </Text>
            </>
          )}
          see <Link url="https://code.claude.com/docs/s/claude-code-auto-mode" />
        </Text>
      </MessageResponse>
    );
  }

  if (isAutomodeUnavailable(toolDenialKind, verbose)) {
    return (
      <MessageResponse>
        <Text dimColor wrap="wrap">
          <AutomodeNotRunRow />
        </Text>
      </MessageResponse>
    );
  }

  // Official 2.1.292 (#231): when a mod / permission-rule denied the tool call,
  // show the denial reason instead of a generic "Error writing/reading file".
  if (toolDenialKind === 'permission-rule' && !verbose) {
    return <FallbackToolUseErrorMessage result={param.content} verbose={verbose} />;
  }

  const errorRenderOptions = {
    progressMessagesForMessage: filterToolProgressMessages(progressMessagesForMessage),
    tools,
    verbose,
    isTranscriptMode,
    input,
    output,
    toolDenialKind,
  };

  return (
    tool?.renderToolUseErrorMessage?.(param.content, errorRenderOptions) ?? (
      <FallbackToolUseErrorMessage result={param.content} verbose={verbose} />
    )
  );
}
