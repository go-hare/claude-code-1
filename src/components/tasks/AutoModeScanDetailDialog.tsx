import React from 'react';
import type { DeepImmutable } from 'src/types/utils.js';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';
import { Box, Text, type KeyboardEvent } from '@anthropic/ink';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { AutoModeScanTaskState } from '../../tasks/AutoModeScanTask/AutoModeScanTask.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';

type Props = {
  task: DeepImmutable<AutoModeScanTaskState>;
  onDone: () => void;
  onBack?: () => void;
  onKill?: () => void;
};

export function AutoModeScanDetailDialog({ task, onDone, onBack, onKill }: Props): React.ReactNode {
  const elapsedTime = useElapsedTime(task.startTime, task.status === 'running', 1000, 0, task.endTime);

  useKeybindings({ 'confirm:yes': onDone }, { context: 'Confirmation' });

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      e.preventDefault();
      onDone();
    } else if (e.key === 'left' && onBack) {
      e.preventDefault();
      onBack();
    } else if (e.key === 'x' && !e.ctrl && !e.meta && task.status === 'running' && onKill) {
      e.preventDefault();
      onKill();
    }
  };

  const bodyCopy =
    task.status === 'running'
      ? task.gathersFromGitHubOrg
        ? 'Scanning your repo, recent sessions, and your GitHub org, then drafting an auto-mode proposal. The review will pop up when it’s ready.'
        : 'Scanning your repo and recent sessions, then drafting an auto-mode proposal. The review will pop up when it’s ready.'
      : task.status === 'completed'
        ? 'Scan finished — the proposal review pops up next (or has already been shown).'
        : 'The scan ended without producing a proposal.';

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="Auto-mode setup scan"
        subtitle={<Text dimColor>{elapsedTime}</Text>}
        onCancel={onDone}
        color="background"
        inputGuide={exitState =>
          exitState.pending ? (
            <Text>Press {exitState.keyName} again to exit</Text>
          ) : (
            <Byline>
              {onBack && <KeyboardShortcutHint shortcut="←" action="go back" />}
              <KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />
              {task.status === 'running' && onKill && <KeyboardShortcutHint shortcut="x" action="stop" />}
            </Byline>
          )
        }
      >
        <Box flexDirection="column" gap={1}>
          <Text>
            <Text bold>Status:</Text>{' '}
            {task.status === 'running' ? (
              <Text color="background">running</Text>
            ) : task.status === 'completed' ? (
              <Text color="success">{task.status}</Text>
            ) : (
              <Text color="error">{task.status}</Text>
            )}
          </Text>
          <Text dimColor>{bodyCopy}</Text>
        </Box>
      </Dialog>
    </Box>
  );
}
