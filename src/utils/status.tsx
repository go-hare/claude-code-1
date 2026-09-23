import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import { color, Text } from '@anthropic/ink';
import type { MCPServerConnection } from '../services/mcp/types.js';
import { isOAuthRefreshTokenDead, isStoredOAuthRefreshTokenCleared } from './accountOnHold.js';
import { describeAnthropicProfile, isProfileAuthActive, isUsableStoredClaudeAiLogin } from './anthropicProfile.js';
import {
  getAccountInformation,
  getClaudeAIOAuthTokens,
  getOauthAccountInfo,
  getSubscriptionType,
  isAnthropicAuthEnabled,
  isClaudeAISubscriber,
} from './auth.js';
import { getSecureStorage } from './secureStorage/index.js';
import { getLargeMemoryFiles, getMemoryFiles, MAX_MEMORY_CHARACTER_COUNT } from './claudemd.js';
import { getDoctorDiagnostic } from './doctorDiagnostic.js';
import { getAWSRegion, getDefaultVertexRegion, isEnvTruthy } from './envUtils.js';
import { getDisplayPath } from './file.js';
import { formatNumber } from './format.js';
import { getGatewayAuth } from './gatewayEnv.js';
import { getIdeClientName, type IDEExtensionInstallationStatus, isJetBrainsIde, toIDEDisplayName } from './ide.js';
import { getClaudeAiUserDefaultModelDescription, modelDisplayString } from './model/model.js';
import { getAPIProvider, getBedrockMantleOverrideProvider } from './model/providers.js';
import { getMTLSConfig } from './mtls.js';
import { checkInstall } from './nativeInstaller/index.js';
import { formatProcessWrapperStatusLines, PROCESS_WRAPPER_ENV_KEY } from './processWrapper.js';
import { getProxyUrl } from './proxy.js';
import { shouldSkipAnthropicAwsAuth, shouldSkipMantleAuth } from './residualFinalEnvGates.js';
import { SandboxManager } from './sandbox/sandbox-adapter.js';
import {
  formatRemoteManagedSettingsStartupWarning,
  formatRemoteManagedSettingsStatusValue,
  zre,
} from '../services/remoteManagedSettings/loadStatus.js';
import { isRemoteManagedSettingsEligible } from '../services/remoteManagedSettings/syncCache.js';
import { getSettingsWithAllErrors } from './settings/allErrors.js';
import { getEnabledSettingSources, getSettingSourceDisplayNameCapitalized } from './settings/constants.js';
import { getManagedFileSettingsPresence, getPolicySettingsOrigin, getSettingsForSource } from './settings/settings.js';
import type { ThemeName } from './theme.js';
import { isHarborKiteEnabled } from './teleport/cloudPeerAccess.js';
import { getUdsStartFailureReason } from './udsMessaging.js';

export type Property = {
  label?: string;
  value: React.ReactNode | Array<string>;
};

export type Diagnostic = React.ReactNode;

export function buildSandboxProperties(): Property[] {
  if (process.env.USER_TYPE !== 'ant') {
    return [];
  }

  const isSandboxed = SandboxManager.isSandboxingEnabled();

  return [
    {
      label: 'Bash Sandbox',
      value: isSandboxed ? 'Enabled' : 'Disabled',
    },
  ];
}

/**
 * Official PROCESS_WRAPPER densable — Self-exec / refuse lines for /status.
 */
export function buildProcessWrapperProperties(): Property[] {
  const lines = formatProcessWrapperStatusLines();
  if (lines.length === 0) return [];
  return [
    {
      label: PROCESS_WRAPPER_ENV_KEY,
      value: lines,
    },
  ];
}

