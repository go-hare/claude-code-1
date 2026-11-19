import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import { color, Link, Text } from '@anthropic/ink';
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
import { describeLoadedClientDataStatus } from '../cli/clientDataUrl.js';
import { getClaudeAiUserDefaultModelDescription, modelDisplayString } from './model/model.js';
import { getAPIProvider, getBedrockMantleOverrideProvider, isFirstPartyAnthropicBaseUrl } from './model/providers.js';
import { leftoverPolicyLimitsHost } from '../cli/leftoverTulip.js';
import { isAutoModeServerEnabled, isFirstPartyBehindLlmGateway } from '../services/api/autoModeClassifierTransport.js';
import { serverCheckDeclined } from '../services/api/autoModeServerFallbackNotice.js';
import type { PermissionMode } from '../types/permissions.js';
import { getMTLSConfig } from './mtls.js';
import { checkInstall } from './nativeInstaller/index.js';
import { formatProcessWrapperStatusLines, PROCESS_WRAPPER_ENV_KEY } from './processWrapper.js';
import { getProxyUrl } from './proxy.js';
import { shouldSkipAnthropicAwsAuth, shouldSkipMantleAuth } from './residualFinalEnvGates.js';
import { SandboxManager } from './sandbox/sandbox-adapter.js';
import { getSettingsWithAllErrors } from './settings/allErrors.js';
import { getEnabledSettingSources, getSettingSourceDisplayNameCapitalized } from './settings/constants.js';
import { getPolicySettingsOrigin, getSettingsForSource } from './settings/settings.js';
import type { ThemeName } from './theme.js';
import { isHarborKiteEnabled } from './teleport/cloudPeerAccess.js';
import { getOtelResourceAttributeStatus } from './telemetryAttributes.js';
import { getUdsStartFailureReason } from './udsMessaging.js';
import type { Command } from '../commands.js';
import { getIsRemoteMode } from '../bootstrap/state.js';
import { getAuthTokenSource, getAnthropicApiKeyWithSource } from './auth.js';

const FEATURE_DOCS_BASE_URL = 'https://code.claude.com/docs/en';

type DisabledFeatureGate = 'anthropicApi' | 'subscription' | 'nonessentialTraffic' | 'featureFlags';

type DisabledFeatureCause =
  | { kind: 'provider'; label: string }
  | { kind: 'variable'; name: string }
  | { kind: 'signIn' }
  | { kind: 'deniedAfterSignIn' };

/**
 * Official 2.1.326 #4 & #262 (`d` @319388200): built-in slash commands that are
 * gated by API provider, subscription sign-in, nonessential traffic env vars,
 * or feature-flag fetching env vars.
 */
const COMMAND_FEATURE_GATES: Record<string, readonly DisabledFeatureGate[]> = {
  advisor: ['anthropicApi', 'featureFlags'],
  'artifact-capabilities': ['subscription', 'nonessentialTraffic'],
  'artifact-diagramming': ['anthropicApi', 'nonessentialTraffic'],
  artifacts: ['subscription', 'nonessentialTraffic'],
  'autofix-pr': ['subscription'],
  chrome: ['subscription'],
  'claude-in-chrome': ['subscription'],
  design: ['anthropicApi', 'nonessentialTraffic'],
  'design-login': ['anthropicApi', 'nonessentialTraffic'],
  'design-sync': ['anthropicApi', 'nonessentialTraffic'],
  desktop: ['subscription'],
  import: ['featureFlags'],
  'install-github-app': ['subscription'],
  'install-slack-app': ['subscription'],
  logout: ['anthropicApi'],
  'privacy-settings': ['subscription'],
  'rate-limit-options': ['subscription'],
  'remote-control': ['subscription', 'nonessentialTraffic', 'featureFlags'],
  'remote-env': ['subscription'],
  schedule: ['subscription'],
  'skill-doctor': ['featureFlags'],
  slides: ['anthropicApi', 'nonessentialTraffic'],
  teleport: ['subscription'],
  ultrareview: ['subscription', 'featureFlags'],
  upgrade: ['subscription'],
  'usage-credits': ['subscription'],
  voice: ['subscription'],
  'web-setup': ['subscription', 'nonessentialTraffic'],
};

