import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js';
import type { Tool } from '../../../Tool.js';
import type { PermissionDecision } from '../../../types/permissions.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { computeShowAlwaysAllowOptions } from '../../../utils/permissions/suppressAlwaysAllow.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
import { generateShellSuggestionsLabel } from '../shellPermissionHelpers.js';

export type PowerShellToolUseOption = 'yes' | 'yes-apply-suggestions' | 'yes-prefix-edited' | 'no';

export function powershellToolUseOptions({
  tool,
  input = {},
  permissionResult,
  suggestions = [],
  onRejectFeedbackChange,
  onAcceptFeedbackChange,
  yesInputMode = false,
  noInputMode = false,
  editablePrefix,
  onEditablePrefixChange,
}: {
  /** densable showAlwaysAllow — tool + input + permissionResult for suppress gates */
  tool: Tool;
  input?: { [key: string]: unknown };
  permissionResult?: PermissionDecision | null;
  suggestions?: PermissionUpdate[];
  onRejectFeedbackChange: (value: string) => void;
  onAcceptFeedbackChange: (value: string) => void;
  yesInputMode?: boolean;
  noInputMode?: boolean;
  editablePrefix?: string;
  onEditablePrefixChange?: (value: string) => void;
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

  // densable showAlwaysAllow: EYt + org ask ceiling + suppressAlwaysAllowRule + tool.suppressesAlwaysAllowRule
  // Prefer the editable prefix input (static extractor + user edits) over the
  // non-editable suggestions label. The editable input can't represent
  // directory permissions or Read-tool rules, so fall back to the label when
  // those are present.
  if (
    computeShowAlwaysAllowOptions({
      tool,
      input,
      permissionResult,
    }) &&
    suggestions.length > 0
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
        placeholder: 'command prefix (e.g., Get-Process:*)',
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
