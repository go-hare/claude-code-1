/**
 * Miscellaneous subcommand handlers — extracted from main.tsx for lazy loading.
 * setup-token, doctor, install
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import chalk from 'chalk';
import { cwd } from 'process';
import React from 'react';
import { WelcomeV2 } from '../../components/LogoV2/WelcomeV2.js';
import type { Root } from '@anthropic/ink';
import { Box, Text } from '@anthropic/ink';
import { isSelfHostedBridge } from '../../bridge/bridgeConfig.js';
import {
  getBridgeDisabledReason,
  getBridgeDisabledReasonForCloudSession,
  isPaidPlanNoTelemetryBridgeFallback,
} from '../../bridge/bridgeEnabled.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { checkGate_CACHED_OR_BLOCKING, isGrowthBookEnabled } from '../../services/analytics/growthbook.js';
import { logEvent } from '../../services/analytics/index.js';
import {
  isPolicyLimitsEligible,
  isRemotePolicyAllowed,
  waitForPolicyLimitsToLoad,
} from '../../services/policyLimits/index.js';
import { AppStateProvider } from '../../state/AppState.js';
import { onChangeAppState } from '../../state/onChangeAppState.js';
import { getAllBaseTools } from '../../tools.js';
import {
  getOauthAccountInfo,
  hasProfileScope,
  isAnthropicAuthEnabled,
  isClaudeAISubscriber,
} from '../../utils/auth.js';
import { formatAutoUpdatesChannelDisplay } from '../../utils/autoUpdater.js';
import { getModelMaxOutputTokens } from '../../utils/context.js';
import { type DiagnosticInfo, getDoctorDiagnostic } from '../../utils/doctorDiagnostic.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { validateBoundedIntEnvVar } from '../../utils/envValidation.js';
import { getFsImplementation } from '../../utils/fsOperations.js';
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from '../../utils/model/providers.js';
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js';
import { loadAllPermissionRulesFromDisk } from '../../utils/permissions/permissionsLoader.js';
import { getSettingsWithAllErrors } from '../../utils/settings/allErrors.js';
import { getManagedFilePath, getManagedSettingsDropInDir } from '../../utils/settings/managedPath.js';
import { validatePermissionRule } from '../../utils/settings/permissionValidation.js';
import {
  formatRemoteSettingsFailureReason,
  getRemoteSettingsLoadStatus,
  type RemoteSettingsLoadStatus,
} from '../../utils/settings/remoteSettingsState.js';
import {
  formatManagedDocumentLinkWarning,
  getInitialSettings,
  inspectManagedDocumentLink,
} from '../../utils/settings/settings.js';
import type { ValidationError } from '../../utils/settings/validation.js';
import { BASH_MAX_OUTPUT_DEFAULT, BASH_MAX_OUTPUT_UPPER_LIMIT } from '../../utils/shell/outputLimits.js';
import { plural } from '../../utils/stringUtils.js';
import { formatLastUpdateResult } from '../../utils/updateResult.js';
import { formatCliSuccess, formatCliWarning } from '../cliStatusMarkers.js';
import { leftoverPolicyLimitsHost, type PolicyLimitsFetchOutcome } from '../leftoverTulip.js';

export async function setupTokenHandler(root: Root): Promise<void> {
  logEvent('tengu_setup_token_command', {});

  // densable Stt(!0) — setup-token is always claude.ai / subscription long-lived token
  const { SETUP_TOKEN_FORCE_LOGIN_REFUSED_SUFFIX, validateForcedLoginMethod } = await import(
    '../../utils/forceLoginMethod.js'
  );
  const pin = validateForcedLoginMethod(true);
  if (!pin.valid) {
    root.unmount();
    process.stderr.write(`${pin.message}\n${SETUP_TOKEN_FORCE_LOGIN_REFUSED_SUFFIX}\n`);
    logEvent('tengu_cli_setup_token_force_login_method_refused', {});
    process.exit(1);
  }

  const showAuthWarning = !isAnthropicAuthEnabled();
  const { ConsoleOAuthFlow } = await import('../../components/ConsoleOAuthFlow.js');
  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider onChangeAppState={onChangeAppState}>
        <KeybindingSetup>
          <Box flexDirection="column" gap={1}>
            <WelcomeV2 />
            {showAuthWarning && (
              <Box flexDirection="column">
                <Text color="warning">
                  Warning: You already have authentication configured via environment variable or API key helper.
                </Text>
                <Text color="warning">
                  The setup-token command will create a new OAuth token which you can use instead.
                </Text>
              </Box>
            )}
            <ConsoleOAuthFlow
              onDone={() => {
                void resolve();
              }}
              mode="setup-token"
              startingMessage="This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude subscription required."
              urlOutdent={1}
            />
          </Box>
        </KeybindingSetup>
      </AppStateProvider>,
    );
  });
  root.unmount();
  process.exit(0);
}

function sanitizeLineText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replaceAll('`', '');
}

const DOCTOR_POLICY_WAIT_MS = 3000;

function resolveBuildGitSha(): string {
  return typeof MACRO !== 'undefined' && typeof MACRO.GIT_SHA === 'string' && MACRO.GIT_SHA.length > 0
    ? MACRO.GIT_SHA
    : '';
}

/**
 * Official 2.1.328 `TGt` (`chunk@304771569.js:615`) — split non-MCP settings errors
 * into `statusNotices` (`statusOnly: true`) and `invalidEntries`.
 */
