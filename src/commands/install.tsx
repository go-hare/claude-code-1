import { homedir } from 'node:os';
import { join } from 'node:path';
import React, { useEffect, useState } from 'react';
import type { CommandResultDisplay } from 'src/commands.js';
import { logEvent } from 'src/services/analytics/index.js';
import { StatusIcon } from '@anthropic/ink';
import { Box, wrappedRender as render, Text } from '@anthropic/ink';
import { logForDebugging } from '../utils/debug.js';
import { env } from '../utils/env.js';
import { errorMessage } from '../utils/errors.js';
import {
  checkInstall,
  cleanupNpmInstallations,
  cleanupShellAliases,
  installLatest,
} from '../utils/nativeInstaller/index.js';
import { getInitialSettings, updateSettingsForSource } from '../utils/settings/settings.js';

interface InstallProps {
  onDone: (result: string, options?: { display?: CommandResultDisplay }) => void;
  force?: boolean;
  target?: string; // 'latest', 'stable', 'rc', or version like '1.0.34'
}

type InstallState =
  | { type: 'checking' }
  | { type: 'installing'; version: string }
  | { type: 'setting-up' }
  | { type: 'success'; version: string; setupMessages: string[] }
  | { type: 'error'; message: string; forceMayHelp?: boolean };

/**
 * Official 2.1.328: normalize an explicit install channel target for
 * persisting `autoUpdatesChannel`. `'rc'` is mapped to `'stable'`.
 */
export function normalizeInstallChannelTarget(target: string | undefined): 'latest' | 'stable' | null {
  if (target === 'latest' || target === 'stable') {
    return target;
  }
  if (target === 'rc') {
    return 'stable';
  }
  return null;
}

/**
 * Official 2.1.328: whether `--force` may help recover from an install error.
 * Signature verification failures (`ManifestSignatureError`) cannot be
 * overridden with `--force`.
 */
export function shouldSuggestForceForInstallError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'ManifestSignatureError') {
    return false;
  }
  return true;
}

