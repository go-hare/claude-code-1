import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React, { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ERROR_MESSAGE_USER_ABORT } from 'src/services/compact/compact.js';
import { shouldShowAutoCompactOffHint } from 'src/services/compact/autoCompact.js';
import { isRateLimitErrorMessage } from 'src/services/rateLimitMessages.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Link, NoSelect, Text, useTerminalSize } from '@anthropic/ink';
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
import { logForDebugging } from '../../utils/debug.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { isEmptyMessageText, NO_RESPONSE_REQUESTED, stripPromptXMLTags } from '../../utils/messages.js';
import { getUpgradeMessage } from '../../utils/model/contextWindowUpgradeCheck.js';
import { getDefaultSonnetModel, getMainLoopModel, renderModelName } from '../../utils/model/model.js';
import {
  getLastUiRenderPlugin,
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from '../../utils/plugins/functionHooksModules.js';
import { getRenderVersion, subscribeRenderInvalidation } from '../../utils/render/invalidateAllRenders.js';
import { isMacOsKeychainLocked } from '../../utils/secureStorage/macOsKeychainStorage.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { InterruptedByUser } from '../InterruptedByUser.js';
import { Markdown } from '../Markdown.js';
import { MessageResponse, useIsMessageResponse } from '../MessageResponse.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import { extractDrawnPlugin, PluginRenderedTree } from '../PluginRasterPanes.js';
import { RateLimitMessage } from './RateLimitMessage.js';

const MAX_API_ERROR_CHARS = 1000;
const OVERLOAD_ERROR_MESSAGE = 'Overloaded';
const FABLE_OFF_SWITCH_MESSAGE = 'Fable is experiencing high load, please use /model to switch to Sonnet';
let assistantMessageRenderSeq = 0;

function getUiRenderVersion(): number {
  return getRenderVersion('ui.render');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findEnginePropsInTree(node: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findEnginePropsInTree(child);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (!isPlainRecord(node)) return undefined;
  if (node.type === 'engine') {
    return isPlainRecord(node.props) ? node.props : undefined;
  }
  if (node.children !== undefined) {
    const hit = findEnginePropsInTree(node.children);
    if (hit !== undefined) return hit;
  }
  if (isPlainRecord(node.props) && node.props.children !== undefined) {
    return findEnginePropsInTree(node.props.children);
  }
  return undefined;
}

function resolveAssistantHookAnswer(
  answer: unknown,
  fallbackText: string,
  fallbackDot: boolean,
): { text: string; shouldShowDot: boolean; pluginTree?: unknown } {
  if (isPlainRecord(answer)) {
    if (answer.type === 'engine') {
      const props = isPlainRecord(answer.props) ? answer.props : undefined;
      return {
        text: typeof props?.text === 'string' ? props.text : fallbackText,
        shouldShowDot: typeof props?.isFirstOfReply === 'boolean' ? props.isFirstOfReply : fallbackDot,
      };
    }
    if (typeof answer.type === 'string') {
      const engineProps = findEnginePropsInTree(answer);
      return {
        text: typeof engineProps?.text === 'string' ? engineProps.text : fallbackText,
        shouldShowDot: typeof engineProps?.isFirstOfReply === 'boolean' ? engineProps.isFirstOfReply : fallbackDot,
        pluginTree: answer,
      };
    }
    if (typeof answer.text === 'string') {
      return {
        text: answer.text,
        shouldShowDot: typeof answer.isFirstOfReply === 'boolean' ? answer.isFirstOfReply : fallbackDot,
      };
    }
  }
  if (typeof answer === 'string') {
    return { text: fallbackText, shouldShowDot: fallbackDot, pluginTree: answer };
  }
  return { text: fallbackText, shouldShowDot: fallbackDot };
}

type Props = {
  param: TextBlockParam;
  addMargin: boolean;
  shouldShowDot: boolean;
  verbose: boolean;
  width?: number | string;
  onOpenRateLimitOptions?: () => void;
  /** densable 2.1.243 #23 `Rle` — client-generated errors render as error lines. */
  isApiError?: boolean;
  /** densable 2.1.289 `tu` `R` — e.g. `'verification_required'` for clickable link. */
  apiErrorKind?: string;
  /** densable 2.1.289 `or` `xI("AssistantMessage")` requestId. */
  messageId?: string;
};

/**
 * densable 2.1.243 `Kx` display text: bare "API Error" gets the wait hint.
 */
export function formatClientApiErrorLine(text: string): string {
  return text === API_ERROR_MESSAGE_PREFIX ? `${API_ERROR_MESSAGE_PREFIX}: Please wait a moment and try again.` : text;
}

const ERROR_URL_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable Awt URL matcher excludes control chars
  /https?:\/\/[^\s"'<>\\…\x00-\x1f]+/g;

const CLOSING_PAIR: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
};

function trimUrlTrailingPunctuation(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url.at(-1)!;
    if ('.,;:!?'.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const open = CLOSING_PAIR[last];
    if (!open) break;
    let opens = 0;
    let closes = 0;
    for (const ch of url) {
      if (ch === open) opens++;
      else if (ch === last) closes++;
    }
    if (closes > opens) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  return url;
}

/** densable 2.1.289 `m0e` — allowlisted verification hosts. */
function getVerificationLinkHref(raw: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.port !== '') {
    return undefined;
  }
  const host = parsed.hostname;
  return host === 'portal.anthropic.com' || host === 'claude.ai' || host === 'platform.claude.com'
    ? parsed.href
    : undefined;
}

function LinkifiedWarningText({
  text,
  linkHref,
}: {
  text: string;
  linkHref?: (url: string) => string | undefined;
}): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(ERROR_URL_RE)) {
    const idx = match.index ?? 0;
    const cleaned = trimUrlTrailingPunctuation(match[0]);
    const href = linkHref === undefined ? cleaned : linkHref(cleaned);
    if (href === undefined) continue;
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx));
    }
    parts.push(
      <Link key={idx} url={href}>
        {href}
      </Link>,
    );
    cursor = idx + cleaned.length;
  }
  parts.push(text.slice(cursor));
  return <Text color="warning">{parts}</Text>;
}

