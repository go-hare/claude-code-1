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
import {
  getClaudeAIOAuthTokens,
  getOauthAccountInfo,
  getOauthAccountInfoFromDisk,
  isClaudeAISubscriber,
} from '../../utils/auth.js';
import { getSecureStorage } from '../../utils/secureStorage/index.js';

const PRIVACY_SETTINGS_URL = 'https://claude.ai/settings/data-privacy-controls';
const FALLBACK_MESSAGE = `Review and manage your privacy settings at ${PRIVACY_SETTINGS_URL}`;
const FETCH_ERROR_MESSAGE = `Unable to fetch your privacy settings at this time. Check ${PRIVACY_SETTINGS_URL}`;
const ACCOUNT_CHANGED_MESSAGE = 'The signed-in account changed.';
const SAVE_FAILED_MESSAGE = "Couldn't save your privacy setting.";

export type AccountIdentity = {
  accessToken?: string;
  accountUuid?: string;
};

export type AccountSnapshot = {
  accessToken?: string;
  accountUuid?: string;
  held?: AccountIdentity | null;
  stored?: AccountIdentity | null;
  diskAccountUuid?: string;
};

export type AccountCheckResult = 'same' | 'changed' | 'unconfirmed';

/**
 * Official 2.1.328: capture both the process-held OAuth tokens and fresh live
 * secure-storage credentials so switching accounts in another terminal is
 * detected even while this process still holds the previous account in memory.
 */
export async function capturePrivacyAccountSnapshot(): Promise<AccountSnapshot | undefined> {
  try {
    const held = getClaudeAIOAuthTokens();
    const storage = getSecureStorage();
    storage.invalidateCache?.();
    const stored = (await storage.readAsync())?.claudeAiOauth as
      | { accessToken?: string; accountUuid?: string }
      | undefined;
    const diskAccountUuid = getOauthAccountInfoFromDisk()?.accountUuid ?? getOauthAccountInfo()?.accountUuid;
    const heldIdentity: AccountIdentity | null = held
      ? {
          accessToken: held.accessToken,
          accountUuid: (held as { accountUuid?: string }).accountUuid,
        }
      : null;
    const storedIdentity: AccountIdentity | null = stored
      ? {
          accessToken: stored.accessToken,
          accountUuid: stored.accountUuid,
        }
      : null;
    // Prefer live stored identity over stale in-process held identity for the
    // summary fields so callers inspecting the snapshot directly see live storage.
    const accessToken = storedIdentity?.accessToken ?? heldIdentity?.accessToken;
    const accountUuid =
      storedIdentity?.accountUuid ??
      (storedIdentity?.accessToken && storedIdentity.accessToken !== heldIdentity?.accessToken
        ? diskAccountUuid
        : undefined) ??
      heldIdentity?.accountUuid ??
      diskAccountUuid;
    return {
      accessToken,
      accountUuid,
      held: heldIdentity,
      stored: storedIdentity,
      diskAccountUuid,
    };
  } catch {
    return undefined;
  }
}

/**
 * Official 2.1.328 `R = k(l?.stored?.accountUuid)`: detects when live storage
 * has already switched to a different account before `/privacy-settings` opens.
 */
export function isPrivacyAccountChangedAtOpen(opened: AccountSnapshot | undefined): boolean {
  if (!opened) return false;
  const heldToken = opened.held?.accessToken;
  const heldUuid = opened.held?.accountUuid;
  const storedToken = opened.stored?.accessToken;
  const storedUuid =
    opened.stored?.accountUuid ??
    (storedToken && heldToken && storedToken !== heldToken ? opened.diskAccountUuid : undefined);
  const effectiveHeldUuid =
    heldUuid ?? (heldToken !== undefined && heldToken === storedToken ? opened.diskAccountUuid : undefined);
  return Boolean(storedUuid && effectiveHeldUuid && storedUuid !== effectiveHeldUuid);
}

