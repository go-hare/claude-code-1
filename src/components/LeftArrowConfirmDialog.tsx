/**
 * densable LAc — "Background this session?" left-arrow inflight confirm.
 */
import React from 'react';
import { Dialog } from '@anthropic/ink';
import {
  EMPTY_WORKFLOW_AGENTS,
  formatMonitorParkSubtitle,
  formatWorkflowAgentsConfirmLabel,
  formatWorkflowAgentsSubtitle,
  type WorkflowAgentsCount,
} from '../utils/leftArrowConfirm.js';
import { ConfirmSelect } from './ConfirmSelect.js';

type Props = {
  summary: string;
  carryOverCount: number;
  monitorParkCount: number;
  workflowAgents?: WorkflowAgentsCount;
  onConfirm: () => void;
  onCancel: () => void;
};

export function LeftArrowConfirmDialog({
  summary,
  carryOverCount,
  monitorParkCount,
  workflowAgents = EMPTY_WORKFLOW_AGENTS,
  onConfirm,
  onCancel,
}: Props): React.ReactNode {
  const stopped = summary ? `${summary} running — they will be stopped.` : '';
  const monitors = formatMonitorParkSubtitle(monitorParkCount);
  const carry =
    carryOverCount > 0
      ? `${carryOverCount} ${carryOverCount === 1 ? 'task carries' : 'tasks carry'} over to the background session.`
      : '';
  const workflow = formatWorkflowAgentsSubtitle(workflowAgents);
  const subtitle = [stopped, monitors, carry, workflow].filter(Boolean).join(' ');
  const confirmLabel = formatWorkflowAgentsConfirmLabel(summary !== '', workflowAgents);

  return (
    <Dialog title="Background this session?" subtitle={subtitle || undefined} onCancel={onCancel}>
      <ConfirmSelect confirmLabel={confirmLabel} cancelLabel="Stay" onConfirm={onConfirm} onCancel={onCancel} />
    </Dialog>
  );
}
