import { basename, dirname } from 'path';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { useInterval } from 'usehooks-ts';
import { useUpdateNotification } from '../hooks/useUpdateNotification.js';
import { Box, StatusIcon, Text } from '@anthropic/ink';
import {
  type AutoUpdaterResult,
  EXE_LOCK_FAILURE_DAMP_THRESHOLD,
  getLatestVersion,
  getMaxVersion,
  getUpdateRestoreFailure,
  type InstallOutcome,
  type InstallStatus,
  installGlobalPackage,
  isForceDowngradeEnabled,
  mergeAutoUpdaterResult,
  shouldSkipVersion,
  shouldThrottleAutoUpdateCheck,
} from '../utils/autoUpdater.js';
import { getGlobalConfig, isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getCurrentInstallationType } from '../utils/doctorDiagnostic.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { installOrUpdateClaudePackage, localInstallationExists } from '../utils/localInstaller.js';
import { logError } from '../utils/log.js';
import { removeInstalledSymlink } from '../utils/nativeInstaller/index.js';
import { gt } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';
import { saveLastUpdateResult } from '../utils/updateResult.js';

function failureHintToErrorCode(hint: string | undefined): string | null {
  switch (hint) {
    case 'windows_running_exe_lock':
      return 'update_apply_exe_locked';
    case 'native_binary_missing':
      return 'update_apply_native_binary_missing';
    case 'registry_session_refused':
      return 'update_session_refused';
    default:
      return null;
  }
}

type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
  withSeparator?: boolean;
};

