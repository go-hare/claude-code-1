import { homedir } from 'os';
import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { setSessionTrustAccepted } from '../../bootstrap/state.js';
import type { Command } from '../../commands.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Link, Text } from '@anthropic/ink';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getMcpConfigsByScope } from '../../services/mcp/config.js';
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js';
import { checkHasTrustDialogAccepted, saveCurrentProjectConfig } from '../../utils/config.js';
import { getCwd } from '../../utils/cwd.js';
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { ConfirmSelect, ConfirmSelectHint } from '../ConfirmSelect.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
import {
  ACCESSING_CANCEL_LABEL,
  ACCESSING_CAPABILITY,
  ACCESSING_CONFIRM_LABEL,
  ACCESSING_HEADERS_HELPER_PREFIX,
  ACCESSING_HEADERS_HELPER_TRUST_NOTE,
  ACCESSING_QUICK_SAFETY_CHECK,
  ACCESSING_WORKSPACE_TITLE,
} from './trustDialogCopy.js';
import {
  formatEnglishSourceList,
  getProjectAddDirsDisclosure,
  getProjectAllowDisclosure,
  getApiKeyHelperSources,
  getAwsCommandsSources,
  getBashPermissionSources,
  getDangerousEnvVarsSources,
  getGcpCommandsSources,
  getHooksSources,
  getMarketplaceHelperSources,
  getOtelHeadersHelperSources,
  getRepoHeadersHelperSources,
} from './utils.js';

type Props = {
  onDone(): void;
  commands?: Command[];
};

