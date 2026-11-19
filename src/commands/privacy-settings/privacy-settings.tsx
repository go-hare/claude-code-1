import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Byline, Dialog, KeyboardShortcutHint, Link, Text, useInput } from '@anthropic/ink';
import { type GroveDecision, GroveDialog } from '../../components/grove/Grove.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import {
  type AccountSettings,
  getGroveNoticeConfig,
  getGroveSettings,
  isQualifiedForGrove,
  updateGroveSettings,
} from '../../services/api/grove.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getClaudeAIOAuthTokens, getOauthAccountInfo } from '../../utils/auth.js';
import { getSecureStorage } from '../../utils/secureStorage/index.js';

const PRIVACY_SETTINGS_URL = 'https://claude.ai/settings/data-privacy-controls';
const FALLBACK_MESSAGE = `Review and manage your privacy settings at ${PRIVACY_SETTINGS_URL}`;
const FETCH_ERROR_MESSAGE = `Unable to fetch your privacy settings at this time. Check ${PRIVACY_SETTINGS_URL}`;
const ACCOUNT_CHANGED_MESSAGE = 'The signed-in account changed.';
const SAVE_FAILED_MESSAGE = "Couldn't save your privacy setting.";

export type AccountSnapshot = {
  accessToken?: string;
  accountUuid?: string;
};

export type AccountCheckResult = 'same' | 'changed' | 'unconfirmed';

/**
 * Official 2.1.326 #72: capture the active OAuth account identity when
 * `/privacy-settings` opens so we refuse to save onto a different account if
 * another terminal signed in while the dialog was open.
 */
export async function capturePrivacyAccountSnapshot(): Promise<AccountSnapshot | undefined> {
  try {
    const held = getClaudeAIOAuthTokens();
    const storage = getSecureStorage();
    storage.invalidateCache?.();
    const stored = (await storage.readAsync())?.claudeAiOauth as
      | { accessToken?: string; accountUuid?: string }
      | undefined;
    const oauthInfo = getOauthAccountInfo();
    const accessToken = held?.accessToken ?? stored?.accessToken;
    const accountUuid =
      (held as { accountUuid?: string } | null)?.accountUuid ?? stored?.accountUuid ?? oauthInfo?.accountUuid;
    return { accessToken, accountUuid };
  } catch {
    return undefined;
  }
}

export async function verifyPrivacyAccountUnchanged(
  openedWith: AccountSnapshot | undefined,
  captureFn: () => Promise<AccountSnapshot | undefined> = capturePrivacyAccountSnapshot,
): Promise<AccountCheckResult> {
  if (!openedWith) return 'unconfirmed';
  const current = await captureFn();
  if (!current) return 'unconfirmed';
  if (openedWith.accountUuid && current.accountUuid && current.accountUuid !== openedWith.accountUuid) {
    return 'changed';
  }
  if (
    openedWith.accessToken &&
    current.accessToken &&
    current.accessToken !== openedWith.accessToken &&
    current.accountUuid !== openedWith.accountUuid
  ) {
    return 'changed';
  }
  if (!current.accessToken && !current.accountUuid) {
    return 'changed';
  }
  return 'same';
}

/**
 * Official 2.1.326 #71 & #72: serialized toggle controller for `/privacy-settings`.
 * - Serializes rapid presses so the last displayed value is always what gets saved.
 * - Ignores keystrokes once closed (Esc) so trailing keys cannot mutate settings.
 * - Verifies account identity before each save and reports save errors.
 */
