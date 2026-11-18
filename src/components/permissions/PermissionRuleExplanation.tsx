import { feature } from 'bun:bundle';
import chalk from 'chalk';
import React from 'react';
import { Ansi, Box, Text, wrapText } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { truncateToWidth } from '../../utils/format.js';
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
  rowBudget?: number;
  rowColumns?: number;
  hideAskRuleHint?: boolean;
};

const MIN_REASON_ROW_BUDGET = 4;
const MAX_REASON_ROW_BUDGET = 12;

export function capExplanationRows(text: string, maxRows: number, colWidth: number, shouldCap: boolean): string {
  if (!shouldCap) return text;
  const lines = wrapText(text, colWidth, 'wrap')
    .split('\n')
    .map(line => truncateToWidth(line, colWidth));
  if (lines.length <= maxRows) {
    return lines.join('\n');
  }
  const keep = Math.max(1, maxRows - 1);
  const more = `… (+${lines.length - keep} more lines)`;
  return [...lines.slice(0, keep), truncateToWidth(more, colWidth)].join('\n');
}

export function allocateExplanationRowBudget(
  consentText: string | undefined,
  askRuleText: string | undefined,
  colWidth: number,
  budget: number,
  compact: boolean,
): { shouldCap: boolean; consentRows: number; askRuleRows: number } {
  const countLines = (text: string | undefined): number => {
    if (text === undefined) return 0;
    const wrapped = wrapText(text, colWidth, 'wrap');
    return wrapped.split('\n').length;
  };
  const consentNeeded = countLines(consentText);
  const askRuleNeeded = countLines(askRuleText);
  const shouldCap = compact || consentNeeded + askRuleNeeded > budget;
  if (!shouldCap) {
    return { shouldCap: false, consentRows: consentNeeded, askRuleRows: askRuleNeeded };
  }
  const mins = compact ? { consent: 2, askRule: 2 } : { consent: 4, askRule: 4 };
  let consentRows = Math.min(consentNeeded, mins.consent);
  let askRuleRows = Math.min(askRuleNeeded, mins.askRule);
  let extra = Math.max(0, budget - (consentRows + askRuleRows));
  if (extra > 0) {
    const addConsent = Math.min(consentNeeded - consentRows, extra);
    consentRows += addConsent;
    extra -= addConsent;
  }
  if (extra > 0) {
    const addAskRule = Math.min(askRuleNeeded - askRuleRows, extra);
    askRuleRows += addAskRule;
  }
  return { shouldCap: true, consentRows, askRuleRows };
}

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
  rowBudget,
  rowColumns,
  hideAskRuleHint,
}: PermissionRuleExplanationProps): React.ReactNode {
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const { columns, rows } = useTerminalSize();
  const strings = stringsForDecisionReason(permissionResult?.decisionReason, toolType, permissionMode);
  const matchedAskRule = permissionResult?.behavior === 'ask' ? permissionResult.matchedAskRule : undefined;
  const matchedAskRuleStrings =
    matchedAskRule !== undefined && extractAskRuleFromReason(permissionResult?.decisionReason) === undefined
      ? stringsForDecisionReason({ type: 'rule', rule: matchedAskRule }, toolType, permissionMode)
      : null;
  if (!strings && !matchedAskRuleStrings) {
    return null;
  }

  const budget = Math.min(MAX_REASON_ROW_BUDGET, Math.max(MIN_REASON_ROW_BUDGET, rowBudget ?? rows - 13));
  const colWidth = Math.max(1, rowColumns ?? columns - 8);
  const compact = rowBudget !== undefined || budget < MAX_REASON_ROW_BUDGET;
  const { shouldCap, consentRows, askRuleRows } = allocateExplanationRowBudget(
    strings?.reasonString,
    matchedAskRuleStrings?.reasonString,
    colWidth,
    budget,
    compact || permissionResult?.decisionReason?.type === 'sandboxOverride',
  );
  const displayReason = strings
    ? capExplanationRows(strings.reasonString, consentRows, colWidth, shouldCap)
    : undefined;
  const displayAskRule = matchedAskRuleStrings
    ? capExplanationRows(matchedAskRuleStrings.reasonString, askRuleRows, colWidth, shouldCap)
    : undefined;

  const themeColor =
    strings?.themeColor ??
    (permissionResult?.decisionReason?.type === 'hook' && permissionMode === 'auto' ? 'warning' : undefined);

  return (
    <Box marginBottom={1} flexDirection="column">
      {strings && displayReason !== undefined && (
        <PermissionPreviewGutter multiline={displayReason.includes('\n')}>
          {themeColor ? (
            <ThemedText color={themeColor}>{displayReason}</ThemedText>
          ) : (
            <Text>
              <Ansi>{displayReason}</Ansi>
            </Text>
          )}
        </PermissionPreviewGutter>
      )}
      {strings?.configString && <Text dimColor>{strings.configString}</Text>}
      {matchedAskRuleStrings && displayAskRule !== undefined && (
        <>
          <PermissionPreviewGutter multiline={displayAskRule.includes('\n')}>
            <Text>
              <Ansi>{displayAskRule}</Ansi>
            </Text>
          </PermissionPreviewGutter>
          {matchedAskRuleStrings.configString &&
            hideAskRuleHint !== true &&
            matchedAskRuleStrings.configString !== strings?.configString && (
              <Text dimColor>{matchedAskRuleStrings.configString}</Text>
            )}
        </>
      )}
    </Box>
  );
}