export function partitionDoctorSettingsErrors(errors: readonly ValidationError[]): {
  statusNotices: ValidationError[];
  invalidEntries: ValidationError[];
} {
  const statusNotices: ValidationError[] = [];
  const invalidEntries: ValidationError[] = [];
  for (const err of errors) {
    if (err.mcpErrorMetadata !== undefined) continue;
    if ((err as ValidationError & { statusOnly?: boolean }).statusOnly) {
      statusNotices.push(err);
    } else {
      invalidEntries.push(err);
    }
  }
  return { statusNotices, invalidEntries };
}

/**
 * Official 2.1.328 `Lco` (`chunk@286370035.js:546590`) — format `Managed settings (remote)` line value.
 */
export function formatRemoteSettingsDoctorStatus(
  status: RemoteSettingsLoadStatus | undefined,
  opts?: { provider?: string; isFirstPartyBaseUrl?: boolean; fetchInProgress?: boolean },
): string | null {
  if (status) {
    switch (status.state) {
      case 'ok':
        return status.hasSettings ? 'loaded' : 'none configured for this organization';
      case 'stale_cache': {
        const reason = formatRemoteSettingsFailureReason(status.failure.errorKind, status.failure.httpStatus);
        const withheld = status.transportEnvWithheld ? '; proxy/CA/provider env withheld until a fetch succeeds' : '';
        return `fetch failed — using stale cache (${reason})${withheld}`;
      }
      case 'failed': {
        const reason = formatRemoteSettingsFailureReason(status.failure.errorKind, status.failure.httpStatus);
        const policyPart = status.restrictionsOnly ? "the stale cache's restrictions still apply" : 'no policy applied';
        const logoutHint = status.restrictionsOnly
          ? '; to clear them, run `claude auth logout` (signs out of all accounts)'
          : '';
        return `fetch failed — ${policyPart} (${reason})${logoutHint}`;
      }
      case 'ineligible':
        return 'not fetched — not available for this account';
    }
  }
  if (opts?.fetchInProgress) {
    return 'checking… (fetch in progress; re-run in a moment)';
  }
  const provider = opts?.provider ?? getAPIProvider();
  if (provider !== 'firstParty') {
    return 'not fetched — not available on Bedrock/Vertex/third-party providers';
  }
  const isFirstPartyBase = opts?.isFirstPartyBaseUrl ?? isFirstPartyAnthropicBaseUrl();
  if (!isFirstPartyBase) {
    return 'not fetched — not available with a custom ANTHROPIC_BASE_URL';
  }
  return null;
}

/**
 * Official 2.1.328 `Dso(Mso())` (`chunk@292269740.js:12531`) — format `Organization policy` line value.
 */
