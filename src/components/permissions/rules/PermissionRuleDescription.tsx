import * as React from 'react';
import { Text } from '@anthropic/ink';
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js';
import type { PermissionRuleValue } from '../../../utils/permissions/PermissionRule.js';
import { sanitizeDontAskCwd } from '../dontAskAgainLabel.js';

type RuleSubtitleProps = {
  ruleValue: PermissionRuleValue;
};

export type PermissionRuleDescriptionParts = {
  prefix: string;
  emphasis?: string;
  suffix?: string;
};

export function getPermissionRuleDescriptionParts(
  ruleValue: PermissionRuleValue,
): PermissionRuleDescriptionParts | null {
  if (ruleValue.toolName === BashTool.name) {
    if (!ruleValue.ruleContent) {
      return { prefix: 'Any Bash command' };
    }
    if (ruleValue.ruleContent.endsWith(':*') || ruleValue.ruleContent.endsWith(' *')) {
      return {
        prefix: 'Any Bash command starting with ',
        emphasis: ruleValue.ruleContent.slice(0, -2),
      };
    }
    return {
      prefix: 'The Bash command ',
      emphasis: ruleValue.ruleContent,
    };
  }
  if (!ruleValue.ruleContent) {
    return {
      prefix: 'Any use of the ',
      emphasis: ruleValue.toolName,
      suffix: ' tool',
    };
  }
  return null;
}

export function PermissionRuleDescription({ ruleValue }: RuleSubtitleProps): React.ReactNode {
  const desc = getPermissionRuleDescriptionParts(ruleValue);
  if (!desc) {
    return null;
  }
  const emphasisNode = desc.emphasis !== undefined && <Text bold>{sanitizeDontAskCwd(desc.emphasis)}</Text>;
  return (
    <Text dimColor>
      {desc.prefix}
      {emphasisNode}
      {desc.suffix}
    </Text>
  );
}
