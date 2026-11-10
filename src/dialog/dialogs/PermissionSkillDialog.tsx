/**
 * densable Jiu — permission_skill DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM(Fno,Jiu)`. Yes / optional yes-exact / optional
 * yes-prefix / No. Esc/onCancel → `{behavior:"deny"}`. Title is Wce
 * `Use skill "${display}"?` else `Use this skill?`. hyy/gyy labels are
 * ConsentRow.node. Host answer is store.answer; do not dequeue.
 */
import React from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { Box, Text } from '@anthropic/ink';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import { PermissionOverflowBox } from '../../components/permissions/PermissionOverflowBox.js';
import { PermissionPreviewGutter } from '../../components/permissions/PermissionPreviewGutter.js';
import { PermissionPrompt, type PermissionPromptOption } from '../../components/permissions/PermissionPrompt.js';
import { PermissionRuleExplanation } from '../../components/permissions/PermissionRuleExplanation.js';
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js';
import type { DialogRendererProps } from '../DialogHost.js';
import { sanitizeHostDisplay } from '../permissionBrowser.js';
import {
  buildSkillExactAllowRow,
  buildSkillPrefixAllowRow,
  type SkillPermissionChoice,
  type SkillPermissionPayload,
  resolveSkillPermissionAnswer,
  shouldShowSkillExactAllow,
  shouldShowSkillPrefixAllow,
} from '../permissionSkill.js';

export function PermissionSkillDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as SkillPermissionPayload;
  const sanitized = sanitizeHostDisplay(p.skill);
  const title = sanitized !== null ? `Use skill "${sanitized.display}"?` : 'Use this skill?';
  const cwd = getOriginalCwd();
  const exactRow = shouldShowSkillExactAllow(p) ? buildSkillExactAllowRow(p, cwd) : null;
  const prefixRow = shouldShowSkillPrefixAllow(p) ? buildSkillPrefixAllowRow(p, cwd) : null;
  const skillDescription = typeof p.skillDescription === 'string' ? p.skillDescription : '';

  const options: PermissionPromptOption<SkillPermissionChoice>[] = [
    { label: 'Yes', value: 'yes', feedbackConfig: { type: 'accept' } },
  ];
  if (exactRow !== null) {
    options.push({
      label: exactRow.node,
      value: 'yes-exact',
    });
  }
  if (prefixRow !== null) {
    options.push({
      label: prefixRow.node,
      value: 'yes-prefix',
    });
  }
  options.push({
    label: 'No',
    value: 'no',
    feedbackConfig: { type: 'reject' },
  });

  return (
    <PermissionDialog title={title} innerPaddingX={0} requestSource={p.requestSource}>
      <Box paddingX={1}>
        <Text>Claude may use instructions, code, or files from this Skill.</Text>
      </Box>
      {skillDescription !== '' ? (
        <PermissionOverflowBox>
          <PermissionPreviewGutter multiline={skillDescription.includes('\n')}>
            <Text dimColor>{skillDescription}</Text>
          </PermissionPreviewGutter>
        </PermissionOverflowBox>
      ) : null}

      <Box flexDirection="column" paddingX={1}>
        <PermissionRuleExplanation permissionResult={p.permissionResult as PermissionDecision} toolType="tool" />
        <PermissionPrompt
          options={options}
          onSelect={(choice, feedback) => {
            answer(resolveSkillPermissionAnswer(choice, p, { exactRow, prefixRow }, feedback));
          }}
          onCancel={() => {
            answer({ behavior: 'deny' });
          }}
          toolAnalyticsContext={{
            toolName: p.toolName,
            isMcp: p.isMcp === true,
          }}
        />
      </Box>
    </PermissionDialog>
  );
}
