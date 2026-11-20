import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { logForDebugging } from 'src/utils/debug.js';
import { logError } from 'src/utils/log.js';
import { useInterval } from 'usehooks-ts';
import { getIsRemoteMode } from '../bootstrap/state.js';
import updateCommand from '../commands/update/index.js';
import { useUpdateNotification } from '../hooks/useUpdateNotification.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { Box, StatusIcon, Text } from '@anthropic/ink';
import type { AutoUpdaterResult } from '../utils/autoUpdater.js';
import {
  formatAutoUpdatesChannelDisplay,
  getMaxVersion,
  getMaxVersionMessage,
  shouldThrottleAutoUpdateCheck,
} from '../utils/autoUpdater.js';
import { isAutoUpdaterDisabled } from '../utils/config.js';
import { installLatest } from '../utils/nativeInstaller/index.js';
import { gt } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';
import { saveLastUpdateResult } from '../utils/updateResult.js';

/**
 * Categorize error messages and error instances for analytics (official `_i`).
 */
function getErrorType(error: unknown): string {
  const errObj = error instanceof Error ? error : null;
  if (errObj?.name === 'SignatureVerificationError') {
    return 'signature_verification';
  }
  if (errObj?.name === 'ChecksumMismatchError') {
    return 'checksum_mismatch';
  }
  const errorMessage = errObj ? errObj.message : String(error);
  const code = errObj && 'code' in errObj ? String((errObj as { code?: unknown }).code) : undefined;
  if (
    errObj?.name === 'DownloadTimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    errorMessage.includes('Download timed out') ||
    errorMessage.includes('timeout')
  ) {
    return 'timeout';
  }
  if (errorMessage.includes('Checksum mismatch')) {
    return 'checksum_mismatch';
  }
  if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
    return 'not_found';
  }
  if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
    return 'permission_denied';
  }
  if (errorMessage.includes('ENOSPC')) {
    return 'disk_full';
  }
  if (errorMessage.includes('npm')) {
    return 'npm_error';
  }
  if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
    return 'network_error';
  }
  const lower = errorMessage.toLowerCase();
  if (
    errorMessage.includes('ENOEXEC') ||
    lower.includes('exec format error') ||
    lower.includes('bad cpu type') ||
    lower.includes('cannot execute binary') ||
    lower.includes('code signature') ||
    lower.includes('gatekeeper') ||
    lower.includes('killed: 9')
  ) {
    return 'exec_format';
  }
  if (
    lower.includes('virus') ||
    lower.includes('quarantine') ||
    lower.includes('defender') ||
    lower.includes('operation did not complete successfully because the file contains')
  ) {
    return 'av_quarantine';
  }
  if (
    errorMessage.includes('EXDEV') ||
    errorMessage.includes('EEXIST') ||
    errorMessage.includes('EBUSY') ||
    lower.includes('rename') ||
    lower.includes('move failed') ||
    lower.includes('cross-device')
  ) {
    return 'swap_failure';
  }
  return 'unknown';
}

function isRegistrySessionRefusedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'RegistrySessionRefusedError') {
    return true;
  }
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  return code === 'registry_session_refused' || code === 'update_session_refused';
}

function getNativeUpdateOutcomeEvent(result: {
  wasUpdated: boolean;
  skippedUnverifiedRelease?: boolean;
}):
  | 'tengu_native_auto_updater_success'
  | 'tengu_native_auto_updater_skipped_unverified_release'
  | 'tengu_native_auto_updater_up_to_date' {
  if (result.wasUpdated) {
    return 'tengu_native_auto_updater_success';
  }
  if (result.skippedUnverifiedRelease) {
    return 'tengu_native_auto_updater_skipped_unverified_release';
  }
  return 'tengu_native_auto_updater_up_to_date';
}