function ClientGeneratedErrorLine({
  text,
  verbose,
  addMargin,
  linkHref,
}: {
  text: string;
  verbose: boolean;
  addMargin: boolean;
  linkHref?: (url: string) => string | undefined;
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
        <LinkifiedWarningText text={shown} linkHref={linkHref} />
        {truncated && <CtrlOToExpand />}
      </Box>
    );
  }

  // densable 2.1.243 `Kx` / 2.1.289 `ru`: non-nested text column is `columns - 10`.
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} width="100%">
      <Box minWidth={2}>
        <Text aria-label="error:" color="warning">
          {BLACK_CIRCLE}
        </Text>
      </Box>
      <Box flexDirection="column" width={columns - 10}>
        <LinkifiedWarningText text={shown} linkHref={linkHref} />
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

export function AssistantTextMessage(props: Props): React.ReactNode {
  const renderVer = useSyncExternalStore(subscribeRenderInvalidation, getUiRenderVersion, getUiRenderVersion);
  const { text } = props.param;
  const strippedText = stripPromptXMLTags(text);
  const hasHook = hasMatchingFunctionHook('ui.render', {
    component: 'AssistantMessage',
    surface: 'terminal',
    props: { text: strippedText, isFirstOfReply: props.shouldShowDot },
  });
  if (!hasHook) {
    return <AssistantTextMessageBody {...props} />;
  }
  return <AssistantTextMessageWithRenderHook {...props} renderVersion={renderVer} />;
}

type SettledAssistantRender = {
  sourceText: string;
  text: string;
  shouldShowDot: boolean;
  pluginTree?: unknown;
  pluginName?: string;
};

