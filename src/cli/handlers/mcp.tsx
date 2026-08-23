/**
 * MCP subcommand handlers — extracted from main.tsx for lazy loading.
 * These are dynamically imported only when the corresponding `claude mcp *` command runs.
 */

import { stat } from 'fs/promises';
import pMap from 'p-map';
import { cwd } from 'process';
import { MCPServerDesktopImportDialog } from '../../components/MCPServerDesktopImportDialog.js';
import { wrappedRender as render } from '@anthropic/ink';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import {
  AuthenticationCancelledError,
  clearMcpClientConfig,
  clearServerTokensFromLocalStorage,
  getMcpClientConfig,
  performMCPOAuthFlow,
  readClientSecret,
  revokeServerTokens,
  saveMcpClientSecret,
} from '../../services/mcp/auth.js';
import { connectToServer, getMcpServerConnectionBatchSize } from '../../services/mcp/client.js';
import {
  addMcpConfig,
  getAllMcpConfigs,
  getMcpConfigByName,
  getMcpConfigsByScope,
  isMcpServerDisabled,
  removeMcpConfig,
} from '../../services/mcp/config.js';
import { formatFailedMcpIssue } from '../../services/mcp/mcpConnectionIssue.js';
import type {
  ConfigScope,
  McpHTTPServerConfig,
  McpSSEServerConfig,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js';
import {
  describeMcpConfigFilePath,
  ensureConfigScope,
  getProjectMcpServerStatusStrict,
  getScopeLabel,
} from '../../services/mcp/utils.js';
import { AppStateProvider } from '../../state/AppState.js';
import { openBrowser } from '../../utils/browser.js';
import { getCurrentProjectConfig, getGlobalConfig, saveCurrentProjectConfig } from '../../utils/config.js';
import { errorMessage, isFsInaccessible } from '../../utils/errors.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { safeParseJSON } from '../../utils/json.js';
import { getPlatform } from '../../utils/platform.js';
import { cliError, cliOk } from '../exit.js';
import { createInterface } from 'readline';
import { MCP_DISABLED_STATUS, mcpDisabledHealthResult } from './mcpDisabledStatus.js';

export { MCP_DISABLED_STATUS };

// Official 2.1.196: never spawn unapproved project (.mcp.json) servers from list/get.
const PENDING_APPROVAL_STATUS = '⏸ Pending approval (run `claude` to approve)';
const REJECTED_STATUS = '✗ Rejected (see disabledMcpjsonServers in settings)';

/** densable 2.1.219 `ivp` result — status line + optional issue (HTTP/error). */
type McpHealthResult = { status: string; issue?: string };

/**
 * densable `evp` — list row body: `status — issue` when issue present.
 */
function formatMcpListStatus(health: McpHealthResult): string {
  return health.issue ? `${health.status} — ${health.issue}` : health.status;
}

async function checkMcpServerHealth(
  name: string,
  server: ScopedMcpServerConfig,
  options?: { skipConnect?: boolean; projectStatus?: 'pending' | 'rejected' },
): Promise<McpHealthResult> {
  if (options?.projectStatus === 'pending' || options?.skipConnect) {
    return { status: PENDING_APPROVAL_STATUS };
  }
  if (options?.projectStatus === 'rejected') {
    return { status: REJECTED_STATUS };
  }
  // densable 2.1.238: hm(name)?wah — disabled → glyph, never connect
  const disabled = mcpDisabledHealthResult(isMcpServerDisabled(name));
  if (disabled) {
    return disabled;
  }
  // Defense in depth: project-scope servers that are not settings-approved
  // must not be connected from CLI list/get (RCE via self-approved .mcp.json).
  if (server.scope === 'project') {
    const projectStatus = getProjectMcpServerStatusStrict(name);
    if (projectStatus === 'pending') {
      return { status: PENDING_APPROVAL_STATUS };
    }
    if (projectStatus === 'rejected') {
      return { status: REJECTED_STATUS };
    }
  }
  try {
    const result = await connectToServer(name, server);
    if (result.type === 'connected') {
      return { status: '✓ Connected' };
    } else if (result.type === 'needs-auth') {
      return { status: '! Needs authentication' };
    } else if (result.type === 'failed') {
      // densable `ivp` + `mSp`
      const issue = formatFailedMcpIssue(result);
      return {
        status: '✗ Failed to connect',
        ...(issue !== '' ? { issue } : {}),
      };
    } else {
      return { status: '✗ Failed to connect' };
    }
  } catch (_error) {
    return { status: '✗ Connection error' };
  }
}

/**
 * Merge approved configs with pending/rejected project servers for display.
 * Pending servers are listed but never connected (official 2.1.196 security fix).
 */
async function getMcpConfigsForListGet(): Promise<{
  servers: Record<string, ScopedMcpServerConfig>;
  pendingProjectServers: Set<string>;
  rejectedProjectServers: Set<string>;
}> {
  const { servers: approved } = await getAllMcpConfigs();
  const pendingProjectServers = new Set<string>();
  const rejectedProjectServers = new Set<string>();
  const servers: Record<string, ScopedMcpServerConfig> = { ...approved };

  const { servers: projectServers } = getMcpConfigsByScope('project');
  for (const [name, config] of Object.entries(projectServers)) {
    // Higher-precedence scopes already present — keep approved entry.
    if (servers[name]) {
      continue;
    }
    const status = getProjectMcpServerStatusStrict(name);
    if (status === 'pending') {
      servers[name] = config;
      pendingProjectServers.add(name);
    } else if (status === 'rejected') {
      servers[name] = config;
      rejectedProjectServers.add(name);
    }
  }

  return { servers, pendingProjectServers, rejectedProjectServers };
}

// mcp serve (lines 4512–4532)
export async function mcpServeHandler({ debug, verbose }: { debug?: boolean; verbose?: boolean }): Promise<void> {
  const providedCwd = cwd();
  logEvent('tengu_mcp_start', {});

  try {
    await stat(providedCwd);
  } catch (error) {
    if (isFsInaccessible(error)) {
      cliError(`Error: Directory ${providedCwd} does not exist`);
    }
    throw error;
  }

  try {
    const { setup } = await import('../../setup.js');
    await setup(providedCwd, 'default', false, false, undefined, false);
    const { startMCPServer } = await import('../../entrypoints/mcp.js');
    await startMCPServer(providedCwd, debug ?? false, verbose ?? false);
  } catch (error) {
    cliError(`Error: Failed to start MCP server: ${error}`);
  }
}

// mcp remove (lines 4545–4635)
export async function mcpRemoveHandler(name: string, options: { scope?: string }): Promise<void> {
  // Look up config before removing so we can clean up secure storage
  const serverBeforeRemoval = getMcpConfigByName(name);

  const cleanupSecureStorage = () => {
    if (serverBeforeRemoval && (serverBeforeRemoval.type === 'sse' || serverBeforeRemoval.type === 'http')) {
      clearServerTokensFromLocalStorage(name, serverBeforeRemoval);
      clearMcpClientConfig(name, serverBeforeRemoval);
    }
  };

  try {
    if (options.scope) {
      const scope = ensureConfigScope(options.scope);
      logEvent('tengu_mcp_delete', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });

      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(`Removed MCP server ${name} from ${scope} config\n`);
      cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`);
    }

    // If no scope specified, check where the server exists
    const projectConfig = getCurrentProjectConfig();
    const globalConfig = getGlobalConfig();

    // Check if server exists in project scope (.mcp.json)
    const { servers: projectServers } = getMcpConfigsByScope('project');
    const mcpJsonExists = !!projectServers[name];

    // Count how many scopes contain this server
    const scopes: Array<Exclude<ConfigScope, 'dynamic'>> = [];
    if (projectConfig.mcpServers?.[name]) scopes.push('local');
    if (mcpJsonExists) scopes.push('project');
    if (globalConfig.mcpServers?.[name]) scopes.push('user');

    if (scopes.length === 0) {
      cliError(`No MCP server found with name: "${name}"`);
    } else if (scopes.length === 1) {
      // Server exists in only one scope, remove it
      const scope = scopes[0]!;
      logEvent('tengu_mcp_delete', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });

      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(`Removed MCP server "${name}" from ${scope} config\n`);
      cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`);
    } else {
      // Server exists in multiple scopes
      process.stderr.write(`MCP server "${name}" exists in multiple scopes:\n`);
      scopes.forEach(scope => {
        process.stderr.write(`  - ${getScopeLabel(scope)} (${describeMcpConfigFilePath(scope)})\n`);
      });
      process.stderr.write('\nTo remove from a specific scope, use:\n');
      scopes.forEach(scope => {
        process.stderr.write(`  claude mcp remove "${name}" -s ${scope}\n`);
      });
      cliError();
    }
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp list (lines 4641–4688)
export async function mcpListHandler(): Promise<void> {
  logEvent('tengu_mcp_list', {});
  const { servers: configs, pendingProjectServers, rejectedProjectServers } = await getMcpConfigsForListGet();
  if (Object.keys(configs).length === 0) {
    console.log('No MCP servers configured. Use `claude mcp add` to add a server.');
  } else {
    console.log('Checking MCP server health...\n');

    // Check servers concurrently — pending/rejected project servers never spawn.
    const entries = Object.entries(configs);
    const results = await pMap(
      entries,
      async ([name, server]) => {
        const projectStatus = pendingProjectServers.has(name)
          ? ('pending' as const)
          : rejectedProjectServers.has(name)
            ? ('rejected' as const)
            : undefined;
        return {
          name,
          server,
          health: await checkMcpServerHealth(name, server, { projectStatus }),
        };
      },
      { concurrency: getMcpServerConnectionBatchSize() },
    );

    for (const { name, server, health } of results) {
      // densable `evp`: status — issue
      const status = formatMcpListStatus(health);
      // Intentionally excluding sse-ide servers here since they're internal
      if (server.type === 'sse') {
        console.log(`${name}: ${server.url} (SSE) - ${status}`);
      } else if (server.type === 'http') {
        console.log(`${name}: ${server.url} (HTTP) - ${status}`);
      } else if (server.type === 'claudeai-proxy') {
        console.log(`${name}: ${server.url} - ${status}`);
      } else if (!server.type || server.type === 'stdio') {
        const stdioServer = server as { command: string; args: string[]; type?: string };
        const args = Array.isArray(stdioServer.args) ? stdioServer.args : [];
        console.log(`${name}: ${stdioServer.command} ${args.join(' ')} - ${status}`);
      }
    }
  }
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0);
}

