import React, { useEffect, useRef, useState } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { Box, Link, StatusIcon, Text, useInput } from '@anthropic/ink';
import {
  type AccountSettings,
  calculateShouldShowGrove,
  type GroveConfig,
  getGroveNoticeConfig,
  getGroveSettings,
  markGroveNoticeViewed,
  updateGroveSettings,
} from '../../services/api/grove.js';
import { Select } from '../CustomSelect/index.js';
import { Byline, Dialog, KeyboardShortcutHint } from '@anthropic/ink';

export type GroveDecision = 'accept_opt_in' | 'accept_opt_out' | 'defer' | 'escape' | 'skip_rendering';

export type GroveConfirmSave = () => Promise<{ ok: boolean; error?: string }>;

export type GroveChoiceOutcome =
  | { kind: 'done'; decision: 'accept_opt_in' | 'accept_opt_out' | 'defer' | 'escape' }
  | { kind: 'blocked'; error: string }
  | { kind: 'already_off' }
  | { kind: 'superseded' };

/**
 * Official 2.1.328 `OEo` decision executor for initial Consumer Terms / Grove save:
 * - Runs pre-save `confirmSave` account verification before writing `accept_opt_in` / `accept_opt_out`.
 * - Passes `{ onlyIfUnset: true }` when saving `accept_opt_in` so ON cannot silently flip an account
 *   whose setting was already OFF elsewhere, returning `{ kind: 'already_off' }` when the server keeps OFF.
 */
