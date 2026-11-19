import { relative } from 'path';
import React from 'react';
import { getCwdState } from '../../bootstrap/state.js';
import { SandboxSettings } from '../../components/sandbox/SandboxSettings.js';
import { color } from '@anthropic/ink';
import type { CommandResultDisplay } from '../../types/command.js';
import { getPlatform } from '../../utils/platform.js';
import {
  addToExcludedCommandsWithResult,
  clearSandboxRootMoveHold,
  SandboxManager,
} from '../../utils/sandbox/sandbox-adapter.js';
import { formatSandboxSaveResult } from '../../components/sandbox/SandboxSettings.js';
import { getSettings_DEPRECATED, getSettingsFilePathForSource } from '../../utils/settings/settings.js';
import type { ThemeName } from '../../utils/theme.js';

export async function call(
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void,
  _context: unknown,
  args?: string,
): Promise<React.ReactNode | null> {
  const settings = getSettings_DEPRECATED();
  const themeName: ThemeName = (settings.theme as ThemeName) || 'light';

  const platform = getPlatform();

  if (!SandboxManager.isSupportedPlatform()) {
    // WSL1 users will see this since isSupportedPlatform returns false for WSL1
    const errorMessage =
      platform === 'wsl'
        ? 'Error: Sandboxing requires WSL2. WSL1 is not supported.'
        : 'Error: Sandboxing is currently only supported on macOS, Linux, and WSL2.';
    const message = color('error', themeName)(errorMessage);
    onDone(message);
    return null;
  }

  // Check dependencies - get structured result with errors/warnings
  const depCheck = SandboxManager.checkDependencies();

  // Check if platform is in enabledPlatforms list (undocumented enterprise setting)
  if (!SandboxManager.isPlatformInEnabledList()) {
    const message = color(
      'error',
      themeName,
    )(`Error: Sandboxing is disabled for this platform (${platform}) via the enabledPlatforms setting.`);
    onDone(message);
    return null;
  }

  // Check if sandbox settings are locked by higher-priority settings
  if (SandboxManager.areSandboxSettingsLockedByPolicy()) {
    const message = color(
      'error',
      themeName,
    )('Error: Sandbox settings are overridden by a higher-priority configuration and cannot be changed locally.');
    onDone(message);
    return null;
  }

  // Parse the arguments
  const trimmedArgs = args?.trim() || '';

  // If no args, show the interactive menu
  if (!trimmedArgs) {
    const handleComplete = (result?: string, options?: { display?: CommandResultDisplay }) => {
      // Official 2.1.326 #299: release root-move sandbox hold once the user
      // explicitly updates sandbox settings via `/sandbox`.
      if (result && (result.startsWith('✓ ') || result.startsWith('○ '))) {
        clearSandboxRootMoveHold();
      }
      onDone(result, options);
    };
    return <SandboxSettings onComplete={handleComplete} depCheck={depCheck} />;
  }

  // Handle subcommands
  if (trimmedArgs) {
    const parts = trimmedArgs.split(' ');
    const subcommand = parts[0];

    if (subcommand === 'exclude') {
      // Handle exclude subcommand
      const commandPattern = trimmedArgs.slice('exclude '.length).trim();

      if (!commandPattern) {
        const message = color(
          'error',
          themeName,
        )('Error: Please provide a command pattern to exclude (e.g., /sandbox exclude "npm run test:*")');
        onDone(message);
        return null;
      }

      // Remove quotes if present
      const cleanPattern = commandPattern.replace(/^["']|["']$/g, '');

      // Add to excludedCommands
      const saveResult = addToExcludedCommandsWithResult(cleanPattern);
      if (saveResult.error !== null) {
        const message = color(
          'error',
          themeName,
        )(formatSandboxSaveResult({ error: saveResult.error }, '', saveResult.settingsSource));
        onDone(message);
        return null;
      }

      // Get the local settings path and make it relative to cwd
      const localSettingsPath = getSettingsFilePathForSource('localSettings');
      const relativePath = localSettingsPath
        ? relative(getCwdState(), localSettingsPath)
        : '.claude/settings.local.json';

      const message = color('success', themeName)(`Added "${cleanPattern}" to excluded commands in ${relativePath}`);

      onDone(message);
      return null;
    } else {
      // Unknown subcommand
      const message = color(
        'error',
        themeName,
      )(`Error: Unknown subcommand "${subcommand}". Available subcommand: exclude`);
      onDone(message);
      return null;
    }
  }

  // Should never reach here since we handle all cases above
  return null;
}