export function TrustDialog({ onDone, commands }: Props): React.ReactNode {
  const { servers: projectServers } = getMcpConfigsByScope('project');

  // In all cases, we generally check only the project-level and
  // project-local-level settings, which we assume that users do not configure
  // directly compared to user-level settings.

  // Check for MCPs
  const hasMcpServers = Object.keys(projectServers).length > 0;
  // Check for hooks
  const hooksSettingSources = getHooksSources();
  const hasHooks = hooksSettingSources.length > 0;
  // Check whether code execution is allowed in permissions and slash commands
  const bashSettingSources = getBashPermissionSources();
  // Check for apiKeyHelper which executes arbitrary commands
  const apiKeyHelperSources = getApiKeyHelperSources();
  const hasApiKeyHelper = apiKeyHelperSources.length > 0;
  // Check for AWS commands which execute arbitrary commands
  const awsCommandsSources = getAwsCommandsSources();
  const hasAwsCommands = awsCommandsSources.length > 0;
  // Check for GCP commands which execute arbitrary commands
  const gcpCommandsSources = getGcpCommandsSources();
  const hasGcpCommands = gcpCommandsSources.length > 0;
  // Check for otelHeadersHelper which executes arbitrary commands
  const otelHeadersHelperSources = getOtelHeadersHelperSources();
  const hasOtelHeadersHelper = otelHeadersHelperSources.length > 0;
  // Check for dangerous environment variables (not in SAFE_ENV_VARS)
  const dangerousEnvVarsSources = getDangerousEnvVarsSources();
  const hasDangerousEnvVars = dangerousEnvVarsSources.length > 0;
  // densable 2.1.238 SEA aRs/sRs — marketplace + MCP headersHelper disclosure
  const marketplaceHelperSources = getMarketplaceHelperSources();
  const repoHelperSources = getRepoHeadersHelperSources(marketplaceHelperSources);
  const hasMarketplaceHeadersHelper = marketplaceHelperSources.length > 0;
  const hasRepoHeadersHelpers = repoHelperSources.length > 0;
  const allowDisclosure = getProjectAllowDisclosure();
  const addDirsDisclosure = getProjectAddDirsDisclosure();

  const hasSlashCommandBash =
    commands?.some(
      command =>
        command.type === 'prompt' &&
        command.loadedFrom === 'commands_DEPRECATED' &&
        (command.source === 'projectSettings' || command.source === 'localSettings') &&
        command.allowedTools?.some((tool: string) => tool === BASH_TOOL_NAME || tool.startsWith(BASH_TOOL_NAME + '(')),
    ) ?? false;

  const hasSkillsBash =
    commands?.some(
      command =>
        command.type === 'prompt' &&
        (command.loadedFrom === 'skills' || command.loadedFrom === 'plugin') &&
        (command.source === 'projectSettings' || command.source === 'localSettings' || command.source === 'plugin') &&
        command.allowedTools?.some((tool: string) => tool === BASH_TOOL_NAME || tool.startsWith(BASH_TOOL_NAME + '(')),
    ) ?? false;

  const hasAnyBashExecution = bashSettingSources.length > 0 || hasSlashCommandBash || hasSkillsBash;

  const hasTrustDialogAccepted = checkHasTrustDialogAccepted();
  const [pendingExitCode, setPendingExitCode] = React.useState<number | null>(null);

  // When a non-null exit code is set, render null (clear screen) first,
  // then trigger shutdown in the next tick so Ink has time to flush
  // the empty frame before cleanupTerminalModes() unmounts and exits
  // the alt screen. Without this deferral, gracefulShutdownSync starts
  // async cleanup immediately after React commit, racing the reconciler
  // and leaving residual TrustDialog output on the terminal.
  React.useEffect(() => {
    if (pendingExitCode !== null) {
      const code = pendingExitCode;
      const timer = setTimeout(() => gracefulShutdownSync(code));
      return () => clearTimeout(timer);
    }
  }, [pendingExitCode]);

  React.useEffect(() => {
    const isHomeDir = homedir() === getCwd();
    logEvent('tengu_trust_dialog_shown', {
      isHomeDir,
      hasMcpServers,
      hasHooks,
      hasBashExecution: hasAnyBashExecution,
      hasApiKeyHelper,
      hasAwsCommands,
      hasGcpCommands,
      hasOtelHeadersHelper,
      hasMarketplaceHeadersHelper,
      hasRepoHeadersHelpers,
      hasDangerousEnvVars,
    });
  }, [
    hasMcpServers,
    hasHooks,
    hasAnyBashExecution,
    hasApiKeyHelper,
    hasAwsCommands,
    hasGcpCommands,
    hasOtelHeadersHelper,
    hasMarketplaceHeadersHelper,
    hasRepoHeadersHelpers,
    hasDangerousEnvVars,
  ]);

  function onChange(value: 'enable_all' | 'exit') {
    if (value === 'exit') {
      gracefulShutdownSync(1);
      return;
    }

    const isHomeDir = homedir() === getCwd();

    logEvent('tengu_trust_dialog_accept', {
      isHomeDir,
      hasMcpServers,
      hasHooks,
      hasBashExecution: hasAnyBashExecution,
      hasApiKeyHelper,
      hasAwsCommands,
      hasGcpCommands,
      hasOtelHeadersHelper,
      hasMarketplaceHeadersHelper,
      hasRepoHeadersHelpers,
      hasDangerousEnvVars,
    });

    if (isHomeDir) {
      // For home directory, store trust in session memory only (not persisted to disk)
      // This allows hooks and other trust-requiring features to work during this session
      // while preserving the security intent of not permanently trusting home dir
      setSessionTrustAccepted(true);
    } else {
      saveCurrentProjectConfig(current => ({
        ...current,
        hasTrustDialogAccepted: true,
      }));
    }

    // Mid-session accept must re-apply gated project grants now, not on restart.
    settingsChangeDetector.notifyChange('projectSettings', { trustFlip: true });

    // Do NOT write MCP server settings here. handleMcpjsonServerApprovals in
    // interactiveHelpers.tsx runs right after this dialog and shows the per-server approval
    // UI. Writing enabledMcpjsonServers/enableAllProjectMcpServers here would
    // mark every server 'approved' and silently skip that dialog. See #15558.

    onDone();
  }

  // Default onExit is useApp().exit() → Ink.unmount(), which tears down the
  // React tree but never calls onDone(). showSetupScreens() in
  // interactiveHelpers.tsx awaits a Promise that only resolves via onDone,
  // so the default would hang the await forever. With keybinding
  // customization enabled, the chokidar watcher (persistent: true) keeps the
  // event loop alive and the process freezes. Explicitly exit 1 like "No".
  const exitState = useExitOnCtrlCDWithKeybindings(() => setPendingExitCode(1));

  // Use configurable keybinding for ESC to cancel/exit
  useKeybinding(
    'confirm:no',
    () => {
      gracefulShutdownSync(0);
    },
    { context: 'Confirmation' },
  );

  // When pendingExitCode is set, render nothing so the screen is cleared
  // before shutdown cleans up the alt screen.  See the useEffect above.
  if (pendingExitCode !== null) {
    return null;
  }

  // densable: already trusted and no backstop → queueMicrotask(onDone), not setTimeout.
  if (hasTrustDialogAccepted) {
    queueMicrotask(onDone);
    return null;
  }

  const cwdPath = getCwd();

  return (
    <PermissionDialog color="warning" titleColor="warning" title={ACCESSING_WORKSPACE_TITLE}>
      <Box flexDirection="column" gap={1} paddingTop={1}>
        <Text bold>{cwdPath}</Text>

        <Text>{ACCESSING_QUICK_SAFETY_CHECK}</Text>
        <Text>{ACCESSING_CAPABILITY}</Text>

        {allowDisclosure.rawCount > 0 || addDirsDisclosure.rawCount > 0 || hasRepoHeadersHelpers ? (
          <Box flexDirection="column">
            {allowDisclosure.rawCount > 0 ? (
              <Box flexDirection="column">
                <Text bold color="warning">
                  This folder pre-approves {allowDisclosure.rawCount} tool permission in{' '}
                  {formatEnglishSourceList(allowDisclosure.sources)}:
                </Text>
                <Text>
                  {'  '}
                  {allowDisclosure.rules.length > 0
                    ? formatEnglishSourceList(allowDisclosure.rules)
                    : '(rule names contain unprintable characters)'}
                </Text>
              </Box>
            ) : null}
            {addDirsDisclosure.rawCount > 0 ? (
              <Box flexDirection="column">
                <Text bold color="warning">
                  This folder adds {addDirsDisclosure.rawCount}{' '}
                  {addDirsDisclosure.rawCount === 1 ? 'directory' : 'directories'} to the workspace in{' '}
                  {formatEnglishSourceList(addDirsDisclosure.sources)}:
                </Text>
                <Text>
                  {'  '}
                  {addDirsDisclosure.dirs.length > 0
                    ? formatEnglishSourceList(addDirsDisclosure.dirs)
                    : '(directory names contain unprintable characters)'}
                </Text>
              </Box>
            ) : null}
            {hasRepoHeadersHelpers ? (
              <Box flexDirection="column">
                <Text bold color="warning">
                  {ACCESSING_HEADERS_HELPER_PREFIX}
                  {formatEnglishSourceList(repoHelperSources)}
                </Text>
                <Text dimColor>{ACCESSING_HEADERS_HELPER_TRUST_NOTE}</Text>
              </Box>
            ) : null}
          </Box>
        ) : null}

        <Text dimColor>
          <Link url="https://code.claude.com/docs/en/security">Security guide</Link>
        </Text>

        <ConfirmSelect
          hideIndexes
          cancelFirst
          focus="cancel"
          confirmLabel={ACCESSING_CONFIRM_LABEL}
          cancelLabel={ACCESSING_CANCEL_LABEL}
          onConfirm={() => onChange('enable_all')}
          onCancel={() => onChange('exit')}
        />

        <ConfirmSelectHint pending={exitState.pending} pendingKeyName={exitState.keyName ?? undefined} />
      </Box>
    </PermissionDialog>
  );
}