export function buildIDEProperties(
  mcpClients: MCPServerConnection[],
  ideInstallationStatus: IDEExtensionInstallationStatus | null = null,
  theme: ThemeName,
): Property[] {
  const ideClient = mcpClients?.find(client => client.name === 'ide');

  if (ideInstallationStatus) {
    const ideName = toIDEDisplayName(ideInstallationStatus.ideType);
    const pluginOrExtension = isJetBrainsIde(ideInstallationStatus.ideType) ? 'plugin' : 'extension';

    if (ideInstallationStatus.error) {
      return [
        {
          label: 'IDE',
          value: (
            <Text>
              {color('error', theme)(figures.cross)} Error installing {ideName} {pluginOrExtension}:{' '}
              {ideInstallationStatus.error}
              {'\n'}Please restart your IDE and try again.
            </Text>
          ),
        },
      ];
    }

    if (ideInstallationStatus.installed) {
      if (ideClient && ideClient.type === 'connected') {
        if (ideInstallationStatus.installedVersion !== ideClient.serverInfo?.version) {
          return [
            {
              label: 'IDE',
              value: `Connected to ${ideName} ${pluginOrExtension} version ${ideInstallationStatus.installedVersion} (server version: ${ideClient.serverInfo?.version})`,
            },
          ];
        } else {
          return [
            {
              label: 'IDE',
              value: `Connected to ${ideName} ${pluginOrExtension} version ${ideInstallationStatus.installedVersion}`,
            },
          ];
        }
      } else {
        return [
          {
            label: 'IDE',
            value: `Installed ${ideName} ${pluginOrExtension}`,
          },
        ];
      }
    }
  } else if (ideClient) {
    const ideName = getIdeClientName(ideClient) ?? 'IDE';
    if (ideClient.type === 'connected') {
      return [
        {
          label: 'IDE',
          value: `Connected to ${ideName} extension`,
        },
      ];
    } else {
      return [
        {
          label: 'IDE',
          value: `${color('error', theme)(figures.cross)} Not connected to ${ideName}`,
        },
      ];
    }
  }

  return [];
}

export function buildMcpProperties(clients: MCPServerConnection[] = [], theme: ThemeName): Property[] {
  const servers = clients.filter(client => client.name !== 'ide');
  if (!servers.length) {
    return [];
  }

  // Summary instead of a full server list — 20+ servers wrapped onto many
  // rows, dominating the Status pane. Show counts by state + /mcp hint.
  const byState = { connected: 0, pending: 0, needsAuth: 0, failed: 0 };
  for (const s of servers) {
    if (s.type === 'connected') byState.connected++;
    else if (s.type === 'pending') byState.pending++;
    else if (s.type === 'needs-auth') byState.needsAuth++;
    else byState.failed++;
  }
  const parts: string[] = [];
  if (byState.connected) parts.push(color('success', theme)(`${byState.connected} connected`));
  if (byState.needsAuth) parts.push(color('warning', theme)(`${byState.needsAuth} need auth`));
  if (byState.pending) parts.push(color('inactive', theme)(`${byState.pending} pending`));
  if (byState.failed) parts.push(color('error', theme)(`${byState.failed} failed`));

  return [
    {
      label: 'MCP servers',
      value: `${parts.join(', ')} ${color('inactive', theme)('· /mcp')}`,
    },
  ];
}

export async function buildMemoryDiagnostics(): Promise<Diagnostic[]> {
  const files = await getMemoryFiles();
  const largeFiles = getLargeMemoryFiles(files);

  const diagnostics: Diagnostic[] = [];

  largeFiles.forEach(file => {
    const displayPath = getDisplayPath(file.path);
    diagnostics.push(
      `Large ${displayPath} will impact performance (${formatNumber(file.content.length)} chars > ${formatNumber(MAX_MEMORY_CHARACTER_COUNT)})`,
    );
  });

  return diagnostics;
}

export function buildSettingSourcesProperties(): Property[] {
  const enabledSources = getEnabledSettingSources();

  // Filter to only sources that actually have settings loaded
  const sourcesWithSettings = enabledSources.filter(source => {
    const settings = getSettingsForSource(source);
    return settings !== null && Object.keys(settings).length > 0;
  });

  // Map internal names to user-friendly names
  // For policySettings, distinguish between remote and local (or skip if neither exists)
  const sourceNames = sourcesWithSettings
    .map(source => {
      if (source === 'policySettings') {
        const origin = getPolicySettingsOrigin();
        if (origin === null) {
          return null; // Skip - no policy settings exist
        }
        switch (origin) {
          case 'remote':
            return 'Enterprise managed settings (remote)';
          case 'plist':
            return 'Enterprise managed settings (plist)';
          case 'hklm':
            return 'Enterprise managed settings (HKLM)';
          case 'file': {
            const { hasBase, hasDropIns } = getManagedFileSettingsPresence();
            if (hasBase && hasDropIns) {
              return 'Enterprise managed settings (file + drop-ins)';
            }
            if (hasDropIns) {
              return 'Enterprise managed settings (drop-ins)';
            }
            return 'Enterprise managed settings (file)';
          }
          case 'hkcu':
            return 'Enterprise managed settings (HKCU)';
        }
      }
      return getSettingSourceDisplayNameCapitalized(source);
    })
    .filter((name): name is string => name !== null);

  const skipped = getSkippedManagedSettingSources();
  isRemoteManagedSettingsEligible();
  const remoteManagedValue = formatRemoteManagedSettingsStatusValue();

  return [
    {
      label: 'Setting sources',
      value: sourceNames,
    },
    ...(skipped.length > 0
      ? [
          {
            label: 'Skipped sources',
            value: skipped,
          },
        ]
      : []),
    ...(remoteManagedValue
      ? [
          {
            label: 'Managed settings (remote)',
            value: remoteManagedValue,
          },
        ]
      : []),
  ];
}

