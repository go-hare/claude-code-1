import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { Box, Dialog, Link, Text } from '@anthropic/ink';
import { getSubscriptionType } from '../utils/auth.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/index.js';

// NOTE: This copy is legally reviewed — do not modify without Legal team approval.
// densable 2.1.228 #18: w9h / GmE / C9h; pro|max|team drop GmE (VmE → R9h).
const AUTO_MODE_DESCRIPTION_PREFIX =
  'Auto mode lets Claude handle permission prompts automatically — Claude checks each tool call for risky actions and prompt injection before executing. Actions Claude identifies as safe are executed, while actions Claude identifies as risky are blocked and Claude may try a different approach. Ideal for long-running tasks.';
const AUTO_MODE_COST_SENTENCE = 'Sessions are slightly more expensive.';
const AUTO_MODE_DESCRIPTION_SUFFIX =
  "Claude can make mistakes that allow harmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode.";

/** densable A9h — full copy including cost sentence. */
export const AUTO_MODE_DESCRIPTION = `${AUTO_MODE_DESCRIPTION_PREFIX} ${AUTO_MODE_COST_SENTENCE} ${AUTO_MODE_DESCRIPTION_SUFFIX}`;

/** densable R9h — pro/max/team plan copy without cost sentence. */
export const AUTO_MODE_DESCRIPTION_WITHOUT_COST_SENTENCE = `${AUTO_MODE_DESCRIPTION_PREFIX} ${AUTO_MODE_DESCRIPTION_SUFFIX}`;

/**
 * densable VmE — plan-gated description.
 * pro | max | team → without cost; otherwise full (includes free/api/null).
 */
export function getAutoModeDescription(): string {
  const plan = getSubscriptionType();
  if (plan === 'pro' || plan === 'max' || plan === 'team') {
    return AUTO_MODE_DESCRIPTION_WITHOUT_COST_SENTENCE;
  }
  return AUTO_MODE_DESCRIPTION;
}

type Props = {
  onAccept(): void;
  onDecline(): void;
  // Startup gate: decline exits the process, so relabel accordingly.
  declineExits?: boolean;
};

export function AutoModeOptInDialog({ onAccept, onDecline, declineExits }: Props): React.ReactNode {
  React.useEffect(() => {
    logEvent('tengu_auto_mode_opt_in_dialog_shown', {});
  }, []);

  function onChange(value: 'accept' | 'accept-default' | 'decline') {
    switch (value) {
      case 'accept': {
        logEvent('tengu_auto_mode_opt_in_dialog_accept', {});
        updateSettingsForSource('userSettings', {
          skipAutoPermissionPrompt: true,
        });
        onAccept();
        break;
      }
      case 'accept-default': {
        logEvent('tengu_auto_mode_opt_in_dialog_accept_default', {});
        updateSettingsForSource('userSettings', {
          skipAutoPermissionPrompt: true,
          permissions: { defaultMode: 'auto' },
        });
        onAccept();
        break;
      }
      case 'decline': {
        logEvent('tengu_auto_mode_opt_in_dialog_decline', {});
        onDecline();
        break;
      }
    }
  }

  return (
    <Dialog title="Enable auto mode?" color="warning" onCancel={onDecline}>
      <Box flexDirection="column" gap={1}>
        <Text>{getAutoModeDescription()}</Text>

        <Link url="https://code.claude.com/docs/en/security" />
      </Box>

      <Select
        options={[
          ...((process.env.USER_TYPE as string) !== 'ant'
            ? [
                {
                  label: 'Yes, and make it my default mode',
                  value: 'accept-default' as const,
                },
              ]
            : []),
          { label: 'Yes, enable auto mode', value: 'accept' as const },
          {
            label: declineExits ? 'No, exit' : 'No, go back',
            value: 'decline' as const,
          },
        ]}
        onChange={value => onChange(value as 'accept' | 'accept-default' | 'decline')}
        onCancel={onDecline}
      />
    </Dialog>
  );
}
