import { feature } from 'bun:bundle';
import * as React from 'react';
import type { AutoUpdaterResult } from '../utils/autoUpdater.js';
import { isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getCurrentInstallationType } from '../utils/doctorDiagnostic.js';
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
};

/** densable 2.1.238 DGT — first auto-update check waits until ~10s uptime. */
export const UPDATE_CHECK_STARTUP_DELAY_MS = 10_000;

/** densable 2.1.238 kOl — remaining delay before first check may run. */
export function getUpdateCheckStartupDelayMs(uptimeSeconds: number = process.uptime()): number {
  return Math.max(0, UPDATE_CHECK_STARTUP_DELAY_MS - uptimeSeconds * 1000);
}

export function AutoUpdaterWrapper({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose,
}: Props): React.ReactNode {
  const [useNativeInstaller, setUseNativeInstaller] = React.useState<boolean | null>(null);
  const [isPackageManager, setIsPackageManager] = React.useState<boolean | null>(null);
  // densable kOl: hold mounting Updater until startup delay elapses
  const [startupDelayDone, setStartupDelayDone] = React.useState(() => getUpdateCheckStartupDelayMs() === 0);

  React.useEffect(() => {
    if (startupDelayDone) return;
    const remaining = getUpdateCheckStartupDelayMs();
    if (remaining <= 0) {
      setStartupDelayDone(true);
      return;
    }
    const timer = setTimeout(() => setStartupDelayDone(true), remaining);
    return () => clearTimeout(timer);
  }, [startupDelayDone]);

  React.useEffect(() => {
    async function checkInstallation() {
      // Skip installation type detection if auto-updates are disabled (ant-only)
      // This avoids potentially slow package manager detection (spawnSync calls)
      if (feature('SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED') && isAutoUpdaterDisabled()) {
        logForDebugging('AutoUpdaterWrapper: Skipping detection, auto-updates disabled');
        return;
      }

      const installationType = await getCurrentInstallationType();
      logForDebugging(`AutoUpdaterWrapper: Installation type: ${installationType}`);
      setUseNativeInstaller(installationType === 'native');
      setIsPackageManager(installationType === 'package-manager');
    }

    void checkInstallation();
  }, []);

  // Don't render until we know the installation type and startup delay has elapsed
  if (!startupDelayDone || useNativeInstaller === null || isPackageManager === null) {
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
      />
    );
  }

  const Updater = useNativeInstaller ? NativeAutoUpdater : AutoUpdater;

  return (
    <Updater
      verbose={verbose}
      onAutoUpdaterResult={onAutoUpdaterResult}
      autoUpdaterResult={autoUpdaterResult}
      isUpdating={isUpdating}
      onChangeIsUpdating={onChangeIsUpdating}
      showSuccessMessage={showSuccessMessage}
    />
  );
}