/**
 * densable 2.1.243 #6 — managed sources present but not applied because a
 * higher-precedence managed source won first-source-wins.
 */
function getSkippedManagedSettingSources(): string[] {
  const origin = getPolicySettingsOrigin();
  if (origin === null) {
    return [];
  }

  const skipped: string[] = [];
  const { hasBase, hasDropIns } = getManagedFileSettingsPresence();
  const filePresent = hasBase || hasDropIns;
  const fileLabel =
    hasBase && hasDropIns
      ? 'managed-settings.json + drop-ins'
      : hasDropIns
        ? 'managed-settings.d'
        : 'managed-settings.json';

  if (origin === 'remote' || origin === 'plist' || origin === 'hklm') {
    if (filePresent) skipped.push(fileLabel);
  }

  return skipped;
}

export async function buildInstallationDiagnostics(): Promise<Diagnostic[]> {
  const installWarnings = await checkInstall();
  return installWarnings.map(warning => warning.message);
}

export async function buildInstallationHealthDiagnostics(): Promise<Diagnostic[]> {
  const diagnostic = await getDoctorDiagnostic();
  const items: Diagnostic[] = [];

  isRemoteManagedSettingsEligible();
  const remoteLoadWarning = formatRemoteManagedSettingsStartupWarning(zre());
  if (remoteLoadWarning) {
    items.push(remoteLoadWarning);
  }

  const { errors: validationErrors } = getSettingsWithAllErrors();
  if (validationErrors.length > 0) {
    const invalidFiles = Array.from(
      new Set(
        validationErrors.map(error => error.file).filter((file): file is string => Boolean(file && file !== '.')),
      ),
    ).map(file => getDisplayPath(file));
    if (invalidFiles.length > 0) {
      // densable 2.1.243 #30 — SEA `Found invalid entries in: ${files}.`
      items.push(`Found invalid entries in: ${invalidFiles.join(', ')}.`);
    }
  }

  // Add warnings from doctor diagnostic (includes leftover installations, config mismatches, etc.)
  diagnostic.warnings.forEach(warning => {
    items.push(warning.issue);
  });

  if (diagnostic.hasUpdatePermissions === false) {
    items.push('No write permissions for auto-updates (requires sudo)');
  }

  return items;
}

/**
 * Official Wm /status Peer address (r0t / wZe @208535688).
 * Po() && socket → `uds:${socket}`; Po() && !socket && r0t() → unavailable copy.
 */
export function buildCrossSessionPeerAddressProperties(): Property[] {
  if (!isHarborKiteEnabled()) {
    return [];
  }
  const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
  if (socket) {
    return [{ label: 'Peer address', value: `uds:${socket}` }];
  }
  const reason = getUdsStartFailureReason();
  if (reason !== undefined) {
    return [
      {
        label: 'Peer address',
        value: `unavailable \u2014 ${reason} (details in the --debug log)`,
      },
    ];
  }
  return [];
}

/**
 * densable TYe — `VN(Xt())` else `GN(Tn().read())`.
 * VN = isOAuthRefreshTokenDead; GN = isStoredOAuthRefreshTokenCleared;
 * Xt = getClaudeAIOAuthTokens; Tn = getSecureStorage.
 */
function isStatusOauthRefreshDead(): boolean {
  const dead = isOAuthRefreshTokenDead(getClaudeAIOAuthTokens());
  if (dead !== undefined) return dead;
  try {
    return isStoredOAuthRefreshTokenCleared(getSecureStorage().read());
  } catch {
    return false;
  }
}

