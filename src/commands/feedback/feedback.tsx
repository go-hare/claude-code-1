import * as React from 'react';
import { useState } from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Feedback } from '../../components/Feedback.js';
import { FeedbackDrafts } from '../../components/FeedbackDrafts.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import type { FileStateCache } from '../../utils/fileStateCache.js';
import {
  getFeedbackCommandAvailability,
  isFeedbackCallHt,
  isSendFeedbackEnabled,
  type FeedbackCommandName,
} from '../../utils/feedbackDrafts/gates.js';

type FeedbackBackgroundTasks = {
  [taskId: string]: {
    type: string;
    identity?: { agentId: string };
    messages?: Message[];
  };
};

function taskRegistrySnapshot(context: LocalJSXCommandContext): FeedbackBackgroundTasks {
  const registry = (
    context as LocalJSXCommandContext & {
      taskRegistry?: { all?: () => FeedbackBackgroundTasks };
    }
  ).taskRegistry;
  // gold `qe`: `{...s.taskRegistry.all()}` — leftover host may omit the slot.
  return { ...(registry?.all?.() ?? {}) };
}

/**
 * densable leftover `wur`. Disabled arm is `m(K.reason), null`.
 * Gold: `e(gt,{...,mode:K.kind,readFileState:g,command:J})`.
 * `fOn` / `surveyFeedbackSource` callee ABSENT — not invented.
 */
export function renderFeedbackComponent(
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void,
  abortSignal: AbortSignal,
  messages: Message[],
  initialDescription: string = '',
  backgroundTasks: FeedbackBackgroundTasks = {},
  readFileState?: FileStateCache,
  command: FeedbackCommandName = '/feedback',
): React.ReactNode {
  const K = getFeedbackCommandAvailability(command);
  if (K.kind === 'disabled') {
    onDone(K.reason);
    return null;
  }
  // Extra gold fields live on gt; Feedback.tsx is outside exclusive dirs.
  return (
    <Feedback
      {...({
        abortSignal,
        messages,
        initialDescription,
        onDone,
        backgroundTasks,
        mode: K.kind,
        readFileState,
        command,
      } as unknown as React.ComponentProps<typeof Feedback>)}
    />
  );
}

/** densable leftover `qe` — `{...s.taskRegistry.all()}`, `s.readFileState`, `p`. */
function openLegacyFeedback(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  description: string,
  command: FeedbackCommandName = '/feedback',
): React.ReactNode {
  return renderFeedbackComponent(
    onDone,
    context.abortController.signal,
    context.messages,
    description,
    taskRegistrySnapshot(context),
    context.readFileState,
    command,
  );
}

/**
 * densable leftover `gRt`. Default `p="/feedback"`; `/bug`/`/share` come from `n`.
 * No `/feedback` rename.
 */
export async function callLegacyFeedbackDialog(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
  command: FeedbackCommandName = '/feedback',
): Promise<React.ReactNode> {
  const description = args?.trim() === 'public' ? '' : args || '';
  return openLegacyFeedback(onDone, context, description, command);
}

function FeedbackDraftsHost({
  onDone,
  context,
}: {
  onDone: LocalJSXCommandOnDone;
  context: LocalJSXCommandContext;
}): React.ReactNode {
  const [writeNew, setWriteNew] = useState(false);
  if (writeNew) {
    return openLegacyFeedback(onDone, context, '');
  }
  return (
    <FeedbackDrafts
      messages={context.messages}
      onDone={onDone}
      abortSignal={context.abortController.signal}
      onWriteNew={() => setWriteNew(true)}
    />
  );
}

/** densable leftover jr / Ns — sr only when aLt && no args && !Ht */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  if (isSendFeedbackEnabled() && !args?.trim() && !isFeedbackCallHt()) {
    return <FeedbackDraftsHost onDone={onDone} context={context} />;
  }
  return callLegacyFeedbackDialog(onDone, context, args);
}
