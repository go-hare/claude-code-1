import figures from 'figures';
import React, { useEffect, useRef, useState } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import type { CommandResultDisplay } from '../../commands.js';
import { getOauthConfig } from '../../constants/oauth.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw j/k/arrow menu navigation
import { Box, Byline, color, Dialog, KeyboardShortcutHint, Link, Text, useInput, useTheme } from '@anthropic/ink';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import type { ClipboardPath } from '@anthropic/ink';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import {
  AuthenticationCancelledError,
  dialedWithoutOAuth,
  hasStaticAuthHeader,
  performMCPOAuthFlow,
  revokeReplacedMcpTokens,
  revokeServerTokens,
  snapshotMcpOAuthTokens,
} from '../../services/mcp/auth.js';
import { clearServerCache } from '../../services/mcp/client.js';
import { useMcpReconnect, useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import {
  describeMcpConfigFilePath,
  excludeCommandsByServer,
  excludeResourcesByServer,
  excludeToolsByServer,
  filterMcpPromptsByServer,
} from '../../services/mcp/utils.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getOauthAccountInfo } from '../../utils/auth.js';
import { openBrowser } from '../../utils/browser.js';
import { BG_NO_TERMINAL_MCP_AUTH_MSG, isBgSessionWithoutTerminal } from '../../utils/concurrentSessions.js';
import { errorMessage } from '../../utils/errors.js';
import { logMCPDebug } from '../../utils/log.js';
import { capitalize } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Select } from '../CustomSelect/index.js';
import { Spinner } from '../Spinner.js';
import TextInput from '../TextInput.js';
import { CapabilitiesSection } from './CapabilitiesSection.js';
import { MCP_COPIED_NATIVE, mcpCopiedViaDetail, mcpCopyShortcutKind, useMcpCopiedVia } from './mcpCopiedVia.js';
import type { ClaudeAIServerInfo, HTTPServerInfo, SSEServerInfo } from './types.js';
import { handleReconnectError, handleReconnectResult } from './utils/reconnectHelpers.js';

function McpUrlCopyInline({ via }: { via: ClipboardPath | null }): React.ReactNode {
  const kind = mcpCopyShortcutKind(via);
  if (kind === 'native') {
    return <Text color="success">{MCP_COPIED_NATIVE}</Text>;
  }
  if (kind === 'hint') {
    return (
      <Text dimColor>
        <KeyboardShortcutHint shortcut="c" action="copy" parens />
      </Text>
    );
  }
  return null;
}

function McpUrlCopyDetail({ via }: { via: ClipboardPath | null }): React.ReactNode {
  const detail = mcpCopiedViaDetail(via);
  if (detail === null) return null;
  return <Text dimColor>{detail}</Text>;
}

type Props = {
  server: SSEServerInfo | HTTPServerInfo | ClaudeAIServerInfo;
  serverToolsCount: number;
  onViewTools: () => void;
  onCancel: () => void;
  onComplete?: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  borderless?: boolean;
};

