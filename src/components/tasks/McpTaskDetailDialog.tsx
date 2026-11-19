import React from 'react';
import { Box, Byline, Dialog, type KeyboardEvent, KeyboardShortcutHint, Text } from '@anthropic/ink';
import type { McpTaskState } from 'src/tasks/McpTask/McpTask.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { formatDuration } from '../../utils/format.js';
import { sanitizeMcpTaskId, sanitizeMcpTaskText } from './BackgroundTask.js';

type Props = {
  task: DeepImmutable<McpTaskState>;
  onDone: () => void;
  onKill?: () => void;
  onBack?: () => void;
};

/**
 * densable `CF` / `McpTaskDetailDialog` (@219097500).
 */
export function McpTaskDetailDialog({ task, onDone, onKill, onBack }: Props): React.ReactNode {
  // Official 2.1.325 #2307/#2367: when a running MCP task has an off-screen
  // question waiting for the user's answer, Enter reopens it and closes /tasks.
  const openQuestion = task.status === 'running' ? task.openQuestion : undefined;
  const handleEnter = openQuestion
    ? () => {
        openQuestion();
        onDone();
      }
    : undefined;

  const handleKill =
    task.status === 'running' && onKill
      ? () => {
          onKill();
          onBack?.();
        }
      : undefined;

  useKeybindings({ 'confirm:yes': handleEnter ?? onDone }, { context: 'Confirmation' });

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      e.preventDefault();
      onDone();
    } else if (e.key === 'left' && onBack) {
      e.preventDefault();
      onBack();
    } else if (e.key === 'x' && !e.ctrl && !e.meta && handleKill) {
      e.preventDefault();
      handleKill();
    }
  };

  const elapsed = useElapsedTime(task.startTime, task.status === 'running', 1000, 0, task.endTime);
  const pollEvery = task.pollIntervalMs === undefined ? undefined : formatDuration(task.pollIntervalMs);
  const serverTaskId = task.mcpTaskId === task.id ? undefined : task.mcpTaskId;
  const serverName = sanitizeMcpTaskText(task.serverName) ?? '';
  const toolName = sanitizeMcpTaskText(task.toolName) ?? '';
  const statusLabel = task.status === 'killed' ? 'stopped' : task.mcpStatus.replace('_', ' ');
  const statusMessage = task.statusMessage ? sanitizeMcpTaskText(task.statusMessage) : undefined;
  const elapsedPrefix = task.status === 'running' ? 'running for ' : 'ran for ';
  const pollSuffix = pollEvery !== undefined ? ` · polls every ${pollEvery}` : '';

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="MCP task"
        onCancel={onBack ?? onDone}
        color="background"
        inputGuide={exitState =>
          exitState.pending ? (
            <Text>Press {exitState.keyName} again to exit</Text>
          ) : (
            <Byline>
              {openQuestion && <KeyboardShortcutHint shortcut="Enter" action="answer" />}
              <KeyboardShortcutHint shortcut="Esc" action="go back" />
              {task.status === 'running' && onKill && <KeyboardShortcutHint shortcut="x" action="stop" />}
            </Byline>
          )
        }
      >
        <Box flexDirection="column">
          <Text>
            <Text bold>
              {serverName}/{toolName}
            </Text>
            <Text dimColor>{` · ${task.id}`}</Text>
          </Text>
          {serverTaskId && <Text dimColor>{`server task ${sanitizeMcpTaskId(serverTaskId)}`}</Text>}
          <Text>
            <Text dimColor>status </Text>
            {statusLabel}
            {statusMessage && <Text dimColor>{` · ${statusMessage}`}</Text>}
          </Text>
          {openQuestion ? (
            <Text color="warning">the server is waiting for your answer</Text>
          ) : (
            task.mcpStatus === 'input_required' &&
            task.status === 'running' && <Text dimColor>waiting for the server</Text>
          )}
          <Text dimColor>
            {elapsedPrefix}
            {elapsed}
            {pollSuffix}
          </Text>
          {task.protocol === 'sep2663' && task.status === 'running' && (
            <Text dimColor>runs on the server; survives exiting this session</Text>
          )}
        </Box>
      </Dialog>
    </Box>
  );
}
