/**
 * densable LAc — "Background this session?" left-arrow inflight confirm.
 */
import React, { useMemo } from 'react';
import { Dialog } from '@anthropic/ink';
import { formatMonitorParkSubtitle } from '../utils/leftArrowConfirm.js';
import { Select } from './CustomSelect/select.js';

type Props = {
  summary: string;
  carryOverCount: number;
  monitorParkCount: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export function LeftArrowConfirmDialog({
  summary,
  carryOverCount,
  monitorParkCount,
  onConfirm,
  onCancel,
}: Props): React.ReactNode {
  const stopped = summary ? `${summary} running — they will be stopped.` : '';
  const monitors = formatMonitorParkSubtitle(monitorParkCount);
  const carry =
    carryOverCount > 0
      ? `${carryOverCount} ${carryOverCount === 1 ? 'task carries' : 'tasks carry'} over to the background session.`
      : '';
  const subtitle = [stopped, monitors, carry].filter(Boolean).join(' ');
  const confirmLabel = summary ? 'Background anyway (tasks will be stopped)' : 'Background';

  const options = useMemo(
    () => [
      { label: confirmLabel, value: 'confirm' as const },
      { label: 'Stay', value: 'stay' as const },
    ],
    [confirmLabel],
  );

  return (
    <Dialog title="Background this session?" subtitle={subtitle || undefined} onCancel={onCancel}>
      {/* densable LAc: Esc is Dialog onCancel only — no Select onCancel. */}
      <Select
        options={options}
        onChange={v => {
          if (v === 'confirm') onConfirm();
          else onCancel();
        }}
      />
    </Dialog>
  );
}
