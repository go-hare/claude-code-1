// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import { Box, StatusIcon, type DOMElement, type StatusIconStatus, Text } from '@anthropic/ink';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useUiRenderHost } from '../components/hooks/useUiRenderHost.js';
import { PluginRenderedTree } from '../components/PluginRasterPanes.js';
import { getPanesTerminalSize, subscribePanes } from './plugins/functionHooksModules.js';
import * as React from 'react';
import { getAllowedChannels } from '../bootstrap/state.js';
import { EmergencyTip, shouldShowEmergencyTip } from '../components/LogoV2/EmergencyTip.js';
import { GuestPassesNotice, shouldShowGuestPassesUpsell } from '../components/LogoV2/GuestPassesUpsell.js';
import { getLargeMemoryFiles, MAX_MEMORY_CHARACTER_COUNT, type MemoryFileInfo } from './claudemd.js';
import figures from 'figures';
import { getCwd } from './cwd.js';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { formatNumber } from './format.js';
import type { getGlobalConfig } from './config.js';
import { pickCompanyAnnouncement } from './companyAnnouncement.js';
import { getDebugLogPath, isDebugMode, isDebugToStdErr } from './debug.js';
import { isEnvTruthy } from './envUtils.js';
import {
  formatApiKeyProfileConflictWarning,
  getActiveAnthropicProfileName,
  getAnthropicConfigDir,
  getAnthropicProfileAuthKind,
  getAnthropicProfileSource,
} from './anthropicProfile.js';
import {
  getAnthropicApiKeyWithSource,
  getApiKeyFromConfigOrMacOSKeychain,
  getAuthTokenSource,
  isClaudeAISubscriber,
} from './auth.js';
import { getAPIProvider } from './model/providers.js';
import type { AgentDefinitionsResult } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { getAgentDescriptionsTotalTokens, AGENT_DESCRIPTIONS_THRESHOLD } from './statusNoticeHelpers.js';
import { isSupportedJetBrainsTerminal, toIDEDisplayName, getTerminalIdeType } from './ide.js';
import { isJetBrainsPluginInstalledCachedSync } from './jetbrains.js';
import { getInitialSettings } from './settings/settings.js';
import { getUdsStartFailureCause, getUdsStartFailureReason } from './udsMessaging.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const ChannelsNoticeModule =
  feature('KAIROS') || feature('KAIROS_CHANNELS')
    ? (require('../components/LogoV2/ChannelsNotice.js') as typeof import('../components/LogoV2/ChannelsNotice.js'))
    : null;
/* eslint-enable @typescript-eslint/no-require-imports */

// Types
export type StatusNoticeType = 'warning' | 'info';
export type StatusNoticeTier = 'error' | 'warning' | 'info' | 'announcement';

export type StatusNoticeContext = {
  config: ReturnType<typeof getGlobalConfig>;
  agentDefinitions?: AgentDefinitionsResult;
  memoryFiles: MemoryFileInfo[];
};

export type StatusNoticeDefinition = {
  id: string;
  tier?: StatusNoticeTier;
  type: StatusNoticeType;
  promo?: boolean;
  priority?: number;
  claimsFirstShow?: () => boolean;
  showAccentBar?: () => boolean;
  isActive: (context: StatusNoticeContext) => boolean;
  render: (context: StatusNoticeContext) => React.ReactNode;
};

const ANNOUNCEMENT_PRIORITY = {
  org: 30,
  launch: 20,
  campaign: 15,
  promo: 10,
  hint: 5,
} as const;

const STATUS_ROW_TEXT_COLORS: Partial<Record<StatusIconStatus, 'success' | 'error' | 'warning' | 'suggestion'>> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'suggestion',
  on: 'success',
};

function NoticeStatusRow({
  status,
  children,
}: {
  status: StatusIconStatus;
  children: React.ReactNode;
}): React.ReactNode {
  const color = STATUS_ROW_TEXT_COLORS[status];
  return (
    <Box flexDirection="row">
      <Box width={2} flexShrink={0}>
        <StatusIcon status={status} />
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={color} dimColor={!color}>
          {children}
        </Text>
      </Box>
    </Box>
  );
}

export function flattenNoticeText(node: React.ReactNode): string {
  let out = '';
  React.Children.forEach(node, child => {
    if (typeof child === 'string' || typeof child === 'number') {
      out += String(child);
    } else if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      out += flattenNoticeText(child.props.children);
    }
  });
  return out;
}

