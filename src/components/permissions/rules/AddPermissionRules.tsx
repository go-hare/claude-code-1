import * as React from 'react';
import { useCallback } from 'react';
import { Select } from '../../../components/CustomSelect/select.js';
import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import type { ToolPermissionContext } from '../../../Tool.js';
import type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleValue,
} from '../../../utils/permissions/PermissionRule.js';
import { applyPermissionUpdate, persistPermissionUpdates } from '../../../utils/permissions/PermissionUpdate.js';
import { permissionRuleValueToString } from '../../../utils/permissions/permissionRuleParser.js';
import { detectUnreachableRules, type UnreachableRule } from '../../../utils/permissions/shadowedRuleDetection.js';
import { SandboxManager } from '../../../utils/sandbox/sandbox-adapter.js';
import { type EditableSettingSource, SOURCES } from '../../../utils/settings/constants.js';
import { getRelativeSettingsFilePathForSource } from '../../../utils/settings/settings.js';
import { plural } from '../../../utils/stringUtils.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
import { PermissionRuleDescription } from './PermissionRuleDescription.js';

export function optionForPermissionSaveDestination(saveDestination: EditableSettingSource): OptionWithDescription {
  switch (saveDestination) {
    case 'localSettings':
      return {
        label: 'Project settings (local)',
        description: `Saved in ${getRelativeSettingsFilePathForSource('localSettings')}`,
        value: saveDestination,
      };
    case 'projectSettings':
      return {
        label: 'Project settings',
        description: `Checked in at ${getRelativeSettingsFilePathForSource('projectSettings')}`,
        value: saveDestination,
      };
    case 'userSettings':
      return {
        label: 'User settings',
        description: `Saved in at ~/.claude/settings.json`,
        value: saveDestination,
      };
  }
}

type Props = {
  onAddRules: (rules: PermissionRule[], unreachable?: UnreachableRule[]) => void;
  onCancel: () => void;
  /** Official 2.1.326 #16: surface settings persistence failures without dropping the session update. */
  onNotSaved?: (warning: string) => void;
  ruleValues: PermissionRuleValue[];
  ruleBehavior: PermissionBehavior;
  initialContext: ToolPermissionContext;
  setToolPermissionContext: (newContext: ToolPermissionContext) => void;
};

export function AddPermissionRules({
  onAddRules,
  onCancel,
  onNotSaved,
  ruleValues,
  ruleBehavior,
  initialContext,
  setToolPermissionContext,
}: Props): React.ReactNode {
  const allOptions = SOURCES.map(optionForPermissionSaveDestination);

  const onSelect = useCallback(
    (selectedValue: string) => {
      if (selectedValue === 'cancel') {
        onCancel();
        return;
      } else if ((SOURCES as readonly string[]).includes(selectedValue)) {
        const destination = selectedValue as EditableSettingSource;

        const update = {
          type: 'addRules' as const,
          rules: ruleValues,
          behavior: ruleBehavior,
          destination,
        };
        const updatedContext = applyPermissionUpdate(initialContext, update);

        // Persist to settings and report any persistence error (#16)
        persistPermissionUpdates([update], { onPersistError: onNotSaved });

        setToolPermissionContext(updatedContext);

        const rules: PermissionRule[] = ruleValues.map(ruleValue => ({
          ruleValue,
          ruleBehavior,
          source: destination,
        }));

        // Check for unreachable rules among the ones we just added
        const sandboxAutoAllowEnabled =
          SandboxManager.isSandboxingEnabled() && SandboxManager.isAutoAllowBashIfSandboxedEnabled();
        const allUnreachable = detectUnreachableRules(updatedContext, {
          sandboxAutoAllowEnabled,
        });

        // Filter to only rules we just added
        const newUnreachable = allUnreachable.filter(u =>
          ruleValues.some(
            rv => rv.toolName === u.rule.ruleValue.toolName && rv.ruleContent === u.rule.ruleValue.ruleContent,
          ),
        );

        onAddRules(rules, newUnreachable.length > 0 ? newUnreachable : undefined);
      }
    },
    [onAddRules, onCancel, onNotSaved, ruleValues, ruleBehavior, initialContext, setToolPermissionContext],
  );

  const title = `Add ${ruleBehavior} permission ${plural(ruleValues.length, 'rule')}`;

  return (
    <Dialog
      title={title}
      onCancel={onCancel}
      color="permission"
      inputGuide={
        <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="save" />
          <KeyboardShortcutHint shortcut="Esc" action="go back" />
        </Byline>
      }
    >
      <Box flexDirection="column" paddingX={2}>
        {ruleValues.map(ruleValue => (
          <Box flexDirection="column" key={permissionRuleValueToString(ruleValue)}>
            <Text bold>{permissionRuleValueToString(ruleValue)}</Text>
            <PermissionRuleDescription ruleValue={ruleValue} />
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" marginY={1}>
        <Text>
          {ruleValues.length === 1 ? 'Where should this rule be saved?' : 'Where should these rules be saved?'}
        </Text>
        <Select options={allOptions} onChange={onSelect} />
      </Box>
    </Dialog>
  );
}