function AssistantTextMessageWithRenderHook(props: Props & { renderVersion: number }): React.ReactNode {
  const { columns, rows } = useTerminalSize();
  const viewportColumns = typeof props.width === 'number' ? props.width : columns;
  const isFullscreen = isFullscreenEnvEnabled();
  const fallbackIdRef = useRef<string | null>(null);
  if (fallbackIdRef.current === null) {
    fallbackIdRef.current = `assistant_${++assistantMessageRenderSeq}`;
  }
  const requestId = props.messageId ?? fallbackIdRef.current;
  const { text } = props.param;
  const strippedText = stripPromptXMLTags(text);
  const [settled, setSettled] = useState<SettledAssistantRender | undefined>(undefined);
  const evalKey = `${requestId}\0${viewportColumns}\0${rows}\0${String(isFullscreen)}\0${props.shouldShowDot ? '1' : '0'}\0${props.renderVersion}\0${text}`;

  useEffect(() => {
    let cancelled = false;
    const eventPayload: Record<string, unknown> = {
      surface: 'terminal',
      component: 'AssistantMessage',
      requestId,
      viewport: { columns: viewportColumns, rows, isFullscreen },
      props: { text: strippedText, isFirstOfReply: props.shouldShowDot },
    };
    void runFunctionHookChain('ui.render', eventPayload, async ev => {
      const nextProps = isPlainRecord(ev) && isPlainRecord(ev.props) ? ev.props : eventPayload.props;
      return { type: 'engine', ref: 0, props: nextProps };
    }).then(
      answer => {
        if (cancelled) return;
        const resolved = resolveAssistantHookAnswer(answer, strippedText, props.shouldShowDot);
        const owner =
          extractDrawnPlugin(resolved.pluginTree, 'AssistantMessage', requestId) ??
          extractDrawnPlugin(answer, 'AssistantMessage', requestId) ??
          (getLastUiRenderPlugin() || undefined);
        setSettled({
          sourceText: text,
          text: resolved.text === strippedText ? text : resolved.text,
          shouldShowDot: resolved.shouldShowDot,
          pluginTree: resolved.pluginTree,
          pluginName: owner,
        });
      },
      err => {
        logForDebugging(
          `ui.render (AssistantMessage ${requestId}): site failed: ${err instanceof Error ? err.message : String(err)}`,
          { level: 'error' },
        );
        if (!cancelled) {
          setSettled({
            sourceText: text,
            text,
            shouldShowDot: props.shouldShowDot,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [evalKey, requestId, viewportColumns, rows, isFullscreen, text, strippedText, props.shouldShowDot]);

  const current = settled?.sourceText === text ? settled : undefined;
  const effectiveText = current ? current.text : text;
  const effectiveDot = current ? current.shouldShowDot : props.shouldShowDot;
  const engineNode = (
    <AssistantTextMessageBody
      {...props}
      param={effectiveText === text ? props.param : { ...props.param, text: effectiveText }}
      shouldShowDot={effectiveDot}
    />
  );
  if (current?.pluginTree !== undefined) {
    return (
      <PluginRenderedTree
        node={current.pluginTree}
        plugin={current.pluginName}
        requestId={requestId}
        component="AssistantMessage"
        engine={engineNode}
      />
    );
  }
  return engineNode;
}

function AssistantTextMessageBody({
  param: { text },
  addMargin,
  shouldShowDot,
  verbose,
  onOpenRateLimitOptions,
  isApiError = false,
  apiErrorKind,
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

    case OVERLOAD_ERROR_MESSAGE:
    case FABLE_OFF_SWITCH_MESSAGE:
      return (
        <MessageResponse>
          <Box flexDirection="column" gap={1}>
            <Text color="error">We are experiencing high demand for {renderModelName(getMainLoopModel())}.</Text>
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
      // densable 2.1.289 `tu`: `Prompt is too long · ...` prefix
      if (text.startsWith(`${PROMPT_TOO_LONG_ERROR_MESSAGE} · `)) {
        const upgradeHint = getUpgradeMessage('warning');
        return (
          <MessageResponse>
            <Text color="error">
              {text}
              {' · /clear to start fresh'}
              {upgradeHint ? ` · ${upgradeHint}` : ''}
            </Text>
          </MessageResponse>
        );
      }
      // densable 2.1.243 Gx `Ox` = `J$a` — red error text, not Markdown / Kx.
      if (isInvalidExternalCredentialSuffix(text)) {
        return (
          <MessageResponse>
            <Text color="error">{text}</Text>
          </MessageResponse>
        );
      }
      // densable 2.1.243 Gx / 2.1.289 tu: `Rle || Lx(text) || wx(text)` → ru.
      if (shouldRenderClientGeneratedErrorLine(isApiError, text)) {
        const linkHref = apiErrorKind === 'verification_required' ? getVerificationLinkHref : undefined;
        return <ClientGeneratedErrorLine text={text} verbose={verbose} addMargin={addMargin} linkHref={linkHref} />;
      }
      // gold @202887955: one row, width 100%, children [dot, column].
      // Streaming (gold yi @203236672) is a nested inner row — do not flatten
      // this completed path to match it. Column has NO flexGrow (202890377 is
      // thinking). No inner row here — yoga min-content would wrap at ~word width.
      return (
        <Box
          alignItems="flex-start"
          flexDirection="row"
          marginTop={addMargin ? 1 : 0}
          width="100%"
          backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
        >
          {shouldShowDot && (
            <NoSelect fromLeftEdge minWidth={2}>
              <Text aria-label="claude:" color={isSelected ? 'suggestion' : 'text'}>
                {BLACK_CIRCLE}
              </Text>
            </NoSelect>
          )}
          <Box flexDirection="column">
            <Markdown capProseWidth>{text}</Markdown>
          </Box>
        </Box>
      );
  }
}
