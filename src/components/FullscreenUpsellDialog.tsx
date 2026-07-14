/**
 * Official densable fullscreen TUI upsell dialog (Npf accept path).
 * Pure gate: utils/fullscreenUpsellGate.ts.
 * Accept → enable /tui marker + mark fully seen; decline → mark fully seen.
 */
import { Box, Dialog, Text } from '@anthropic/ink';
import React from 'react';
import { callTui } from '../commands/tui/index.js';
import { saveGlobalConfig } from '../utils/config.js';
import { markFullscreenUpsellFullySeen } from '../utils/fullscreenUpsellGate.js';
import { Select } from './CustomSelect/index.js';

export type FullscreenUpsellDialogProps = {
  onDone: (result: 'accepted' | 'declined') => void;
};

type Choice = 'accept' | 'decline';

export function FullscreenUpsellDialog({ onDone }: FullscreenUpsellDialogProps): React.ReactNode {
  function handleSelect(value: Choice): void {
    if (value === 'accept') {
      void callTui('on');
      saveGlobalConfig(prev => ({
        ...prev,
        ...markFullscreenUpsellFullySeen(prev),
      }));
      // Official OLt densable accept: inject env; optional spawnSync when
      // CLAUDE_CODE_SPAWN_TUI_RELAUNCH=1 (process replacement densable).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { acceptTuiRelaunch } = require('../utils/cliRelaunch.js') as typeof import('../utils/cliRelaunch.js');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getSessionId } = require('../bootstrap/state.js') as typeof import('../bootstrap/state.js');
        const result = acceptTuiRelaunch({
          target: 'fullscreen',
          sessionId: getSessionId(),
          hasNonEmptyTranscript: true,
          screenReaderEnv: {},
        });
        if (result.mode === 'spawned' && result.spawn.ok) {
          // Child inherited session; parent exits like official PNe consumer.
          process.exit(result.spawn.status ?? 0);
        }
      } catch {
        // densable optional
      }
      onDone('accepted');
      return;
    }
    saveGlobalConfig(prev => ({
      ...prev,
      ...markFullscreenUpsellFullySeen(prev),
    }));
    onDone('declined');
  }

  return (
    <Dialog title="Flicker-free rendering" onCancel={() => handleSelect('decline')}>
      <Box flexDirection="column">
        <Text>
          Claude Code can use flicker-free full-screen rendering. Enable now? Takes effect on the next session start.
        </Text>
        <Text dimColor>You can also run /tui on later. To go back: /tui off.</Text>
      </Box>
      <Select
        options={[
          {
            label: 'Enable flicker-free rendering',
            value: 'accept' as const,
          },
          {
            label: 'Not now',
            value: 'decline' as const,
          },
        ]}
        onChange={handleSelect}
      />
    </Dialog>
  );
}
