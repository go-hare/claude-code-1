/**
 * densable 2.1.218 hGa — New / Edit scheduled task form.
 *
 * SEA ~240798877:
 *   title: New scheduled task | Edit '{id}'
 *   subtitle: Fire a prompt on a recurring schedule
 *   fields: Prompt, Schedule (5m/2h/1d or cron), Directory, Id, Permission mode, Model
 *
 * Local: write via upsertCronTask into .claude/scheduled_tasks.json.
 * Permission mode / model are densable daemon.json fields — stored only when
 * present on the densable path; local cron file keeps id/cron/prompt/recurring.
 */

import { basename, resolve } from 'path';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from '../CustomSelect/select.js';
import type { OptionWithDescription } from '../CustomSelect/select.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import TextInput from '../TextInput.js';
import { type CronTask, upsertCronTask } from '../../utils/cronTasks.js';
import { parseScheduleInput } from '../../utils/cron.js';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { errorMessage } from '../../utils/errors.js';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** densable eoi — auto id from dir basename + first words of prompt. */
export function autoScheduledTaskId(dir: string, prompt: string): string {
  const r = slugify(basename(dir));
  const n = slugify(prompt.split(/\s+/).slice(0, 4).join(' '));
  return [r, n].filter(Boolean).join('-') || 'task';
}

type Props = {
  existingIds: string[];
  prefill?: CronTask;
  defaultDir?: string;
  onCancel: () => void;
  onDone: (result?: string, options?: { display?: 'system' | 'skip' }) => void;
  onSaved: () => void | Promise<void>;
};

type Phase = 'form' | 'edit-prompt' | 'edit-schedule' | 'edit-dir' | 'edit-id';