const API_PROVIDER_DISPLAY_LABELS: Record<string, string> = {
  bedrock: 'AWS Bedrock',
  vertex: 'Google Vertex AI',
  foundry: 'Microsoft Foundry',
  anthropicAws: 'Anthropic on AWS',
  anthropicGoogleCloud: 'Claude Platform on Google Cloud',
  mantle: 'Amazon Bedrock Mantle',
  gateway: 'Cloud gateway',
  gemini: 'Gemini API',
  grok: 'Grok API',
  openai: 'OpenAI API',
};

function getNonessentialTrafficEnvVar(): string | null {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';
  }
  return null;
}

function getFeatureFlagDisableEnvVar(): string | null {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';
  }
  if (process.env.DISABLE_TELEMETRY) {
    return 'DISABLE_TELEMETRY';
  }
  if (isEnvTruthy(process.env.DO_NOT_TRACK)) {
    return 'DO_NOT_TRACK';
  }
  if (isEnvTruthy(process.env.DISABLE_GROWTHBOOK)) {
    return 'DISABLE_GROWTHBOOK';
  }
  return null;
}

function evaluateFeatureGate(gate: DisabledFeatureGate, matchingCommands: Command[]): DisabledFeatureCause | undefined {
  const provider = getAPIProvider();
  const providerCause: DisabledFeatureCause | undefined =
    provider === 'firstParty'
      ? undefined
      : { kind: 'provider', label: API_PROVIDER_DISPLAY_LABELS[provider] ?? provider };

  switch (gate) {
    case 'anthropicApi':
      return providerCause;
    case 'subscription': {
      if (isClaudeAISubscriber()) {
        return undefined;
      }
      if (providerCause) {
        return providerCause;
      }
      if (matchingCommands.some(c => c.availability?.includes('console'))) {
        return { kind: 'variable', name: 'ANTHROPIC_BASE_URL' };
      }
      return { kind: 'signIn' };
    }
    case 'nonessentialTraffic': {
      const envName = getNonessentialTrafficEnvVar();
      return envName ? { kind: 'variable', name: envName } : undefined;
    }
    case 'featureFlags': {
      const envName = getFeatureFlagDisableEnvVar();
      return envName ? { kind: 'variable', name: envName } : undefined;
    }
  }
}

function getCommandDisabledCause(commandName: string, commands: Command[]): DisabledFeatureCause | undefined {
  if (!Object.hasOwn(COMMAND_FEATURE_GATES, commandName) || getIsRemoteMode()) {
    return undefined;
  }
  const matching = commands.filter(c => c.name === commandName);
  const gates = COMMAND_FEATURE_GATES[commandName];
  if (!gates) return undefined;
  const cause = gates.map(g => evaluateFeatureGate(g, matching)).find(r => r !== undefined);
  if (cause !== undefined && matching.some(c => c.isEnabled?.() ?? true)) {
    return undefined;
  }
  return cause;
}

/**
 * Official 2.1.326 #4 (`gFs`): `/status` row explaining when the API provider
 * or an environment variable (e.g. `DISABLE_TELEMETRY`, `DO_NOT_TRACK`,
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) turns built-in features off.
 */
export function buildDisabledFeaturesProperties(commands: Command[] = []): Property[] {
  if (getIsRemoteMode()) {
    return [];
  }
  const cause =
    evaluateFeatureGate('anthropicApi', []) ??
    evaluateFeatureGate('nonessentialTraffic', []) ??
    evaluateFeatureGate('featureFlags', []);
  if (!cause) {
    return [];
  }
  if (cause.kind === 'provider') {
    return [
      {
        label: 'Features',
        value: `some aren't available with ${cause.label}: ${FEATURE_DOCS_BASE_URL}/feature-availability`,
        linkify: true,
      },
    ];
  }
  if (cause.kind !== 'variable') {
    return [];
  }
  const affected = Object.keys(COMMAND_FEATURE_GATES).filter(name => {
    const c = getCommandDisabledCause(name, commands);
    return c?.kind === 'variable' && c.name === cause.name;
  });
  const examples = affected.length > 0 ? `, such as /${affected.slice(0, 6).join(', /')}` : '';
  const anchor = cause.name === getNonessentialTrafficEnvVar() ? '' : '#features-that-need-feature-flag-fetching';
  return [
    {
      label: 'Features',
      value: `some aren't available while ${cause.name} is set${examples}: ${FEATURE_DOCS_BASE_URL}/env-vars${anchor}`,
      linkify: true,
    },
  ];
}

/**
 * Official 2.1.326 #262 (`xsa`): explain why a built-in slash command is turned
 * off for the current provider, sign-in, or environment variable instead of
 * reporting `"Unknown command"`.
 */