export async function verifyPrivacyAccountUnchanged(
  openedWith: AccountSnapshot | undefined,
  captureFn: () => Promise<AccountSnapshot | undefined> = capturePrivacyAccountSnapshot,
): Promise<AccountCheckResult> {
  if (!openedWith) return 'unconfirmed';
  const current = await captureFn();
  if (!current) return 'unconfirmed';

  const openedHeld = openedWith.held;
  const openedStored = openedWith.stored;
  const openedAccessToken = openedHeld?.accessToken ?? openedWith.accessToken;
  const openedHeldUuid = openedHeld?.accountUuid;
  const openedAccountUuid =
    openedHeldUuid ??
    (openedAccessToken === (openedStored?.accessToken ?? openedWith.accessToken)
      ? (openedStored?.accountUuid ?? openedWith.diskAccountUuid ?? openedWith.accountUuid)
      : (openedWith.accountUuid ?? openedStored?.accountUuid ?? openedWith.diskAccountUuid));

  const isDifferentAccount = (uuid?: string): boolean =>
    Boolean(uuid && openedAccountUuid && uuid !== openedAccountUuid);

  const hasSplitIdentity =
    openedWith.held !== undefined ||
    openedWith.stored !== undefined ||
    current.held !== undefined ||
    current.stored !== undefined;

  if (hasSplitIdentity) {
    const currentHeld = current.held ?? undefined;
    const currentStored = current.stored ?? undefined;
    const currentStoredToken = currentStored?.accessToken;
    const currentStoredUuid =
      currentStored?.accountUuid ??
      (currentStoredToken && currentStoredToken !== openedAccessToken ? current.diskAccountUuid : undefined);

    // Official 2.1.328 `E()`: check live storage BEFORE trusting in-process held
    // tokens so an account switch in another terminal is never masked by stale `held`.
    if (isDifferentAccount(currentStoredUuid)) {
      return 'changed';
    }
    if (openedStored?.accessToken && !currentStoredToken && !current.diskAccountUuid) {
      return 'changed';
    }
    if (
      currentHeld &&
      (currentHeld.accessToken === openedAccessToken ||
        (openedHeldUuid && currentHeld.accountUuid === openedHeldUuid && isClaudeAISubscriber()))
    ) {
      return 'same';
    }
    const fallbackUuid = currentHeld?.accountUuid ?? current.diskAccountUuid ?? current.accountUuid;
    return isDifferentAccount(fallbackUuid) || (!currentHeld && !fallbackUuid) ? 'changed' : 'unconfirmed';
  }

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

export function HardenedPrivacySettingsDialog({
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
        const saved = await updateGroveSettings(enabled);
        // Official `X` @330053699: `pe = Ae ?? await h()` — on failure the
        // PATCH resolves `undefined` and the caller re-reads live settings;
        // if the effective value differs from the requested target the UI
        // shows SAVE_FAILED. `saved === false` is a server-side OFF, also a
        // mismatch vs an ON request (and vice-versa).
        const refreshed = await getGroveSettings();
        const effective = saved ?? (refreshed.success ? refreshed.data.grove_enabled : undefined) ?? undefined;
        if (effective !== enabled) {
          throw new Error("Couldn't save your choice. Please try again.");
        }
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
  const openedAccount = await capturePrivacyAccountSnapshot();
  if (!openedAccount || isPrivacyAccountChangedAtOpen(openedAccount)) {
    onDone(FALLBACK_MESSAGE);
    return null;
  }

  const qualified = await isQualifiedForGrove();
  if (!qualified) {
    onDone(FALLBACK_MESSAGE);
    return null;
  }

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
  let saveAttempted = false;
  let pendingCloseToken: symbol | undefined;

  async function confirmSave(): Promise<{ ok: boolean; error?: string }> {
    if (!active || failedReason) {
      return { ok: false, error: failedReason };
    }
    const status = await verifyPrivacyAccountUnchanged(openedAccount);
    if (status === 'same') {
      saveAttempted = true;
      return { ok: true };
    }
    const prefix = status === 'changed' ? ACCOUNT_CHANGED_MESSAGE : '';
    failedReason = `${prefix} ${SAVE_FAILED_MESSAGE}`.trim();
    return { ok: false, error: failedReason };
  }

  function onOffPicked() {
    if (pendingCloseToken) {
      pendingCloseToken = undefined;
      active = true;
    }
  }

  async function onDoneWithDecision(decision: GroveDecision) {
    if (!failedReason && (decision === 'escape' || decision === 'defer')) {
      if (!saveAttempted) {
        active = false;
        onDone('Privacy settings dialog dismissed', {
          display: 'system',
        });
      }
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

    const token = Symbol();
    pendingCloseToken = token;

    // Official 2.1.326 #72 & 2.1.328: verify signed-in account didn't change before reporting status.
    const accountStatus = await verifyPrivacyAccountUnchanged(openedAccount);
    if (pendingCloseToken !== token) return;
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
    if (pendingCloseToken !== token) return;
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
    const lockedByClaudeScience = config.grove_locked_by_claude_science === true;
    return (
      <HardenedPrivacySettingsDialog
        settings={settings}
        domainExcluded={config?.domain_excluded}
        lockedByClaudeScience={lockedByClaudeScience}
        confirmSave={confirmSave}
        onChoose={val => {
          chosenValue = val;
        }}
        onDone={
          lockedByClaudeScience
            ? () => {
                onDone(undefined, { display: 'skip' });
              }
            : () => {
                void onDoneWithSettingsCheck();
              }
        }
      />
    );
  }

  // Show the GroveDialog for users who haven't accepted terms yet
  return (
    <GroveDialog
      showIfAlreadyViewed={true}
      confirmSave={confirmSave}
      onOffPicked={onOffPicked}
      onDone={onDoneWithDecision}
      location={'settings'}
    />
  );
}
