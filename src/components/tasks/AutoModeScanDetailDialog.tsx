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
  const elapsedTime = useElapsedTime(task.startTime, task.status === 'running', 1000, 0);

  useKeybindings({ 'confirm:yes': onDone }, { context: 'Confirmation' });

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'left' && onBack) {
      e.preventDefault();
      onBack();
    } else if (e.key === 'x' && task.status === 'running' && onKill) {
      e.preventDefault();
      onKill();
    }
  };

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="Auto-mode setup scan"
        subtitle={<Text dimColor>{elapsedTime}</Text>}
        onCancel={onBack ?? onDone}
        color="background"
        inputGuide={exitState =>
          exitState.pending ? (
            <Text>Press {exitState.keyName} again to exit</Text>
          ) : (
            <Byline>
              {onBack && <KeyboardShortcutHint shortcut="←" action="go back" />}
              <KeyboardShortcutHint shortcut="Esc/Enter" action="close" />
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
          <Text>
            <Text bold>Description:</Text> {task.description}
          </Text>
          {task.gathersFromGitHubOrg && <Text dimColor>Includes GitHub org repository scan</Text>}
        </Box>
      </Dialog>
    </Box>
  );
}
