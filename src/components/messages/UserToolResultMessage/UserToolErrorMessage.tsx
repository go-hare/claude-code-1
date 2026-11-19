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

/**
 * Official 2.1.325 `xwo` / `D5i` (#2275): detect when Claude tried to invoke a
 * user-only command (`disable-model-invocation`, UI command, or built-in CLI
 * command) via SkillTool, and return the sanitized command name so it renders
 * as a dim guidance line instead of a red tool error.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: official xwo rejects control chars in command names
const UNSAFE_COMMAND_CHAR_RE = /[\x00-\x1f\x7f-\x9f\s]/;
const LEADING_COMBINING_OR_IGNORABLE_RE = /^\p{M}|\p{Default_Ignorable_Code_Point}/u;
const DISABLE_MODEL_INVOCATION_RE =
  /^(?:<tool_use_error>)?Skill ([^\s<>]+) cannot be used with Skill tool due to disable-model-invocation\./;
const USER_ONLY_COMMAND_RE = /^(?:<tool_use_error>)?([^\s<>]+) is a (?:UI|built-in CLI) command, not a skill\./;

export function isSafeUserOnlyCommandName(name: string): boolean {
  if (name.length === 0 || name.length > 128) return false;
  if (UNSAFE_COMMAND_CHAR_RE.test(name)) return false;
  if (LEADING_COMBINING_OR_IGNORABLE_RE.test(name)) return false;
  return true;
}

export function extractUserOnlyCommandError(
  content: ToolResultBlockParam['content'],
  input?: unknown,
): string | undefined {
  const raw =
    typeof content === 'string'
      ? content
      : Array.isArray(content) &&
          content.length === 1 &&
          content[0]?.type === 'text' &&
          typeof content[0].text === 'string'
        ? content[0].text
        : undefined;
  if (!raw) return undefined;
  const match = DISABLE_MODEL_INVOCATION_RE.exec(raw) ?? USER_ONLY_COMMAND_RE.exec(raw);
  if (!match) return undefined;
  const fromError = match[1]?.replace(/^\/+/, '');
  const fromInput =
    typeof input === 'object' && input !== null && typeof (input as { skill?: unknown }).skill === 'string'
      ? (input as { skill: string }).skill.trim().replace(/^\/+/, '')
      : undefined;
  const cmd = fromInput && fromInput === fromError ? fromInput : fromError;
  if (!cmd || !isSafeUserOnlyCommandName(cmd)) return undefined;
  return cmd;
}

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

  // Official 2.1.325 (#2275): render a dim line instead of a red error when
  // Claude tries a user-only command (`disableModelInvocation`, UI, or built-in CLI).
  if (!verbose && isTranscriptMode !== true) {
    const userOnlyCmd = extractUserOnlyCommandError(param.content, input);
    if (userOnlyCmd !== undefined) {
      return (
        <MessageResponse>
          <Text dimColor wrap="wrap">
            Claude couldn&apos;t run /{userOnlyCmd}. It runs only when you type it at the prompt.
          </Text>
        </MessageResponse>
      );
    }
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
