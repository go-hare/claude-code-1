/**
 * Official densable fullscreen TUI upsell dialog (Npf accept path).
 * Pure gate: utils/fullscreenUpsellGate.ts.
 * Accept → enable /tui marker + mark fully seen; decline → mark fully seen.
 *
 * densable 2.1.234: accept must pass live AppState into `/tui on` so W4e refuse
 * and Cmt+Rmt carry see `un(t)` (toolPermissionContext + effort), same as the
 * slash-command panel path — never callTui('on') with empty carry.
 */
import { Box, Dialog, Text } from '@anthropic/ink';
import React from 'react';
import { callTui, type TuiRelaunchCarryInput } from '../commands/tui/index.js';
import { useAppStateStore } from '../state/AppState.js';
import { saveGlobalConfig } from '../utils/config.js';
import { markFullscreenUpsellFullySeen, recordFullscreenUpsellImpression } from '../utils/fullscreenUpsellGate.js';
import { Select } from './CustomSelect/index.js';

export type FullscreenUpsellDialogProps = {
  onDone: (result: 'accepted' | 'declined') => void;
};

type Choice = 'accept' | 'decline';

/** densable un(t) + taskRegistry snapshot for /tui relaunch from upsell accept. */
export function carryFromAppStore(store: {
  getState: () => {
    toolPermissionContext?: TuiRelaunchCarryInput['toolPermissionContext'];
    effortValue?: unknown;
    tasks?: TuiRelaunchCarryInput['tasks'];
  };
}): TuiRelaunchCarryInput | undefined {
  try {
    const state = store.getState();
    if (!state.toolPermissionContext && !state.tasks) return undefined;
    return {
      toolPermissionContext: state.toolPermissionContext,
      effort: state.effortValue,
      tasks: state.tasks,
    };
  } catch {
    return undefined;
  }
}

export function FullscreenUpsellDialog({ onDone }: FullscreenUpsellDialogProps): React.ReactNode {
  const store = useAppStateStore();

  // Official udc: increment seen on show so an unanswered prompt still counts
  // toward M4r=3 (changelog #21). Decline still jfn-caps at max.
  React.useEffect(() => {
    saveGlobalConfig(prev => ({
      ...prev,
      ...recordFullscreenUpsellImpression(prev),
    }));
  }, []);

  function handleSelect(value: Choice): void {
    if (value === 'accept') {
      // densable 2.1.234: /tui on path owns W4e refuse + Cmt/Rmt carry + OLt
      // relaunch (callTui → enableTui → acceptTuiRelaunch). Do not double-call
      // acceptTuiRelaunch here.
      void (async () => {
        await callTui('on', carryFromAppStore(store));
        saveGlobalConfig(prev => ({
          ...prev,
          ...markFullscreenUpsellFullySeen(prev),
        }));
        onDone('accepted');
      })();
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
