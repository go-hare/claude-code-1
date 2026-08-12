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
import { type ConsentBaseline, hasDangerousSettingsChangedAgainstBaseline } from './orgConsent.js';

export type SecurityCheckResult =
  | 'approved'
  | 'rejected'
  | 'no_check_needed'
  // Official 2.1.207: non-interactive (-p/SDK) runs must not permanently
  // record consent for dangerous managed settings that never showed a dialog.
  | 'deferred_non_interactive'
  // densable YXd: interactive session without a dialog surface / callback
  | 'deferred_no_consent_surface';

/**
 * densable showSecurityDialog — optional consent surface.
 * When omitted after interactive+need-check, YXd returns deferred_no_consent_surface.
 */
export type ShowSecurityDialog = (
  settings: SettingsJson,
  hasActiveInkSurface: boolean,
) => Promise<'approved' | 'rejected'>;

/**
 * densable default dialog surface (blocking Ink render).
 * Used by startup load when a surface is available.
 */
export async function showManagedSettingsSecurityDialog(
  settings: SettingsJson,
  _hasActiveInkSurface: boolean,
): Promise<'approved' | 'rejected'> {
  return new Promise<'approved' | 'rejected'>(resolve => {
    void (async () => {
      const { unmount } = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <ManagedSettingsSecurityDialog
              settings={settings}
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
 * Check if new remote managed settings contain dangerous settings that require user approval.
 *
 * densable YXd algorithm (2.1.224):
 * 1. no dangerous → no_check_needed
 * 2. unchanged vs baseline → no_check_needed
 * 3. non-interactive → deferred_non_interactive
 * 4. no showSecurityDialog surface → deferred_no_consent_surface
 * 5. else call surface
 *
 * densable 2.1.224 #24: prefer org_record / consented_payload baseline so
 * re-login does not re-prompt when the org dangerous projection is unchanged.
 */
export async function checkManagedSettingsSecurity(
  cachedSettings: SettingsJson | null,
  newSettings: SettingsJson | null,
  consentBaseline?: ConsentBaseline | null,
  showSecurityDialog?: ShowSecurityDialog,
): Promise<SecurityCheckResult> {
  // If new settings don't have dangerous settings, no check needed
  if (!newSettings || !hasDangerousSettings(extractDangerousSettings(newSettings))) {
    return 'no_check_needed';
  }

  // densable BXd — org hash / consented payload compare first
  const changed = consentBaseline
    ? hasDangerousSettingsChangedAgainstBaseline(consentBaseline, newSettings)
    : hasDangerousSettingsChanged(cachedSettings, newSettings);
  if (!changed) {
    return 'no_check_needed';
  }

  // Official 2.1.207 / densable b2(): do not treat non-interactive as consented.
  if (!getIsInteractive()) {
    return 'deferred_non_interactive';
  }

  // densable YXd: r === void 0 → deferred_no_consent_surface
  // (no registered ink surface / no caller-provided dialog)
  if (showSecurityDialog === undefined) {
    return 'deferred_no_consent_surface';
  }

  // Log that dialog is being shown
  logEvent('tengu_managed_settings_security_dialog_shown', {});

  // densable msf managed-settings → Needs input on bg job list
  void import('../../utils/bgNeedsInputBridge.js').then(m => {
    if (!m.isBgJobSession()) return;
    m.ensureBgNeedsPermissionBridge();
    m.emitBgNeedsInput(m.MANAGED_SETTINGS_NEEDS, 'managed-settings');
  });

  // densable: hasActiveInk = Up.has(process.stdout); local has no iQs registry —
  // pass false (blocking standalone render path).
  const result = await showSecurityDialog(newSettings, false);
  return result;
}

/**
 * densable JXd — handle the security check result by exiting if rejected
 * Returns true if we should continue, false if we should stop
 */
export function handleSecurityCheckResult(result: SecurityCheckResult): boolean {
  if (result === 'rejected') {
    gracefulShutdownSync(1);
    return false;
  }
  if (result === 'deferred_no_consent_surface') {
    return false;
  }
  return true;
}
