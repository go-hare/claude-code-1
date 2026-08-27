import { instances, wrappedRender as render } from '@anthropic/ink';
import { getIsInteractive } from '../../bootstrap/state.js';
import { ManagedSettingsSecurityDialog } from '../../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.js';
import {
  extractDangerousSettings,
  hasDangerousSettings,
  hasDangerousSettingsChanged,
} from '../../components/ManagedSettingsSecurityDialog/utils.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { AppStateProvider } from '../../state/AppState.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { logError } from '../../utils/log.js';
import { getBaseRenderOptions } from '../../utils/renderOptions.js';
import type { SettingsJson } from '../../utils/settings/types.js';
import { logEvent } from '../analytics/index.js';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../analytics/metadata.js';
import {
  getManagedSettingsConsentRegistry,
  waitForManagedSettingsRequester,
  type ManagedSettingsConsentResult,
} from './consentRequester.js';
import { type ConsentBaseline, hasDangerousSettingsChangedAgainstBaseline } from './orgConsent.js';

export type SecurityCheckResult =
  | 'approved'
  | 'rejected'
  | 'no_check_needed'
  // Official 2.1.207: non-interactive (-p/SDK) runs must not permanently
  // record consent for dangerous managed settings that never showed a dialog.
  | 'deferred_non_interactive'
  // densable YXd: interactive session without a dialog surface / callback
  | 'deferred_no_consent_surface'
  // densable X2m supersede — newer fetch took over pending review
  | 'superseded';

/**
 * densable showSecurityDialog — optional consent surface.
 * When omitted after interactive+need-check, YXd returns deferred_no_consent_surface.
 */
export type ShowSecurityDialog = (
  settings: SettingsJson,
  hasActiveInkSurface: boolean,
) => Promise<'approved' | 'rejected'>;

/**
 * densable mSs / showStandaloneSecurityDialog.
 * hasActiveInkSurface true → rerender(null) on answer (keep Ink instance for
 * createRoot); false → unmount (standalone claim path).
 * densable Te(err) on unanswered / render failure → tip logError.
 */
export async function showManagedSettingsSecurityDialog(
  settings: SettingsJson,
  hasActiveInkSurface: boolean,
): Promise<'approved' | 'rejected'> {
  return new Promise<'approved' | 'rejected'>((resolve, reject) => {
    let answered = false;
    void (async () => {
      const { rerender, unmount, waitUntilExit } = await render(
        <AppStateProvider>
          <KeybindingSetup>
            <ManagedSettingsSecurityDialog
              key="managed-settings-security"
              settings={settings}
              onAccept={() => {
                answered = true;
                void import('../../utils/bgNeedsInputBridge.js').then(m => {
                  m.emitBgNeedsInput(null, 'managed-settings');
                });
                resolve('approved');
                if (hasActiveInkSurface) {
                  rerender(null);
                } else {
                  unmount();
                }
              }}
              onReject={() => {
                answered = true;
                void import('../../utils/bgNeedsInputBridge.js').then(m => {
                  m.emitBgNeedsInput(null, 'managed-settings');
                });
                resolve('rejected');
                if (hasActiveInkSurface) {
                  rerender(null);
                } else {
                  unmount();
                }
              }}
            />
          </KeybindingSetup>
        </AppStateProvider>,
        getBaseRenderOptions(false),
      );
      await waitUntilExit();
      if (!answered) {
        const err = new Error('Managed-settings consent dialog exited without an answer');
        logError(err);
        reject(err);
      }
    })().catch(err => {
      logError(err);
      reject(err);
    });
  });
}

/**
 * densable Q2m — managed-settings security check with Ink surface negotiation.
 *
 * 1. no dangerous / unchanged → no_check_needed
 * 2. non-interactive → deferred_non_interactive
 * 3. replRequester → review (same Ink)
 * 4. Yp.has(stdout) → wait requester 5s → review
 * 5. no showSecurityDialog → deferred_no_consent_surface
 * 6. else showSecurityDialog; claimForStandaloneRender only when !hasInk
 */
export async function checkManagedSettingsSecurity(
  cachedSettings: SettingsJson | null,
  newSettings: SettingsJson | null,
  consentBaseline?: ConsentBaseline | null,
  showSecurityDialog?: ShowSecurityDialog,
): Promise<SecurityCheckResult> {
  if (!newSettings || !hasDangerousSettings(extractDangerousSettings(newSettings))) {
    return 'no_check_needed';
  }

  const changed = consentBaseline
    ? hasDangerousSettingsChangedAgainstBaseline(consentBaseline, newSettings)
    : hasDangerousSettingsChanged(cachedSettings, newSettings);
  if (!changed) {
    return 'no_check_needed';
  }

  if (!getIsInteractive()) {
    return 'deferred_non_interactive';
  }

  const reg = getManagedSettingsConsentRegistry();
  if (reg.replRequester) {
    return reg.review(reg.replRequester, newSettings);
  }

  if (instances.has(process.stdout)) {
    const requester = await waitForManagedSettingsRequester();
    if (requester) {
      return reg.review(requester, newSettings);
    }
  }

  if (showSecurityDialog === undefined) {
    return 'deferred_no_consent_surface';
  }

  logEvent('tengu_managed_settings_security_dialog_shown', {});

  void import('../../utils/bgNeedsInputBridge.js').then(m => {
    if (!m.isBgJobSession()) return;
    m.ensureBgNeedsPermissionBridge();
    m.emitBgNeedsInput(m.MANAGED_SETTINGS_NEEDS, 'managed-settings');
  });

  const hasActiveInk = instances.has(process.stdout);
  const dialogPromise = showSecurityDialog(newSettings, hasActiveInk);
  if (!hasActiveInk) {
    instances.claimForStandaloneRender(dialogPromise);
  }

  let result: 'approved' | 'rejected';
  try {
    result = await dialogPromise;
  } catch (err) {
    logEvent('tengu_feature_bad', {
      feature_name:
        'remote_managed_settings_security_check' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code: 'dialog_unavailable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    throw err;
  }

  logEvent(
    result === 'approved'
      ? 'tengu_managed_settings_security_dialog_accepted'
      : 'tengu_managed_settings_security_dialog_rejected',
    {},
  );
  if (result === 'approved') {
    logEvent('tengu_feature_ok', {
      feature_name:
        'remote_managed_settings_security_check' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
  }
  return result;
}

/**
 * densable eBm / JXd — handle the security check result by exiting if rejected
 * Returns true if we should continue, false if we should stop
 */
export function handleSecurityCheckResult(result: SecurityCheckResult): boolean {
  switch (result) {
    case 'rejected':
      gracefulShutdownSync(1);
      return false;
    case 'deferred_no_consent_surface':
    case 'superseded':
      return false;
    case 'approved':
    case 'no_check_needed':
    case 'deferred_non_interactive':
      return true;
  }
}

/** densable Z2m — loading barrier should not fire while standalone dialog pending */
export function isPendingStandaloneManagedSettingsRender(): boolean {
  return instances.pendingStandaloneRender !== null;
}

export type { ManagedSettingsConsentResult };
