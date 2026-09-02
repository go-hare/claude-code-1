/**
 * densable Ynu — permission_enter_plan_mode DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM(xno,Ynu)`. rhy yes → allow+setMode session;
 * no/cancel → deny. tengu_plan_enter only `{entryMethod:"tool"}`.
 * Keep Select (do not invent sc). Gold Ynu sc has no cancelFirst —
 * that token is GoalProposal xou. Host answer is store.answer.
 */
import React from 'react';
import { handlePlanModeTransition } from '../../bootstrap/state.js';
import { Box, Text } from '@anthropic/ink';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useAppState } from '../../state/AppState.js';
import { Select } from '../../components/CustomSelect/index.js';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import type { DialogRendererProps } from '../DialogHost.js';
import {
  ENTER_PLAN_MODE_CANCEL_LABEL,
  ENTER_PLAN_MODE_CONFIRM_LABEL,
  type EnterPlanModeChoice,
  type EnterPlanModePermissionPayload,
  mintEnterPlanModeRow,
  resolveEnterPlanModeAnswer,
} from '../permissionEnterPlanMode.js';

export function PermissionEnterPlanModeDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as EnterPlanModePermissionPayload;
  const currentMode = useAppState(s => s.toolPermissionContext.mode);
  const row = mintEnterPlanModeRow();

  function handleChoice(choice: EnterPlanModeChoice): void {
    if (choice === 'yes' && row !== null) {
      logEvent('tengu_plan_enter', {
        entryMethod: 'tool' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      handlePlanModeTransition(currentMode, 'plan');
    }
    answer(resolveEnterPlanModeAnswer(choice, row));
  }

  return (
    <PermissionDialog color="planMode" title="Enter plan mode?" requestSource={p.requestSource}>
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text>Claude wants to enter plan mode to explore and design an implementation approach.</Text>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>In plan mode, Claude will:</Text>
          <Text dimColor> · Explore the codebase thoroughly</Text>
          <Text dimColor> · Identify existing patterns</Text>
          <Text dimColor> · Design an implementation strategy</Text>
          <Text dimColor> · Present a plan for your approval</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>No code changes will be made until you approve the plan.</Text>
        </Box>

        <Box marginTop={1}>
          <Select
            options={[
              { label: ENTER_PLAN_MODE_CONFIRM_LABEL, value: 'yes' as const },
              { label: ENTER_PLAN_MODE_CANCEL_LABEL, value: 'no' as const },
            ]}
            onChange={handleChoice}
            onCancel={() => handleChoice('no')}
          />
        </Box>
      </Box>
    </PermissionDialog>
  );
}
