import * as React from 'react';
import { StatusIcon, Text } from '@anthropic/ink';
import type { TaskStatus } from 'src/Task.js';
import { isArtifactCommentMonitor } from 'src/tasks/pillLabel.js';
import type { BackgroundTaskState } from 'src/tasks/types.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { count } from 'src/utils/array.js';
import { EFFORT_LEVELS } from 'src/utils/effort.js';
import { truncate } from 'src/utils/format.js';
import { getPublicModelDisplayName } from 'src/utils/model/model.js';
import { getAPIProvider } from 'src/utils/model/providers.js';
import { plural } from 'src/utils/stringUtils.js';
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../../constants/figures.js';
import { toInkColor } from '../../utils/ink.js';
import { RemoteSessionProgress } from './RemoteSessionProgress.js';
import { ShellProgress, TaskStatusText } from './ShellProgress.js';
import { describeTeammateActivity } from './taskStatusUtils.js';

const COMMENT_AUTO_REPLY_LABEL = 'auto-replying to comments';

function sanitizeModelLabel(model: string): string {
  const cleaned = model.replace(/[^A-Za-z0-9._:/@[\]-]/g, '');
  if (cleaned.length === 0) return '(unrecognized model name)';
  return cleaned.length > 128 ? `${cleaned.slice(0, 128)}…` : cleaned;
}

function normalizeEffortLabel(effort: unknown): string {
  if (typeof effort === 'string' && (EFFORT_LEVELS as readonly string[]).includes(effort)) {
    return effort;
  }
  return 'high';
}

export function formatTaskModelEffort(model: string | undefined, effort: unknown): string | null {
  if (!model) return null;
  const display =
    (getAPIProvider() === 'foundry' ? null : getPublicModelDisplayName(model)) ?? sanitizeModelLabel(model);
  const effortLabel = effort === undefined || typeof effort === 'number' ? undefined : normalizeEffortLabel(effort);
  return effortLabel !== undefined ? `${display} (${effortLabel})` : display;
}

export function renderBackgroundTaskStatusIcon(status: TaskStatus): React.ReactNode {
  switch (status) {
    case 'running':
      return <StatusIcon status="running" />;
    case 'pending':
      return <StatusIcon status="pending" />;
    case 'completed':
      return <StatusIcon status="success" />;
    case 'failed':
      return <StatusIcon status="error" />;
    case 'killed':
      return <StatusIcon status="warning" aria-label="stopped:" />;
    case 'paused':
      return <StatusIcon status="off" aria-label="paused:" />;
  }
}

export function formatShellStatusFact(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    case 'killed':
      return 'stopped';
    case 'running':
    case 'pending':
    case 'paused':
      return 'running';
  }
}

function formatRemoteSessionFact(
  session: DeepImmutable<Extract<BackgroundTaskState, { type: 'remote_agent' }>>,
): string {
  if (session.status === 'completed') return 'done';
  if (session.status === 'failed') return 'error';
  if (!session.todoList.length) return `${session.status}…`;
  return `${count(session.todoList, item => item.status === 'completed')}/${session.todoList.length}`;
}

export type BackgroundTaskItemPresentation = {
  label: string;
  icon: React.ReactNode;
  facts: string[];
};

export function getBackgroundTaskItemPresentation(
  task: DeepImmutable<BackgroundTaskState>,
): BackgroundTaskItemPresentation | null {
  const unread = task.status === 'completed' && !task.notified ? ', unread' : '';
  switch (task.type) {
    case 'local_bash':
      return {
        label: task.kind === 'monitor' ? task.description : task.command,
        icon: renderBackgroundTaskStatusIcon(task.status),
        facts: [formatShellStatusFact(task.status)],
      };
    case 'remote_agent':
      if (task.isRemoteReview) return null;
      return {
        label: task.title,
        icon: (
          <Text dimColor>{task.status === 'running' || task.status === 'pending' ? DIAMOND_OPEN : DIAMOND_FILLED}</Text>
        ),
        facts: [formatRemoteSessionFact(task)],
      };
    case 'local_agent': {
      const isParked = task.status === 'completed' && 'quietlyParked' in task && task.quietlyParked === true;
      const modelEffort = formatTaskModelEffort(task.model, task.effort);
      return {
        label: task.description,
        icon: isParked ? (
          <StatusIcon status="pending" aria-label="parked:" />
        ) : (
          renderBackgroundTaskStatusIcon(task.status)
        ),
        facts: [
          `${task.status === 'completed' ? (isParked ? 'parked' : 'done') : task.status}${unread}`,
          ...(modelEffort ? [truncate(modelEffort, 28, true)] : []),
        ],
      };
    }
    case 'in_process_teammate':
      return null;
    case 'local_workflow':
      return {
        label: task.workflowName ?? task.summary ?? task.description,
        icon: renderBackgroundTaskStatusIcon(task.status),
        facts: [
          `${
            task.status === 'running'
              ? `${task.agentCount} ${plural(task.agentCount, 'agent')}`
              : task.status === 'completed'
                ? 'done'
                : task.status
          }${unread}`,
        ],
      };
    case 'monitor_mcp':
    case 'monitor_ws':
      return {
        label: task.description,
        icon: renderBackgroundTaskStatusIcon(task.status),
        facts: [
          `${
            task.status === 'completed'
              ? 'done'
              : isArtifactCommentMonitor(task)
                ? COMMENT_AUTO_REPLY_LABEL
                : task.status
          }${unread}`,
        ],
      };
    case 'dream': {
      const n = task.filesTouched.length;
      return {
        label: task.description,
        icon: renderBackgroundTaskStatusIcon(task.status),
        facts: [
          `${task.status === 'completed' ? 'done' : task.status}${unread}`,
          task.phase,
          task.phase === 'updating' && n > 0
            ? `${n} ${plural(n, 'file')}`
            : `${task.sessionsReviewing} ${plural(task.sessionsReviewing, 'session')}`,
        ],
      };
    }
    case 'auto_mode_scan':
      return {
        label: task.description,
        icon: renderBackgroundTaskStatusIcon(task.status),
        facts: [task.status],
      };
  }
}

