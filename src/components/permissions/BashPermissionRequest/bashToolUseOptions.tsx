import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js';
import { isClassifierNotApprovable } from '../../../dialog/classifierVeto.js';
import { WORKFLOW_AUTO_MODE_DESCRIPTION } from '../../../dialog/permissionAutoMode.js';
import { extractOutputRedirections } from '../../../utils/bash/commands.js';
import type { PermissionDecisionReason } from '../../../utils/permissions/PermissionResult.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import {
  type ShowPersistentAllowPermissionResult,
  type ShowPersistentAllowTool,
  shouldShowPersistentAllowOption,
} from '../../../utils/permissions/showAlwaysAllow.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
import { generateShellSuggestionsLabel } from '../shellPermissionHelpers.js';

export type BashToolUseOption = 'yes' | 'yes-apply-suggestions' | 'yes-prefix-edited' | 'yes-enable-auto-mode' | 'no';

/**
 * Strip output redirections so filenames don't show as commands in the label.
 */
function stripBashRedirections(command: string): string {
  const { commandWithoutRedirections, redirections } = extractOutputRedirections(command);
  // Only use stripped version if there were actual redirections
  return redirections.length > 0 ? commandWithoutRedirections : command;
}

export function bashToolUseOptions({
  suggestions = [],
  decisionReason,
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
  showEnableAutoModeOption = false,
  enableAutoModeDescription = WORKFLOW_AUTO_MODE_DESCRIPTION,
}: {
  suggestions?: PermissionUpdate[];
  decisionReason?: PermissionDecisionReason;
  onRejectFeedbackChange: (value: string) => void;
  onAcceptFeedbackChange: (value: string) => void;
  yesInputMode?: boolean;
  noInputMode?: boolean;
  /** Editable prefix rule content (e.g., "npm run *"). When set, replaces Haiku-based suggestions. */
  editablePrefix?: string;
  /** Callback when the user edits the prefix value. */
  onEditablePrefixChange?: (value: string) => void;
  /** densable 2.1.235 #12 showAlwaysAllow inputs */
  permissionResult?: ShowPersistentAllowPermissionResult;
  tool?: ShowPersistentAllowTool;
  input?: unknown;
  isAskCappedByOrg?: boolean;
  /** densable 2.1.247 KNe showEnableAutoModeOption */
  showEnableAutoModeOption?: boolean;
  /** densable 2.1.247 KNe enableAutoModeDescription (UNe when !offered, else RA) */
  enableAutoModeDescription?: string;
}): OptionWithDescription<BashToolUseOption>[] {
  const options: OptionWithDescription<BashToolUseOption>[] = [];

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

  // densable 2.1.235 #12: omit don't-ask-again when suppressAlwaysAllowRule
  if (
    shouldShowPersistentAllowOption({
      baseAllowed: shouldShowAlwaysAllowOptions(),
      permissionResult,
      tool,
      input,
      isAskCappedByOrg,
    })
  ) {
    const classifierVetoed = isClassifierNotApprovable(
      permissionResult ?? (decisionReason ? { behavior: 'ask', decisionReason } : undefined),
    );
    const effectiveSuggestions = classifierVetoed ? suggestions.filter(s => s.type === 'addDirectories') : suggestions;
    // Show an editable input for the prefix rule instead of the
    // Haiku-generated suggestion label — but only when the suggestions
    // don't contain non-Bash items (addDirectories, Read rules) that
    // the editable prefix can't represent.
    const hasNonBashSuggestions = effectiveSuggestions.some(
      s => s.type === 'addDirectories' || (s.type === 'addRules' && s.rules?.some(r => r.toolName !== BASH_TOOL_NAME)),
    );
    if (
      !classifierVetoed &&
      editablePrefix !== undefined &&
      onEditablePrefixChange &&
      !hasNonBashSuggestions &&
      effectiveSuggestions.length > 0
    ) {
      options.push({
        type: 'input',
        label: 'Yes, and don’t ask again for',
        value: 'yes-prefix-edited',
        placeholder: 'command prefix (e.g., npm run *)',
        initialValue: editablePrefix,
        onChange: onEditablePrefixChange,
        allowEmptySubmitToCancel: true,
        showLabelWithValue: true,
        labelValueSeparator: ': ',
        resetCursorOnUpdate: true,
      });
    } else if (effectiveSuggestions.length > 0) {
      const label = generateShellSuggestionsLabel(effectiveSuggestions, BASH_TOOL_NAME, stripBashRedirections);

      if (label) {
        options.push({
          label,
          value: 'yes-apply-suggestions',
        });
      }
    }
  }

  if (showEnableAutoModeOption) {
    options.push({
      label: 'Yes, and switch to auto mode',
      description: enableAutoModeDescription,
      value: 'yes-enable-auto-mode',
    });
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
