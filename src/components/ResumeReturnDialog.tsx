/**
 * Official Oga densable UI — resume-return offer (compact | continue | never).
 * Pure evaluation lives in utils/resumeReturn.ts (CBp).
 */
import { Box, Dialog, Text } from '@anthropic/ink';
import React from 'react';
import {
  formatResumeReturnBanner,
  getResumeReturnWarning,
  RESUME_RETURN_OPTIONS,
  type ResumeReturnChoice,
} from '../utils/resumeReturn.js';
import { Select } from './CustomSelect/index.js';

export type ResumeReturnDialogProps = {
  sessionAgeMinutes: number;
  estimatedTokens: number;
  onChoice: (choice: ResumeReturnChoice) => void;
};

export function ResumeReturnDialog({
  sessionAgeMinutes,
  estimatedTokens,
  onChoice,
}: ResumeReturnDialogProps): React.ReactNode {
  return (
    <Dialog title={formatResumeReturnBanner(sessionAgeMinutes, estimatedTokens)} onCancel={() => onChoice('continue')}>
      <Box flexDirection="column">
        <Text>{getResumeReturnWarning()}</Text>
      </Box>
      <Select
        options={RESUME_RETURN_OPTIONS.map(o => ({
          label: o.label,
          value: o.value,
        }))}
        onChange={(value: ResumeReturnChoice) => onChoice(value)}
      />
    </Dialog>
  );
}
