import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { useInterval } from 'usehooks-ts';
import { useUpdateNotification } from '../hooks/useUpdateNotification.js';
import { Box, Text } from '@anthropic/ink';
import {
  type AutoUpdaterResult,
  EXE_LOCK_FAILURE_DAMP_THRESHOLD,
  getLatestVersion,
  getMaxVersion,
  type InstallOutcome,
  type InstallStatus,
  installGlobalPackage,
  mergeAutoUpdaterResult,
  shouldSkipVersion,
} from '../utils/autoUpdater.js';
import { getGlobalConfig, isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getCurrentInstallationType } from '../utils/doctorDiagnostic.js';
import { installOrUpdateClaudePackage, localInstallationExists } from '../utils/localInstaller.js';
import { removeInstalledSymlink } from '../utils/nativeInstaller/index.js';
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

export function AutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose,
}: Props): React.ReactNode {
  const [versions, setVersions] = useState<{
    global?: string | null;
    latest?: string | null;
  }>({});
  const [hasLocalInstall, setHasLocalInstall] = useState(false);
  const updateSemver = useUpdateNotification(autoUpdaterResult?.version);

  useEffect(() => {
    void localInstallationExists().then(setHasLocalInstall);
  }, []);

  // Track latest isUpdating value in a ref so the memoized checkForUpdates
  // callback always sees the current value. Without this, the 30-minute
  // interval fires with a stale closure where isUpdating is false, allowing
  // a concurrent installGlobalPackage() to run while one is already in
  // progress.
  const isUpdatingRef = useRef(isUpdating);
  isUpdatingRef.current = isUpdating;
  // densable merge reads previous autoUpdaterResult; keep a live ref so the
  // memoized checkForUpdates callback does not close over a stale value.
  const autoUpdaterResultRef = useRef(autoUpdaterResult);
  autoUpdaterResultRef.current = autoUpdaterResult;

  const checkForUpdates = React.useCallback(async () => {
    if (isUpdatingRef.current) {
      return;
    }

    // densable: no_permissions persists for the session — don't keep retrying.
    if (autoUpdaterResultRef.current?.status === 'no_permissions') {
      logForDebugging('AutoUpdater: Skipping update check (no_permissions persists this session)');
      return;
    }

    // densable Vpg=2: damp after consecutive windows exe lock failures.
    if ((autoUpdaterResultRef.current?.consecutiveExeLockFailures ?? 0) >= EXE_LOCK_FAILURE_DAMP_THRESHOLD) {
      logForDebugging(
        'AutoUpdater: Skipping update check (claude.exe locked by another process; damped for this session)',
      );
      return;
    }

    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      logForDebugging('AutoUpdater: Skipping update check in test/dev environment');
      return;
    }

    const currentVersion = MACRO.VERSION;
    const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest';
    let latestVersion = await getLatestVersion(channel);
    const isDisabled = isAutoUpdaterDisabled();

    // Publish versions ASAP so notify-only UI can render even if GrowthBook
    // getMaxVersion() is slow/hung (BLOCKS_ON_INIT). Without this, autoUpdates
    // false never showed "Update available" because setVersions never ran.
    setVersions({ global: currentVersion, latest: latestVersion });

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
    if (maxVersion && latestVersion && gt(latestVersion, maxVersion)) {
      logForDebugging(
        `AutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latestVersion} to ${maxVersion}`,
      );
      if (gte(currentVersion, maxVersion)) {
        logForDebugging(
          `AutoUpdater: current version ${currentVersion} is already at or above maxVersion ${maxVersion}, skipping update`,
        );
        setVersions({ global: currentVersion, latest: latestVersion });
        return;
      }
      latestVersion = maxVersion;
      setVersions({ global: currentVersion, latest: latestVersion });
    }

    const needsUpdate =
      !!currentVersion && !!latestVersion && !gte(currentVersion, latestVersion) && !shouldSkipVersion(latestVersion);

    // Auto-install off: still report so Notifications can toast "Update available".
    if (isDisabled && needsUpdate && latestVersion) {
      onAutoUpdaterResult(
        mergeAutoUpdaterResult(autoUpdaterResultRef.current, {
          version: latestVersion,
          status: 'available',
        }),
      );
      return;
    }

    // Check if update needed and perform update
    if (!isDisabled && needsUpdate) {
      const startTime = Date.now();
      onChangeIsUpdating(true);

      // Remove native installer symlink since we're using JS-based updates
      // But only if user hasn't migrated to native installation
      const config = getGlobalConfig();
      if (config.installMethod !== 'native') {
        await removeInstalledSymlink();
      }

      // Detect actual running installation type
      const installationType = await getCurrentInstallationType();
      logForDebugging(`AutoUpdater: Detected installation type: ${installationType}`);

      // Skip update for development builds
      if (installationType === 'development') {
        logForDebugging('AutoUpdater: Cannot auto-update development build');
        onChangeIsUpdating(false);
        return;
      }

      // Choose the appropriate update method based on what's actually running
      let installOutcome: InstallOutcome;
      let updateMethod: 'local' | 'global';

      if (installationType === 'npm-local') {
        // Use local update for local installations
        logForDebugging('AutoUpdater: Using local update method');
        updateMethod = 'local';
        installOutcome = await installOrUpdateClaudePackage(channel);
      } else if (installationType === 'npm-global') {
        // Use global update for global installations
        logForDebugging('AutoUpdater: Using global update method');
        updateMethod = 'global';
        installOutcome = await installGlobalPackage();
      } else if (installationType === 'native') {
        // This shouldn't happen - native should use NativeAutoUpdater
        logForDebugging('AutoUpdater: Unexpected native installation in non-native updater');
        onChangeIsUpdating(false);
        return;
      } else {
        // Fallback to config-based detection for unknown types
        logForDebugging(`AutoUpdater: Unknown installation type, falling back to config`);
        const isMigrated = config.installMethod === 'local';
        updateMethod = isMigrated ? 'local' : 'global';

        if (isMigrated) {
          installOutcome = await installOrUpdateClaudePackage(channel);
        } else {
          installOutcome = await installGlobalPackage();
        }
      }

      onChangeIsUpdating(false);

      const installStatus: InstallStatus = installOutcome.status;
      if (installStatus === 'success') {
        logEvent('tengu_auto_updater_success', {
          fromVersion: currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toVersion: latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          durationMs: Date.now() - startTime,
          wasMigrated: updateMethod === 'local',
          installationType: installationType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      } else if (installStatus !== 'in_progress') {
        logEvent('tengu_auto_updater_fail', {
          fromVersion: currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          attemptedVersion: latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          status: installStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          durationMs: Date.now() - startTime,
          wasMigrated: updateMethod === 'local',
          installationType: installationType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      }

      // densable: merge failureHint + consecutiveExeLockFailures into result.
      onAutoUpdaterResult(
        mergeAutoUpdaterResult(autoUpdaterResultRef.current, {
          version: latestVersion,
          status: installStatus,
          failureHint: installOutcome.failureHint,
        }),
      );
    }
    // isUpdating intentionally omitted from deps; we read isUpdatingRef
    // instead so the guard is always current without changing callback
    // identity (which would re-trigger the initial-check useEffect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAutoUpdaterResult]);

  // Initial check
  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  // Check every 30 minutes
  useInterval(checkForUpdates, 30 * 60 * 1000);

  const updateAvailable =
    !!versions.global &&
    !!versions.latest &&
    !gte(versions.global, versions.latest) &&
    !shouldSkipVersion(versions.latest);

  // Notify-only when auto-install is off (config.autoUpdates=false / DISABLE_…)
  // or when status is 'available' from the check path.
  const showAvailableHint =
    !isUpdating && (autoUpdaterResult?.status === 'available' || (updateAvailable && !autoUpdaterResult?.version));

  if (!autoUpdaterResult?.version && !isUpdating && !showAvailableHint) {
    return null;
  }

  if (!versions.global && !versions.latest && !autoUpdaterResult?.version) {
    return null;
  }

  return (
    <Box flexDirection="row" gap={1}>
      {verbose && (
        <Text dimColor wrap="truncate">
          globalVersion: {versions.global} &middot; latestVersion: {versions.latest}
        </Text>
      )}
      {isUpdating ? (
        <>
          <Box>
            <Text color="text" dimColor wrap="truncate">
              Auto-updating…
            </Text>
          </Box>
        </>
      ) : (
        autoUpdaterResult?.status === 'success' &&
        showSuccessMessage &&
        updateSemver && (
          <Text color="success" wrap="truncate">
            ✓ Update installed · Restart to apply
          </Text>
        )
      )}
      {showAvailableHint && (
        <Text color="warning" wrap="truncate">
          Update available! Run:{' '}
          <Text bold>
            {hasLocalInstall ? `cd ~/.claude/local && npm update ${MACRO.PACKAGE_URL}` : `claude update`}
          </Text>
        </Text>
      )}
      {autoUpdaterResult?.status === 'no_permissions' && (
        <Text color="error" wrap="truncate">
          Auto-update failed: no write permission to npm prefix · Run <Text bold>claude doctor</Text>
        </Text>
      )}
      {autoUpdaterResult?.status === 'install_failed' &&
        autoUpdaterResult.failureHint === 'windows_running_exe_lock' && (
          <Text color="error" wrap="truncate">
            Auto-update failed: claude.exe in use (close other Claude Code sessions, including VS Code) · Run{' '}
            <Text bold>claude doctor</Text>
          </Text>
        )}
      {autoUpdaterResult?.status === 'install_failed' &&
        autoUpdaterResult.failureHint !== 'windows_running_exe_lock' && (
          <Text color="error" wrap="truncate">
            Auto-update failed · Try <Text bold>claude doctor</Text> or{' '}
            <Text bold>
              {hasLocalInstall
                ? `cd ~/.claude/local && npm update ${MACRO.PACKAGE_URL}`
                : `npm i -g ${MACRO.PACKAGE_URL}`}
            </Text>
          </Text>
        )}
    </Box>
  );
}