export async function submitGroveDialogDecision(params: {
  value: 'accept_opt_in' | 'accept_opt_out' | 'defer' | 'escape';
  confirmSave?: GroveConfirmSave;
  onOffPicked?: () => void;
  isOffPicked: () => boolean;
  markOffPicked: () => void;
  noticeIsGracePeriod?: boolean;
  saveSetting?: (groveEnabled: boolean, options?: { onlyIfUnset?: boolean }) => Promise<boolean | undefined>;
}): Promise<GroveChoiceOutcome> {
  const {
    value,
    confirmSave,
    onOffPicked,
    isOffPicked,
    markOffPicked,
    noticeIsGracePeriod,
    saveSetting = updateGroveSettings,
  } = params;

  if (value === 'accept_opt_in' && isOffPicked()) {
    return { kind: 'superseded' };
  }
  if (value === 'accept_opt_out') {
    markOffPicked();
    onOffPicked?.();
  }
  if ((value === 'accept_opt_in' || value === 'accept_opt_out') && confirmSave) {
    const check = await confirmSave();
    if (!check.ok) {
      return {
        kind: 'blocked',
        error: check.error ?? "Couldn't save your choice. Please try again.",
      };
    }
  }

  switch (value) {
    case 'accept_opt_in': {
      if (isOffPicked()) {
        return { kind: 'superseded' };
      }
      const savedValue = await saveSetting(true, { onlyIfUnset: true });
      const alreadyOff = savedValue === false;
      logEvent('tengu_grove_policy_submitted', {
        state: !alreadyOff,
        dismissable: noticeIsGracePeriod as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      if (isOffPicked()) {
        return { kind: 'superseded' };
      }
      if (alreadyOff) {
        return { kind: 'already_off' };
      }
      break;
    }
    case 'accept_opt_out': {
      await saveSetting(false);
      logEvent('tengu_grove_policy_submitted', {
        state: false,
        dismissable: noticeIsGracePeriod as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      break;
    }
    case 'defer':
      logEvent('tengu_grove_policy_dismissed', {
        state: true,
      });
      break;
    case 'escape':
      logEvent('tengu_grove_policy_escaped', {});
      break;
  }

  return { kind: 'done', decision: value };
}

type Props = {
  showIfAlreadyViewed: boolean;
  location: 'settings' | 'policy_update_modal' | 'onboarding';
  confirmSave?: GroveConfirmSave;
  onOffPicked?: () => void;
  onDone(decision: GroveDecision): void;
};

const NEW_TERMS_ASCII = ` _____________
 |          \\  \\
 | NEW TERMS \\__\\
 |              |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |              |
 |______________|`;

function GracePeriodContentBody(): React.ReactNode {
  return (
    <>
      <Text>
        An update to our Consumer Terms and Privacy Policy will take effect on <Text bold>October 8, 2025</Text>. You
        can accept the updated terms today.
      </Text>

      <Box flexDirection="column">
        <Text>What&apos;s changing?</Text>

        <Box paddingLeft={1}>
          <Text>
            <Text>· </Text>
            <Text bold>Help improve our AI models </Text>
            <Text>
              — Allow the use of your chats and coding sessions to train and improve Anthropic AI models. Change anytime
              in your Privacy Settings (<Link url={'https://claude.ai/settings/data-privacy-controls'}></Link>
              ).
            </Text>
          </Text>
        </Box>
        <Box paddingLeft={1}>
          <Text>
            <Text>· </Text>
            <Text bold>Updates to data retention </Text>
            <Text>
              — To help us improve our AI models and safety protections, we&apos;re extending data retention to 5 years.
            </Text>
          </Text>
        </Box>
      </Box>

      <Text>
        Learn more (<Link url={'https://www.anthropic.com/news/updates-to-our-consumer-terms'}></Link>) or read the
        updated Consumer Terms (<Link url={'https://anthropic.com/legal/terms'}></Link>) and Privacy Policy (
        <Link url={'https://anthropic.com/legal/privacy'}></Link>)
      </Text>
    </>
  );
}

function PostGracePeriodContentBody(): React.ReactNode {
  return (
    <>
      <Text>We&apos;ve updated our Consumer Terms and Privacy Policy.</Text>

      <Box flexDirection="column" gap={1}>
        <Text>What&apos;s changing?</Text>

        <Box flexDirection="column">
          <Text bold>Help improve our AI models</Text>
          <Text>
            Allow the use of your chats and coding sessions to train and improve Anthropic AI models. You can change
            this anytime in Privacy Settings
          </Text>
          <Link url={'https://claude.ai/settings/data-privacy-controls'}></Link>
        </Box>

        <Box flexDirection="column">
          <Text bold>How this affects data retention</Text>
          <Text>
            Turning ON the improve Claude setting extends data retention from 30 days to 5 years. Turning it OFF keeps
            the default 30-day data retention. Delete data anytime.
          </Text>
        </Box>
      </Box>

      <Text>
        Learn more (<Link url={'https://www.anthropic.com/news/updates-to-our-consumer-terms'}></Link>) or read the
        updated Consumer Terms (<Link url={'https://anthropic.com/legal/terms'}></Link>) and Privacy Policy (
        <Link url={'https://anthropic.com/legal/privacy'}></Link>)
      </Text>
    </>
  );
}

export function GroveDialog({
  showIfAlreadyViewed,
  location,
  confirmSave,
  onOffPicked,
  onDone,
}: Props): React.ReactNode {
  const [shouldShowDialog, setShouldShowDialog] = useState<boolean | null>(null);
  const [groveConfig, setGroveConfig] = useState<GroveConfig | null>(null);
  // Official 2.1.326 #70 & 2.1.328 `OEo`: lock selection while saving so keys pressed
  // in flight cannot overwrite an OFF answer with ON, and surface blocked/already-off states.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [wasAlreadyOff, setWasAlreadyOff] = useState(false);
  const savingRef = useRef(false);
  const offPickedRef = useRef(false);

  useInput(
    (_input, key) => {
      if (key.return) {
        onDone('accept_opt_out');
      }
    },
    { isActive: wasAlreadyOff },
  );

  useEffect(() => {
    async function checkGroveSettings() {
      const [settingsResult, configResult] = await Promise.all([getGroveSettings(), getGroveNoticeConfig()]);

      // Extract config data if successful, otherwise null
      const config = configResult.success ? configResult.data : null;
      setGroveConfig(config);

      // Determine if we should show the dialog (returns false on API failure)
      const shouldShow = calculateShouldShowGrove(settingsResult, configResult, showIfAlreadyViewed);

      setShouldShowDialog(shouldShow);
      // If we shouldn't show the dialog, immediately call onDone
      if (!shouldShow) {
        onDone('skip_rendering');
        return;
      }
      // Mark as viewed every time we show the dialog (for reminder frequency tracking)
      void markGroveNoticeViewed();
      // Log that the Grove policy dialog was shown
      logEvent('tengu_grove_policy_viewed', {
        location: location as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        dismissable: config?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }

    void checkGroveSettings();
  }, [showIfAlreadyViewed, location, onDone]);

  // Loading state
  if (shouldShowDialog === null) {
    return null;
  }

  // User has already set preferences, don't show dialog
  if (!shouldShowDialog) {
    return null;
  }

  if (blockedError) {
    return (
      <Dialog title="Help improve our AI models" color="professionalBlue" onCancel={() => onDone('escape')}>
        <Text color="error">
          <StatusIcon status="error" withSpace />
          {blockedError}
        </Text>
      </Dialog>
    );
  }

  if (wasAlreadyOff) {
    return (
      <Dialog
        title="Help improve our AI models"
        color="professionalBlue"
        onCancel={() => onDone('accept_opt_out')}
        inputGuide={
          <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="continue" />
            <KeyboardShortcutHint shortcut="Esc" action="close" />
          </Byline>
        }
      >
        <Text>
          This setting wasn&apos;t turned on. It&apos;s off for your account. You can review it any time with
          /privacy-settings.
        </Text>
      </Dialog>
    );
  }

  async function onChange(value: 'accept_opt_in' | 'accept_opt_out' | 'defer' | 'escape') {
    if (savingRef.current) {
      return;
    }
    if (value === 'accept_opt_in' && offPickedRef.current) {
      return;
    }
    if (value === 'defer' && offPickedRef.current) {
      return;
    }
    if (value !== 'defer' && value !== 'escape') {
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
    }
    try {
      const outcome = await submitGroveDialogDecision({
        value,
        confirmSave,
        onOffPicked,
        isOffPicked: () => offPickedRef.current,
        markOffPicked: () => {
          offPickedRef.current = true;
        },
        noticeIsGracePeriod: groveConfig?.notice_is_grace_period,
      });
      if (outcome.kind === 'blocked') {
        savingRef.current = false;
        setSaving(false);
        setBlockedError(outcome.error);
        return;
      }
      if (outcome.kind === 'already_off') {
        savingRef.current = false;
        setSaving(false);
        setWasAlreadyOff(true);
        return;
      }
      if (outcome.kind === 'done') {
        onDone(outcome.decision);
      }
    } catch (err) {
      savingRef.current = false;
      setSaving(false);
      setSaveError(err instanceof Error ? err.message : 'Failed to save privacy preference.');
    }
  }

  const offOption = {
    label: 'Accept terms · Help improve our AI models: OFF',
    value: 'accept_opt_out',
  };
  const acceptOptions = groveConfig?.grove_locked_by_claude_science
    ? [offOption]
    : groveConfig?.domain_excluded
      ? [
          {
            label: 'Accept terms · Help improve our AI models: OFF (for emails with your domain)',
            value: 'accept_opt_out',
          },
        ]
      : [
          {
            label: 'Accept terms · Help improve our AI models: ON',
            value: 'accept_opt_in',
            disabled: saving || offPickedRef.current,
          },
          offOption,
        ];

  function handleCancel(): void {
    if (savingRef.current) {
      return;
    }
    if (groveConfig?.notice_is_grace_period) {
      void onChange('defer');
      return;
    }
    void onChange('escape');
  }

  return (
    <Dialog
      title="Updates to Consumer Terms and Policies"
      color="professionalBlue"
      onCancel={handleCancel}
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <KeyboardShortcutHint shortcut="Esc" action="cancel" />
          </Byline>
        )
      }
    >
      <Box flexDirection="row">
        <Box flexDirection="column" gap={1} flexGrow={1}>
          {groveConfig?.notice_is_grace_period ? <GracePeriodContentBody /> : <PostGracePeriodContentBody />}
        </Box>
        <Box flexShrink={0}>
          <Text color="professionalBlue">{NEW_TERMS_ASCII}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Please select how you&apos;d like to continue</Text>
          <Text>Your choice takes effect immediately upon confirmation.</Text>
        </Box>

        <Select
          options={[
            ...acceptOptions,
            // Only show "Not now" if in grace period
            ...(groveConfig?.notice_is_grace_period ? [{ label: 'Not now', value: 'defer' }] : []),
          ]}
          isDisabled={saving}
          disablePrintableKeybindings
          onChange={value => onChange(value as 'accept_opt_in' | 'accept_opt_out' | 'defer')}
          onCancel={handleCancel}
        />
        {saving ? <Text dimColor>Saving…</Text> : null}
        {saveError ? (
          <Text color="error">
            <StatusIcon status="error" withSpace />
            {saveError}
          </Text>
        ) : null}
      </Box>
    </Dialog>
  );
}

type PrivacySettingsDialogProps = {
  settings: AccountSettings;
  domainExcluded?: boolean;
  lockedByClaudeScience?: boolean;
  onDone(): void;
};

export function PrivacySettingsDialog({
  settings,
  domainExcluded,
  lockedByClaudeScience,
  onDone,
}: PrivacySettingsDialogProps): React.ReactNode {
  const [groveEnabled, setGroveEnabled] = useState(settings.grove_enabled);
  // Official 2.1.326 #70: serialize privacy-settings toggles & ignore keys after Esc.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const closedRef = useRef(false);
  const locked = domainExcluded || lockedByClaudeScience;

  React.useEffect(() => {
    logEvent('tengu_grove_privacy_settings_viewed', {});
    return () => {
      closedRef.current = true;
    };
  }, []);

  const handleClose = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onDone();
  };

  useInput((input, key) => {
    if (locked || savingRef.current || closedRef.current) {
      return;
    }
    // Toggle the setting when enter/tab/space is pressed
    if (key.tab || key.return || input === ' ') {
      const previousValue = groveEnabled;
      const newValue = !previousValue;
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      setGroveEnabled(newValue);
      void updateGroveSettings(newValue)
        .catch(err => {
          if (!closedRef.current) {
            setGroveEnabled(previousValue);
            setSaveError(err instanceof Error ? err.message : 'Failed to update privacy setting.');
          }
        })
        .finally(() => {
          savingRef.current = false;
          if (!closedRef.current) {
            setSaving(false);
          }
        });
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
      onCancel={handleClose}
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
        Review and manage your privacy settings at{' '}
        <Link url={'https://claude.ai/settings/data-privacy-controls'}></Link>
      </Text>

      <Box flexDirection="column">
        <Box gap={1}>
          <Box width={43}>
            <Text bold>Help improve our AI models</Text>
          </Box>
          <Box minWidth={5}>{valueComponent}</Box>
          {saving ? <Text dimColor>(saving…)</Text> : null}
        </Box>
        {saveError ? (
          <Text color="error">
            <StatusIcon status="error" withSpace />
            {saveError}
          </Text>
        ) : null}
        {lockedByClaudeScience && <Text dimColor>Not available for this account.</Text>}
      </Box>
    </Dialog>
  );
}