export function getDisabledCommandReason(
  commandName: string,
  commands: Command[],
): { command?: Command; reason: string } | undefined {
  const normalized = commandName.trim().replace(/^\//, '');
  const matched = commands.find(c => c.name === normalized || c.aliases?.includes(normalized));
  const canonicalName = matched?.name ?? normalized;
  const cause = getCommandDisabledCause(canonicalName, commands);
  if (!cause || cause.kind === 'deniedAfterSignIn') {
    return undefined;
  }
  switch (cause.kind) {
    case 'provider':
      return {
        command: matched,
        reason: `/${canonicalName} isn't available with ${cause.label}. See ${FEATURE_DOCS_BASE_URL}/feature-availability`,
      };
    case 'variable': {
      const policyEnv = getSettingsForSource('policySettings')?.env;
      const adminNote = policyEnv?.[cause.name] !== undefined ? ' Your admin set it.' : '';
      return {
        command: matched,
        reason: `/${canonicalName} isn't available while ${cause.name} is set.${adminNote}`,
      };
    }
    case 'signIn': {
      const tokenSrc = getAuthTokenSource().source;
      const apiKeySrc = getAnthropicApiKeyWithSource({ skipRetrievingKeyFromApiKeyHelper: true }).source;
      const altAuth = [tokenSrc, apiKeySrc].find(
        src => src === 'ANTHROPIC_AUTH_TOKEN' || src === 'ANTHROPIC_API_KEY' || src === 'apiKeyHelper',
      );
      const canLogin = tokenSrc === 'none' && !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND);
      const tail = altAuth
        ? ` This session uses ${altAuth} instead.`
        : canLogin
          ? ' Run /login to sign in with one.'
          : ' Run /status to see how this session is signed in.';
      return {
        command: matched,
        reason: `/${canonicalName} needs a Claude subscription.${tail}`,
      };
    }
  }
}

/**
 * Official 2.1.326 #210 (`xTs`): deduplicate identical string diagnostics so
 * installation warnings from checkInstall + doctor don't appear twice in `/status`.
 */
export function deduplicateDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seenStrings = new Set<string>();
  const result: Diagnostic[] = [];
  for (const item of diagnostics) {
    if (typeof item === 'string') {
      const key = item.trim();
      if (seenStrings.has(key)) continue;
      seenStrings.add(key);
    }
    result.push(item);
  }
  return result;
}

export type Property = {
  label?: string;
  value: React.ReactNode | Array<string>;
  /** Official 2.1.319 (#1783): render inline URLs via OSC-8 <Link> so wrapped links open intact. */
  linkify?: boolean;
};

export const AUTO_MODE_SERVER_DOCS_URL =
  'https://code.claude.com/docs/en/permission-modes#server-side-classifier-review';

const URL_IN_TEXT_RE = /(https?:\/\/[^\s)]+)/g;

/**
 * Official 2.1.319 (#1783): split a plain status string into Text + OSC-8 <Link>
 * segments so wrapped help links open as one URL.
 */
export function linkifyStatusText(text: string): React.ReactNode {
  const parts = text.split(URL_IN_TEXT_RE);
  if (parts.length <= 1) {
    return text;
  }
  return parts.map((part, idx) =>
    idx % 2 === 1 ? (
      <Link key={idx} url={part}>
        {part}
      </Link>
    ) : (
      part
    ),
  );
}

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

  // Map internal names to user-friendly names.
  // policySettings only surfaces parent/host overlay after the enterprise cut.
  const sourceNames = sourcesWithSettings
    .map(source => {
      if (source === 'policySettings') {
        const origin = getPolicySettingsOrigin();
        if (origin === null) {
          return null;
        }
        if (origin === 'parent') {
          return 'Host managed settings';
        }
        return null;
      }
      return getSettingSourceDisplayNameCapitalized(source);
    })
    .filter((name): name is string => name !== null);

  return [
    {
      label: 'Setting sources',
      value: sourceNames,
    },
    ...(() => {
      const clientData = describeLoadedClientDataStatus();
      return clientData !== undefined ? [{ label: 'Client data', value: clientData }] : [];
    })(),
    ...buildManagedSettingsRemoteProperties(),
    ...buildOrganizationPolicyProperties(),
  ];
}

/**
 * densable `rvi` / `Dfo` (2.1.319 #1727 & #1783) — Auto mode server row.
 * When enabled locally but server-side review isn't reaching this session (e.g.
 * behind an LLM gateway or declined by server), show `Not reaching this session: <url>`
 * with OSC-8 linkification.
 */
