import { feature } from 'bun:bundle';
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js';
import {
  COMMAND_MESSAGE_TAG,
  FORK_BOILERPLATE_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
  TASK_NOTIFICATION_TAG,
  TEAMMATE_MESSAGE_TAG,
  TICK_TAG,
} from '../../constants/xml.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { useQueuedMessage } from '../../context/QueuedMessageContext.js';
import {
  extractTag,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  looksLikeCrossSessionMessageEnvelope,
  peerOrObserverDisplayName,
  shouldPaintAgentInboundRow,
  uiRenderUserMessageOrigin,
} from '../../utils/messages.js';
import { InterruptedByUser } from '../InterruptedByUser.js';
import { MessageResponse } from '../MessageResponse.js';
import { PluginUserMessageSite } from '../PluginRasterPanes.js';
import { isTranscriptV2RowsEnabled } from './TranscriptV2Row.js';
import {
  isDetachedToolCallNotification,
  DetachedToolCallResultMessage,
  UserAgentNotificationMessage,
} from './UserAgentNotificationMessage.js';
import { UserBashInputMessage } from './UserBashInputMessage.js';
import { UserBashOutputMessage } from './UserBashOutputMessage.js';
import { UserCommandMessage } from './UserCommandMessage.js';
import { UserLocalCommandOutputMessage } from './UserLocalCommandOutputMessage.js';
import { UserMemoryInputMessage } from './UserMemoryInputMessage.js';
import { UserPlanMessage } from './UserPlanMessage.js';
import { formatPluginPromptOriginName, UserPromptMessage } from './UserPromptMessage.js';
import { UserResourceUpdateMessage } from './UserResourceUpdateMessage.js';
import { UserTeammateMessage } from './UserTeammateMessage.js';
import { UserCrossSessionMessage } from './UserCrossSessionMessage.js';

const ARTIFACT_ROOM_VIEW_NOTIFICATION_PREFIX = `<${TASK_NOTIFICATION_TAG}>\n<task-type>artifact-room-view</task-type>\n`;

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  verbose: boolean;
  planContent?: string;
  isTranscriptMode?: boolean;
  timestamp?: string;
  /** densable `xI("UserMessage")` requestId (`URe` messageId). */
  requestId?: string;
  /** densable `BX` `messageId` alias. */
  messageId?: string;
  /** densable Wr origin — plugin / channel / peer (subagent). */
  origin?: {
    kind: string;
    name?: string;
    from?: string;
    fromName?: string;
    senderTaskId?: string;
    [key: string]: unknown;
  };
  /** densable `URe` `isExpanded`. */
  isExpanded?: boolean;
  /** densable `URe` `task` — omit when unset. */
  task?: unknown;
  /** densable `URe` `from` — omit when unset. */
  from?: unknown;
  commandRun?: { command?: string; args?: string };
  followsSpeakerLabel?: boolean;
  followsInboundLabel?: boolean;
  /** densable BX `taskDelivery` — GetTask snapshot on As. */
  taskDelivery?: unknown;
};