export function ScheduledTaskFormDialog({
  existingIds,
  prefill,
  defaultDir,
  onCancel,
  onDone,
  onSaved,
}: Props): React.ReactNode {
  useRegisterOverlay('daemon-hub-scheduled-form');
  const isEdit = prefill !== undefined;
  const cwd = defaultDir ?? getOriginalCwd();

  const [prompt, setPrompt] = useState(prefill?.prompt ?? '');
  const [schedule, setSchedule] = useState(prefill?.cron ?? '');
  const [dirText, setDirText] = useState(prefill ? cwd : cwd);
  const [id, setId] = useState(prefill?.id ?? '');
  const [idUserEdited, setIdUserEdited] = useState(isEdit);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editCursor, setEditCursor] = useState(0);

  const resolvedDir = useMemo(() => resolve(dirText.trim() || cwd), [dirText, cwd]);

  // densable: auto id from prompt+dir until user edits id
  const effectiveId = useMemo(() => {
    if (idUserEdited && id.trim()) return id.trim();
    if (isEdit && prefill) return prefill.id;
    return autoScheduledTaskId(resolvedDir, prompt);
  }, [idUserEdited, id, isEdit, prefill, resolvedDir, prompt]);

  const scheduleHint = useMemo(() => {
    if (!schedule.trim()) return '5m, 2h, 1d  or  */15 * * * *';
    const parsed = parseScheduleInput(schedule);
    if ('error' in parsed) return parsed.error;
    return `${parsed.human} · ${parsed.cron}`;
  }, [schedule]);

  const save = useCallback(async () => {
    if (busy) return;
    setError(null);
    const parsed = parseScheduleInput(schedule);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    const taskId = effectiveId.trim();
    if (!taskId) {
      setError('id is required');
      return;
    }
    if (!prompt.trim()) {
      setError('prompt is required');
      return;
    }
    // densable: id uniqueness (excluding self when edit)
    const taken = existingIds.filter(x => (isEdit && prefill ? x !== prefill.id : true));
    if (taken.includes(taskId)) {
      setError(`id '${taskId}' is already in use`);
      return;
    }
    setBusy(true);
    try {
      // densable IBt always recurring for hub form
      const result = await upsertCronTask({
        id: taskId,
        cron: parsed.cron,
        prompt: prompt.trim(),
        recurring: true,
        enabled: isEdit && prefill ? prefill.enabled !== false : true,
      });
      await onSaved();
      onDone(result === 'created' ? `Created scheduled task '${taskId}'.` : `Updated scheduled task '${taskId}'.`, {
        display: 'system',
      });
    } catch (err) {
      setError(`Save failed: ${errorMessage(err)}`);
      setBusy(false);
    }
  }, [busy, schedule, effectiveId, prompt, existingIds, isEdit, prefill, onSaved, onDone]);

  if (phase !== 'form') {
    const labelMap: Record<Exclude<Phase, 'form'>, string> = {
      'edit-prompt': 'Prompt',
      'edit-schedule': 'Schedule',
      'edit-dir': 'Directory',
      'edit-id': 'Id',
    };
    const label = labelMap[phase];
    return (
      <PermissionDialog title={isEdit ? `Edit '${prefill!.id}'` : 'New scheduled task'}>
        <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
          <Text dimColor>Fire a prompt on a recurring schedule</Text>
          <Box>
            <Text bold>{label}: </Text>
            <TextInput
              value={editValue}
              onChange={setEditValue}
              onSubmit={v => {
                if (phase === 'edit-prompt') setPrompt(v);
                else if (phase === 'edit-schedule') setSchedule(v);
                else if (phase === 'edit-dir') setDirText(v.trim() || cwd);
                else if (phase === 'edit-id') {
                  setId(v.trim());
                  setIdUserEdited(true);
                }
                setPhase('form');
              }}
              cursorOffset={editCursor}
              onChangeCursorOffset={setEditCursor}
              columns={60}
              focus={true}
              showCursor={true}
              placeholder={
                phase === 'edit-schedule'
                  ? '5m, 2h, 1d  or  */15 * * * *'
                  : phase === 'edit-prompt'
                    ? '/babysit-prs'
                    : phase === 'edit-dir'
                      ? cwd
                      : effectiveId
              }
              onExit={() => setPhase('form')}
            />
          </Box>
          <Text dimColor>Enter to save · Esc to cancel</Text>
        </Box>
      </PermissionDialog>
    );
  }

  type Choice = 'edit-prompt' | 'edit-schedule' | 'edit-dir' | 'edit-id' | 'submit' | 'cancel';

  const options: OptionWithDescription<Choice>[] = [
    {
      label: `Prompt: ${prompt.trim() || '(empty)'}`,
      description: 'Sent to Claude on each fire. Slash commands work.',
      value: 'edit-prompt',
    },
    {
      label: `Schedule: ${schedule.trim() || '(empty)'}`,
      description: scheduleHint,
      value: 'edit-schedule',
    },
    {
      label: `Directory: ${resolvedDir}`,
      description: 'Working directory when the task fires.',
      value: 'edit-dir',
    },
    {
      label: `Id: ${effectiveId}`,
      description: idUserEdited ? 'Stable identifier for this task.' : 'Auto-generated from prompt and directory.',
      value: 'edit-id',
    },
    {
      label: isEdit ? 'Save changes' : 'Create task',
      description: 'Write to .claude/scheduled_tasks.json.',
      value: 'submit',
    },
    {
      label: 'Cancel',
      description: 'Discard changes and go back.',
      value: 'cancel',
    },
  ];

  return (
    <PermissionDialog title={isEdit ? `Edit '${prefill!.id}'` : 'New scheduled task'}>
      <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        <Text dimColor>Fire a prompt on a recurring schedule</Text>
        {error ? <Text color="error">{error}</Text> : null}
        <Box>
          <Select
            options={options}
            isDisabled={busy}
            onChange={v => {
              if (v === 'cancel') {
                onCancel();
                return;
              }
              if (v === 'submit') {
                void save();
                return;
              }
              if (v === 'edit-prompt') {
                setEditValue(prompt);
                setEditCursor(prompt.length);
                setPhase('edit-prompt');
                return;
              }
              if (v === 'edit-schedule') {
                setEditValue(schedule);
                setEditCursor(schedule.length);
                setPhase('edit-schedule');
                return;
              }
              if (v === 'edit-dir') {
                setEditValue(dirText);
                setEditCursor(dirText.length);
                setPhase('edit-dir');
                return;
              }
              if (v === 'edit-id') {
                setEditValue(effectiveId);
                setEditCursor(effectiveId.length);
                setPhase('edit-id');
              }
            }}
            onCancel={onCancel}
          />
        </Box>
      </Box>
    </PermissionDialog>
  );
}
