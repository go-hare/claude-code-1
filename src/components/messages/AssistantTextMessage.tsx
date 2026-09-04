import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React, { useContext } from 'react';
import { ERROR_MESSAGE_USER_ABORT } from 'src/services/compact/compact.js';
import { shouldShowAutoCompactOffHint } from 'src/services/compact/autoCompact.js';
import { isRateLimitErrorMessage } from 'src/services/rateLimitMessages.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, NoSelect, Text, useTerminalSize } from '@anthropic/ink';
import {
  API_ERROR_MESSAGE_PREFIX,
  API_TIMEOUT_ERROR_MESSAGE,
  CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE,
  CUSTOM_OFF_SWITCH_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL,
  ORG_DISABLED_ERROR_MESSAGE_ENV_KEY,
  ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  isInvalidExternalCredentialSuffix,
  shouldRenderClientGeneratedErrorLine,
  TOKEN_REVOKED_ERROR_MESSAGE,
} from '../../services/api/errors.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isEmptyMessageText, NO_RESPONSE_REQUESTED } from '../../utils/messages.js';
import { getUpgradeMessage } from '../../utils/model/contextWindowUpgradeCheck.js';
import { getDefaultSonnetModel, renderModelName } from '../../utils/model/model.js';
import { isMacOsKeychainLocked } from '../../utils/secureStorage/macOsKeychainStorage.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { InterruptedByUser } from '../InterruptedByUser.js';
import { Markdown } from '../Markdown.js';
import { MessageResponse, useIsMessageResponse } from '../MessageResponse.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import { RateLimitMessage } from './RateLimitMessage.js';

const MAX_API_ERROR_CHARS = 1000;

type Props = {
  param: TextBlockParam;
  addMargin: boolean;
  shouldShowDot: boolean;
  verbose: boolean;
  width?: number | string;
  onOpenRateLimitOptions?: () => void;
  /** densable 2.1.243 #23 `Rle` — client-generated errors render as error lines. */
  isApiError?: boolean;
};

/**
 * densable 2.1.243 `Kx` display text: bare "API Error" gets the wait hint.
 */
export function formatClientApiErrorLine(text: string): string {
  return text === API_ERROR_MESSAGE_PREFIX ? `${API_ERROR_MESSAGE_PREFIX}: Please wait a moment and try again.` : text;
}

function ClientGeneratedErrorLine({
  text,
  verbose,
  addMargin,
}: {
  text: string;
  verbose: boolean;
  addMargin: boolean;
}): React.ReactNode {
  const nested = useIsMessageResponse();
  const { columns } = useTerminalSize();
  const display = formatClientApiErrorLine(text);
  const trimmed = display.trim();
  const truncated = !verbose && trimmed.length > MAX_API_ERROR_CHARS;
  const shown = truncated ? `${trimmed.slice(0, MAX_API_ERROR_CHARS)}…` : trimmed;

  if (nested) {
    return (
      <Box flexDirection="column">
        <Text color="warning">{shown}</Text>
        {truncated && <CtrlOToExpand />}
      </Box>
    );
  }

  // densable 2.1.243 `Kx`: non-nested text column is `columns - 10`.
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} width="100%">
      <Box minWidth={2}>
        <Text aria-label="error:" color="warning">
          {BLACK_CIRCLE}
        </Text>
      </Box>
      <Box flexDirection="column" width={columns - 10}>
        <Text color="warning">{shown}</Text>
        {truncated && <CtrlOToExpand />}
      </Box>
    </Box>
  );
}

function InvalidApiKeyMessage(): React.ReactNode {
  const isKeychainLocked = isMacOsKeychainLocked();

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">{INVALID_API_KEY_ERROR_MESSAGE}</Text>
        {isKeychainLocked && <Text dimColor>· Run in another terminal: security unlock-keychain</Text>}
      </Box>
    </MessageResponse>
  );
}

/**
 * densable SEA `ZOl` text assembly for PROMPT_TOO_LONG (wire const JG).
 * Exported for focused unit tests — keep user-facing strings 1:1.
 */
export function buildPromptTooLongContextLimitText(options: {
  disableCompact: boolean;
  autoCompactOffHint: boolean;
  upgradeHint: string | null;
}): string {
  const continueHint = options.disableCompact ? '/clear to continue' : '/compact or /clear to continue';
  const autoCompactOffSuffix = options.autoCompactOffHint ? ' · auto-compact is off · /config to turn it on' : '';
  const upgradeSuffix = options.upgradeHint ? ` · ${options.upgradeHint}` : '';
  return `Context limit reached · ${continueHint}${autoCompactOffSuffix}${upgradeSuffix}`;
}

/**
 * densable SEA `ZOl` — render PROMPT_TOO_LONG via assembled hint, not raw JG.
 * remoteAutocompactState (UrD) is ABSENT locally → treated as false for this item.
 */
