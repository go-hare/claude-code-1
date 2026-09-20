import * as React from 'react';
import { useState } from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Feedback } from '../../components/Feedback.js';
import { FeedbackDrafts } from '../../components/FeedbackDrafts.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import {
  getFeedbackCommandAvailability,
  isFeedbackCallHt,
  isSendFeedbackEnabled,
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
  return registry?.all?.() ?? {};
}

/** densable leftover Yo / Ls / renderFeedbackComponent */
export function renderFeedbackComponent(
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void,
  abortSignal: AbortSignal,
  messages: Message[],
  initialDescription: string = '',
  backgroundTasks: FeedbackBackgroundTasks = {},
): React.ReactNode {
  const availability = getFeedbackCommandAvailability();
  if (availability.kind === 'disabled') {
    onDone(availability.reason);
    return null;
  }
  return (
    <Feedback
      abortSignal={abortSignal}
      messages={messages}
      initialDescription={initialDescription}
      onDone={onDone}
      backgroundTasks={backgroundTasks}
    />
  );
}

/** densable leftover ut */
function openLegacyFeedback(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  description: string,
): React.ReactNode {
  return renderFeedbackComponent(
    onDone,
    context.abortController.signal,
    context.messages,
    description,
    taskRegistrySnapshot(context),
  );
}

/** densable leftover en / Ms / callLegacyFeedbackDialog */
export async function callLegacyFeedbackDialog(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const description = args?.trim() === 'public' ? '' : args || '';
  return openLegacyFeedback(onDone, context, description);
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