export function MCPRemoteServerMenu({
  server,
  serverToolsCount,
  onViewTools,
  onCancel,
  onComplete,
  borderless = false,
}: Props): React.ReactNode {
  const [theme] = useTheme();
  const { columns: terminalColumns } = useTerminalSize();
  const [isAuthenticating, setIsAuthenticating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mcp = useAppState(s => s.mcp);
  const setAppState = useSetAppState();
  const [authorizationUrl, setAuthorizationUrl] = React.useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [togglingAction, setTogglingAction] = useState<'enabling' | 'disabling' | null>(null);
  const isTogglingRef = useRef(false);
  const authAbortControllerRef = useRef<AbortController | null>(null);
  const [isClaudeAIAuthenticating, setIsClaudeAIAuthenticating] = useState(false);
  const [claudeAIAuthUrl, setClaudeAIAuthUrl] = useState<string | null>(null);
  const [isClaudeAIClearingAuth, setIsClaudeAIClearingAuth] = useState(false);
  const [claudeAIClearAuthUrl, setClaudeAIClearAuthUrl] = useState<string | null>(null);
  const [claudeAIClearAuthBrowserOpened, setClaudeAIClearAuthBrowserOpened] = useState(false);
  // densable `gt=xe||we||(ot?Q4():null)` then `ZW(gt)`. Q4 body is not in this
  // item; pass the three menu URLs ZW already sees on `c`.
  const copyUrl = authorizationUrl || claudeAIAuthUrl || claudeAIClearAuthUrl;
  const { copiedVia, copy: copyViaClipboard } = useMcpCopiedVia(copyUrl);
  const unmountedRef = useRef(false);
  const [callbackUrlInput, setCallbackUrlInput] = useState('');
  const [callbackUrlCursorOffset, setCallbackUrlCursorOffset] = useState(0);
  const [manualCallbackSubmit, setManualCallbackSubmit] = useState<((url: string) => void) | null>(null);

  // If the component unmounts mid-auth (e.g. a parent component's Esc handler
  // navigates away before ours fires), abort the OAuth flow so the callback
  // server is closed. Without this, the server stays bound and the process
  // can outlive the terminal. Copy-via timers live in ZW / useMcpCopiedVia.
  useEffect(
    () => () => {
      unmountedRef.current = true;
      authAbortControllerRef.current?.abort();
    },
    [],
  );

  // Gold `Gn` / `xn` (#1264): a connected remote server is only effectively
  // authenticated if it has OAuth tokens or sends credentials (headers/helper/XAA).
  // Otherwise it is connected without credentials ("not signed in").
  const isConnectedWithTools = server.client.type === 'connected' && serverToolsCount > 0;
  const hasStaticAuth =
    (server.config.type === 'sse' || server.config.type === 'http') && hasStaticAuthHeader(server.config);
  const hasHeadersHelper = server.config.type !== 'claudeai-proxy' && !!server.config.headersHelper;
  const hasXaaOrCliAuth =
    (server.config.type === 'sse' || server.config.type === 'http') &&
    Boolean(server.config.oauth?.authServerMetadataUrl);
  const isEffectivelyAuthenticated =
    server.isAuthenticated ||
    (isConnectedWithTools &&
      server.config.type !== 'claudeai-proxy' &&
      (hasHeadersHelper || hasStaticAuth || hasXaaOrCliAuth));

  const reconnectMcpServer = useMcpReconnect();

  const handleClaudeAIAuthComplete = React.useCallback(async () => {
    setIsClaudeAIAuthenticating(false);
    setClaudeAIAuthUrl(null);
    setIsReconnecting(true);
    try {
      const result = await reconnectMcpServer(server.name);
      const success = result.client.type === 'connected';
      logEvent('tengu_claudeai_mcp_auth_completed', { success });
      if (success) {
        onComplete?.(`Authentication successful. Connected to ${server.name}.`);
      } else if (result.client.type === 'needs-auth') {
        onComplete?.(
          'Authentication successful, but server still requires authentication. You may need to manually restart Claude Code.',
        );
      } else {
        onComplete?.(
          'Authentication successful, but server reconnection failed. You may need to manually restart Claude Code for the changes to take effect.',
        );
      }
    } catch (err) {
      logEvent('tengu_claudeai_mcp_auth_completed', { success: false });
      onComplete?.(handleReconnectError(err, server.name));
    } finally {
      setIsReconnecting(false);
    }
  }, [reconnectMcpServer, server.name, onComplete]);

  const handleClaudeAIClearAuthComplete = React.useCallback(async () => {
    await clearServerCache(server.name, {
      ...server.config,
      scope: server.scope,
    });

    setAppState(prev => {
      const newClients = prev.mcp.clients.map(c =>
        c.name === server.name ? { ...c, type: 'needs-auth' as const } : c,
      );
      const newTools = excludeToolsByServer(prev.mcp.tools, server.name);
      const newCommands = excludeCommandsByServer(prev.mcp.commands, server.name);
      const newResources = excludeResourcesByServer(prev.mcp.resources, server.name);

      return {
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: newClients,
          tools: newTools,
          commands: newCommands,
          resources: newResources,
        },
      };
    });

    logEvent('tengu_claudeai_mcp_clear_auth_completed', {});
    onComplete?.(`Disconnected from ${server.name}.`);
    setIsClaudeAIClearingAuth(false);
    setClaudeAIClearAuthUrl(null);
    setClaudeAIClearAuthBrowserOpened(false);
  }, [server.name, server.config, server.scope, setAppState, onComplete]);

  // Escape to cancel authentication flow
  useKeybinding(
    'confirm:no',
    () => {
      authAbortControllerRef.current?.abort();
      authAbortControllerRef.current = null;
      setIsAuthenticating(false);
      setAuthorizationUrl(null);
    },
    {
      context: 'Confirmation',
      isActive: isAuthenticating,
    },
  );

  // Escape to cancel Claude AI authentication
  useKeybinding(
    'confirm:no',
    () => {
      setIsClaudeAIAuthenticating(false);
      setClaudeAIAuthUrl(null);
    },
    {
      context: 'Confirmation',
      isActive: isClaudeAIAuthenticating,
    },
  );

  // Escape to cancel Claude AI clear auth
  useKeybinding(
    'confirm:no',
    () => {
      setIsClaudeAIClearingAuth(false);
      setClaudeAIClearAuthUrl(null);
      setClaudeAIClearAuthBrowserOpened(false);
    },
    {
      context: 'Confirmation',
      isActive: isClaudeAIClearingAuth,
    },
  );

  // Return key handling for authentication flows and 'c' to copy URL
  useInput((input, key) => {
    if (key.return && isClaudeAIAuthenticating) {
      void handleClaudeAIAuthComplete();
    }
    if (key.return && isClaudeAIClearingAuth) {
      if (claudeAIClearAuthBrowserOpened) {
        void handleClaudeAIClearAuthComplete();
      } else {
        // First Enter: open the browser
        const connectorsUrl = `${getOauthConfig().CLAUDE_AI_ORIGIN}/settings/connectors`;
        setClaudeAIClearAuthUrl(connectorsUrl);
        setClaudeAIClearAuthBrowserOpened(true);
        void openBrowser(connectorsUrl);
      }
    }
    // Official 2.1.326 #89: When the manual callback paste TextInput is active,
    // let its onChange handler intercept single-char 'c' to copy without leaving
    // a stray 'c' in the paste field.
    const isManualCallbackInputActive = isAuthenticating && Boolean(authorizationUrl) && Boolean(manualCallbackSubmit);
    if (input === 'c' && !isManualCallbackInputActive) {
      if (copyUrl) {
        copyViaClipboard(copyUrl);
      }
    }
  });

  const capitalizedServerName = capitalize(String(server.name));

  // Count MCP prompts for this server (skills are shown in /skills, not here)
  const serverCommandsCount = filterMcpPromptsByServer(mcp.commands, server.name).length;

  const toggleMcpServer = useMcpToggleEnabled();

  const handleClaudeAIAuth = React.useCallback(async () => {
    const claudeAiBaseUrl = getOauthConfig().CLAUDE_AI_ORIGIN;
    const accountInfo = getOauthAccountInfo();
    const orgUuid = accountInfo?.organizationUuid;

    let authUrl: string;
    if (orgUuid && server.config.type === 'claudeai-proxy' && server.config.id) {
      // Use the direct auth URL with org and server IDs
      // Replace 'mcprs' prefix with 'mcpsrv' if present
      const serverId = server.config.id.startsWith('mcprs') ? 'mcpsrv' + server.config.id.slice(5) : server.config.id;
      const productSurface = encodeURIComponent(process.env.CLAUDE_CODE_ENTRYPOINT || 'cli');
      authUrl = `${claudeAiBaseUrl}/api/organizations/${orgUuid}/mcp/start-auth/${serverId}?product_surface=${productSurface}`;
    } else {
      // Fall back to settings/connectors if we don't have the required IDs
      authUrl = `${claudeAiBaseUrl}/settings/connectors`;
    }

    setClaudeAIAuthUrl(authUrl);
    setIsClaudeAIAuthenticating(true);
    logEvent('tengu_claudeai_mcp_auth_started', {});
    await openBrowser(authUrl);
  }, [server.config]);

  const handleClaudeAIClearAuth = React.useCallback(() => {
    setIsClaudeAIClearingAuth(true);
    logEvent('tengu_claudeai_mcp_clear_auth_started', {});
  }, []);

  const handleToggleEnabled = React.useCallback(async () => {
    // Official 2.1.326 #86: Ignore duplicate Enter while Enable/Disable is in flight.
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;
    const wasEnabled = server.client.type !== 'disabled';
    setTogglingAction(wasEnabled ? 'disabling' : 'enabling');

    try {
      await toggleMcpServer(server.name);

      if (server.config.type === 'claudeai-proxy') {
        logEvent('tengu_claudeai_mcp_toggle', {
          new_state: (wasEnabled
            ? 'disabled'
            : 'enabled') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      }

      // Return to the server list so user can continue managing other servers
      onCancel();
    } catch (err) {
      const action = wasEnabled ? 'disable' : 'enable';
      onComplete?.(`Failed to ${action} MCP server '${server.name}': ${errorMessage(err)}`);
    } finally {
      isTogglingRef.current = false;
      setTogglingAction(null);
    }
  }, [server.client.type, server.config.type, server.name, toggleMcpServer, onCancel, onComplete]);

  const handleAuthenticate = React.useCallback(async () => {
    if (server.config.type === 'claudeai-proxy') return;

    // densable KGo / Pte: OAuth needs an attached terminal on bg sessions.
    if (isBgSessionWithoutTerminal()) {
      setError(BG_NO_TERMINAL_MCP_AUTH_MSG);
      onComplete?.(BG_NO_TERMINAL_MCP_AUTH_MSG);
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    const controller = new AbortController();
    authAbortControllerRef.current = controller;

    try {
      // densable 2.1.216 #19: do NOT revoke working credentials before OAuth.
      // Snapshot pre-auth tokens (QLu); OAuth overwrites local storage; only
      // after reconnect is "connected" revoke the *replaced* set (eMu).
      if (server.config) {
        const previousTokens = server.isAuthenticated
          ? await snapshotMcpOAuthTokens(server.name, server.config)
          : undefined;

        await performMCPOAuthFlow(server.name, server.config, setAuthorizationUrl, controller.signal, {
          onWaitingForCallback: submit => {
            setManualCallbackSubmit(() => submit);
          },
        });

        logEvent('tengu_mcp_auth_config_authenticate', {
          wasAuthenticated: server.isAuthenticated,
        });

        const result = await reconnectMcpServer(server.name);

        if (result.client.type === 'connected') {
          if (previousTokens) {
            await revokeReplacedMcpTokens(server.name, server.config, previousTokens);
          }
          const message = isEffectivelyAuthenticated
            ? `Authentication successful. Reconnected to ${server.name}.`
            : `Authentication successful. Connected to ${server.name}.`;
          onComplete?.(message);
        } else if (result.client.type === 'needs-auth') {
          // densable: Got new credentials, but server rejected them on reconnect.
          onComplete?.(
            `Got new credentials, but ${server.name} rejected them on reconnect. Try re-authenticating, or restart Claude Code if it persists.`,
          );
        } else {
          // result.client.type === 'failed'
          logMCPDebug(server.name, `Reconnection failed after authentication`);
          const failDetail =
            result.client.type === 'failed' && 'error' in result.client && result.client.error
              ? String(result.client.error)
              : '';
          onComplete?.(
            failDetail
              ? `Got new credentials, but reconnecting to ${server.name} failed: ${failDetail}`
              : `Got new credentials, but reconnecting to ${server.name} failed. Restart Claude Code to retry.`,
          );
        }
      }
    } catch (err) {
      // Don't show error if it was a cancellation
      if (err instanceof Error && !(err instanceof AuthenticationCancelledError)) {
        setError(err.message);
      }
    } finally {
      setIsAuthenticating(false);
      authAbortControllerRef.current = null;
      setManualCallbackSubmit(null);
      setCallbackUrlInput('');
    }
  }, [server.isAuthenticated, server.config, server.name, onComplete, reconnectMcpServer, isEffectivelyAuthenticated]);

  const handleClearAuth = async () => {
    if (server.config.type === 'claudeai-proxy') return;

    if (server.config) {
      // First revoke the authentication tokens and clear all auth state
      const revokeResult = await revokeServerTokens(server.name, server.config);
      if (!revokeResult.cleared) {
        onComplete?.(
          `Authentication for ${server.name} was not cleared: sign-in data is still stored, or the credential store could not be read. Try Clear authentication again.`,
        );
        return;
      }
      logEvent('tengu_mcp_auth_config_clear', {});

      // Disconnect the client and clear the cache
      await clearServerCache(server.name, {
        ...server.config,
        scope: server.scope,
      });

      // Update app state to remove the disconnected server's tools, commands, and resources
      setAppState(prev => {
        const newClients = prev.mcp.clients.map(c =>
          // 'failed' is a misnomer here, but we don't really differentiate between "not connected" and "failed" at the moment
          c.name === server.name ? { ...c, type: 'failed' as const } : c,
        );
        const newTools = excludeToolsByServer(prev.mcp.tools, server.name);
        const newCommands = excludeCommandsByServer(prev.mcp.commands, server.name);
        const newResources = excludeResourcesByServer(prev.mcp.resources, server.name);

        return {
          ...prev,
          mcp: {
            ...prev.mcp,
            clients: newClients,
            tools: newTools,
            commands: newCommands,
            resources: newResources,
          },
        };
      });

      // Gold #1263: if the server was connected/needs-auth, dial without OAuth
      // so servers that work without sign-in reconnect as connected instead of
      // remaining marked failed.
      if (server.client.type !== 'failed' && server.client.type !== 'disabled' && 'url' in server.config) {
        dialedWithoutOAuth.set(server.name, server.config.url);
        try {
          const result = await reconnectMcpServer(server.name);
          if (result.client.type === 'connected') {
            onComplete?.(`Authentication cleared for ${server.name}. Connected without sign-in.`);
            return;
          }
        } catch {
          // Fall through to default clear message if reconnect fails
        }
      }

      onComplete?.(`Authentication cleared for ${server.name}.`);
    }
  };

  if (isAuthenticating) {
    // XAA: silent exchange (cached id_token → no browser), so don't claim
    // one will open. If IdP login IS needed, authorizationUrl populates and
    // the URL fallback block below still renders.
    const authCopy =
      server.config.type !== 'claudeai-proxy' && server.config.oauth?.xaa
        ? ' Authenticating via your identity provider'
        : ' A browser window will open for authentication';
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text color="claude">Authenticating with {server.name}…</Text>
        <Box>
          <Spinner />
          <Text>{authCopy}</Text>
        </Box>
        {authorizationUrl && (
          <Box flexDirection="column">
            <Box>
              <Text dimColor>If your browser doesn&apos;t open automatically, copy this URL manually </Text>
              <McpUrlCopyInline via={copiedVia} />
            </Box>
            <McpUrlCopyDetail via={copiedVia} />
            <Link url={authorizationUrl} />
          </Box>
        )}
        {isAuthenticating && authorizationUrl && manualCallbackSubmit && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>
              If the redirect page shows a connection error, paste the URL from your browser&apos;s address bar:
            </Text>
            <Box>
              <Text dimColor>URL {'>'} </Text>
              <TextInput
                value={callbackUrlInput}
                onChange={(nextValue: string) => {
                  // Official 2.1.326 #89: Pressing 'c' when the paste field is
                  // empty copies the sign-in URL and clears the stray 'c'.
                  if (callbackUrlInput === '' && (nextValue === 'c' || nextValue === 'C') && copyUrl) {
                    copyViaClipboard(copyUrl);
                    setCallbackUrlInput('');
                    setCallbackUrlCursorOffset(0);
                    return;
                  }
                  setCallbackUrlInput(nextValue);
                }}
                onSubmit={(value: string) => {
                  manualCallbackSubmit(value.trim());
                  setCallbackUrlInput('');
                }}
                cursorOffset={callbackUrlCursorOffset}
                onChangeCursorOffset={setCallbackUrlCursorOffset}
                columns={terminalColumns - 8}
              />
            </Box>
          </Box>
        )}
        <Box marginLeft={3}>
          <Text dimColor>Return here after authenticating in your browser. Press Esc to go back.</Text>
        </Box>
      </Box>
    );
  }

  if (isClaudeAIAuthenticating) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text color="claude">Authenticating with {server.name}…</Text>
        <Box>
          <Spinner />
          <Text> A browser window will open for authentication</Text>
        </Box>
        {claudeAIAuthUrl && (
          <Box flexDirection="column">
            <Box>
              <Text dimColor>If your browser doesn&apos;t open automatically, copy this URL manually </Text>
              <McpUrlCopyInline via={copiedVia} />
            </Box>
            <McpUrlCopyDetail via={copiedVia} />
            <Link url={claudeAIAuthUrl} />
          </Box>
        )}
        <Box marginLeft={3} flexDirection="column">
          <Text color="permission">
            Press <Text bold>Enter</Text> after authenticating in your browser.
          </Text>
          <Text dimColor italic>
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
          </Text>
        </Box>
      </Box>
    );
  }

  if (isClaudeAIClearingAuth) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text color="claude">Clear authentication for {server.name}</Text>
        {claudeAIClearAuthBrowserOpened ? (
          <>
            <Text>Find the MCP server in the browser and click &quot;Disconnect&quot;.</Text>
            {claudeAIClearAuthUrl && (
              <Box flexDirection="column">
                <Box>
                  <Text dimColor>If your browser didn&apos;t open automatically, copy this URL manually </Text>
                  <McpUrlCopyInline via={copiedVia} />
                </Box>
                <McpUrlCopyDetail via={copiedVia} />
                <Link url={claudeAIClearAuthUrl} />
              </Box>
            )}
            <Box marginLeft={3} flexDirection="column">
              <Text color="permission">
                Press <Text bold>Enter</Text> when done.
              </Text>
              <Text dimColor italic>
                <ConfigurableShortcutHint
                  action="confirm:no"
                  context="Confirmation"
                  fallback="Esc"
                  description="back"
                />
              </Text>
            </Box>
          </>
        ) : (
          <>
            <Text>
              This will open claude.ai in the browser. Find the MCP server in the list and click &quot;Disconnect&quot;.
            </Text>
            <Box marginLeft={3} flexDirection="column">
              <Text color="permission">
                Press <Text bold>Enter</Text> to open the browser.
              </Text>
              <Text dimColor italic>
                <ConfigurableShortcutHint
                  action="confirm:no"
                  context="Confirmation"
                  fallback="Esc"
                  description="back"
                />
              </Text>
            </Box>
          </>
        )}
      </Box>
    );
  }

  if (isReconnecting || togglingAction !== null) {
    const heading = isReconnecting ? 'Connecting to ' : togglingAction === 'enabling' ? 'Enabling ' : 'Disabling ';
    const detail = isReconnecting
      ? ' Establishing connection to MCP server'
      : togglingAction === 'enabling'
        ? ' Enabling MCP server'
        : ' Disabling MCP server';
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text color="text">
          {heading}
          <Text bold>{server.name}</Text>…
        </Text>
        <Box>
          <Spinner />
          <Text>{detail}</Text>
        </Box>
        <Text dimColor>This may take a few moments.</Text>
      </Box>
    );
  }

  const menuOptions = [];

  // If server is disabled, show Enable first as the primary action
  if (server.client.type === 'disabled') {
    menuOptions.push({
      label: 'Enable',
      value: 'toggle-enabled',
    });
  }

  if (server.client.type === 'connected' && serverToolsCount > 0) {
    menuOptions.push({
      label: 'View tools',
      value: 'tools',
    });
  }

  if (server.config.type === 'claudeai-proxy') {
    if (server.client.type === 'connected') {
      menuOptions.push({
        label: 'Clear authentication',
        value: 'claudeai-clear-auth',
      });
    } else if (server.client.type !== 'disabled') {
      menuOptions.push({
        label: 'Authenticate',
        value: 'claudeai-auth',
      });
    }
  } else {
    if (isEffectivelyAuthenticated) {
      menuOptions.push({
        label: 'Re-authenticate',
        value: 'reauth',
      });
      menuOptions.push({
        label: 'Clear authentication',
        value: 'clear-auth',
      });
    }

    if (!isEffectivelyAuthenticated) {
      menuOptions.push({
        label: 'Authenticate',
        value: 'auth',
      });
    }
  }

  if (server.client.type !== 'disabled') {
    // #2048: When a server needs-auth but still holds its sign-in credentials
    // (`isEffectivelyAuthenticated`), offer Reconnect (and focus it) instead of
    // opening the page with cursor on Disable.
    if (server.client.type !== 'needs-auth' || isEffectivelyAuthenticated) {
      menuOptions.push({
        label: 'Reconnect',
        value: 'reconnectMcpServer',
      });
    }
    menuOptions.push({
      label: 'Disable in this project',
      value: 'toggle-enabled',
    });
  }

  // Official 2.1.328 #494: Always end server action menus with Back.
  menuOptions.push({
    label: 'Back',
    value: 'back',
  });

  // #2048: Match official `un` default cursor — skip auth-maintenance entries
  // (`reauth`, `clear-auth`, `claudeai-clear-auth`) when selecting initial focus
  // so a server with stored sign-in opens on `Reconnect`.
  const authMaintenanceValues = ['reauth', 'clear-auth', 'claudeai-clear-auth'];
  const defaultFocusValue =
    menuOptions[0] && authMaintenanceValues.includes(menuOptions[0].value)
      ? menuOptions.find(opt => !authMaintenanceValues.includes(opt.value))?.value
      : undefined;

  return (
    <Dialog
      title={`${capitalizedServerName} MCP Server`}
      subtitle="MCP server"
      onCancel={onCancel}
      hideBorder={borderless}
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <Byline>
            <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
            <KeyboardShortcutHint shortcut="Enter" action="select" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
          </Byline>
        )
      }
    >
      <Box flexDirection="column" gap={0}>
        <Box>
          <Text bold>Status: </Text>
          {server.client.type === 'disabled' ? (
            <Text>{color('inactive', theme)(figures.radioOff)} disabled</Text>
          ) : server.client.type === 'connected' ? (
            <Text>{color('success', theme)(figures.tick)} connected</Text>
          ) : server.client.type === 'pending' ? (
            <>
              <Text dimColor>{figures.radioOff}</Text>
              <Text> connecting…</Text>
            </>
          ) : server.client.type === 'needs-auth' ? (
            <Text>{color('warning', theme)(figures.triangleUpOutline)} needs authentication</Text>
          ) : (
            <Text>{color('error', theme)(figures.cross)} failed</Text>
          )}
        </Box>

        {server.transport !== 'claudeai-proxy' && (
          <Box>
            <Text bold>Auth: </Text>
            {isEffectivelyAuthenticated ? (
              <Text>{color('success', theme)(figures.tick)} authenticated</Text>
            ) : isConnectedWithTools ? (
              <Text dimColor>not signed in</Text>
            ) : (
              <Text>{color('error', theme)(figures.cross)} not authenticated</Text>
            )}
          </Box>
        )}

        {server.transport === 'claudeai-proxy' && server.scope === 'claudeai' && server.config.enterpriseManaged && (
          <Box>
            <Text bold>Managed: </Text>
            <Text dimColor>by your organization</Text>
          </Box>
        )}

        <Box>
          <Text bold>URL: </Text>
          <Text dimColor>{server.config.url}</Text>
        </Box>

        <Box>
          <Text bold>Config location: </Text>
          <Text dimColor>{describeMcpConfigFilePath(server.scope)}</Text>
        </Box>

        {server.client.type === 'connected' && (
          <CapabilitiesSection
            serverToolsCount={serverToolsCount}
            serverPromptsCount={serverCommandsCount}
            serverResourcesCount={mcp.resources[server.name]?.length || 0}
          />
        )}

        {server.client.type === 'connected' && serverToolsCount > 0 && (
          <Box>
            <Text bold>Tools: </Text>
            <Text dimColor>{serverToolsCount} tools</Text>
          </Box>
        )}

        {/* densable: connected + discoveryBearerRejected → /login Issue (not needs-auth) */}
        {server.client.type === 'connected' && server.client.discoveryBearerRejected && (
          <Box>
            <Text bold>Issue: </Text>
            <Text color="error">claude.ai rejected the session token. Run /login, then reconnect.</Text>
          </Box>
        )}
        {server.client.type === 'connected' &&
          !server.client.discoveryBearerRejected &&
          server.client.toolsListError && (
            <Box>
              <Text bold>Issue: </Text>
              <Text color="error">{server.client.toolsListError}</Text>
            </Box>
          )}
        {/* #2151: Show omitted tools count and per-tool schema reasons in /mcp */}
        {server.client.type === 'connected' &&
          !server.client.toolsListError &&
          server.client.droppedTools &&
          server.client.droppedTools.length > 0 && (
            <Box flexDirection="column">
              <Text>
                <Text bold>Issue: </Text>
                <Text dimColor>
                  Claude wasn&apos;t given {server.client.droppedTools.length}{' '}
                  {server.client.droppedTools.length === 1 ? 'tool' : 'tools'} because the Anthropic API would reject{' '}
                  {server.client.droppedTools.length === 1 ? 'its input schema' : 'their input schemas'}. Once the
                  server is fixed, choose Reconnect.
                </Text>
              </Text>
              {server.client.droppedTools.slice(0, 3).map(dropped => (
                <Text key={dropped.toolName} dimColor wrap="truncate-middle">
                  {dropped.toolName || '(unnamed tool)'}: {dropped.reason}
                </Text>
              ))}
              {server.client.droppedTools.length > 3 && (
                <Text dimColor>
                  … and {server.client.droppedTools.length - 3} more{' '}
                  {server.client.droppedTools.length - 3 === 1 ? 'tool' : 'tools'}
                </Text>
              )}
            </Box>
          )}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="error">Error: {error}</Text>
        </Box>
      )}

      {menuOptions.length > 0 && (
        <Box marginTop={1}>
          <Select
            options={menuOptions}
            defaultFocusValue={defaultFocusValue}
            hideIndexes={!isScreenReaderModeEnabled()}
            disablePrintableKeybindings={!isScreenReaderModeEnabled()}
            onChange={async value => {
              switch (value) {
                case 'tools':
                  onViewTools();
                  break;
                case 'auth':
                case 'reauth':
                  await handleAuthenticate();
                  break;
                case 'clear-auth':
                  await handleClearAuth();
                  break;
                case 'claudeai-auth':
                  await handleClaudeAIAuth();
                  break;
                case 'claudeai-clear-auth':
                  handleClaudeAIClearAuth();
                  break;
                case 'reconnectMcpServer':
                  setIsReconnecting(true);
                  try {
                    const result = await reconnectMcpServer(server.name);
                    if (server.config.type === 'claudeai-proxy') {
                      logEvent('tengu_claudeai_mcp_reconnect', {
                        success: result.client.type === 'connected',
                      });
                    }
                    const { message } = handleReconnectResult(result, server.name, {
                      hasHeadersHelper: Boolean(
                        'headersHelper' in server.config && (server.config as { headersHelper?: string }).headersHelper,
                      ),
                    });
                    onComplete?.(message);
                  } catch (err) {
                    if (server.config.type === 'claudeai-proxy') {
                      logEvent('tengu_claudeai_mcp_reconnect', {
                        success: false,
                      });
                    }
                    onComplete?.(handleReconnectError(err, server.name));
                  } finally {
                    setIsReconnecting(false);
                  }
                  break;
                case 'toggle-enabled':
                  await handleToggleEnabled();
                  break;
                case 'back':
                  onCancel();
                  break;
              }
            }}
            onCancel={onCancel}
          />
        </Box>
      )}
    </Dialog>
  );
}
