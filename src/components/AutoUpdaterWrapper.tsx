import * as React from 'react';
import type { AutoUpdaterResult } from '../utils/autoUpdater.js';
import { logForDebugging } from '../utils/debug.js';
import { getCurrentInstallationType } from '../utils/doctorDiagnostic.js';
import { leftoverY } from '../utils/leftoverOt.js';
import { AutoUpdater } from './AutoUpdater.js';
import { NativeAutoUpdater } from './NativeAutoUpdater.js';
import { PackageManagerAutoUpdater } from './PackageManagerAutoUpdater.js';

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

/** densable 2.1.238 DGT — first auto-update check waits until ~10s uptime. */
export const UPDATE_CHECK_STARTUP_DELAY_MS = 10_000;

/** densable 2.1.238 kOl — remaining delay before first check may run. */
export function getUpdateCheckStartupDelayMs(uptimeSeconds: number = process.uptime()): number {
  return Math.max(0, UPDATE_CHECK_STARTUP_DELAY_MS - uptimeSeconds * 1000);
}

let hasAttemptedDetectionInProcess = false;

export function AutoUpdaterWrapper({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose,
  withSeparator,
  atPrompt,
}: Props): React.ReactNode {
  const [useNativeInstaller, setUseNativeInstaller] = React.useState<boolean | null>(null);
  const [isPackageManager, setIsPackageManager] = React.useState<boolean | null>(null);
  const [delayMs] = React.useState<number>(() => getUpdateCheckStartupDelayMs());

  React.useEffect(() => {
    let cancelled = false;

    async function checkInstallation() {
      const firstInProcess = !hasAttemptedDetectionInProcess;
      hasAttemptedDetectionInProcess = true;
      const startTime = Date.now();
      const installationType = await getCurrentInstallationType();
      leftoverY('update_detection', {
        duration_ms: Date.now() - startTime,
        first_in_process: firstInProcess,
        installation_type: installationType,
      });
      logForDebugging(`AutoUpdaterWrapper: Installation type: ${installationType}`);
      if (cancelled) {
        return;
      }
      setUseNativeInstaller(installationType === 'native');
      setIsPackageManager(installationType === 'package-manager');
    }

    if (delayMs <= 0) {
      void checkInstallation();
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(() => {
      void checkInstallation();
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [delayMs]);

  // Don't render until we know the installation type
  if (useNativeInstaller === null || isPackageManager === null) {
    return null;
  }

  if (isPackageManager) {
    return (
      <PackageManagerAutoUpdater
        verbose={verbose}
        onAutoUpdaterResult={onAutoUpdaterResult}
        autoUpdaterResult={autoUpdaterResult}
        isUpdating={isUpdating}
        onChangeIsUpdating={onChangeIsUpdating}
        showSuccessMessage={showSuccessMessage}
        withSeparator={withSeparator}
      />
    );
  }

  const sharedProps = {
    verbose,
    onAutoUpdaterResult,
    autoUpdaterResult,
    isUpdating,
    onChangeIsUpdating,
    showSuccessMessage,
    withSeparator,
  };

  return useNativeInstaller ? (
    <NativeAutoUpdater {...sharedProps} atPrompt={atPrompt} />
  ) : (
    <AutoUpdater {...sharedProps} />
  );
}