export function buildAutoModeServerProperties(
  permissionMode: PermissionMode,
  opts?: { serverCheckDeclined?: boolean },
): Property[] {
  const enabled = isAutoModeServerEnabled(permissionMode);
  const declined = opts?.serverCheckDeclined ?? serverCheckDeclined();
  const notReaching = enabled && (declined || isFirstPartyBehindLlmGateway());
  return [
    {
      label: 'Auto mode server',
      value: !enabled
        ? 'Disabled'
        : notReaching
          ? `Not reaching this session: ${AUTO_MODE_SERVER_DOCS_URL}`
          : 'Enabled',
      linkify: true,
    },
  ];
}

/**
 * densable Mfo Vxo — Managed settings (remote) when fetch failed / ineligible.
 * Remote Anthropic managed-settings control plane is product-cut; surface the
 * gold ineligible copy when the session cannot fetch.
 */
function buildManagedSettingsRemoteProperties(): Property[] {
  const provider = getAPIProvider();
  if (provider !== 'firstParty') {
    return [
      {
        label: 'Managed settings (remote)',
        value: 'not fetched — not available on Bedrock/Vertex/third-party providers',
      },
    ];
  }
  if (!isFirstPartyAnthropicBaseUrl()) {
    return [
      {
        label: 'Managed settings (remote)',
        value: 'not fetched — not available with a custom ANTHROPIC_BASE_URL',
      },
    ];
  }
  return [];
}

/**
 * densable Mfo ezo/W_n — Organization policy when ineligible or unsettled.
 */
function buildOrganizationPolicyProperties(): Property[] {
  const provider = getAPIProvider();
  if (provider !== 'firstParty') {
    return [
      {
        label: 'Organization policy',
        value:
          "not fetched: this session doesn't connect to the Anthropic API directly (Bedrock, Vertex, Foundry, or a gateway)",
      },
    ];
  }
  if (!isFirstPartyAnthropicBaseUrl()) {
    return [
      {
        label: 'Organization policy',
        value: 'not fetched with a custom ANTHROPIC_BASE_URL',
      },
    ];
  }
  const host = leftoverPolicyLimitsHost();
  if (host.sessionCache !== null && !host.sessionFromServerFetch) {
    return [
      {
        label: 'Organization policy',
        value: 'Using the copy on disk · not refreshed yet this session',
      },
    ];
  }
  return [];
}

export async function buildInstallationDiagnostics(): Promise<Diagnostic[]> {
  const installWarnings = await checkInstall();
  return installWarnings.map(warning => warning.message);
}

export async function buildInstallationHealthDiagnostics(): Promise<Diagnostic[]> {
  const diagnostic = await getDoctorDiagnostic();
  const items: Diagnostic[] = [];

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
 * Official 2.1.323 (#2123): surface malformed OTEL_RESOURCE_ATTRIBUTES notices
 * on `/status` without emitting duplicate debug warnings on every render.
 */
export function buildTelemetryDiagnostics(): Diagnostic[] {
  return getOtelResourceAttributeStatus(process.env, { logWarnings: false }).notices;
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
  // No M() inject (ABSENT). wl has if(Wd())return!1 — compose !profileActive.
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
      // gold Ztt: `${e.subscription} account`
      value: `${accountInfo.subscription} account`,
    });
  }

  // xJ: else if(t!=="profile")r.tokenSource=t — no Auth token row under Wd
  if (accountInfo.tokenSource && !profileActive) {
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
      anthropicGoogleCloud: 'Claude Platform on Google Cloud',
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
  } else if (apiProvider === 'anthropicGoogleCloud') {
    const agcBase = process.env.ANTHROPIC_GOOGLE_CLOUD_BASE_URL;
    if (agcBase) {
      properties.push({
        label: 'Claude Platform on Google Cloud base URL',
        value: agcBase,
      });
    }
    const agcWorkspace = process.env.ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID;
    if (agcWorkspace) {
      properties.push({
        label: 'Workspace ID',
        value: agcWorkspace,
      });
    }
    const agcProject = process.env.ANTHROPIC_GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    if (agcProject) {
      properties.push({
        label: 'GCP project',
        value: agcProject,
      });
    }
    properties.push({
      label: 'GCP location',
      value: process.env.ANTHROPIC_GOOGLE_CLOUD_LOCATION || 'global',
    });
    if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH)) {
      properties.push({
        value: 'Claude Platform on Google Cloud auth skipped',
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