export function UserTextMessage({
  addMargin,
  param,
  verbose,
  planContent,
  isTranscriptMode,
  timestamp,
  requestId,
  messageId,
  origin,
  isExpanded,
  task,
  from,
  commandRun,
  followsSpeakerLabel,
  followsInboundLabel,
  taskDelivery,
}: Props): React.ReactNode {
  const resolvedMessageId = requestId ?? messageId;
  const isQueued = useQueuedMessage()?.isQueued === true;
  const effectiveIsExpanded = isExpanded ?? Boolean(verbose || isTranscriptMode);
  const systemLine = !verbose && !isTranscriptMode && !isQueued && isTranscriptV2RowsEnabled();

  if (typeof param.text !== 'string' || !param.text || param.text.trim() === NO_CONTENT_MESSAGE) {
    return null;
  }

  const followsAnyLabel = Boolean(followsSpeakerLabel || followsInboundLabel);

  // densable Fg/zX — uM(origin) OR fme envelope (first-frame origin may lag).
  if (shouldPaintAgentInboundRow(origin, param.text)) {
    return (
      <UserCrossSessionMessage
        addMargin={addMargin}
        param={param}
        isTranscriptMode={isTranscriptMode}
        verbose={verbose}
        fromName={peerOrObserverDisplayName(origin)}
        fallbackLabel="agent"
        origin={origin}
        followsSpeakerLabel={followsAnyLabel}
        hostInjected={origin?.hostInjected === true}
        messageId={resolvedMessageId}
      />
    );
  }

  // Plan to implement message (cleared context flow)
  if (planContent) {
    return <UserPlanMessage addMargin={addMargin} planContent={planContent} />;
  }

  // Teammate messages - only check when swarms enabled
  if (isAgentSwarmsEnabled() && param.text.includes(`<${TEAMMATE_MESSAGE_TAG}`)) {
    return (
      <UserTeammateMessage
        addMargin={addMargin}
        param={param}
        isTranscriptMode={isTranscriptMode}
        verbose={verbose}
        messageId={resolvedMessageId}
        origin={origin}
        followsSpeakerLabel={followsAnyLabel}
      />
    );
  }

  // Inbound channel message (MCP server push) — densable z6n anchored check.
  if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isInboundChannelMessageText, UserChannelMessage } =
      require('./UserChannelMessage.js') as typeof import('./UserChannelMessage.js');
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isInboundChannelMessageText(param.text)) {
      return (
        <UserChannelMessage
          addMargin={addMargin}
          param={param}
          messageId={resolvedMessageId}
          origin={origin}
          isExpanded={isTranscriptMode || verbose}
          followsSpeakerLabel={followsAnyLabel}
        />
      );
    }
  }

  // Cross-session UDS message (from another Claude session's SendMessage).
  // Anchored via looksLikeCrossSessionMessageEnvelope (densable ese) so user
  // prompts mentioning `<cross-session-message` mid-text are never hijacked.
  if (feature('UDS_INBOX')) {
    if (looksLikeCrossSessionMessageEnvelope(param.text)) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { UserCrossSessionMessage } =
        require('./UserCrossSessionMessage.js') as typeof import('./UserCrossSessionMessage.js');
      /* eslint-enable @typescript-eslint/no-require-imports */
      return (
        <UserCrossSessionMessage
          addMargin={addMargin}
          param={param}
          verbose={verbose}
          isTranscriptMode={isTranscriptMode}
          messageId={resolvedMessageId}
          origin={origin}
          followsSpeakerLabel={followsAnyLabel}
          hostInjected={origin?.hostInjected === true}
        />
      );
    }
  }

  const renderUserPrompt = (inbound: boolean | undefined): React.ReactNode => {
    const pluginOriginName = origin?.kind === 'plugin' && typeof origin.name === 'string' ? origin.name : undefined;
    const prompt = (
      <UserPromptMessage
        addMargin={pluginOriginName === undefined && addMargin}
        param={param}
        isTranscriptMode={isTranscriptMode}
        timestamp={timestamp}
        origin={origin}
        followsSpeakerLabel={followsSpeakerLabel}
        followsInboundLabel={inbound}
        hidePluginOriginHeader
      />
    );
    const site =
      resolvedMessageId === undefined ? (
        prompt
      ) : (
        <PluginUserMessageSite
          requestId={resolvedMessageId}
          text={param.text}
          origin={uiRenderUserMessageOrigin(origin)}
          isExpanded={effectiveIsExpanded}
          task={task}
          from={from}
        >
          {prompt}
        </PluginUserMessageSite>
      );
    if (pluginOriginName === undefined) {
      return site;
    }
    return (
      <Box flexDirection="column" marginTop={addMargin && !followsSpeakerLabel && !inbound ? 1 : 0}>
        <Text dimColor>
          <Text aria-hidden>{figures.pointerSmall} </Text>
          Prompt from the {formatPluginPromptOriginName(pluginOriginName)} plugin
        </Text>
        {site}
      </Box>
    );
  };

  if (followsInboundLabel) {
    return renderUserPrompt(true);
  }

  if (extractTag(param.text, TICK_TAG)) {
    return null;
  }

  // Hide synthetic caveat messages (should be filtered by isMeta, this is defensive)
  if (param.text.includes(`<${LOCAL_COMMAND_CAVEAT_TAG}>`)) {
    return null;
  }

  // Show bash output
  if (param.text.startsWith('<bash-stdout') || param.text.startsWith('<bash-stderr')) {
    return <UserBashOutputMessage content={param.text} verbose={verbose} />;
  }

  // Show command output
  if (param.text.startsWith('<local-command-stdout') || param.text.startsWith('<local-command-stderr')) {
    return (
      <UserLocalCommandOutputMessage
        content={param.text}
        addMargin={addMargin}
        capProseWidth={commandRun?.command === 'recap'}
        systemLine={systemLine}
        commandRun={commandRun}
        messageId={resolvedMessageId}
      />
    );
  }

  // Handle interruption messages specially
  if (param.text === INTERRUPT_MESSAGE || param.text === INTERRUPT_MESSAGE_FOR_TOOL_USE) {
    return (
      <MessageResponse height={1}>
        <InterruptedByUser />
      </MessageResponse>
    );
  }

  // GitHub webhook events (check_run, review comments, pushes) delivered via
  // bound-session routing after /subscribe-pr. The tag constant is stripped
  // from external builds — inline the literal so the import doesn't fail.
  // The require() below DCEs when both flags are off. startsWith (not
  // includes) and before the includes-checks below: defense-in-depth if
  // the sanitizer were ever weakened.
  if (feature('KAIROS_GITHUB_WEBHOOKS')) {
    if (param.text.startsWith('<github-webhook-activity>')) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { UserGitHubWebhookMessage } =
        require('./UserGitHubWebhookMessage.js') as typeof import('./UserGitHubWebhookMessage.js');
      /* eslint-enable @typescript-eslint/no-require-imports */
      return <UserGitHubWebhookMessage addMargin={addMargin} param={param} />;
    }
  }

  // Bash inputs!
  if (param.text.includes('<bash-input>')) {
    return <UserBashInputMessage addMargin={addMargin} param={param} />;
  }

  // Slash commands/
  if (param.text.includes(`<${COMMAND_MESSAGE_TAG}>`)) {
    // Resume / merge can keep command-message and local-command-stdout in one
    // text block. Command bubble must not swallow the ANSI stdout grid; omit
    // commandRun/messageId so merged blocks never double-mount CommandOutputSite.
    const hasLocalOutput = param.text.includes('<local-command-stdout') || param.text.includes('<local-command-stderr');
    if (hasLocalOutput) {
      return (
        <>
          <UserCommandMessage addMargin={addMargin} param={param} />
          <UserLocalCommandOutputMessage
            content={param.text}
            capProseWidth={commandRun?.command === 'recap'}
            systemLine={systemLine}
          />
        </>
      );
    }
    return <UserCommandMessage addMargin={addMargin} param={param} />;
  }

  if (param.text.includes('<user-memory-input>')) {
    return <UserMemoryInputMessage addMargin={addMargin} text={param.text} />;
  }

  // Task notifications (agent completions, bash completions, etc.)
  if (param.text.includes(`<${TASK_NOTIFICATION_TAG}`)) {
    // densable Xi (@207653560): artifact-room-view task notifications never render a transcript row.
    if (param.text.startsWith(ARTIFACT_ROOM_VIEW_NOTIFICATION_PREFIX)) {
      return null;
    }
    // densable BX `gVn` → `el` before As. Detached tool_call results are not As.
    if (isDetachedToolCallNotification(param.text)) {
      return <DetachedToolCallResultMessage addMargin={addMargin} text={param.text} verbose={verbose} />;
    }
    return (
      <UserAgentNotificationMessage
        addMargin={addMargin}
        param={param}
        messageId={resolvedMessageId}
        origin={origin}
        verbose={verbose || isTranscriptMode}
        isExpanded={isTranscriptMode || verbose}
        taskDelivery={taskDelivery}
      />
    );
  }

  // MCP resource and polling update notifications
  if (param.text.includes('<mcp-resource-update') || param.text.includes('<mcp-polling-update')) {
    return <UserResourceUpdateMessage addMargin={addMargin} param={param} />;
  }

  // Fork child's first message: collapse the rules/format boilerplate, show
  // only the user prompt. Independent of FORK_SUBAGENT flag — the fork agent
  // transcript always needs to render the prompt as a normal user bubble.
  if (param.text.includes(`<${FORK_BOILERPLATE_TAG}>`)) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { UserForkBoilerplateMessage } =
      require('./UserForkBoilerplateMessage.js') as typeof import('./UserForkBoilerplateMessage.js');
    /* eslint-enable @typescript-eslint/no-require-imports */
    return (
      <UserForkBoilerplateMessage
        addMargin={addMargin}
        param={param}
        isTranscriptMode={isTranscriptMode}
        timestamp={timestamp}
      />
    );
  }

  // User prompts>
  return renderUserPrompt(followsInboundLabel);
}