export function formatOrgPolicyDoctorStatus(opts?: {
  provider?: string;
  isFirstPartyBaseUrl?: boolean;
  eligible?: boolean;
  lastFetchOutcome?: PolicyLimitsFetchOutcome | null;
  hasSessionCache?: boolean;
  sessionFromServerFetch?: boolean;
}): string {
  const provider = opts?.provider ?? getAPIProvider();
  if (provider !== 'firstParty') {
    return "not fetched: this session doesn't connect to the Anthropic API directly (Bedrock, Vertex, Foundry, or a gateway)";
  }
  const isFirstPartyBase = opts?.isFirstPartyBaseUrl ?? isFirstPartyAnthropicBaseUrl();
  if (!isFirstPartyBase) {
    return 'not fetched with a custom ANTHROPIC_BASE_URL';
  }
  const host = leftoverPolicyLimitsHost();
  const outcome = opts?.lastFetchOutcome !== undefined ? opts.lastFetchOutcome : host.lastFetchOutcome;
  const hasCache = opts?.hasSessionCache ?? host.sessionCache !== null;
  const fromServer = opts?.sessionFromServerFetch ?? host.sessionFromServerFetch;
  const eligible = opts?.eligible ?? isPolicyLimitsEligible();

  if (outcome !== null) {
    if (outcome.success) {
      return 'Loaded from api.anthropic.com';
    }
    const retrying = outcome.retrying ? ' yet, still retrying' : '';
    const detail = [outcome.errorCode, outcome.httpStatus ? `HTTP ${outcome.httpStatus}` : undefined]
      .filter(Boolean)
      .join(' ');
    const detailSuffix = detail ? ` · ${detail}` : '';
    if (hasCache) {
      return `Couldn't refresh${retrying} · using the last copy on this machine${detailSuffix}`;
    }
    return `Couldn't load${retrying} · no restrictions applied this session${detailSuffix}`;
  }
  if (!eligible) {
    return 'not fetched — account is not eligible for organization policy';
  }
  if (hasCache && !fromServer) {
    return 'Using the copy on disk · not refreshed yet this session';
  }
  return 'Not loaded yet · if this persists, check your network or proxy';
}

export type RemoteControlDoctorCheck = {
  label: string;
  ok: boolean;
  detail?: string;
};

export type RemoteControlDoctorInfo = {
  inRemoteSession: boolean;
  disabledReason: string | null;
  checks: RemoteControlDoctorCheck[];
};

/**
 * Official 2.1.328 `Rdi` (`chunk@292164095.js:11509`) — format Remote Control
 * doctor block lines.
 */
export function formatRemoteControlDoctorLines(info: RemoteControlDoctorInfo): string[] {
  const lines: string[] = ['', 'Remote Control'];
  if (info.inRemoteSession) {
    lines.push('Inside a cloud session — Remote Control is unavailable here. Use it from the local session instead.');
    return lines;
  }
  lines.push(
    sanitizeLineText(info.disabledReason ?? 'Control this session from claude.ai/code or the Claude mobile app'),
  );
  for (const check of info.checks) {
    if (!check.ok) {
      lines.push(sanitizeLineText(`- ${check.label}${check.detail ? ` (${check.detail})` : ''}`));
    }
  }
  return lines;
}

/**
 * Official 2.1.328 `TOr` (`chunk@304772480.js:683`) — collect permission rules
 * from disk that may not work as written (unknown tool names or validation warnings).
 */
export function collectPermissionRuleDoctorAdvisories(): string[] {
  try {
    const rules = loadAllPermissionRulesFromDisk();
    const knownToolNames = new Set(getAllBaseTools().map(t => t.name));
    const advisories = new Set<string>();
    for (const rule of rules) {
      if (rule.source === 'session') continue;
      const ruleStr = permissionRuleValueToString(rule.ruleValue);
      const { toolName } = rule.ruleValue;
      const validation = validatePermissionRule(ruleStr, rule.ruleBehavior);
      if (validation.warning) {
        advisories.add(`${ruleStr}: ${validation.warning}`);
      } else if (validation.securityNotice) {
        advisories.add(`${ruleStr}: ${validation.securityNotice}`);
      } else if (!validation.valid && validation.error) {
        advisories.add(`${ruleStr}: ${validation.error}`);
      } else if (
        (rule.ruleBehavior === 'deny' || rule.ruleBehavior === 'ask') &&
        !toolName.startsWith('mcp__') &&
        !toolName.includes('_') &&
        !knownToolNames.has(toolName)
      ) {
        advisories.add(`Permission ${rule.ruleBehavior} rule "${ruleStr}" matches no known tool — check for typos.`);
      }
    }
    return Array.from(advisories);
  } catch {
    return [];
  }
}

/**
 * Official 2.1.328 `wyr` (`chunk@284607801.js:110393`) — collect managed document
 * symlink warnings (outside or unverified links in managed-settings.json / .d).
 */