export function buildAccountProperties(): Property[] {
  const accountInfo = getAccountInformation();
  if (!accountInfo) {
    return [];
  }

  const tokens = getClaudeAIOAuthTokens();
  // Aqt(Xt()) — usable stored claude.ai login, not bare accessToken
  const storedClaudeAiLogin = isUsableStoredClaudeAiLogin(tokens);
  const profileActive = isProfileAuthActive({ storedClaudeAiLogin });

  // gold Ztt: i!==void 0&&M()?i.refreshKnownDead:wl()&&TYe()
  // No local M() inject. wl has if(Wd())return!1 — skip expired when profile is active.
  if (isAnthropicAuthEnabled() && !profileActive && isStatusOauthRefreshDead()) {
    const expired: Property[] = [{ label: 'Login', value: 'Expired \u2014 log in again' }];
    const oauth = getOauthAccountInfo();
    if (oauth?.organizationName && !process.env.IS_DEMO) {
      expired.push({
        label: 'Organization',
        value: oauth.organizationName,
      });
    }
    if (oauth?.emailAddress && !process.env.IS_DEMO) {
      expired.push({
        label: 'Email',
        value: oauth.emailAddress,
      });
    }
    return expired;
  }

  const properties: Property[] = [];

  if (accountInfo.subscription) {
    properties.push({
      label: 'Login method',
      value: `${accountInfo.subscription} Account`,
    });
  }

  if (accountInfo.tokenSource) {
    properties.push({
      label: 'Auth token',
      value: accountInfo.tokenSource,
    });
  }

  if (accountInfo.apiKeySource) {
    properties.push({
      label: 'API key',
      value: accountInfo.apiKeySource,
    });
  }

  // densable Ztt: if(Wd())s.push({label:"Profile",value:AJe()})
  if (profileActive) {
    properties.push({
      label: 'Profile',
      value: describeAnthropicProfile(),
    });
  }

  // Hide sensitive account info in demo mode
  if (accountInfo.organization && !process.env.IS_DEMO) {
    properties.push({
      label: 'Organization',
      value: accountInfo.organization,
    });
  }
  if (accountInfo.email && !process.env.IS_DEMO) {
    properties.push({
      label: 'Email',
      value: accountInfo.email,
    });
  }

  return properties;
}

/**
 * densable 2.1.243 #9 — `/status` GitHub-for-web line (Pro/Max).
 * SEA: label `Claude Code on the web`, values connected / not set up.
 */
export async function loadGithubWebStatusProperty(): Promise<Property | null> {
  if (!isClaudeAISubscriber()) {
    return null;
  }
  const subscription = getSubscriptionType();
  if (subscription !== 'pro' && subscription !== 'max') {
    return null;
  }

  // Lazy: preconditions pulls oauth/axios; status is imported widely.
  const { checkGithubTokenSynced } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./background/remote/preconditions.js') as typeof import('./background/remote/preconditions.js');
  const synced = await checkGithubTokenSynced();
  return {
    label: 'Claude Code on the web',
    value: synced ? 'GitHub connected' : 'Not set up · /web-setup to connect GitHub',
  };
}

