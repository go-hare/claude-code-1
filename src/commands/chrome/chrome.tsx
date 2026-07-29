import React, { useCallback, useState } from 'react';
import { type OptionWithDescription, Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '@anthropic/ink';
import { Box, Text } from '@anthropic/ink';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { openBrowser } from '../../utils/browser.js';
import { setClaudeInChromeSessionPromptActive } from '../../bootstrap/state.js';
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME, openInChrome } from '../../utils/claudeInChrome/common.js';
import {
  openLocalExtensionInstallHelpers,
  resolveLocalChromeExtensionPackageDir,
} from '../../utils/claudeInChrome/localExtensionPackage.js';
import {
  ensureChromeNativeHostLocal,
  isChromeExtensionInstalled,
  setupClaudeInChrome,
} from '../../utils/claudeInChrome/setup.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { env } from '../../utils/env.js';
import { isRunningOnHomespace } from '../../utils/envUtils.js';
import { clearServerCache } from '../../services/mcp/client.js';
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js';
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js';

const CHROME_EXTENSION_URL = 'https://claude.ai/chrome';
const CHROME_PERMISSIONS_URL = 'https://clau.de/chrome/permissions';
/** densable Web Store handshake — keep for official Reconnect; local uses Connect local. */
const CHROME_RECONNECT_URL = 'https://clau.de/chrome/reconnect';

type MenuAction =
  | 'install-extension'
  | 'install-local'
  | 'reconnect'
  | 'connect-local'
  | 'manage-permissions'
  | 'toggle-session'
  | 'toggle-default';

type Props = {
  onDone: (result?: string) => void;
  isExtensionInstalled: boolean;
  configEnabled: boolean | undefined;
  isWSL: boolean;
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>;
  onChangeDynamicMcpConfig?: (config: Record<string, ScopedMcpServerConfig>) => void;
};