export function AutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose,
  withSeparator,
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

  // Track latest isUpdating / autoUpdaterResult in refs so the memoized
  // checkForUpdates callback always sees fresh values without changing
  // callback identity (which would re-trigger the initial-check useEffect).
  const isUpdatingRef = useRef(isUpdating);
  isUpdatingRef.current = isUpdating;
  const autoUpdaterResultRef = useRef(autoUpdaterResult);
  autoUpdaterResultRef.current = autoUpdaterResult;
  const onChangeIsUpdatingRef = useRef(onChangeIsUpdating);
  onChangeIsUpdatingRef.current = onChangeIsUpdating;

  const checkForUpdates = React.useCallback(async () => {
    if (isUpdatingRef.current) {
      return;
    }

    // Official $r: no_permissions persists for the session — don't keep retrying.
    if (autoUpdaterResultRef.current?.status === 'no_permissions') {
      logForDebugging('AutoUpdater: Skipping update check (no_permissions persists this session)');
      return;
    }

    // Official $r (On=2): damp after consecutive windows exe lock failures.
    if ((autoUpdaterResultRef.current?.consecutiveExeLockFailures ?? 0) >= EXE_LOCK_FAILURE_DAMP_THRESHOLD) {
      logForDebugging(
        'AutoUpdater: Skipping update check (claude.exe locked by another process; damped for this session)',
      );
      return;
    }

    // Official $r: early-return BEFORE any network call when disabled or throttled.
    if (isAutoUpdaterDisabled()) {
      return;
    }
    if (shouldThrottleAutoUpdateCheck()) {
      return;
    }

    const currentVersion = MACRO.VERSION;
    const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest';
    const fetchedLatestVersion = await getLatestVersion(channel);

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

    const forceDowngradeEnabled = isForceDowngradeEnabled();
    let latestVersion: string | null = null;
    let isForcedDowngrade = false;

    if (forceDowngradeEnabled && maxVersion) {
      if (gt(currentVersion, maxVersion)) {
        logForDebugging(`AutoUpdater: force-downgrade active — moving from ${currentVersion} to ${maxVersion}`);
        isForcedDowngrade = true;
        latestVersion = maxVersion;
      } else {
        logForDebugging(
          `AutoUpdater: force-downgrade flag set but current ${currentVersion} is not above ${maxVersion} — taking normal upgrade path`,
        );
      }
    }

    if (!latestVersion && fetchedLatestVersion) {
      if (maxVersion && gt(fetchedLatestVersion, maxVersion)) {
        logForDebugging(
          `AutoUpdater: maxVersion ${maxVersion} is set, capping update from ${fetchedLatestVersion} to ${maxVersion}`,
        );
        if (gt(maxVersion, currentVersion)) {
          latestVersion = maxVersion;
        } else {
          logForDebugging(
            `AutoUpdater: current version ${currentVersion} is already at or above maxVersion ${maxVersion}, skipping update`,
          );
        }
      } else if (gt(fetchedLatestVersion, currentVersion)) {
        latestVersion = fetchedLatestVersion;
      }
    }

    setVersions({ global: currentVersion, latest: latestVersion ?? fetchedLatestVersion });

    if (!latestVersion || shouldSkipVersion(latestVersion)) {
      return;
    }

    if (isForcedDowngrade) {
      logEvent('tengu_auto_updater_forced_downgrade', {
        from_version: currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        to_version: latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }

    const startTime = Date.now();
    onChangeIsUpdatingRef.current(true);

    // Remove native installer symlink since we're using JS-based updates
    // But only if user hasn't migrated to native installation
    const config = getGlobalConfig();
    if (config.installMethod !== 'native' && !isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)) {
      await removeInstalledSymlink();
    }

    // Detect actual running installation type
    const installationType = await getCurrentInstallationType();
    logForDebugging(`AutoUpdater: Detected installation type: ${installationType}`);

    // Skip update for development builds
    if (installationType === 'development') {
      logForDebugging('AutoUpdater: Cannot auto-update development build');
      onChangeIsUpdatingRef.current(false);
      return;
    }

    // Choose the appropriate update method based on what's actually running
    let installOutcome: InstallOutcome;
    let updateMethod: 'local' | 'global';

    if (installationType === 'npm-local') {
      // Use local update for local installations
      logForDebugging('AutoUpdater: Using local update method');
      updateMethod = 'local';
      installOutcome = await installOrUpdateClaudePackage(channel, latestVersion);
    } else if (installationType === 'npm-global') {
      // Use global update for global installations
      logForDebugging('AutoUpdater: Using global update method');
      updateMethod = 'global';
      installOutcome = await installGlobalPackage(latestVersion);
    } else if (installationType === 'native') {
      // This shouldn't happen - native should use NativeAutoUpdater
      logForDebugging('AutoUpdater: Unexpected native installation in non-native updater');
      onChangeIsUpdatingRef.current(false);
      return;
    } else {
      // Fallback to config-based detection for unknown types
      logForDebugging(`AutoUpdater: Unknown installation type, falling back to config`);
      const isMigrated = config.installMethod === 'local';
      updateMethod = isMigrated ? 'local' : 'global';

      if (isMigrated) {
        installOutcome = await installOrUpdateClaudePackage(channel, latestVersion);
      } else {
        installOutcome = await installGlobalPackage(latestVersion);
      }
    }

    onChangeIsUpdatingRef.current(false);

    const installStatus: InstallStatus = installOutcome.status;
    const failureHint = installOutcome.failureHint;

    if (installStatus !== 'in_progress') {
      saveLastUpdateResult({
        timestamp: new Date().toISOString(),
        path: updateMethod === 'local' ? 'npm-local' : 'npm-global',
        outcome: installStatus === 'success' ? 'success' : 'failed',
        status: installStatus,
        version_from: currentVersion,
        version_to: latestVersion,
        error_code:
          installStatus === 'install_failed' && getUpdateRestoreFailure()
            ? 'update_apply_restore_failed'
            : failureHintToErrorCode(failureHint),
      });
    }

    if (installStatus === 'success') {
      const probeDurationMs =
        'probeDurationMs' in installOutcome &&
        typeof (installOutcome as { probeDurationMs?: unknown }).probeDurationMs === 'number'
          ? (installOutcome as { probeDurationMs: number }).probeDurationMs
          : 0;
      logEvent('tengu_auto_updater_success', {
        fromVersion: currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toVersion: latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        durationMs: Date.now() - startTime - probeDurationMs,
        probeDurationMs,
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

    // Official $r: merge failureHint + consecutiveExeLockFailures into result.
    onAutoUpdaterResult(
      mergeAutoUpdaterResult(autoUpdaterResultRef.current, {
        version: latestVersion,
        status: installStatus,
        failureHint,
      }),
    );
    // isUpdating / autoUpdaterResult intentionally read via refs so callback
    // identity stays stable and does not re-trigger the mount effect.
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
  useInterval(
    () => {
      void checkForUpdates().catch(handleCheckError);
    },
    30 * 60 * 1000,
  );

  if (!autoUpdaterResult?.version && (!versions.global || !versions.latest)) {
    return null;
  }

  if (!autoUpdaterResult?.version && !isUpdating) {
    return null;
  }

  const restoreFailure = autoUpdaterResult?.status === 'install_failed' ? getUpdateRestoreFailure() : null;
  let failureHintMessage: string | null = null;
  switch (autoUpdaterResult?.failureHint as string | undefined) {
    case 'windows_running_exe_lock':
      failureHintMessage = 'claude.exe in use (close other Claude Code sessions, including VS Code)';
      break;
    case 'native_binary_missing':
      failureHintMessage = 'native binary for this platform was not downloaded (will retry)';
      break;
    case 'registry_session_refused':
    case undefined:
      break;
  }

  if (
    !(
      verbose ||
      isUpdating ||
      (autoUpdaterResult?.status === 'success' && showSuccessMessage && !!updateSemver) ||
      autoUpdaterResult?.status === 'no_permissions' ||
      autoUpdaterResult?.status === 'install_failed'
    )
  ) {
    return null;
  }

  return (
    <Box flexDirection="row" gap={1}>
      {withSeparator === undefined ? null : <Text dimColor>{withSeparator ? ' ·' : ''}</Text>}
      {verbose && (
        <Text dimColor wrap="truncate">
          installed: {versions.global} &middot; latest: {versions.latest}
        </Text>
      )}
      {isUpdating ? (
        <Box>
          <Text color="text" dimColor wrap="truncate">
            Auto-updating…
          </Text>
        </Box>
      ) : (
        autoUpdaterResult?.status === 'success' &&
        showSuccessMessage &&
        updateSemver && (
          <Text color="success" wrap="truncate">
            <StatusIcon status="success" withSpace />
            Update installed · restart to apply
          </Text>
        )
      )}
      {autoUpdaterResult?.status === 'no_permissions' && (
        <Text color="error" wrap="truncate">
          <StatusIcon status="error" withSpace />
          Auto-update failed: no write permission to npm prefix · Run <Text bold>claude doctor</Text>
        </Text>
      )}
      {autoUpdaterResult?.status === 'install_failed' &&
        (restoreFailure ? (
          restoreFailure.preservedPath ? (
            <Box flexDirection="column">
              <Text color="error" wrap="truncate">
                <StatusIcon status="error" withSpace />
                Couldn&apos;t update or restore {basename(restoreFailure.originalPath)} — a copy is at:
              </Text>
              {dirname(restoreFailure.preservedPath) === dirname(restoreFailure.originalPath) ? (
                <Text color="error" wrap="truncate">
                  {restoreFailure.preservedPath} · rename it back to {basename(restoreFailure.originalPath)} or run{' '}
                  <Text bold>npm i -g {MACRO.PACKAGE_URL}</Text>
                </Text>
              ) : (
                <Text color="error" wrap="truncate">
                  {restoreFailure.preservedPath} · reinstall with <Text bold>npm i -g {MACRO.PACKAGE_URL}</Text>
                </Text>
              )}
            </Box>
          ) : (
            <Text color="error" wrap="truncate">
              <StatusIcon status="error" withSpace />
              Couldn&apos;t update or restore {basename(restoreFailure.originalPath)} (no copy found) · reinstall with{' '}
              <Text bold>npm i -g {MACRO.PACKAGE_URL}</Text>
            </Text>
          )
        ) : failureHintMessage ? (
          <Text color="error" wrap="truncate">
            <StatusIcon status="error" withSpace />
            Auto-update failed: {failureHintMessage} · Run <Text bold>claude doctor</Text>
          </Text>
        ) : (
          <Text color="error" wrap="truncate">
            <StatusIcon status="error" withSpace />
            Auto-update failed · Try <Text bold>claude doctor</Text> or{' '}
            <Text bold>
              {hasLocalInstall
                ? `cd ~/.claude/local && npm update ${MACRO.PACKAGE_URL}`
                : `npm i -g ${MACRO.PACKAGE_URL}`}
            </Text>
          </Text>
        ))}
    </Box>
  );
}