export function buildAPIProviderProperties(): Property[] {
  const apiProvider = getAPIProvider();

  const properties: Property[] = [];

  if (apiProvider !== 'firstParty') {
    const providerLabel = {
      bedrock: 'AWS Bedrock',
      vertex: 'Google Vertex AI',
      foundry: 'Microsoft Foundry',
      anthropicAws: 'Anthropic on AWS',
      mantle: 'Amazon Bedrock Mantle',
      gateway: 'Cloud gateway',
      gemini: 'Gemini API',
      grok: 'Grok API',
      openai: 'OpenAI API',
    }[apiProvider];
    properties.push({
      label: 'API provider',
      value: providerLabel,
    });
  }

  if (apiProvider === 'firstParty') {
    const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
    if (anthropicBaseUrl) {
      properties.push({
        label: 'Anthropic base URL',
        value: anthropicBaseUrl,
      });
    }
  } else if (apiProvider === 'bedrock') {
    const bedrockBaseUrl = process.env.BEDROCK_BASE_URL;
    if (bedrockBaseUrl) {
      properties.push({
        label: 'Bedrock base URL',
        value: bedrockBaseUrl,
      });
    }

    properties.push({
      label: 'AWS region',
      value: getAWSRegion(),
    });

    // Official SKIP_BEDROCK_AUTH densable.
    let skipBedrockAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH);
    try {
      const { isSkipBedrockAuthEnvEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js');
      skipBedrockAuth = isSkipBedrockAuthEnvEnabled();
    } catch {
      // keep raw env fallback
    }
    if (skipBedrockAuth) {
      properties.push({
        value: 'AWS auth skipped',
      });
    }
  } else if (apiProvider === 'vertex') {
    const vertexBaseUrl = process.env.VERTEX_BASE_URL;
    if (vertexBaseUrl) {
      properties.push({
        label: 'Vertex base URL',
        value: vertexBaseUrl,
      });
    }

    const gcpProject = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
    if (gcpProject) {
      properties.push({
        label: 'GCP project',
        value: gcpProject,
      });
    }

    properties.push({
      label: 'Default region',
      value: getDefaultVertexRegion(),
    });

    // Official SKIP_VERTEX_AUTH densable.
    let skipVertexAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH);
    try {
      const { isSkipVertexAuthEnvEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js');
      skipVertexAuth = isSkipVertexAuthEnvEnabled();
    } catch {
      // keep raw env fallback
    }
    if (skipVertexAuth) {
      properties.push({
        value: 'GCP auth skipped',
      });
    }
  } else if (apiProvider === 'foundry') {
    const foundryBaseUrl = process.env.ANTHROPIC_FOUNDRY_BASE_URL;
    if (foundryBaseUrl) {
      properties.push({
        label: 'Microsoft Foundry base URL',
        value: foundryBaseUrl,
      });
    }

    const foundryResource = process.env.ANTHROPIC_FOUNDRY_RESOURCE;
    if (foundryResource) {
      properties.push({
        label: 'Microsoft Foundry resource',
        value: foundryResource,
      });
    }

    // Official SKIP_FOUNDRY_AUTH densable.
    let skipFoundryAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH);
    try {
      const { isSkipFoundryAuthEnvEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js');
      skipFoundryAuth = isSkipFoundryAuthEnvEnabled();
    } catch {
      // keep raw env fallback
    }
    if (skipFoundryAuth) {
      properties.push({
        value: 'Microsoft Foundry auth skipped',
      });
    }
  } else if (apiProvider === 'anthropicAws') {
    // Official status densable for Claude Platform on AWS.
    const workspaceId = process.env.ANTHROPIC_AWS_WORKSPACE_ID;
    if (workspaceId) {
      properties.push({
        label: 'Workspace ID',
        value: workspaceId,
      });
    }
    properties.push({
      label: 'AWS region',
      value: getAWSRegion(),
    });
    if (shouldSkipAnthropicAwsAuth()) {
      properties.push({
        value: 'Claude Platform on AWS auth skipped',
      });
    }
  } else if (apiProvider === 'gateway') {
    const gateway = getGatewayAuth();
    if (gateway) {
      properties.push({
        label: 'Gateway URL',
        value: gateway.url,
      });
    }
  } else if (apiProvider === 'gemini') {
    const geminiBaseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    properties.push({
      label: 'Gemini base URL',
      value: geminiBaseUrl,
    });
  } else if (apiProvider === 'grok') {
    const grokBaseUrl = process.env.GROK_BASE_URL;
    properties.push({
      label: 'Grok base URL',
      value: grokBaseUrl,
    });
  } else if (apiProvider === 'openai') {
    const openaiBaseUrl = process.env.OPENAI_BASE_URL;
    properties.push({
      label: 'OpenAI base URL',
      value: openaiBaseUrl,
    });
  }

  // Official: mantle provider OR bedrock+mantle override shows Mantle details.
  if (apiProvider === 'mantle' || getBedrockMantleOverrideProvider() === 'mantle') {
    const mantleBaseUrl = process.env.ANTHROPIC_BEDROCK_MANTLE_BASE_URL;
    if (mantleBaseUrl) {
      properties.push({
        label: 'Amazon Bedrock (Mantle) base URL',
        value: mantleBaseUrl,
      });
    }
    if (apiProvider === 'mantle') {
      properties.push({
        label: 'AWS region',
        value: getAWSRegion(),
      });
    }
    if (shouldSkipMantleAuth()) {
      properties.push({
        value: 'Amazon Bedrock (Mantle) auth skipped',
      });
    }
  }

  const proxyUrl = getProxyUrl();
  if (proxyUrl) {
    properties.push({
      label: 'Proxy',
      value: proxyUrl,
    });
  }

  const mtlsConfig = getMTLSConfig();
  if (process.env.NODE_EXTRA_CA_CERTS) {
    properties.push({
      label: 'Additional CA cert(s)',
      value: process.env.NODE_EXTRA_CA_CERTS,
    });
  }
  if (mtlsConfig) {
    if (mtlsConfig.cert && process.env.CLAUDE_CODE_CLIENT_CERT) {
      properties.push({
        label: 'mTLS client cert',
        value: process.env.CLAUDE_CODE_CLIENT_CERT,
      });
    }

    if (mtlsConfig.key && process.env.CLAUDE_CODE_CLIENT_KEY) {
      properties.push({
        label: 'mTLS client key',
        value: process.env.CLAUDE_CODE_CLIENT_KEY,
      });
    }
  }

  return properties;
}

export function getModelDisplayLabel(mainLoopModel: string | null): string {
  let modelLabel = modelDisplayString(mainLoopModel);

  if (mainLoopModel === null && isClaudeAISubscriber()) {
    const description = getClaudeAiUserDefaultModelDescription();

    modelLabel = `${chalk.bold('Default')} ${description}`;
  }

  return modelLabel;
}
