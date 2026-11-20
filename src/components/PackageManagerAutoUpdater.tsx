import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { useInterval } from 'usehooks-ts';
import { Box, StatusIcon, Text } from '@anthropic/ink';
import {
  type AutoUpdaterResult,
  getLatestVersion,
  getLatestVersionFromGcs,
  getMaxVersion,
  shouldSkipVersion,
  shouldThrottleAutoUpdateCheck,
} from '../utils/autoUpdater.js';
import { isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { execFileNoThrow } from '../utils/execFileNoThrow.js';
import { logError } from '../utils/log.js';
import {
  getHomebrewCaskName,
  getPackageManager,
  type PackageManager,
} from '../utils/nativeInstaller/packageManagers.js';
import {
  fetchHomebrewCaskLatestVersion,
  getPackageManagerManualUpgradeCommand,
  getPackageManagerUpdateLastFailedAt,
  getPackageManagerUpgradeArgs,
  isPackageManagerAutoUpdateOptedIn,
  PACKAGE_MANAGER_FAILURE_COOLDOWN_MS,
  recordPackageManagerUpdateFailure,
} from '../utils/packageManagerAutoUpdate.js';
import { gt, gte } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';

type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
  withSeparator?: boolean;
};

export function PackageManagerAutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose,
  withSeparator,
}: Props): React.ReactNode {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [packageManager, setPackageManager] = useState<PackageManager>('unknown');
  const [homebrewCaskName, setHomebrewCaskName] = useState<string | null>(null);

  const isUpdatingRef = useRef(isUpdating);
  isUpdatingRef.current = isUpdating;
  const autoUpdaterResultRef = useRef(autoUpdaterResult);
  autoUpdaterResultRef.current = autoUpdaterResult;
  const onChangeIsUpdatingRef = useRef(onChangeIsUpdating);
  onChangeIsUpdatingRef.current = onChangeIsUpdating;

  useEffect(() => {
    void getPackageManager().then(pm => {
      setPackageManager(pm);
      if (pm === 'homebrew') {
        setHomebrewCaskName(getHomebrewCaskName());
      }
    });
  }, []);

  const checkForUpdates = React.useCallback(async () => {
    if (isUpdatingRef.current) {
      return;
    }

    if (autoUpdaterResultRef.current?.status === 'success') {
      return;
    }

    // Official sr: ALWAYS early-return when disabled or throttled.
    if (isAutoUpdaterDisabled()) {
      return;
    }

    if (shouldThrottleAutoUpdateCheck()) {
      return;
    }

    if (autoUpdaterResultRef.current?.status === 'install_failed') {
      if (Date.now() - getPackageManagerUpdateLastFailedAt() < PACKAGE_MANAGER_FAILURE_COOLDOWN_MS) {
        return;
      }
    }

    const [configuredChannel, pm] = await Promise.all([
      Promise.resolve(getInitialSettings()?.autoUpdatesChannel ?? 'latest'),
      getPackageManager(),
    ]);
    setPackageManager(pm);

    let channel = configuredChannel;
    let caskName: string | null = null;
    if (pm === 'homebrew') {
      caskName = getHomebrewCaskName();
      setHomebrewCaskName(caskName);
      channel = caskName === 'claude-code@latest' ? 'latest' : 'stable';
    }

    let latest =
      pm === 'homebrew'
        ? ((await fetchHomebrewCaskLatestVersion(caskName ?? 'claude-code')) ?? (await getLatestVersion(channel)))
        : ((await getLatestVersion(channel)) ?? (await getLatestVersionFromGcs(channel)));

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

    let isCappedByMaxVersion = false;
    if (maxVersion && latest && gt(latest, maxVersion)) {
      logForDebugging(
        `PackageManagerAutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latest} to ${maxVersion}`,
      );
      if (gte(MACRO.VERSION, maxVersion)) {
        logForDebugging(
          `PackageManagerAutoUpdater: current version ${MACRO.VERSION} is already at or above maxVersion ${maxVersion}, skipping update`,
        );
        setLatestVersion(null);
        return;
      }
      latest = maxVersion;
      isCappedByMaxVersion = true;
    }

    const hasUpdate = !!latest && !gte(MACRO.VERSION, latest) && !shouldSkipVersion(latest);
    setLatestVersion(hasUpdate ? latest : null);

    if (!hasUpdate || !latest) {
      return;
    }

    logForDebugging(`PackageManagerAutoUpdater: Update available ${MACRO.VERSION} -> ${latest}`);

    const upgradeArgs = getPackageManagerUpgradeArgs(pm, caskName ?? undefined);
    if (
      !isPackageManagerAutoUpdateOptedIn() ||
      !upgradeArgs ||
      isCappedByMaxVersion ||
      Date.now() - getPackageManagerUpdateLastFailedAt() < PACKAGE_MANAGER_FAILURE_COOLDOWN_MS
    ) {
      return;
    }

    if (isUpdatingRef.current) {
      return;
    }

    onChangeIsUpdatingRef.current(true);
    const startTime = Date.now();
    const pmAnalytics = {
      pm_homebrew: pm === 'homebrew',
      pm_winget: pm === 'winget',
    };
    logEvent('tengu_pkg_manager_auto_updater_start', pmAnalytics);

    const [cmd, ...args] = upgradeArgs;
    const result = await execFileNoThrow(cmd!, args, {
      timeout: 300_000,
      env: pm === 'homebrew' ? { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '' } : process.env,
    });
    const latencyMs = Date.now() - startTime;
    onChangeIsUpdatingRef.current(false);

    if (result.code === 0) {
      logEvent('tengu_pkg_manager_auto_updater_success', {
        ...pmAnalytics,
        latency_ms: latencyMs,
      });
      onAutoUpdaterResult({
        version: latest,
        status: 'success',
      });
    } else {
      logForDebugging(
        `PackageManagerAutoUpdater: ${cmd} exited ${result.code}: ${result.stderr || result.error || result.stdout}`,
      );
      logEvent('tengu_pkg_manager_auto_updater_fail', {
        ...pmAnalytics,
        latency_ms: latencyMs,
        exit_code: result.code,
      });
      recordPackageManagerUpdateFailure();
      onAutoUpdaterResult({
        version: null,
        status: 'install_failed',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAutoUpdaterResult]);

  const handleCheckError = React.useCallback((err: unknown) => {
    onChangeIsUpdatingRef.current(false);
    logError(err);
  }, []);

  // Initial check
  useEffect(() => {
    void checkForUpdates().catch(handleCheckError);
  }, [checkForUpdates, handleCheckError]);

  // Check every 30 minutes
  useInterval(() => {
    void checkForUpdates().catch(handleCheckError);
  }, PACKAGE_MANAGER_FAILURE_COOLDOWN_MS);

  const separator = withSeparator === undefined ? null : <Text dimColor>{withSeparator ? ' ·' : ''}</Text>;

  if (autoUpdaterResult?.status === 'success') {
    if (!showSuccessMessage) {
      return null;
    }
    const viaSuffix = packageManager !== 'unknown' ? ` via ${packageManager}` : '';
    return (
      <Box flexDirection="row" gap={1}>
        {separator}
        {verbose && (
          <Text dimColor wrap="truncate">
            current: {MACRO.VERSION} &middot; latest: {autoUpdaterResult.version}
          </Text>
        )}
        <Text color="success" wrap="truncate">
          <StatusIcon status="success" withSpace />
          Update installed{viaSuffix} · restart to apply
        </Text>
      </Box>
    );
  }

  if (isUpdating) {
    const updatingLabel = packageManager === 'unknown' ? 'Updating…' : `Updating via ${packageManager}…`;
    return (
      <Box flexDirection="row" gap={1}>
        {separator}
        <Text dimColor wrap="truncate">
          {updatingLabel}
        </Text>
      </Box>
    );
  }

  const autoUpdateFailed = autoUpdaterResult?.status === 'install_failed';
  if ((!latestVersion && !autoUpdateFailed) || packageManager === 'unknown') {
    return null;
  }

  const manualCmd = getPackageManagerManualUpgradeCommand(packageManager, homebrewCaskName ?? undefined);

  return (
    <Box flexDirection="row" gap={1} alignItems="flex-end">
      {separator}
      <Box flexDirection="column" alignItems="flex-end">
        {verbose && (
          <Text dimColor wrap="truncate">
            current: {MACRO.VERSION}
          </Text>
        )}
        <Text color="warning" wrap="truncate">
          Update available · run <Text bold>{manualCmd}</Text>
          {autoUpdateFailed && <Text dimColor> (auto-update failed)</Text>}
        </Text>
      </Box>
    </Box>
  );
}
