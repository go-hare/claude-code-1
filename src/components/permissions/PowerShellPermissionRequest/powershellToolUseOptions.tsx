import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import {
  type ShowPersistentAllowPermissionResult,
  type ShowPersistentAllowTool,
  shouldShowPersistentAllowOption,
} from '../../../utils/permissions/showAlwaysAllow.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
import { generateShellSuggestionsLabel } from '../shellPermissionHelpers.js';

export type PowerShellToolUseOption = 'yes' | 'yes-apply-suggestions' | 'yes-prefix-edited' | 'no';

export function powershellToolUseOptions({
  suggestions = [],
  onRejectFeedbackChange,
  onAcceptFeedbackChange,
  yesInputMode = false,
  noInputMode = false,
  editablePrefix,
  onEditablePrefixChange,
  permissionResult,
  tool,
  input,
  isAskCappedByOrg = false,
}: {
  suggestions?: PermissionUpdate[];
  onRejectFeedbackChange: (value: string) => void;
  onAcceptFeedbackChange: (value: string) => void;
  yesInputMode?: boolean;
  noInputMode?: boolean;
  editablePrefix?: string;
  onEditablePrefixChange?: (value: string) => void;
  /** densable 2.1.235 #12 showAlwaysAllow inputs */
  permissionResult?: ShowPersistentAllowPermissionResult;
  tool?: ShowPersistentAllowTool;
  input?: unknown;
  isAskCappedByOrg?: boolean;
}): OptionWithDescription<PowerShellToolUseOption>[] {
  const options: OptionWithDescription<PowerShellToolUseOption>[] = [];

  if (yesInputMode) {
    options.push({
      type: 'input',
      label: 'Yes',
      value: 'yes',
      placeholder: 'and tell Claude what to do next',
      onChange: onAcceptFeedbackChange,
      allowEmptySubmitToCancel: true,
    });
  } else {
    options.push({
      label: 'Yes',
      value: 'yes',
    });
  }

  // Note: No sandbox toggle for PowerShell - sandbox is not supported on Windows
  // Note: No classifier-reviewed option for PowerShell (ANT-ONLY feature for Bash)

  // densable 2.1.235 #12: omit don't-ask-again when suppressAlwaysAllowRule.
  // Prefer the editable prefix input (static extractor + user edits) over the
  // non-editable suggestions label. The editable input can't represent
  // directory permissions or Read-tool rules, so fall back to the label when
  // those are present.
  if (
    shouldShowPersistentAllowOption({
      baseAllowed: shouldShowAlwaysAllowOptions() && suggestions.length > 0,
      permissionResult,
      tool,
      input,
      isAskCappedByOrg,
    })
  ) {
    const hasNonPowerShellSuggestions = suggestions.some(
      s =>
        s.type === 'addDirectories' ||
        (s.type === 'addRules' && s.rules?.some(r => r.toolName !== POWERSHELL_TOOL_NAME)),
    );
    if (editablePrefix !== undefined && onEditablePrefixChange && !hasNonPowerShellSuggestions) {
      options.push({
        type: 'input',
        label: 'Yes, and don\u2019t ask again for',
        value: 'yes-prefix-edited',
        placeholder: 'command prefix (e.g., Get-Process *)',
        initialValue: editablePrefix,
        onChange: onEditablePrefixChange,
        allowEmptySubmitToCancel: true,
        showLabelWithValue: true,
        labelValueSeparator: ': ',
        resetCursorOnUpdate: true,
      });
    } else {
      const label = generateShellSuggestionsLabel(suggestions, POWERSHELL_TOOL_NAME);
      if (label) {
        options.push({
          label,
          value: 'yes-apply-suggestions',
        });
      }
    }
  }

  if (noInputMode) {
    options.push({
      type: 'input',
      label: 'No',
      value: 'no',
      placeholder: 'and tell Claude what to do differently',
      onChange: onRejectFeedbackChange,
      allowEmptySubmitToCancel: true,
    });
  } else {
    options.push({
      label: 'No',
      value: 'no',
    });
  }

  return options;
}