function collectManagedLinkDoctorWarnings(): Array<[string, string]> {
  const warnings: Array<[string, string]> = [];
  try {
    const managedDir = getManagedFilePath();
    const baseLink = inspectManagedDocumentLink(managedDir, ['managed-settings.json']);
    if (baseLink) {
      const msg = formatManagedDocumentLinkWarning(baseLink, true);
      if (msg) warnings.push(msg);
    }
    const dropInDir = getManagedSettingsDropInDir();
    try {
      const entries = getFsImplementation()
        .readdirSync(dropInDir)
        .filter(d => (d.isFile() || d.isSymbolicLink()) && d.name.endsWith('.json') && !d.name.startsWith('.'))
        .map(d => d.name)
        .sort();
      for (const name of entries) {
        const dropLink = inspectManagedDocumentLink(managedDir, ['managed-settings.d', name]);
        if (dropLink) {
          const msg = formatManagedDocumentLinkWarning(dropLink, true);
          if (msg) warnings.push(msg);
        }
      }
    } catch {
      // drop-in directory may not exist
    }
  } catch {
    // non-fatal
  }
  return warnings;
}

async function collectRemoteControlDoctorInfo(): Promise<RemoteControlDoctorInfo> {
  if (getBridgeDisabledReasonForCloudSession() !== null && !isSelfHostedBridge()) {
    return { inRemoteSession: true, disabledReason: null, checks: [] };
  }
  const disabledReason = await getBridgeDisabledReason();
  const selfHosted = isSelfHostedBridge();
  const onAnthropicApi = selfHosted || (getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl());
  const notDisabledByOrg = getInitialSettings()?.disableRemoteControl !== true;
  const subscriber = selfHosted || isClaudeAISubscriber();
  const profileScope = selfHosted || hasProfileScope();
  const hasOrg = selfHosted || Boolean(getOauthAccountInfo()?.organizationUuid);
  const orgPolicyAllowed = selfHosted || isRemotePolicyAllowed('allow_remote_control');
  const paidFallback = isPaidPlanNoTelemetryBridgeFallback();
  const gbEnabled = isGrowthBookEnabled();
  const bridgeGate = selfHosted || paidFallback || (await checkGate_CACHED_OR_BLOCKING('tengu_ccr_bridge'));

  const checks: RemoteControlDoctorCheck[] = [
    {
      label: onAnthropicApi
        ? 'Connected to the Anthropic API (api.anthropic.com)'
        : 'Not connected to the Anthropic API (api.anthropic.com)',
      ok: onAnthropicApi,
    },
    {
      label: notDisabledByOrg
        ? 'Not disabled by org policy (disableRemoteControl)'
        : 'Disabled by org policy (disableRemoteControl)',
      ok: notDisabledByOrg,
    },
    {
      label: subscriber ? 'claude.ai subscription active' : 'claude.ai subscription auth not active',
      ok: subscriber,
    },
    {
      label: profileScope ? 'Sign-in includes the user:profile scope' : 'Sign-in is missing the user:profile scope',
      ok: profileScope,
    },
    {
      label: hasOrg ? 'Organization found' : 'Organization not found',
      ok: hasOrg,
    },
    {
      label: orgPolicyAllowed
        ? 'Org policy allows Remote Control (allow_remote_control)'
        : 'Org policy does not allow Remote Control (allow_remote_control)',
      ok: orgPolicyAllowed,
    },
    {
      label: gbEnabled ? 'Feature-flag evaluation enabled' : 'Feature-flag evaluation disabled',
      ok: gbEnabled || paidFallback,
    },
    {
      label: bridgeGate ? 'Remote Control enabled for this account' : 'Remote Control not enabled for this account',
      ok: bridgeGate,
      detail: paidFallback ? 'decided from your plan, feature flags are off' : undefined,
    },
  ];
  return { inRemoteSession: false, disabledReason, checks };
}

/**
 * Pure summary header lines for `claude doctor` (aligned with official 2.1.328 `HTl`).
 */
