import * as React from 'react';
import { useState } from 'react';
import { useInterval } from 'usehooks-ts';
import { Text } from '@anthropic/ink';
import {
  type AutoUpdaterResult,
  getLatestVersion,
  getLatestVersionFromGcs,
  getMaxVersion,
  shouldSkipVersion,
} from '../utils/autoUpdater.js';
import { isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getPackageManager, type PackageManager } from '../utils/nativeInstaller/packageManagers.js';
import { gt, gte } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';

type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
};

export function PackageManagerAutoUpdater({ verbose }: Props): React.ReactNode {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [packageManager, setPackageManager] = useState<PackageManager>('unknown');

  const checkForUpdates = React.useCallback(async () => {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      return;
    }

    // Official CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE: '0' force-off.
    const { resolvePackageManagerAutoUpdateFromEnv } =
      require('../utils/packageManagerAutoUpdate.js') as typeof import('../utils/packageManagerAutoUpdate.js');
    const envAuto = resolvePackageManagerAutoUpdateFromEnv();
    if (envAuto === false) {
      return;
    }

    if (isAutoUpdaterDisabled() && envAuto !== true) {
      return;
    }

    const [channel, pm] = await Promise.all([
      Promise.resolve(getInitialSettings()?.autoUpdatesChannel ?? 'latest'),
      getPackageManager(),
    ]);
    setPackageManager(pm);

    // Prefer npm registry (MACRO.PACKAGE_URL = @go-hare/claude-code). GCS is
    // Anthropic native release pointers and will never list fork versions.
    let latest = (await getLatestVersion(channel)) ?? (await getLatestVersionFromGcs(channel));

    // Set availability before optional maxVersion gate (may be slow/hung).
    let hasUpdate = !!latest && !gte(MACRO.VERSION, latest) && !shouldSkipVersion(latest);
    setUpdateAvailable(hasUpdate);

    // Check if max version is set (server-side kill switch for auto-updates)
    let maxVersion: string | undefined;
    try {
      maxVersion = await Promise.race([
        getMaxVersion(),
        new Promise<undefined>(resolve => {
          setTimeout(resolve, 3000, undefined);
        }),
      ]);
    } catch {
      maxVersion = undefined;
    }

    if (maxVersion && latest && gt(latest, maxVersion)) {
      logForDebugging(
        `PackageManagerAutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latest} to ${maxVersion}`,
      );
      if (gte(MACRO.VERSION, maxVersion)) {
        logForDebugging(
          `PackageManagerAutoUpdater: current version ${MACRO.VERSION} is already at or above maxVersion ${maxVersion}, skipping update`,
        );
        setUpdateAvailable(false);
        return;
      }
      latest = maxVersion;
      hasUpdate = !!latest && !gte(MACRO.VERSION, latest) && !shouldSkipVersion(latest);
      setUpdateAvailable(hasUpdate);
    }

    if (hasUpdate) {
      logForDebugging(`PackageManagerAutoUpdater: Update available ${MACRO.VERSION} -> ${latest}`);
    }
  }, []);

  // Initial check
  React.useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  // Check every 30 minutes
  useInterval(checkForUpdates, 30 * 60 * 1000);

  if (!updateAvailable) {
    return null;
  }

  // pacman, deb, and rpm don't get specific commands because they each have
  // multiple frontends (pacman: yay/paru/makepkg, deb: apt/apt-get/aptitude/nala,
  // rpm: dnf/yum/zypper). Fork default path is npm/bun global.
  const updateCommand =
    packageManager === 'homebrew'
      ? 'brew upgrade claude-code'
      : packageManager === 'winget'
        ? 'winget upgrade Anthropic.ClaudeCode'
        : packageManager === 'apk'
          ? 'apk upgrade claude-code'
          : `npm i -g ${MACRO.PACKAGE_URL}@latest`;

  return (
    <>
      {verbose && (
        <Text dimColor wrap="truncate">
          currentVersion: {MACRO.VERSION}
        </Text>
      )}
      <Text color="warning" wrap="truncate">
        Update available! Run: <Text bold>{updateCommand}</Text>
      </Text>
    </>
  );
}