export function createSerializedPrivacyToggleController(deps: {
  initialEnabled: boolean;
  confirmSave: () => Promise<{ ok: boolean; error?: string }>;
  saveSetting: (enabled: boolean) => Promise<void>;
  onStateChange: (state: { enabled: boolean; saving: boolean; error: string | null }) => void;
  onChoose: (enabled: boolean) => void;
}) {
  let displayed = deps.initialEnabled;
  let closed = false;
  let inFlight = false;
  let pendingTarget: boolean | undefined;
  let lastSaved = deps.initialEnabled;

  async function drain(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      while (pendingTarget !== undefined) {
        const target = pendingTarget;
        pendingTarget = undefined;
        const check = await deps.confirmSave();
        if (!check.ok) {
          displayed = lastSaved;
          pendingTarget = undefined;
          deps.onStateChange({
            enabled: displayed,
            saving: false,
            error: check.error ?? SAVE_FAILED_MESSAGE,
          });
          return;
        }
        try {
          await deps.saveSetting(target);
          lastSaved = target;
          deps.onChoose(target);
          deps.onStateChange({ enabled: displayed, saving: pendingTarget !== undefined, error: null });
        } catch (err) {
          displayed = lastSaved;
          pendingTarget = undefined;
          const detail = err instanceof Error && err.message ? ` ${err.message}` : '';
          deps.onStateChange({
            enabled: displayed,
            saving: false,
            error: `${SAVE_FAILED_MESSAGE}${detail}`,
          });
          return;
        }
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    toggle(): Promise<void> {
      if (closed) return Promise.resolve();
      displayed = !displayed;
      pendingTarget = displayed;
      deps.onChoose(displayed);
      deps.onStateChange({ enabled: displayed, saving: true, error: null });
      return drain();
    },
    close(): void {
      closed = true;
      pendingTarget = undefined;
    },
    isClosed(): boolean {
      return closed;
    },
    getDisplayed(): boolean {
      return displayed;
    },
  };
}

function HardenedPrivacySettingsDialog({
  settings,
  domainExcluded,
  lockedByClaudeScience,
  confirmSave,
  onChoose,
  onDone,
}: {
  settings: AccountSettings;
  domainExcluded?: boolean;
  lockedByClaudeScience?: boolean;
  confirmSave: () => Promise<{ ok: boolean; error?: string }>;
  onChoose: (enabled: boolean) => void;
  onDone: () => void;
}): React.ReactNode {
  const [groveEnabled, setGroveEnabled] = useState(Boolean(settings.grove_enabled));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const locked = Boolean(domainExcluded || lockedByClaudeScience);

  const controllerRef = useRef<ReturnType<typeof createSerializedPrivacyToggleController> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createSerializedPrivacyToggleController({
      initialEnabled: Boolean(settings.grove_enabled),
      confirmSave,
      saveSetting: async enabled => {
        await updateGroveSettings(enabled);
      },
      onStateChange: state => {
        setGroveEnabled(state.enabled);
        setSaving(state.saving);
        setSaveError(state.error);
      },
      onChoose,
    });
  }

  useEffect(() => {
    logEvent('tengu_grove_privacy_settings_viewed', {});
    return () => {
      controllerRef.current?.close();
    };
  }, []);

  const handleCancel = useCallback(() => {
    controllerRef.current?.close();
    onDone();
  }, [onDone]);

  useInput((input, key) => {
    if (controllerRef.current?.isClosed()) return;
    if (!locked && (key.tab || key.return || input === ' ')) {
      void controllerRef.current?.toggle();
    }
  });

  let valueComponent = <Text color="error">false</Text>;
  if (lockedByClaudeScience) {
    valueComponent = <Text dimColor>false</Text>;
  } else if (domainExcluded) {
    valueComponent = <Text color="error">false (for emails with your domain)</Text>;
  } else if (groveEnabled) {
    valueComponent = <Text color="success">true</Text>;
  }

  return (
    <Dialog
      title="Data privacy"
      color="professionalBlue"
      onCancel={handleCancel}
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : locked ? (
          <KeyboardShortcutHint shortcut="Esc" action="cancel" />
        ) : (
          <Byline>
            <KeyboardShortcutHint shortcut="Enter/Tab/Space" action="toggle" />
            <KeyboardShortcutHint shortcut="Esc" action="cancel" />
          </Byline>
        )
      }
    >
      <Text>
        Review and manage your privacy settings at <Link url={PRIVACY_SETTINGS_URL} />
      </Text>

      <Box flexDirection="column">
        <Box gap={1}>
          <Box width={43}>
            <Text bold>Help improve our AI models</Text>
          </Box>
          <Box minWidth={5}>
            {valueComponent}
            {saving && <Text dimColor> (saving…)</Text>}
          </Box>
        </Box>
        {lockedByClaudeScience && <Text dimColor>Not available for this account.</Text>}
        {saveError && <Text color="error">{saveError}</Text>}
      </Box>
    </Dialog>
  );
}

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode | null> {
  const qualified = await isQualifiedForGrove();
  if (!qualified) {
    onDone(FALLBACK_MESSAGE);
    return null;
  }

  const openedAccount = await capturePrivacyAccountSnapshot();

  getGroveSettings.cache.clear?.();
  getGroveNoticeConfig.cache.clear?.();
  const [settingsResult, configResult] = await Promise.all([getGroveSettings(), getGroveNoticeConfig()]);
  // Hide dialog on API failure (after retry)
  if (!settingsResult.success || !configResult.success) {
    onDone(FETCH_ERROR_MESSAGE);
    return null;
  }
  const settings = settingsResult.data;
  const config = configResult.data;

  let chosenValue: boolean | undefined;
  let failedReason: string | undefined;
  let active = true;

  async function confirmSave(): Promise<{ ok: boolean; error?: string }> {
    if (!active || failedReason) {
      return { ok: false, error: failedReason };
    }
    const status = await verifyPrivacyAccountUnchanged(openedAccount);
    if (status === 'same') {
      return { ok: true };
    }
    const prefix = status === 'changed' ? ACCOUNT_CHANGED_MESSAGE : '';
    failedReason = `${prefix} ${SAVE_FAILED_MESSAGE}`.trim();
    return { ok: false, error: failedReason };
  }

  async function onDoneWithDecision(decision: GroveDecision) {
    if (!failedReason && (decision === 'escape' || decision === 'defer')) {
      active = false;
      onDone('Privacy settings dialog dismissed', {
        display: 'system',
      });
      return;
    }
    if (decision === 'accept_opt_in' || decision === 'accept_opt_out') {
      if (failedReason) return;
      chosenValue = decision === 'accept_opt_in';
    }
    await onDoneWithSettingsCheck();
  }

  async function onDoneWithSettingsCheck() {
    if (!active) return;
    active = false;
    if (failedReason) {
      onDone(failedReason);
      return;
    }

    // Official 2.1.326 #72: verify signed-in account didn't change before reporting status.
    const accountStatus = await verifyPrivacyAccountUnchanged(openedAccount);
    if (accountStatus !== 'same') {
      onDone(accountStatus === 'changed' ? `${ACCOUNT_CHANGED_MESSAGE} ${FALLBACK_MESSAGE}` : FETCH_ERROR_MESSAGE, {
        display: 'system',
      });
      return;
    }

    // Official 2.1.326 #73: clear cached getGroveSettings() before re-reading so
    // picking OFF right after ON never reports stale "set to true".
    getGroveSettings.cache.clear?.();
    const updatedSettingsResult = await getGroveSettings();
    if (!updatedSettingsResult.success) {
      onDone(
        chosenValue === undefined
          ? FETCH_ERROR_MESSAGE
          : "Couldn't confirm your privacy setting was saved · /privacy-settings to check",
        {
          display: 'system',
        },
      );
      return;
    }
    const updatedSettings = updatedSettingsResult.data;
    if (updatedSettings.grove_enabled === null) {
      onDone(chosenValue === undefined ? FALLBACK_MESSAGE : SAVE_FAILED_MESSAGE);
      return;
    }
    const groveStatus = updatedSettings.grove_enabled ? 'true' : 'false';
    if (chosenValue !== undefined && chosenValue !== updatedSettings.grove_enabled) {
      onDone(
        `Couldn't save your choice, so "Help improve our AI models" is still ${groveStatus} · /privacy-settings to try again`,
      );
    } else {
      onDone(`"Help improve our AI models" set to ${groveStatus}.`);
    }
    if (
      chosenValue !== undefined &&
      settings.grove_enabled !== null &&
      settings.grove_enabled !== updatedSettings.grove_enabled
    ) {
      logEvent('tengu_grove_policy_toggled', {
        state: updatedSettings.grove_enabled as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        location: 'settings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }
  }

  // Show privacy settings directly if the user has already accepted the terms.
  if (settings.grove_enabled !== null) {
    return (
      <HardenedPrivacySettingsDialog
        settings={settings}
        domainExcluded={config?.domain_excluded}
        confirmSave={confirmSave}
        onChoose={val => {
          chosenValue = val;
        }}
        onDone={() => {
          void onDoneWithSettingsCheck();
        }}
      />
    );
  }

  // Show the GroveDialog for users who haven't accepted terms yet
  return <GroveDialog showIfAlreadyViewed={true} onDone={onDoneWithDecision} location={'settings'} />;
}