export function formatDoctorSummaryLines(
  diagnostic: DiagnosticInfo,
  channel: string | undefined,
  gitSha: string = resolveBuildGitSha(),
): string[] {
  return [
    'Claude Code doctor',
    '',
    `Running: ${diagnostic.installationType} (${diagnostic.version})`,
    ...(gitSha ? [`Commit: ${sanitizeLineText(gitSha.slice(0, 12))}`] : []),
    `Platform: ${process.platform}-${process.arch}`,
    ...(diagnostic.packageManager ? [`Package manager: ${sanitizeLineText(diagnostic.packageManager)}`] : []),
    `Path: ${sanitizeLineText(diagnostic.installationPath)}`,
    ...(diagnostic.invokedBinary !== diagnostic.installationPath
      ? [`Invoked: ${sanitizeLineText(diagnostic.invokedBinary)}`]
      : []),
    `Config install method: ${sanitizeLineText(String(diagnostic.configInstallMethod))}`,
    `Search: ${diagnostic.ripgrepStatus.working ? 'OK' : 'Not working'} (${diagnostic.ripgrepStatus.mode === 'embedded' || diagnostic.ripgrepStatus.mode === 'builtin' ? 'bundled' : sanitizeLineText(diagnostic.ripgrepStatus.systemPath || 'system')})`,
    `Auto-updates: ${diagnostic.packageManager ? 'Managed by package manager' : sanitizeLineText(diagnostic.autoUpdates)}`,
    `Auto-update channel: ${formatAutoUpdatesChannelDisplay(channel)}`,
    `Last update attempt: ${formatLastUpdateResult(diagnostic.lastUpdateResult)}`,
  ];
}

export function formatDoctorDiagnosticSections(input: {
  diagnostic: DiagnosticInfo;
  channel: string | undefined;
  gitSha?: string;
  remoteSettingsLine?: string | null;
  orgPolicyLine?: string;
  settingsErrors: readonly ValidationError[];
  permissionRuleAdvisories?: readonly string[];
  linkWarnings?: ReadonlyArray<[string, string]>;
  envIssues: ReadonlyArray<{ name: string; status: string; message?: string }>;
  remoteControl?: RemoteControlDoctorInfo | null;
  interactiveTty?: boolean;
}): string[] {
  const {
    diagnostic,
    channel,
    gitSha,
    remoteSettingsLine,
    orgPolicyLine,
    settingsErrors,
    permissionRuleAdvisories = [],
    linkWarnings = [],
    envIssues,
    remoteControl,
    interactiveTty,
  } = input;

  const lines: string[] = formatDoctorSummaryLines(diagnostic, channel, gitSha);

  if (remoteSettingsLine) {
    lines.push(`Managed settings (remote): ${sanitizeLineText(remoteSettingsLine)}`);
  }
  if (orgPolicyLine) {
    lines.push(`Organization policy: ${sanitizeLineText(orgPolicyLine)}`);
  }

  const { statusNotices, invalidEntries } = partitionDoctorSettingsErrors(settingsErrors);
  if (invalidEntries.length > 0) {
    lines.push('', chalk.yellow(formatCliWarning('Invalid settings', '', interactiveTty)));
    for (const err of invalidEntries) {
      const loc = [err.file, err.path].flatMap(part => (part ? [sanitizeLineText(part)] : [])).join(' › ');
      const suggested = err.suggestion ? `\n  Suggested fix: ${sanitizeLineText(err.suggestion)}` : '';
      lines.push(`- ${loc ? `${loc}: ` : ''}${sanitizeLineText(err.message)}${suggested}`);
    }
  }
  if (statusNotices.length > 0) {
    lines.push('');
    for (const notice of statusNotices) {
      lines.push(`- ${sanitizeLineText(notice.message)}`);
    }
  }

  if (permissionRuleAdvisories.length > 0) {
    lines.push('', chalk.yellow(formatCliWarning('Permission rules that may not work as written', '', interactiveTty)));
    for (const advisory of permissionRuleAdvisories) {
      lines.push(`- ${sanitizeLineText(advisory)}`);
    }
  }

  const invalidMessages = new Set(invalidEntries.map(e => sanitizeLineText(e.message)));
  const uniqueLinkWarnings = linkWarnings.filter(([title]) => !invalidMessages.has(sanitizeLineText(title)));
  if (uniqueLinkWarnings.length > 0) {
    lines.push('');
    for (const [title, detail] of uniqueLinkWarnings) {
      lines.push(`- ${sanitizeLineText(title)}\n  ${sanitizeLineText(detail)}`);
    }
  }

  if (envIssues.length > 0) {
    lines.push('', chalk.yellow(formatCliWarning('Environment variables', '', interactiveTty)));
    for (const issue of envIssues) {
      lines.push(`- ${issue.name}: ${sanitizeLineText(issue.message ?? issue.status)}`);
    }
  }

  if (diagnostic.multipleInstallations.length > 1) {
    lines.push('', chalk.yellow(formatCliWarning('Multiple installations found', '', interactiveTty)));
    for (const inst of diagnostic.multipleInstallations) {
      lines.push(`- ${sanitizeLineText(`${inst.type} at ${inst.path}`)}`);
    }
  }

  if (remoteControl) {
    lines.push(...formatRemoteControlDoctorLines(remoteControl));
  }

  if (diagnostic.warnings.length > 0) {
    lines.push(
      '',
      chalk.yellow(
        formatCliWarning(
          `${diagnostic.warnings.length} ${plural(diagnostic.warnings.length, 'warning')} found`,
          '',
          interactiveTty,
        ),
      ),
    );
    for (const warning of diagnostic.warnings) {
      lines.push(`- ${sanitizeLineText(warning.issue)}`, `  Fix: ${sanitizeLineText(warning.fix)}`);
    }
  } else {
    lines.push('', formatCliSuccess('No installation issues found.', '', interactiveTty));
  }

  lines.push('', 'For a full setup checkup that can also fix issues, run /doctor in a Claude Code session.');
  return lines;
}

