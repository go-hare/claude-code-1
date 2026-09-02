/**
 * densable Lbs — "Background work is running" exit confirm.
 * Options: Exit and stop tasks / Move to background and exit (optional) / Stay.
 */
import React, { useMemo } from 'react';
import { Box, Dialog, Text, useIsInsideModal, useModalOrTerminalSize } from '@anthropic/ink';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
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
};

export function ExitBackgroundWorkDialog({ items, onExit, onCancel, onBackground }: Props): React.ReactNode {
  const terminal = useTerminalSize();
  const { rows } = useModalOrTerminalSize(terminal);
  const budget = lbsVisibleRowBudget(rows, useIsInsideModal(), isFullscreenActive());
  const maxVisible = Math.max(1, budget - (onBackground ? 13 : 12));
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

  function track(choice: Choice): void {
    logEvent('tengu_exit_background_work_prompt', {
      item_count: items.length,
      chose_exit: choice === 'exit',
      chose_background: choice === 'background',
    });
  }

  function handleChange(choice: Choice): void {
    track(choice);
    switch (choice) {
      case 'exit':
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
      onCancel={() => {
        track('stay');
        onCancel();
      }}
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
      {/* densable Ln: Esc is Dialog onCancel only — no Select onCancel. */}
      <Select options={options} onChange={handleChange} />
    </Dialog>
  );
}
