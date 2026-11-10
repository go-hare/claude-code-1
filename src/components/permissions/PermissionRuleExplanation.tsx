import { feature } from 'bun:bundle';
import chalk from 'chalk';
import React from 'react';
import { Ansi, Box, Text } from '@anthropic/ink';
import ThemedText from '../design-system/ThemedText.js';
import { useAppState } from '../../state/AppState.js';
import type { PermissionMode, PermissionRule } from '../../types/permissions.js';
import type { PermissionDecision, PermissionDecisionReason } from '../../utils/permissions/PermissionResult.js';
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js';
import type { Theme } from '../../utils/theme.js';
import { PermissionPreviewGutter } from './PermissionPreviewGutter.js';

export type PermissionRuleExplanationProps = {
  permissionResult: PermissionDecision;
  toolType: 'tool' | 'command' | 'edit' | 'read';
};

type DecisionReasonStrings = {
  reasonString: string;
  configString?: string;
  /** When set, reasonString is plain text rendered with this theme color instead of <Ansi>. */
  themeColor?: keyof Theme;
};

function hookSourceConfigString(hookSource: string | undefined): string {
  if (hookSource?.startsWith('plugin')) {
    return 'plugin hooks.json to update hooks';
  }
  if (hookSource?.startsWith('skill')) {
    return 'SKILL.md to update hooks';
  }
  if (hookSource) {
    return 'settings.json to update hooks';
  }
  return '/hooks to update';
}

function extractAskRuleFromReason(reason: PermissionDecisionReason | undefined): PermissionRule | undefined {
  if (reason?.type === 'rule' && reason.rule.ruleBehavior === 'ask') {
    return reason.rule;
  }
  if (reason?.type === 'subcommandResults') {
    for (const subResult of reason.reasons.values()) {
      if (subResult.behavior === 'ask') {
        const found = extractAskRuleFromReason(subResult.decisionReason);
        if (found) {
          return found;
        }
      }
    }
  }
  return undefined;
}

function stringsForDecisionReason(
  reason: PermissionDecisionReason | undefined,
  toolType: 'tool' | 'command' | 'edit' | 'read',
  permissionMode?: PermissionMode,
): DecisionReasonStrings | null {
  if (!reason) {
    return null;
  }
  if ((feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) && reason.type === 'classifier') {
    if (reason.classifier === 'auto-mode') {
      return {
        reasonString: `Auto mode classifier requires confirmation for this ${toolType}.\n${reason.reason}`,
        configString: undefined,
        themeColor: 'error',
      };
    }
    return {
      reasonString: `Classifier ${chalk.bold(reason.classifier)} requires confirmation for this ${toolType}.\n${reason.reason}`,
      configString: undefined,
    };
  }
  if (reason.type === 'subcommandResults') {
    const askRule = extractAskRuleFromReason(reason);
    if (askRule) {
      return stringsForDecisionReason({ type: 'rule', rule: askRule }, toolType, permissionMode);
    }
    for (const subResult of reason.reasons.values()) {
      if (subResult.behavior === 'ask' || subResult.behavior === 'passthrough') {
        const subStrings = stringsForDecisionReason(subResult.decisionReason, toolType, permissionMode);
        if (subStrings) {
          return subStrings;
        }
      }
    }
    return null;
  }
  switch (reason.type) {
    case 'rule': {
      const ruleValueBold = chalk.bold(permissionRuleValueToString(reason.rule.ruleValue));
      if (permissionMode === 'auto' && reason.rule.ruleBehavior === 'ask' && reason.rule.source !== 'policySettings') {
        return {
          reasonString: `Ask rule ${ruleValueBold} overrides auto mode for this ${toolType}.`,
          configString: '/permissions to let auto mode decide',
        };
      }
      return {
        reasonString: `Permission rule ${ruleValueBold} requires confirmation for this ${toolType}.`,
        configString: reason.rule.source === 'policySettings' ? undefined : '/permissions to update rules',
      };
    }
    case 'hook': {
      const hookReasonString = reason.reason ? `:\n${reason.reason}` : '.';
      const sourceLabel = reason.hookSource ? ` ${chalk.dim(`[${reason.hookSource}]`)}` : '';
      return {
        reasonString: `Hook ${chalk.bold(reason.hookName)} requires confirmation for this ${toolType}${hookReasonString}${sourceLabel}`,
        configString: hookSourceConfigString(reason.hookSource),
      };
    }
    case 'safetyCheck':
    case 'other':
      return {
        reasonString: reason.reason,
        configString: undefined,
      };
    case 'workingDir':
      return {
        reasonString: reason.reason,
        configString: '/permissions to update rules',
      };
    default:
      return null;
  }
}

export function PermissionRuleExplanation({
  permissionResult,
  toolType,
}: PermissionRuleExplanationProps): React.ReactNode {
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const strings = stringsForDecisionReason(permissionResult?.decisionReason, toolType, permissionMode);
  const matchedAskRule = permissionResult?.behavior === 'ask' ? permissionResult.matchedAskRule : undefined;
  const matchedAskRuleStrings =
    matchedAskRule !== undefined && extractAskRuleFromReason(permissionResult?.decisionReason) === undefined
      ? stringsForDecisionReason({ type: 'rule', rule: matchedAskRule }, toolType, permissionMode)
      : null;
  if (!strings && !matchedAskRuleStrings) {
    return null;
  }

  const themeColor =
    strings?.themeColor ??
    (permissionResult?.decisionReason?.type === 'hook' && permissionMode === 'auto' ? 'warning' : undefined);

  return (
    <Box marginBottom={1} flexDirection="column">
      {strings && (
        <PermissionPreviewGutter multiline={strings.reasonString.includes('\n')}>
          {themeColor ? (
            <ThemedText color={themeColor}>{strings.reasonString}</ThemedText>
          ) : (
            <Text>
              <Ansi>{strings.reasonString}</Ansi>
            </Text>
          )}
        </PermissionPreviewGutter>
      )}
      {strings?.configString && <Text dimColor>{strings.configString}</Text>}
      {matchedAskRuleStrings && (
        <>
          <PermissionPreviewGutter multiline={matchedAskRuleStrings.reasonString.includes('\n')}>
            <Text>
              <Ansi>{matchedAskRuleStrings.reasonString}</Ansi>
            </Text>
          </PermissionPreviewGutter>
          {matchedAskRuleStrings.configString && matchedAskRuleStrings.configString !== strings?.configString && (
            <Text dimColor>{matchedAskRuleStrings.configString}</Text>
          )}
        </>
      )}
    </Box>
  );
}
