/**
 * densable 2.1.218 mGa — single scheduled task detail.
 *
 * SEA ~240789000:
 *   options: Enable|Disable, Edit, Remove, Back
 *   Remove → ba cancelFirst:
 *     title "Remove task?"
 *     subtitle "Delete '{id}' from daemon.json. The daemon will stop firing it on its next reconcile."
 *     Yes, remove / No, cancel
 *   fields: Cron / Directory / Prompt / Status (enabled|disabled) / Mode
 *
 * Local storage is `.claude/scheduled_tasks.json` (cronTasks) — densable
 * daemon.json path is product-equivalent for hub manage, not reinvented.
 */

import * as React from 'react';
import { useCallback, useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from '../CustomSelect/select.js';
import type { OptionWithDescription } from '../CustomSelect/select.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { type CronTask, isCronTaskEnabled, removeCronTasks, toggleCronTaskEnabled } from '../../utils/cronTasks.js';
import { cronToHuman } from '../../utils/cron.js';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { errorMessage } from '../../utils/errors.js';

export const SCHED_REMOVE_TASK_TITLE = 'Remove task?';
export const SCHED_REMOVE_TASK_CONFIRM = 'Yes, remove';
export const SCHED_REMOVE_TASK_CANCEL = 'No, cancel';

export function formatSchedRemoveSubtitle(id: string): string {
  return `Delete '${id}' from daemon.json. The daemon will stop firing it on its next reconcile.`;
}

type Props = {
  task: CronTask;
  onBack: () => void;
  onEdit: (task: CronTask) => void;
  onDone: (result?: string, options?: { display?: 'system' | 'skip' }) => void;
  refresh?: () => void | Promise<void>;
};

type Phase = 'detail' | 'confirm-remove';

export function ScheduledTaskDetailDialog({ task, onBack, onEdit, onDone, refresh }: Props): React.ReactNode {
  useRegisterOverlay('daemon-hub-scheduled-detail');
  const [phase, setPhase] = useState<Phase>('detail');
  const [busy, setBusy] = useState(false);
  // local view of enabled so toggle reflects immediately before refresh
  const [enabled, setEnabled] = useState(() => isCronTaskEnabled(task));

  const runToggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await toggleCronTaskEnabled(task.id);
      if (next === null) {
        onDone(`Toggle failed: task '${task.id}' not found.`, { display: 'system' });
        return;
      }
      setEnabled(next);
      await refresh?.();
      onDone(`${next ? 'Enabled' : 'Disabled'} scheduled task '${task.id}'.`, {
        display: 'system',
      });
    } catch (err) {
      onDone(`Toggle failed: ${errorMessage(err)}`, { display: 'system' });
    } finally {
      setBusy(false);
    }
  }, [busy, onDone, refresh, task.id]);

  const runRemove = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await removeCronTasks([task.id]);
      await refresh?.();
      onDone(`Removed scheduled task '${task.id}'.`, { display: 'system' });
    } catch (err) {
      onDone(`Remove failed: ${errorMessage(err)}`, { display: 'system' });
    } finally {
      setBusy(false);
    }
  }, [busy, onDone, refresh, task.id]);

  if (phase === 'confirm-remove') {
    const opts: OptionWithDescription<'yes' | 'no'>[] = [
      {
        label: SCHED_REMOVE_TASK_CANCEL,
        description: 'Keep this scheduled task.',
        value: 'no',
      },
      {
        label: SCHED_REMOVE_TASK_CONFIRM,
        description: 'Delete this task from scheduled_tasks.json.',
        value: 'yes',
      },
    ];
    return (
      <PermissionDialog title={SCHED_REMOVE_TASK_TITLE} subtitle={formatSchedRemoveSubtitle(task.id)} color="error">
        <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
          <Box>
            <Select
              options={opts}
              defaultValue={'no'}
              isDisabled={busy}
              onChange={v => {
                if (v === 'yes') void runRemove();
                else setPhase('detail');
              }}
              onCancel={() => setPhase('detail')}
            />
          </Box>
        </Box>
      </PermissionDialog>
    );
  }

  const toggleLabel = enabled ? 'Disable' : 'Enable';
  const detailOptions: OptionWithDescription<'toggle' | 'edit' | 'remove' | 'back'>[] = [
    {
      label: toggleLabel,
      description: enabled ? 'Stop firing this task until re-enabled.' : 'Allow the scheduler to fire this task again.',
      value: 'toggle',
    },
    {
      label: 'Edit',
      description: 'Change prompt / schedule / id.',
      value: 'edit',
    },
    {
      label: 'Remove',
      description: 'Delete this scheduled task.',
      value: 'remove',
    },
    {
      label: 'Back',
      description: 'Return to the Scheduled list.',
      value: 'back',
    },
  ];

  const statusLabel = enabled ? 'enabled' : 'disabled';
  const statusColor = enabled ? 'success' : undefined;
  const human = cronToHuman(task.cron);
  const directory = getOriginalCwd();

  return (
    <PermissionDialog title={task.id}>
      <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>
            Cron {task.cron} ({human})
          </Text>
          <Text dimColor>Directory {directory}</Text>
          <Text dimColor>Prompt {task.prompt}</Text>
          <Text dimColor>
            Status{'     '}
            <Text color={statusColor}>{statusLabel}</Text>
          </Text>
          <Text dimColor>
            Mode {task.recurring ? 'recurring' : 'one-shot'}
            {task.durable === false ? ' · session' : ''}
          </Text>
        </Box>
        <Box>
          <Select
            options={detailOptions}
            isDisabled={busy}
            onChange={v => {
              if (v === 'back') {
                onBack();
                return;
              }
              if (v === 'edit') {
                onEdit(task);
                return;
              }
              if (v === 'remove') {
                setPhase('confirm-remove');
                return;
              }
              void runToggle();
            }}
            onCancel={onBack}
          />
        </Box>
      </Box>
    </PermissionDialog>
  );
}
