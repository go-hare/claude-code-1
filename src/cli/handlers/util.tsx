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
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { logEvent } from '../../services/analytics/index.js';
import { AppStateProvider } from '../../state/AppState.js';
import { onChangeAppState } from '../../state/onChangeAppState.js';
import { isAnthropicAuthEnabled } from '../../utils/auth.js';
import { getModelMaxOutputTokens } from '../../utils/context.js';
import { getDoctorDiagnostic } from '../../utils/doctorDiagnostic.js';
import { validateBoundedIntEnvVar } from '../../utils/envValidation.js';
import { getSettingsWithAllErrors } from '../../utils/settings/allErrors.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { BASH_MAX_OUTPUT_DEFAULT, BASH_MAX_OUTPUT_UPPER_LIMIT } from '../../utils/shell/outputLimits.js';
import { plural } from '../../utils/stringUtils.js';
import { type LastUpdateResult, loadLastUpdateResult } from '../../utils/updateResult.js';

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

function formatLastUpdateAttempt(result: LastUpdateResult | null): string {
  if (!result) return 'none recorded';
  const datePart = sanitizeLineText(result.timestamp.slice(0, 10));
  if (result.success) {
    return result.toVersion ? `success → ${sanitizeLineText(result.toVersion)} (${datePart})` : `success (${datePart})`;
  }
  return `failed (${sanitizeLineText(result.error ?? 'unknown')}) — ${datePart}`;
}

export async function doctorHandler(root?: Root): Promise<void> {
  logEvent('tengu_doctor_command', {});
  root?.unmount();

  const [diagnostic, lastUpdate] = await Promise.all([getDoctorDiagnostic(), loadLastUpdateResult()]);
  const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest';

  const lines: string[] = [
    'Claude Code doctor',
    '',
    `Running: ${diagnostic.installationType} (${diagnostic.version})`,
    `Platform: ${process.platform}-${process.arch}`,
    ...(diagnostic.packageManager ? [`Package manager: ${sanitizeLineText(diagnostic.packageManager)}`] : []),
    `Path: ${sanitizeLineText(diagnostic.installationPath)}`,
    ...(diagnostic.invokedBinary !== diagnostic.installationPath
      ? [`Invoked: ${sanitizeLineText(diagnostic.invokedBinary)}`]
      : []),
    `Config install method: ${sanitizeLineText(String(diagnostic.configInstallMethod))}`,
    `Search: ${diagnostic.ripgrepStatus.working ? 'OK' : 'Not working'} (${diagnostic.ripgrepStatus.mode === 'embedded' || diagnostic.ripgrepStatus.mode === 'builtin' ? 'bundled' : sanitizeLineText(diagnostic.ripgrepStatus.systemPath || 'system')})`,
    `Auto-updates: ${diagnostic.packageManager ? 'Managed by package manager' : sanitizeLineText(diagnostic.autoUpdates)}`,
    `Auto-update channel: ${channel}`,
    `Last update attempt: ${formatLastUpdateAttempt(lastUpdate)}`,
  ];

  const { errors: settingsErrors } = getSettingsWithAllErrors();
  const nonMcpSettingsErrors = settingsErrors.filter(err => err.mcpErrorMetadata === undefined);
  if (nonMcpSettingsErrors.length > 0) {
    lines.push('', chalk.yellow('Invalid settings'));
    for (const err of nonMcpSettingsErrors) {
      const loc = [err.file, err.path].flatMap(part => (part ? [sanitizeLineText(part)] : [])).join(' › ');
      const suggested = err.suggestion ? `\n  Suggested fix: ${sanitizeLineText(err.suggestion)}` : '';
      lines.push(`- ${loc ? `${loc}: ` : ''}${sanitizeLineText(err.message)}${suggested}`);
    }
  }

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

  if (envIssues.length > 0) {
    lines.push('', chalk.yellow('Environment variables'));
    for (const issue of envIssues) {
      lines.push(`- ${issue.name}: ${sanitizeLineText(issue.message ?? issue.status)}`);
    }
  }

  if (diagnostic.multipleInstallations.length > 1) {
    lines.push('', chalk.yellow('Multiple installations found'));
    for (const inst of diagnostic.multipleInstallations) {
      lines.push(`- ${sanitizeLineText(`${inst.type} at ${inst.path}`)}`);
    }
  }

  if (diagnostic.warnings.length > 0) {
    lines.push(
      '',
      chalk.yellow(`${diagnostic.warnings.length} ${plural(diagnostic.warnings.length, 'warning')} found`),
    );
    for (const warning of diagnostic.warnings) {
      lines.push(`- ${sanitizeLineText(warning.issue)}`, `  Fix: ${sanitizeLineText(warning.fix)}`);
    }
  } else {
    lines.push('', 'No installation issues found.');
  }

  lines.push('', 'For a full setup checkup that can also fix issues, run /doctor in a Claude Code session.');
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
}

// install handler
export async function installHandler(target: string | undefined, options: { force?: boolean }): Promise<void> {
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