function getInstallationPath(): string {
  const isWindows = env.platform === 'win32';
  const homeDir = homedir();

  if (isWindows) {
    // Convert to Windows-style path
    const windowsPath = join(homeDir, '.local', 'bin', 'claude.exe');
    // Replace forward slashes with backslashes for Windows display
    return windowsPath.replace(/\//g, '\\');
  }

  return '~/.local/bin/claude';
}

function SetupNotes({ messages }: { messages: string[] }): React.ReactNode {
  if (messages.length === 0) return null;

  return (
    <Box flexDirection="column" gap={0} marginBottom={1}>
      <Box>
        <Text color="warning">
          <StatusIcon status="warning" withSpace />
          Setup notes:
        </Text>
      </Box>
      {messages.map((message, index) => (
        <Box key={index} marginLeft={2}>
          <Text dimColor>• {message}</Text>
        </Box>
      ))}
    </Box>
  );
}

function Install({ onDone, force, target }: InstallProps): React.ReactNode {
  const [state, setState] = useState<InstallState>({ type: 'checking' });

  useEffect(() => {
    async function run() {
      try {
        logForDebugging(`Install: Starting installation process (force=${force}, target=${target})`);

        // Install native build first
        const channelOrVersion = target || getInitialSettings()?.autoUpdatesChannel || 'latest';
        setState({ type: 'installing', version: channelOrVersion });

        // Pass force flag to trigger reinstall even if up to date
        logForDebugging(
          `Install: Calling installLatest(channelOrVersion=${channelOrVersion}, forceReinstall=${force})`,
        );
        const result = await installLatest(channelOrVersion, force);
        logForDebugging(
          `Install: installLatest returned version=${result.latestVersion}, wasUpdated=${result.wasUpdated}, lockFailed=${result.lockFailed}`,
        );

        // Check specifically for lock failure
        if (result.lockFailed) {
          throw new Error('Another process is installing Claude. Try again in a moment.');
        }

        // If we couldn't get the version, there might be an issue
        if (!result.latestVersion) {
          logForDebugging('Install: Failed to retrieve version information during install', { level: 'error' });
        }

        // If user explicitly specified a channel, save it to settings ('rc' -> 'stable')
        let channelSaved = false;
        const normalizedChannel = normalizeInstallChannelTarget(target);
        if (normalizedChannel) {
          const { error: settingsError } = updateSettingsForSource('userSettings', {
            autoUpdatesChannel: normalizedChannel,
          });
          channelSaved = settingsError === null;
          logForDebugging(
            channelSaved
              ? `Install: Saved autoUpdatesChannel=${normalizedChannel} to user settings`
              : `Install: Could not save autoUpdatesChannel=${normalizedChannel}: ${errorMessage(settingsError)}`,
            { level: channelSaved ? 'debug' : 'warn' },
          );
        }

        if ('skippedUnverifiedRelease' in result && result.skippedUnverifiedRelease && result.latestVersion) {
          setState({
            type: 'error',
            message: `Skipped: the update target for @${channelOrVersion} resolved to ${result.latestVersion}, which predates release-signature enforcement, so this client (${MACRO.VERSION}) will not switch to it automatically.${channelSaved ? ' Channel preference saved.' : ''} Run \`claude install ${result.latestVersion}\` to install that exact version.`,
          });
          return;
        }

        if (!result.wasUpdated) {
          logForDebugging('Install: Already up to date');
        }

        // Set up launcher and shell integration
        setState({ type: 'setting-up' });
        const setupMessages = await checkInstall(true);

        logForDebugging(`Install: Setup launcher completed with ${setupMessages.length} messages`);
        if (setupMessages.length > 0) {
          setupMessages.forEach(msg => logForDebugging(`Install: Setup message: ${msg.message}`));
        }

        // Now that native installation succeeded, clean up old npm installations
        logForDebugging('Install: Cleaning up npm installations after successful install');
        const { removed, errors, warnings } = await cleanupNpmInstallations();

        if (removed > 0) {
          logForDebugging(`Cleaned up ${removed} npm installation(s)`);
        }

        if (errors.length > 0) {
          logForDebugging(`Cleanup errors: ${errors.join(', ')}`);
          // Continue despite cleanup errors - native install already succeeded
        }

        // Clean up old shell aliases
        const aliasMessages = await cleanupShellAliases();
        if (aliasMessages.length > 0) {
          logForDebugging(`Shell alias cleanup: ${aliasMessages.map(m => m.message).join('; ')}`);
        }

        // Log success event
        logEvent('tengu_claude_install_command', {
          has_version: result.latestVersion ? 1 : 0,
          forced: force ? 1 : 0,
        });

        setState({
          type: 'success',
          version: result.latestVersion || 'current',
          setupMessages: [...setupMessages.map(m => m.message), ...warnings, ...aliasMessages.map(m => m.message)],
        });
      } catch (error) {
        logForDebugging(`Install command failed: ${error}`, {
          level: 'error',
        });
        setState({
          type: 'error',
          message: errorMessage(error),
          forceMayHelp: shouldSuggestForceForInstallError(error),
        });
      }
    }

    void run();
  }, [force, target]);

  useEffect(() => {
    if (state.type === 'success') {
      onDone('Claude Code installation completed successfully', {
        display: 'system',
      });
    } else if (state.type === 'error') {
      onDone('Claude Code installation failed', {
        display: 'system',
      });
    }
  }, [state.type, onDone]);

  return (
    <Box flexDirection="column" marginTop={1}>
      {state.type === 'checking' && <Text color="claude">Checking installation…</Text>}

      {state.type === 'installing' && <Text color="claude">Installing Claude Code native build {state.version}…</Text>}

      {state.type === 'setting-up' && <Text color="claude">Setting up launcher and shell integration…</Text>}

      {state.type === 'success' && (
        <Box flexDirection="column" gap={1}>
          <Box>
            <StatusIcon status="success" withSpace />
            <Text color="success" bold>
              Claude Code successfully installed!
            </Text>
          </Box>
          <Box marginLeft={2} flexDirection="column" gap={1}>
            {state.version !== 'current' && (
              <Box>
                <Text dimColor>Version: </Text>
                <Text color="claude">{state.version}</Text>
              </Box>
            )}
            <Box>
              <Text dimColor>Location: </Text>
              <Text color="text">{getInstallationPath()}</Text>
            </Box>
          </Box>
          <Box marginLeft={2} flexDirection="column" gap={1}>
            <Box marginTop={1}>
              <Text dimColor>Next: Run </Text>
              <Text color="claude" bold>
                claude --help
              </Text>
              <Text dimColor> to get started</Text>
            </Box>
          </Box>
          {state.setupMessages.length > 0 && <SetupNotes messages={state.setupMessages} />}
        </Box>
      )}

      {state.type === 'error' && (
        <Box flexDirection="column" gap={1}>
          <Box>
            <StatusIcon status="error" withSpace />
            <Text color="error">Couldn't install Claude Code</Text>
          </Box>
          <Text color="error">{state.message}</Text>
          {state.forceMayHelp && (
            <Box marginTop={1}>
              <Text dimColor>Try running with --force to override checks</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// This is only used from cli.tsx, not as a slash command
export const install = {
  type: 'local-jsx' as const,
  name: 'install',
  description: 'Install Claude Code native build',
  argumentHint: '[options]',
  async call(
    onDone: (result: string, options?: { display?: CommandResultDisplay }) => void,
    _context: unknown,
    args: string[],
  ) {
    // Parse arguments
    const force = args.includes('--force');
    const nonFlagArgs = args.filter(arg => !arg.startsWith('--'));
    const target = nonFlagArgs[0]; // 'latest', 'stable', or version like '1.0.34'

    const renderPromise = render(
      <Install
        onDone={async (result, options) => {
          const { unmount } = await renderPromise;
          unmount();
          onDone(result, options);
        }}
        force={force}
        target={target}
      />,
    );
    await renderPromise;
  },
};