export async function doctorHandler(root?: Root): Promise<void> {
  logEvent('tengu_doctor_command', {});
  root?.unmount();

  const diagnostic = await getDoctorDiagnostic();
  const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest';

  // Wait briefly for policy limits fetch if in flight (official HTl bounded wait).
  if (leftoverPolicyLimitsHost().lastFetchOutcome === null) {
    await Promise.race([
      waitForPolicyLimitsToLoad().catch(() => {}),
      new Promise<void>(resolve => setTimeout(resolve, DOCTOR_POLICY_WAIT_MS)),
    ]);
  }

  const remoteSettingsLine = formatRemoteSettingsDoctorStatus(getRemoteSettingsLoadStatus());
  const { errors: settingsErrors } = getSettingsWithAllErrors();
  const permissionRuleAdvisories = collectPermissionRuleDoctorAdvisories();
  const linkWarnings = collectManagedLinkDoctorWarnings();

  const maxOutputTokensSpec = getModelMaxOutputTokens('claude-opus-4-6');
  const envIssues = [
    {
      name: 'BASH_MAX_OUTPUT_LENGTH',
      default: BASH_MAX_OUTPUT_DEFAULT,
      upperLimit: BASH_MAX_OUTPUT_UPPER_LIMIT,
    },
    {
      name: 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
      default: maxOutputTokensSpec.default,
      upperLimit: maxOutputTokensSpec.upperLimit,
    },
  ]
    .map(spec => ({
      name: spec.name,
      ...validateBoundedIntEnvVar(spec.name, process.env[spec.name], spec.default, spec.upperLimit),
    }))
    .filter(item => item.status !== 'valid');

  let remoteControl: RemoteControlDoctorInfo | null = null;
  try {
    remoteControl = await collectRemoteControlDoctorInfo();
  } catch {
    // Non-fatal: bridge info unavailable
  }

  const orgPolicyLine = formatOrgPolicyDoctorStatus();

  const lines = formatDoctorDiagnosticSections({
    diagnostic,
    channel,
    remoteSettingsLine,
    orgPolicyLine,
    settingsErrors,
    permissionRuleAdvisories,
    linkWarnings,
    envIssues,
    remoteControl,
  });

  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
}

// install handler
export async function installHandler(target: string | undefined, options: { force?: boolean }): Promise<void> {
  if (isEnvTruthy(process.env.DISABLE_UPDATES)) {
    process.stdout.write(
      'Updates are disabled by your administrator. Contact your IT team to get the latest version.\n',
    );
    process.exit(0);
    return;
  }
  const { setup } = await import('../../setup.js');
  await setup(cwd(), 'default', false, false, undefined, false);
  const { install } = await import('../../commands/install.js');
  await new Promise<void>(resolve => {
    const args: string[] = [];
    if (target) args.push(target);
    if (options.force) args.push('--force');

    void install.call(
      result => {
        void resolve();
        process.exit(result.includes('failed') ? 1 : 0);
      },
      {},
      args,
    );
  });
}