function ClaudeInChromeMenu({
  onDone,
  isExtensionInstalled: installed,
  configEnabled,
  isWSL,
  dynamicMcpConfig,
  onChangeDynamicMcpConfig,
}: Props): React.ReactNode {
  const mcpClients = useAppState(s => s.mcp.clients);
  const setAppState = useSetAppState();
  const [selectKey, setSelectKey] = useState(0);
  const [enabledByDefault, setEnabledByDefault] = useState(configEnabled ?? false);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [isExtensionInstalled, setIsExtensionInstalled] = useState(installed);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [localConnectHint, setLocalConnectHint] = useState<string | null>(null);
  const [localInstallHint, setLocalInstallHint] = useState<string | null>(null);
  const localPackageDir = resolveLocalChromeExtensionPackageDir();

  const isHomespace = process.env.USER_TYPE === 'ant' && isRunningOnHomespace();

  const chromeClient = mcpClients.find(c => c.name === CLAUDE_IN_CHROME_MCP_SERVER_NAME);
  const isConnected = chromeClient?.type === 'connected';
  const isPending = chromeClient?.type === 'pending';
  const isSessionWired = !!dynamicMcpConfig?.[CLAUDE_IN_CHROME_MCP_SERVER_NAME] || !!chromeClient;

  function openUrl(url: string): void {
    if (isHomespace) {
      void openBrowser(url);
    } else {
      void openInChrome(url);
    }
  }

  const enableThisSession = useCallback(
    (opts?: { forceNative?: boolean }) => {
      if (!onChangeDynamicMcpConfig) {
        onDone('Cannot enable Claude in Chrome this session (no dynamic MCP config hook).');
        return;
      }
      setSessionBusy(true);
      try {
        // Connect local pins native socket (no token). Plain "This session: On"
        // keeps densable bridge eligibility when user has OAuth + copper flag.
        const { mcpConfig, allowedTools } = setupClaudeInChrome(opts?.forceNative ? { forceNative: true } : undefined);
        const newConfig = {
          ...(dynamicMcpConfig || {}),
          ...mcpConfig,
        };
        // Pre-allow chrome tools for this session (same as main --chrome path).
        // Dedupe against existing session/cliArg allows so re-On does not stack.
        setAppState(prev => {
          const allow = prev.toolPermissionContext.alwaysAllowRules;
          const existing = new Set([...(allow.session ?? []), ...(allow.cliArg ?? [])]);
          const newRules = allowedTools.filter(toolName => !existing.has(toolName)).map(toolName => ({ toolName }));
          if (newRules.length === 0) {
            return prev;
          }
          return {
            ...prev,
            toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, {
              type: 'addRules',
              rules: newRules,
              behavior: 'allow',
              destination: 'session',
            }),
          };
        });
        // Inject full chrome system prompt on subsequent turns (launch --chrome parity).
        setClaudeInChromeSessionPromptActive(true);
        onChangeDynamicMcpConfig(newConfig);
        // Close menu after action (same as /ide) — do not leave user stuck needing Esc.
        onDone(
          opts?.forceNative
            ? 'Claude in Chrome: local native socket mounted this session (no token).'
            : 'Claude in Chrome enabled for this session.',
        );
      } catch (e) {
        onDone(`Failed to enable Claude in Chrome: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSessionBusy(false);
      }
    },
    [dynamicMcpConfig, onChangeDynamicMcpConfig, onDone, setAppState],
  );

  const disableThisSession = useCallback(() => {
    if (!onChangeDynamicMcpConfig) {
      onDone('Cannot disable Claude in Chrome this session (no dynamic MCP config hook).');
      return;
    }
    setSessionBusy(true);
    try {
      const newConfig = { ...(dynamicMcpConfig || {}) };
      const chromeConfig = chromeClient?.config ?? newConfig[CLAUDE_IN_CHROME_MCP_SERVER_NAME];
      delete newConfig[CLAUDE_IN_CHROME_MCP_SERVER_NAME];

      // Always drop caches for pending/failed/connected so reconnect is clean.
      if (chromeClient?.type === 'connected') {
        // Prevent auto-reconnect on close (same pattern as /ide disconnect).
        chromeClient.client.onclose = () => {};
      }
      if (chromeConfig) {
        void clearServerCache(CLAUDE_IN_CHROME_MCP_SERVER_NAME, chromeConfig);
      }

      // Drop mid-session / launch-baked chrome system prompt for later turns.
      setClaudeInChromeSessionPromptActive(false);

      setAppState(prev => {
        const allow = prev.toolPermissionContext.alwaysAllowRules;
        const stripChrome = (rules: string[] | undefined) =>
          (rules ?? []).filter(r => !r.startsWith('mcp__claude-in-chrome__'));
        // Strip session + cliArg (main --chrome pushes allows into allowedTools → cliArg).
        return {
          ...prev,
          toolPermissionContext: {
            ...prev.toolPermissionContext,
            alwaysAllowRules: {
              ...allow,
              session: stripChrome(allow.session),
              cliArg: stripChrome(allow.cliArg),
            },
          },
          mcp: {
            ...prev.mcp,
            clients: prev.mcp.clients.filter(c => c.name !== CLAUDE_IN_CHROME_MCP_SERVER_NAME),
            tools: prev.mcp.tools.filter(t => !t.name?.startsWith('mcp__claude-in-chrome__')),
            commands: prev.mcp.commands.filter(c => !c.name?.startsWith('mcp__claude-in-chrome__')),
          },
        };
      });
      onChangeDynamicMcpConfig(newConfig);
      onDone('Claude in Chrome unloaded for this session.');
    } finally {
      setSessionBusy(false);
    }
  }, [chromeClient, dynamicMcpConfig, onChangeDynamicMcpConfig, onDone, setAppState]);

  /**
   * Fork: local unpacked extension path — reinstall native host + refresh
   * detection, optionally hot-mount session MCP. Never opens claude.ai.
   * Success closes the dialog via onDone; incomplete detection stays open.
   */
  const connectLocal = useCallback(() => {
    if (sessionBusy) return;
    setSessionBusy(true);
    setLocalConnectHint(null);
    void (async () => {
      try {
        const { extensionInstalled } = await ensureChromeNativeHostLocal();
        setIsExtensionInstalled(extensionInstalled);
        if (extensionInstalled) {
          setShowInstallHint(false);
        }

        if (!extensionInstalled) {
          // Stay in menu so user can Install / try again without reopening /chrome.
          setLocalConnectHint(
            'Native host installed. Extension still not detected — use Load unpacked (with official manifest key) or Install Chrome extension.',
          );
          setSelectKey(k => k + 1);
          return;
        }

        // Mount MCP this session if not already wired (does not change default).
        // Always forceNative: local path never needs claude.ai token / bridge.
        if (!isSessionWired) {
          if (!onChangeDynamicMcpConfig) {
            onDone(
              'Extension + native host OK, but cannot mount MCP this session (no dynamic MCP hook). Use claude --chrome.',
            );
            return;
          }
          // enableThisSession calls onDone and closes the dialog.
          enableThisSession({ forceNative: true });
          return;
        }

        // Already wired: remount by cycling config so MCP reconnects cleanly.
        const chromeConfig = chromeClient?.config ?? dynamicMcpConfig?.[CLAUDE_IN_CHROME_MCP_SERVER_NAME];
        if (chromeClient?.type === 'connected') {
          chromeClient.client.onclose = () => {};
        }
        if (chromeConfig) {
          await clearServerCache(CLAUDE_IN_CHROME_MCP_SERVER_NAME, chromeConfig);
        }
        if (onChangeDynamicMcpConfig) {
          const { mcpConfig } = setupClaudeInChrome({ forceNative: true });
          const without = { ...(dynamicMcpConfig || {}) };
          delete without[CLAUDE_IN_CHROME_MCP_SERVER_NAME];
          onChangeDynamicMcpConfig({ ...without, ...mcpConfig });
        }
        onDone('Local native host reinstalled · Extension detected · MCP reconnecting on native socket (no token).');
      } catch (e) {
        onDone(`Local connect failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSessionBusy(false);
      }
    })();
  }, [
    chromeClient,
    dynamicMcpConfig,
    enableThisSession,
    isSessionWired,
    onChangeDynamicMcpConfig,
    onDone,
    sessionBusy,
  ]);

  function handleAction(action: MenuAction): void {
    switch (action) {
      case 'install-extension':
        // densable: Web Store. Keep menu open — user still needs Connect local / Reconnect.
        setSelectKey(k => k + 1);
        setShowInstallHint(true);
        setLocalInstallHint(null);
        openUrl(CHROME_EXTENSION_URL);
        break;
      case 'install-local':
        // Fork: Load unpacked helpers — reveal package + chrome://extensions; stay in menu.
        if (sessionBusy) return;
        setSessionBusy(true);
        setLocalInstallHint(null);
        void (async () => {
          try {
            const result = await openLocalExtensionInstallHelpers();
            setLocalInstallHint(result.hint);
            setShowInstallHint(false);
            setSelectKey(k => k + 1);
          } catch (e) {
            setLocalInstallHint(`Install local failed: ${e instanceof Error ? e.message : String(e)}`);
            setSelectKey(k => k + 1);
          } finally {
            setSessionBusy(false);
          }
        })();
        break;
      case 'reconnect':
        // Official densable: open reconnect page, then return to REPL (not stuck in dialog).
        void isChromeExtensionInstalled().then(installed => {
          setIsExtensionInstalled(installed);
        });
        openUrl(CHROME_RECONNECT_URL);
        onDone('Opened official Chrome reconnect page (clau.de/chrome/reconnect).');
        break;
      case 'connect-local':
        connectLocal();
        break;
      case 'manage-permissions':
        openUrl(CHROME_PERMISSIONS_URL);
        onDone('Opened Chrome extension permissions page.');
        break;
      case 'toggle-session':
        if (sessionBusy) return;
        if (isSessionWired) {
          disableThisSession();
        } else {
          enableThisSession();
        }
        break;
      case 'toggle-default': {
        const newValue = !enabledByDefault;
        saveGlobalConfig(current => ({
          ...current,
          claudeInChromeDefaultEnabled: newValue,
        }));
        onDone(
          newValue
            ? 'Claude in Chrome enabled by default (next launch).'
            : 'Claude in Chrome disabled by default (next launch).',
        );
        break;
      }
    }
  }

  const options: OptionWithDescription<MenuAction>[] = [];
  const requiresExtensionSuffix = isExtensionInstalled ? '' : ' (requires extension)';

  if (!isExtensionInstalled && !isHomespace) {
    options.push({
      label: 'Install Chrome extension',
      value: 'install-extension',
      description: 'Official: opens claude.ai/chrome (Web Store)',
    });
    // Fork: Load unpacked — not densable. Always offer when not detected so
    // users do not hit the store path by mistake.
    options.push({
      label: sessionBusy ? 'Install local extension…' : 'Install local extension',
      value: 'install-local',
      description: localPackageDir
        ? `Fork: use/cache ${localPackageDir}; download zip if needed → chrome://extensions → Load unpacked`
        : 'Fork: download go-hare/agent-extension release zip → ~/.claude/chrome/extensions → Load unpacked',
    });
  }

  // Fork: no claude.ai subscription gate — any local user can mount Chrome MCP
  // (densable UI still requires subscriber / ant). WSL remains unsupported.
  if (!isWSL) {
    options.push({
      label: `This session: ${isSessionWired ? (isConnected ? 'On' : isPending ? 'Connecting…' : 'On') : 'Off'}`,
      value: 'toggle-session',
      description: isSessionWired
        ? 'Unload Claude in Chrome MCP for this session only (does not change default)'
        : 'Hot-mount Claude in Chrome MCP for this session only (does not change default)',
    });
  }

  options.push(
    {
      label: (
        <>
          <Text>Manage permissions</Text>
          <Text dimColor>{requiresExtensionSuffix}</Text>
        </>
      ),
      value: 'manage-permissions',
    },
    {
      label: (
        <>
          <Text>Reconnect extension</Text>
          <Text dimColor>{requiresExtensionSuffix}</Text>
        </>
      ),
      value: 'reconnect',
      description: 'Official: opens claude.ai reconnect page for Web Store extension',
    },
    {
      label: sessionBusy ? 'Connect local…' : 'Connect local',
      value: 'connect-local',
      description:
        'Fork: native socket only (no token / no bridge). Reinstall host + detect unpacked; no claude.ai tab. Does not change official Reconnect.',
    },
    {
      label: `Enabled by default: ${enabledByDefault ? 'Yes' : 'No'}`,
      value: 'toggle-default',
      description: 'Persists across sessions. Does not mount or unmount Chrome MCP in the current session.',
    },
  );

  const isDisabled = isWSL;

  return (
    <Dialog title="Claude in Chrome" onCancel={() => onDone()} color="chromeYellow">
      <Box flexDirection="column" gap={1}>
        <Text>
          Claude in Chrome works with the Chrome extension to let you control your browser directly from Claude Code.
          Navigate websites, fill forms, capture screenshots, record GIFs, and debug with console logs and network
          requests.
        </Text>

        {isWSL && <Text color="error">Claude in Chrome is not supported in WSL at this time.</Text>}

        {!isDisabled && (
          <>
            {!isHomespace && (
              <Box flexDirection="column">
                <Text>
                  Status:{' '}
                  {isConnected ? (
                    <Text color="success">Enabled</Text>
                  ) : isSessionWired ? (
                    <Text color="warning">Connecting…</Text>
                  ) : (
                    <Text color="inactive">Disabled</Text>
                  )}
                </Text>
                <Text>
                  Extension:{' '}
                  {isExtensionInstalled ? (
                    <Text color="success">Installed</Text>
                  ) : (
                    <Text color="warning">Not detected</Text>
                  )}
                </Text>
              </Box>
            )}
            <Select key={selectKey} options={options} onChange={handleAction} hideIndexes />

            {showInstallHint && (
              <Text color="warning">
                Web Store install: then {'"Reconnect extension"'}. Unpacked: use {'"Install local extension"'} then{' '}
                {'"Connect local"'}.
              </Text>
            )}

            {localInstallHint && <Text color="warning">{localInstallHint}</Text>}

            {localConnectHint && <Text color="warning">{localConnectHint}</Text>}

            <Text>
              <Text dimColor>Usage: </Text>
              <Text>claude --chrome</Text>
              <Text dimColor> or </Text>
              <Text>claude --no-chrome</Text>
              <Text dimColor> · This session mounts/unmounts MCP without changing Enabled by default</Text>
            </Text>

            <Text dimColor>
              Site-level permissions are inherited from the Chrome extension. Manage permissions in the Chrome extension
              settings to control which sites Claude can browse, click, and type on.
            </Text>
          </>
        )}
        <Text dimColor>Learn more: https://code.claude.com/docs/en/chrome</Text>
      </Box>
    </Dialog>
  );
}

export const call: LocalJSXCommandCall = async function (onDone, context) {
  const isExtensionInstalled = await isChromeExtensionInstalled();
  const config = getGlobalConfig();
  const isWSL = env.isWslEnvironment();

  return (
    <ClaudeInChromeMenu
      onDone={onDone}
      isExtensionInstalled={isExtensionInstalled}
      configEnabled={config.claudeInChromeDefaultEnabled}
      isWSL={isWSL}
      dynamicMcpConfig={context.options.dynamicMcpConfig}
      onChangeDynamicMcpConfig={context.onChangeDynamicMcpConfig}
    />
  );
};
