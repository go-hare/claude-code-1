/**
 * Official Oga densable UI — resume-return offer (compact | continue | never).
 * Pure evaluation lives in utils/resumeReturn.ts (CBp).
 */
import { Box, Dialog, Text } from '@anthropic/ink';
import React from 'react';
import { useRegisterOverlay } from '../context/overlayContext.js';
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
  onCancel?: () => void;
};

export function ResumeReturnDialog({
  sessionAgeMinutes,
  estimatedTokens,
  onChoice,
  onCancel,
}: ResumeReturnDialogProps): React.ReactNode {
  useRegisterOverlay('resume-return-dialog');
  const handleCancel = () => (onCancel !== undefined ? onCancel() : onChoice('continue'));
  return (
    <Dialog title={formatResumeReturnBanner(sessionAgeMinutes, estimatedTokens)} onCancel={handleCancel}>
      <Box flexDirection="column">
        <Text>{getResumeReturnWarning()}</Text>
      </Box>
      <Select
        options={RESUME_RETURN_OPTIONS.map(o => ({
          label: o.label,
          value: o.value,
        }))}
        onChange={(value: ResumeReturnChoice) => onChoice(value)}
        onCancel={handleCancel}
      />
    </Dialog>
  );
}