function PromptTooLongMessage(): React.ReactNode {
  const upgradeHint = getUpgradeMessage('warning');
  const isNestedMessageResponse = useIsMessageResponse();
  const remoteAutocompactStateDefined = false;
  const autoCompactOffHint =
    !remoteAutocompactStateDefined && !isNestedMessageResponse && shouldShowAutoCompactOffHint();
  const disableCompact = isEnvTruthy(process.env.DISABLE_COMPACT);
  const height = autoCompactOffHint || upgradeHint ? undefined : 1;

  return (
    <MessageResponse height={height}>
      <Text color="error">
        {buildPromptTooLongContextLimitText({
          disableCompact,
          autoCompactOffHint,
          upgradeHint,
        })}
      </Text>
    </MessageResponse>
  );
}

export function AssistantTextMessage({
  param: { text },
  addMargin,
  shouldShowDot,
  verbose,
  onOpenRateLimitOptions,
  isApiError = false,
}: Props): React.ReactNode {
  const isSelected = useContext(MessageActionsSelectedContext);
  if (isEmptyMessageText(text)) {
    return null;
  }

  // Handle all rate limit error messages from getRateLimitErrorMessage
  // Use the exported function to avoid fragile string coupling
  if (isRateLimitErrorMessage(text)) {
    return <RateLimitMessage text={text} onOpenRateLimitOptions={onOpenRateLimitOptions} />;
  }

  switch (text) {
    // Local JSX commands don't need a response, but we still want Claude to see them
    // Tool results render their own interrupt messages
    case NO_RESPONSE_REQUESTED:
      return null;

    case PROMPT_TOO_LONG_ERROR_MESSAGE:
      return <PromptTooLongMessage />;

    case CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE:
      return (
        <MessageResponse height={1}>
          <Text color="error">
            Credit balance too low &middot; Add funds: https://platform.claude.com/settings/billing
          </Text>
        </MessageResponse>
      );

    case INVALID_API_KEY_ERROR_MESSAGE:
      return <InvalidApiKeyMessage />;

    case INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL:
      return (
        <MessageResponse height={1}>
          <Text color="error">{INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL}</Text>
        </MessageResponse>
      );

    case ORG_DISABLED_ERROR_MESSAGE_ENV_KEY:
    case ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH:
      return (
        <MessageResponse>
          <Text color="error">{text}</Text>
        </MessageResponse>
      );

    case TOKEN_REVOKED_ERROR_MESSAGE:
      return (
        <MessageResponse height={1}>
          <Text color="error">{TOKEN_REVOKED_ERROR_MESSAGE}</Text>
        </MessageResponse>
      );

    case API_TIMEOUT_ERROR_MESSAGE:
      return (
        <MessageResponse height={1}>
          <Text color="error">
            {API_TIMEOUT_ERROR_MESSAGE}
            {process.env.API_TIMEOUT_MS && <> (API_TIMEOUT_MS={process.env.API_TIMEOUT_MS}ms, try increasing it)</>}
          </Text>
        </MessageResponse>
      );

    case CUSTOM_OFF_SWITCH_MESSAGE:
      return (
        <MessageResponse>
          <Box flexDirection="column" gap={1}>
            <Text color="error">We are experiencing high demand for Opus 4.</Text>
            <Text>
              To continue immediately, use /model to switch to {renderModelName(getDefaultSonnetModel())} and continue
              coding.
            </Text>
          </Box>
        </MessageResponse>
      );

    // TODO: Move this to a user turn
    case ERROR_MESSAGE_USER_ABORT:
      return (
        <MessageResponse height={1}>
          <InterruptedByUser />
        </MessageResponse>
      );

    default:
      // densable 2.1.243 Gx `Ox` = `J$a` — red error text, not Markdown / Kx.
      if (isInvalidExternalCredentialSuffix(text)) {
        return (
          <MessageResponse>
            <Box flexDirection="column">
              <Text color="error">{text}</Text>
            </Box>
          </MessageResponse>
        );
      }
      // densable 2.1.243 Gx: `Rle || Lx(text) || wx(text)` → Kx.
      // Import map: Lx=NR (`startsWithApiErrorPrefix`), wx=`he`.
      if (shouldRenderClientGeneratedErrorLine(isApiError, text)) {
        return <ClientGeneratedErrorLine text={text} verbose={verbose} addMargin={addMargin} />;
      }
      return (
        <Box
          alignItems="flex-start"
          flexDirection="row"
          justifyContent="space-between"
          marginTop={addMargin ? 1 : 0}
          width="100%"
          backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
        >
          <Box flexDirection="row">
            {shouldShowDot && (
              <NoSelect fromLeftEdge minWidth={2}>
                <Text color={isSelected ? 'suggestion' : 'text'}>{BLACK_CIRCLE}</Text>
              </NoSelect>
            )}
            <Box flexDirection="column">
              <Markdown>{text}</Markdown>
            </Box>
          </Box>
        </Box>
      );
  }
}
