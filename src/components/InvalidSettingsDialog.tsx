import React from 'react';
import { Text, Dialog } from '@anthropic/ink';
import type { ValidationError } from '../utils/settings/validation.js';
import { Select } from './CustomSelect/index.js';
import { ValidationErrorsList } from './ValidationErrorsList.js';

type Props = {
  settingsErrors: Array<ValidationError & { substituted?: boolean }>;
  onContinue: () => void;
  onFix?: () => void;
  onExit: () => void;
};

function isErrorSeverity(error: ValidationError): boolean {
  return error.severity !== 'warning';
}

function isSubstitutedWarning(error: ValidationError & { substituted?: boolean }): boolean {
  return Boolean(error.substituted);
}

/**
 * Dialog shown when settings files have validation errors or warnings.
 */
export function InvalidSettingsDialog({ settingsErrors, onContinue, onFix, onExit }: Props): React.ReactNode {
  function handleSelect(value: string): void {
    if (value === 'exit') {
      onExit();
    } else if (value === 'fix') {
      (onFix ?? onContinue)();
    } else {
      onContinue();
    }
  }

  const hasErrors = settingsErrors.some(isErrorSeverity);
  const hasSubstituted = settingsErrors.some(isSubstitutedWarning);
  const options = hasErrors
    ? [
        { label: 'Fix with Claude', value: 'fix' },
        { label: 'Exit and fix manually', value: 'exit' },
        { label: 'Continue without these settings', value: 'continue' },
      ]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'Fix with Claude', value: 'fix' },
        { label: 'Exit and fix manually', value: 'exit' },
      ];
  const title = hasErrors ? 'Settings Error' : 'Settings Warning';
  const onCancel = hasErrors ? onExit : onContinue;
  const explanation = hasErrors
    ? 'Files with errors are skipped entirely, not just the invalid settings.'
    : hasSubstituted
      ? 'The values listed above were replaced with their restrictive reading or skipped as noted; the rest of the file is in effect.'
      : 'The values listed above were skipped; the rest of the file is in effect.';

  return (
    <Dialog title={title} onCancel={onCancel} color="warning" exitOnCtrlCD>
      <ValidationErrorsList errors={settingsErrors} />
      <Text dimColor>{explanation}</Text>
      <Select options={options} onChange={handleSelect} />
    </Dialog>
  );
}