// mcp get (lines 4694–4786)
export async function mcpGetHandler(name: string): Promise<void> {
  logEvent('tengu_mcp_get', {
    name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  // Prefer approved configs; surface pending/rejected project servers without connecting.
  let server = getMcpConfigByName(name);
  let projectStatus: 'pending' | 'rejected' | undefined;
  if (!server) {
    const { servers: projectServers } = getMcpConfigsByScope('project');
    const projectServer = projectServers[name];
    if (projectServer) {
      const status = getProjectMcpServerStatusStrict(name);
      if (status === 'pending' || status === 'rejected') {
        server = projectServer;
        projectStatus = status;
      }
    }
  }
  if (!server) {
    cliError(`No MCP server found with name: ${name}`);
  }

  console.log(`${name}:`);
  console.log(`  Scope: ${getScopeLabel(server.scope)}`);

  // Check server health (pending/rejected never spawn)
  // densable `oX_`: Status + optional Issue: line
  const health = await checkMcpServerHealth(name, server, { projectStatus });
  console.log(`  Status: ${health.status}`);
  if (health.issue) {
    console.log(`  Issue: ${health.issue}`);
  }

  // Intentionally excluding sse-ide servers here since they're internal
  if (server.type === 'sse') {
    console.log(`  Type: sse`);
    console.log(`  URL: ${server.url}`);
    if (server.headers) {
      console.log('  Headers:');
      for (const [key, value] of Object.entries(server.headers)) {
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('client_id configured');
        const clientConfig = getMcpClientConfig(name, server);
        if (clientConfig?.clientSecret) parts.push('client_secret configured');
      }
      if (server.oauth.callbackPort) parts.push(`callback_port ${server.oauth.callbackPort}`);
      console.log(`  OAuth: ${parts.join(', ')}`);
    }
  } else if (server.type === 'http') {
    console.log(`  Type: http`);
    console.log(`  URL: ${server.url}`);
    if (server.headers) {
      console.log('  Headers:');
      for (const [key, value] of Object.entries(server.headers)) {
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('client_id configured');
        const clientConfig = getMcpClientConfig(name, server);
        if (clientConfig?.clientSecret) parts.push('client_secret configured');
      }
      if (server.oauth.callbackPort) parts.push(`callback_port ${server.oauth.callbackPort}`);
      console.log(`  OAuth: ${parts.join(', ')}`);
    }
  } else if (server.type === 'stdio') {
    console.log(`  Type: stdio`);
    console.log(`  Command: ${server.command}`);
    const args = Array.isArray(server.args) ? server.args : [];
    console.log(`  Args: ${args.join(' ')}`);
    if (server.env) {
      console.log('  Environment:');
      for (const [key, value] of Object.entries(server.env)) {
        console.log(`    ${key}=${value}`);
      }
    }
  }
  console.log(`\nTo remove this server, run: claude mcp remove "${name}" -s ${server.scope}`);
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0);
}

// mcp add-json (lines 4801–4870)
export async function mcpAddJsonHandler(
  name: string,
  json: string,
  options: { scope?: string; clientSecret?: true },
): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope);
    const parsedJson = safeParseJSON(json);

    // Read secret before writing config so cancellation doesn't leave partial state
    const needsSecret =
      options.clientSecret &&
      parsedJson &&
      typeof parsedJson === 'object' &&
      'type' in parsedJson &&
      (parsedJson.type === 'sse' || parsedJson.type === 'http') &&
      'url' in parsedJson &&
      typeof parsedJson.url === 'string' &&
      'oauth' in parsedJson &&
      parsedJson.oauth &&
      typeof parsedJson.oauth === 'object' &&
      'clientId' in parsedJson.oauth;
    const clientSecret = needsSecret ? await readClientSecret() : undefined;

    await addMcpConfig(name, parsedJson, scope);

    const transportType =
      parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson
        ? String(parsedJson.type || 'stdio')
        : 'stdio';

    if (
      clientSecret &&
      parsedJson &&
      typeof parsedJson === 'object' &&
      'type' in parsedJson &&
      (parsedJson.type === 'sse' || parsedJson.type === 'http') &&
      'url' in parsedJson &&
      typeof parsedJson.url === 'string'
    ) {
      saveMcpClientSecret(name, { type: parsedJson.type, url: parsedJson.url }, clientSecret);
    }

    logEvent('tengu_mcp_add', {
      scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: 'json' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      type: transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });

    cliOk(`Added ${transportType} MCP server ${name} to ${scope} config`);
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp add-from-claude-desktop (lines 4881–4927)
export async function mcpAddFromDesktopHandler(options: { scope?: string }): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope);
    const platform = getPlatform();

    logEvent('tengu_mcp_add', {
      scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      platform: platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: 'desktop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });

    const { readClaudeDesktopMcpServers } = await import('../../utils/claudeDesktop.js');
    const servers = await readClaudeDesktopMcpServers();

    if (Object.keys(servers).length === 0) {
      cliOk('No MCP servers found in Claude Desktop configuration or configuration file does not exist.');
    }

    const { unmount } = await render(
      <AppStateProvider>
        <KeybindingSetup>
          <MCPServerDesktopImportDialog
            servers={servers}
            scope={scope}
            onDone={() => {
              unmount();
            }}
          />
        </KeybindingSetup>
      </AppStateProvider>,
      { exitOnCtrlC: true },
    );
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp reset-project-choices (lines 4935–4952)
export async function mcpResetChoicesHandler(): Promise<void> {
  logEvent('tengu_mcp_reset_mcpjson_choices', {});
  saveCurrentProjectConfig(current => ({
    ...current,
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    enableAllProjectMcpServers: false,
  }));
  cliOk(
    'All project-scoped (.mcp.json) server approvals and rejections have been reset.\n' +
      'You will be prompted for approval next time you start Claude Code.',
  );
}

type McpAuthTarget =
  | { kind: 'claudeai-proxy'; config: ScopedMcpServerConfig }
  | { kind: 'unsupported-transport'; transport: string }
  | { kind: 'oauth'; config: McpSSEServerConfig | McpHTTPServerConfig }
  | { kind: 'missing' };

function classifyMcpAuthTarget(name: string, server: ScopedMcpServerConfig | null): McpAuthTarget {
  if (!server) return { kind: 'missing' };
  if (server.type === 'claudeai-proxy') {
    return { kind: 'claudeai-proxy', config: server };
  }
  if (server.type !== 'sse' && server.type !== 'http') {
    return { kind: 'unsupported-transport', transport: server.type ?? 'stdio' };
  }
  return {
    kind: 'oauth',
    config: server as McpSSEServerConfig | McpHTTPServerConfig,
  };
}

function hasStaticAuthHeader(config: McpSSEServerConfig | McpHTTPServerConfig): boolean {
  const headers = config.headers ?? {};
  return Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
}

function formatAuthUrlHint(openBrowserAttempted: boolean, url: string): string {
  const label = openBrowserAttempted ? "If the browser didn't open, visit:" : 'Visit this URL to authorize:';
  return `${label}\n  ${url}\n`;
}

// Official 2.1.186: `claude mcp login <name> [--no-browser]`
export async function mcpLoginHandler(name: string, options: { browser?: boolean } = {}): Promise<void> {
  logEvent('tengu_mcp_login', {});
  const openBrowserEnabled = options.browser !== false;
  const server = getMcpConfigByName(name);
  const target = classifyMcpAuthTarget(name, server);

  switch (target.kind) {
    case 'missing':
      cliError(`No MCP server found with name: ${name}`);
      break;
    case 'claudeai-proxy': {
      const url = 'url' in target.config ? String(target.config.url) : '';
      if (!url) {
        cliError(
          `Couldn't build the claude.ai authorization link for "${name}". Make sure you're signed in (\`claude login\`).`,
        );
      }
      if (openBrowserEnabled) {
        process.stdout.write(`Opening browser to authorize "${name}"…\n`);
        await openBrowser(url);
      }
      process.stdout.write(
        formatAuthUrlHint(openBrowserEnabled, url) +
          'Once authorized on claude.ai, the connector will be available the next time you start Claude Code.\n',
      );
      await gracefulShutdown(0);
      break;
    }
    case 'unsupported-transport':
      cliError(`"${name}" doesn't support OAuth login — it's only available for HTTP and SSE servers.`);
      break;
    case 'oauth': {
      if (hasStaticAuthHeader(target.config)) {
        cliError(
          `"${name}" authenticates with the \`Authorization\` header in its configuration, so there's no separate login. Update that header to change its credentials.`,
        );
      }

      process.stdout.write(`Starting authentication for "${name}"…\n`);
      const prompt = 'Or paste the redirect URL here: ';
      const abortController = new AbortController();
      let rl: ReturnType<typeof createInterface> | undefined;
      let noTtyStdin = false;
      // Keep the event loop alive while waiting for the OAuth callback.
      const keepAlive = setInterval(() => {}, 60_000);

      try {
        // densable 2.1.216 CLI mcp login still: await wat(...,{preserveStepUpState:!0}), await ebe(...)
        // UI re-auth uses QLu→ebe→eMu (#19); do NOT invent CLI eMu unless densable drops wat here.
        await revokeServerTokens(name, target.config, {
          preserveStepUpState: true,
        });
        await performMCPOAuthFlow(
          name,
          target.config,
          authorizationUrl => {
            process.stdout.write(
              formatAuthUrlHint(openBrowserEnabled, authorizationUrl) + 'Waiting for authorization… (^C to cancel)\n',
            );
            rl?.prompt();
          },
          abortController.signal,
          {
            skipBrowserOpen: !openBrowserEnabled,
            onWaitingForCallback: submit => {
              if (!process.stdin.isTTY) {
                noTtyStdin = true;
                abortController.abort();
                return;
              }
              if (!process.stdout.isTTY) return;
              rl = createInterface({
                input: process.stdin,
                output: process.stdout,
                prompt,
              });
              rl.on('SIGINT', () => abortController.abort());
              rl.on('close', () => abortController.abort());
              rl.on('line', line => {
                const trimmed = line.trim();
                if (trimmed && submit(trimmed)) return;
                if (trimmed) {
                  process.stdout.write(
                    "That doesn't look like a redirect URL — paste the full address from your browser's address bar.\n",
                  );
                }
                rl?.prompt();
              });
            },
          },
        );
      } catch (error) {
        if (error instanceof AuthenticationCancelledError) {
          if (noTtyStdin) {
            cliError(
              `Couldn't complete authentication for "${name}": stdin isn't a terminal, so authentication can't be completed here. ` +
                'Re-run in an interactive terminal — e.g. `ssh -t` — and paste the redirect URL when prompted.',
            );
          }
          process.exit(130);
          return;
        }
        cliError(`Couldn't complete authentication for "${name}": ${errorMessage(error)}`);
      } finally {
        clearInterval(keepAlive);
        if (rl) {
          rl.close();
          process.stdout.write('\n');
        }
      }

      if (isMcpServerDisabled(name)) {
        cliOk(`Authenticated with "${name}", but it's currently disabled. Enable it in /mcp for its tools to load.`);
      }
      cliOk(`Authenticated with "${name}". Its tools are now available in Claude Code.`);
      break;
    }
  }
}

// Official 2.1.186: `claude mcp logout <name>`
export async function mcpLogoutHandler(name: string): Promise<void> {
  logEvent('tengu_mcp_logout', {});
  const server = getMcpConfigByName(name);
  const target = classifyMcpAuthTarget(name, server);

  switch (target.kind) {
    case 'missing':
      cliError(`No MCP server found with name: ${name}`);
      break;
    case 'claudeai-proxy': {
      const url = 'url' in target.config ? String(target.config.url) : 'claude.ai';
      cliOk(
        `"${name}" is a claude.ai connector — its credentials live on claude.ai, not this machine. ` +
          `Disconnect it at ${url}`,
      );
      break;
    }
    case 'unsupported-transport':
      cliError(`"${name}" doesn't use OAuth — there are no stored credentials to clear.`);
      break;
    case 'oauth': {
      await revokeServerTokens(name, target.config);
      clearServerTokensFromLocalStorage(name, target.config);
      clearMcpClientConfig(name, target.config);
      const reauth = hasStaticAuthHeader(target.config)
        ? ''
        : ` Run \`claude mcp login ${name}\` to authenticate again.`;
      cliOk(`Signed out of "${name}".${reauth}`);
      break;
    }
  }
}
