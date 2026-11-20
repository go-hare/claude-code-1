/**
 * densable Lbs — "Background work is running" exit confirm.
 * Options: Exit and stop tasks / Move to background and exit (optional) / Stay.
 */
import React, { useMemo } from 'react';
import { Box, Dialog, Text, useIsInsideModal, useModalOrTerminalSize } from '@anthropic/ink';
import { markSessionExiting } from '../dialog/useDialogMailboxBridge.js';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { logEvent } from '../services/analytics/index.js';
import type { ExitBackgroundWorkItem } from '../utils/exitBackgroundItems.js';
import { isFullscreenActive } from '../utils/fullscreen.js';
import { plural } from '../utils/stringUtils.js';
import { Select } from './CustomSelect/select.js';

/**
 * densable Lbs row budget: `!Gw()&&uq()?Math.floor(rows/2):rows`.
 * Gw = ModalContext; uq = isFullscreenActive; Fg already swaps modal rows.
 */
export function lbsVisibleRowBudget(rows: number, insideModal: boolean, fullscreen: boolean): number {
  return !insideModal && fullscreen ? Math.floor(rows / 2) : rows;
}

type Choice = 'exit' | 'background' | 'stay';

type Props = {
  items: readonly ExitBackgroundWorkItem[];
  onExit: () => void;
  onCancel: () => void;
  /** densable onBackground — only when Dbs(messages) / canBackgroundSession. */
  onBackground?: () => void;
  /** Official 2.1.325 (#2292): error message when moving to background was refused. */
  refusal?: string;
};

export function ExitBackgroundWorkDialog({ items, onExit, onCancel, onBackground, refusal }: Props): React.ReactNode {
  const terminal = useTerminalSize();
  const { rows, columns } = useModalOrTerminalSize(terminal);
  const budget = lbsVisibleRowBudget(rows, useIsInsideModal(), isFullscreenActive());
  const refusalRows = refusal === undefined ? 0 : Math.ceil(refusal.length / Math.max(1, columns - 8)) + 1;
  const maxVisible = Math.max(1, budget - (onBackground ? 13 : 12) - refusalRows);
  const visible = items.slice(0, maxVisible);
  const overflow = items.length - visible.length;

  const options = useMemo(() => {
    const opts: { label: string; value: Choice }[] = [{ label: 'Exit and stop tasks', value: 'exit' }];
    if (onBackground) {
      opts.push({ label: 'Move to background and exit', value: 'background' });
    }
    opts.push({ label: 'Stay', value: 'stay' });
    return opts;
  }, [onBackground]);

  // Official 2.1.325 (#2292): after a move to background is refused, focus
  // "Stay" so a second Enter does not stop background work.
  const defaultFocusValue: Choice | undefined = refusal === undefined ? undefined : 'stay';

  function track(choice: Choice): void {
    logEvent('tengu_exit_background_work_prompt', {
      item_count: items.length,
      chose_exit: choice === 'exit',
      chose_background: choice === 'background',
    });
  }

  const handleCancel = (): void => {
    track('stay');
    onCancel();
  };

  // Official 2.1.326 #108: mark session exiting on double Ctrl+C/Ctrl+D before Ink unmounts
  // so pending background-agent permission dialogs are not resolved as user refusal.
  const exitState = useExitOnCtrlCDWithKeybindings(() => {
    markSessionExiting();
    track('exit');
    onExit();
  });

  useKeybinding('confirm:no', handleCancel, { context: 'Confirmation' });

  function handleChange(choice: Choice): void {
    track(choice);
    switch (choice) {
      case 'exit':
        markSessionExiting();
        onExit();
        return;
      case 'background':
        onBackground?.();
        return;
      case 'stay':
        onCancel();
        return;
    }
  }

  return (
    <Dialog
      title="Background work is running"
      subtitle="The following will stop when you exit:"
      onCancel={handleCancel}
      isCancelActive={false}
      inputGuide={exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : undefined}
    >
      <Box flexDirection="column" gap={0}>
        {visible.map((item, i) => (
          <Box key={`${item.label}-${i}`} flexDirection="row">
            <Text bold>{item.label}</Text>
            {item.detail ? (
              <Text dimColor>
                {' · '}
                {item.detail}
              </Text>
            ) : null}
          </Box>
        ))}
        {overflow > 0 ? (
          <Text dimColor>
            …and {overflow} more {plural(overflow, 'item')}
          </Text>
        ) : null}
      </Box>
      {refusal !== undefined && <Text color="error">{refusal}</Text>}
      {/* densable Ln: Esc is Dialog onCancel only — no Select onCancel. */}
      <Select
        key={refusal === undefined ? 'default' : 'refused'}
        options={options}
        defaultFocusValue={defaultFocusValue}
        onChange={handleChange}
      />
    </Dialog>
  );
}