function InfoNotice({ command, children }: { command?: string; children: React.ReactNode }): React.ReactNode {
  const { columns, rows } = useTerminalSize();
  const panesViewport = React.useSyncExternalStore(subscribePanes, getPanesTerminalSize, getPanesTerminalSize);
  const viewportColumns = panesViewport?.conversationColumns ?? columns;
  const text = flattenNoticeText(children);
  const rendered = useUiRenderHost({
    component: 'InfoNotice',
    requestId: `notice:${text}`,
    props: { text, command: command ?? null },
    viewport: { columns: viewportColumns, rows },
  });
  if (rendered.drawPending) {
    return (
      <Box
        ref={rendered.hostRef as React.Ref<DOMElement>}
        flexDirection="column"
        drawPending
        {...(rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
      />
    );
  }
  const shown: React.ReactNode = rendered.props.text === text ? children : String(rendered.props.text ?? '');
  const cmd =
    rendered.props.command === null
      ? undefined
      : typeof rendered.props.command === 'string'
        ? rendered.props.command
        : command;
  const suffix = cmd ? ` · ${cmd}` : '';
  const engine = (
    <Box
      ref={rendered.pluginTree === undefined ? (rendered.hostRef as React.Ref<DOMElement>) : undefined}
      {...(rendered.pluginTree === undefined && rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
    >
      <Text dimColor>
        {shown}
        {suffix}
      </Text>
    </Box>
  );
  if (rendered.pluginTree !== undefined) {
    return (
      <Box
        ref={rendered.hostRef as React.Ref<DOMElement>}
        flexDirection="column"
        {...(rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
      >
        <PluginRenderedTree
          node={rendered.pluginTree}
          plugin={rendered.pluginName}
          requestId={`notice:${text}`}
          component="InfoNotice"
          engine={engine}
        />
      </Box>
    );
  }
  return engine;
}

// Individual notice definitions
const largeMemoryFilesNotice: StatusNoticeDefinition = {
  id: 'large-memory-files',
  tier: 'warning',
  type: 'warning',
  isActive: ctx => getLargeMemoryFiles(ctx.memoryFiles).length > 0,
  render: ctx => {
    const largeMemoryFiles = getLargeMemoryFiles(ctx.memoryFiles);
    return (
      <>
        {largeMemoryFiles.map(file => {
          const displayPath = file.path.startsWith(getCwd()) ? relative(getCwd(), file.path) : file.path;

          return (
            <NoticeStatusRow key={file.path} status="warning">
              <Text bold>{displayPath}</Text> is over the {formatNumber(MAX_MEMORY_CHARACTER_COUNT)}-char limit (
              {formatNumber(file.content.length)} chars)<Text dimColor> · /memory to free up context</Text>
            </NoticeStatusRow>
          );
        })}
      </>
    );
  },
};

const claudeAiSubscriberExternalTokenNotice: StatusNoticeDefinition = {
  id: 'claude-ai-external-token',
  tier: 'warning',
  type: 'warning',
  isActive: () => {
    const authTokenInfo = getAuthTokenSource();
    return (
      isClaudeAISubscriber() &&
      (authTokenInfo.source === 'ANTHROPIC_AUTH_TOKEN' || authTokenInfo.source === 'apiKeyHelper')
    );
  },
  render: () => {
    const authTokenInfo = getAuthTokenSource();
    return (
      <Box marginTop={1}>
        <NoticeStatusRow status="warning">
          {authTokenInfo.source} overriding Claude subscription login
          <Text dimColor> · unset it or /logout to sign it out</Text>
        </NoticeStatusRow>
      </Box>
    );
  },
};

const apiKeyConflictNotice: StatusNoticeDefinition = {
  id: 'api-key-conflict',
  tier: 'warning',
  type: 'warning',
  isActive: () => {
    const { source: apiKeySource } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    });
    return (
      !!getApiKeyFromConfigOrMacOSKeychain() &&
      (apiKeySource === 'ANTHROPIC_API_KEY' || apiKeySource === 'apiKeyHelper')
    );
  },
  render: () => {
    const { source: apiKeySource } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    });
    return (
      <Box marginTop={1}>
        <NoticeStatusRow status="warning">
          {apiKeySource} overriding saved Console key
          <Text dimColor> · unset it or /logout to clear the saved key</Text>
        </NoticeStatusRow>
      </Box>
    );
  },
};

function isActiveProfileCreatedByClaudeCode(): boolean | null {
  try {
    const source = getAnthropicProfileSource();
    if (source === null || source === 'env-quad') return null;
    const configDir = getAnthropicConfigDir();
    if (!configDir) return null;
    const profileName =
      source === 'profile-explicit'
        ? (process.env.ANTHROPIC_PROFILE?.trim() ?? 'default')
        : getActiveAnthropicProfileName(configDir);
    const raw = readFileSync(join(configDir, 'configs', `${profileName}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { created_by?: unknown };
    if (typeof parsed?.created_by === 'string') {
      return parsed.created_by === 'claude-code';
    }
    return false;
  } catch {
    return null;
  }
}

const bothAuthMethodsNotice: StatusNoticeDefinition = {
  id: 'both-auth-methods',
  tier: 'warning',
  type: 'warning',
  isActive: () => {
    const { source: apiKeySource } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    });
    const authTokenInfo = getAuthTokenSource();
    return (
      apiKeySource !== 'none' &&
      authTokenInfo.source !== 'none' &&
      !(apiKeySource === 'apiKeyHelper' && authTokenInfo.source === 'apiKeyHelper')
    );
  },
  render: () => {
    const { source: apiKeySource } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    });
    const authTokenInfo = getAuthTokenSource();
    // Official 2.1.327 (#483): actionable API key vs Anthropic profile conflict warning.
    if (authTokenInfo.source === 'anthropic-profile' || (authTokenInfo.source as string) === 'profile') {
      const settings = getInitialSettings();
      const warning = formatApiKeyProfileConflictWarning({
        apiKeySource,
        profileAuthKind: getAnthropicProfileAuthKind(),
        createdByClaudeCode: isActiveProfileCreatedByClaudeCode(),
        consoleProfileLoginAllowed:
          getAPIProvider() === 'firstParty' &&
          settings.forceLoginOrgUUID === undefined &&
          settings.forceLoginMethod !== 'claudeai',
        hasEnvApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
        forceLoginMethod: settings.forceLoginMethod,
      });
      return (
        <Box flexDirection="column" marginTop={1}>
          <NoticeStatusRow status="warning">{warning.headline}</NoticeStatusRow>
          {warning.switchHint && (
            <Box flexDirection="column" paddingLeft={2}>
              <Text dimColor>{warning.switchHint}</Text>
            </Box>
          )}
        </Box>
      );
    }
    return (
      <Box flexDirection="column" marginTop={1}>
        <NoticeStatusRow status="warning">
          Both {authTokenInfo.source} and {apiKeySource} set · auth may not work as expected
        </NoticeStatusRow>
        <Box flexDirection="column" paddingLeft={2}>
          <Text dimColor>
            · to use {authTokenInfo.source === 'claude.ai' ? 'claude.ai' : authTokenInfo.source}:{' '}
            {apiKeySource === 'ANTHROPIC_API_KEY'
              ? 'Unset the ANTHROPIC_API_KEY environment variable, or claude /logout then say "No" to the API key approval before login.'
              : apiKeySource === 'apiKeyHelper'
                ? 'Unset the apiKeyHelper setting.'
                : 'claude /logout'}
          </Text>
          <Text dimColor>
            · to use {apiKeySource}:{' '}
            {authTokenInfo.source === 'claude.ai'
              ? 'claude /logout to sign out of claude.ai.'
              : `Unset the ${authTokenInfo.source} environment variable.`}
          </Text>
        </Box>
      </Box>
    );
  },
};

const largeAgentDescriptionsNotice: StatusNoticeDefinition = {
  id: 'large-agent-descriptions',
  tier: 'warning',
  type: 'warning',
  isActive: context => {
    const totalTokens = getAgentDescriptionsTotalTokens(context.agentDefinitions);
    return totalTokens > AGENT_DESCRIPTIONS_THRESHOLD;
  },
  render: context => {
    const totalTokens = getAgentDescriptionsTotalTokens(context.agentDefinitions);
    return (
      <NoticeStatusRow status="warning">
        Agent descriptions are over the {formatNumber(AGENT_DESCRIPTIONS_THRESHOLD)}-token limit (~
        {formatNumber(totalTokens)} tokens)
        <Text dimColor> · ask Claude to trim agent descriptions in .claude/agents/</Text>
      </NoticeStatusRow>
    );
  },
};

/**
 * Official Bf @201567134 — startup notice when inbox dir was refused.
 * Gold: "Cross-session messaging is off:" + wZe + debug-file hint.
 */
const crossSessionMessagingOffNotice: StatusNoticeDefinition = {
  id: 'cross-session-messaging-off',
  tier: 'warning',
  type: 'warning',
  isActive: () => getUdsStartFailureCause() === 'socket_dir_refused',
  render: () => (
    <NoticeStatusRow status="warning">
      Cross-session messaging is off: {getUdsStartFailureReason() ?? 'its socket directory could not be set up'}
      <Text dimColor>{' · run with --debug-file <path> for the full log'}</Text>
    </NoticeStatusRow>
  ),
};

function getPromptCachingDisabledVars(): string[] {
  return [
    'DISABLE_PROMPT_CACHING',
    'DISABLE_PROMPT_CACHING_HAIKU',
    'DISABLE_PROMPT_CACHING_OPUS',
    'DISABLE_PROMPT_CACHING_SONNET',
    'DISABLE_PROMPT_CACHING_FABLE',
  ].filter(name => isEnvTruthy(process.env[name]));
}

const promptCachingDisabledNotice: StatusNoticeDefinition = {
  id: 'prompt-caching-disabled',
  tier: 'warning',
  type: 'warning',
  isActive: () => getPromptCachingDisabledVars().length > 0,
  render: () => {
    const vars = getPromptCachingDisabledVars();
    return (
      <NoticeStatusRow status="warning">
        Prompt caching off ({vars.join(', ')}), requests will be slower and cost more
        <Text dimColor> · unset it to re-enable</Text>
      </NoticeStatusRow>
    );
  },
};

const emergencyTipNotice: StatusNoticeDefinition = {
  id: 'emergency-tip',
  tier: 'warning',
  type: 'warning',
  isActive: () => shouldShowEmergencyTip(),
  render: () => <EmergencyTip />,
};

const channelsNotice: StatusNoticeDefinition = {
  id: 'channels',
  tier: 'info',
  type: 'info',
  isActive: () => ChannelsNoticeModule !== null && getAllowedChannels().length > 0,
  render: () => (ChannelsNoticeModule ? <ChannelsNoticeModule.ChannelsNotice /> : null),
};

const debugModeNotice: StatusNoticeDefinition = {
  id: 'debug-mode',
  tier: 'info',
  type: 'info',
  isActive: () => isDebugMode(),
  render: () => (
    <InfoNotice>Debug mode enabled · logging to {isDebugToStdErr() ? 'stderr' : getDebugLogPath()}</InfoNotice>
  ),
};

const tmuxSessionNotice: StatusNoticeDefinition = {
  id: 'tmux-session',
  tier: 'info',
  type: 'info',
  isActive: () => Boolean(process.env.CLAUDE_CODE_TMUX_SESSION),
  render: () => (
    <InfoNotice>
      tmux session: {process.env.CLAUDE_CODE_TMUX_SESSION} · detach with{' '}
      {process.env.CLAUDE_CODE_TMUX_PREFIX_CONFLICTS
        ? `${process.env.CLAUDE_CODE_TMUX_PREFIX} ${process.env.CLAUDE_CODE_TMUX_PREFIX} d (press prefix twice - Claude uses ${process.env.CLAUDE_CODE_TMUX_PREFIX})`
        : `${process.env.CLAUDE_CODE_TMUX_PREFIX} d`}
    </InfoNotice>
  ),
};

const jetbrainsPluginNotice: StatusNoticeDefinition = {
  id: 'jetbrains-plugin-install',
  tier: 'info',
  type: 'info',
  isActive: context => {
    // Only show if running in JetBrains built-in terminal
    if (!isSupportedJetBrainsTerminal()) {
      return false;
    }
    // Don't show if auto-install is disabled
    const shouldAutoInstall = context.config.autoInstallIdeExtension ?? true;
    if (!shouldAutoInstall) {
      return false;
    }
    // Check if plugin is already installed (cached to avoid repeated filesystem checks)
    const ideType = getTerminalIdeType();
    return ideType !== null && !isJetBrainsPluginInstalledCachedSync(ideType);
  },
  render: () => {
    const ideType = getTerminalIdeType();
    const ideName = toIDEDisplayName(ideType);
    return (
      <Box flexDirection="row" gap={1}>
        <Text color="ide">{figures.arrowUp}</Text>
        <Text>
          Install the <Text color="ide">{ideName}</Text> plugin from the JetBrains Marketplace:{' '}
          <Text bold>https://docs.claude.com/s/claude-code-jetbrains</Text>
        </Text>
      </Box>
    );
  },
};

function hasCompanyAnnouncements(): boolean {
  const announcements = getInitialSettings().companyAnnouncements;
  return Boolean(announcements && announcements.some(Boolean));
}

const companyAnnouncementNotice: StatusNoticeDefinition = {
  id: 'company-announcement',
  tier: 'announcement',
  type: 'info',
  promo: false,
  priority: ANNOUNCEMENT_PRIORITY.org,
  isActive: () => hasCompanyAnnouncements(),
  render: ctx => {
    const announcement = pickCompanyAnnouncement(true);
    if (!announcement) return null;
    const orgName = ctx.config.oauthAccount?.organizationName;
    return (
      <Box flexDirection="column">
        {!process.env.IS_DEMO && orgName && <Text dimColor>Message from {orgName}:</Text>}
        <Text>{announcement}</Text>
      </Box>
    );
  },
};

const guestPassesNotice: StatusNoticeDefinition = {
  id: 'guest-passes',
  tier: 'announcement',
  type: 'info',
  promo: true,
  priority: ANNOUNCEMENT_PRIORITY.promo,
  isActive: () => shouldShowGuestPassesUpsell(),
  render: () => <GuestPassesNotice />,
};

// All notice definitions
export const statusNoticeDefinitions: StatusNoticeDefinition[] = [
  largeMemoryFilesNotice,
  largeAgentDescriptionsNotice,
  claudeAiSubscriberExternalTokenNotice,
  apiKeyConflictNotice,
  bothAuthMethodsNotice,
  crossSessionMessagingOffNotice,
  channelsNotice,
  promptCachingDisabledNotice,
  emergencyTipNotice,
  debugModeNotice,
  tmuxSessionNotice,
  jetbrainsPluginNotice,
  companyAnnouncementNotice,
  guestPassesNotice,
];

// Helper functions for external use
export function getActiveNotices(context: StatusNoticeContext): StatusNoticeDefinition[] {
  return statusNoticeDefinitions.filter(notice => notice.isActive(context));
}

const INFO_NOTICE_ORDER = ['debug-mode', 'model-source', 'channels', 'tmux-session'];

function noticeRank(notice: StatusNoticeDefinition): [number, number] {
  const tier = notice.tier ?? (notice.type === 'warning' ? 'warning' : 'info');
  if (tier === 'announcement') {
    const priority = notice.priority ?? 0;
    if (priority >= ANNOUNCEMENT_PRIORITY.org) return [0, -priority];
    if (priority >= ANNOUNCEMENT_PRIORITY.launch) return [1, -priority];
    if (priority >= ANNOUNCEMENT_PRIORITY.campaign) return [2, -priority];
    return [4, -priority];
  }
  const idx = INFO_NOTICE_ORDER.indexOf(notice.id);
  return [3, idx === -1 ? INFO_NOTICE_ORDER.length : idx];
}

export type SelectedStatusNotices = {
  warnings: StatusNoticeDefinition[];
  slot: StatusNoticeDefinition | null;
  slotOverflowCount: number;
};

export function selectNoticesForDisplay(
  notices: readonly StatusNoticeDefinition[],
  options: { suppressPromos?: boolean } = {},
): SelectedStatusNotices {
  const allowed = notices.filter(n => !(n.promo === true && options.suppressPromos));
  const warnings = allowed.filter(n => {
    const tier = n.tier ?? (n.type === 'warning' ? 'warning' : 'info');
    return tier !== 'info' && tier !== 'announcement';
  });
  const candidates = allowed.filter(n => {
    const tier = n.tier ?? (n.type === 'warning' ? 'warning' : 'info');
    return tier === 'info' || tier === 'announcement';
  });

  let winner: StatusNoticeDefinition | null = candidates.find(n => n.claimsFirstShow?.() === true) ?? null;
  if (winner === null) {
    for (const candidate of candidates) {
      if (winner === null) {
        winner = candidate;
        continue;
      }
      const [candGroup, candSub] = noticeRank(candidate);
      const [winGroup, winSub] = noticeRank(winner);
      if (candGroup < winGroup || (candGroup === winGroup && candSub < winSub)) {
        winner = candidate;
      }
    }
  }

  return {
    warnings,
    slot: winner,
    slotOverflowCount: winner === null ? 0 : candidates.length - 1,
  };
}
