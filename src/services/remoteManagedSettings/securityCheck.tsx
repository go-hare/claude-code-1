import { getIsInteractive } from '../../bootstrap/state.js';
import { ManagedSettingsSecurityDialog } from '../../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.js';
import {
  extractDangerousSettings,
  hasDangerousSettings,
  hasDangerousSettingsChanged,
} from '../../components/ManagedSettingsSecurityDialog/utils.js';
import { wrappedRender as render } from '@anthropic/ink';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { AppStateProvider } from '../../state/AppState.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { getBaseRenderOptions } from '../../utils/renderOptions.js';
import type { SettingsJson } from '../../utils/settings/types.js';
import { logEvent } from '../analytics/index.js';

export type SecurityCheckResult =
  | 'approved'
  | 'rejected'
  | 'no_check_needed'
  // Official 2.1.207: non-interactive (-p/SDK) runs must not permanently
  // record consent for dangerous managed settings that never showed a dialog.
  | 'deferred_non_interactive';

/**
 * Check if new remote managed settings contain dangerous settings that require user approval.
 * Shows a blocking dialog if dangerous settings have changed or been added.
 *
 * @param cachedSettings The current cached settings (may be null for first run)
 * @param newSettings The new settings fetched from the API
 * @returns 'approved' if user accepts, 'rejected' if user declines,
 *   'no_check_needed' if no dangerous changes,
 *   'deferred_non_interactive' if dangerous changes exist but no UI can be shown
 */
export async function checkManagedSettingsSecurity(
  cachedSettings: SettingsJson | null,
  newSettings: SettingsJson | null,
): Promise<SecurityCheckResult> {
  // If new settings don't have dangerous settings, no check needed
  if (!newSettings || !hasDangerousSettings(extractDangerousSettings(newSettings))) {
    return 'no_check_needed';
  }

  // If dangerous settings haven't changed, no check needed
  if (!hasDangerousSettingsChanged(cachedSettings, newSettings)) {
    return 'no_check_needed';
  }

  // Official 2.1.207: do not treat non-interactive as consented.
  // Apply for this run only; leave the disk cache un-consented so the next
  // interactive session still shows the security dialog.
  if (!getIsInteractive()) {
    return 'deferred_non_interactive';
  }

  // Log that dialog is being shown
  logEvent('tengu_managed_settings_security_dialog_shown', {});

  // densable msf managed-settings → Needs input on bg job list
  void import('../../utils/bgNeedsInputBridge.js').then(m => {
    if (!m.isBgJobSession()) return;
    m.ensureBgNeedsPermissionBridge();
    m.emitBgNeedsInput(m.MANAGED_SETTINGS_NEEDS, 'managed-settings');
  });

  // Show blocking dialog
  return new Promise<SecurityCheckResult>(resolve => {
    void (async () => {
      const { unmount } = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <ManagedSettingsSecurityDialog
              settings={newSettings}
              onAccept={() => {
                logEvent('tengu_managed_settings_security_dialog_accepted', {});
                void import('../../utils/bgNeedsInputBridge.js').then(m => {
                  m.emitBgNeedsInput(null, 'managed-settings');
                });
                unmount();
                void resolve('approved');
              }}
              onReject={() => {
                logEvent('tengu_managed_settings_security_dialog_rejected', {});
                void import('../../utils/bgNeedsInputBridge.js').then(m => {
                  m.emitBgNeedsInput(null, 'managed-settings');
                });
                unmount();
                void resolve('rejected');
              }}
            />
          </KeybindingSetup>
        </AppStateProvider>,
        getBaseRenderOptions(false),
      );
    })();
  });
}

/**
 * Handle the security check result by exiting if rejected
 * Returns true if we should continue, false if we should stop
 */
export function handleSecurityCheckResult(result: SecurityCheckResult): boolean {
  if (result === 'rejected') {
    gracefulShutdownSync(1);
    return false;
  }
  return true;
}