type Props = {
  task: DeepImmutable<BackgroundTaskState>;
  maxActivityWidth?: number;
};

export function BackgroundTask({ task, maxActivityWidth }: Props): React.ReactNode {
  const activityLimit = maxActivityWidth ?? 40;
  switch (task.type) {
    case 'local_bash':
      return (
        <Text>
          {truncate(task.kind === 'monitor' ? task.description : task.command, activityLimit, true)}{' '}
          <ShellProgress shell={task} />
        </Text>
      );
    case 'remote_agent': {
      if (task.isRemoteReview) {
        return (
          <Text>
            <RemoteSessionProgress session={task} />
          </Text>
        );
      }
      const running = task.status === 'running' || task.status === 'pending';
      return (
        <Text>
          <Text dimColor>{running ? DIAMOND_OPEN : DIAMOND_FILLED} </Text>
          {truncate(task.title, activityLimit, true)}
          <Text dimColor> · </Text>
          <RemoteSessionProgress session={task} />
        </Text>
      );
    }
    case 'local_agent': {
      const isParked = task.status === 'completed' && task.quietlyParked === true;
      return (
        <Text>
          {truncate(task.description, activityLimit, true)}
          {task.model ? ` · ${task.model}` : ''}
          {task.effort ? ` · ${task.effort}` : ''}{' '}
          <TaskStatusText
            status={task.status}
            label={task.status === 'completed' ? (isParked ? 'parked' : 'done') : undefined}
            suffix={task.status === 'completed' && !task.notified ? ', unread' : undefined}
          />
        </Text>
      );
    }
    case 'in_process_teammate': {
      const activity = describeTeammateActivity(task);
      return (
        <Text wrap="truncate-end">
          <Text color={toInkColor(task.identity.color)}>@{task.identity.agentName}</Text>
          <Text dimColor>: {truncate(activity, activityLimit, true)}</Text>
        </Text>
      );
    }
    case 'local_workflow': {
      const _task = task as Record<string, unknown>;
      return (
        <Text>
          {truncate(
            ((_task.workflowName as string) ?? task.summary ?? task.description) as string,
            activityLimit,
            true,
          )}{' '}
          <TaskStatusText
            status={task.status}
            label={
              task.status === 'running'
                ? `${_task.agentCount as number} ${plural(_task.agentCount as number, 'agent')}`
                : task.status === 'completed'
                  ? 'done'
                  : undefined
            }
            suffix={task.status === 'completed' && !task.notified ? ', unread' : undefined}
          />
        </Text>
      );
    }
    case 'monitor_mcp':
    case 'monitor_ws':
      return (
        <Text>
          {truncate(task.description, activityLimit, true)}{' '}
          <TaskStatusText
            status={task.status}
            label={
              task.status === 'completed'
                ? 'done'
                : isArtifactCommentMonitor(task)
                  ? COMMENT_AUTO_REPLY_LABEL
                  : undefined
            }
            suffix={task.status === 'completed' && !task.notified ? ', unread' : undefined}
          />
        </Text>
      );
    case 'auto_mode_scan':
      return (
        <Text>
          {truncate(task.description, activityLimit, true)}{' '}
          <TaskStatusText
            status={task.status}
            label={task.status === 'completed' ? 'done' : undefined}
            suffix={task.status === 'completed' && !task.notified ? ', unread' : undefined}
          />
        </Text>
      );
    case 'dream': {
      const n = task.filesTouched.length;
      const detail =
        task.phase === 'updating' && n > 0
          ? `${n} ${plural(n, 'file')}`
          : `${task.sessionsReviewing} ${plural(task.sessionsReviewing, 'session')}`;
      return (
        <Text>
          {task.description}{' '}
          <Text dimColor>
            · {task.phase} · {detail}
          </Text>{' '}
          <TaskStatusText
            status={task.status}
            label={task.status === 'completed' ? 'done' : undefined}
            suffix={task.status === 'completed' && !task.notified ? ', unread' : undefined}
          />
        </Text>
      );
    }
  }
}