function getRestartOfferCopy(): string {
  const offer = getFeatureValue_CACHED_MAY_BE_STALE<{ offer?: unknown }>('tengu_fancy_wand_copy', {}).offer;
  return typeof offer === 'string' && offer !== '' ? offer : '/restart to apply';
}

function isRestartOfferAvailable(): boolean {
  if (getIsRemoteMode()) {
    return false;
  }
  return updateCommand.isEnabled() || getFeatureValue_CACHED_MAY_BE_STALE('tengu_fancy_wand', false) === true;
}

function RestartPromptCopy(): React.ReactNode {
  return isRestartOfferAvailable() ? getRestartOfferCopy() : 'Restart to update';
}

type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
  withSeparator?: boolean;
  atPrompt?: boolean;
};

export function NativeAutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose,
  withSeparator,
  atPrompt,
}: Props): React.ReactNode {
  const [versions, setVersions] = useState<{
    current?: string | null;
    latest?: string | null;
  }>({ current: MACRO.VERSION });
  const [maxVersionIssue, setMaxVersionIssue] = useState<string | null>(null);
  const updateSemver = useUpdateNotification(autoUpdaterResult?.version);
  const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest';

  // Track latest isUpdating & autoUpdaterResult in refs so the memoized
  // checkForUpdates callback always sees fresh values without changing
  // callback identity (which would re-trigger the initial-check useEffect
  // and cause repeated downloads on remount — #22413).
  const isUpdatingRef = useRef(isUpdating);
  isUpdatingRef.current = isUpdating;
  const autoUpdaterResultRef = useRef(autoUpdaterResult);
  autoUpdaterResultRef.current = autoUpdaterResult;

  const checkForUpdates = React.useCallback(async () => {
    if (isUpdatingRef.current) {
      return;
    }

    if (autoUpdaterResultRef.current?.status === 'success') {
      return;
    }

    if (isAutoUpdaterDisabled()) {
      return;
    }

    // Check if current version is above the max allowed version
    const maxVersion = await getMaxVersion().catch(() => undefined);
    if (maxVersion && gt(MACRO.VERSION, maxVersion)) {
      const msg = await getMaxVersionMessage().catch(() => undefined);
      setMaxVersionIssue(msg ?? 'affects your version');
    }

    if (shouldThrottleAutoUpdateCheck()) {
      return;
    }

    onChangeIsUpdating(true);
    const startTime = Date.now();

    // Log the start of an auto-update check for funnel analysis
    logEvent('tengu_native_auto_updater_start', {});

    try {
      const result = await installLatest(channel);
      const currentVersion = MACRO.VERSION;
      const latencyMs = Date.now() - startTime;

      // Handle lock contention gracefully - just return without treating as error
      if (result.lockFailed) {
        logEvent('tengu_native_auto_updater_lock_contention', {
          latency_ms: latencyMs,
        });
        return; // Silently skip this update check, will try again later
      }

      // Update versions for display
      setVersions({ current: currentVersion, latest: result.latestVersion });

      const skippedUnverifiedRelease =
        'skippedUnverifiedRelease' in result &&
        Boolean((result as { skippedUnverifiedRelease?: boolean }).skippedUnverifiedRelease);
      logEvent(
        getNativeUpdateOutcomeEvent({
          wasUpdated: result.wasUpdated,
          skippedUnverifiedRelease,
        }),
        {
          latency_ms: latencyMs,
        },
      );

      if (result.wasUpdated) {
        saveLastUpdateResult({
          timestamp: new Date().toISOString(),
          path: 'native',
          outcome: 'success',
          status: 'success',
          version_from: currentVersion,
          version_to: result.latestVersion ?? null,
          error_code: null,
        });

        onAutoUpdaterResult({
          version: result.latestVersion,
          status: 'success',
        });
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logForDebugging(`Native auto-updater failed: ${errorMessage}`, { level: 'error' });
      logError(error);

      const failureHint = isRegistrySessionRefusedError(error) ? 'registry_session_refused' : undefined;
      saveLastUpdateResult({
        timestamp: new Date().toISOString(),
        path: 'native',
        outcome: 'failed',
        status: failureHint === undefined ? 'install_failed' : 'session_refused',
        version_from: MACRO.VERSION,
        version_to: null,
        error_code: failureHint === undefined ? null : 'update_session_refused',
      });

      const errorType = getErrorType(error);
      const errCode =
        error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'none';
      logEvent('tengu_native_auto_updater_fail', {
        latency_ms: latencyMs,
        error_code: errCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_timeout: errorType === 'timeout',
        error_checksum: errorType === 'checksum_mismatch',
        error_signature: errorType === 'signature_verification',
        error_not_found: errorType === 'not_found',
        error_permission: errorType === 'permission_denied',
        error_disk_full: errorType === 'disk_full',
        error_npm: errorType === 'npm_error',
        error_network: errorType === 'network_error',
        error_swap_failure: errorType === 'swap_failure',
        error_exec_format: errorType === 'exec_format',
        error_av_quarantine: errorType === 'av_quarantine',
      });

      onAutoUpdaterResult({
        version: null,
        status: 'install_failed',
        ...(failureHint ? { failureHint: failureHint as AutoUpdaterResult['failureHint'] } : {}),
      });
    } finally {
      onChangeIsUpdating(false);
    }
    // isUpdating intentionally omitted from deps; we read isUpdatingRef
    // instead so the guard is always current without changing callback
    // identity (which would re-trigger the initial-check useEffect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAutoUpdaterResult, channel]);

  // Initial check
  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  // Check every 30 minutes
  useInterval(checkForUpdates, 30 * 60 * 1000);

  const hasUpdateResult = !!autoUpdaterResult?.status;
  const hasVersionInfo = !!versions.current && !!versions.latest;
  const hasVisibleContent =
    verbose ||
    isUpdating ||
    (autoUpdaterResult?.status === 'success' && showSuccessMessage && !!updateSemver) ||
    autoUpdaterResult?.status === 'install_failed' ||
    (!!maxVersionIssue && process.env.USER_TYPE === 'ant');
  // Show the component when:
  // - warning banner needed (above max version), or
  // - there's an update result to display (success/error), or
  // - actively checking and we have version info to show
  const shouldRender = (!!maxVersionIssue || hasUpdateResult || (isUpdating && hasVersionInfo)) && hasVisibleContent;

  if (!shouldRender) {
    return null;
  }

  const channelDisplay = formatAutoUpdatesChannelDisplay(channel);

  return (
    <Box flexDirection="row" gap={1}>
      {withSeparator === undefined ? null : <Text dimColor>{withSeparator ? ' ·' : ''}</Text>}
      {verbose && (
        <Text dimColor wrap="truncate">
          current: {versions.current} &middot; {channelDisplay}: {versions.latest}
        </Text>
      )}
      {isUpdating ? (
        <Box>
          <Text dimColor wrap="truncate">
            Checking for updates…
          </Text>
        </Box>
      ) : (
        autoUpdaterResult?.status === 'success' &&
        showSuccessMessage &&
        updateSemver && (
          <Text color="success" wrap="truncate">
            <StatusIcon status="success" withSpace />
            Update installed · {atPrompt ? <RestartPromptCopy /> : 'Restart to update'}
          </Text>
        )
      )}
      {autoUpdaterResult?.status === 'install_failed' && (
        <Text color="error" wrap="truncate">
          <StatusIcon status="error" withSpace />
          Auto-update failed · Run <Text bold>claude doctor</Text>
        </Text>
      )}
      {maxVersionIssue && process.env.USER_TYPE === 'ant' && (
        <Text color="warning">
          ⚠ Known issue: {maxVersionIssue} &middot; Run <Text bold>claude rollback --safe</Text> to downgrade
        </Text>
      )}
    </Box>
  );
}
